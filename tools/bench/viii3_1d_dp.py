#!/usr/bin/env python3
"""VIII-3 의 수치와 정확성 검증 — 1차원 DP.

무엇을 재는가
    1. 최대 부분합: O(n^2) 완전탐색과 카데인의 시간, 그리고 답의 일치
    2. 타일링/계단: 배열판과 롤링(변수 두 개)판의 시간·메모리
    3. 잘못된 상태 정의("i 까지의 최대 부분합")가 실제로 얼마나 틀리는가
    4. 무작위 대조 (M7 부칙 §7) — 카데인 vs 완전탐색, 타일링 DP vs 완전열거

시간과 메모리를 **따로** 잰다. tracemalloc 은 모든 할당을 추적하므로 켜 둔 채
시간을 재면 열 배 넘게 부풀어 본문에 못 쓸 값이 나온다. 시간은 tracemalloc 없이
3회 이상 재고 중앙값을, 메모리는 별도 패스에서 최대 추적량을 쓴다.

측정 환경은 CLAUDE.md §1-3 고정. 실행:
    python3.13 tools/bench/viii3_1d_dp.py
"""

from __future__ import annotations

import random
import statistics
import time
import tracemalloc

MOD = 10007
REPEAT = 5          # 중앙값을 쓰므로 홀수


def timed(fn, *args, repeat: int = REPEAT):
    """fn 을 repeat 번 돌려 (결과, 중앙값 초)를 준다."""
    out = None
    ts = []
    for _ in range(repeat):
        t0 = time.perf_counter()
        out = fn(*args)
        ts.append(time.perf_counter() - t0)
    return out, statistics.median(ts)


def peak_mb(fn, *args) -> float:
    tracemalloc.start()
    fn(*args)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return peak / 1024 / 1024


# --------------------------------------------------------------- 계단·타일링

def tiling_array(n: int) -> int:
    dp = [0] * (n + 1)
    dp[0] = 1
    dp[1] = 1
    for i in range(2, n + 1):
        dp[i] = (dp[i - 1] + dp[i - 2]) % MOD
    return dp[n]


def tiling_rolling(n: int) -> int:
    prev2, prev1 = 1, 1     # dp[0], dp[1]
    for _ in range(2, n + 1):
        prev2, prev1 = prev1, (prev1 + prev2) % MOD
    return prev1


def tiling_enumerate(n: int) -> int:
    """2×n 을 타일로 실제로 채워 보며 하나씩 센다. n 이 작을 때만."""
    def go(k: int) -> int:
        if k < 0:
            return 0
        if k == 0:
            return 1
        return go(k - 1) + go(k - 2)   # 세로 1개 / 가로 2개
    return go(n) % MOD


def tiling_naive(n: int, calls: list[int]) -> int:
    """메모 없는 재귀. 호출 수가 곧 중복 부분문제의 양이다."""
    calls[0] += 1
    if n <= 1:
        return 1
    return tiling_naive(n - 1, calls) + tiling_naive(n - 2, calls)


# ------------------------------------------------------------- 최대 부분합

def kadane(a: list[int]) -> tuple[int, int, int]:
    """(최대 합, 시작 인덱스, 끝 인덱스). 상태는 'i 로 끝나는 최대 부분합'."""
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


def kadane_value(a: list[int]) -> int:
    return kadane(a)[0]


def wrong_prefix_state(a: list[int]) -> int:
    """상태를 'i 까지의 최대 부분합'으로 잡았을 때 나오는 값.

    dp[i] = max(dp[i-1], dp[i-1] + a[i], a[i]) 는 그럴듯해 보이지만
    dp[i-1] 이 i-1 에서 끝난 구간인지 알 수 없으므로 존재하지 않는 구간을 만든다.
    """
    dp = a[0]
    for i in range(1, len(a)):
        dp = max(dp, dp + a[i], a[i])
    return dp


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
    random.seed(77)

    print("[1] 최대 부분합 — O(n^2) 완전탐색 vs 카데인 (중앙값)")
    for size in (1000, 5000, 20000):
        a = [random.randint(-1000, 1000) for _ in range(size)]
        b1, t_bf = timed(max_subarray_brute, a, repeat=3)
        b2, t_kd = timed(kadane_value, a)
        assert b1 == b2, (b1, b2)
        print(f"    n={size:>6,}  답 {b1:>7,}  완전탐색 {t_bf*1000:9.1f} ms"
              f"  카데인 {t_kd*1000:7.2f} ms  ({t_bf/t_kd:,.0f}배)")

    print("\n[2] 타일링 — 배열판 vs 롤링판 (n=2,000,000, mod %d)" % MOD)
    n = 2_000_000
    ans_arr, t_arr = timed(tiling_array, n, repeat=3)
    ans_roll, t_roll = timed(tiling_rolling, n, repeat=3)
    assert ans_arr == ans_roll
    m_arr = peak_mb(tiling_array, n)
    m_roll = peak_mb(tiling_rolling, n)
    print(f"    답 {ans_arr} (두 판 일치)")
    print(f"    배열판 {t_arr*1000:8.1f} ms  최대 추적 메모리 {m_arr*1024:10.1f} KB")
    print(f"    롤링판 {t_roll*1000:8.1f} ms  최대 추적 메모리 {m_roll*1024:10.1f} KB")
    print(f"    메모리 비 {m_arr / max(m_roll, 1e-9):,.0f}배")

    print("\n[3] 메모 없는 재귀 — 같은 부분문제를 몇 번이나 다시 푸는가")
    for k in (10, 20, 30, 35):
        calls = [0]
        t0 = time.perf_counter()
        v = tiling_naive(k, calls)
        el = time.perf_counter() - t0
        print(f"    n={k:>3}  답 {v:>10,}  호출 {calls[0]:>12,}회  {el*1000:9.1f} ms")

    print("\n[4] 잘못된 상태 — 'i 까지의 최대 부분합'")
    ex = [3, -2, 4, -7, 5, 2, -1, 3]
    kb, ks, ke = kadane(ex)
    print(f"    a = {ex}")
    print(f"    카데인(i 로 끝나는) = {kb}  구간 a[{ks}..{ke}] = {ex[ks:ke+1]}")
    print(f"    완전탐색            = {max_subarray_brute(ex)}")
    print(f"    잘못된 상태(i 까지) = {wrong_prefix_state(ex)}  ← 존재하지 않는 구간의 합")

    bad = 0
    trials = 3000
    for _ in range(trials):
        k = random.randint(1, 10)
        a = [random.randint(-9, 9) for _ in range(k)]
        if wrong_prefix_state(a) != max_subarray_brute(a):
            bad += 1
    print(f"    무작위 {trials}회 중 잘못된 상태가 틀린 횟수: {bad}회 ({bad/trials*100:.1f}%)")

    print("\n[5] 무작위 대조 (M7 부칙 §7)")
    bad = 0
    for _ in range(3000):
        k = random.randint(1, 12)
        a = [random.randint(-9, 9) for _ in range(k)]
        if kadane(a)[0] != max_subarray_brute(a):
            bad += 1
            print(f"    카데인 불일치! a={a}")
    print(f"    카데인 값   3000회 무작위 대조, 불일치 {bad}건")

    bad = 0
    for _ in range(3000):
        k = random.randint(1, 12)
        a = [random.randint(-9, 9) for _ in range(k)]
        best, s, e = kadane(a)
        if sum(a[s:e + 1]) != best:
            bad += 1
            print(f"    구간 불일치! a={a} best={best} s={s} e={e}")
    print(f"    카데인 구간 3000회 검증(합이 실제로 그 구간에서 나오는가), 불일치 {bad}건")

    bad = 0
    for k in range(1, 25):
        if tiling_array(k) != tiling_enumerate(k) or tiling_rolling(k) != tiling_enumerate(k):
            bad += 1
            print(f"    타일링 불일치! n={k}")
    print(f"    타일링 n=1..24 완전열거와 대조, 불일치 {bad}건")


if __name__ == "__main__":
    main()
