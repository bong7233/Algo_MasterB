#!/usr/bin/env python3
"""힙 다익스트라 vs O(V^2) 선형 탐색 다익스트라 (V-1 §4).

O(E log V) 와 O(V^2) 중 무엇이 빠른지는 그래프의 밀도가 정한다. 희소하면 힙,
조밀하면 배열 훑기다. 자릿수가 아니라 어느 쪽이 이기는지가 뒤집히는 지점을 본다.

사용법:
    python3 tools/bench/dijkstra_heap_vs_scan.py
"""
import heapq
import random
import time

INF = float("inf")


def gen(n, m, seed):
    rng = random.Random(seed)
    adj = [[] for _ in range(n)]
    for i in range(1, n):                       # 연결성 보장
        p = rng.randrange(i)
        adj[p].append((i, rng.randint(1, 1000)))
    for _ in range(max(0, m - (n - 1))):
        u, v = rng.randrange(n), rng.randrange(n)
        if u != v:
            adj[u].append((v, rng.randint(1, 1000)))
    return adj


def heap_dijkstra(n, adj, src):
    dist = [INF] * n
    dist[src] = 0
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    return dist


def scan_dijkstra(n, adj, src):
    dist = [INF] * n
    dist[src] = 0
    done = [False] * n
    for _ in range(n):
        u, best = -1, INF
        for i in range(n):                      # 매 라운드 전 정점을 훑는다
            if not done[i] and dist[i] < best:
                best, u = dist[i], i
        if u < 0:
            break
        done[u] = True
        for v, w in adj[u]:
            if best + w < dist[v]:
                dist[v] = best + w
    return dist


def bench(fn, n, adj, rep=3):
    best = INF
    for _ in range(rep):
        t = time.perf_counter()
        out = fn(n, adj, 0)
        best = min(best, time.perf_counter() - t)
    return best, out


def main():
    print(f"{'V':>6} {'E':>9} {'힙 (ms)':>10} {'선형 탐색 (ms)':>14}  일치")
    for n, m in ((2000, 4000), (2000, 40000), (2000, 400000),
                 (4000, 8000), (4000, 1600000)):
        adj = gen(n, m, 7)
        e = sum(len(a) for a in adj)
        t1, d1 = bench(heap_dijkstra, n, adj)
        t2, d2 = bench(scan_dijkstra, n, adj)
        print(f"{n:>6} {e:>9} {t1 * 1000:>10.1f} {t2 * 1000:>14.1f}  {d1 == d2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
