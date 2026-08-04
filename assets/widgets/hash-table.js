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
