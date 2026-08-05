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
  var STALL_ROWS = 3;    // 얼어붙은 줄을 몇 개나 쌓아 보일 것인가. 셋이면 "안 줄어든다"가 전달된다

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
    var frozenRows = 0;
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
      if (frozen) { stalled = true; frozenRows += 1; }

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

      // 얼어붙은 줄을 몇 개 쌓아 "폭이 줄지 않는다"를 눈으로 확인시킨 뒤 끊는다.
      // 진짜 무한 루프를 끝까지 돌릴 수는 없으므로, 반복이 보일 만큼만 남긴다.
      if (frozenRows >= STALL_ROWS) break;
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

    // 원본 길이를 먼저 재 둔다. 잘라 놓고 말하지 않으면 위젯이 거짓말을 한다.
    var rawLen = isArr(opts.array) ? opts.array.length : 0;
    var a = toNums(opts.array, dfltArray).slice().sort(function (x, y) { return x - y; });
    var clamped = rawLen > a.length ? rawLen : 0;
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
    // 칸 글자가 뭉개지지 않게 자르는 것은 옳지만, 조용히 자르면 독자는
    // 화면의 배열이 넘긴 배열이라고 믿는다.
    if (clamped) title += '  ·  배열이 길어 앞 ' + a.length + '개만 그린다 (넘긴 것은 ' + clamped + '개)';

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

    // 색만으로 정보를 나르면 색을 구분하지 못하는 독자에게 위젯이 사라진다(계약 §5).
    // 칸에는 값이 글자로 있고 버려진 칸에는 취소선이 있지만, 색이 무엇을 뜻하는지는 적어 둔다.
    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [
        ['살아 있는 구간', T.wFrontier],
        ['이번에 버릴 절반', T.boxDanger],
        ['mid', T.accent],
        ['반환 위치', T.wPath]
      ];
      var wrapEl = K.el('div', 'wk-legend');
      items.forEach(function (it) {
        var sp = K.el('span');
        var i = K.el('i');
        i.style.background = it[1];
        sp.appendChild(i);
        sp.appendChild(document.createTextNode(it[0]));
        wrapEl.appendChild(sp);
      });
      ui.slot.appendChild(wrapEl);
      // 테마가 바뀌면 범례 색도 따라가야 한다. 캔버스만 다시 그리면 범례만 옛 테마로 남는다.
      K.onThemeChange(function () {
        var T2 = K.tokens(ui.stage);
        var cs = [T2.wFrontier, T2.boxDanger, T2.accent, T2.wPath];
        Array.prototype.forEach.call(wrapEl.querySelectorAll('i'), function (n, k) {
          n.style.background = cs[k];
        });
      });
    })();

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
        ctx.fillText(goals[gi].label + '  ·  while (' + r.variant.loop + ')  ·  mid = lo + (hi - lo) // 2  ·  술어 ' +
          goals[gi].pred.src, x0, y + 7);
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
