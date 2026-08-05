#!/usr/bin/env python3
"""V-6 — Weighted A* 의 epsilon 스윕과 JPS 대칭성 계수.

무엇을 재는가
    1. 같은 격자·같은 시작·같은 목표에서 epsilon 을 바꿔 가며
       (확장 칸 수, 경로 비용, 최적 대비 비율) 을 잰다.
    2. epsilon = 1 인 A* 의 비용이 다익스트라의 비용과 같은지 확인한다.
       (M5 부칙 §6 — 서로가 서로의 채점기다.)
    3. 실제 비율이 항상 epsilon 이하인지 확인한다. 이것이 본문이 "경계가 알려져
       있다" 고 말하는 근거다.
    4. 균일 격자에서 같은 길이의 최단경로가 몇 개인지 센다 — JPS 가 제거하는
       대칭의 크기다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 x86-64 / CPython 3.13.12)
실행: python3.13 tools/bench/v6_weighted_astar.py
"""

from __future__ import annotations

import heapq
from math import comb

DR = (-1, 0, 1, 0)
DC = (0, 1, 0, -1)


def lcg(seed: int):
    s = seed & 0xFFFFFFFF

    def nxt() -> float:
        nonlocal s
        s = (1664525 * s + 1013904223) & 0xFFFFFFFF
        return s / 4294967296.0

    return nxt


def make_grid(rows: int, cols: int, seed: int = 0x5EED17):
    """지형 비용 격자. 칸에 들어가는 비용이 1/3/6 중 하나, 일부는 벽(0).

    칸마다 독립 난수를 뿌리면 점박이가 되어 우회 판단이 생기지 않는다.
    저해상도 격자를 보간해 늪이 덩어리로 뭉치게 한다(위젯과 같은 모델).
    """
    rnd = lcg(seed)
    L = 5
    lat = [[rnd() for _ in range(L + 1)] for _ in range(L + 1)]

    def smooth(t: float) -> float:
        return t * t * (3 - 2 * t)

    cost = [[1] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            fy = (r / (rows - 1)) * L
            fx = (c / (cols - 1)) * L
            y0, x0 = min(L - 1, int(fy)), min(L - 1, int(fx))
            ty, tx = smooth(fy - y0), smooth(fx - x0)
            a = lat[y0][x0] + (lat[y0][x0 + 1] - lat[y0][x0]) * tx
            b = lat[y0 + 1][x0] + (lat[y0 + 1][x0 + 1] - lat[y0 + 1][x0]) * tx
            v = a + (b - a) * ty
            cost[r][c] = 0 if v < 0.24 else (1 if v < 0.55 else (3 if v < 0.78 else 6))
    return cost


def search(cost, start, goal, eps: float):
    """f = g + eps*h 로 여는 A*. eps=0 이면 다익스트라, 1 이면 A*, >1 이면 Weighted A*.

    반환: (경로 비용, 확장 칸 수)
    """
    rows, cols = len(cost), len(cost[0])
    gr, gc = goal

    def h(r, c):  # 최소 칸 비용이 1 이므로 맨해튼 거리는 허용적이다
        return abs(r - gr) + abs(c - gc)

    INF = float("inf")
    g = [[INF] * cols for _ in range(rows)]
    closed = [[False] * cols for _ in range(rows)]
    g[start[0]][start[1]] = 0
    pq = [(eps * h(*start), 0, start)]
    expanded = 0
    while pq:
        _, gv, (r, c) = heapq.heappop(pq)
        if closed[r][c] or gv > g[r][c]:
            continue
        closed[r][c] = True
        expanded += 1
        if (r, c) == goal:
            return gv, expanded
        for d in range(4):
            nr, nc = r + DR[d], c + DC[d]
            if not (0 <= nr < rows and 0 <= nc < cols) or cost[nr][nc] == 0:
                continue
            ng = gv + cost[nr][nc]
            if ng < g[nr][nc]:
                g[nr][nc] = ng
                heapq.heappush(pq, (ng + eps * h(nr, nc), ng, (nr, nc)))
    return INF, expanded


def count_shortest_paths(rows: int, cols: int) -> int:
    """벽 없는 균일 격자에서 한쪽 구석에서 반대 구석까지의 최단경로 개수."""
    return comb((rows - 1) + (cols - 1), rows - 1)


def main() -> None:
    rows = cols = 60
    cost = make_grid(rows, cols)
    start, goal = (1, 1), (rows - 2, cols - 2)
    assert cost[start[0]][start[1]] and cost[goal[0]][goal[1]], "시작·목표가 벽이다"

    dij_cost, dij_exp = search(cost, start, goal, 0.0)
    print(f"격자 {rows}x{cols}, 칸 비용 1/3/6, 벽 포함. 시작 {start} 목표 {goal}")
    print(f"다익스트라(h=0): 비용 {dij_cost:>4} 확장 {dij_exp:>5}")
    print()
    print("  eps |  확장 칸 |  경로 비용 |  최적 대비 |  경계 eps  |  경계 준수")
    print("  ----+----------+------------+------------+------------+-----------")
    rows_out = []
    for eps in (1.0, 1.5, 2.0, 3.0, 5.0):
        c, e = search(cost, start, goal, eps)
        ratio = c / dij_cost
        ok = "OK" if ratio <= eps + 1e-9 else "VIOLATION"
        rows_out.append((eps, e, c, ratio, ok))
        print(f"  {eps:>3.1f} | {e:>8} | {c:>10} | {ratio:>10.3f} | {eps:>10.1f} | {ok:>9}")

    # 검증 1 — eps=1 의 A* 는 다익스트라와 같은 비용을 내야 한다 (M5 §6)
    a_star_cost = rows_out[0][2]
    assert a_star_cost == dij_cost, (a_star_cost, dij_cost)
    print()
    print(f"[검증] A*(eps=1) 비용 {a_star_cost} == 다익스트라 비용 {dij_cost}  OK")

    # 검증 2 — 실제 비율이 항상 eps 이하 (Weighted A* 의 준최적 경계)
    assert all(r[3] <= r[0] + 1e-9 for r in rows_out)
    print("[검증] 모든 eps 에서 실제 비율 <= eps  OK")

    print()
    for n in (5, 10, 15):
        print(f"[JPS] {n}x{n} 빈 격자의 최단경로 개수 = {count_shortest_paths(n, n):,}")


if __name__ == "__main__":
    main()
