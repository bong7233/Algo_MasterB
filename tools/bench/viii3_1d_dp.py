#!/usr/bin/env python3
"""VIII-3 의 수치와 정확성 검증 — 1차원 DP.

무엇을 재는가
    1. 타일링/계단의 배열판과 롤링(변수 두 개)판의 시간·메모리
    2. 최대 부분합: O(n^2) 완전탐색과 카데인의 시간, 그리고 답의 일치
    3. 무작위 대조 (M7 부칙 §7) — 카데인 vs 완전탐색, 타일링 DP vs 완전열거

측정 환경은 CLAUDE.md §1-3 고정. 실행:
    python3.13 tools/bench/viii3_1d_dp.py
"""

from __future__ import annotations

import random
import time
import tracemalloc

MOD = 10007


def tiling_array(n: int) -> list[int]:
    dp = [0] * (max(n, 1) + 1)
    dp[0] = 1
    dp[1] = 1
    for i in range(2, n + 1):
        dp[i] = (dp[i - 1] + dp[i - 2]) % MOD
    return dp


def tiling_rolling(n: int) -> int:
    prev2, prev1 = 1, 1     # dp[0], dp[1]
    for _ in range(2, n + 1):
        prev2, prev1 = prev1, (prev1 + prev2) % MOD
    return prev1 if n >= 1 else 1


def tiling_enumerate(n: int) -> int:
    """2×n 을 타일로 채우는 방법을 실제로 하나씩 세어 본다. n 이 작을 때만."""
    def go(k: int) -> int:
        if k < 0:
            return 0
        if k == 0:
            return 1
        return go(k - 1) + go(k - 2)   # 세로 1개 / 가로 2개
    return go(n) % MOD


def kadane(a: list[int]) -> tuple[int, int, int]:
    """(최대 합, 시작 인덱스, 끝 인덱스)."""
    best = cur = a[0]
    bs = be = cs = 0
    for i in range(1, len(a)):
        if cur + a[i] < a[i]:
            cur = a[i]
            cs = i
        else:
            cur = cur + a[i]
        if cur > best:
            best = cur
            bs, be = cs, i
    return best, bs, be


def max_subarray_brute(a: list[int]) -> int:
    n = len(a)
    best = a[0]
    for i in range(n):
        s = 0
        for j in range(i, n):
            s += a[j]
            if s > best:
                best = s
    return best


def main() -> None:
    print("[1] 타일링 — 배열 vs 롤링 (n=2,000,000, mod 10007)")
    n = 2_000_000
    tracemalloc.start()
    t0 = time.perf_counter()
    dp = tiling_array(n)
    t_arr = time.perf_counter() - t0
    _, peak_arr = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    ans_arr = dp[n]
    del dp

    tracemalloc.start()
    t0 = time.perf_counter()
    ans_roll = tiling_rolling(n)
    t_roll = time.perf_counter() - t0
    _, peak_roll = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert ans_arr == ans_roll
    print(f"    답 {ans_arr} (두 판 일치)")
    print(f"    배열판 {t_arr*1000:8.1f} ms  최대 메모리 {peak_arr/1024/1024:8.2f} MB")
    print(f"    롤링판 {t_roll*1000:8.1f} ms  최대 메모리 {peak_roll/1024:8.2f} KB")
    print(f"    메모리 비 {peak_arr / max(peak_roll, 1):,.0f}배")

    print("\n[2] 최대 부분합 — O(n^2) 완전탐색 vs 카데인")
    random.seed(77)
    for size in (1000, 5000, 20000):
        a = [random.randint(-1000, 1000) for _ in range(size)]
        t0 = time.perf_counter()
        b1 = max_subarray_brute(a)
        t_bf = time.perf_counter() - t0
        t0 = time.perf_counter()
        b2, s, e = kadane(a)
        t_kd = time.perf_counter() - t0
        assert b1 == b2, (b1, b2)
        print(f"    n={size:>6,}  답 {b1:>7,}  완전탐색 {t_bf*1000:9.1f} ms  카데인 {t_kd*1000:7.2f} ms"
              f"  ({t_bf/t_kd:,.0f}배)")

    print("\n[3] 본문 예제 — [10,-4,3,1,5,6,-35,12,21,-1]")
    ex = [10, -4, 3, 1, 5, 6, -35, 12, 21, -1]
    best, s, e = kadane(ex)
    print(f"    카데인 {best}  구간 a[{s}..{e}] = {ex[s:e+1]}")
    print(f"    완전탐색 {max_subarray_brute(ex)}")

    print("\n[4] 무작위 대조 (M7 §7)")
    bad = 0
    for _ in range(2000):
        k = random.randint(1, 12)
        a = [random.randint(-9, 9) for _ in range(k)]
        if kadane(a)[0] != max_subarray_brute(a):
            bad += 1
            print(f"    카데인 불일치! a={a}")
    print(f"    카데인 2000회 무작위 대조, 불일치 {bad}건")

    bad = 0
    for k in range(1, 25):
        if tiling_array(k)[k] != tiling_enumerate(k) or tiling_rolling(k) != tiling_enumerate(k):
            bad += 1
            print(f"    타일링 불일치! n={k}")
    print(f"    타일링 n=1..24 완전열거와 대조, 불일치 {bad}건")

    # 카데인의 구간이 실제로 그 합을 내는지 — 값만 맞고 구간이 틀리는 버그를 잡는다
    bad = 0
    for _ in range(2000):
        k = random.randint(1, 12)
        a = [random.randint(-9, 9) for _ in range(k)]
        best, s, e = kadane(a)
        if sum(a[s:e + 1]) != best:
            bad += 1
            print(f"    구간 불일치! a={a} best={best} s={s} e={e}")
    print(f"    카데인 구간 2000회 검증, 불일치 {bad}건")


if __name__ == "__main__":
    main()
