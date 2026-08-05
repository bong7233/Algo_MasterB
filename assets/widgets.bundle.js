/* 자동 생성 파일 — 직접 고치지 말 것. `python build.py` 로 다시 만든다. */
/* 원본: assets/widgets/*.js */
window.Widgets = window.Widgets || {};

/* ==== _runtime.js ==== */
/* _runtime.js — 위젯 공용 런타임
 *
 * 모든 위젯이 똑같이 필요로 하는 것을 한 곳에 모은다: 껍데기 DOM, 스텝 재생
 * 컨트롤, 고해상도 캔버스, 폭 변화 대응, 테마 색 읽기.
 *
 * 왜 스텝 기반인가 (requestAnimationFrame 자동 재생이 아니라)
 *   알고리즘 위젯의 목적은 "예쁘게 움직이는 것"이 아니라 "한 스텝씩 곱씹는 것"이다.
 *   자동 애니메이션은 지나가 버리고, 독자는 되감을 수 없다. 그래서 상태를 미리
 *   전부 계산해 두고 인덱스로 왕복한다. 재생 버튼은 그 인덱스를 시간에 따라
 *   올려 주는 편의 기능일 뿐이다.
 *
 * 파일명이 밑줄로 시작하는 이유: build.py 가 assets/widgets/*.js 를 정렬해서
 * 이어붙인다. '_' 는 알파벳보다 앞서므로 이 파일이 항상 먼저 들어간다.
 */
(function () {
  'use strict';

  var W = (typeof window !== 'undefined' ? window : this);
  W.Widgets = W.Widgets || {};

  var reduceMotion = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------------------------------------------------------------- 색 토큰
  //
  // 위젯은 색을 직접 정하지 않는다. 계약 §6 의 CSS 변수를 읽어 쓴다.
  // 그래야 테마를 바꿨을 때 위젯만 따로 놀지 않는다.

  var TOKENS = [
    'w-visited', 'w-frontier', 'w-path', 'w-wall', 'w-start', 'w-goal',
    'accent', 'accent-dim', 'fg', 'fg-dim', 'fg-faint', 'bg', 'bg-elev', 'bg-code', 'border',
    'box-warn', 'box-danger', 'box-classify'
  ];

  function readTokens(node) {
    var cs = getComputedStyle(node);
    var out = {};
    for (var i = 0; i < TOKENS.length; i++) {
      var k = TOKENS[i];
      var v = cs.getPropertyValue('--' + k).trim();
      // 카멜케이스로도 꺼낼 수 있게 둔다: tokens.wVisited / tokens['w-visited']
      out[k] = v || '#888';
      out[k.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = out[k];
    }
    return out;
  }

  // 테마 전환은 <html data-theme> 속성으로 일어난다. 캔버스는 CSS 변수를
  // 자동으로 따라가지 않으므로 직접 감지해서 다시 그려야 한다.
  var themeSubs = [];
  var themeObserver = null;

  function onThemeChange(fn) {
    themeSubs.push(fn);
    if (!themeObserver && typeof MutationObserver === 'function') {
      themeObserver = new MutationObserver(function () {
        for (var i = 0; i < themeSubs.length; i++) {
          try { themeSubs[i](); } catch (e) { /* 한 위젯의 실패가 나머지를 막지 않는다 */ }
        }
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return function () {
      var i = themeSubs.indexOf(fn);
      if (i >= 0) themeSubs.splice(i, 1);
    };
  }

  // ---------------------------------------------------------------- 껍데기

  /* 위젯의 공통 DOM 을 만든다.
   *   .widget > .wk            (런타임이 소유하는 루트)
   *     .wk-head   제목 + 우측 커스텀 슬롯
   *     .wk-stage  위젯 본체가 그리는 곳
   *     .wk-ctl    재생 컨트롤
   *     .wk-status 현재 스텝 설명 (스크린리더도 읽는다)
   */
  function frame(host, o) {
    o = o || {};
    host.innerHTML = '';
    host.classList.remove('is-placeholder', 'is-error');
    if (o.wide) host.classList.add('wide');

    var root = el('div', 'wk');
    var head = el('div', 'wk-head');
    if (o.title) head.appendChild(el('div', 'wk-title', o.title));
    var slot = el('div', 'wk-slot');
    head.appendChild(slot);

    var stage = el('div', 'wk-stage');
    var ctl = el('div', 'wk-ctl');
    var status = el('div', 'wk-status');
    // 스텝이 바뀔 때마다 무엇이 일어났는지 읽어 준다. 색만으로 전달하면
    // 색을 구분하지 못하는 독자에게는 위젯이 통째로 사라진다.
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    root.appendChild(head);
    root.appendChild(stage);
    root.appendChild(ctl);
    root.appendChild(status);
    host.appendChild(root);

    return { root: root, head: head, slot: slot, stage: stage, ctl: ctl, status: status };
  }

  // ---------------------------------------------------------------- 스텝 재생기

  /* player(ui, opts)
   *   opts.total(): 전체 스텝 수 (동적으로 바뀔 수 있어 함수로 받는다)
   *   opts.render(i): i 번째 상태를 그린다
   *   opts.label(i): 상태 줄에 쓸 문장 (선택)
   *   opts.speed: 자동 재생 간격 ms (기본 420)
   */
  function player(ui, opts) {
    var i = 0;
    var timer = null;
    var speed = opts.speed || 420;

    var bBack = el('button', 'wk-btn', '◀');
    var bPlay = el('button', 'wk-btn wk-play', '▶');
    var bNext = el('button', 'wk-btn', '▶');
    var bReset = el('button', 'wk-btn wk-reset', '↺');
    var range = el('input', 'wk-range');
    var count = el('span', 'wk-count');
    var speedSel = el('select', 'wk-speed');

    bBack.type = bNext.type = bPlay.type = bReset.type = 'button';
    bBack.setAttribute('aria-label', '이전 스텝');
    bNext.setAttribute('aria-label', '다음 스텝');
    bPlay.setAttribute('aria-label', '재생');
    bReset.setAttribute('aria-label', '처음으로');
    range.type = 'range';
    range.min = '0';
    range.step = '1';
    range.setAttribute('aria-label', '스텝 위치');

    [['0.5', '0.5배'], ['1', '1배'], ['2', '2배'], ['4', '4배']].forEach(function (p) {
      var o = el('option', null, p[1]);
      o.value = p[0];
      if (p[0] === '1') o.selected = true;
      speedSel.appendChild(o);
    });
    speedSel.setAttribute('aria-label', '재생 속도');

    ui.ctl.appendChild(bReset);
    ui.ctl.appendChild(bBack);
    ui.ctl.appendChild(bPlay);
    ui.ctl.appendChild(bNext);
    ui.ctl.appendChild(range);
    ui.ctl.appendChild(count);
    ui.ctl.appendChild(speedSel);

    function last() { return Math.max(0, opts.total() - 1); }

    function draw() {
      var n = last();
      if (i > n) i = n;
      if (i < 0) i = 0;
      range.max = String(n);
      range.value = String(i);
      count.textContent = i + ' / ' + n;
      bBack.disabled = i === 0;
      bNext.disabled = i === n;
      try {
        opts.render(i);
      } catch (e) {
        if (W.console) console.error('widget render', e);
      }
      if (opts.label) {
        try { ui.status.textContent = opts.label(i) || ''; } catch (e) { ui.status.textContent = ''; }
      }
    }

    function goto(n) { i = n; draw(); }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      bPlay.textContent = '▶';
      bPlay.setAttribute('aria-label', '재생');
      bPlay.classList.remove('is-playing');
    }

    function play() {
      if (timer) { stop(); return; }
      if (i >= last()) { i = 0; }
      bPlay.textContent = '❚❚';
      bPlay.setAttribute('aria-label', '일시정지');
      bPlay.classList.add('is-playing');
      timer = setInterval(function () {
        if (i >= last()) { stop(); return; }
        i += 1;
        draw();
      }, speed / parseFloat(speedSel.value));
    }

    bBack.addEventListener('click', function () { stop(); goto(i - 1); });
    bNext.addEventListener('click', function () { stop(); goto(i + 1); });
    bReset.addEventListener('click', function () { stop(); goto(0); });
    bPlay.addEventListener('click', play);
    range.addEventListener('input', function () { stop(); goto(parseInt(range.value, 10) || 0); });
    speedSel.addEventListener('change', function () {
      if (timer) { stop(); play(); }   // 재생 중 속도를 바꾸면 즉시 반영한다
    });

    // 위젯에 포커스가 있을 때만 화살표를 먹는다. 본문 스크롤을 빼앗지 않기 위해서다.
    ui.root.tabIndex = 0;
    ui.root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); stop(); goto(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); goto(i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); stop(); goto(0); }
      else if (e.key === 'End') { e.preventDefault(); stop(); goto(last()); }
      else if (e.key === ' ') { e.preventDefault(); play(); }
    });

    // 화면 밖으로 나가면 재생을 멈춘다. 보이지도 않는 위젯이 계속 도는 것은 낭비다.
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) stop();
      }, { threshold: 0 }).observe(ui.root);
    }

    return {
      draw: draw,
      goto: goto,
      play: play,
      stop: stop,
      index: function () { return i; },
      autoplayAllowed: !reduceMotion
    };
  }

  // ---------------------------------------------------------------- 캔버스

  /* 고해상도 대응 캔버스를 만들고, 폭이 바뀌거나 테마가 바뀌면 다시 그린다.
   *   opts.height(width): 주어진 CSS 폭에 대한 높이를 돌려준다
   *   opts.draw(ctx, size, tokens): 실제 그리기
   */
  function canvas(stage, opts) {
    var cv = el('canvas', 'wk-canvas');
    stage.appendChild(cv);
    var ctx = cv.getContext('2d');
    var size = { w: 0, h: 0 };
    var tokens = readTokens(stage);

    function redraw() {
      var cssW = stage.clientWidth || 320;
      var cssH = Math.max(80, Math.round(opts.height ? opts.height(cssW) : cssW * 0.6));
      // devicePirelRatio 를 반영하지 않으면 레티나에서 선이 뭉갠다.
      var dpr = Math.min(W.devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
        cv.width = Math.round(cssW * dpr);
        cv.height = Math.round(cssH * dpr);
        cv.style.width = cssW + 'px';
        cv.style.height = cssH + 'px';
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      size.w = cssW;
      size.h = cssH;
      try {
        opts.draw(ctx, size, tokens);
      } catch (e) {
        if (W.console) console.error('widget draw', e);
      }
    }

    if (typeof ResizeObserver === 'function') {
      var pending = false;
      new ResizeObserver(function () {
        // 리사이즈는 연속으로 쏟아진다. 프레임당 한 번으로 묶는다.
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; redraw(); });
      }).observe(stage);
    } else {
      W.addEventListener('resize', redraw);
    }

    onThemeChange(function () { tokens = readTokens(stage); redraw(); });

    return { el: cv, ctx: ctx, size: size, redraw: redraw, tokens: function () { return tokens; } };
  }

  // ---------------------------------------------------------------- 보조

  /* 위젯 등록의 표준 형태. 예외를 여기서 잡아 자리표시자로 되돌린다.
   * 위젯 하나가 던져서 챕터 전체가 안 보이는 일이 없어야 한다. */
  function register(type, fn) {
    W.Widgets[type] = function (host, opts) {
      try {
        fn(host, opts || {});
      } catch (e) {
        host.classList.add('is-error');
        host.innerHTML = '<div class="widget-placeholder">위젯 <code>' + type + '</code> 오류</div>';
        if (W.console) console.error('widget ' + type, e);
      }
    };
  }

  function seg(host, items, initial, onPick) {
    var wrap = el('div', 'wk-seg');
    var cur = initial;
    items.forEach(function (it) {
      var b = el('button', 'wk-seg-btn', it.label);
      b.type = 'button';
      b.setAttribute('data-val', it.value);
      if (it.value === cur) b.classList.add('is-active');
      b.addEventListener('click', function () {
        cur = it.value;
        Array.prototype.forEach.call(wrap.children, function (c) {
          c.classList.toggle('is-active', c.getAttribute('data-val') === cur);
        });
        onPick(cur);
      });
      wrap.appendChild(b);
    });
    host.appendChild(wrap);
    return wrap;
  }

  W.WidgetKit = {
    frame: frame,
    player: player,
    canvas: canvas,
    tokens: readTokens,
    onThemeChange: onThemeChange,
    register: register,
    seg: seg,
    el: el,
    reduceMotion: reduceMotion
  };
})();

/* ==== backtracking-tree.js ==== */
/* backtracking-tree.js — 재귀 호출 트리가 뻗고, 가지치기로 잘려 나간다
 *
 * 이 위젯이 증명하려는 명제는 하나다: **백트래킹의 이득은 "더 좋은 답"이 아니라
 * "같은 답을 훨씬 적게 펼쳐서" 다.** 그래서 화면의 주인공은 트리 그림이 아니라
 * 그 위에 붙은 두 개의 카운터다 — 가지치기 ON 과 OFF 의 방문 노드 수.
 * 4-퀸에서 341 이 17 로 줄고, 8-퀸에서 1,900만이 2,057 로 줄어든다.
 * 그 숫자가 III-4 의 논지 전부이고, 산문으로는 이 대비가 만들어지지 않는다.
 *
 * 왜 잘린 가지 아래에 "유령 삼각형"을 그리는가
 *   가지치기를 색칠로만 표시하면 화면에서 사라진 것은 아무것도 없다 —
 *   원래 거기 매달려 있었을 부분트리를 독자가 상상해야 한다. 상상을 시키면
 *   위젯이 하는 일이 없다. 잘린 노드마다 점선 삼각형과 "×16" 같은 잎 개수를
 *   남겨서, **버린 것의 크기**를 눈에 보이게 한다. III-4 가 "잘려 나간 자리에
 *   원래 무엇이 매달려 있었는지"를 요구하는 지점이다.
 *
 * 왜 스텝 = 노드 방문 1회 인가
 *   그렇게 두면 스텝 인덱스가 곧 "지금까지 만든 노드 수"가 되어 카운터와
 *   재생 위치가 같은 수를 가리킨다. 되돌아 나오는 것(undo)은 스텝을 소비하지
 *   않는다 — 화면에서 새로 생기는 것이 없기 때문이다. 대신 지금 노드에서
 *   뿌리까지의 경로를 액센트로 칠해 **재귀 스택**을 항상 보이게 한다.
 *
 * 왜 색·모양을 둘 다 쓰는가
 *   방문=원, 가지치기=×가 그어진 사각형, 해=금색 마름모. 색을 구분하지 못해도
 *   모양으로 갈린다(계약 §5). 트리가 300 노드를 넘어가면 글자가 죽으므로
 *   모양이 유일한 단서가 되는 구간이 실제로 생긴다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  /* 그리는 노드 수 상한. 폭이 좁을수록 잎 간격이 무너지므로 단계로 낮춘다.
   * 상한을 넘으면 **DFS 앞부분만** 남는다 — 실제 탐색이 방문하는 순서 그대로라
   * 재생 서사가 깨지지 않는다. 잘라냈다는 사실은 제목에 적는다(계약 §7,
   * dp-table 이 이미 밟은 선례). 조용히 자르면 위젯이 거짓말을 한다. */
  var TIERS = [[900, 400], [560, 360], [0, 180]];

  // 전수 열거를 실제로 돌려 볼 상한. 8-퀸의 가지치기 없는 트리는 1,900만 노드라
  // 브라우저에서 돌릴 수 없다. 그 위는 닫힌 식으로 계산하고 "계산값"이라고 밝힌다.
  var ENUM_BUDGET = 1200000;

  var MAX_TREE_H = 430;
  /* 현재 상태 패널(퀸 판 등). 트리에서 폭을 떼어 오는 값비싼 장치라
   * ① 폭이 700 이상이고 ② 잎이 200개 이하일 때만 켠다. 잎이 그보다 많으면
   * 노드가 이미 점 크기라 트리에 폭을 다 주는 편이 낫다. */
  var SIDE_MIN = 700;
  var SIDE_MAX_LEAVES = 200;
  var COMPACT = 620;         // 이 폭 아래에서는 카운터를 한 줄짜리로 접는다

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(v, list, dflt) {
    for (var i = 0; i < list.length; i++) if (v === list[i]) return v;
    return dflt;
  }

  function comma(n) {
    if (!isFinite(n)) return '?';
    var s = String(Math.round(n)), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0 && s.charAt(i - 1) !== '-') out = ',' + out;
    }
    return out;
  }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  // 등비수열 합 1 + B + B^2 + ... + B^D. 가지치기 없는 트리의 노드 수다.
  function geom(B, D) {
    var s = 0, p = 1;
    for (var d = 0; d <= D; d++) { s += p; p *= B; }
    return s;
  }

  // ─── 문제 정의 ───────────────────────────────────────────────────────────
  //
  // spec 은 "선택 트리" 하나를 기술한다. 탐색 드라이버(search)는 문제를 모른다.
  //   D          깊이 (선택을 몇 번 하면 잎인가)
  //   B          분기 수 (후보 개수). 가지치기 없는 트리의 크기를 여기서 역산한다
  //   reject(d,c)  가지치기 근거 문자열 또는 null. **필요조건만 검사한다** —
  //                여기서 자른 가지 아래에 해가 있으면 위젯이 답을 잃는다
  //   accept()     잎에서의 최종 판정. reject 와 독립적으로 전체를 다시 검사한다.
  //                그래야 가지치기를 꺼도 같은 해집합이 나오는 것이 **검증**된다
  //
  // 본문 ::: dual 의 코드와 같은 알고리즘이어야 한다(계약 §9). 특히 퀸의
  // 충돌 검사는 "열 같음 + 행차 == 열차" 두 줄 그대로다.

  function nqueensSpec(n) {
    var col = new Int32Array(n);
    return {
      key: 'nqueens', D: n, B: n, n: n,
      levelLabel: function (d) { return d === 0 ? '빈 판' : '행 ' + (d - 1); },
      rootText: '·',
      rootSay: '빈 판에서 시작한다. 행 0 부터 열을 하나씩 시도한다. 한 행에 퀸은 정확히 하나다.',
      nodeText: function (d, c) { return String(c); },
      candidates: function () {
        var a = [];
        for (var c = 0; c < n; c++) a.push(c);
        return a;
      },
      // 이미 놓인 퀸 중 첫 번째 충돌을 돌려준다. 어느 퀸과 왜 부딪히는지까지
      // 남겨야 상태 줄이 "열 3 이 이미 쓰였다" 처럼 근거를 말할 수 있다.
      reject: function (d, c) {
        for (var i = 0; i < d; i++) {
          if (col[i] === c) return { why: '열 ' + c + ' 이 이미 쓰였다', row: i };
          if (Math.abs(col[i] - c) === d - i) {
            return { why: '(행 ' + i + ', 열 ' + col[i] + ') 과 대각선으로 마주 본다', row: i };
          }
        }
        return null;
      },
      apply: function (d, c) { col[d] = c; },
      undo: function () { },
      accept: function () {
        for (var r = 1; r < n; r++) {
          for (var i = 0; i < r; i++) {
            if (col[i] === col[r] || Math.abs(col[i] - col[r]) === r - i) return false;
          }
        }
        return true;
      },
      solKey: function () {
        var a = [];
        for (var i = 0; i < n; i++) a.push(col[i]);
        return a.join('-');
      },
      sayOk: function (d, c) {
        return '(행 ' + d + ', 열 ' + c + ') 배치. 충돌 없다.' +
               (d + 1 < n ? ' 행 ' + (d + 1) + ' 로 내려간다.' : '');
      },
      sayCut: function (d, c, r) {
        return '(행 ' + d + ', 열 ' + c + ') 배치 시도 → ' + r.why + '. 가지치기.';
      },
      sayFail: function (d, c) {
        // 가지치기를 끈 경우에만 온다: 잎까지 다 가서야 틀린 것을 안다.
        var r = null;
        for (var rr = 1; rr < n && !r; rr++) {
          for (var i = 0; i < rr; i++) {
            if (col[i] === col[rr]) { r = '(행 ' + i + ', 열 ' + col[i] + ') 과 같은 열'; break; }
            if (Math.abs(col[i] - col[rr]) === rr - i) {
              r = '(행 ' + i + ', 열 ' + col[i] + ') 과 대각선'; break;
            }
          }
        }
        return '(행 ' + d + ', 열 ' + c + ') 배치. 판이 다 찼다 — 검사하니 ' +
               (r || '충돌') + ' 이다. 버린다.';
      },
      state: function () { return col; }
    };
  }

  function subsetSpec(items, target) {
    var n = items.length, pick = new Int32Array(n), sum = 0;
    return {
      key: 'subset', D: n, B: 2, items: items, target: target,
      levelLabel: function (d) { return d === 0 ? '시작' : '물건 ' + (d - 1); },
      rootText: '0',
      rootSay: '빈 부분집합에서 시작한다. 합 0. 물건마다 넣을지 말지를 고른다. 목표는 ' + target + '.',
      nodeText: function (d, c) { return c ? '+' + items[d] : '−'; },
      candidates: function () { return [1, 0]; },   // 넣는 쪽을 먼저 — 초과가 빨리 드러난다
      reject: function (d, c) {
        if (!c) return null;                        // 건너뛰는 선택은 합을 늘리지 않는다
        if (sum + items[d] > target) {
          return { why: '합 ' + (sum + items[d]) + ' 이 목표 ' + target + ' 을 넘는다', row: d };
        }
        return null;
      },
      apply: function (d, c) { pick[d] = c; if (c) sum += items[d]; },
      undo: function (d, c) { if (c) sum -= items[d]; pick[d] = 0; },
      accept: function () {
        var s = 0;
        for (var i = 0; i < n; i++) if (pick[i]) s += items[i];
        return s === target;
      },
      solKey: function () {
        var a = [];
        for (var i = 0; i < n; i++) if (pick[i]) a.push(items[i]);
        return '{' + a.join(',') + '}';
      },
      sayOk: function (d, c) {
        var s = c ? ('물건 ' + d + '(무게 ' + items[d] + ') 을 넣는다 → 합 ' + (sum + items[d]))
                  : ('물건 ' + d + '(무게 ' + items[d] + ') 을 건너뛴다 → 합 ' + sum);
        return s + '. 목표 ' + target + ' 이하다.' + (d + 1 < n ? ' 물건 ' + (d + 1) + ' 로 넘어간다.' : '');
      },
      sayCut: function (d, c, r) {
        return '물건 ' + d + '(무게 ' + items[d] + ') 을 넣어 보면 → ' + r.why + '. 가지치기.';
      },
      sayFail: function (d, c) {
        var s = 0;
        for (var i = 0; i < n; i++) if (pick[i]) s += items[i];
        return '물건 ' + d + ' 까지 다 골랐다. 합 ' + s + ' ≠ 목표 ' + target + '. 버린다.';
      },
      state: function () { return pick; },
      sumNow: function () { return sum; }
    };
  }

  function permutationSpec(n) {
    var a = new Int32Array(n), used = new Int32Array(n), at = new Int32Array(n);
    return {
      key: 'permutation', D: n, B: n, n: n,
      levelLabel: function (d) { return d === 0 ? '시작' : '자리 ' + (d - 1); },
      rootText: '·',
      rootSay: '빈 수열에서 시작한다. 자리 0 부터 값 0..' + (n - 1) + ' 를 하나씩 시도한다.',
      nodeText: function (d, c) { return String(c); },
      candidates: function () {
        var l = [];
        for (var c = 0; c < n; c++) l.push(c);
        return l;
      },
      reject: function (d, c) {
        if (used[c]) return { why: '값 ' + c + ' 는 자리 ' + at[c] + ' 에서 이미 썼다', row: at[c] };
        return null;
      },
      apply: function (d, c) { a[d] = c; used[c] = 1; at[c] = d; },
      undo: function (d, c) { used[c] = 0; },
      accept: function () {
        var seen = {};
        for (var i = 0; i < n; i++) {
          if (seen[a[i]]) return false;
          seen[a[i]] = 1;
        }
        return true;
      },
      solKey: function () {
        var o = [];
        for (var i = 0; i < n; i++) o.push(a[i]);
        return o.join('-');
      },
      sayOk: function (d, c) {
        return '자리 ' + d + ' 에 값 ' + c + '. 아직 안 쓴 값이다.' +
               (d + 1 < n ? ' 자리 ' + (d + 1) + ' 로 넘어간다.' : '');
      },
      sayCut: function (d, c, r) {
        return '자리 ' + d + ' 에 값 ' + c + ' 시도 → ' + r.why + '. 가지치기.';
      },
      sayFail: function (d, c) {
        return '자리 ' + d + ' 까지 다 채웠다 — 값이 겹친다. 순열이 아니다. 버린다.';
      },
      state: function () { return a; }
    };
  }

  // ─── 탐색 드라이버 ───────────────────────────────────────────────────────

  /* 노드 하나 = 상태 하나. 루트는 "아무것도 고르지 않은 상태"다.
   *   kind 'ok'   들어가서 더 펼친 노드 (= 방문)
   *        'cut'  가지치기로 잘린 노드. 만들기는 하되 펼치지 않는다
   *        'sol'  잎 + 해
   *        'fail' 잎인데 틀림 (가지치기를 껐을 때만 나온다)
   *        'base' 하노이의 기저 호출
   *
   * 방문 수의 정의: **cut 이 아닌 노드의 수**(루트 포함). 4-퀸 가지치기 ON 이
   * 17, OFF 가 341 이 되는 그 정의이고 III-4 본문의 숫자와 같다.
   *
   * enumerate=false 면 drawCap 에서 재귀를 통째로 멈춘다. 8-퀸의 가지치기 없는
   * 트리(1,900만 노드)를 브라우저가 다 돌 수 없기 때문이다. 그때 총계는
   * 닫힌 식으로 채우고 화면에 "계산값"이라고 밝힌다.
   */
  function search(spec, prune, drawCap, enumerate) {
    var D = spec.D;
    var nodes = [], solKeys = [];
    var visited = 0, pruned = 0, truncated = false, stopped = false;

    function add(parent, depth, kind, text, say, cv, wrow, skip) {
      if (nodes.length >= drawCap) { truncated = true; return -1; }
      var nd = {
        p: parent, d: depth, kind: kind, txt: text, say: say,
        cv: cv, wrow: (wrow == null ? -1 : wrow), skip: skip || 0,
        kids: [], slot: 0, x: 0, y: 0
      };
      nodes.push(nd);
      if (parent >= 0) nodes[parent].kids.push(nodes.length - 1);
      return nodes.length - 1;
    }

    function leavesUnder(depth) { return Math.pow(spec.B, D - depth); }

    function rec(id, d) {
      if (stopped) return;
      if (d === D) {
        var ok = spec.accept();
        if (ok) {
          solKeys.push(spec.solKey());
          if (id >= 0) { nodes[id].kind = 'sol'; nodes[id].say += ' 해 ' + solKeys[solKeys.length - 1] + ' 를 찾았다.'; }
        } else if (id >= 0) {
          nodes[id].kind = 'fail';
        }
        return;
      }
      var cands = spec.candidates(d);
      for (var i = 0; i < cands.length; i++) {
        if (stopped) return;
        var c = cands[i];
        var r = prune ? spec.reject(d, c) : null;
        if (r) {
          pruned++;
          add(id, d + 1, 'cut',
              spec.nodeText(d, c),
              spec.sayCut(d, c, r) + ' 이 아래 ' + comma(leavesUnder(d + 1)) + '개 잎을 통째로 버린다.',
              c, r.row, leavesUnder(d + 1));
          if (!enumerate && truncated) { stopped = true; return; }
          continue;
        }
        visited++;
        var say = (d + 1 === D) ? null : spec.sayOk(d, c);
        var nid = add(id, d + 1, 'ok', spec.nodeText(d, c), say, c, -1, 0);
        if (!enumerate && truncated) { stopped = true; return; }
        spec.apply(d, c);
        // 잎의 문장은 상태를 적용한 뒤에 만들어야 "무엇과 충돌했는지"를 말할 수 있다.
        if (nid >= 0 && d + 1 === D) {
          nodes[nid].say = spec.accept() ? spec.sayOk(d, c) : spec.sayFail(d, c);
        }
        rec(nid, d + 1);
        spec.undo(d, c);
      }
    }

    visited++;
    var root = add(-1, 0, 'ok', spec.rootText, spec.rootSay, -1, -1, 0);
    rec(root, 0);

    return {
      nodes: nodes, solKeys: solKeys,
      visited: visited, pruned: pruned, sols: solKeys.length,
      truncated: truncated, exact: !stopped
    };
  }

  // ─── 하노이 호출 트리 ────────────────────────────────────────────────────
  //
  // 하노이는 "탐색"이 아니라 **호출 트리**다. 자를 가지가 없다 — 모든 호출이
  // 실제로 필요한 일을 한다. III-1 이 이 위젯에 요구하는 것은 가지치기가 아니라
  // "한 노드에서 보이는 것은 자기 자신과 자식 둘뿐" 이라는 그림이다.

  function hanoiModel(n, drawCap) {
    var nodes = [], calls = 0, bases = 0, moves = 0, truncated = false;
    var PEG = ['A', 'B', 'C'];

    function add(parent, depth, kind, text, say, cv, arrow) {
      if (nodes.length >= drawCap) { truncated = true; return -1; }
      nodes.push({
        p: parent, d: depth, kind: kind, txt: text, say: say, cv: cv,
        wrow: -1, skip: 0, kids: [], slot: 0, x: 0, y: 0, arrow: arrow
      });
      if (parent >= 0) nodes[parent].kids.push(nodes.length - 1);
      return nodes.length - 1;
    }

    function rec(parent, depth, k, from, to, via) {
      var tag = 'h' + k;
      var arrow = PEG[from] + '→' + PEG[to];
      calls++;
      if (k === 0) {
        bases++;
        var bid = add(parent, depth, 'base', '0',
          'hanoi(0, ' + arrow + ') — 기저 조건. 원반이 없으니 아무 일도 하지 않고 그대로 돌아간다. ' +
          '여기가 재귀가 멈추는 자리다.', k, arrow);
        return bid;
      }
      moves++;
      var id = add(parent, depth, 'ok', tag,
        'hanoi(' + k + ', ' + arrow + ') 호출. 맨 아래 원반 ' + k + ' 를 ' + PEG[to] + ' 로 보내려면 ' +
        '위 ' + (k - 1) + '개가 먼저 ' + PEG[via] + ' 로 비켜나야 한다 — 그것이 왼쪽 자식이다. ' +
        '비켜났다고 믿고 원반 ' + k + ' 를 옮긴 뒤, 오른쪽 자식이 그 ' + (k - 1) + '개를 ' + PEG[to] + ' 로 옮긴다.', k, arrow);
      rec(id, depth + 1, k - 1, from, via, to);
      rec(id, depth + 1, k - 1, via, to, from);
      return id;
    }

    rec(-1, 0, n, 0, 2, 1);
    return {
      nodes: nodes, solKeys: [], visited: calls, pruned: 0, sols: bases,
      moves: moves, truncated: truncated, exact: true
    };
  }

  // ─── 배치 ────────────────────────────────────────────────────────────────

  /* 잎을 균등 간격으로 늘어놓고 부모를 **자기 부분트리의 잎 구간 한가운데**에 둔다.
   * 자식들의 평균이 아니라 잎 구간의 중앙인 이유: 자식마다 부분트리 크기가
   * 다르면 평균은 큰 쪽으로 끌려가서 트리가 통째로 기울어 보인다. 잎 구간의
   * 중앙을 쓰면 층마다 좌우 대칭이 살아나 "같은 규칙이 반복된다"가 눈에 들어온다.
   * 가지치기된 노드도 잎으로 자리를 차지한다 — 자리를 안 주면 잘린 가지가
   * 화면에서 사라져 버려서, 정작 이 위젯이 보여야 할 "버린 것"이 안 보인다. */
  function assignSlots(nodes) {
    if (!nodes.length) return 0;
    var slot = 0;
    // 재귀 대신 후위 순회를 스택으로 돈다. 노드가 400개까지 가는데
    // 호출 스택 한도에 기대고 싶지 않다.
    var stack = [[0, 0]];
    while (stack.length) {
      var top = stack[stack.length - 1];
      var nd = nodes[top[0]];
      if (top[1] === 0) nd.lo = slot;            // 부분트리가 차지하기 시작하는 잎 자리
      if (top[1] < nd.kids.length) {
        top[1] += 1;
        stack.push([nd.kids[top[1] - 1], 0]);
      } else {
        if (!nd.kids.length) slot += 1;
        nd.hi = slot;
        nd.slot = (nd.lo + nd.hi) / 2;
        stack.pop();
      }
    }
    return slot;
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('backtracking-tree', function (host, opts) {
    if (!opts || typeof opts !== 'object') opts = {};

    // ---- opts 검증. 본문 저자가 손으로 쓴 JSON 이라 신뢰하지 않는다(계약 §1) ----
    var problem = oneOf(opts.problem, ['nqueens', 'subset', 'permutation', 'hanoi'], 'nqueens');
    var prunable = problem !== 'hanoi';
    var prune = prunable ? (opts.prune !== false) : false;

    var n;
    if (problem === 'nqueens') n = clampInt(opts.n, 4, 8, 5);
    else if (problem === 'permutation') n = clampInt(opts.n, 2, 6, 4);
    else n = clampInt(opts.n, 1, 6, 3);            // hanoi

    var items = [];
    if (isArr(opts.items)) {
      for (var ii = 0; ii < opts.items.length && items.length < 8; ii++) {
        var w = clampInt(opts.items[ii], 1, 99, 0);
        if (w > 0) items.push(w);
      }
    }
    if (items.length < 2) items = [3, 34, 4, 12, 5, 2];
    var target = clampInt(opts.target, 1, 999, 9);

    var caption = (typeof opts.caption === 'string' && opts.caption.length)
      ? opts.caption.slice(0, 120) : '';

    function makeSpec() {
      if (problem === 'subset') return subsetSpec(items, target);
      if (problem === 'permutation') return permutationSpec(n);
      return nqueensSpec(n);
    }

    var B = problem === 'subset' ? 2 : n;
    var D = problem === 'subset' ? items.length : n;

    // ---- 모델 ----
    var cap = 400;
    var model = null;
    var layout = null;
    var cur = 0;
    var player = null;

    /* 한 번의 rebuild 가 두 번 탐색한다: 지금 모드(그리기 + 세기)와 반대 모드(세기만).
     * 두 수를 나란히 놓는 것이 이 위젯의 결론이므로, 반대편 숫자는 항상 있어야 한다. */
    function rebuild() {
      var m;
      if (problem === 'hanoi') {
        m = hanoiModel(n, cap);
        m.other = null;
        m.same = null;
      } else {
        var spec = makeSpec();
        var estCur = prune ? 0 : geom(B, D);
        m = search(spec, prune, cap, !(estCur > ENUM_BUDGET));
        if (!m.exact) {
          // 전수 열거를 포기했다. 노드 수는 닫힌 식으로 정확히 계산되고,
          // 해의 개수는 반대편(가지치기 ON) 이 알려 준다.
          m.visited = geom(B, D);
          m.pruned = 0;
        }
        var spec2 = makeSpec();
        var estOther = prune ? geom(B, D) : 0;
        var o = search(spec2, !prune, 0, !(estOther > ENUM_BUDGET));
        if (!o.exact) { o.visited = geom(B, D); o.pruned = 0; }
        m.other = o;

        // 가지치기는 비용을 바꾸지 exact 답을 바꾸지 않는다 — 그 명제를 위젯이 직접 검사한다.
        if (m.exact && o.exact) {
          m.same = m.solKeys.join('|') === o.solKeys.join('|');
          m.solList = m.solKeys;
        } else {
          m.same = null;
          m.solList = m.exact ? m.solKeys : o.solKeys;
          if (!m.exact) m.sols = o.sols;
          if (!o.exact) o.sols = m.sols;
        }
      }
      m.leaves = assignSlots(m.nodes);
      m.maxDepth = 0;
      // 누적 카운터. render 에서 매번 세면 재생이 느려진다(계약 §7).
      var nn = m.nodes.length;
      m.cVis = new Int32Array(nn + 1);
      m.cCut = new Int32Array(nn + 1);
      m.cSol = new Int32Array(nn + 1);
      for (var i = 0; i < nn; i++) {
        var nd = m.nodes[i];
        if (nd.d > m.maxDepth) m.maxDepth = nd.d;
        m.cVis[i + 1] = m.cVis[i] + (nd.kind === 'cut' ? 0 : 1);
        m.cCut[i + 1] = m.cCut[i] + (nd.kind === 'cut' ? 1 : 0);
        // 하노이의 기저 호출(base)은 "여기서 멈춘다"는 뜻이라 해와 같은 칸에 센다.
        m.cSol[i + 1] = m.cSol[i] + ((nd.kind === 'sol' || nd.kind === 'base') ? 1 : 0);
      }
      /* 하노이의 "원반을 옮기는 순간"은 노드에 들어갈 때가 아니라 **왼쪽 자식의
       * 부분트리가 끝난 뒤**다. 그 순서가 곧 hanoi 의 세 줄(왼쪽 재귀 → 이동 →
       * 오른쪽 재귀)이므로, 노드 방문 수로 이동 수를 대신 세면 거짓말이 된다.
       * DFS 순서에서 왼쪽 부분트리는 [첫째 자식, 둘째 자식 - 1] 구간이다. */
      if (problem === 'hanoi') {
        m.cMov = new Int32Array(nn + 1);
        var mk = new Int32Array(nn);
        for (var h = 0; h < nn; h++) {
          var hn = m.nodes[h];
          if (hn.kids.length === 2) {
            var j = hn.kids[1] - 1;
            if (j >= 0 && j < nn) mk[j] += 1;
          }
        }
        for (var h2 = 0; h2 < nn; h2++) m.cMov[h2 + 1] = m.cMov[h2] + mk[h2];
      }
      m.total = m.visited + m.pruned;
      model = m;
      layout = null;
    }
    rebuild();

    // ---- 껍데기 ----
    var defTitle = {
      nqueens: n + '-퀸 탐색 트리',
      subset: '부분집합 합 = ' + target + ' 탐색 트리',
      permutation: n + '개 순열 생성 트리',
      hanoi: 'hanoi(' + n + ') 호출 트리'
    }[problem];

    var ui = K.frame(host, { title: caption || defTitle, wide: true });
    var titleEl = ui.head.querySelector('.wk-title');
    var baseTitle = caption || defTitle;

    function syncTitle() {
      if (!titleEl) return;
      var s = baseTitle;
      if (model.truncated) {
        s += '  · 앞 ' + comma(model.nodes.length) + '개 노드까지만 그린다 (전체 ' +
             comma(model.total) + '개)';
      }
      if (titleEl.textContent !== s) titleEl.textContent = s;
    }

    if (prunable) {
      K.seg(ui.slot, [
        { label: '가지치기 ON', value: 'on' },
        { label: 'OFF', value: 'off' }
      ], prune ? 'on' : 'off', function (v) {
        prune = (v === 'on');
        rebuild();
        // 모드를 바꾸면 트리 모양 자체가 달라진다. 처음부터 다시 보는 것이 맞다.
        player.stop();
        player.goto(0);
        syncTitle();
      });
    } else {
      var note = K.el('span', null, '가지치기 없음 — 모든 호출이 필요한 일을 한다');
      note.style.fontSize = '.74rem';
      note.style.color = 'var(--fg-faint)';
      ui.slot.appendChild(note);
    }

    var legend = K.el('div', 'wk-legend');
    var LEG = problem === 'hanoi'
      ? [['--w-visited', '호출 (원)'], ['--w-path', '기저 조건 h0 (마름모) — 여기서 멈춘다'],
         ['--accent', '지금 호출 + 그 위 호출들 = 재귀 스택']]
      : [['--w-visited', '방문 (원)'], ['--box-danger', '가지치기 (× 사각형) — 펼치지 않는다'],
         ['--w-wall', '잎까지 가서 실패 (흐린 사각형)'], ['--w-path', '해 (마름모)'],
         ['--accent', '지금 노드 + 뿌리까지의 경로 = 재귀 스택']];
    LEG.forEach(function (p) {
      var s = K.el('span'), i = K.el('i');
      i.style.background = 'var(' + p[0] + ')';
      s.appendChild(i);
      s.appendChild(document.createTextNode(p[1]));
      legend.appendChild(s);
    });
    if (prunable) {
      legend.appendChild(K.el('span', null, '· 점선 삼각형 = 잘려서 펼치지 않은 부분트리 (안의 수는 그 아래 잎 개수)'));
    }
    ui.root.insertBefore(legend, ui.ctl);

    // ---- 배치 계산 ----
    function capFor(w) {
      for (var i = 0; i < TIERS.length; i++) if (w >= TIERS[i][0]) return TIERS[i][1];
      return TIERS[TIERS.length - 1][1];
    }

    function computeLayout(w) {
      var compact = w < COMPACT;
      var side = (w >= SIDE_MIN && model.leaves <= SIDE_MAX_LEAVES) ? (w >= 860 ? 180 : 150) : 0;
      /* 깊이 라벨 자리. 폰에서도 없애지 않는다 — "한 층이 한 행" 이라는 대응이
       * 이 트리를 읽는 열쇠라, 폭을 조금 내주더라도 축은 남긴다. */
      var gut = (w >= 520) ? 46 : 30;
      // 카운터 패널 + 논지 두 줄. 논지가 잘리면 이 위젯의 결론이 사라진다.
      var headerH = compact ? (26 * 2 + 4 + 44) : (62 + 44);
      var levels = model.maxDepth + 1;
      var levelH = Math.floor(MAX_TREE_H / Math.max(1, levels));
      if (levelH > 58) levelH = 58;
      if (levelH < 22) levelH = 22;
      var treeTop = headerH + 10;
      var treeW = Math.max(60, w - gut - 8 - (side ? side + 12 : 0));
      var slotW = treeW / Math.max(1, model.leaves);
      var r = Math.min(levelH * 0.30, slotW * 0.42, 13);
      if (r < 1.2) r = 1.2;
      var treeH = (levels - 1) * levelH + r * 2 + 26;
      return {
        w: w, compact: compact, side: side, gut: gut,
        headerH: headerH, levelH: levelH, treeTop: treeTop, treeW: treeW,
        slotW: slotW, r: r, levels: levels,
        height: Math.min(700, treeTop + treeH + 6)
      };
    }

    function layoutFor(w) {
      if (!layout || layout.w !== w) {
        layout = computeLayout(w);
        // 노드 좌표는 배치가 바뀔 때만 다시 잡는다. render 안에서 만들지 않는다.
        for (var i = 0; i < model.nodes.length; i++) {
          var nd = model.nodes[i];
          nd.x = layout.gut + (nd.slot / Math.max(1, model.leaves)) * layout.treeW;
          nd.y = layout.treeTop + 12 + nd.d * layout.levelH;
        }
      }
      return layout;
    }

    // ---- 그리기 보조 ----
    function text(ctx, s, x, y, font, color, align) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.fillText(s, x, y);
      ctx.textAlign = 'left';
    }

    /* 논지 한 줄이 좁은 폭에서 캔버스 밖으로 새어 나가면 결론이 잘린다.
     * 어절 단위로 접어서 최대 두 줄까지 쓰고, 그래도 넘치면 말줄임한다. */
    function wrapLines(ctx, s, maxW, maxLines) {
      var words = s.split(' '), lines = [], line = '', i = 0;
      for (; i < words.length; i++) {
        var t = line ? line + ' ' + words[i] : words[i];
        if (line && ctx.measureText(t).width > maxW) {
          lines.push(line);
          line = words[i];
          if (lines.length >= maxLines - 1) { i++; break; }
        } else line = t;
      }
      // 남은 어절이 있으면 마지막 줄에 몰아넣고 폭에 맞춰 자른다.
      var rest = line;
      if (i < words.length) rest = line + ' ' + words.slice(i).join(' ');
      var cut = false;
      while (rest.length > 1 && ctx.measureText(rest + (cut ? '…' : '')).width > maxW) {
        rest = rest.slice(0, -1);
        cut = true;
      }
      lines.push(cut ? rest + '…' : rest);
      return lines;
    }

    /* 카운터 패널. grid-search 가 패널마다 "확장 칸 수"를 크게 띄우는 것과 같은 장치다 —
     * 이 위젯의 결론도 그림이 아니라 숫자이기 때문이다. */
    function statPanel(ctx, T, x, y, w, h, title, stats, active, compact) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = active ? T.accent : T.border;
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      if (compact) {
        text(ctx, title, x + 8, y + h / 2 + 4, '700 11px ' + FONT, active ? T.accent : T.fgDim);
        var tx = x + 8 + ctx.measureText(title).width + 10;
        for (var i = 0; i < stats.length; i++) {
          var s = stats[i][1] + ' ' + stats[i][0];
          text(ctx, s, tx, y + h / 2 + 4, (i === 0 ? '700 ' : '') + '11px ' + FONT,
               i === 0 ? T.fg : T.fgDim);
          tx += ctx.measureText(s).width + 10;
        }
        return;
      }

      text(ctx, title, x + 9, y + 16, '700 11px ' + FONT, active ? T.accent : T.fgDim);
      if (active) text(ctx, '← 지금 보는 트리', x + w - 9, y + 16, '10px ' + FONT, T.fgFaint, 'right');
      var colW = (w - 18) / stats.length;
      for (var k = 0; k < stats.length; k++) {
        var cx = x + 9 + colW * k;
        text(ctx, stats[k][1], cx, y + 44, '700 19px ' + FONT, k === 0 ? T.fg : T.fgDim);
        text(ctx, stats[k][0], cx, y + 57, '10px ' + FONT, T.fgFaint);
      }
    }

    function drawHeader(ctx, T, L) {
      var w = L.w, pad = 8;
      // 스텝 i 에서는 노드 0..i 까지가 드러나 있다. 누적 배열은 [i+1] 이 그 값이다.
      var upto = Math.min(cur + 1, model.nodes.length);
      var vis = model.cVis[upto];
      var cut = model.cCut[upto];
      var sol = model.cSol[upto];
      var done = cur >= model.nodes.length && !model.truncated;

      if (problem === 'hanoi') {
        var hw = Math.min(380, w - pad * 2);
        statPanel(ctx, T, pad, 6, hw, L.compact ? 26 : 62, '호출 트리 (가지치기 없음)', [
          ['호출', comma(vis) + (done ? '' : ' / ' + comma(model.visited))],
          ['기저 h0', comma(sol)],
          ['옮긴 원반', comma(model.cMov[upto]) + (done ? '' : ' / ' + comma(model.moves))]
        ], true, L.compact);
        thesis(ctx, T, L, '호출 ' + comma(model.visited) + '개 = 2^' + (n + 1) + ' − 1, ' +
               '그중 절반인 ' + comma(model.sols) + '개가 기저다. ' +
               '원반이 하나 늘 때마다 호출이 두 배가 된다 — 20개면 100만 번이다.', false);
        return;
      }

      var me = { v: model.visited, c: model.pruned, s: model.sols };
      var ot = { v: model.other.visited, c: model.other.pruned, s: model.other.sols };
      var on = prune ? me : ot, off = prune ? ot : me;

      var pw, ph = L.compact ? 26 : 62, gapY = L.compact ? 4 : 0;
      var x2, y2;
      if (L.compact) {
        pw = w - pad * 2;
        x2 = pad; y2 = 6 + ph + gapY;
      } else {
        pw = Math.min(300, Math.floor((w - pad * 2 - 12 - (L.side ? L.side + 12 : 0)) / 2));
        if (pw < 150) pw = Math.floor((w - pad * 2 - 12) / 2);
        x2 = pad + pw + 12; y2 = 6;
      }

      // 지금 보는 쪽만 "지금까지" 값을 키우고, 반대쪽은 최종값을 보여 준다.
      // 두 수를 같은 눈금에 두면 재생 도중에도 격차가 계속 읽힌다.
      var onStats = prune
        ? [['방문', comma(vis) + (done ? '' : ' / ' + comma(on.v))], ['잘림', comma(cut)], ['해', comma(sol)]]
        : [['방문', comma(on.v)], ['잘림', comma(on.c)], ['해', comma(on.s)]];
      var offStats = !prune
        ? [['방문', comma(vis) + (done ? '' : ' / ' + comma(off.v))], ['잘림', comma(cut)], ['해', comma(sol)]]
        : [['방문', comma(off.v)], ['잘림', comma(off.c)], ['해', comma(off.s)]];

      statPanel(ctx, T, pad, 6, pw, ph, '가지치기 ON', onStats, prune, L.compact);
      statPanel(ctx, T, x2, y2, pw, ph, '가지치기 OFF (전수 조사)', offStats, !prune, L.compact);

      // 논지 한 줄. 이 위젯이 존재하는 이유가 이 문장이다.
      var ratio = on.v > 0 ? (off.v / on.v) : 0;
      var msg = '가지치기가 방문 노드를 ' + comma(off.v) + ' → ' + comma(on.v) + ' 로 줄인다 (' +
                (ratio >= 100 ? comma(Math.round(ratio)) : (Math.round(ratio * 10) / 10)) + '배).';
      var warn = false;
      if (model.same === true) msg += ' 두 쪽이 찾은 해는 ' + comma(on.s) + '개로 같다 — 답은 그대로다.';
      else if (model.same === false) { msg += ' 해집합이 다르다 — 가지치기가 답을 잃었다.'; warn = true; }
      else msg += ' 해 ' + comma(on.s) + '개. OFF 쪽 노드 수는 전수 열거 대신 계산값이다.';
      thesis(ctx, T, L, msg, warn);
    }

    function thesis(ctx, T, L, msg, warn) {
      var font = (warn ? '700 ' : '') + '11px ' + FONT;
      ctx.font = font;
      var lines = wrapLines(ctx, msg, L.w - 16, 2);
      for (var i = 0; i < lines.length; i++) {
        text(ctx, lines[i], 8, L.headerH - 21 + i * 14, font, warn ? T.boxWarn : T.fgDim);
      }
    }

    // 지금 노드에서 뿌리까지 (재귀 스택)
    var stackMark = [];
    function markStack(idx) {
      stackMark.length = 0;
      var guard = 64, i = idx;
      while (i >= 0 && guard-- > 0) { stackMark.push(i); i = model.nodes[i].p; }
    }

    function drawTree(ctx, T, L) {
      var nodes = model.nodes;
      var shown = Math.min(cur, nodes.length - 1);
      if (cur >= nodes.length) shown = nodes.length - 1;
      var active = cur < nodes.length ? cur : -1;
      markStack(active);
      var onStack = {};
      for (var s = 0; s < stackMark.length; s++) onStack[stackMark[s]] = 1;

      var bottomY = L.treeTop + 12 + (L.levels - 1) * L.levelH;

      // 깊이 라벨. 좁으면 접두어를 떼고 숫자만 남긴다.
      var tight = L.gut < 40;
      for (var d = 0; d < L.levels; d++) {
        var lab = (problem === 'hanoi')
          ? (d === 0 ? (tight ? '0' : '호출') : (tight ? String(d) : '깊이 ' + d))
          : (problem === 'nqueens' ? (d === 0 ? (tight ? '—' : '빈 판') : (tight ? '행' + (d - 1) : '행 ' + (d - 1)))
            : problem === 'subset' ? (d === 0 ? (tight ? '—' : '시작') : (tight ? '물' + (d - 1) : '물건 ' + (d - 1)))
            : (d === 0 ? (tight ? '—' : '시작') : (tight ? '칸' + (d - 1) : '자리 ' + (d - 1))));
        ctx.globalAlpha = 0.75;
        text(ctx, lab, 4, L.treeTop + 16 + d * L.levelH, '10px ' + FONT, T.fgFaint);
        ctx.globalAlpha = 1;
      }

      // ① 간선
      ctx.lineWidth = 1;
      for (var i = 1; i <= shown; i++) {
        var nd = nodes[i];
        if (nd.p < 0 || nd.p > shown) continue;
        var pa = nodes[nd.p];
        var stacked = onStack[i] && onStack[nd.p];
        /* 잘린 간선이 굵고 붉으면 노드가 작아지는 순간(잎이 100개를 넘어가면
         * 노드는 2~3px 가 된다) 화면이 붉은 실뭉치가 되어 트리 모양이 사라진다.
         * 노드가 작을수록 간선을 흐리게 해서 잉크의 주인공을 노드에 남긴다. */
        ctx.globalAlpha = nd.kind === 'cut' ? Math.min(0.55, 0.16 + L.r * 0.1)
                                            : (stacked ? 1 : 0.5);
        ctx.strokeStyle = stacked ? T.accent : (nd.kind === 'cut' ? T.boxDanger : T.border);
        ctx.lineWidth = stacked ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y + L.r);
        ctx.lineTo(nd.x, nd.y - L.r);
        ctx.stroke();

        /* 잘린 가지는 간선 위에 이발소 표시(빗금 두 줄)를 얹는다.
         * 노드 안에 × 를 그리면 "몇 번 후보였는지" 숫자와 겹쳐 둘 다 죽는다.
         * 자르는 행위는 간선에서 일어나므로 표시도 간선에 두는 것이 맞다. */
        if (nd.kind === 'cut' && L.r >= 4) {
          var mx = (pa.x + nd.x) / 2, my = (pa.y + nd.y) / 2;
          var vx = nd.x - pa.x, vy = nd.y - pa.y;
          var len = Math.sqrt(vx * vx + vy * vy) || 1;
          var ux = vx / len, uy = vy / len;
          var px = -uy, py = ux;                    // 간선에 수직인 방향
          var sl = Math.min(5, L.r * 0.9);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.boxDanger;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          // 빗금 하나면 충분하다. 두 줄로 그으면 형제 간선이 여럿 잘릴 때
          // 화면이 붉은 낙서가 되어 정작 노드가 안 보인다.
          ctx.moveTo(mx - px * sl - ux * sl * 0.5, my - py * sl - uy * sl * 0.5);
          ctx.lineTo(mx + px * sl + ux * sl * 0.5, my + py * sl + uy * sl * 0.5);
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1;

      // ② 유령 삼각형 — 잘려서 펼치지 않은 부분트리
      /* 잎 개수 라벨이 서로 겹치면 둘 다 못 읽는다. 노드는 DFS 순서로 도므로
       * x 가 단조가 아니다 — 이미 찍은 구간을 모아 두고 겹치면 건너뛴다. */
      var taken = [];
      function freeAt(x0, x1) {
        for (var t = 0; t < taken.length; t += 2) {
          if (x0 < taken[t + 1] && x1 > taken[t]) return false;
        }
        taken.push(x0, x1);
        return true;
      }
      if (L.r >= 1.2) {
        for (var g = 0; g <= shown; g++) {
          var cn = nodes[g];
          if (cn.kind !== 'cut' || cn.skip < 2 || cn.d >= L.levels - 1) continue;
          var half = Math.min(L.slotW * 1.7, (L.levels - 1 - cn.d) * L.levelH * 0.34);
          if (half < 2.5) continue;
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = T.fgFaint;
          ctx.beginPath();
          ctx.moveTo(cn.x, cn.y + L.r);
          ctx.lineTo(cn.x - half, bottomY + 4);
          ctx.lineTo(cn.x + half, bottomY + 4);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.42;
          ctx.strokeStyle = T.fgFaint;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          if (half >= 11) {
            var lab2 = '×' + comma(cn.skip);
            ctx.font = '9px ' + FONT;
            var lw = ctx.measureText(lab2).width;
            if (freeAt(cn.x - lw / 2 - 3, cn.x + lw / 2 + 3)) {
              ctx.globalAlpha = 0.85;
              text(ctx, lab2, cn.x, bottomY + 1, '9px ' + FONT, T.fgFaint, 'center');
            }
          }
        }
      }
      ctx.globalAlpha = 1;

      // ③ 노드
      for (var k = 0; k <= shown; k++) drawNode(ctx, T, L, nodes[k], k === active, !!onStack[k]);

      // 잘려서 못 그린 부분을 밑줄로 알린다. 제목에도 적지만, 그림 안에서도
      // "여기서 끊겼다"가 보여야 트리 모양을 오해하지 않는다.
      if (model.truncated && cur >= nodes.length - 1) {
        ctx.globalAlpha = 0.9;
        text(ctx, '⋯ 여기까지만 그렸다. 전체 ' + comma(model.total) + '개 노드 중 ' +
                  comma(nodes.length) + '개.',
             L.gut, bottomY + 20, '10px ' + FONT, T.fgFaint);
        ctx.globalAlpha = 1;
      }
    }

    function drawNode(ctx, T, L, nd, isCur, stacked) {
      var r = L.r, x = nd.x, y = nd.y;
      ctx.globalAlpha = 1;

      if (nd.kind === 'cut') {
        // 잘린 노드: 사각형(원과 모양으로 갈린다, 계약 §5). × 는 간선 위에 있다.
        // 아무리 촘촘해도 2.2px 아래로는 줄이지 않는다 — 이 위젯의 주인공이라
        // 사라지면 안 된다.
        var cr = Math.max(r, 2.2);
        ctx.fillStyle = T.boxDanger;
        ctx.globalAlpha = 0.92;
        ctx.fillRect(x - cr, y - cr, cr * 2, cr * 2);
        ctx.globalAlpha = 1;
        if (r >= 2.5 && r < 4) {
          // 너무 작아 간선 표시가 안 보이는 크기에서는 노드에 직접 × 를 긋는다.
          ctx.strokeStyle = T.bg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
          ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
          ctx.stroke();
        }
      } else if (nd.kind === 'fail') {
        /* 다크 테마에서 --w-wall 은 배경보다 겨우 한 단계 밝다. 잎까지 갔다가
         * 실패한 노드는 가지치기를 껐을 때 수백 개가 깔리는데, 그것들이 배경에
         * 묻히면 "헛일한 잎" 이라는 이 위젯의 두 번째 논지가 통째로 사라진다.
         * 글자색 계열로 테두리를 둘러 두 테마 모두에서 보이게 한다. */
        var fr = Math.max(r * 0.85, 1.6);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = T.wWall;
        ctx.fillRect(x - fr, y - fr, fr * 2, fr * 2);
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = T.fgFaint;
        ctx.strokeRect(x - fr + 0.5, y - fr + 0.5, fr * 2 - 1, fr * 2 - 1);
        ctx.globalAlpha = 1;
      } else if (nd.kind === 'sol' || nd.kind === 'base') {
        // 마름모 = 확정. 금색은 "확정" 전용이라 여기서만 쓴다.
        ctx.fillStyle = T.wPath;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y);
        ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = T.wVisited;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.border;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.2832);
        ctx.stroke();
      }

      if (stacked || isCur) {
        ctx.strokeStyle = T.accent;
        ctx.lineWidth = isCur ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + (isCur ? 3.5 : 2), 0, 6.2832);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // 글자는 자리가 있을 때만. 뭉개진 글자는 없는 것만 못하다.
      if (r >= 5.5 && nd.txt) {
        var fs = Math.max(8, Math.min(Math.round(r * 1.15), 13));
        var col = (nd.kind === 'sol' || nd.kind === 'base') ? T.bg
                : (nd.kind === 'cut' ? T.bg : T.fg);
        ctx.font = '700 ' + fs + 'px ' + FONT;
        if (ctx.measureText(nd.txt).width <= r * 2.1) {
          text(ctx, nd.txt, x, y + fs * 0.36, '700 ' + fs + 'px ' + FONT, col, 'center');
        }
      }
    }

    // ---- 현재 상태 패널 ----
    //
    // 트리만 있으면 "이 노드가 무슨 상태인가"를 독자가 머리로 복원해야 한다.
    // 퀸은 판을, 부분집합은 고른 물건과 합을, 순열은 자리를 그대로 보여 준다.

    function pathOf(idx) {
      var p = [], guard = 64, i = idx;
      while (i > 0 && guard-- > 0) { p.push(model.nodes[i]); i = model.nodes[i].p; }
      p.reverse();
      return p;
    }

    function drawSide(ctx, T, L) {
      var x = L.w - L.side - 4, y = L.treeTop, w = L.side, h = L.height - L.treeTop - 8;
      ctx.globalAlpha = 1;
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = T.border;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      var idx = cur < model.nodes.length ? cur : model.nodes.length - 1;
      var nd = model.nodes[idx];
      var path = pathOf(idx);
      text(ctx, cur < model.nodes.length ? '지금 상태' : '탐색 종료', x + 8, y + 16,
           '700 11px ' + FONT, T.fgDim);

      if (problem === 'nqueens') drawBoard(ctx, T, x, y, w, nd, path);
      else if (problem === 'subset') drawItems(ctx, T, x, y, w, nd, path);
      else if (problem === 'permutation') drawSlots(ctx, T, x, y, w, nd, path);
      else drawCalls(ctx, T, x, y, w, nd, path);
    }

    function drawBoard(ctx, T, x, y, w, nd, path) {
      var cell = Math.min(20, Math.floor((w - 24) / n));
      var bx = x + Math.floor((w - cell * n) / 2), by = y + 26;
      var cols = [], cutRow = -1, cutCol = -1;
      for (var i = 0; i < path.length; i++) {
        if (path[i].kind === 'cut') { cutRow = path[i].d - 1; cutCol = path[i].cv; }
        else cols.push(path[i].cv);
      }
      // 탐색이 끝난 뒤에는 첫 번째 해를 보여 준다 — 결국 무엇을 찾았는지가 남아야 한다.
      var showSol = (cur >= model.nodes.length && model.solList && model.solList.length);
      if (showSol) {
        cols = model.solList[0].split('-');
        for (var q = 0; q < cols.length; q++) cols[q] = parseInt(cols[q], 10);
        cutRow = -1;
      }

      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          ctx.fillStyle = ((r + c) % 2) ? T.bgCode : T.bg;
          ctx.fillRect(bx + c * cell, by + r * cell, cell, cell);
        }
      }
      // 놓인 퀸
      for (var rr = 0; rr < cols.length && rr < n; rr++) {
        var qx = bx + cols[rr] * cell, qy = by + rr * cell;
        ctx.fillStyle = showSol ? T.wPath : T.wVisited;
        ctx.fillRect(qx + 1, qy + 1, cell - 2, cell - 2);
        if (cell >= 12) {
          text(ctx, 'Q', qx + cell / 2, qy + cell * 0.72, '700 ' + Math.round(cell * 0.62) + 'px ' + FONT, T.bg, 'center');
        }
      }
      // 시도했다가 잘린 칸 + 부딪힌 퀸
      if (cutRow >= 0) {
        ctx.fillStyle = T.boxDanger;
        ctx.fillRect(bx + cutCol * cell + 1, by + cutRow * cell + 1, cell - 2, cell - 2);
        if (cell >= 12) {
          text(ctx, '×', bx + cutCol * cell + cell / 2, by + cutRow * cell + cell * 0.74,
               '700 ' + Math.round(cell * 0.7) + 'px ' + FONT, T.bg, 'center');
        }
        if (nd.wrow >= 0 && nd.wrow < cols.length) {
          ctx.strokeStyle = T.boxWarn;
          ctx.lineWidth = 2;
          ctx.strokeRect(bx + cols[nd.wrow] * cell + 1, by + nd.wrow * cell + 1, cell - 2, cell - 2);
          ctx.lineWidth = 1;
        }
      }
      ctx.strokeStyle = T.border;
      ctx.strokeRect(bx + 0.5, by + 0.5, cell * n - 1, cell * n - 1);

      var ty = by + cell * n + 16;
      text(ctx, showSol ? ('해 ' + model.solList[0]) : ('놓은 퀸 ' + cols.length + '개'),
           x + 8, ty, '11px ' + FONT, showSol ? T.wPath : T.fgDim);
      if (cutRow >= 0) {
        text(ctx, '× 행 ' + cutRow + ' 열 ' + cutCol + ' 은 못 놓는다', x + 8, ty + 15, '11px ' + FONT, T.boxDanger);
      }
    }

    function drawItems(ctx, T, x, y, w, nd, path) {
      var sum = 0, ty = y + 30;
      for (var i = 0; i < items.length; i++) {
        var st = 0;   // 0 미정 1 넣음 2 건너뜀 3 잘림
        if (i < path.length) {
          var p = path[i];
          st = (p.kind === 'cut') ? 3 : (p.cv ? 1 : 2);
          if (p.cv && p.kind !== 'cut') sum += items[i];
        }
        var bx = x + 10, bw = w - 20, bh = 15;
        ctx.fillStyle = st === 1 ? T.wVisited : (st === 3 ? T.boxDanger : T.bg);
        ctx.globalAlpha = st === 2 ? 0.35 : 1;
        ctx.fillRect(bx, ty - 11, bw, bh);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.border;
        ctx.strokeRect(bx + 0.5, ty - 10.5, bw - 1, bh - 1);
        text(ctx, '물건 ' + i + ' · 무게 ' + items[i], bx + 5, ty,
             '10px ' + FONT, (st === 1 || st === 3) ? T.bg : T.fgDim);
        text(ctx, st === 1 ? '넣음' : (st === 2 ? '건너뜀' : (st === 3 ? '초과 ×' : '—')),
             bx + bw - 5, ty, '10px ' + FONT, (st === 1 || st === 3) ? T.bg : T.fgFaint, 'right');
        ty += bh + 3;
      }
      text(ctx, '합 ' + sum + ' / 목표 ' + target, x + 10, ty + 12, '700 12px ' + FONT,
           sum === target ? T.wPath : T.fgDim);
      // 목표 대비 막대. 넘치면 붉게 — 가지치기의 근거가 그림으로도 읽힌다.
      var bw2 = w - 20, ratio = Math.min(1, sum / target);
      ctx.fillStyle = T.bgCode;
      ctx.fillRect(x + 10, ty + 18, bw2, 6);
      ctx.fillStyle = sum > target ? T.boxDanger : (sum === target ? T.wPath : T.wVisited);
      ctx.fillRect(x + 10, ty + 18, Math.max(1, bw2 * ratio), 6);
    }

    function drawSlots(ctx, T, x, y, w, nd, path) {
      var cell = Math.min(26, Math.floor((w - 24) / n));
      var bx = x + 10, by = y + 34;
      for (var i = 0; i < n; i++) {
        var v = null, cut = false;
        if (i < path.length) { v = path[i].cv; cut = path[i].kind === 'cut'; }
        ctx.fillStyle = v == null ? T.bg : (cut ? T.boxDanger : T.wVisited);
        ctx.fillRect(bx + i * cell, by, cell - 2, cell - 2);
        ctx.strokeStyle = T.border;
        ctx.strokeRect(bx + i * cell + 0.5, by + 0.5, cell - 3, cell - 3);
        if (v != null) {
          text(ctx, String(v), bx + i * cell + (cell - 2) / 2, by + cell * 0.68,
               '700 ' + Math.round(cell * 0.5) + 'px ' + FONT, T.bg, 'center');
        }
        text(ctx, String(i), bx + i * cell + (cell - 2) / 2, by + cell + 12,
             '9px ' + FONT, T.fgFaint, 'center');
      }
      text(ctx, '자리 ↑ / 값 ↓', x + 10, by + cell + 30, '10px ' + FONT, T.fgFaint);
    }

    function drawCalls(ctx, T, x, y, w, nd, path) {
      var ty = y + 32;
      text(ctx, 'hanoi(' + n + ', A→C)', x + 10, ty, '11px ' + FONT, T.fgDim);
      for (var i = 0; i < path.length && i < 8; i++) {
        ty += 16;
        var p = path[i];
        text(ctx, '└ hanoi(' + p.cv + ', ' + (p.arrow || '') + ')',
             x + 10 + (i + 1) * 7, ty, '11px ' + FONT,
             p.kind === 'base' ? T.wPath : (i === path.length - 1 ? T.accent : T.fgFaint));
      }
      ty += 24;
      text(ctx, '지금 스택 깊이 ' + path.length, x + 10, ty, '11px ' + FONT, T.fgDim);
      text(ctx, '한 노드에서 보이는 것은', x + 10, ty + 18, '10px ' + FONT, T.fgFaint);
      text(ctx, '자기 자신과 자식 둘뿐이다.', x + 10, ty + 31, '10px ' + FONT, T.fgFaint);
    }

    // ---- 캔버스 ----
    function draw(ctx, size, T) {
      var L = layoutFor(size.w);
      ctx.textBaseline = 'alphabetic';
      drawHeader(ctx, T, L);
      drawTree(ctx, T, L);
      if (L.side) drawSide(ctx, T, L);
      ctx.globalAlpha = 1;
    }

    var canvas = K.canvas(ui.stage, {
      height: function (w) { return layoutFor(w).height; },
      draw: draw
    });

    // ---- 상태 줄 ----
    function solText() {
      var list = model.solList || [];
      if (!list.length) return '해가 없다.';
      var head = list.slice(0, 10).join(', ');
      return '해 ' + comma(model.sols) + '개: ' + head + (list.length > 10 ? ' 외 ' + (list.length - 10) + '개' : '') + '.';
    }

    function label(i) {
      var nodes = model.nodes;
      if (i < nodes.length) {
        var nd = nodes[i];
        var vis = model.cVis[i + 1], cutn = model.cCut[i + 1], sol = model.cSol[i + 1];
        var s = nd.say || '';
        if (problem === 'hanoi') {
          return s + '  ▸ 지금까지 호출 ' + comma(vis) + '개, 기저 ' + comma(sol) +
                 '개, 실제로 옮긴 원반 ' + comma(model.cMov[i + 1]) + '개.';
        }
        return s + '  ▸ 지금까지 방문 ' + comma(vis) + '개, 잘림 ' + comma(cutn) +
               '개, 해 ' + comma(sol) + '개. (가지치기 ' + (prune ? 'ON' : 'OFF') + ')';
      }
      // 마지막 스텝 — 결론. 두 모드의 총계를 한 문장에 나란히 둔다.
      if (problem === 'hanoi') {
        return '탐색 종료. hanoi(' + n + ') 는 호출 ' + comma(model.visited) + '개, 그중 기저 h0 가 ' +
               comma(model.sols) + '개, 실제로 옮긴 원반이 ' + comma(model.moves) + '개다. ' +
               '호출 수는 2^' + (n + 1) + ' − 1 이고 원반이 하나 늘 때마다 두 배가 된다.';
      }
      var me = { v: model.visited, c: model.pruned, s: model.sols };
      var ot = { v: model.other.visited, c: model.other.pruned, s: model.other.sols };
      var on = prune ? me : ot, off = prune ? ot : me;
      var ratio = on.v > 0 ? Math.round((off.v / on.v) * 10) / 10 : 0;
      var s2 = '탐색 종료. 가지치기 ON — 방문 ' + comma(on.v) + '개, 잘림 ' + comma(on.c) +
               '개, 해 ' + comma(on.s) + '개. 가지치기 OFF — 방문 ' + comma(off.v) +
               '개, 잘림 ' + comma(off.c) + '개, 해 ' + comma(off.s) + '개. ' +
               'ON 이 ' + (ratio >= 100 ? comma(Math.round(ratio)) : ratio) + '배 적게 펼친다. ';
      if (model.same === true) s2 += '두 쪽이 찾은 해는 같다. ';
      else if (model.same === false) s2 += '해집합이 다르다 — 가지치기가 답을 잃었다. ';
      else s2 += 'OFF 쪽은 전수 열거 대신 계산값이다. ';
      s2 += solText();
      if (model.truncated) {
        s2 += ' (그림은 앞 ' + comma(model.nodes.length) + '개 노드까지만이다.)';
      }
      return s2;
    }

    // ---- 재생기 ----
    player = K.player(ui, {
      total: function () { return model.nodes.length + 1; },
      render: function (i) { cur = i; canvas.redraw(); },
      label: label
    });

    /* 폭이 바뀌면 그릴 수 있는 노드 수 자체가 달라진다(TIERS). 캔버스의
     * ResizeObserver 는 다시 그리기만 하므로, 모델을 다시 만들 관측자를 따로 둔다.
     * 같은 폭에서는 절대 다시 만들지 않는다 — 되감기가 흔들리면 안 된다(계약 §7). */
    function syncCap() {
      var w = ui.stage.clientWidth || 320;
      var want = capFor(w);
      if (want === cap) return;
      cap = want;
      rebuild();
      syncTitle();
      player.goto(Math.min(cur, model.nodes.length));
    }

    if (typeof ResizeObserver === 'function') {
      var pending = false;
      new ResizeObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; syncCap(); });
      }).observe(ui.stage);
    } else {
      window.addEventListener('resize', syncCap);
    }

    syncCap();
    syncTitle();
    player.goto(0);
  });
})();

/* ==== binary-search-bounds.js ==== */
/* binary-search-bounds.js — 오프바이원이 어디서 태어나는가
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **이분 탐색의 정확성은 불변식 하나가, 종료는 측도 하나가 담당한다.**
 *   불변식은 "답은 항상 [lo, hi) 안에 있다"이고 측도는 폭 `hi - lo` 다.
 *   두 문장 중 하나라도 깨지면 이분 탐색은 틀린 답을 내거나 영원히 돈다.
 *
 * 그래서 이 위젯의 중심은 배열 그림이 아니라 **폭 열**이다.
 *   배열 위에서 절반이 지워지는 그림은 예쁘지만, 독자가 실제로 틀리는 지점은
 *   거기가 아니다. `while (lo < hi)` 를 `<=` 로 쓰거나 `lo = mid + 1` 을
 *   `lo = mid` 로 쓰는 순간 폭이 1에서 멈춘다 — 그 정지를 눈으로 봐야
 *   "왜 +1 이 붙는가"가 관용구가 아니라 근거가 된다. 그래서 변형 탭에
 *   무한 루프판(`lo = mid`)을 일부러 넣었고, 폭이 줄지 않는 순간 그 열이
 *   빨갛게 굳는다.
 *
 * 왜 세 변형을 한 위젯에 넣는가
 *   반열림 `[lo, hi)` 와 닫힘 `[lo, hi]` 는 같은 알고리즘의 다른 표기이고,
 *   초기값·루프 조건·갱신·반환이 **네 개가 한 세트로** 바뀐다. 하나만 바꾸면
 *   깨진다. 탭으로 갈아 끼워 네 줄이 동시에 바뀌는 것을 보여 주는 편이
 *   "닫힘 구간에서는 hi = n-1 로 시작한다"를 글로 열 줄 쓰는 것보다 짧다.
 *
 * 왜 pair 모드가 따로 있는가
 *   lower_bound 와 upper_bound 는 **술어 한 글자**만 다르다(`>=` vs `>`).
 *   나란히 재생해 나머지 세 줄이 글자 하나 다르지 않다는 것을 보이면,
 *   둘을 외울 필요가 없고 개수는 두 경계의 뺄셈이라는 것이 따라 나온다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  var MAX_N = 24;        // 이보다 많으면 400px 폭에서 칸 글자가 뭉갠다
  var MAX_STEPS = 400;   // 계약 §7
  var STALL_ROWS = 4;    // 정체를 보여 주기에 네 줄이면 충분하다. 그 뒤는 같은 줄의 반복일 뿐이다

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  // ─── 변형 ────────────────────────────────────────────────────────────────
  //
  // 초기값·루프 조건·갱신·반환은 한 세트다. 하나만 바꾸면 깨지므로 통째로 묶어 둔다.

  var VARIANTS = {
    'half-open': {
      label: '반열림 [lo, hi)',
      loop: 'lo < hi',
      init: 'lo = 0, hi = n',
      updT: 'hi = mid',
      updF: 'lo = mid + 1',
      ret: 'lo',
      invariant: '답은 항상 구간 [lo, hi) 안에 있다',
      note: '폭 hi - lo 는 매 스텝 최소 1 줄어든다'
    },
    closed: {
      label: '닫힘 [lo, hi]',
      loop: 'lo <= hi',
      init: 'lo = 0, hi = n-1, ans = n',
      updT: 'ans = mid; hi = mid - 1',
      updF: 'lo = mid + 1',
      ret: 'ans',
      invariant: '답 후보는 항상 구간 [lo, hi] 안에 있고, 지금까지 본 최선은 ans 다',
      note: '구간이 비면(lo > hi) 끝난다. 답은 ans 에 따로 적어 둔다'
    },
    stall: {
      label: '무한 루프 (lo = mid)',
      loop: 'lo < hi',
      init: 'lo = 0, hi = n',
      updT: 'hi = mid',
      updF: 'lo = mid',
      ret: 'lo',
      invariant: '불변식은 그대로다 — 깨진 것은 측도다',
      note: '+1 이 빠지면 폭이 1에서 멈춘다. mid 가 내림이므로 mid == lo 가 되고 갱신이 아무것도 바꾸지 않는다',
      broken: true
    }
  };

  var VARIANT_ALIAS = {
    'half-open': 'half-open', halfopen: 'half-open', half: 'half-open',
    'left-closed': 'half-open', 반열림: 'half-open',
    closed: 'closed', 'fully-closed': 'closed', 닫힘: 'closed',
    stall: 'stall', broken: 'stall', infinite: 'stall', 무한: 'stall'
  };

  // ─── 술어 ────────────────────────────────────────────────────────────────
  //
  // opts 는 술어를 사람이 읽는 문자열로 준다("a[mid] >= target").
  // 파서를 만들 일이 아니다 — 이 위젯이 다루는 술어는 두 종류뿐이고,
  // 그 둘의 차이가 곧 lower_bound 와 upper_bound 의 차이다.

  var PREDS = {
    ge: { src: 'a[mid] >= target', fn: function (v, t) { return v >= t; }, goal: 'lower_bound' },
    gt: { src: 'a[mid] > target', fn: function (v, t) { return v > t; }, goal: 'upper_bound' }
  };

  function predOf(spec) {
    var s = String(spec == null ? '' : spec);
    if (/>=/.test(s) || /lower/i.test(s) || /bisect_left/i.test(s)) return PREDS.ge;
    if (/>/.test(s) || /upper/i.test(s) || /bisect_right/i.test(s)) return PREDS.gt;
    return PREDS.ge;
  }

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function toNums(v, dflt) {
    if (!isArr(v)) return dflt.slice();
    var out = [];
    for (var i = 0; i < v.length && out.length < MAX_N; i++) {
      var x = v[i];
      if (typeof x === 'string' && x.trim() !== '') x = Number(x);
      if (typeof x === 'number' && isFinite(x)) out.push(Math.round(x));
    }
    return out.length ? out : dflt.slice();
  }

  function toInt(v, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    return isFinite(n) ? Math.round(n) : dflt;
  }

  function truthy(v, dflt) { return v === undefined || v === null ? dflt : !!v; }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 캔버스에는 줄바꿈이 없다. 불변식 문장이 화면 밖으로 나가면 위젯의 본문이 사라진다.
  function wrap(ctx, text, maxW) {
    var words = String(text).split(' ');
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; }
      else { cur = t; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ─── 계산 ────────────────────────────────────────────────────────────────
  //
  // 상태를 전부 미리 만든다. 되감기가 결정적이어야 하므로 그리는 쪽에서
  // 계산하는 일이 없어야 한다(런타임 주석 참조).

  /* 한 스텝 = 반복 한 번. 상태는 **반복 시작 시점의 구간**을 담고,
   * 그 반복이 버릴 절반을 따로 표시한다. 다음 상태에서 실제로 줄어든 구간이 보인다. */
  function solve(a, target, variantId, pred) {
    var V = VARIANTS[variantId] || VARIANTS['half-open'];
    var n = a.length;
    var closed = variantId === 'closed';

    var lo = 0;
    var hi = closed ? n - 1 : n;
    var ans = closed ? n : null;

    var states = [];
    var rows = [];
    var stalled = false;
    var guard = 0;

    // 스텝 0 — 아직 mid 를 고르지 않은 초기 구간
    states.push({ lo: lo, hi: hi, mid: null, ans: ans, phase: 'init', rows: 0 });

    while (guard < MAX_STEPS) {
      var alive = closed ? (lo <= hi) : (lo < hi);
      if (!alive) break;

      var mid = lo + Math.floor((hi - lo) / 2);
      var amid = a[mid];
      var p = pred.fn(amid, target);

      var pLo = lo, pHi = hi;
      var kill;   // 이번 반복이 버리는 구간 [from, to)

      if (closed) {
        if (p) { ans = mid; kill = [mid, hi + 1]; hi = mid - 1; }
        else { kill = [lo, mid + 1]; lo = mid + 1; }
      } else {
        if (p) { kill = [mid, hi]; hi = mid; }
        else if (V.broken) { kill = [lo, mid]; lo = mid; }
        else { kill = [lo, mid + 1]; lo = mid + 1; }
      }

      var frozen = (lo === pLo && hi === pHi);
      if (frozen) stalled = true;

      rows.push({
        step: rows.length + 1,
        lo: pLo, hi: pHi,
        width: closed ? (pHi - pLo + 1) : (pHi - pLo),
        mid: mid, amid: amid, p: p,
        update: p ? V.updT : V.updF,
        kill: kill,
        frozen: frozen
      });

      states.push({
        lo: pLo, hi: pHi, mid: mid, amid: amid, p: p, ans: ans,
        kill: kill, phase: 'test', rows: rows.length, frozen: frozen
      });

      guard += 1;

      // 정체는 네 줄이면 충분히 보인다. 그 뒤는 같은 줄의 무한 반복이라
      // 스텝만 늘고 배우는 것이 없다.
      if (stalled && rows.length >= STALL_ROWS) break;
    }

    var ret = closed ? ans : lo;
    states.push({
      lo: lo, hi: hi, mid: null, ans: ans, phase: stalled ? 'stall' : 'done',
      rows: rows.length, ret: ret
    });

    return { states: states, rows: rows, ret: ret, stalled: stalled, closed: closed, variant: V };
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('binary-search-bounds', function (host, opts) {
    var dfltArray = [10, 20, 20, 30, 40, 50, 60];

    var a = toNums(opts.array, dfltArray).slice().sort(function (x, y) { return x - y; });
    var target = toInt(opts.target, 35);

    var pairMode = String(opts.mode || '') === 'pair' || isArr(opts.goals);
    var show = opts.show || {};
    var controls = opts.controls || {};

    var wantWindow = truthy(show.window, true);
    var wantDiscarded = truthy(show.discarded, true);
    var wantInvariant = truthy(show.invariant, true);
    var wantMeasure = truthy(show.measure, true);
    var wantSegments = pairMode && truthy(show.segments, true);
    var wantBadge = pairMode && truthy(show.countBadge, true);
    var stallDetect = truthy(opts.stallDetect, true);

    // 목표(술어) — 단일이면 하나, pair 면 둘을 나란히 돌린다.
    var goals;
    if (pairMode) {
      var g = isArr(opts.goals) ? opts.goals : [];
      goals = [
        { id: 'lower', label: (g[0] && g[0].label) || 'lower_bound', pred: predOf((g[0] && g[0].predicate) || 'a[mid] >= target') },
        { id: 'upper', label: (g[1] && g[1].label) || 'upper_bound', pred: predOf((g[1] && g[1].predicate) || 'a[mid] > target') }
      ];
    } else {
      var p0 = predOf(opts.predicate || opts.goal || 'a[mid] >= target');
      goals = [{ id: 'single', label: p0.goal, pred: p0 }];
    }

    // 변형 탭 — pair 모드에서는 두 탐색을 비교하는 것이 주제이므로 변형을 고정한다.
    var variantIds = [];
    if (!pairMode) {
      if (isArr(opts.variants)) {
        for (var vi = 0; vi < opts.variants.length; vi++) {
          var id = VARIANT_ALIAS[String((opts.variants[vi] || {}).id || '').toLowerCase()];
          if (id && variantIds.indexOf(id) < 0) variantIds.push(id);
        }
      }
      if (!variantIds.length) {
        var only = VARIANT_ALIAS[String(opts.interval || 'half-open').toLowerCase()] || 'half-open';
        variantIds = [only];
      }
      if (!stallDetect) {
        variantIds = variantIds.filter(function (x) { return x !== 'stall'; });
        if (!variantIds.length) variantIds = ['half-open'];
      }
    } else {
      variantIds = [VARIANT_ALIAS[String(opts.interval || 'half-open').toLowerCase()] || 'half-open'];
    }

    var variant = variantIds[0];
    var runs = [];      // goals 와 같은 길이
    var cur = 0;
    var play = null;

    function rebuild() {
      runs = goals.map(function (g) { return solve(a, target, variant, g.pred); });
    }

    function totalSteps() {
      var m = 0;
      for (var i = 0; i < runs.length; i++) m = Math.max(m, runs[i].states.length);
      return m;
    }

    // 각 탐색은 자기 길이에서 멈춘다. 짧게 끝난 쪽이 먼저 굳는 것이 실제 동작이다.
    function stateOf(r, i) {
      return r.states[Math.min(i, r.states.length - 1)];
    }

    rebuild();

    var title = pairMode
      ? 'lower_bound 와 upper_bound — 술어 한 글자의 차이'
      : '이분 탐색의 경계 — 불변식 하나, 측도 하나';

    var ui = K.frame(host, { title: title });

    // ── 컨트롤 (제목 우측 슬롯) ────────────────────────────────────────────

    var variantSeg = null;
    if (variantIds.length > 1) {
      variantSeg = K.seg(ui.slot, variantIds.map(function (id) {
        return { label: VARIANTS[id].label, value: id };
      }), variant, function (v) {
        variant = v;
        rebuild();
        play.goto(0);
      });
    }

    if (truthy(controls.editTarget, true)) {
      var tWrap = K.el('label', 'wk-field');
      tWrap.appendChild(K.el('span', null, 'target'));
      var tIn = K.el('input', 'wk-num');
      tIn.type = 'number';
      tIn.value = String(target);
      tIn.setAttribute('aria-label', '찾는 값');
      tIn.addEventListener('change', function () {
        target = toInt(tIn.value, target);
        tIn.value = String(target);
        rebuild();
        play.goto(0);
      });
      tWrap.appendChild(tIn);
      ui.slot.appendChild(tWrap);
    }

    if (truthy(controls.editArray, true)) {
      var aWrap = K.el('label', 'wk-field');
      aWrap.appendChild(K.el('span', null, '배열'));
      var aIn = K.el('input', 'wk-text');
      aIn.type = 'text';
      aIn.value = a.join(' ');
      aIn.setAttribute('aria-label', '배열 (공백 구분, 자동 정렬)');
      aIn.addEventListener('change', function () {
        // 이분 탐색의 전제는 정렬이다. 입력이 흐트러져 있으면 조용히 정렬한다 —
        // 정렬되지 않은 입력으로 "이분 탐색이 틀렸다"를 보여 주는 것은 이 위젯의 주제가 아니다.
        var parsed = toNums(aIn.value.split(/[\s,]+/), a);
        a = parsed.slice().sort(function (x, y) { return x - y; });
        aIn.value = a.join(' ');
        rebuild();
        play.goto(0);
      });
      aWrap.appendChild(aIn);
      ui.slot.appendChild(aWrap);
    }

    // ── 레이아웃 ───────────────────────────────────────────────────────────

    var PAD = 12;
    var CELL_MAX = 46;
    var CELL_MIN = 20;
    var ROW_H = 22;
    var TABLE_MAX = 680;   // 넓은 화면에서 표를 화면 폭만큼 늘리면 열 사이가 벌어져 오히려 안 읽힌다

    function layout(w) {
      var inner = Math.max(200, w - PAD * 2);
      var cw = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(inner / a.length)));
      var gridW = cw * a.length;
      var narrow = w < 560;

      var cols = activeColumns(narrow);
      var maxRows = 0;
      for (var i = 0; i < runs.length; i++) maxRows = Math.max(maxRows, runs[i].rows.length);

      var invH = wantInvariant ? measureInvariant(inner) : 0;
      var searchH = 18 + 16 + cw + 34;    // 제목 + 인덱스 + 칸 + 포인터 두 줄
      // pair 모드는 표도 둘이다 — 술어 열만 다르고 나머지가 같다는 것이 이 위젯의 논지다
      var tableH = runs.length * ((maxRows + 1) * ROW_H + 24);
      var segH = wantSegments ? 46 : 0;
      var footH = 34;

      return {
        w: w, inner: inner, cw: cw, gridW: gridW, narrow: narrow, cols: cols,
        // 왼쪽 정렬로 통일한다. 배열만 가운데 두면 표·불변식이 배열 폭에 끌려가 좁아진다.
        x0: PAD,
        tableW: Math.max(300, Math.min(TABLE_MAX, inner)),
        invH: invH, searchH: searchH, tableH: tableH, segH: segH, footH: footH,
        height: PAD + invH + runs.length * searchH + segH + tableH + footH + PAD
      };
    }

    // 불변식 문장은 폭에 따라 줄 수가 달라진다. 추정하면 아래가 텅 비거나 잘린다.
    var measCv = null;
    function measureInvariant(inner) {
      if (!measCv) measCv = document.createElement('canvas').getContext('2d');
      measCv.font = '12px ' + FONT;
      var V = (runs[0] && runs[0].variant) || VARIANTS['half-open'];
      var head = '불변식: ' + invariantText(V);
      var h = wrap(measCv, head, inner).length * 15 + 2;
      if (wantMeasure) h += wrap(measCv, '측도: ' + (V.note || ''), inner).length * 15;
      return h + 8;
    }

    function invariantText(V) {
      return (typeof show.invariant === 'string' && runs.length === 1) ? show.invariant : V.invariant;
    }

    // 좁은 폭에서는 열을 줄인다. 폭 열은 이 위젯의 중심이므로 마지막까지 남긴다.
    function activeColumns(narrow) {
      var want = isArr(opts.columns) ? opts.columns.map(String) : null;
      var all = ['step', 'lo', 'hi', 'width', 'mid', 'a[mid]', 'p(mid)', 'update'];
      var cols = want || all;
      cols = cols.filter(function (c) { return all.indexOf(c) >= 0; });
      if (!cols.length) cols = all;
      if (!wantMeasure) cols = cols.filter(function (c) { return c !== 'width'; });
      if (narrow) {
        var keep = ['step', 'lo', 'hi', 'width', 'mid', 'p(mid)'];
        cols = cols.filter(function (c) { return keep.indexOf(c) >= 0; });
      }
      return cols;
    }

    // ── 그리기 ─────────────────────────────────────────────────────────────

    function cell(ctx, T, x, y, w, h, text, st) {
      ctx.save();
      rrect(ctx, x + 1, y + 1, w - 2, h - 2, 4);
      // 살아 있는 구간은 옅게, mid 와 답은 꽉 차게 칠한다. 다크 테마에서
      // --accent 와 --w-frontier 는 색상이 가까워 같은 농도로 칠하면 mid 가 묻힌다.
      ctx.globalAlpha = (st.alpha == null ? 1 : st.alpha);
      ctx.fillStyle = st.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (st.stroke) {
        ctx.lineWidth = st.thick ? 2 : 1;
        ctx.strokeStyle = st.stroke;
        ctx.stroke();
      }
      ctx.fillStyle = st.text;
      ctx.font = (st.bold ? '600 ' : '') + Math.max(10, Math.min(14, Math.floor(w * 0.36))) + 'px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(text), x + w / 2, y + h / 2 + 0.5);
      if (st.strike) {
        ctx.strokeStyle = st.text;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 5, y + h / 2);
        ctx.lineTo(x + w - 5, y + h / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function pointerMark(ctx, T, x, w, y, name, color) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2 - 4, y + 6);
      ctx.lineTo(x + w / 2 + 4, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.font = '600 10px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(name, x + w / 2, y + 7);
      ctx.restore();
    }

    function drawSearch(ctx, T, l, r, g, st, y) {
      var n = a.length;
      var closed = r.closed;
      var hiEx = closed ? st.hi + 1 : st.hi;    // 그림은 항상 반열림으로 통일해 그린다

      // 제목 줄
      ctx.save();
      ctx.font = '600 12px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = T.fg;
      var head = g.label;
      if (runs.length > 1) head += '  ·  술어 ' + g.pred.src;
      ctx.fillText(head, l.x0, y);
      ctx.restore();
      y += 18;

      // 인덱스 줄
      ctx.save();
      ctx.font = '10px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = T.fgFaint;
      for (var i = 0; i < n; i++) {
        ctx.fillText(String(i), l.x0 + i * l.cw + l.cw / 2, y);
      }
      ctx.restore();
      y += 16;

      // 칸
      // 끝난 뒤에는 구간이 비어 있다. 그때 "살아 있지 않은 칸"을 전부 지우면 배열이
      // 통째로 사라져 결론(경계가 어디인가)이 안 보인다. 종료 상태는 중립으로 그린다.
      var ended = (st.phase === 'done' || st.phase === 'stall');
      for (var j = 0; j < n; j++) {
        var live = ended ? false : (wantWindow ? (j >= st.lo && j < hiEx) : true);
        var willKill = !ended && st.kill && j >= st.kill[0] && j < st.kill[1];
        var isMid = !ended && st.mid === j;
        var isRet = (st.phase === 'done') && st.ret === j;

        var style = {
          fill: T.bgElev, text: ended ? T.fgDim : T.fgFaint, stroke: T.border,
          strike: false, bold: false, thick: false, alpha: 1
        };
        if (live) {
          style.fill = T.wFrontier;
          style.text = T.fg;
          style.stroke = T.border;
          style.alpha = 0.32;
        } else if (wantDiscarded && !ended) {
          style.strike = true;
        }
        if (willKill && live) {
          style.fill = T.boxDanger;
          style.text = T.fg;
          style.alpha = 0.42;
        }
        if (isMid) {
          style.fill = T.accent;
          style.text = T.bg;
          style.bold = true;
          style.stroke = T.accent;
          style.thick = true;
        }
        if (isRet) {
          style.fill = T.wPath;
          style.text = T.bg;
          style.bold = true;
          style.thick = true;
          style.stroke = T.wPath;
        }
        cell(ctx, T, l.x0 + j * l.cw, y, l.cw, l.cw, a[j], style);
      }

      // 반환 위치가 배열 밖(= n)일 때도 보여 줘야 한다. 경계는 n 을 정당한 답으로 갖는다.
      if (st.phase === 'done' && st.ret === n) {
        ctx.save();
        ctx.font = '600 11px ' + MONO;
        ctx.fillStyle = T.wPath;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('↳ ' + n, l.x0 + n * l.cw + 4, y + l.cw / 2);
        ctx.restore();
      }
      y += l.cw;

      // 포인터. mid 는 윗줄, lo·hi 는 아랫줄에 찍어 겹치지 않게 한다.
      // lo == hi 는 종료 순간에 반드시 일어나므로(그것이 종료 조건이다) 그때도
      // 두 이름이 다 읽혀야 한다 — 좌우로 갈라 찍는다.
      if (st.mid != null) {
        pointerMark(ctx, T, l.x0 + st.mid * l.cw, l.cw, y + 2, 'mid', T.accent);
      }
      var loI = Math.max(0, Math.min(st.lo, n));
      var hiI = Math.max(0, Math.min(closed ? st.hi : st.hi, n));
      var collide = (loI === hiI);
      var dx = collide ? Math.min(11, l.cw / 3) : 0;
      pointerMark(ctx, T, l.x0 + loI * l.cw - dx, l.cw, y + 16, 'lo', T.wStart);
      pointerMark(ctx, T, l.x0 + hiI * l.cw + dx, l.cw, y + 16, 'hi', T.wGoal);

      return y + 34;
    }

    function drawSegments(ctx, T, l, y) {
      // pair 모드의 결론: 두 경계가 배열을 세 토막으로 자르고, 가운데가 곧 개수다.
      var lower = runs[0].ret;
      var upper = runs[1] ? runs[1].ret : lower;
      var n = a.length;
      var bands = [
        { from: 0, to: lower, label: '< ' + target, c: T.bgElev, t: T.fgDim },
        { from: lower, to: upper, label: '= ' + target, c: T.wPath, t: T.bg },
        { from: upper, to: n, label: '> ' + target, c: T.bgElev, t: T.fgDim }
      ];
      ctx.save();
      for (var i = 0; i < bands.length; i++) {
        var b = bands[i];
        if (b.to <= b.from) continue;
        var x = l.x0 + b.from * l.cw;
        var w = (b.to - b.from) * l.cw;
        rrect(ctx, x + 1, y, w - 2, 20, 4);
        ctx.fillStyle = b.c;
        ctx.fill();
        ctx.fillStyle = b.t;
        ctx.font = '600 11px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (w > 34) ctx.fillText(b.label, x + w / 2, y + 10);
      }
      ctx.fillStyle = T.fg;
      ctx.font = '600 12px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (wantBadge) {
        ctx.fillText('개수 = upper − lower = ' + upper + ' − ' + lower + ' = ' + (upper - lower),
          l.x0, y + 26);
      }
      ctx.restore();
      return y + 46;
    }

    function drawTable(ctx, T, l, i, y, gi) {
      var cols = l.cols;
      var r = runs[gi];
      var st = stateOf(r, i);
      var shown = st.rows;

      var colW = [];
      var totalW = 0;
      for (var c = 0; c < cols.length; c++) {
        var wgt = (cols[c] === 'update') ? 2.6 : (cols[c] === 'p(mid)' || cols[c] === 'a[mid]' ? 1.2 : 1);
        colW.push(wgt);
        totalW += wgt;
      }
      var avail = l.tableW;
      for (var c2 = 0; c2 < colW.length; c2++) colW[c2] = colW[c2] / totalW * avail;

      var x0 = l.x0;
      ctx.save();
      ctx.textBaseline = 'middle';

      if (runs.length > 1) {
        ctx.font = '600 11px ' + FONT;
        ctx.fillStyle = T.fgDim;
        ctx.textAlign = 'left';
        ctx.fillText(goals[gi].label + ' 의 표  ·  술어 ' + goals[gi].pred.src, x0, y + 7);
        y += 18;
      }

      // 머리글
      ctx.font = '600 11px ' + MONO;
      ctx.fillStyle = T.fgDim;
      var x = x0;
      for (var h = 0; h < cols.length; h++) {
        ctx.textAlign = h === 0 ? 'left' : 'center';
        ctx.fillText(cols[h], h === 0 ? x + 2 : x + colW[h] / 2, y + ROW_H / 2);
        x += colW[h];
      }
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y + ROW_H - 1);
      ctx.lineTo(x0 + avail, y + ROW_H - 1);
      ctx.stroke();
      y += ROW_H;

      // 본문
      for (var k = 0; k < r.rows.length; k++) {
        var row = r.rows[k];
        var on = k < shown;
        var isCur = (k === shown - 1);
        if (isCur) {
          // 현재 줄은 옅은 판에 왼쪽 띠로 표시한다. 강조색으로 줄 전체를 칠하면
          // 그 위의 글자가 안 읽혀 표가 정작 못 읽히게 된다.
          ctx.fillStyle = T.bgElev;
          rrect(ctx, x0 - 2, y + 1, avail + 4, ROW_H - 2, 3);
          ctx.fill();
          ctx.fillStyle = T.accent;
          ctx.fillRect(x0 - 2, y + 2, 2, ROW_H - 4);
        }
        x = x0;
        for (var q = 0; q < cols.length; q++) {
          var name = cols[q];
          var val = '';
          if (name === 'step') val = row.step;
          else if (name === 'lo') val = row.lo;
          else if (name === 'hi') val = row.hi;
          else if (name === 'width') val = row.width;
          else if (name === 'mid') val = row.mid;
          else if (name === 'a[mid]') val = row.amid;
          else if (name === 'p(mid)') val = row.p ? 'T' : 'F';
          else if (name === 'update') val = row.update;

          // 폭 열이 이 위젯의 중심이다. 줄지 않으면 그 자리에서 빨갛게 굳는다.
          var danger = (name === 'width') && row.frozen;
          ctx.fillStyle = !on ? T.fgFaint : (danger ? T.boxDanger : (name === 'width' ? T.accent : T.fg));
          ctx.font = (on && (danger || name === 'width') ? '600 ' : '') + '11px ' + MONO;
          ctx.textAlign = q === 0 ? 'left' : 'center';
          ctx.fillText(on ? String(val) : '·', q === 0 ? x + 2 : x + colW[q] / 2, y + ROW_H / 2);
          x += colW[q];
        }
        y += ROW_H;
      }
      ctx.restore();
      return y + 14;
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var y = PAD;

      if (wantInvariant) {
        ctx.save();
        ctx.font = '12px ' + FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        var V = runs[0].variant;
        var txt = '불변식: ' + invariantText(V);
        var lines = wrap(ctx, txt, l.inner);
        for (var li = 0; li < lines.length; li++) {
          ctx.fillStyle = T.fg;
          ctx.fillText(lines[li], l.x0, y + li * 15);
        }
        y += lines.length * 15 + 2;
        if (wantMeasure) {
          var m = wrap(ctx, '측도: ' + (V.note || '폭 hi - lo 는 매 스텝 줄어든다'), l.inner);
          for (var mi = 0; mi < m.length; mi++) {
            ctx.fillStyle = V.broken ? T.boxDanger : T.fgDim;
            ctx.fillText(m[mi], l.x0, y + mi * 15);
          }
          y += m.length * 15;
        }
        ctx.restore();
        y += 8;
      }

      for (var g = 0; g < runs.length; g++) {
        y = drawSearch(ctx, T, l, runs[g], goals[g], stateOf(runs[g], i), y);
      }

      var atEnd = i >= totalSteps() - 1;
      if (wantSegments && atEnd) y = drawSegments(ctx, T, l, y);
      else if (wantSegments) y += l.segH;

      for (var t = 0; t < runs.length; t++) y = drawTable(ctx, T, l, i, y, t);

      // 결론 줄
      ctx.save();
      ctx.font = '600 12px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      var r0 = runs[0];
      var s0 = stateOf(r0, i);
      if (s0.phase === 'stall') {
        ctx.fillStyle = T.boxDanger;
        ctx.fillText('폭이 ' + (r0.rows.length ? r0.rows[r0.rows.length - 1].width : 1) +
          ' 에서 멈췄다 — 갱신이 구간을 바꾸지 않는다. 이 루프는 끝나지 않는다.', l.x0, y);
      } else if (s0.phase === 'done') {
        ctx.fillStyle = T.wPath;
        var msg;
        if (pairMode && runs[1]) {
          msg = 'lower = ' + runs[0].ret + ', upper = ' + runs[1].ret +
            '  ·  개수 = ' + (runs[1].ret - runs[0].ret) +
            '  ·  두 탐색은 술어 한 글자만 다르다';
          ctx.fillText(msg, l.x0, y);
          ctx.restore();
          return;
        }
        msg = 'return ' + r0.variant.ret + ' = ' + r0.ret;
        if (r0.ret < a.length && a[r0.ret] === target) msg += '  ·  a[' + r0.ret + '] = ' + target + ' (존재)';
        else msg += '  ·  a[' + r0.ret + '] ' + (r0.ret >= a.length ? '없음' : '= ' + a[r0.ret]) + ' — 경계일 뿐 target 이 아니다';
        ctx.fillText(msg, l.x0, y);
      } else {
        ctx.fillStyle = T.fgDim;
        ctx.fillText(r0.variant.loop + '  ·  mid = lo + (hi - lo) // 2  ·  ' +
          (s0.p === undefined ? '아직 판정 전' : (s0.p ? '술어 참 → ' + r0.variant.updT : '술어 거짓 → ' + r0.variant.updF)),
          l.x0, y);
      }
      ctx.restore();
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) { return layout(w).height; },
      draw: draw
    });

    function label(i) {
      var r = runs[0];
      var st = stateOf(r, i);
      var closed = r.closed;
      var widthNow = closed ? (st.hi - st.lo + 1) : (st.hi - st.lo);

      if (st.phase === 'init') {
        return '초기 구간 [' + st.lo + ', ' + st.hi + (closed ? ']' : ')') + ', 폭 ' + widthNow +
          '. ' + r.variant.invariant + '.';
      }
      if (st.phase === 'stall') {
        return '폭이 줄지 않는다. ' + r.variant.note;
      }
      if (st.phase === 'done') {
        var tail = pairMode && runs[1]
          ? ' lower = ' + runs[0].ret + ', upper = ' + runs[1].ret + ', 개수 ' + (runs[1].ret - runs[0].ret) + '.'
          : '';
        return '구간이 비었다. ' + r.variant.ret + ' = ' + r.ret + ' 을 돌려준다.' + tail;
      }
      var s = 'mid = ' + st.mid + ', a[mid] = ' + st.amid + '. 술어 ' + goals[0].pred.src +
        ' 는 ' + (st.p ? '참' : '거짓') + ' → ' + (st.p ? r.variant.updT : r.variant.updF) + '.';
      if (st.frozen) s += ' 구간이 그대로다 — 폭이 줄지 않았다.';
      else s += ' 폭 ' + widthNow + ' 에서 줄어든다.';
      return s;
    }

    play = K.player(ui, {
      total: totalSteps,
      render: function (i) { cur = i; cv.redraw(); },
      label: label
    });
    play.draw();

    // 테스트·본문 검증용 표면. 위젯이 계산한 것과 본문의 표가 어긋나면 여기서 잡는다.
    host.__widget = {
      array: function () { return a.slice(); },
      target: function () { return target; },
      variant: function () { return variant; },
      setVariant: function (v) {
        if (!VARIANTS[v]) return;
        variant = v;
        if (variantSeg) {
          Array.prototype.forEach.call(variantSeg.children, function (c) {
            c.classList.toggle('is-active', c.getAttribute('data-val') === v);
          });
        }
        rebuild();
        play.goto(0);
      },
      runs: function () {
        return runs.map(function (r, i) {
          return { goal: goals[i].label, ret: r.ret, stalled: r.stalled, rows: r.rows.slice() };
        });
      },
      steps: totalSteps,
      goto: function (i) { play.goto(i); },
      index: function () { return play.index(); }
    };
  });
})();

/* ==== complexity-plot.js ==== */
/* complexity-plot — N 이 커질 때 복잡도 곡선이 벌어지는 것과 "1초 안에 되는 선"
 *
 * 왜 이 위젯이 필요한가
 *   복잡도를 표로만 보면 O(n^2) 과 O(n log n) 이 "조금 다른 것"으로 읽힌다.
 *   숫자는 외워지지만 감각이 안 붙는다. 실제로는 n = 10^5 에서 전자가 후자의
 *   6천 배다. 이 배수를 눈으로 보게 하는 것이 목적이다.
 *
 * 왜 로그 축인가
 *   선형 축에서는 O(2^n) 이 첫 몇 칸에서 화면 밖으로 나가고 나머지 곡선이
 *   전부 바닥에 붙어 버린다. 로그-로그 축에서는 각 복잡도가 서로 다른
 *   기울기의 직선이 되어 "차수가 다르다"는 것이 곧 "기울기가 다르다"로 보인다.
 *
 * 왜 스텝이 N 인가
 *   런타임의 스텝 재생기를 N 슬라이더로 쓴다. 스텝을 밀면 N 이 커지고,
 *   어느 복잡도가 먼저 1초 선을 넘는지가 순서대로 드러난다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 1초에 처리 가능한 연산 수의 관례적 기준. 0-9 가 이 숫자의 실체와 예외를 다룬다.
  var BUDGET = 1e8;

  var FUNCS = [
    { key: 'log',    label: 'O(log n)',   f: function (n) { return Math.log2(n); } },
    { key: 'n',      label: 'O(n)',       f: function (n) { return n; } },
    { key: 'nlogn',  label: 'O(n log n)', f: function (n) { return n * Math.log2(n); } },
    { key: 'n2',     label: 'O(n²)',      f: function (n) { return n * n; } },
    { key: 'n3',     label: 'O(n³)',      f: function (n) { return n * n * n; } },
    { key: '2n',     label: 'O(2ⁿ)',      f: function (n) { return Math.pow(2, n); } },
    { key: 'fact',   label: 'O(n!)',      f: function (n) { return gammaFactorial(n); } }
  ];

  // n! 은 n=171 부터 double 범위를 넘는다. 로그 축에 찍을 것이므로
  // 스털링 근사로 log 값을 직접 구해 Infinity 를 피한다.
  function gammaFactorial(n) {
    if (n < 2) return 1;
    if (n <= 170) { var r = 1; for (var i = 2; i <= n; i++) r *= i; return r; }
    return Infinity;
  }
  function log10Factorial(n) {
    if (n < 2) return 0;
    if (n <= 170) return Math.log10(gammaFactorial(n));
    // log10(n!) ≈ n log10(n/e) + log10(2πn)/2
    return n * Math.log10(n / Math.E) + 0.5 * Math.log10(2 * Math.PI * n);
  }
  function log10Of(key, n) {
    if (key === 'fact') return log10Factorial(n);
    if (key === '2n') return n * Math.log10(2);
    var v = null;
    for (var i = 0; i < FUNCS.length; i++) if (FUNCS[i].key === key) v = FUNCS[i].f(n);
    return v <= 0 ? 0 : Math.log10(v);
  }

  // N 축 눈금. 코딩테스트 제약조건에 실제로 나오는 값들을 고른다.
  var NS = [10, 15, 20, 25, 30, 50, 100, 200, 500, 1000, 2000, 5000,
            10000, 20000, 50000, 100000, 200000, 500000, 1000000, 5000000, 10000000];

  function fmt(x) {
    if (!isFinite(x)) return '∞';
    if (x < 1000) return String(Math.round(x));
    var e = Math.floor(Math.log10(x));
    if (e < 6) return Math.round(x).toLocaleString('en-US');
    return '10^' + e;
  }
  function fmtLog(l) {
    if (!isFinite(l)) return '∞';
    if (l < 3) return String(Math.round(Math.pow(10, l)));
    // 10^9 미만은 자릿수를 그대로 보인다. 10! 을 "10^7" 로 뭉개면 3,628,800 이라는
    // 실제 크기가 사라지고, 이 위젯이 주려는 감각이 바로 그 크기다.
    if (l < 9) return Math.round(Math.pow(10, l)).toLocaleString('en-US');
    if (l > 300) return '10^' + Math.round(l) + ' (사실상 불가능)';
    // 유효숫자 한 자리를 남긴다. 2.3×10^8 과 9.9×10^8 은 1초 선 앞에서 의미가 다르다.
    var e = Math.floor(l);
    var m = Math.pow(10, l - e);
    return (m < 1.05 ? '10^' + e : m.toFixed(1) + '×10^' + e);
  }

  K.register('complexity-plot', function (host, opts) {
    var o = opts || {};
    var show = Array.isArray(o.show) && o.show.length
      ? FUNCS.filter(function (f) { return o.show.indexOf(f.key) >= 0; })
      : FUNCS;
    if (!show.length) show = FUNCS;

    var ui = K.frame(host, { title: 'N 이 커지면 무엇이 먼저 무너지는가', wide: o.wide !== false });

    // 범례. 색은 토큰에서 꺼내 쓰되 곡선마다 달라야 하므로 색상환을 돌린다.
    var legend = K.el('div', 'wk-legend');
    ui.slot.appendChild(legend);

    var cv = null;
    var idx = 0;

    function colorFor(i, tokens) {
      // 토큰 6개를 순환시킨다. 새 색을 만들지 않기 위한 선택이다.
      var ring = [tokens.wFrontier, tokens.wPath, tokens.boxWarn, tokens.boxDanger,
                  tokens.accent, tokens.wStart, tokens.fgDim];
      return ring[i % ring.length];
    }

    function draw(ctx, size, tokens) {
      var W = size.w, H = size.h;
      var padL = 54, padR = 14, padT = 14, padB = 34;
      var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
      var narrow = W < 520;

      var nMin = Math.log10(NS[0]), nMax = Math.log10(NS[NS.length - 1]);
      var yMax = 20;   // 10^20 위는 어차피 "불가능"이라 잘라도 정보가 안 준다
      var yMin = 0;

      var px = function (n) { return x0 + (Math.log10(n) - nMin) / (nMax - nMin) * (x1 - x0); };
      var py = function (l) { return y1 - (Math.min(l, yMax) - yMin) / (yMax - yMin) * (y1 - y0); };

      // 격자
      ctx.strokeStyle = tokens.border;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      for (var e = 0; e <= yMax; e += 4) {
        var gy = Math.round(py(e)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 축 라벨
      ctx.fillStyle = tokens.fgFaint;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      for (var e2 = 0; e2 <= yMax; e2 += 4) {
        ctx.fillText('10^' + e2, x0 - 6, py(e2) + 3);
      }
      ctx.textAlign = 'center';
      [10, 1000, 100000, 10000000].forEach(function (n) {
        ctx.fillText(fmt(n), px(n), y1 + 14);
      });
      ctx.fillText('N', (x0 + x1) / 2, y1 + 28);

      // 1초 선. 이 위젯의 주인공이다.
      var by = py(Math.log10(BUDGET));
      ctx.strokeStyle = tokens.wPath;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tokens.wPath;
      ctx.textAlign = 'left';
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillText('10^8 — 1초 안에 되는 선', x0 + 4, by - 5);

      // 곡선
      show.forEach(function (fn, i) {
        ctx.strokeStyle = colorFor(i, tokens);
        ctx.lineWidth = 2;
        ctx.beginPath();
        var started = false;
        for (var s = 0; s <= 240; s++) {
          var n = Math.pow(10, nMin + (nMax - nMin) * (s / 240));
          var l = log10Of(fn.key, n);
          if (l > yMax + 2) {
            if (started) { ctx.lineTo(px(n), py(yMax + 2)); }
            break;
          }
          var X = px(n), Y = py(l);
          if (!started) { ctx.moveTo(X, Y); started = true; } else { ctx.lineTo(X, Y); }
        }
        ctx.stroke();
      });

      // 현재 N 의 세로선과 각 곡선과의 교점
      var curN = NS[idx];
      var cx = Math.round(px(curN)) + 0.5;
      ctx.strokeStyle = tokens.fg;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = tokens.fg;
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = cx > (x0 + x1) / 2 ? 'right' : 'left';
      ctx.fillText('N = ' + fmt(curN), cx + (cx > (x0 + x1) / 2 ? -6 : 6), y0 + 11);

      show.forEach(function (fn, i) {
        var l = log10Of(fn.key, curN);
        if (l > yMax + 0.5) return;
        var Y = py(l);
        ctx.fillStyle = colorFor(i, tokens);
        ctx.beginPath(); ctx.arc(cx, Y, 3.5, 0, Math.PI * 2); ctx.fill();
        if (!narrow) {
          // 통과 여부를 점 옆에 글자로도 쓴다. 색만으로는 전달되지 않는다.
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(fn.label + ' ' + (l <= Math.log10(BUDGET) ? '통과' : '초과'),
                       Math.min(cx + 8, x1 - 92), Y + 3);
        }
      });
    }

    cv = K.canvas(ui.stage, {
      height: function (w) { return w < 520 ? 260 : (w < 900 ? 300 : 340); },
      draw: draw
    });

    // 범례는 캔버스가 토큰을 읽은 뒤에 만들어야 색이 맞는다.
    function buildLegend() {
      var t = cv.tokens();
      legend.innerHTML = '';
      show.forEach(function (fn, i) {
        var s = K.el('span');
        var box = K.el('i');
        box.style.background = colorFor(i, t);
        s.appendChild(box);
        s.appendChild(document.createTextNode(fn.label));
        legend.appendChild(s);
      });
    }
    buildLegend();
    K.onThemeChange(buildLegend);

    var p = K.player(ui, {
      total: function () { return NS.length; },
      render: function (i) { idx = i; cv.redraw(); },
      label: function (i) {
        var n = NS[i];
        var pass = [], fail = [];
        show.forEach(function (fn) {
          var l = log10Of(fn.key, n);
          (l <= Math.log10(BUDGET) ? pass : fail).push(fn.label + '=' + fmtLog(l));
        });
        return 'N = ' + fmt(n) + ' · 1초 안: ' + (pass.join(', ') || '없음') +
               (fail.length ? ' · 초과: ' + fail.join(', ') : '');
      },
      speed: 620
    });

    // 기본 위치를 N=10^5 근처로 둔다. 코딩테스트에서 가장 자주 나오는 구간이고,
    // 여기서 O(n^2) 이 막 선을 넘는 장면이 이 위젯의 핵심이다.
    var startAt = NS.indexOf(100000);
    p.goto(o.n && NS.indexOf(o.n) >= 0 ? NS.indexOf(o.n) : (startAt >= 0 ? startAt : 0));
  });
})();

/* ==== dp-table.js ==== */
/* dp-table.js — DP 표: 점화식이 "어느 칸을 읽는가"를 화살표로 보여준다
 *
 * 왜 화살표가 이 위젯의 본체인가
 *   DP 는 "설명은 이해했는데 코드는 못 짜는" 상태가 가장 안정적으로 재생산되는
 *   주제다. 그 간극의 정체는 점화식을 문장으로는 외웠지만, 한 칸을 채울 때 표의
 *   *어느 칸*을 읽는지를 한 번도 눈으로 본 적이 없다는 데 있다. 그래서 이 위젯은
 *   "채워지는 칸을 반짝이게 하는" 데서 멈추지 않는다. 읽은 칸에서 쓰는 칸으로
 *   화살표를 그린다. 화살표가 장식이 아니라 이 위젯의 존재 이유다.
 *
 * 왜 색만이 아니라 모양으로도 구분하는가 (계약 §5)
 *   채택한 항(실선 화살표 + 실선 테두리)과 비교만 한 항(점선 화살표 + 점선 테두리)을
 *   색이 아니라 선 종류로 갈랐다. 색을 구분하지 못해도 어느 쪽을 골랐는지 읽힌다.
 *   상태 줄은 점화식을 그 스텝의 실제 숫자로 풀어 쓴다 — 그것만 읽어도 위젯이 성립한다.
 *
 * 왜 스텝마다 표 전체를 스냅샷으로 떠 두는가 (계약 §7)
 *   render(i) 는 그리기만 해야 한다. 되감기가 즉시 되어야 하고 같은 i 는 항상 같은
 *   그림이어야 하기 때문이다. 표는 최대 수백 칸이라 스냅샷 비용이 무시할 만하다.
 *
 * 왜 숫자에 배경색 테두리(halo)를 두르는가
 *   긴 화살표는 중간 칸 위를 지나갈 수밖에 없다. 숫자를 배경색으로 한 번 긋고
 *   그 위에 다시 칠하면 화살표가 지나가도 숫자가 먼저 읽힌다.
 *
 * kind 별 점화식 — 본문 ::: dual 코드와 같은 표준형만 쓴다 (계약 §9).
 *   grid     : dp[r][c] = dp[r-1][c] + dp[r][c-1]            (벽이면 0)
 *   knapsack : dp[i][c] = max(dp[i-1][c], dp[i-1][c-w]+v)
 *   lcs      : 같으면 dp[i-1][j-1]+1, 다르면 max(dp[i-1][j], dp[i][j-1])
 *   lis      : dp[i] = 1 + max(dp[j] for j<i if a[j]<a[i])
 *   interval : dp[i][j] = min_k dp[i][k] + dp[k+1][j] + d[i-1]*d[k]*d[j]
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K || !K.register) return;

  var EMPTY = -2147483648;   // Int32Array 에 "아직 안 채움"을 담기 위한 보초값
  var MAX_STEPS = 700;       // opts 가 이상하게 커도 재생이 무한정 길어지지 않게

  // ------------------------------------------------------------- opts 검증
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 절대 믿지 않는다 (계약 §1).

  function num(v, dflt) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return dflt;
  }

  function int(v, lo, hi, dflt) {
    var n = Math.round(num(v, NaN));
    if (!isFinite(n)) return dflt;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function str(v, dflt) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return dflt;
  }

  // ------------------------------------------------------------- 표 빌더
  //
  // 값 배열 하나를 굴리면서 스텝마다 복사본을 떠 둔다. 스텝 객체는
  //   acts    이번에 쓰는 칸
  //   reads   이번에 읽은 칸 [r, c, 채택했는가]
  //   label   상태 줄 문장 (점화식을 숫자로 풀어 쓴 것)
  //   caption 캔버스 좌상단 한 줄 (지금 어느 단계인가)
  //   pathLen 역추적 경로 중 몇 개까지 밝혔는가
  // 를 갖는다.

  function Table(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.vals = new Int32Array(rows * cols);
    for (var i = 0; i < this.vals.length; i++) this.vals[i] = EMPTY;
    this.has = new Uint8Array(rows * cols);
    this.steps = [];
    this.path = [];      // 역추적으로 밝혀진 칸 [r, c]
    this.mark = {};      // "여기서 답의 조각을 채택했다" 표시 (키: r*cols+c)
  }

  Table.prototype.set = function (r, c, v) {
    var k = r * this.cols + c;
    this.vals[k] = v;
    this.has[k] = 1;
  };

  Table.prototype.get = function (r, c) { return this.vals[r * this.cols + c]; };

  Table.prototype.step = function (s) {
    if (this.steps.length >= MAX_STEPS) return;
    s.acts = s.acts || [];
    s.reads = s.reads || [];
    s.label = s.label || '';
    s.caption = s.caption || '';
    s.pathLen = this.path.length;
    s.vals = new Int32Array(this.vals);
    s.has = new Uint8Array(this.has);
    this.steps.push(s);
  };

  // ------------------------------------------------------------- 격자 경로 수
  //
  // 가장 단순한 2차원 DP. 읽는 칸이 위·왼쪽 둘뿐이라 화살표의 의미가 즉시 보인다.

  function buildGrid(o) {
    var rows = int(o.rows, 2, 8, 5);
    var cols = int(o.cols, 2, 10, 6);
    var wall = new Uint8Array(rows * cols);
    var blocked = Array.isArray(o.blocked) ? o.blocked : [[1, 2], [2, 4]];
    for (var b = 0; b < blocked.length && b < 40; b++) {
      var e = blocked[b];
      if (!e) continue;
      var r = Array.isArray(e) ? int(e[0], 0, rows - 1, -1) : int(e.r, 0, rows - 1, -1);
      var c = Array.isArray(e) ? int(e[1], 0, cols - 1, -1) : int(e.c, 0, cols - 1, -1);
      if (r < 0 || c < 0) continue;
      // 시작·도착을 막으면 위젯이 아무것도 보여주지 못한다. 그건 오타로 본다.
      if ((r === 0 && c === 0) || (r === rows - 1 && c === cols - 1)) continue;
      wall[r * cols + c] = 1;
    }

    var t = new Table(rows, cols);
    t.kind = 'grid';
    t.wall = wall;
    t.headW = 34;
    t.corner = 'r\\c';
    t.rowLab = []; t.colLab = [];
    for (var i = 0; i < rows; i++) t.rowLab.push(String(i));
    for (var j = 0; j < cols; j++) t.colLab.push(String(j));
    t.title = '격자 경로 수 — dp[r][c] = dp[r-1][c] + dp[r][c-1]';

    t.set(0, 0, 1);
    t.step({
      acts: [[0, 0]],
      caption: '기저',
      label: '기저: 출발 칸 dp[0][0] = 1. 출발점에 도달하는 방법은 "가만히 있는 것" 하나뿐이다.'
    });

    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols; cc++) {
        if (rr === 0 && cc === 0) continue;
        if (wall[rr * cols + cc]) {
          t.set(rr, cc, 0);
          t.step({
            acts: [[rr, cc]],
            caption: 'r=' + rr,
            label: '(' + rr + ',' + cc + ') 은 벽이다. 지나갈 수 없으니 dp = 0. 읽을 칸이 없다.'
          });
          continue;
        }
        var up = rr > 0 ? t.get(rr - 1, cc) : 0;
        var left = cc > 0 ? t.get(rr, cc - 1) : 0;
        var reads = [];
        var parts = [];
        if (rr > 0) { reads.push([rr - 1, cc, up > 0]); parts.push('dp[' + (rr - 1) + '][' + cc + ']=' + up); }
        if (cc > 0) { reads.push([rr, cc - 1, left > 0]); parts.push('dp[' + rr + '][' + (cc - 1) + ']=' + left); }
        var v = up + left;
        t.set(rr, cc, v);
        t.step({
          acts: [[rr, cc]],
          reads: reads,
          caption: 'r=' + rr,
          label: 'dp[' + rr + '][' + cc + '] = ' + parts.join(' + ') + ' = ' + v +
            (v === 0 ? ' — 여기로 오는 길이 아직 없다.' : ' — 위와 왼쪽에서 오는 경로를 더한다.')
        });
      }
    }

    var ans = t.get(rows - 1, cols - 1);
    t.result = { value: ans, kind: 'grid' };

    if (ans > 0) {
      // 경로 수 DP 는 "정답 경로"가 하나로 정해지지 않는다. 그래서 대표 경로
      // 하나를 거꾸로 따라가며 보여주고, 그것이 여러 경로 중 하나임을 명시한다.
      var pr = rows - 1, pc = cols - 1;
      var chain = [];
      while (true) {
        chain.push([pr, pc]);
        if (pr === 0 && pc === 0) break;
        var u = pr > 0 ? t.get(pr - 1, pc) : 0;
        if (pr > 0 && u > 0) { pr = pr - 1; }
        else { pc = pc - 1; }
      }
      for (var s = 0; s < chain.length; s++) {
        t.path.push(chain[s]);
        t.step({
          caption: '역추적',
          label: s === 0
            ? 'dp[' + (rows - 1) + '][' + (cols - 1) + '] = ' + ans + '. 값이 0 이 아닌 칸을 거꾸로 따라가면 실제 경로 하나가 나온다.'
            : '(' + chain[s][0] + ',' + chain[s][1] + ') 로 되돌아왔다. dp = ' + t.get(chain[s][0], chain[s][1]) + '.'
        });
      }
      t.step({
        caption: '역추적',
        label: '도착 칸까지 가는 방법은 모두 ' + ans + ' 가지다. 방금 칠한 것은 그중 한 경로다 — 경로 수 DP 는 경로를 하나로 정해 주지 않는다.'
      });
    } else {
      t.step({ caption: '결과', label: '도착 칸의 dp 가 0 이다. 벽에 막혀 갈 수 있는 경로가 하나도 없다.' });
    }
    return t;
  }

  // ------------------------------------------------------------- 0/1 배낭
  //
  // dp[i][c] = max(dp[i-1][c], dp[i-1][c-w_i] + v_i)
  // 읽는 칸이 "바로 윗줄의 같은 열"과 "바로 윗줄의 w 칸 왼쪽" 두 군데라는 것이
  // 배낭의 전부다. 그 두 화살표를 보이는 것이 이 kind 의 목적이다.

  function buildKnapsack(o) {
    // 표가 읽히려면 칸이 일정 크기 이상이어야 한다. 그래서 상한을 둔다.
    // 다만 잘라냈다는 사실은 제목에 밝힌다 — 조용히 자르면 위젯이 거짓말을 한다.
    var capWant = int(o.cap, 1, 9999, 8);
    var cap = capWant > 14 ? 14 : capWant;
    var clamped = [];
    if (capWant > cap) clamped.push('용량 ' + capWant + '→' + cap);
    var items = [];
    var src = Array.isArray(o.items) ? o.items : null;
    if (src) {
      for (var i = 0; i < src.length && items.length < 6; i++) {   // 물건 상한 6 — 세로로도 읽혀야 한다
        var it = src[i];
        if (!it || typeof it !== 'object') continue;
        var w = int(it.w, 1, 20, 0);
        var v = int(it.v, 0, 999, 0);
        if (w < 1) continue;
        items.push({ w: w, v: v });
      }
    }
    if (!items.length) items = [{ w: 2, v: 3 }, { w: 3, v: 4 }, { w: 4, v: 5 }, { w: 5, v: 6 }];
    if (src && src.length > items.length) clamped.push('물건 ' + src.length + '→' + items.length);

    var n = items.length;
    var t = new Table(n + 1, cap + 1);
    t.kind = 'knapsack';
    t.headW = 60;
    t.corner = 'i\\c';
    t.rowLab = ['0'];
    t.rowSub = ['없음'];
    for (var a = 0; a < n; a++) {
      t.rowLab.push(String(a + 1));
      t.rowSub.push('w' + items[a].w + ' v' + items[a].v);
    }
    t.colLab = [];
    for (var c0 = 0; c0 <= cap; c0++) t.colLab.push(String(c0));
    t.title = '0/1 배낭 (용량 ' + cap + ') — dp[i][c] = max(dp[i-1][c], dp[i-1][c-w]+v)'
              + (clamped.length ? '  · 표가 읽히도록 줄임: ' + clamped.join(', ') : '');
    t.items = items;

    for (var cz = 0; cz <= cap; cz++) t.set(0, cz, 0);
    var row0 = [];
    for (var cz2 = 0; cz2 <= cap; cz2++) row0.push([0, cz2]);
    t.step({
      acts: row0,
      caption: '기저',
      label: '기저: 물건이 하나도 없으면(i=0) 용량이 얼마든 담을 수 있는 가치는 0 이다. 읽을 칸이 없다.'
    });

    for (var ii = 1; ii <= n; ii++) {
      var w = items[ii - 1].w, v = items[ii - 1].v;
      for (var cc = 0; cc <= cap; cc++) {
        var skip = t.get(ii - 1, cc);
        if (cc < w) {
          t.set(ii, cc, skip);
          t.step({
            acts: [[ii, cc]],
            reads: [[ii - 1, cc, true]],
            caption: '물건 ' + ii + ' (무게 ' + w + ', 가치 ' + v + ')',
            label: 'dp[' + ii + '][' + cc + '] = dp[' + (ii - 1) + '][' + cc + '] = ' + skip +
              ' — 용량 ' + cc + ' 에는 무게 ' + w + ' 짜리 물건 ' + ii + ' 가 아예 안 들어간다. 윗줄을 그대로 베낀다.'
          });
          continue;
        }
        var take = t.get(ii - 1, cc - w) + v;
        var best = take > skip ? take : skip;
        t.set(ii, cc, best);
        t.step({
          acts: [[ii, cc]],
          reads: [[ii - 1, cc, take <= skip], [ii - 1, cc - w, take > skip]],
          caption: '물건 ' + ii + ' (무게 ' + w + ', 가치 ' + v + ')',
          label: 'dp[' + ii + '][' + cc + '] = max(dp[' + (ii - 1) + '][' + cc + ']=' + skip +
            ', dp[' + (ii - 1) + '][' + (cc - w) + ']+' + v + '=' + take + ') = ' + best +
            ' — 물건 ' + ii + ' 을 ' + (take > skip ? '넣는' : '넣지 않는') + ' 쪽이 낫다.'
        });
      }
    }

    var ans = t.get(n, cap);
    // 역추적: 윗줄과 값이 같으면 안 넣은 것, 다르면 넣은 것이다.
    var ci = n, cq = cap, chosen = [], sum = 0;
    t.path.push([n, cap]);
    t.step({
      caption: '역추적',
      label: 'dp[' + n + '][' + cap + '] = ' + ans + '. 여기서 거꾸로 올라가며 어떤 물건을 넣었는지 복원한다.'
    });
    while (ci > 0) {
      var up = t.get(ci - 1, cq);
      if (t.get(ci, cq) === up) {
        t.path.push([ci - 1, cq]);
        t.step({
          caption: '역추적',
          label: 'dp[' + ci + '][' + cq + '] 가 윗칸 dp[' + (ci - 1) + '][' + cq + '] 와 같다 → 물건 ' + ci + ' 는 넣지 않았다. 용량은 그대로 ' + cq + '.'
        });
        ci -= 1;
      } else {
        var iw = items[ci - 1].w, iv = items[ci - 1].v;
        chosen.push(ci); sum += iv;
        t.mark[ci * t.cols + cq] = 1;
        t.path.push([ci - 1, cq - iw]);
        t.step({
          caption: '역추적',
          label: 'dp[' + ci + '][' + cq + '] 가 윗칸 ' + up + ' 보다 크다 → 물건 ' + ci + '(무게 ' + iw + ', 가치 ' + iv + ') 를 넣었다. 용량 ' + (cq - iw) + ' 칸으로 간다.'
        });
        ci -= 1; cq -= iw;
      }
    }
    chosen.reverse();
    t.step({
      caption: '역추적',
      label: '고른 물건: ' + (chosen.length ? chosen.join(', ') + '번' : '없음') +
        '. 가치 합 ' + sum + ' = dp[' + n + '][' + cap + '] = ' + ans + '.'
    });
    t.result = { value: ans, kind: 'knapsack', chosen: chosen, chosenValue: sum };
    return t;
  }

  // ------------------------------------------------------------- LCS
  //
  // 같으면 대각선 하나, 다르면 위·왼쪽 둘. "왜 대각선인가"는 화살표를 봐야 안다.

  function buildLcs(o) {
    var A = str(o.a, 'ACAYKP').replace(/\s+/g, '').slice(0, 8);
    var B = str(o.b, 'CAPCAK').replace(/\s+/g, '').slice(0, 8);
    if (!A) A = 'ACAYKP';
    if (!B) B = 'CAPCAK';
    var n = A.length, m = B.length;

    var t = new Table(n + 1, m + 1);
    t.kind = 'lcs';
    t.headW = 44;
    t.corner = ' ';
    t.rowLab = ['∅']; t.rowSub = ['0'];
    for (var i = 0; i < n; i++) { t.rowLab.push(A.charAt(i)); t.rowSub.push(String(i + 1)); }
    t.colLab = ['∅']; t.colSub = ['0'];
    for (var j = 0; j < m; j++) { t.colLab.push(B.charAt(j)); t.colSub.push(String(j + 1)); }
    t.title = 'LCS — "' + A + '" vs "' + B + '"';

    var base = [];
    for (var c = 0; c <= m; c++) { t.set(0, c, 0); base.push([0, c]); }
    for (var r = 1; r <= n; r++) { t.set(r, 0, 0); base.push([r, 0]); }
    t.step({
      acts: base,
      caption: '기저',
      label: '기저: 한쪽이 빈 문자열이면 공통 부분수열의 길이는 0 이다. 0 행과 0 열을 0 으로 채운다.'
    });

    for (var ri = 1; ri <= n; ri++) {
      for (var cj = 1; cj <= m; cj++) {
        var ca = A.charAt(ri - 1), cb = B.charAt(cj - 1);
        if (ca === cb) {
          var d = t.get(ri - 1, cj - 1) + 1;
          t.set(ri, cj, d);
          t.step({
            acts: [[ri, cj]],
            reads: [[ri - 1, cj - 1, true]],
            caption: '"' + ca + '" 행',
            label: 'dp[' + ri + '][' + cj + ']: a[' + ri + ']=\'' + ca + '\' 와 b[' + cj + ']=\'' + cb +
              '\' 가 같다 → dp[' + (ri - 1) + '][' + (cj - 1) + ']+1 = ' + d + '. 대각선 하나만 읽는다.'
          });
        } else {
          var upv = t.get(ri - 1, cj), lfv = t.get(ri, cj - 1);
          var bv = upv >= lfv ? upv : lfv;
          t.set(ri, cj, bv);
          t.step({
            acts: [[ri, cj]],
            reads: [[ri - 1, cj, upv >= lfv], [ri, cj - 1, lfv > upv]],
            caption: '"' + ca + '" 행',
            label: 'dp[' + ri + '][' + cj + ']: \'' + ca + '\' ≠ \'' + cb + '\' → max(dp[' + (ri - 1) + '][' + cj + ']=' + upv +
              ', dp[' + ri + '][' + (cj - 1) + ']=' + lfv + ') = ' + bv + ' — ' + (upv >= lfv ? '위' : '왼쪽') + '쪽을 가져온다.'
          });
        }
      }
    }

    var ans = t.get(n, m);
    var pi = n, pj = m, out = [];
    t.path.push([n, m]);
    t.step({ caption: '역추적', label: 'dp[' + n + '][' + m + '] = ' + ans + '. 여기서 거꾸로 내려가며 실제 문자열을 복원한다.' });
    while (pi > 0 && pj > 0) {
      if (A.charAt(pi - 1) === B.charAt(pj - 1)) {
        out.push(A.charAt(pi - 1));
        t.mark[pi * t.cols + pj] = 1;
        t.path.push([pi - 1, pj - 1]);
        t.step({
          caption: '역추적',
          label: '\'' + A.charAt(pi - 1) + '\' 가 일치했던 칸이다 → 답에 넣고 대각선으로 간다.'
        });
        pi -= 1; pj -= 1;
      } else if (t.get(pi - 1, pj) >= t.get(pi, pj - 1)) {
        t.path.push([pi - 1, pj]);
        t.step({ caption: '역추적', label: '값이 윗칸에서 왔다 → 위로 올라간다. (a 의 \'' + A.charAt(pi - 1) + '\' 는 쓰지 않았다)' });
        pi -= 1;
      } else {
        t.path.push([pi, pj - 1]);
        t.step({ caption: '역추적', label: '값이 왼쪽 칸에서 왔다 → 왼쪽으로 간다. (b 의 \'' + B.charAt(pj - 1) + '\' 는 쓰지 않았다)' });
        pj -= 1;
      }
    }
    out.reverse();
    var lcsStr = out.join('');
    t.step({ caption: '역추적', label: 'LCS = "' + lcsStr + '" (길이 ' + lcsStr.length + ' = dp[' + n + '][' + m + ']).' });
    t.result = { value: ans, kind: 'lcs', seq: lcsStr };
    return t;
  }

  // ------------------------------------------------------------- LIS (O(n²))
  //
  // 1차원이라 표가 한 줄이다. 위 줄에 입력 수열을 같이 놓지 않으면
  // "a[j] < a[i] 인가"라는 조건을 눈으로 확인할 수 없다. 그래서 두 줄로 그린다.
  // 화살표는 같은 줄 안에서 오가므로 셀 아래쪽 띠에 활 모양으로 건다(숫자를 가리지 않게).

  function buildLis(o) {
    var seq = [];
    var src = Array.isArray(o.seq) ? o.seq : (Array.isArray(o.a) ? o.a : null);
    if (src) {
      for (var i = 0; i < src.length && seq.length < 12; i++) {
        var x = num(src[i], NaN);
        if (!isFinite(x)) continue;
        seq.push(int(x, -999, 999, 0));
      }
    }
    if (seq.length < 2) seq = [10, 20, 10, 30, 20, 50, 40, 60];
    var n = seq.length;

    var t = new Table(2, n);
    t.kind = 'lis';
    t.headW = 48;
    t.corner = 'i';
    t.inputRow = 0;
    t.rowLab = ['a[i]', 'dp[i]'];
    t.colLab = [];
    for (var j = 0; j < n; j++) t.colLab.push(String(j));
    t.title = 'LIS O(n²) — dp[i] = 1 + max(dp[j] : j<i, a[j]<a[i])';
    t.seq = seq;

    var acts0 = [];
    for (var k = 0; k < n; k++) { t.set(0, k, seq[k]); acts0.push([0, k]); }
    t.step({
      acts: acts0,
      caption: '입력',
      label: '수열을 놓는다. dp[i] 는 "i 에서 끝나는 증가 부분수열의 최대 길이"다.'
    });

    var dp = [], prev = [];
    for (var ii = 0; ii < n; ii++) {
      dp[ii] = 1; prev[ii] = -1;
      t.set(1, ii, 1);
      t.step({
        acts: [[1, ii]],
        caption: 'i=' + ii,
        label: 'dp[' + ii + '] = 1 로 시작한다 — 자기 자신 하나짜리 부분수열은 언제나 있다. 읽을 칸이 없다.'
      });
      for (var jj = 0; jj < ii; jj++) {
        if (seq[jj] < seq[ii]) {
          if (dp[jj] + 1 > dp[ii]) {
            dp[ii] = dp[jj] + 1; prev[ii] = jj;
            t.set(1, ii, dp[ii]);
            t.step({
              acts: [[1, ii]],
              reads: [[1, jj, true]],
              caption: 'i=' + ii,
              label: 'a[' + jj + ']=' + seq[jj] + ' < a[' + ii + ']=' + seq[ii] + ' 이고 dp[' + jj + ']+1=' + (dp[jj] + 1) +
                ' 이 더 크다 → dp[' + ii + '] = ' + dp[ii] + '. ' + ii + ' 앞에 ' + jj + ' 를 붙인다.'
            });
          } else {
            t.step({
              acts: [[1, ii]],
              reads: [[1, jj, false]],
              caption: 'i=' + ii,
              label: 'a[' + jj + ']=' + seq[jj] + ' < a[' + ii + ']=' + seq[ii] + ' 지만 dp[' + jj + ']+1=' + (dp[jj] + 1) +
                ' 은 이미 가진 dp[' + ii + ']=' + dp[ii] + ' 보다 크지 않다 → 그대로 둔다.'
            });
          }
        } else {
          t.step({
            acts: [[1, ii]],
            caption: 'i=' + ii,
            label: 'a[' + jj + ']=' + seq[jj] + ' ≥ a[' + ii + ']=' + seq[ii] + ' → 증가가 아니라 이어붙일 수 없다. 읽지 않는다.'
          });
        }
      }
    }

    var best = 0, bi = 0;
    for (var q = 0; q < n; q++) if (dp[q] > best) { best = dp[q]; bi = q; }
    var chain = [];
    var cur = bi;
    while (cur >= 0) { chain.push(cur); cur = prev[cur]; }

    for (var s = 0; s < chain.length; s++) {
      var idxc = chain[s];
      t.mark[1 * t.cols + idxc] = 1;
      t.path.push([1, idxc]);
      t.path.push([0, idxc]);
      t.step({
        caption: '역추적',
        label: s === 0
          ? '가장 긴 길이는 ' + best + ' 이고 i=' + idxc + ' 에서 끝난다. prev 를 따라 거꾸로 간다.'
          : 'dp[' + chain[s - 1] + ']=' + dp[chain[s - 1]] + ' 는 dp[' + idxc + ']=' + dp[idxc] + ' 에서 왔다. a[' + idxc + ']=' + seq[idxc] + ' < a[' + chain[s - 1] + ']=' + seq[chain[s - 1]] + '.'
      });
    }
    var vals = chain.slice().reverse().map(function (z) { return seq[z]; });
    t.step({ caption: '역추적', label: 'LIS = ' + vals.join(' → ') + ' (길이 ' + best + ').' });
    t.result = { value: best, kind: 'lis', seq: vals };
    return t;
  }

  // ------------------------------------------------------------- 구간 DP
  //
  // 행렬 곱셈 순서. 이 kind 의 교훈은 점화식 자체가 아니라 **채우는 순서**다.
  // dp[i][j] 는 같은 행의 왼쪽(dp[i][k])과 같은 열의 아래(dp[k+1][j])를 읽는다.
  // 그래서 행 우선으로 채우면 아직 없는 칸을 읽게 된다 — 길이가 짧은 구간부터
  // 채워야 한다. 캡션에 L 을 크게 띄우고 대각선 띠가 순서대로 차오르게 그린다.

  function buildInterval(o) {
    var dims = [];
    var src = Array.isArray(o.dims) ? o.dims : null;
    if (src) {
      for (var i = 0; i < src.length && dims.length < 7; i++) {
        var d = int(src[i], 1, 999, 0);
        if (d < 1) continue;
        dims.push(d);
      }
    }
    if (dims.length < 3) dims = [5, 10, 3, 12, 5, 50];
    var n = dims.length - 1;   // 행렬 개수

    var t = new Table(n, n);
    t.kind = 'interval';
    t.headW = 40;
    t.corner = 'i\\j';
    t.rowLab = []; t.colLab = [];
    for (var a = 1; a <= n; a++) { t.rowLab.push(String(a)); t.colLab.push(String(a)); }
    t.mask = new Uint8Array(n * n);
    for (var r = 0; r < n; r++) for (var c = r; c < n; c++) t.mask[r * n + c] = 1;
    var mnames = [];
    for (var mi = 1; mi <= n; mi++) mnames.push('A' + mi + '(' + dims[mi - 1] + '×' + dims[mi] + ')');
    t.title = '구간 DP — 행렬 곱셈 순서: ' + mnames.join(' ');
    t.dims = dims;

    // 표 좌표는 0-based(r=i-1, c=j-1), 점화식은 1-based(i, j) 로 쓴다.
    function R(i) { return i - 1; }

    var dp = [], split = [];
    for (var z = 0; z <= n + 1; z++) { dp[z] = []; split[z] = []; }

    var diag = [];
    for (var i1 = 1; i1 <= n; i1++) { dp[i1][i1] = 0; t.set(R(i1), R(i1), 0); diag.push([R(i1), R(i1)]); }
    t.step({
      acts: diag,
      caption: '길이 L = 1',
      label: '기저: 행렬 하나짜리 구간은 곱할 것이 없다. dp[i][i] = 0. 대각선부터 채운다.'
    });

    for (var L = 2; L <= n; L++) {
      for (var i = 1; i + L - 1 <= n; i++) {
        var j = i + L - 1;
        var bestV = Infinity, bestK = i;
        for (var k = i; k < j; k++) {
          var mul = dims[i - 1] * dims[k] * dims[j];
          var tot = dp[i][k] + dp[k + 1][j] + mul;
          var better = tot < bestV;
          if (better) { bestV = tot; bestK = k; }
          t.step({
            acts: [[R(i), R(j)]],
            reads: [[R(i), R(k), better], [R(k + 1), R(j), better]],
            caption: '길이 L = ' + L,
            label: 'dp[' + i + '][' + j + '] 후보 k=' + k + ': dp[' + i + '][' + k + ']=' + dp[i][k] +
              ' + dp[' + (k + 1) + '][' + j + ']=' + dp[k + 1][j] +
              ' + ' + dims[i - 1] + '×' + dims[k] + '×' + dims[j] + '=' + mul + ' → ' + tot +
              (better ? ' — 지금까지 최선.' : ' — 지금 최선 ' + bestV + ' 보다 크다.')
          });
        }
        dp[i][j] = bestV; split[i][j] = bestK;
        t.set(R(i), R(j), bestV);
        t.step({
          acts: [[R(i), R(j)]],
          reads: [[R(i), R(bestK), true], [R(bestK + 1), R(j), true]],
          caption: '길이 L = ' + L,
          label: 'dp[' + i + '][' + j + '] = ' + bestV + ' (k=' + bestK + ' 에서 자른다). 길이 ' + L +
            ' 구간은 길이 ' + (L - 1) + ' 이하 구간만 읽는다 — 그래서 길이 순서로 채워야 한다.'
        });
      }
    }

    var ans = dp[1][n];
    function paren(i, j) {
      if (i === j) return 'A' + i;
      var k = split[i][j];
      return '(' + paren(i, k) + paren(k + 1, j) + ')';
    }

    var order = [];
    (function walk(i, j) {
      order.push([i, j]);
      if (i === j) return;
      var k = split[i][j];
      walk(i, k); walk(k + 1, j);
    })(1, n);

    for (var w = 0; w < order.length; w++) {
      var oi = order[w][0], oj = order[w][1];
      t.path.push([R(oi), R(oj)]);
      if (oi === oj) {
        t.step({ caption: '역추적', label: '구간 [' + oi + ',' + oj + '] 은 행렬 A' + oi + ' 하나다. 더 자를 것이 없다.' });
      } else {
        t.mark[R(oi) * t.cols + R(oj)] = 1;
        t.step({
          caption: '역추적',
          label: '구간 [' + oi + ',' + oj + '] 은 k=' + split[oi][oj] + ' 에서 자른다 → (' + paren(oi, split[oi][oj]) + ')(' + paren(split[oi][oj] + 1, oj) + '), 비용 ' + dp[oi][oj] + '.'
        });
      }
    }
    t.step({ caption: '역추적', label: '최적 괄호: ' + paren(1, n) + ' — 곱셈 ' + ans + ' 번. 순서만 바꿔도 비용이 달라진다.' });
    t.result = { value: ans, kind: 'interval', paren: paren(1, n) };
    return t;
  }

  // ------------------------------------------------------------- 그리기

  function boxEdge(cx, cy, hw, hh, dx, dy) {
    // 중심에서 (dx,dy) 방향으로 나갈 때 사각형 경계와 만나는 점.
    // 화살표를 셀 경계에서 시작·종료시켜 숫자를 덜 가리게 하려고 쓴다.
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 && ay < 1e-6) return { x: cx, y: cy };
    var tx = ax > 1e-6 ? hw / ax : Infinity;
    var ty = ay > 1e-6 ? hh / ay : Infinity;
    var s = Math.min(tx, ty);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function widget(host, opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    var kind = str(o.kind, 'grid').toLowerCase();
    var builders = {
      grid: buildGrid, knapsack: buildKnapsack, lcs: buildLcs,
      lis: buildLis, interval: buildInterval
    };
    if (!builders[kind]) kind = 'grid';
    var model = builders[kind](o);

    // 역추적 칸을 O(1) 로 찾기 위한 역인덱스. render 안에서 배열을 새로 만들지 않는다.
    model.pathIndex = new Int32Array(model.rows * model.cols);
    for (var pz = 0; pz < model.pathIndex.length; pz++) model.pathIndex[pz] = -1;
    for (var pp = 0; pp < model.path.length; pp++) {
      var pk = model.path[pp][0] * model.cols + model.path[pp][1];
      if (model.pathIndex[pk] < 0) model.pathIndex[pk] = pp;
    }

    var ui = K.frame(host, { title: str(o.title, model.title), wide: o.wide === true });

    // 범례: 색을 못 봐도 되게 선 종류 설명을 같이 넣는다.
    var lg = K.el('div', 'wk-legend');
    function legend(colorVar, text) {
      var sp = K.el('span');
      if (colorVar) {
        var sw = K.el('i');
        sw.style.background = 'var(' + colorVar + ')';
        sp.appendChild(sw);
      }
      sp.appendChild(document.createTextNode(text));
      lg.appendChild(sp);
    }
    legend('--w-visited', '채워진 칸');
    legend('--w-frontier', '지금 채우는 칸');
    legend('--w-start', '점화식이 읽는 칸');
    legend('--w-path', '역추적');
    if (model.kind === 'grid') legend('--w-wall', '벽');
    legend(null, '실선 화살표 = 채택 / 점선 = 비교만');
    ui.slot.appendChild(lg);

    var idx = 0;

    // ---- 배치 계산: 폭에 따라 셀 크기를 정하고, 최소 크기 밑으로 내려가면
    //      열을 창(window)으로 잘라 보여준다. 글자를 못 읽을 크기로 그리느니
    //      일부만 보이는 편이 낫다. (계약 §4)
    function layout(W) {
      var narrow = W < 700;
      var padX = 2;
      var capH = 15;
      var headW = Math.round(Math.max(24, model.headW * (narrow ? 0.8 : 1)));
      var headH = model.colSub ? 30 : 22;
      var avail = Math.max(60, W - padX * 2 - headW);
      var nCols = model.cols;
      var minCell = narrow ? 21 : 26;
      var cw = Math.floor(avail / nCols);
      var visCols = nCols;
      if (cw < minCell) {
        visCols = Math.max(3, Math.min(nCols, Math.floor(avail / minCell)));
        cw = Math.floor(avail / visCols);
      }
      if (cw > 56) cw = 56;
      if (cw < 14) cw = 14;
      // 좁은 화면에서는 칸을 정사각형보다 세로로 길게 잡는다. 폭은 화면이 정하지만
      // 세로는 공짜이고, 위아래 이웃 칸을 잇는 화살표가 그릴 자리를 거기서 번다.
      var ch = Math.max(narrow ? 34 : 24, Math.min(cw, 44));
      var tableW = headW + visCols * cw;
      var ox = Math.max(padX, Math.floor((W - tableW) / 2)) + headW;
      var extraBottom = model.kind === 'lis' ? Math.round(ch * 1.05) : 5;
      var oy = capH + headH + 2;
      return {
        narrow: narrow, cw: cw, ch: ch, headW: headW, headH: headH, capH: capH,
        visCols: visCols, ox: ox, oy: oy,
        h: oy + model.rows * ch + extraBottom + 3
      };
    }

    function heightFor(W) { return layout(W).h; }

    // 창의 시작 열. 이번 스텝에 등장하는 칸을 되도록 다 담는다.
    function windowStart(g, st) {
      if (g.visCols >= model.cols) return 0;
      var lo = Infinity, hi = -Infinity, i;
      for (i = 0; i < st.acts.length; i++) { if (st.acts[i][1] < lo) lo = st.acts[i][1]; if (st.acts[i][1] > hi) hi = st.acts[i][1]; }
      for (i = 0; i < st.reads.length; i++) { if (st.reads[i][1] < lo) lo = st.reads[i][1]; if (st.reads[i][1] > hi) hi = st.reads[i][1]; }
      if (st.pathLen > 0) {
        var pc = model.path[st.pathLen - 1][1];
        if (pc < lo) lo = pc;
        if (pc > hi) hi = pc;
      }
      if (!isFinite(lo)) return 0;
      var span = hi - lo + 1;
      var s0;
      if (span <= g.visCols) {
        s0 = lo - Math.floor((g.visCols - span) / 2);
      } else if (st.reads.length && st.acts.length) {
        // 읽는 칸과 쓰는 칸이 한 화면에 다 안 들어가면 **쓰는 칸**을 붙잡는다.
        // 창 밖으로 밀린 읽는 칸은 가장자리에 열 번호 스텁으로 남는다 —
        // 지금 무엇을 채우는지가 사라지는 것이 훨씬 나쁘다.
        s0 = st.acts[st.acts.length - 1][1] - Math.floor(g.visCols / 2);
      } else {
        s0 = lo;
      }
      if (s0 < 0) s0 = 0;
      if (s0 > model.cols - g.visCols) s0 = model.cols - g.visCols;
      return s0;
    }

    function fitFont(ctx, text, maxW, base, weight) {
      var fs = base;
      while (fs > 8) {
        ctx.font = weight + ' ' + fs + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        if (ctx.measureText(text).width <= maxW) return fs;
        fs -= 1;
      }
      ctx.font = weight + ' 8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      return 8;
    }

    function draw(ctx, size, T) {
      var g = layout(size.w);
      if (!model.steps.length) return;
      var st = model.steps[Math.max(0, Math.min(idx, model.steps.length - 1))];
      var c0 = windowStart(g, st);
      var cw = g.cw, ch = g.ch;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      function cx(c) { return g.ox + (c - c0) * cw; }
      function cy(r) { return g.oy + r * ch; }
      function inWin(c) { return c >= c0 && c < c0 + g.visCols; }

      // ---- 캡션: 지금 어느 단계인가 (구간 DP 의 L 이 여기 뜬다)
      if (st.caption) {
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = T.fgFaint;
        ctx.fillText(st.caption, 3, g.capH * 0.5);
        ctx.textAlign = 'center';
      }

      // ---- 셀 배경
      var r, c, k;
      for (r = 0; r < model.rows; r++) {
        for (c = c0; c < c0 + g.visCols && c < model.cols; c++) {
          k = r * model.cols + c;
          if (model.mask && !model.mask[k]) {
            // 존재하지 않는 구간(i > j). 옅게 깔아 "여긴 칸이 아니다"를 보인다.
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = T.bgCode;
            ctx.fillRect(cx(c), cy(r), cw, ch);
            ctx.globalAlpha = 1;
            continue;
          }
          var isWall = model.wall && model.wall[k];
          var isInput = model.inputRow === r;
          var act = false, read = -1, i;
          for (i = 0; i < st.acts.length; i++) if (st.acts[i][0] === r && st.acts[i][1] === c) { act = true; break; }
          for (i = 0; i < st.reads.length; i++) if (st.reads[i][0] === r && st.reads[i][1] === c) { read = st.reads[i][2] ? 2 : 1; break; }
          var pIdx = model.pathIndex[k];
          var onPath = pIdx >= 0 && pIdx < st.pathLen;

          var fill = null, alpha = 1, stroke = T.border, lw = 1, dash = null;
          if (isWall) { fill = T.wWall; alpha = 0.9; }
          else if (isInput) { fill = T.bgElev; alpha = 1; }
          else if (act) { fill = T.wFrontier; alpha = 0.34; stroke = T.wFrontier; lw = 2.4; }
          else if (read === 2) { fill = T.wStart; alpha = 0.24; stroke = T.wStart; lw = 2; }
          else if (read === 1) { fill = T.wStart; alpha = 0.10; stroke = T.wStart; lw = 1.6; dash = [4, 3]; }
          else if (onPath) { fill = T.wPath; alpha = pIdx === st.pathLen - 1 ? 0.5 : 0.3; stroke = T.wPath; lw = pIdx === st.pathLen - 1 ? 2.4 : 1.6; }
          else if (st.has[k]) { fill = T.wVisited; alpha = 0.45; }

          if (fill) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = fill;
            ctx.fillRect(cx(c), cy(r), cw, ch);
            ctx.globalAlpha = 1;
          }
          ctx.setLineDash(dash || []);
          ctx.lineWidth = lw;
          ctx.strokeStyle = stroke;
          ctx.globalAlpha = lw > 1 ? 1 : 0.7;
          ctx.strokeRect(cx(c) + lw / 2, cy(r) + lw / 2, cw - lw, ch - lw);
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        }
      }

      // ---- 머리글
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = T.fgFaint;
      for (c = c0; c < c0 + g.visCols && c < model.cols; c++) {
        var chx = cx(c) + cw / 2;
        if (model.colSub) {
          ctx.fillStyle = T.fg;
          ctx.font = '700 12px system-ui, -apple-system, sans-serif';
          ctx.fillText(model.colLab[c], chx, g.oy - g.headH + 9);
          ctx.fillStyle = T.fgFaint;
          ctx.font = '500 10px system-ui, -apple-system, sans-serif';
          ctx.fillText(model.colSub[c], chx, g.oy - g.headH + 22);
        } else {
          ctx.fillText(model.colLab[c], chx, g.oy - g.headH / 2 - 1);
        }
      }
      for (r = 0; r < model.rows; r++) {
        var hy = cy(r) + ch / 2;
        var hx = g.ox - g.headW / 2;
        ctx.fillStyle = T.fg;
        ctx.font = '700 11px system-ui, -apple-system, sans-serif';
        if (model.rowSub) {
          ctx.fillText(model.rowLab[r], hx, hy - 6);
          ctx.fillStyle = T.fgFaint;
          ctx.font = '500 9px system-ui, -apple-system, sans-serif';
          ctx.fillText(model.rowSub[r], hx, hy + 6);
        } else {
          ctx.fillText(model.rowLab[r], hx, hy);
        }
      }
      // 잘린 방향 표시
      ctx.fillStyle = T.fgFaint;
      ctx.font = '600 11px system-ui, sans-serif';
      // 표를 가운데 정렬하면 잘림 표시가 캔버스 밖으로 나갈 수 있어 안쪽으로 당긴다
      if (c0 > 0) ctx.fillText('◂', Math.max(5, g.ox - 6), g.oy - g.headH / 2 - 1);
      if (c0 + g.visCols < model.cols) ctx.fillText('▸', Math.min(size.w - 5, g.ox + g.visCols * cw + 6), g.oy - g.headH / 2 - 1);
      // 모서리 라벨
      if (model.corner) {
        ctx.fillStyle = T.fgFaint;
        ctx.font = '500 10px system-ui, sans-serif';
        ctx.fillText(model.corner, g.ox - g.headW / 2, g.oy - g.headH / 2 - 1);
      }

      // ---- 화살표: 읽은 칸 → 쓰는 칸. 이 위젯의 본체다.
      if (st.acts.length === 1 && st.reads.length) {
        var tr = st.acts[0][0], tc = st.acts[0][1];
        for (var q = 0; q < st.reads.length; q++) {
          arrow(ctx, T, g, c0, st.reads[q][0], st.reads[q][1], tr, tc, !!st.reads[q][2]);
        }
      }

      // ---- 값: 화살표 위에 배경색 테두리를 두르고 올린다
      for (r = 0; r < model.rows; r++) {
        for (c = c0; c < c0 + g.visCols && c < model.cols; c++) {
          k = r * model.cols + c;
          if (model.mask && !model.mask[k]) continue;
          if (model.wall && model.wall[k]) {
            ctx.font = '700 ' + Math.round(ch * 0.5) + 'px system-ui, sans-serif';
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = T.bg;
            ctx.fillText('×', cx(c) + cw / 2, cy(r) + ch / 2);
            ctx.globalAlpha = 1;
            continue;
          }
          if (!st.has[k]) continue;
          var v = st.vals[k];
          var txt = String(v);
          var isAct = false;
          for (var z = 0; z < st.acts.length; z++) if (st.acts[z][0] === r && st.acts[z][1] === c) { isAct = true; break; }
          var base = Math.max(9, Math.min(15, Math.round(ch * 0.46)));
          fitFont(ctx, txt, cw - 5, base, isAct ? '800' : '600');
          var tx2 = cx(c) + cw / 2, ty2 = cy(r) + ch / 2;
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = T.bg;
          ctx.globalAlpha = 0.88;
          ctx.strokeText(txt, tx2, ty2);
          ctx.globalAlpha = 1;
          ctx.fillStyle = model.inputRow === r ? T.fgDim : T.fg;
          ctx.fillText(txt, tx2, ty2);

          // 답의 조각을 채택한 칸에는 점을 하나 찍는다 (색 없이도 구분되게)
          if (model.mark[k] && model.pathIndex[k] >= 0 && model.pathIndex[k] < st.pathLen) {
            ctx.beginPath();
            ctx.arc(cx(c) + cw - 5, cy(r) + 5, 2.6, 0, Math.PI * 2);
            ctx.fillStyle = T.wPath;
            ctx.fill();
          }
        }
      }
    }

    // 화살표 하나. bow(활 모양)를 주는 이유: 같은 행·열 안에서 먼 칸을 읽는
    // 경우(구간 DP, LIS) 직선으로 그으면 중간 칸의 숫자를 정확히 관통한다.
    function arrow(ctx, T, g, c0, sr, sc, tr, tc, used) {
      var cw = g.cw, ch = g.ch;
      function cxc(c) { return g.ox + (c - c0) * cw + cw / 2; }
      function cyc(r) { return g.oy + r * ch + ch / 2; }
      var clipped = 0;
      var sx = cxc(sc), sy = cyc(sr);
      if (sc < c0) { sx = g.ox - 7; clipped = -1; }
      else if (sc >= c0 + g.visCols) { sx = g.ox + g.visCols * cw + 7; clipped = 1; }
      var tx = cxc(tc), ty = cyc(tr);

      var p1, p2;
      var hw = Math.min(cw * 0.40, 13);
      var hh = Math.min(ch * 0.28, 9);
      if (model.kind === 'lis') {
        // 한 줄짜리 표라 셀 아래 띠에 활을 건다. 숫자를 전혀 건드리지 않는다.
        p1 = { x: sx, y: sy + ch / 2 - 2 };
        p2 = { x: tx, y: ty + ch / 2 - 2 };
      } else {
        // 셀 경계가 아니라 **숫자를 감싸는 상자**를 기준으로 시작·끝을 잡는다.
        // 경계 기준으로 잡으면 이웃한 두 칸은 변을 공유하므로 화살표 길이가 0 이
        // 되어 버린다(대각선 참조가 통째로 사라진다). 숫자만 피하면 화살표는
        // 셀 경계를 가로질러 "이 칸이 저 칸을 읽는다"가 그대로 보인다.
        // 도착 쪽 여유를 출발 쪽보다 좁게 잡는다. 이웃한 두 칸 사이는 남는 거리가
        // 얼마 없어서, 양쪽을 똑같이 띄우면 화살촉만 남고 방향이 안 읽힌다.
        // 도착 숫자는 halo 로 다시 덮어 그리므로 조금 파고들어도 가려지지 않는다.
        var hw = Math.min(cw * 0.40, 13);
        var hh = Math.min(ch * 0.28, 9);
        var dx = tx - sx, dy = ty - sy;
        p1 = clipped ? { x: sx, y: sy } : boxEdge(sx, sy, hw + 1.5, hh + 1.5, dx, dy);
        p2 = boxEdge(tx, ty, hw * 0.75 + 2, hh * 0.75 + 2, -dx, -dy);
      }

      var vx = p2.x - p1.x, vy = p2.y - p1.y;
      var len = Math.sqrt(vx * vx + vy * vy);
      if (len < 0.5) return;
      var bow;
      // 같은 행·열에서 멀리 떨어진 칸을 읽는 경우(구간 DP)는 사이에 낀 칸의 숫자를
      // 정면으로 지나간다. 그때만 활을 크게 휘어 숫자 상자 밖으로 빼낸다.
      // 2차 베지에의 최고점은 제어점 변위의 절반이므로 필요한 여유의 두 배를 준다.
      var sameRow = sr === tr, sameCol = sc === tc;
      var farInLine = (sameRow && len > cw * 1.4) || (sameCol && len > ch * 1.4);
      if (model.kind === 'lis') bow = Math.min(ch * 0.9, 12 + len * 0.10);
      else if (farInLine) bow = 2 * ((sameRow ? hh : hw) + 6);
      else bow = Math.min(ch * 0.42, len * 0.14);
      // 수직(-90도) 회전 벡터. 오른쪽 방향 화살표는 위로, 위쪽 방향은 왼쪽으로 휜다.
      var px = (vy / len) * bow, py = (-vx / len) * bow;
      if (model.kind === 'lis') { px = 0; py = bow; }
      var mx = (p1.x + p2.x) / 2 + px, my = (p1.y + p2.y) / 2 + py;

      ctx.save();
      ctx.strokeStyle = used ? T.wStart : T.fgDim;
      // 비교만 한 항의 화살표는 좁은 폭에서 아주 짧아진다. 너무 흐리면 아예 안 보여서
      // "두 항을 비교했다"는 사실 자체가 사라지므로 농도를 충분히 남긴다.
      ctx.globalAlpha = used ? 0.95 : 0.75;
      ctx.lineWidth = used ? 2 : 1.7;
      ctx.setLineDash(used ? [] : [3.5, 2.5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(mx, my, p2.x, p2.y);
      ctx.stroke();

      // 화살촉: 곡선의 끝 접선(= 제어점 → 끝점) 방향으로 붙인다
      var ax = p2.x - mx, ay = p2.y - my;
      var al = Math.sqrt(ax * ax + ay * ay) || 1;
      ax /= al; ay /= al;
      // 짧은 화살표에 큰 화살촉을 달면 촉만 남아 방향이 안 읽힌다. 길이에 맞춘다.
      var hs = Math.max(4.5, Math.min(used ? 7.5 : 6.5, len * 0.55));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - ax * hs - ay * hs * 0.5, p2.y - ay * hs + ax * hs * 0.5);
      ctx.lineTo(p2.x - ax * hs + ay * hs * 0.5, p2.y - ay * hs - ax * hs * 0.5);
      ctx.closePath();
      ctx.fillStyle = used ? T.wStart : T.fgDim;
      ctx.fill();

      // 창 밖의 칸에서 온 화살표는 어느 열에서 왔는지 글자로 남긴다
      if (clipped) {
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.font = '600 9px system-ui, sans-serif';
        ctx.fillStyle = T.fgFaint;
        ctx.textAlign = clipped < 0 ? 'right' : 'left';
        ctx.fillText('c' + sc, p1.x + (clipped < 0 ? -2 : 2), p1.y);
        ctx.textAlign = 'center';
      }
      ctx.restore();
    }

    var cv = K.canvas(ui.stage, { height: heightFor, draw: draw });

    var pl = K.player(ui, {
      total: function () { return model.steps.length; },
      render: function (i) { idx = i; cv.redraw(); },
      label: function (i) {
        var st = model.steps[Math.max(0, Math.min(i, model.steps.length - 1))];
        return st ? st.label : '';
      },
      speed: 520
    });

    // 검증(계약 §8)에서 최종 값과 역추적 결과를 브루트포스와 대조할 수 있게
    // 모델을 호스트 요소에 매달아 둔다. 전역은 건드리지 않는다.
    host._dpTable = model;

    pl.draw();
  }

  K.register('dp-table', widget);
})();

/* ==== dstar-replan.js ==== */
/* dstar-replan.js — 지도가 바뀐 뒤, 무엇을 버리고 무엇을 살리는가
 *
 * 이 위젯이 증명하려는 명제는 두 줄이다.
 *   ① **답은 같다.** 전체 재계산과 증분 갱신의 경로 비용은 언제나 일치한다.
 *   ② **계산량만 갈린다.** 증분 갱신은 "답이 얼마나 바뀌었는가" 만큼만 일한다.
 * 그래서 두 패널이 같은 지도·같은 발견 시점을 공유하고, 스텝 인덱스 하나가
 * 둘을 동시에 민다. 왼쪽이 293칸을 버리고 253칸을 새로 펼치는 동안 오른쪽은
 * 다섯 칸을 고치고 멈춘다 — 그 대비는 산문으로 만들어지지 않는다(CLAUDE.md §4-1).
 *
 * 왜 "믿는 지도" 와 "실제 지도" 를 따로 두는가
 *   walls 는 로봇이 들고 출발한 지도이고 unknown 은 그 지도에 없는 진짜 벽이다.
 *   두 장이 없으면 **발견** 이라는 사건 자체가 성립하지 않고, 발견이 없으면
 *   재계획도 없다. 미지의 벽은 발견 전에는 점선으로만 그린다 — 독자는 알고
 *   로봇은 모르는 상태를 화면에 그대로 만든다.
 *
 * 왜 로봇을 몇 칸 걷게 하는가
 *   D* Lite 가 LPA* 에 더한 것이 정확히 두 가지인데(목표에서 거꾸로 풀기, k_m),
 *   **시작점이 움직이지 않으면 k_m 이 할 일이 없다.** revealAfter 칸을 전진한
 *   뒤에 발견이 일어나야 k_m += h(s_last, s_start) 가 실제로 무언가를 보정한다.
 *
 * 왜 국소 불일치를 색이 아니라 "모양까지" 로 구분하는가
 *   본문 §2.1 의 주장은 "우선순위 큐에 들어 있는 것이 곧 어긋난 정점" 이다.
 *   그것을 화면에서 확인시키려면 어긋남의 **방향**(g>rhs 인가 g<rhs 인가)까지
 *   보여야 한다. 두 방향은 처리가 완전히 다르고(값을 내린다 / 버리고 다시 잰다),
 *   underconsistent 정점이 두 번 확장되는 이유가 거기서 나온다. 그래서 아래
 *   삼각형(값을 내린다)과 위 삼각형(값을 버린다)으로 나눠 그린다 — 색을
 *   구분하지 못해도 방향이 읽힌다(계약 §5).
 *
 * 왜 이전 단계의 확장 자국을 지우지 않는가
 *   A* 패널은 그것을 **아주 흐리게**(버렸다), D* Lite 패널은 **또렷하게**(살렸다)
 *   남긴다. 재계획 국면에서 두 패널의 차이는 새로 칠해지는 넓이만이 아니라
 *   "이전 계산이 아직 자산인가" 다. 알파 두 단계가 그 문장을 대신한다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // ─── 상수 ────────────────────────────────────────────────────────────────

  var INF = Infinity;
  var DIM_MIN = 6, DIM_MAX = 40;
  var MAX_CELLS = 720;      // 이 위에서는 확장 스텝이 수천이 되어 재생이 무의미해진다(계약 §7)
  var MAX_FRAMES = 2400;    // 스텝 상한. 넘으면 기록을 잘라낸다

  var MIN_CELL = 9;         // 이 아래로 내려가면 삼각형 표식이 뭉갠다 → 세로 스택으로 간다
  var MAX_CELL = 24;
  var HEAD = 38;            // 패널 머리 두 줄(이름+규칙 / 카운터)
  var PAD = 5;
  var GAP = 14;
  var SUM_H = 48;           // 결론 줄. 이 위젯의 결론이 여기 적힌다
  var MAX_H_SIDE = 560;
  var MAX_H_STACK = 420;
  var SIDE_MIN_W = 700;     // 이 아래는 두 패널을 세로로 쌓는다(계약 §4)

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  /* 4-이웃 고정. 맨해튼 휴리스틱의 허용성이 대각 이동이 없다는 전제 위에서만
   * 성립하고, D* Lite 의 키 보정(k_m)은 h 의 삼각부등식을 요구한다. 8-이웃으로
   * 늘리면 두 전제가 동시에 깨진다. 본문 ::: dual 코드도 4-이웃이다. */
  var DR = [-1, 0, 1, 0];
  var DC = [0, 1, 0, -1];

  var PANELS = ['astar-replan', 'dstar-lite'];
  var PANEL_NAME = { 'astar-replan': 'A* 전체 재계산', 'dstar-lite': 'D* Lite' };
  var PANEL_RULE = {
    'astar-replan': '지도가 바뀌면 처음부터',
    'dstar-lite': '목표에서 거꾸로 · 어긋난 곳만'
  };

  var COUNTERS = ['expanded', 'pathCost'];
  var HIGHLIGHTS = ['inconsistent', 'none'];
  var STEP_MODES = ['expansion', 'phase'];

  // 국면. 스텝 인덱스는 이 다섯 구간으로 쪼개진다.
  var PH_PLAN = 0, PH_MOVE = 1, PH_REVEAL = 2, PH_REPLAN = 3, PH_DONE = 4;
  var PHASE_LABEL = ['최초 계획', '로봇 전진', '장애물 발견', '재계획', '완료'];

  // 국소 불일치 상태
  var ST_OK = 0, ST_OVER = 1, ST_UNDER = 2;

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(v, list, dflt) {
    for (var i = 0; i < list.length; i++) if (v === list[i]) return v;
    return dflt;
  }

  function fmt(v) { return (v === INF || v == null) ? '∞' : String(v); }

  // ─── 이진 힙 ─────────────────────────────────────────────────────────────

  /* 항목: [k1, k2, seq, cell]. seq(삽입 순번)까지 비교해 동점을 결정론적으로 깬다.
   * 동점이 실행마다 다르게 깨지면 "같은 인덱스에 같은 그림"(계약 §7)이 무너진다. */
  function Heap() { this.a = []; }
  Heap.prototype.less = function (x, y) {
    if (x[0] !== y[0]) return x[0] < y[0];
    if (x[1] !== y[1]) return x[1] < y[1];
    return x[2] < y[2];
  };
  Heap.prototype.push = function (e) {
    var a = this.a, i = a.length;
    a.push(e);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      var t = a[i]; a[i] = a[p]; a[p] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0, n = a.length;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, m = i;
        if (l < n && this.less(a[l], a[m])) m = l;
        if (r < n && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        var t = a[i]; a[i] = a[m]; a[m] = t;
        i = m;
      }
    }
    return top;
  };

  // ─── 벽 프리셋 ───────────────────────────────────────────────────────────

  /* "rooms" 가 기본값이자 본문이 쓰는 배치다. 세로 칸막이 두 장 + 문 두 개 —
   * 우회는 필요하되 막다른 길은 없다. 막다른 길이 많은 미로는 발견 하나가
   * 답을 통째로 뒤집어 증분 탐색의 전제("변화가 작다")를 깨므로 여기서는 쓰지 않는다. */
  var PRESETS = ['open', 'rooms', 'spiral'];

  function buildWalls(rows, cols, spec) {
    var wall = new Uint8Array(rows * cols);
    function set(r, c) { if (r >= 0 && r < rows && c >= 0 && c < cols) wall[r * cols + c] = 1; }
    function clr(r, c) { if (r >= 0 && r < rows && c >= 0 && c < cols) wall[r * cols + c] = 0; }

    if (isArr(spec)) {
      for (var i = 0; i < spec.length; i++) {
        var p = spec[i];
        if (!isArr(p)) continue;
        var r = clampInt(p[0], 0, rows - 1, -1), c = clampInt(p[1], 0, cols - 1, -1);
        if (r >= 0 && c >= 0) set(r, c);
      }
      return wall;
    }

    var name = oneOf(spec, PRESETS, 'rooms');
    if (name === 'rooms') {
      var c1 = Math.floor(cols / 3), c2 = Math.floor((cols * 2) / 3);
      for (var rr = 0; rr < rows; rr++) { set(rr, c1); set(rr, c2); }
      var d1 = Math.floor(rows / 6), d2 = rows - 1 - Math.floor(rows / 6);
      clr(d1, c1); clr(d1 + 1, c1);
      clr(d2, c2); clr(d2 - 1, c2);
    } else if (name === 'spiral') {
      for (var k = 2; k * 2 + 2 < Math.min(rows, cols); k += 2) {
        var r0 = k, r1 = rows - 1 - k, c0 = k, cE = cols - 1 - k;
        for (var c3 = c0; c3 <= cE; c3++) { set(r0, c3); set(r1, c3); }
        for (var r2 = r0; r2 <= r1; r2++) { set(r2, c0); set(r2, cE); }
        var mid = Math.floor((c0 + cE) / 2);
        if ((k / 2) % 2 === 0) { clr(r1, mid); clr(r1, mid + 1); }
        else { clr(r0, mid); clr(r0, mid + 1); }
      }
    }
    return wall;
  }

  // ─── A* (전체 재계산 쪽) ─────────────────────────────────────────────────

  /* 본문 ::: dual 의 astar() 와 같은 알고리즘이다. 다른 것은 화면에 필요한
   * 기록(확장 순서·열린 목록 변화)을 남긴다는 것뿐이다.
   *   firstAt[c]  c 가 처음 확장된 순번(1기준). 0 이면 확장된 적 없음
   *   openEv[c]   [순번, 0|1, ...] 열린 목록 소속이 바뀐 시점. 프레임 왕복을
   *               위해 스냅샷 대신 변화만 남긴다(계약 §7) */
  function runAStar(wall, rows, cols, start, goal) {
    var n = rows * cols;
    var gr = (goal / cols) | 0, gc = goal % cols;
    function h(c) { return Math.abs(((c / cols) | 0) - gr) + Math.abs((c % cols) - gc); }

    var g = new Float64Array(n); g.fill(INF);
    var parent = new Int32Array(n); parent.fill(-1);
    var closed = new Uint8Array(n);
    var inOpen = new Uint8Array(n);
    var firstAt = new Int32Array(n);
    var openEv = new Array(n);
    var order = [];
    var heap = new Heap(), seq = 0, t = 0;

    function note(c, on) {
      if (inOpen[c] === on) return;
      inOpen[c] = on;
      var a = openEv[c] || (openEv[c] = []);
      if (a.length && a[a.length - 2] === t) a[a.length - 1] = on;
      else a.push(t, on);
    }

    if (!wall[start]) {
      g[start] = 0;
      heap.push([h(start), 0, seq++, start]);
      note(start, 1);
    }

    while (heap.a.length && order.length < MAX_CELLS * 2) {
      var e = heap.pop(), u = e[3];
      if (closed[u]) continue;      // 낡은 항목. 화면에서 아무 일도 안 일어나므로 스텝을 소비하지 않는다
      closed[u] = 1;
      t += 1;
      firstAt[u] = t;
      order.push(u);
      note(u, 0);
      if (u === goal) break;
      var r = (u / cols) | 0, c = u % cols;
      for (var d = 0; d < 4; d++) {
        var nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var v = nr * cols + nc;
        if (wall[v] || closed[v]) continue;
        if (g[u] + 1 < g[v]) {
          g[v] = g[u] + 1;
          parent[v] = u;
          heap.push([g[v] + h(v), g[v], seq++, v]);
          note(v, 1);
        }
      }
    }

    var path = null, cost = INF;
    if (closed[goal]) {
      path = [];
      var cur = goal, guard = n + 2;
      while (cur !== -1 && guard-- > 0) { path.push(cur); if (cur === start) break; cur = parent[cur]; }
      path.reverse();
      if (path[0] !== start) path = null; else cost = path.length - 1;
    }
    return {
      order: order, firstAt: firstAt, openEv: openEv,
      g: g, expanded: order.length, path: path, cost: cost
    };
  }

  // ─── D* Lite ─────────────────────────────────────────────────────────────

  /* 본문 ::: dual 의 DStarLite 클래스와 같은 알고리즘이다.
   *   key(s) = [ min(g,rhs) + h(start,s) + km , min(g,rhs) ]
   *   목표에서 거꾸로 푼다. g(u) 는 "u 에서 목표까지" 의 비용이다.
   *   best[] 대신 bk0/bk1/inq 세 배열을 쓴다 — 자바스크립트에서 튜플 비교를
   *   피하려는 것뿐이고 의미는 같다(큐에 들어 있는 최신 키). */
  function DStar(wall, rows, cols, start, goal) {
    var n = rows * cols;
    this.wall = wall; this.rows = rows; this.cols = cols;
    this.start = start; this.goal = goal; this.km = 0;
    this.g = new Float64Array(n); this.g.fill(INF);
    this.rhs = new Float64Array(n); this.rhs.fill(INF);
    this.bk0 = new Float64Array(n); this.bk0.fill(INF);
    this.bk1 = new Float64Array(n); this.bk1.fill(INF);
    this.inq = new Uint8Array(n);
    this.heap = new Heap();
    this.seq = 0;
    this.expanded = 0;

    // 화면 기록
    this.state = new Uint8Array(n);          // 지금의 국소 불일치 상태
    this.stEv = new Array(n);                // [프레임, 상태, ...] 변화만 남긴다
    this.frame = 0;                          // 지금 기록 중인 전역 프레임
    this.order = [];                         // 확장 순서(국면 구분은 밖에서 한다)

    this.rhs[goal] = 0;
    this.push(goal);
    this.note(goal);
  }

  DStar.prototype.h = function (a, b) {
    return Math.abs(((a / this.cols) | 0) - ((b / this.cols) | 0)) +
           Math.abs((a % this.cols) - (b % this.cols));
  };
  DStar.prototype.key0 = function (s) {
    var m = Math.min(this.g[s], this.rhs[s]);
    return m + this.h(this.start, s) + this.km;
  };
  DStar.prototype.key1 = function (s) { return Math.min(this.g[s], this.rhs[s]); };
  DStar.prototype.lessKey = function (a0, a1, b0, b1) { return a0 < b0 || (a0 === b0 && a1 < b1); };

  DStar.prototype.push = function (s) {
    var k0 = this.key0(s), k1 = this.key1(s);
    this.bk0[s] = k0; this.bk1[s] = k1; this.inq[s] = 1;
    this.heap.push([k0, k1, this.seq++, s]);
  };

  DStar.prototype.top = function () {
    while (this.heap.a.length) {
      var e = this.heap.a[0], s = e[3];
      // 지연 삭제. best 배열의 최신 키와 다르면 낡은 항목이다.
      if (!this.inq[s] || this.bk0[s] !== e[0] || this.bk1[s] !== e[1]) { this.heap.pop(); continue; }
      return e;
    }
    return null;
  };

  // 국소 불일치 상태가 바뀌었으면 기록한다. 렌더는 이 목록만 뒤진다.
  DStar.prototype.note = function (c) {
    var s = (this.g[c] === this.rhs[c]) ? ST_OK : (this.g[c] > this.rhs[c] ? ST_OVER : ST_UNDER);
    if (s === this.state[c]) return;
    this.state[c] = s;
    var a = this.stEv[c] || (this.stEv[c] = []);
    if (a.length && a[a.length - 2] === this.frame) a[a.length - 1] = s;
    else a.push(this.frame, s);
  };

  /* rhs(u) 를 이웃의 g 로 다시 재고, g 와 어긋나면 큐에 넣는다.
   * 벽이 된 칸은 rhs = ∞ 다 — 들어가는 간선이 전부 끊긴 것이다. */
  DStar.prototype.update = function (u) {
    if (u !== this.goal) {
      var b = INF;
      if (!this.wall[u]) {
        var r = (u / this.cols) | 0, c = u % this.cols;
        for (var d = 0; d < 4; d++) {
          var nr = r + DR[d], nc = c + DC[d];
          if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
          var v = nr * this.cols + nc;
          if (this.wall[v] || this.g[v] >= INF) continue;
          if (this.g[v] + 1 < b) b = this.g[v] + 1;
        }
      }
      this.rhs[u] = b;
    }
    this.inq[u] = 0;
    if (this.g[u] !== this.rhs[u]) this.push(u);
    this.note(u);
  };

  /* 종료 조건은 "큐가 빌 때까지" 가 아니다. 시작점보다 먼 곳의 불일치는
   * 답에 영향을 주지 않으므로 어긋난 채로 남겨 둔다 — 그래서 계산이 끝난
   * 뒤에도 큐가 비어 있지 않은 것이 정상이다(본문 §2.2). */
  DStar.prototype.compute = function (frameOf, log, info) {
    var guard = MAX_CELLS * 6;
    for (;;) {
      var e = this.top();
      if (!e) break;
      if (guard-- <= 0) break;
      var u = e[3], k0 = e[0], k1 = e[1];
      if (!(this.lessKey(k0, k1, this.key0(this.start), this.key1(this.start)) ||
            this.rhs[this.start] > this.g[this.start])) break;
      this.heap.pop();
      this.inq[u] = 0;
      if (this.lessKey(k0, k1, this.key0(u), this.key1(u))) {
        this.push(u);          // 키만 낡았다. 다시 넣는다 — 확장이 아니다
        continue;
      }
      this.expanded += 1;
      var localIdx = log.length + 1;
      this.frame = frameOf(localIdx);
      log.push(u);
      if (this.g[u] > this.rhs[u]) {
        this.g[u] = this.rhs[u];   // overconsistent → 더 싼 길이 생겼다. 값을 확정한다
        this.note(u);
        // 그 스텝에서 실제로 무슨 값이 되었는지를 남긴다. 상태 줄이 나중 값을
        // 읽어 버리면 되감았을 때 화면과 문장이 어긋난다.
        info.push({ kind: 'over', g: this.g[u] });
      } else {
        this.g[u] = INF;           // underconsistent → 길이 사라졌다. 버리고 자신부터 다시 잰다
        this.update(u);
        info.push({ kind: 'under', g: INF });
      }
      var r = (u / this.cols) | 0, c = u % this.cols;
      for (var d = 0; d < 4; d++) {
        var nr = r + DR[d], nc = c + DC[d];
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) this.update(nr * this.cols + nc);
      }
    }
  };

  DStar.prototype.cost = function () { return Math.min(this.g[this.start], this.rhs[this.start]); };

  /* 경로를 들고 다니지 않는다. c(s,s') + g(s') 가 가장 작은 이웃으로 한 칸씩
   * 내려가면 그것이 최단경로다 — 목표에서 거꾸로 푸는 것의 배당금이다. */
  DStar.prototype.descend = function (from) {
    var path = [from], cur = from, guard = this.rows * this.cols + 4;
    while (cur !== this.goal && guard-- > 0) {
      var best = INF, bs = -1;
      var r = (cur / this.cols) | 0, c = cur % this.cols;
      for (var d = 0; d < 4; d++) {
        var nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        var v = nr * this.cols + nc;
        if (this.wall[v] || this.g[v] >= INF) continue;
        if (this.g[v] + 1 < best) { best = this.g[v] + 1; bs = v; }
      }
      if (bs < 0) return null;
      path.push(bs);
      cur = bs;
    }
    return cur === this.goal ? path : null;
  };

  // 큐(유효 항목)와 국소 불일치 집합이 정말 같은가. 본문 §2.1 의 주장 자체다.
  DStar.prototype.auditQueue = function () {
    var n = this.rows * this.cols;
    for (var i = 0; i < n; i++) {
      var incon = this.g[i] !== this.rhs[i];
      if (!!this.inq[i] !== incon) return false;
    }
    return true;
  };

  /* 화면에 금색으로 그리는 것은 "답" 이다. 실제로 걸을 수 있는 칸의 연속이
   * 아니면 그것은 답이 아니라 그림이다. 네 이웃 인접인지·벽을 밟지 않는지를
   * 시뮬레이션 단계에서 확인한다(계약 §9). */
  function pathValid(path, wall, cols, from, to) {
    if (!path) return true;                       // 경로 없음은 거짓말이 아니다
    if (path[0] !== from || path[path.length - 1] !== to) return false;
    for (var i = 0; i < path.length; i++) {
      if (wall[path[i]]) return false;
      if (i === 0) continue;
      var a = path[i - 1], b = path[i];
      var dr = Math.abs(((a / cols) | 0) - ((b / cols) | 0));
      var dc = Math.abs((a % cols) - (b % cols));
      if (dr + dc !== 1) return false;
    }
    return true;
  }

  // 상태 목록에서 프레임 f 시점의 값을 꺼낸다. 목록은 보통 길이 0~8이라 뒤에서 훑는다.
  function evAt(list, f) {
    if (!list) return 0;
    for (var i = list.length - 2; i >= 0; i -= 2) if (list[i] <= f) return list[i + 1];
    return 0;
  }

  // ─── 시나리오 시뮬레이션 ─────────────────────────────────────────────────

  /* 국면과 프레임의 대응 (steps:"expansion" 기준)
   *   [0 .. P0]                      최초 계획. 프레임 k = 양쪽 확장 k 회씩
   *   [P0+1 .. P0+M]                 로봇 전진 M 칸
   *   [P0+M+1]                       발견. 지도를 고치고 k_m 을 보정한다
   *   [P0+M+2 .. P0+M+2+P1]          재계획. 프레임 = 재계획 확장 k 회씩
   *   [마지막]                        완료
   * P0 = max(A* 최초 확장, D* Lite 최초 확장), P1 = max(재계획 확장) */
  function simulate(cfg) {
    var rows = cfg.rows, cols = cfg.cols, n = rows * cols;
    var start = cfg.start, goal = cfg.goal;

    var believed = cfg.believed;                    // 로봇이 들고 출발한 지도
    var truth = new Uint8Array(believed);
    for (var i = 0; i < cfg.unknown.length; i++) truth[cfg.unknown[i]] = 1;

    // ① 최초 계획 — 양쪽 모두 "믿는 지도" 위에서
    var a0 = runAStar(believed, rows, cols, start, goal);
    var ds = new DStar(new Uint8Array(believed), rows, cols, start, goal);
    var dOrd0 = [], dInfo0 = [];
    ds.compute(function (k) { return k; }, dOrd0, dInfo0);
    var dCost0 = ds.cost();
    var dPath0 = ds.descend(start);
    var qOk = ds.auditQueue();

    var P0 = Math.max(a0.expanded, dOrd0.length);

    // ② 로봇 전진 — A* 가 세운 경로를 실제로 실행한다.
    //    로봇이 A* 의 계획 위에 있어야 두 패널의 경로가 같은 칸(로봇)에서 출발한다.
    var robotPath = a0.path || [start];
    var M = Math.min(cfg.revealAfter, Math.max(0, robotPath.length - 2));
    var trail = [];
    for (var m = 0; m <= M; m++) trail.push(robotPath[m]);
    var robot = trail[M];

    // 이동 중 각 위치에서 두 패널의 남은 비용이 같은지 확인한다(§9 — 위젯이 거짓말하지 않는다)
    var moveCostOk = true, movePaths = [];
    for (var mm = 0; mm <= M; mm++) {
      var dp = ds.descend(trail[mm]);
      movePaths.push(dp);
      var aRemain = a0.path ? (a0.path.length - 1 - mm) : INF;
      var dRemain = dp ? dp.length - 1 : INF;
      if (aRemain !== dRemain) moveCostOk = false;
    }

    // ③ 발견 — 본문 ::: dual 과 같은 순서다.
    //    k_m 을 먼저 올리고, 바뀐 칸과 그 이웃을 갱신한다.
    var revealFrame = P0 + M + 1;
    ds.frame = revealFrame;
    ds.start = robot;
    ds.km += ds.h(trail[0], robot);
    var revealed = [];
    for (var u = 0; u < cfg.unknown.length; u++) {
      var cell = cfg.unknown[u];
      if (believed[cell]) continue;         // 이미 알던 벽이면 발견이 아니다
      ds.wall[cell] = 1;
      revealed.push(cell);
    }
    for (var v = 0; v < revealed.length; v++) {
      var cc = revealed[v];
      ds.update(cc);
      var r0 = (cc / cols) | 0, c0 = cc % cols;
      for (var d0 = 0; d0 < 4; d0++) {
        var nr0 = r0 + DR[d0], nc0 = c0 + DC[d0];
        if (nr0 >= 0 && nr0 < rows && nc0 >= 0 && nc0 < cols) ds.update(nr0 * cols + nc0);
      }
    }
    var brokeCount = 0;
    for (var q = 0; q < n; q++) if (ds.g[q] !== ds.rhs[q]) brokeCount++;

    // ④ 재계획
    var a1 = runAStar(truth, rows, cols, robot, goal);
    var dOrd1 = [], dInfo1 = [];
    ds.compute(function (k) { return revealFrame + 1 + k; }, dOrd1, dInfo1);
    if (qOk) qOk = ds.auditQueue();
    var dCost1 = ds.cost();
    var dPath1 = ds.descend(robot);

    var P1 = Math.max(a1.expanded, dOrd1.length);

    // 화면에 쓸 "국면별 첫 확장 순번" 배열
    function firstAtOf(order) {
      var arr = new Int32Array(n);
      for (var i2 = 0; i2 < order.length; i2++) if (!arr[order[i2]]) arr[order[i2]] = i2 + 1;
      return arr;
    }

    var costPlanOk = (a0.cost === dCost0) && (!dPath0 || dPath0.length - 1 === a0.cost);
    var costReplanOk = (a1.cost === dCost1) && (!dPath1 || dPath1.length - 1 === a1.cost);

    var pathOk = pathValid(a0.path, believed, cols, start, goal) &&
                 pathValid(dPath0, believed, cols, start, goal) &&
                 pathValid(a1.path, truth, cols, robot, goal) &&
                 pathValid(dPath1, truth, cols, robot, goal);
    for (var pv = 0; pv <= M && pathOk; pv++) {
      pathOk = pathValid(movePaths[pv], believed, cols, trail[pv], goal);
    }

    return {
      rows: rows, cols: cols, start: start, goal: goal,
      believed: believed, truth: truth, revealed: revealed,
      a0: a0, a1: a1,
      d: {
        ord0: dOrd0, first0: firstAtOf(dOrd0), info0: dInfo0,
        ord1: dOrd1, first1: firstAtOf(dOrd1), info1: dInfo1,
        stEv: ds.stEv, cost0: dCost0, cost1: dCost1,
        path0: dPath0, path1: dPath1, km: ds.km
      },
      trail: trail, movePaths: movePaths, robot: robot, M: M,
      brokeCount: brokeCount,
      P0: P0, P1: P1, revealFrame: revealFrame,
      total: P0 + M + P1 + 4,
      audit: {
        costPlanOk: costPlanOk,
        costReplanOk: costReplanOk,
        moveCostOk: moveCostOk,
        pathWalkable: pathOk,
        queueIsInconsistentSet: qOk,
        costs: { plan: [a0.cost, dCost0], replan: [a1.cost, dCost1] },
        expanded: { plan: [a0.expanded, dOrd0.length], replan: [a1.expanded, dOrd1.length] },
        revealed: revealed.length,
        checks: 2 + (M + 1) + 2
      }
    };
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('dstar-replan', function (host, opts) {
    if (!opts || typeof opts !== 'object' || isArr(opts)) opts = {};

    // ---- opts 검증. 본문 저자가 손으로 쓴 JSON 이라 신뢰하지 않는다(계약 §1) ----
    var rows = clampInt(opts.rows, DIM_MIN, DIM_MAX, 18);
    var cols = clampInt(opts.cols, DIM_MIN, DIM_MAX, 26);
    while (rows * cols > MAX_CELLS) { if (rows >= cols) rows--; else cols--; }
    var n = rows * cols;

    function pickCell(v, dr, dc) {
      if (!isArr(v)) return dr * cols + dc;
      return clampInt(v[0], 0, rows - 1, dr) * cols + clampInt(v[1], 0, cols - 1, dc);
    }
    var start = pickCell(opts.start, (rows / 2) | 0, 1);
    var goal = pickCell(opts.goal, (rows / 2) | 0, cols - 2);
    if (start === goal) goal = (start + 1) % n;

    var panels = [];
    if (isArr(opts.panels)) {
      for (var pi = 0; pi < opts.panels.length; pi++) {
        var pk = opts.panels[pi];
        if (PANELS.indexOf(pk) >= 0 && panels.indexOf(pk) < 0) panels.push(pk);
      }
    }
    if (!panels.length) panels = PANELS.slice();

    var counters = [];
    if (isArr(opts.counters)) {
      for (var ci = 0; ci < opts.counters.length; ci++) {
        var ck = opts.counters[ci];
        if (COUNTERS.indexOf(ck) >= 0 && counters.indexOf(ck) < 0) counters.push(ck);
      }
    }
    if (!counters.length) counters = COUNTERS.slice();
    var showExp = counters.indexOf('expanded') >= 0;
    var showCost = counters.indexOf('pathCost') >= 0;

    var highlight = oneOf(opts.highlight, HIGHLIGHTS, 'inconsistent');
    var stepMode = oneOf(opts.steps, STEP_MODES, 'expansion');
    var revealAfter = clampInt(opts.revealAfter, 0, 40, 5);

    var believed = buildWalls(rows, cols, opts.walls);

    // unknown — "지도에 없지만 실제로는 벽" 인 칸. 이 위젯의 전제다.
    var unknown = [];
    if (isArr(opts.unknown)) {
      for (var ui = 0; ui < opts.unknown.length; ui++) {
        var up = opts.unknown[ui];
        if (!isArr(up)) continue;
        var ur = clampInt(up[0], 0, rows - 1, -1), uc = clampInt(up[1], 0, cols - 1, -1);
        if (ur < 0 || uc < 0) continue;
        var ucell = ur * cols + uc;
        if (ucell === start || ucell === goal) continue;
        if (unknown.indexOf(ucell) < 0) unknown.push(ucell);
      }
    }
    if (!unknown.length) {
      // 미지의 장애물이 없으면 발견도 재계획도 없다 — 위젯이 성립하지 않는다.
      // 목표 앞을 가로지르는 짧은 벽을 기본값으로 세운다.
      var mc = (cols / 2) | 0, mr = (rows / 2) | 0;
      for (var k2 = -2; k2 <= 2; k2++) {
        var cand = (mr + k2) * cols + mc;
        if (mr + k2 >= 0 && mr + k2 < rows && cand !== start && cand !== goal && !believed[cand]) unknown.push(cand);
      }
    }

    // 시작·목표는 벽일 수 없다. 사방이 막혀 있으면 한 칸 열어 준다.
    function openCell(c) {
      believed[c] = 0;
      var r = (c / cols) | 0, cc2 = c % cols, first = -1, free = false;
      for (var d = 0; d < 4; d++) {
        var nr = r + DR[d], nc = cc2 + DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var nb = nr * cols + nc;
        if (first < 0) first = nb;
        if (!believed[nb] && unknown.indexOf(nb) < 0) { free = true; break; }
      }
      if (!free && first >= 0) { believed[first] = 0; var ix = unknown.indexOf(first); if (ix >= 0) unknown.splice(ix, 1); }
    }
    openCell(start);
    openCell(goal);

    // ---- 시뮬레이션 ----
    var sim = null, frames = null, keyFrames = null, cur = 0, layout = null;
    var unknownMask = new Uint8Array(n);
    var showIncon = highlight === 'inconsistent';

    /* 프레임 표는 미리 전부 만든다. render(i) 는 그리기만 하므로 되감기가
     * 즉시 되고, 같은 i 는 언제나 같은 그림이다(계약 §7). */
    function buildFrames() {
      var total = Math.min(sim.total, MAX_FRAMES);
      var ph = new Uint8Array(total);
      var aK = new Int32Array(total);
      var dK = new Int32Array(total);
      var rb = new Int32Array(total);
      var P0 = sim.P0, M = sim.M, rf = sim.revealFrame;
      for (var i = 0; i < total; i++) {
        if (i <= P0) {
          ph[i] = PH_PLAN;
          aK[i] = Math.min(i, sim.a0.expanded);
          dK[i] = Math.min(i, sim.d.ord0.length);
          rb[i] = 0;
        } else if (i <= P0 + M) {
          ph[i] = PH_MOVE;
          aK[i] = sim.a0.expanded; dK[i] = sim.d.ord0.length;
          rb[i] = i - P0;
        } else if (i === rf) {
          ph[i] = PH_REVEAL;
          aK[i] = sim.a0.expanded; dK[i] = sim.d.ord0.length;
          rb[i] = M;
        } else if (i <= rf + 1 + sim.P1) {
          ph[i] = PH_REPLAN;
          var k = i - rf - 1;
          aK[i] = Math.min(k, sim.a1.expanded);
          dK[i] = Math.min(k, sim.d.ord1.length);
          rb[i] = M;
        } else {
          ph[i] = PH_DONE;
          aK[i] = sim.a1.expanded; dK[i] = sim.d.ord1.length;
          rb[i] = M;
        }
      }
      frames = { ph: ph, aK: aK, dK: dK, rb: rb, total: total };

      /* steps:"phase" 는 국면 경계만 남긴다. 확장 한 번씩 곱씹을 필요가 없고
       * 국면 대비만 보고 싶을 때 쓰는 모드다. */
      keyFrames = [0];
      var seen = {};
      for (var j = 0; j < total; j++) {
        var key = ph[j];
        if (!seen[key]) { seen[key] = 1; if (keyFrames[keyFrames.length - 1] !== j) keyFrames.push(j); }
      }
      // 각 국면의 마지막 프레임도 넣어야 "국면이 끝난 그림" 이 보인다
      var ends = [Math.min(P0, total - 1), Math.min(P0 + M, total - 1),
                  Math.min(rf, total - 1), Math.min(rf + 1 + sim.P1, total - 1), total - 1];
      for (var q2 = 0; q2 < ends.length; q2++) {
        if (ends[q2] >= 0 && keyFrames.indexOf(ends[q2]) < 0) keyFrames.push(ends[q2]);
      }
      keyFrames.sort(function (x, y) { return x - y; });
    }

    function recompute() {
      unknownMask = new Uint8Array(n);
      for (var q3 = 0; q3 < unknown.length; q3++) if (!believed[unknown[q3]]) unknownMask[unknown[q3]] = 1;
      sim = simulate({
        rows: rows, cols: cols, start: start, goal: goal,
        believed: believed, unknown: unknown.slice(), revealAfter: revealAfter
      });
      buildFrames();
      host.__dstarReplan = sim.audit;
      // 위젯이 본문과 다른 답을 내면 조용히 넘어가면 안 된다(계약 §9).
      if (window.console && (!sim.audit.costPlanOk || !sim.audit.costReplanOk ||
                             !sim.audit.moveCostOk || !sim.audit.pathWalkable ||
                             !sim.audit.queueIsInconsistentSet)) {
        console.warn('dstar-replan 자기검사 실패', sim.audit);
      }
    }
    recompute();

    function totalSteps() { return stepMode === 'phase' ? keyFrames.length : frames.total; }
    function frameOf(i) {
      if (stepMode === 'phase') return keyFrames[Math.max(0, Math.min(i, keyFrames.length - 1))] || 0;
      return Math.max(0, Math.min(i, frames.total - 1));
    }

    // ---- 껍데기 ----
    var ui = K.frame(host, { title: '지도가 바뀐 뒤 — 전체 재계산 vs 증분 갱신', wide: true });

    /* 국면 점프. 최초 계획만 300스텝이라 슬라이더로 국면 경계를 찾는 것은
     * 사실상 불가능하다. 이 위젯에서 볼 것은 "발견 직후" 와 "재계획 끝" 두 장면이다. */
    var jump = K.el('div', 'wk-seg');
    var jumpBtns = [];
    [['최초 계획', function () { return 0; }],
     ['전진', function () { return sim.P0 + 1; }],
     ['발견', function () { return sim.revealFrame; }],
     ['재계획', function () { return sim.revealFrame + 1; }],
     ['완료', function () { return frames.total - 1; }]].forEach(function (p, idx) {
      var b = K.el('button', 'wk-seg-btn', p[0]);
      b.type = 'button';
      b.addEventListener('click', function () {
        player.stop();
        var f = Math.max(0, Math.min(p[1](), frames.total - 1));
        player.goto(stepMode === 'phase' ? Math.min(idx, keyFrames.length - 1) : f);
      });
      jump.appendChild(b);
      jumpBtns.push(b);
    });
    ui.slot.appendChild(jump);

    /* 불일치 표식을 껐다 켜 보게 두는 이유: 표식을 끄면 D* Lite 패널이
     * 그냥 "확장이 적은 A*" 로 보인다. 켜는 순간 큐의 정체가 드러난다. */
    if (highlight === 'inconsistent') {
      K.seg(ui.slot, [
        { label: '불일치 표시', value: 'on' },
        { label: '끔', value: 'off' }
      ], 'on', function (v) { showIncon = v === 'on'; player.goto(cur); });
    }

    var legend = K.el('div', 'wk-legend');
    function legItem(cssVar, text) {
      var s = K.el('span');
      var ic = K.el('i');
      ic.style.background = 'var(' + cssVar + ')';
      s.appendChild(ic);
      s.appendChild(document.createTextNode(text));
      legend.appendChild(s);
    }
    legItem('--w-start', '로봇 R (출발 S)');
    legItem('--w-goal', '목표 G');
    legItem('--w-wall', '지도에 있는 벽 (빗금)');
    legItem('--box-danger', '지도에 없는 진짜 벽 (점선 → 발견되면 굵은 테두리)');
    legItem('--w-frontier', 'A* 열린 목록 (고리)');
    legItem('--w-visited', '확장 완료 — 진할수록 나중');
    legItem('--box-warn', 'g > rhs 국소 불일치 ▼ 값을 내린다');
    legItem('--box-classify', 'g < rhs 국소 불일치 ▲ 값을 버린다');
    legItem('--w-path', '지금 답으로 들고 있는 경로');
    legend.appendChild(K.el('span', null, '· 재계획 국면에서 A* 패널의 흐린 자국 = 버린 계산, D* Lite 패널의 진한 자국 = 살린 계산'));
    legend.appendChild(K.el('span', null, '· 격자를 드래그하면 "지도에 없는 벽" 이 늘고 줄어 시나리오가 즉시 다시 돈다'));
    ui.root.insertBefore(legend, ui.ctl);

    // ---- 배치 ----
    /* ≥700px 두 패널 좌우. 그 아래는 세로 스택 — 두 패널을 400px 에 우겨넣으면
     * 셀이 7px 아래로 내려가 불일치 삼각형이 사라진다. 폰에서는 좌우 비교를
     * 포기하고 세로로 쌓아 두 패널을 둘 다 읽을 수 있게 한다(계약 §4). */
    function computeLayout(w) {
      var side = w >= SIDE_MIN_W && panels.length > 1;
      var gcols = side ? panels.length : 1;
      var grows = Math.ceil(panels.length / gcols);
      var paneW = Math.floor((w - GAP * (gcols - 1)) / gcols);
      var maxH = side ? MAX_H_SIDE : MAX_H_STACK;
      var byW = (paneW - PAD * 2) / cols;
      var byH = (maxH - HEAD - PAD * 2) / rows;
      var cell = Math.floor(Math.min(byW, byH, MAX_CELL));
      if (side && cell < MIN_CELL) {
        // 좌우로는 너무 작다. 세로로 쌓으면 셀이 두 배가 된다.
        gcols = 1;
        grows = panels.length;
        paneW = w;
        byW = (paneW - PAD * 2) / cols;
        byH = (MAX_H_STACK - HEAD - PAD * 2) / rows;
        cell = Math.floor(Math.min(byW, byH, MAX_CELL));
        side = false;
      }
      if (cell < 3) cell = 3;
      var gridW = cell * cols, gridH = cell * rows;
      var pw = Math.min(paneW, Math.max(gridW + PAD * 2, 200));
      var paneH = HEAD + gridH + PAD * 2;
      var blockW = gcols * pw + GAP * (gcols - 1);
      return {
        w: w, side: side, gcols: gcols, grows: grows, cell: cell,
        paneW: pw, paneH: paneH, gridW: gridW, gridH: gridH,
        ox: Math.max(0, Math.floor((w - blockW) / 2)),
        height: grows * paneH + GAP * (grows - 1) + SUM_H + 4,
        compact: w < 560
      };
    }
    function layoutFor(w) {
      if (!layout || layout.w !== w) layout = computeLayout(w);
      return layout;
    }
    function paneBox(L, idx) {
      var col = idx % L.gcols, row = (idx / L.gcols) | 0;
      var x = L.ox + col * (L.paneW + GAP), y = row * (L.paneH + GAP);
      return { x: x, y: y, gx: x + Math.floor((L.paneW - L.gridW) / 2), gy: y + HEAD };
    }

    // ---- 프레임 상태 조회 ----
    /* 각 패널이 "지금 몇 칸 확장했고, 어떤 경로를 답으로 들고 있는가" 를
     * 한 곳에서 계산한다. 그리기와 상태 줄이 같은 수를 보게 하기 위해서다. */
    function paneState(key, f) {
      var ph = frames.ph[f];
      var replan = ph === PH_REPLAN || ph === PH_DONE;
      var o = { phase: ph, replan: replan, path: null, done: false };
      if (key === 'astar-replan') {
        var s = replan ? sim.a1 : sim.a0;
        o.k = frames.aK[f];
        o.search = s;
        o.total = s.expanded;
        o.done = o.k >= s.expanded;
        o.prevFirst = replan ? sim.a0.firstAt : null;
        o.expCum = replan ? sim.a0.expanded + o.k : o.k;
        /* 발견 시점에는 경로를 그리지 않는다. 지도가 바뀐 순간 A* 가 들고 있던
         * 계획은 검증되지 않은 것이 되고, 그것을 답으로 그리면 위젯이 거짓말을
         * 한다. 다시 푼 뒤에 다시 그린다. */
        if (o.done && s.path && ph !== PH_REVEAL) {
          o.path = replan ? s.path : s.path.slice(frames.rb[f]);
        }
        o.cost = (ph === PH_REVEAL) ? null
               : (o.done ? (s.path ? (replan ? s.cost : s.cost - frames.rb[f]) : INF) : null);
      } else {
        o.k = frames.dK[f];
        o.total = replan ? sim.d.ord1.length : sim.d.ord0.length;
        o.done = o.k >= o.total;
        o.expCum = replan ? sim.d.ord0.length + o.k : o.k;
        if (o.done) {
          if (replan) o.path = sim.d.path1;
          else if (ph === PH_MOVE) o.path = sim.movePaths[frames.rb[f]];
          else if (ph === PH_PLAN) o.path = sim.d.path0;
          else o.path = null;             // 발견 직후의 g 는 이미 낡았다. 경로를 그리면 거짓말이다
        }
        o.cost = o.path ? o.path.length - 1 : (o.done && ph !== PH_REVEAL ? INF : null);
      }
      return o;
    }

    // ---- 그리기 ----
    function draw(ctx, size, T) {
      var L = layoutFor(size.w);
      var f = frameOf(cur);
      ctx.textBaseline = 'alphabetic';
      for (var p = 0; p < panels.length; p++) drawPane(ctx, T, L, p, panels[p], f);
      drawSummary(ctx, T, L, f);
    }

    function drawPane(ctx, T, L, idx, key, f) {
      var box = paneBox(L, idx);
      var cell = L.cell;
      var st = paneState(key, f);
      var ph = frames.ph[f];
      var isD = key === 'dstar-lite';

      // ── 머리줄 ──
      ctx.globalAlpha = 1;
      ctx.font = '700 12px ' + FONT;
      ctx.fillStyle = T.fg;
      ctx.fillText(PANEL_NAME[key], box.x + PAD, box.y + 13);
      var nameW = ctx.measureText(PANEL_NAME[key]).width;
      if (L.paneW > 260) {
        /* 재계획 국면에서는 규칙 문구를 "이전 계산을 어떻게 했는가" 로 바꾼다.
         * 알파 차이(버린 자국 0.14 / 살린 자국 0.28)만으로는 라이트 테마에서
         * 버린 쪽이 사실상 보이지 않는다. 숫자로 말하는 편이 정확하다. */
        var rule = PANEL_RULE[key];
        if (ph === PH_REPLAN || ph === PH_DONE) {
          rule = isD ? ('이전 ' + sim.d.ord0.length + '칸 유지 · 어긋난 곳만')
                     : ('이전 ' + sim.a0.expanded + '칸 폐기 · 처음부터 다시');
        }
        ctx.font = '11px ' + FONT;
        ctx.fillStyle = T.fgFaint;
        ctx.fillText('— ' + rule, box.x + PAD + nameW + 6, box.y + 13);
      }

      var bits = [];
      if (showExp) bits.push('확장 ' + st.k + (st.total ? '/' + st.total : '') + ' · 누적 ' + st.expCum);
      if (showCost) bits.push('경로 비용 ' + (st.cost == null ? '계산 중' : fmt(st.cost)));
      ctx.font = '700 11px ' + FONT;
      ctx.fillStyle = st.done ? T.fgDim : T.accent;
      ctx.fillText(bits.join('   ·   '), box.x + PAD, box.y + 29);

      // ── 격자 바탕 ──
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(box.gx, box.gy, L.gridW, L.gridH);

      var revealed = ph >= PH_REVEAL;
      var denom = Math.max(1, st.k);
      // 살린 계산 / 버린 계산. 흐린 쪽도 형태는 남아야 "이만큼을 버렸다" 가 보인다.
      var prevAlpha = isD ? 0.28 : 0.14;
      var markReplan = st.replan && st.total > 0 && st.total <= 24 && cell >= 10;

      for (var c = 0; c < n; c++) {
        var x = box.gx + (c % cols) * cell, y = box.gy + ((c / cols) | 0) * cell;
        // indexOf 를 468칸 × 2패널 × 매 프레임 돌리면 재생이 눈에 띄게 끊긴다(계약 §7)
        var isUnknown = unknownMask[c] === 1;
        var isWall = believed[c] || (isUnknown && revealed);

        if (isWall) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = T.wWall;
          ctx.fillRect(x, y, cell, cell);
          if (cell >= 7) {
            // 색을 구분하지 못해도 벽임을 알 수 있게 빗금을 긋는다(계약 §5).
            ctx.globalAlpha = 0.45;
            ctx.strokeStyle = T.fgFaint;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y);
            ctx.moveTo(x + cell * 0.5, y + cell); ctx.lineTo(x + cell, y + cell * 0.5);
            ctx.moveTo(x, y + cell * 0.5); ctx.lineTo(x + cell * 0.5, y);
            ctx.stroke();
          }
          if (isUnknown) {
            // 방금 발견한 벽. 지도에 원래 있던 벽과 구별되어야 한다.
            ctx.globalAlpha = 1;
            ctx.strokeStyle = T.boxDanger;
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
          }
          /* 벽이라고 건너뛰면 안 된다. **막힌 칸도 정점이다** — 벽이 된 순간
           * rhs 가 ∞ 로 바뀌면서 국소 불일치가 되고, D* Lite 가 수리하는
           * 다섯 칸이 정확히 이 칸들이다. 여기서 continue 하면 "확장 5칸" 이
           * 카운터에만 있고 화면에는 없는 수가 된다. */
          drawCellMarks(ctx, T, st, c, x, y, cell, isD, denom, markReplan, f, true);
          continue;
        }

        // 이전 국면의 확장 자국
        if (st.replan) {
          var pf = isD ? sim.d.first0[c] : (st.prevFirst ? st.prevFirst[c] : 0);
          if (pf > 0) {
            ctx.globalAlpha = prevAlpha;
            ctx.fillStyle = T.wVisited;
            ctx.fillRect(x, y, cell, cell);
          }
        }

        drawCellMarks(ctx, T, st, c, x, y, cell, isD, denom, markReplan, f, false);

        // 아직 발견되지 않은 진짜 벽 — 독자는 알고 로봇은 모른다
        if (isUnknown && !revealed) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = T.boxDanger;
          ctx.lineWidth = 1.5;
          if (ctx.setLineDash) ctx.setLineDash([3, 2]);
          ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
          if (ctx.setLineDash) ctx.setLineDash([]);
          if (cell >= 13) {
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = T.boxDanger;
            ctx.font = '700 ' + Math.round(cell * 0.5) + 'px ' + FONT;
            var qw = ctx.measureText('?').width;
            ctx.fillText('?', x + (cell - qw) / 2, y + cell * 0.72);
          }
        }

      }

      // ── 지금 답으로 들고 있는 경로 ──
      if (st.path && st.path.length > 1) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = T.wPath;
        for (var pi2 = 0; pi2 < st.path.length; pi2++) {
          var pc = st.path[pi2];
          ctx.fillRect(box.gx + (pc % cols) * cell, box.gy + ((pc / cols) | 0) * cell, cell, cell);
        }
      }

      // ── 로봇이 지나온 자리 ──
      var rbIdx = frames.rb[f];
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = T.wStart;
      for (var ti = 0; ti < rbIdx; ti++) {
        var tc = sim.trail[ti];
        var tx = box.gx + (tc % cols) * cell, ty = box.gy + ((tc / cols) | 0) * cell;
        var dsz = Math.max(2, Math.round(cell * 0.3));
        ctx.fillRect(tx + ((cell - dsz) >> 1), ty + ((cell - dsz) >> 1), dsz, dsz);
      }

      // ── 출발 · 로봇 · 목표 ──
      ctx.globalAlpha = 1;
      if (rbIdx > 0) drawMark(ctx, T, box, cell, sim.trail[0], T.wStart, 'S', 0.45);
      drawMark(ctx, T, box, cell, sim.trail[rbIdx], T.wStart, 'R', 1);
      drawMark(ctx, T, box, cell, goal, T.wGoal, 'G', 1);

      // ── 격자선 ──
      if (cell >= 6) {
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var gi = 0; gi <= cols; gi++) {
          ctx.moveTo(box.gx + gi * cell + 0.5, box.gy);
          ctx.lineTo(box.gx + gi * cell + 0.5, box.gy + L.gridH);
        }
        for (var gj = 0; gj <= rows; gj++) {
          ctx.moveTo(box.gx, box.gy + gj * cell + 0.5);
          ctx.lineTo(box.gx + L.gridW, box.gy + gj * cell + 0.5);
        }
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, L.paneW - 1, L.paneH - 1);
    }

    /* 칸 하나에 얹는 표식 — 확장 자국, A* 열린 목록, 재계획 표시, 국소 불일치.
     * 빈 칸과 벽이 공유한다(벽도 정점이다). onWall 이면 채우기를 생략하고
     * 테두리와 삼각형만 얹는다 — 벽 위에 --w-visited 를 덧칠하면 벽이 벽으로
     * 안 읽히기 때문이다. */
    function drawCellMarks(ctx, T, st, c, x, y, cell, isD, denom, markReplan, f, onWall) {
      var fa = isD ? (st.replan ? sim.d.first1[c] : sim.d.first0[c]) : st.search.firstAt[c];
      var expandedNow = fa > 0 && fa <= st.k;

      if (expandedNow) {
        if (!onWall) {
          /* 확장 순서를 농도 + 크기 두 겹으로 그린다. 농도만 쓰면 --w-visited 가
           * 배경 대비가 낮아 "얼마나 넓게 펼쳤는가" 만 남고 "어느 쪽으로 자랐는가"
           * 가 사라진다. A* 는 로봇에서, D* Lite 는 목표에서 자란다 — 그 방향
           * 차이가 곧 "거꾸로 푼다" 의 그림이다. */
          var ratio = fa / denom;
          ctx.globalAlpha = 0.20 + 0.30 * ratio;
          ctx.fillStyle = T.wVisited;
          ctx.fillRect(x, y, cell, cell);
          var side = Math.round(cell * (0.26 + 0.74 * ratio));
          if (side > 0) {
            ctx.globalAlpha = 0.5 + 0.5 * ratio;
            ctx.fillRect(x + ((cell - side) >> 1), y + ((cell - side) >> 1), side, side);
          }
        }
        if (markReplan) {
          // 수리한 칸이 다섯 개뿐이면 468칸 격자에서 눈에 안 띈다. 테두리로 찍어 준다.
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.accent;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + (onWall ? 3.5 : 1), y + (onWall ? 3.5 : 1),
                         cell - (onWall ? 7 : 2), cell - (onWall ? 7 : 2));
        }
      } else if (!isD && !onWall && evAt(st.search.openEv[c], st.k) === 1) {
        // A* 의 열린 목록 — "아직 안 본 곳". 가운데가 뚫린 고리로 그린다.
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = T.wFrontier;
        ctx.fillRect(x, y, cell, cell);
        if (cell >= 9) {
          var hole = Math.round(cell * 0.34);
          ctx.globalAlpha = 1;
          ctx.fillStyle = T.bgElev;
          ctx.fillRect(x + ((cell - hole) >> 1), y + ((cell - hole) >> 1), hole, hole);
        }
      }

      /* D* Lite 패널의 국소 불일치 — 이 위젯의 핵심 표식이다.
       * 큐에 들어 있는 것이 곧 이 표식이 붙은 칸이다(본문 §2.1). */
      if (!isD || !showIncon) return;
      var s2 = evAt(sim.d.stEv[c], f);
      if (s2 === ST_OK) return;
      var col = s2 === ST_OVER ? T.boxWarn : T.boxClassify;
      ctx.globalAlpha = 0.95;
      if (!onWall) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
      }
      if (cell >= 9) {
        // 방향까지 모양으로 — 색을 구분하지 못해도 어느 쪽 불일치인지 읽힌다
        var m2 = cell * 0.26, cx = x + cell / 2, cy = y + cell / 2;
        if (onWall) {
          // 벽의 빗금 위에서는 삼각형이 묻힌다. 바탕을 깔고 얹는다.
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = T.bg;
          ctx.fillRect(cx - m2 - 1, cy - m2 - 1, m2 * 2 + 2, m2 * 2 + 2);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.beginPath();
        if (s2 === ST_OVER) {
          ctx.moveTo(cx - m2, cy - m2 * 0.7); ctx.lineTo(cx + m2, cy - m2 * 0.7); ctx.lineTo(cx, cy + m2);
        } else {
          ctx.moveTo(cx - m2, cy + m2 * 0.7); ctx.lineTo(cx + m2, cy + m2 * 0.7); ctx.lineTo(cx, cy - m2);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawMark(ctx, T, box, cell, c, color, ch, alpha) {
      if (c == null || c < 0) return;
      var x = box.gx + (c % cols) * cell, y = box.gy + ((c / cols) | 0) * cell;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, cell, cell);
      if (cell >= 11) {
        ctx.fillStyle = T.bg;
        ctx.font = '700 ' + Math.round(cell * 0.62) + 'px ' + FONT;
        var w = ctx.measureText(ch).width;
        ctx.fillText(ch, x + (cell - w) / 2, y + cell * 0.76);
      }
      ctx.globalAlpha = 1;
    }

    /* 결론 줄. 이 위젯이 증명하려는 두 명제가 여기 숫자로 남는다.
     * 국면에 따라 비교 대상이 달라진다 — 최초 계획에서는 D* Lite 가 지고,
     * 재계획에서 이긴다. 둘 다 보여야 정직하다(본문 §2.2, §5). */
    function drawSummary(ctx, T, L, f) {
      var y0 = L.grows * L.paneH + GAP * (L.grows - 1) + 4;
      var ph = frames.ph[f];
      var replan = ph === PH_REPLAN || ph === PH_DONE;
      var aS = paneState('astar-replan', f), dS = paneState('dstar-lite', f);

      ctx.globalAlpha = 1;
      ctx.fillStyle = T.bgCode;
      ctx.fillRect(0, y0, L.w, SUM_H - 6);
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, y0 + 0.5, L.w - 1, SUM_H - 7);

      var lab = PHASE_LABEL[ph];
      ctx.font = '700 11px ' + FONT;
      ctx.fillStyle = T.accent;
      ctx.fillText(lab, 8, y0 + 16);
      var labW = ctx.measureText(lab).width + 14;

      /* 1행 — 경로 비용. 두 패널이 같아야 한다.
       * 후보를 긴 것부터 늘어놓고 들어가는 첫 문장을 쓴다. 좁은 화면에서
       * 잘린 글자를 남기는 것보다 짧게 정확한 편이 낫다. */
      var cands;
      if (!showCost) {
        cands = [''];
      } else if (aS.cost == null || dS.cost == null) {
        cands = ['경로 비용  계산 중'];
      } else if (aS.cost === dS.cost) {
        var same = '경로 비용  A* ' + fmt(aS.cost) + '  =  D* Lite ' + fmt(dS.cost);
        cands = [];
        /* 두 패널의 금색 경로가 서로 다른 칸을 지나는 일이 흔하다. 최단경로는
         * 여럿이고 둘 다 최적이기 때문인데, 그 말을 안 해 두면 독자는 "답이
         * 바뀌지 않았다" 는 문장과 눈에 보이는 그림이 어긋난다고 읽는다. */
        if (aS.path && dS.path && aS.path.join() !== dS.path.join()) {
          cands.push(same + '   ✓ 갱신 방식이 답을 바꾸지 않았다 (비용이 같은 최단경로가 여럿이라 지나는 칸은 다를 수 있다)');
          cands.push(same + '   ✓ 답은 같다 (지나는 칸은 다를 수 있다)');
        } else {
          cands.push(same + '   ✓ 갱신 방식이 답을 바꾸지 않았다');
        }
        cands.push(same + '  ✓');
        cands.push('비용 ' + fmt(aS.cost) + ' = ' + fmt(dS.cost) + ' ✓');
      } else {
        cands = ['경로 비용  A* ' + fmt(aS.cost) + '  ≠  D* Lite ' + fmt(dS.cost) + '   ← 어느 하나가 틀렸다',
                 '비용 ' + fmt(aS.cost) + ' ≠ ' + fmt(dS.cost) + ' ←틀림'];
      }
      ctx.font = '11px ' + FONT;
      ctx.fillStyle = (aS.cost != null && dS.cost != null && aS.cost !== dS.cost) ? T.boxDanger : T.fg;
      var line1 = cands[cands.length - 1];
      for (var ci2 = 0; ci2 < cands.length; ci2++) {
        if (ctx.measureText(cands[ci2]).width <= L.w - labW - 16) { line1 = cands[ci2]; break; }
      }
      ctx.fillText(line1, 8 + labW, y0 + 16);

      // 2행 — 확장 수. 여기가 갈린다.
      if (!showExp) return;
      var ae = replan ? sim.audit.expanded.replan[0] : sim.audit.expanded.plan[0];
      var de = replan ? sim.audit.expanded.replan[1] : sim.audit.expanded.plan[1];
      var head = replan ? '재계획 확장' : '최초 계획 확장';
      var verdict = '';
      if (de > 0 && ae > 0) {
        var ratio = ae / de;
        if (ratio >= 1.05) verdict = 'D* Lite 가 ' + (ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)) + '배 적게 편다';
        else if (ratio <= 0.95) verdict = 'D* Lite 가 ' + (de - ae) + '칸 더 편다 (부기 비용)';
        else verdict = '거의 같다';
      } else if (de === 0) {
        verdict = '고칠 정점이 없었다';
      }
      var line2 = head + '  A* ' + ae + '  vs  D* Lite ' + de + (verdict ? '   → ' + verdict : '');
      ctx.font = '700 11px ' + FONT;
      // 좁으면 줄여 쓴다. 잘린 글자를 남기는 것보다 짧게 정확한 편이 낫다.
      if (ctx.measureText(line2).width > L.w - 16) {
        line2 = head + ' ' + ae + ' vs ' + de + (verdict ? ' → ' + verdict : '');
      }
      if (ctx.measureText(line2).width > L.w - 16) line2 = head + ' ' + ae + ' vs ' + de;
      ctx.fillStyle = T.fgDim;
      ctx.fillText(line2, 8, y0 + 33);
      var w2 = ctx.measureText(line2).width;
      var tail = replan ? '  · 수리 비용은 지도 크기가 아니라 답이 얼마나 바뀌었는가를 따라간다'
                        : '  · 한 번만 푸는 문제라면 증분 탐색은 손해다';
      ctx.font = '11px ' + FONT;
      if (!L.compact && ctx.measureText(tail).width <= L.w - w2 - 16) {
        ctx.fillStyle = T.fgFaint;
        ctx.fillText(tail, 8 + w2, y0 + 33);
      }
    }

    // ---- 캔버스 ----
    var canvas = K.canvas(ui.stage, {
      height: function (w) { return layoutFor(w).height; },
      draw: draw
    });
    canvas.el.style.touchAction = 'none';
    canvas.el.style.cursor = 'crosshair';

    // ---- 상태 줄 (계약 §5 — 색 없이도 위젯이 살아 있어야 한다) ----
    function rc(c) { return '(' + ((c / cols) | 0) + ',' + (c % cols) + ')'; }

    function label(i) {
      var f = frameOf(i);
      var ph = frames.ph[f];
      var aS = paneState('astar-replan', f), dS = paneState('dstar-lite', f);
      var s;

      if (ph === PH_PLAN) {
        if (f === 0) {
          s = '시작 상태. A* 는 로봇 ' + rc(sim.trail[0]) + ' 에서 앞으로, D* Lite 는 목표 ' + rc(goal) +
              ' 에서 거꾸로 푼다. D* Lite 의 큐에는 지금 목표 하나만 있고 그것이 유일한 국소 불일치 정점이다.';
        } else {
          var au = sim.a0.order[f - 1], du = sim.d.ord0[f - 1], di = sim.d.info0[f - 1];
          s = '최초 계획 ' + f + '번째 확장 — ';
          s += au != null ? ('A* 는 ' + rc(au) + ' 를 확정했다(로봇에서 앞으로). ') : 'A* 는 이미 끝났다. ';
          s += du != null ? ('D* Lite 는 ' + rc(du) + ' 를 확장해 g=' + fmt(di.g) + ' 로 두었다(목표에서 거꾸로).')
                          : 'D* Lite 는 이미 끝났다.';
        }
      } else if (ph === PH_MOVE) {
        var m3 = frames.rb[f];
        s = '로봇이 ' + rc(sim.trail[m3]) + ' 로 ' + m3 + '칸째 전진했다. 남은 비용 ' + fmt(dS.cost) +
            '. 아직 지도는 그대로다 — 시작점이 움직인 만큼은 발견 시점에 k_m 으로 한 번에 흡수한다.';
      } else if (ph === PH_REVEAL) {
        s = '센서가 지도에 없던 벽 ' + sim.revealed.length + '칸을 발견했다. k_m 에 h(출발, 로봇)=' + sim.d.km +
            ' 을 더해 큐 전체를 다시 매기는 일을 피했다. 바뀐 칸과 그 이웃을 다시 재자 국소 불일치 정점이 ' +
            sim.brokeCount + '개가 되었다 — 큐에 들어 있는 것이 정확히 그것들이다. ' +
            'A* 패널은 이전 계산 ' + sim.a0.expanded + '칸을 통째로 버리고 처음부터 다시 푼다.';
      } else if (ph === PH_REPLAN) {
        var k3 = f - sim.revealFrame - 1;
        var au2 = sim.a1.order[k3 - 1], du2 = sim.d.ord1[k3 - 1], di2 = sim.d.info1[k3 - 1];
        s = k3 === 0 ? '재계획 시작 — ' : ('재계획 ' + k3 + '번째 확장 — ');
        s += au2 != null ? ('A* 는 ' + rc(au2) + ' 를 확정했다(누적 ' + aS.k + '칸). ')
                         : (k3 === 0 ? ('A* 는 열린 목록에 로봇 ' + rc(sim.trail[sim.M]) + ' 하나만 넣고 처음부터 시작한다. ')
                                     : ('A* 는 ' + sim.a1.expanded + '칸으로 끝났다. '));
        if (du2 != null) {
          s += 'D* Lite 는 ' + rc(du2) + ' 를 확장했다 — ' +
               (di2.kind === 'under' ? 'g 를 ∞ 로 버리고 다시 재는 쪽(underconsistent)'
                                     : 'g 를 ' + fmt(di2.g) + ' 로 확정하는 쪽(overconsistent)') + '이다.';
        } else if (k3 === 0) {
          s += 'D* Lite 는 이전 g 값을 그대로 들고 어긋난 정점부터 집어 든다.';
        } else {
          s += 'D* Lite 는 ' + sim.d.ord1.length + '칸 만에 이미 끝나 답을 들고 기다린다.';
        }
      } else {
        s = '완료. 경로 비용은 A* ' + fmt(sim.a1.cost) + ', D* Lite ' + fmt(sim.d.cost1) + ' 로 ' +
            (sim.a1.cost === sim.d.cost1 ? '같다' : '다르다') + '. ' +
            '재계획 확장은 ' + sim.a1.expanded + ' 대 ' + sim.d.ord1.length + ' 다. ' +
            '최초 계획까지 합치면 누적 ' + (sim.a0.expanded + sim.a1.expanded) +
            ' 대 ' + (sim.d.ord0.length + sim.d.ord1.length) + ' 다.';
      }

      var tail = '  ▸ 확장 누적 — A* ' + aS.expCum + ' / D* Lite ' + dS.expCum + '.';
      return s + tail;
    }

    // ---- 재생기 ----
    var player = K.player(ui, {
      total: totalSteps,
      render: function (i) {
        cur = i;
        var f = frameOf(i);
        var ph = frames.ph[f];
        for (var b = 0; b < jumpBtns.length; b++) jumpBtns[b].classList.toggle('is-active', b === ph);
        canvas.redraw();
      },
      label: label,
      speed: 90     // 최초 계획만 300스텝이다. 기본 420ms 면 한 국면에 2분이 걸린다
    });

    // ---- 미지의 장애물 편집 (마우스 + 터치) ----
    /* 독자가 직접 장애물을 키워 보게 하는 것이 이 위젯의 마지막 장치다.
     * 본문 §2.2 의 표는 "답이 크게 바뀌면 D* Lite 가 A* 보다 비싸다" 로 끝나는데,
     * 그 줄은 읽는 것보다 만들어 보는 쪽이 훨씬 강하다. */
    var painting = false, paintTo = 0, lastCell = -1;

    function hit(e) {
      var L = layoutFor(canvas.size.w || ui.stage.clientWidth || 320);
      var rect = canvas.el.getBoundingClientRect();
      if (!rect.width || !rect.height) return -1;
      var x = (e.clientX - rect.left) * (canvas.size.w / rect.width);
      var y = (e.clientY - rect.top) * (canvas.size.h / rect.height);
      for (var p = 0; p < panels.length; p++) {
        var box = paneBox(L, p);
        var lx = x - box.gx, ly = y - box.gy;
        if (lx < 0 || ly < 0 || lx >= L.gridW || ly >= L.gridH) continue;
        var c = ((ly / L.cell) | 0) * cols + ((lx / L.cell) | 0);
        return (c >= 0 && c < n) ? c : -1;
      }
      return -1;
    }

    var dirty = false, queued = false;
    function flush() {
      queued = false;
      if (!dirty) return;
      dirty = false;
      recompute();
      layout = null;
      player.goto(cur);      // player 가 범위를 알아서 자른다
    }
    function markDirty() {
      dirty = true;
      if (queued) return;
      queued = true;
      requestAnimationFrame(flush);
    }

    function paint(c) {
      if (c < 0 || c === start || c === goal || believed[c]) return;
      var at = unknown.indexOf(c);
      if (paintTo === 1) { if (at >= 0) return; unknown.push(c); }
      else { if (at < 0) return; unknown.splice(at, 1); }
      markDirty();
    }

    // 빠르게 끌면 pointermove 가 칸을 건너뛴다. 두 칸 사이를 이어 칠한다.
    function paintLine(a, b) {
      if (a < 0) { paint(b); return; }
      var r0 = (a / cols) | 0, c0 = a % cols, r1 = (b / cols) | 0, c1 = b % cols;
      var dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
      var sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
      var err = dr - dc, guard = rows + cols + 4;
      for (;;) {
        paint(r0 * cols + c0);
        if ((r0 === r1 && c0 === c1) || guard-- <= 0) break;
        var e2 = err * 2;
        if (e2 > -dc) { err -= dc; r0 += sr; }
        if (e2 < dr) { err += dr; c0 += sc; }
      }
    }

    canvas.el.addEventListener('pointerdown', function (e) {
      var c = hit(e);
      if (c < 0) return;
      e.preventDefault();
      player.stop();
      painting = true;
      paintTo = unknown.indexOf(c) >= 0 ? 0 : 1;   // 같은 제스처로 그리기와 지우기
      lastCell = -1;
      paint(c);
      lastCell = c;
      if (canvas.el.setPointerCapture) {
        try { canvas.el.setPointerCapture(e.pointerId); } catch (err) { /* 캡처 실패는 무시 */ }
      }
    });

    canvas.el.addEventListener('pointermove', function (e) {
      if (!painting) return;
      e.preventDefault();
      var c = hit(e);
      if (c < 0 || c === lastCell) return;
      paintLine(lastCell, c);
      lastCell = c;
    });

    function endPaint() { painting = false; lastCell = -1; }
    canvas.el.addEventListener('pointerup', endPaint);
    canvas.el.addEventListener('pointercancel', endPaint);
    canvas.el.addEventListener('lostpointercapture', endPaint);

    player.goto(0);
  });
})();

/* ==== grid-search.js ==== */
/* grid-search.js — 같은 격자, 다른 우선순위 규칙
 *
 * 이 위젯이 증명하려는 명제는 하나다: **BFS·DFS·다익스트라·A* 는 같은 탐색이고,
 * 다르는 것은 "열린 목록에서 다음에 무엇을 꺼내는가" 뿐이다.** 그래서 네 패널이
 * 같은 격자·같은 시작·같은 목표를 쓰고, 스텝 인덱스 하나가 넷을 동시에 민다.
 * 독자는 BFS 가 동심원으로 퍼지는 동안 A* 가 목표를 향해 곧게 뻗는 것을 한 화면에서 본다.
 * 산문으로는 이 대비가 만들어지지 않는다(CLAUDE.md §0, §4-1).
 *
 * 왜 방문 순서를 "색 농도"로 그리는가
 *   확장된 칸을 전부 같은 색으로 칠하면 마지막 프레임에서 네 패널이 똑같이
 *   "칠해진 덩어리"로 보인다. 정작 배워야 할 것은 덩어리의 크기가 아니라
 *   **덩어리가 자라난 모양**이다. 확장 순서를 알파로 매핑하면 정지 화면
 *   한 장만으로도 BFS 의 동심원, 다익스트라의 등가 비용 등고선, A* 의 쐐기,
 *   DFS 의 실뭉치가 구분된다. 새 색을 만들지 않고 --w-visited 하나의
 *   globalAlpha 만 흔드는 이유이기도 하다(계약 §3).
 *
 * 왜 "확장 칸 수" 를 패널마다 크게 띄우는가
 *   A* 의 가치는 "더 짧은 답" 이 아니라 "같은 답을 더 적게 펼쳐서" 다.
 *   경로 길이는 다익스트라와 같고 확장 수만 줄어든다 — 그 숫자가 V-5 의 핵심이다.
 *
 * 왜 스텝을 "확장 1회" 로 정의하는가
 *   그렇게 두면 스텝 인덱스 i 가 곧 그 패널의 확장 횟수가 된다. 상태 줄과
 *   카운터가 같은 수를 가리키므로 독자가 두 수를 대조하지 않아도 된다.
 *   낡은 힙 항목을 버리는 것은 스텝을 소비하지 않는다 — 화면에서 아무 일도
 *   일어나지 않는 내부 사건이기 때문이다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // ─── 상수 ────────────────────────────────────────────────────────────────

  var INF = Infinity;
  var DIM_MIN = 6, DIM_MAX = 30;
  var MAX_CELLS = 900;   // 30×30. 확장은 칸당 최대 1회이므로 이게 곧 스텝 상한이다(계약 §7)

  var MIN_CELL = 7;      // 이 아래로 내려가면 격자가 뭉갠다 → 셀이 아니라 패널 수를 줄인다
  var MAX_CELL = 26;
  var HEAD = 34;         // 패널 머리(이름 + 카운터) 두 줄
  var PAD = 4;
  var MIN_PANE_W = 176;  // 머리줄 글자가 들어갈 최소 폭
  var MAX_H_MULTI = 720; // 4분할 전체 높이 상한. 이보다 크면 한 화면에 안 들어온다
  var MAX_H_ONE = 470;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  /* 4-이웃 고정(대각선 없음). 맨해튼 휴리스틱의 허용성(admissibility)이
   * 대각 이동이 없다는 전제 위에서만 성립하기 때문이다. 8-이웃으로 바꾸면
   * 맨해튼은 실제 비용을 초과할 수 있어 A* 가 최적해를 놓친다 — 그때는
   * 옥타일(대각 보정) 휴리스틱으로 갈아타야 한다. 그 함정을 위젯이
   * 재현해 버리면 안 되므로 여기서는 4-이웃만 쓴다. */
  var DR = [-1, 0, 1, 0];
  var DC = [0, 1, 0, -1];
  var DIRNAME = ['위', '오른쪽', '아래', '왼쪽'];

  var WEIGHT_LEVELS = [1, 3, 6];   // 지형 비용 3단. 점 개수(0/1/2)로도 구분된다

  var ALGOS = ['bfs', 'dfs', 'dijkstra', 'astar'];
  var ALGO_NAME = { bfs: 'BFS', dfs: 'DFS', dijkstra: '다익스트라', astar: 'A*' };
  var ALGO_RULE = {
    bfs: '큐 앞에서 꺼낸다',
    dfs: '스택 위에서 꺼낸다',
    dijkstra: 'g 가 가장 작은 것',
    astar: 'g+h 가 가장 작은 것'
  };

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(v, list, dflt) {
    for (var i = 0; i < list.length; i++) if (v === list[i]) return v;
    return dflt;
  }

  // 선형 합동 생성기. Math.random 을 쓰면 같은 opts 가 매번 다른 격자를 내고
  // "같은 인덱스 = 같은 그림"(계약 §7) 이 깨진다. 씨앗을 고정한다.
  function lcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // ─── 이진 힙 ─────────────────────────────────────────────────────────────

  /* 항목: [key, seq, cell, g]
   * seq(삽입 순번)까지 비교해 동점을 결정론적으로 깬다. 동점 처리가
   * 알고리즘마다 다르면 "h=0 인 A* 는 곧 다익스트라"(V-5)가 화면에서
   * 확인되지 않는다 — 같은 칸을 다른 순서로 펼쳐 버리기 때문이다. */
  function Heap() { this.a = []; }
  Heap.prototype.less = function (x, y) {
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  };
  Heap.prototype.push = function (e) {
    var a = this.a, i = a.length;
    a.push(e);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      var t = a[i]; a[i] = a[p]; a[p] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0, n = a.length;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, m = i;
        if (l < n && this.less(a[l], a[m])) m = l;
        if (r < n && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        var t = a[i]; a[i] = a[m]; a[m] = t;
        i = m;
      }
    }
    return top;
  };

  // ─── 격자 ────────────────────────────────────────────────────────────────

  /* 벽 프리셋 — opts.walls 에 이름 문자열로 준다. [[r,c],...] 좌표 배열도 받는다.
   *   "open"   벽 없음. A* 가 다익스트라보다 얼마나 덜 펼치는지 가장 선명하다.
   *   "rooms"  세로 칸막이 두 장 + 문 두 개. 기본값. 우회가 필요하되 막다른 길은 없다.
   *   "maze"   재귀 분할 미로. DFS 가 엉뚱한 가지로 새어 들어가는 장면이 잘 나온다.
   *   "spiral" 안으로 감기는 동심 벽. 휴리스틱이 오히려 손해가 되는 배치 —
   *            A* 가 목표 쪽으로 밀렸다가 벽에 막혀 되돌아 나온다.
   */
  var PRESETS = ['open', 'rooms', 'maze', 'spiral'];

  function buildWalls(rows, cols, spec) {
    var n = rows * cols;
    var wall = new Uint8Array(n);
    function set(r, c) { if (r >= 0 && r < rows && c >= 0 && c < cols) wall[r * cols + c] = 1; }
    function clr(r, c) { if (r >= 0 && r < rows && c >= 0 && c < cols) wall[r * cols + c] = 0; }

    if (Object.prototype.toString.call(spec) === '[object Array]') {
      for (var i = 0; i < spec.length; i++) {
        var p = spec[i];
        if (Object.prototype.toString.call(p) !== '[object Array]') continue;
        var r = clampInt(p[0], 0, rows - 1, -1), c = clampInt(p[1], 0, cols - 1, -1);
        if (r >= 0 && c >= 0) set(r, c);
      }
      return wall;
    }

    var name = oneOf(spec, PRESETS, 'rooms');

    if (name === 'rooms') {
      var c1 = Math.floor(cols / 3), c2 = Math.floor((cols * 2) / 3);
      for (var rr = 0; rr < rows; rr++) { set(rr, c1); set(rr, c2); }
      var d1 = Math.floor(rows / 6), d2 = rows - 1 - Math.floor(rows / 6);
      clr(d1, c1); clr(d1 + 1, c1);
      clr(d2, c2); clr(d2 - 1, c2);
    } else if (name === 'spiral') {
      for (var k = 2; k * 2 + 2 < Math.min(rows, cols); k += 2) {
        var r0 = k, r1 = rows - 1 - k, c0 = k, c2b = cols - 1 - k;
        for (var c = c0; c <= c2b; c++) { set(r0, c); set(r1, c); }
        for (var r2 = r0; r2 <= r1; r2++) { set(r2, c0); set(r2, c2b); }
        // 링마다 반대편에 문을 하나씩 뚫는다. 안으로 들어가려면 한 바퀴 돌아야 한다.
        var mid = Math.floor((c0 + c2b) / 2);
        if ((k / 2) % 2 === 0) { clr(r1, mid); clr(r1, mid + 1); }
        else { clr(r0, mid); clr(r0, mid + 1); }
      }
    } else if (name === 'maze') {
      /* 재귀 분할. **벽은 홀수 좌표에만, 통로는 짝수 좌표에만** 둔다.
       * 이 격자 규칙이 없으면 벽에 뚫어 둔 문 바로 옆 칸을 나중 재귀가
       * 다시 벽으로 막아 버려 미로가 끊긴다 — 실제로 목표가 도달 불가능해진다.
       * 규칙을 지키면 문(짝수 좌표)과 벽(홀수 좌표)이 절대 겹치지 않아
       * 어떤 두 통로 칸도 항상 연결된다(완전 미로). */
      var rnd = lcg(0x9E37 ^ (rows * 131 + cols));
      var R1 = rows - 1 - ((rows - 1) % 2);   // 마지막 짝수 행
      var C1 = cols - 1 - ((cols - 1) % 2);
      (function divide(r0, c0, r1, c1, depth) {
        var hh = r1 - r0, ww = c1 - c0;
        if (depth > 12 || (hh < 2 && ww < 2)) return;
        var vertical = ww > hh;
        if (ww < 2) vertical = false;
        else if (hh < 2) vertical = true;
        if (vertical) {
          var cw = c0 + 1 + 2 * Math.floor(rnd() * (ww / 2));            // 홀수 = 벽
          // 격자 크기가 짝수면 마지막 한 줄이 격자 밖에 남는다. 벽을 실제
          // 가장자리까지 늘려야 그 줄이 통짜 복도가 되지 않는다.
          var rEnd = (r1 === R1) ? rows - 1 : r1;
          for (var r = r0; r <= rEnd; r++) set(r, cw);
          clr(r0 + 2 * Math.floor(rnd() * (hh / 2 + 1)), cw);            // 짝수 = 문
          divide(r0, c0, r1, cw - 1, depth + 1);
          divide(r0, cw + 1, r1, c1, depth + 1);
        } else {
          var rw = r0 + 1 + 2 * Math.floor(rnd() * (hh / 2));
          var cEnd = (c1 === C1) ? cols - 1 : c1;
          for (var cc = c0; cc <= cEnd; cc++) set(rw, cc);
          clr(rw, c0 + 2 * Math.floor(rnd() * (ww / 2 + 1)));
          divide(r0, c0, rw - 1, c1, depth + 1);
          divide(rw + 1, c0, r1, c1, depth + 1);
        }
      })(0, 0, R1, C1, 0);
    }
    return wall;
  }

  /* 지형 비용. 4×4 저해상도 격자에서 값을 뽑아 부드럽게 보간한 뒤 3단으로 양자화한다.
   * 칸마다 독립 난수를 뿌리면 점박이가 되어 "돌아가는 게 이득" 이라는 판단이
   * 눈에 보이지 않는다. 늪이 덩어리로 뭉쳐야 우회 경로가 읽힌다.
   * 비용은 **칸에 들어가는 비용**(노드 가중치)이다. 격자 지형의 표준 모델이고,
   * 최소 비용이 1 이므로 맨해튼 휴리스틱이 그대로 허용적이다. */
  function buildWeights(rows, cols, mode) {
    var n = rows * cols, w = new Float64Array(n), i;
    if (mode !== 'terrain') { for (i = 0; i < n; i++) w[i] = 1; return w; }
    var L = 4, rnd = lcg(0x5EED17), lat = new Float64Array((L + 1) * (L + 1));
    for (i = 0; i < lat.length; i++) lat[i] = rnd();
    function smooth(t) { return t * t * (3 - 2 * t); }
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var fy = rows > 1 ? (r / (rows - 1)) * L : 0;
        var fx = cols > 1 ? (c / (cols - 1)) * L : 0;
        var y0 = Math.min(L - 1, Math.floor(fy)), x0 = Math.min(L - 1, Math.floor(fx));
        var ty = smooth(fy - y0), tx = smooth(fx - x0);
        var a = lat[y0 * (L + 1) + x0], b = lat[y0 * (L + 1) + x0 + 1];
        var cD = lat[(y0 + 1) * (L + 1) + x0], d = lat[(y0 + 1) * (L + 1) + x0 + 1];
        var v = (a + (b - a) * tx) + ((cD + (d - cD) * tx) - (a + (b - a) * tx)) * ty;
        w[r * cols + c] = v < 0.42 ? WEIGHT_LEVELS[0] : (v < 0.68 ? WEIGHT_LEVELS[1] : WEIGHT_LEVELS[2]);
      }
    }
    return w;
  }

  // ─── 휴리스틱 ────────────────────────────────────────────────────────────

  /* zero 를 고르면 A* 는 f = g + 0 = g 가 되어 **다익스트라와 완전히 같은
   * 순서로** 칸을 펼친다. V-5 가 하는 주장("다익스트라는 h=0 인 A* 다")을
   * 독자가 직접 확인하는 스위치다.
   * euclidean 은 4-이웃 격자에서 항상 맨해튼 이하이므로 허용적이지만 더 약하다 —
   * 즉 A* 가 다익스트라 쪽으로 조금 되돌아간다. 그 손해도 화면에서 보인다. */
  var HEURISTICS = ['manhattan', 'euclidean', 'zero'];

  function makeH(kind, gr, gc) {
    if (kind === 'zero') return function () { return 0; };
    if (kind === 'euclidean') {
      return function (r, c) { var a = r - gr, b = c - gc; return Math.sqrt(a * a + b * b); };
    }
    return function (r, c) { return Math.abs(r - gr) + Math.abs(c - gc); };
  }

  // ─── 탐색 기록 ───────────────────────────────────────────────────────────

  /* 시간 정의
   *   상태 t = "확장이 t 번 끝난 시점". t=0 은 시작 칸만 열린 목록에 있는 초기 상태.
   *   k 번째(0-기준) 확장은 t=k 와 t=k+1 사이에 일어난다.
   *   확장된 칸은 expandStep = k+1, 그때 열린 목록에서 빠진다.
   *   그 확장에서 새로 열린 이웃은 t=k+1 부터 경계다.
   * 프레임마다 스냅샷을 통째로 저장하지 않고 칸별 "체류 구간" 만 남기는 이유:
   *   30×30 × 900스텝 × 4패널 스냅샷은 메가바이트 단위다. 구간은 칸당 배열 하나면 되고
   *   render 는 구간 검사만 하므로 되감기가 즉시 된다(계약 §7). */
  function newTrace(key, n) {
    var t = {
      key: key, name: ALGO_NAME[key],
      expandStep: new Int32Array(n),  // 0 = 확장된 적 없음
      iv: new Array(n),               // 열린 목록 체류 구간 [in,out, in,out, ...]
      oc: new Int32Array(n),          // DFS 전용: 스택 안 중복 개수
      g: new Float64Array(n),
      h: new Float64Array(n),
      parent: new Int32Array(n),
      order: [],                      // 확장 순서 (칸 인덱스)
      pushed: [],                     // 각 확장에서 새로 연 칸들
      found: false, path: null, pathCost: 0
    };
    for (var i = 0; i < n; i++) { t.parent[i] = -1; t.g[i] = INF; }
    return t;
  }

  function openFirst(st, c, t) { if (!st.iv[c]) st.iv[c] = [t, INF]; }
  function closeIv(st, c, t) {
    var a = st.iv[c];
    if (a && a[a.length - 1] === INF) a[a.length - 1] = t;
  }
  function openAgain(st, c, t) {              // DFS: 같은 칸이 스택에 여러 번 들어간다
    if (st.oc[c]++ === 0) {
      var a = st.iv[c] || (st.iv[c] = []);
      a.push(t, INF);
    }
  }
  function isOpen(iv, t) {
    if (!iv) return false;
    for (var i = 0; i < iv.length; i += 2) if (iv[i] <= t && t < iv[i + 1]) return true;
    return false;
  }

  function tracePath(st, start, goal, g) {
    if (!st.found) return;
    var path = [], c = goal, guard = g.wall.length + 2, cost = 0;
    while (c !== -1 && guard-- > 0) { path.push(c); if (c === start) break; c = st.parent[c]; }
    path.reverse();
    if (path[0] !== start) { st.found = false; return; }
    for (var i = 1; i < path.length; i++) cost += g.w[path[i]];
    st.path = path;
    st.pathCost = cost;
  }

  // ─── 네 알고리즘 ─────────────────────────────────────────────────────────
  //
  // 본문 ::: dual 코드와 같은 알고리즘이어야 한다(계약 §9). 특히
  // 다익스트라와 A* 는 "같은 코드에 h 만 더한 것" 으로 합칠 수 있지만
  // 일부러 따로 적었다 — 합쳐 버리면 "h=0 이면 같아진다" 가 검증 대상이 아니라
  // 구현상 자명한 사실이 되어, 위젯이 아무것도 증명하지 못한다.

  function runBFS(g, start, goal) {
    var n = g.rows * g.cols, st = newTrace('bfs', n);
    var visited = new Uint8Array(n);
    var q = new Int32Array(n), qh = 0, qt = 0;
    var t = 0;

    visited[start] = 1; st.g[start] = 0;
    openFirst(st, start, 0);
    q[qt++] = start;

    while (qh < qt && !st.found) {
      var c = q[qh++];
      t += 1;
      st.expandStep[c] = t;
      closeIv(st, c, t);
      st.order.push(c);
      var pushed = [];
      var cr = (c / g.cols) | 0, cc = c % g.cols;
      for (var d = 0; d < 4; d++) {
        var nr = cr + DR[d], nc = cc + DC[d];
        if (nr < 0 || nr >= g.rows || nc < 0 || nc >= g.cols) continue;
        var nb = nr * g.cols + nc;
        if (g.wall[nb] || visited[nb]) continue;
        /* ★ 방문 표시는 큐에 **넣을 때** 한다. 꺼낼 때 표시하면 같은 칸이
         *   여러 갈래에서 중복으로 큐에 들어가 큐 길이가 지수적으로 부풀고,
         *   최악의 경우 나중에 도착한(더 먼) 경로로 거리가 덮인다.
         *   본문이 ::: pitfall 로 못 박는 지점이라 위젯도 정확히 이대로 짠다. */
        visited[nb] = 1;
        st.g[nb] = st.g[c] + 1;
        st.parent[nb] = c;
        openFirst(st, nb, t);
        q[qt++] = nb;
        pushed.push(nb);
        if (nb === goal) { st.found = true; break; }
      }
      st.pushed.push(pushed);
    }
    if (start === goal) st.found = true;
    tracePath(st, start, goal, g);
    return st;
  }

  function runDFS(g, start, goal) {
    var n = g.rows * g.cols, st = newTrace('dfs', n);
    var visited = new Uint8Array(n);
    var stack = [start];
    var t = 0;

    st.g[start] = 0;
    openAgain(st, start, 0);

    while (stack.length) {
      var c = stack.pop();
      if (visited[c]) {
        // 낡은 항목: 다른 갈래가 이미 이 칸을 먹었다. 스텝을 소비하지 않는다.
        if (st.oc[c] > 0 && --st.oc[c] === 0) closeIv(st, c, t);
        continue;
      }
      visited[c] = 1;
      t += 1;
      st.expandStep[c] = t;
      st.oc[c] = 0; closeIv(st, c, t);
      st.order.push(c);
      st.pushed.push([]);
      if (c === goal) { st.found = true; break; }
      var pushed = st.pushed[st.pushed.length - 1];
      var cr = (c / g.cols) | 0, cc = c % g.cols;
      // 역순으로 넣어야 꺼낼 때 위→오른쪽→아래→왼쪽 순서가 된다.
      for (var d = 3; d >= 0; d--) {
        var nr = cr + DR[d], nc = cc + DC[d];
        if (nr < 0 || nr >= g.rows || nc < 0 || nc >= g.cols) continue;
        var nb = nr * g.cols + nc;
        if (g.wall[nb] || visited[nb]) continue;
        /* DFS 는 목표를 **꺼낼 때** 알아챈다. BFS 처럼 넣을 때 끊으면
         * "먼저 닿은 갈래" 가 답이 되어 버려 DFS 의 성질이 흐려진다.
         * parent 를 덮어쓰는 것도 의도한 것이다 — 가장 최근에 밀어 넣은
         * 칸이 곧 지금 파고 있는 갈래이고, DFS 가 찾는 것은 최단이 아니라
         * **어떤** 경로다. */
        st.parent[nb] = c;
        st.g[nb] = st.g[c] + 1;
        stack.push(nb);
        openAgain(st, nb, t);
        pushed.push(nb);
      }
    }
    tracePath(st, start, goal, g);
    return st;
  }

  function runDijkstra(g, start, goal) {
    var n = g.rows * g.cols, st = newTrace('dijkstra', n);
    var settled = new Uint8Array(n);
    var heap = new Heap(), seq = 0, t = 0;

    st.g[start] = 0;
    openFirst(st, start, 0);
    heap.push([0, seq++, start, 0]);

    while (heap.a.length) {
      var e = heap.pop(), c = e[2];
      // 낡은 항목. 같은 칸을 더 짧은 거리로 이미 확정했다. 감소키 대신
      // 다시 push 하고 여기서 걸러내는 것이 배열 힙에서 가장 싸다.
      if (settled[c]) continue;
      settled[c] = 1;
      t += 1;
      st.expandStep[c] = t;
      closeIv(st, c, t);
      st.order.push(c);
      st.pushed.push([]);
      if (c === goal) { st.found = true; break; }
      var pushed = st.pushed[st.pushed.length - 1];
      var cr = (c / g.cols) | 0, cc = c % g.cols;
      for (var d = 0; d < 4; d++) {
        var nr = cr + DR[d], nc = cc + DC[d];
        if (nr < 0 || nr >= g.rows || nc < 0 || nc >= g.cols) continue;
        var nb = nr * g.cols + nc;
        if (g.wall[nb] || settled[nb]) continue;
        var nd = st.g[c] + g.w[nb];
        if (nd < st.g[nb]) {
          st.g[nb] = nd;
          st.parent[nb] = c;
          heap.push([nd, seq++, nb, nd]);
          openFirst(st, nb, t);
          pushed.push(nb);
        }
      }
    }
    tracePath(st, start, goal, g);
    return st;
  }

  function runAStar(g, start, goal, hFn) {
    var n = g.rows * g.cols, st = newTrace('astar', n);
    var settled = new Uint8Array(n);
    var heap = new Heap(), seq = 0, t = 0;
    var sr = (start / g.cols) | 0, sc = start % g.cols;

    st.g[start] = 0;
    st.h[start] = hFn(sr, sc);
    openFirst(st, start, 0);
    heap.push([st.h[start], seq++, start, 0]);

    while (heap.a.length) {
      var e = heap.pop(), c = e[2];
      if (settled[c]) continue;
      settled[c] = 1;
      t += 1;
      st.expandStep[c] = t;
      closeIv(st, c, t);
      st.order.push(c);
      st.pushed.push([]);
      if (c === goal) { st.found = true; break; }
      var pushed = st.pushed[st.pushed.length - 1];
      var cr = (c / g.cols) | 0, cc = c % g.cols;
      for (var d = 0; d < 4; d++) {
        var nr = cr + DR[d], nc = cc + DC[d];
        if (nr < 0 || nr >= g.rows || nc < 0 || nc >= g.cols) continue;
        var nb = nr * g.cols + nc;
        if (g.wall[nb] || settled[nb]) continue;
        var nd = st.g[c] + g.w[nb];
        if (nd < st.g[nb]) {
          st.g[nb] = nd;
          st.h[nb] = hFn(nr, nc);
          st.parent[nb] = c;
          // f = g + h. h 가 실제 잔여 비용을 넘지 않는 한(허용적) 최적해가 보장된다.
          heap.push([nd + st.h[nb], seq++, nb, nd]);
          openFirst(st, nb, t);
          pushed.push(nb);
        }
      }
    }
    tracePath(st, start, goal, g);
    return st;
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('grid-search', function (host, opts) {
    if (!opts || typeof opts !== 'object') opts = {};

    // ---- opts 검증. 본문 저자가 손으로 쓴 JSON 이라 신뢰하지 않는다(계약 §1) ----
    var rows = clampInt(opts.rows, DIM_MIN, DIM_MAX, 16);
    var cols = clampInt(opts.cols, DIM_MIN, DIM_MAX, 16);
    while (rows * cols > MAX_CELLS) { if (rows >= cols) rows--; else cols--; }

    var algos = [];
    if (Object.prototype.toString.call(opts.algos) === '[object Array]') {
      for (var ai = 0; ai < opts.algos.length; ai++) {
        var a = opts.algos[ai];
        if (ALGOS.indexOf(a) >= 0 && algos.indexOf(a) < 0) algos.push(a);
      }
    }
    if (!algos.length) algos = ALGOS.slice();

    var weightMode = oneOf(opts.weights, ['uniform', 'terrain'], 'uniform');
    var hKind = oneOf(opts.heuristic, HEURISTICS, 'manhattan');

    function pickCell(v, dr, dc) {
      if (Object.prototype.toString.call(v) !== '[object Array]') return dr * cols + dc;
      return clampInt(v[0], 0, rows - 1, dr) * cols + clampInt(v[1], 0, cols - 1, dc);
    }
    var start = pickCell(opts.start, Math.min(1, rows - 1), Math.min(1, cols - 1));
    var goal = pickCell(opts.goal, rows - 1 - Math.min(1, rows - 1), cols - 1 - Math.min(1, cols - 1));
    if (start === goal) goal = (start + 1) % (rows * cols);   // 같으면 볼 것이 없다

    var grid = {
      rows: rows, cols: cols,
      wall: buildWalls(rows, cols, opts.walls),
      w: buildWeights(rows, cols, weightMode)
    };
    /* 시작·목표 칸은 벽일 수 없다. 게다가 미로에서는 그 칸만 뚫어 봐야
     * 사방이 벽이라 고립될 수 있으므로, 이웃이 전부 벽이면 하나를 열어 준다.
     * (사용자가 walls 로 목표를 통째로 둘러싸는 것까지 막지는 않는다 —
     *  그때는 "경로 없음" 이 정직한 답이다.) */
    function openCell(c) {
      grid.wall[c] = 0;
      var r = (c / cols) | 0, cc = c % cols, first = -1, free = false;
      for (var d = 0; d < 4; d++) {
        var nr = r + DR[d], nc = cc + DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var nb = nr * cols + nc;
        if (first < 0) first = nb;
        if (!grid.wall[nb]) { free = true; break; }
      }
      if (!free && first >= 0) grid.wall[first] = 0;
    }
    openCell(start);
    openCell(goal);

    // ---- 상태 ----
    var panes = [];
    var total = 1;
    var bestCost = INF;
    var focus = algos[0];
    var layout = null;
    var cur = 0;

    function recompute() {
      var hFn = makeH(hKind, (goal / cols) | 0, goal % cols);
      panes = [];
      var maxLen = 0;
      for (var i = 0; i < algos.length; i++) {
        var st;
        if (algos[i] === 'bfs') st = runBFS(grid, start, goal);
        else if (algos[i] === 'dfs') st = runDFS(grid, start, goal);
        else if (algos[i] === 'dijkstra') st = runDijkstra(grid, start, goal);
        else st = runAStar(grid, start, goal, hFn);
        panes.push(st);
        if (st.order.length > maxLen) maxLen = st.order.length;
      }
      total = maxLen + 1;
      bestCost = INF;
      for (var j = 0; j < panes.length; j++) {
        if (panes[j].found && panes[j].pathCost < bestCost) bestCost = panes[j].pathCost;
      }
    }
    recompute();

    function paneOf(key) {
      for (var i = 0; i < panes.length; i++) if (panes[i].key === key) return panes[i];
      return panes[0];
    }

    // ---- 껍데기 ----
    var ui = K.frame(host, { title: '같은 격자 · 다른 우선순위 규칙', wide: true });

    // 세그먼트 세 개. 지형/휴리스틱은 "무엇이 달라지는가" 를 독자가 직접
    // 뒤집어 볼 수 있어야 하는 축이라 opts 뿐 아니라 UI 로도 연다.
    K.seg(ui.slot, [
      { label: '균일', value: 'uniform' },
      { label: '가중 지형', value: 'terrain' }
    ], weightMode, function (v) {
      weightMode = v;
      grid.w = buildWeights(rows, cols, weightMode);
      recompute();
      player.goto(cur);
    });

    K.seg(ui.slot, [
      { label: 'h=맨해튼', value: 'manhattan' },
      { label: '유클리드', value: 'euclidean' },
      { label: 'h=0', value: 'zero' }
    ], hKind, function (v) {
      hKind = v;
      recompute();
      player.goto(cur);
    });

    var focusSeg = algos.map(function (k) { return { label: ALGO_NAME[k], value: k }; });
    K.seg(ui.slot, focusSeg, focus, function (v) {
      focus = v;
      layout = null;          // 좁은 화면에서는 보이는 패널 자체가 바뀐다
      player.goto(cur);
    });

    var legend = K.el('div', 'wk-legend');
    [
      ['--w-start', '시작 S'],
      ['--w-goal', '목표 G'],
      ['--w-wall', '벽 (빗금)'],
      ['--w-frontier', '경계 = 열린 목록 (고리)'],
      ['--w-visited', '확장 완료 — 크고 진할수록 나중'],
      ['--w-path', '최종 경로']
    ].forEach(function (p) {
      var s = K.el('span');
      var i = K.el('i');
      i.style.background = 'var(' + p[0] + ')';
      s.appendChild(i);
      s.appendChild(document.createTextNode(p[1]));
      legend.appendChild(s);
    });
    legend.appendChild(K.el('span', null, '· 격자를 드래그하면 벽이 그려지고 넷이 즉시 다시 탐색한다'));
    legend.appendChild(K.el('span', null, '· 지형 점 ●=3배 ●●=6배 비용'));
    ui.root.insertBefore(legend, ui.ctl);

    // ---- 배치 계산 ----
    /* 폭에 따라 패널 개수를 바꾼다(계약 §4).
     *   ≥1000px  2×2. 넷을 한눈에 — 이 위젯의 설계 목적 그대로다.
     *   700~1000 2×2 유지, 셀만 작아진다.
     *   <700px   **한 번에 한 패널.** 넷을 우겨넣으면 셀이 5px 아래로 내려가
     *            확장 모양이고 뭐고 죽 한 덩어리가 된다. 폰에서는 비교를 포기하고
     *            가독성을 산다 — 알고리즘 선택은 위의 세그먼트가 맡는다.
     * 셀 크기는 폭과 높이 예산에서 함께 뽑되, MIN_CELL 아래로 내려가면
     * 셀을 더 줄이는 대신 패널 수를 줄인다. */
    function computeLayout(w) {
      var narrow = w < 700;
      var list = narrow ? [focus] : algos.slice();
      var gap = narrow ? 10 : 16;
      var n = list.length, cellsz = 0, gcols, grows, paneW, maxH;

      for (;;) {
        gcols = (n >= 3) ? 2 : ((n === 2 && w >= 700) ? 2 : 1);
        grows = Math.ceil(n / gcols);
        paneW = Math.floor((w - gap * (gcols - 1)) / gcols);
        maxH = (n === 1) ? MAX_H_ONE : MAX_H_MULTI;
        var byW = (paneW - PAD * 2) / cols;
        var byH = ((maxH - gap * (grows - 1)) / grows - HEAD - PAD * 2) / rows;
        cellsz = Math.floor(Math.min(byW, byH, MAX_CELL));
        if (cellsz >= MIN_CELL || n === 1) break;
        n = (n >= 3) ? 2 : 1;
        list = list.slice(0, n);
      }
      if (cellsz < 3) cellsz = 3;

      var gridW = cellsz * cols, gridH = cellsz * rows;
      // 패널을 격자에 딱 맞게 좁힌 뒤 블록 전체를 가운데로 모은다. 넓은 화면에서
      // 패널을 폭 끝까지 늘리면 네 격자가 서로 멀어져 비교가 안 된다.
      var pw = Math.max(gridW + PAD * 2, Math.min(paneW, MIN_PANE_W));
      if (pw > paneW) pw = paneW;
      var paneH = HEAD + gridH + PAD * 2;
      var blockW = gcols * pw + gap * (gcols - 1);
      return {
        w: w, list: list, gcols: gcols, grows: grows, gap: gap,
        cell: cellsz, paneW: pw, paneH: paneH, gridW: gridW, gridH: gridH,
        ox: Math.max(0, Math.floor((w - blockW) / 2)),
        height: grows * paneH + gap * (grows - 1) + 2
      };
    }

    function layoutFor(w) {
      if (!layout || layout.w !== w) layout = computeLayout(w);
      return layout;
    }

    function paneBox(L, idx) {
      var col = idx % L.gcols, row = (idx / L.gcols) | 0;
      var x = L.ox + col * (L.paneW + L.gap), y = row * (L.paneH + L.gap);
      return { x: x, y: y, gx: x + Math.floor((L.paneW - L.gridW) / 2), gy: y + HEAD };
    }

    // ---- 그리기 ----
    function draw(ctx, size, T) {
      var L = layoutFor(size.w);
      ctx.textBaseline = 'alphabetic';
      for (var p = 0; p < L.list.length; p++) drawPane(ctx, T, L, p, paneOf(L.list[p]));
    }

    function drawPane(ctx, T, L, idx, st) {
      var box = paneBox(L, idx);
      var cell = L.cell;
      var done = Math.min(cur, st.order.length);       // 이 패널의 지금까지 확장 수
      var denom = Math.max(1, done);
      var showPath = st.found && cur >= st.order.length && st.path;
      var isFocus = st.key === focus;

      // 머리줄: 이름 + 규칙 + 카운터. 카운터가 이 위젯의 결론이다.
      ctx.font = '700 12px ' + FONT;
      ctx.fillStyle = isFocus ? T.accent : T.fg;
      ctx.fillText(st.name, box.x + PAD, box.y + 13);
      var nameW = ctx.measureText(st.name).width;
      ctx.font = '11px ' + FONT;
      ctx.fillStyle = T.fgFaint;
      if (L.paneW > 200) ctx.fillText('— ' + ALGO_RULE[st.key], box.x + PAD + nameW + 6, box.y + 13);

      var stat = '확장 ' + done + '칸';
      var warn = false;
      if (showPath) {
        stat += ' · 경로 ' + (st.path.length - 1) + '칸 · 비용 ' + st.pathCost;
        if (st.pathCost > bestCost + 1e-9) { stat += '  ← 최단 아님'; warn = true; }
      } else if (cur >= st.order.length && !st.found) {
        stat += ' · 경로 없음';
        warn = true;
      } else if (cur > st.order.length) {
        stat += ' · 종료';
      }
      ctx.font = '700 11px ' + FONT;
      ctx.fillStyle = warn ? T.boxWarn : T.fgDim;
      ctx.fillText(stat, box.x + PAD, box.y + 27);

      // 격자 바탕
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(box.gx, box.gy, L.gridW, L.gridH);

      var n = rows * cols;
      for (var c = 0; c < n; c++) {
        var x = box.gx + (c % cols) * cell, y = box.gy + ((c / cols) | 0) * cell;

        if (grid.wall[c]) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = T.wWall;
          ctx.fillRect(x, y, cell, cell);
          /* 색을 구분하지 못해도 벽임을 알 수 있게 빗금을 긋는다(계약 §5).
           * 빗금 색으로 --fg-faint 를 쓰는 이유: 다크에서 --w-wall 은 배경보다
           * 겨우 한 단계 밝을 뿐이라 벽 덩어리가 배경에 묻힌다. 글자색 계열로
           * 그으면 라이트·다크 양쪽에서 벽이 항상 벽으로 읽힌다. */
          if (cell >= 7) {
            ctx.globalAlpha = 0.45;
            ctx.strokeStyle = T.fgFaint;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y);
            ctx.moveTo(x + cell * 0.5, y + cell); ctx.lineTo(x + cell, y + cell * 0.5);
            ctx.moveTo(x, y + cell * 0.5); ctx.lineTo(x + cell * 0.5, y);
            ctx.stroke();
          }
          continue;
        }

        // 지형 바탕 — 비용이 높을수록 살짝 어둡게 깐다.
        var wv = grid.w[c];
        if (wv > 1) {
          ctx.globalAlpha = 0.10 + 0.10 * (wv / WEIGHT_LEVELS[WEIGHT_LEVELS.length - 1]);
          ctx.fillStyle = T.wWall;
          ctx.fillRect(x, y, cell, cell);
        }

        var es = st.expandStep[c];
        if (es > 0 && es <= done) {
          /* 방문 순서 → **농도 + 크기** 두 겹으로 그린다.
           *   ① 옅은 전면 칠: "여기는 이미 펼쳐진 영역이다"
           *   ② 가운데 정사각형: 변 길이와 농도가 확장 순서에 비례한다
           * 농도만 쓰면 --w-visited 가 배경 대비가 낮은 색이라(라이트에서는
           * 거의 흰색, 다크에서는 거의 배경색) 순서 차이가 눈에 남지 않는다.
           * 크기를 같이 흔들면 색을 구분하지 못하는 독자에게도 순서가 보인다(계약 §5).
           * 그 결과 BFS 는 안쪽이 작고 바깥이 꽉 찬 동심원, A* 는 목표를 향한
           * 쐐기로 굳어져 **정지 화면 한 장만으로** 네 알고리즘이 구별된다.
           *
           * 분모를 "지금까지의 확장 수" 로 두는 이유: 재생 중에도 알파·크기
           * 전 구간을 쓰게 되어 파면이 선명하게 굴러간다. 마지막 프레임에서는
           * 분모가 전체 확장 수가 되므로 완전한 등고선이 남는다. */
          var ratio = es / denom;
          ctx.globalAlpha = 0.20 + 0.28 * ratio;
          ctx.fillStyle = T.wVisited;
          ctx.fillRect(x, y, cell, cell);
          var side = Math.round(cell * (0.24 + 0.76 * ratio));
          if (side > 0) {
            ctx.globalAlpha = 0.5 + 0.5 * ratio;
            ctx.fillRect(x + ((cell - side) >> 1), y + ((cell - side) >> 1), side, side);
          }
        } else if (isOpen(st.iv[c], Math.min(cur, st.order.length))) {
          // 경계는 가운데가 뚫린 고리로 그린다. 채워진 정사각형(확장 완료)과
          // 색이 아니라 모양으로도 갈린다.
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = T.wFrontier;
          ctx.fillRect(x, y, cell, cell);
          if (cell >= 9) {
            var hole = Math.round(cell * 0.34);
            ctx.globalAlpha = 1;
            ctx.fillStyle = T.bgElev;
            ctx.fillRect(x + ((cell - hole) >> 1), y + ((cell - hole) >> 1), hole, hole);
          }
        }

        // 지형 점. 색이 아니라 개수로 비용을 읽게 한다(계약 §5).
        if (wv > 1 && cell >= 9) {
          var dots = WEIGHT_LEVELS.indexOf(wv);
          if (dots < 1) dots = 1;
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = T.fg;
          var rr = Math.max(1, cell * 0.075);
          for (var k = 0; k < dots; k++) {
            ctx.beginPath();
            ctx.arc(x + cell / 2 + (k - (dots - 1) / 2) * rr * 3, y + cell / 2, rr, 0, 6.2832);
            ctx.fill();
          }
        }
      }

      // 최종 경로 — 금색은 "확정" 전용이라 여기서만 쓴다.
      if (showPath) {
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = T.wPath;
        for (var pi = 0; pi < st.path.length; pi++) {
          var pc = st.path[pi];
          ctx.fillRect(box.gx + (pc % cols) * cell, box.gy + ((pc / cols) | 0) * cell, cell, cell);
        }
      }

      // 시작·목표
      ctx.globalAlpha = 1;
      drawMark(ctx, T, box, cell, start, T.wStart, 'S');
      drawMark(ctx, T, box, cell, goal, T.wGoal, 'G');

      // 격자선
      if (cell >= 6) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var gi = 0; gi <= cols; gi++) {
          ctx.moveTo(box.gx + gi * cell + 0.5, box.gy);
          ctx.lineTo(box.gx + gi * cell + 0.5, box.gy + L.gridH);
        }
        for (var gj = 0; gj <= rows; gj++) {
          ctx.moveTo(box.gx, box.gy + gj * cell + 0.5);
          ctx.lineTo(box.gx + L.gridW, box.gy + gj * cell + 0.5);
        }
        ctx.stroke();
      }

      // 패널 테두리. 초점 패널만 액센트로 — 상태 줄이 설명하는 대상이 어느 것인지 잇는다.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = isFocus ? T.accent : T.border;
      ctx.lineWidth = isFocus ? 2 : 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, L.paneW - 1, L.paneH - 1);
    }

    function drawMark(ctx, T, box, cell, c, color, ch) {
      var x = box.gx + (c % cols) * cell, y = box.gy + ((c / cols) | 0) * cell;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, cell, cell);
      if (cell >= 11) {
        ctx.fillStyle = T.bg;
        ctx.font = '700 ' + Math.round(cell * 0.62) + 'px ' + FONT;
        var w = ctx.measureText(ch).width;
        ctx.fillText(ch, x + (cell - w) / 2, y + cell * 0.76);
      }
    }

    // ---- 캔버스 ----
    var canvas = K.canvas(ui.stage, {
      height: function (w) { return layoutFor(w).height; },
      draw: draw
    });
    // 캔버스 위에서만 터치 스크롤을 끈다. stage 는 놔둔다(계약 §6).
    canvas.el.style.touchAction = 'none';
    canvas.el.style.cursor = 'crosshair';

    // ---- 상태 줄 ----
    function rc(c) { return '(' + ((c / cols) | 0) + ',' + (c % cols) + ')'; }

    function gText(st, c) {
      if (st.key === 'bfs') return '거리 ' + st.g[c];
      if (st.key === 'dfs') return '깊이 ' + st.g[c];
      if (st.key === 'dijkstra') return '누적 비용 g=' + round1(st.g[c]);
      return 'g=' + round1(st.g[c]) + ', h=' + round1(st.h[c]) + ', f=' + round1(st.g[c] + st.h[c]);
    }
    function round1(v) { return Math.round(v * 10) / 10; }

    function label(i) {
      var st = paneOf(focus);
      var s;
      if (i === 0) {
        s = '시작 상태. 열린 목록에는 시작 칸 ' + rc(start) + ' 하나뿐이다. ' +
            '네 패널 모두 같은 격자·같은 시작·같은 목표를 쓴다.';
      } else if (i <= st.order.length) {
        var c = st.order[i - 1];
        var pushed = st.pushed[i - 1] || [];
        s = st.name + ' — ' + i + '번째 확장: ' + rc(c) + ' 를 꺼내 확정했다. ' + gText(st, c) + '. ';
        if (pushed.length) {
          var names = [];
          for (var k = 0; k < pushed.length && k < 4; k++) names.push(rc(pushed[k]));
          s += '열린 목록에 ' + names.join(', ') + ' 를 넣었다.';
        } else {
          s += '새로 열린 칸은 없다.';
        }
        if (c === goal) s += ' 목표에 닿았다.';
      } else {
        s = st.name + ' — 이미 끝났다. ';
        s += st.found
          ? ('확장 ' + st.order.length + '칸, 경로 ' + (st.path.length - 1) + '칸, 비용 ' + st.pathCost + '.')
          : '경로가 없다.';
      }
      var parts = [];
      for (var p = 0; p < panes.length; p++) {
        var q = panes[p];
        parts.push(q.name + ' ' + Math.min(i, q.order.length) +
          (i >= q.order.length ? (q.found ? '(완료)' : '(실패)') : ''));
      }
      return s + '  ▸ 확장 수 — ' + parts.join(' / ') + '.';
    }

    // ---- 재생기 ----
    var player = K.player(ui, {
      total: function () { return total; },
      render: function (i) { cur = i; canvas.redraw(); },
      label: label
    });

    // ---- 벽 그리기 (마우스 + 터치) ----
    var painting = false, paintTo = 0, lastCell = -1;

    function hit(e) {
      var L = layoutFor(canvas.size.w || ui.stage.clientWidth || 320);
      var rect = canvas.el.getBoundingClientRect();
      if (!rect.width || !rect.height) return -1;
      var x = (e.clientX - rect.left) * (canvas.size.w / rect.width);
      var y = (e.clientY - rect.top) * (canvas.size.h / rect.height);
      for (var p = 0; p < L.list.length; p++) {
        var box = paneBox(L, p);
        var lx = x - box.gx, ly = y - box.gy;
        if (lx < 0 || ly < 0 || lx >= L.gridW || ly >= L.gridH) continue;
        var c = ((ly / L.cell) | 0) * cols + ((lx / L.cell) | 0);
        return (c >= 0 && c < rows * cols) ? c : -1;
      }
      return -1;
    }

    var dirty = false, queued = false;
    function flush() {
      queued = false;
      if (!dirty) return;
      dirty = false;
      recompute();
      player.goto(cur);        // player 가 알아서 범위를 자른다
    }
    function markDirty() {
      dirty = true;
      if (queued) return;
      queued = true;
      requestAnimationFrame(flush);
    }

    function paint(c) {
      if (c < 0 || c === start || c === goal) return;
      if (grid.wall[c] === paintTo) return;
      grid.wall[c] = paintTo;
      markDirty();
    }

    // 빠르게 끌면 pointermove 가 칸을 건너뛴다. 두 칸 사이를 이어 칠한다.
    function paintLine(a, b) {
      if (a < 0) { paint(b); return; }
      var r0 = (a / cols) | 0, c0 = a % cols, r1 = (b / cols) | 0, c1 = b % cols;
      var dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
      var sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
      var err = dr - dc, guard = rows + cols + 4;
      for (;;) {
        paint(r0 * cols + c0);
        if ((r0 === r1 && c0 === c1) || guard-- <= 0) break;
        var e2 = err * 2;
        if (e2 > -dc) { err -= dc; r0 += sr; }
        if (e2 < dr) { err += dr; c0 += sc; }
      }
    }

    canvas.el.addEventListener('pointerdown', function (e) {
      var c = hit(e);
      if (c < 0) return;
      e.preventDefault();
      player.stop();
      painting = true;
      // 첫 칸이 벽이면 지우기, 아니면 그리기. 같은 제스처로 둘 다 된다.
      paintTo = grid.wall[c] ? 0 : 1;
      lastCell = -1;
      paint(c);
      lastCell = c;
      if (canvas.el.setPointerCapture) {
        try { canvas.el.setPointerCapture(e.pointerId); } catch (err) { /* 캡처 실패는 무시 */ }
      }
    });

    canvas.el.addEventListener('pointermove', function (e) {
      if (!painting) return;
      e.preventDefault();
      var c = hit(e);
      if (c < 0 || c === lastCell) return;
      paintLine(lastCell, c);
      lastCell = c;
    });

    function endPaint() { painting = false; lastCell = -1; }
    canvas.el.addEventListener('pointerup', endPaint);
    canvas.el.addEventListener('pointercancel', endPaint);
    canvas.el.addEventListener('lostpointercapture', endPaint);

    // 폭이 바뀌면 배치를 다시 뽑아야 한다. canvas 의 ResizeObserver 가
    // height(w) 를 먼저 부르므로 layoutFor 의 캐시 무효화만으로 충분하다.
    player.goto(0);
  });
})();

/* ==== hash-table.js ==== */
/* hash-table.js — 해시 함수 → 버킷 배치 → 충돌 → 체이닝/개방주소법 → 리해싱
 *
 * 이 위젯이 반박하려는 믿음은 하나다: "해시 테이블은 O(1)이다."
 * 맞다. 단 **평균**이고, 그 평균에는 조건이 붙는다 — 해시가 잘 흩어질 것,
 * 적재율이 낮을 것. 조건이 깨지면 무슨 일이 벌어지는지는 말로 하면 안 믿는다.
 * 군집(cluster)이 자라는 것을 한 스텝씩 보여 주고, 그 옆에 평균 탐사 횟수를
 * 같이 띄운다. 숫자가 논증이다.
 *
 * 왜 스텝을 이렇게 쪼갰는가
 *   키 → 해시값 → % 용량 → 버킷 → (충돌) → 탐사 → 배치.
 *   초보자가 해시 테이블을 어려워하는 지점은 "해시값"과 "버킷 번호"를
 *   구분하지 못하는 데 있다. 그래서 파이프라인 네 칸을 항상 띄워 두고
 *   어느 칸이 지금 바뀌는지를 보이게 한다. 탐사는 한 칸이 한 스텝이다 —
 *   개방 주소법의 비용은 "몇 칸을 더 봤는가"이므로 그것이 스텝의 단위여야 한다.
 *
 * 왜 일부러 약한 해시를 기본값으로 두는가
 *   문자 코드의 합은 실무에서 쓰면 안 되는 해시다. 하지만 교육용으로는
 *   그래서 좋다. 값이 작아 손으로 검산되고, ape·cod·eel 처럼 합이 완전히
 *   같은 키가 생겨 "해시가 같으면 용량을 아무리 키워도 같은 버킷"이라는
 *   사실이 눈에 보인다. 잘 흩어지는 해시(FNV-1a)로 전환해 비교할 수 있게
 *   두 개를 다 넣었다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // ---------------------------------------------------------------- 상수

  var STRATEGIES = ['chaining', 'linear', 'quadratic', 'double'];
  var STRATEGY_LABEL = {
    chaining: '체이닝',
    linear: '선형 탐사',
    quadratic: '이차 탐사',
    double: '이중 해싱'
  };
  var HASHES = ['simple', 'fnv'];
  var HASH_LABEL = { simple: '약한 해시', fnv: 'FNV-1a' };

  // 기본 키 — 충돌이 안 나는 시연은 아무것도 가르치지 못한다. 그래서
  // 약한 해시에서 실제로 부딪히도록 고른 세 글자 동물 이름들이다.
  //   ape / cod / eel  : 문자 코드 합이 모두 310. 용량을 늘려도 영원히 같은 버킷.
  //   emu / rat        : 합이 모두 327. 같은 쌍.
  //   bug / hog        : 합이 모두 318. 용량 8에서는 ape 무리와 겹치지만
  //                      16으로 늘리면 떨어져 나간다 — 리해싱이 푸는 충돌.
  var DEFAULT_KEYS = ['cat', 'ape', 'cod', 'eel', 'emu', 'rat', 'bug', 'hog', 'owl', 'fox', 'yak', 'hen'];

  // 조회 시연에 쓸 "없는 키" 후보. 이 중 탐사가 가장 길어지는 것을 고른다.
  // 군집 한복판에 떨어지는 실패 조회가 가장 비싸다는 것을 보여야 하기 때문이다.
  var MISS_CANDIDATES = ['zoo', 'pup', 'cub', 'kit', 'jam'];

  var MAX_STEPS = 600;   // 폭주 방지. 기본값에서는 90 안팎이다.
  var MAX_KEYS = 32;
  var TOMB = { tomb: true };   // 묘비(삭제 표식). 참조 하나를 공유해도 안전하다.

  // ---------------------------------------------------------------- 해시

  /* 약한 해시: 문자 코드의 합.
   * 자리(position)를 전혀 반영하지 않으므로 애너그램이 전부 같은 값이 된다.
   * 실무에서는 재앙이지만, 여기서는 그 재앙을 보여 주는 것이 목적이다. */
  function hashSimple(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h += s.charCodeAt(i);
    return h;
  }

  /* FNV-1a 32비트: 실제로 쓰이는 해시. 자리마다 곱셈으로 섞어 버린다.
   * >>> 0 으로 부호 없는 32비트로 되돌린다(JS 비트 연산은 부호 있는 32비트). */
  function hashFnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      // 곱셈 상수 16777619. 큰 수 정밀도를 잃지 않도록 시프트 합으로 편다.
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
      h = h >>> 0;
    }
    return h >>> 0;
  }

  /* 이중 해싱의 두 번째 해시(간격). 첫 해시와 독립이어야 하므로 djb2 를 쓴다.
   * 같은 함수를 재활용하면 h1 이 같은 키는 h2 도 같아 이중 해싱의 이점이 사라진다. */
  function hashDjb2(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }

  /* 이중 해싱 간격 h2.
   * 절대 조건 두 가지: h2 != 0 (안 그러면 제자리를 무한히 다시 본다),
   * 그리고 gcd(h2, cap) == 1 (안 그러면 탐사가 테이블 전체를 못 돈다).
   * 용량이 2의 거듭제곱이면 홀수가 곧 서로소이므로 |1 로 끝난다.
   * 그 외 용량은 서로소가 될 때까지 올린다(h2=1 은 항상 서로소라 반드시 끝난다). */
  function stepOf(key, cap) {
    var g = hashDjb2(key);
    if (isPow2(cap)) return ((g % cap) | 1);
    var s = 1 + (g % (cap - 1));
    var guard = 0;
    while (gcd(s, cap) !== 1 && guard++ < cap) s = (s % (cap - 1)) + 1;
    return s;
  }

  // ---------------------------------------------------------------- opts 검증
  //
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 신뢰하지 않는다(계약 §1).

  function num(v, def, lo, hi) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  }

  function normalize(opts) {
    opts = (opts && typeof opts === 'object') ? opts : {};

    var strategy = STRATEGIES.indexOf(opts.strategy) >= 0 ? opts.strategy : 'chaining';
    var hash = HASHES.indexOf(opts.hash) >= 0 ? opts.hash : 'simple';
    var capacity = Math.round(num(opts.capacity, 8, 2, 64));
    var loadFactor = num(opts.loadFactor, 0.75, 0.1, 4);

    var keys = [];
    var seen = {};
    var raw = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : DEFAULT_KEYS;
    for (var i = 0; i < raw.length && keys.length < MAX_KEYS; i++) {
      var k = raw[i];
      if (typeof k === 'number' && isFinite(k)) k = String(k);
      if (typeof k !== 'string') continue;
      k = k.trim();
      if (!k) continue;
      if (k.length > 12) k = k.slice(0, 12);
      // 같은 키를 두 번 넣는 것은 삽입이 아니라 갱신이다. 시연의 초점이
      // 흐려지므로 미리 중복을 걷어낸다.
      if (seen[k]) continue;
      seen[k] = 1;
      keys.push(k);
    }
    if (!keys.length) keys = DEFAULT_KEYS.slice();

    var deletes = [];
    if (Array.isArray(opts.deletes)) {
      for (var j = 0; j < opts.deletes.length && deletes.length < 6; j++) {
        var d = opts.deletes[j];
        if (typeof d === 'number' && isFinite(d)) d = String(d);
        if (typeof d === 'string' && seen[d.trim()]) deletes.push(d.trim());
      }
    }

    // 조회 시연에 쓸 키를 저자가 직접 고를 수 있게 열어 둔다.
    // 비워 두면 "가장 비싼 성공 조회 + 가장 비싼 실패 조회"를 자동으로 고른다.
    var lookupKeys = null;
    if (Array.isArray(opts.lookupKeys)) {
      lookupKeys = [];
      for (var m = 0; m < opts.lookupKeys.length && lookupKeys.length < MAX_KEYS; m++) {
        var lk = opts.lookupKeys[m];
        if (typeof lk === 'number' && isFinite(lk)) lk = String(lk);
        if (typeof lk === 'string' && lk.trim()) lookupKeys.push(lk.trim().slice(0, 12));
      }
      if (!lookupKeys.length) lookupKeys = null;
    }

    return {
      strategy: strategy, hash: hash, capacity: capacity,
      loadFactor: loadFactor, keys: keys, deletes: deletes,
      lookupKeys: lookupKeys,
      lookup: opts.lookup !== false
    };
  }

  // ---------------------------------------------------------------- 테이블 동작
  //
  // 여기 구현은 본문의 ::: dual 코드와 같은 알고리즘이어야 한다.
  // 위젯이 거짓말을 하면 안 된다(계약 §9).

  function makeSlots(cap, chaining) {
    var a = new Array(cap);
    for (var i = 0; i < cap; i++) a[i] = chaining ? [] : null;
    return a;
  }

  function copySlots(slots, chaining) {
    if (!chaining) return slots.slice();
    var a = new Array(slots.length);
    for (var i = 0; i < slots.length; i++) a[i] = slots[i].slice();
    return a;
  }

  /* 탐사 위치. i 는 0 부터.
   *   linear    : (h + i) % cap
   *   quadratic : (h + i²) % cap
   *       주의 — 이 수식은 용량이 소수이고 적재율 < 0.5 일 때만 빈 칸을 찾는다는
   *       보장이 있다. 용량이 2의 거듭제곱이면 (h + i²) 는 이차 잉여만 밟아
   *       칸의 절반가량밖에 못 본다. 그래서 아래 insert 는 cap 회 탐사해도
   *       못 찾으면 리해싱으로 탈출한다 — 실패를 감추지 않고 그대로 보여 준다.
   *       (2의 거듭제곱에서 전 칸을 도는 변형은 삼각수 (h + i(i+1)/2) 다.)
   *   double    : (h1 + i*h2) % cap, h2 는 0 이 아니고 cap 과 서로소.
   */
  function probeAt(strategy, home, i, cap, h2) {
    if (i === 0) return home;
    if (strategy === 'linear') return (home + i) % cap;
    if (strategy === 'quadratic') return (home + i * i) % cap;
    if (strategy === 'double') return (home + i * h2) % cap;
    return home;
  }

  function probeExpr(strategy, i, cap, h2) {
    if (strategy === 'linear') return '(h+' + i + ') % ' + cap;
    if (strategy === 'quadratic') return '(h+' + i + '²) % ' + cap;
    if (strategy === 'double') return '(h+' + i + '×' + h2 + ') % ' + cap;
    return 'h % ' + cap;
  }

  /* 조회 경로. 삽입과 **같은** 순서로 밟아야 한다.
   * 개방 주소법에서 이 둘이 어긋나면 키가 조용히 사라진다. */
  function findPath(cfg, slots, cap, key) {
    var h = cfg.hashFn(key);
    var home = h % cap;
    var path = [];
    if (cfg.strategy === 'chaining') {
      var b = slots[home];
      for (var c = 0; c < b.length; c++) {
        path.push(home);
        if (b[c].k === key) return { found: true, probes: c + 1, at: home, chainPos: c, path: path, h: h, home: home };
      }
      return { found: false, probes: Math.max(1, b.length), at: home, chainPos: -1, path: [home], h: h, home: home };
    }
    var h2 = cfg.strategy === 'double' ? stepOf(key, cap) : 1;
    for (var i = 0; i < cap; i++) {
      var idx = probeAt(cfg.strategy, home, i, cap, h2);
      path.push(idx);
      var e = slots[idx];
      if (e === null) return { found: false, probes: i + 1, at: idx, path: path, h: h, home: home, h2: h2 };
      // 묘비는 건너뛴다. 묘비를 빈 칸처럼 취급하면 그 뒤에 있는 키를 못 찾는다 —
      // 순진한 삭제가 탐사 사슬을 끊는다는 것이 바로 이 지점이다.
      if (e !== TOMB && e.k === key) return { found: true, probes: i + 1, at: idx, path: path, h: h, home: home, h2: h2 };
    }
    return { found: false, probes: cap, at: home, path: path, h: h, home: home, h2: h2 };
  }

  function liveKeys(slots, chaining) {
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      if (chaining) {
        for (var c = 0; c < slots[i].length; c++) out.push(slots[i][c]);
      } else if (slots[i] && slots[i] !== TOMB) {
        out.push(slots[i]);
      }
    }
    return out;
  }

  /* 최장 체인(체이닝) 또는 최장 군집(개방 주소법).
   * 군집은 "연속으로 찬 칸"이다. 묘비도 탐사를 멈추지 않으므로 군집에 포함한다 —
   * 탐사 비용은 살아 있는 키가 아니라 "빈 칸이 나올 때까지의 거리"가 결정한다. */
  function longestRun(slots, chaining) {
    var cap = slots.length, i;
    if (chaining) {
      var m = 0;
      for (i = 0; i < cap; i++) m = Math.max(m, slots[i].length);
      return m;
    }
    var full = true;
    for (i = 0; i < cap; i++) if (slots[i] === null) { full = false; break; }
    if (full) return cap;
    var best = 0, run = 0;
    for (i = 0; i < cap * 2; i++) {           // 한 바퀴 더 돌아 wrap-around 군집도 잡는다
      if (slots[i % cap] !== null) { run++; if (run > best) best = run; }
      else run = 0;
    }
    return Math.min(best, cap);
  }

  function avgProbes(cfg, slots, cap) {
    var ks = liveKeys(slots, cfg.strategy === 'chaining');
    if (!ks.length) return 0;
    var sum = 0;
    for (var i = 0; i < ks.length; i++) sum += findPath(cfg, slots, cap, ks[i].k).probes;
    return sum / ks.length;
  }

  function tombCount(slots) {
    var n = 0;
    for (var i = 0; i < slots.length; i++) if (slots[i] === TOMB) n++;
    return n;
  }

  function fmt2(x) { return (Math.round(x * 100) / 100).toFixed(2); }

  // ---------------------------------------------------------------- 스텝 생성
  //
  // 계약 §7: 상태를 미리 전부 계산해 배열에 담는다. render(i) 는 그리기만 한다.
  // 그래야 되감기가 즉시 되고, 같은 i 는 언제나 같은 그림이 된다.

  function build(cfg) {
    cfg.hashFn = cfg.hash === 'fnv' ? hashFnv : hashSimple;

    var chaining = cfg.strategy === 'chaining';
    var cap = cfg.capacity;
    var slots = makeSlots(cap, chaining);
    var size = 0;
    var collisions = 0;
    var steps = [];
    var moved = null;      // 리해싱으로 자리를 옮긴 키 — 이 위젯의 결정적 증거
    var maxCap = cap;

    function push(s) {
      if (steps.length >= MAX_STEPS) return false;
      s.cap = cap;
      s.size = size;
      s.slots = copySlots(slots, chaining);
      s.collisions = collisions;
      s.longest = longestRun(slots, chaining);
      s.avgP = avgProbes(cfg, slots, cap);
      s.tombs = chaining ? 0 : tombCount(slots);
      s.load = size / cap;
      if (!s.probes) s.probes = [];
      steps.push(s);
      return true;
    }

    var Q = function (k) { return '"' + k + '"'; };

    // ---- 삽입 ----------------------------------------------------------
    function insert(key, opt) {
      opt = opt || {};
      var h = cfg.hashFn(key);
      var home = h % cap;
      var h2 = cfg.strategy === 'double' ? stepOf(key, cap) : 1;

      if (!opt.silent) {
        push({
          kind: 'hash', key: key, h: h, home: home, h2: h2, at: home, probes: [home],
          badge: { text: '해시', tone: 'dim' },
          msg: '키 ' + Q(key) + ' → 해시 ' + h + ' → ' + h + ' % ' + cap + ' = ' + home +
               '. ' + home + '번 버킷을 본다.'
        });
      }

      if (chaining) {
        var b = slots[home];
        var hit = b.length > 0;
        if (hit) collisions++;
        if (!opt.silent) {
          push({
            kind: 'probe', key: key, h: h, home: home, at: home, probes: [home],
            collide: hit,
            badge: hit ? { text: '충돌', tone: 'danger' } : { text: '빈 버킷', tone: 'frontier' },
            msg: hit
              ? home + '번 버킷에 이미 ' + Q(b[0].k) + ' 이(가) 있다 → 충돌. 체이닝은 자리를 다투지 않고 ' +
                '같은 버킷에 매단다. 새 키는 체인 **맨 앞**에 붙는다(꼬리 포인터 없이 O(1)이라서).'
              : home + '번 버킷이 비어 있다. 바로 넣는다.'
          });
        }
        // 앞에 붙인다(prepend). 관찰되는 체인 순서가 삽입 순서의 역순이 되는
        // 이유가 여기다 — 어느 쪽을 골랐는지 말하지 않으면 독자가 헷갈린다.
        b.unshift({ k: key, h: h, hm: home });
        size++;
        if (!opt.silent) {
          push({
            kind: 'place', key: key, h: h, home: home, at: home, probes: [home], placed: home,
            badge: { text: '배치', tone: 'path' },
            msg: Q(key) + ' 을(를) ' + home + '번 버킷 체인 맨 앞에 붙였다. 체인 길이 ' + b.length +
                 '. 적재율 ' + size + '/' + cap + ' = ' + fmt2(size / cap) + '.'
          });
        }
        return { ok: true, at: home, probes: 1 };
      }

      // 개방 주소법: 빈 칸(또는 묘비)을 찾을 때까지 탐사한다.
      var firstFree = -1;
      var used = [];
      for (var i = 0; i < cap; i++) {
        var idx = probeAt(cfg.strategy, home, i, cap, h2);
        used.push(idx);
        var e = slots[idx];
        var empty = (e === null);
        var tomb = (e === TOMB);
        if ((empty || tomb) && firstFree < 0) firstFree = idx;

        if (!opt.silent) {
          var m;
          if (empty) {
            m = '탐사 ' + (i + 1) + '회차 — ' + idx + '번 칸이 비어 있다. 여기서 멈춘다.';
          } else if (tomb) {
            m = '탐사 ' + (i + 1) + '회차 — ' + idx + '번 칸은 묘비(삭제 자국)다. 넣을 수는 있지만 ' +
                '탐사는 여기서 멈추지 않는다. 같은 키가 뒤에 있을 수 있기 때문이다.';
          } else {
            m = '탐사 ' + (i + 1) + '회차 — ' + idx + '번 칸에 이미 ' + Q(e.k) + ' 이(가) 있다 → 충돌. ' +
                '다음 칸 ' + probeExpr(cfg.strategy, i + 1, cap, h2) + ' 로 간다.';
          }
          push({
            kind: 'probe', key: key, h: h, home: home, h2: h2, at: idx, probeNo: i + 1,
            probes: used.slice(), collide: !(empty || tomb),
            badge: (empty || tomb) ? { text: '빈 칸', tone: 'frontier' } : { text: '충돌', tone: 'danger' },
            msg: m
          });
        }
        if (!empty && !tomb && e.k === key) { return { ok: true, at: idx, probes: i + 1 }; }
        if (!empty && !tomb) { collisions++; continue; }
        if (empty) break;   // 진짜 빈 칸을 만나면 이 키는 테이블에 없다 → 삽입 확정
      }

      if (firstFree < 0) {
        // 이차 탐사에서 실제로 일어나는 실패. 용량이 2의 거듭제곱이라
        // (h+i²) 가 칸의 절반밖에 못 밟기 때문이다. 숨기지 않고 보여 준다.
        if (!opt.silent) {
          push({
            kind: 'note', key: key, h: h, home: home, at: home, probes: used.slice(),
            badge: { text: '탐사 실패', tone: 'warn' },
            msg: '탐사를 ' + cap + '번 했는데도 빈 칸을 못 찾았다. 테이블이 꽉 찬 것이 아니다 — ' +
                 '이차 탐사는 용량이 2의 거듭제곱이면 칸의 절반가량만 밟는다. 용량을 늘려 다시 시도한다.'
          });
        }
        return { ok: false, at: home, probes: cap };
      }

      slots[firstFree] = { k: key, h: h, hm: home };
      size++;
      var np = used.indexOf(firstFree) + 1;
      if (!opt.silent) {
        push({
          kind: 'place', key: key, h: h, home: home, h2: h2, at: firstFree, placed: firstFree,
          probes: used.slice(),
          badge: { text: '배치', tone: 'path' },
          msg: Q(key) + ' 을(를) ' + firstFree + '번 칸에 넣었다. 집 주소는 ' + home + '번인데 ' +
               firstFree + '번에 산다 — 탐사 ' + np + '회. 적재율 ' + size + '/' + cap + ' = ' + fmt2(size / cap) + '.'
        });
      }
      return { ok: true, at: firstFree, probes: np };
    }

    // ---- 리해싱 --------------------------------------------------------
    function rehash(reason) {
      var oldCap = cap;
      var oldSlots = slots;
      var entries = liveKeys(oldSlots, chaining);
      // 체이닝은 앞에 붙이므로 체인 앞쪽이 최신이다. 재삽입 순서를 밝혀 두어야
      // 재해싱 후 체인 순서가 왜 그렇게 되는지 설명이 된다.
      var oldIndex = {};
      for (var q = 0; q < entries.length; q++) {
        var fp = findPath(cfg, oldSlots, oldCap, entries[q].k);
        oldIndex[entries[q].k] = fp.at;
      }

      push({
        kind: 'rehash-begin', at: -1, probes: [],
        badge: { text: '리해싱', tone: 'warn' },
        msg: reason + ' 용량을 ' + oldCap + ' → ' + (oldCap * 2) + ' 로 늘리고 ' + entries.length +
             '개 키를 전부 다시 넣는다. 버킷 번호는 h % 용량이므로 용량이 바뀌면 주소가 통째로 바뀐다.'
      });

      cap = oldCap * 2;
      if (cap > maxCap) maxCap = cap;
      slots = makeSlots(cap, chaining);
      size = 0;

      var firstMove = null;
      for (var i = 0; i < entries.length; i++) {
        var key = entries[i].k;
        var from = oldIndex[key];
        var r = insert(key, { silent: true });
        var h = cfg.hashFn(key);
        if (firstMove === null && r.at !== from) firstMove = { key: key, from: from, to: r.at };
        push({
          kind: 'rehash-move', key: key, h: h, home: h % cap, at: r.at, placed: r.at, probes: [r.at],
          badge: { text: '재배치', tone: 'frontier' },
          msg: Q(key) + ': ' + h + ' % ' + cap + ' = ' + (h % cap) + '. ' + from + '번 → ' + r.at + '번' +
               (r.at === from ? ' (우연히 같은 번호에 앉았다).' : '.') +
               ' 탐사 ' + r.probes + '회.'
        });
      }

      if (firstMove && !moved) moved = firstMove;
      push({
        kind: 'rehash-done', at: firstMove ? firstMove.to : -1, probes: firstMove ? [firstMove.to] : [],
        badge: { text: '리해싱 끝', tone: 'path' },
        moved: firstMove,
        msg: firstMove
          ? '리해싱 끝. ' + Q(firstMove.key) + ' 은(는) ' + firstMove.from + '번에서 ' + firstMove.to +
            '번으로 옮겨졌다. 같은 키가 다른 버킷에 앉는다 — 그래서 해시 테이블의 순회 순서는 약속이 아니다. ' +
            'unordered_map/dict 를 순회한 순서가 어느 날 갑자기 달라지는 이유가 이것이다.'
          : '리해싱 끝. 이번에는 모든 키가 같은 번호에 다시 앉았다.'
      });
    }

    function maybeRehash() {
      // 계약대로 size/capacity > loadFactor 에서 늘린다. 체이닝은 적재율이
      // 1을 넘어도 동작하지만, 체인이 길어지면 O(1)이 무너지므로 똑같이 늘린다.
      var guard = 0;
      while (size / cap > cfg.loadFactor && cap < 4096 && guard++ < 6) {
        rehash('적재율 ' + size + '/' + cap + ' = ' + fmt2(size / cap) + ' 이(가) 임계값 ' +
               fmt2(cfg.loadFactor) + ' 를 넘었다.');
      }
    }

    // ---- 삭제(묘비) ----------------------------------------------------
    function remove(key) {
      var fp = findPath(cfg, slots, cap, key);
      push({
        kind: 'del', key: key, h: fp.h, home: fp.home, at: fp.at, probes: fp.path.slice(),
        badge: { text: '삭제', tone: 'warn' },
        msg: '삭제 ' + Q(key) + ': 탐사 ' + fp.probes + '회로 ' + fp.at + '번에서 찾았다.'
      });
      if (!fp.found) return;
      if (chaining) {
        var b = slots[fp.home];
        b.splice(fp.chainPos, 1);
        size--;
        push({
          kind: 'del-done', key: key, at: fp.home, probes: [fp.home],
          badge: { text: '삭제 완료', tone: 'path' },
          msg: '체인에서 노드를 떼어냈다. 체이닝은 묘비가 필요 없다 — 노드를 빼도 ' +
               '나머지 노드로 가는 길이 끊기지 않기 때문이다. 적재율 ' + size + '/' + cap + ' = ' + fmt2(size / cap) + '.'
        });
      } else {
        slots[fp.at] = TOMB;
        size--;
        push({
          kind: 'del-done', key: key, at: fp.at, probes: [fp.at],
          badge: { text: '묘비', tone: 'warn' },
          msg: fp.at + '번을 그냥 비우면 이 칸을 지나 뒤쪽에 앉은 키들을 영영 못 찾는다. ' +
               '그래서 빈 칸이 아니라 **묘비**를 남긴다. 조회는 묘비를 지나가고, 삽입은 묘비를 덮어쓴다. ' +
               '묘비는 적재율에 안 잡히지만 탐사 비용에는 그대로 잡힌다.'
        });
      }
    }

    // ---- 조회 ----------------------------------------------------------
    function lookup(key, kindNote) {
      var h = cfg.hashFn(key);
      var home = h % cap;
      var h2 = cfg.strategy === 'double' ? stepOf(key, cap) : 1;
      var path = [];

      push({
        kind: 'lookup', key: key, h: h, home: home, h2: h2, at: home, probes: [home],
        badge: { text: '조회', tone: 'frontier' },
        msg: '조회 ' + Q(key) + ': 해시 ' + h + ' → ' + h + ' % ' + cap + ' = ' + home + '번부터 본다.'
      });

      if (chaining) {
        var b = slots[home];
        for (var c = 0; c < b.length; c++) {
          path.push(home);
          var isIt = b[c].k === key;
          push({
            kind: 'lookup', key: key, h: h, home: home, at: home, probes: [home], chainPos: c,
            badge: isIt ? { text: '찾음', tone: 'path' } : { text: '비교', tone: 'frontier' },
            msg: '체인 ' + (c + 1) + '번째 노드 ' + Q(b[c].k) + ' 와(과) 비교 — ' +
                 (isIt ? '같다. 찾았다. 비교 ' + (c + 1) + '회.' : '다르다. 다음 노드로.')
          });
          if (isIt) return c + 1;
        }
        push({
          kind: 'lookup', key: key, h: h, home: home, at: home, probes: [home],
          badge: { text: '없음', tone: 'danger' },
          msg: home + '번 체인 끝까지 봤지만 ' + Q(key) + ' 은(는) 없다. 비교 ' + b.length + '회. ' + (kindNote || '')
        });
        return Math.max(1, b.length);
      }

      for (var i = 0; i < cap; i++) {
        var idx = probeAt(cfg.strategy, home, i, cap, h2);
        path.push(idx);
        var e = slots[idx];
        var found = e && e !== TOMB && e.k === key;
        var empty = e === null;
        push({
          kind: 'lookup', key: key, h: h, home: home, h2: h2, at: idx, probeNo: i + 1,
          probes: path.slice(),
          badge: found ? { text: '찾음', tone: 'path' } : (empty ? { text: '없음', tone: 'danger' } : { text: '비교', tone: 'frontier' }),
          msg: found
            ? '탐사 ' + (i + 1) + '회차 — ' + idx + '번에서 ' + Q(key) + ' 을(를) 찾았다. 탐사 ' + (i + 1) + '회.'
            : (empty
              ? '탐사 ' + (i + 1) + '회차 — ' + idx + '번이 비어 있다. 빈 칸을 만났으니 ' + Q(key) +
                ' 은(는) 테이블에 없다. 탐사 ' + (i + 1) + '회. ' + (kindNote || '')
              : (e === TOMB
                ? '탐사 ' + (i + 1) + '회차 — ' + idx + '번은 묘비다. 여기서 멈추면 안 된다. 다음 칸으로.'
                : '탐사 ' + (i + 1) + '회차 — ' + idx + '번의 ' + Q(e.k) + ' 은(는) 찾는 키가 아니다. ' +
                  '집 주소가 ' + e.hm + '번인 키가 여기 앉아 있다. 다음 칸 ' + probeExpr(cfg.strategy, i + 1, cap, h2) + ' 로.'))
        });
        if (found) return i + 1;
        if (empty) return i + 1;
      }
      return cap;
    }

    // ---- 본편 ----------------------------------------------------------
    push({
      kind: 'note', at: -1, probes: [],
      badge: { text: '시작', tone: 'dim' },
      msg: '빈 테이블. 용량 ' + cap + ', 전략 ' + STRATEGY_LABEL[cfg.strategy] + ', 해시 ' +
           HASH_LABEL[cfg.hash] + ', 리해싱 임계 적재율 ' + fmt2(cfg.loadFactor) + '.'
    });

    for (var ki = 0; ki < cfg.keys.length; ki++) {
      if (steps.length >= MAX_STEPS) break;
      var r = insert(cfg.keys[ki]);
      if (!r.ok) {
        // 탐사 실패 → 용량을 늘리고 같은 키를 다시 넣는다.
        rehash('빈 칸을 못 찾았다.');
        insert(cfg.keys[ki]);
      }
      maybeRehash();
    }

    for (var di = 0; di < cfg.deletes.length; di++) remove(cfg.deletes[di]);

    // ---- 조회 시연 ------------------------------------------------------
    // 여기가 결론이다. 군집이 큰 테이블에서 조회가 실제로 몇 칸을 밟는지 세어
    // "O(1)" 이라는 말과 대조시킨다.
    if (cfg.lookup && steps.length < MAX_STEPS - 20) {
      var present = liveKeys(slots, chaining);
      if (cfg.lookupKeys) {
        for (var li = 0; li < cfg.lookupKeys.length; li++) lookup(cfg.lookupKeys[li]);
      } else {
        var worst = null, worstP = -1;
        for (var wi = 0; wi < present.length; wi++) {
          var p = findPath(cfg, slots, cap, present[wi].k).probes;
          if (p > worstP) { worstP = p; worst = present[wi].k; }
        }
        var missKey = null, missP = -1;
        for (var mi = 0; mi < MISS_CANDIDATES.length; mi++) {
          var mk = MISS_CANDIDATES[mi];
          if (cfg.keys.indexOf(mk) >= 0) continue;
          var mp = findPath(cfg, slots, cap, mk).probes;
          if (mp > missP) { missP = mp; missKey = mk; }
        }
        if (worst) lookup(worst);
        if (missKey) lookup(missKey, '없는 키를 찾는 비용도 군집이 결정한다.');
      }

      var ap = avgProbes(cfg, slots, cap);
      push({
        kind: 'summary', at: -1, probes: [],
        badge: { text: '결론', tone: 'path' },
        msg: '키 ' + present.length + '개, 용량 ' + cap + ', 적재율 ' + fmt2(size / cap) + ', 충돌 ' + collisions +
             '회, ' + (chaining ? '최장 체인 ' : '최장 군집 ') + longestRun(slots, chaining) +
             '. 성공 조회의 평균 ' + (chaining ? '비교' : '탐사') + ' 횟수는 ' + fmt2(ap) + '회다. ' +
             'O(1)은 이 평균을 말한다 — 해시가 잘 흩어지고 적재율이 낮다는 조건 아래에서만 성립한다.'
      });
    }

    if (!steps.length) {
      push({ kind: 'note', at: -1, probes: [], badge: { text: '없음', tone: 'dim' }, msg: '넣을 키가 없다.' });
    }

    return { steps: steps, maxCap: maxCap, moved: moved, finalSlots: slots, finalCap: cap, collisions: collisions };
  }

  // ---------------------------------------------------------------- 그리기 보조

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fitText(ctx, s, maxW) {
    if (ctx.measureText(s).width <= maxW) return s;
    var t = s;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  // ---------------------------------------------------------------- 위젯 본체

  K.register('hash-table', function (host, opts) {
    var cfg = normalize(opts);
    var model = build(cfg);

    var ui = K.frame(host, { title: '해시 테이블 — 충돌 · 탐사 · 리해싱', wide: true });

    // 폰트는 본문과 같은 스택을 쓴다. 캔버스는 CSS 를 상속하지 않으므로 직접 읽는다.
    var cs = getComputedStyle(host);
    var MONO = (cs.getPropertyValue('--font-mono') || '').trim() || 'ui-monospace, Menlo, monospace';
    var SANS = (cs.getPropertyValue('--font-sans') || '').trim() || 'system-ui, sans-serif';

    // ---- 컨트롤 ----
    K.seg(ui.slot, STRATEGIES.map(function (s) { return { label: STRATEGY_LABEL[s], value: s }; }),
      cfg.strategy, function (v) { cfg.strategy = v; rebuild(); });
    K.seg(ui.slot, HASHES.map(function (h) { return { label: HASH_LABEL[h], value: h }; }),
      cfg.hash, function (v) { cfg.hash = v; rebuild(); });

    var legend = K.el('div', 'wk-legend');
    function legendItem(color, text) {
      var s = K.el('span');
      var i = K.el('i');
      i.style.background = color;
      s.appendChild(i);
      s.appendChild(document.createTextNode(text));
      legend.appendChild(s);
    }
    function paintLegend() {
      legend.innerHTML = '';
      var t = K.tokens(ui.stage);
      legendItem(t.wVisited, '찬 칸');
      legendItem(t.wFrontier, '지금 보는 칸');
      legendItem(t.wPath, '방금 배치');
      legendItem(t.boxDanger, '충돌');
    }
    paintLegend();
    ui.slot.appendChild(legend);
    K.onThemeChange(paintLegend);

    // ---- 레이아웃 ----
    //
    // 캔버스 높이는 **최대 용량** 기준으로 잡는다. 스텝마다 높이가 바뀌면
    // 리해싱 순간에 페이지가 튀어 독자가 읽던 자리를 잃는다.
    function layout(w) {
      var narrow = w < 700;
      var mid = w < 980;
      var cap = model.maxCap;

      var padX = narrow ? 4 : 8;
      var padY = 6;
      var rowH = narrow ? 25 : (mid ? 29 : 33);

      // 좁은 화면에서 줄이는 것은 **글자 크기가 아니라 보이는 버킷 수**다.
      // 11px 아래로 내려가면 버킷 번호와 키를 읽을 수 없고, 그러면 위젯이
      // 하는 말이 사라진다. 기본값(용량 8→16)은 여기 걸리지 않는다.
      var maxRows = narrow ? 16 : 40;
      var shown = Math.min(cap, maxRows);
      var cols = (!mid && cap >= 12) ? 2 : 1;
      var perCol = Math.ceil(shown / cols);

      var gutterW = narrow ? 15 : 20;
      var idxW = narrow ? 26 : 32;
      var slotW = narrow ? 74 : (mid ? 92 : 104);
      var colGap = 22;

      var availW = Math.max(120, w - padX * 2);
      var isChain = cfg.strategy === 'chaining';
      var colW, chainRoom = 0, colXs = [], c;

      if (isChain) {
        // 체이닝은 오른쪽 여백이 곧 체인이 자랄 자리다. 열을 폭 끝까지 벌린다.
        colW = (availW - (cols - 1) * colGap) / cols;
        chainRoom = Math.max(0, colW - gutterW - idxW - slotW - 4);
        for (c = 0; c < cols; c++) colXs.push(padX + c * (colW + colGap));
      } else {
        // 개방 주소법에는 체인이 없다. 열을 폭 끝까지 벌리면 가운데가 텅 비고
        // 탐사 걷기 선만 화면을 가로지른다. 내용 폭으로 좁혀 가운데에 모은다.
        var homeW = narrow ? 56 : 68;
        colW = gutterW + idxW + slotW + homeW;
        var g = cols > 1 ? Math.min(110, Math.max(24, (availW - cols * colW) / (cols + 1))) : 0;
        var off = Math.max(0, (availW - (cols * colW + (cols - 1) * g)) / 2);
        for (c = 0; c < cols; c++) colXs.push(padX + off + c * (colW + g));
      }

      var nodeW = narrow ? 62 : 78;
      var nodeGap = narrow ? 14 : 20;
      var maxNodes = Math.max(1, Math.floor((chainRoom + nodeGap) / (nodeW + nodeGap)));

      var pipeH = narrow ? 96 : 72;
      var statsH = narrow ? 44 : 24;

      return {
        narrow: narrow, mid: mid, padX: padX, padY: padY, rowH: rowH,
        cols: cols, shown: shown, perCol: perCol, colW: colW, colGap: colGap, colXs: colXs,
        gutterW: gutterW, idxW: idxW, slotW: slotW, chainRoom: chainRoom,
        nodeW: nodeW, nodeGap: nodeGap, maxNodes: maxNodes,
        pipeH: pipeH, statsH: statsH,
        rowsY: padY + pipeH + statsH + 8,
        fKey: narrow ? 11.5 : 13,
        fIdx: narrow ? 10.5 : 11.5,
        fLab: narrow ? 9.5 : 10.5,
        totalH: padY + pipeH + statsH + 8 + perCol * rowH + padY + 6
      };
    }

    // ---- 파이프라인 패널 ----
    function drawPipeline(ctx, L, st, t, w) {
      var boxes = [
        { lab: '키', val: st.key != null ? '"' + st.key + '"' : '—' },
        { lab: '해시 h', val: st.h != null ? String(st.h) : '—' },
        { lab: '% 용량', val: '% ' + st.cap },
        { lab: '버킷', val: st.home != null ? String(st.home) : '—' }
      ];
      var perRow = L.narrow ? 2 : 4;
      var arrowW = L.narrow ? 16 : 20;
      var availW = w - L.padX * 2;
      // 배지는 항상 자리를 미리 뺀다. 좁은 화면에서 이 자리를 안 빼면
      // 배지가 캔버스 밖으로 잘려 나간다.
      var badgeW = L.narrow ? 74 : 96;
      var bw = Math.min(L.narrow ? 150 : 128,
        (availW - badgeW - (perRow - 1) * arrowW - 6) / perRow);
      var bh = L.narrow ? 30 : 32;
      var rowGap = L.narrow ? 44 : 0;

      for (var i = 0; i < boxes.length; i++) {
        var r = Math.floor(i / perRow), c = i % perRow;
        var x = L.padX + c * (bw + arrowW);
        var y = L.padY + 13 + r * rowGap;

        ctx.font = L.fLab + 'px ' + SANS;
        ctx.fillStyle = t.fgFaint;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(boxes[i].lab, x + 2, y - 3);

        ctx.fillStyle = t.bgCode;
        roundRect(ctx, x, y, bw, bh, 5);
        ctx.fill();
        ctx.strokeStyle = t.border;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = (L.narrow ? 12.5 : 14) + 'px ' + MONO;
        ctx.fillStyle = t.fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fitText(ctx, boxes[i].val, bw - 8), x + bw / 2, y + bh / 2 + 0.5);

        if (c < perRow - 1) {
          ctx.font = (L.narrow ? 12 : 14) + 'px ' + SANS;
          ctx.fillStyle = t.fgFaint;
          ctx.fillText('→', x + bw + arrowW / 2, y + bh / 2);
        }
      }

      // 상태 배지 — 색을 못 보는 독자를 위해 글자로도 상태를 말한다.
      if (st.badge) {
        var tone = { frontier: t.wFrontier, danger: t.boxDanger, path: t.wPath, warn: t.boxWarn, dim: t.fgFaint }[st.badge.tone] || t.fgDim;
        var pw = badgeW - 8;
        var bx = w - L.padX - pw;
        var by = L.padY + 13 + (L.narrow ? rowGap : 0);
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = tone;
        roundRect(ctx, bx, by + 4, pw, bh - 8, 4);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = tone;
        ctx.lineWidth = 1.2;
        roundRect(ctx, bx, by + 4, pw, bh - 8, 4);
        ctx.stroke();
        ctx.font = '700 ' + (L.narrow ? 10.5 : 11.5) + 'px ' + SANS;
        ctx.fillStyle = tone;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.badge.text, bx + pw / 2, by + bh / 2);
      }
    }

    // ---- 통계 줄 ----
    // 이 숫자들이 이 위젯의 논증이다. 적재율은 언제나 size/capacity 다.
    function drawStats(ctx, L, st, t, w) {
      var chaining = cfg.strategy === 'chaining';
      var items = [
        { lab: '적재율', val: st.size + '/' + st.cap + ' = ' + fmt2(st.load) },
        { lab: '충돌', val: String(st.collisions) + '회' },
        { lab: chaining ? '최장 체인' : '최장 군집', val: String(st.longest) },
        { lab: chaining ? '평균 비교' : '평균 탐사', val: fmt2(st.avgP) + '회' }
      ];
      if (!chaining && st.tombs) items.push({ lab: '묘비', val: String(st.tombs) });

      var y = L.padY + L.pipeH;
      var x = L.padX;
      var lineH = L.narrow ? 21 : 22;
      var maxX = w - L.padX;
      for (var i = 0; i < items.length; i++) {
        ctx.font = L.fLab + 'px ' + SANS;
        var lw = ctx.measureText(items[i].lab).width;
        ctx.font = (L.narrow ? 11 : 12) + 'px ' + MONO;
        var vw = ctx.measureText(items[i].val).width;
        var total = lw + vw + 8;
        if (x > L.padX && x + total > maxX) { x = L.padX; y += lineH; }

        ctx.font = L.fLab + 'px ' + SANS;
        ctx.fillStyle = t.fgFaint;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(items[i].lab, x, y + 11);
        ctx.font = (L.narrow ? 11 : 12) + 'px ' + MONO;
        ctx.fillStyle = t.fg;
        ctx.fillText(items[i].val, x + lw + 5, y + 11);
        x += total + (L.narrow ? 12 : 20);
      }
    }

    // ---- 칸 하나 ----
    function drawSlot(ctx, L, t, x, y, w, h, entry, mark) {
      var chaining = cfg.strategy === 'chaining';
      var empty = chaining ? false : (entry === null || entry === undefined);
      var tomb = entry === TOMB;

      // 바탕: 빈 칸은 코드 배경, 찬 칸은 wVisited(양 테마 모두 fg 글자가 얹히는 색이다)
      ctx.fillStyle = empty ? t.bgCode : (tomb ? t.bgCode : t.wVisited);
      roundRect(ctx, x, y, w, h, 4);
      ctx.fill();

      if (tomb) {
        // 묘비는 색이 아니라 **빗금**으로도 구분되게 한다.
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, x, y, w, h, 4);
        ctx.clip();
        ctx.strokeStyle = t.wWall;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        for (var d = -h; d < w; d += 6) {
          ctx.beginPath();
          ctx.moveTo(x + d, y + h);
          ctx.lineTo(x + d + h, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 강조 테두리
      var ring = null, rw = 1;
      if (mark === 'probe') { ring = t.wFrontier; rw = 2.2; }
      else if (mark === 'collide') { ring = t.boxDanger; rw = 2.2; }
      else if (mark === 'placed') { ring = t.wPath; rw = 2.4; }
      if (ring) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = ring;
        roundRect(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = ring;
        ctx.lineWidth = rw;
      } else {
        ctx.strokeStyle = t.border;
        ctx.lineWidth = 1;
      }
      roundRect(ctx, x, y, w, h, 4);
      ctx.stroke();

      // 글자
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (empty) {
        ctx.font = L.fIdx + 'px ' + MONO;
        ctx.fillStyle = t.fgFaint;
        ctx.fillText('비었음', x + w / 2, y + h / 2);
      } else if (tomb) {
        ctx.font = L.fIdx + 'px ' + MONO;
        ctx.fillStyle = t.fgDim;
        ctx.fillText('× 묘비', x + w / 2, y + h / 2);
      } else {
        ctx.font = '600 ' + L.fKey + 'px ' + MONO;
        ctx.fillStyle = t.fg;
        ctx.fillText(fitText(ctx, entry.k, w - 8), x + w / 2, y + h / 2);
      }
    }

    // ---- 전체 ----
    function draw(ctx, size, t) {
      var st = model.steps[player ? player.index() : 0] || model.steps[0];
      if (!st) return;
      var L = layout(size.w);
      var chaining = cfg.strategy === 'chaining';

      drawPipeline(ctx, L, st, t, size.w);
      drawStats(ctx, L, st, t, size.w);

      // 보이는 버킷 범위. 용량이 화면에 다 안 들어갈 때만 창이 움직인다.
      var cap = st.cap;
      var shown = Math.min(cap, L.shown);
      var start = 0;
      if (shown < cap) {
        var focus = st.at >= 0 ? st.at : 0;
        start = Math.max(0, Math.min(cap - shown, focus - Math.floor(shown / 2)));
      }
      var perCol = Math.ceil(shown / L.cols);

      // 탐사 순서 → 화면 좌표. 탐사 걷기를 왼쪽 여백에 그리기 위해 먼저 자리를 잡는다.
      var pos = {};   // 버킷 번호 -> {x,y}
      var r, c, bi;
      for (var n = 0; n < shown; n++) {
        bi = start + n;
        c = Math.min(L.cols - 1, Math.floor(n / perCol));
        r = n % perCol;
        pos[bi] = { x: L.colXs[c], y: L.rowsY + r * L.rowH };
      }

      // 탐사 걷기의 연결선은 칸보다 **먼저** 그린다. 나중에 그리면 선이
      // 키 글자 위를 지나가 읽기를 방해한다.
      var pr = st.probes || [];
      var dots = [];
      if (pr.length) {
        var prevD = null;
        for (var pi0 = 0; pi0 < pr.length; pi0++) {
          var pb0 = pr[pi0];
          if (!pos[pb0]) { prevD = null; continue; }
          var d = {
            x: pos[pb0].x + L.gutterW - 8,
            y: pos[pb0].y + 2 + (L.rowH - 5) / 2,
            n: pi0 + 1,
            last: pi0 === pr.length - 1
          };
          if (prevD) {
            ctx.save();
            var sameCol = Math.abs(prevD.x - d.x) < 1;
            ctx.globalAlpha = sameCol ? 0.5 : 0.3;
            ctx.strokeStyle = t.wFrontier;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            if (sameCol) {
              ctx.moveTo(prevD.x, prevD.y);
              ctx.quadraticCurveTo(prevD.x - 9, (prevD.y + d.y) / 2, d.x, d.y);
            } else {
              // 열을 건너뛰는 것은 테이블 끝에서 처음으로 되감긴 것이다.
              ctx.setLineDash([3, 3]);
              ctx.moveTo(prevD.x, prevD.y);
              ctx.lineTo(d.x, d.y);
            }
            ctx.stroke();
            ctx.restore();
          }
          dots.push(d);
          prevD = d;
        }
      }

      for (var n2 = 0; n2 < shown; n2++) {
        bi = start + n2;
        var p = pos[bi];
        var slotX = p.x + L.gutterW + L.idxW;
        var slotY = p.y + 2;
        var slotH = L.rowH - 5;

        // 버킷 번호 — 색이 아니라 숫자로 위치를 말한다.
        ctx.font = L.fIdx + 'px ' + MONO;
        ctx.fillStyle = (st.at === bi) ? t.fg : t.fgFaint;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(bi), p.x + L.gutterW + L.idxW - 6, slotY + slotH / 2);

        var mark = null;
        if (st.at === bi) {
          if (st.placed === bi) mark = 'placed';
          else if (st.collide) mark = 'collide';
          else mark = 'probe';
        }

        if (chaining) {
          var b = st.slots[bi] || [];
          // 체이닝의 버킷 칸은 "머리 포인터"다. 키가 아니라 체인 길이를 쓴다.
          ctx.fillStyle = b.length ? t.wVisited : t.bgCode;
          roundRect(ctx, slotX, slotY, L.slotW * 0.52, slotH, 4);
          ctx.fill();
          if (mark) {
            var ring2 = mark === 'placed' ? t.wPath : (mark === 'collide' ? t.boxDanger : t.wFrontier);
            ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = ring2;
            roundRect(ctx, slotX, slotY, L.slotW * 0.52, slotH, 4); ctx.fill(); ctx.restore();
            ctx.strokeStyle = ring2; ctx.lineWidth = 2.2;
          } else {
            ctx.strokeStyle = t.border; ctx.lineWidth = 1;
          }
          roundRect(ctx, slotX, slotY, L.slotW * 0.52, slotH, 4);
          ctx.stroke();
          ctx.font = L.fIdx + 'px ' + MONO;
          ctx.fillStyle = b.length ? t.fg : t.fgFaint;
          ctx.textAlign = 'center';
          ctx.fillText(b.length ? '● ' + b.length : '∅', slotX + L.slotW * 0.26, slotY + slotH / 2);

          // 체인: 머리에서 오른쪽으로. 새 키는 앞(왼쪽)에 붙는다.
          var nx = slotX + L.slotW * 0.52;
          var shownNodes = Math.min(b.length, L.maxNodes);
          if (b.length > L.maxNodes) shownNodes = Math.max(1, L.maxNodes - 1);
          for (var ci = 0; ci < shownNodes; ci++) {
            var x0 = nx + L.nodeGap;
            ctx.strokeStyle = t.border;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(nx + 3, slotY + slotH / 2);
            ctx.lineTo(x0 - 4, slotY + slotH / 2);
            ctx.stroke();
            // 화살촉
            ctx.beginPath();
            ctx.moveTo(x0 - 4, slotY + slotH / 2);
            ctx.lineTo(x0 - 9, slotY + slotH / 2 - 3);
            ctx.lineTo(x0 - 9, slotY + slotH / 2 + 3);
            ctx.closePath();
            ctx.fillStyle = t.border;
            ctx.fill();

            var isNew = (st.placed === bi && ci === 0 && st.kind === 'place');
            var isCmp = (st.kind === 'lookup' && st.at === bi && st.chainPos === ci);
            drawSlot(ctx, L, t, x0, slotY, L.nodeW, slotH, b[ci],
              isNew ? 'placed' : (isCmp ? 'probe' : null));
            nx = x0 + L.nodeW;
          }
          if (b.length > shownNodes) {
            ctx.font = L.fIdx + 'px ' + MONO;
            ctx.fillStyle = t.fgDim;
            ctx.textAlign = 'left';
            ctx.fillText('+' + (b.length - shownNodes), nx + 8, slotY + slotH / 2);
          }
        } else {
          var e = st.slots[bi];
          drawSlot(ctx, L, t, slotX, slotY, L.slotW, slotH, e, mark);
          // 집 주소(home)를 옆에 적는다. 키가 제 집에서 얼마나 밀려났는지가
          // 개방 주소법의 비용 그 자체이므로, 이 숫자가 보여야 한다.
          if (e && e !== TOMB) {
            ctx.font = L.fLab + 'px ' + MONO;
            ctx.fillStyle = e.hm === bi ? t.fgFaint : t.boxWarn;
            ctx.textAlign = 'left';
            ctx.fillText(e.hm === bi ? '집 ' + e.hm : '집 ' + e.hm + ' ↗', slotX + L.slotW + 7, slotY + slotH / 2);
          }
        }
      }

      // 탐사 순서 점은 칸 위에 찍는다. "몇 칸을 밟았는가"는 색이 아니라
      // 번호로 읽혀야 색을 구분하지 못하는 독자에게도 남는다.
      for (var di = 0; di < dots.length; di++) {
        var dd = dots[di];
        ctx.save();
        if (!dd.last) ctx.globalAlpha = 0.45;
        ctx.fillStyle = t.wFrontier;
        ctx.beginPath();
        ctx.arc(dd.x, dd.y, dd.last ? 7.5 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.font = '700 ' + (L.narrow ? 8.5 : 9.5) + 'px ' + MONO;
        ctx.fillStyle = t.bg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(dd.n), dd.x, dd.y + 0.5);
      }

      // 창이 잘렸으면 몇 개가 숨었는지 밝힌다.
      if (shown < cap) {
        ctx.font = L.fLab + 'px ' + SANS;
        ctx.fillStyle = t.fgFaint;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        var noteY = L.rowsY - 6;
        ctx.fillText('버킷 ' + start + '–' + (start + shown - 1) + ' 만 표시 (전체 ' + cap + ')', L.padX, noteY);
      }
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) { return layout(w).totalH; },
      draw: draw
    });

    var player = K.player(ui, {
      total: function () { return model.steps.length; },
      render: function () { cv.redraw(); },
      label: function (i) { return (model.steps[i] && model.steps[i].msg) || ''; },
      speed: 620
    });

    function rebuild() {
      model = build(cfg);
      player.stop();
      player.goto(0);
      cv.redraw();
    }

    player.draw();
  });
})();

/* ==== heap-ops.js ==== */
/* heap-ops.js — 이진 힙의 삽입·삭제·heapify
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **트리는 그림일 뿐이고, 실제 힙은 배열이다.**
 * 트리만 본 독자는 코드를 못 짠다. 코드는 `2*i+1` 을 쓰기 때문이다.
 * 그래서 두 표현을 동시에 띄우고, 같은 노드를 양쪽에서 동시에 강조한다.
 * 상태 줄에는 인덱스 산술을 문장으로 적는다 — 이것이 두 그림을 잇는 다리다.
 *
 * 0-based 인덱싱으로 통일한다. 본문 `::: dual` 코드(Python heapq / C++ vector)와
 * 같은 식이어야 하기 때문이다:  부모 (i-1)/2,  자식 2i+1 / 2i+2.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 트리 깊이가 5레벨(31개)을 넘으면 잎 간격이 글자보다 좁아져 읽을 수 없다.
  // "많이 보여주기"보다 "읽히게 보여주기"가 우선이라 여기서 자른다.
  var MAX_N = 31;
  var MAX_STEPS = 420;   // §7: 스텝 수 상한. 대본이 이상하면 잘라낸다.

  // ---------------------------------------------------------------- opts 검증
  //
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 무엇이 들어와도 던지지 않는다.

  function toInt(v, dflt) {
    var n;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && v.trim() !== '') n = Number(v);
    else return dflt;
    if (!isFinite(n)) return dflt;
    return Math.round(n);
  }

  function clampVal(v) {
    // 칸 안에 들어가야 하므로 표시 가능한 범위로 자른다.
    var n = toInt(v, null);
    if (n === null) return null;
    return Math.max(-99, Math.min(999, n));
  }

  var DEFAULT_VALUES = [9, 4, 7, 1, 8, 2, 6, 3, 5];

  function normValues(raw) {
    if (!raw || typeof raw.length !== 'number' || typeof raw === 'string') return DEFAULT_VALUES.slice();
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_N; i++) {
      var v = clampVal(raw[i]);
      if (v !== null) out.push(v);
    }
    return out.length ? out : DEFAULT_VALUES.slice();
  }

  var OPS = { push: 1, pop: 1, heapify: 1, peek: 1 };

  function normOps(raw) {
    // 허용 형태: [["push",7],["pop"],["heapify"],["heapify",[3,1,2]],"pop"
    if (!raw || typeof raw.length !== 'number' || typeof raw === 'string') return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      var name = null, arg;
      if (typeof e === 'string') { name = e; }
      else if (e && typeof e.length === 'number') { name = e[0]; arg = e[1]; }
      if (typeof name !== 'string') continue;
      name = name.toLowerCase();
      if (!OPS[name]) continue;
      if (name === 'push') out.push({ op: 'push', v: clampVal(arg) });          // null 이면 자동 선택
      else if (name === 'heapify') out.push({ op: 'heapify', arr: (arg && typeof arg.length === 'number' && typeof arg !== 'string') ? normValues(arg) : null });
      else out.push({ op: name });
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- 힙 알고리즘
  //
  // 본문 `::: dual` 에 실릴 코드와 **같은 알고리즘**이어야 한다. 위젯이 거짓말을
  // 하면 독자는 코드와 그림 사이에서 길을 잃는다.

  function prefers(x, y, isMin) {
    // x 가 y 보다 위(부모 쪽)에 있어야 하는가
    return isMin ? x < y : x > y;
  }

  function isHeap(a, n, isMin) {
    for (var i = 1; i < n; i++) {
      var p = (i - 1) >> 1;
      if (prefers(a[i], a[p], isMin)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- 스텝 생성
  //
  // §7: 상태를 미리 전부 계산해 배열에 담는다. render(i) 는 그리기만 한다.
  // 그래야 되감기가 즉시 되고, 같은 i 는 항상 같은 그림이 된다.

  function rel(x, y) { return x < y ? '<' : (x > y ? '>' : '='); }

  function build(values, isMin, ops) {
    var a = values.slice();
    var n = a.length;
    var steps = [];
    var starts = [];        // 각 연산이 시작하는 스텝 번호 (버튼이 그리로 점프한다)
    var opName = '초기';
    var settledLo = MAX_N + 1;   // 이 인덱스부터는 이번 연산에서 확정된 자리
    var out = null;         // pop 으로 꺼낸 값 (표시용)
    var swaps = 0;          // 이번 연산의 교환 횟수
    var truncated = false;

    function begin(name) { starts.push(steps.length); opName = name; }

    function push(o) {
      if (steps.length >= MAX_STEPS) { truncated = true; return false; }
      steps.push({
        arr: a.slice(),
        n: n,
        op: opName,
        i: o.i == null ? -1 : o.i,
        j: o.j == null ? -1 : o.j,
        l: o.l == null ? -1 : o.l,
        r: o.r == null ? -1 : o.r,
        swap: !!o.swap,
        dir: o.dir || '',        // 'up' | 'down' | ''
        settledLo: o.all ? 0 : settledLo,
        allSettled: !!o.all,
        out: out,
        msg: o.msg || ''
      });
      return true;
    }

    // --- 위로 올리기 (삽입) ---
    function siftUp(i) {
      var guard = 0;
      while (i > 0 && guard++ < MAX_N * 2) {
        var p = (i - 1) >> 1;
        var doSwap = prefers(a[i], a[p], isMin);
        var arith = 'i=' + i + ' 의 부모는 (' + i + '-1)/2 = ' + p + '. ';
        if (doSwap) {
          if (!push({
            i: i, j: p, dir: 'up',
            msg: arith + 'heap[' + i + ']=' + a[i] + ' ' + rel(a[i], a[p]) + ' heap[' + p + ']=' + a[p] +
                 ' 이므로 교환한다.'
          })) return i;
          var t = a[i]; a[i] = a[p]; a[p] = t; swaps++;
          if (!push({
            i: p, j: i, swap: true, dir: 'up',
            msg: '교환했다(' + i + ' ↔ ' + p + '). 올라온 값 ' + a[p] + ' 는 이제 i=' + p + ' 에 있다.'
          })) return p;
          i = p;
        } else {
          push({
            i: i, j: p, dir: 'up',
            msg: arith + 'heap[' + i + ']=' + a[i] + ' ' + rel(a[i], a[p]) + ' heap[' + p + ']=' + a[p] +
                 ' 라 ' + (isMin ? '부모가 더 작거나 같다' : '부모가 더 크거나 같다') + '. 힙 성질을 만족하므로 여기서 멈춘다.'
          });
          return i;
        }
      }
      push({ i: 0, dir: 'up', msg: '루트(i=0)에 도달했다. 더 올라갈 부모가 없으므로 끝이다.' });
      return 0;
    }

    // --- 아래로 내리기 (삭제·heapify) ---
    function siftDown(i, stopAt) {
      var guard = 0;
      while (guard++ < MAX_N * 2) {
        var l = 2 * i + 1, r = 2 * i + 2, best = i;
        if (l < stopAt && prefers(a[l], a[best], isMin)) best = l;
        if (r < stopAt && prefers(a[r], a[best], isMin)) best = r;

        if (l >= stopAt) {
          push({
            i: i, dir: 'down',
            msg: 'i=' + i + ' 의 왼쪽 자식은 2·' + i + '+1 = ' + l + ' 인데 힙 크기 ' + stopAt +
                 ' 를 넘는다. 자식이 없는 잎이므로 여기서 멈춘다.'
          });
          return i;
        }

        var kids = 'i=' + i + ' 의 자식은 2·' + i + '+1 = ' + l +
                   (r < stopAt ? ', 2·' + i + '+2 = ' + r : ' (오른쪽 자식 없음)') + '. ';
        var vals = 'heap[' + i + ']=' + a[i] + ', heap[' + l + ']=' + a[l] +
                   (r < stopAt ? ', heap[' + r + ']=' + a[r] : '') + ' → ';
        var word = isMin ? '가장 작은 것' : '가장 큰 것';

        if (best === i) {
          push({
            i: i, l: l, r: (r < stopAt ? r : -1), dir: 'down',
            msg: kids + vals + word + '은 자기 자신이다. 힙 성질을 만족하므로 멈춘다.'
          });
          return i;
        }
        if (!push({
          i: i, l: l, r: (r < stopAt ? r : -1), j: best, dir: 'down',
          msg: kids + vals + word + '은 heap[' + best + ']=' + a[best] + '. heap[' + i + ']=' + a[i] +
               ' 와 교환한다.'
        })) return i;
        var t2 = a[i]; a[i] = a[best]; a[best] = t2; swaps++;
        if (!push({
          i: best, j: i, swap: true, dir: 'down',
          msg: '교환했다(' + i + ' ↔ ' + best + '). 내려간 값 ' + a[best] + ' 를 i=' + best + ' 에서 다시 본다.'
        })) return best;
        i = best;
      }
      return i;
    }

    // --- 연산들 ---

    function opPush(v) {
      begin('push ' + v);
      settledLo = 0;
      out = null;
      swaps = 0;
      if (n >= MAX_N) {
        push({ msg: 'push ' + v + ': 배열이 가득 찼다(최대 ' + MAX_N + '칸). 트리가 읽을 수 없게 커지므로 여기서는 넣지 않는다.' });
        return;
      }
      a[n] = v;
      n += 1;
      push({
        i: n - 1, dir: 'up',
        msg: 'push(' + v + '): 배열의 맨 끝 i=' + (n - 1) + ' 에 붙인다. 트리로는 마지막 레벨의 다음 빈 자리다. 이제 위로 올린다.'
      });
      siftUp(n - 1);
      push({ all: true, msg: 'push(' + v + ') 완료. 교환 ' + swaps + '회. 최악이라도 트리 높이 ⌊log₂' + n + '⌋ = ' + depthOf(n) + ' 번뿐이다 — O(log n).' });
    }

    function opPop() {
      begin('pop');
      settledLo = 0;
      swaps = 0;
      if (n === 0) {
        out = null;
        push({ msg: 'pop: 힙이 비어 있다. 꺼낼 것이 없다.' });
        return;
      }
      out = a[0];
      push({
        i: 0,
        msg: 'pop(): 루트 heap[0]=' + out + ' 가 ' + (isMin ? '최솟값' : '최댓값') + '이다. 이 값을 꺼낸다.'
      });
      var lastIdx = n - 1;
      if (lastIdx === 0) {
        a[0] = null;
        n = 0;
        push({ all: true, msg: '마지막 한 개였다. 힙이 비었다. 꺼낸 값은 ' + out + '.' });
        return;
      }
      a[0] = a[lastIdx];
      a[lastIdx] = null;
      n -= 1;
      push({
        i: 0, dir: 'down',
        msg: '맨 뒤 heap[' + lastIdx + ']=' + a[0] + ' 를 루트로 옮기고 크기를 ' + n +
             ' 로 줄인다. 왜 맨 뒤인가 — 그래야 트리가 완전 이진 트리로 남고 배열에 구멍이 안 생긴다.'
      });
      siftDown(0, n);
      push({ all: true, msg: 'pop() 완료. 꺼낸 값 ' + out + ', 교환 ' + swaps + '회. 내려간 거리는 최대 트리 높이 ' + depthOf(n) + ' — O(log n).' });
    }

    function opHeapify(replace) {
      begin('heapify');
      out = null;
      swaps = 0;
      if (replace) { a = replace.slice(); n = a.length; }
      settledLo = n;   // 아직 아무 자리도 확정되지 않았다
      var start = (n >> 1) - 1;
      if (start < 0) {
        // n ≤ 1 이면 내부 노드가 없어 반복문이 한 번도 돌지 않는다.
        push({ msg: 'heapify: 원소가 ' + n + '개뿐이라 자식을 가진 노드가 없다. 잎만 있는 트리는 그 자체로 힙이다 — 할 일이 없다.' });
      } else {
        push({
          msg: 'heapify: 아래에서 위로 쌓는다. 인덱스 ' + start + ' = ⌊' + n + '/2⌋-1 부터 0 까지 거꾸로 내려가며 sift-down. ' +
               'i ≥ ' + (n >> 1) + ' 인 칸은 전부 잎이라 이미 힙이다 — 그래서 절반은 손도 대지 않는다.'
        });
      }
      for (var k = start; k >= 0; k--) {
        settledLo = k + 1;
        push({
          i: k, dir: 'down',
          msg: 'i=' + k + ' 를 뿌리로 하는 부분 트리 차례다. 자식 쪽(i > ' + k + ')은 이미 힙이므로, ' +
               'heap[' + k + ']=' + a[k] + ' 하나만 제자리로 내려보내면 된다.'
        });
        siftDown(k, n);
      }
      settledLo = 0;
      var nlogn = n > 1 ? Math.round(n * Math.log(n) / Math.LN2) : 0;
      push({
        all: true,
        msg: 'heapify 완료. 교환 ' + swaps + '회. 하나씩 push 했다면 최대 n·log₂n ≈ ' + nlogn +
             '회다. 노드의 절반은 잎이라 내려갈 거리가 0, 그 위 4분의 1은 1 — 이 합이 O(n) 으로 수렴한다.'
      });
    }

    function opPeek() {
      begin('peek');
      settledLo = 0;
      out = null;
      if (n === 0) { push({ msg: 'peek: 힙이 비어 있다.' }); return; }
      push({
        i: 0, all: true,
        msg: 'peek(): 배열의 0번 칸 하나만 읽으면 끝이다. heap[0]=' + a[0] + ' 가 ' +
             (isMin ? '최솟값' : '최댓값') + '. 비교도 이동도 없으니 O(1).'
      });
    }

    // --- 대본 실행 ---

    // 첫 연산이 heapify 가 아닌데 초기 배열이 힙이 아니면, 조용히 heapify 를 앞에 끼운다.
    // 힙이 아닌 배열에 push/pop 을 하는 그림은 독자에게 거짓말이 된다.
    var script = ops.slice();
    var autoHeapify = false;
    if (!isHeap(a, n, isMin) && !(script[0] && script[0].op === 'heapify')) {
      script.unshift({ op: 'heapify', arr: null });
      autoHeapify = true;
    }

    begin('초기');
    push({
      msg: '초기 배열 [' + a.slice(0, n).join(', ') + ']. ' +
           (isHeap(a, n, isMin)
             ? '이미 ' + (isMin ? '최소' : '최대') + ' 힙 성질을 만족한다.'
             : (isMin ? '부모가 자식보다 작다' : '부모가 자식보다 크다') + '는 성질이 아직 깨져 있다' +
               (autoHeapify ? ' — 그래서 heapify 부터 한다.' : '.'))
    });

    for (var s = 0; s < script.length; s++) {
      if (steps.length >= MAX_STEPS) { truncated = true; break; }
      var o = script[s];
      if (o.op === 'push') {
        var v = o.v;
        if (v === null || v === undefined) {
          // 자동 값: 반드시 끝까지 올라가도록 골라 sift-up 을 온전히 보여 준다.
          var ext = a[0];
          for (var q = 1; q < n; q++) { if (prefers(a[q], ext, isMin)) ext = a[q]; }
          v = clampVal(isMin ? (n ? ext - 1 : 5) : (n ? ext + 1 : 5));
        }
        opPush(v);
      } else if (o.op === 'pop') opPop();
      else if (o.op === 'heapify') opHeapify(o.arr);
      else if (o.op === 'peek') opPeek();
    }

    if (truncated) {
      steps.push({
        arr: a.slice(), n: n, op: '중단', i: -1, j: -1, l: -1, r: -1, swap: false, dir: '',
        settledLo: 0, allSettled: true, out: null,
        msg: '스텝이 ' + MAX_STEPS + '개를 넘어 여기서 자른다. ops 대본을 줄여라.'
      });
    }

    // 최대 크기: 트리 배치를 이 값으로 고정한다. 그래야 스텝마다 그림이 튀지 않는다.
    var maxN = 1;
    for (var t = 0; t < steps.length; t++) maxN = Math.max(maxN, steps[t].n);
    return {
      steps: steps, starts: starts, maxN: Math.max(1, Math.min(MAX_N, maxN)),
      final: a.slice(0, n), finalN: n
    };
  }

  function depthOf(n) {
    var d = 0;
    while ((2 << d) - 1 < n) d++;   // (2<<d)-1 == 2^(d+1)-1
    return d;
  }

  // ---------------------------------------------------------------- 배치 계산
  //
  // 왜 "타이디 배치"인가: 레벨마다 2^d 칸을 통째로 잡으면 마지막 레벨이 반만
  // 차 있어도 폭을 다 먹어 좁은 화면에서 글자가 뭉갠다. 잎을 왼쪽부터 차례로
  // 세우고 부모를 자식들의 중점에 두면 실제 노드 수만큼만 폭을 쓴다.
  // 이 방식은 정의상 간선이 서로 교차하지 않는다.
  function tidyCols(n) {
    var col = new Array(n), next = 0;
    (function walk(i) {
      if (i >= n) return;
      var l = 2 * i + 1, r = 2 * i + 2;
      if (l >= n) { col[i] = next++; return; }   // 잎
      walk(l);
      var lx = col[l], rx;
      if (r < n) { walk(r); rx = col[r]; }
      else { rx = next++; }                      // 오른쪽 자리를 비워야 왼쪽 자식이 왼쪽에 보인다
      col[i] = (lx + rx) / 2;
    })(0);
    return { col: col, cols: Math.max(1, next) };
  }

  function layout(w, maxN) {
    var tiny = w < 460, narrow = w < 700;
    var pad = tiny ? 6 : (narrow ? 10 : 16);
    var nodeH = tiny ? 21 : (narrow ? 24 : 28);
    // 간선이 보이는 길이. 여기에 인덱스 산술 라벨(높이 13)이 들어가야 하므로
    // 최소 18은 확보한다. 이 값이 작으면 박스끼리 붙어 트리로 안 보인다.
    var edge = tiny ? 20 : (narrow ? 25 : 32);
    var vgap = nodeH + edge;                        // 레벨 간 세로 간격(박스 위쪽끼리)
    var headH = tiny ? 13 : 15;                     // 구역 제목 한 줄

    var t = tidyCols(maxN);
    var levels = depthOf(maxN) + 1;

    // 인덱스 규칙 패널: 넓으면 트리 오른쪽에, 좁으면 트리 아래 한 줄로.
    var panelW = narrow ? 0 : 148;
    var panelH = narrow ? 0 : 66;
    var ruleLineH = narrow ? 15 : 0;

    var availW = Math.max(80, w - pad * 2);
    var treeAreaW = Math.max(80, availW - (panelW ? panelW + 14 : 0));
    // 노드가 몇 개 없을 때 트리가 화면 끝까지 벌어지면 오히려 읽기 나쁘다. 칸 폭에 상한을 둔다.
    var colW = Math.min(treeAreaW / t.cols, tiny ? 44 : (narrow ? 62 : 92));
    // 칸 폭을 다 채우지 않는다. 박스 사이에 틈이 있어야 이웃 노드와 구분된다.
    var nodeW = Math.max(18, Math.min(colW * (tiny ? 0.82 : 0.88), tiny ? 34 : (narrow ? 40 : 48)));
    var treeW = colW * t.cols;
    var treeX = pad + Math.max(0, (treeAreaW - treeW) / 2);

    var treeTop = pad + headH;
    // 레벨 간격 vgap = 박스 위쪽끼리의 거리. 마지막 레벨의 박스 높이까지 포함한다.
    var treeH = (levels - 1) * vgap + nodeH;
    if (!narrow) treeH = Math.max(treeH, panelH);   // 노드가 적어도 패널이 잘리면 안 된다

    var arrTop = treeTop + treeH + ruleLineH + (tiny ? 12 : 22) + headH;

    // 배열은 "더 중요한 뷰"다. 좁으면 줄바꿈해서라도 칸 크기를 지킨다.
    var minCell = tiny ? 26 : 30;
    var perRow = Math.max(1, Math.min(maxN, Math.floor(availW / minCell)));
    var rows = Math.ceil(maxN / perRow);
    var cellW = Math.min(tiny ? 40 : 48, availW / perRow);
    var cellH = nodeH;
    var rowGap = tiny ? 7 : 9;
    var arrW = cellW * Math.min(maxN, perRow);
    var arrX = pad + Math.max(0, (availW - arrW) / 2);

    // "꺼낸 값" 칩 자리를 항상 비워 둔다. 있을 때만 높이를 바꾸면 pop 스텝에서
    // 캔버스 높이가 튀어 아래 본문이 흔들린다.
    var outH = tiny ? 18 : 21;
    var arrBottom = arrTop + rows * (cellH + rowGap) - rowGap;
    var h = arrBottom + outH + pad;

    return {
      w: w, tiny: tiny, narrow: narrow, pad: pad, headH: headH,
      cols: t.cols, col: t.col, levels: levels,
      colW: colW, nodeW: nodeW, nodeH: nodeH, vgap: vgap, edge: edge,
      treeX: treeX, treeTop: treeTop, treeH: treeH,
      panelW: panelW, panelH: panelH, panelX: pad + treeAreaW + 14, panelY: pad + headH,
      ruleLineY: treeTop + treeH + (tiny ? 4 : 6), ruleLineH: ruleLineH,
      arrTop: arrTop, arrX: arrX, arrW: arrW, arrBottom: arrBottom, outH: outH,
      cellW: cellW, cellH: cellH, perRow: perRow, rows: rows, rowGap: rowGap,
      height: h
    };
  }

  function nodeXY(L, k) {
    var d = depthOf(k + 1);       // k 의 레벨 = ⌊log₂(k+1)⌋
    return {
      x: L.treeX + (L.col[k] + 0.5) * L.colW - L.nodeW / 2,
      y: L.treeTop + d * L.vgap
    };
  }

  function cellXY(L, k) {
    var r = Math.floor(k / L.perRow), c = k % L.perRow;
    return { x: L.arrX + c * L.cellW, y: L.arrTop + r * (L.cellH + L.rowGap) };
  }

  // ---------------------------------------------------------------- 그리기 보조

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  K.register('heap-ops', function (host, opts) {
    opts = opts || {};

    var values = normValues(opts.values);
    var kind = (opts.kind === 'max') ? 'max' : 'min';   // 기본은 최소 힙 — Python heapq 가 최소 힙 고정이라서

    // 기본 대본: heapify 로 힙을 만들고, 끝까지 올라가는 push 하나, 그리고 pop.
    // 이 세 개면 sift-up 과 sift-down 을 모두 한 번씩 본다.
    // push 값 null = "반드시 루트까지 올라가는 값을 알아서 고른다"
    function defaultScript() {
      return [{ op: 'heapify', arr: null }, { op: 'push', v: null }, { op: 'pop' }];
    }

    var script = normOps(opts.ops) || defaultScript();
    var seed = toInt(opts.seed, 20240817) >>> 0;

    // 저자가 준 값 중 몇 개를 버렸는지. 말없이 자르면 저자가 왜 안 나오는지 모른다.
    var dropped = 0;
    if (opts.values && typeof opts.values !== 'string' && typeof opts.values.length === 'number') {
      dropped = Math.max(0, opts.values.length - values.length);
    }

    var model = null;      // {steps, maxN}
    var cur = 0;
    var cache = null;      // 배치 캐시: render 마다 다시 계산하면 재생이 무거워진다

    // 결정적 난수. "랜덤 삽입" 버튼을 눌러도 같은 순서가 나와야 테스트가 재현된다.
    function rnd() {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) / 16777216;
    }

    var ui = K.frame(host, { title: '', wide: false });
    var titleEl = K.el('div', 'wk-title', '');
    ui.head.insertBefore(titleEl, ui.head.firstChild);

    function setTitle() {
      titleEl.textContent = kind === 'min'
        ? '힙 연산 — 최소 힙 (Python heapq 의 기본)'
        : '힙 연산 — 최대 힙 (C++ priority_queue 의 기본)';
    }

    // 새 연산을 대본에 덧붙이고, 그 연산의 첫 스텝으로 데려간다.
    // 전부 다시 계산하는 이유: §7 대로 스텝은 미리 만들어 둬야 되감기가 즉시 된다.
    function rebuild(goIdx) {
      model = build(values, kind === 'min', script);
      if (dropped > 0 && model.steps[0]) {
        model.steps[0].msg += ' (옵션 values 중 ' + dropped + '개는 쓰지 않았다 — 유효한 정수만, 최대 ' + MAX_N + '칸.)';
      }
      cache = null;
      var idx = goIdx == null ? 0 : goIdx;
      if (idx === -1) idx = model.starts.length ? model.starts[model.starts.length - 1] : 0;
      if (idx >= model.steps.length) idx = model.steps.length - 1;
      if (idx < 0) idx = 0;
      cur = idx;
      setTitle();
      if (play) play.goto(idx);
    }

    // ---- 머리말 컨트롤 ----
    K.seg(ui.slot, [{ label: '최소 힙', value: 'min' }, { label: '최대 힙', value: 'max' }], kind, function (v) {
      kind = v;
      // 방향이 바뀌면 지금 배열은 더 이상 힙이 아니다. build() 가 heapify 를 앞에 끼운다.
      rebuild(0);
    });

    function btn(label, aria, fn) {
      var b = K.el('button', 'wk-btn', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      ui.slot.appendChild(b);
      return b;
    }

    btn('+ 삽입', '무작위 값을 push 한다', function () {
      script.push({ op: 'push', v: 1 + Math.floor(rnd() * 99) });
      rebuild(-1);
    });
    btn('pop', '루트를 꺼낸다', function () {
      script.push({ op: 'pop' });
      rebuild(-1);
    });
    btn('heapify', '현재 배열을 다시 힙으로 만든다', function () {
      script.push({ op: 'heapify', arr: null });
      rebuild(-1);
    });
    btn('↺ 대본', '처음 대본으로 되돌린다', function () {
      script = normOps(opts.ops) || defaultScript();
      rebuild(0);
    });

    // ---- 범례 (§5: 색만으로 정보를 주지 않는다. 글자 표식도 같이 쓴다) ----
    var legend = K.el('div', 'wk-legend');
    legend.style.width = '100%';
    legend.innerHTML =
      '<span><i style="background:var(--w-frontier)"></i>비교 중 (? ↑ ↓)</span>' +
      '<span><i style="background:var(--box-warn)"></i>교환 (⇄)</span>' +
      '<span><i style="background:var(--w-visited)"></i>확정 (✓)</span>' +
      '<span><i style="background:var(--w-path)"></i>꺼낸 값</span>' +
      '<span>칸 왼쪽 위 작은 숫자 = 인덱스</span>' +
      '<span>heapq = 최소 힙 고정 · priority_queue = 최대 힙 기본 (반대다)</span>';
    ui.slot.appendChild(legend);

    // 캔버스보다 먼저 모델을 만든다. ResizeObserver 가 캔버스 생성 직후
    // 비동기로 redraw 를 부르는데 그때 model 이 없으면 그리다 던진다.
    rebuild(0);

    // ---- 캔버스 ----
    function L() {
      var w = cv.size.w || 320;
      if (!cache || cache.w !== w || cache.maxN !== model.maxN) {
        cache = layout(w, model.maxN);
        cache.maxN = model.maxN;
      }
      return cache;
    }

    function styleOf(s, k) {
      // 우선순위: 교환 쌍 > 지금 보는 칸 > 비교 상대 > 확정 > 보통
      // mark 는 색 없이도 읽히는 표식이다(§5). 칸 오른쪽 위 구석에 찍는다 —
      // 박스 밖에 그리면 좁은 화면에서 옆 노드를 덮거나 캔버스 밖으로 잘린다.
      if (s.swap && (k === s.i || k === s.j)) return { c: 'boxWarn', a: 0.30, lw: 2.5, mark: '⇄' };
      if (k === s.i) return { c: 'wFrontier', a: 0.30, lw: 2.5, mark: s.dir === 'up' ? '↑' : (s.dir === 'down' ? '↓' : '?') };
      if (k === s.j || k === s.l || k === s.r) return { c: 'wFrontier', a: 0.13, lw: 1.6, mark: '?' };
      if (s.allSettled || k >= s.settledLo) return { c: 'wVisited', a: 0.40, lw: 1.2, mark: '✓' };
      return { c: null, a: 0, lw: 1, mark: '' };
    }

    function box(ctx, T, x, y, w, h, k, val, st, faint) {
      ctx.save();
      // 캔버스는 투명하게 시작한다. 농도(globalAlpha)로 칠하려면 먼저 불투명 바탕을 깔아야 한다.
      ctx.fillStyle = T.bgElev;
      rrect(ctx, x, y, w, h, 5);
      ctx.fill();
      if (st.c) {
        ctx.globalAlpha = st.a;
        ctx.fillStyle = T[st.c];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = st.lw;
      ctx.strokeStyle = st.c ? T[st.c] : T.border;
      if (faint) { ctx.setLineDash([3, 3]); ctx.strokeStyle = T.border; }
      ctx.stroke();
      ctx.setLineDash([]);

      var fs = L().tiny ? 11 : 13;
      // 인덱스: 두 뷰에서 같은 자리(왼쪽 위)에 둔다. 트리 노드와 배열 칸이
      // 같은 것임을 형태로 못 박기 위해서다.
      ctx.fillStyle = T.fgFaint;
      ctx.font = (L().tiny ? 8 : 9) + 'px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(k), x + 3, y + 2);

      if (st.mark) {
        ctx.fillStyle = st.c ? T[st.c] : T.fgFaint;
        ctx.textAlign = 'right';
        ctx.fillText(st.mark, x + w - 3, y + 2);
      }

      ctx.fillStyle = faint ? T.fgFaint : T.fg;
      ctx.font = '700 ' + fs + 'px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(val == null ? '·' : String(val), x + w / 2, y + h - (L().tiny ? 4 : 5));
      ctx.restore();
    }

    function pill(ctx, T, x, y, text, color) {
      ctx.save();
      ctx.font = (L().tiny ? 8.5 : 9.5) + 'px ui-monospace, monospace';
      var tw = ctx.measureText(text).width;
      var w = tw + 8, h = 13;
      ctx.fillStyle = T.bg;
      rrect(ctx, x - w / 2, y - h / 2, w, h, 3);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 0.5);
      ctx.restore();
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) { return layout(w, model ? model.maxN : 9).height; },
      draw: function (ctx, size, T) {
        var s = model.steps[cur];
        if (!s) return;
        var l = L();
        var n = s.n;

        ctx.textBaseline = 'alphabetic';

        // ---- 구역 제목 ----
        ctx.fillStyle = T.fgDim;
        ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('트리로 보면 (머릿속 그림)', l.pad, l.pad + (l.tiny ? 9 : 11));
        ctx.fillText('배열로는 (실제로 저장되는 것)', l.pad, l.arrTop - (l.tiny ? 5 : 6));

        // 힙 크기 표시 — pop 으로 줄어드는 것이 보여야 한다
        ctx.textAlign = 'right';
        ctx.fillStyle = T.fgFaint;
        ctx.font = (l.tiny ? 9 : 10) + 'px ui-monospace, monospace';
        ctx.fillText('n = ' + n, size.w - l.pad, l.arrTop - (l.tiny ? 5 : 6));

        // ---- 간선 ----
        // 라벨은 모아 뒀다가 간선을 다 그린 뒤에 얹는다. 그리는 도중에 얹으면
        // 나중 간선이 라벨 위를 지나가 글자를 그어 버린다.
        var pills = [];
        for (var k = 1; k < l.col.length; k++) {
          var p = (k - 1) >> 1;
          var a = nodeXY(l, p), b = nodeXY(l, k);
          var inHeap = k < n;
          var active = s.swap && ((k === s.i && p === s.j) || (k === s.j && p === s.i));
          var looked = (k === s.l || k === s.r) && p === s.i;
          var upEdge = (s.dir === 'up' && ((k === s.i && p === s.j) || (k === s.j && p === s.i)));
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(a.x + l.nodeW / 2, a.y + l.nodeH);
          ctx.lineTo(b.x + l.nodeW / 2, b.y);
          if (!inHeap) { ctx.strokeStyle = T.border; ctx.globalAlpha = 0.35; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; }
          else if (active) { ctx.strokeStyle = T.boxWarn; ctx.lineWidth = 2.6; }
          else if (looked || upEdge) { ctx.strokeStyle = T.wFrontier; ctx.lineWidth = 2; }
          else { ctx.strokeStyle = T.border; ctx.lineWidth = 1.2; }
          ctx.stroke();
          ctx.restore();

          // 지금 쓰이는 간선에만 인덱스 산술을 붙인다. 전부 붙이면 글자밭이 된다.
          if (inHeap && (looked || active || upEdge)) {
            // 간선 한가운데(= 두 박스 사이 빈 띠)에 얹는다. edge 를 18 이상으로
            // 잡아 뒀으므로 라벨(13px)이 박스를 침범하지 않는다.
            var mx = (a.x + b.x) / 2 + l.nodeW / 2, my = a.y + l.nodeH + l.edge * 0.5;
            var label = (s.dir === 'up') ? '(' + k + '-1)/2' : (k === 2 * p + 1 ? '2·' + p + '+1' : '2·' + p + '+2');
            pills.push([mx, my, label, active ? T.boxWarn : T.wFrontier]);
          }
        }
        for (var pi = 0; pi < pills.length; pi++) {
          pill(ctx, T, pills[pi][0], pills[pi][1], pills[pi][2], pills[pi][3]);
        }

        // ---- 트리 노드 ----
        for (k = 0; k < l.col.length; k++) {
          var q = nodeXY(l, k);
          if (k >= n) {
            // 힙 밖: 빈 자리로 남겨 트리가 줄어든 것을 보여 준다
            ctx.save();
            ctx.globalAlpha = 0.4;
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.strokeStyle = T.border;
            rrect(ctx, q.x, q.y, l.nodeW, l.nodeH, 5);
            ctx.stroke();
            ctx.restore();
            continue;
          }
          box(ctx, T, q.x, q.y, l.nodeW, l.nodeH, k, s.arr[k], styleOf(s, k), false);
        }

        // ---- 인덱스 규칙 ----
        ctx.save();
        ctx.textBaseline = 'alphabetic';
        if (l.panelW) {
          ctx.fillStyle = T.bgElev;
          rrect(ctx, l.panelX, l.panelY, l.panelW, l.panelH, 6);
          ctx.fill();
          ctx.strokeStyle = T.border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = T.fgDim;
          ctx.font = '700 10px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('인덱스 규칙 (0-based)', l.panelX + 9, l.panelY + 16);
          ctx.font = '11px ui-monospace, monospace';
          ctx.fillStyle = T.fg;
          ctx.fillText('부모(i)   = (i-1)/2', l.panelX + 9, l.panelY + 33);
          ctx.fillText('왼자식(i) = 2i+1', l.panelX + 9, l.panelY + 47);
          ctx.fillText('오른자식  = 2i+2', l.panelX + 9, l.panelY + 61);
        } else {
          ctx.fillStyle = T.fgDim;
          ctx.font = (l.tiny ? 9 : 10) + 'px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('부모 (i-1)/2 · 왼자식 2i+1 · 오른자식 2i+2', size.w / 2, l.ruleLineY + 10);
        }
        ctx.restore();

        // ---- 배열 ----
        for (k = 0; k < l.col.length; k++) {
          var c = cellXY(l, k);
          box(ctx, T, c.x, c.y, l.cellW - 3, l.cellH, k, s.arr[k], k < n ? styleOf(s, k) : { c: null, a: 0, lw: 1, mark: '' }, k >= n);
        }

        // ---- 꺼낸 값: 배열 밖으로 빠져나간 원소 ----
        // wPath(금색)는 "확정된 답" 전용 색이다. pop 이 돌려주는 값은 이 힙이
        // 내놓는 답 그 자체이므로 여기서만 쓴다.
        if (s.out != null) {
          ctx.save();
          var txt = '꺼낸 값 ' + s.out;
          ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px system-ui, sans-serif';
          var tw = ctx.measureText(txt).width + 18;
          var cx = size.w / 2, oy = l.arrBottom + 3;
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = T.wPath;
          rrect(ctx, cx - tw / 2, oy, tw, l.outH - 5, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.wPath;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.fillStyle = T.fg;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, cx, oy + (l.outH - 5) / 2 + 0.5);
          ctx.restore();
        }
      }
    });

    var play = K.player(ui, {
      total: function () { return model.steps.length; },
      render: function (i) { cur = i; cv.redraw(); },
      label: function (i) {
        var s = model.steps[i];
        if (!s) return '';
        return '[' + s.op + '] ' + s.msg;
      },
      speed: 620
    });

    setTitle();
    play.goto(0);

    // 테스트·디버깅용 훅. 계약상 전역 오염은 금지라 host 요소에만 붙인다.
    host.__heapOps = {
      steps: function () { return model.steps; },
      kind: function () { return kind; },
      setKind: function (v) { kind = (v === 'max') ? 'max' : 'min'; rebuild(0); },
      run: function (ops) { script = normOps(ops) || defaultScript(); rebuild(0); },
      setValues: function (v) { values = normValues(v); rebuild(0); },
      goto: function (i) { play.goto(i); },
      layout: function () { return L(); },
      nodeXY: function (k) { return nodeXY(L(), k); },
      cellXY: function (k) { return cellXY(L(), k); }
    };
  });
})();

/* ==== multi-agv-conflict.js ==== */
/* multi-agv-conflict.js — 여러 대가 같은 통로를 쓸 때 무엇이 무너지는가
 *
 * 이 위젯 하나가 V-8·V-9·V-10 세 챕터를 떠받친다. 세 챕터가 사실은 한 줄기이기
 * 때문이다: **A\* 의 상태에 시각을 더하면 시공간 A\*(V-8), 그 위에 충돌을 제약으로
 * 되먹이면 CBS(V-9), 계획대로 굴러가지 않는 현장에서 남는 실패가 교착(V-10)이다.**
 * 세 챕터에 서로 다른 위젯 셋을 만들면 독자는 세 개의 관용구를 얻고 계보를 잃는다.
 * 같은 격자·같은 타임라인·같은 카운터로 넷을 보여 주면 계보가 남는다.
 *
 * 왜 "타임라인" 이 격자만큼 크게 그려지는가
 *   이 세 챕터의 상태는 칸이 아니라 **(칸, 시각)** 이다. 격자만 그리면 시간 축이
 *   화면에서 사라지고, 시간 축이 사라지면 "예약은 시각과 함께 열리고 닫힌다" 도
 *   "t=2 에 둘 다 가운데 있다" 도 그림으로 확인할 수 없다. 그래서 시간은
 *   재생 인덱스에 숨기지 않고 **가로축으로 펼쳐** 놓는다.
 *
 * 왜 예약 테이블·제약 트리·자원 할당 그래프를 "옆 패널" 로 따로 그리는가
 *   이 셋은 각 챕터가 가르치려는 **자료구조 그 자체**다. 격자 위에 색으로 녹여
 *   넣으면 자료구조가 안 보이고 결과만 보인다. V-8 의 독자가 봐야 하는 것은
 *   B 가 비켜 갔다는 사실이 아니라 `(2,2)@2` 라는 항목이 표에 찍히는 순간이다.
 *
 * 왜 일부러 실패하는 모드가 있는가 (v-8 §5)
 *   우선순위 기반 계획이 **해가 있는데도 실패하는** 장면이 V-9 의 존재 이유다.
 *   성공으로 바꾸면 다음 챕터의 동기가 통째로 사라진다. 그래서 이 호출은 회색으로
 *   막힌 채 끝나고, 그 위에 손으로 만든 동시 해를 겹쳐 대비를 만든다.
 *
 * 왜 알고리즘을 본문 코드와 한 글자씩 맞췄는가 (계약 §9)
 *   본문은 코드를 **실제로 돌려** 경로와 비용을 인쇄해 두었다. 위젯이 다른 경로를
 *   그리면 둘 중 하나가 거짓말이다. MOVES 순서·HORIZON·힙의 튜플 비교·도착 칸의
 *   미래 예약 검사까지 본문과 동일하게 두어, 위젯이 인쇄된 출력을 그대로 재현한다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // ─── 상수 ────────────────────────────────────────────────────────────────

  var HORIZON = 20;                 // 본문과 동일. 시간 축의 상한
  /* 대기가 첫 번째다 — 시간 축이 생기는 순간 제자리에 머무는 것도 비용 1짜리 행동이다.
   * 순서까지 본문과 같아야 손추적 표의 "새로 연 상태" 열이 그대로 재현된다. */
  var MOVES = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];

  var MAX_ROWS = 24, MAX_COLS = 24, MAX_AGENTS = 6;
  var MAX_STEPS = 220;              // 스텝 상한(계약 §7). 넘치면 화면에 말하고 자른다
  var MAX_SIM = 26;                 // 정책 재생 시뮬레이션 상한

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  var MODES = ['prioritized', 'cbs', 'deadlock'];
  var PANELS = ['grid', 'timeline', 'reservation-table', 'constraint-tree',
    'resource-allocation-graph'];

  var COUNTER_LABEL = {
    expanded: '확장 상태', waits: '대기', makespan: 'makespan', sumOfCosts: '비용 합',
    deadEnd: '막힌 확장', ctNodes: 'CT 노드', lowLevelCalls: '하위 호출',
    cycleLength: '사이클 길이', stepsWithoutProgress: '진행 없는 스텝', yields: '양보'
  };

  var PHASE_LABEL = {
    independent: '① 따로 계획', conflict: '② 충돌', reserve: '③ 예약', replan: '④ 재계획',
    swap: '⑤ 맞바꿈', blocked: '③ 막힘', joint: '④ 동시 해',
    root: '① 뿌리', branch: '③ 분기', solution: '⑤ 해',
    approach: '① 진입', 'hold-and-wait': '② 점유와 대기', cycle: '③ 사이클', resolve: '④ 해소'
  };

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function oneOf(v, list, dflt) {
    for (var i = 0; i < list.length; i++) if (v === list[i]) return v;
    return dflt;
  }
  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  // 칸을 정수 하나로 접는다. c < 64 이므로 정수 크기 비교가 곧 (r,c) 사전순 비교다 —
  // 본문의 파이썬 튜플 비교와 순서가 같아야 확장 순서가 재현된다.
  function enc(r, c) { return r * 64 + c; }
  function rowOf(x) { return x >> 6; }
  function colOf(x) { return x & 63; }
  function rc(x) { return '(' + rowOf(x) + ',' + colOf(x) + ')'; }
  function vkey(cell, t) { return cell * 32 + t; }
  function ekey(a, b, t) { return (a * 4096 + b) * 32 + t; }

  function walkable(g, r, c) {
    return r >= 0 && r < g.length && c >= 0 && c < g[0].length && g[r].charAt(c) !== '#';
  }
  function manh(a, b) {
    return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));
  }
  function showPath(p) {
    var s = [];
    for (var i = 0; i < p.length; i++) s.push(rc(p[i]));
    return s.join(' ');
  }

  // ─── 이진 힙 ─────────────────────────────────────────────────────────────

  /* 항목 [f, t, cell] 을 사전순으로 비교한다. 본문의 heapq 가 튜플을 비교하는 것과
   * 같다. (t, cell) 이 상태를 유일하게 정하므로 동점이 아예 없고, 따라서 확장
   * 순서가 완전히 결정론적이다 — 같은 인덱스에 같은 그림(계약 §7)의 근거이기도 하다. */
  function Heap() { this.a = []; }
  Heap.prototype.less = function (x, y) {
    if (x[0] !== y[0]) return x[0] < y[0];
    if (x[1] !== y[1]) return x[1] < y[1];
    return x[2] < y[2];
  };
  Heap.prototype.size = function () { return this.a.length; };
  Heap.prototype.push = function (e) {
    var a = this.a, i = a.length;
    a.push(e);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      var t = a[i]; a[i] = a[p]; a[p] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0, n = a.length;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, m = i;
        if (l < n && this.less(a[l], a[m])) m = l;
        if (r < n && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        var t = a[i]; a[i] = a[m]; a[m] = t; i = m;
      }
    }
    return top;
  };

  // ─── 시공간 A* — 본문 v-8 / v-9 의 plan() 그대로 ──────────────────────────

  function rebuild(came, cell, t) {
    var path = [], k = vkey(cell, t), guard = 4096;
    while (k !== -1 && guard-- > 0) { path.push(Math.floor(k / 32)); k = came.get(k); }
    path.reverse();
    return path;
  }

  /* 상태는 (칸, 시각)이다. vertex·edge 는 내가 하면 안 되는 것의 집합이다.
   * 예약 테이블이면 우선순위 기반 계획, 한 에이전트의 제약 집합이면 CBS 의 하위 레벨. */
  function plan(g, start, goal, vertex, edge) {
    var open = new Heap();
    open.push([manh(start, goal), 0, start]);
    var came = new Map();
    came.set(vkey(start, 0), -1);
    var exp = [];                      // 시각화용 확장 기록. 알고리즘에는 영향이 없다
    while (open.size()) {
      var e = open.pop(), t = e[1], cell = e[2];
      var rec = { cell: cell, t: t, f: e[0], opened: [], skipped: [] };
      exp.push(rec);
      if (cell === goal) {
        // 목표 칸이 나중에 예약되어 있으면 그 자리에 눌러앉을 수 없다
        var clear = true;
        for (var tt = t; tt <= HORIZON; tt++) if (vertex.has(vkey(goal, tt))) { clear = false; break; }
        if (clear) return { path: rebuild(came, cell, t), exp: exp };
      }
      if (t >= HORIZON) continue;
      var cr = rowOf(cell), cc = colOf(cell);
      for (var m = 0; m < 5; m++) {
        var nr = cr + MOVES[m][0], nc = cc + MOVES[m][1];
        if (!walkable(g, nr, nc)) continue;
        var nxt = enc(nr, nc);
        if (vertex.has(vkey(nxt, t + 1))) { rec.skipped.push([nxt, t + 1, 'v']); continue; }
        if (edge.has(ekey(cell, nxt, t))) { rec.skipped.push([nxt, t + 1, 'e']); continue; }
        if (came.has(vkey(nxt, t + 1))) continue;   // g == t 이므로 처음 닿은 것이 최선이다
        came.set(vkey(nxt, t + 1), vkey(cell, t));
        open.push([t + 1 + manh(nxt, goal), t + 1, nxt]);
        rec.opened.push([nxt, t + 1]);
      }
    }
    return { path: null, exp: exp };
  }

  /* 뽑은 경로를 예약 테이블에 적는다. 항목을 만들어진 순서대로 모아 두는 이유:
   * 위젯이 표를 한 항목씩 채워 보여야 "(2,2)@2 가 찍히는 순간"이 그림이 된다. */
  function reserveEntries(path) {
    var out = [], t;
    for (t = 0; t < path.length; t++) out.push({ kind: 'v', cell: path[t], t: t });
    for (t = 0; t + 1 < path.length; t++) out.push({ kind: 'e', cell: path[t + 1], to: path[t], t: t });
    for (t = path.length; t <= HORIZON; t++) out.push({ kind: 'v', cell: path[path.length - 1], t: t, tail: true });
    return out;
  }
  function applyEntries(list, vertex, edge) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.kind === 'v') vertex.add(vkey(e.cell, e.t));
      else edge.add(ekey(e.cell, e.to, e.t));
    }
  }

  function prioritized(g, agents, useEdge) {
    var vertex = new Set(), edge = new Set(), paths = [], runs = [], ents = [];
    for (var i = 0; i < agents.length; i++) {
      var r = plan(g, agents[i].s, agents[i].g, vertex, useEdge ? edge : new Set());
      runs.push(r);
      if (!r.path) return { paths: paths, failed: i, runs: runs, ents: ents };
      var list = reserveEntries(r.path);
      applyEntries(list, vertex, edge);
      ents.push(list);
      paths.push(r.path);
    }
    return { paths: paths, failed: -1, runs: runs, ents: ents };
  }

  function at(p, t) { return t < p.length ? p[t] : p[p.length - 1]; }

  function firstConflict(paths) {
    var span = 0, i, j, t;
    for (i = 0; i < paths.length; i++) span = Math.max(span, paths[i].length);
    for (t = 0; t < span; t++)
      for (i = 0; i < paths.length; i++)
        for (j = i + 1; j < paths.length; j++) {
          var a = at(paths[i], t), b = at(paths[j], t);
          if (a === b) return { kind: 'vertex', i: i, j: j, a: a, b: b, t: t };
          // 맞바꿈 — 어느 시각에도 같은 칸에 있은 적이 없지만 서로를 관통한다
          if (at(paths[i], t + 1) === b && at(paths[j], t + 1) === a)
            return { kind: 'swap', i: i, j: j, a: a, b: b, t: t };
        }
    return { kind: 'none', i: 0, j: 0, a: 0, b: 0, t: 0 };
  }

  function totalCost(paths) {
    var s = 0;
    for (var i = 0; i < paths.length; i++) s += paths[i].length - 1;
    return s;
  }
  function makespan(paths) {
    var s = 0;
    for (var i = 0; i < paths.length; i++) s = Math.max(s, paths[i].length - 1);
    return s;
  }
  function waitCount(paths) {
    var n = 0;
    for (var i = 0; i < paths.length; i++)
      for (var t = 1; t < paths[i].length; t++) if (paths[i][t] === paths[i][t - 1]) n++;
    return n;
  }

  // ─── CBS — 상위 레벨은 제약 트리, 하위 레벨은 시공간 A* ────────────────────

  function cbs(g, agents) {
    var n = agents.length, i;
    var cons = [];
    for (i = 0; i < n; i++) cons.push({ v: new Set(), e: new Set() });
    var paths = [], calls = n;
    for (i = 0; i < n; i++) paths.push(plan(g, agents[i].s, agents[i].g, cons[i].v, cons[i].e).path);
    for (i = 0; i < n; i++) if (!paths[i]) return { paths: null, nodes: [], trace: [], expanded: 0, calls: calls, goal: -1 };
    var nodes = [{ cons: cons, paths: paths, parent: -1, who: -1, tag: '', cost: totalCost(paths), depth: 0 }];
    var open = new Heap();
    open.push([nodes[0].cost, 0, 0]);
    var expanded = 0, trace = [], guard = 0;
    while (open.size() && guard++ < 4000) {
      var idx = open.pop()[1], nd = nodes[idx];
      expanded += 1;
      var cf = firstConflict(nd.paths);
      var rec = { node: idx, cost: nd.cost, conflict: cf, children: [] };
      trace.push(rec);
      if (cf.kind === 'none') return { paths: nd.paths, nodes: nodes, trace: trace, expanded: expanded, calls: calls, goal: idx };
      var whos = [cf.i, cf.j];
      for (var k = 0; k < 2; k++) {
        var who = whos[k], tag;
        // 제약은 **깊은 복사**다. 얕게 복사하면 자식이 부모와 형제를 오염시킨다
        var child = [];
        for (i = 0; i < n; i++) child.push({ v: new Set(nd.cons[i].v), e: new Set(nd.cons[i].e) });
        if (cf.kind === 'vertex') {
          child[who].v.add(vkey(cf.a, cf.t));
          tag = rc(cf.a) + '@' + cf.t;
        } else {
          var u = who === cf.i ? cf.a : cf.b, w = who === cf.i ? cf.b : cf.a;
          child[who].e.add(ekey(u, w, cf.t));
          tag = rc(u) + '→' + rc(w) + '@' + cf.t;
        }
        // 제약이 붙은 **한 명만** 다시 계획한다. 전부 다시 계획하면 최적성 논증이 무너진다
        var fixed = plan(g, agents[who].s, agents[who].g, child[who].v, child[who].e).path;
        calls += 1;
        if (!fixed) continue;
        var grown = nd.paths.slice();
        grown[who] = fixed;
        nodes.push({
          cons: child, paths: grown, parent: idx, who: who, tag: tag,
          cost: totalCost(grown), depth: nd.depth + 1
        });
        rec.children.push(nodes.length - 1);
        open.push([totalCost(grown), nodes.length - 1, 0]);
      }
    }
    return { paths: null, nodes: nodes, trace: trace, expanded: expanded, calls: calls, goal: -1 };
  }

  // ─── 자원 할당 그래프 · 3색 DFS · 은행가 (V-10) ───────────────────────────

  /* 회색(1)으로 되돌아가는 간선이 곧 사이클이다 — IV-2 의 3색 DFS 그대로다.
   * 이벤트를 남기는 이유: 교착 검출을 "결과" 가 아니라 "탐색 과정" 으로 보여야
   * 독자가 아는 DFS 와 같은 것임이 화면에서 확인된다. */
  function findCycle(nodes, adj) {
    var color = {}, trail = [], events = [], i;
    for (i = 0; i < nodes.length; i++) color[nodes[i]] = 0;
    function dfs(v) {
      color[v] = 1; trail.push(v);
      events.push({ kind: 'enter', v: v, trail: trail.slice(), color: shallow(color) });
      var out = adj[v] || [];
      for (var k = 0; k < out.length; k++) {
        var w = out[k];
        if (color[w] === 1) {
          var cyc = trail.slice(trail.indexOf(w)).concat([w]);
          events.push({ kind: 'cycle', v: v, w: w, trail: trail.slice(), color: shallow(color), cycle: cyc });
          return cyc;
        }
        if (color[w] === 0) {
          var f = dfs(w);
          if (f.length) return f;
        }
      }
      trail.pop(); color[v] = 2;
      events.push({ kind: 'black', v: v, trail: trail.slice(), color: shallow(color) });
      return [];
    }
    function shallow(o) { var c = {}; for (var kk in o) if (o.hasOwnProperty(kk)) c[kk] = o[kk]; return c; }
    for (i = 0; i < nodes.length; i++) {
      if (color[nodes[i]] === 0) {
        var f = dfs(nodes[i]);
        if (f.length) return { cycle: f, events: events };
      }
    }
    return { cycle: [], events: events };
  }

  /* 은행가 — 요청을 들어준 뒤에도 "모두가 끝날 수 있는 순서"가 남는가.
   * hold[k] = k 가 지금 쥔 자원 칸(-1이면 없음), need[k] = 앞으로 잡아야 할 자원 칸들. */
  function safeSequence(resources, hold, need) {
    var free = {}, i, k;
    for (i = 0; i < resources.length; i++) free[resources[i]] = true;
    for (k = 0; k < hold.length; k++) if (hold[k] >= 0) delete free[hold[k]];
    var done = [], order = [];
    for (k = 0; k < hold.length; k++) done.push(false);
    for (var step = 0; step < hold.length; step++) {
      var picked = -1;
      for (k = 0; k < hold.length && picked < 0; k++) {
        if (done[k]) continue;
        var fits = true;
        for (i = 0; i < need[k].length; i++)
          if (!free[need[k][i]] && need[k][i] !== hold[k]) { fits = false; break; }
        if (fits) picked = k;
      }
      if (picked < 0) return [];            // 아무도 못 고르면 안전 순열이 없다
      if (hold[picked] >= 0) free[hold[picked]] = true;
      done[picked] = true;
      order.push(picked);
    }
    return order;
  }

  // 벽과 정적 장애물(후속 차량)만 피하는 격자 BFS. 다른 로봇은 장애물이 아니다 —
  // 로봇은 "언제 갈 것인가" 로 피하지 경로 자체를 바꾸지 않는다는 V-10 §1 의 전제다.
  var D4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function route(grid, blocked, from, to) {
    if (from === to) return [from];
    var prev = {}, seen = {}, q = [from], head = 0;
    seen[from] = 1;
    while (head < q.length) {
      var cur = q[head++], cr = rowOf(cur), cc = colOf(cur);
      for (var d = 0; d < 4; d++) {
        var nr = cr + D4[d][0], nc = cc + D4[d][1];
        if (!walkable(grid, nr, nc)) continue;
        var nx = enc(nr, nc);
        if (seen[nx] || blocked[nx]) continue;
        seen[nx] = 1; prev[nx] = cur;
        if (nx === to) {
          var path = [to], p = to;
          while (p !== from) { p = prev[p]; path.push(p); }
          path.reverse();
          return path;
        }
        q.push(nx);
      }
    }
    return null;
  }

  // ─── 시나리오 프리셋 ─────────────────────────────────────────────────────
  //
  // 본문의 ::: dual 코드가 쓰는 격자·에이전트와 **글자 하나까지 같다.** 위젯이
  // 다른 배치를 그리면 인쇄된 경로와 비용을 재현할 수 없다.

  var SCEN = {
    'cross-intersection': {
      grid: ['##.##', '##.##', '.....', '##.##', '##.##'],
      agents: [{ id: 'A', start: [2, 0], goal: [2, 4] }, { id: 'B', start: [0, 2], goal: [4, 2] }],
      title: '십자 교차로 — 예약 테이블이 대기 하나를 만든다'
    },
    'corridor-alcove': {
      grid: ['#.###', '.....'],
      agents: [{ id: 'A', start: [1, 0], goal: [1, 4] }, { id: 'B', start: [1, 4], goal: [1, 0] }],
      title: '대피 공간이 하나뿐인 복도'
    },
    'gridlock-2x2': {
      grid: ['#..#', '....', '....', '#..#'],
      agents: [
        { id: 'R1', start: [1, 1], goal: [1, 3], queue: [[1, 0]] },
        { id: 'R2', start: [1, 2], goal: [3, 2], queue: [[0, 2]] },
        { id: 'R3', start: [2, 2], goal: [2, 0], queue: [[2, 3]] },
        { id: 'R4', start: [2, 1], goal: [0, 1], queue: [[3, 1]] }
      ],
      title: '사거리 — 네 대가 서로의 다음 칸을 쥐고 있다'
    }
  };

  // 맞바꿈 시연용 1행짜리 복도(본문 v-8 출력 [2]). 주 격자와 별도로 그린다.
  var SWAP_SCENE = {
    grid: ['....'],
    agents: [{ id: 'A', start: [0, 0], goal: [0, 3] }, { id: 'B', start: [0, 3], goal: [0, 0] }]
  };

  // 라이브락 시연 — 교차 칸 (1,2) 하나를 둘이 함께 지나야 한다. 목표는 겹치지 않는다.
  var LIVE = {
    agents: [
      { id: 'L1', start: [1, 1], goal: [1, 3], back: [1, 0] },
      { id: 'L2', start: [0, 2], goal: [2, 2], back: [0, 1] }
    ],
    cross: [1, 2]
  };

  // ─── opts 검증 — 본문 저자가 손으로 쓴 JSON 이라 신뢰하지 않는다(계약 §1) ────

  function readGrid(v, dflt) {
    if (!isArr(v) || !v.length) return dflt;
    var rows = [], w = 0, i;
    for (i = 0; i < v.length && rows.length < MAX_ROWS; i++) {
      if (typeof v[i] !== 'string' || !v[i].length) return dflt;
      rows.push(v[i].slice(0, MAX_COLS));
      w = Math.max(w, rows[rows.length - 1].length);
    }
    if (!rows.length || w === 0) return dflt;
    for (i = 0; i < rows.length; i++) {       // 짧은 줄은 벽으로 채워 직사각형을 보장한다
      while (rows[i].length < w) rows[i] += '#';
    }
    return rows;
  }

  function readAgents(v, grid, dflt) {
    if (!isArr(v) || !v.length) return dflt;
    var out = [], i;
    for (i = 0; i < v.length && out.length < MAX_AGENTS; i++) {
      var a = v[i];
      if (!a || typeof a !== 'object' || !isArr(a.start) || !isArr(a.goal)) return dflt;
      var sr = clampInt(a.start[0], 0, grid.length - 1, -1), sc = clampInt(a.start[1], 0, grid[0].length - 1, -1);
      var gr = clampInt(a.goal[0], 0, grid.length - 1, -1), gc = clampInt(a.goal[1], 0, grid[0].length - 1, -1);
      if (sr < 0 || sc < 0 || gr < 0 || gc < 0) return dflt;
      if (!walkable(grid, sr, sc) || !walkable(grid, gr, gc)) return dflt;
      var q = [];
      if (isArr(a.queue)) {
        for (var k = 0; k < a.queue.length && k < 2; k++) {
          var p = a.queue[k];
          if (!isArr(p)) continue;
          var qr = clampInt(p[0], 0, grid.length - 1, -1), qc = clampInt(p[1], 0, grid[0].length - 1, -1);
          if (qr >= 0 && qc >= 0 && walkable(grid, qr, qc)) q.push(enc(qr, qc));
        }
      }
      out.push({
        id: (typeof a.id === 'string' && a.id.length <= 4) ? a.id : String.fromCharCode(65 + i),
        s: enc(sr, sc), g: enc(gr, gc), queue: q
      });
    }
    return out.length ? out : dflt;
  }

  function toAgents(list, grid) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push({
        id: list[i].id, s: enc(list[i].start[0], list[i].start[1]),
        g: enc(list[i].goal[0], list[i].goal[1]),
        queue: (list[i].queue || []).map(function (p) { return enc(p[0], p[1]); })
      });
    }
    return out;
  }

  // ─── 스텝 스크립트 ───────────────────────────────────────────────────────
  //
  // 스텝은 전부 미리 계산해 배열에 담는다(계약 §7). render(i) 는 그리기만 하므로
  // 되감기가 즉시 되고, 같은 i 는 항상 같은 그림이다.

  function pushStep(steps, o) {
    if (steps.length < MAX_STEPS) steps.push(o);
    else if (steps.length === MAX_STEPS) {
      // 잘라내는 것은 화면에 말한다 — 조용한 절단은 이 책이 이미 한 번 고친 결함이다
      steps[MAX_STEPS - 1].note = '스텝 상한 ' + MAX_STEPS + '개에서 잘렸다. opts 를 줄여라.';
    }
  }

  /* ① 십자 교차로 — 따로 계획 → 충돌 → 예약 → 재계획 (v-8 §2) */
  function buildPrioritized(cfg) {
    var g = cfg.grid, ags = cfg.agents, steps = [];
    var n = ags.length, i;

    // ── ① 따로 계획: 서로를 모르는 채 각자 최단경로를 뽑는다
    var indep = [];
    for (i = 0; i < n; i++) indep.push(plan(g, ags[i].s, ags[i].g, new Set(), new Set()).path || [ags[i].s]);
    for (i = 0; i < n; i++) {
      pushStep(steps, {
        ph: 'independent', paths: indep.slice(0, i + 1), now: -1,
        ctr: { expanded: 0, waits: 0, makespan: makespan(indep.slice(0, i + 1)), sumOfCosts: totalCost(indep.slice(0, i + 1)) },
        msg: ags[i].id + ' 가 서로를 모르는 채 혼자 계획했다. ' + showPath(indep[i]) +
          ' — 비용 ' + (indep[i].length - 1) + '. 벽을 넘지 않고 최단이다.'
      });
    }

    // ── ② 충돌: 타임라인을 한 칸씩 밀면 어느 시각에 사고가 나는지 보인다
    var cf = firstConflict(indep);
    var span = makespan(indep);
    var stop = (cf.kind === 'none') ? span : cf.t;
    for (var t = 0; t <= stop; t++) {
      var hit = (cf.kind !== 'none' && t === cf.t);
      pushStep(steps, {
        ph: hit ? 'conflict' : 'independent', paths: indep, now: t, cf: hit ? cf : null,
        ctr: { expanded: 0, waits: waitCount(indep), makespan: span, sumOfCosts: totalCost(indep) },
        msg: hit
          ? ('t=' + t + ' — ' + (cf.kind === 'vertex'
            ? ('정점 충돌. ' + ags[cf.i].id + ' 와 ' + ags[cf.j].id + ' 가 둘 다 ' + rc(cf.a) + ' 에 있다.')
            : ('맞바꿈 충돌. ' + ags[cf.i].id + ' 와 ' + ags[cf.j].id + ' 가 ' + rc(cf.a) + ' ↔ ' + rc(cf.b) + ' 로 서로를 관통한다.')) +
            ' 각자의 경로는 완벽한데 함께 두면 사고가 난다.')
          : ('t=' + t + ' — 아직 아무 일도 없다. ' + ags.map(function (a, k) { return a.id + ' ' + rc(at(indep[k], t)); }).join(', ') + '.')
      });
    }

    // ── ③ 예약: 앞 순번의 경로를 (칸, 시각) 표로 옮겨 적는다
    var ents = reserveEntries(indep[0]);
    var byTime = [];                       // 같은 t 의 항목을 한 스텝에 묶어 보여 준다
    for (i = 0; i < ents.length; i++) {
      if (ents[i].tail) continue;
      var k = ents[i].t;
      (byTime[k] || (byTime[k] = [])).push(i);
    }
    var revealed = 0;
    for (t = 0; t < byTime.length; t++) {
      if (!byTime[t]) continue;
      revealed = Math.max.apply(null, byTime[t]) + 1;
      var vEnt = null;
      for (i = 0; i < byTime[t].length; i++) if (ents[byTime[t][i]].kind === 'v') vEnt = ents[byTime[t][i]];
      pushStep(steps, {
        ph: 'reserve', paths: [indep[0]], now: t, resN: revealed,
        ctr: { expanded: 0, waits: 0, makespan: span, sumOfCosts: totalCost(indep) },
        msg: ags[0].id + ' 의 경로를 예약 테이블에 적는다. vertex ' + rc(vEnt.cell) + '@' + vEnt.t +
          ' — 이 칸은 이 시각에 임자가 있다. 다른 시각에는 비어 있다.'
      });
    }
    pushStep(steps, {
      ph: 'reserve', paths: [indep[0]], now: -1, resN: ents.length,
      ctr: { expanded: 0, waits: 0, makespan: span, sumOfCosts: totalCost(indep) },
      msg: '도착 칸 ' + rc(indep[0][indep[0].length - 1]) + ' 를 t=' + indep[0].length +
        ' 부터 지평 끝 t=' + HORIZON + ' 까지 전부 예약했다. 도착한 로봇은 사라지지 않는다.'
    });

    // ── ④ 재계획: 뒤 순번만 다시 계획한다. 예약은 시간에 따라 열리고 닫히는 장애물이다
    var vertex = new Set(), edge = new Set();
    applyEntries(ents, vertex, edge);
    var run = plan(g, ags[1].s, ags[1].g, vertex, edge);
    for (i = 0; i < run.exp.length; i++) {
      var e = run.exp[i];
      var opened = e.opened.map(function (o) { return rc(o[0]) + '@' + o[1]; });
      var dropped = e.skipped.map(function (o) { return rc(o[0]) + '@' + o[1] + (o[2] === 'e' ? '(간선)' : ''); });
      pushStep(steps, {
        ph: 'replan', paths: [indep[0]], now: e.t, resN: ents.length,
        srch: { who: 1, upto: i + 1, exp: run.exp },
        ctr: { expanded: i + 1, waits: 0, makespan: span, sumOfCosts: totalCost(indep) },
        msg: ags[1].id + ' 재계획 ' + i + '번째 확장: ' + rc(e.cell) + '@' + e.t + ' 를 꺼냈다. f = t + h = ' + e.f + '. ' +
          (opened.length ? '새로 연 상태 ' + opened.join(' ') + '.' : '새로 연 상태 없음 — 이미 다 열려 있다.') +
          (dropped.length ? ' 예약 때문에 버린 것 ' + dropped.join(' ') + '.' : '')
      });
    }
    var finalPaths = run.path ? [indep[0], run.path] : [indep[0]];
    var fc = firstConflict(finalPaths);
    pushStep(steps, {
      ph: 'replan', paths: finalPaths, now: -1, resN: ents.length,
      srch: { who: 1, upto: run.exp.length, exp: run.exp },
      ctr: {
        expanded: run.exp.length, waits: waitCount(finalPaths),
        makespan: makespan(finalPaths), sumOfCosts: totalCost(finalPaths)
      },
      msg: run.path
        ? (ags[1].id + ' 의 새 경로 ' + showPath(run.path) + '. 대기 ' + waitCount([run.path]) +
          '회가 들어갔고 비용 합이 ' + totalCost(indep) + ' → ' + totalCost(finalPaths) + ' 로 올랐다. 충돌: ' +
          (fc.kind === 'none' ? '없음' : fc.kind) + '.')
        : (ags[1].id + ' 는 해를 찾지 못했다.')
    });
    return steps;
  }

  /* ①-b 맞바꿈 시연 — 정점 충돌이 0건인데 서로를 관통한다 (v-8 출력 [2]) */
  function buildSwapDemo() {
    var g = SWAP_SCENE.grid, ags = toAgents(SWAP_SCENE.agents, g), steps = [];
    var noEdge = prioritized(g, ags, false);
    var withEdge = prioritized(g, ags, true);
    var cf = firstConflict(noEdge.paths);
    var vcount = 0;
    for (var t = 0; t < 4; t++) if (at(noEdge.paths[0], t) === at(noEdge.paths[1], t)) vcount++;
    var alt = { grid: g, agents: ags };

    pushStep(steps, {
      ph: 'swap', alt: alt, paths: noEdge.paths, now: -1,
      ctr: { expanded: 0, waits: 0, makespan: makespan(noEdge.paths), sumOfCosts: totalCost(noEdge.paths) },
      msg: '맞바꿈 시연 — 폭이 하나인 1행짜리 복도. 간선(이동) 예약을 끄면 B 는 ' +
        showPath(noEdge.paths[1]) + ' 로 그냥 직진한다.'
    });
    for (t = 0; t <= 3; t++) {
      var hit = (cf.kind === 'swap' && t === cf.t);
      pushStep(steps, {
        ph: 'swap', alt: alt, paths: noEdge.paths, now: t, cf: hit ? cf : null,
        ctr: { expanded: 0, waits: 0, makespan: makespan(noEdge.paths), sumOfCosts: totalCost(noEdge.paths) },
        msg: hit
          ? ('t=' + t + '→' + (t + 1) + ' — 맞바꿈 충돌. A ' + rc(cf.a) + ' 와 B ' + rc(cf.b) +
            ' 가 자리를 맞바꾼다. 같은 시각 같은 칸에 있은 적은 ' + vcount + '번이다 — 정점 검사는 이것을 통과시킨다.')
          : ('t=' + t + ' — A ' + rc(at(noEdge.paths[0], t)) + ', B ' + rc(at(noEdge.paths[1], t)) + '. 아직 같은 칸에 있지 않다.')
      });
    }
    pushStep(steps, {
      ph: 'swap', alt: alt, paths: [noEdge.paths[0]], now: -1, blocked: true,
      ctr: { expanded: 0, waits: 0, makespan: 3, sumOfCosts: 3 },
      note: '간선 예약을 켠 결과',
      msg: '간선 예약을 켜면 B 는 해를 찾지 못한다(' + (withEdge.failed === 1 ? '실패' : '성공') +
        '). 폭이 하나인 복도에서 마주 오는 둘은 실제로 지나갈 수 없으므로 "해 없음"이 옳은 답이다.'
    });
    return steps;
  }

  /* ② 우선순위 기반의 불완전성 — 일부러 실패한다 (v-8 §5) */
  function buildFailure(cfg) {
    var g = cfg.grid, ags = cfg.agents, steps = [];
    var pathA = plan(g, ags[0].s, ags[0].g, new Set(), new Set()).path;
    var indepB = plan(g, ags[1].s, ags[1].g, new Set(), new Set()).path;
    var both = [pathA, indepB];

    pushStep(steps, {
      ph: 'independent', paths: [pathA], now: -1,
      ctr: { expanded: 0, waits: 0, deadEnd: 0 },
      msg: ags[0].id + ' 가 먼저 계획한다. ' + showPath(pathA) + ' — 복도를 직진해 t=' +
        (pathA.length - 1) + ' 에 도착하고 그 자리에 눌러앉는다.'
    });
    pushStep(steps, {
      ph: 'independent', paths: both, now: -1,
      ctr: { expanded: 0, waits: 0, deadEnd: 0 },
      msg: ags[1].id + ' 도 혼자면 ' + showPath(indepB) + ' 로 갈 수 있다. 비용 합 ' +
        totalCost(both) + '. 그러나 둘을 함께 두면 성립하지 않는다.'
    });

    var ents = reserveEntries(pathA);
    var byTime = [], i;
    for (i = 0; i < ents.length; i++) { if (ents[i].tail) continue; (byTime[ents[i].t] || (byTime[ents[i].t] = [])).push(i); }
    for (var t = 0; t < byTime.length; t++) {
      if (!byTime[t]) continue;
      var revealed = Math.max.apply(null, byTime[t]) + 1;
      pushStep(steps, {
        ph: 'reserve', paths: [pathA], now: t, resN: revealed,
        ctr: { expanded: 0, waits: 0, deadEnd: 0 },
        msg: '예약 t=' + t + ' — 복도 다섯 칸이 시각과 함께 대각선으로 찍힌다. ' +
          rc(at(pathA, t)) + '@' + t + '.'
      });
    }
    pushStep(steps, {
      ph: 'reserve', paths: [pathA], now: -1, resN: ents.length,
      ctr: { expanded: 0, waits: 0, deadEnd: 0 },
      msg: '도착 칸 ' + rc(pathA[pathA.length - 1]) + ' 를 t=' + pathA.length + '..' + HORIZON +
        ' 까지 예약했다. 이제 복도 오른쪽 끝은 영원히 임자가 있다.'
    });

    var vertex = new Set(), edge = new Set();
    applyEntries(ents, vertex, edge);
    var run = plan(g, ags[1].s, ags[1].g, vertex, edge);
    var dead = 0;
    for (i = 0; i < run.exp.length; i++) {
      var e = run.exp[i];
      if (!e.opened.length) dead++;
      pushStep(steps, {
        ph: 'blocked', paths: [pathA], now: e.t, resN: ents.length,
        srch: { who: 1, upto: i + 1, exp: run.exp },
        ctr: { expanded: i + 1, waits: 0, deadEnd: dead },
        msg: ags[1].id + ' 탐색 ' + i + '번째 확장: ' + rc(e.cell) + '@' + e.t + ' f=' + e.f + '. ' +
          (e.opened.length ? '새로 연 상태 ' + e.opened.map(function (o) { return rc(o[0]) + '@' + o[1]; }).join(' ') + '.'
            : '새로 열 수 있는 상태가 하나도 없다.') +
          (e.skipped.length ? ' 예약 때문에 버린 것 ' + e.skipped.map(function (o) { return rc(o[0]) + '@' + o[1]; }).join(' ') + '.' : '')
      });
    }
    pushStep(steps, {
      ph: 'blocked', paths: [pathA], now: -1, resN: ents.length, blocked: true,
      srch: { who: 1, upto: run.exp.length, exp: run.exp },
      ctr: { expanded: run.exp.length, waits: 0, deadEnd: dead },
      msg: '열린 목록이 비었다. ' + ags[1].id + ' 는 계획을 만들지 못한다 — 확장 ' + run.exp.length +
        '개 중 ' + dead + '개가 아무것도 열지 못했다. 우선순위 기반 계획은 여기서 끝난다.'
    });

    // 손으로 만든 동시 해를 겹쳐 보인다 — 해가 실재한다는 것이 V-9 의 동기다
    var joint = [
      [[1, 0], [1, 1], [0, 1], [0, 1], [1, 1], [1, 2], [1, 3], [1, 4]],
      [[1, 4], [1, 3], [1, 2], [1, 1], [1, 0]]
    ];
    var jp = [], ok = true;
    for (i = 0; i < joint.length && i < ags.length; i++) {
      var p = [];
      for (var k = 0; k < joint[i].length; k++) {
        if (!walkable(g, joint[i][k][0], joint[i][k][1])) { ok = false; break; }
        p.push(enc(joint[i][k][0], joint[i][k][1]));
      }
      jp.push(p);
    }
    // 손으로 적은 해가 이 격자에 맞지 않으면(저자가 grid 를 바꿨다면) 겹치지 않는다
    if (ok && jp.length === 2 && jp[0][0] === ags[0].s && jp[1][0] === ags[1].s) {
      var jc = firstConflict(jp);
      pushStep(steps, {
        ph: 'joint', paths: jp, now: -1, joint: true, resN: ents.length,
        ctr: { expanded: run.exp.length, waits: waitCount(jp), deadEnd: dead },
        msg: '그런데 해는 실재한다. 손으로 만든 동시 해 — ' + ags[0].id + ' 가 대피 공간 ' +
          rc(jp[0][2]) + ' 로 들어가 ' + ags[1].id + ' 를 보내고 나온다. 비용 합 ' + totalCost(jp) +
          ', 충돌 ' + (jc.kind === 'none' ? '없음' : jc.kind) + '.'
      });
      for (t = 0; t <= makespan(jp); t++) {
        pushStep(steps, {
          ph: 'joint', paths: jp, now: t, joint: true, resN: ents.length,
          ctr: { expanded: run.exp.length, waits: waitCount(jp), deadEnd: dead },
          msg: 't=' + t + ' — ' + ags.map(function (a, kk) { return a.id + ' ' + rc(at(jp[kk], t)); }).join(', ') +
            (t === 2 ? '. ' + ags[0].id + ' 가 대피 공간에 들어가 있다 — 먼저 계획한 쪽이 양보하는 해다.' : '.')
        });
      }
      pushStep(steps, {
        ph: 'joint', paths: jp, now: -1, joint: true, resN: ents.length,
        ctr: { expanded: run.exp.length, waits: waitCount(jp), deadEnd: dead },
        msg: '우선순위 기반 계획은 이 해에 원리적으로 닿을 수 없다. ' + ags[0].id +
          ' 의 경로를 고정한 순간 대피 공간에 들어가는 선택지가 사라졌기 때문이다. 순서를 바꿔도 대칭으로 같다.'
      });
    }
    return steps;
  }

  /* ③ CBS — 충돌을 제약으로 바꿔 되먹인다 (v-9 §2) */
  function buildCBS(cfg) {
    var g = cfg.grid, ags = cfg.agents, steps = [];
    var res = cbs(g, ags);
    if (!res.nodes.length) return steps;
    var created = 1, calls = ags.length;   // 뿌리에서 에이전트마다 한 번씩 부른다

    for (var s = 0; s < res.trace.length; s++) {
      var r = res.trace[s], nd = res.nodes[r.node];
      var consText = describeCons(nd, res.nodes, ags);
      pushStep(steps, {
        ph: s === 0 ? 'root' : 'replan', paths: nd.paths, now: -1,
        tree: { cur: r.node, created: created, expanded: s + 1, res: res },
        ctr: { ctNodes: created, lowLevelCalls: calls, sumOfCosts: nd.cost },
        msg: (s === 0
          ? '제약 없이 각자 계획한다. 이것이 뿌리 N0 다. '
          : '열린 목록에서 비용이 가장 작은 노드 N' + r.node + ' 를 꺼냈다. ') +
          '비용 합 ' + nd.cost + '. 제약: ' + consText + '.'
      });
      if (r.conflict.kind === 'none') {
        pushStep(steps, {
          ph: 'solution', paths: nd.paths, now: -1, solved: true,
          tree: { cur: r.node, created: created, expanded: s + 1, res: res },
          ctr: { ctNodes: created, lowLevelCalls: res.calls, sumOfCosts: nd.cost },
          msg: '충돌이 없다. 이것이 답이다 — 비용 합 ' + nd.cost + '. 열린 목록에 남은 노드는 전부 ' +
            nd.cost + ' 이상이고 그 서브트리의 해도 전부 그 이상이므로 **이 해가 최적이다.** ' +
            ags.map(function (a, k) { return a.id + ': ' + showPath(nd.paths[k]); }).join(' / ') + '.'
        });
        break;
      }
      var cf = r.conflict;
      pushStep(steps, {
        ph: 'conflict', paths: nd.paths, now: cf.t, cf: cf,
        tree: { cur: r.node, created: created, expanded: s + 1, res: res },
        ctr: { ctNodes: created, lowLevelCalls: calls, sumOfCosts: nd.cost },
        msg: '가장 이른 충돌 하나: ' + (cf.kind === 'vertex'
          ? ('정점 ' + rc(cf.a) + '@' + cf.t + ' — ' + ags[cf.i].id + ' 와 ' + ags[cf.j].id + ' 가 같은 칸에 있다.')
          : ('맞바꿈 ' + rc(cf.a) + '↔' + rc(cf.b) + '@' + cf.t + ' — 서로를 관통한다.')) +
          ' 없앨 방법은 논리적으로 둘뿐이다: ' + ags[cf.i].id + ' 가 비키거나 ' + ags[cf.j].id + ' 가 비키거나.'
      });
      created += r.children.length;
      calls += 2;                          // 자식 둘을 시도했으므로 하위 레벨을 두 번 불렀다
      var kids = r.children.map(function (c) { return 'N' + c + '(' + res.nodes[c].cost + ')'; }).join(' ');
      pushStep(steps, {
        ph: 'branch', paths: nd.paths, now: cf.t, cf: cf,
        tree: { cur: r.node, created: created, expanded: s + 1, res: res, kids: r.children },
        ctr: { ctNodes: created, lowLevelCalls: calls, sumOfCosts: nd.cost },
        msg: '자식 둘을 만든다: ' + kids + '. ' + r.children.map(function (c) {
          return ags[res.nodes[c].who].id + ' 에게 ' + res.nodes[c].tag + ' 금지';
        }).join(', ') + '. 제약이 붙은 에이전트 **한 명만** 다시 계획했고, 제약은 늘기만 하므로 비용은 절대 줄지 않는다.'
      });
    }
    return steps;
  }

  function describeCons(nd, nodes, ags) {
    var parts = [], cur = nd, guard = 40;
    while (cur && cur.parent >= 0 && guard-- > 0) {
      parts.unshift(ags[cur.who].id + ': ' + cur.tag + ' 금지');
      cur = nodes[cur.parent];
    }
    return parts.length ? parts.join(' / ') : '없음';
  }

  /* ④ 교착과 라이브락 (v-10 §2) */
  function buildDeadlock(cfg, scenario, policy) {
    return scenario === 'livelock'
      ? buildLivelock(cfg, policy)
      : buildGridlock(cfg, policy);
  }

  // 자원 할당 그래프를 만든다. 정점은 로봇 이름과 자원 칸 이름 두 종류다.
  function makeRag(ags, holds, waits) {
    var nodes = [], adj = {}, i;
    for (i = 0; i < ags.length; i++) { nodes.push(ags[i].id); adj[ags[i].id] = []; }
    for (i = 0; i < holds.length; i++) {
      if (holds[i] < 0) continue;
      var rn = rc(holds[i]);
      if (!adj[rn]) { nodes.push(rn); adj[rn] = []; }
      adj[rn].push(ags[i].id);                 // 자원 → 로봇 = 쥐고 있다
    }
    for (i = 0; i < waits.length; i++) {
      if (waits[i] < 0) continue;
      var wn = rc(waits[i]);
      if (!adj[wn]) { nodes.push(wn); adj[wn] = []; }
      adj[ags[i].id].push(wn);                 // 로봇 → 자원 = 기다린다
    }
    return { nodes: nodes, adj: adj, holds: holds.slice(), waits: waits.slice() };
  }

  function buildGridlock(cfg, policy) {
    var g = cfg.grid, ags = cfg.agents, steps = [], i;
    var n = ags.length;
    var center = ags.map(function (a) { return a.s; });      // 각자의 시작 칸이 곧 다툼의 대상이다
    var followers = ags.map(function (a) { return a.queue.length ? a.queue[0] : -1; });

    // 각 로봇이 원하는 다음 칸 = 자기 목표로 가는 최단경로의 두 번째 칸
    var blockedStatic = {};
    for (i = 0; i < n; i++) if (followers[i] >= 0) blockedStatic[followers[i]] = 1;
    var wants = [];
    for (i = 0; i < n; i++) {
      var rt = route(g, blockedStatic, ags[i].s, ags[i].g);
      wants.push(rt && rt.length > 1 ? rt[1] : -1);
    }

    // ── ① 진입
    for (i = 0; i < n; i++) {
      pushStep(steps, {
        ph: 'approach', tick: true, pos: center.slice(0, i + 1).concat(fillNeg(n - i - 1)),
        follow: followers.slice(0, i + 1).concat(fillNeg(n - i - 1)),
        rag: makeRag(ags.slice(0, i + 1), center.slice(0, i + 1), fillNeg(i + 1)),
        ctr: { cycleLength: 0, stepsWithoutProgress: 0, yields: 0 },
        msg: ags[i].id + ' 가 ' + (followers[i] >= 0 ? rc(followers[i]) + ' 방향에서 ' : '') +
          rc(center[i]) + ' 로 들어왔다. 뒤에 후속 차량이 붙어 있어 물러설 수 없다.'
      });
    }

    // ── ② 점유와 대기: 대기 간선이 하나씩 붙는다. 마지막 하나에서 고리가 완성된다
    var stall = 0;
    for (i = 0; i < n; i++) {
      var waits = fillNeg(n);
      for (var k = 0; k <= i; k++) waits[k] = wants[k];
      var rag = makeRag(ags, center, waits);
      var cyc = findCycle(rag.nodes, rag.adj).cycle;
      stall += 1;
      pushStep(steps, {
        ph: 'hold-and-wait', tick: true, pos: center, follow: followers, rag: rag,
        ctr: { cycleLength: Math.max(0, cyc.length - 1), stepsWithoutProgress: stall, yields: 0 },
        msg: ags[i].id + ' 가 ' + rc(center[i]) + ' 를 쥔 채 ' + rc(wants[i]) + ' 를 요청한다. 그 칸의 임자는 ' +
          ownerOf(ags, center, wants[i]) + ' 다. ' +
          (cyc.length ? '고리가 완성됐다 — 간선 하나가 추가되는 순간 교착이 완성된다.' : '아직 사이클은 없다.')
      });
    }

    // ── ③ 사이클: 3색 DFS 를 한 정점씩 따라간다
    var full = makeRag(ags, center, wants);
    var fc = findCycle(full.nodes, full.adj);
    for (i = 0; i < fc.events.length; i++) {
      var ev = fc.events[i];
      stall += 1;
      var found = ev.kind === 'cycle';
      pushStep(steps, {
        ph: 'cycle', pos: center, follow: followers,
        rag: full, dfs: { trail: ev.trail, color: ev.color, cycle: found ? ev.cycle : null },
        ctr: { cycleLength: found ? ev.cycle.length - 1 : 0, stepsWithoutProgress: stall, yields: 0 },
        msg: found
          ? ('회색 정점 ' + ev.w + ' 로 되돌아가는 간선을 만났다. 사이클: ' + ev.cycle.join(' → ') +
            '. 자원 인스턴스가 하나씩이므로 **사이클이 곧 교착이다.** 경로를 다시 짜도 풀리지 않는다.')
          : (ev.kind === 'enter'
            ? (ev.v + ' 를 회색으로 칠하고 들어간다. 재귀 경로: ' + ev.trail.join(' → ') + '.')
            : (ev.v + ' 를 검은색으로 칠하고 나온다 — 이 정점에서는 사이클이 없다.'))
      });
      if (found) break;
    }

    // ── ④ 해소: 정책을 켜고 진입부터 다시 재생한다
    var sim = simulate(g, ags, policy, center, followers);
    for (i = 0; i < sim.length; i++) {
      var st = sim[i];
      pushStep(steps, {
        ph: 'resolve', tick: true, pos: st.pos, follow: st.follow, rag: st.rag, policy: policy,
        ctr: { cycleLength: st.cycleLength, stepsWithoutProgress: st.stall, yields: st.yields },
        msg: st.msg
      });
    }
    return steps;
  }

  function fillNeg(n) { var a = []; while (a.length < n) a.push(-1); return a; }
  function ownerOf(ags, pos, cell) {
    for (var i = 0; i < pos.length; i++) if (pos[i] === cell) return ags[i].id;
    return '없음';
  }

  var POLICY_NAME = { priority: '우선순위', preempt: '선점', banker: '은행가' };

  /* 정책 시뮬레이터 — 세 정책이 코프만의 서로 다른 조건을 깬다.
   *   priority : 교차로 진입을 우선순위 순으로 직렬화한다(순환 대기를 깬다 = 예방)
   *   preempt  : 교착이 실제로 나게 두고 희생자를 후진시킨다(비선점을 깬다 = 검출·복구)
   *   banker   : 요청마다 안전 순열이 남는지 보고 없으면 거절한다(회피)
   * 진입 지점부터 다시 재생하므로 로봇은 자기 대기열 칸에서 출발한다. */
  function simulate(grid, ags, policy, center, followers) {
    var n = ags.length, i, k;
    var pos = [], done = [], spawned = [], home = [];
    for (i = 0; i < n; i++) {
      home.push(followers[i] >= 0 ? followers[i] : ags[i].s);
      pos.push(home[i]);
      done.push(false);
      spawned.push(false);
    }
    var isCenter = {};
    for (i = 0; i < center.length; i++) isCenter[center[i]] = 1;

    var out = [], stall = 0, yields = 0, denied = [];
    out.push({
      pos: pos.slice(), follow: fillNeg(n), rag: makeRag(ags, fillNeg(n), fillNeg(n)),
      stall: 0, yields: 0, cycleLength: 0,
      msg: POLICY_NAME[policy] + ' 정책을 켜고 진입부터 다시 재생한다. 네 대가 각자의 대기열 칸에서 출발한다.'
    });

    /* 진입 허가. 세 정책의 차이가 전부 이 함수 안에 있다. */
    function admit(pol, who, nxt, blockedStatic) {
      if (pol === 'priority') {
        // 앞 번호가 통과할 때까지 진입을 막는다 = 순환 대기를 구조적으로 못 만들게 한다
        for (var j = 0; j < who; j++) if (!done[j]) return false;
        return true;
      }
      if (pol === 'banker') {
        // 준 셈 치고 안전 순열이 남는지 본다. 없으면 가용 칸이 있어도 거절한다
        var hold = [], need = [], q, z;
        for (q = 0; q < n; q++) {
          var p = (q === who) ? nxt : pos[q];
          hold.push(isCenter[p] ? p : -1);
          var bl = {};
          for (var bb in blockedStatic) if (blockedStatic.hasOwnProperty(bb)) bl[bb] = 1;
          var r2 = route(grid, bl, p, ags[q].g) || [p];
          var nd = [];
          for (z = 1; z < r2.length; z++) if (isCenter[r2[z]]) nd.push(r2[z]);
          need.push(nd);
        }
        return safeSequence(center, hold, need).length > 0;
      }
      return true;                       // preempt: 막지 않는다. 교착이 실제로 나게 둔다
    }

    for (var step = 0; step < MAX_SIM; step++) {
      var allDone = true;
      for (i = 0; i < n; i++) if (!done[i]) allDone = false;
      if (allDone) break;

      var occupied = {}, blockedStatic = {};
      for (i = 0; i < n; i++) occupied[pos[i]] = i;
      for (i = 0; i < n; i++) if (spawned[i] && home[i] >= 0) blockedStatic[home[i]] = 1;

      var movedAny = false, moved = [], notes = [];
      for (i = 0; i < n; i++) moved.push(false);
      denied = [];

      for (var pass = 0; pass < n + 1; pass++) {
        for (k = 0; k < n; k++) {
          if (done[k] || moved[k]) continue;
          var blk = {};
          for (var b in blockedStatic) if (blockedStatic.hasOwnProperty(b)) blk[b] = 1;
          var rt = route(grid, blk, pos[k], ags[k].g);
          if (!rt || rt.length < 2) continue;
          var nxt = rt[1];
          if (occupied[nxt] !== undefined || blockedStatic[nxt]) continue;
          if (isCenter[nxt] && !admit(policy, k, nxt, blockedStatic)) { denied.push(k); continue; }
          delete occupied[pos[k]];
          if (!spawned[k] && pos[k] === home[k] && followers[k] >= 0) spawned[k] = true;
          pos[k] = nxt;
          occupied[nxt] = k;
          moved[k] = true;
          movedAny = true;
          if (spawned[k]) blockedStatic[home[k]] = 1;
          if (pos[k] === ags[k].g) { done[k] = true; notes.push(ags[k].id + ' 도착'); }
        }
      }

      var holdsNow = [], waitsNow = [];
      for (i = 0; i < n; i++) {
        holdsNow.push(isCenter[pos[i]] ? pos[i] : -1);
        if (done[i]) { waitsNow.push(-1); continue; }
        var bl2 = {};
        for (var b2 in blockedStatic) if (blockedStatic.hasOwnProperty(b2)) bl2[b2] = 1;
        var r3 = route(grid, bl2, pos[i], ags[i].g);
        var w = (r3 && r3.length > 1) ? r3[1] : -1;
        // "기다린다" 는 간선은 그 칸을 남이 쥐고 있을 때만 그린다
        var held = false;
        for (var q2 = 0; q2 < n; q2++) if (q2 !== i && pos[q2] === w) held = true;
        waitsNow.push(held ? w : -1);
      }
      var rag = makeRag(ags, holdsNow, waitsNow);
      var cyc = findCycle(rag.nodes, rag.adj).cycle;

      if (!movedAny) stall += 1;
      var msg;
      if (movedAny) {
        var mv = [];
        for (i = 0; i < n; i++) if (moved[i]) mv.push(ags[i].id + '→' + rc(pos[i]));
        msg = 't=' + (step + 1) + ' — ' + mv.join(', ') + '.' + (notes.length ? ' ' + notes.join(', ') + '.' : '');
        if (denied.length) {
          msg += ' ' + denied.map(function (x) { return ags[x].id; }).join(', ') +
            (policy === 'banker'
              ? ' 의 진입 요청은 가용 칸이 남아 있는데도 거절됐다 — 주면 안전 순열이 사라진다.'
              : ' 는 앞 번호가 통과할 때까지 진입할 수 없다.');
        }
      } else if (cyc.length && policy === 'preempt') {
        // 사이클 위에서 우선순위가 가장 낮은 로봇을 희생자로 골라 후진시킨다
        var victim = -1;
        for (i = 0; i < n; i++) if (cyc.indexOf(ags[i].id) >= 0) victim = i;
        if (victim >= 0) {
          pos[victim] = home[victim];
          spawned[victim] = false;               // 후속 차량까지 함께 물린다
          yields += 1;
          msg = 't=' + (step + 1) + ' — 아무도 못 움직인다. 사이클을 검출해 ' + ags[victim].id +
            ' 를 희생자로 골라 ' + rc(home[victim]) + ' 로 후진시켰다. **뒤의 후속 차량까지 함께 물린다** — 그것이 선점의 값이다.';
          holdsNow[victim] = -1; waitsNow[victim] = -1;
          rag = makeRag(ags, holdsNow, waitsNow);
          cyc = findCycle(rag.nodes, rag.adj).cycle;
        } else msg = 't=' + (step + 1) + ' — 아무도 못 움직인다.';
      } else {
        msg = 't=' + (step + 1) + ' — 아무도 못 움직인다. 진행 없는 스텝이 ' + stall + '이다.' +
          (cyc.length ? ' 사이클: ' + cyc.join(' → ') + '.' : ' 사이클은 없다.');
      }
      out.push({
        pos: pos.slice(),
        follow: pos.map(function (_, kk) { return spawned[kk] ? home[kk] : -1; }),
        rag: rag, stall: stall, yields: yields,
        cycleLength: Math.max(0, cyc.length - 1), msg: msg
      });
    }
    var last = out[out.length - 1];
    var allDone2 = true;
    for (i = 0; i < n; i++) if (!done[i]) allDone2 = false;
    last.msg += allDone2
      ? ' 전원 목표 도착. ' + POLICY_NAME[policy] + ' 정책이 고리를 만들지 않았다.'
      : ' 상한 ' + MAX_SIM + '스텝에서 멈췄다.';
    return out;
  }

  /* 라이브락 — 아무도 막혀 있지 않은데 진행이 없다. 그래프에 사이클이 없는 것이 요점이다. */
  function buildLivelock(cfg, policy) {
    var g = cfg.grid, steps = [];
    var ags = [], i;
    for (i = 0; i < LIVE.agents.length; i++) {
      var a = LIVE.agents[i];
      if (!walkable(g, a.start[0], a.start[1]) || !walkable(g, a.goal[0], a.goal[1]) ||
        !walkable(g, a.back[0], a.back[1]) || !walkable(g, LIVE.cross[0], LIVE.cross[1])) return null;
      ags.push({ id: a.id, s: enc(a.start[0], a.start[1]), g: enc(a.goal[0], a.goal[1]), queue: [], back: enc(a.back[0], a.back[1]) });
    }
    var cross = enc(LIVE.cross[0], LIVE.cross[1]);
    var home = [ags[0].s, ags[1].s];

    pushStep(steps, {
      ph: 'approach', tick: true, pos: home, follow: [-1, -1], live: true,
      rag: makeRag(ags, home, [-1, -1]),
      ctr: { cycleLength: 0, stepsWithoutProgress: 0, yields: 0 },
      msg: '라이브락 시나리오 — 둘 다 교차 칸 ' + rc(cross) + ' 하나를 지나야 한다. 규칙은 "상대도 요청 중이면 나도 물러난다" 이다.'
    });

    var CYCLES = 4, stall = 0, yields = 0;
    for (var c = 0; c < CYCLES; c++) {
      stall += 1; yields += 2;
      pushStep(steps, {
        ph: 'hold-and-wait', tick: true, pos: home, follow: [-1, -1], live: true, want: [cross, cross],
        rag: makeRag(ags, home, [-1, -1]),      // 기다리지 않고 물러나므로 대기 간선이 없다
        ctr: { cycleLength: 0, stepsWithoutProgress: stall, yields: yields },
        msg: '둘 다 ' + rc(cross) + ' 를 요청한다. 대칭 규칙이라 **둘 다 물러난다.** 누적 양보 ' + yields +
          '. 자원 할당 그래프에는 사이클이 없다 — 아무도 기다리는 상태가 아니기 때문이다.'
      });
      stall += 1;
      var backPos = [ags[0].back, ags[1].back];
      pushStep(steps, {
        ph: 'cycle', tick: true, pos: backPos, follow: [-1, -1], live: true,
        rag: makeRag(ags, backPos, [-1, -1]),
        ctr: { cycleLength: 0, stepsWithoutProgress: stall, yields: yields },
        msg: '둘 다 물러났다. ' + ags[0].id + ' ' + rc(backPos[0]) + ', ' + ags[1].id + ' ' + rc(backPos[1]) +
          '. 상태는 계속 바뀌고 로그도 쌓인다 — 시스템 지표로 보면 활발하다. 그런데 진행은 0이다.'
      });
    }
    pushStep(steps, {
      ph: 'cycle', pos: home, follow: [-1, -1], live: true,
      rag: makeRag(ags, home, [-1, -1]),
      ctr: { cycleLength: 0, stepsWithoutProgress: stall + 1, yields: yields },
      note: CYCLES + '주기에서 표시를 멈춘다 — 실제로는 무한히 반복된다',
      msg: '다시 마주친다. 이것이 ' + CYCLES + '주기째다. 교착 검출기는 이것을 **영원히 못 잡는다** — 사이클을 찾는 검출기인데 사이클이 없다. 진행 척도를 따로 봐야 한다.'
    });

    // 대칭을 깬다 — 번호가 작은 쪽이 우선. 한 줄이 종료성을 만든다
    var simPos = [home[0], home[1]], simStall = stall + 1, simYield = yields;
    var seq = [
      { pos: [cross, home[1]], y: 1, m: ags[0].id + ' 이 진입한다. ' + ags[1].id + ' 는 양보하고 **기다린다** — 이제 대기 간선이 생기고, 그 기다림은 곧 풀린다.' },
      { pos: [ags[0].g, cross], y: 1, m: ags[0].id + ' 이 목표 ' + rc(ags[0].g) + ' 에 도착했다. 교차 칸이 비었고 ' + ags[1].id + ' 가 들어간다.' },
      { pos: [ags[0].g, ags[1].g], y: 1, m: ags[1].id + ' 도 목표 ' + rc(ags[1].g) + ' 에 도착했다. 통과 2대. 규칙에서 바꾼 것은 "동점일 때 누가 이기는가" 한 줄뿐이고 그 한 줄이 종료성을 만든다.' }
    ];
    for (i = 0; i < seq.length; i++) {
      var w2 = (i === 0) ? [-1, cross] : [-1, -1];
      pushStep(steps, {
        ph: 'resolve', tick: true, pos: seq[i].pos, follow: [-1, -1], live: true, policy: 'priority',
        rag: makeRag(ags, seq[i].pos, w2),
        ctr: { cycleLength: 0, stepsWithoutProgress: simStall, yields: simYield + 1 },
        msg: '비대칭 규칙(우선순위) — ' + seq[i].m
      });
    }
    return steps;
  }

  // ─── 그리기 ──────────────────────────────────────────────────────────────

  var PAD = 6, GAP = 14, CHIP_H = 26, CTR_H = 46;

  /* 에이전트 색. 새 색을 만들지 않고 토큰에서만 고른다(계약 §3).
   * --w-path 는 "확정" 전용이라 여기 쓰지 않고 최종 해 강조에만 남겨 둔다.
   * 색을 구분하지 못해도 되도록 **모든 개체에 이름 글자를 함께 찍는다**(계약 §5). */
  function agentColor(T, i) {
    return [T.wStart, T.wGoal, T.accent, T.boxWarn, T.wVisited, T.fgDim][i % 6];
  }

  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }
  function center(ctx, text, x, y, maxW) {
    var t = maxW ? fit(ctx, text, maxW) : text;
    ctx.fillText(t, x - ctx.measureText(t).width / 2, y);
  }
  function box(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function arrow(ctx, x1, y1, x2, y2, head) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    var a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
    ctx.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  }
  function panelHead(ctx, T, x, y, w, title, note) {
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = T.fgDim;
    ctx.fillText(fit(ctx, title, w), x, y + 10);
    if (note) {
      ctx.font = '10px ' + FONT;
      ctx.fillStyle = T.fgFaint;
      var tw = ctx.measureText(note).width;
      if (tw < w - 90) ctx.fillText(note, x + w - tw, y + 10);
    }
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('multi-agv-conflict', function (host, opts) {
    if (!opts || typeof opts !== 'object') opts = {};

    // ---- opts 검증 ----
    var mode = oneOf(opts.mode, MODES, 'prioritized');
    var scenName = oneOf(opts.scenario, ['cross-intersection', 'corridor-alcove', 'gridlock-2x2'],
      mode === 'deadlock' ? 'gridlock-2x2' : (mode === 'cbs' ? 'corridor-alcove' : 'cross-intersection'));
    var preset = SCEN[scenName];

    var grid = readGrid(opts.grid, preset.grid);
    var agents = readAgents(opts.agents, grid, toAgents(preset.agents, grid));
    if (mode !== 'deadlock' && agents.length > 2) agents = agents.slice(0, 2);   // 두 대까지가 이 계보의 예제다
    if (agents.length < 2) agents = toAgents(preset.agents, preset.grid), grid = preset.grid;

    var cfg = { grid: grid, agents: agents };

    var show = [];
    if (isArr(opts.show)) {
      for (var si = 0; si < opts.show.length; si++)
        if (PANELS.indexOf(opts.show[si]) >= 0 && show.indexOf(opts.show[si]) < 0) show.push(opts.show[si]);
    }
    if (!show.length) {
      show = mode === 'cbs' ? ['grid', 'timeline', 'constraint-tree']
        : mode === 'deadlock' ? ['grid', 'resource-allocation-graph', 'timeline']
          : ['grid', 'timeline', 'reservation-table'];
    }
    var sidePanel = null;
    for (var pi = 0; pi < show.length; pi++)
      if (show[pi] !== 'grid' && show[pi] !== 'timeline') { sidePanel = show[pi]; break; }
    var showGrid = show.indexOf('grid') >= 0;
    var showTimeline = show.indexOf('timeline') >= 0;

    var outcome = oneOf(opts.outcome, ['failure', 'success'], 'success');
    var wantSwap = isArr(opts.highlight) && opts.highlight.indexOf('swap-conflict') >= 0;
    var wantCompare = isArr(opts.compare) && opts.compare.length >= 2;

    var counters = [];
    if (isArr(opts.counters)) {
      for (var ci = 0; ci < opts.counters.length; ci++)
        if (COUNTER_LABEL[opts.counters[ci]] && counters.indexOf(opts.counters[ci]) < 0) counters.push(opts.counters[ci]);
    }
    if (!counters.length) {
      counters = mode === 'cbs' ? ['ctNodes', 'lowLevelCalls', 'sumOfCosts']
        : mode === 'deadlock' ? ['cycleLength', 'stepsWithoutProgress', 'yields']
          : ['expanded', 'waits', 'makespan', 'sumOfCosts'];
    }

    var scenarios = [];
    if (isArr(opts.scenarios)) {
      for (var xi = 0; xi < opts.scenarios.length; xi++)
        if (['deadlock', 'livelock'].indexOf(opts.scenarios[xi]) >= 0) scenarios.push(opts.scenarios[xi]);
    }
    var policies = ['priority'];
    if (opts.resolve && typeof opts.resolve === 'object') {
      var pol = oneOf(opts.resolve.policy, ['priority', 'preempt', 'banker'], 'priority');
      policies = [pol];
      if (isArr(opts.resolve.alternatives)) {
        for (var ri = 0; ri < opts.resolve.alternatives.length; ri++) {
          var alt = oneOf(opts.resolve.alternatives[ri], ['priority', 'preempt', 'banker'], null);
          if (alt && policies.indexOf(alt) < 0) policies.push(alt);
        }
      }
    }

    // ---- 상태 ----
    var scenario = scenarios.length ? scenarios[0] : 'deadlock';
    var policy = policies[0];
    var steps = [], cur = 0, layout = null, MX = null;
    var resEnts = [], compareInfo = null;

    function rebuild2() {
      steps = [];
      if (mode === 'cbs') {
        steps = buildCBS(cfg);
        if (wantCompare) {
          var pr = prioritized(cfg.grid, cfg.agents, true);
          var cb = cbs(cfg.grid, cfg.agents);
          compareInfo = {
            left: { name: '우선순위 기반', ok: pr.failed < 0, text: pr.failed < 0 ? ('비용 합 ' + totalCost(pr.paths)) : (cfg.agents[pr.failed].id + ' 계획 불가 — 실패') },
            right: { name: 'CBS', ok: !!cb.paths, text: cb.paths ? ('비용 합 ' + totalCost(cb.paths) + ' · CT 노드 ' + cb.expanded + ' · 하위 호출 ' + cb.calls) : '해 없음' }
          };
        }
      } else if (mode === 'deadlock') {
        steps = buildDeadlock(cfg, scenario, policy) || [];
      } else if (outcome === 'failure') {
        steps = buildFailure(cfg);
      } else {
        steps = buildPrioritized(cfg);
        if (wantSwap) steps = steps.concat(buildSwapDemo());
      }
      if (!steps.length) {
        steps = [{ ph: 'independent', paths: [], now: -1, ctr: {}, msg: '이 opts 로는 보여줄 것이 없다.' }];
      }
      // 예약 테이블의 행 목록은 스텝 전체에서 고정이어야 표가 흔들리지 않는다
      resEnts = [];
      if (mode !== 'deadlock' && cfg.agents.length) {
        var p0 = plan(cfg.grid, cfg.agents[0].s, cfg.agents[0].g, new Set(), new Set()).path;
        if (p0) resEnts = reserveEntries(p0);
      }
      MX = maxima();
      layout = null;
    }
    rebuild2();

    function phaseList() {
      var seen = [], out = [];
      for (var i = 0; i < steps.length; i++)
        if (steps[i].ph && seen.indexOf(steps[i].ph) < 0) { seen.push(steps[i].ph); out.push(steps[i].ph); }
      return out;
    }

    // ---- 껍데기 ----
    var TITLE = {
      prioritized: outcome === 'failure' ? '우선순위 기반 계획은 불완전하다' : '예약 테이블 — (칸, 시각)을 장부에 적는다',
      cbs: 'CBS — 충돌을 제약으로 바꿔 되먹인다',
      deadlock: '교착과 라이브락 — 자원 할당 그래프'
    };
    var ui = K.frame(host, { title: TITLE[mode], wide: true });

    if (scenarios.length > 1) {
      K.seg(ui.slot, scenarios.map(function (s) {
        return { label: s === 'livelock' ? '라이브락' : '교착', value: s };
      }), scenario, function (v) { scenario = v; rebuild2(); player.goto(0); });
    }
    if (mode === 'deadlock' && policies.length > 1) {
      K.seg(ui.slot, policies.map(function (p) {
        return { label: POLICY_NAME[p], value: p };
      }), policy, function (v) { policy = v; rebuild2(); player.goto(cur); });
    }

    var legend = K.el('div', 'wk-legend');
    (function () {
      for (var i = 0; i < cfg.agents.length; i++) {
        var s = K.el('span'), ic = K.el('i');
        ic.style.background = ['var(--w-start)', 'var(--w-goal)', 'var(--accent)', 'var(--box-warn)', 'var(--w-visited)', 'var(--fg-dim)'][i % 6];
        s.appendChild(ic);
        s.appendChild(document.createTextNode(cfg.agents[i].id + ' (칸 안의 글자로도 구분된다)'));
        legend.appendChild(s);
      }
      var texts = mode === 'deadlock'
        ? ['· ◻ 목표', '· ▨ 후속 차량 — 물러설 수 없다', '· 자원 할당 그래프: 자원→로봇 = 보유, 로봇→자원 = 대기', '· 붉은 굵은 선 = 사이클']
        : ['· ◻ 목표', '· ▨ 벽', '· 타임라인의 = 는 대기, ✕ 는 충돌', '· 예약표의 채운 칸 = (칸, 시각) 예약, ↔ = 이동(간선) 예약'];
      for (var k = 0; k < texts.length; k++) legend.appendChild(K.el('span', null, texts[k]));
    })();
    ui.root.insertBefore(legend, ui.ctl);

    // ---- 배치 ----
    function maxima() {
      var m = { tmax: 0, resRows: 0, ticks: 1 };
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (s.paths) for (var k = 0; k < s.paths.length; k++) m.tmax = Math.max(m.tmax, s.paths[k].length - 1);
        if (s.tick) m.ticks += 1;
      }
      m.tmax = Math.max(m.tmax, 4);
      var seen = {};
      for (i = 0; i < resEnts.length; i++) {
        if (resEnts[i].kind !== 'v') continue;
        if (!seen[resEnts[i].cell]) { seen[resEnts[i].cell] = 1; m.resRows++; }
      }
      return m;
    }

    function computeLayout(w) {
      var rows = cfg.grid.length, cols = cfg.grid[0].length;
      var wide = w >= 980 && sidePanel;
      var sideW = wide ? Math.max(300, Math.round(w * 0.44)) : w;
      var gridW = wide ? (w - sideW - GAP) : w;
      if (!sidePanel) gridW = w;

      var gridBudget = wide ? 268 : 236;
      var cell = Math.floor(Math.min((gridW - PAD * 2) / cols, gridBudget / rows, 46));
      if (cell < 13) cell = 13;
      var gridH = showGrid ? (18 + cell * rows + 8) : 0;

      var sideH = 0, treeInfo = null;
      if (sidePanel === 'reservation-table') {
        var rowH = 18;
        sideH = 18 + Math.max(1, MX.resRows) * rowH + 26;
      } else if (sidePanel === 'constraint-tree') {
        sideH = 18 + 4 * 54 + 46;
      } else if (sidePanel === 'resource-allocation-graph') {
        var dia = Math.min(sideW - 24, wide ? 236 : 230);
        sideH = 18 + dia + 30;
      }

      var mainH = wide ? Math.max(gridH, sideH) : (gridH + (sidePanel ? GAP + sideH : 0));
      var tlRowH = 24;
      var tlH = showTimeline ? (18 + cfg.agents.length * tlRowH + 20) : 0;
      var cmpH = compareInfo ? 40 : 0;
      var noteH = 18;

      return {
        w: w, wide: wide, cell: cell, cols: cols, rows: rows,
        gridW: gridW, sideW: sideW, gridH: gridH, sideH: sideH, mainH: mainH,
        tlH: tlH, tlRowH: tlRowH, cmpH: cmpH,
        yChips: 0, yCtr: CHIP_H, yMain: CHIP_H + CTR_H,
        yTl: CHIP_H + CTR_H + mainH + (tlH ? GAP : 0),
        yCmp: CHIP_H + CTR_H + mainH + (tlH ? GAP + tlH : 0) + (cmpH ? 8 : 0),
        height: CHIP_H + CTR_H + mainH + (tlH ? GAP + tlH : 0) + (cmpH ? 8 + cmpH : 0) + noteH + 4
      };
    }
    function layoutFor(w) {
      if (!layout || layout.w !== w) layout = computeLayout(w);
      return layout;
    }

    // ---- 각 패널 ----

    function drawChips(ctx, T, L, step) {
      var list = phaseList(), x = 0;
      ctx.font = '700 10.5px ' + FONT;
      for (var i = 0; i < list.length; i++) {
        var lab = PHASE_LABEL[list[i]] || list[i];
        var w = ctx.measureText(lab).width + 16;
        if (x + w > L.w) break;
        var on = list[i] === step.ph;
        ctx.globalAlpha = 1;
        box(ctx, x, 2, w, 18, 9);
        ctx.fillStyle = on ? T.accent : T.bgCode;
        ctx.fill();
        ctx.fillStyle = on ? T.bg : T.fgFaint;
        ctx.fillText(lab, x + 8, 15);
        x += w + 6;
      }
    }

    function drawCounters(ctx, T, L, step) {
      var c = step.ctr || {};
      var n = counters.length;
      var bw = Math.min(168, Math.floor((L.w - (n - 1) * 8) / n));
      for (var i = 0; i < n; i++) {
        var x = i * (bw + 8), y = L.yCtr + 2;
        box(ctx, x, y, bw, CTR_H - 8, 6);
        ctx.fillStyle = T.bgCode;
        ctx.fill();
        ctx.font = '10px ' + FONT;
        ctx.fillStyle = T.fgFaint;
        ctx.fillText(fit(ctx, COUNTER_LABEL[counters[i]], bw - 12), x + 7, y + 13);
        ctx.font = '700 16px ' + MONO;
        var v = c[counters[i]];
        ctx.fillStyle = (counters[i] === 'stepsWithoutProgress' || counters[i] === 'cycleLength') && v > 0 ? T.boxDanger : T.fg;
        ctx.fillText(v === undefined ? '–' : String(v), x + 7, y + 31);
      }
    }

    function sceneOf(step) { return step.alt || cfg; }

    // 이 스텝에서 각 에이전트가 어디에 있는가
    function positions(step) {
      if (step.pos) return step.pos;
      var out = [], sc = sceneOf(step);
      for (var i = 0; i < sc.agents.length; i++) {
        var p = step.paths && step.paths[i];
        if (!p) { out.push(-1); continue; }
        out.push(step.now >= 0 ? at(p, step.now) : p[p.length - 1]);
      }
      return out;
    }

    function drawGridPanel(ctx, T, L, step, x0, y0) {
      var sc = sceneOf(step);
      var g = sc.grid, ags = sc.agents;
      var rows = g.length, cols = g[0].length;
      var cell = Math.floor(Math.min((L.gridW - PAD * 2) / cols, (L.gridH - 26) / rows, 46));
      if (cell < 13) cell = 13;
      var gx = x0 + Math.floor((L.gridW - cell * cols) / 2), gy = y0 + 18;

      panelHead(ctx, T, x0 + PAD, y0, L.gridW - PAD * 2, '격자',
        step.now >= 0 ? 't = ' + step.now : (step.blocked ? '해 없음' : ''));

      var r, c, i;
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
        var x = gx + c * cell, y = gy + r * cell;
        ctx.globalAlpha = 1;
        if (!walkable(g, r, c)) {
          ctx.fillStyle = T.wWall;
          ctx.fillRect(x, y, cell, cell);
          // 색을 구분하지 못해도 벽임이 읽히도록 빗금을 긋는다
          ctx.globalAlpha = 0.45;
          ctx.strokeStyle = T.fgFaint;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y);
          ctx.moveTo(x + cell * 0.5, y + cell); ctx.lineTo(x + cell, y + cell * 0.5);
          ctx.moveTo(x, y + cell * 0.5); ctx.lineTo(x + cell * 0.5, y);
          ctx.stroke();
        } else {
          ctx.fillStyle = T.bgElev;
          ctx.fillRect(x, y, cell, cell);
        }
      }
      ctx.globalAlpha = 1;

      // 이 시각에 예약된 칸 — 시간에 따라 열리고 닫히는 장애물임을 격자 위에서 보인다
      if (step.resN && step.now >= 0) {
        ctx.globalAlpha = 0.9;
        for (i = 0; i < step.resN && i < resEnts.length; i++) {
          var e = resEnts[i];
          if (e.kind !== 'v' || e.t !== step.now) continue;
          var rx = gx + colOf(e.cell) * cell, ry = gy + rowOf(e.cell) * cell;
          ctx.strokeStyle = T.boxWarn;
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(rx + 2.5, ry + 2.5, cell - 5, cell - 5);
          ctx.setLineDash([]);
        }
      }

      // 탐색 흔적 — (칸, 시각) 상태를 격자에 눌러 그린다. 같은 칸이 여러 시각에 확장된다
      if (step.srch && step.srch.exp) {
        var exp = step.srch.exp, upto = step.srch.upto;
        var cnt = {};
        for (i = 0; i < upto && i < exp.length; i++) cnt[exp[i].cell] = (cnt[exp[i].cell] || 0) + 1;
        for (var key in cnt) {
          if (!cnt.hasOwnProperty(key)) continue;
          var cl = parseInt(key, 10);
          var sx = gx + colOf(cl) * cell, sy = gy + rowOf(cl) * cell;
          ctx.globalAlpha = 0.20 + 0.12 * Math.min(3, cnt[key]);
          ctx.fillStyle = agentColor(T, step.srch.who);
          ctx.fillRect(sx, sy, cell, cell);
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = T.fgDim;
          ctx.font = '9px ' + MONO;
          ctx.fillText(String(cnt[key]), sx + 3, sy + 11);
        }
        var last = exp[Math.min(upto, exp.length) - 1];
        if (last) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.accent;
          ctx.lineWidth = 2;
          ctx.strokeRect(gx + colOf(last.cell) * cell + 1, gy + rowOf(last.cell) * cell + 1, cell - 2, cell - 2);
        }
      }
      ctx.globalAlpha = 1;

      // 목표
      for (i = 0; i < ags.length; i++) {
        var gxx = gx + colOf(ags[i].g) * cell, gyy = gy + rowOf(ags[i].g) * cell;
        ctx.strokeStyle = agentColor(T, i);
        ctx.lineWidth = 2;
        ctx.strokeRect(gxx + 3.5, gyy + 3.5, cell - 7, cell - 7);
        ctx.font = '700 ' + Math.round(cell * 0.30) + 'px ' + FONT;
        ctx.fillStyle = agentColor(T, i);
        center(ctx, ags[i].id, gxx + cell / 2, gyy + cell * 0.66);
      }

      // 경로 자취 (시간 커서가 없을 때)
      if (step.paths && step.now < 0) {
        for (i = 0; i < step.paths.length; i++) {
          var p = step.paths[i];
          if (!p) continue;
          ctx.globalAlpha = step.joint || step.solved ? 0.55 : 0.35;
          ctx.strokeStyle = step.joint || step.solved ? T.wPath : agentColor(T, i);
          ctx.lineWidth = Math.max(2, cell * 0.12);
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (var t = 0; t < p.length; t++) {
            var px = gx + colOf(p[t]) * cell + cell / 2 + (i - (step.paths.length - 1) / 2) * cell * 0.13;
            var py = gy + rowOf(p[t]) * cell + cell / 2 + (i - (step.paths.length - 1) / 2) * cell * 0.13;
            if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // 후속 차량 — 물러설 수 없다는 것이 교착의 전제다
      if (step.follow) {
        for (i = 0; i < step.follow.length; i++) {
          if (step.follow[i] < 0) continue;
          var fx = gx + colOf(step.follow[i]) * cell, fy = gy + rowOf(step.follow[i]) * cell;
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = agentColor(T, i);
          ctx.fillRect(fx + cell * 0.2, fy + cell * 0.2, cell * 0.6, cell * 0.6);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.fgFaint;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(fx + cell * 0.2, fy + cell * 0.8); ctx.lineTo(fx + cell * 0.8, fy + cell * 0.2);
          ctx.stroke();
        }
      }

      // 에이전트
      var pos = positions(step);
      for (i = 0; i < pos.length && i < ags.length; i++) {
        if (pos[i] < 0) continue;
        var ax = gx + colOf(pos[i]) * cell, ay = gy + rowOf(pos[i]) * cell;
        ctx.globalAlpha = step.blocked && i === 1 ? 0.35 : 1;
        box(ctx, ax + 2, ay + 2, cell - 4, cell - 4, 4);
        ctx.fillStyle = agentColor(T, i);
        ctx.fill();
        ctx.fillStyle = T.bg;
        ctx.font = '700 ' + Math.round(cell * (ags[i].id.length > 1 ? 0.34 : 0.46)) + 'px ' + FONT;
        center(ctx, ags[i].id, ax + cell / 2, ay + cell * 0.64, cell - 4);
        // 대기 중이면 = 를 함께 찍는다(색 없이도 읽힌다)
        if (step.now > 0 && step.paths && step.paths[i] && at(step.paths[i], step.now) === at(step.paths[i], step.now - 1)) {
          ctx.font = '700 ' + Math.round(cell * 0.26) + 'px ' + MONO;
          center(ctx, '=', ax + cell / 2, ay + cell * 0.92);
        }
      }
      ctx.globalAlpha = 1;

      // 요청 화살표 (교착 모드)
      if (step.rag && step.rag.waits) {
        for (i = 0; i < step.rag.waits.length; i++) {
          if (step.rag.waits[i] < 0 || pos[i] < 0) continue;
          ctx.strokeStyle = T.boxDanger;
          ctx.fillStyle = T.boxDanger;
          ctx.lineWidth = 2;
          var x1 = gx + colOf(pos[i]) * cell + cell / 2, y1 = gy + rowOf(pos[i]) * cell + cell / 2;
          var x2 = gx + colOf(step.rag.waits[i]) * cell + cell / 2, y2 = gy + rowOf(step.rag.waits[i]) * cell + cell / 2;
          var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
          arrow(ctx, x1 + dx / len * cell * 0.3, y1 + dy / len * cell * 0.3,
            x2 - dx / len * cell * 0.34, y2 - dy / len * cell * 0.34, 6);
        }
      }
      if (step.want) {
        for (i = 0; i < step.want.length; i++) {
          if (step.want[i] < 0 || pos[i] < 0) continue;
          ctx.strokeStyle = T.boxWarn;
          ctx.fillStyle = T.boxWarn;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          var wx1 = gx + colOf(pos[i]) * cell + cell / 2, wy1 = gy + rowOf(pos[i]) * cell + cell / 2;
          var wx2 = gx + colOf(step.want[i]) * cell + cell / 2, wy2 = gy + rowOf(step.want[i]) * cell + cell / 2;
          var wdx = wx2 - wx1, wdy = wy2 - wy1, wl = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
          arrow(ctx, wx1 + wdx / wl * cell * 0.3, wy1 + wdy / wl * cell * 0.3,
            wx2 - wdx / wl * cell * 0.34, wy2 - wdy / wl * cell * 0.34, 6);
          ctx.setLineDash([]);
        }
      }

      // 충돌
      if (step.cf) {
        var cells = step.cf.kind === 'vertex' ? [step.cf.a] : [step.cf.a, step.cf.b];
        for (i = 0; i < cells.length; i++) {
          var cx = gx + colOf(cells[i]) * cell, cy = gy + rowOf(cells[i]) * cell;
          ctx.strokeStyle = T.boxDanger;
          ctx.lineWidth = 3;
          ctx.strokeRect(cx + 1.5, cy + 1.5, cell - 3, cell - 3);
          ctx.beginPath();
          ctx.moveTo(cx + 5, cy + 5); ctx.lineTo(cx + cell - 5, cy + cell - 5);
          ctx.moveTo(cx + cell - 5, cy + 5); ctx.lineTo(cx + 5, cy + cell - 5);
          ctx.stroke();
        }
      }

      // 격자선
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 0; i <= cols; i++) { ctx.moveTo(gx + i * cell + 0.5, gy); ctx.lineTo(gx + i * cell + 0.5, gy + rows * cell); }
      for (i = 0; i <= rows; i++) { ctx.moveTo(gx, gy + i * cell + 0.5); ctx.lineTo(gx + cols * cell, gy + i * cell + 0.5); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* 타임라인 — 이 세 챕터의 상태는 (칸, 시각)이다. 시간을 재생 인덱스에 숨기지 않고
     * 가로축으로 펼쳐야 "t=2 에 둘 다 가운데 있다"가 그림이 된다. */
    function drawTimeline(ctx, T, L, step, y0) {
      var sc = sceneOf(step), ags = sc.agents;
      var labW = 34;
      if (mode === 'deadlock') return drawProgress(ctx, T, L, step, y0, labW);

      var tmax = MX.tmax;
      var colW = Math.max(9, Math.min(36, Math.floor((L.w - labW - 4) / (tmax + 1))));
      var shown = Math.min(tmax, Math.floor((L.w - labW - 4) / colW) - 1);
      panelHead(ctx, T, 0, y0, L.w, '타임라인 — 가로축이 시각 t',
        shown < tmax ? ('t≤' + shown + '만 표시') : '');

      var top = y0 + 18, i, t;
      // 시각 눈금
      ctx.font = '9px ' + MONO;
      ctx.fillStyle = T.fgFaint;
      for (t = 0; t <= shown; t++) center(ctx, String(t), labW + t * colW + colW / 2, top + 9);

      for (i = 0; i < ags.length; i++) {
        var ry = top + 12 + i * L.tlRowH;
        ctx.font = '700 11px ' + FONT;
        ctx.fillStyle = agentColor(T, i);
        ctx.fillText(fit(ctx, ags[i].id, labW - 4), 0, ry + 14);
        var p = step.paths && step.paths[i];
        for (t = 0; t <= shown; t++) {
          var x = labW + t * colW;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.border;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, ry + 0.5, colW - 1, L.tlRowH - 5);
          if (!p) continue;
          if (t >= p.length) {                       // 도착 뒤에도 그 칸에 서 있다
            ctx.globalAlpha = 0.22;
            ctx.fillStyle = agentColor(T, i);
            ctx.fillRect(x + 1, ry + 1, colW - 2, L.tlRowH - 6);
            continue;
          }
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = agentColor(T, i);
          ctx.fillRect(x + 1, ry + 1, colW - 2, L.tlRowH - 6);
          ctx.globalAlpha = 1;
          ctx.fillStyle = T.bg;
          if (colW >= 30) {
            ctx.font = '9px ' + MONO;
            center(ctx, rowOf(p[t]) + ',' + colOf(p[t]), x + colW / 2, ry + 13, colW - 2);
          }
          if (t > 0 && p[t] === p[t - 1]) {           // 대기 — 색 없이도 읽히는 글자
            ctx.font = '700 ' + (colW >= 30 ? 10 : 11) + 'px ' + MONO;
            center(ctx, '=', x + colW / 2, ry + (colW >= 30 ? 22 : 15));
          }
        }
      }
      ctx.globalAlpha = 1;

      // 충돌 열
      if (step.cf && step.cf.t <= shown) {
        var cxx = labW + step.cf.t * colW;
        ctx.strokeStyle = T.boxDanger;
        ctx.lineWidth = 2;
        ctx.strokeRect(cxx - 1, top + 11, colW * (step.cf.kind === 'swap' ? 2 : 1) + 2, ags.length * L.tlRowH + 2);
        ctx.fillStyle = T.boxDanger;
        ctx.font = '700 11px ' + FONT;
        center(ctx, '✕', cxx + colW / 2, top + 10);
      }
      // 시간 커서
      if (step.now >= 0 && step.now <= shown) {
        ctx.strokeStyle = T.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(labW + step.now * colW + colW / 2, top + 11);
        ctx.lineTo(labW + step.now * colW + colW / 2, top + 12 + ags.length * L.tlRowH);
        ctx.stroke();
      }
    }

    /* 교착 모드의 타임라인은 **진행 척도**다. §2.5 가 "라이브락은 진행 척도로만 잡힌다"고
     * 말하는 그 지표를 그대로 그린다 — 채운 칸은 그 스텝에 움직인 로봇이다. */
    function drawProgress(ctx, T, L, step, y0, labW) {
      var ags = cfg.agents, ticks = [], i, k;
      for (i = 0; i <= cur && i < steps.length; i++) if (steps[i].tick && steps[i].pos) ticks.push(steps[i].pos);
      var colW = Math.max(8, Math.min(26, Math.floor((L.w - labW - 4) / Math.max(1, MX.ticks))));
      var shown = Math.min(ticks.length, Math.max(1, Math.floor((L.w - labW - 4) / colW)));
      var from = ticks.length - shown;
      panelHead(ctx, T, 0, y0, L.w, '진행 척도 — 이 스텝에 실제로 움직였는가',
        from > 0 ? ('최근 ' + shown + '스텝만 표시') : '');
      var top = y0 + 20;
      for (i = 0; i < ags.length; i++) {
        var ry = top + i * L.tlRowH;
        ctx.font = '700 11px ' + FONT;
        ctx.fillStyle = agentColor(T, i);
        ctx.fillText(fit(ctx, ags[i].id, labW - 4), 0, ry + 14);
        for (k = 0; k < shown; k++) {
          var idx = from + k;
          var moved = idx > 0 && ticks[idx][i] !== ticks[idx - 1][i];
          var x = labW + k * colW;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.border;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, ry + 0.5, colW - 2, L.tlRowH - 6);
          if (moved) {
            ctx.fillStyle = agentColor(T, i);
            ctx.fillRect(x + 1, ry + 1, colW - 3, L.tlRowH - 7);
          } else if (idx > 0) {
            ctx.fillStyle = T.boxDanger;
            ctx.globalAlpha = 0.9;
            ctx.font = '700 10px ' + MONO;
            center(ctx, '·', x + colW / 2 - 0.5, ry + 14);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    /* 예약 테이블 — V-8 이 가르치려는 자료구조 그 자체다. 격자 색으로 녹여 넣으면
     * 결과만 보이고 표가 안 보인다. 그래서 표를 표로 그린다. */
    function drawReservation(ctx, T, L, step, x0, y0, w) {
      var rowsList = [], seen = {}, i;
      for (i = 0; i < resEnts.length; i++) {
        if (resEnts[i].kind !== 'v' || seen[resEnts[i].cell]) continue;
        seen[resEnts[i].cell] = rowsList.length;
        rowsList.push(resEnts[i].cell);
      }
      var labW = 46;
      var colW = Math.max(11, Math.min(22, Math.floor((w - labW - 4) / (HORIZON + 1))));
      var shown = Math.min(HORIZON, Math.max(3, Math.floor((w - labW - 4) / colW) - 1));
      panelHead(ctx, T, x0, y0, w, '예약 테이블 — (칸, 시각)',
        shown < HORIZON ? ('t≤' + shown + ' 표시 · 실제 예약은 t=' + HORIZON + '까지') : '');

      var top = y0 + 18, rowH = 18, t;
      ctx.font = '9px ' + MONO;
      ctx.fillStyle = T.fgFaint;
      for (t = 0; t <= shown; t++) if (t % (colW < 15 ? 2 : 1) === 0) center(ctx, String(t), x0 + labW + t * colW + colW / 2, top + 9);

      var revealed = Math.min(step.resN || 0, resEnts.length);
      var newest = revealed > 0 ? resEnts[revealed - 1] : null;
      for (i = 0; i < rowsList.length; i++) {
        var ry = top + 12 + i * rowH;
        ctx.font = '10px ' + MONO;
        ctx.fillStyle = T.fgDim;
        ctx.fillText(fit(ctx, rc(rowsList[i]), labW - 4), x0, ry + 12);
        for (t = 0; t <= shown; t++) {
          var x = x0 + labW + t * colW;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.border;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, ry + 0.5, colW - 1, rowH - 3);
        }
      }
      for (i = 0; i < revealed; i++) {
        var e = resEnts[i];
        if (e.t > shown) continue;
        var x2 = x0 + labW + e.t * colW;
        if (e.kind === 'v') {
          var ry2 = top + 12 + seen[e.cell] * rowH;
          ctx.globalAlpha = e.tail ? 0.42 : 0.9;
          ctx.fillStyle = e.tail ? T.fgFaint : T.boxWarn;
          ctx.fillRect(x2 + 1, ry2 + 1, colW - 2, rowH - 4);
          if (newest === e) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = T.accent;
            ctx.lineWidth = 2;
            ctx.strokeRect(x2, ry2, colW, rowH - 2);
          }
        } else if (seen[e.cell] !== undefined && seen[e.to] !== undefined) {
          // 이동(간선) 예약 — 방향이 반대인 짝 하나만 막으면 맞바꿈이 금지된다
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = T.fg;
          ctx.font = '700 9px ' + MONO;
          center(ctx, '↔', x2 + colW / 2, top + 12 + Math.min(seen[e.cell], seen[e.to]) * rowH + rowH * 0.95);
        }
      }
      ctx.globalAlpha = 1;
      if (!revealed) {
        ctx.font = '10px ' + FONT;
        ctx.fillStyle = T.fgFaint;
        ctx.fillText('아직 비어 있다.', x0 + labW + 4, top + 24);
      }
    }

    /* 제약 트리 — 노드 라벨이 비용 합인 이유: 최적성 논증이 "비용은 절대 줄지 않는다"
     * 한 줄이기 때문이다. 8 → 9 → 10 → 11 이 트리 위에서 눈으로 확인돼야 한다. */
    function drawTree(ctx, T, L, step, x0, y0, w, h) {
      var info = step.tree;
      if (!info) { panelHead(ctx, T, x0, y0, w, '제약 트리'); return; }
      var nodes = info.res.nodes, created = info.created;
      panelHead(ctx, T, x0, y0, w, '제약 트리 — 라벨은 비용 합, 최적 우선으로 꺼낸다',
        '노드 ' + created + '개');

      var kids = [], i;
      for (i = 0; i < nodes.length; i++) kids.push([]);
      for (i = 1; i < nodes.length && i < created; i++) if (nodes[i].parent >= 0) kids[nodes[i].parent].push(i);

      var maxDepth = 0;
      for (i = 0; i < created && i < nodes.length; i++) maxDepth = Math.max(maxDepth, nodes[i].depth);
      var leafX = 0, xs = [];
      (function assign(idx) {
        var ch = kids[idx];
        if (!ch.length) { xs[idx] = leafX++; return; }
        for (var k = 0; k < ch.length; k++) assign(ch[k]);
        xs[idx] = (xs[ch[0]] + xs[ch[ch.length - 1]]) / 2;
      })(0);
      var leaves = Math.max(1, leafX);
      var top = y0 + 20, levelH = Math.max(34, Math.min(54, (h - 56) / Math.max(1, maxDepth)));
      var slot = (w - 24) / leaves;
      var rad = Math.max(9, Math.min(14, slot * 0.34));
      function px(i) { return x0 + 12 + (xs[i] + 0.5) * slot; }
      function py(i) { return top + nodes[i].depth * levelH + rad + 2; }

      for (i = 1; i < created && i < nodes.length; i++) {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px(nodes[i].parent), py(nodes[i].parent) + rad);
        ctx.lineTo(px(i), py(i) - rad);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      var expandedSet = {};
      for (i = 0; i < info.expanded && i < info.res.trace.length; i++) expandedSet[info.res.trace[i].node] = 1;
      for (i = 0; i < created && i < nodes.length; i++) {
        var isCur = i === info.cur, isKid = info.kids && info.kids.indexOf(i) >= 0;
        ctx.beginPath();
        ctx.arc(px(i), py(i), rad, 0, 6.2832);
        ctx.fillStyle = step.solved && isCur ? T.wPath : (expandedSet[i] ? T.accent : T.bgCode);
        ctx.fill();
        ctx.lineWidth = isCur || isKid ? 2.5 : 1;
        ctx.strokeStyle = isCur ? T.wPath : (isKid ? T.boxWarn : T.border);
        ctx.stroke();
        ctx.fillStyle = (expandedSet[i] || (step.solved && isCur)) ? T.bg : T.fgDim;
        ctx.font = '700 ' + Math.round(rad * 0.95) + 'px ' + MONO;
        center(ctx, String(nodes[i].cost), px(i), py(i) + rad * 0.36);
      }
      // 지금 노드에 쌓인 제약
      ctx.font = '10px ' + FONT;
      ctx.fillStyle = T.fgFaint;
      var txt = 'N' + info.cur + ' 의 제약: ' + describeCons(nodes[info.cur], nodes, cfg.agents);
      var ty = top + (maxDepth + 1) * levelH + 6;
      var words = txt.split(' '), line = '', lines = [];
      for (i = 0; i < words.length; i++) {
        var cand = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(cand).width > w - 8 && line) { lines.push(line); line = words[i]; }
        else line = cand;
      }
      if (line) lines.push(line);
      for (i = 0; i < lines.length && i < 2; i++) ctx.fillText(fit(ctx, lines[i], w - 4), x0, ty + 10 + i * 13);
      if (lines.length > 2) ctx.fillText('…', x0 + w - 12, ty + 10 + 13);
    }

    /* 자원 할당 그래프 — 정점을 고리 모양으로 배치하는 이유: 교착의 정의가 고리이므로,
     * 배치 자체가 고리를 이루면 사이클이 있다·없다가 한눈에 갈린다. */
    function drawRag(ctx, T, L, step, x0, y0, w, h) {
      var rag = step.rag;
      panelHead(ctx, T, x0, y0, w, '자원 할당 그래프 — 자원→로봇 보유, 로봇→자원 대기',
        rag && step.dfs && step.dfs.cycle ? '사이클 길이 ' + (step.dfs.cycle.length - 1) : '');
      if (!rag) return;
      var ags = cfg.agents, i;

      // 로봇 i → 그가 기다리는 자원 순으로 늘어놓으면 고리가 그대로 원이 된다
      var order = [], pushed = {};
      for (i = 0; i < ags.length; i++) {
        order.push({ id: ags[i].id, kind: 'r', idx: i }); pushed[ags[i].id] = 1;
        if (rag.waits[i] >= 0 && !pushed[rc(rag.waits[i])]) {
          order.push({ id: rc(rag.waits[i]), kind: 'res' }); pushed[rc(rag.waits[i])] = 1;
        }
      }
      for (i = 0; i < rag.nodes.length; i++) if (!pushed[rag.nodes[i]]) { order.push({ id: rag.nodes[i], kind: 'res' }); pushed[rag.nodes[i]] = 1; }

      var n = order.length;
      var dia = Math.min(w - 24, h - 44);
      var cx = x0 + w / 2, cy = y0 + 20 + dia / 2;
      var R = dia / 2 - 16;
      var at2 = {}, i2;
      for (i2 = 0; i2 < n; i2++) {
        var a = -Math.PI / 2 + (i2 / n) * Math.PI * 2;
        at2[order[i2].id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), kind: order[i2].kind, idx: order[i2].idx };
      }
      var cyc = (step.dfs && step.dfs.cycle) || null;
      function onCycle(a, b) {
        if (!cyc) return false;
        for (var k = 0; k + 1 < cyc.length; k++) if (cyc[k] === a && cyc[k + 1] === b) return true;
        return false;
      }
      // 간선
      for (var v in rag.adj) {
        if (!rag.adj.hasOwnProperty(v) || !at2[v]) continue;
        for (var k2 = 0; k2 < rag.adj[v].length; k2++) {
          var wv = rag.adj[v][k2];
          if (!at2[wv]) continue;
          var hot = onCycle(v, wv);
          ctx.strokeStyle = hot ? T.boxDanger : T.fgFaint;
          ctx.fillStyle = hot ? T.boxDanger : T.fgFaint;
          ctx.lineWidth = hot ? 3 : 1.2;
          ctx.globalAlpha = hot ? 1 : 0.65;
          if (at2[v].kind === 'r') ctx.setLineDash(hot ? [] : [4, 3]);   // 대기 간선은 점선
          var dx = at2[wv].x - at2[v].x, dy = at2[wv].y - at2[v].y, len = Math.sqrt(dx * dx + dy * dy) || 1;
          arrow(ctx, at2[v].x + dx / len * 17, at2[v].y + dy / len * 17,
            at2[wv].x - dx / len * 19, at2[wv].y - dy / len * 19, hot ? 8 : 6);
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;
      // 정점
      for (i2 = 0; i2 < n; i2++) {
        var o = order[i2], p = at2[o.id];
        var col = o.kind === 'r' ? agentColor(T, o.idx) : T.bgCode;
        var gray = step.dfs && step.dfs.color && step.dfs.color[o.id] === 1;
        var black = step.dfs && step.dfs.color && step.dfs.color[o.id] === 2;
        ctx.globalAlpha = black ? 0.45 : 1;
        if (o.kind === 'r') { box(ctx, p.x - 15, p.y - 11, 30, 22, 5); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 6.2832); }
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = gray ? 3 : 1;
        ctx.strokeStyle = gray ? T.accent : T.border;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = o.kind === 'r' ? T.bg : T.fgDim;
        ctx.font = '700 ' + (o.kind === 'r' ? 11 : 9) + 'px ' + (o.kind === 'r' ? FONT : MONO);
        center(ctx, o.id, p.x, p.y + 4, 30);
      }
      // 사이클 문장 — 색을 못 보는 독자에게는 이 줄이 그림이다
      ctx.font = '10px ' + FONT;
      ctx.fillStyle = cyc ? T.boxDanger : T.fgFaint;
      var line2 = cyc ? cyc.join(' → ') : (step.live ? '사이클 없음 — 아무도 기다리는 상태가 아니다' : '사이클 없음');
      ctx.fillText(fit(ctx, line2, w), x0, y0 + 20 + dia + 12);
    }

    function drawCompare(ctx, T, L, y0) {
      if (!compareInfo) return;
      var bw = Math.floor((L.w - 10) / 2);
      var items = [compareInfo.left, compareInfo.right];
      for (var i = 0; i < 2; i++) {
        var x = i * (bw + 10);
        box(ctx, x, y0, bw, 34, 6);
        ctx.fillStyle = T.bgCode;
        ctx.fill();
        ctx.globalAlpha = items[i].ok ? 1 : 0.55;      // 실패한 쪽은 회색으로 남는다
        ctx.font = '700 11px ' + FONT;
        ctx.fillStyle = items[i].ok ? T.accent : T.fgFaint;
        ctx.fillText(fit(ctx, items[i].name, bw - 12), x + 8, y0 + 14);
        ctx.font = '10.5px ' + FONT;
        ctx.fillStyle = items[i].ok ? T.fgDim : T.fgFaint;
        ctx.fillText(fit(ctx, items[i].text, bw - 12), x + 8, y0 + 28);
        ctx.globalAlpha = 1;
      }
    }

    // ---- 전체 그리기 ----
    function draw(ctx, size, T) {
      var L = layoutFor(size.w);
      var step = steps[Math.min(cur, steps.length - 1)] || steps[0];
      ctx.textBaseline = 'alphabetic';

      drawChips(ctx, T, L, step);
      drawCounters(ctx, T, L, step);

      var gx = 0, gy = L.yMain;
      if (showGrid) drawGridPanel(ctx, T, L, step, gx, gy);
      if (sidePanel) {
        var sx = L.wide ? L.gridW + GAP : 0;
        var sy = L.wide ? L.yMain : (L.yMain + (showGrid ? L.gridH + GAP : 0));
        var sw = L.wide ? L.sideW : L.w;
        if (sidePanel === 'reservation-table') drawReservation(ctx, T, L, step, sx, sy, sw);
        else if (sidePanel === 'constraint-tree') drawTree(ctx, T, L, step, sx, sy, sw, L.sideH);
        else if (sidePanel === 'resource-allocation-graph') drawRag(ctx, T, L, step, sx, sy, sw, L.sideH);
      }
      if (showTimeline) drawTimeline(ctx, T, L, step, L.yTl);
      if (compareInfo) drawCompare(ctx, T, L, L.yCmp);

      if (step.note) {
        ctx.font = '10px ' + FONT;
        ctx.fillStyle = T.boxWarn;
        ctx.fillText(fit(ctx, '※ ' + step.note, L.w), 0, L.height - 6);
      }
    }

    var canvas = K.canvas(ui.stage, {
      height: function (w) { return layoutFor(w).height; },
      draw: draw
    });

    var player = K.player(ui, {
      total: function () { return steps.length; },
      render: function (i) { cur = i; canvas.redraw(); },
      label: function (i) {
        var s = steps[Math.min(i, steps.length - 1)] || steps[0];
        var head = PHASE_LABEL[s.ph] ? PHASE_LABEL[s.ph] + ' — ' : '';
        var tail = [];
        for (var k = 0; k < counters.length; k++) {
          var v = s.ctr ? s.ctr[counters[k]] : undefined;
          if (v !== undefined) tail.push(COUNTER_LABEL[counters[k]] + ' ' + v);
        }
        return head + (s.msg || '') + (tail.length ? '  ▸ ' + tail.join(' / ') + '.' : '');
      }
    });

    /* 검증 훅. 형제 위젯(sorting-race 등)과 같은 방식이다.
     * 이 위젯이 화면에 그리는 경로·비용은 본문이 **실제로 돌려 인쇄한 값**이어야 하고,
     * 그것은 눈으로가 아니라 단언으로 확인해야 한다(계약 §8·§9). */
    host.__multiAgvConflict = {
      total: function () { return steps.length; },
      step: function (i) {
        var s = steps[Math.min(Math.max(0, i), steps.length - 1)];
        return { ph: s.ph, msg: s.msg, ctr: s.ctr, note: s.note || null };
      },
      setScenario: function (v) { scenario = v; rebuild2(); player.goto(0); },
      setPolicy: function (v) { policy = v; rebuild2(); player.goto(0); },
      verify: function () {
        var g = ['#.###', '.....'];
        var ab = [{ id: 'A', s: enc(1, 0), g: enc(1, 4), queue: [] }, { id: 'B', s: enc(1, 4), g: enc(1, 0), queue: [] }];
        var pr = prioritized(g, ab, true);
        var cb = cbs(g, ab);
        var joint = [[enc(1, 0), enc(1, 1), enc(0, 1), enc(0, 1), enc(1, 1), enc(1, 2), enc(1, 3), enc(1, 4)],
        [enc(1, 4), enc(1, 3), enc(1, 2), enc(1, 1), enc(1, 0)]];
        var sg = ['....'];
        var sab = [{ id: 'A', s: enc(0, 0), g: enc(0, 3), queue: [] }, { id: 'B', s: enc(0, 3), g: enc(0, 0), queue: [] }];
        var sNo = prioritized(sg, sab, false), sYes = prioritized(sg, sab, true);
        var vconf = 0;
        for (var t = 0; t < 4; t++) if (at(sNo.paths[0], t) === at(sNo.paths[1], t)) vconf++;
        var xg = ['##.##', '##.##', '.....', '##.##', '##.##'];
        var xab = [{ id: 'A', s: enc(2, 0), g: enc(2, 4), queue: [] }, { id: 'B', s: enc(0, 2), g: enc(4, 2), queue: [] }];
        var xpr = prioritized(xg, xab, true), xcb = cbs(xg, xab);
        // 교착·라이브락의 자원 할당 그래프
        var dg = ['#..#', '....', '....', '#..#'];
        var dags = toAgents(SCEN['gridlock-2x2'].agents, dg);
        var dc = [], dw = [], bs = {};
        for (var i = 0; i < dags.length; i++) if (dags[i].queue.length) bs[dags[i].queue[0]] = 1;
        for (i = 0; i < dags.length; i++) {
          dc.push(dags[i].s);
          var rt = route(dg, bs, dags[i].s, dags[i].g);
          dw.push(rt && rt.length > 1 ? rt[1] : -1);
        }
        var dr = makeRag(dags, dc, dw);
        var dcyc = findCycle(dr.nodes, dr.adj).cycle;
        var lr = makeRag(dags.slice(0, 2), [dags[0].s, dags[1].s], [-1, -1]);
        var lcyc = findCycle(lr.nodes, lr.adj).cycle;
        var live = buildLivelock({ grid: dg, agents: dags }, 'priority') || [];
        var liveStall = 0, liveCyc = 0;
        for (i = 0; i < live.length; i++) {
          if (live[i].ctr && live[i].ctr.stepsWithoutProgress > liveStall) liveStall = live[i].ctr.stepsWithoutProgress;
          if (live[i].ctr && live[i].ctr.cycleLength) liveCyc++;
        }
        return [
          { name: 'corridor-alcove: 우선순위 기반은 B 에서 실패한다', ok: pr.failed === 1, got: pr.failed },
          { name: 'corridor-alcove: 유효한 동시 해가 있고 비용 합 11', ok: totalCost(joint) === 11 && firstConflict(joint).kind === 'none', got: totalCost(joint) + '/' + firstConflict(joint).kind },
          { name: 'corridor-alcove: CBS 는 비용 11 · 충돌 없음', ok: !!cb.paths && totalCost(cb.paths) === 11 && firstConflict(cb.paths).kind === 'none', got: cb.paths ? totalCost(cb.paths) + '/' + firstConflict(cb.paths).kind : 'null' },
          { name: 'corridor-alcove: CBS 는 CT 노드 8 · 하위 호출 16', ok: cb.expanded === 8 && cb.calls === 16, got: cb.expanded + '/' + cb.calls },
          { name: 'corridor-alcove: CBS 비용이 8→9→10→11 로 줄지 않는다', ok: cb.trace.map(function (r) { return r.cost; }).join(',') === '8,9,9,10,10,10,10,11', got: cb.trace.map(function (r) { return r.cost; }).join(',') },
          { name: 'swap: 정점 충돌 0 건인데 맞바꿈이 일어난다', ok: vconf === 0 && firstConflict(sNo.paths).kind === 'swap', got: vconf + '/' + firstConflict(sNo.paths).kind },
          { name: 'swap: 간선 검사를 켜면 해 없음이 옳은 답', ok: sYes.failed === 1, got: sYes.failed },
          { name: 'cross: 우선순위 기반 B 가 대기 1회, 비용 합 9', ok: xpr.failed < 0 && waitCount(xpr.paths) === 1 && totalCost(xpr.paths) === 9, got: waitCount(xpr.paths) + '/' + totalCost(xpr.paths) },
          { name: 'cross: 따로 계획하면 (2,2)@2 에서 정점 충돌', ok: (function () { var ip = [plan(xg, xab[0].s, xab[0].g, new Set(), new Set()).path, plan(xg, xab[1].s, xab[1].g, new Set(), new Set()).path]; var c = firstConflict(ip); return c.kind === 'vertex' && c.a === enc(2, 2) && c.t === 2; })(), got: 'vertex(2,2)@2' },
          { name: 'cross: CBS 는 비용 9 · 노드 2 · 호출 4', ok: !!xcb.paths && totalCost(xcb.paths) === 9 && xcb.expanded === 2 && xcb.calls === 4, got: xcb.expanded + '/' + xcb.calls },
          { name: 'deadlock: 자원 할당 그래프에 길이 8 사이클이 있다', ok: dcyc.length === 9, got: dcyc.join(' → ') },
          { name: 'livelock: 자원 할당 그래프에 사이클이 없다', ok: lcyc.length === 0, got: lcyc.length },
          { name: 'livelock: 사이클 0 인데 진행 없는 스텝이 오른다', ok: liveCyc === 0 && liveStall >= 8, got: 'cycle ' + liveCyc + ' / stall ' + liveStall }
        ];
      }
    };

    player.goto(0);
  });
})();

/* ==== sorting-race.js ==== */
/* sorting-race.js — 같은 배열, 다른 정렬 전략의 동시 경주
 *
 * 이 위젯이 증명하려는 명제는 하나다: **정렬 알고리즘의 차이는 "무엇을 언제
 * 견주는가"이고, 그 차이는 막대가 움직이는 모양이 아니라 카운터에 남는다.**
 * 그래서 여러 패널이 같은 배열·같은 스텝 인덱스를 쓰고, 각 패널 머리에
 * 비교 횟수와 이동 횟수를 크게 띄운다.
 *
 * 왜 카운터가 이 위젯의 본체인가
 *   "O(n²) 와 O(n log n) 은 다르다"는 문장은 그 자체로는 아무것도 보여주지
 *   않는다. 같은 40개 배열에서 삽입 정렬이 400번 견줄 때 병합 정렬이 190번
 *   견디는 것을 **같은 화면에서 동시에** 세어야 주장이 관찰이 된다.
 *   막대의 춤은 거들 뿐이다. 그래서 좁은 화면에서는 막대를 버리고 카운터
 *   표를 남긴다(§레이아웃 주석).
 *
 * 왜 입력 프리셋이 알고리즘 목록만큼 중요한가
 *   II-7 §2.1 의 결론은 "하한은 n! 가지가 전부 가능한 입력에 대한 명제"다.
 *   이미 정렬된 입력에서 삽입 정렬이 n-1 번 비교로 끝나고 나머지는 그대로인
 *   장면이 그 문장의 증거다. 프리셋을 바꾸는 순간 순위가 뒤집히는 것을
 *   보지 못하면 "무엇을 고를 것인가"(§2.5)가 표 암기로 끝난다.
 *   그리고 그 관찰이 그대로 Timsort 의 존재 이유가 된다(0-4).
 *
 * ── 카운터 정의 (여섯 알고리즘에 똑같이 적용한다) ──────────────────────
 *   정의가 알고리즘마다 다르면 비교가 통째로 거짓말이 되므로 여기서 못 박는다.
 *
 *   비교 1회 = **원소 두 개의 값**(또는 원소 하나와 손에 든 키의 값)을 견준 횟수.
 *              인덱스·경계 검사(`j < i`, `lo < hi`)는 세지 않는다. 값을 보지
 *              않는 검사는 정렬 하한(§2.1)이 말하는 "정보 한 비트"가 아니다.
 *   이동 1회 = **배열 칸의 값이 실제로 바뀐 쓰기 1회.** 교환 1회 = 2.
 *              보조 배열에 쓰는 것도 센다(병합 정렬이 공짜가 아니라는 사실이
 *              이 칸에 드러나야 한다). 같은 값을 제자리에 다시 쓰는 것은
 *              아무것도 바꾸지 않으므로 세지 않는다.
 *
 * 알고리즘 구현은 교과서형 그대로다. 특히 퀵 정렬은 **마지막 원소를 피벗으로
 * 쓰는 Lomuto 분할**이다 — 정렬된 입력에서 O(n²) 로 무너지는 그 버전이다.
 * 실무 구현이 왜 median-of-three 와 introsort 로 가는지(0-7)를 프리셋
 * "정렬됨"에서 독자가 직접 보게 하려고 일부러 고르지 않았다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // ─── 상수 ────────────────────────────────────────────────────────────────

  var ALGOS = ['bubble', 'insertion', 'selection', 'merge', 'quick', 'heap'];
  var DEFAULT_ALGOS = ['insertion', 'merge', 'quick', 'heap'];

  var NAME = {
    bubble: '버블', insertion: '삽입', selection: '선택',
    merge: '병합', quick: '퀵', heap: '힙'
  };
  var RULE = {
    bubble: '이웃끼리 견줘 큰 것을 뒤로 민다',
    insertion: '앞의 정렬 구간에 하나씩 끼운다',
    selection: '남은 것 중 최솟값을 앞으로',
    merge: '반씩 정렬해 합친다 (보조 배열)',
    quick: 'Lomuto · 마지막 원소가 피벗',
    heap: '힙을 쌓고 최댓값을 뒤로 뺀다'
  };
  var BIG_O = {
    bubble: 'O(n²)', insertion: 'O(n²)', selection: 'O(n²)',
    merge: 'O(n log n)', quick: '평균 O(n log n)', heap: 'O(n log n)'
  };

  var PRESETS = ['random', 'sorted', 'reversed', 'nearly-sorted', 'few-unique'];
  var PRESET_ALIAS = {
    random: 'random', shuffled: 'random', 무작위: 'random',
    sorted: 'sorted', ascending: 'sorted', 정렬됨: 'sorted',
    reversed: 'reversed', reverse: 'reversed', descending: 'reversed', 역순: 'reversed',
    'nearly-sorted': 'nearly-sorted', nearly: 'nearly-sorted', nearlysorted: 'nearly-sorted', almost: 'nearly-sorted',
    'few-unique': 'few-unique', few: 'few-unique', fewunique: 'few-unique', duplicates: 'few-unique'
  };
  var PRESET_LABEL = {
    random: '무작위', sorted: '정렬됨', reversed: '역순',
    'nearly-sorted': '거의 정렬', 'few-unique': '값 4종'
  };
  var PRESET_NOTE = {
    random: '무작위 — n! 가지가 전부 가능한 입력. 하한이 그대로 걸린다',
    sorted: '이미 정렬됨 — 삽입은 n-1 번으로 끝나고, 마지막 원소를 피벗으로 쓰는 퀵은 O(n²) 로 무너진다',
    reversed: '역순 — 삽입·버블의 최악. 모든 쌍이 뒤집혀 있다',
    'nearly-sorted': '거의 정렬 — 어긋난 쌍이 몇 개뿐이다. Timsort 가 노리는 실전 입력의 모양(0-4)',
    'few-unique': '값 4종 — 같은 값이 잔뜩. 2-way 분할 퀵이 여기서도 무너진다'
  };

  var MIN_N = 6, MAX_N = 48;
  var MAX_STEPS = 6000;   // 계약 §7: 스텝 상한. n=48 역순 버블이 약 2,300스텝이라 여유가 있다

  var PAD = 6;
  var HEAD = 30;          // 이름줄 + 카운터줄
  var MARK = 14;          // 막대 아래 포인터 표식 띠
  var GAP = 14;
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  // 선형 합동 생성기. Math.random 을 쓰면 같은 opts 가 매번 다른 배열을 내고
  // "같은 인덱스 = 같은 그림"(계약 §7)이 깨진다. 씨앗을 고정한다.
  function lcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // 숫자를 읽었을 때 받침이 있는가. 0 영·1 일·3 삼·6 육·7 칠·8 팔만 받침이 있다.
  // 상태 줄이 소리 내어 읽히는 문장이라 조사가 틀리면 그대로 눈에 띈다.
  function jong(n) {
    var s = String(n);
    return '013678'.indexOf(s.charAt(s.length - 1)) >= 0;
  }
  function ul(n) { return n + (jong(n) ? '을' : '를'); }
  function iga(n) { return n + (jong(n) ? '이' : '가'); }

  // ─── 입력 프리셋 ─────────────────────────────────────────────────────────
  //
  // 값은 1..n 의 순열이다. 막대 높이가 전부 달라야 "어디가 아직 안 맞았는가"가
  // 한눈에 보이기 때문이다. 값 4종 프리셋만 예외이고, 그 예외 자체가 교훈이다.

  function makeInput(kind, n, seed) {
    var a = new Int16Array(n), i, t, j;
    for (i = 0; i < n; i++) a[i] = i + 1;
    var rnd = lcg(seed);

    if (kind === 'sorted') return a;

    if (kind === 'reversed') {
      for (i = 0; i < n >> 1; i++) { t = a[i]; a[i] = a[n - 1 - i]; a[n - 1 - i] = t; }
      return a;
    }

    if (kind === 'few-unique') {
      // 서로 다른 값 네 개만 쓴다. 높이가 네 단이라 "같은 값끼리의 순서"가
      // 보이지 않고, 그래서 안정성(§2.3)이 눈으로 확인되지 않는다는 것도 정직한 관찰이다.
      var levels = [Math.max(1, Math.round(n * 0.25)), Math.round(n * 0.5), Math.round(n * 0.75), n];
      for (i = 0; i < n; i++) a[i] = levels[Math.floor(rnd() * 4) % 4];
      return a;
    }

    if (kind === 'nearly-sorted') {
      // 정렬된 배열에서 가까운 쌍 몇 개만 뒤집는다. 어긋난 쌍(inversion) 수가
      // 작다는 것이 "거의 정렬"의 정확한 뜻이고, 삽입 정렬의 비용은 그 수에 비례한다.
      var swaps = Math.max(1, Math.round(n / 12));
      for (i = 0; i < swaps; i++) {
        j = Math.floor(rnd() * (n - 1));
        var d = 1 + Math.floor(rnd() * 3);
        var k2 = Math.min(n - 1, j + d);
        t = a[j]; a[j] = a[k2]; a[k2] = t;
      }
      return a;
    }

    // random — Fisher-Yates
    for (i = n - 1; i > 0; i--) {
      j = Math.floor(rnd() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ─── 기록기 ──────────────────────────────────────────────────────────────
  //
  // 알고리즘은 배열을 직접 만지지 않고 이 객체를 통해서만 만진다. 그래야
  // 카운터 정의(파일 머리)가 여섯 알고리즘에 **똑같이** 적용된다.
  //
  // 스냅샷은 복사-쓰기다. 비교 스텝은 배열을 바꾸지 않으므로 직전 스냅샷을
  // 그대로 참조한다. 그 덕에 스텝 2,000개짜리 기록도 수십 KB에 들어가고
  // 되감기가 즉시 된다(계약 §7).

  function Rec(base) {
    this.n = base.length;
    this.a = base.slice();
    this.cmp = 0;
    this.mv = 0;
    this.sorted = new Uint8Array(this.n);
    this.arrSnap = this.a.slice();
    this.srtSnap = this.sorted.slice();
    this.steps = [];
    this.over = false;
    this.push({ t: 'init' });
  }

  Rec.prototype.push = function (s) {
    if (this.steps.length >= MAX_STEPS) { this.over = true; return false; }
    s.cmp = this.cmp;
    s.mv = this.mv;
    s.arr = this.arrSnap;
    s.srt = this.srtSnap;
    this.steps.push(s);
    return true;
  };

  Rec.prototype.touchArr = function () { this.arrSnap = this.a.slice(); };
  Rec.prototype.touchSrt = function () { this.srtSnap = this.sorted.slice(); };

  /* 원소 두 개를 견준다. 반환은 a[i] - a[j] 의 부호. */
  Rec.prototype.compare = function (i, j, ex) {
    this.cmp += 1;
    var s = ex ? cloneEx(ex) : {};
    s.t = 'cmp'; s.i = i; s.j = j;
    this.push(s);
    return this.a[i] - this.a[j];
  };

  /* 원소 하나와 손에 든 키를 견준다. 삽입 정렬 전용이다 —
   * 키는 이미 배열에서 들어낸 값이라 인덱스로 가리킬 수 없다. */
  Rec.prototype.compareKey = function (i, key, hole) {
    this.cmp += 1;
    this.push({ t: 'cmpk', i: i, key: key, kx: hole });
    return this.a[i] - key;
  };

  /* 배열 칸에 쓴다. 값이 실제로 바뀔 때만 이동으로 센다. */
  Rec.prototype.write = function (i, val, ex) {
    var changed = this.a[i] !== val;
    if (changed) { this.a[i] = val; this.mv += 1; this.touchArr(); }
    var s = ex ? cloneEx(ex) : {};
    s.t = 'wr'; s.i = i; s.val = val; s.noop = !changed;
    this.push(s);
  };

  /* 교환. 값이 같으면 배열이 바뀌지 않으므로 이동은 0이다. */
  Rec.prototype.swap = function (i, j, ex) {
    var changed = this.a[i] !== this.a[j];
    if (changed) {
      var t = this.a[i]; this.a[i] = this.a[j]; this.a[j] = t;
      this.mv += 2;
      this.touchArr();
    }
    var s = ex ? cloneEx(ex) : {};
    s.t = 'sw'; s.i = i; s.j = j; s.noop = !changed;
    this.push(s);
  };

  /* 보조 배열로 옮긴다(병합 정렬). 배열 칸 하나에 쓰는 것이므로 이동 1이다. */
  Rec.prototype.take = function (i, ex) {
    this.mv += 1;
    var s = cloneEx(ex);
    s.t = 'take'; s.i = i;
    this.push(s);
  };

  /* 손에 든 키를 들어낸다. 배열은 아직 그대로다 — 이동이 아니다. */
  Rec.prototype.lift = function (i, key) {
    this.push({ t: 'lift', i: i, key: key, kx: i });
  };

  Rec.prototype.seal = function (lo, hi, why) {
    for (var i = lo; i <= hi; i++) this.sorted[i] = 1;
    this.touchSrt();
    this.push({ t: 'seal', lo: lo, hi: hi, why: why || '' });
  };

  Rec.prototype.finish = function () {
    for (var i = 0; i < this.n; i++) this.sorted[i] = 1;
    this.touchSrt();
    this.push({ t: 'done' });
  };

  function cloneEx(ex) {
    var o = {};
    for (var k in ex) if (Object.prototype.hasOwnProperty.call(ex, k)) o[k] = ex[k];
    return o;
  }

  // ─── 여섯 알고리즘 ───────────────────────────────────────────────────────
  //
  // 전부 교과서형이다. 위젯이 본문과 다른 알고리즘을 돌리면 안 된다(계약 §9).

  function runBubble(rec) {
    var n = rec.n, i, j;
    for (i = n - 1; i > 0; i--) {
      var swapped = false;
      for (j = 0; j < i; j++) {
        if (rec.over) return;
        if (rec.compare(j, j + 1) > 0) { rec.swap(j, j + 1); swapped = true; }
      }
      // 한 바퀴가 끝나면 남은 것 중 최댓값이 i 자리에 확정된다.
      rec.seal(i, i, '한 바퀴 끝 — 최댓값이 뒤로 밀려 확정');
      // 한 바퀴를 도는 동안 한 번도 교환이 없었다 = 이미 정렬됐다.
      if (!swapped) break;
    }
  }

  function runSelection(rec) {
    var n = rec.n, i, j;
    for (i = 0; i < n - 1; i++) {
      var m = i;
      for (j = i + 1; j < n; j++) {
        if (rec.over) return;
        if (rec.compare(j, m) < 0) m = j;
      }
      // 자기 자신과의 교환은 아무것도 바꾸지 않는다. 실무 구현도 건너뛴다.
      if (m !== i) rec.swap(i, m);
      rec.seal(i, i, '최솟값을 앞자리에 확정');
    }
  }

  function runInsertion(rec) {
    var n = rec.n;
    if (n > 0) rec.seal(0, 0, '원소 하나는 그 자체로 정렬 구간');
    for (var i = 1; i < n; i++) {
      if (rec.over) return;
      var key = rec.a[i];
      rec.lift(i, key);
      var j = i - 1;
      // 키보다 큰 것을 오른쪽으로 한 칸씩 민다. 교환이 아니라 **밀기**라
      // 이동이 교환형의 절반이다 — 같은 비교 횟수로도 이동이 갈리는 이유다.
      while (j >= 0 && rec.compareKey(j, key, j + 1) > 0) {
        if (rec.over) return;
        rec.write(j + 1, rec.a[j], { key: key, kx: j });
        j -= 1;
      }
      rec.write(j + 1, key, { key: key, kx: j + 1, drop: true });
      rec.seal(0, i, '앞 구간이 정렬 상태를 유지');
    }
  }

  /* 병합 — 안정 정렬이다. 값이 같으면 **왼쪽 런을 먼저** 가져가기 때문이고,
   * 그 한 줄(`<= 0`)이 §2.3 이 말하는 안정성의 전부다. */
  function mergeRange(rec, lo, mid, hi) {
    var aux = [], p = lo, q = mid, t;
    var ex = { lo: lo, mid: mid, hi: hi, p: p, q: q };
    while (p < mid && q < hi) {
      if (rec.over) return;
      ex.p = p; ex.q = q;
      var c = rec.compare(p, q, ex);
      ex.p = p; ex.q = q;
      if (c <= 0) { aux.push(rec.a[p]); rec.take(p, ex); p += 1; }
      else { aux.push(rec.a[q]); rec.take(q, ex); q += 1; }
    }
    while (p < mid) { if (rec.over) return; ex.p = p; ex.q = q; aux.push(rec.a[p]); rec.take(p, ex); p += 1; }
    while (q < hi) { if (rec.over) return; ex.p = p; ex.q = q; aux.push(rec.a[q]); rec.take(q, ex); q += 1; }
    // 보조 배열의 내용을 제자리에 되쓴다. 여기서 막대가 실제로 움직인다.
    for (t = 0; t < aux.length; t++) {
      if (rec.over) return;
      rec.write(lo + t, aux[t], { lo: lo, mid: mid, hi: hi, back: lo + t });
    }
    rec.seal(lo, hi - 1, '이 구간이 정렬됨');
  }

  function runMerge(rec) {
    (function ms(lo, hi) {
      if (rec.over || hi - lo < 2) return;
      var mid = (lo + hi) >> 1;
      ms(lo, mid);
      ms(mid, hi);
      mergeRange(rec, lo, mid, hi);
    })(0, rec.n);
  }

  function runQuick(rec) {
    (function qs(lo, hi) {
      if (rec.over || lo > hi) return;
      if (lo === hi) { rec.seal(lo, lo, '원소 하나 — 확정'); return; }
      var ex = { lo: lo, hi: hi, pivot: hi, i: lo - 1 };
      var i = lo - 1;
      for (var j = lo; j < hi; j++) {
        if (rec.over) return;
        ex.i = i;
        if (rec.compare(j, hi, ex) <= 0) {
          i += 1;
          ex.i = i;
          if (i !== j) rec.swap(i, j, ex);
        }
      }
      var p = i + 1;
      ex.i = i;
      if (p !== hi) rec.swap(p, hi, ex);
      rec.seal(p, p, '피벗이 제자리에 확정');
      qs(lo, p - 1);
      qs(p + 1, hi);
    })(0, rec.n - 1);
  }

  function runHeap(rec) {
    var n = rec.n;

    function sift(root, end) {          // end 는 열린 끝
      var r = root;
      for (;;) {
        if (rec.over) return;
        var l = 2 * r + 1, rt = l + 1, big = r;
        var ex = { heap: end, root: r };
        if (l < end && rec.compare(l, big, ex) > 0) big = l;
        if (rec.over) return;
        if (rt < end && rec.compare(rt, big, ex) > 0) big = rt;
        if (rec.over) return;
        if (big === r) return;
        rec.swap(r, big, ex);
        r = big;
      }
    }

    for (var i = (n >> 1) - 1; i >= 0; i--) sift(i, n);
    for (var e = n - 1; e > 0; e--) {
      if (rec.over) return;
      rec.swap(0, e, { heap: e, root: 0 });
      rec.seal(e, e, '최댓값을 뒤에 확정');
      sift(0, e);
    }
    if (n > 0) rec.seal(0, 0, '남은 하나 — 확정');
  }

  var RUNNER = {
    bubble: runBubble, insertion: runInsertion, selection: runSelection,
    merge: runMerge, quick: runQuick, heap: runHeap
  };

  /* 한 알고리즘을 끝까지 돌려 기록을 만든다.
   * **정렬 결과가 실제로 오름차순인지 여기서 확인한다.** 위젯이 거짓말을 하면
   * 안 되므로(계약 §9) 정렬하지 못한 기록에는 표식을 남겨 화면에 띄운다. */
  function record(key, base) {
    var rec = new Rec(base);
    RUNNER[key](rec);
    rec.finish();
    var okSorted = true, i;
    for (i = 1; i < rec.n; i++) if (rec.a[i - 1] > rec.a[i]) okSorted = false;
    // 다중집합까지 같은지 — 값을 잃어버리거나 복제하지 않았는가
    var s1 = Array.prototype.slice.call(base).sort(function (x, y) { return x - y; });
    for (i = 0; i < rec.n; i++) if (s1[i] !== rec.a[i]) okSorted = false;
    return {
      key: key, name: NAME[key],
      steps: rec.steps, cmp: rec.cmp, mv: rec.mv,
      out: rec.a, sorted: okSorted, truncated: rec.over
    };
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('sorting-race', function (host, opts) {
    if (!opts || typeof opts !== 'object') opts = {};

    // ---- opts 검증. 본문 저자가 손으로 쓴 JSON 이라 신뢰하지 않는다(계약 §1) ----
    var n = clampInt(opts.n, MIN_N, MAX_N, 40);

    var algos = [];
    if (isArr(opts.algos)) {
      for (var ai = 0; ai < opts.algos.length; ai++) {
        var a = opts.algos[ai];
        if (ALGOS.indexOf(a) >= 0 && algos.indexOf(a) < 0) algos.push(a);
      }
    }
    if (!algos.length) algos = DEFAULT_ALGOS.slice();
    if (algos.length > 6) algos = algos.slice(0, 6);

    var preset = 'random';
    if (typeof opts.input === 'string') {
      preset = PRESET_ALIAS[opts.input.trim().toLowerCase()] || 'random';
    }

    // counters: 어느 카운터를 띄울지. 둘 다가 기본이다.
    var showCmp = true, showMv = true;
    if (isArr(opts.counters) && opts.counters.length) {
      var wantC = false, wantM = false;
      for (var ci = 0; ci < opts.counters.length; ci++) {
        var c = String(opts.counters[ci]).toLowerCase();
        if (c === 'compare' || c === 'cmp' || c === 'comparison' || c === '비교') wantC = true;
        if (c === 'swap' || c === 'move' || c === 'write' || c === '교환' || c === '이동') wantM = true;
      }
      if (wantC || wantM) { showCmp = wantC; showMv = wantM; }
    }

    var seed = clampInt(opts.seed, 1, 1 << 30, 20260804);

    // ---- 상태 ----
    var base = makeInput(preset, n, seed);
    var panes = [];
    var total = 1;
    var maxVal = 1;
    var focus = algos[0];
    var layout = null;
    var cur = 0;
    var bestCmp = 0, bestMv = 0;

    function recompute() {
      base = makeInput(preset, n, seed);
      maxVal = 1;
      for (var v = 0; v < n; v++) if (base[v] > maxVal) maxVal = base[v];
      panes = [];
      var longest = 1;
      bestCmp = Infinity; bestMv = Infinity;
      for (var i = 0; i < algos.length; i++) {
        var p = record(algos[i], base);
        panes.push(p);
        if (p.steps.length > longest) longest = p.steps.length;
        if (p.cmp < bestCmp) bestCmp = p.cmp;
        if (p.mv < bestMv) bestMv = p.mv;
      }
      total = longest;
    }
    recompute();

    function paneOf(key) {
      for (var i = 0; i < panes.length; i++) if (panes[i].key === key) return panes[i];
      return panes[0];
    }
    function stepOf(p, i) {
      return p.steps[Math.min(i, p.steps.length - 1)];
    }
    function isDone(p, i) { return i >= p.steps.length - 1; }

    // ---- 껍데기 ----
    var ui = K.frame(host, { title: '정렬 경주 — 같은 배열, 다른 전략', wide: true });

    // 입력 프리셋. 이 세그먼트가 이 위젯에서 가장 중요한 컨트롤이다 —
    // 순위가 입력에 따라 뒤집히는 것을 보여주는 것이 §2.1 의 결론이기 때문이다.
    K.seg(ui.slot, PRESETS.map(function (p) {
      return { label: PRESET_LABEL[p], value: p };
    }), preset, function (v) {
      preset = v;
      recompute();
      player.goto(0);
    });

    // 초점 알고리즘. 상태 줄이 설명하는 대상이고, 좁은 화면에서는 유일하게
    // 막대로 그려지는 패널이다.
    var focusSeg = K.seg(ui.slot, algos.map(function (k) {
      return { label: NAME[k], value: k };
    }), focus, function (v) {
      focus = v;
      layout = null;
      player.goto(cur);
    });

    // ---- 범례 + 카운터 정의 ----
    // 정의를 화면에 띄우지 않으면 두 숫자가 무엇을 센 것인지 독자가 알 수 없고,
    // 그러면 비교 자체가 성립하지 않는다.
    var legend = K.el('div', 'wk-legend');
    [
      ['--w-frontier', '지금 견주는 두 원소'],
      ['--box-warn', '방금 값이 바뀐 칸'],
      ['--w-visited', '정렬이 끝난 구간'],
      ['--w-path', '전체 완료']
    ].forEach(function (p) {
      var s = K.el('span');
      var i = K.el('i');
      i.style.background = 'var(' + p[0] + ')';
      s.appendChild(i);
      s.appendChild(document.createTextNode(p[1]));
      legend.appendChild(s);
    });
    ui.root.insertBefore(legend, ui.ctl);

    var defline = K.el('div', 'wk-legend');
    defline.appendChild(K.el('span', null,
      '비교 = 원소 두 개(또는 원소와 손에 든 키)의 값을 견준 횟수. 인덱스·경계 검사는 세지 않는다.'));
    defline.appendChild(K.el('span', null,
      '이동 = 배열 칸의 값이 실제로 바뀐 쓰기 횟수. 교환 1회 = 2, 보조 배열에 쓰는 것도 센다.'));
    ui.root.insertBefore(defline, ui.ctl);

    var presetLine = K.el('div', 'wk-legend');
    var presetSpan = K.el('span', null, '');
    presetLine.appendChild(presetSpan);
    ui.root.insertBefore(presetLine, ui.ctl);

    // ---- 배치 ----
    /* 폭에 따라 패널 개수를 바꾼다(계약 §4). grid-search 와 같은 판단이다.
     *   ≥1200px  알고리즘이 5개 이상이면 3열, 아니면 2열
     *   700~1200 2열
     *   <700px   **막대는 초점 패널 하나만.** 40개 막대를 네 패널에 우겨넣으면
     *            막대 폭이 3px 아래로 내려가 무엇이 정렬됐는지조차 안 보인다.
     *            폰에서는 막대 비교를 포기하고 **카운터 표**를 남긴다 —
     *            이 위젯의 결론은 애초에 막대가 아니라 숫자이므로,
     *            잃는 것보다 지키는 것이 크다. */
    function computeLayout(w) {
      var narrow = w < 700;
      var list = narrow ? [focus] : algos.slice();
      var cnt = list.length;
      var gcols = narrow ? 1 : (w >= 1200 && cnt >= 5 ? 3 : Math.min(2, cnt));
      var grows = Math.ceil(cnt / gcols);
      var gap = narrow ? 10 : GAP;
      var paneW = Math.floor((w - gap * (gcols - 1)) / gcols);
      if (paneW < 120) paneW = 120;

      var barsH = w >= 1000 ? 140 : (w >= 700 ? 116 : 128);
      var paneH = HEAD + barsH + MARK + PAD * 2;

      var bw = (paneW - PAD * 2) / n;
      var summaryH = narrow ? (18 + algos.length * 15) : 0;

      return {
        w: w, list: list, gcols: gcols, grows: grows, gap: gap,
        paneW: paneW, paneH: paneH, barsH: barsH, bw: bw,
        narrow: narrow, summaryH: summaryH,
        height: grows * paneH + gap * (grows - 1) + summaryH + 2
      };
    }

    function layoutFor(w) {
      if (!layout || layout.w !== w) layout = computeLayout(w);
      return layout;
    }

    function paneBox(L, idx) {
      var col = idx % L.gcols, row = (idx / L.gcols) | 0;
      return {
        x: col * (L.paneW + L.gap),
        y: row * (L.paneH + L.gap)
      };
    }

    // ---- 그리기 ----
    function draw(ctx, size, T) {
      var L = layoutFor(size.w);
      presetSpan.textContent = '입력: ' + PRESET_NOTE[preset] + ' · n = ' + n;
      ctx.textBaseline = 'alphabetic';
      for (var p = 0; p < L.list.length; p++) drawPane(ctx, T, L, p, paneOf(L.list[p]));
      if (L.narrow) drawSummary(ctx, T, L);
    }

    function counterText(p, i) {
      var s = stepOf(p, i);
      var parts = [];
      if (showCmp) parts.push('비교 ' + s.cmp);
      if (showMv) parts.push('이동 ' + s.mv);
      return parts.join(' · ');
    }

    function drawPane(ctx, T, L, idx, p) {
      var box = paneBox(L, idx);
      var s = stepOf(p, cur);
      var done = isDone(p, cur);
      var isFocus = p.key === focus;
      var x0 = box.x + PAD, y0 = box.y + HEAD;

      // ── 머리줄 ──
      ctx.font = '700 12px ' + FONT;
      ctx.fillStyle = isFocus ? T.accent : T.fg;
      ctx.textAlign = 'left';
      ctx.fillText(p.name, box.x + PAD, box.y + 13);
      var nameW = ctx.measureText(p.name).width;
      ctx.font = '10.5px ' + FONT;
      ctx.fillStyle = T.fgFaint;
      if (L.paneW > 250) {
        ctx.fillText('— ' + RULE[p.key] + ' · ' + BIG_O[p.key], box.x + PAD + nameW + 6, box.y + 13);
      } else if (L.paneW > 170) {
        ctx.fillText('— ' + BIG_O[p.key], box.x + PAD + nameW + 6, box.y + 13);
      }

      // 카운터줄. 이 두 숫자가 위젯의 결론이다.
      ctx.font = '700 11.5px ' + MONO;
      var line = counterText(p, cur);
      if (done) {
        ctx.fillStyle = T.wPath;
        line = '✓ ' + line;
      } else {
        ctx.fillStyle = T.fgDim;
      }
      ctx.fillText(line, box.x + PAD, box.y + 27);
      if (done && L.paneW > 210) {
        var tail = [];
        if (showCmp && p.cmp === bestCmp) tail.push('비교 최소');
        if (showMv && p.mv === bestMv) tail.push('이동 최소');
        if (!p.sorted) tail.push('정렬 실패');
        if (p.truncated) tail.push('스텝 상한에서 잘림');
        if (tail.length) {
          var tx = box.x + PAD + ctx.measureText(line).width + 22;
          ctx.font = '700 10.5px ' + FONT;
          var tt = '← ' + tail.join(' · ');
          // 패널 폭을 넘으면 아예 그리지 않는다. 잘린 글자는 없느니만 못하다.
          if (tx + ctx.measureText(tt).width <= box.x + L.paneW - PAD) {
            ctx.fillStyle = (!p.sorted || p.truncated) ? T.boxDanger : T.wPath;
            ctx.fillText(tt, tx, box.y + 27);
          }
        }
      }

      // ── 막대 ──
      var bw = L.bw, i;
      var arr = s.arr, srt = s.srt;
      var baseY = y0 + L.barsH;

      // 병합 중 보조 배열로 옮겨진 칸 = 이 스텝에서 이미 가져간 구간
      var goneLo = -1, goneHi = -1, goneLo2 = -1, goneHi2 = -1;
      if (s.p !== undefined && s.lo !== undefined) {
        goneLo = s.lo; goneHi = s.p;       // [lo, p)
        goneLo2 = s.mid; goneHi2 = s.q;    // [mid, q)
      }

      for (i = 0; i < n; i++) {
        var v = arr[i];
        var h = Math.max(2, Math.round((v / maxVal) * (L.barsH - 2)));
        var bx = x0 + i * bw;
        var bwv = Math.max(1, bw - (bw > 4 ? 1.2 : 0.4));

        // 아직 정렬 안 된 칸은 옅은 회색, 정렬된 구간은 진한 파랑. 두 색의 명도
        // 차이가 크지 않아(라이트에서 특히) 농도까지 함께 벌려야 구간 경계가 읽힌다.
        var color = T.fgFaint, alpha = 0.55;
        if (done) { color = T.wPath; alpha = 0.9; }
        else if (srt[i]) { color = T.wVisited; alpha = 1; }

        // 현재 사건에 걸린 칸은 색을 덮어쓴다. 우선순위: 쓰기 > 비교.
        if (!done) {
          if ((s.t === 'cmp' && (i === s.i || i === s.j)) ||
              (s.t === 'cmpk' && i === s.i)) { color = T.wFrontier; alpha = 1; }
          if (s.t === 'take' && i === s.i) { color = T.boxWarn; alpha = 1; }
          if ((s.t === 'wr' && i === s.i) || (s.t === 'sw' && (i === s.i || i === s.j))) {
            color = s.noop ? T.wFrontier : T.boxWarn; alpha = 1;
          }
          // 퀵의 피벗은 색이 아니라 아래 표식(P)으로 구분한다. 색을 하나 더
          // 쓰면 "비교/쓰기/확정" 세 역할이 흐려진다(계약 §3).
        }

        // 병합에서 보조 배열로 이미 옮겨간 칸은 옅게. 막대가 남아 있지만
        // 논리적으로는 이 자리를 떠났다는 뜻이다.
        if (!done && ((i >= goneLo && i < goneHi) || (i >= goneLo2 && i < goneHi2))) alpha *= 0.3;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillRect(bx, baseY - h, bwv, h);
      }
      ctx.globalAlpha = 1;

      // 활성 구간을 밑줄로 표시한다. 병합의 hi 는 열린 끝이고 퀵의 hi 는 닫힌 끝이라
      // 마지막 칸을 서로 다르게 잡는다. 'seal' 은 확정 사건이지 활성 구간이 아니다.
      if (!done && s.t !== 'seal' && s.lo !== undefined && s.hi !== undefined) {
        var rlo = s.lo, rhi = (s.mid !== undefined ? s.hi - 1 : s.hi);
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = T.wFrontier;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 + rlo * bw, baseY + 2.5);
        ctx.lineTo(x0 + (rhi + 1) * bw - 1, baseY + 2.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // 힙 정렬의 "아직 힙인 구간"도 같은 밑줄로 보인다.
      if (!done && s.heap !== undefined && s.heap > 0) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = T.wFrontier;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, baseY + 2.5);
        ctx.lineTo(x0 + s.heap * bw - 1, baseY + 2.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 바닥선
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, baseY + 0.5);
      ctx.lineTo(x0 + n * bw, baseY + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // ── 표식 띠 ── 색을 구분하지 못해도 무슨 일이 일어나는지 읽히게 한다(계약 §5).
      if (!done) drawMarks(ctx, T, L, s, x0, baseY + MARK - 3, bw);

      // 손에 든 키(삽입 정렬). 배열에서 들어낸 값이라 막대 줄 위에 띄운다.
      if (!done && s.key !== undefined && s.kx !== undefined && s.kx >= 0 && s.kx < n) {
        var kh = Math.max(2, Math.round((s.key / maxVal) * (L.barsH - 2)));
        var kx = x0 + s.kx * bw;
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = T.wPath;
        ctx.setLineDash([3, 2]);
        ctx.lineWidth = 1.4;
        ctx.strokeRect(kx + 0.5, baseY - kh + 0.5, Math.max(2, bw - 1.2), kh);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // 패널 테두리. 초점 패널만 액센트로 — 상태 줄이 설명하는 대상을 잇는다.
      ctx.strokeStyle = isFocus ? T.accent : T.border;
      ctx.lineWidth = isFocus ? 2 : 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, L.paneW - 1, L.paneH - 1);
    }

    /* 막대 아래 표식. 폭이 넉넉하면 글자, 좁으면 **모양**으로 구분한다.
     * 좁은 폭에서 전부 같은 삼각형을 쓰면 색만 다른 표식이 되어, 색을 구분하지
     * 못하는 독자에게는 아무 정보도 남지 않는다(계약 §5). 그래서 사건 종류마다
     * 다른 도형을 준다: 빈 삼각 = 견줌, 채운 삼각 = 씀, 마름모 = 손에 든 키, 사각 = 피벗. */
    function drawMarks(ctx, T, L, s, x0, y, bw) {
      var small = bw < 9;
      ctx.font = '700 ' + (small ? 8 : 9.5) + 'px ' + MONO;
      ctx.textAlign = 'center';

      function shape(cx, kind, color) {
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        if (kind === 'square') {
          ctx.rect(cx - 2.5, y - 5.5, 5, 5);
          ctx.fill();
          return;
        }
        if (kind === 'diamond') {
          ctx.moveTo(cx, y - 7); ctx.lineTo(cx + 3.2, y - 3.5);
          ctx.lineTo(cx, y); ctx.lineTo(cx - 3.2, y - 3.5);
          ctx.closePath();
          ctx.fill();
          return;
        }
        ctx.moveTo(cx, y - 6.5);
        ctx.lineTo(cx - 3.2, y - 1);
        ctx.lineTo(cx + 3.2, y - 1);
        ctx.closePath();
        if (kind === 'hollow') ctx.stroke(); else ctx.fill();
      }

      function put(i, ch, color, kind) {
        if (i == null || i < 0 || i >= n) return;
        // 퀵 정렬은 언제나 피벗과 견주므로 피벗 칸에 표식이 두 개 겹친다.
        // 그 칸에서는 'P' 만 남긴다 — 피벗이라는 사실이 더 많은 것을 설명한다.
        if (s.pivot !== undefined && i === s.pivot && kind !== 'square') return;
        var cx = x0 + i * bw + bw / 2;
        if (small) shape(cx, kind, color);
        else { ctx.fillStyle = color; ctx.fillText(ch, cx, y); }
      }

      if (s.t === 'cmp') { put(s.i, '↑', T.wFrontier, 'hollow'); put(s.j, '↑', T.wFrontier, 'hollow'); }
      else if (s.t === 'cmpk') { put(s.i, '↑', T.wFrontier, 'hollow'); put(s.kx, '키', T.wPath, 'diamond'); }
      else if (s.t === 'lift') { put(s.i, '키', T.wPath, 'diamond'); }
      else if (s.t === 'sw') { put(s.i, '⇄', T.boxWarn, 'fill'); put(s.j, '⇄', T.boxWarn, 'fill'); }
      else if (s.t === 'wr') { put(s.i, '쓰', T.boxWarn, 'fill'); if (s.kx !== undefined) put(s.kx, '키', T.wPath, 'diamond'); }
      else if (s.t === 'take') { put(s.i, '↑', T.boxWarn, 'fill'); }
      if (s.pivot !== undefined) put(s.pivot, 'P', T.wGoal, 'square');
      ctx.textAlign = 'left';
    }

    /* 좁은 화면 전용 카운터 표. 막대를 포기한 대가로 반드시 남겨야 하는 것 —
     * 이 위젯의 주장은 숫자에 있다. */
    function drawSummary(ctx, T, L) {
      var y = L.grows * L.paneH + L.gap + 8;
      ctx.font = '700 10.5px ' + FONT;
      ctx.fillStyle = T.fgDim;
      ctx.textAlign = 'left';
      ctx.fillText('다른 알고리즘의 카운터 (막대는 초점 패널만 그린다)', PAD, y);
      y += 14;
      ctx.font = '11px ' + MONO;
      for (var i = 0; i < panes.length; i++) {
        var p = panes[i];
        var done = isDone(p, cur);
        ctx.fillStyle = p.key === focus ? T.accent : (done ? T.wPath : T.fgDim);
        ctx.fillText((done ? '✓ ' : '  ') + p.name + '  ' + counterText(p, cur), PAD, y);
        y += 15;
      }
    }

    // ---- 캔버스 ----
    var canvas = K.canvas(ui.stage, {
      height: function (w) { return layoutFor(w).height; },
      draw: draw
    });

    // ---- 상태 줄 ----
    function valAt(s, i) { return s.arr[i]; }

    // "a[3](=12)" 뒤에 붙는 조사는 괄호 안의 **값**을 읽은 소리를 따른다.
    // 화면이 읽어 주는 문장이라 조사가 틀리면 그대로 눈에 띈다.
    function cell(s, i) { return 'a[' + i + '](=' + valAt(s, i) + ')'; }

    function describe(p, i) {
      var s = stepOf(p, i);
      var nm = p.name;
      if (s.t === 'init') {
        return nm + ' — 시작 상태. ' + panes.length + '개 알고리즘이 모두 같은 배열(' +
          PRESET_LABEL[preset] + ', n=' + n + ')을 받는다. 비교도 이동도 아직 0이다.';
      }
      if (s.t === 'cmp') {
        var vi = valAt(s, s.i), vj = valAt(s, s.j);
        var rel = vi === vj ? '같다' : (vi > vj ? '더 크다' : '더 작다');
        var head = nm + ' — ' + cell(s, s.i) + (jong(vi) ? '과 ' : '와 ') +
          cell(s, s.j) + (jong(vj) ? '을' : '를') + ' 견준다. ' + iga(vi) + ' ' + rel + '.';
        if (s.pivot !== undefined) head += ' 피벗은 ' + cell(s, s.pivot) + '.';
        if (s.mid !== undefined) head += ' 두 런 [' + s.lo + ',' + s.mid + ')과 [' + s.mid + ',' + s.hi + ')을 합치는 중이다.';
        if (s.heap !== undefined) head += ' 힙 구간은 0..' + (s.heap - 1) + '.';
        return head + ' (비교 ' + s.cmp + ')';
      }
      if (s.t === 'cmpk') {
        var v = valAt(s, s.i);
        return nm + ' — 손에 든 키 ' + ul(s.key) + ' ' + cell(s, s.i) + (jong(v) ? '과' : '와') + ' 견준다. ' +
          (v > s.key ? iga(v) + ' 더 크므로 한 칸 오른쪽으로 민다.' : '키가 들어갈 자리를 찾았다.') +
          ' (비교 ' + s.cmp + ')';
      }
      if (s.t === 'lift') {
        return nm + ' — a[' + s.i + '](=' + s.key + ')' + (jong(s.key) ? '을' : '를') +
          ' 손에 들어낸다. 이 자리가 빈칸이 되고, ' +
          '앞의 정렬 구간에서 들어갈 곳을 찾는다. 아직 배열은 바뀌지 않았다.';
      }
      if (s.t === 'wr') {
        if (s.noop) return nm + ' — a[' + s.i + ']에 ' + ul(s.val) + ' 쓴다. 이미 같은 값이라 바뀐 것이 없다(이동 ' + s.mv + ').';
        if (s.drop) return nm + ' — 손에 든 키 ' + ul(s.key) + ' a[' + s.i + ']에 내려놓는다. 앞 구간이 다시 정렬 상태다. (이동 ' + s.mv + ')';
        if (s.back !== undefined) return nm + ' — 보조 배열의 값 ' + ul(s.val) + ' a[' + s.i + ']에 되쓴다. 여기서 막대가 실제로 움직인다. (이동 ' + s.mv + ')';
        return nm + ' — a[' + s.i + ']에 ' + ul(s.val) + ' 쓴다. 한 칸 밀렸다. (이동 ' + s.mv + ')';
      }
      if (s.t === 'sw') {
        if (s.noop) {
          return nm + ' — a[' + s.i + ']' + (jong(s.i) ? '과 ' : '와 ') + 'a[' + s.j + ']' +
            (jong(s.j) ? '을' : '를') + ' 맞바꾼다. 값이 같아 실제로 바뀐 것은 없다. (이동 ' + s.mv + ')';
        }
        // 교환 스텝의 스냅샷은 이미 바뀐 뒤다. 문장은 "무엇과 무엇을" 이므로
        // 바뀐 뒤의 값을 서로 바꿔 읽어야 사건 직전의 배치를 가리킨다.
        var av = valAt(s, s.j), bv = valAt(s, s.i);
        return nm + ' — a[' + s.i + '](=' + av + ')' + (jong(av) ? '과 ' : '와 ') +
          'a[' + s.j + '](=' + bv + ')' + (jong(bv) ? '을' : '를') +
          ' 맞바꾼다. 교환 한 번은 쓰기 두 번이다. (이동 ' + s.mv + ')';
      }
      if (s.t === 'take') {
        var tv = valAt(s, s.i);
        return nm + ' — ' + cell(s, s.i) + (jong(tv) ? '을' : '를') + ' 보조 배열로 가져간다. ' +
          '보조 배열에 쓰는 것도 이동이다 — 병합 정렬의 O(n) 추가 메모리가 이 칸에 드러난다. (이동 ' + s.mv + ')';
      }
      if (s.t === 'seal') {
        return nm + ' — 구간 ' + s.lo + '..' + s.hi + (jong(s.hi) ? '이' : '가') + ' 정렬 상태로 확정됐다' +
          (s.why ? ' (' + s.why + ')' : '') + '.';
      }
      if (s.t === 'done') {
        var nlogn = Math.round(n * Math.log(n) / Math.LN2);
        var nn = Math.round(n * n / 4);
        var t = nm + ' 정렬 완료. 비교 ' + p.cmp + '회, 이동 ' + p.mv + '회.';
        t += ' 참고: n log₂ n ≈ ' + nlogn + ', n²/4 ≈ ' + nn + '.';
        if (!p.sorted) t += ' ⚠ 결과가 오름차순이 아니다.';
        if (p.truncated) t += ' ⚠ 스텝 상한에서 잘렸다.';
        return t;
      }
      return nm + ' — ' + s.t;
    }

    function label(i) {
      var s = describe(paneOf(focus), i);
      var parts = [];
      for (var p = 0; p < panes.length; p++) {
        var q = panes[p];
        var st = stepOf(q, i);
        var one = q.name + ' ';
        if (showCmp) one += st.cmp;
        if (showCmp && showMv) one += '/';
        if (showMv) one += st.mv;
        if (isDone(q, i)) one += '(완료)';
        parts.push(one);
      }
      var head = '▸ ' + (showCmp && showMv ? '비교/이동' : (showCmp ? '비교' : '이동')) + ' — ';
      return s + '  ' + head + parts.join(' / ') + '.';
    }

    // ---- 재생기 ----
    var player = K.player(ui, {
      total: function () { return total; },
      render: function (i) { cur = i; canvas.redraw(); },
      label: label,
      speed: 260
    });

    // 테스트·디버깅용 훅. 계약상 전역 오염은 금지라 host 요소에만 붙인다.
    host.__sortingRace = {
      algos: function () { return algos.slice(); },
      preset: function () { return preset; },
      setPreset: function (v) {
        var p = PRESET_ALIAS[String(v).toLowerCase()];
        if (!p) return false;
        preset = p;
        recompute();
        player.goto(0);
        return true;
      },
      setFocus: function (v) {
        if (algos.indexOf(v) < 0) return false;
        focus = v; layout = null; player.goto(cur);
        return true;
      },
      input: function () { return Array.prototype.slice.call(base); },
      panes: function () {
        return panes.map(function (p) {
          return {
            key: p.key, cmp: p.cmp, mv: p.mv, steps: p.steps.length,
            sorted: p.sorted, truncated: p.truncated,
            out: Array.prototype.slice.call(p.out)
          };
        });
      },
      /* 모든 알고리즘 × 모든 프리셋이 실제로 정렬하는가.
       * 위젯이 화면에서 거짓말을 하지 않는지 브라우저에서 직접 검사하는 통로다. */
      verify: function (sizes) {
        var out = [], list = sizes && sizes.length ? sizes : [6, 7, 12, 17, 32, 40, 48];
        for (var si = 0; si < list.length; si++) {
          var nn = clampInt(list[si], MIN_N, MAX_N, 12);
          for (var pi = 0; pi < PRESETS.length; pi++) {
            var inp = makeInput(PRESETS[pi], nn, 12345 + si * 7 + pi);
            var want = Array.prototype.slice.call(inp).sort(function (x, y) { return x - y; });
            for (var ki = 0; ki < ALGOS.length; ki++) {
              var r = record(ALGOS[ki], inp);
              var got = Array.prototype.slice.call(r.out);
              var same = got.length === want.length;
              for (var z = 0; same && z < got.length; z++) if (got[z] !== want[z]) same = false;
              out.push({
                algo: ALGOS[ki], preset: PRESETS[pi], n: nn,
                ok: same && r.sorted && !r.truncated,
                cmp: r.cmp, mv: r.mv, steps: r.steps.length, truncated: r.truncated
              });
            }
          }
        }
        return out;
      },
      total: function () { return total; },
      goto: function (i) { player.goto(i); },
      layout: function () { return layoutFor(canvas.size.w || 320); }
    };

    player.goto(0);
  });
})();

/* ==== state-machine.js ==== */
/* state-machine.js — 상태 기계: 상태 그래프 + 전이 격자
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **그래프는 "어디로 갈 수 있는가"를 보이고, 격자는 "어디로 갈 수 없는가"를 보인다.**
 * 둘을 나란히 놓는 이유가 그것이다. 그래프만 보면 빈칸이 보이지 않는다. XII-8 §1 의
 * 버그(`can_edit` 하나를 놓쳐 paused × edit 이 열려 버린 것)는 격자에서만 눈에 띈다.
 * 그래서 격자는 장식이 아니라 이 위젯의 절반이다.
 *
 * 왜 거부된 이벤트를 건너뛰지 않고 그리는가
 *   거부는 오류가 아니라 이 기계의 정상 동작이다. 조회에 실패하면 아무것도 바꾸지
 *   않고 넘어간다 — 상태도, 진입 동작도, 타이머도. 그 "아무 일도 일어나지 않음"을
 *   스텝으로 보여 주지 않으면 독자는 거부를 예외 처리로 오해한다. 격자의 빈칸에
 *   × 를 찍는 것이 곧 "여기 규칙이 없어서 막혔다"는 문장이다.
 *
 * 왜 타이머를 상태에서 계산하는가
 *   opts 에 타이머 필드는 없다. 있어서도 안 된다 — 본문 §3 의 요점이 ==타이머를
 *   만지는 코드가 진입 동작 한 곳뿐==이라는 것이고, 그렇다면 타이머는 이력이 아니라
 *   **현재 상태의 함수**다. 그래서 진입 동작 문자열("타이머 시작" / "타이머 정지")에서
 *   플래그 이름을 뽑아 내고, 값은 매 스텝 현재 상태에서 다시 계산한다. 이력으로
 *   누적하면 상태와 어긋나는 조합을 위젯이 스스로 만들어 낼 수 있는데, 그것이 바로
 *   본문이 경고하는 사고다.
 *
 * kind 에 대하여
 *   지금은 `kind:"fsm"`(평면 상태 기계)만 그린다. XI-6 이 계층적 상태 기계와
 *   Behavior Tree 에 같은 위젯 타입을 쓰므로, 모델은 상태·전이·이벤트만으로 서술되고
 *   렌더러(그래프 배치·격자)는 그 모델만 읽도록 분리해 두었다. 새 kind 는 모델에
 *   부모/자식 관계를 얹고 배치 함수를 하나 더 붙이는 일이 된다. 모르는 kind 가 오면
 *   던지지 않고 평면 FSM 으로 그린 뒤 그 사실을 캔버스에 적는다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 상한. "많이 보여주기"보다 "읽히게 보여주기"가 먼저다(계약 §4).
  var MAX_STATES = 12;
  var MAX_EVENTS = 12;
  var MAX_SCRIPT = 40;      // 계약 §7: 스텝 수 상한 (스텝은 최대 이것 + 1)
  var MAX_LABEL = 14;

  var MONO = 'ui-monospace, monospace';
  var SANS = 'system-ui, sans-serif';

  // ---------------------------------------------------------------- opts 검증
  //
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 무엇이 들어와도 던지지 않는다(계약 §1).

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function str(v) {
    if (typeof v === 'string') { var s = v.trim(); return s || null; }
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return null;
  }

  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // 글자 폭 추정. 배치 계산은 ctx 없이도 돌아야 캐시가 폭에만 의존한다.
  // 한글은 고정폭에서 두 칸을 차지한다(§4-9 의 그 사실이 캔버스에서도 같다).
  function estW(s, fs) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += (s.charCodeAt(i) > 0x2E80) ? fs : fs * 0.6;
    }
    return w;
  }

  // ---------------------------------------------------------------- 조사
  //
  // 상태 이름이 영문이라 받침 판정이 눈에 보이지 않는다. 읽는 소리를 기준으로 한다.
  //   running → 러닝(ㅇ 받침) → "running 으로"
  //   done    → 던(ㄴ 받침)   → "done 으로"      (끝의 e 는 묵음이라 n 을 본다)
  //   paused  → 포즈드         → "paused 로"
  // 상태 줄은 스크린리더가 읽는 문장이다. 조사가 틀리면 그대로 귀에 걸린다.

  function tailSound(s) {
    if (!s) return { jong: false, rieul: false };
    var last = s.charAt(s.length - 1);
    if (last >= '0' && last <= '9') {
      return { jong: '013678'.indexOf(last) >= 0, rieul: '178'.indexOf(last) >= 0 };
    }
    var code = s.charCodeAt(s.length - 1);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      var j = (code - 0xAC00) % 28;
      return { jong: j !== 0, rieul: j === 8 };
    }
    var t = s.toLowerCase();
    var c = t.charAt(t.length - 1);
    // 묵음 e: 앞이 자음이면 그 자음이 실제 끝소리다 (done → n, idle → l).
    if (c === 'e' && t.length >= 2 && 'aeiouy'.indexOf(t.charAt(t.length - 2)) < 0) {
      c = t.charAt(t.length - 2);
      t = t.slice(0, -1);
    }
    if (c === 'l') return { jong: true, rieul: true };
    if (c === 'm' || c === 'n') return { jong: true, rieul: false };
    if (c === 'g' && t.charAt(t.length - 2) === 'n') return { jong: true, rieul: false };
    // 나머지 자음은 '으'가 붙어 소리 나므로 받침이 없다 (paused → 포즈드).
    return { jong: false, rieul: false };
  }

  function eul(s) { return s + (tailSound(s).jong ? '을' : '를'); }
  function eun(s) { return s + (tailSound(s).jong ? '은' : '는'); }
  function ga(s) { return s + (tailSound(s).jong ? '이' : '가'); }
  function ro(s) {
    var t = tailSound(s);
    return s + (t.jong && !t.rieul ? '으로' : '로');
  }

  // ---------------------------------------------------------------- 기본 기계
  //
  // opts 가 비어 있을 때 쓰는 기계. XII-8 의 작업 오더를 그대로 쓴다 — 이 위젯이
  // 설명하는 대상이 그것이고, 빈 opts 로도 챕터와 같은 그림이 나오는 편이 낫다.

  var DEFAULT_MACHINE = {
    title: '작업 오더',
    states: [
      { id: 'created', label: 'created', initial: true },
      { id: 'assigned', label: 'assigned', note: '로봇 배차' },
      { id: 'running', label: 'running', note: '타이머 시작' },
      { id: 'paused', label: 'paused', note: '타이머 정지' },
      { id: 'done', label: 'done', terminal: true, note: '정산' },
      { id: 'canceled', label: 'canceled', terminal: true, note: '정산' }
    ],
    events: ['assign', 'start', 'pause', 'resume', 'finish', 'cancel', 'edit'],
    transitions: [
      { from: 'created', on: 'assign', to: 'assigned' },
      { from: 'created', on: 'cancel', to: 'canceled' },
      { from: 'created', on: 'edit', to: 'created' },
      { from: 'assigned', on: 'start', to: 'running' },
      { from: 'assigned', on: 'cancel', to: 'canceled' },
      { from: 'assigned', on: 'edit', to: 'assigned' },
      { from: 'running', on: 'pause', to: 'paused' },
      { from: 'running', on: 'finish', to: 'done' },
      { from: 'running', on: 'cancel', to: 'canceled' },
      { from: 'paused', on: 'resume', to: 'running' },
      { from: 'paused', on: 'cancel', to: 'canceled' }
    ],
    script: ['assign', 'start', 'pause', 'finish', 'resume', 'finish', 'cancel']
  };

  // "타이머 시작" 류의 진입 동작에서 플래그 이름을 뽑는다.
  var ON_RE = /^(.+?)\s*(시작|가동|켜기|start|on)$/i;

  function normStates(raw) {
    if (!isArr(raw)) return null;
    var out = [], seen = {};
    for (var i = 0; i < raw.length && out.length < MAX_STATES; i++) {
      var it = raw[i], id = null, label = null, note = null, ini = false, term = false;
      if (typeof it === 'string' || typeof it === 'number') {
        id = str(it);
      } else if (it && typeof it === 'object' && !isArr(it)) {
        id = str(it.id) || str(it.name) || str(it.label);
        label = str(it.label);
        note = str(it.note) || str(it.entry) || str(it.onEnter);
        ini = it.initial === true;
        term = it.terminal === true || it.final === true;
      }
      if (!id || seen[id]) continue;      // 중복 id 는 격자 행이 겹쳐 버린다
      seen[id] = true;
      out.push({
        id: id,
        label: clip(label || id, MAX_LABEL),
        note: note ? clip(note, 16) : null,
        initial: ini, terminal: term,
        out: [], layer: 0, row: 0
      });
    }
    return out.length ? out : null;
  }

  function normEvents(raw) {
    var out = [], seen = {};
    if (isArr(raw)) {
      for (var i = 0; i < raw.length && out.length < MAX_EVENTS; i++) {
        var e = str(raw[i]);
        if (!e || seen[e]) continue;
        seen[e] = true;
        out.push(clip(e, MAX_LABEL));
      }
    }
    return { list: out, seen: seen };
  }

  function buildModel(opts) {
    var states = normStates(opts.states);
    var src = opts;
    var usedDefault = false;

    // 상태 목록이 통째로 망가졌으면 기계 전체를 기본값으로 바꾼다.
    // 남의 전이 표를 남의 상태 목록에 붙이면 그림이 거짓말을 한다.
    if (!states) {
      src = DEFAULT_MACHINE;
      states = normStates(DEFAULT_MACHINE.states);
      usedDefault = true;
    }

    var idx = {};
    for (var i = 0; i < states.length; i++) idx[states[i].id] = i;

    var ev = normEvents(src.events);
    var events = ev.list, evSeen = ev.seen;

    // 전이. 알 수 없는 상태를 가리키는 줄은 **버린다.** 자동으로 상태를 만들어 주면
    // 오타가 조용히 새 상태가 되어 격자가 늘어난다 — 오히려 발견이 늦어진다.
    var trans = [], dropped = 0, tseen = {};
    var rawT = isArr(src.transitions) ? src.transitions : [];
    for (i = 0; i < rawT.length; i++) {
      var t = rawT[i], f = null, on = null, to = null;
      if (isArr(t) && t.length >= 3) { f = str(t[0]); on = str(t[1]); to = str(t[2]); }
      else if (t && typeof t === 'object') {
        f = str(t.from) || str(t.f);
        on = str(t.on) || str(t.event) || str(t.e);
        to = str(t.to) || str(t.t);
      }
      if (!f || !on || !to || idx[f] === undefined || idx[to] === undefined) { dropped++; continue; }
      on = clip(on, MAX_LABEL);
      var key = f + '\u0000' + on;   // 상태 이름에 공백이 있어도 키가 섞이지 않는다
      if (tseen[key]) { dropped++; continue; }   // (상태, 이벤트) 는 결정적이어야 한다
      tseen[key] = true;
      if (!evSeen[on]) {
        // events 에 없는 이벤트도 격자에 열이 있어야 한다. 열이 없으면 그 전이는
        // 그래프에만 있고 격자에는 없는 것이 되어 둘이 어긋난다.
        if (events.length >= MAX_EVENTS) { dropped++; tseen[key] = false; continue; }
        evSeen[on] = true;
        events.push(on);
      }
      trans.push({ from: idx[f], on: on, to: idx[to] });
    }
    if (!events.length) events = ['(이벤트 없음)'];

    var eidx = {};
    for (i = 0; i < events.length; i++) eidx[events[i]] = i;

    // 격자: matrix[s][e] = 도착 상태 인덱스, 없으면 -1. 채워진 칸 수는 정의상
    // 유효 전이 수와 같다 — 이 등식이 깨지면 위젯이 본문과 다른 말을 하는 것이다.
    var matrix = [], filled = 0;
    for (i = 0; i < states.length; i++) {
      var row = [];
      for (var j = 0; j < events.length; j++) row.push(-1);
      matrix.push(row);
    }
    for (i = 0; i < trans.length; i++) {
      matrix[trans[i].from][eidx[trans[i].on]] = trans[i].to;
      states[trans[i].from].out.push(i);
      filled++;
    }

    // 시작 상태 / 종료 상태
    var initial = 0;
    for (i = 0; i < states.length; i++) if (states[i].initial) { initial = i; break; }
    for (i = 0; i < states.length; i++) {
      if (!states[i].out.length) states[i].terminal = true;   // 나가는 간선이 0개면 종료다
    }

    // 진입 동작에서 플래그(타이머)를 뽑는다. 값은 상태의 함수다 — §3 참조.
    var flagName = null, flagOn = [];
    for (i = 0; i < states.length; i++) flagOn.push(false);
    for (i = 0; i < states.length; i++) {
      var m = states[i].note && ON_RE.exec(states[i].note);
      if (m && m[1]) { flagName = m[1].trim(); break; }
    }
    if (flagName) {
      var low = flagName.toLowerCase();
      for (i = 0; i < states.length; i++) {
        var mm = states[i].note && ON_RE.exec(states[i].note);
        flagOn[i] = !!(mm && mm[1] && mm[1].trim().toLowerCase() === low);
      }
    }

    // 스크립트. 격자에 열이 없는 이벤트는 보여 줄 자리가 없으므로 뺀다.
    var script = [];
    var rawS = isArr(src.script) ? src.script : (isArr(opts.script) ? opts.script : []);
    for (i = 0; i < rawS.length && script.length < MAX_SCRIPT; i++) {
      var s = str(rawS[i]);
      if (s && eidx[clip(s, MAX_LABEL)] !== undefined) script.push(clip(s, MAX_LABEL));
    }
    if (!script.length) script = autoScript(states, trans, events, initial);

    var model = {
      states: states, events: events, trans: trans, matrix: matrix,
      eidx: eidx, initial: initial, filled: filled, dropped: dropped,
      script: script, flagName: flagName, flagOn: flagOn,
      usedDefault: usedDefault
    };
    layerize(model);
    return model;
  }

  // 스크립트가 없으면 걸어 본다. 각 상태에서 아직 쓰지 않은 전이를 먼저 고른다 —
  // 그래야 짧은 스크립트로 기계의 많은 부분을 지난다.
  function autoScript(states, trans, events, initial) {
    var out = [], cur = initial, used = {}, guard = 0;
    while (guard++ < 12) {
      var pick = -1, fallback = -1, i;
      for (i = 0; i < trans.length; i++) {
        if (trans[i].from !== cur) continue;
        if (fallback < 0) fallback = i;
        if (!used[i]) { pick = i; break; }
      }
      if (pick < 0) pick = fallback;
      if (pick < 0) break;
      used[pick] = true;
      out.push(trans[pick].on);
      cur = trans[pick].to;
    }
    return out;
  }

  // 층 나누기: 시작 상태에서의 BFS 깊이를 층으로 삼되, **종료 상태는 마지막 층으로
  // 몰아 둔다.** canceled 처럼 어디서든 도달하는 흡수 상태를 BFS 깊이대로 앞쪽에
  // 두면 뒤쪽 상태에서 오는 간선이 전부 거꾸로 흘러 그림이 엉킨다.
  function layerize(model) {
    var ns = model.states, n = ns.length;
    var depth = new Array(n), i;
    for (i = 0; i < n; i++) depth[i] = -1;
    depth[model.initial] = 0;
    var q = [model.initial];
    while (q.length) {
      var u = q.shift();
      for (i = 0; i < model.trans.length; i++) {
        var t = model.trans[i];
        if (t.from !== u || t.to === u) continue;
        if (depth[t.to] < 0) { depth[t.to] = depth[u] + 1; q.push(t.to); }
      }
    }
    var maxOpen = 0;
    for (i = 0; i < n; i++) if (!ns[i].terminal && depth[i] > maxOpen) maxOpen = depth[i];
    for (i = 0; i < n; i++) {
      if (depth[i] < 0) depth[i] = 0;                 // 도달 불가 상태는 첫 층에 둔다
      ns[i].layer = ns[i].terminal ? maxOpen + 1 : depth[i];
    }
    var count = {};
    var maxLayer = 0;
    for (i = 0; i < n; i++) {
      var L = ns[i].layer;
      ns[i].row = count[L] = (count[L] === undefined ? 0 : count[L] + 1);
      if (L > maxLayer) maxLayer = L;
    }
    model.layers = maxLayer + 1;
    model.rowsIn = [];
    for (i = 0; i <= maxLayer; i++) model.rowsIn.push(count[i] === undefined ? 0 : count[i] + 1);
    model.maxRows = 1;
    for (i = 0; i < model.rowsIn.length; i++) model.maxRows = Math.max(model.maxRows, model.rowsIn[i]);
  }

  // ---------------------------------------------------------------- 스텝
  //
  // 계약 §7: 상태를 미리 전부 계산한다. render(i) 는 그리기만 한다.
  // 알고리즘은 본문 §4.2 의 `::: dual` 과 같다 — 조회 한 번, 실패하면 아무것도 안 한다.

  function cp(o) {
    var out = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  function openEvents(model, si) {
    var out = [];
    for (var j = 0; j < model.events.length; j++) if (model.matrix[si][j] >= 0) out.push(model.events[j]);
    return out;
  }

  function flagText(model, si) {
    if (!model.flagName) return '';
    return model.flagName + ' ' + (model.flagOn[si] ? '켜짐' : '꺼짐');
  }

  function openText(model, si) {
    var op = openEvents(model, si);
    var nm = model.states[si].label;
    if (!op.length) return nm + ' 행은 전부 비어 있다 — 나가는 간선이 0개인 종료 상태다.';
    return nm + ' 행에서 열린 칸은 ' + op.join(', ') + ' ' + op.length + '개다.';
  }

  function buildSteps(model, showRejected) {
    var steps = [];
    var cur = model.initial;
    var used = {}, rej = {}, seen = {};
    // 스크립트 칸마다 수락/거부를 따로 남긴다. showRejected:false 면 거부가 스텝으로
    // 남지 않는데, 그때도 테이프가 ✓ 를 찍으면 위젯이 거짓말을 하게 된다.
    var outcomes = [];
    seen[cur] = true;

    function snap(o) {
      o.used = cp(used);
      o.rej = cp(rej);
      o.seen = cp(seen);
      o.flag = model.flagName ? model.flagOn[o.state] : false;
      steps.push(o);
    }

    var s0 = model.states[model.initial];
    snap({
      kind: 'init', state: model.initial, from: model.initial, to: model.initial,
      ei: -1, ev: null, note: null, k: -1,
      msg: '시작 상태 ' + ga(s0.label) + ' 놓여 있다. 아직 이벤트를 받지 않았다. ' +
           openText(model, model.initial) +
           (model.flagName ? ' ' + flagText(model, model.initial) + '.' : '')
    });

    for (var k = 0; k < model.script.length; k++) {
      var evName = model.script[k];
      var ei = model.eidx[evName];
      var to = model.matrix[cur][ei];
      var key = cur + ':' + ei;
      var head = '스텝 ' + k + ' · ' + evName + ' — (' + model.states[cur].label + ', ' + evName + ') ';

      if (to < 0) {
        // ---- 거부: 아무것도 바꾸지 않는다 ----
        outcomes[k] = 'rej';
        if (!showRejected) continue;      // showRejected:false 면 스텝 자체를 만들지 않는다
        rej[key] = (rej[key] || 0) + 1;
        snap({
          kind: 'reject', state: cur, from: cur, to: cur, ei: ei, ev: evName, note: null, k: k,
          msg: head + '조회 실패. 격자에서 그 칸이 비어 있다. 거부는 오류가 아니라 이 기계의 정상 동작이라 ' +
               '상태도' + (model.flagName ? ' ' + model.flagName + '도' : '') + ' 진입 동작도 그대로다 — ' +
               model.states[cur].label + (model.flagName ? ' / ' + flagText(model, cur) : '') + '. ' +
               openText(model, cur)
        });
        continue;
      }

      // ---- 수락 ----
      outcomes[k] = 'ok';
      used[key] = (used[key] || 0) + 1;
      var self = (to === cur);
      var note = self ? null : model.states[to].note;   // 같은 상태로 돌아오면 진입 동작은 돌지 않는다
      var from = cur;
      cur = to;
      seen[cur] = true;
      var msg = head + '조회 성공 → ';
      if (self) {
        msg += '같은 상태 ' + model.states[to].label + ' 다. 상태가 바뀌지 않았으므로 진입 동작은 실행되지 않는다. ';
      } else {
        msg += ro(model.states[to].label) + ' 간다. 진입 동작 ' + (note ? '‘' + note + '’.' : '없음.') + ' ';
      }
      if (model.flagName) msg += flagText(model, cur) + '. ';
      msg += openText(model, cur);
      snap({
        kind: 'move', state: cur, from: from, to: to, ei: ei, ev: evName, note: note, k: k,
        self: self, msg: msg
      });
    }

    // 마지막 한 줄: 격자의 빈칸이 곧 규칙이라는 문장을 여기서 한 번 더 못박는다.
    var total = model.states.length * model.events.length;
    steps.push({
      kind: 'done', state: cur, from: cur, to: cur, ei: -1, ev: null, note: null, k: model.script.length,
      used: cp(used), rej: cp(rej), seen: cp(seen),
      flag: model.flagName ? model.flagOn[cur] : false,
      msg: '스크립트 종료. 최종 상태 ' + model.states[cur].label +
           (model.flagName ? ' / ' + flagText(model, cur) : '') + '. ' +
           '격자 ' + total + '칸 중 ' + model.filled + '칸이 열려 있고 나머지 ' + (total - model.filled) +
           '칸은 누가 닫은 것이 아니라 결정하지 않아서 닫힌 것이다.'
    });

    model.outcomes = outcomes;
    return steps;
  }

  // ---------------------------------------------------------------- 기하 보조

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function inRect(px, py, r, pad) {
    return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }

  function overlap(a, b, pad) {
    return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
             a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
  }

  function quadPts(ax, ay, cx, cy, bx, by, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      pts.push(u * u * ax + 2 * u * t * cx + t * t * bx);
      pts.push(u * u * ay + 2 * u * t * cy + t * t * by);
    }
    return pts;
  }

  // 양 끝을 노드 상자 밖으로 물린다. 화살촉이 상자 안에 파묻히면 방향이 안 보인다.
  function trimPts(pts, ra, rb) {
    var i, s = 0, e = (pts.length / 2) - 1;
    for (i = 0; i < pts.length / 2; i++) {
      if (!inRect(pts[i * 2], pts[i * 2 + 1], ra, 3)) { s = i; break; }
    }
    for (i = (pts.length / 2) - 1; i >= 0; i--) {
      if (!inRect(pts[i * 2], pts[i * 2 + 1], rb, 3)) { e = i; break; }
    }
    if (e <= s) { s = 0; e = (pts.length / 2) - 1; }
    return pts.slice(s * 2, (e + 1) * 2);
  }

  function ptAt(pts, f) {
    var n = pts.length / 2;
    var i = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
    return { x: pts[i * 2], y: pts[i * 2 + 1] };
  }

  // ---------------------------------------------------------------- 그래프 배치
  //
  // 왜 층 배치 + 휘어진 간선인가
  //   상태 기계는 "시작에서 종료로 흐르는" 그림이라 층으로 세우면 읽는 방향이 생긴다.
  //   문제는 canceled 처럼 멀리서 오는 간선이다. 직선으로 그으면 중간 상태의 이름표를
  //   그어 버린다. 그래서 간선마다 **직선부터 시도해 보고, 다른 노드를 지나가면 활을
  //   키운다.** 통과하는 순간의 활 크기가 그 간선의 곡률이다. 라벨(이벤트 이름)도
  //   같은 방식으로 자리를 찾는다 — 겹치지 않는 t 를 고른다.
  //
  //   왕복 간선(running↔paused)은 활을 0 으로 두면 정확히 겹친다. 그런데 활의 기준
  //   방향을 (진행 방향의 수직)으로 잡으면 방향이 뒤집힐 때 수직 벡터도 뒤집혀
  //   저절로 반대쪽으로 휜다. 그래서 왕복 쌍은 후보에서 0 만 빼면 된다.

  function buildGraph(model, vertical, nodeW, nodeH, gapMain, gapCross, fs, noteFs) {
    var ns = model.states, n = ns.length, i;
    var nodes = [];
    var rowsIn = model.rowsIn;
    var maxRows = model.maxRows;
    var noteH = 0;
    for (i = 0; i < n; i++) if (ns[i].note) noteH = noteFs + 4;

    var cross = nodeH + noteH + gapCross;             // 층 안에서 이웃 사이 간격(가로 배치)
    var crossV = nodeW + gapCross;                    // 세로 배치일 때
    for (i = 0; i < n; i++) {
      var L = ns[i].layer, r = ns[i].row, cnt = rowsIn[L];
      var x, y;
      if (vertical) {
        var spanW = cnt * nodeW + (cnt - 1) * gapCross;
        var fullW = maxRows * nodeW + (maxRows - 1) * gapCross;
        x = (fullW - spanW) / 2 + r * crossV;
        y = L * (nodeH + noteH + gapMain);
      } else {
        var spanH = cnt * (nodeH + noteH) + (cnt - 1) * gapCross;
        var fullH = maxRows * (nodeH + noteH) + (maxRows - 1) * gapCross;
        x = L * (nodeW + gapMain);
        y = (fullH - spanH) / 2 + r * cross;
      }
      nodes.push({ x: x, y: y, w: nodeW, h: nodeH, i: i });
    }

    // 충돌 판정용 상자에는 노트 글자까지 넣는다. 간선이 노트를 그으면 안 된다.
    var hits = [];
    for (i = 0; i < n; i++) {
      var lw = ns[i].note ? Math.max(nodeW, estW(ns[i].note, noteFs) + 6) : nodeW;
      hits.push({
        x: nodes[i].x - (lw - nodeW) / 2, y: nodes[i].y,
        w: lw, h: nodeH + (ns[i].note ? noteH : 0)
      });
    }

    // (from,to) 가 같은 전이는 한 간선으로 묶는다. 라벨만 늘어난다.
    var groups = {}, order = [];
    for (i = 0; i < model.trans.length; i++) {
      var t = model.trans[i];
      var key = t.from + '>' + t.to;
      if (!groups[key]) { groups[key] = { from: t.from, to: t.to, evs: [], key: key }; order.push(key); }
      groups[key].evs.push(t.on);
    }

    var pairSet = {};
    for (i = 0; i < order.length; i++) pairSet[order[i]] = true;

    var edges = [], labels = [];
    for (i = 0; i < order.length; i++) {
      var g = groups[order[i]];
      var a = nodes[g.from], b = nodes[g.to];
      var text = g.evs.join(', ');
      var lwid = estW(text, fs) + 10, lhei = fs + 6;

      if (g.from === g.to) {
        // 자기 자신으로 가는 간선. 가로 배치에서는 위쪽, 세로 배치에서는 오른쪽에 고리를 건다.
        var pts = selfLoop(a, vertical);
        var lp = vertical
          ? { x: a.x + a.w + 26 - lwid / 2, y: a.y + a.h / 2 - lhei / 2 }
          : { x: a.x + a.w / 2 - lwid / 2, y: a.y - 30 - lhei / 2 };
        edges.push({ key: g.key, from: g.from, to: g.to, evs: g.evs, pts: pts, self: true });
        labels.push({ x: lp.x, y: lp.y, w: lwid, h: lhei, text: text, key: g.key });
        continue;
      }

      var ax = a.x + a.w / 2, ay = a.y + a.h / 2;
      var bx = b.x + b.w / 2, by = b.y + b.h / 2;
      var dx = bx - ax, dy = by - ay;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var px = dy / len, py = -dx / len;              // 진행 방향의 수직 (오른쪽으로 갈 땐 위)
      var twoWay = !!pairSet[g.to + '>' + g.from];
      var span = Math.abs(ns[g.to].layer - ns[g.from].layer);

      /* 후보 순서가 그림의 질을 정한다.
       *   - 이웃 층끼리는 직선이 제일 낫다. 0 부터 본다.
       *   - 왕복 쌍(running↔paused)은 0 이면 정확히 겹친다. 수직 벡터가 진행 방향을
       *     따라 뒤집히므로 같은 양수를 줘도 서로 반대쪽으로 휜다.
       *   - **여러 층을 건너뛰는 간선은 처음부터 크게 휘게 한다.** 작은 활로도 노드는
       *     피할 수 있지만 라벨이 한가운데 붐비는 자리에 떨어진다. 손으로 그린 상태
       *     기계가 먼 간선을 바깥으로 크게 돌리는 것과 같은 이유다.
       *   - 음수(가로 배치에서는 아래, 세로 배치에서는 왼쪽)를 먼저 본다. 자기 간선
       *     고리가 반대쪽에 걸려 있어 그쪽이 늘 비어 있다. */
      var cands;
      if (span >= 2) {
        var base = 60 + 34 * span;
        cands = [-base, base, -base * 1.4, base * 1.4, -base * 1.9, base * 1.9, -44, 44];
      } else if (twoWay) {
        // 활을 작게 주면 두 라벨이 가운데에서 붙어 한 덩어리로 읽힌다. 처음부터
        // 벌려 놓는다 — 수직 벡터가 방향을 따라 뒤집히므로 양수 하나로 양쪽이 갈린다.
        cands = [64, 96, 136, 186];
      } else {
        cands = [0, -44, 44, -78, 78, -120, 120, -170, 170, 230];
      }
      var best = null;
      for (var c = 0; c < cands.length; c++) {
        var bow = cands[c];
        var samples = quadPts(ax, ay, (ax + bx) / 2 + px * bow, (ay + by) / 2 + py * bow, bx, by, 40);
        if (clearOf(samples, hits, g.from, g.to)) { best = samples; break; }
        if (!best) best = samples;                     // 하나도 안 되면 첫 후보라도 쓴다
        if (c === cands.length - 1) best = samples;    // 마지막이면 가장 크게 휜 것
      }
      var trimmed = trimPts(best, hits[g.from], hits[g.to]);
      edges.push({ key: g.key, from: g.from, to: g.to, evs: g.evs, pts: trimmed, self: false });

      // 라벨 자리: 겹치지 않는 t 를 찾는다.
      var tries = [0.5, 0.4, 0.6, 0.3, 0.7, 0.24, 0.76];
      var placed = null;
      for (var q = 0; q < tries.length; q++) {
        var p = ptAt(trimmed, tries[q]);
        var rct = { x: p.x - lwid / 2, y: p.y - lhei / 2, w: lwid, h: lhei };
        var ok = true, z;
        for (z = 0; z < hits.length && ok; z++) if (overlap(rct, hits[z], 1)) ok = false;
        for (z = 0; z < labels.length && ok; z++) if (overlap(rct, labels[z], 7)) ok = false;
        if (ok) { placed = rct; break; }
        if (!placed) placed = rct;
      }
      placed.text = text;
      placed.key = g.key;
      labels.push(placed);
    }

    // 전체를 감싸는 상자를 재서 원점으로 옮긴다. 활이 밖으로 나간 만큼 패널이 커진다.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(x, y) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    for (i = 0; i < hits.length; i++) {
      grow(hits[i].x, hits[i].y);
      grow(hits[i].x + hits[i].w, hits[i].y + hits[i].h);
    }
    for (i = 0; i < edges.length; i++) {
      for (var j = 0; j < edges[i].pts.length; j += 2) grow(edges[i].pts[j], edges[i].pts[j + 1]);
    }
    for (i = 0; i < labels.length; i++) {
      grow(labels[i].x, labels[i].y);
      grow(labels[i].x + labels[i].w, labels[i].y + labels[i].h);
    }
    // 시작 표식(▶)이 들어갈 자리
    if (vertical) minY -= 14; else minX -= 14;
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }

    for (i = 0; i < nodes.length; i++) { nodes[i].x -= minX; nodes[i].y -= minY; }
    for (i = 0; i < hits.length; i++) { hits[i].x -= minX; hits[i].y -= minY; }
    for (i = 0; i < labels.length; i++) { labels[i].x -= minX; labels[i].y -= minY; }
    for (i = 0; i < edges.length; i++) {
      for (var m = 0; m < edges[i].pts.length; m += 2) {
        edges[i].pts[m] -= minX; edges[i].pts[m + 1] -= minY;
      }
    }

    return {
      nodes: nodes, hits: hits, edges: edges, labels: labels,
      w: maxX - minX, h: maxY - minY, vertical: vertical, fs: fs, noteFs: noteFs, noteH: noteH
    };
  }

  function selfLoop(a, vertical) {
    var pts = [];
    var i, t, u;
    var p0, p1, p2, p3;
    if (vertical) {
      p0 = { x: a.x + a.w, y: a.y + a.h * 0.3 };
      p1 = { x: a.x + a.w + 40, y: a.y - 6 };
      p2 = { x: a.x + a.w + 40, y: a.y + a.h + 6 };
      p3 = { x: a.x + a.w, y: a.y + a.h * 0.7 };
    } else {
      p0 = { x: a.x + a.w * 0.3, y: a.y };
      p1 = { x: a.x - 6, y: a.y - 40 };
      p2 = { x: a.x + a.w + 6, y: a.y - 40 };
      p3 = { x: a.x + a.w * 0.7, y: a.y };
    }
    for (i = 0; i <= 24; i++) {
      t = i / 24; u = 1 - t;
      pts.push(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x);
      pts.push(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y);
    }
    return pts;
  }

  function clearOf(pts, hits, skipA, skipB) {
    for (var i = 2; i < pts.length - 2; i += 2) {
      for (var j = 0; j < hits.length; j++) {
        if (j === skipA || j === skipB) continue;
        if (inRect(pts[i], pts[i + 1], hits[j], 4)) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- 전체 배치
  //
  // 계약 §4. 왜 700px 아래에서 세로로 쌓는가: 그래프와 격자를 나란히 두면 둘 다
  // 폭이 절반이 되고, 격자의 칸이 30px 아래로 내려가는 순간 이벤트 이름을 못 읽는다.
  // 격자는 **읽는 표**라서 작아지면 정보가 통째로 사라진다. grid-search 가 폰에서
  // 4분할을 포기하고 한 판을 크게 그리는 것과 같은 판단이다 — 나란히 두는 이득보다
  // 읽히는 것이 먼저다.

  // 기준은 뷰포트가 아니라 **stage 의 폭**이다. 본문 칼럼이 --measure 로 좁혀져 있어
  // 1200px 화면에서도 위젯이 쓰는 폭은 670px 남짓이다(wide 로 벌려도 1400px 위에서나
  // 940px 이 된다). 뷰포트로 문턱을 잡으면 데스크톱에서도 영원히 세로로 쌓인다.
  var SIDE_MIN = 620;      // 이 아래로는 무조건 세로 스택
  var GRAPH_MIN = 250;     // 나란히 둘 때 그래프가 최소한 가져야 하는 폭
  var GRAPH_WANT = 340;    // 이만큼은 그래프에 주려고 격자 칸을 먼저 줄인다
  var MIN_SIDE_CELL = 38;  // 나란히 두느라 이보다 좁아지면 이벤트 이름을 못 읽는다
  var LABEL_ROOM = 46;     // 층 사이에 간선 라벨이 들어가려면 최소 이만큼

  function computeLayout(w, model, view, showRejected) {
    var tiny = w < 520, narrow = w < 620;
    var pad = tiny ? 8 : (narrow ? 12 : 16);
    var gap = tiny ? 12 : 18;
    var headH = tiny ? 14 : 16;

    var showM = model.showMatrix && view !== 'graph';
    var showG = view !== 'matrix' || !showM;

    var avail = Math.max(120, w - pad * 2);
    var E = model.events.length, S = model.states.length;

    // ---- 격자 치수 ----
    var mfs = tiny ? 8.5 : (narrow ? 9.5 : 10.5);
    var labelW = 0, i;
    for (i = 0; i < S; i++) labelW = Math.max(labelW, estW(model.states[i].label, mfs));
    labelW = Math.ceil(labelW) + 12;
    var evW = 0;
    for (i = 0; i < E; i++) evW = Math.max(evW, estW(model.events[i], mfs));
    var cellW = Math.ceil(Math.max(tiny ? 30 : 34, evW + 8));
    var cellH = tiny ? 20 : 24;
    var mHeadH = tiny ? 17 : 20;
    var matW = labelW + E * cellW;
    var matH = mHeadH + S * cellH + (tiny ? 16 : 19);   // 마지막 줄은 칸 수 캡션

    // ---- 나란히 둘 수 있는가 ----
    var side = showG && showM && w >= SIDE_MIN;
    var graphAvail = avail;
    if (side) {
      // 그래프 쪽이 훨씬 넓이를 탄다(노드 + 휘어진 간선 + 라벨). 격자는 칸이
      // MIN_SIDE_CELL 까지 좁아져도 읽히므로, 남는 폭은 그래프에 몰아준다.
      if (matW > avail - GRAPH_WANT - gap) {
        var need = avail - GRAPH_WANT - gap - labelW;
        var shrunk = Math.floor(need / E);
        if (shrunk < MIN_SIDE_CELL) shrunk = MIN_SIDE_CELL;
        if (shrunk < cellW) { cellW = shrunk; matW = labelW + E * cellW; }
      }
      // 그래도 그래프가 최소 폭을 못 받으면 나란히 두는 것을 포기한다.
      // 읽히는 것이 나란히 두는 것보다 먼저다(grid-search 와 같은 판단).
      if (avail - matW - gap < GRAPH_MIN) side = false;
      if (side) graphAvail = avail - matW - gap;
    }

    /* 격자가 stage 보다 넓으면 오른쪽 열이 잘린다 — 캔버스 폭이 stage 폭이라
     * 넘친 부분은 스크롤되는 것이 아니라 그냥 사라진다. 열이 잘린 격자는
     * "어디로 갈 수 없는가"를 통째로 거짓말한다. 그래서 먼저 칸을 줄여 맞추고,
     * 그래도 안 되면 격자 전체를 축소해서 그린다(정보는 남긴다). */
    var mScale = 1;
    if (matW > avail) {
      var fit = Math.floor((avail - labelW) / E);
      if (fit >= 16) { cellW = fit; matW = labelW + E * cellW; }
      else mScale = Math.max(0.4, avail / matW);
    }

    // 머리글은 칸 폭 안에 들어가야 한다. 이름이 칸보다 길면 글자를 줄인다 —
    // 이웃 열 이름과 붙어 버리면 어느 열인지 못 읽는다.
    var headFs = Math.max(7.5, Math.min(mfs, evW > 0 ? mfs * (cellW - 5) / evW : mfs));

    // ---- 그래프 치수 ----
    var g = null;
    if (showG) {
      var gfs = tiny ? 9 : (narrow ? 10 : 11);
      var noteFs = tiny ? 8 : 8.8;
      var maxLabel = 0;
      for (i = 0; i < S; i++) maxLabel = Math.max(maxLabel, estW(model.states[i].label, gfs));
      var nodeW = Math.max(48, Math.ceil(maxLabel) + 16);
      var nodeH = tiny ? 23 : 27;
      var gapCross = tiny ? 20 : 26;

      /* 가로로 눕힐지 세로로 세울지.
       * 층 간격을 줄여서 억지로 가로에 맞추지 않는다 — 가로 배치에서 층 간격은
       * **이벤트 이름이 들어갈 자리**다. 이름보다 좁아지는 순간 라벨이 양쪽 노드
       * 상자를 덮어 그림이 통째로 죽는다. 그래서 필요한 폭을 이름에서 역산하고,
       * 그만큼이 안 나오면 세로로 세운다. 세로는 층 간격을 높이에서 가져오므로
       * 폭이 좁아도 라벨 자리가 남는다. */
      var elw = 0;   // 라벨 알약의 실제 폭 (buildGraph 와 같은 식으로 잰다)
      for (i = 0; i < model.events.length; i++) elw = Math.max(elw, estW(model.events[i], gfs) + 10);
      var roomH = Math.min(104, Math.max(52, Math.ceil(elw) + 20));
      var natural = model.layers * nodeW + (model.layers - 1) * roomH + 24;
      var vertical = natural > graphAvail;
      var gapMain = vertical ? (tiny ? 34 : LABEL_ROOM) : roomH;
      g = buildGraph(model, vertical, nodeW, nodeH, gapMain, gapCross, gfs, noteFs);
      // 그래도 넘치면 폭에 맞춰 통째로 축소한다. .wk-stage 는 overflow-x 가 되지만
      // 캔버스를 stage 보다 넓게 잡을 이유는 없다.
      g.scale = g.w > graphAvail ? Math.max(0.55, graphAvail / g.w) : 1;
    }

    // ---- 세로 위치 ----
    var y = pad;
    var gy = 0, my = 0, gw = 0, gh = 0;
    if (showG) {
      gw = g.w * g.scale;
      gh = g.h * g.scale;
    }
    var gx = pad, mx = pad, gtY = 0, mtY = 0;

    if (side) {
      // 위를 맞춘다. 짧은 쪽을 가운데로 내리면 제목과 표가 떨어져 서로 남처럼 보인다.
      var band = Math.max(gh, matH);
      gtY = mtY = y + headH - 5;
      gy = my = y + headH;
      gx = pad + Math.max(0, (graphAvail - gw) / 2);
      mx = pad + graphAvail + gap;
      y = y + headH + band + (tiny ? 12 : 16);
    } else {
      if (showG) {
        gtY = y + headH - 5;
        gy = y + headH;
        gx = pad + Math.max(0, (avail - gw) / 2);
        y = gy + gh + (tiny ? 12 : 16);
      }
      if (showM) {
        mtY = y + headH - 5;
        my = y + headH;
        mx = pad + Math.max(0, (avail - matW * mScale) / 2);
        y = my + matH * mScale + (tiny ? 12 : 16);
      }
    }

    // ---- 스크립트 테이프 ----
    var tfs = tiny ? 9 : 10;
    var chips = [], rows = 1;
    var cx = pad, cy = y + headH;
    var chipH = tiny ? 19 : 22;
    for (i = 0; i < model.script.length; i++) {
      var cw = Math.ceil(estW(model.script[i], tfs)) + (tiny ? 14 : 18);
      if (cx + cw > pad + avail && cx > pad) { cx = pad; cy += chipH + 5; rows++; }
      chips.push({ x: cx, y: cy, w: cw, h: chipH, text: model.script[i], k: i });
      cx += cw + 5;
    }
    y = cy + chipH + (tiny ? 10 : 13);

    // ---- 현재 상태 줄 ----
    var stripY = y;
    var stripH = tiny ? 20 : 23;
    y = stripY + stripH + pad;

    // 각주(모르는 kind, 버려진 전이)는 제 줄을 갖는다. 좁은 화면에서 현재 줄 위에
    // 겹쳐 쓰면 둘 다 못 읽는다.
    var foot = model.footLines || 0;
    y += foot * (tiny ? 11 : 12);

    return {
      w: w, tiny: tiny, narrow: narrow, pad: pad, headH: headH, side: side,
      showG: showG, showM: showM, view: view, showRejected: showRejected,
      graph: g, gx: gx, gy: gy, gw: gw, gh: gh, gtY: gtY, mtY: mtY,
      mx: mx, my: my, matW: matW, matH: matH, mScale: mScale,
      labelW: labelW, cellW: cellW, cellH: cellH, mHeadH: mHeadH, mfs: mfs, headFs: headFs,
      chips: chips, tapeRows: rows, chipH: chipH, tfs: tfs,
      stripY: stripY, stripH: stripH,
      height: Math.max(120, y)
    };
  }

  // ---------------------------------------------------------------- 위젯

  K.register('state-machine', function (host, opts) {
    if (!opts || typeof opts !== 'object' || isArr(opts)) opts = {};

    var model = buildModel(opts);
    model.showMatrix = (opts.showMatrix === false) ? false : true;
    var showRejected = (opts.showRejected === false) ? false : true;

    // kind: 지금은 평면 FSM 만 그린다. 모르는 값이 와도 던지지 않고 그 사실을 적는다.
    var kind = str(opts.kind) || 'fsm';
    var kindNote = (kind.toLowerCase() === 'fsm') ? null
      : 'kind="' + clip(kind, 10) + '" 는 아직 평면 상태 기계로 그린다 (계층·행동 트리는 XI-6)';
    model.footLines = (kindNote ? 1 : 0) + (model.dropped ? 1 : 0);

    var title = str(opts.title);

    var steps = buildSteps(model, showRejected);
    var cur = 0;
    var view = model.showMatrix ? 'both' : 'graph';
    var cache = null;

    // wide: 그래프와 격자를 나란히 두려면 폭이 필요하다. ≥1400px 화면에서 본문 폭을
    // 조금 넘어 벌어진다(§8). 좁은 화면에서는 아무 효과가 없다.
    var ui = K.frame(host, { title: '', wide: true });
    var titleEl = K.el('div', 'wk-title', '상태 기계' + (title ? ' — ' + title : ''));
    ui.head.insertBefore(titleEl, ui.head.firstChild);

    // ---- 머리말 세그 ----
    // 폰에서 격자만 크게 보고 싶을 때가 있다. 나란히 두는 것을 포기하는 대신
    // 무엇을 볼지는 독자가 고른다.
    var segEl = null;
    if (model.showMatrix) {
      segEl = K.seg(ui.slot, [
        { label: '둘 다', value: 'both' },
        { label: '그래프', value: 'graph' },
        { label: '격자', value: 'matrix' }
      ], view, function (v) {
        view = v;
        cache = null;
        cv.redraw();
      });
    }

    // ---- 범례 (계약 §5: 색만으로 정보를 주지 않는다) ----
    var legend = K.el('div', 'wk-legend');
    legend.style.width = '100%';
    legend.innerHTML =
      '<span><i style="background:var(--w-frontier)"></i>현재 상태</span>' +
      '<span><i style="background:var(--w-path)"></i>방금 지난 전이</span>' +
      (showRejected ? '<span><i style="background:var(--box-danger)"></i>거부 — 격자의 빈칸(×)</span>' : '') +
      (model.showMatrix ? '<span>격자: <b>●</b> 전이 있음 / 빈칸 = 전이 없음 (빈칸이 곧 규칙이다)</span>' : '') +
      (model.flagName ? '<span>' + eun(model.flagName) + ' 상태의 함수다 — 진입 동작 한 곳에서만 바뀐다</span>' : '');
    ui.slot.appendChild(legend);

    function L() {
      var w = cv.size.w || 320;
      if (!cache || cache.w !== w || cache.view !== view) {
        cache = computeLayout(w, model, view, showRejected);
      }
      return cache;
    }

    // ---- 그리기 보조 ----

    function section(ctx, T, l, text, x, y) {
      ctx.fillStyle = T.fgDim;
      ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px ' + SANS;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x, y);
    }

    function pill(ctx, T, r, text, fs, color, bold) {
      ctx.save();
      ctx.fillStyle = T.bg;
      rrect(ctx, r.x, r.y, r.w, r.h, 3);
      ctx.fill();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = bold ? 1.6 : 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = (bold ? '700 ' : '') + fs + 'px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      ctx.restore();
    }

    function polyline(ctx, pts, color, lw, alpha, dash) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
      ctx.restore();
    }

    function arrowHead(ctx, pts, color, s) {
      var n = pts.length;
      if (n < 4) return;
      var bx = pts[n - 2], by = pts[n - 1];
      var ax = pts[n - 4], ay = pts[n - 3];
      var dx = bx - ax, dy = by - ay;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - ux * s - uy * s * 0.55, by - uy * s + ux * s * 0.55);
      ctx.lineTo(bx - ux * s + uy * s * 0.55, by - uy * s - ux * s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ---- 그래프 ----
    function drawGraph(ctx, T, l, s) {
      var g = l.graph;
      if (!g) return;
      ctx.save();
      ctx.translate(l.gx, l.gy);
      ctx.scale(g.scale, g.scale);

      var i, e;
      var takenKey = (s.kind === 'move') ? (s.from + '>' + s.to) : null;

      // 1) 보통 간선 → 2) 방금 지난 간선 순으로 그린다. 강조가 뒤에 와야 위에 남는다.
      for (var pass = 0; pass < 2; pass++) {
        for (i = 0; i < g.edges.length; i++) {
          e = g.edges[i];
          var hot = (e.key === takenKey);
          if ((pass === 0) === hot) continue;
          var col = hot ? T.wPath : T.border;
          polyline(ctx, e.pts, col, hot ? 2.6 : 1.2, hot ? 1 : 0.85, null);
          arrowHead(ctx, e.pts, hot ? T.wPath : T.fgFaint, hot ? 7 : 5.5);
        }
      }

      // 노드
      for (i = 0; i < g.nodes.length; i++) {
        var nd = g.nodes[i];
        var st = model.states[i];
        var isCur = (s.state === i);
        var wasHere = !!s.seen[i];
        var rejectHere = (s.kind === 'reject' && isCur);

        ctx.save();
        ctx.fillStyle = T.bgElev;
        rrect(ctx, nd.x, nd.y, nd.w, nd.h, 6);
        ctx.fill();
        if (isCur) {
          ctx.globalAlpha = 0.26;
          ctx.fillStyle = rejectHere ? T.boxDanger : T.wFrontier;
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (wasHere) {
          ctx.globalAlpha = 0.34;
          ctx.fillStyle = T.wVisited;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = isCur ? 2.6 : 1.2;
        ctx.strokeStyle = isCur ? (rejectHere ? T.boxDanger : T.wFrontier) : T.border;
        ctx.stroke();
        // 종료 상태는 이중 테두리. 색이 아니라 모양으로 구분한다(계약 §5).
        if (st.terminal) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = isCur ? (rejectHere ? T.boxDanger : T.wFrontier) : T.fgFaint;
          rrect(ctx, nd.x + 3, nd.y + 3, nd.w - 6, nd.h - 6, 4);
          ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = T.fg;
        ctx.font = '700 ' + g.fs + 'px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.label, nd.x + nd.w / 2, nd.y + nd.h / 2 + 0.5);

        // 진입 동작. 방금 실행된 것만 금색으로 켠다 — 나머지는 항상 보이되 조용히.
        if (st.note) {
          var justRan = (s.kind === 'move' && s.to === i && !s.self && s.note);
          ctx.fillStyle = justRan ? T.wPath : T.fgFaint;
          ctx.font = (justRan ? '700 ' : '') + g.noteFs + 'px ' + SANS;
          ctx.textBaseline = 'top';
          ctx.fillText(st.note, nd.x + nd.w / 2, nd.y + nd.h + 3);
        }

        // 시작 표식
        if (i === model.initial) {
          ctx.fillStyle = T.fgDim;
          ctx.font = '700 ' + (g.fs - 1) + 'px ' + SANS;
          ctx.textBaseline = 'middle';
          if (g.vertical) {
            ctx.textAlign = 'center';
            ctx.fillText('▼', nd.x + nd.w / 2, nd.y - 7);
          } else {
            ctx.textAlign = 'right';
            ctx.fillText('▶', nd.x - 3, nd.y + nd.h / 2);
          }
        }
      }

      // 간선 라벨(이벤트 이름). 노드 위에 얹어야 선에 가려지지 않는다.
      for (i = 0; i < g.labels.length; i++) {
        var lb = g.labels[i];
        var hot2 = (lb.key === takenKey);
        pill(ctx, T, lb, lb.text, g.fs - 1.5, hot2 ? T.wPath : T.fgDim, hot2);
      }
      ctx.restore();
    }

    // ---- 격자 ----
    function drawMatrix(ctx, T, l, s) {
      var S = model.states.length, E = model.events.length;
      var i, j;
      // 축소가 걸린 경우를 위해 격자는 자기 좌표계에서 그린다.
      ctx.save();
      ctx.translate(l.mx, l.my);
      if (l.mScale !== 1) ctx.scale(l.mScale, l.mScale);
      var x0 = 0, y0 = 0;

      // 띠 두 개. 가로는 **지금 있는 상태의 행**(여기서 다음 이벤트를 조회한다),
      // 세로는 방금 던진 이벤트의 열이다. 둘이 만나는 칸이 조회 지점이고,
      // 전이가 일어난 스텝에서는 행이 한 칸 옮겨 간 것이 눈에 보인다.
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = T.wFrontier;
      ctx.fillRect(x0, y0 + l.mHeadH + s.state * l.cellH, l.labelW + E * l.cellW, l.cellH);
      if (s.ei >= 0) ctx.fillRect(x0 + l.labelW + s.ei * l.cellW, y0, l.cellW, l.mHeadH + S * l.cellH);
      ctx.restore();

      // 헤더
      ctx.textBaseline = 'middle';
      for (j = 0; j < E; j++) {
        ctx.font = ((j === s.ei) ? '700 ' : '') + l.headFs + 'px ' + MONO;
        ctx.fillStyle = (j === s.ei) ? T.fg : T.fgDim;
        ctx.textAlign = 'center';
        ctx.fillText(model.events[j], x0 + l.labelW + (j + 0.5) * l.cellW, y0 + l.mHeadH / 2);
      }
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + l.mHeadH - 0.5);
      ctx.lineTo(x0 + l.labelW + E * l.cellW, y0 + l.mHeadH - 0.5);
      ctx.moveTo(x0 + l.labelW - 0.5, y0);
      ctx.lineTo(x0 + l.labelW - 0.5, y0 + l.mHeadH + S * l.cellH);
      ctx.stroke();

      for (i = 0; i < S; i++) {
        var ry = y0 + l.mHeadH + i * l.cellH;
        ctx.fillStyle = (i === s.state) ? T.fg : T.fgDim;
        ctx.font = ((i === s.state) ? '700 ' : '') + l.mfs + 'px ' + MONO;
        ctx.textAlign = 'left';
        ctx.fillText(model.states[i].label, x0 + 4, ry + l.cellH / 2);

        for (j = 0; j < E; j++) {
          var cxx = x0 + l.labelW + j * l.cellW;
          var open = model.matrix[i][j] >= 0;
          var key = i + ':' + j;
          var wasUsed = !!s.used[key], wasRej = !!s.rej[key];
          // 조회가 일어난 칸은 **떠나온 상태의 행**이다. 도착한 행이 아니다.
          // (paused, resume) 를 조회해서 running 으로 갔다면 켜져야 하는 칸은
          // paused 행이고, running 행에는 아무 일도 없었다.
          var isNow = (s.from === i && s.ei === j && (s.kind === 'move' || s.kind === 'reject'));

          // 열린 칸은 옅은 채움 + 글자 O. 색을 못 보는 독자에게도 O/· 로 구분된다.
          if (open) {
            ctx.save();
            ctx.globalAlpha = isNow ? 0.34 : (wasUsed ? 0.22 : 0.12);
            ctx.fillStyle = isNow ? T.wPath : (wasUsed ? T.wVisited : T.wFrontier);
            rrect(ctx, cxx + 2, ry + 2, l.cellW - 4, l.cellH - 4, 3);
            ctx.fill();
            ctx.restore();
          }
          if (isNow) {
            ctx.save();
            ctx.lineWidth = 2;
            ctx.strokeStyle = open ? T.wPath : T.boxDanger;
            rrect(ctx, cxx + 1.5, ry + 1.5, l.cellW - 3, l.cellH - 3, 3);
            ctx.stroke();
            ctx.restore();
          }

          // 글자로도 구분된다(계약 §5). 본문 §4.2 의 콘솔 표는 O / . 를 쓰지만
          // 화면에서 O 는 숫자 0 으로 읽혀 "열려 있음"과 정반대의 인상을 준다.
          // 그래서 채운 점과 작은 점으로 바꿨다. 패턴은 콘솔 표와 한 칸씩 같다.
          var glyph = open ? '●' : '·';
          var col = T.fgFaint;
          if (open) col = isNow ? T.wPath : (wasUsed ? T.fg : T.fgDim);
          if (!open && (wasRej || (isNow && !open))) { glyph = '×'; col = T.boxDanger; }
          ctx.fillStyle = col;
          ctx.font = ((isNow || (open && wasUsed)) ? '700 ' : '') + (open ? l.mfs : l.mfs + 1) + 'px ' + MONO;
          ctx.textAlign = 'center';
          ctx.globalAlpha = (!open && wasRej && !isNow) ? 0.6 : 1;
          ctx.fillText(glyph, cxx + l.cellW / 2, ry + l.cellH / 2);
          ctx.globalAlpha = 1;
        }
      }

      // 격자선
      ctx.save();
      ctx.strokeStyle = T.border;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 0; i <= S; i++) {
        var gy2 = y0 + l.mHeadH + i * l.cellH + 0.5;
        ctx.moveTo(x0 + l.labelW, gy2);
        ctx.lineTo(x0 + l.labelW + E * l.cellW, gy2);
      }
      for (j = 0; j <= E; j++) {
        var gx2 = x0 + l.labelW + j * l.cellW + 0.5;
        ctx.moveTo(gx2, y0 + l.mHeadH);
        ctx.lineTo(gx2, y0 + l.mHeadH + S * l.cellH);
      }
      ctx.stroke();
      ctx.restore();

      // 칸 수 캡션 — 본문 §4.2 의 "42칸 중 11칸" 문장이 여기서 그대로 나온다.
      var total = S * E;
      ctx.fillStyle = T.fgFaint;
      ctx.font = (l.tiny ? 9 : 10) + 'px ' + SANS;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('열린 칸 ' + model.filled + ' · 빈칸 ' + (total - model.filled) + ' / 전체 ' + total,
                   x0, y0 + l.mHeadH + S * l.cellH + 4);
      ctx.restore();
    }

    // ---- 스크립트 테이프 + 현재 줄 ----
    function drawTape(ctx, T, l, s) {
      var i;
      for (i = 0; i < l.chips.length; i++) {
        var c = l.chips[i];
        var state;   // 'past-ok' | 'past-rej' | 'now' | 'now-rej' | 'future'
        if (s.k > c.k) state = pastKind(c.k);
        else if (s.k === c.k) state = (s.kind === 'reject') ? 'now-rej' : 'now';
        else state = 'future';

        var col = T.fgFaint, alpha = 0.1, bold = false, mark = '';
        if (state === 'now') { col = T.wPath; alpha = 0.3; bold = true; mark = ' ✓'; }
        else if (state === 'now-rej') { col = T.boxDanger; alpha = 0.3; bold = true; mark = ' ×'; }
        else if (state === 'past-ok') { col = T.wVisited; alpha = 0.34; mark = ' ✓'; }
        else if (state === 'past-rej') { col = T.boxDanger; alpha = 0.18; mark = ' ×'; }

        ctx.save();
        ctx.fillStyle = T.bgElev;
        rrect(ctx, c.x, c.y, c.w, c.h, 4);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = bold ? 2 : 1;
        ctx.strokeStyle = (state === 'future') ? T.border : col;
        if (state === 'future') ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = (state === 'future') ? T.fgFaint : T.fg;
        ctx.font = (bold ? '700 ' : '') + l.tfs + 'px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.text, c.x + c.w / 2, c.y + c.h / 2 + 0.5);
        ctx.restore();

        if (mark) {
          ctx.fillStyle = col;
          ctx.font = '700 ' + (l.tfs - 1) + 'px ' + SANS;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText(mark.trim(), c.x + c.w - 2, c.y + 1);
        }
      }

      // 현재 줄: 상태 · 진입 동작 · 플래그
      var x = l.pad, y = l.stripY, h = l.stripH;
      var fs = l.tiny ? 9.5 : 10.5;
      ctx.font = fs + 'px ' + SANS;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = T.fgDim;
      ctx.fillText('현재', x, y + h / 2);
      x += estW('현재', fs) + 7;

      var st = model.states[s.state];
      var w1 = estW(st.label, fs) + 14;
      pill(ctx, T, { x: x, y: y, w: w1, h: h }, st.label,
           fs, s.kind === 'reject' ? T.boxDanger : T.wFrontier, true);
      x += w1 + 6;

      var noteTxt = '진입 동작 ' + (s.kind === 'move' && s.note ? s.note : '—');
      var w2 = estW(noteTxt, fs) + 14;
      var noteCol = (s.kind === 'move' && s.note) ? T.wPath : T.fgFaint;
      pill(ctx, T, { x: x, y: y, w: w2, h: h }, noteTxt, fs, noteCol, false);
      x += w2 + 6;

      if (model.flagName) {
        var ft = flagText(model, s.state);
        var w3 = estW(ft, fs) + 14;
        pill(ctx, T, { x: x, y: y, w: w3, h: h }, ft, fs, s.flag ? T.wPath : T.fgFaint, s.flag);
        x += w3 + 6;
      }
    }

    function pastKind(k) {
      return model.outcomes[k] === 'rej' ? 'past-rej' : 'past-ok';
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) { return computeLayout(w, model, view, showRejected).height; },
      draw: function (ctx, size, T) {
        var s = steps[cur];
        if (!s) return;
        var l = L();

        ctx.textBaseline = 'alphabetic';
        if (l.showG) {
          section(ctx, T, l, '상태 그래프 — 어디로 갈 수 있는가', l.gx, l.gtY);
        }
        if (l.showM) {
          section(ctx, T, l, (l.tiny || l.side) ? '전이 격자 — 어디로 갈 수 없는가'
                                                : '전이 격자 (상태 × 이벤트) — 어디로 갈 수 없는가', l.mx, l.mtY);
        }
        if (l.showG) drawGraph(ctx, T, l, s);
        if (l.showM) drawMatrix(ctx, T, l, s);

        section(ctx, T, l, '스크립트', l.pad, (l.chips.length ? l.chips[0].y : l.stripY) - 5);
        drawTape(ctx, T, l, s);

        if (kindNote) {
          ctx.fillStyle = T.fgFaint;
          ctx.font = (l.tiny ? 8.5 : 9.5) + 'px ' + SANS;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(kindNote, size.w - l.pad, l.height - 2);
        }
        if (model.dropped) {
          ctx.fillStyle = T.boxWarn;
          ctx.font = (l.tiny ? 8.5 : 9.5) + 'px ' + SANS;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText('알 수 없는 상태·중복을 가리키는 전이 ' + model.dropped + '개를 버렸다',
                       size.w - l.pad, l.height - (kindNote ? 13 : 2));
        }
      }
    });

    var play = K.player(ui, {
      total: function () { return steps.length; },
      render: function (i) { cur = i; cv.redraw(); },
      label: function (i) { return steps[i] ? steps[i].msg : ''; },
      speed: 760
    });

    play.goto(0);

    // 테스트·디버깅 훅. 전역 오염은 금지라 host 요소에만 붙인다(계약 §1).
    host.__stateMachine = {
      kind: function () { return kind; },
      model: function () { return model; },
      states: function () { return model.states.map(function (s) { return s.id; }); },
      events: function () { return model.events.slice(); },
      transitions: function () { return model.trans.slice(); },
      matrix: function () { return model.matrix.map(function (r) { return r.slice(); }); },
      filled: function () { return model.filled; },
      steps: function () { return steps; },
      // 본문 §3 의 손추적 표와 같은 모양으로 낸다. 이것이 위젯이 챕터와
      // 같은 말을 하는지 확인하는 유일한 방법이다(계약 §9).
      trace: function () {
        var out = [];
        for (var i = 1; i < steps.length; i++) {
          var s = steps[i];
          if (s.kind !== 'move' && s.kind !== 'reject') continue;
          out.push({
            step: s.k,
            event: s.ev,
            from: model.states[s.from].id,
            found: s.kind === 'move',
            to: model.states[s.state].id,
            note: (s.kind === 'move' && s.note) ? s.note : '—',
            flag: s.flag ? '켜짐' : '꺼짐'
          });
        }
        return out;
      },
      view: function () { return view; },
      setView: function (v) {
        if (['both', 'graph', 'matrix'].indexOf(v) < 0) return false;
        view = v;
        cache = null;
        if (segEl) {
          Array.prototype.forEach.call(segEl.children, function (c) {
            c.classList.toggle('is-active', c.getAttribute('data-val') === view);
          });
        }
        cv.redraw();
        return true;
      },
      layout: function () { return L(); },
      goto: function (i) { play.goto(i); }
    };
  });
})();

/* ==== tree-traversal.js ==== */
/* tree-traversal.js — 전위 · 중위 · 후위 · 레벨 순회와 호출 스택
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **네 순회는 다른 알고리즘이 아니다. 같은 재귀에서 "자기를 출력하는 줄"이
 *   어디에 놓였느냐의 차이일 뿐이다.**
 * 그 차이는 트리 그림만으로는 절대 보이지 않는다. 보이는 곳은 호출 스택이다.
 * 그래서 트리와 스택을 나란히 놓고 같은 노드를 양쪽에서 동시에 강조한다.
 * 프레임 안의 [1] [2] [3] 표식은 본문 II-10 §2 의 세 시점 표기와 같은 것이다.
 *
 *   visit(u):
 *       [1] 여기 → 전위      (들어가면서)
 *       visit(u.left)
 *       [2] 여기 → 중위      (왼쪽을 끝내고)
 *       visit(u.right)
 *       [3] 여기 → 후위      (자식을 다 끝내고)
 *
 * 레벨 순회만 계보가 다르다. 스택이 아니라 큐를 쓴다 — 그래서 이 순회에서는
 * 같은 자리에 스택 대신 **큐**를 그리고 이름표도 바꿔 단다. 자료구조 하나를
 * 바꾼 것이 깊이 우선을 너비 우선로 바꾼다는 사실이 이 위젯의 두 번째 교훈이다.
 *
 * 왜 출력열을 트리 아래에 따로 쌓는가: 순회의 결과물은 "노드에 칠해진 색"이
 * 아니라 **순서를 가진 수열**이다. 수열이 한 칸씩 자라나는 것을 봐야
 * "중위는 정렬이 나온다"(II-9) 같은 문장이 눈으로 확인된다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 노드가 이보다 많아지면 잎 간격이 글자보다 좁아져 읽을 수 없다.
  // "많이 보여주기"보다 "읽히게 보여주기"가 우선이라 여기서 자른다.
  var MAX_N = 31;
  var MAX_STEPS = 400;   // 계약 §7: 스텝 수 상한

  // ---------------------------------------------------------------- opts 검증
  //
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 무엇이 들어와도 던지지 않는다.

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function toNum(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return null;
  }

  // 노드 표시 라벨. 숫자든 짧은 문자열이든 받되 칸에 들어갈 길이로 자른다.
  function toLabel(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? String(v) : null;
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      return s.length > 4 ? s.slice(0, 4) : s;
    }
    return null;
  }

  var ORDER_ALIAS = {
    pre: 'pre', preorder: 'pre', 'pre-order': 'pre', 전위: 'pre',
    'in': 'in', inorder: 'in', 'in-order': 'in', 중위: 'in',
    post: 'post', postorder: 'post', 'post-order': 'post', 후위: 'post',
    level: 'level', levelorder: 'level', 'level-order': 'level', bfs: 'level', 레벨: 'level'
  };

  var ORDER_LABEL = { pre: '전위', 'in': '중위', post: '후위', level: '레벨' };
  var ORDER_FULL = {
    pre: '전위 (뿌리 → 왼쪽 → 오른쪽)',
    'in': '중위 (왼쪽 → 뿌리 → 오른쪽)',
    post: '후위 (왼쪽 → 오른쪽 → 뿌리)',
    level: '레벨 (깊이 순 — 큐를 쓴다)'
  };

  function normOrder(v) {
    if (typeof v !== 'string') return null;
    return ORDER_ALIAS[v.trim().toLowerCase()] || null;
  }

  // ---------------------------------------------------------------- 트리 만들기
  //
  // 세 가지 입력을 받는다. 본문 저자가 상황에 따라 편한 형태를 쓰기 때문이다.
  //   tree: [50,30,70,...]      레벨 순서 배열 (힙 위젯과 같은 규칙: 자식 2i+1, 2i+2)
  //   tree: {v:50,l:{...},r:{}} 중첩 객체
  //   edges: [[1,2],[1,3]] + root   간선 목록 (IV-8 처럼 그래프로 주어진 트리)
  //   values: [...] + bst:true      삽입으로 BST 를 만든다

  function newNode(id, label) {
    return { id: id, label: label, left: -1, right: -1, kids: [], parent: -1, depth: 0 };
  }

  function fromArray(arr) {
    if (!isArr(arr) || arr.length === 0) return null;
    var rootLabel = toLabel(arr[0]);
    if (rootLabel === null) return null;
    var ns = [newNode(0, rootLabel)];
    var slot = {};            // 배열 인덱스 → 노드 id
    slot[0] = 0;
    var q = [0];
    while (q.length) {
      var ai = q.shift();
      var node = ns[slot[ai]];
      var pair = [2 * ai + 1, 2 * ai + 2];
      for (var s = 0; s < 2; s++) {
        var ci = pair[s];
        if (ci >= arr.length || ns.length >= MAX_N) continue;
        var lb = toLabel(arr[ci]);
        if (lb === null) continue;              // 빈 자리 = 자식 없음
        var child = newNode(ns.length, lb);
        child.parent = node.id;
        child.depth = node.depth + 1;
        ns.push(child);
        slot[ci] = child.id;
        if (s === 0) node.left = child.id; else node.right = child.id;
        node.kids.push(child.id);
        q.push(ci);
      }
    }
    return ns;
  }

  function fromNested(obj) {
    if (!obj || typeof obj !== 'object' || isArr(obj)) return null;
    var ns = [];
    function walk(o, parent, depth) {
      if (!o || typeof o !== 'object' || ns.length >= MAX_N) return -1;
      var lb = toLabel(o.v !== undefined ? o.v : (o.value !== undefined ? o.value : o.key));
      if (lb === null) return -1;
      var n = newNode(ns.length, lb);
      n.parent = parent;
      n.depth = depth;
      ns.push(n);
      var l = walk(o.l !== undefined ? o.l : o.left, n.id, depth + 1);
      var r = walk(o.r !== undefined ? o.r : o.right, n.id, depth + 1);
      n.left = l; n.right = r;
      if (l >= 0) n.kids.push(l);
      if (r >= 0) n.kids.push(r);
      return n.id;
    }
    var root = walk(obj, -1, 0);
    return root === 0 ? ns : null;
  }

  function fromEdges(edges, rootOpt) {
    if (!isArr(edges) || edges.length === 0) return null;
    var adj = {};             // 라벨 → 이웃 라벨 배열
    var seen = [];
    function touch(k) {
      if (!adj[k]) { adj[k] = []; seen.push(k); }
    }
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (!isArr(e) || e.length < 2) continue;
      var a = toLabel(e[0]), b = toLabel(e[1]);
      if (a === null || b === null || a === b) continue;
      touch(a); touch(b);
      if (adj[a].indexOf(b) < 0) adj[a].push(b);
      if (adj[b].indexOf(a) < 0) adj[b].push(a);
    }
    if (!seen.length) return null;

    var rootLabel = toLabel(rootOpt);
    if (rootLabel === null || !adj[rootLabel]) rootLabel = seen[0];

    // 자식 순서를 정렬해 고정한다. 스텝이 매번 같아야 되감기와 테스트가 재현된다.
    var numeric = seen.every(function (k) { return toNum(k) !== null; });
    function sortKids(list) {
      var out = list.slice();
      out.sort(function (x, y) {
        return numeric ? (toNum(x) - toNum(y)) : (x < y ? -1 : (x > y ? 1 : 0));
      });
      return out;
    }

    var ns = [newNode(0, rootLabel)];
    var idOf = {};
    idOf[rootLabel] = 0;
    var q = [rootLabel];
    var visited = {};
    visited[rootLabel] = true;
    while (q.length) {
      var cur = q.shift();
      var node = ns[idOf[cur]];
      var nb = sortKids(adj[cur]);
      for (var j = 0; j < nb.length; j++) {
        var c = nb[j];
        if (visited[c] || ns.length >= MAX_N) continue;   // 부모로 되돌아가는 간선은 여기서 걸린다
        visited[c] = true;
        var child = newNode(ns.length, c);
        child.parent = node.id;
        child.depth = node.depth + 1;
        ns.push(child);
        idOf[c] = child.id;
        node.kids.push(child.id);
        q.push(c);
      }
    }
    return ns;
  }

  function fromBST(values) {
    if (!isArr(values)) return null;
    var ns = [];
    for (var i = 0; i < values.length && ns.length < MAX_N; i++) {
      var v = toNum(values[i]);
      if (v === null) continue;
      var lb = toLabel(v);
      if (ns.length === 0) { ns.push(newNode(0, lb)); continue; }
      // 삽입: 작으면 왼쪽, 크면 오른쪽. 같은 값은 버린다(중복은 BST 의 정렬 증명을 흐린다).
      var cur = 0, guard = 0;
      while (guard++ < MAX_N * 2) {
        var node = ns[cur];
        var nv = toNum(node.label);
        if (v === nv) { cur = -1; break; }
        var goLeft = v < nv;
        var next = goLeft ? node.left : node.right;
        if (next < 0) {
          var child = newNode(ns.length, lb);
          child.parent = node.id;
          child.depth = node.depth + 1;
          ns.push(child);
          if (goLeft) node.left = child.id; else node.right = child.id;
          node.kids = [];
          if (node.left >= 0) node.kids.push(node.left);
          if (node.right >= 0) node.kids.push(node.right);
          cur = -1;
          break;
        }
        cur = next;
      }
    }
    return ns.length ? ns : null;
  }

  var DEFAULT_TREE = [50, 30, 70, 20, 40, 60, 80];

  function buildModel(opts) {
    var ns = null;
    if (opts.bst === true && isArr(opts.values)) ns = fromBST(opts.values);
    if (!ns && isArr(opts.tree)) ns = fromArray(opts.tree);
    if (!ns && opts.tree && typeof opts.tree === 'object') ns = fromNested(opts.tree);
    if (!ns && isArr(opts.edges)) ns = fromEdges(opts.edges, opts.root);
    if (!ns && isArr(opts.values)) ns = fromBST(opts.values);
    if (!ns) ns = fromArray(DEFAULT_TREE);

    // 이진 트리인가 — 자식이 셋 이상인 노드가 하나라도 있으면 중위는 정의되지 않는다.
    // (II-10 §2.1: "가운데"가 어디인지 정할 수 없기 때문이다.)
    var binary = true, height = 0, i;
    for (i = 0; i < ns.length; i++) {
      if (ns[i].kids.length > 2) binary = false;
      if (ns[i].depth > height) height = ns[i].depth;
    }

    // 순회가 볼 슬롯을 확정한다. 이진이면 [왼쪽, 오른쪽] 두 칸(-1 = 없음)이고,
    // 그렇지 않으면 자식 목록 그대로다.
    for (i = 0; i < ns.length; i++) {
      var n = ns[i];
      if (binary) {
        if (n.left < 0 && n.right < 0 && n.kids.length) {
          // 간선 목록으로 만든 트리는 좌우 구분이 없다. 정렬된 자식 순서를 좌우로 삼는다.
          n.left = n.kids.length > 0 ? n.kids[0] : -1;
          n.right = n.kids.length > 1 ? n.kids[1] : -1;
        }
        n.slots = [n.left, n.right];
      } else {
        n.slots = n.kids.slice();
      }
    }

    // 중위 순회가 실제로 정렬을 내는가 — 저자가 shape:"bst" 라고 적었더라도
    // 값으로 직접 확인한다. 위젯이 거짓말을 하면 안 된다(계약 §9).
    var seq = [];
    (function inorder(u) {
      if (u < 0) return;
      inorder(ns[u].left);
      seq.push(ns[u].label);
      inorder(ns[u].right);
    })(0);
    var sorted = binary && seq.length === ns.length;
    for (i = 1; sorted && i < seq.length; i++) {
      var a = toNum(seq[i - 1]), b = toNum(seq[i]);
      if (a === null || b === null || !(a < b)) sorted = false;
    }

    return { nodes: ns, root: 0, binary: binary, height: height, sortedInorder: sorted };
  }

  // ---------------------------------------------------------------- 순회 스텝
  //
  // 계약 §7: 상태를 미리 전부 계산해 배열에 담는다. render(i) 는 그리기만 한다.
  // 그래야 되감기가 즉시 되고, 같은 i 는 항상 같은 그림이 된다.
  //
  // 알고리즘은 본문 II-10 §4 의 `::: dual` 코드와 같다. 다른 것은 재귀를
  // 명시적 프레임으로 펼쳐 스택을 그릴 수 있게 한 것뿐이다.

  function buildSteps(model, order, accumulate) {
    var ns = model.nodes;
    var N = ns.length;
    var steps = [];
    var out = [];                       // 출력된 노드 id (순서 그대로)
    var stack = [];                     // 재귀 프레임 {u, st}
    var vals = new Array(N);            // 노드에 붙는 누적값 (깊이 또는 서브트리 크기)
    var size = new Array(N);
    var truncated = false;
    for (var z = 0; z < N; z++) { vals[z] = null; size[z] = 0; }

    // 어떤 값을 노드에 붙일 것인가.
    //   깊이는 **내려가는 길**에 확정되고(전위·레벨), 서브트리 크기는 **올라오는 길**에만
    //   확정된다(후위). IV-8 이 "한 번의 DFS 가 양방향 정보를 다 나른다"고 말하는 그 두 값이다.
    //   중위에는 둘 다 걸리지 않으므로 아무것도 붙이지 않는다 — 정렬 출력에서 눈을 뺏기지 않게.
    var showDepth = (accumulate === 'depth') || (accumulate === 'size' && (order === 'pre' || order === 'level'));
    var showSize = (accumulate === 'size' && order === 'post');

    function lab(id) { return id >= 0 ? ns[id].label : '없음'; }

    // 조사 맞추기. 숫자 라벨은 읽는 소리의 받침에 따라 을/를이 갈린다
    // (50 → 오십'을', 40 → 사십'를'... 이 아니라 사십'을'? 아니다 — 4는 '사'라
    //  받침이 없어 40 은 '사십'으로 읽히므로 받침 ㅂ이 아니라 ㅂ... 여기서는
    //  마지막 자릿수의 소리를 기준으로 삼는다: 0 영·1 일·3 삼·6 육·7 칠·8 팔은 받침 있음).
    // 위젯이 읽어 주는 문장이라 조사가 틀리면 그대로 눈에 띈다.
    function hasJong(s) {
      var ch = s.charAt(s.length - 1);
      if (ch >= '0' && ch <= '9') return '013678'.indexOf(ch) >= 0;
      var code = s.charCodeAt(s.length - 1);
      if (code >= 0xAC00 && code <= 0xD7A3) return ((code - 0xAC00) % 28) !== 0;
      return false;
    }
    function ul(id) { return lab(id) + (hasJong(lab(id)) ? ' 을' : ' 를'); }
    function eun(id) { return lab(id) + (hasJong(lab(id)) ? ' 은' : ' 는'); }
    function ro(id) {
      var s = lab(id);
      var ch = s.charAt(s.length - 1);
      var rieul;
      if (ch >= '0' && ch <= '9') rieul = '178'.indexOf(ch) >= 0;   // 일·칠·팔은 ㄹ 받침
      else {
        var code = s.charCodeAt(s.length - 1);
        rieul = (code >= 0xAC00 && code <= 0xD7A3) && ((code - 0xAC00) % 28) === 8;
      }
      return s + (hasJong(s) && !rieul ? ' 으로' : ' 로');
    }
    function seqText(k) {
      // 출력열이 길어지면 상태 줄이 넘친다. 뒤쪽 몇 개만 보인다.
      var arr = out.map(lab);
      if (arr.length <= k) return arr.join(' ');
      return '… ' + arr.slice(arr.length - k).join(' ');
    }

    function snap(o) {
      if (steps.length >= MAX_STEPS) { truncated = true; return false; }
      var fr = [];
      for (var i = 0; i < stack.length; i++) fr.push({ u: stack[i].u, st: stack[i].st });
      steps.push({
        kind: o.kind,
        u: o.u == null ? -1 : o.u,
        visit: !!o.visit,
        stack: fr,
        pop: o.pop || null,               // 지금 빠져나가는 프레임 (점선으로 그린다)
        queue: o.queue ? o.queue.slice() : null,
        out: out.slice(),
        vals: vals.slice(),
        edge: o.edge || null,
        msg: o.msg || ''
      });
      return true;
    }

    function depthNote(u) {
      return showDepth ? ' 깊이 ' + ns[u].depth + '.' : '';
    }

    // ---- 깊이 우선 (전위 · 중위 · 후위) ----
    function dfs(u) {
      var node = ns[u];
      var parent = node.parent;
      stack.push({ u: u, st: 0 });

      if (showDepth) vals[u] = node.depth;   // 깊이는 내려가는 길에 확정된다

      var visitNow = (order === 'pre');
      if (visitNow) out.push(u);

      var msg;
      if (visitNow) {
        msg = lab(u) + ' 에 들어간다. 전위는 [1] 자리 — 들어가는 순간 출력한다. ' +
              '부모까지의 결과는 이미 확정되어 있다.' + depthNote(u) +
              ' → 출력 ' + seqText(8);
      } else {
        var firstChild = node.slots.length ? node.slots[0] : -1;
        var next;
        if (firstChild >= 0) {
          next = (model.binary ? '왼쪽 자식 ' : '첫 자식 ') + ro(firstChild) + ' 내려간다.';
        } else if (node.kids.length) {
          // 왼쪽만 비어 있는 경우다. "자식이 없다"고 쓰면 그림과 어긋난다.
          next = order === 'in'
            ? '왼쪽 자식이 없다. 왼쪽 서브트리가 비었으니 곧장 [2] 자리로 간다.'
            : '왼쪽 자식이 없어 오른쪽 자식 ' + ro(node.kids[0]) + ' 바로 넘어간다.';
        } else {
          next = '잎이라 내려갈 자식이 없어 바로 되돌아갈 준비를 한다.';
        }
        msg = ul(u) + ' 호출한다. 프레임을 쌓는다. ' + next +
              ' 아직 출력하지 않는다 — ' + (order === 'in' ? '중위는 [2]' : '후위는 [3]') + ' 자리에서 찍는다.' +
              ' 스택 깊이 ' + stack.length + '.';
      }
      if (!snap({ kind: 'enter', u: u, visit: visitNow, edge: parent >= 0 ? { a: parent, b: u, dir: 'down' } : null, msg: msg })) return;

      var slots = node.slots;
      for (var s = 0; s < slots.length; s++) {
        var c = slots[s];
        if (c >= 0) {
          dfs(c);
          if (truncated) return;
        }
        stack[stack.length - 1].st = s + 1;

        // 중위: 왼쪽 슬롯을 끝낸 [2] 자리가 출력 시점이다.
        if (order === 'in' && s === 0) {
          out.push(u);
          var m2 = c >= 0
            ? lab(u) + ' 의 왼쪽 서브트리를 다 돌았다. 중위 순회는 여기서 ' + ul(u) + ' 출력한다.'
            : eun(u) + ' 왼쪽 자식이 없다. 왼쪽 서브트리가 비었으니 [2] 자리에 곧바로 도달해 ' + ul(u) + ' 출력한다.';
          if (model.sortedInorder) m2 += ' 지금까지 오름차순이다.';
          if (!snap({ kind: 'mid', u: u, visit: true, msg: m2 + ' → 출력 ' + seqText(8) })) return;
        }
      }

      // ---- 나가는 길: 자식의 결과가 전부 모인 유일한 시점 ----
      var sum = 0, parts = [];
      for (var t = 0; t < node.kids.length; t++) { sum += size[node.kids[t]]; parts.push(String(size[node.kids[t]])); }
      size[u] = 1 + sum;
      if (showSize) vals[u] = size[u];

      var visitOut = (order === 'post');
      if (visitOut) out.push(u);
      var frame = stack.pop();

      var m3;
      if (visitOut) {
        m3 = lab(u) + ' 의 자식을 모두 끝냈다. 후위는 [3] 자리 — 여기서 ' + ul(u) + ' 출력한다.';
        if (showSize) {
          m3 += parts.length
            ? ' 자식의 값이 다 모였으므로 size(' + lab(u) + ') = 1 + ' + parts.join(' + ') + ' = ' + size[u] + '.'
            : ' 잎이라 더할 자식이 없다. size(' + lab(u) + ') = 1.';
        }
        m3 += ' → 출력 ' + seqText(8);
      } else {
        m3 = lab(u) + ' 의 프레임을 팝한다. ' +
             (parent >= 0
               ? '부모 ' + ro(parent) + ' 돌아가 ' + (order === 'in' ? '오른쪽' : '다음') + ' 차례를 이어간다.'
               : '루트까지 돌아왔다. 스택이 비면 순회가 끝난다.');
      }
      snap({ kind: 'exit', u: u, visit: visitOut, pop: frame, edge: parent >= 0 ? { a: parent, b: u, dir: 'up' } : null, msg: m3 });
    }

    // ---- 너비 우선 (레벨) ----
    function bfs() {
      var q = [model.root];
      snap({
        kind: 'init', u: -1, queue: q,
        msg: '큐에 루트 ' + ul(model.root) + ' 넣는다. 코드는 전위의 명시적 스택 버전과 같고 ' +
             '자료구조만 스택 → 큐로 바뀌었다. 이 한 글자가 깊이 우선을 너비 우선으로 바꾼다.'
      });
      var guard = 0;
      while (q.length && guard++ < MAX_N + 2) {
        var u = q.shift();
        if (showDepth) vals[u] = ns[u].depth;
        out.push(u);
        var kids = ns[u].kids;
        for (var i = 0; i < kids.length; i++) q.push(kids[i]);
        var kidText = '';
        if (kids.length) {
          // 목록 뒤의 조사도 마지막 항목의 받침을 따른다.
          kidText = '자식 ' + kids.slice(0, -1).map(lab).concat([ul(kids[kids.length - 1])]).join(', ') +
                    ' 큐 뒤에 넣는다.';
        } else {
          kidText = '잎이라 넣을 자식이 없다.';
        }
        var msg = '큐 앞에서 ' + ul(u) + ' 꺼내 출력한다. ' + kidText +
                  ' 큐: [' + q.map(lab).join(', ') + ']. 레벨 ' + ns[u].depth + '.' +
                  // 같은 설명을 매 스텝 반복하면 상태 줄이 소음이 된다. 처음 한 번만.
                  (out.length === 1 ? ' 가중치가 전부 1일 때 이 레벨 번호가 곧 최단 거리다.' : '');
        if (!snap({ kind: 'deq', u: u, visit: true, queue: q, edge: ns[u].parent >= 0 ? { a: ns[u].parent, b: u, dir: 'down' } : null, msg: msg })) return;
      }
    }

    if (order === 'level') bfs();
    else dfs(model.root);

    // 마지막 스텝: 수열 전체가 답이다. 여기서만 금색(wPath)을 쓴다.
    if (!truncated) {
      var full = out.map(lab).join(' ');
      var tail = '';
      if (order === 'in' && model.sortedInorder) {
        tail = ' 오름차순으로 정렬되어 나왔다 — BST 의 불변식이 곧 "중위 순서 = 정렬 순서"라는 문장이다.';
      } else if (order === 'post' && accumulate === 'size') {
        tail = ' 루트의 size = ' + size[model.root] + ' 이고 이것이 전체 노드 수다. 한 번의 순회로 모든 서브트리 크기가 채워졌다.';
      } else if (order === 'level') {
        tail = ' 이 순서가 곧 BFS 순서다.';
      } else if (order === 'pre') {
        tail = ' 뿌리가 맨 앞이고, 서브트리 하나를 완전히 끝낸 뒤 다음 서브트리로 넘어갔다.';
      }
      snap({
        kind: 'done', u: -1, queue: order === 'level' ? [] : null,
        msg: ORDER_LABEL[order] + ' 순회 완료. 결과: ' + full + '.' + tail
      });
    } else {
      steps.push({
        kind: 'done', u: -1, visit: false, stack: [], pop: null, queue: null,
        out: out.slice(), vals: vals.slice(), edge: null,
        msg: '스텝이 ' + MAX_STEPS + '개를 넘어 여기서 자른다. 트리가 너무 크다.'
      });
    }

    return { steps: steps, out: out.slice(), sizes: size.slice() };
  }

  // ---------------------------------------------------------------- 배치
  //
  // 왜 "타이디 배치"인가 (heap-ops 와 같은 방식): 레벨마다 2^d 칸을 통째로 잡으면
  // 마지막 레벨이 반만 차 있어도 폭을 다 먹어 좁은 화면에서 글자가 뭉갠다.
  // 잎을 왼쪽부터 차례로 세우고 부모를 자식들의 중점에 두면 실제 노드 수만큼만
  // 폭을 쓴다. 이 방식은 정의상 간선이 서로 교차하지 않는다.
  //
  // 자식이 하나뿐인 이진 노드는 **빈 칸을 예약**한다. 그래야 왼쪽 자식이 왼쪽에,
  // 오른쪽 자식이 오른쪽에 보인다 — 중위 순회를 설명하는 위젯에서 좌우가
  // 뒤집혀 보이면 그림이 거짓말을 한다.
  function tidyCols(model) {
    var ns = model.nodes;
    var col = new Array(ns.length);
    var next = 0;
    (function walk(u) {
      var n = ns[u];
      var slots = n.slots;
      var real = 0, i;
      for (i = 0; i < slots.length; i++) if (slots[i] >= 0) real++;
      if (!real) { col[u] = next++; return; }
      var first = null, last = null;
      for (i = 0; i < slots.length; i++) {
        var c = slots[i];
        var cx;
        if (c >= 0) { walk(c); cx = col[c]; }
        else if (model.binary) { cx = next++; }     // 빈 슬롯도 자리를 차지한다
        else continue;
        if (first === null) first = cx;
        last = cx;
      }
      col[u] = (first + last) / 2;
    })(model.root);
    return { col: col, cols: Math.max(1, next) };
  }

  function layout(w, model, order, showStack, outCount, maxFrames) {
    var tiny = w < 520, narrow = w < 790;
    var pad = tiny ? 6 : (narrow ? 10 : 16);
    var headH = tiny ? 13 : 15;
    var nodeH = tiny ? 22 : (narrow ? 26 : 30);
    // 간선이 보이는 길이. 자식 위 16px 은 누적값 필의 자리이고, 그 위에 방향 라벨(13)이
    // 한 줄 더 들어가야 한다. 그래서 좁지 않은 폭에서는 32 이상을 확보한다.
    var edge = tiny ? 24 : (narrow ? 32 : 36);
    var vgap = nodeH + edge;

    var t = tidyCols(model);
    var levels = model.height + 1;

    var isLevel = (order === 'level');
    // 스택 패널을 옆에 둘 것인가. 좁으면 트리 아래 가로 띠로 눕힌다.
    // 큐(레벨 순회)는 본래 가로로 읽는 것이라 폭과 무관하게 항상 아래에 눕힌다.
    // 700px 은 본문 칼럼(약 750px)이 들어오는 선이다. 데스크톱에서 챕터를 열면
    // 스택이 세로로 서고, 폰에서는 가로로 눕는다.
    var sideStack = showStack && !isLevel && w >= 700;
    var panelW = sideStack ? (w >= 900 ? 192 : 164) : 0;

    var availW = Math.max(80, w - pad * 2);
    var treeAreaW = Math.max(80, availW - (panelW ? panelW + 14 : 0));
    var colW = Math.min(treeAreaW / t.cols, tiny ? 48 : (narrow ? 72 : 102));
    var nodeW = Math.max(20, Math.min(colW * (tiny ? 0.84 : 0.8), tiny ? 40 : (narrow ? 48 : 56)));
    var treeW = colW * t.cols;
    var treeX = pad + Math.max(0, (treeAreaW - treeW) / 2);

    var treeTop = pad + headH + (tiny ? 12 : 14);   // 루트 위 누적값 필 자리
    var treeH = (levels - 1) * vgap + nodeH;

    var frameH = tiny ? 20 : 24;
    var panelY = pad + headH;
    var panelH = sideStack ? (maxFrames * (frameH + 4) + 14) : 0;
    if (sideStack) treeH = Math.max(treeH, panelH - (treeTop - panelY));

    var y = treeTop + treeH + (tiny ? 12 : 18);

    // 아래 가로 띠: 스택(눕힌 것) 또는 큐
    var stripTop = 0, stripH = 0;
    if (showStack && !sideStack) {
      stripTop = y + headH;
      stripH = frameH;
      y = stripTop + stripH + (tiny ? 10 : 16);
    }

    // 출력열: 칸 크기를 지키고 줄바꿈한다. 순서를 읽는 것이 목적이라 칸이 작아지면 안 된다.
    var maxLen = 1;
    for (var i = 0; i < model.nodes.length; i++) maxLen = Math.max(maxLen, model.nodes[i].label.length);
    var chipH = tiny ? 20 : 24;
    var chipW = Math.max(tiny ? 24 : 28, 12 + maxLen * (tiny ? 7 : 8.5));
    var perRow = Math.max(1, Math.floor(availW / (chipW + 4)));
    var rows = Math.max(1, Math.ceil(Math.max(1, outCount) / perRow));
    var outTop = y + headH;
    var outBottom = outTop + rows * (chipH + 5) - 5;

    var h = outBottom + pad;
    if (sideStack) h = Math.max(h, panelY + panelH + pad);

    return {
      w: w, tiny: tiny, narrow: narrow, pad: pad, headH: headH,
      cols: t.cols, col: t.col, levels: levels,
      colW: colW, nodeW: nodeW, nodeH: nodeH, vgap: vgap, edge: edge,
      treeX: treeX, treeTop: treeTop, treeH: treeH,
      sideStack: sideStack, panelW: panelW, panelX: pad + treeAreaW + 14, panelY: panelY, panelH: panelH,
      maxFrames: maxFrames,
      frameH: frameH, stripTop: stripTop, stripH: stripH,
      outTop: outTop, outBottom: outBottom, chipW: chipW, chipH: chipH, perRow: perRow, rows: rows,
      height: h
    };
  }

  function nodeXY(L, model, id) {
    return {
      x: L.treeX + (L.col[id] + 0.5) * L.colW - L.nodeW / 2,
      y: L.treeTop + model.nodes[id].depth * L.vgap
    };
  }

  // ---------------------------------------------------------------- 그리기 보조

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // 간선 위의 화살촉. 좁은 화면에서 글자 라벨 대신 방향만 전한다.
  function arrow(ctx, ax, ay, bx, by, up, color) {
    var t = up ? 0.42 : 0.5;
    var cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
    var dx = bx - ax, dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = (dx / len) * (up ? -1 : 1), uy = (dy / len) * (up ? -1 : 1);
    var s = 5.5;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + ux * s, cy + uy * s);
    ctx.lineTo(cx - ux * s - uy * s * 0.7, cy - uy * s + ux * s * 0.7);
    ctx.lineTo(cx - ux * s + uy * s * 0.7, cy - uy * s - ux * s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  K.register('tree-traversal', function (host, opts) {
    opts = opts || {};
    if (typeof opts !== 'object') opts = {};

    var model = buildModel(opts);

    // accumulate: 후위에서는 서브트리 크기, 내려가는 순회에서는 깊이를 노드에 붙인다.
    // IV-8 이 요구하는 "한 번의 DFS 가 양방향 정보를 다 나른다"가 이 표시의 정체다.
    var accumulate = 'size';
    if (opts.accumulate === false || opts.accumulate === 'none') accumulate = 'none';
    else if (opts.accumulate === 'depth') accumulate = 'depth';
    else if (typeof opts.accumulate === 'string' && opts.accumulate !== 'size') accumulate = 'size';

    var showStack = (opts.showStack === false) ? false : true;

    // 제공할 순회 목록. 이진이 아니면 중위는 정의되지 않으므로 뺀다(II-10 §2.1).
    var avail = [];
    if (isArr(opts.orders)) {
      for (var i = 0; i < opts.orders.length; i++) {
        var o = normOrder(opts.orders[i]);
        if (o && avail.indexOf(o) < 0) avail.push(o);
      }
    }
    if (!avail.length) avail = ['pre', 'in', 'post', 'level'];
    if (!model.binary) avail = avail.filter(function (x) { return x !== 'in'; });
    if (!avail.length) avail = ['pre'];

    var order = normOrder(opts.order);
    if (!order || avail.indexOf(order) < 0) order = avail[0];

    // highlight:"sorted-output" — 출력열을 "정렬 결과"로 강조한다(II-9).
    var sortedHint = (opts.highlight === 'sorted-output') && model.sortedInorder;

    var run = null;      // {steps, out, sizes}
    var cur = 0;
    var cache = null;

    var ui = K.frame(host, { title: '', wide: false });
    var titleEl = K.el('div', 'wk-title', '');
    ui.head.insertBefore(titleEl, ui.head.firstChild);

    function stackTitle() {
      return order === 'level' ? '큐 (앞 → 뒤)' : '호출 스택 (아래 → 위)';
    }

    function setTitle() {
      titleEl.textContent = '트리 순회 — ' + ORDER_FULL[order];
    }

    function rebuild(keepIndex) {
      run = buildSteps(model, order, accumulate);
      cache = null;
      setTitle();
      var idx = keepIndex ? Math.min(cur, run.steps.length - 1) : 0;
      cur = idx < 0 ? 0 : idx;
      if (play) play.goto(cur);
    }

    // ---- 머리말 컨트롤 ----
    var segEl = null;
    if (avail.length > 1) {
      segEl = K.seg(ui.slot, avail.map(function (v) { return { label: ORDER_LABEL[v], value: v }; }), order, function (v) {
        order = v;
        rebuild(false);
      });
    }

    // 버튼이 아닌 경로(테스트 훅)로 순회를 바꿔도 눌린 칸이 따라가야 한다.
    function syncSeg() {
      if (!segEl) return;
      Array.prototype.forEach.call(segEl.children, function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-val') === order);
      });
    }

    // ---- 범례 (§5: 색만으로 정보를 주지 않는다. 글자 표식도 같이 쓴다) ----
    var legend = K.el('div', 'wk-legend');
    legend.style.width = '100%';
    legend.innerHTML =
      '<span><i style="background:var(--w-frontier)"></i>지금 보는 노드</span>' +
      '<span><i style="background:var(--accent-dim)"></i>스택에 올라 있음 ([1][2][3] = 코드 위치)</span>' +
      '<span><i style="background:var(--w-visited)"></i>출력됨 (왼쪽 위 숫자 = 몇 번째)</span>' +
      '<span><i style="background:var(--w-path)"></i>방금 출력</span>' +
      (accumulate === 'none' ? '' : '<span>노드 위 필: 내려가며 깊이 d, 올라오며 크기 sz</span>');
    ui.slot.appendChild(legend);

    // 캔버스보다 먼저 스텝을 만든다. ResizeObserver 가 캔버스 생성 직후 비동기로
    // redraw 를 부르는데 그때 run 이 없으면 그리다 던진다.
    var play = null;
    rebuild(false);

    function L() {
      var w = cv.size.w || 320;
      var maxFrames = model.height + 2;      // 프레임 최대 개수 = 높이 + 1, 팝 표시 한 칸
      if (!cache || cache.w !== w || cache.key !== order) {
        cache = layout(w, model, order, showStack, model.nodes.length, maxFrames);
        cache.key = order;
      }
      return cache;
    }

    // 노드 상태 → 색·표식. 우선순위: 방금 출력 > 지금 보는 것 > 스택 > 출력됨 > 보통
    function styleOf(s, id) {
      var onStack = -1;
      for (var i = 0; i < s.stack.length; i++) if (s.stack[i].u === id) onStack = s.stack[i].st;
      var isCur = (s.u === id);
      var rank = s.out.indexOf(id);
      var justOut = s.visit && isCur;

      var st = { c: null, a: 0, lw: 1.2, mark: '', rank: rank >= 0 ? rank + 1 : 0 };
      if (justOut) { st.c = 'wPath'; st.a = 0.34; st.lw = 2.6; }
      else if (isCur) { st.c = 'wFrontier'; st.a = 0.26; st.lw = 2.6; }
      else if (onStack >= 0) { st.c = 'wFrontier'; st.a = 0.10; st.lw = 1.8; }
      else if (rank >= 0) { st.c = 'wVisited'; st.a = 0.36; st.lw = 1.2; }

      if (onStack >= 0 && model.binary) st.mark = '[' + (onStack + 1) + ']';
      else if (onStack >= 0) st.mark = '·' + onStack;
      return st;
    }

    function pill(ctx, T, cx, cy, text, color, l) {
      ctx.save();
      ctx.font = (l.tiny ? 8.5 : 9.5) + 'px ui-monospace, monospace';
      var tw = ctx.measureText(text).width;
      var w = tw + 9, h = 13;
      // 불투명 바탕: 간선 위에 얹혀도 글자가 선에 그어지지 않는다.
      ctx.fillStyle = T.bg;
      rrect(ctx, cx - w / 2, cy - h / 2, w, h, 3);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, cy + 0.5);
      ctx.restore();
    }

    function box(ctx, T, x, y, w, h, text, st, l, dashed) {
      ctx.save();
      // 캔버스는 투명하게 시작한다. 농도(globalAlpha)로 칠하려면 먼저 불투명 바탕을 깔아야 한다.
      ctx.fillStyle = T.bgElev;
      rrect(ctx, x, y, w, h, 5);
      ctx.fill();
      if (st.c) {
        ctx.globalAlpha = st.a;
        ctx.fillStyle = T[st.c];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = st.lw;
      ctx.strokeStyle = st.c ? T[st.c] : T.border;
      if (dashed) { ctx.setLineDash([3, 3]); ctx.strokeStyle = T.fgFaint; }
      ctx.stroke();
      ctx.setLineDash([]);

      var corner = l.tiny ? 8 : 9;
      ctx.font = corner + 'px ui-monospace, monospace';
      ctx.textBaseline = 'top';
      if (st.rank) {
        // 출력 순번을 노드에 직접 찍는다. 수열과 트리를 잇는 다리다.
        // '#' 를 붙이는 이유: 숫자만 찍으면 노드 값과 헷갈린다.
        ctx.fillStyle = T.fgFaint;
        ctx.textAlign = 'left';
        ctx.fillText('#' + st.rank, x + 3, y + 2);
      }
      if (st.mark) {
        ctx.fillStyle = st.c ? T[st.c] : T.fgFaint;
        ctx.textAlign = 'right';
        ctx.fillText(st.mark, x + w - 3, y + 2);
      }

      ctx.fillStyle = T.fg;
      ctx.font = '700 ' + (l.tiny ? 11 : 13) + 'px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x + w / 2, y + h - (l.tiny ? 4 : 6));
      ctx.restore();
    }

    function sectionTitle(ctx, T, l, text, x, y, align) {
      ctx.fillStyle = T.fgDim;
      ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px system-ui, sans-serif';
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x, y);
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) {
        return layout(w, model, order, showStack, model.nodes.length, model.height + 2).height;
      },
      draw: function (ctx, size, T) {
        var s = run.steps[cur];
        if (!s) return;
        var l = L();
        var ns = model.nodes;
        var i;

        ctx.textBaseline = 'alphabetic';
        sectionTitle(ctx, T, l, '트리', l.pad, l.pad + (l.tiny ? 9 : 11));
        // 좁은 화면에서는 순회 이름을 캔버스에 다시 적지 않는다. 머리말 제목에 이미 있고,
        // 루트 위 누적값 필과 자리를 다투기 때문이다.
        if (!l.narrow) sectionTitle(ctx, T, l, ORDER_FULL[order], size.w - l.pad, l.pad + (l.tiny ? 9 : 11), 'right');

        // ---- 간선 ----
        // 지금 타고 내려가거나 올라오는 간선만 강조한다. 전부 칠하면 어디가
        // 현재 경로인지 사라진다.
        for (i = 0; i < ns.length; i++) {
          var p = ns[i].parent;
          if (p < 0) continue;
          var a = nodeXY(l, model, p), b = nodeXY(l, model, i);
          var active = s.edge && ((s.edge.a === p && s.edge.b === i));
          // 스택에 부모와 자식이 함께 올라 있으면 그 간선이 곧 현재 재귀 경로다.
          var onPath = false;
          for (var q = 1; q < s.stack.length; q++) {
            if (s.stack[q].u === i && s.stack[q - 1].u === p) onPath = true;
          }
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(a.x + l.nodeW / 2, a.y + l.nodeH);
          ctx.lineTo(b.x + l.nodeW / 2, b.y);
          if (active) { ctx.strokeStyle = s.edge.dir === 'up' ? T.wVisited : T.wFrontier; ctx.lineWidth = 2.6; }
          else if (onPath) { ctx.strokeStyle = T.wFrontier; ctx.lineWidth = 1.9; ctx.globalAlpha = 0.6; }
          else { ctx.strokeStyle = T.border; ctx.lineWidth = 1.2; }
          ctx.stroke();
          ctx.restore();

          // 방금 지나간 간선에만 방향 표식을 붙인다.
          if (active) {
            var ax = a.x + l.nodeW / 2, ay = a.y + l.nodeH;
            var bx = b.x + l.nodeW / 2, by = b.y;
            var col = s.edge.dir === 'up' ? T.wVisited : T.wFrontier;
            if (l.edge >= 30) {
              // 자식 위 16px 은 누적값 필의 자리다. 그 위쪽 띠의 한가운데에 놓아
              // 두 라벨이 절대 겹치지 않게 한다.
              var py = (ay + (by - 16)) / 2;
              var tt = (by - ay) === 0 ? 0.3 : (py - ay) / (by - ay);
              pill(ctx, T, ax + (bx - ax) * tt, py,
                   order === 'level' ? '↓ 꺼냄' : (s.edge.dir === 'up' ? '↑ 복귀' : '↓ 호출'), col, l);
            } else {
              // 좁은 화면에서는 필 두 개가 들어갈 띠가 없다. 화살촉으로 방향만 준다.
              arrow(ctx, ax, ay, bx, by, s.edge.dir === 'up', col);
            }
          }
        }

        // ---- 노드 ----
        for (i = 0; i < ns.length; i++) {
          var xy = nodeXY(l, model, i);
          box(ctx, T, xy.x, xy.y, l.nodeW, l.nodeH, ns[i].label, styleOf(s, i), l, false);
        }
        // 누적값 필은 노드를 다 그린 뒤 얹는다. 박스 위 빈 띠에 놓아 간선과 겹쳐도
        // 불투명 바탕이 가려 준다.
        if (accumulate !== 'none') {
          for (i = 0; i < ns.length; i++) {
            if (s.vals[i] == null) continue;
            var v = nodeXY(l, model, i);
            var isSize = (order === 'post' && accumulate === 'size');
            pill(ctx, T, v.x + l.nodeW / 2, v.y - (l.tiny ? 8 : 9),
                 (isSize ? 'sz ' : 'd ') + s.vals[i],
                 isSize ? T.wVisited : T.fgFaint, l);
          }
        }

        // ---- 스택 / 큐 ----
        if (showStack) {
          var frames = s.stack;
          var isLevel = (order === 'level');
          if (l.sideStack) {
            // 세로 패널: 아래가 바닥(루트), 위가 top. 스택은 쌓이는 것이라 위로 자란다.
            ctx.save();
            ctx.fillStyle = T.bgCode;
            rrect(ctx, l.panelX, l.panelY, l.panelW, l.panelH, 6);
            ctx.fill();
            ctx.strokeStyle = T.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
            sectionTitle(ctx, T, l, stackTitle(), l.panelX + 9, l.panelY - 4);

            var baseY = l.panelY + l.panelH - 7 - l.frameH;
            // 빈 칸을 점선으로 남긴다. 패널 높이가 곧 "스택이 최대 트리 높이 + 1
            // 프레임까지 자란다"는 사실이고, 빈 칸이 그 여유를 보여 준다.
            ctx.save();
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = T.border;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1;
            for (i = frames.length + (s.pop ? 1 : 0); i < l.maxFrames; i++) {
              rrect(ctx, l.panelX + 8, baseY - i * (l.frameH + 4), l.panelW - 16, l.frameH, 4);
              ctx.stroke();
            }
            ctx.restore();
            for (i = 0; i < frames.length; i++) {
              var fy = baseY - i * (l.frameH + 4);
              var top = (i === frames.length - 1);
              drawFrame(ctx, T, l, l.panelX + 8, fy, l.panelW - 16, frames[i], top, false);
            }
            if (s.pop) {
              drawFrame(ctx, T, l, l.panelX + 8, baseY - frames.length * (l.frameH + 4),
                        l.panelW - 16, s.pop, false, true);
            }
            if (!frames.length && !s.pop) {
              ctx.fillStyle = T.fgFaint;
              ctx.font = (l.tiny ? 9 : 10) + 'px system-ui, sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('비어 있음', l.panelX + l.panelW / 2, l.panelY + l.panelH / 2);
            }
          } else {
            // 가로 띠: 왼쪽이 바닥(또는 큐의 앞), 오른쪽이 top(또는 큐의 뒤).
            sectionTitle(ctx, T, l, isLevel ? '큐 (왼쪽이 앞 — 여기서 꺼낸다)' : '호출 스택 (오른쪽이 top)',
                         l.pad, l.stripTop - 4);
            var items = isLevel ? (s.queue || []).map(function (u) { return { u: u, st: -1 }; }) : frames;
            var fw = Math.max(l.tiny ? 34 : 42, Math.min(l.tiny ? 52 : 74, (l.w - l.pad * 2) / Math.max(4, items.length + (s.pop ? 1 : 0))));
            var fx = l.pad;
            for (i = 0; i < items.length; i++) {
              if (fx + fw > l.w - l.pad) break;
              drawFrame(ctx, T, l, fx, l.stripTop, fw - 4, items[i], !isLevel && i === items.length - 1, false);
              fx += fw;
            }
            if (!isLevel && s.pop && fx + fw <= l.w - l.pad) {
              drawFrame(ctx, T, l, fx, l.stripTop, fw - 4, s.pop, false, true);
            }
            if (!items.length && !s.pop) {
              ctx.fillStyle = T.fgFaint;
              ctx.font = (l.tiny ? 9 : 10) + 'px system-ui, sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText('비어 있음', l.pad + 2, l.stripTop + l.stripH / 2);
            }
          }
        }
        if (l.sideStack && order === 'level') {
          // 도달할 수 없는 조합이지만, 배치가 바뀌어도 큐 이름표가 사라지지 않게 남긴다.
          sectionTitle(ctx, T, l, '큐', l.panelX + 9, l.panelY - 4);
        }

        // ---- 출력열 ----
        var cap = '출력 (' + ORDER_LABEL[order] + ' 순서)';
        if (sortedHint && order === 'in') cap += ' — 오름차순으로 나온다';
        sectionTitle(ctx, T, l, cap, l.pad, l.outTop - 4);
        var done = (s.kind === 'done');
        for (i = 0; i < model.nodes.length; i++) {
          var r = Math.floor(i / l.perRow), c = i % l.perRow;
          var cx0 = l.pad + c * (l.chipW + 4);
          var cy0 = l.outTop + r * (l.chipH + 5);
          var filled = i < s.out.length;
          var stc = { c: null, a: 0, lw: 1, mark: '', rank: 0 };
          if (filled) {
            var last = (i === s.out.length - 1);
            stc.c = done ? 'wPath' : (last ? 'wPath' : 'wVisited');
            stc.a = done ? 0.28 : (last ? 0.34 : 0.3);
            stc.lw = last ? 2.2 : 1.2;
          }
          ctx.save();
          if (!filled) ctx.globalAlpha = 0.45;
          box(ctx, T, cx0, cy0, l.chipW, l.chipH,
              filled ? model.nodes[s.out[i]].label : '·', stc, l, !filled);
          ctx.restore();
        }
      }
    });

    function drawFrame(ctx, T, l, x, y, w, f, isTop, dashed) {
      var st = {
        c: dashed ? null : (isTop ? 'wFrontier' : 'accentDim'),
        a: dashed ? 0 : (isTop ? 0.26 : 0.12),
        lw: isTop ? 2.2 : 1.2,
        mark: '',
        rank: 0
      };
      // accent-dim 은 토큰 표에 있는 값이다. 없으면 frontier 로 떨어뜨린다.
      if (st.c === 'accentDim' && !T.accentDim) st.c = 'wFrontier';
      var text = model.nodes[f.u].label;
      if (f.st >= 0 && model.binary) text += ' [' + (f.st + 1) + ']';
      else if (f.st > 0) text += ' ·' + f.st;
      ctx.save();
      ctx.fillStyle = T.bgElev;
      rrect(ctx, x, y, w, l.frameH, 4);
      ctx.fill();
      if (st.c) {
        ctx.globalAlpha = st.a;
        ctx.fillStyle = T[st.c];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = st.lw;
      ctx.strokeStyle = dashed ? T.fgFaint : (st.c ? T[st.c] : T.border);
      if (dashed) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = dashed ? T.fgFaint : T.fg;
      ctx.font = (l.tiny ? 10 : 11.5) + 'px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dashed ? text + ' ↑' : text, x + w / 2, y + l.frameH / 2 + 0.5);
      ctx.restore();
    }

    play = K.player(ui, {
      total: function () { return run.steps.length; },
      render: function (i) { cur = i; cv.redraw(); },
      label: function (i) {
        var s = run.steps[i];
        if (!s) return '';
        return '[' + ORDER_LABEL[order] + '] ' + s.msg;
      },
      speed: 640
    });

    setTitle();
    play.goto(0);

    // 테스트·디버깅용 훅. 계약상 전역 오염은 금지라 host 요소에만 붙인다.
    host.__treeTraversal = {
      order: function () { return order; },
      orders: function () { return avail.slice(); },
      setOrder: function (v) {
        var o = normOrder(v);
        if (!o || avail.indexOf(o) < 0) return false;
        order = o;
        rebuild(false);
        syncSeg();
        return true;
      },
      steps: function () { return run.steps; },
      output: function () { return run.out.map(function (u) { return model.nodes[u].label; }); },
      sizes: function () { return run.sizes.slice(); },
      nodes: function () { return model.nodes; },
      model: function () { return model; },
      maxStackDepth: function () {
        var m = 0;
        for (var i = 0; i < run.steps.length; i++) m = Math.max(m, run.steps[i].stack.length);
        return m;
      },
      goto: function (i) { play.goto(i); },
      layout: function () { return L(); }
    };
  });
})();

/* ==== two-pointer.js ==== */
/* two-pointer.js — 창이 늘고 줄어드는 것, 그리고 왜 그것이 O(n) 인가
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **두 포인터는 "두 번 도는 것"이 아니다. 각 인덱스를 왼쪽·오른쪽이 각각
 *   한 번씩만 지나가므로 안쪽 while 이 한 스텝에서 여러 번 돌아도 전체 합이
 *   2n 을 넘지 못한다.**
 * 독자가 가장 자주 설명하지 못하는 지점이 정확히 이것이다. "이중 루프인데 왜
 * O(n²) 가 아닌가"에 답하지 못하면 이 기법은 외운 관용구로 남는다.
 * 그래서 이 위젯의 중심은 창 그림이 아니라 **포인터 이동 카운터**다.
 * 왼쪽 이동과 오른쪽 이동을 따로 세어 두 수의 합이 2n 선을 절대 넘지 않는 것을
 * 스텝마다 보여 준다. 카운터가 없으면 이 위젯은 예쁜 애니메이션일 뿐이다.
 *
 * 왜 한 위젯에 다섯 모드인가
 *   창-합·양끝 쌍·중복 없는 최장 구간·병합·창 최댓값은 겉으로 다른 문제처럼
 *   보이지만 전부 같은 뼈대다: **오른쪽을 밀어 조건을 깨뜨리고, 왼쪽을 당겨
 *   조건을 회복한다.** 같은 화면·같은 카운터로 다섯을 보여 주면 그 뼈대가
 *   남고, 문제마다 다른 위젯을 만들면 관용구 다섯 개가 남는다.
 *
 * 왜 불변식을 화면에 글자로 박아 두는가
 *   창의 색만으로는 "왜 이렇게 밀어도 되는가"가 전달되지 않는다. 두 포인터의
 *   정당성은 전부 불변식 한 줄에서 나온다(예: 덱은 항상 값 내림차순이다).
 *   그 문장이 화면에 없으면 독자는 손동작만 흉내 내게 된다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // ─── 모드 ────────────────────────────────────────────────────────────────

  var MODES = ['window-sum', 'pair-sum', 'longest-unique', 'merge', 'window-max'];

  var MODE_ALIAS = {
    'window-sum': 'window-sum', windowsum: 'window-sum', sum: 'window-sum',
    'min-window': 'window-sum', minwindow: 'window-sum', 최소창: 'window-sum',
    'pair-sum': 'pair-sum', pairsum: 'pair-sum', pair: 'pair-sum',
    'two-sum': 'pair-sum', twosum: 'pair-sum', 양끝: 'pair-sum',
    'longest-unique': 'longest-unique', longestunique: 'longest-unique',
    unique: 'longest-unique', 'no-repeat': 'longest-unique', 중복없는: 'longest-unique',
    merge: 'merge', 병합: 'merge',
    'window-max': 'window-max', windowmax: 'window-max', max: 'window-max',
    'sliding-max': 'window-max', monotonic: 'window-max', 최댓값: 'window-max'
  };

  var MODE_LABEL = {
    'window-sum': '창 합', 'pair-sum': '양 끝 쌍', 'longest-unique': '중복 없는 최장',
    merge: '병합', 'window-max': '창 최댓값'
  };

  var MODE_TITLE = {
    'window-sum': '합이 target 이상인 가장 짧은 구간',
    'pair-sum': '정렬된 배열에서 합이 target 인 두 수',
    'longest-unique': '중복 없는 가장 긴 구간',
    merge: '정렬된 두 배열 합치기',
    'window-max': '크기 k 창의 최댓값 (단조 감소 덱)'
  };

  /* 불변식 — 이 위젯의 본문이다. 각 모드의 정당성이 전부 이 한 줄에서 나온다. */
  var INVARIANT = {
    'window-sum':
      '불변식: 창 [L, R] 의 합이 target 미만인 동안 R 을 민다. 조건을 만족하면 답 후보로 적고 L 을 당겨 더 줄인다. ' +
      'L 은 절대 되돌아가지 않는다 — 각 인덱스를 왼쪽·오른쪽이 각각 한 번씩만 지나가므로 안쪽 while 을 합쳐도 O(n) 이다.',
    'pair-sum':
      '불변식: 합이 작으면 L 을 오른쪽으로, 크면 R 을 왼쪽으로 민다. 버리는 쪽에는 답이 없다는 것이 근거다 — ' +
      'a[L] 이 가장 작은데 합이 모자라면 a[L] 은 어떤 짝과도 target 을 만들지 못한다. 두 포인터가 만날 때까지 각 인덱스를 한 번씩만 지난다.',
    'longest-unique':
      '불변식: 창 [L, R] 안에는 중복이 없다. 중복이 생기면 그것이 사라질 때까지 L 을 당긴다. ' +
      'L 은 되돌아가지 않으므로 전체 이동이 n 을 넘지 않는다 — 그래서 O(n) 이다.',
    merge:
      '불변식: 두 배열이 각각 정렬돼 있으므로 남은 것 중 최솟값은 언제나 두 앞머리 중 하나다. ' +
      '한 번 지나간 앞머리는 되돌아오지 않는다 — 각 원소를 정확히 한 번씩 본다.',
    'window-max':
      '불변식: 덱에는 값이 내림차순인 인덱스만 남는다. 그래서 창의 최댓값은 언제나 덱의 맨 앞이다. ' +
      '각 인덱스는 덱에 정확히 한 번 들어가고 많아야 한 번 나온다 — 안쪽 while 이 한 번에 여러 개를 버려도 전체는 O(n) 이다.'
  };

  var MAX_N = 22;        // 이보다 많으면 400px 폭에서 칸 글자가 뭉갠다
  var MAX_STEPS = 400;   // 계약 §7

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  // 숫자 배열로 정규화. 무엇이 들어와도 던지지 않는다(계약 §1).
  function toNums(v, dflt) {
    if (!isArr(v)) return dflt.slice();
    var out = [];
    for (var i = 0; i < v.length && out.length < MAX_N; i++) {
      var x = v[i];
      if (typeof x === 'string' && x.trim() !== '') x = Number(x);
      if (typeof x === 'number' && isFinite(x)) out.push(Math.round(x));
    }
    return out.length ? out : dflt.slice();
  }

  // 라벨 배열(문자·숫자 아무거나). 중복 판정은 라벨 문자열로 한다.
  function toLabels(v, dflt) {
    if (!isArr(v)) return dflt.slice();
    var out = [];
    for (var i = 0; i < v.length && out.length < MAX_N; i++) {
      var x = v[i];
      if (typeof x === 'number' && isFinite(x)) out.push(String(x));
      else if (typeof x === 'string' && x.trim() !== '') out.push(x.trim().slice(0, 2));
    }
    return out.length ? out : dflt.slice();
  }

  // 읽었을 때 받침이 있는가. 숫자는 0 영·1 일·3 삼·6 육·7 칠·8 팔만 받침이 있다.
  // 위젯이 읽어 주는 문장이라 조사가 틀리면 그대로 눈에 띈다.
  function jong(s) {
    s = String(s);
    var ch = s.charAt(s.length - 1);
    if (ch >= '0' && ch <= '9') return '013678'.indexOf(ch) >= 0;
    var code = s.charCodeAt(s.length - 1);
    if (code >= 0xAC00 && code <= 0xD7A3) return ((code - 0xAC00) % 28) !== 0;
    return false;   // 알파벳은 받침 없는 것으로 읽는다(a 에이, b 비 …)
  }
  function ul(v) { return v + (jong(v) ? '을' : '를'); }
  function iga(v) { return v + (jong(v) ? '이' : '가'); }

  // ─── 기본 데이터 ─────────────────────────────────────────────────────────

  var DEFAULTS = {
    'window-sum': { array: [2, 3, 1, 2, 4, 3], target: 7 },
    'pair-sum': { array: [1, 3, 4, 6, 8, 11, 15], target: 14 },
    'longest-unique': { labels: ['a', 'b', 'c', 'a', 'b', 'c', 'b', 'b'] },
    merge: { a: [1, 4, 7, 9], b: [2, 3, 8, 11, 15] },
    'window-max': { array: [1, 3, -1, -3, 5, 3, 6, 7], window: 3 }
  };

  // ─── 스텝 생성 ───────────────────────────────────────────────────────────
  //
  // 계약 §7: 상태를 미리 전부 계산해 배열에 담는다. render(i) 는 그리기만 한다.
  // 스텝 하나는 **포인터가 한 번 움직이거나 덱이 한 번 바뀌는 사건**이다.
  // 그렇게 두면 스텝 수가 곧 "이 알고리즘이 한 일"의 총량이 되어, 재생 막대의
  // 길이 자체가 O(n) 의 증거가 된다.

  function Trace() {
    this.steps = [];
    this.mvL = 0;         // 왼쪽 포인터(또는 덱 앞) 이동
    this.mvR = 0;         // 오른쪽 포인터(또는 덱 뒤) 이동
    this.over = false;
  }

  Trace.prototype.add = function (s) {
    if (this.steps.length >= MAX_STEPS) { this.over = true; return false; }
    s.mvL = this.mvL;
    s.mvR = this.mvR;
    this.steps.push(s);
    return true;
  };

  /* ① 창 합 — 합이 target 이상인 가장 짧은 구간. */
  function runWindowSum(cfg) {
    var a = cfg.array, n = a.length, target = cfg.target;
    var tr = new Trace();
    var l = 0, sum = 0, best = Infinity, bestSpan = null;

    tr.add({ t: 'init', l: 0, r: -1, sum: 0, best: best, bestSpan: null });
    for (var r = 0; r < n; r++) {
      sum += a[r];
      tr.mvR += 1;
      tr.add({ t: 'expand', l: l, r: r, sum: sum, best: best, bestSpan: bestSpan, ok: sum >= target });
      if (tr.over) break;
      while (sum >= target) {
        var len = r - l + 1;
        var took = false;
        if (len < best) { best = len; bestSpan = [l, r]; took = true; }
        sum -= a[l];
        l += 1;
        tr.mvL += 1;
        tr.add({ t: 'shrink', l: l, r: r, sum: sum, best: best, bestSpan: bestSpan, took: took, dropped: l - 1 });
        if (tr.over) break;
      }
      if (tr.over) break;
    }
    tr.add({ t: 'done', l: l, r: n - 1, sum: sum, best: best, bestSpan: bestSpan });
    return { steps: tr.steps, answer: best === Infinity ? 0 : best, span: bestSpan, mvL: tr.mvL, mvR: tr.mvR };
  }

  /* ② 양 끝 쌍 — 정렬된 배열에서 합이 target 인 두 수. */
  function runPairSum(cfg) {
    var a = cfg.array, n = a.length, target = cfg.target;
    var tr = new Trace();
    var l = 0, r = n - 1, found = null;

    tr.add({ t: 'init', l: l, r: r, sum: n > 1 ? a[l] + a[r] : 0, found: null });
    while (l < r) {
      var s = a[l] + a[r];
      if (s === target) {
        found = [l, r];
        tr.add({ t: 'found', l: l, r: r, sum: s, found: found });
        break;
      }
      if (s < target) {
        l += 1; tr.mvL += 1;
        tr.add({ t: 'moveL', l: l, r: r, sum: l < r ? a[l] + a[r] : 0, prev: s, found: null });
      } else {
        r -= 1; tr.mvR += 1;
        tr.add({ t: 'moveR', l: l, r: r, sum: l < r ? a[l] + a[r] : 0, prev: s, found: null });
      }
      if (tr.over) break;
    }
    tr.add({ t: 'done', l: l, r: r, sum: l < r ? a[l] + a[r] : 0, found: found });
    return { steps: tr.steps, answer: found, mvL: tr.mvL, mvR: tr.mvR };
  }

  /* ③ 중복 없는 최장 구간. */
  function runLongestUnique(cfg) {
    var lab = cfg.labels, n = lab.length;
    var tr = new Trace();
    var l = 0, best = 0, bestSpan = null;
    var inWin = {};
    function has(x) { return Object.prototype.hasOwnProperty.call(inWin, x); }

    /* wr = **확정된 창의 오른쪽 끝.** R 이 도착했지만 아직 창에 넣지 않은 동안은
     * wr = r-1 이다. 창 그림에 r 을 미리 넣어 버리면 "창 안에는 중복이 없다"는
     * 불변식이 화면에서 깨진 것처럼 보인다 — 위젯이 거짓말을 하면 안 된다. */
    tr.add({ t: 'init', l: 0, r: -1, wr: -1, best: 0, bestSpan: null, size: 0 });
    for (var r = 0; r < n; r++) {
      tr.mvR += 1;
      tr.add({ t: 'probe', l: l, r: r, wr: r - 1, dup: has(lab[r]), best: best, bestSpan: bestSpan, size: r - l });
      if (tr.over) break;
      while (has(lab[r])) {
        delete inWin[lab[l]];
        l += 1;
        tr.mvL += 1;
        tr.add({ t: 'shrink', l: l, r: r, wr: r - 1, best: best, bestSpan: bestSpan, dropped: l - 1, size: r - l });
        if (tr.over) break;
      }
      if (tr.over) break;
      inWin[lab[r]] = true;
      var len = r - l + 1;
      var took = false;
      if (len > best) { best = len; bestSpan = [l, r]; took = true; }
      tr.add({ t: 'add', l: l, r: r, wr: r, best: best, bestSpan: bestSpan, took: took, size: len });
      if (tr.over) break;
    }
    tr.add({ t: 'done', l: l, r: n - 1, wr: n - 1, best: best, bestSpan: bestSpan, size: 0 });
    return { steps: tr.steps, answer: best, span: bestSpan, mvL: tr.mvL, mvR: tr.mvR };
  }

  /* ④ 병합 — 두 정렬 배열. 두 포인터가 서로 다른 배열 위를 간다. */
  function runMerge(cfg) {
    var A = cfg.a, B = cfg.b;
    var tr = new Trace();
    var i = 0, j = 0, out = [];

    tr.add({ t: 'init', i: 0, j: 0, out: [] });
    while (i < A.length && j < B.length) {
      // 같으면 A 를 먼저 가져간다 — 이 한 줄이 병합 정렬의 안정성이다(II-7 §2.3).
      if (A[i] <= B[j]) {
        var tie = A[i] === B[j];
        out.push(A[i]); i += 1; tr.mvL += 1;
        tr.add({ t: 'take', from: 'A', i: i, j: j, took: A[i - 1], out: out.slice(), tie: tie });
      } else {
        out.push(B[j]); j += 1; tr.mvR += 1;
        tr.add({ t: 'take', from: 'B', i: i, j: j, took: B[j - 1], out: out.slice(), tie: false });
      }
      if (tr.over) break;
    }
    while (i < A.length && !tr.over) {
      out.push(A[i]); i += 1; tr.mvL += 1;
      tr.add({ t: 'drain', from: 'A', i: i, j: j, took: A[i - 1], out: out.slice() });
    }
    while (j < B.length && !tr.over) {
      out.push(B[j]); j += 1; tr.mvR += 1;
      tr.add({ t: 'drain', from: 'B', i: i, j: j, took: B[j - 1], out: out.slice() });
    }
    tr.add({ t: 'done', i: i, j: j, out: out.slice() });
    return { steps: tr.steps, answer: out.slice(), mvL: tr.mvL, mvR: tr.mvR };
  }

  /* ⑤ 창 최댓값 — 단조 감소 덱.
   *    본문 II-5 §4 의 ::: dual 코드와 같은 알고리즘이고 세 규칙의 순서까지 같다:
   *    ① 뒤에서 버린다 ② 넣는다 ③ 앞의 만료를 버린다.
   *    ③을 ①②보다 앞에 두면 k = 1 에서 즉시 틀린다(본문 ::: pitfall). */
  function runWindowMax(cfg) {
    var a = cfg.array, n = a.length, k = cfg.window;
    var tr = new Trace();
    var dq = [], out = [];

    tr.add({ t: 'init', i: -1, dq: [], out: [] });
    for (var i = 0; i < n; i++) {
      while (dq.length && a[dq[dq.length - 1]] <= a[i]) {
        var gone = dq.pop();
        tr.mvR += 1;   // 덱 뒤 연산
        tr.add({ t: 'popback', i: i, gone: gone, dq: dq.slice(), out: out.slice() });
        if (tr.over) break;
      }
      if (tr.over) break;
      dq.push(i);
      tr.mvR += 1;
      tr.add({ t: 'push', i: i, dq: dq.slice(), out: out.slice() });
      if (tr.over) break;
      if (dq[0] <= i - k) {
        var exp = dq.shift();
        tr.mvL += 1;   // 덱 앞 연산
        tr.add({ t: 'popfront', i: i, gone: exp, dq: dq.slice(), out: out.slice() });
        if (tr.over) break;
      }
      if (i >= k - 1) {
        out.push(a[dq[0]]);
        tr.add({ t: 'emit', i: i, dq: dq.slice(), out: out.slice() });
        if (tr.over) break;
      }
    }
    tr.add({ t: 'done', i: n - 1, dq: dq.slice(), out: out.slice() });
    return { steps: tr.steps, answer: out.slice(), mvL: tr.mvL, mvR: tr.mvR };
  }

  var RUNNER = {
    'window-sum': runWindowSum,
    'pair-sum': runPairSum,
    'longest-unique': runLongestUnique,
    merge: runMerge,
    'window-max': runWindowMax
  };

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('two-pointer', function (host, opts) {
    if (!opts || typeof opts !== 'object') opts = {};

    // ---- opts 검증(계약 §1) ----
    var mode = null;
    if (typeof opts.mode === 'string') mode = MODE_ALIAS[opts.mode.trim().toLowerCase()] || null;

    // 창 크기만 주어졌으면 창 문제로 읽는다.
    var explicitMode = !!mode;
    if (!mode) mode = (opts.window !== undefined) ? 'window-max' : 'window-sum';

    /* 제공할 모드 목록. 저자가 mode 를 못 박았으면 그 하나만 연다 —
     * 챕터가 특정 장면(II-5 의 단조 덱)을 가리키고 있는데 다른 모드로 새면
     * 그 장면의 데이터 전제(정렬됨·양수 등)까지 함께 무너진다. */
    var avail = [];
    if (isArr(opts.modes)) {
      for (var mi = 0; mi < opts.modes.length; mi++) {
        var m = MODE_ALIAS[String(opts.modes[mi]).trim().toLowerCase()];
        if (m && avail.indexOf(m) < 0) avail.push(m);
      }
    }
    if (!avail.length) avail = explicitMode ? [mode] : MODES.slice();
    if (avail.indexOf(mode) < 0) mode = avail[0];

    var userArray = isArr(opts.array) ? opts.array : null;
    var kUser = clampInt(opts.window, 1, MAX_N, 3);

    // 모드별 데이터. 저자가 준 배열을 모드의 전제에 맞게 손질한다.
    function cfgFor(md) {
      var d = DEFAULTS[md];
      var c = { mode: md, window: 0, target: 0 };
      if (md === 'merge') {
        c.a = toNums(opts.a, d.a);
        c.b = toNums(opts.b, d.b);
        c.a.sort(function (x, y) { return x - y; });
        c.b.sort(function (x, y) { return x - y; });
        return c;
      }
      if (md === 'longest-unique') {
        // 숫자 배열이 와도 라벨로 쓴다. 중복 판정에는 값만 있으면 된다.
        c.labels = toLabels(isArr(opts.labels) ? opts.labels : userArray, d.labels);
        return c;
      }
      c.array = toNums(userArray, d.array);
      if (md === 'window-sum') {
        /* 음수가 섞이면 "R 을 밀수록 합이 커진다"는 전제가 깨져 두 포인터가
         * 아예 성립하지 않는다. 틀린 답을 그리는 대신 값을 양수로 바꿔 전제를
         * 지킨다 — 위젯이 화면에서 거짓말을 하면 안 된다(계약 §9). */
        for (var i = 0; i < c.array.length; i++) if (c.array[i] <= 0) c.array[i] = Math.abs(c.array[i]) + 1;
        c.target = clampInt(opts.target, 1, 1e6, d.target);
        return c;
      }
      if (md === 'pair-sum') {
        c.array.sort(function (x, y) { return x - y; });   // 정렬이 전제다
        var t = clampInt(opts.target, -1e6, 1e6, NaN);
        if (!isFinite(t)) {
          // target 이 없으면 실제로 존재하는 쌍을 골라 준다. 답이 없는 화면은 배울 것이 적다.
          // 배열도 저자가 준 것이 아니면 기본 데이터에 맞춰 둔 target 을 그대로 쓴다.
          t = (userArray && c.array.length > 1) ? c.array[0] + c.array[c.array.length - 2] : d.target;
        }
        c.target = t;
        return c;
      }
      // window-max
      c.window = Math.max(1, Math.min(kUser, c.array.length));
      return c;
    }

    var cfg = cfgFor(mode);
    var run = RUNNER[mode](cfg);
    var cur = 0;
    var cache = null;

    // ---- 껍데기 ----
    var ui = K.frame(host, { title: '', wide: false });
    var titleEl = K.el('div', 'wk-title', '');
    ui.head.insertBefore(titleEl, ui.head.firstChild);

    var modeSeg = null;
    if (avail.length > 1) {
      modeSeg = K.seg(ui.slot, avail.map(function (v) {
        return { label: MODE_LABEL[v], value: v };
      }), mode, function (v) {
        mode = v;
        rebuild();
      });
    }

    /* 창 크기 세그먼트는 창 최댓값 모드에서만 뜬다. k 를 바꾸면 무엇이 만료되고
     * 무엇이 뒤에서 밀려나는지가 통째로 바뀐다 — 실제로 배울 것이 있는 축이다.
     * (본문 II-5 의 손추적 표는 k=3 이고 위젯도 거기서 시작한다.) */
    var kSeg = null;
    if (mode === 'window-max' && avail.length === 1 && cfg.array.length >= 3) {
      var kOpts = [];
      [2, 3, 4, kUser].forEach(function (v) {
        if (v >= 1 && v <= cfg.array.length && kOpts.indexOf(v) < 0) kOpts.push(v);
      });
      kOpts.sort(function (x, y) { return x - y; });
      if (kOpts.length > 1) {
        kSeg = K.seg(ui.slot, kOpts.map(function (v) { return { label: 'k=' + v, value: String(v) }; }),
          String(cfg.window), function (v) {
            kUser = parseInt(v, 10) || 3;
            rebuild();
          });
      }
    }

    // ---- 불변식 줄 + 범례 ----
    var invLine = K.el('div', 'wk-legend');
    var invSpan = K.el('span', null, '');
    invSpan.style.color = 'var(--fg-dim)';
    invLine.appendChild(invSpan);
    ui.root.insertBefore(invLine, ui.ctl);

    var legend = K.el('div', 'wk-legend');
    ui.root.insertBefore(legend, ui.ctl);

    function setLegend() {
      legend.innerHTML = '';
      var items;
      if (mode === 'merge') {
        items = [
          ['--w-frontier', '지금 견주는 두 앞머리'],
          ['--box-warn', '방금 가져간 것'],
          ['--w-visited', '이미 지나간 원소'],
          ['--w-path', '출력 배열']
        ];
      } else if (mode === 'window-max') {
        items = [
          ['--w-frontier', '지금 보는 i'],
          ['--box-warn', '지금 덱에서 버리는 것'],
          ['--w-visited', '덱에 남아 있는 인덱스'],
          ['--w-path', '창의 최댓값 = 덱의 맨 앞']
        ];
      } else {
        items = [
          ['--w-frontier', '창 [L, R]'],
          ['--box-warn', '방금 창 밖으로 밀려난 칸'],
          ['--w-visited', '이미 지나간 칸'],
          ['--w-path', '지금까지의 최선']
        ];
      }
      items.forEach(function (p) {
        var s = K.el('span');
        var ic = K.el('i');
        ic.style.background = 'var(' + p[0] + ')';
        s.appendChild(ic);
        s.appendChild(document.createTextNode(p[1]));
        legend.appendChild(s);
      });
    }

    function setTitle() {
      var extra = '';
      if (mode === 'window-sum' || mode === 'pair-sum') extra = ' (target = ' + cfg.target + ')';
      else if (mode === 'window-max') extra = ' (k = ' + cfg.window + ')';
      titleEl.textContent = '두 포인터 — ' + MODE_TITLE[mode] + extra;
      invSpan.textContent = INVARIANT[mode];
    }

    // ---- 배치 ────────────────────────────────────────────────────────────
    /* 폭이 좁아져도 **칸 수는 줄이지 않는다.** 배열 하나가 이 위젯의 전부라서
     * 일부만 보여 주면 창이 어디까지 왔는지 자체가 사라진다. 대신 칸 폭·글자
     * 크기·행 간격을 줄인다. 칸이 14px 밑으로 내려가면 stage 의 가로 스크롤에
     * 맡긴다(계약 §4: body 에는 가로 스크롤이 생기지 않는다). */
    function layout(w) {
      var tiny = w < 520;
      var pad = tiny ? 8 : 14;
      var mainCols = (mode === 'merge')
        ? Math.max(cfg.a.length, cfg.b.length)
        : (mode === 'longest-unique' ? cfg.labels.length : cfg.array.length);
      var outCols = (mode === 'merge') ? (cfg.a.length + cfg.b.length)
        : (mode === 'window-max' ? Math.max(1, cfg.array.length - cfg.window + 1) : 0);
      var cols = Math.max(mainCols, outCols, 1);

      var cellW = Math.floor((w - pad * 2) / cols);
      cellW = Math.max(14, Math.min(cellW, tiny ? 34 : 44));
      var cellH = tiny ? 26 : 30;
      var headH = tiny ? 13 : 15;
      var markH = tiny ? 20 : 23;
      /* 칸 위 인덱스 숫자가 들어갈 띠. 이 자리를 따로 잡지 않으면 세 가지가
       * 같은 줄을 다툰다: 구역 제목, 인덱스 숫자, 최선 구간의 금색 점선 상자.
       * 위에서부터 제목 → 인덱스 → 점선 상자 → 창 띠 → 칸 순으로 층을 나눈다. */
      var idxH = (cellW >= 20) ? 13 : 0;

      var rows = [];
      var y = pad;
      function section(kind, h, withIdx) {
        var extra = withIdx ? idxH : 0;
        y += headH + extra;
        rows.push({ kind: kind, y: y, h: h, titleY: y - extra - 4 });
        y += h + (tiny ? 9 : 12);
      }

      if (mode === 'merge') {
        section('A', cellH + markH, false);
        section('B', cellH + markH, false);
        section('out', cellH, false);
      } else {
        section('main', cellH + markH, true);
        if (mode === 'window-max') {
          section('dq', cellH, true);
          section('out', cellH, false);
        }
      }

      /* 덱 칸은 'a12' 까지 들어가야 해서 배열 칸보다 넓다. 다만 덱이 길어지면
       * 폭에 맞춰 줄여야 캔버스 밖으로 밀려난다. 덱의 순간 최대 길이는 k+1 이다 —
       * 만료를 버리기 **전에** 새 인덱스를 먼저 넣기 때문이다(규칙 ②→③ 순서). */
      var dqMax = Math.max(1, Math.min((cfg.array || []).length, (cfg.window || 1) + 1));
      var dqW = Math.min(tiny ? 36 : 46, Math.floor((w - pad * 2 - 4 * (dqMax - 1)) / dqMax));
      dqW = Math.max(18, dqW);

      // 통계는 두 줄. 좁은 화면에서는 곁가지 문구(훑기 비교 횟수 등)를 세 번째
      // 줄로 내린다 — 한 줄에 이어 붙이면 캔버스 밖으로 잘려 아예 못 읽는다.
      var statTop = y;
      var statLines = tiny ? 3 : 2;
      var statH = statLines * (tiny ? 15 : 17) + 6;

      return {
        w: w, tiny: tiny, pad: pad, cellW: cellW, cellH: cellH, headH: headH, markH: markH,
        idxH: idxH, dqW: dqW, cols: cols, mainCols: mainCols, rows: rows, statTop: statTop,
        height: statTop + statH + pad
      };
    }

    function L() {
      var w = cv.size.w || 320;
      var key = mode + '|' + cfg.window + '|' + cfg.target;
      if (!cache || cache.w !== w || cache.key !== key) {
        cache = layout(w);
        cache.key = key;
      }
      return cache;
    }

    function rowOf(kind) {
      var rows = L().rows;
      for (var i = 0; i < rows.length; i++) if (rows[i].kind === kind) return rows[i];
      return rows[0];
    }

    // ---- 그리기 보조 ────────────────────────────────────────────────────

    function rrect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    /* 칸 하나. 색 외에 테두리 두께·점선·글자로도 구분되게 한다(계약 §5). */
    function cellBox(ctx, T, l, x, y, w, h, text, st) {
      ctx.save();
      ctx.fillStyle = T.bgElev;
      rrect(ctx, x, y, w, h, 4);
      ctx.fill();
      if (st.fill) {
        ctx.globalAlpha = st.alpha || 0.3;
        ctx.fillStyle = st.fill;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = st.lw || 1;
      ctx.strokeStyle = st.stroke || T.border;
      if (st.dash) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      var s = String(text);
      var fs = Math.max(8, Math.min(l.tiny ? 11 : 13, (w - 4) / Math.max(1, s.length) * 1.7));
      ctx.fillStyle = st.dim ? T.fgFaint : T.fg;
      ctx.font = '700 ' + fs + 'px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, x + w / 2, y + h / 2 + 0.5);
      ctx.restore();
    }

    function sectionTitle(ctx, T, l, text, x, y) {
      ctx.fillStyle = T.fgDim;
      ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x, y);
    }

    // 포인터 표식: 삼각형 + 이름. 색을 못 봐도 어느 칸인지 읽힌다(계약 §5).
    function pointer(ctx, T, l, x, w, y, name, color) {
      ctx.save();
      ctx.fillStyle = color;
      var cx = x + w / 2;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx - 4.5, y + 5);
      ctx.lineTo(cx + 4.5, y + 5);
      ctx.closePath();
      ctx.fill();
      ctx.font = '700 ' + (l.tiny ? 9 : 10.5) + 'px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // 한글 라벨('창')은 위쪽 여백이 거의 없어 삼각형에 붙는다. 7px 아래로 민다.
      ctx.fillText(name, cx, y + 7);
      ctx.restore();
    }

    // ---- 모드별 그리기 ──────────────────────────────────────────────────

    function draw(ctx, size, T) {
      var l = L();
      var s = run.steps[Math.min(cur, run.steps.length - 1)];
      if (!s) return;
      ctx.textBaseline = 'alphabetic';
      if (mode === 'merge') drawMerge(ctx, T, l, s);
      else drawArrayMode(ctx, T, l, s);
      drawStats(ctx, T, l, s);
    }

    function drawArrayMode(ctx, T, l, s) {
      var vals = (mode === 'longest-unique') ? cfg.labels : cfg.array;
      var n = vals.length;
      var row = rowOf('main');
      var x0 = l.pad, y0 = row.y;
      var cw = l.cellW, ch = l.cellH;
      var i;

      var lo, hi;   // 지금 창
      if (mode === 'window-max') {
        hi = s.i;
        lo = Math.max(0, s.i - cfg.window + 1);
      } else {
        lo = s.l;
        hi = (s.wr !== undefined) ? s.wr : s.r;   // 아직 창에 안 들어온 R 은 띠에 넣지 않는다
      }

      sectionTitle(ctx, T, l,
        mode === 'window-max' ? '배열 a — 창은 최근 k칸 [i-k+1, i]' : '배열 a — 창 [L, R]',
        x0, row.titleY);

      // 창 배경 띠. 칸보다 먼저 깔아야 칸 글자가 살아 있다.
      if (hi >= lo && hi >= 0 && lo >= 0) {
        ctx.save();
        rrect(ctx, x0 + lo * cw - 1, y0 - 1, (hi - lo + 1) * cw + 2, ch + 2, 5);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = T.wFrontier;
        ctx.fill();
        // 채우기만으로는 창의 경계가 어디인지 흐리다. 테두리를 한 겹 더 준다.
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = T.wFrontier;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
      // 최선 구간 — 금색 점선. 창 띠보다 한 겹 바깥에 둔다(지금이 아니라 지금까지의 결과).
      if (s.bestSpan) {
        ctx.save();
        ctx.strokeStyle = T.wPath;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        rrect(ctx, x0 + s.bestSpan[0] * cw - 3, y0 - 4, (s.bestSpan[1] - s.bestSpan[0] + 1) * cw + 6, ch + 8, 6);
        ctx.stroke();
        ctx.restore();
      }

      var dqPos = {};
      if (mode === 'window-max' && s.dq) for (i = 0; i < s.dq.length; i++) dqPos[s.dq[i]] = i;

      for (i = 0; i < n; i++) {
        var st = {};
        if (mode === 'window-max') {
          if (i > s.i) { st.dim = true; st.dash = true; }               // 아직 보지 않은 칸
          else if (dqPos[i] !== undefined) {
            var head = (dqPos[i] === 0);
            st.fill = head ? T.wPath : T.wVisited;
            st.alpha = head ? 0.42 : 0.55;
            st.stroke = head ? T.wPath : T.wVisited;
            st.lw = 1.6;
          } else if (i >= lo && i <= hi) { st.stroke = T.border; }
          else { st.dim = true; }
          if (s.gone === i) { st.fill = T.boxWarn; st.alpha = 0.5; st.stroke = T.boxWarn; st.lw = 2.2; st.dim = false; }
          if (i === s.i) { st.stroke = T.wFrontier; st.lw = 2.4; }
        } else {
          if (i < lo) { st.dim = true; }
          else if (i >= lo && i <= hi) { st.stroke = T.wFrontier; st.lw = 1.6; }
          else { st.dim = true; st.dash = true; }
          if (s.dropped === i) { st.fill = T.boxWarn; st.alpha = 0.45; st.stroke = T.boxWarn; st.lw = 2.2; st.dim = false; }
          // 포인터가 선 칸은 창 밖(아직 안 들어온 R)이라도 또렷하게 둔다.
          if (i === s.l || i === s.r) { st.stroke = T.wFrontier; st.lw = 2.4; st.dim = false; st.dash = false; }
          if (s.found && (i === s.found[0] || i === s.found[1])) {
            st.fill = T.wPath; st.alpha = 0.45; st.stroke = T.wPath; st.lw = 2.4; st.dim = false;
          }
        }
        cellBox(ctx, T, l, x0 + i * cw + 1, y0, cw - 2, ch, vals[i], st);

        // 인덱스는 칸 안이 아니라 칸 위에 작게. 값과 헷갈리면 안 된다.
        if (l.idxH) {
          ctx.fillStyle = T.fgFaint;
          ctx.font = (l.tiny ? 8 : 8.5) + 'px ' + MONO;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(String(i), x0 + i * cw + cw / 2, y0 - 6);
        }
      }

      // 포인터 표식. 최선 구간 점선 상자(아래 +4)보다 더 아래에서 시작한다.
      var my = y0 + ch + 7;
      if (mode === 'window-max') {
        if (s.i >= 0) pointer(ctx, T, l, x0 + s.i * cw, cw, my, 'i', T.wFrontier);
        if (s.i >= cfg.window - 1 && lo !== s.i) pointer(ctx, T, l, x0 + lo * cw, cw, my, '창', T.fgDim);
      } else if (s.l === s.r && s.l >= 0 && s.l < n) {
        pointer(ctx, T, l, x0 + s.l * cw, cw, my, 'L=R', T.wFrontier);
      } else {
        if (s.l >= 0 && s.l < n) pointer(ctx, T, l, x0 + s.l * cw, cw, my, 'L', T.wFrontier);
        if (s.r >= 0 && s.r < n) pointer(ctx, T, l, x0 + s.r * cw, cw, my, 'R', T.wFrontier);
      }

      // 덱 · 출력 (창 최댓값 전용)
      if (mode === 'window-max') {
        var dRow = rowOf('dq');
        sectionTitle(ctx, T, l, '덱 — 앞 → 뒤. 값이 내림차순인 인덱스만 남는다', x0, dRow.titleY);
        if (!s.dq || !s.dq.length) {
          ctx.fillStyle = T.fgFaint;
          ctx.font = (l.tiny ? 10 : 11) + 'px ' + FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText('비어 있음', x0 + 2, dRow.y + ch / 2);
        }
        var dw = l.dqW;
        for (i = 0; s.dq && i < s.dq.length; i++) {
          var idx = s.dq[i];
          var isHead = (i === 0);
          cellBox(ctx, T, l, x0 + i * (dw + 4), dRow.y, dw, ch, 'a' + idx, {
            fill: isHead ? T.wPath : T.wVisited, alpha: isHead ? 0.42 : 0.5,
            stroke: isHead ? T.wPath : T.wVisited, lw: isHead ? 2.2 : 1.4
          });
          ctx.fillStyle = T.fgFaint;
          ctx.font = (l.tiny ? 8 : 8.5) + 'px ' + MONO;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText('=' + cfg.array[idx], x0 + i * (dw + 4) + dw / 2, dRow.y - 6);
        }

        var oRow = rowOf('out');
        sectionTitle(ctx, T, l, '출력 — 창마다 최댓값 하나', x0, oRow.titleY);
        var slots = Math.max(1, cfg.array.length - cfg.window + 1);
        for (i = 0; i < slots; i++) {
          var filled = s.out && i < s.out.length;
          cellBox(ctx, T, l, x0 + i * cw + 1, oRow.y, cw - 2, ch, filled ? s.out[i] : '·',
            filled
              ? { fill: T.wPath, alpha: 0.32, stroke: T.wPath, lw: i === s.out.length - 1 ? 2.2 : 1.2 }
              : { dim: true, dash: true });
        }
      }
    }

    function drawMerge(ctx, T, l, s) {
      var x0 = l.pad, cw = l.cellW, ch = l.cellH, i;

      function arrRow(row, arr, ptr, name) {
        var p = (ptr === 'i') ? s.i : s.j;
        sectionTitle(ctx, T, l, '배열 ' + name + ' — ' + ptr + ' = ' + p, x0, row.titleY);
        for (i = 0; i < arr.length; i++) {
          var st = {};
          if (i < p) { st.fill = T.wVisited; st.alpha = 0.45; st.dim = true; }   // 이미 가져갔다
          else if (i === p) { st.stroke = T.wFrontier; st.lw = 2.4; }
          if (s.from === name && i === p - 1 && s.t !== 'done') {
            st.fill = T.boxWarn; st.alpha = 0.45; st.stroke = T.boxWarn; st.lw = 2.2; st.dim = false;
          }
          cellBox(ctx, T, l, x0 + i * cw + 1, row.y, cw - 2, ch, arr[i], st);
        }
        if (p >= 0 && p < arr.length) pointer(ctx, T, l, x0 + p * cw, cw, row.y + ch + 4, ptr, T.wFrontier);
        else {
          ctx.fillStyle = T.fgFaint;
          ctx.font = (l.tiny ? 9 : 10.5) + 'px ' + FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText('다 썼다', x0 + arr.length * cw + 6, row.y + ch / 2 - 5);
        }
      }

      arrRow(rowOf('A'), cfg.a, 'i', 'A');
      arrRow(rowOf('B'), cfg.b, 'j', 'B');

      var oRow = rowOf('out');
      sectionTitle(ctx, T, l, '출력 — 정렬된 순서로 하나씩', x0, oRow.titleY);
      var total = cfg.a.length + cfg.b.length;
      for (i = 0; i < total; i++) {
        var filled = s.out && i < s.out.length;
        cellBox(ctx, T, l, x0 + i * cw + 1, oRow.y, cw - 2, ch, filled ? s.out[i] : '·',
          filled
            ? { fill: T.wPath, alpha: 0.32, stroke: T.wPath, lw: i === s.out.length - 1 ? 2.2 : 1.2 }
            : { dim: true, dash: true });
      }
    }

    /* 통계 두 줄. **이 위젯의 결론이 여기 있다.**
     * 첫 줄은 지금의 집계값, 둘째 줄은 포인터 이동 총량과 그 상한이다. */
    function drawStats(ctx, T, l, s) {
      var x0 = l.pad, y = l.statTop + (l.tiny ? 10 : 12);
      var lh = l.tiny ? 15 : 17;
      var maxW = l.w - l.pad * 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // 폭을 넘으면 글자를 줄인다. 통계 줄이 잘리면 이 위젯의 결론이 사라진다.
      function put(text, size, bold, yy) {
        var sz = size;
        for (;;) {
          ctx.font = (bold ? '700 ' : '') + sz + 'px ' + MONO;
          if (sz <= 8 || ctx.measureText(text).width <= maxW) break;
          sz -= 0.5;
        }
        ctx.fillText(text, x0, yy);
      }

      ctx.font = '700 ' + (l.tiny ? 10.5 : 12) + 'px ' + MONO;

      var n = (mode === 'merge') ? (cfg.a.length + cfg.b.length)
        : (mode === 'longest-unique' ? cfg.labels.length : cfg.array.length);

      var line1;
      if (mode === 'window-sum') {
        line1 = '창 [' + s.l + ', ' + s.r + ']  합 ' + s.sum + ' / target ' + cfg.target +
          '   최선 ' + (s.best === Infinity ? '아직 없음'
            : '길이 ' + s.best + ' [' + s.bestSpan[0] + ', ' + s.bestSpan[1] + ']');
      } else if (mode === 'pair-sum') {
        line1 = 'a[' + s.l + '] + a[' + s.r + '] = ' + s.sum + ' / target ' + cfg.target +
          (s.found ? '   찾음 (' + cfg.array[s.found[0]] + ', ' + cfg.array[s.found[1]] + ')' : '');
      } else if (mode === 'longest-unique') {
        // 확정된 창만 적는다. 아직 넣지 않은 R 을 창에 넣어 적으면 크기와 어긋난다.
        var wr = (s.wr === undefined) ? s.r : s.wr;
        line1 = (wr < s.l ? '창 비어 있음' : '창 [' + s.l + ', ' + wr + ']') + '  크기 ' + Math.max(0, s.size) +
          '   최선 ' + s.best + (s.bestSpan ? ' [' + s.bestSpan[0] + ', ' + s.bestSpan[1] + ']' : '');
      } else if (mode === 'merge') {
        line1 = 'i = ' + s.i + ' / ' + cfg.a.length + '   j = ' + s.j + ' / ' + cfg.b.length +
          '   출력 ' + (s.out ? s.out.length : 0) + ' / ' + n;
      } else {
        var head = (s.dq && s.dq.length) ? cfg.array[s.dq[0]] : null;
        line1 = 'i = ' + s.i + '   덱 크기 ' + (s.dq ? s.dq.length : 0) +
          '   창의 최댓값 ' + (head === null || s.i < cfg.window - 1 ? '아직' : head) +
          '   출력 ' + (s.out ? s.out.length : 0) + ' / ' + Math.max(1, cfg.array.length - cfg.window + 1);
      }
      ctx.fillStyle = T.fg;
      put(line1, l.tiny ? 10.5 : 12, true, y);

      // 둘째 줄 — 이동 총량. O(n) 주장을 눈에 보이게 만드는 줄이다.
      var line2, note;
      if (mode === 'window-max') {
        line2 = '덱 연산 — 뒤(push·pop) ' + s.mvR + ' + 앞(pop) ' + s.mvL + ' = ' + (s.mvL + s.mvR) +
          ' ≤ 2n = ' + (2 * n);
        note = '창마다 다시 훑으면 비교 ' + (Math.max(0, n - cfg.window + 1) * cfg.window) + '회';
      } else if (mode === 'merge') {
        line2 = '포인터 이동 — i ' + s.mvL + ' + j ' + s.mvR + ' = ' + (s.mvL + s.mvR) + ' ≤ n = ' + n;
        note = '각 원소를 정확히 한 번씩 지난다';
      } else {
        line2 = '포인터 이동 — R ' + s.mvR + ' + L ' + s.mvL + ' = ' + (s.mvL + s.mvR) + ' ≤ 2n = ' + (2 * n);
        note = '이 합이 곧 전체 비용이다 — 그래서 O(n)';
      }
      ctx.fillStyle = T.fgDim;
      if (l.tiny) {
        put(line2, 10, false, y + lh);
        put(note, 10, false, y + lh * 2);
      } else {
        put(line2 + '    ' + note, 11.5, false, y + lh);
      }
    }

    // ---- 캔버스 ----
    var cv = K.canvas(ui.stage, {
      height: function (w) { return layout(w).height; },
      draw: draw
    });

    // ---- 상태 줄 ────────────────────────────────────────────────────────
    function label(i) {
      var s = run.steps[Math.min(i, run.steps.length - 1)];
      if (!s) return '';
      var a = cfg.array, msg = '';

      if (mode === 'window-sum') {
        if (s.t === 'init') {
          msg = 'L 과 R 을 0에 둔다. 창이 비어 있고 합은 0이다. 목표는 합이 ' + cfg.target + ' 이상인 가장 짧은 창이다.';
        } else if (s.t === 'expand') {
          msg = 'R 을 ' + s.r + '로 밀어 ' + ul(a[s.r]) + ' 창에 넣는다. 합이 ' + s.sum + '. ' +
            (s.ok ? '조건을 만족했으니 이제 왼쪽을 당겨 줄여 본다.' : 'target ' + cfg.target + '에 모자라 계속 민다.');
        } else if (s.t === 'shrink') {
          msg = (s.took ? '길이 ' + (s.r - s.l + 2) + '짜리 창을 답 후보로 적었다. ' : '') +
            'L 을 당겨 a[' + s.dropped + '](=' + a[s.dropped] + ')' + (jong(a[s.dropped]) ? '을' : '를') +
            ' 창에서 뺀다. 합이 ' + s.sum + '이 됐다. ' +
            (s.sum >= cfg.target ? '아직 조건을 만족하니 더 줄인다.' : '조건이 깨졌으니 다시 오른쪽을 민다.');
        } else {
          msg = '끝. ' + (s.best === Infinity
            ? '어떤 구간도 target 에 못 미쳐 답이 없다.'
            : '최소 길이는 ' + s.best + ', 구간은 [' + s.bestSpan[0] + ', ' + s.bestSpan[1] + '].');
        }
      } else if (mode === 'pair-sum') {
        if (s.t === 'init') msg = 'L 은 맨 앞, R 은 맨 뒤에 둔다. 배열이 정렬돼 있다는 것이 이 방법의 전제다.';
        else if (s.t === 'moveL') {
          msg = '합이 ' + s.prev + '으로 target ' + cfg.target + '보다 작다. 가장 작은 a[' + (s.l - 1) +
            '] 은 어떤 짝과도 target 을 만들 수 없으니 버리고 L 을 오른쪽으로 민다. 새 합은 ' + s.sum + '.';
        } else if (s.t === 'moveR') {
          msg = '합이 ' + s.prev + '으로 target ' + cfg.target + '보다 크다. 가장 큰 a[' + (s.r + 1) +
            '] 은 어떤 짝과도 안 되니 버리고 R 을 왼쪽으로 당긴다. 새 합은 ' + s.sum + '.';
        } else if (s.t === 'found') {
          msg = 'a[' + s.l + '](=' + a[s.l] + ') + a[' + s.r + '](=' + a[s.r] + ') = ' + cfg.target + '. 찾았다.';
        } else {
          msg = s.found
            ? '끝. 답은 (' + a[s.found[0]] + ', ' + a[s.found[1]] + ').'
            : '끝. 두 포인터가 만났고 답이 없다 — 모든 후보를 정확히 한 번씩 배제했다.';
        }
      } else if (mode === 'longest-unique') {
        var lab = cfg.labels;
        if (s.t === 'init') msg = '창이 비어 있다. "창 안에 중복이 없다"는 불변식을 지키며 R 을 민다.';
        else if (s.t === 'probe') {
          msg = 'R 을 ' + s.r + '로 민다. 새 원소는 ' + lab[s.r] + '. ' +
            (s.dup ? '창 안에 이미 있다 — 중복이 사라질 때까지 L 을 당긴다.' : '창 안에 없으니 그냥 넣으면 된다.');
        } else if (s.t === 'shrink') {
          msg = 'L 을 당겨 ' + lab[s.dropped] + (jong(lab[s.dropped]) ? '을' : '를') + ' 창에서 뺀다. L = ' + s.l + '.';
        } else if (s.t === 'add') {
          msg = lab[s.r] + (jong(lab[s.r]) ? '을' : '를') + ' 창에 넣는다. 창 [' + s.l + ', ' + s.r + '] 크기 ' + s.size + '. ' +
            (s.took ? '지금까지의 최장이다.' : '최장 ' + s.best + '에는 못 미친다.');
        } else {
          msg = '끝. 가장 긴 구간의 길이는 ' + s.best +
            (s.bestSpan ? ' ([' + s.bestSpan[0] + ', ' + s.bestSpan[1] + '])' : '') + '이다.';
        }
      } else if (mode === 'merge') {
        if (s.t === 'init') msg = '두 배열의 앞머리에 포인터를 하나씩 둔다. 남은 것 중 최솟값은 언제나 이 둘 중 하나다.';
        else if (s.t === 'take') {
          msg = (s.tie
            ? '두 앞머리가 ' + s.took + '으로 같다. A 를 먼저 가져간다 — 이 한 줄이 병합 정렬의 안정성이다.'
            : s.from + ' 의 ' + iga(s.took) + ' 더 작아 그것을 가져간다.') +
            ' i = ' + s.i + ', j = ' + s.j + '.';
        } else if (s.t === 'drain') {
          msg = '반대쪽이 비었다. ' + s.from + ' 에 남은 ' + ul(s.took) + ' 그대로 가져간다. 비교는 더 필요 없다.';
        } else {
          msg = '끝. 두 배열을 합쳐 ' + (s.out ? s.out.length : 0) + '개를 정렬된 순서로 냈다. 비교는 최대 n-1 번이다.';
        }
      } else {
        if (s.t === 'init') msg = '덱이 비어 있다. 덱에는 값이 아니라 **인덱스**를 담는다 — 값만 담으면 창 밖으로 나간 것을 알아볼 수 없다.';
        else if (s.t === 'popback') {
          msg = '새 값 ' + a[s.i] + ' 앞에서 a[' + s.gone + '](=' + a[s.gone] + ')' + (jong(a[s.gone]) ? '은' : '는') +
            ' 영원히 답이 될 수 없다 — 더 뒤에 있고 더 큰 값이 살아 있는 한 최댓값이 되지 못한다. 덱 뒤에서 버린다.';
        } else if (s.t === 'push') {
          msg = '인덱스 ' + ul(s.i) + ' 덱 뒤에 넣는다. 덱의 값은 [' +
            s.dq.map(function (d) { return a[d]; }).join(', ') + '] — 내림차순이 유지된다.';
        } else if (s.t === 'popfront') {
          msg = '덱 맨 앞 인덱스 ' + iga(s.gone) + ' 창 [' + Math.max(0, s.i - cfg.window + 1) + ', ' + s.i +
            '] 밖으로 나갔다. 앞에서 버린다. 뒤에서 버리는 규칙과 이 규칙은 서로를 대신하지 못한다.';
        } else if (s.t === 'emit') {
          msg = '창 [' + (s.i - cfg.window + 1) + ', ' + s.i + '] 이 완성됐다. 최댓값은 덱의 맨 앞 ' + iga(a[s.dq[0]]) +
            ' 답이다. 찾은 것이 아니라 찾을 필요가 없게 유지한 결과다.';
        } else {
          msg = '끝. 답은 [' + (s.out || []).join(', ') + ']. 덱 연산 ' + (s.mvL + s.mvR) +
            '회로 n = ' + a.length + '짜리 배열을 전부 처리했다.';
        }
      }
      return '[' + MODE_LABEL[mode] + '] ' + msg;
    }

    // ---- 재생기 ----
    var play = null;

    function rebuild() {
      cfg = cfgFor(mode);
      run = RUNNER[mode](cfg);
      cache = null;
      cur = 0;
      setTitle();
      setLegend();
      if (play) play.goto(0);
    }

    setTitle();
    setLegend();

    play = K.player(ui, {
      total: function () { return run.steps.length; },
      render: function (i) { cur = i; cv.redraw(); },
      label: label,
      speed: 620
    });

    play.goto(0);

    // 테스트·디버깅용 훅. 계약상 전역 오염은 금지라 host 요소에만 붙인다.
    host.__twoPointer = {
      mode: function () { return mode; },
      modes: function () { return avail.slice(); },
      setMode: function (v) {
        var m2 = MODE_ALIAS[String(v).toLowerCase()];
        if (!m2 || avail.indexOf(m2) < 0) return false;
        mode = m2;
        rebuild();
        if (modeSeg) {
          Array.prototype.forEach.call(modeSeg.children, function (c) {
            c.classList.toggle('is-active', c.getAttribute('data-val') === mode);
          });
        }
        return true;
      },
      setK: function (k) {
        if (mode !== 'window-max') return false;
        kUser = clampInt(k, 1, MAX_N, cfg.window);
        rebuild();
        if (kSeg) {
          Array.prototype.forEach.call(kSeg.children, function (c) {
            c.classList.toggle('is-active', c.getAttribute('data-val') === String(cfg.window));
          });
        }
        return true;
      },
      config: function () { return cfg; },
      steps: function () { return run.steps; },
      answer: function () { return run.answer; },
      moves: function () { return { L: run.mvL, R: run.mvR }; },
      /* 임의 입력으로 한 모드를 돌린다. 테스트가 브루트포스와 대조하는 통로다. */
      solve: function (md, data) {
        var m2 = MODE_ALIAS[String(md).toLowerCase()];
        if (!m2 || !data) return null;
        var c = { mode: m2, window: 1, target: 0 };
        if (m2 === 'merge') {
          c.a = (data.a || []).slice().sort(function (x, y) { return x - y; });
          c.b = (data.b || []).slice().sort(function (x, y) { return x - y; });
        } else if (m2 === 'longest-unique') {
          c.labels = (data.labels || data.array || []).map(String);
        } else {
          c.array = (data.array || []).slice();
          if (m2 === 'pair-sum') c.array.sort(function (x, y) { return x - y; });
          c.target = data.target;
          c.window = Math.max(1, Math.min(data.window || 1, c.array.length || 1));
        }
        var r = RUNNER[m2](c);
        return { answer: r.answer, mvL: r.mvL, mvR: r.mvR, steps: r.steps.length, cfg: c };
      },
      goto: function (i) { play.goto(i); },
      layout: function () { return L(); }
    };
  });
})();
