#!/usr/bin/env python3
"""인접 행렬 vs 인접 리스트의 실제 비용 — IV-1 본문 수치.

무엇을 재는가
    1. 메모리: 같은 그래프를 두 표현으로 들었을 때의 실제 바이트 수.
       Python 컨테이너는 내부 포인터까지 따라가며 센다(얕은 getsizeof 는 거짓말한다).
    2. 전체 이웃 순회 시간: "모든 정점의 모든 이웃을 한 번씩 본다".
       BFS·DFS 가 하는 일의 뼈대이고, 두 표현의 차이가 가장 크게 드러나는 연산이다.
    3. 간선 존재 질의 시간: "u 와 v 가 붙어 있는가" 를 10만 번.
       이쪽은 반대로 행렬이 이긴다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
사용법: python3.13 tools/bench/graph_repr_cost.py
"""

import random
import sys
import time
from statistics import median

V = 2000
E = 10000
QUERIES = 100_000
REPEAT = 3


def deep_size(obj, seen=None):
    """컨테이너가 붙들고 있는 바이트를 재귀로 합산한다.

    왜: sys.getsizeof(list) 는 포인터 배열의 크기만 준다. 인접 리스트는
    "리스트의 리스트" 라 안쪽 리스트를 세지 않으면 비교 자체가 성립하지 않는다.
    작은 정수는 CPython 이 캐시하므로 int 객체는 세지 않는다 — 두 표현 모두
    같은 조건이라 비교에 영향이 없다.
    """
    if seen is None:
        seen = set()
    oid = id(obj)
    if oid in seen:
        return 0
    seen.add(oid)
    total = sys.getsizeof(obj)
    if isinstance(obj, (list, tuple)):
        for item in obj:
            total += deep_size(item, seen)
    return total


def build(seed=42):
    rng = random.Random(seed)
    edges = set()
    while len(edges) < E:
        u = rng.randrange(V)
        v = rng.randrange(V)
        if u == v:
            continue
        edges.add((min(u, v), max(u, v)))
    return sorted(edges)


def main():
    edges = build()

    mat = [bytearray(V) for _ in range(V)]
    adj = [[] for _ in range(V)]
    for u, v in edges:
        mat[u][v] = 1
        mat[v][u] = 1
        adj[u].append(v)
        adj[v].append(u)

    mat_bytes = deep_size(mat)
    adj_bytes = deep_size(adj)

    def scan_matrix():
        s = 0
        for u in range(V):
            row = mat[u]
            for v in range(V):
                if row[v]:
                    s += v
        return s

    def scan_list():
        s = 0
        for u in range(V):
            for v in adj[u]:
                s += v
        return s

    assert scan_matrix() == scan_list()

    def bench(fn):
        ts = []
        for _ in range(REPEAT):
            t0 = time.perf_counter()
            fn()
            ts.append(time.perf_counter() - t0)
        return median(ts)

    t_scan_mat = bench(scan_matrix)
    t_scan_adj = bench(scan_list)

    rng = random.Random(7)
    qs = [(rng.randrange(V), rng.randrange(V)) for _ in range(QUERIES)]
    sets = [set(row) for row in adj]

    def query_matrix():
        c = 0
        for u, v in qs:
            if mat[u][v]:
                c += 1
        return c

    def query_list():
        c = 0
        for u, v in qs:
            if v in adj[u]:      # 리스트 선형 탐색 — 인접 리스트의 약점
                c += 1
        return c

    def query_set():
        c = 0
        for u, v in qs:
            if v in sets[u]:     # 해시 집합으로 보강하면 회복된다
                c += 1
        return c

    assert query_matrix() == query_list() == query_set()

    t_q_mat = bench(query_matrix)
    t_q_adj = bench(query_list)
    t_q_set = bench(query_set)

    print(f"V={V} E={E}  (무방향, 자기 루프·중복 없음)")
    print(f"인접 행렬 메모리 : {mat_bytes:>12,} B  ({mat_bytes / 1e6:.1f} MB)")
    print(f"인접 리스트 메모리: {adj_bytes:>12,} B  ({adj_bytes / 1e6:.1f} MB)")
    print(f"  배수: {mat_bytes / adj_bytes:.1f}배")
    print()
    print(f"전체 이웃 순회  행렬: {t_scan_mat * 1000:8.1f} ms   리스트: {t_scan_adj * 1000:8.2f} ms"
          f"   ({t_scan_mat / t_scan_adj:.0f}배)")
    print(f"간선 질의 10만  행렬: {t_q_mat * 1000:8.1f} ms   리스트: {t_q_adj * 1000:8.1f} ms"
          f"   ({t_q_adj / t_q_mat:.1f}배)")
    print(f"                 집합: {t_q_set * 1000:8.1f} ms")


if __name__ == "__main__":
    main()
