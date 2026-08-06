#!/usr/bin/env python3
"""X-2 소수 — 소인수분해: 체(SPF 배열) 대 단일 시도 나눗셈 실측 (CPython 3.13).

    python3.13 tools/bench/x2_spf_vs_trial.py

최소 소인수(smallest prime factor) 배열을 한 번 만들어 두면 질의 하나가
O(log n) 이고, 그때그때 sqrt(n) 까지 나눠 보면 질의 하나가 O(sqrt(n)) 이다.
전처리 비용과 질의 횟수의 트레이드오프를 실제로 잰다.
"""
from __future__ import annotations

import random
import time

N = 1_000_000
QUERIES = 20_000


def build_spf(n: int) -> list[int]:
    spf = list(range(n + 1))
    for i in range(2, int(n**0.5) + 1):
        if spf[i] == i:                      # i 가 아직 안 지워졌으면 소수다
            for j in range(i * i, n + 1, i):
                if spf[j] == j:               # 더 작은 소인수가 이미 안 찍혔을 때만
                    spf[j] = i
    return spf


def factorize_spf(n: int, spf: list[int]) -> list[int]:
    factors = []
    while n > 1:
        factors.append(spf[n])
        n //= spf[n]
    return factors


def factorize_trial(n: int) -> list[int]:
    factors = []
    d = 2
    while d * d <= n:
        while n % d == 0:
            factors.append(d)
            n //= d
        d += 1
    if n > 1:
        factors.append(n)
    return factors


if __name__ == "__main__":
    random.seed(0)
    queries = [random.randint(2, N) for _ in range(QUERIES)]

    t0 = time.perf_counter()
    spf = build_spf(N)
    t1 = time.perf_counter()
    by_spf = [factorize_spf(q, spf) for q in queries]
    t2 = time.perf_counter()
    by_trial = [factorize_trial(q) for q in queries]
    t3 = time.perf_counter()

    assert by_spf == by_trial
    print(f"N = {N:,}, 질의 {QUERIES:,}건")
    print(f"  SPF 전처리(1회)         {(t1 - t0) * 1000:8.1f} ms")
    print(f"  SPF 질의 {QUERIES:,}건        {(t2 - t1) * 1000:8.1f} ms  "
          f"(건당 {(t2 - t1) * 1e6 / QUERIES:6.2f} us)")
    print(f"  시도 나눗셈 {QUERIES:,}건      {(t3 - t2) * 1000:8.1f} ms  "
          f"(건당 {(t3 - t2) * 1e6 / QUERIES:6.2f} us)")
    breakeven = (t1 - t0) / ((t3 - t2) / QUERIES - (t2 - t1) / QUERIES)
    print(f"  손익분기 질의 수 ≈ {breakeven:,.0f}건 — 이보다 질의가 많으면 전처리가 이긴다")
