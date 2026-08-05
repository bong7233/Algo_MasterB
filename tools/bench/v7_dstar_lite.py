#!/usr/bin/env python3
"""V-7 — D* Lite 의 증분 갱신과 A* 전체 재계획의 연산량 비교.

무엇을 재는가
    자유공간 가정으로 출발한 로봇이 이동 중에 미지의 장애물을 발견하고
    그때마다 경로를 다시 세운다. 같은 지도·같은 발견 시점에서

        (A) 매번 A* 를 처음부터 다시 돌린다
        (B) D* Lite 로 영향받은 정점만 고친다

    두 방식이 확장하는 정점 수를 누적해 비교한다.

무엇을 검증하는가 (M5 부칙 §6)
    갱신 방식이 답을 바꾸면 안 된다. 매 재계획 시점마다 D* Lite 가 내는
    시작점 비용 g(s_start) 와 같은 지도에서 A* 를 처음부터 돌린 비용이
    같은지 단언한다. 하나라도 다르면 즉시 실패한다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 x86-64 / CPython 3.13.12)
실행: python3.13 tools/bench/v7_dstar_lite.py
"""

from __future__ import annotations

import heapq

DR = (-1, 0, 1, 0)
DC = (0, 1, 0, -1)
INF = float("inf")


def lcg(seed: int):
    s = seed & 0xFFFFFFFF

    def nxt() -> float:
        nonlocal s
        s = (1664525 * s + 1013904223) & 0xFFFFFFFF
        return s / 4294967296.0

    return nxt


def make_map(rows: int, cols: int, seed: int, density: float):
    """무작위 벽 격자. 시작·목표 주변은 비워 둔다."""
    rnd = lcg(seed)
    wall = [[False] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            wall[r][c] = rnd() < density
    for r, c in ((1, 1), (rows - 2, cols - 2)):
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if 0 <= r + dr < rows and 0 <= c + dc < cols:
                    wall[r + dr][c + dc] = False
    return wall


def neighbors(rows, cols, r, c):
    for d in range(4):
        nr, nc = r + DR[d], c + DC[d]
        if 0 <= nr < rows and 0 <= nc < cols:
            yield nr, nc


def astar(wall, start, goal):
    """알려진 지도 위에서 처음부터 다시 푸는 A*. 반환: (비용, 확장 정점 수)."""
    rows, cols = len(wall), len(wall[0])
    gr, gc = goal

    def h(r, c):
        return abs(r - gr) + abs(c - gc)

    g = {start: 0}
    closed = set()
    pq = [(h(*start), 0, start)]
    expanded = 0
    while pq:
        _, gv, u = heapq.heappop(pq)
        if u in closed or gv > g.get(u, INF):
            continue
        closed.add(u)
        expanded += 1
        if u == goal:
            return gv, expanded
        for v in neighbors(rows, cols, *u):
            if wall[v[0]][v[1]]:
                continue
            ng = gv + 1
            if ng < g.get(v, INF):
                g[v] = ng
                heapq.heappush(pq, (ng + h(*v), ng, v))
    return INF, expanded


class DStarLite:
    """Koenig & Likhachev, 2002, *D* Lite* 의 최적화 버전.

    목표에서 시작 방향으로 거꾸로 푼다. 그래서 로봇이 움직여도 트리가
    무효화되지 않는다. 시작점이 움직이며 생기는 휴리스틱 차이는 k_m 으로
    누적 보정해 큐 전체를 다시 키잉하지 않는다.
    """

    def __init__(self, wall, start, goal):
        self.wall = wall
        self.rows, self.cols = len(wall), len(wall[0])
        self.start = start
        self.goal = goal
        self.km = 0.0
        self.g = {}
        self.rhs = {}
        self.pq = []          # (key, 정점)
        self.best = {}        # 정점 -> 큐에 들어 있는 최신 key. 낡은 항목 판별용
        self.expanded = 0     # ComputeShortestPath 가 실제로 처리한 정점 수
        self.updates = 0      # UpdateVertex 호출 수
        self.rhs[goal] = 0.0
        self._push(goal)

    # --- 내부 ---
    def _gv(self, s):
        return self.g.get(s, INF)

    def _rhsv(self, s):
        return self.rhs.get(s, INF)

    def h(self, a, b):
        return abs(a[0] - b[0]) + abs(a[1] - b[1])

    def key(self, s):
        m = min(self._gv(s), self._rhsv(s))
        return (m + self.h(self.start, s) + self.km, m)

    def _push(self, s):
        k = self.key(s)
        self.best[s] = k
        heapq.heappush(self.pq, (k, s))

    def _remove(self, s):
        self.best.pop(s, None)   # 낡은 항목은 pop 할 때 걸러낸다(지연 삭제)

    def _top(self):
        while self.pq:
            k, s = self.pq[0]
            if self.best.get(s) != k:
                heapq.heappop(self.pq)   # 낡은 항목
                continue
            return k, s
        return None, None

    def update_vertex(self, u):
        self.updates += 1
        if u != self.goal:
            if self.wall[u[0]][u[1]]:
                self.rhs[u] = INF     # 벽이 된 칸에는 들어갈 수 없다
            else:
                best = INF
                for v in neighbors(self.rows, self.cols, *u):
                    if self.wall[v[0]][v[1]]:
                        continue
                    cand = 1 + self._gv(v)
                    if cand < best:
                        best = cand
                self.rhs[u] = best
        self._remove(u)
        if self._gv(u) != self._rhsv(u):
            self._push(u)

    def compute_shortest_path(self):
        while True:
            k_old, u = self._top()
            if u is None:
                break
            if not (k_old < self.key(self.start) or self._rhsv(self.start) > self._gv(self.start)):
                break
            heapq.heappop(self.pq)
            self.best.pop(u, None)
            k_new = self.key(u)
            if k_old < k_new:
                # 시작점이 움직여 키가 낡았다. 다시 넣기만 한다 — 확장이 아니다
                self.best[u] = k_new
                heapq.heappush(self.pq, (k_new, u))
                continue
            self.expanded += 1
            if self._gv(u) > self._rhsv(u):
                self.g[u] = self._rhsv(u)            # 과대추정 → 확정
                for s in neighbors(self.rows, self.cols, *u):
                    self.update_vertex(s)
            else:
                self.g[u] = INF                       # 과소추정 → 무효화하고 재계산
                self.update_vertex(u)
                for s in neighbors(self.rows, self.cols, *u):
                    self.update_vertex(s)

    def cost(self):
        """시작점에서 목표까지의 비용.

        논문의 종료 조건은 시작점이 **국소 일관** 상태가 되는 것까지 요구하지
        않는다. TopKey 가 key(s_start) 이상이 된 순간 남은 정점 중 더 싼 경로가
        없음이 증명되므로 거기서 멈춘다. 그때 답을 들고 있는 것은 g 가 아니라
        rhs 다 — g 는 아직 확정 전(inf)일 수 있다.
        """
        return min(self._gv(self.start), self._rhsv(self.start))

    def next_step(self):
        """현재 시작점에서 한 칸 이동할 곳. c(s,s') + g(s') 이 최소인 이웃."""
        best, bs = INF, None
        for v in neighbors(self.rows, self.cols, *self.start):
            if self.wall[v[0]][v[1]]:
                continue
            cand = 1 + self._gv(v)
            if cand < best:
                best, bs = cand, v
        return bs


def sense(true_wall, known_wall, pos, radius):
    """센서 반경 안의 진짜 벽을 알려진 지도에 반영한다. 새로 드러난 칸 목록."""
    rows, cols = len(true_wall), len(true_wall[0])
    found = []
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            r, c = pos[0] + dr, pos[1] + dc
            if not (0 <= r < rows and 0 <= c < cols):
                continue
            if true_wall[r][c] and not known_wall[r][c]:
                known_wall[r][c] = True
                found.append((r, c))
    return found


def single_discovery_spread() -> None:
    """장애물 하나를 발견했을 때의 수리 비용이 무엇에 비례하는지 본다.

    본문 §4 의 구현(40x40, LCG 지도)을 시드만 바꿔 가며 돌린다.
    관찰하려는 것은 "비용이 얼마나 변했는가(delta)" 와 "확장 수" 의 관계다.
    """
    print()
    print("장애물 1개 발견 — 수리 비용은 '답이 얼마나 바뀌었는가' 를 따라간다 (40x40)")
    print("  seed | 밀도 | 비용 변화 | D* Lite 확장 | A* 전체 확장 | 배율")
    print("  -----+------+-----------+--------------+--------------+------")
    n = 40
    for seed, pct in ((12345, 25), (42, 28), (123, 30), (11, 28), (31337, 25),
                      (2024, 28), (777, 25), (98765, 28)):
        wall = [0] * (n * n)
        s = seed
        for i in range(n * n):
            s = (1664525 * s + 1013904223) % 4294967296
            wall[i] = 1 if (s >> 16) % 100 < pct else 0
        for u in (1 * n + 1, (n - 2) * n + (n - 2)):
            r, c = u // n, u % n
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    wall[(r + dr) * n + (c + dc)] = 0
        grid = [[bool(wall[r * n + c]) for c in range(n)] for r in range(n)]
        start, goal = (1, 1), (n - 2, n - 2)
        d = DStarLite(grid, start, goal)
        d.compute_shortest_path()
        if d.cost() >= INF:
            continue
        pos = start
        for _ in range(5):
            pos = d.next_step()
            d.start = pos
        before_cost = d.cost()
        blocked = d.next_step()
        grid[blocked[0]][blocked[1]] = True
        d.km += d.h(start, pos)
        d.update_vertex(blocked)
        for nb in neighbors(n, n, *blocked):
            d.update_vertex(nb)
        before = d.expanded
        d.compute_shortest_path()
        inc = d.expanded - before
        a_cost, a_exp = astar(grid, pos, goal)
        assert d.cost() == a_cost, (seed, pct, d.cost(), a_cost)
        delta = int(d.cost() - before_cost)
        print(f"  {seed:>5} | {pct:>3}% | {delta:>9} | {inc:>12} | {a_exp:>12} | "
              f"{a_exp / max(1, inc):>5.1f}x")
    print("  (비용 변화 0 = 같은 길이의 대안이 이미 트리에 있었다 → 거의 공짜)")
    print("  (비용 변화가 클수록 고쳐야 할 정점이 늘고, 어떤 경우엔 A* 보다 비싸다)")


def main() -> None:
    rows = cols = 80
    start, goal = (1, 1), (rows - 2, cols - 2)

    # 진짜 지도. 알려진 지도는 이 중 절반만 담고 출발한다(자유공간 가정).
    true_wall = make_map(rows, cols, seed=0xC0FFEE, density=0.28)
    cost, _ = astar(true_wall, start, goal)
    assert cost < INF, "진짜 지도에서 목표에 못 간다 — 시드를 바꿔라"

    rnd = lcg(0xBEEF)
    known_wall = [[true_wall[r][c] and rnd() < 0.5 for c in range(cols)] for r in range(rows)]
    for r, c in (start, goal):
        known_wall[r][c] = False

    d = DStarLite(known_wall, start, goal)
    d.compute_shortest_path()

    # 첫 계획은 양쪽 다 처음부터 푼다. 비교 대상은 "재계획" 이다.
    first_cost, first_astar_exp = astar(known_wall, start, goal)
    assert d.cost() == first_cost, (d.cost(), first_cost)
    initial_dstar_exp = d.expanded
    initial_dstar_upd = d.updates

    astar_total = 0
    replans = 0
    steps = 0
    s_last = start
    pos = start
    traversed = 0

    while pos != goal:
        found = sense(true_wall, known_wall, pos, radius=3)
        if found:
            replans += 1
            d.km += d.h(s_last, pos)
            s_last = pos
            d.start = pos
            touched = set()
            for cell in found:
                touched.add(cell)
                for nb in neighbors(rows, cols, *cell):
                    touched.add(nb)
            for u in touched:
                d.update_vertex(u)
            before = d.expanded
            d.compute_shortest_path()
            inc = d.expanded - before

            # 같은 지도·같은 시작점에서 A* 를 처음부터 돌린다
            a_cost, a_exp = astar(known_wall, pos, goal)
            astar_total += a_exp

            # ★ 핵심 단언 — 증분 갱신은 비용을 바꾸지 않는다
            assert d.cost() == a_cost, (replans, pos, d.cost(), a_cost)
            if replans <= 5:
                print(
                    f"  재계획 {replans:>2}: 위치 {str(pos):>9}  "
                    f"D* Lite 확장 {inc:>5}  A* 확장 {a_exp:>5}  "
                    f"비용 {int(a_cost):>3} (일치)"
                )
        d.start = pos
        nxt = d.next_step()
        assert nxt is not None and d._gv(nxt) < INF, f"막혔다: {pos}"
        pos = nxt
        traversed += 1
        steps += 1
        assert steps < rows * cols * 4, "루프 — 진행이 없다"

    print()
    print(f"격자 {rows}x{cols}, 진짜 벽 밀도 0.28, 그중 절반만 미리 안다. 센서 반경 3")
    print(f"주행 거리 {traversed}칸, 재계획 {replans}회")
    print(f"최초 계획   : D* Lite {initial_dstar_exp:>6}  /  A* {first_astar_exp:>6}")
    print(f"재계획 누적 : D* Lite {d.expanded - initial_dstar_exp:>6}  /  A* {astar_total:>6}"
          f"   (배율 {astar_total / max(1, d.expanded - initial_dstar_exp):.1f}x)")
    print(f"전체 누적   : D* Lite {d.expanded:>6}  /  A* {first_astar_exp + astar_total:>6}"
          f"   (배율 {(first_astar_exp + astar_total) / d.expanded:.1f}x)")
    print(f"재계획 구간의 UpdateVertex 호출: {d.updates - initial_dstar_upd}회 "
          f"(확장 1회당 평균 {(d.updates - initial_dstar_upd) / max(1, d.expanded - initial_dstar_exp):.1f}회)")
    print()
    print(f"[검증] 재계획 {replans}회 전부에서 D* Lite 비용 == A* 전체 재계산 비용  OK")

    single_discovery_spread()


if __name__ == "__main__":
    main()
