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

    function add(parent, depth, kind, text, say, cv) {
      if (nodes.length >= drawCap) { truncated = true; return -1; }
      nodes.push({
        p: parent, d: depth, kind: kind, txt: text, say: say, cv: cv,
        wrow: -1, skip: 0, kids: [], slot: 0, x: 0, y: 0
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
          '여기가 재귀가 멈추는 자리다.', k);
        return bid;
      }
      moves++;
      var id = add(parent, depth, 'ok', tag,
        'hanoi(' + k + ', ' + arrow + ') 호출. 맨 아래 원반 ' + k + ' 를 ' + PEG[to] + ' 로 보내려면 ' +
        '위 ' + (k - 1) + '개가 먼저 ' + PEG[via] + ' 로 비켜나야 한다 — 그것이 왼쪽 자식이다. ' +
        '비켜났다고 믿고 원반 ' + k + ' 를 옮긴 뒤, 오른쪽 자식이 그 ' + (k - 1) + '개를 ' + PEG[to] + ' 로 옮긴다.', k);
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
        m.cSol[i + 1] = m.cSol[i] + (nd.kind === 'sol' ? 1 : 0);
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
      var gut = (w >= 520) ? 46 : 14;              // 깊이 라벨 자리
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
      var vis = model.cVis[Math.min(cur, model.nodes.length)];
      var cut = model.cCut[Math.min(cur, model.nodes.length)];
      var sol = model.cSol[Math.min(cur, model.nodes.length)];
      var done = cur >= model.nodes.length && !model.truncated;

      if (problem === 'hanoi') {
        var hw = Math.min(360, w - pad * 2);
        statPanel(ctx, T, pad, 6, hw, 62, '호출 트리 (가지치기 없음)', [
          ['호출', comma(vis)], ['기저 h0', comma(sol)], ['옮긴 원반', comma(model.moves)]
        ], true, L.compact);
        thesis(ctx, T, L, '호출 ' + comma(model.visited) + '개 = 2^' + (n + 1) + ' − 1. ' +
               '원반이 하나 늘 때마다 호출이 두 배가 된다 — 원반 20개면 100만 번이다. ' +
               '자를 가지는 없다. 모든 호출이 필요한 일을 한다.', false);
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
        text(ctx, lines[i], 8, L.headerH - 30 + i * 14, font, warn ? T.boxWarn : T.fgDim);
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

      // 깊이 라벨
      if (L.gut > 20) {
        for (var d = 0; d < L.levels; d++) {
          var lab = (problem === 'hanoi')
            ? (d === 0 ? '호출' : '깊이 ' + d)
            : (problem === 'nqueens' ? (d === 0 ? '빈 판' : '행 ' + (d - 1))
              : problem === 'subset' ? (d === 0 ? '시작' : '물건 ' + (d - 1))
              : (d === 0 ? '시작' : '자리 ' + (d - 1)));
          ctx.globalAlpha = 0.75;
          text(ctx, lab, 4, L.treeTop + 16 + d * L.levelH, '10px ' + FONT, T.fgFaint);
          ctx.globalAlpha = 1;
        }
      }

      // ① 간선
      ctx.lineWidth = 1;
      for (var i = 1; i <= shown; i++) {
        var nd = nodes[i];
        if (nd.p < 0 || nd.p > shown) continue;
        var pa = nodes[nd.p];
        var stacked = onStack[i] && onStack[nd.p];
        ctx.globalAlpha = nd.kind === 'cut' ? 0.55 : (stacked ? 1 : 0.5);
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
          for (var q = -1; q <= 1; q += 2) {
            var cx0 = mx + ux * q * 2, cy0 = my + uy * q * 2;
            ctx.moveTo(cx0 - px * sl - ux * sl * 0.5, cy0 - py * sl - uy * sl * 0.5);
            ctx.lineTo(cx0 + px * sl + ux * sl * 0.5, cy0 + py * sl + uy * sl * 0.5);
          }
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1;

      // ② 유령 삼각형 — 잘려서 펼치지 않은 부분트리
      if (L.r >= 2) {
        for (var g = 0; g <= shown; g++) {
          var cn = nodes[g];
          if (cn.kind !== 'cut' || cn.skip < 2 || cn.d >= L.levels - 1) continue;
          var half = Math.min(L.slotW * 1.7, (L.levels - 1 - cn.d) * L.levelH * 0.34);
          if (half < 2) continue;
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
          if (half >= 13) {
            ctx.globalAlpha = 0.8;
            text(ctx, '×' + comma(cn.skip), cn.x, bottomY + 1, '9px ' + FONT, T.fgFaint, 'center');
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
        ctx.fillStyle = T.boxDanger;
        ctx.globalAlpha = 0.92;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        if (r < 4) {
          // 너무 작아 간선 표시가 안 보이는 크기에서는 노드에 직접 × 를 긋는다.
          ctx.strokeStyle = T.bg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
          ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
          ctx.stroke();
        }
      } else if (nd.kind === 'fail') {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = T.wWall;
        ctx.fillRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
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
      if (r >= 7 && nd.txt) {
        var fs = Math.min(Math.round(r * 1.15), 13);
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
        text(ctx, '└ ' + (p.kind === 'base' ? 'hanoi(0)' : 'hanoi(' + p.cv + ')'),
             x + 10 + (i + 1) * 8, ty, '11px ' + FONT,
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
          return s + '  ▸ 지금까지 호출 ' + comma(vis) + '개, 기저 ' + comma(sol) + '개.';
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
