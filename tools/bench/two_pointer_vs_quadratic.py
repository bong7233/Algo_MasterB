#!/usr/bin/env python3
"""VI-3 본문 수치 — 투 포인터 O(n) 과 이중 루프 O(n^2) 의 실측 비교.

측정 환경은 CLAUDE.md §1-3 에 고정되어 있다.
    Ubuntu 24.04 LTS (x86-64) / CPython 3.13.12 / 4코어 15GB

같은 n 에서 두 알고리즘을 재는 것이 요점이다. n 을 다르게 잡고 비례식으로
환산한 값은 실측이 아니다. 이중 루프는 n = 5,000 에서도 Python 이 수 초를
쓰므로, 투 포인터가 n = 1,000,000 에서 얼마나 걸리는지를 따로 한 줄 더 잰다.

    python3.13 tools/bench/two_pointer_vs_quadratic.py
"""

from __future__ import annotations

import time

SEED = 12345


def make_array(n: int) -> list[int]:
    """자체 LCG. 양수만 만든다 — 투 포인터의 단조성 전제가 그것이다."""
    seed = SEED
    out = []
    for _ in range(n):
        seed = (seed * 1103515245 + 12345) % 2147483648
        out.append(1 + seed % 100)
    return out


def min_window(a: list[int], target: int) -> int:
    n = len(a)
    lo, total, best = 0, 0, n + 1
    for hi in range(n):
        total += a[hi]
        while total >= target:
            if hi - lo + 1 < best:
                best = hi - lo + 1
            total -= a[lo]
            lo += 1
    return 0 if best == n + 1 else best


def brute_min_window(a: list[int], target: int) -> int:
    n = len(a)
    best = n + 1
    for lo in range(n):
        total = 0
        for hi in range(lo, n):
            total += a[hi]
            if total >= target and hi - lo + 1 < best:
                best = hi - lo + 1
    return 0 if best == n + 1 else best


def bench(fn, a: list[int], target: int, reps: int) -> tuple[int, float]:
    times = []
    ans = 0
    for _ in range(reps):
        t0 = time.perf_counter()
        ans = fn(a, target)
        times.append(time.perf_counter() - t0)
    times.sort()
    return ans, times[len(times) // 2]  # 중앙값


def main() -> None:
    n = 5000
    a = make_array(n)
    target = 20000

    ans1, t1 = bench(min_window, a, target, 3)
    ans2, t2 = bench(brute_min_window, a, target, 3)
    print(f"n = {n}, target = {target}")
    print(f"  two-pointer O(n)    : answer = {ans1}, {t1:.6f} s")
    print(f"  double loop O(n^2)  : answer = {ans2}, {t2:.6f} s")
    assert ans1 == ans2, "두 알고리즘의 답이 다르다"
    print(f"  ratio               : {t2 / t1:.1f} x")

    big = 1_000_000
    b = make_array(big)
    ans3, t3 = bench(min_window, b, 4_000_000, 3)
    print(f"n = {big}")
    print(f"  two-pointer O(n)    : answer = {ans3}, {t3:.6f} s")


if __name__ == "__main__":
    main()
