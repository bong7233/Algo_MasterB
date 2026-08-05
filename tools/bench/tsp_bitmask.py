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


def main() -> int:
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
