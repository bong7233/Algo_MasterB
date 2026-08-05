#!/usr/bin/env python3.13
"""구간 DP(행렬 곱셈 순서)의 실제 비용과 채우는 순서의 효과 (VIII-7).

측정 환경은 CLAUDE.md §1-3 고정: Ubuntu 24.04 / CPython 3.13.12.

세 가지를 잰다.
    1. 완전탐색(모든 괄호 배치)의 호출 수와 시간 — 카탈란 수로 부푸는 것을 확인한다.
    2. 구간 DP 의 시간을 n 을 키워 가며 잰다. O(n^3) 이 실제로 세제곱으로 자라는지,
       그리고 파이썬에서 n 이 얼마부터 1 초를 넘는지가 이 항목의 목적이다.
    3. 행 우선으로 채웠을 때 나오는 값 — 아직 안 채운 칸을 0 으로 읽으면
       답이 조용히 작아진다. 그것이 예외가 아니라 오답으로 나온다는 것을 보인다.

실행:
    python3.13 tools/bench/viii7_interval_dp.py
"""

from __future__ import annotations

import math
import random
import time

INF = float("inf")


def chain_dp(d: list[int]) -> tuple[int, list[list[int]]]:
    """dp[i][j] = 구간 [i, j] 를 하나로 곱치는 최소 스칼라 곱 횟수. 길이 순으로 채운다."""
    n = len(d) - 1
    dp = [[0] * (n + 2) for _ in range(n + 2)]
    sp = [[0] * (n + 2) for _ in range(n + 2)]
    for L in range(2, n + 1):
        for i in range(1, n - L + 2):
            j = i + L - 1
            best, bk = INF, i
            for k in range(i, j):
                t = dp[i][k] + dp[k + 1][j] + d[i - 1] * d[k] * d[j]
                if t < best:
                    best, bk = t, k
            dp[i][j] = best
            sp[i][j] = bk
    return dp[1][n], sp


def chain_row_major(d: list[int]) -> int:
    """행 우선으로 채운다 — 아직 안 채운 칸을 0 으로 읽는다."""
    n = len(d) - 1
    dp = [[0] * (n + 2) for _ in range(n + 2)]
    for i in range(1, n + 1):
        for j in range(i + 1, n + 1):
            best = INF
            for k in range(i, j):
                t = dp[i][k] + dp[k + 1][j] + d[i - 1] * d[k] * d[j]
                if t < best:
                    best = t
            dp[i][j] = best
    return dp[1][n]


def chain_brute(d: list[int]) -> tuple[int, int]:
    """모든 괄호 배치를 다 만들어 본다. 호출 수를 함께 센다."""
    calls = [0]

    def go(i: int, j: int) -> int:
        calls[0] += 1
        if i == j:
            return 0
        best = INF
        for k in range(i, j):
            t = go(i, k) + go(k + 1, j) + d[i - 1] * d[k] * d[j]
            if t < best:
                best = t
        return best

    return go(1, len(d) - 1), calls[0]


def greedy_cheapest(d: list[int]) -> int:
    """가장 싼 인접 쌍부터 합친다 — 구간 DP 자리에서 가장 먼저 떠오르는 그리디."""
    d = list(d)
    tot = 0
    while len(d) > 2:
        best, bi = None, 1
        for i in range(1, len(d) - 1):
            c = d[i - 1] * d[i] * d[i + 1]
            if best is None or c < best:
                best, bi = c, i
        tot += best
        d.pop(bi)
    return tot


def catalan(m: int) -> int:
    return math.comb(2 * m, m) // (m + 1)


def median(xs: list[float]) -> float:
    xs = sorted(xs)
    return xs[len(xs) // 2]


def timed(fn, *args, reps: int = 3) -> float:
    ts = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn(*args)
        ts.append(time.perf_counter() - t0)
    return median(ts)


def main() -> None:
    print("[1] 완전탐색 — 괄호 배치의 수와 호출 수")
    for n in (4, 8, 10, 12, 13):
        d = [3] * (n + 1)
        _, calls = chain_brute(d)
        print("    n=%2d  괄호 배치 %9d 가지  호출 %9d회" % (n, catalan(n - 1), calls))

    print("[2] 구간 DP — n 을 키우며 시간 (중앙값 3회)")
    rng = random.Random(20250805)
    for n in (50, 100, 200, 300, 500):
        d = [rng.randint(1, 100) for _ in range(n + 1)]
        t = timed(chain_dp, d)
        cells = n * (n - 1) // 2
        ops = sum(j - i for i in range(1, n + 1) for j in range(i + 1, n + 1))
        print("    n=%3d  구간 %7d개  분할점 시도 %10d회  %.4f s" % (n, cells, ops, t))

    print("[3] 행 우선으로 채우면 무엇이 나오는가")
    d = [10, 100, 5, 50, 20]
    ok, _ = chain_dp(d)
    bad = chain_row_major(d)
    print("    dims=%s  길이 순 %d  행 우선 %d" % (d, ok, bad))

    print("[4] 그리디(가장 싼 인접 쌍부터)가 최적을 놓치는 비율")
    r3 = random.Random(20250805)
    lost = 0
    for _ in range(400):
        n = r3.randint(3, 7)
        dd = [r3.randint(1, 50) for _ in range(n + 1)]
        if greedy_cheapest(dd) > chain_dp(dd)[0]:
            lost += 1
    print("    400회 중 %d회(%.1f%%) 에서 그리디가 진다" % (lost, lost * 100 / 400))
    d2 = [10, 100, 5, 50, 20]
    print("    dims=%s  그리디 %d  최적 %d" % (d2, greedy_cheapest(d2), chain_dp(d2)[0]))

    print("[5] 무작위 대조 — 길이 순 DP vs 완전탐색 (n=2..8, 300회)")
    bad_cnt = 0
    for t in range(300):
        n = rng.randint(2, 8)
        d = [rng.randint(1, 30) for _ in range(n + 1)]
        a, _ = chain_dp(d)
        b, _ = chain_brute(d)
        if a != b:
            bad_cnt += 1
            print("    불일치! dims=%s dp=%s brute=%s" % (d, a, b))
    print("    불일치 %d건 / 300건" % bad_cnt)

    print("[6] 무작위 대조 — 행 우선 DP vs 완전탐색 (300회)")
    rng2 = random.Random(20250805 + 1)
    wrong = 0
    for t in range(300):
        n = rng2.randint(3, 8)
        d = [rng2.randint(1, 30) for _ in range(n + 1)]
        if chain_row_major(d) != chain_brute(d)[0]:
            wrong += 1
    print("    행 우선이 틀린 횟수 %d / 300" % wrong)


if __name__ == "__main__":
    main()
