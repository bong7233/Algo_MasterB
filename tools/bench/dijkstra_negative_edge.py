#!/usr/bin/env python3
"""음수 간선에서 다익스트라가 무엇을 잃는지 두 가지로 잰다 (V-2 §1).

(a) 확정 배열(done) 판을 쓰면 **틀린 값**을 낸다.
(b) 게으른 삭제 판(d > dist[v] 만 거르는 V-1 의 구현)은 답은 맞지만
    확정 순서 보장을 잃어 정점을 여러 번 다시 펼친다. 재확장 횟수가
    정점 수에 대해 지수로 늘어나는 그래프를 만들어 실제로 센다.

사용법:
    python3 tools/bench/dijkstra_negative_edge.py
"""
import heapq

INF = float("inf")


def dijkstra_done(n, adj, src):
    """확정 배열 판 — 한 번 꺼낸 정점은 다시 보지 않는다."""
    dist = [INF] * n
    dist[src] = 0
    done = [False] * n
    pq = [(0, src)]
    pops = 0
    while pq:
        d, u = heapq.heappop(pq)
        if done[u]:
            continue
        done[u] = True
        pops += 1
        for v, w in adj[u]:
            if not done[v] and d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    return dist, pops


def dijkstra_lazy(n, adj, src, limit=50_000_000):
    """게으른 삭제 판 — V-1 본문 구현과 같다."""
    dist = [INF] * n
    dist[src] = 0
    pq = [(0, src)]
    expands = 0
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        expands += 1
        if expands > limit:
            return dist, -1
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    return dist, expands


def bellman(n, edges, src):
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    return dist


def main():
    # (a) 세 정점짜리 반례. 0→1(5), 0→2(6), 2→1(-4). 참값 dist[1] = 2
    n = 3
    edges = [(0, 1, 5), (0, 2, 6), (2, 1, -4)]
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    print("[a] 반례 그래프  0→1(5)  0→2(6)  2→1(-4)")
    print("    참값(벨만-포드)     ", bellman(n, edges, 0))
    print("    다익스트라 확정판   ", dijkstra_done(n, adj, 0)[0], " ← dist[1] 이 틀렸다")
    print("    다익스트라 게으른판 ", dijkstra_lazy(n, adj, 0)[0], " ← 값은 맞다")
    print()

    # (b) 게으른 판의 재확장 횟수가 지수로 느는 그래프.
    #     게이트 i:  a_i →(0) a_{i+1},  a_i →(M_i) b_i,  b_i →(-M_i-c_i) a_{i+1}
    #     c_i = 2^(k-i) 로 두면 게이트 i 의 두 경로가 만드는 값이 아래쪽 게이트들이
    #     만드는 값 전부와 겹치지 않는다. 그래서 a_{i+1} 에 도착하는 값 하나마다
    #     아래쪽 사슬 전체가 한 번씩 통째로 다시 펼쳐진다 — 게이트마다 두 배다.
    #     M_i 는 우회로가 아래쪽 전체보다 늦게 꺼내지도록 하는 큰 값이다.
    print("[b] 게이트 k개 사슬 — 게으른 판의 확장 횟수")
    print(f"    {'k':>3} {'정점':>5} {'간선':>5} {'확장 횟수':>10} {'2^k':>10}")
    for k in range(1, 15):
        n = 2 * k + 1                     # a_0..a_k, b_0..b_{k-1}
        adj = [[] for _ in range(n)]
        edges = []
        B = 1 << (k + 3)
        for i in range(k):
            a_i, a_next, b_i = i, i + 1, k + 1 + i
            c = 1 << (k - i)
            m = (k - i + 1) * B
            for u, v, w in ((a_i, a_next, 0), (a_i, b_i, m), (b_i, a_next, -m - c)):
                adj[u].append((v, w))
                edges.append((u, v, w))
        _, ex = dijkstra_lazy(n, adj, 0)
        print(f"    {k:>3} {n:>5} {len(edges):>5} {ex:>10} {2 ** k:>10}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
