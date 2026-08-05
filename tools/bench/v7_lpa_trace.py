#!/usr/bin/env python3
"""V-7 §3 손추적 표를 기계로 다시 확인한다.

본문의 `::: trace` 는 정점 다섯 개짜리 방향 그래프에서 간선 하나의 비용이
바뀌었을 때 LPA* 가 무엇을 몇 번 꺼내는지를 손으로 따라가게 한다.
표에 적힌 값이 실제 실행과 한 칸도 어긋나지 않아야 한다.

여기서는 h = 0 으로 두고(키의 첫 항이 곧 min(g, rhs)) 목표가 국소 일관이
될 때까지 돌린다 — 본문 표가 g(G) 까지 보이기 때문이다.

실행: python3.13 tools/bench/v7_lpa_trace.py
"""

from __future__ import annotations

import heapq

INF = float("inf")

EDGES = {("S", "A"): 1, ("S", "B"): 1, ("A", "C"): 1, ("B", "C"): 4, ("C", "G"): 1}
V = ["S", "A", "B", "C", "G"]
START, GOAL = "S", "G"

pred = {v: [u for (u, w) in EDGES if w == v] for v in V}
succ = {v: [w for (u, w) in EDGES if u == v] for v in V}

g = {v: INF for v in V}
rhs = {v: INF for v in V}
rhs[START] = 0
pq: list = []
best: dict = {}


def key(s):
    return min(g[s], rhs[s])          # h = 0, k_m = 0


def push(s):
    best[s] = key(s)
    heapq.heappush(pq, (best[s], s))


def top():
    while pq:
        k, s = pq[0]
        if best.get(s) != k:          # 낡은 항목 — 지연 삭제
            heapq.heappop(pq)
            continue
        return k, s
    return None, None


def update(u):
    if u != START:
        rhs[u] = min([g[p] + EDGES[(p, u)] for p in pred[u]] or [INF])
    best.pop(u, None)
    if g[u] != rhs[u]:
        push(u)


def compute(log=False):
    step = 0
    while True:
        k, u = top()
        if u is None:
            break
        if not (k < key(GOAL) or rhs[GOAL] != g[GOAL]):
            break
        heapq.heappop(pq)
        best.pop(u, None)
        if k < key(u):
            push(u)
            continue
        step += 1
        if g[u] > rhs[u]:
            g[u] = rhs[u]
            for s in succ[u]:
                update(s)
        else:
            g[u] = INF
            update(u)
            for s in succ[u]:
                update(s)
        if log:
            q = ", ".join(f"{x}:{fmt(best[x])}" for _, x in sorted((best[x], x) for x in best))
            print(f"  | {step} | {{{q}}} | {u} | {fmt(g['C'])} | {fmt(rhs['C'])} | "
                  f"{fmt(g['G'])} | {fmt(rhs['G'])} |")
    return step


def fmt(x):
    return "inf" if x == INF else str(int(x))


def main() -> None:
    push(START)
    compute()
    print("첫 탐색 후 (모든 정점이 국소 일관):")
    print("  " + " ".join(f"{v}={fmt(g[v])}" for v in V))
    assert all(g[v] == rhs[v] for v in V)
    assert [g[v] for v in V] == [0, 1, 1, 2, 3], [g[v] for v in V]

    EDGES[("A", "C")] = 10            # 그 통로에 장애물이 놓였다
    update("C")
    q0 = ", ".join(f"{x}:{fmt(best[x])}" for x in best)
    print()
    print("간선 A→C 를 1 에서 10 으로 바꾼 뒤")
    print(f"  | 0 | {{{q0}}} | — | {fmt(g['C'])} | {fmt(rhs['C'])} | "
          f"{fmt(g['G'])} | {fmt(rhs['G'])} |")
    steps = compute(log=True)

    print()
    print(f"확장 {steps}회. 최종 g = " + " ".join(f"{v}={fmt(g[v])}" for v in V))
    assert steps == 4, steps
    assert g["G"] == 6 and rhs["G"] == 6
    assert g["C"] == 5 and rhs["C"] == 5
    # S, A, B 는 한 번도 큐에 들어가지 않았다 — 값이 그대로다
    assert (g["S"], g["A"], g["B"]) == (0, 1, 1)
    print("[검증] 본문 §3 표와 일치. S·A·B 는 재계산되지 않았다  OK")


if __name__ == "__main__":
    main()
