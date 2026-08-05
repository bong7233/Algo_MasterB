#!/usr/bin/env python3
"""VIII-5 배낭 — 유사 다항식 비용과 비트 연산 부분합의 실측.

측정 환경은 CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / g++ 13 -O2).
같은 실험의 C++ 판은 knapsack_scale.cpp 다.

    python3.13 tools/bench/knapsack_scale.py
"""
import time


class LCG:
    """C++ 판과 같은 수열을 내기 위한 최소 난수기. 두 언어의 입력을 같게 맞춘다."""

    def __init__(self, seed):
        self.x = seed

    def next(self, mod):
        self.x = (self.x * 1103515245 + 12345) % (1 << 31)
        return self.x % mod + 1


def knap01(items, W):
    dp = [0] * (W + 1)
    for w, v in items:
        for c in range(W, w - 1, -1):
            if dp[c - w] + v > dp[c]:
                dp[c] = dp[c - w] + v
    return dp[W]


def subset_bool(nums, S):
    can = bytearray(S + 1)
    can[0] = 1
    for x in nums:
        for s in range(S, x - 1, -1):
            if can[s - x]:
                can[s] = 1
    return sum(can)


def subset_bits(nums, S):
    bits = 1
    mask = (1 << (S + 1)) - 1
    for x in nums:
        bits = (bits | (bits << x)) & mask
    return bin(bits).count("1")


def main():
    rnd = LCG(20260805)
    n, W = 100, 100_000
    items = [(rnd.next(1000), rnd.next(1000)) for _ in range(n)]
    t0 = time.perf_counter()
    ans = knap01(items, W)
    t1 = time.perf_counter()
    print(f"0/1 배낭  n={n} W={W:,} ({n * W:,} 칸) : {t1 - t0:.2f} s  (답 {ans})")

    nums = [rnd.next(1000) for _ in range(n)]
    S = 100_000
    t0 = time.perf_counter()
    a = subset_bool(nums, S)
    t1 = time.perf_counter()
    b = subset_bits(nums, S)
    t2 = time.perf_counter()
    print(f"부분합 불린 DP n={n} S={S:,} : {t1 - t0:.2f} s  (도달 가능한 합 {a}개)")
    print(f"부분합 비트 연산            : {(t2 - t1) * 1000:.1f} ms  (도달 가능한 합 {b}개)")
    print(f"두 결과 일치: {a == b} / 배율 {(t1 - t0) / (t2 - t1):.0f}배")


if __name__ == "__main__":
    main()
