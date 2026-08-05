#!/usr/bin/env python3
"""VIII-9 의 수치 — 순열 완전탐색 대 비트마스크 DP (CPython 3.13).

CLAUDE.md §1-3 환경에서 실행한다.
    python3.13 tools/bench/tsp_bitmask.py

측정하는 것
  1. 같은 입력에 대해 두 방법이 같은 답을 내는지 (정확성 대조)
  2. n 을 늘려 가며 각각의 벽시계 시간
  3. 비트마스크 DP 의 상태 수와 메모리
"""
from __future__ import annotations

import random
import statistics
import sys
import time
from itertools import permutations

INF = float("inf")


def make_cost(n: int, seed: int = 7) -> list[list[int]]:
    rnd = random.Random(seed)
    c = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                c[i][j] = rnd.randint(1, 100)
    return c


def brute(cost: list[list[int]]) -> int:
    n = len(cost)
    best = INF
    for p in permutations(range(1, n)):
        prev = 0
        s = 0
        for x in p:
            s += cost[prev][x]
            prev = x
        s += cost[prev][0]
        if s < best:
            best = s
    return best


def bitmask(cost: list[list[int]]) -> int:
    n = len(cost)
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1 << n):
        row = dp[mask]
        for i in range(n):
            cur = row[i]
            if cur == INF:
                continue
            ci = cost[i]
            for j in range(n):
                if mask >> j & 1:
                    continue
                nxt = dp[mask | (1 << j)]
                v = cur + ci[j]
                if v < nxt[j]:
                    nxt[j] = v
    return min(dp[full][i] + cost[i][0] for i in range(1, n))


def timed(fn, arg, reps=3):
    ts = []
    out = None
    for _ in range(reps):
        t0 = time.perf_counter()
        out = fn(arg)
        ts.append(time.perf_counter() - t0)
    return out, statistics.median(ts)


def verify(trials: int = 300) -> bool:
    """무작위 비용 행렬에서 순열 완전탐색과 비트마스크 DP 를 대조한다.

    DP 는 답을 독립으로 검증할 수 있다. 작은 n 에서 완전탐색과 어긋나면
    점화식이나 초기값이 틀린 것이지 성능 문제가 아니다.
    """
    rnd = random.Random(2024)
    for t in range(trials):
        n = rnd.randint(2, 8)
        cost = [[0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i != j:
                    cost[i][j] = rnd.randint(1, 50)
        b, d = brute(cost), bitmask(cost)
        if b != d:
            print(f"불일치 t={t} n={n} brute={b} bitmask={d}")
            for row in cost:
                print("   ", row)
            return False
    print(f"정확성: 무작위 {trials}건(n=2..8, 비대칭 비용)에서 완전탐색 == 비트마스크 DP")
    return True


def memory_table() -> None:
    """DP 표가 실제로 잡는 메모리. n 이 1 늘면 2배가 조금 넘는다."""
    import tracemalloc

    print("  n | 상태 수 (2^n x n) | 표 메모리(Python)")
    print("----|-------------------|------------------")
    for n in (12, 16, 18):
        cost = make_cost(n)
        tracemalloc.start()
        bitmask(cost)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        print(f" {n:2d} | {(1 << n) * n:17,} | {peak / 1024 / 1024:14.1f} MB")


def main() -> int:
    if not verify():
        return 1
    print()

    print("n  | brute(초)   | bitmask(초) | 답 일치")
    print("---|-------------|-------------|--------")
    for n in (9, 10, 11, 12):
        cost = make_cost(n)
        b, tb = timed(brute, cost)
        d, td = timed(bitmask, cost)
        print(f"{n:2d} | {tb:11.4f} | {td:11.4f} | {b == d} ({b})")

    print()
    for n in (13, 14, 15, 16):
        cost = make_cost(n)
        d, td = timed(bitmask, cost, reps=1)
        states = (1 << n) * n
        print(f"n={n:2d} bitmask={td:8.3f}초  상태 {states:,}개  답 {d}")

    print()
    memory_table()
    return 0


if __name__ == "__main__":
    sys.exit(main())
