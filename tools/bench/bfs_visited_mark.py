#!/usr/bin/env python3
"""visited 를 큐에 넣을 때 찍는가, 뺄 때 찍는가 — IV-3 본문 수치.

이 책에서 가장 자주 나는 BFS 버그다. 두 가지를 한 스크립트에서 보인다.

    1. 정확성: 정점 4개짜리 그래프에서 뺄 때 찍기는 **틀린 거리**를 낸다.
       홀수 길이 사이클(같은 층에 이웃이 있는 구조)이 있으면 깨진다.
    2. 성능: 격자는 이분 그래프라 거리가 우연히 맞는다. 대신 push 횟수가 는다.
       "작은 격자 예제로는 이 버그가 안 잡힌다" 는 것이 요점이다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
사용법: python3.13 tools/bench/bfs_visited_mark.py
"""

import time
from collections import deque
from statistics import median

REPEAT = 3


def bfs_mark_on_push(adj, n, s):
    """✅ 큐에 넣을 때 visited 를 찍는다."""
    dist = [-1] * n
    dist[s] = 0
    q = deque([s])
    pushes, peak = 1, 1
    while q:
        x = q.popleft()
        for nx in adj(x):
            if dist[nx] == -1:
                dist[nx] = dist[x] + 1
                q.append(nx)
                pushes += 1
                peak = max(peak, len(q))
    return dist, pushes, peak


def bfs_mark_on_pop(adj, n, s):
    """❌ 큐에서 뺄 때 visited 를 찍는다."""
    visited = [False] * n
    dist = [-1] * n
    dist[s] = 0
    q = deque([s])
    pushes, peak = 1, 1
    while q:
        x = q.popleft()
        if visited[x]:
            continue
        visited[x] = True
        for nx in adj(x):
            if not visited[nx]:
                dist[nx] = dist[x] + 1
                q.append(nx)
                pushes += 1
                peak = max(peak, len(q))
    return dist, pushes, peak


def tiny_counterexample():
    """0-1, 0-2, 1-2, 2-3. 정점 2가 시작점에서 거리 1인데 뺄 때 찍기는 2를 낸다."""
    g = [[1, 2], [0, 2], [0, 1, 3], [2]]
    n = 4
    push, _, _ = bfs_mark_on_push(lambda x: g[x], n, 0)
    pop, _, _ = bfs_mark_on_pop(lambda x: g[x], n, 0)
    print("정점 4개 그래프  간선 (0,1) (0,2) (1,2) (2,3), 시작 0")
    print(f"  넣을 때 찍기 dist = {push}   ← 정답")
    print(f"  뺄 때 찍기  dist = {pop}   ← 틀림")
    print()


def grid_case(n=500):
    """n×n 빈 격자. 이분 그래프라 두 방식의 거리가 같다 — 그래서 버그가 숨는다."""
    def adj(v):
        r, c = divmod(v, n)
        if r > 0: yield v - n
        if r < n - 1: yield v + n
        if c > 0: yield v - 1
        if c < n - 1: yield v + 1

    total = n * n
    results = {}
    for name, fn in (("넣을 때", bfs_mark_on_push), ("뺄 때", bfs_mark_on_pop)):
        ts = []
        for _ in range(REPEAT):
            t0 = time.perf_counter()
            dist, pushes, peak = fn(adj, total, 0)
            ts.append(time.perf_counter() - t0)
        results[name] = (median(ts), pushes, peak, dist)

    same = results["넣을 때"][3] == results["뺄 때"][3]
    print(f"{n}×{n} 빈 격자  (정점 {total:,}개, 간선 {2 * n * (n - 1):,}개)")
    print(f"{'':8} {'시간':>10} {'push 횟수':>12} {'큐 최대 길이':>14}")
    for name in ("넣을 때", "뺄 때"):
        t, pushes, peak, _ = results[name]
        print(f"{name:8} {t * 1000:9.1f}ms {pushes:12,} {peak:14,}")
    a, b = results["넣을 때"], results["뺄 때"]
    print(f"  배수: 시간 {b[0] / a[0]:.2f}배, push {b[1] / a[1]:.2f}배, 큐 {b[2] / a[2]:.2f}배")
    print(f"  거리 배열이 같은가: {same}   ← 격자에서는 우연히 같다")


if __name__ == "__main__":
    tiny_counterexample()
    grid_case()
