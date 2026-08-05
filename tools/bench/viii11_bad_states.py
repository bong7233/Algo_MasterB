#!/usr/bin/env python3
"""VIII-11 의 반례 검산 — "부족한 상태"가 실제로 틀린 답을 내는지 확인한다 (CPython 3.13).

    python3.13 tools/bench/viii11_bad_states.py

반례는 주장이 아니라 계산이다. 이 스크립트는 다섯 사례 각각에 대해
  (1) 본문에 실린 반례에서 잘못된 상태가 내는 값과 완전탐색의 값을 나란히 찍고
  (2) 무작위 입력 수백 건에서 완전탐색과 대조해 "올바른 상태"가 항상 맞는지,
      "부족한 상태"가 실제로 어긋나는 비율이 얼마인지 센다.
"""
from __future__ import annotations

import random
import sys
from itertools import permutations, product

INF = float("inf")


# ─────────────────────────────────────────────────────────────────────
# 사례 1. 계단 오르기 — 연속으로 몇 개째인지를 상태에 안 넣는다
# ─────────────────────────────────────────────────────────────────────
def stairs_brute(a: list[int]) -> int:
    """마지막 계단 필수, 한 번에 1~2칸, 연속 3칸 금지. 전수 조사."""
    n = len(a)
    best = -INF
    for take in product((0, 1), repeat=n):
        if not take[n - 1]:
            continue
        ok = True
        run = 0
        gap = 0
        for t in take:
            if t:
                run += 1
                gap = 0
                if run == 3:
                    ok = False
                    break
            else:
                run = 0
                gap += 1
                if gap == 2:      # 두 칸 넘게 건너뛸 수 없다
                    ok = False
                    break
        if ok and take[0] == 0 and not take[1]:
            ok = False            # 첫 두 칸을 모두 건너뛰면 출발할 수 없다
        if ok:
            best = max(best, sum(v for v, t in zip(a, take) if t))
    return best


def stairs_bad(a: list[int]) -> int:
    """dp[i] = i 번 계단까지의 최대 점수. 연속 개수를 기억하지 않는다."""
    n = len(a)
    dp = [0] * n
    dp[0] = a[0]
    if n > 1:
        dp[1] = a[1] + dp[0]
    for i in range(2, n):
        dp[i] = a[i] + max(dp[i - 1], dp[i - 2])
    return dp[n - 1]


def stairs_good(a: list[int]) -> int:
    """dp[i][r] = i 번을 밟고, 그것이 연속 r 번째일 때의 최대 점수."""
    n = len(a)
    dp = [[-INF, -INF, -INF] for _ in range(n)]
    dp[0][1] = a[0]
    if n > 1:
        dp[1][1] = a[1]                       # 0 번을 건너뛰고 1 번을 밟는다
        dp[1][2] = a[1] + dp[0][1]
    for i in range(2, n):
        dp[i][1] = a[i] + max(dp[i - 2][1], dp[i - 2][2])
        dp[i][2] = a[i] + dp[i - 1][1]
    return max(dp[n - 1][1], dp[n - 1][2])


# ─────────────────────────────────────────────────────────────────────
# 사례 2. 최대 부분합 — "i 까지" 와 "i 로 끝나는" 을 섞는다
# ─────────────────────────────────────────────────────────────────────
def maxsub_brute(a: list[int]) -> int:
    n = len(a)
    return max(sum(a[i:j]) for i in range(n) for j in range(i + 1, n + 1))


def maxsub_bad(a: list[int]) -> int:
    """dp[i] = 앞 i+1 개 안에서의 최대 부분합 — 이라고 두고 이어 붙인다."""
    dp = [0] * len(a)
    dp[0] = a[0]
    for i in range(1, len(a)):
        dp[i] = max(dp[i - 1], dp[i - 1] + a[i])
    return dp[-1]


def maxsub_good(a: list[int]) -> int:
    """dp[i] = i 로 끝나는 부분합의 최댓값. 답은 dp 전체의 최댓값이다."""
    dp = [0] * len(a)
    dp[0] = a[0]
    for i in range(1, len(a)):
        dp[i] = max(a[i], dp[i - 1] + a[i])
    return max(dp)


# ─────────────────────────────────────────────────────────────────────
# 사례 3. 0/1 배낭 — 물건 축을 지우고 용량만 남긴다
# ─────────────────────────────────────────────────────────────────────
def knap_brute(items: list[tuple[int, int]], cap: int) -> int:
    best = 0
    for take in product((0, 1), repeat=len(items)):
        w = sum(it[0] for it, t in zip(items, take) if t)
        if w <= cap:
            best = max(best, sum(it[1] for it, t in zip(items, take) if t))
    return best


def knap_bad(items: list[tuple[int, int]], cap: int) -> int:
    """한 줄 배낭을 용량 오름차순으로 돈다 — 같은 물건이 다시 들어온다."""
    dp = [0] * (cap + 1)
    for w, v in items:
        for c in range(w, cap + 1):           # 오름차순: dp[c-w] 는 이미 이번 물건을 썼다
            dp[c] = max(dp[c], dp[c - w] + v)
    return dp[cap]


def knap_good(items: list[tuple[int, int]], cap: int) -> int:
    dp = [0] * (cap + 1)
    for w, v in items:
        for c in range(cap, w - 1, -1):       # 내림차순: dp[c-w] 는 아직 윗 행이다
            dp[c] = max(dp[c], dp[c - w] + v)
    return dp[cap]


# ─────────────────────────────────────────────────────────────────────
# 사례 4. 동전 — 조합을 세려 했는데 순열이 세어진다
# ─────────────────────────────────────────────────────────────────────
def coin_perm(coins: list[int], target: int) -> int:
    """금액이 바깥, 동전이 안쪽 — 순서가 다른 것을 다른 것으로 센다."""
    dp = [0] * (target + 1)
    dp[0] = 1
    for x in range(1, target + 1):
        for c in coins:
            if c <= x:
                dp[x] += dp[x - c]
    return dp[target]


def coin_comb(coins: list[int], target: int) -> int:
    """동전이 바깥, 금액이 안쪽 — 동전 종류에 순서를 강제해 조합만 센다."""
    dp = [0] * (target + 1)
    dp[0] = 1
    for c in coins:
        for x in range(c, target + 1):
            dp[x] += dp[x - c]
    return dp[target]


def coin_comb_brute(coins: list[int], target: int) -> int:
    """개수 벡터를 전부 만들어 세는 조합 완전탐색."""
    def rec(i: int, left: int) -> int:
        if left == 0:
            return 1
        if i == len(coins):
            return 0
        total = 0
        used = 0
        while used * coins[i] <= left:
            total += rec(i + 1, left - used * coins[i])
            used += 1
        return total

    return rec(0, target)


# ─────────────────────────────────────────────────────────────────────
# 사례 5. 외판원 순회 — 현재 위치를 상태에서 뺀다
# ─────────────────────────────────────────────────────────────────────
def tsp_brute(cost: list[list[int]]) -> int:
    n = len(cost)
    best = INF
    for p in permutations(range(1, n)):
        prev, s = 0, 0
        for x in p:
            s += cost[prev][x]
            prev = x
        best = min(best, s + cost[prev][0])
    return best


def tsp_bad(cost: list[list[int]]) -> int:
    """dp[mask] = 최소 비용, at[mask] = 그 최소를 낸 현재 위치.

    현재 위치를 상태의 일부가 아니라 "최솟값에 딸린 부가 정보"로 들고 다닌다.
    전이가 쓰는 cost[at[mask]][j] 는 그 마스크의 최적해 하나만 대표한다.
    """
    n = len(cost)
    full = (1 << n) - 1
    dp = [INF] * (1 << n)
    at = [0] * (1 << n)
    dp[1] = 0
    for mask in range(1 << n):
        if dp[mask] == INF:
            continue
        i = at[mask]
        for j in range(n):
            if mask >> j & 1:
                continue
            nm = mask | (1 << j)
            v = dp[mask] + cost[i][j]
            if v < dp[nm]:
                dp[nm] = v
                at[nm] = j
    return dp[full] + cost[at[full]][0]


def tsp_good(cost: list[list[int]]) -> int:
    n = len(cost)
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1 << n):
        for i in range(n):
            if dp[mask][i] == INF:
                continue
            for j in range(n):
                if mask >> j & 1:
                    continue
                nm = mask | (1 << j)
                v = dp[mask][i] + cost[i][j]
                if v < dp[nm][j]:
                    dp[nm][j] = v
    return min(dp[full][i] + cost[i][0] for i in range(1, n))


def find_tsp_counterexample(trials: int = 20000) -> list[list[int]] | None:
    """mask 만 상태로 쓰는 판이 실제로 지는 4 도시 비용 행렬을 찾는다."""
    rnd = random.Random(5)
    for _ in range(trials):
        n = 4
        cost = [[0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i != j:
                    cost[i][j] = rnd.randint(1, 9)
        if tsp_bad(cost) != tsp_brute(cost):
            return cost
    return None


# ─────────────────────────────────────────────────────────────────────
def main() -> int:
    rnd = random.Random(20240815)
    print("=== 본문 반례 ===")

    a = [10, 20, 15, 25]
    print(f"[1] 계단 {a}")
    print(f"    부족한 상태 dp[i]           = {stairs_bad(a)}")
    print(f"    상태에 연속 횟수 추가       = {stairs_good(a)}")
    print(f"    완전탐색                    = {stairs_brute(a)}")

    a = [2, -3, 4]
    print(f"[2] 최대 부분합 {a}")
    print(f"    'i 까지' 로 잡은 상태       = {maxsub_bad(a)}")
    print(f"    'i 로 끝나는' 으로 잡은 상태 = {maxsub_good(a)}")
    print(f"    완전탐색                    = {maxsub_brute(a)}")

    items, cap = [(2, 3)], 6
    print(f"[3] 0/1 배낭 items={items} cap={cap}")
    print(f"    용량 오름차순(물건 축 소실) = {knap_bad(items, cap)}")
    print(f"    용량 내림차순              = {knap_good(items, cap)}")
    print(f"    완전탐색                    = {knap_brute(items, cap)}")

    coins, target = [1, 2], 3
    print(f"[4] 동전 {coins} 로 {target} 원 만드는 경우의 수")
    print(f"    금액 바깥 / 동전 안쪽       = {coin_perm(coins, target)}  (순열을 센다)")
    print(f"    동전 바깥 / 금액 안쪽       = {coin_comb(coins, target)}  (조합을 센다)")
    print(f"    조합 완전탐색               = {coin_comb_brute(coins, target)}")

    cost = find_tsp_counterexample()
    print("[5] 외판원 순회 — 현재 위치를 뺀 상태")
    if cost is None:
        print("    반례를 못 찾았다")
    else:
        for row in cost:
            print("        ", row)
        print(f"    dp[mask] 만 (현재 위치는 부가 정보) = {tsp_bad(cost)}")
        print(f"    dp[mask][last]                     = {tsp_good(cost)}")
        print(f"    완전탐색                            = {tsp_brute(cost)}")

    print()
    print("=== 무작위 대조 (완전탐색 기준) ===")

    bad = good = 0
    for _ in range(500):
        n = rnd.randint(2, 10)
        a = [rnd.randint(-20, 30) for _ in range(n)]
        b = stairs_brute(a)
        bad += stairs_bad(a) != b
        good += stairs_good(a) == b
    print(f"[1] 계단 500건: 부족한 상태가 틀린 횟수 {bad}, 올바른 상태가 맞은 횟수 {good}")

    bad = good = 0
    for _ in range(500):
        n = rnd.randint(2, 8)
        a = [rnd.randint(-9, 9) for _ in range(n)]
        b = maxsub_brute(a)
        bad += maxsub_bad(a) != b
        good += maxsub_good(a) == b
    print(f"[2] 최대 부분합 500건: 틀린 횟수 {bad}, 올바른 상태가 맞은 횟수 {good}")

    bad = good = 0
    for _ in range(500):
        m = rnd.randint(1, 5)
        items = [(rnd.randint(1, 6), rnd.randint(1, 20)) for _ in range(m)]
        cap = rnd.randint(1, 15)
        b = knap_brute(items, cap)
        bad += knap_bad(items, cap) != b
        good += knap_good(items, cap) == b
    print(f"[3] 0/1 배낭 500건: 틀린 횟수 {bad}, 올바른 상태가 맞은 횟수 {good}")

    bad = good = 0
    for _ in range(500):
        k = rnd.randint(1, 4)
        coins = sorted(set(rnd.randint(1, 7) for _ in range(k)))
        target = rnd.randint(1, 14)
        b = coin_comb_brute(coins, target)
        bad += coin_perm(coins, target) != b
        good += coin_comb(coins, target) == b
    print(f"[4] 동전 500건: 순열 판이 틀린 횟수 {bad}, 조합 판이 맞은 횟수 {good}")

    bad = good = 0
    for _ in range(500):
        n = rnd.randint(3, 6)
        c = [[0 if i == j else rnd.randint(1, 30) for j in range(n)] for i in range(n)]
        b = tsp_brute(c)
        bad += tsp_bad(c) != b
        good += tsp_good(c) == b
    print(f"[5] 외판원 순회 500건: 위치를 뺀 판이 틀린 횟수 {bad}, 온전한 상태가 맞은 횟수 {good}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
