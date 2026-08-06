#!/usr/bin/env python3
"""IX-8 — 본문 예제의 Ford-Fulkerson 반복을 재현하고, 두 가지 방법으로 대조한다.

1. BFS 기반 Edmonds-Karp로 같은 그래프를 독립적으로 풀어 최대 유량 값이 같은지 확인.
2. 모든 S-T 컷을 브루트포스로 열거해 최소 컷 = 최대 유량인지 확인(그래프가 작아 가능하다).
3. §5의 이분 매칭 결과를 완전탐색(모든 순열)으로 다시 확인.
"""

from __future__ import annotations

import itertools
from collections import deque


def max_flow_dfs_trace(n: int, cap: list[list[int]], s: int, t: int, names: list[str]):
    """본문 §3~4와 동일한 DFS(정점 번호 오름차순) Ford-Fulkerson. 반복 로그를 남긴다."""
    total = 0
    log = []
    while True:
        visited = [False] * n
        parent = [-1] * n
        visited[s] = True

        def dfs(u: int) -> bool:
            if u == t:
                return True
            for v in range(n):
                if cap[u][v] > 0 and not visited[v]:
                    visited[v] = True
                    parent[v] = u
                    if dfs(v):
                        return True
            return False

        if not dfs(s):
            break
        v, bottleneck = t, float("inf")
        while v != s:
            u = parent[v]
            bottleneck = min(bottleneck, cap[u][v])
            v = u
        path = [t]
        v = t
        while v != s:
            u = parent[v]
            cap[u][v] -= bottleneck
            cap[v][u] += bottleneck
            path.append(u)
            v = u
        path.reverse()
        total += bottleneck
        log.append((path, bottleneck, total))
    return total, log


def max_flow_bfs(n: int, cap: list[list[int]], s: int, t: int) -> int:
    """Edmonds-Karp — 완전히 별도의 구현으로 같은 그래프를 검산한다."""
    total = 0
    while True:
        parent = [-1] * n
        parent[s] = s
        q = deque([s])
        while q:
            u = q.popleft()
            if u == t:
                break
            for v in range(n):
                if cap[u][v] > 0 and parent[v] == -1:
                    parent[v] = u
                    q.append(v)
        if parent[t] == -1:
            break
        v, bn = t, float("inf")
        while v != s:
            u = parent[v]
            bn = min(bn, cap[u][v])
            v = u
        v = t
        while v != s:
            u = parent[v]
            cap[u][v] -= bn
            cap[v][u] += bn
            v = u
        total += bn
    return total


def brute_min_cut(n: int, orig_cap: dict[tuple[int, int], int], s: int, t: int) -> int:
    best = float("inf")
    nodes = [i for i in range(n) if i != s and i != t]
    for r in range(len(nodes) + 1):
        for combo in itertools.combinations(nodes, r):
            side = {s, *combo}
            if t in side:
                continue
            cutcap = sum(c for (u, v), c in orig_cap.items() if u in side and v not in side)
            best = min(best, cutcap)
    return best


def main() -> None:
    names = ["S", "A", "B", "T"]
    n = 4
    orig = {(0, 1): 2, (0, 2): 2, (1, 2): 1, (1, 3): 2, (2, 3): 2}

    cap1 = [[0] * n for _ in range(n)]
    for (u, v), c in orig.items():
        cap1[u][v] = c
    total_dfs, log = max_flow_dfs_trace(n, cap1, 0, 3, names)
    print("[본문 §3 trace 재현 — DFS Ford-Fulkerson]")
    for it, (path, bn, tot) in enumerate(log, 1):
        print(f"  iter{it}: {'->'.join(names[x] for x in path):<14} bottleneck={bn} total={tot}")
    print(f"  max flow (DFS) = {total_dfs}")

    cap2 = [[0] * n for _ in range(n)]
    for (u, v), c in orig.items():
        cap2[u][v] = c
    total_bfs = max_flow_bfs(n, cap2, 0, 3)
    print(f"\n[독립 구현 대조] max flow (BFS Edmonds-Karp) = {total_bfs}")

    mincut = brute_min_cut(n, orig, 0, 3)
    print(f"[브루트포스 최소 컷] = {mincut}")
    assert total_dfs == total_bfs == mincut == 4
    print("DFS == BFS == 브루트포스 최소 컷: OK")

    # §5 이분 매칭 완전탐색 대조.
    workers = ["W1", "W2", "W3"]
    jobs = ["J1", "J2", "J3"]
    able = {("W1", "J1"), ("W1", "J2"), ("W2", "J1"), ("W3", "J2"), ("W3", "J3")}
    best = 0
    for perm in itertools.permutations(jobs):
        size = sum(1 for w, j in zip(workers, perm) if (w, j) in able)
        best = max(best, size)
    print(f"\n[§5 이분 매칭] 완전탐색(순열) 최대 매칭 = {best} (본문 결과 3과 일치: {best == 3})")


if __name__ == "__main__":
    main()
