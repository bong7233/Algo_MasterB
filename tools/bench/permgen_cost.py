#!/usr/bin/env python3
"""III-2 — 순열을 만드는 세 가지 방법의 실제 비용 (Python).

  lib  : itertools.permutations — C 로 구현된 표준 라이브러리
  rec  : 직접 짠 재귀 (used 배열 + 부분해 리스트)
  swap : 자리 교환으로 만드는 재귀 (복사 없음)

같은 n! 개를 만들고 각 순열의 첫 원소를 더한다. 소비하지 않으면 게으른 생성기가
아무 일도 하지 않아 측정이 0이 된다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13).
사용법: python3.13 tools/bench/permgen_cost.py [n]
"""

from __future__ import annotations

import itertools
import math
import sys
import time


def by_lib(a):
    s = 0
    for p in itertools.permutations(a):
        s += p[0]
    return s


def by_rec(a):
    n = len(a)
    used = [False] * n
    cur = []
    total = 0

    def go():
        nonlocal total
        if len(cur) == n:
            total += cur[0]
            return
        for i in range(n):
            if used[i]:
                continue
            used[i] = True
            cur.append(a[i])
            go()
            cur.pop()
            used[i] = False

    go()
    return total


def by_swap(a):
    a = list(a)
    n = len(a)
    total = 0

    def go(k):
        nonlocal total
        if k == n:
            total += a[0]
            return
        for i in range(k, n):
            a[k], a[i] = a[i], a[k]
            go(k + 1)
            a[k], a[i] = a[i], a[k]

    go(0)
    return total


def timeit(fn, a, reps=3):
    ts, val = [], None
    for _ in range(reps):
        t0 = time.perf_counter()
        val = fn(a)
        ts.append(time.perf_counter() - t0)
    return sorted(ts)[len(ts) // 2], val


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 9
    a = list(range(1, n + 1))
    print(f"n = {n}, n! = {math.factorial(n):,}")
    for name, fn in (("lib", by_lib), ("rec", by_rec), ("swap", by_swap)):
        dt, val = timeit(fn, a)
        print(f"{name:<5} {dt:8.4f}초   체크섬 {val}")

    print("\nn 하나 늘 때 걸리는 시간 (itertools 기준)")
    for k in range(8, 12):
        dt, _ = timeit(by_lib, list(range(1, k + 1)), reps=1)
        print(f"  n = {k:2d}  n! = {math.factorial(k):>12,}  {dt:8.4f}초")


if __name__ == "__main__":
    main()
