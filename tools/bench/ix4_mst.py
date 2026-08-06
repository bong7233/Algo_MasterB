#!/usr/bin/env python3
"""IX-4 최소 신장 트리 — 완전탐색 대조 + 크루스칼·프림 속도 (CPython 3.13).

    python3.13 tools/bench/ix4_mst.py

세 가지를 확인한다.
  1. 정확성: 아주 작은 그래프(정점 6개 이하)에서 가능한 신장 트리를 전부 만들어
     최솟값을 찾고, 크루스칼·프림이 같은 값을 내는지 본다.
  2. 희소 그래프 속도: 간선이 적을 때 크루스칼(정렬 + 유니온 파인드)과
     프림(힙)을 견준다.
  3. 밀집 그래프 속도: 거의 완전그래프에 가까울 때 두 알고리즘의 상수가
     어떻게 벌어지는지 본다 — 크루스칼은 간선을 전부 만들어 정렬해야 하고,
     프림은 힙에 넣는 대신 인접 정점만 본다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
"""
from __future__ import annotations

import heapq
import itertools
import random
import time
from statistics import median

REPEAT = 3


# ─────────────────────────────────────────────────────────────────────
# 유니온 파인드 — IX-1 의 경로 압축 버전과 같다
# ─────────────────────────────────────────────────────────────────────
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.parent[ra] = rb
        return True


def kruskal(n, edges):
    """edges: (weight, u, v) 목록."""
    dsu = DSU(n)
    total, used = 0, 0
    for w, u, v in sorted(edges):
        if dsu.union(u, v):
            total += w
            used += 1
            if used == n - 1:
                break
    return total if used == n - 1 else None


def prim(n, adj):
    """adj[u] = [(v, w), ...]. 힙 기반, II-8 과 같은 sift 구조."""
    visited = [False] * n
    heap = [(0, 0)]
    total, used = 0, 0
    while heap and used < n:
        w, u = heapq.heappop(heap)
        if visited[u]:
            continue
        visited[u] = True
        total += w
        used += 1
        for v, vw in adj[u]:
            if not visited[v]:
                heapq.heappush(heap, (vw, v))
    return total if used == n else None


def brute_mst(n, edges):
    """정점이 아주 적을 때만 쓴다 — 간선 부분집합을 전부 검사."""
    best = None
    m = len(edges)
    for combo in itertools.combinations(range(m), n - 1):
        dsu = DSU(n)
        w_sum = 0
        ok = True
        for idx in combo:
            w, u, v = edges[idx]
            if not dsu.union(u, v):
                ok = False
                break
            w_sum += w
        if ok:
            root = dsu.find(0)
            if all(dsu.find(x) == root for x in range(n)):
                if best is None or w_sum < best:
                    best = w_sum
    return best


def prim_dense(n, wmat):
    """힙 없이 배열로 최솟값을 매번 선형 탐색한다 — 인접 행렬로 주어진 밀집 그래프용."""
    INF = float("inf")
    key = [INF] * n
    visited = [False] * n
    key[0] = 0
    total = 0
    for _ in range(n):
        u = -1
        best = INF
        for x in range(n):
            if not visited[x] and key[x] < best:
                best, u = key[x], x
        visited[u] = True
        total += key[u]
        for v in range(n):
            if not visited[v] and wmat[u][v] < key[v]:
                key[v] = wmat[u][v]
    return total


def to_adj(n, edges):
    adj = [[] for _ in range(n)]
    for w, u, v in edges:
        adj[u].append((v, w))
        adj[v].append((u, w))
    return adj


def correctness_check():
    random.seed(3)
    trials, mismatches = 200, 0
    for _ in range(trials):
        n = random.randint(3, 6)
        max_edges = n * (n - 1) // 2
        m = random.randint(n - 1, max_edges)
        pairs = list(itertools.combinations(range(n), 2))
        random.shuffle(pairs)
        chosen = pairs[:m]
        edges = [(random.randint(1, 20), u, v) for u, v in chosen]
        # 연결 그래프가 아니면 신장 트리가 없다 — 스킵
        dsu = DSU(n)
        for _, u, v in edges:
            dsu.union(u, v)
        if len({dsu.find(x) for x in range(n)}) != 1:
            continue
        want = brute_mst(n, edges)
        got_k = kruskal(n, edges)
        got_p = prim(n, to_adj(n, edges))
        if want != got_k or want != got_p:
            mismatches += 1
    print(f"[정확성] 무작위 {trials}건(정점 3~6개) — 불일치 {mismatches}건 (완전탐색 대조)")


def timeit(fn):
    ts = []
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        fn()
        ts.append(time.perf_counter() - t0)
    return ts


def sparse_speed():
    random.seed(4)
    n = 4000
    pairs = set()
    edges = []
    # 스패닝 트리 하나로 연결을 보장한 뒤 무작위 간선을 더해 E ≈ 2V 로 맞춘다
    order = list(range(n))
    random.shuffle(order)
    for i in range(1, n):
        u, v = order[i], order[random.randint(0, i - 1)]
        w = random.randint(1, 1000)
        edges.append((w, u, v))
        pairs.add((min(u, v), max(u, v)))
    while len(edges) < 2 * n:
        u, v = random.randint(0, n - 1), random.randint(0, n - 1)
        if u != v and (min(u, v), max(u, v)) not in pairs:
            pairs.add((min(u, v), max(u, v)))
            edges.append((random.randint(1, 1000), u, v))
    adj = to_adj(n, edges)

    tk = timeit(lambda: kruskal(n, edges))
    tp = timeit(lambda: prim(n, adj))
    wk, wp = kruskal(n, edges), prim(n, adj)
    print(f"[희소] V={n:,} E={len(edges):,} (E≈2V) — 크루스칼={wk} 프림={wp}")
    print(f"  크루스칼: {[round(t, 4) for t in tk]}  중앙값 {median(tk):.4f}s")
    print(f"  프림    : {[round(t, 4) for t in tp]}  중앙값 {median(tp):.4f}s")


def dense_speed():
    random.seed(5)
    n = 700
    edges = []
    wmat = [[0] * n for _ in range(n)]
    for u in range(n):
        for v in range(u + 1, n):
            w = random.randint(1, 1000)
            edges.append((w, u, v))
            wmat[u][v] = wmat[v][u] = w
    adj = to_adj(n, edges)

    tk = timeit(lambda: kruskal(n, edges))
    tp = timeit(lambda: prim(n, adj))
    tpd = timeit(lambda: prim_dense(n, wmat))
    wk, wp, wpd = kruskal(n, edges), prim(n, adj), prim_dense(n, wmat)
    print(f"[밀집] V={n:,} E={len(edges):,} (완전그래프) — 크루스칼={wk} 프림(힙)={wp} 프림(배열)={wpd}")
    print(f"  크루스칼(정렬+유니온파인드): {[round(t, 4) for t in tk]}  중앙값 {median(tk):.4f}s")
    print(f"  프림(힙, 인접리스트)      : {[round(t, 4) for t in tp]}  중앙값 {median(tp):.4f}s")
    print(f"  프림(배열, 인접행렬)      : {[round(t, 4) for t in tpd]}  중앙값 {median(tpd):.4f}s")


if __name__ == "__main__":
    correctness_check()
    sparse_speed()
    dense_speed()
