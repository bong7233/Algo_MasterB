#!/usr/bin/env python3
"""플로이드-워셜의 V^3 이 실제로 어디서 터지는가 (V-3 §4).

세 줄짜리 알고리즘이지만 상수가 아니라 지수가 문제다. n 이 두 배가 되면 여덟 배다.
같은 코드의 C++ 판은 floyd_warshall_cost.cpp 다. 두 언어의 상수 차이가
n 을 어디까지 허용하는지를 가른다.

사용법:
    python3 tools/bench/floyd_warshall_cost.py
"""
import random
import time

INF = float("inf")


def make(n, seed=5):
    rng = random.Random(seed)
    d = [[INF] * n for _ in range(n)]
    for i in range(n):
        d[i][i] = 0
    for _ in range(n * 8):
        u, v = rng.randrange(n), rng.randrange(n)
        if u != v:
            d[u][v] = min(d[u][v], rng.randint(1, 1000))
    return d


def plain(n, d):
    for k in range(n):
        dk = d[k]
        for i in range(n):
            di = d[i]
            aik = di[k]
            if aik == INF:
                continue
            for j in range(n):
                t = aik + dk[j]
                if t < di[j]:
                    di[j] = t
    return d


def main():
    print(f"{'n':>5}{'n^3':>14}{'Python (ms)':>14}")
    for n in (100, 200, 400, 800):
        d = make(n)
        t = time.perf_counter()
        plain(n, d)
        print(f"{n:>5}{n ** 3:>14,}{(time.perf_counter() - t) * 1000:>14.0f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
