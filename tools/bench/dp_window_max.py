#!/usr/bin/env python3
"""VIII-10 의 수치 — 창 최댓값을 다시 훑는 DP 대 단조 덱 DP (CPython 3.13).

    python3.13 tools/bench/dp_window_max.py

점화식은 본문과 같다.
    dp[0] = a[0]
    dp[i] = a[i] + max(dp[j])   for j in [i-k, i-1]

같은 답이 나오는지 먼저 확인하고, 그다음 시간을 잰다.
Python 은 O(nk) 쪽이 커지면 측정이 끝나지 않으므로 n 을 작게 잡는다 —
환산값은 적지 않는다. 자릿수는 잰 구간에서 이미 갈린다.
"""
from __future__ import annotations

import random
import statistics
import sys
import time
from collections import deque


def naive(a: list[int], k: int) -> int:
    n = len(a)
    dp = [0] * n
    dp[0] = a[0]
    for i in range(1, n):
        best = dp[i - 1]
        lo = i - k
        if lo < 0:
            lo = 0
        for j in range(lo, i):
            if dp[j] > best:
                best = dp[j]
        dp[i] = a[i] + best
    return dp[-1]


def fast(a: list[int], k: int) -> int:
    n = len(a)
    dp = [0] * n
    dp[0] = a[0]
    dq: deque[int] = deque()
    for i in range(1, n):
        while dq and dp[dq[-1]] <= dp[i - 1]:
            dq.pop()
        dq.append(i - 1)
        while dq[0] < i - k:
            dq.popleft()
        dp[i] = a[i] + dp[dq[0]]
    return dp[-1]


def timed(fn, a, k, reps=3):
    ts = []
    out = None
    for _ in range(reps):
        t0 = time.perf_counter()
        out = fn(a, k)
        ts.append(time.perf_counter() - t0)
    return out, statistics.median(ts)


def main() -> int:
    rnd = random.Random(11)

    # 1) 정확성 — 작은 입력 2,000개를 브루트포스와 대조
    for _ in range(2000):
        n = rnd.randint(2, 9)
        k = rnd.randint(1, 4)
        a = [rnd.randint(-9, 9) for _ in range(n)]
        if naive(a, k) != fast(a, k):
            print("불일치:", a, k)
            return 1
    print("정확성: 무작위 2,000건에서 naive == fast")

    print()
    print("      n |      k | naive(초) | fast(초) | 배수 | 답 일치")
    print("--------|--------|-----------|----------|------|--------")
    for n, k in ((20_000, 2_000), (50_000, 2_000), (100_000, 2_000)):
        a = [rnd.randint(-1000, 1000) for _ in range(n)]
        v1, t1 = timed(naive, a, k, reps=1)
        v2, t2 = timed(fast, a, k, reps=3)
        print(f"{n:7,} | {k:6,} | {t1:9.3f} | {t2:8.3f} | {t1 / t2:4.0f} | {v1 == v2}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
