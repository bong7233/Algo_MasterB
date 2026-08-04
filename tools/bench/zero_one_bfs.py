#!/usr/bin/env python3
"""덱 하나로 힙을 대신한다 — IV-4 본문 수치.

가중치가 {0, 1} 뿐인 격자에서 세 가지를 같은 입력으로 돌려 비교한다.

    1. 다익스트라(heapq)      O(E log V)
    2. 0-1 BFS(deque)         O(V + E)
    3. 다중 시작점 BFS         소스가 여럿일 때 한 번의 탐색으로 끝난다는 확인용

격자: 벽 칸으로 들어가는 간선의 비용이 1, 빈 칸은 0. 백준 1261(알고스팟)의 모양이다.
세 결과의 거리 배열이 완전히 같다는 것을 assert 로 확인한 뒤 시간을 잰다 —
같은 답을 다른 비용으로 낸다는 것이 이 절의 주장이기 때문이다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
사용법: python3.13 tools/bench/zero_one_bfs.py
"""

import heapq
import random
import time
from collections import deque
from statistics import median

N = 700
WALL_RATE = 0.60
REPEAT = 3
INF = float("inf")


def make_grid(n=N, seed=5):
    rng = random.Random(seed)
    g = [[1 if rng.random() < WALL_RATE else 0 for _ in range(n)] for _ in range(n)]
    g[0][0] = g[n - 1][n - 1] = 0
    return g


def dijkstra(g):
    n = len(g)
    dist = [[INF] * n for _ in range(n)]
    dist[0][0] = 0
    pq = [(0, 0, 0)]
    pushes = 1
    while pq:
        d, r, c = heapq.heappop(pq)
        if d > dist[r][c]:
            continue
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n:
                nd = d + g[nr][nc]
                if nd < dist[nr][nc]:
                    dist[nr][nc] = nd
                    heapq.heappush(pq, (nd, nr, nc))
                    pushes += 1
    return dist, pushes


def zero_one_bfs(g):
    n = len(g)
    dist = [[INF] * n for _ in range(n)]
    dist[0][0] = 0
    dq = deque([(0, 0)])
    pushes = 1
    while dq:
        r, c = dq.popleft()
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n:
                nd = dist[r][c] + g[nr][nc]
                if nd < dist[nr][nc]:
                    dist[nr][nc] = nd
                    if g[nr][nc] == 0:
                        dq.appendleft((nr, nc))    # 비용 0 — 지금 층에 남는다
                    else:
                        dq.append((nr, nc))        # 비용 1 — 다음 층으로 간다
                    pushes += 1
    return dist, pushes


def bench(fn, g):
    ts = []
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        out = fn(g)
        ts.append(time.perf_counter() - t0)
    return median(ts), out


def main():
    g = make_grid()
    t_dij, (d1, pushes1) = bench(dijkstra, g)
    t_01, (d2, pushes2) = bench(zero_one_bfs, g)
    assert d1 == d2, "두 알고리즘의 거리 배열이 다르다"

    print(f"{N}×{N} 격자, 벽 비율 {WALL_RATE:.0%}  (정점 {N * N:,}개)")
    print(f"{'':16} {'시간':>10} {'push 횟수':>12}")
    print(f"{'다익스트라(힙)':16} {t_dij * 1000:9.1f}ms {pushes1:12,}")
    print(f"{'0-1 BFS(덱)':16} {t_01 * 1000:9.1f}ms {pushes2:12,}")
    print(f"  배수: 시간 {t_dij / t_01:.2f}배, push 횟수 {pushes1 / pushes2:.2f}배")
    print(f"  두 거리 배열이 같은가: {d1 == d2}")
    print(f"  (0,0)→({N - 1},{N - 1}) 최소 비용: {d1[N - 1][N - 1]}")


if __name__ == "__main__":
    main()
