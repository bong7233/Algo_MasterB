#!/usr/bin/env python3
"""X-1 정수론 — 순진한 GCD 대 유클리드 호제법 실측 (CPython 3.13).

    python3.13 tools/bench/x1_gcd_naive_vs_euclid.py

두 수 a, b 에 대해
  1. 순진한 방법(min(a,b) 부터 1까지 내려가며 공약수를 찾는다)과
  2. 유클리드 호제법(gcd(a,b) = gcd(b, a mod b))
의 실행 시간과 나눗셈 횟수를 함께 찍는다. gcd(a, b) = 1 인 쌍을 골라
순진한 방법이 최악(= min(a,b) 번 전부 확인)을 겪게 한다.
"""
from __future__ import annotations

import math
import time


def naive_gcd(a: int, b: int) -> tuple[int, int]:
    """1부터 min(a,b) 까지 전부 시도한다. 반환값은 (gcd, 나눗셈 횟수)."""
    steps = 0
    for d in range(min(a, b), 0, -1):
        steps += 1
        if a % d == 0 and b % d == 0:
            return d, steps
    return 1, steps


def euclid_gcd(a: int, b: int) -> tuple[int, int]:
    """gcd(a, b) = gcd(b, a mod b). 반환값은 (gcd, 나눗셈 횟수)."""
    steps = 0
    while b:
        a, b = b, a % b
        steps += 1
    return a, steps


def median(xs: list[float]) -> float:
    xs = sorted(xs)
    return xs[len(xs) // 2]


def bench(a: int, b: int, runs: int = 3) -> None:
    naive_times, euclid_times = [], []
    g1 = g2 = s1 = s2 = 0
    for _ in range(runs):
        t0 = time.perf_counter()
        g1, s1 = naive_gcd(a, b)
        t1 = time.perf_counter()
        g2, s2 = euclid_gcd(a, b)
        t2 = time.perf_counter()
        naive_times.append(t1 - t0)
        euclid_times.append(t2 - t1)
    assert g1 == g2 == math.gcd(a, b)
    print(f"a={a}, b={b}, gcd={g1}")
    print(f"  순진한 방법   나눗셈 {s1:>9}회   시간(중앙값) {median(naive_times) * 1000:9.3f} ms")
    print(f"  유클리드 호제법 나눗셈 {s2:>9}회   시간(중앙값) {median(euclid_times) * 1000:9.3f} ms")
    print(f"  배율: 나눗셈 {s1 / s2:,.0f}배, 시간 {median(naive_times) / median(euclid_times):,.0f}배")


if __name__ == "__main__":
    bench(10_000_019, 9_999_991)      # 둘 다 소수에 가까운 서로소 쌍 — 순진한 쪽의 최악
    print()
    # 연속된 두 피보나치 수 — 유클리드 호제법 자체의 최악(라메의 정리)
    fibs = [1, 1]
    while len(fibs) < 30:
        fibs.append(fibs[-1] + fibs[-2])
    a, b = fibs[29], fibs[28]
    _, s = euclid_gcd(a, b)
    print(f"피보나치 F(29)={a}, F(28)={b}: 유클리드 호제법 나눗셈 {s}회 (자릿수 {len(str(b))})")
