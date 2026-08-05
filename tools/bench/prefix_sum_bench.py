#!/usr/bin/env python3
"""VI-4 본문 수치 — 구간 합 질의를 매번 더할 때와 누적 합을 쓸 때.

측정 환경은 CLAUDE.md §1-3 고정. 스크립트 안에서 3회 재어 중앙값을 내고,
본문 수치는 이 스크립트를 5회 실행한 중앙값이다.

사용법
    python3.13 tools/bench/prefix_sum_bench.py
"""

import random
import time

N = 100_000
Q = 100_000


def build_case():
    random.seed(1)
    a = [random.randint(0, 1000) for _ in range(N)]
    qs = []
    for _ in range(Q):
        l = random.randrange(N)
        r = random.randrange(l, N)
        qs.append((l, r))
    return a, qs


def naive(a, qs):
    total = 0
    for l, r in qs:
        s = 0
        for i in range(l, r + 1):
            s += a[i]
        total += s
    return total


def with_prefix(a, qs):
    S = [0] * (len(a) + 1)
    for i, v in enumerate(a):
        S[i + 1] = S[i] + v
    total = 0
    for l, r in qs:
        total += S[r + 1] - S[l]
    return total


def med(f, *args, reps=3):
    ts = []
    for _ in range(reps):
        t0 = time.perf_counter()
        val = f(*args)
        ts.append(time.perf_counter() - t0)
    return sorted(ts)[len(ts) // 2], val


def main():
    a, qs = build_case()

    # 순진한 쪽은 N·Q = 10^10 이라 끝나지 않는다. 질의 수를 줄여 재고
    # 환산값은 본문에 적지 않는다 — 환산은 실측이 아니다.
    small = qs[:200]
    t_naive, v_naive = med(naive, a, small)
    t_fast_small, v_fast_small = med(with_prefix, a, small)
    assert v_naive == v_fast_small

    t_fast, _ = med(with_prefix, a, qs)

    print(f"N = {N:,}, Q = {Q:,}")
    print(f"순진한 구간 합  (질의 {len(small)}개만): {t_naive:.3f}초")
    print(f"누적 합         (질의 {len(small)}개만): {t_fast_small:.6f}초")
    print(f"누적 합         (질의 {Q:,}개 전부): {t_fast:.3f}초")


if __name__ == "__main__":
    main()
