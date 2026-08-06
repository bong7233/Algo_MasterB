#!/usr/bin/env python3
"""XIII-5 — 전수 최근접 탐색(brute-force NN)이 점 개수에 얼마나 민감한가.

본문(XIII-5, "어디에 쓰이는가")이 인용하는 수치의 측정 스크립트다. ICP의 한
반복은 소스 점마다 타깃 점 전부를 훑어 최근접을 찾는다. 이 비용이 점 개수의
제곱으로 자란다는 것을 실측으로 보인다.

측정 환경(CLAUDE.md §1-3): Ubuntu 24.04 x86-64 / CPython 3.13.

    python3.13 tools/bench/icp_nn_cost.py
"""

from __future__ import annotations

import random
import statistics
import time


def brute_force_pass(n: int) -> float:
    """소스 점 n개 각각에 대해 타깃 점 n개를 전부 훑어 최근접을 찾는 데 걸리는 시간."""
    random.seed(0)
    source = [(random.random() * 10, random.random() * 10) for _ in range(n)]
    target = [(random.random() * 10, random.random() * 10) for _ in range(n)]

    t0 = time.perf_counter()
    matches = []
    for px, py in source:
        best_j, best_d2 = -1, None
        for j, (qx, qy) in enumerate(target):
            d2 = (px - qx) ** 2 + (py - qy) ** 2
            if best_d2 is None or d2 < best_d2:
                best_d2, best_j = d2, j
        matches.append(best_j)
    t1 = time.perf_counter()
    assert len(matches) == n
    return t1 - t0


def main() -> None:
    for n in (500, 2000, 5000):
        runs = [brute_force_pass(n) for _ in range(3)]
        print(f"n={n:>5}: median={statistics.median(runs):.4f}s  (runs={['%.4f' % r for r in runs]})")


if __name__ == "__main__":
    main()
