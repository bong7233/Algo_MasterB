#!/usr/bin/env python3
"""X-2 소수 — 시도 나눗셈 대 에라토스테네스의 체 실측 (CPython 3.13).

    python3.13 tools/bench/x2_sieve_vs_naive.py

N 이하의 모든 소수를 구할 때
  1. 수마다 sqrt(n) 까지 나눠 보는 시도 나눗셈과
  2. 에라토스테네스의 체
의 실행 시간을 비교한다. 두 결과가 같은 소수 목록을 내는지도 확인한다.
"""
from __future__ import annotations

import time


def naive_is_prime(n: int) -> bool:
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


def naive_primes_upto(n: int) -> list[int]:
    return [x for x in range(2, n + 1) if naive_is_prime(x)]


def sieve_primes_upto(n: int) -> list[int]:
    is_comp = bytearray(n + 1)
    primes = []
    for i in range(2, n + 1):
        if not is_comp[i]:
            primes.append(i)
            for j in range(i * i, n + 1, i):
                is_comp[j] = 1
    return primes


def median(xs: list[float]) -> float:
    xs = sorted(xs)
    return xs[len(xs) // 2]


def bench(n: int, runs: int = 3) -> None:
    naive_times, sieve_times = [], []
    p1 = p2 = []
    for _ in range(runs):
        t0 = time.perf_counter()
        p1 = naive_primes_upto(n)
        t1 = time.perf_counter()
        p2 = sieve_primes_upto(n)
        t2 = time.perf_counter()
        naive_times.append(t1 - t0)
        sieve_times.append(t2 - t1)
    assert p1 == p2
    print(f"N = {n:,}, 소수 개수 = {len(p1):,}")
    print(f"  시도 나눗셈   시간(중앙값) {median(naive_times) * 1000:9.1f} ms")
    print(f"  에라토스테네스 체 시간(중앙값) {median(sieve_times) * 1000:9.1f} ms")
    print(f"  배율: {median(naive_times) / median(sieve_times):,.1f}배")


def segmented_sieve_count(lo: int, hi: int) -> int:
    """구간 [lo, hi] 안의 소수 개수. sqrt(hi) 까지의 기본 소수만 메모리에 든다."""
    import math

    limit = int(math.isqrt(hi)) + 1
    base = sieve_primes_upto(limit)
    is_comp = bytearray(hi - lo + 1)
    for p in base:
        start = max(p * p, ((lo + p - 1) // p) * p)
        for j in range(start, hi + 1, p):
            is_comp[j - lo] = 1
    return sum(1 for i in range(hi - lo + 1) if not is_comp[i] and lo + i >= 2)


if __name__ == "__main__":
    bench(1_000_000)
    print()
    lo, hi = 10**9, 10**9 + 100_000
    t0 = time.perf_counter()
    cnt = segmented_sieve_count(lo, hi)
    t1 = time.perf_counter()
    print(f"세그먼트 체: 구간 [{lo:,}, {hi:,}] (폭 {hi - lo:,}) 안의 소수 {cnt}개, "
          f"{(t1 - t0) * 1000:.1f} ms — 이 구간 전체를 담는 배열 대신 폭만큼만 쓴다")
