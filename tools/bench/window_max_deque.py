#!/usr/bin/env python3
"""II-5 — 슬라이딩 윈도우 최댓값: 창을 매번 훑는 방법과 덱으로 후보만 남기는 방법.

두 방법은 같은 답을 낸다. 다른 것은 창이 커질 때의 기울기다. 창마다 다시
훑으면 O(nk) 라 k 에 비례해 느려지고, 덱은 각 원소가 한 번 들어가고 한 번
나오므로 O(n) 이라 k 와 무관하다. 표의 "k 를 4배로 늘렸을 때" 열이 그 증거다.

`window_max_deque.cpp` 와 1:1 로 대응한다.

사용법:
    python3.13 tools/bench/window_max_deque.py
"""
from __future__ import annotations

import random
import time
from collections import deque

N = 200_000


def naive(a: list[int], k: int) -> list[int]:
    """창마다 다시 훑는다. max(슬라이스)는 C 루프라 순수 파이썬보다 훨씬 빠르지만
    그래도 원소를 k번 본다는 사실은 바뀌지 않는다."""
    return [max(a[i : i + k]) for i in range(len(a) - k + 1)]


def with_deque(a: list[int], k: int) -> list[int]:
    """덱에는 '아직 최댓값이 될 수 있는 후보'의 인덱스만 남긴다."""
    dq: deque[int] = deque()
    out = []
    for i, x in enumerate(a):
        while dq and a[dq[-1]] <= x:
            dq.pop()
        dq.append(i)
        if dq[0] <= i - k:
            dq.popleft()
        if i >= k - 1:
            out.append(a[dq[0]])
    return out


def bench(fn, a: list[int], k: int, repeat: int = 3) -> float:
    ts = []
    for _ in range(repeat):
        t = time.perf_counter()
        fn(a, k)
        ts.append(time.perf_counter() - t)
    return sorted(ts)[len(ts) // 2]


def main() -> None:
    random.seed(20250804)
    a = [random.randrange(1, 10**9) for _ in range(N)]

    assert naive(a[:5000], 100) == with_deque(a[:5000], 100)

    print(f"n = {N:,}  (Python 3.13)")
    print(f"{'k':>8} | {'창마다 훑기':>12} | {'덱':>10} | {'배수':>8}")
    print("-" * 48)
    for k in (100, 400, 1600):
        t1 = bench(naive, a, k)
        t2 = bench(with_deque, a, k)
        print(f"{k:>8,} | {t1:>11.3f}초 | {t2:>9.3f}초 | {t1 / t2:>7.1f}배")


if __name__ == "__main__":
    main()
