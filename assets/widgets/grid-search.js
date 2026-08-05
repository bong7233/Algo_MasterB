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
