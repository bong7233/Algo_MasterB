/* highlight.js — 의존성 없는 구문 강조기 (Algorithmic)
 *
 * window.HL.highlight(code, lang) -> HTML 문자열. 이스케이프까지 여기서 책임진다.
 * 지원 lang: python cpp text bash json console (+ 몇 가지 별칭). 그 외는 이스케이프만.
 *
 * 설계 두 가지가 이 파일 전체를 결정한다.
 *
 * 1) 스캐너는 "정규식 규칙 나열"이 아니라 첫 글자로 분기하는 손수 짠 루프다.
 *    문자열 안의 `#`/`//`, 주석 안의 `"`, 이스케이프된 따옴표 같은 함정은
 *    "문자열을 만나면 끝까지 통째로 소비한다"는 순서 보장이 있어야만 안 깨진다.
 *    규칙 테이블은 이 순서를 사람이 눈으로 지켜야 해서 실수가 나기 쉽다.
 *
 * 2) 토큰을 만들 때는 개행을 품은 채로 두고, HTML로 뱉을 때 개행에서 span을 끊는다.
 *    호출자(markdown.js)가 결과 HTML을 `\n`으로 잘라 줄 번호를 붙이기 때문에
 *    span이 개행을 가로지르면 각 줄이 깨진 HTML이 된다. 파이썬 삼중따옴표나
 *    C++ 블록 주석처럼 여러 줄짜리 토큰은 줄마다 span을 닫고 다시 연다.
 */
(function (global) {
  'use strict';

  /* ---------- 이스케이프 ---------- */

  // 큰따옴표까지 escape 하는 이유: 나중에 이 결과를 속성값 안에 넣는 실수가 나도 안전하게.
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- 토큰 목록 → HTML ---------- */

  function push(out, cls, text) {
    if (text) out.push({ c: cls, t: text });
  }

  // 토큰의 개행마다 span을 끊는다. 이게 "줄 단위로 HTML이 온전하다"는 계약의 핵심.
  function render(tokens) {
    var buf = [];
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var parts = tok.t.split('\n');
      for (var j = 0; j < parts.length; j++) {
        if (j > 0) buf.push('\n');
        var seg = parts[j];
        if (!seg) continue; // 빈 조각에 빈 span을 만들 이유가 없다
        buf.push(tok.c ? '<span class="hl-' + tok.c + '">' + esc(seg) + '</span>' : esc(seg));
      }
    }
    return buf.join('');
  }

  /* ---------- 공용 헬퍼 ---------- */

  function setOf(words) {
    var o = Object.create(null), a = words.split(' ');
    for (var i = 0; i < a.length; i++) if (a[i]) o[a[i]] = true;
    return o;
  }

  var RE_WS = /[ \t\f\v]+/;
  var RE_IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/;

  function isSpace(ch) { return ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v'; }
  function isDigit(ch) { return ch >= '0' && ch <= '9'; }
  function isIdentStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
  }
  function isIdentChar(ch) { return isIdentStart(ch) || isDigit(ch); }

  // 앞쪽이 공백뿐인가. 파이썬 데코레이터(@)와 C++ 전처리기(#) 판정에 쓴다.
  // 뒤돌아보기 정규식(lookbehind)은 구형 사파리에서 문법 에러로 파일 전체를 죽이므로 안 쓴다.
  function atLineStart(src, i) {
    for (var p = i - 1; p >= 0; p--) {
      var ch = src.charAt(p);
      if (ch === '\n') return true;
      if (!isSpace(ch)) return false;
    }
    return true;
  }

  // 식별자 다음에 (공백을 건너뛰고) 여는 괄호가 오면 호출/정의 지점이다.
  function callsAhead(src, i) {
    while (i < src.length && isSpace(src.charAt(i))) i++;
    return src.charAt(i) === '(';
  }

  // 창(window)을 잘라 매칭한다. 매 토큰마다 문자열 끝까지 slice 하면 O(n^2)가 되고,
  // 400자를 넘는 식별자·숫자·공백 덩어리는 실제 코드에 없다.
  function matchAt(src, i, re) {
    var m = re.exec(src.slice(i, i + 400));
    if (m && m.index === 0 && m[0].length) return m[0];
    return null;
  }

  // 긴 연산자부터 시도해야 `<<=` 가 `<`+`<`+`=` 로 쪼개지지 않는다.
  function matchOp(src, i, ops) {
    for (var k = 0; k < ops.length; k++) {
      var op = ops[k];
      if (src.substr(i, op.length) === op) return op;
    }
    return null;
  }

  /* ---------- 문자열 스캐너 ---------- */

  // 여는 따옴표 위치 i에서 시작해 닫는 위치(배타적)를 돌려준다.
  // 역슬래시는 다음 한 글자를 무조건 삼킨다 → "\"" 가 문자열을 조기 종료시키지 않는다.
  // (파이썬 raw 문자열도 값에는 역슬래시가 남을 뿐, 종료 판정은 동일하다.)
  function scanQuoted(src, i, quote, triple) {
    var n = src.length;
    var p = i + (triple ? 3 : 1);
    var close = triple ? quote + quote + quote : quote;
    while (p < n) {
      var ch = src.charAt(p);
      if (ch === '\\') { p += 2; continue; }
      // 한 줄 문자열이 닫히지 않은 채 개행을 만나면 거기서 끊는다.
      // 안 그러면 오타 하나가 파일 끝까지 전부 문자열로 물들인다.
      if (!triple && ch === '\n') return p;
      if (ch === quote && src.substr(p, close.length) === close) return p + close.length;
      p++;
    }
    return n; // 끝까지 안 닫히면 남은 전부가 문자열
  }

  // C++ 원시 문자열 R"delim( ... )delim" — 안쪽 따옴표/역슬래시가 전부 리터럴이다.
  function scanRawString(src, i, quoteIdx) {
    var open = src.indexOf('(', quoteIdx + 1);
    if (open < 0) return src.length;
    var close = ')' + src.slice(quoteIdx + 1, open) + '"';
    var end = src.indexOf(close, open + 1);
    return end < 0 ? src.length : end + close.length;
  }

  /* ---------- Python ---------- */

  var PY_KW = setOf(
    'False None True and as assert async await break class continue def del elif else ' +
    'except finally for from global if import in is lambda nonlocal not or pass raise ' +
    'return try while with yield ' +
    // self/cls는 문법상 키워드가 아니지만 사실상 예약어처럼 읽힌다.
    // 팔레트에 변수 전용 토큰이 없어 kw로 묶는다.
    'self cls'
  );
  // match/case는 소프트 키워드다. 변수명으로도 흔해서(`case = ...`) 일부러 뺐다.

  var PY_TYPE = setOf(
    'abs aiter all any anext ascii bin bool bytearray bytes callable chr classmethod ' +
    'complex delattr dict dir divmod enumerate eval filter float format frozenset ' +
    'getattr globals hasattr hash hex id input int isinstance issubclass iter len list ' +
    'locals map max memoryview min next object oct open ord pow print property range ' +
    'repr reversed round set setattr slice sorted staticmethod str sum super tuple type ' +
    'vars zip ' +
    // 표준 라이브러리 컨테이너. 이 책 코드에 상시 등장해서 타입처럼 취급하는 편이 읽기 좋다.
    'deque defaultdict Counter OrderedDict namedtuple heapdict ' +
    'Exception ValueError IndexError KeyError TypeError RuntimeError StopIteration ' +
    'ZeroDivisionError OverflowError RecursionError NotImplementedError AssertionError'
  );

  var PY_OPS = ['**=', '//=', '>>=', '<<=', '==', '!=', '<=', '>=', '//', '**', '->', ':=',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '>>', '<<',
    '+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '^', '~'];

  var RE_PY_NUM = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)/;
  var RE_PY_PREFIX = /^[rRbBuUfF]{1,3}(?=['"])/;

  function scanPython(src, out) {
    var n = src.length, i = 0;
    while (i < n) {
      var ch = src.charAt(i), ws, m;

      if (ch === '\n') { push(out, null, '\n'); i++; continue; }
      if (isSpace(ch)) { ws = matchAt(src, i, RE_WS); push(out, null, ws); i += ws.length; continue; }

      // 주석. 문자열 분기보다 뒤에 와도 되는 이유: 문자열은 통째로 소비되므로
      // 문자열 안의 #는 애초에 여기까지 오지 않는다.
      if (ch === '#') {
        var eol = src.indexOf('\n', i); if (eol < 0) eol = n;
        push(out, 'com', src.slice(i, eol)); i = eol; continue;
      }

      // 문자열 접두사(r, f, rb, ...) + 따옴표
      var pre = '';
      var pm = RE_PY_PREFIX.exec(src.substr(i, 4));
      if (pm) pre = pm[0];
      var q = src.charAt(i + pre.length);
      if (q === '"' || q === "'") {
        var qi = i + pre.length;
        var triple = src.substr(qi, 3) === q + q + q;
        var end = scanQuoted(src, qi, q, triple);
        push(out, 'str', src.slice(i, end)); i = end; continue;
      }

      // 데코레이터. 줄 머리에 있을 때만. (a @ b 행렬곱과 구분하려면 이 조건이 필요하다.)
      if (ch === '@' && atLineStart(src, i)) {
        var dm = matchAt(src, i + 1, /[A-Za-z_][A-Za-z0-9_.]*/);
        if (dm) { push(out, 'pre', '@' + dm); i += 1 + dm.length; continue; }
      }

      if (isDigit(ch) || (ch === '.' && isDigit(src.charAt(i + 1)))) {
        m = matchAt(src, i, RE_PY_NUM);
        if (m) { push(out, 'num', m); i += m.length; continue; }
      }

      if (isIdentStart(ch)) {
        m = matchAt(src, i, RE_IDENT);
        var cls = null;
        if (PY_KW[m]) cls = 'kw';
        // 빌트인이 호출 규칙보다 먼저다. len(...) 은 fn이 아니라 type으로 칠한다(계약 §6 표).
        else if (PY_TYPE[m]) cls = 'type';
        else if (callsAhead(src, i + m.length)) cls = 'fn';
        push(out, cls, m); i += m.length; continue;
      }

      var op = matchOp(src, i, PY_OPS);
      if (op) { push(out, 'op', op); i += op.length; continue; }

      // 괄호·콤마·콜론·점은 일부러 칠하지 않는다. 다 칠하면 코드가 크리스마스 트리가 된다.
      push(out, null, ch); i++;
    }
  }

  /* ---------- C++ ---------- */

  var CPP_KW = setOf(
    'alignas alignof and and_eq asm bitand bitor break case catch class compl concept ' +
    'const consteval constexpr constinit const_cast continue co_await co_return co_yield ' +
    'decltype default delete do dynamic_cast else enum explicit export extern false for ' +
    'friend goto if inline mutable namespace new noexcept not not_eq nullptr operator or ' +
    'or_eq private protected public register reinterpret_cast requires return sizeof ' +
    'static static_assert static_cast struct switch template this thread_local throw true ' +
    'try typedef typeid typename union using virtual volatile while xor xor_eq auto'
  );

  var CPP_TYPE = setOf(
    // 내장 스칼라
    'void bool char char8_t char16_t char32_t wchar_t short int long float double ' +
    'signed unsigned size_t ssize_t ptrdiff_t intptr_t uintptr_t nullptr_t ' +
    'int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t ' +
    // 표준 라이브러리 컨테이너/유틸 — 이 책에서 자료구조 이름이 곧 알고리즘의 뼈대다
    'std string wstring string_view vector array deque list forward_list ' +
    'set multiset map multimap unordered_set unordered_map unordered_multiset ' +
    'unordered_multimap stack queue priority_queue pair tuple bitset optional variant ' +
    'span initializer_list shared_ptr unique_ptr weak_ptr function ' +
    'greater less hash numeric_limits iterator ostream istream ostringstream ' +
    'istringstream stringstream ifstream ofstream fstream complex valarray ' +
    'true_type false_type'
  );

  // 홑꺾쇠(`<` `>` `<<` `>>`)와 `&` `*` 는 일부러 뺐다.
  // vector<pair<ll,int>> 같은 템플릿에서 꺾쇠가 전부 물들면 자료구조 이름이 안 읽히고,
  // `&`/`*` 는 참조·포인터·주소연산이 뒤섞여 색이 의미를 못 준다.
  var CPP_OPS = ['<<=', '>>=', '->*', '::', '->', '++', '--', '<=', '>=', '==',
    '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '+', '-', '/', '%', '=', '!', '|', '^', '~'];

  // 자릿수 구분자 ' 를 숫자 안에서 소비해야 1'000'000LL 이 문자 리터럴로 오인되지 않는다.
  // 꼬리 [a-zA-Z_]* 가 LL/ULL/f/z 같은 접미사와 사용자 정의 리터럴을 함께 먹는다.
  var RE_CPP_NUM = /(?:0[xX][0-9a-fA-F']+(?:\.[0-9a-fA-F']*)?(?:[pP][+-]?\d+)?|0[bB][01']+|(?:\d[\d']*(?:\.[\d']*)?|\.\d[\d']*)(?:[eE][+-]?\d+)?)[a-zA-Z_]*/;
  var RE_CPP_RAW = /^(?:u8|u|U|L)?R"/;
  var RE_CPP_STRPRE = /^(?:u8|u|U|L)(?=['"])/;

  function scanCpp(src, out) {
    var n = src.length, i = 0;
    while (i < n) {
      var ch = src.charAt(i), ws, m, end;

      if (ch === '\n') { push(out, null, '\n'); i++; continue; }
      if (isSpace(ch)) { ws = matchAt(src, i, RE_WS); push(out, null, ws); i += ws.length; continue; }

      // 전처리기 줄. 줄 머리의 # 부터 줄 끝까지 통째로 pre.
      // 단 // 나 /* 를 만나면 거기서 넘긴다 — `#include <queue>  // 우선순위 큐` 를 살리려고.
      // <queue> 의 꺾쇠는 render()에서 이스케이프되므로 HTML로 먹히지 않는다.
      if (ch === '#' && atLineStart(src, i)) {
        var p = i;
        while (p < n) {
          var c2 = src.charAt(p);
          if (c2 === '\n') break;
          if (c2 === '/' && (src.charAt(p + 1) === '/' || src.charAt(p + 1) === '*')) break;
          // 줄 끝 역슬래시는 다음 줄까지 이어지는 매크로 정의다
          if (c2 === '\\' && src.charAt(p + 1) === '\n') { p += 2; continue; }
          p++;
        }
        // 꼬리 공백은 pre 밖으로 뺀다. 배경색이 붙는 테마에서 주석 앞까지 색 띠가 늘어진다.
        var q2 = p;
        while (q2 > i && isSpace(src.charAt(q2 - 1))) q2--;
        push(out, 'pre', src.slice(i, q2));
        push(out, null, src.slice(q2, p));
        i = p; continue;
      }

      if (ch === '/' && src.charAt(i + 1) === '/') {
        var eol = src.indexOf('\n', i); if (eol < 0) eol = n;
        push(out, 'com', src.slice(i, eol)); i = eol; continue;
      }
      if (ch === '/' && src.charAt(i + 1) === '*') {
        end = src.indexOf('*/', i + 2);
        end = end < 0 ? n : end + 2;
        push(out, 'com', src.slice(i, end)); i = end; continue;
      }

      // 원시 문자열이 일반 문자열보다 먼저다. R"( "따옴표" )" 를 놓치면 그 뒤가 전부 어긋난다.
      if (ch === 'R' || ch === 'u' || ch === 'U' || ch === 'L') {
        var rm = RE_CPP_RAW.exec(src.substr(i, 4));
        if (rm) {
          end = scanRawString(src, i, i + rm[0].length - 1);
          push(out, 'str', src.slice(i, end)); i = end; continue;
        }
      }

      // u8"..." / L'...' 같은 인코딩 접두사
      var spre = RE_CPP_STRPRE.exec(src.substr(i, 3));
      var plen = spre ? spre[0].length : 0;
      var q = src.charAt(i + plen);
      if (q === '"' || q === "'") {
        end = scanQuoted(src, i + plen, q, false);
        push(out, 'str', src.slice(i, end)); i = end; continue;
      }

      if (isDigit(ch) || (ch === '.' && isDigit(src.charAt(i + 1)))) {
        m = matchAt(src, i, RE_CPP_NUM);
        if (m) { push(out, 'num', m); i += m.length; continue; }
      }

      if (isIdentStart(ch)) {
        m = matchAt(src, i, RE_IDENT);
        var cls = null;
        // 타입이 키워드보다 먼저다. int/long/bool 은 계약 §6 표에서 hl-type 쪽이다.
        if (CPP_TYPE[m]) cls = 'type';
        else if (CPP_KW[m]) cls = 'kw';
        else if (callsAhead(src, i + m.length)) cls = 'fn';
        push(out, cls, m); i += m.length; continue;
      }

      var op = matchOp(src, i, CPP_OPS);
      if (op) { push(out, 'op', op); i += op.length; continue; }

      push(out, null, ch); i++;
    }
  }

  /* ---------- bash ---------- */

  var SH_KW = setOf(
    'if then else elif fi for while until do done case esac function return in ' +
    'export local readonly declare source set unset shift break continue exit trap'
  );
  var SH_CMD = setOf(
    'echo cd ls cat mkdir rm cp mv touch chmod chown grep sed awk find sort uniq head ' +
    'tail wc xargs curl wget make cmake g++ gcc clang clang++ python python3 pip pip3 ' +
    'node npm git docker time diff tee less printf pwd which env'
  );
  // 이 키워드들 뒤에는 다시 명령이 온다(`; do ls`). 나머지 키워드는 인자를 받는다(`set -e`).
  var SH_CONT = setOf('do then else elif');
  var SH_OPS = ['&&', '||', '>>', '<<', '|', '>', '<', '=', ';', '&'];

  function scanBash(src, out) {
    var n = src.length, i = 0, cmdSlot = true; // 줄/파이프 첫 낱말이 명령 자리
    while (i < n) {
      var ch = src.charAt(i), ws, m, end;

      if (ch === '\n') { push(out, null, '\n'); i++; cmdSlot = true; continue; }
      if (isSpace(ch)) { ws = matchAt(src, i, RE_WS); push(out, null, ws); i += ws.length; continue; }

      // #은 낱말 중간이면 주석이 아니다(예: ${#arr}, 색상 코드 #fff 인자).
      if (ch === '#' && (i === 0 || isSpace(src.charAt(i - 1)) || src.charAt(i - 1) === '\n')) {
        end = src.indexOf('\n', i); if (end < 0) end = n;
        push(out, 'com', src.slice(i, end)); i = end; continue;
      }

      if (ch === "'") { // 홑따옴표 안에서는 역슬래시도 리터럴이다
        end = src.indexOf("'", i + 1);
        end = end < 0 ? n : end + 1;
        push(out, 'str', src.slice(i, end)); i = end; continue;
      }
      if (ch === '"') {
        end = scanQuoted(src, i, '"', false);
        push(out, 'str', src.slice(i, end)); i = end; continue;
      }

      // 변수 확장. 전용 토큰이 없어 값 계열인 type으로 칠한다.
      if (ch === '$') {
        if (src.charAt(i + 1) === '{') {
          end = src.indexOf('}', i + 2);
          end = end < 0 ? n : end + 1;
          push(out, 'type', src.slice(i, end)); i = end; continue;
        }
        m = matchAt(src, i + 1, /[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!]/);
        if (m) { push(out, 'type', '$' + m); i += 1 + m.length; continue; }
      }

      if (isDigit(ch)) {
        m = matchAt(src, i, /\d+/);
        push(out, 'num', m); i += m.length; continue;
      }

      // `+` 를 낱말에 포함시켜야 g++/clang++ 이 `g` + `++` 로 쪼개지지 않는다.
      if (isIdentStart(ch) || ch === '-' || ch === '.' || ch === '/') {
        m = matchAt(src, i, /[A-Za-z0-9_.+\/~-]+/);
        if (m) {
          var cls = null;
          // NAME=value 는 명령이 아니라 변수 대입이다. 대입은 명령 앞에도 올 수 있으므로
          // (FOO=1 ./run) 명령 자리 표시는 그대로 남겨 둔다.
          var assign = src.charAt(i + m.length) === '=' && src.charAt(i + m.length + 1) !== '=';
          if (m.charAt(0) === '-') { cls = null; cmdSlot = false; }   // 옵션은 명령이 아니다
          else if (SH_KW[m]) { cls = 'kw'; cmdSlot = !!SH_CONT[m]; }
          else if (assign) { cls = null; }
          else if (cmdSlot) { cls = 'fn'; cmdSlot = false; }
          push(out, cls, m); i += m.length; continue;
        }
      }

      var op = matchOp(src, i, SH_OPS);
      if (op) {
        push(out, 'op', op); i += op.length;
        if (op === '|' || op === '&&' || op === '||' || op === ';') cmdSlot = true;
        continue;
      }

      push(out, null, ch); i++;
    }
  }

  /* ---------- JSON ---------- */

  function scanJson(src, out) {
    var n = src.length, i = 0;
    while (i < n) {
      var ch = src.charAt(i), ws, m, end;

      if (ch === '\n') { push(out, null, '\n'); i++; continue; }
      if (isSpace(ch)) { ws = matchAt(src, i, RE_WS); push(out, null, ws); i += ws.length; continue; }

      // 엄밀한 JSON엔 주석이 없지만, 책 예제는 설명 주석을 단다(JSONC).
      if (ch === '/' && src.charAt(i + 1) === '/') {
        end = src.indexOf('\n', i); if (end < 0) end = n;
        push(out, 'com', src.slice(i, end)); i = end; continue;
      }
      if (ch === '/' && src.charAt(i + 1) === '*') {
        end = src.indexOf('*/', i + 2); end = end < 0 ? n : end + 2;
        push(out, 'com', src.slice(i, end)); i = end; continue;
      }

      if (ch === '"') {
        end = scanQuoted(src, i, '"', false);
        // 뒤에 콜론이 오면 키다. 팔레트에 속성 전용 토큰이 없어 fn을 빌려 쓴다
        // (값 문자열과 색이 갈리는 게 읽기에 훨씬 낫다).
        var p = end;
        while (p < n && (isSpace(src.charAt(p)) || src.charAt(p) === '\n')) p++;
        push(out, src.charAt(p) === ':' ? 'fn' : 'str', src.slice(i, end));
        i = end; continue;
      }

      if (isDigit(ch) || (ch === '-' && isDigit(src.charAt(i + 1)))) {
        m = matchAt(src, i, /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (m) { push(out, 'num', m); i += m.length; continue; }
      }

      if (isIdentStart(ch)) {
        m = matchAt(src, i, RE_IDENT);
        push(out, (m === 'true' || m === 'false' || m === 'null') ? 'kw' : null, m);
        i += m.length; continue;
      }

      push(out, null, ch); i++;
    }
  }

  /* ---------- console (셸/REPL 기록) ---------- */

  // 프롬프트 뒤에 공백(또는 줄 끝)을 요구한다. 안 그러면 출력 줄의 `$HOME ...` 이
  // 프롬프트로 오인된다. 루트 프롬프트 `# ` 는 셸 주석과 구분이 안 돼 일부러 뺐다.
  var RE_PROMPT = /^([ \t]*)(\$|>>>|\.\.\.)([ \t]|$)/;

  // 출력 줄은 hl-com으로 흐리게 칠한다. 전용 토큰이 없고, "입력이 아닌 것"을
  // 한 눈에 구분하는 게 목적이라 팔레트에서 가장 낮은 대비인 주석색이 맞다.
  function highlightConsole(code) {
    var lines = code.split('\n'), res = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = RE_PROMPT.exec(line);
      if (m) {
        var rest = line.slice(m[0].length);
        var toks = [];
        if (m[2] === '>>>' || m[2] === '...') scanPython(rest, toks);
        else scanBash(rest, toks);
        res.push(esc(m[1]) + '<span class="hl-op">' + esc(m[2]) + '</span>' + esc(m[3]) + render(toks));
      } else if (!line) {
        res.push('');
      } else {
        res.push('<span class="hl-com">' + esc(line) + '</span>');
      }
    }
    return res.join('\n');
  }

  /* ---------- 진입점 ---------- */

  var SCANNERS = {
    python: scanPython,
    cpp: scanCpp,
    bash: scanBash,
    json: scanJson
  };

  var ALIASES = {
    py: 'python', python3: 'python', py3: 'python',
    'c++': 'cpp', cxx: 'cpp', cc: 'cpp', c: 'cpp', cplusplus: 'cpp',
    sh: 'bash', shell: 'bash', zsh: 'bash',
    jsonc: 'json', json5: 'json',
    txt: 'text', plain: 'text', plaintext: 'text', none: 'text',
    repl: 'console', pycon: 'console', 'shell-session': 'console', terminal: 'console'
  };

  function highlight(code, lang) {
    // 캐리지 리턴이 남으면 호출자의 `\n` 분할에 \r가 딸려가 줄 끝이 어긋난다.
    var src = String(code == null ? '' : code).replace(/\r\n?/g, '\n');
    var key = String(lang == null ? '' : lang).toLowerCase().trim();
    key = ALIASES[key] || key;

    try {
      if (key === 'console') return highlightConsole(src);
      var scan = SCANNERS[key];
      if (!scan) return esc(src); // text 포함, 모르는 언어는 이스케이프만
      var out = [];
      scan(src, out);
      return render(out);
    } catch (e) {
      // 강조는 부가 기능이다. 어떤 입력에도 본문이 안 보이는 사태는 만들지 않는다.
      return esc(src);
    }
  }

  global.HL = { highlight: highlight };
})(typeof window !== 'undefined' ? window : this);
