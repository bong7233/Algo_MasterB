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
  function wa(n) { return n + (jong(n) ? '과' : '와'); }
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
          ctx.font = '700 10.5px ' + FONT;
          ctx.fillStyle = (!p.sorted || p.truncated) ? T.boxDanger : T.wPath;
          ctx.fillText('← ' + tail.join(' · '), box.x + PAD + ctx.measureText(line).width + 26, box.y + 27);
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

        var color = T.fgFaint, alpha = 0.75;
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

      // 활성 구간(병합·퀵의 [lo,hi))을 밑줄로 표시한다.
      if (!done && s.lo !== undefined && s.hi !== undefined) {
        var rlo = s.lo, rhi = (s.t === 'cmp' || s.t === 'sw' || s.t === 'wr' || s.t === 'take')
          ? (s.mid !== undefined ? s.hi - 1 : s.hi) : s.hi;
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

    function drawMarks(ctx, T, L, s, x0, y, bw) {
      var small = bw < 9;
      ctx.font = '700 ' + (small ? 8 : 9.5) + 'px ' + MONO;
      ctx.textAlign = 'center';
      function put(i, ch, color) {
        if (i == null || i < 0 || i >= n) return;
        ctx.fillStyle = color;
        if (small) {
          // 글자가 들어갈 폭이 없으면 삼각 표식으로 방향만 준다.
          var cx = x0 + i * bw + bw / 2;
          ctx.beginPath();
          ctx.moveTo(cx, y - 6);
          ctx.lineTo(cx - 3, y - 1);
          ctx.lineTo(cx + 3, y - 1);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillText(ch, x0 + i * bw + bw / 2, y);
        }
      }
      if (s.t === 'cmp') { put(s.i, '↑', T.wFrontier); put(s.j, '↑', T.wFrontier); }
      else if (s.t === 'cmpk') { put(s.i, '↑', T.wFrontier); put(s.kx, '키', T.wPath); }
      else if (s.t === 'lift') { put(s.i, '키', T.wPath); }
      else if (s.t === 'sw') { put(s.i, '⇄', T.boxWarn); put(s.j, '⇄', T.boxWarn); }
      else if (s.t === 'wr') { put(s.i, '쓰', T.boxWarn); if (s.kx !== undefined) put(s.kx, '키', T.wPath); }
      else if (s.t === 'take') { put(s.i, '↑', T.boxWarn); }
      if (s.pivot !== undefined) put(s.pivot, 'P', T.wGoal);
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
        var head = nm + ' — a[' + s.i + '](=' + vi + ')' + wa(vj === vi ? vi : vi) ;
        head = nm + ' — a[' + s.i + '](=' + vi + ')' + '와 a[' + s.j + '](=' + vj + ')' + '를 견준다. ' +
          iga(vi) + ' ' + rel + '.';
        if (s.pivot !== undefined) head += ' 피벗은 a[' + s.pivot + '](=' + valAt(s, s.pivot) + ').';
        if (s.mid !== undefined) head += ' 두 런 [' + s.lo + ',' + s.mid + ') 과 [' + s.mid + ',' + s.hi + ') 을 합치는 중이다.';
        if (s.heap !== undefined) head += ' 힙 구간은 0..' + (s.heap - 1) + '.';
        return head + ' (비교 ' + s.cmp + ')';
      }
      if (s.t === 'cmpk') {
        var v = valAt(s, s.i);
        return nm + ' — 손에 든 키 ' + s.key + '를 a[' + s.i + '](=' + v + ')' + '와 견준다. ' +
          (v > s.key ? iga(v) + ' 더 크므로 한 칸 오른쪽으로 민다.' : '키가 들어갈 자리를 찾았다.') +
          ' (비교 ' + s.cmp + ')';
      }
      if (s.t === 'lift') {
        return nm + ' — a[' + s.i + '](=' + s.key + ')' + '를 손에 들어낸다. 이 자리가 빈칸이 되고, ' +
          '앞의 정렬 구간에서 들어갈 곳을 찾는다. 아직 배열은 바뀌지 않았다.';
      }
      if (s.t === 'wr') {
        if (s.noop) return nm + ' — a[' + s.i + ']에 ' + ul(s.val) + ' 쓴다. 이미 같은 값이라 바뀐 것이 없다(이동 ' + s.mv + ').';
        if (s.drop) return nm + ' — 손에 든 키 ' + ul(s.key) + ' a[' + s.i + ']에 내려놓는다. 앞 구간이 다시 정렬 상태다. (이동 ' + s.mv + ')';
        if (s.back !== undefined) return nm + ' — 보조 배열의 값 ' + ul(s.val) + ' a[' + s.i + ']에 되쓴다. 여기서 막대가 실제로 움직인다. (이동 ' + s.mv + ')';
        return nm + ' — a[' + s.i + ']에 ' + ul(s.val) + ' 쓴다. 한 칸 밀렸다. (이동 ' + s.mv + ')';
      }
      if (s.t === 'sw') {
        if (s.noop) return nm + ' — a[' + s.i + ']와 a[' + s.j + ']를 맞바꾼다. 값이 같아 실제로 바뀐 것은 없다. (이동 ' + s.mv + ')';
        return nm + ' — a[' + s.i + '](=' + valAt(s, s.i) + ')' + '와 a[' + s.j + '](=' + valAt(s, s.j) + ')' +
          '를 맞바꾼다. 교환 한 번은 쓰기 두 번이다. (이동 ' + s.mv + ')';
      }
      if (s.t === 'take') {
        return nm + ' — a[' + s.i + '](=' + valAt(s, s.i) + ')' + '를 보조 배열로 가져간다. ' +
          '보조 배열에 쓰는 것도 이동이다 — 병합 정렬의 O(n) 추가 메모리가 이 칸에 드러난다. (이동 ' + s.mv + ')';
      }
      if (s.t === 'seal') {
        return nm + ' — 구간 ' + s.lo + '..' + s.hi + '이 정렬 상태로 확정됐다' +
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
