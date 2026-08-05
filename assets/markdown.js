/* markdown.js — 『Algorithmic』 전용 마크다운 렌더러
 *
 * 계약(CONTRACT.md §2)이 유일한 진실이다. 여기서 만드는 클래스명만 style.css가 타깃한다.
 * 의존성 제로. 파서는 정규식 한 방이 아니라 줄 단위 상태 기계다 —
 * 코드 펜스와 ::: 상자가 서로 중첩되는 이 책의 문법에서는 그래야만 경계가 안 깨진다.
 *
 *   window.MD.render(md)   -> HTML 문자열 (순수 함수, DOM 접근 없음)
 *   window.MD.headings(md) -> [{ level, text, id }]  (최상위 h2·h3만)
 *   window.MD.inline(src)  -> HTML 문자열 (한 줄용. 블록 문법을 타지 않는다)
 */
(function (global) {
  'use strict';

  /* ==================== 이스케이프 ====================
   *
   * 이 책은 public 페이지이고 본문은 마크다운 파일에서 그대로 들어온다.
   * 통과시키는 원시 HTML은 <kbd> 하나뿐이고, 그 예외는 inline() 4단계 이전에
   * 스태시로 빼돌려 처리한다. 그 외의 모든 꺾쇠는 무조건 글자가 된다.
   */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // data-opts 는 작은따옴표로 감싼다(계약 §2.5). JSON 안의 큰따옴표는 살려야 하므로
  // 여기서는 큰따옴표를 건드리지 않는다.
  function escSingle(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;');
  }

  // 링크로 위장한 코드 실행 통로를 끊는다. 이 시점의 문자열은 이미 esc()를 거쳤으므로
  // `&#106;avascript:` 같은 엔티티 우회는 이미 &amp;#106; 이 되어 스킴으로 성립하지 않는다.
  function safeUrl(u) {
    var raw = String(u == null ? '' : u).trim();
    var probe = raw.replace(/[\u0000-\u0020]/g, '').toLowerCase();
    if (/^(?:javascript|vbscript|data):/.test(probe)) return '#';
    return raw;
  }

  /* ==================== 슬러그 ====================
   *
   * render()와 headings()가 같은 함수를 쓴다. 둘이 갈라지면 우측 인북 목차 링크가
   * 통째로 죽으므로, 슬러그 로직은 절대 복제하지 않는다.
   */

  // 계약 §2.7: 소문자화 → 공백을 `-` → 영숫자/한글/`-` 외 제거.
  // 마크다운 기호(*, `, [, ] …)는 마지막 필터에서 자연히 사라지므로 별도 처리가 없다.
  var SLUG_KEEP = /[^a-z0-9가-힣ᄀ-ᇿ㄰-㆏-]/g;

  function slugify(text) {
    var s = String(text == null ? '' : text)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(SLUG_KEEP, '');
    return s || 'sec';
  }

  // 중복은 `-2`, `-3`. hasOwnProperty로 확인하는 이유는 제목이 `constructor`,
  // `__proto__` 같은 값일 때 프로토타입 체인에 걸려 오탐하지 않게 하기 위해서다.
  function uniqueSlug(base, used) {
    if (!used.hasOwnProperty(base)) {
      used[base] = 1;
      return base;
    }
    var n = used[base] + 1;
    while (used.hasOwnProperty(base + '-' + n)) n++;
    used[base] = n;
    used[base + '-' + n] = 1;
    return base + '-' + n;
  }

  // 제목의 표시용 텍스트. 슬러그도 이 결과에서 뽑는다.
  function headingText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/\s+#+\s*$/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*|\*|~~|==|\$/g, '')
      .trim();
  }

  /* ==================== 수식 ====================
   *
   * 렌더링 엔진을 붙이지 않는다(의존성 제로가 우선). 원문을 최소한만 다듬어
   * 그대로 보인다. \log → log 처럼 명령 백슬래시를 벗기고, 자주 쓰는 기호만 바꾼다.
   */

  var MATH_SYM = {
    cdot: '·', times: '×', div: '÷', pm: '±',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡',
    infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔',
    sum: 'Σ', prod: 'Π', sqrt: '√', partial: '∂', nabla: '∇',
    'in': '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅',
    forall: '∀', exists: '∃', land: '∧', lor: '∨', neg: '¬',
    lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', ldots: '…', cdots: '…',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
    xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
  };

  function tidyMath(src) {
    var s = String(src == null ? '' : src).trim();
    s = s.replace(/\\left|\\right/g, '');
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    s = s.replace(/\\(?:quad|qquad|,|;|!|:)/g, ' ');
    s = s.replace(/\\([{}%&#$_])/g, '$1');
    s = s.replace(/\\([A-Za-z]+)/g, function (_, w) {
      return MATH_SYM.hasOwnProperty(w) ? MATH_SYM[w] : w;
    });
    // O(n^{2}) 처럼 지수·첨자의 중괄호만 벗긴다. 나머지 중괄호는 집합 표기일 수 있어 둔다.
    s = s.replace(/([\^_])\{([^{}]*)\}/g, '$1$2');
    return s.replace(/[ \t]+/g, ' ').trim();
  }

  /* ==================== 인라인 ==================== */

  var MARK = '\u0000'; // 스태시 자리표시자 구분자. 본문에 등장할 수 없는 문자라 안전하다.

  function inline(src) {
    var stash = [];
    function keep(html) {
      stash.push(html);
      return MARK + (stash.length - 1) + MARK;
    }

    var s = String(src == null ? '' : src);

    // 1) 인라인 코드를 먼저 격리한다. 코드 안의 `*`, `$`, `<` 는 문법이 아니라 글자다.
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (_, ticks, code) {
      return keep('<code class="inline">' + esc(code.replace(/^ | $/g, '')) + '</code>');
    });

    // 2) 수식. 블록이 먼저다 — $$ 를 $ 로 먼저 먹으면 경계가 어긋난다.
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (_, m) {
      return keep('<div class="math-block">' + esc(tidyMath(m)) + '</div>');
    });
    s = s.replace(/\$([^$\n]+?)\$/g, function (_, m) {
      return keep('<span class="math">' + esc(tidyMath(m)) + '</span>');
    });

    // 3) 허용된 유일한 원시 HTML. 속성이 붙은 <kbd class=…> 형태는 통과시키지 않는다 —
    //    속성을 허용하는 순간 온갖 이벤트 핸들러가 같이 들어온다.
    s = s.replace(/<\/?kbd>/gi, function (m) {
      return keep(m.toLowerCase());
    });

    // 4) 나머지 원시 HTML은 전부 글자로 만든다.
    s = esc(s);

    // 5) 이미지 · 링크
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, function (_, alt, url) {
      return '<img src="' + safeUrl(url) + '" alt="' + alt + '" loading="lazy">';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, function (_, text, url) {
      var u = safeUrl(url);
      var ext = /^(?:https?:|\/\/)/i.test(u);
      if (ext) return '<a href="' + u + '" target="_blank" rel="noopener">' + text + '</a>';
      // 내부 상호참조는 라우터가 가로채야 하므로 표식을 남긴다(계약 §2.6).
      var cls = u.indexOf('#/') === 0 ? ' class="xref"' : '';
      return '<a href="' + u + '"' + cls + '>' + text + '</a>';
    });

    // 6) 강조. 긴 마커부터 처리해야 ***x*** 가 **+* 로 쪼개지지 않는다.
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    s = s.replace(/~~([\s\S]+?)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>');
    // `_`는 강조로 쓰지 않는다. 식별자(`max_heap`)를 기울임으로 부수는 사고가 잦다.

    // 7) 줄 끝 공백 두 칸은 강제 개행
    s = s.replace(/ {2,}\n/g, '<br>\n');

    // 8) 스태시 복원
    return s.replace(new RegExp(MARK + '(\\d+)' + MARK, 'g'), function (_, k) {
      var v = stash[+k];
      return v == null ? '' : v;
    });
  }

  /* ==================== 코드 블록 ==================== */

  function langOf(info) {
    var t = String(info == null ? '' : info).trim().split(/\s+/)[0] || '';
    t = t.replace(/\{[\s\S]*/, '').toLowerCase();
    // 클래스명·속성에 그대로 박히는 값이라 화이트리스트 문자만 통과시킨다.
    return /^[a-z0-9+#_.-]*$/.test(t) ? t : '';
  }

  function parseHl(spec) {
    var set = {};
    String(spec == null ? '' : spec).split(',').forEach(function (part) {
      var p = part.trim();
      var m = /^(\d+)\s*-\s*(\d+)$/.exec(p);
      if (m) {
        var a = +m[1], b = +m[2];
        // {1-99999999} 같은 오타 하나로 브라우저가 멈추면 안 된다.
        if (b > a + 5000) b = a + 5000;
        for (var k = a; k <= b; k++) set[k] = true;
      } else if (/^\d+$/.test(p)) {
        set[+p] = true;
      }
    });
    return set;
  }

  function renderCode(code, info) {
    var meta = String(info == null ? '' : info).trim();
    var lang = langOf(meta);
    var tm = /title\s*=\s*"([^"]*)"/.exec(meta);
    var hm = /\{([0-9,\s-]+)\}/.exec(meta);
    var noLines = /(^|\s)nolines(\s|$)/.test(meta);
    var title = tm ? tm[1] : '';
    var hlSet = parseHl(hm ? hm[1] : '');

    var body = String(code == null ? '' : code).replace(/\n+$/, '');

    // 원문을 이스케이프하지 않고 넘긴다 — 이스케이프는 HL의 책임이다(계약 §2.1).
    // HL이 아직 로드되지 않았거나 터져도 코드는 보여야 하므로 자체 esc로 물러선다.
    var painted;
    try {
      var HL = global.HL;
      painted = (HL && typeof HL.highlight === 'function') ? HL.highlight(body, lang) : esc(body);
      if (typeof painted !== 'string') painted = esc(body);
    } catch (e) {
      painted = esc(body);
    }

    var rows = painted.split('\n').map(function (ln, k) {
      var cls = 'line' + (hlSet[k + 1] ? ' hl' : '');
      return (noLines ? '' : '<span class="ln">' + (k + 1) + '</span>') +
        '<span class="' + cls + '">' + ln + '</span>';
    }).join('\n');

    // title이 없어도 head는 남긴다 — 복사 버튼이 거기 산다(계약 §2.1).
    var head = '<div class="codeblock-head">' +
      (title ? '<span class="codeblock-title">' + esc(title) + '</span>' : '') +
      (lang ? '<span class="codeblock-lang">' + esc(lang) + '</span>' : '') +
      '<button class="codeblock-copy" type="button" aria-label="코드 복사">복사</button>' +
      '</div>';

    return '<div class="codeblock" data-lang="' + esc(lang) + '">' + head +
      '<pre class="code' + (noLines ? ' nolines' : '') + '">' +
      '<code class="lang-' + esc(lang) + '">' + rows + '</code></pre></div>';
  }

  /* ==================== ::: dual ==================== */

  var LANG_LABEL = {
    python: 'Python', cpp: 'C++', c: 'C', text: 'Text',
    bash: 'Bash', json: 'JSON', console: 'Console'
  };

  function renderDual(inner, ctx) {
    var lines = inner.split('\n');
    var panes = [];
    var slot = {};
    var stray = [];
    var i = 0;

    while (i < lines.length) {
      var f = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
      if (f) {
        var mark = f[1].charAt(0);
        var len = f[1].length;
        var meta = f[2];
        var buf = [];
        i++;
        while (i < lines.length && !isFenceClose(lines[i], mark, len)) { buf.push(lines[i]); i++; }
        i++;
        var lang = langOf(meta) || 'text';
        var html = renderCode(buf.join('\n'), meta);
        if (slot.hasOwnProperty(lang)) panes[slot[lang]].html += html;
        else { slot[lang] = panes.length; panes.push({ lang: lang, html: html }); }
        continue;
      }
      if (lines[i].trim()) stray.push(lines[i]);
      i++;
    }

    // 코드 펜스가 하나도 없으면 dual로 만들 게 없다. 본문을 버리지 말고 그대로 살린다.
    if (!panes.length) return blocks(inner, ctx, true);

    // A-04: Python이 항상 먼저, C++이 뒤. 그 외 언어는 등장 순서로 뒤에 붙인다.
    var ordered = [];
    ['python', 'cpp'].forEach(function (l) {
      panes.forEach(function (p) { if (p.lang === l) ordered.push(p); });
    });
    panes.forEach(function (p) {
      if (p.lang !== 'python' && p.lang !== 'cpp') ordered.push(p);
    });

    var tabs = ordered.map(function (p, k) {
      return '<button class="dual-tab' + (k === 0 ? ' is-active' : '') +
        '" data-dual-lang="' + esc(p.lang) + '" role="tab" type="button">' +
        esc(LANG_LABEL[p.lang] || p.lang) + '</button>';
    }).join('');

    // `둘 다` 모드에서 app.js가 컨테이너에 .is-both를 붙여 두 패널을 세로로 쌓는다.
    // 렌더러는 두 패널을 항상 다 만들어 두기만 하면 된다(계약 §2.2).
    var body = ordered.map(function (p, k) {
      return '<div class="dual-pane' + (k === 0 ? ' is-active' : '') +
        '" data-dual-lang="' + esc(p.lang) + '">' + p.html + '</div>';
    }).join('');

    var html = '<div class="dual" data-dual>' +
      '<div class="dual-tabs" role="tablist">' + tabs + '</div>' + body + '</div>';

    return stray.length ? html + '\n' + blocks(stray.join('\n'), ctx, true) : html;
  }

  /* ==================== ::: 상자 ==================== */

  // 계약 §2.3의 기본 라벨. lead는 라벨이 없다.
  var BOX_LABEL = {
    lead: '',
    note: '참고',
    tip: '요령',
    warn: '주의',
    danger: '위험',
    deep: '한 단계 아래',
    perf: '성능',
    hist: '설계 배경',
    trace: '손으로 따라가기',
    pitfall: '틀리는 지점',
    classify: '이 유형을 알아보는 법',
    interview: '면접에서는',
    quiz: '연습',
    answer: '정답'
  };

  function renderBox(kind, title, body, ctx) {
    // 클래스명에 임의 문자열이 들어가지 않게 한 번 더 거른다.
    var k = String(kind).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!k) k = 'note';
    var known = BOX_LABEL.hasOwnProperty(k);
    var label = title || (known ? BOX_LABEL[k] : k);

    // classify 안에서만 불릿에 data-classify-key를 붙인다(계약 §2.4).
    // build.py가 이 블록을 수집해 Anki 덱을 만들기 때문에 키는 상자 밖으로 새면 안 된다.
    if (k === 'classify') ctx.classify++;
    var inner = blocks(body, ctx, true);
    if (k === 'classify') ctx.classify--;

    if (k === 'answer') {
      return '<details class="box box-answer"><summary class="box-title">' +
        esc(label || BOX_LABEL.answer) + '</summary>' +
        '<div class="box-body">' + inner + '</div></details>';
    }
    // lead는 제목 줄 자체가 없다. 절 머리말이라 라벨이 붙으면 오히려 방해가 된다.
    if (k === 'lead') {
      return '<div class="box box-lead"><div class="box-body">' + inner + '</div></div>';
    }
    return '<div class="box box-' + k + '">' +
      (label ? '<div class="box-title">' + esc(label) + '</div>' : '') +
      '<div class="box-body">' + inner + '</div></div>';
  }

  /* ==================== ::: widget ==================== */

  function renderWidget(rest, bodyLines) {
    var m = /^([A-Za-z0-9_.-]+)\s*([\s\S]*)$/.exec(String(rest || '').trim());
    var type = m ? m[1] : '';
    var jsonText = ((m ? m[2] : '') + '\n' + bodyLines.join('\n')).trim();
    var opts = '{}';
    if (jsonText) {
      try {
        var parsed = JSON.parse(jsonText);
        // 배열·숫자를 옵션으로 넘기면 위젯 쪽 계약이 깨진다. 객체만 인정한다.
        if (parsed && typeof parsed === 'object' && !(parsed instanceof Array)) {
          opts = JSON.stringify(parsed);
        }
      } catch (e) {
        opts = '{}'; // 깨진 JSON은 조용히 버린다. 한 챕터의 오타로 책 전체가 안 뜨면 안 된다.
      }
    }
    return '<div class="widget" data-widget="' + esc(type) + '" data-opts=\'' + escSingle(opts) + '\'></div>';
  }

  /* ==================== 표 ==================== */

  function isTableDelim(s) {
    return typeof s === 'string' && /\|/.test(s) && /-/.test(s) && /^[\s|:-]+$/.test(s);
  }

  function splitRow(line) {
    var s = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var cur = '';
    var inCode = false;
    for (var k = 0; k < s.length; k++) {
      var ch = s.charAt(k);
      if (ch === '\\' && s.charAt(k + 1) === '|') { cur += '|'; k++; continue; }
      if (ch === '`') inCode = !inCode;
      if (ch === '|' && !inCode) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  }

  function alignOf(cell) {
    var c = String(cell).trim();
    if (/^:.*:$/.test(c)) return 'center';
    if (/:$/.test(c)) return 'right';
    if (/^:/.test(c)) return 'left';
    return '';
  }

  /* ==================== 목록 ==================== */

  // 그룹1=들여쓰기, 그룹2=불릿 문자(순서 있는 목록이면 undefined), 그룹3=번호.
  // /g 를 붙이면 lastIndex가 남아 .test()가 번갈아 실패하므로 절대 붙이지 않는다.
  var MARKER = /^(\s*)(?:([-*+])|(\d+)[.)])[ \t]+/;

  function classifyKey(text) {
    var t = String(text).replace(/^[\s*_`>]+/, '');
    if (/^신호어/.test(t)) return 'signals';
    if (/^제약\s*조건/.test(t)) return 'constraints';
    // 집필 현장에서 `혼동 주의`와 `혼동주의`가 섞여 들어온다. 둘 다 받는다(계약 §2.4).
    if (/^혼동\s*주의/.test(t)) return 'confusion';
    if (/^반례\s*함정/.test(t)) return 'traps';
    return '';
  }

  function renderList(lines, ctx) {
    var first = MARKER.exec(lines[0]);
    if (!first) return '<p>' + inline(lines.join('\n')) + '</p>';

    var indent = first[1].length;
    var ordered = !first[2];
    var start = ordered ? parseInt(first[3], 10) : 1;

    // 이 레벨의 '같은 종류' 마커만 항목 시작으로 인정한다. 더 깊게 들여쓴 줄은
    // 항목 본문으로 넘겨서 blocks()가 재귀로 중첩 목록을 처리하게 한다.
    var markerRe = new RegExp('^\\s{' + indent + '}' + (ordered ? '\\d+[.)]' : '[-*+]') + '[ \\t]+');
    var items = [];
    var cur = null;
    var contIndent = 0;

    lines.forEach(function (ln) {
      var m = markerRe.exec(ln);
      if (m) {
        if (cur) items.push(cur);
        cur = [ln.slice(m[0].length)];
        contIndent = m[0].length;
      } else if (cur) {
        cur.push(/^\s*$/.test(ln) ? '' : ln.replace(new RegExp('^\\s{0,' + contIndent + '}'), ''));
      }
    });
    if (cur) items.push(cur);

    var html = items.map(function (item) {
      var text = item.join('\n');
      var attrs = '';
      var prefix = '';

      var cb = /^\[([ xX])\][ \t]*([\s\S]*)$/.exec(text);
      if (cb) {
        attrs = ' class="task"';
        prefix = '<input type="checkbox" disabled' +
          (cb[1].toLowerCase() === 'x' ? ' checked' : '') + '> ';
        text = cb[2];
      } else if (ctx.classify > 0) {
        var key = classifyKey(text);
        if (key) attrs = ' data-classify-key="' + key + '"';
      }

      var inner = blocks(text, ctx, true);
      // 한 문단짜리 항목이면 <p>를 벗긴다. 안 벗기면 목록 줄 간격이 통째로 벌어진다.
      var only = /^<p>([\s\S]*)<\/p>$/.exec(inner.trim());
      if (only && only[1].indexOf('<p>') === -1) {
        inner = only[1];
      } else if (!/\n[ \t]*\n/.test(text)) {
        // 빈 줄이 없는 항목(tight)은 중첩 목록을 달고 있어도 첫 줄이 문단이 아니다.
        // 여기서 안 벗기면 `- 항목\n  - 중첩` 이 loose 목록처럼 벌어진다.
        inner = inner.replace(/^<p>([\s\S]*?)<\/p>(\n|$)/, '$1$2');
      }
      return '<li' + attrs + '>' + prefix + inner + '</li>';
    }).join('');

    return ordered
      ? '<ol' + (start !== 1 && !isNaN(start) ? ' start="' + start + '"' : '') + '>' + html + '</ol>'
      : '<ul>' + html + '</ul>';
  }

  /* ==================== 블록 상태 기계 ==================== */

  function isFenceClose(line, mark, len) {
    var m = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
    if (!m) return false;
    return m[1].charAt(0) === mark && m[1].length >= len;
  }

  // 목록의 게으른 연속(lazy continuation)이 삼키면 안 되는 줄들.
  // 이게 없으면 목록 뒤에 붙은 `## 제목`이 목록 안으로 빨려 들어가고,
  // 그러면 headings()와 render()의 슬러그 번호가 어긋난다.
  function isHardBlockStart(line) {
    return /^#{1,6}[ \t]+/.test(line) ||
      /^:::/.test(line) ||
      /^(?:`{3,}|~{3,})/.test(line) ||
      /^>/.test(line);
  }

  function isBlockBreak(lines, i) {
    var l = lines[i];
    return /^\s*$/.test(l) ||
      /^#{1,6}[ \t]+/.test(l) ||
      /^:::/.test(l) ||
      /^\s{0,3}(?:`{3,}|~{3,})/.test(l) ||
      /^\s{0,3}>/.test(l) ||
      MARKER.test(l) ||
      /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l) ||
      /^\s*\$\$/.test(l) ||
      (/\|/.test(l) && i + 1 < lines.length && isTableDelim(lines[i + 1]));
  }

  function blank(s) { return /^\s*$/.test(s); }

  /**
   * @param src    마크다운 원문
   * @param ctx    { used, classify } — 슬러그 중복 사전과 classify 깊이
   * @param nested 재귀 호출 여부. 상자·인용·목록 안의 제목에는 id를 붙이지 않는다.
   *               headings()가 최상위 h2·h3만 세므로, 여기서 id를 남발하면 `-2` 접미가
   *               어긋나 인북 목차 링크가 통째로 깨진다.
   */
  function blocks(src, ctx, nested) {
    var lines = String(src == null ? '' : src).split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (blank(line)) { i++; continue; }

      /* --- 코드 펜스 --- */
      var fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        var mark = fence[1].charAt(0);
        var len = fence[1].length;
        var meta = fence[2];
        var cbuf = [];
        i++;
        while (i < lines.length && !isFenceClose(lines[i], mark, len)) { cbuf.push(lines[i]); i++; }
        i++; // 닫는 펜스(없으면 EOF)
        out.push(renderCode(cbuf.join('\n'), meta));
        continue;
      }

      /* --- ::: 블록 (widget / dual / 표시 상자) --- */
      var bm = /^:::[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*(.*)$/.exec(line);
      if (bm) {
        var kind = bm[1].toLowerCase();
        var rest = bm[2].trim();
        var bbuf = [];
        var depth = 1;
        var inFence = null; // 상자 안의 코드 펜스에 들어 있는 `:::`는 세면 안 된다
        i++;
        while (i < lines.length) {
          var l = lines[i];
          var fm = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
          if (fm) {
            if (!inFence) inFence = fm[1];
            else if (fm[1].charAt(0) === inFence.charAt(0) && fm[1].length >= inFence.length) inFence = null;
          } else if (!inFence) {
            // 닫는 :::는 항상 홀로 있는 ::: 줄이다(계약 §2.3).
            if (/^:::[ \t]*$/.test(l)) {
              depth--;
              if (depth === 0) { i++; break; }
            } else if (/^:::[ \t]*\S/.test(l)) {
              depth++;
            }
          }
          bbuf.push(l);
          i++;
        }

        if (kind === 'widget') { out.push(renderWidget(rest, bbuf)); continue; }
        if (kind === 'dual') { out.push(renderDual(bbuf.join('\n'), ctx)); continue; }
        out.push(renderBox(kind, rest, bbuf.join('\n'), ctx));
        continue;
      }

      /* --- 제목 --- */
      var h = /^(#{1,6})[ \t]+(.*)$/.exec(line);
      if (h) {
        var lvl = h[1].length;
        var raw = h[2].replace(/\s+#+\s*$/, '').trim();
        var text = headingText(raw);
        var attr = '';
        var anchor = '';
        if (!nested && (lvl === 2 || lvl === 3)) {
          var id = uniqueSlug(slugify(text), ctx.used);
          attr = ' id="' + esc(id) + '"';
          anchor = '<a class="anchor" href="#' + esc(id) + '" aria-label="이 절 링크">#</a>';
        }
        out.push('<h' + lvl + attr + '>' + inline(raw) + anchor + '</h' + lvl + '>');
        i++;
        continue;
      }

      /* --- 수평선 --- */
      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      /* --- 블록 수식 --- */
      var mb = /^\s*\$\$([\s\S]*)$/.exec(line);
      if (mb) {
        var acc = mb[1];
        if (/\$\$\s*$/.test(acc)) {
          acc = acc.replace(/\$\$\s*$/, '');
          i++;
        } else {
          i++;
          while (i < lines.length && lines[i].indexOf('$$') === -1) { acc += '\n' + lines[i]; i++; }
          if (i < lines.length) { acc += '\n' + lines[i].replace(/\$\$[\s\S]*$/, ''); i++; }
        }
        out.push('<div class="math-block">' + esc(tidyMath(acc)) + '</div>');
        continue;
      }

      /* --- 표 --- */
      if (/\|/.test(line) && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
        var head = splitRow(line);
        var align = splitRow(lines[i + 1]).map(alignOf);
        i += 2;
        var rows = [];
        while (i < lines.length && !blank(lines[i]) && /\|/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        // 가로 스크롤 컨테이너는 필수다(계약 §2.6·§5). body에 가로 스크롤을 만들면 안 된다.
        var t = '<div class="table-wrap"><table><thead><tr>';
        head.forEach(function (c, k) {
          t += '<th' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' +
            inline(c.trim()) + '</th>';
        });
        t += '</tr></thead><tbody>';
        rows.forEach(function (row) {
          t += '<tr>';
          head.forEach(function (_, k) {
            t += '<td' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' +
              inline(String(row[k] == null ? '' : row[k]).trim()) + '</td>';
          });
          t += '</tr>';
        });
        out.push(t + '</tbody></table></div>');
        continue;
      }

      /* --- 인용 --- */
      if (/^\s{0,3}>/.test(line)) {
        var qbuf = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
          qbuf.push(lines[i].replace(/^\s{0,3}>[ \t]?/, ''));
          i++;
        }
        out.push('<blockquote>' + blocks(qbuf.join('\n'), ctx, true) + '</blockquote>');
        continue;
      }

      /* --- 목록 --- */
      if (MARKER.test(line)) {
        var lm = MARKER.exec(line);
        var baseIndent = lm[1].length;
        var baseOrdered = !lm[2];
        var lbuf = [];
        while (i < lines.length) {
          if (blank(lines[i])) {
            var j = i + 1;
            while (j < lines.length && blank(lines[j])) j++;
            if (j < lines.length && /^(?:\s{2,}|\s*(?:[-*+]|\d+[.)])[ \t])/.test(lines[j])) {
              lbuf.push(''); i++; continue;
            }
            break;
          }
          var mm = MARKER.exec(lines[i]);
          // 같은 레벨에서 마커 종류가 바뀌면(- → 1.) 별개의 목록이다.
          if (mm && mm[1].length === baseIndent && (!mm[2]) !== baseOrdered) break;
          if (!mm && isHardBlockStart(lines[i])) break;
          lbuf.push(lines[i]);
          i++;
        }
        out.push(renderList(lbuf, ctx));
        continue;
      }

      /* --- 문단 --- */
      var pbuf = [line];
      i++;
      while (i < lines.length && !isBlockBreak(lines, i)) { pbuf.push(lines[i]); i++; }
      out.push('<p>' + inline(pbuf.join('\n')) + '</p>');
    }

    return out.join('\n');
  }

  /* ==================== 공개 API ==================== */

  // CRLF만 정규화한다. 탭은 건드리지 않는다 — 코드 블록 원문이 바뀌면 안 되기 때문이다.
  function norm(src) {
    return String(src == null ? '' : src).replace(/\r\n?/g, '\n');
  }

  function render(markdown) {
    try {
      return blocks(norm(markdown), { used: {}, classify: 0 }, false);
    } catch (e) {
      // 에러 경계가 없는 페이지다. 어떤 입력에서도 렌더가 죽는 것보다
      // 원문을 그대로 보여주는 쪽이 낫다.
      return '<pre class="code">' + esc(norm(markdown)) + '</pre>';
    }
  }

  // 코드 펜스 안과 ::: 상자 안의 `#`는 제외한다(계약 §2.7).
  // 슬러그 계산은 render()와 같은 함수를 쓰고, 스캔 순서도 같으므로 결과가 일치한다.
  function headings(markdown) {
    var out = [];
    try {
      var lines = norm(markdown).split('\n');
      var used = {};
      var fence = null;
      var depth = 0;

      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];

        var fm = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
        if (fm) {
          if (!fence) fence = fm[1];
          else if (fm[1].charAt(0) === fence.charAt(0) && fm[1].length >= fence.length) fence = null;
          continue;
        }
        if (fence) continue;

        if (/^:::[ \t]*$/.test(l)) { if (depth > 0) depth--; continue; }
        if (/^:::[ \t]*\S/.test(l)) { depth++; continue; }
        if (depth > 0) continue;

        var h = /^(#{1,6})[ \t]+(.*)$/.exec(l);
        if (!h) continue;
        var lvl = h[1].length;
        if (lvl !== 2 && lvl !== 3) continue;

        var text = headingText(h[2]);
        out.push({ level: lvl, text: text, id: uniqueSlug(slugify(text), used) });
      }
    } catch (e) {
      return out; // 목차가 비는 것은 참을 수 있다. 크래시는 안 된다.
    }
    return out;
  }

  global.MD = { render: render, headings: headings, inline: inline };
})(typeof window !== 'undefined' ? window : this);
