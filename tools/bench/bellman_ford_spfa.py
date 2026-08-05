#!/usr/bin/env python3
"""벨만-포드의 라운드 수 vs 조기 종료 vs SPFA (V-2 §4).

V-1 라운드는 상한이지 실제로 필요한 횟수가 아니다. 갱신이 없으면 멈추는 판과
큐로 갱신된 정점만 다시 보는 SPFA 가 실제로 몇 번의 완화를 하는지 센다.
SPFA 의 최악은 여전히 O(VE) 라는 것도 함께 보인다.

사용법:
    python3 tools/bench/bellman_ford_spfa.py
"""
import random
import time
from collections import deque

INF = float("inf")


def bf_full(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    ops = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            ops += 1
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    return dist, ops


def bf_early(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    ops = 0
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            ops += 1
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            break
    return dist, ops


def spfa(n, adj, src):
    dist = [INF] * n
    dist[src] = 0
    inq = [False] * n
    q = deque([src])
    inq[src] = True
    ops = 0
    while q:
        u = q.popleft()
        inq[u] = False
        for v, w in adj[u]:
            ops += 1
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                if not inq[v]:
                    q.append(v)
                    inq[v] = True
    return dist, ops


def randgraph(n, m, seed, lo=1, hi=100):
    rng = random.Random(seed)
    edges = []
    for i in range(1, n):
        edges.append((rng.randrange(i), i, rng.randint(lo, hi)))
    for _ in range(m - (n - 1)):
        u, v = rng.randrange(n), rng.randrange(n)
        if u != v:
            edges.append((u, v, rng.randint(lo, hi)))
    return edges


def main():
    print(f"{'그래프':<22}{'V':>6}{'E':>8}{'BF 전체':>12}{'BF 조기종료':>14}{'SPFA':>12}")
    for n, m, seed in ((1000, 3000, 1), (1000, 20000, 2), (5000, 20000, 3)):
        edges = randgraph(n, m, seed)
        adj = [[] for _ in range(n)]
        for u, v, w in edges:
            adj[u].append((v, w))
        d0, o0 = bf_full(n, edges, 0)
        d1, o1 = bf_early(n, edges, 0)
        d2, o2 = spfa(n, adj, 0)
        assert d0 == d1 == d2
        print(f"{'무작위 희소':<22}{n:>6}{len(edges):>8}{o0:>12,}{o1:>14,}{o2:>12,}")

    print()
    print("같은 그래프에서 힙 다익스트라와 SPFA 의 실행 시간 (가중치가 전부 양수)")
    print(f"{'V':>6}{'E':>8}{'다익스트라(ms)':>16}{'SPFA(ms)':>12}{'BF 조기종료(ms)':>18}")
    import heapq
    for n, m, seed in ((5000, 20000, 3), (20000, 100000, 4)):
        edges = randgraph(n, m, seed)
        adj = [[] for _ in range(n)]
        for u, v, w in edges:
            adj[u].append((v, w))

        def dij():
            dist = [INF] * n
            dist[0] = 0
            pq = [(0, 0)]
            while pq:
                d, u = heapq.heappop(pq)
                if d > dist[u]:
                    continue
                for v, w in adj[u]:
                    if d + w < dist[v]:
                        dist[v] = d + w
                        heapq.heappush(pq, (d + w, v))
            return dist

        t = time.perf_counter(); a = dij(); t1 = time.perf_counter() - t
        t = time.perf_counter(); b, _ = spfa(n, adj, 0); t2 = time.perf_counter() - t
        t = time.perf_counter(); c, _ = bf_early(n, edges, 0); t3 = time.perf_counter() - t
        assert a == b == c
        print(f"{n:>6}{len(edges):>8}{t1 * 1000:>16.1f}{t2 * 1000:>12.1f}{t3 * 1000:>18.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
