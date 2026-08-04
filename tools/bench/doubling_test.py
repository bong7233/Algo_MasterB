#!/usr/bin/env python3
"""0-9 — 두 배 실험(doubling test): 코드를 읽지 않고 복잡도를 알아내는 절차.

n 을 두 배로 늘려 가며 시간을 재고 직전 대비 배수를 본다.
    배수 ≈ 2   -> O(n)
    배수 ≈ 2.1 -> O(n log n)   (log 항 때문에 2 보다 아주 조금 크다)
    배수 ≈ 4   -> O(n^2)
    배수 ≈ 8   -> O(n^3)
지수는 log2(배수) 로 바로 읽힌다.

측정 대상은 겉보기가 같은 두 루프다. 하나는 O(n), 하나는 O(n^2) 인데
줄 수가 같아 눈으로는 구분되지 않는다.

`doubling_test.cpp` 와 1:1 로 대응한다.

사용법:
    python3.13 tools/bench/doubling_test.py
"""
from __future__ import annotations

import math
import time

REPS = 3


def median(xs):
    return sorted(xs)[len(xs) // 2]


def build_append(n):
    """뒤에 붙인다. 재할당이 상환되어 한 번이 O(1)."""
    a = []
    for i in range(n):
        a.append(i)
    return len(a)


def build_insert_front(n):
    """앞에 붙인다. 뒤 원소를 통째로 밀어야 해서 한 번이 O(n)."""
    a = []
    for i in range(n):
        a.insert(0, i)
    return len(a)


def sort_build(n):
    a = [(i * 2654435761) % n for i in range(n)]
    a.sort()
    return a[0]


def run(name, fn, sizes):
    print(f"\n--- {name} ---")
    print(f"{'n':>9} {'T(n) 초':>10} {'T(n)/T(n/2)':>12} {'log2(배수)':>11}  판정")
    prev = None
    for n in sizes:
        ts = []
        for _ in range(REPS):
            t = time.perf_counter()
            fn(n)
            ts.append(time.perf_counter() - t)
        el = median(ts)
        if prev is None:
            print(f"{n:>9,} {el:>10.4f} {'—':>12} {'—':>11}  (기준)")
        else:
            r = el / prev
            k = math.log2(r) if r > 0 else float("nan")
            verdict = "O(n)" if k < 1.3 else ("O(n^2)" if k < 2.6 else "O(n^3) 이상")
            print(f"{n:>9,} {el:>10.4f} {r:>12.2f} {k:>11.2f}  {verdict}")
        prev = el


if __name__ == "__main__":
    print("=== 두 배 실험 (CPython 3.13) ===")
    run("append — 뒤에 붙이기", build_append, [50_000, 100_000, 200_000, 400_000])
    run("insert(0) — 앞에 붙이기", build_insert_front, [12_500, 25_000, 50_000, 100_000])
    run("sort — n log n", sort_build, [500_000, 1_000_000, 2_000_000, 4_000_000])
