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
