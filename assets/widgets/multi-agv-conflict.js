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
