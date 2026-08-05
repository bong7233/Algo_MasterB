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
