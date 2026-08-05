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
