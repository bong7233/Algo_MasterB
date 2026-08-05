#!/usr/bin/env python3
"""VIII-1 의 수치와 정확성 검증.

무엇을 재는가
    1. 동전 거스름돈을 완전탐색으로 풀 때 호출 수가 금액에 따라 어떻게 느는가
    2. 같은 문제를 DP 로 풀 때 상태 수와 시간
    3. 그리디가 실제로 틀리는 비율 (동전 집합을 무작위로 뽑아 DP 와 대조)
    4. DP 의 답이 브루트포스와 일치하는가 (M7 부칙 §7)

측정 환경은 CLAUDE.md §1-3 고정. 실행:
    python3.13 tools/bench/viii1_coin_dp.py
"""

from __future__ import annotations

import random
import sys
import time

INF = float("inf")


def brute(amount: int, coins: tuple[int, ...], counter: list[int]) -> float:
    """완전탐색 — 메모 없음. 같은 부분문제를 몇 번이나 다시 푸는지 세려고 남긴다."""
    counter[0] += 1
    if amount == 0:
        return 0
    best = INF
    for c in coins:
        if c <= amount:
            r = brute(amount - c, coins, counter)
            if r + 1 < best:
                best = r + 1
    return best


def dp_min_coins(amount: int, coins: tuple[int, ...]) -> list[float]:
    dp = [INF] * (amount + 1)
    dp[0] = 0
    for x in range(1, amount + 1):
        for c in coins:
            if c <= x and dp[x - c] + 1 < dp[x]:
                dp[x] = dp[x - c] + 1
    return dp


def greedy(amount: int, coins: tuple[int, ...]) -> float:
    """큰 동전부터 최대한 — 가장 흔한 오답."""
    left, used = amount, 0
    for c in sorted(coins, reverse=True):
        used += left // c
        left %= c
    return used if left == 0 else INF


def main() -> None:
    sys.setrecursionlimit(300000)
    coins = (1, 3, 4)

    print("[1] 완전탐색의 호출 수 (동전 1,3,4)")
    for amount in (6, 10, 15, 20, 25, 30):
        counter = [0]
        t0 = time.perf_counter()
        val = brute(amount, coins, counter)
        el = time.perf_counter() - t0
        print(f"    금액 {amount:3d} → 답 {int(val)}  호출 {counter[0]:>12,}  {el*1000:9.2f} ms")

    print("\n[2] 같은 금액을 DP 로")
    for amount in (6, 30, 100000):
        t0 = time.perf_counter()
        dp = dp_min_coins(amount, coins)
        el = time.perf_counter() - t0
        print(f"    금액 {amount:6d} → 답 {int(dp[amount])}  상태 {amount+1:>7,}개  {el*1000:9.2f} ms")

    print("\n[3] 브루트포스 대조 (M7 §7) — 무작위 동전 집합 × 금액")
    random.seed(20260805)
    bad_dp = 0
    bad_greedy = 0
    trials = 0
    for _ in range(400):
        k = random.randint(2, 4)
        cs = tuple(sorted(random.sample(range(1, 12), k)))
        if 1 not in cs:
            cs = (1,) + cs
        amount = random.randint(1, 16)
        dp = dp_min_coins(amount, cs)
        counter = [0]
        bf = brute(amount, cs, counter)
        trials += 1
        if dp[amount] != bf:
            bad_dp += 1
            print(f"    불일치! coins={cs} amount={amount} dp={dp[amount]} bf={bf}")
        if greedy(amount, cs) != bf:
            bad_greedy += 1
    print(f"    {trials}회 중 DP-브루트포스 불일치 {bad_dp}회")
    print(f"    {trials}회 중 그리디가 최적이 아니었던 경우 {bad_greedy}회 "
          f"({bad_greedy / trials * 100:.1f}%)")

    print("\n[4] 본문 예제 확인 — coins=(1,3,4), amount=6")
    dp = dp_min_coins(6, coins)
    print("    dp[0..6] =", [int(x) for x in dp])
    print("    그리디 =", int(greedy(6, coins)), " DP =", int(dp[6]))


if __name__ == "__main__":
    main()
