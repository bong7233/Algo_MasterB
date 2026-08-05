#!/usr/bin/env python3
"""V-4·V-5 — 계산 순서와 휴리스틱을 바꿔도 답이 같은지 확인한다.

V-4 의 주장은 "같은 점화식을 다른 순서로 푼다" 이고, V-5 의 주장은
"h = 0 인 A* 가 곧 다익스트라이며, 허용적이기만 하면 답은 최적이다" 다.
둘 다 검증 가능한 명제다. 하나의 그래프에서 여섯 가지 방법이 같은 거리를
내야 하고, 다르면 그중 하나가 틀린 것이다.

함께 확인하는 것
    - 플로이드-워셜의 k 를 안쪽 루프에 두면 실제로 틀리는 그래프가 얼마나 되는가
      (대부분의 그래프에서 우연히 맞는다는 것이 이 버그가 오래 사는 이유다)
    - 허용적이지만 일관되지 않은 h 에서 닫힌 정점이 몇 번 다시 열리는가

사용법:
    python3.13 tools/bench/v45_order_agreement.py
"""

from __future__ import annotations

import heapq
import random

INF = 10 ** 9


def bellman_ford(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:
            break
    return dist


def dijkstra(n, edges, src):
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    dist = [INF] * n
    dist[src] = 0
    done = [False] * n
    order = []
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if done[u]:
            continue
        done[u] = True
        order.append(u)
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (dist[v], v))
    return dist, order


def floyd(n, edges, k_outer):
    d = [[INF] * n for _ in range(n)]
    for i in range(n):
        d[i][i] = 0
    for u, v, w in edges:
        if w < d[u][v]:
            d[u][v] = w
    if k_outer:
        for k in range(n):
            for i in range(n):
                for j in range(n):
                    if d[i][k] + d[k][j] < d[i][j]:
                        d[i][j] = d[i][k] + d[k][j]
    else:
        for i in range(n):
            for j in range(n):
                for k in range(n):
                    if d[i][k] + d[k][j] < d[i][j]:
                        d[i][j] = d[i][k] + d[k][j]
    return d


def astar(n, edges, src, goal, h):
    """닫힌 목록 + 재열기. 일관되지 않은 h 도 받아 준다."""
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    g = [INF] * n
    g[src] = 0
    closed = [False] * n
    pq = [(h[src], 0, src)]
    expanded = reopened = 0
    order = []
    while pq:
        _, gu, u = heapq.heappop(pq)
        if gu > g[u]:
            continue
        expanded += 1
        order.append(u)
        if u == goal:
            return g[goal], expanded, reopened, order
        closed[u] = True
        for v, w in adj[u]:
            ng = gu + w
            if ng < g[v]:
                if closed[v]:
                    closed[v] = False
                    reopened += 1
                g[v] = ng
                heapq.heappush(pq, (ng + h[v], ng, v))
    return g[goal], expanded, reopened, order


def h_star(n, edges, goal):
    """역방향 다익스트라로 진짜 남은 비용을 구한다. 이것이 허용성의 기준선이다."""
    rev = [(v, u, w) for u, v, w in edges]
    d, _ = dijkstra(n, rev, goal)
    return d


def random_graph(rnd, n, m):
    edges = []
    for _ in range(m):
        u = rnd.randrange(n)
        v = rnd.randrange(n)
        if u == v:
            continue
        edges.append((u, v, rnd.randint(1, 20)))
    return edges


def main() -> None:
    rnd = random.Random(20260805)
    trials = 500
    mismatch = 0
    k_inner_wrong = 0
    reopen_cases = 0
    reopen_total = 0
    zero_order_same = 0

    for _ in range(trials):
        n = rnd.randint(4, 9)
        edges = random_graph(rnd, n, rnd.randint(n, n * 3))
        src, goal = 0, n - 1

        bf = bellman_ford(n, edges, src)
        dij, order_dij = dijkstra(n, edges, src)
        edges_shuffled = edges[:]
        rnd.shuffle(edges_shuffled)
        bf2 = bellman_ford(n, edges_shuffled, src)
        fw_out = floyd(n, edges, True)[src]
        fw_in = floyd(n, edges, False)[src]

        hs = h_star(n, edges, goal)
        h0 = [0] * n
        # 허용적이지만 일관성은 보장하지 않는 h: h* 를 무작위 비율로 깎는다
        hb = [0 if hs[v] >= INF else int(hs[v] * rnd.random()) for v in range(n)]
        hb[goal] = 0

        a0, _, _, order0 = astar(n, edges, src, goal, h0)
        ab, _, rb, _ = astar(n, edges, src, goal, hb)
        # h* 는 언제나 일관하다. 단 목표에 못 닿는 정점의 h* 는 무한이므로,
        # 0 으로 뭉개면 삼각부등식이 깨져 없던 재열기가 생긴다. 큰 유한값으로 둔다 —
        # 그런 정점끼리는 서로만 이어지므로 BIG <= w + BIG 이 그대로 성립한다.
        BIG = 10 ** 7
        hc = [BIG if x >= INF else x for x in hs]
        ah, _, rh, _ = astar(n, edges, src, goal, hc)

        if not (bf == bf2 == dij == fw_out):
            mismatch += 1
        if not (a0 == ab == ah == dij[goal]):
            mismatch += 1
        if fw_in != fw_out:
            k_inner_wrong += 1
        if rb:
            reopen_cases += 1
            reopen_total += rb
        if rh:
            mismatch += 1          # 일관된 h 에서 재열기가 나오면 그것이 결함이다

        # h=0 인 A* 는 다익스트라와 같은 순서로 확장해야 한다(V-5 §2.2).
        # 다익스트라는 끝까지 돌므로 목표를 꺼내는 지점까지만 잘라서 대조한다.
        if goal in order_dij:
            cut = order_dij[: order_dij.index(goal) + 1]
            if cut == order0:
                zero_order_same += 1
            else:
                mismatch += 1
        else:
            zero_order_same += 1        # 목표에 못 닿는 그래프는 대조 대상이 아니다

    print(f"무작위 양수 가중 그래프 {trials}개")
    print(f"  벨만-포드(두 간선 순서) · 다익스트라 · 플로이드-워셜(k 바깥) · "
          f"A*(h=0, 허용적 h, h*) 불일치: {mismatch}건")
    print(f"  플로이드-워셜의 k 를 안쪽에 두면 틀리는 그래프: {k_inner_wrong}건 "
          f"({k_inner_wrong / trials * 100:.1f}%) — 나머지는 우연히 맞는다")
    print(f"  h=0 인 A* 의 확장 순서가 다익스트라와 같은 그래프: {zero_order_same}/{trials}")
    print(f"  허용적이지만 일관되지 않은 h 에서 재열기가 난 그래프: {reopen_cases}건 "
          f"/ 재열기 총 {reopen_total}회 (답은 전부 최적)")


if __name__ == "__main__":
    main()
