#!/usr/bin/env python3
"""VIII-6 LIS — O(n^2) 판과 O(n log n) 판의 실측.

측정 환경은 CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / g++ 13 -O2).
같은 실험의 C++ 판은 lis_two_versions.cpp 다. 두 언어가 같은 수열을 보도록
난수기를 직접 굴린다.

    python3.13 tools/bench/lis_two_versions.py
"""
import time
from bisect import bisect_left


def gen(n, seed=20260805):
    x = seed
    out = []
    for _ in range(n):
        x = (x * 1103515245 + 12345) % (1 << 31)
        out.append(x % 1000000)
    return out


def lis_n2(a):
    n = len(a)
    dp = [1] * n
    for i in range(n):
        for j in range(i):
            if a[j] < a[i] and dp[j] + 1 > dp[i]:
                dp[i] = dp[j] + 1
    return max(dp)


def lis_nlogn(a):
    tails = []
    for x in a:
        k = bisect_left(tails, x)
        if k == len(tails):
            tails.append(x)
        else:
            tails[k] = x
    return len(tails)


def main():
    n = 5000
    a = gen(n)
    t0 = time.perf_counter()
    r1 = lis_n2(a)
    t1 = time.perf_counter()
    r2 = lis_nlogn(a)
    t2 = time.perf_counter()
    print(f"n={n:,}  O(n^2)     : {t1 - t0:.3f} s  (LIS {r1})")
    print(f"n={n:,}  O(n log n) : {(t2 - t1) * 1000:.1f} ms  (LIS {r2})")
    print(f"두 판의 답이 같은가: {r1 == r2}")

    big = 1000000
    a = gen(big)
    t0 = time.perf_counter()
    r = lis_nlogn(a)
    t1 = time.perf_counter()
    print(f"n={big:,}  O(n log n) : {t1 - t0:.2f} s  (LIS {r})")


if __name__ == "__main__":
    main()
