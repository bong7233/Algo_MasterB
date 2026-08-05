#!/usr/bin/env python3
"""플로이드-워셜의 k 가 왜 가장 바깥이어야 하는가 (V-3 §2).

k 를 안쪽에 두는 것은 구현 관례의 문제가 아니라 DP 계산 순서의 문제다.
같은 세 줄을 순서만 바꿔 돌려 어디서 답이 갈라지는지 센다.

사용법:
    python3 tools/bench/floyd_loop_order.py
"""
import itertools
import random

INF = float("inf")


def init(n, edges):
    d = [[INF] * n for _ in range(n)]
    for i in range(n):
        d[i][i] = 0
    for u, v, w in edges:
        if w < d[u][v]:
            d[u][v] = w
    return d


def run(n, edges, order):
    """order 는 'kij' 처럼 세 루프의 중첩 순서를 바깥부터 적은 문자열."""
    d = init(n, edges)
    idx = {c: 0 for c in "kij"}
    for a in range(n):
        idx[order[0]] = a
        for b in range(n):
            idx[order[1]] = b
            for c in range(n):
                idx[order[2]] = c
                i, j, k = idx["i"], idx["j"], idx["k"]
                if d[i][k] + d[k][j] < d[i][j]:
                    d[i][j] = d[i][k] + d[k][j]
    return d


def show(n, d, tag):
    print(f"  {tag}")
    for i in range(n):
        print("   ", " ".join("INF" if x == INF else f"{x:3d}" for x in d[i]))


def main():
    print("[1] 사슬 0→3→2→1, 간선은 전부 1")
    n, edges = 4, [(0, 3, 1), (3, 2, 1), (2, 1, 1)]
    ok = run(n, edges, "kij")
    bad = run(n, edges, "ijk")
    show(n, ok, "k 가 바깥 (kij) — 정답")
    show(n, bad, "k 가 안쪽 (ijk) — 오답")
    print(f"  d[0][1] : 정답 {ok[0][1]} / k 안쪽 {bad[0][1]}")
    print()

    print("[2] 사슬 0→1→2→3, 간선은 전부 1 (번호 순서만 뒤집었다)")
    n2, e2 = 4, [(0, 1, 1), (1, 2, 1), (2, 3, 1)]
    ok2, bad2 = run(n2, e2, "kij"), run(n2, e2, "ijk")
    print(f"  d[0][3] : 정답 {ok2[0][3]} / k 안쪽 {bad2[0][3]}  ← 여기서는 우연히 맞는다")
    print()

    print("[3] 여섯 순서 전부 — 무작위 그래프 300개에서 정답과 다른 비율")
    rng = random.Random(20260805)
    tot = 300
    wrong = {"".join(p): 0 for p in itertools.permutations("kij")}
    for _ in range(tot):
        n3 = rng.randint(3, 6)
        m = rng.randint(n3, n3 * 2)
        e3 = [(rng.randrange(n3), rng.randrange(n3), rng.randint(1, 9)) for _ in range(m)]
        e3 = [t for t in e3 if t[0] != t[1]]
        ref = run(n3, e3, "kij")
        for order in wrong:
            if run(n3, e3, order) != ref:
                wrong[order] += 1
    for order in ("kij", "kji", "ikj", "jki", "ijk", "jik"):
        print(f"    {order} : {wrong[order]:>3} / {tot}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
