#!/usr/bin/env python3
"""III-3 — 집합을 정수로 접었을 때 실제로 얼마나 싸지는가 (Python).

  A. 2^n 개 부분집합을 전부 훑으며 가중치 합을 구한다.
     bitmask(정수) 판과 frozenset 판의 시간을 비교한다.
  B. "부분집합의 부분집합" 열거가 정말 3^n 인지 세어 본다.
     순진한 판정(모든 (s, m) 쌍을 보고 s ⊆ m 인지 검사)은 4^n 이다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13).
사용법: python3.13 tools/bench/bitmask_cost.py [n]
"""

from __future__ import annotations

import sys
import time



def ops_by_bitmask(a, b, k, reps):
    """합집합·교집합·차집합·원소검사를 reps 회. 정수 판."""
    acc = 0
    for _ in range(reps):
        u = a | b
        i = a & b
        d = a & ~b
        has = (a >> k) & 1
        acc += u + i + d + has
    return acc


def ops_by_set(a, b, k, reps):
    """같은 연산의 집합 판. 결과를 소비해야 최적화로 사라지지 않는다."""
    acc = 0
    for _ in range(reps):
        u = a | b
        i = a & b
        d = a - b
        has = 1 if k in a else 0
        acc += len(u) + len(i) + len(d) + has
    return acc


def timeit(fn, *args, reps=3):
    ts, val = [], None
    for _ in range(reps):
        t0 = time.perf_counter()
        val = fn(*args)
        ts.append(time.perf_counter() - t0)
    return sorted(ts)[len(ts) // 2], val


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    reps = 1_000_000
    mask_a = int("".join("1" if (i * 7) % 3 else "0" for i in range(n)), 2)
    mask_b = int("".join("1" if (i * 5) % 4 else "0" for i in range(n)), 2)
    set_a = {i for i in range(n) if (mask_a >> i) & 1}
    set_b = {i for i in range(n) if (mask_b >> i) & 1}

    print(f"A. 집합 연산 {reps:,}회 (원소 {n}개 우주)")
    t1, _ = timeit(ops_by_bitmask, mask_a, mask_b, n // 2, reps)
    t2, _ = timeit(ops_by_set, set_a, set_b, n // 2, reps)
    print(f"   int  {t1:8.4f}초   set  {t2:8.4f}초   ({t2 / t1:.1f}배)")
    print(f"   메모리: int {sys.getsizeof(mask_a)}바이트 / set {sys.getsizeof(set_a)}바이트")

    m = 12
    print(f"\nB. 부분집합의 부분집합 (n = {m})")
    cnt = 0
    t0 = time.perf_counter()
    for mask in range(1 << m):
        s = mask
        while True:                # 관용구: s = (s - 1) & mask
            cnt += 1
            if s == 0:
                break
            s = (s - 1) & mask
    t_sub = time.perf_counter() - t0
    print(f"   s = (s-1) & mask 로 센 횟수 : {cnt:,}   3^n = {3 ** m:,}   {t_sub:.4f}초")

    cnt2 = 0
    t0 = time.perf_counter()
    for mask in range(1 << m):
        for s in range(1 << m):    # 순진한 판정: 모든 쌍을 보고 부분집합인지 검사
            if (s & mask) == s:
                cnt2 += 1
    t_pair = time.perf_counter() - t0
    print(f"   모든 쌍 검사로 센 횟수     : {cnt2:,}   4^n = {4 ** m:,} 쌍 중  {t_pair:.4f}초")
    print(f"   같은 답에 {t_pair / t_sub:.0f}배")


if __name__ == "__main__":
    main()
