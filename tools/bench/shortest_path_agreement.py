#!/usr/bin/env python3
"""V-1·V-2·V-3 이 같은 답을 내는지 확인한다.

세 알고리즘은 같은 벨만 방정식을 다른 순서로 푼다(V-4). 순서가 다를 뿐이므로
음수 간선이 없는 그래프에서는 거리 벡터가 완전히 같아야 한다. 하나라도 다르면
셋 중 하나가 틀린 것이다. 본문에 실린 세 구현을 그대로 옮겨 놓고 대조한다.

사용법:
    python3 tools/bench/shortest_path_agreement.py
"""
import heapq
import random
from collections import deque

INF = float("inf")

# 본문 V-1·V-2·V-3 이 공유하는 예제 그래프 (정점 6, 유향 간선 9, 전부 양수)
EDGES = [(0, 1, 4), (0, 2, 1), (2, 1, 2), (1, 3, 5), (2, 3, 8),
         (2, 4, 10), (3, 4, 2), (3, 5, 6), (4, 5, 3)]
N = 6


def to_adj(n, edges):
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    return adj


def dijkstra(n, edges, src):
    adj = to_adj(n, edges)
    dist = [INF] * n
    dist[src] = 0
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist


def bellman_ford(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            break
    for u, v, w in edges:
        if dist[u] != INF and dist[u] + w < dist[v]:
            return None          # 음수 사이클
    return dist


def spfa(n, edges, src):
    adj = to_adj(n, edges)
    dist = [INF] * n
    dist[src] = 0
    inq = [False] * n
    cnt = [0] * n
    q = deque([src])
    inq[src] = True
    while q:
        u = q.popleft()
        inq[u] = False
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                if not inq[v]:
                    cnt[v] += 1
                    if cnt[v] >= n:
                        return None
                    q.append(v)
                    inq[v] = True
    return dist


def floyd(n, edges):
    d = [[INF] * n for _ in range(n)]
    for i in range(n):
        d[i][i] = 0
    for u, v, w in edges:
        d[u][v] = min(d[u][v], w)
    for k in range(n):
        for i in range(n):
            if d[i][k] == INF:
                continue
            for j in range(n):
                if d[i][k] + d[k][j] < d[i][j]:
                    d[i][j] = d[i][k] + d[k][j]
    return d


def show(tag, v):
    print(f"  {tag:<16}", [("INF" if x == INF else x) for x in v])


def main():
    print("[1] 본문 공유 예제 그래프 — 시작 정점 0")
    dj = dijkstra(N, EDGES, 0)
    bf = bellman_ford(N, EDGES, 0)
    sp = spfa(N, EDGES, 0)
    fw = floyd(N, EDGES)[0]
    show("다익스트라(V-1)", dj)
    show("벨만-포드(V-2)", bf)
    show("SPFA(V-2)", sp)
    show("플로이드-워셜(V-3)", fw)
    assert dj == bf == sp == fw, "세 알고리즘의 답이 다르다"
    print("  → 네 거리 벡터가 완전히 일치한다.\n")

    print("[2] 무작위 양수 가중 그래프 500개 — 전 쌍 대조")
    rng = random.Random(20260805)
    bad = 0
    for t in range(500):
        n = rng.randint(2, 9)
        m = rng.randint(0, n * (n - 1))
        edges = [(rng.randrange(n), rng.randrange(n), rng.randint(0, 30))
                 for _ in range(m)]
        edges = [(u, v, w) for u, v, w in edges if u != v]
        fwm = floyd(n, edges)
        for s in range(n):
            a = dijkstra(n, edges, s)
            b = bellman_ford(n, edges, s)
            c = spfa(n, edges, s)
            if not (a == b == c == fwm[s]):
                bad += 1
                print("  불일치!", n, edges, s, a, b, c, fwm[s])
    print(f"  대조 그래프 500개 / 불일치 {bad}건")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
