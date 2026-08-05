"""VII-1·VII-2 본문 수치 — 선형 탐색 / 직접 짠 이분 탐색 / bisect 의 질의 1회 비용.

측정 환경은 CLAUDE.md §1-3 (Ubuntu 24.04 x86-64 / CPython 3.13).
실행:  python3.13 tools/bench/binsearch_vs_linear.py

같은 배열·같은 질의열을 세 방법에 그대로 먹인다. 질의 수가 방법마다 다른 것은
선형 탐색이 같은 질의 수로는 끝나지 않기 때문이고, 그래서 결과는 총 시간이
아니라 **질의 1회당 시간**으로 환산해 적는다.
"""

import random
import time
from bisect import bisect_left

N = 100_000
Q_FAST = 100_000   # 이분 탐색 쪽 질의 수
Q_SLOW = 200       # 선형 탐색 쪽 질의 수 (같은 수로는 분 단위가 된다)


def lower_bound(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if a[mid] >= x:
            hi = mid
        else:
            lo = mid + 1
    return lo


def lower_bound_linear(a, x):
    for i, v in enumerate(a):
        if v >= x:
            return i
    return len(a)


def bench(fn, a, qs):
    t0 = time.perf_counter()
    s = 0
    for x in qs:
        s += fn(a, x)
    t1 = time.perf_counter()
    return (t1 - t0) / len(qs) * 1e6, s   # 질의 1회당 마이크로초


def main():
    random.seed(20260805)
    a = sorted(random.randint(0, 10 ** 9) for _ in range(N))
    qs_fast = [random.randint(0, 10 ** 9) for _ in range(Q_FAST)]
    qs_slow = qs_fast[:Q_SLOW]

    runs = []
    for label, fn, qs in (
        ("선형 탐색", lower_bound_linear, qs_slow),
        ("직접 짠 이분 탐색", lower_bound, qs_fast),
        ("bisect_left", bisect_left, qs_fast),
    ):
        best = min(bench(fn, a, qs)[0] for _ in range(3))   # 3회 중 최소
        runs.append((label, len(qs), best))

    print(f"N = {N:,}  (CPython {__import__('sys').version.split()[0]})")
    for label, q, us in runs:
        print(f"  {label:<20} 질의 {q:>7,}회   {us:9.3f} us/질의")


if __name__ == "__main__":
    main()
