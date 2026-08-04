#!/usr/bin/env python3
"""0-9 — "1초에 몇 연산인가"의 실측 (Python 쪽).

"1초 ≈ 10^8 연산"이라는 어림은 연산 하나의 비용이 상수라고 가정한다.
그 가정이 얼마나 틀리는지를 재는 스크립트다.

측정 대상은 산술 명령 하나가 아니라 **알고리즘의 안쪽 루프 한 바퀴**다.
`s += 1` 같은 루프는 C++ 에서 컴파일러가 통째로 지워 버려 비교가 성립하지
않는다(그 현상 자체는 ops_budget.cpp 의 마지막 절에서 따로 보인다).

`ops_budget.cpp` 와 워크로드가 1:1 로 대응한다.

사용법:
    python3.13 tools/bench/ops_budget.py
"""
from __future__ import annotations

import math
import random
import time

REPS = 3


def median(xs):
    return sorted(xs)[len(xs) // 2]


def bench(fn, *args):
    ts = []
    for _ in range(REPS):
        t = time.perf_counter()
        r = fn(*args)
        ts.append(time.perf_counter() - t)
    return median(ts), r


# --- 워크로드: 전부 "루프 한 바퀴 = 연산 1회" ------------------------------

N = 10_000_000


def w_seq_scan(a):
    """연속 접근. 캐시가 최대로 먹히는 경우."""
    s = 0
    for i in range(len(a)):
        s += a[i]
    return s


def w_random_scan(a, idx):
    """무작위 접근. 캐시 미스가 지배하는 경우. 같은 횟수, 같은 연산."""
    s = 0
    for i in range(len(idx)):
        s += a[idx[i]]
    return s


def w_dict_lookup(d, keys):
    s = 0
    for i in range(len(keys)):
        s += d[keys[i]]
    return s


def w_knapsack_inner(dp, w, v, n_updates):
    """0/1 배낭의 안쪽 루프. 실제 DP 갱신 한 번의 비용."""
    cnt = 0
    cap = len(dp) - 1
    while cnt < n_updates:
        for j in range(cap, w - 1, -1):
            cand = dp[j - w] + v
            if cand > dp[j]:
                dp[j] = cand
            cnt += 1
            if cnt >= n_updates:
                break
    return dp[cap]


def _leaf(x):
    return x + 1


def w_func_call(n):
    s = 0
    for _ in range(n):
        s = _leaf(s)
    return s


def main():
    print("=== 알고리즘 안쪽 루프 한 바퀴의 비용 (CPython 3.13) ===")
    print(f"{'워크로드':<26} {'n':>12} {'초':>8} {'ns/op':>9} {'ops/s':>16}")
    rows = []

    def report(name, n, el):
        rows.append((name, n, el))
        print(f"{name:<26} {n:>12,} {el:>8.3f} {el / n * 1e9:>9.1f} {n / el:>16,.0f}")

    a = list(range(N))
    el, _ = bench(w_seq_scan, a)
    report("연속 접근 s += a[i]", N, el)

    random.seed(1)
    idx = [random.randrange(N) for _ in range(N)]
    el, _ = bench(w_random_scan, a, idx)
    report("무작위 접근 s += a[idx[i]]", N, el)
    del idx

    nd = 2_000_000
    d = {i: i for i in range(1 << 20)}
    random.seed(2)
    keys = [random.randrange(1 << 20) for _ in range(nd)]
    el, _ = bench(w_dict_lookup, d, keys)
    report("딕셔너리 조회 d[k]", nd, el)
    del d, keys

    ndp = 5_000_000
    el, _ = bench(w_knapsack_inner, [0] * 10001, 7, 13, ndp)
    report("DP 갱신 dp[j]=max(...)", ndp, el)

    nf = 5_000_000
    el, _ = bench(w_func_call, nf)
    report("함수 호출 f(x)", nf, el)

    print("\n=== 정렬: n log n 한 단위의 비용 ===")
    for n in (100_000, 1_000_000, 5_000_000):
        random.seed(1)
        base = [random.randrange(1 << 30) for _ in range(n)]
        ts = []
        for _ in range(REPS):
            arr = base[:]
            t = time.perf_counter()
            arr.sort()
            ts.append(time.perf_counter() - t)
        el = median(ts)
        units = n * math.log2(n)
        print(f"  n={n:>9,}  sort={el:7.3f}s  n·log2 n={units:>13,.0f}  {units / el:>15,.0f} 단위/s")

    print("\n=== 1초 예산 역산: 이 비용이면 N 이 얼마까지 되는가 ===")
    # 단가를 하나로 정할 수 없다는 것이 이 챕터의 요점이다. 그래서 두 개를 쓴다.
    #   최선 = 연속 접근 (캐시가 최대로 먹히는 안쪽 루프)
    #   최악 = 무작위 접근 (포인터를 따라다니는 안쪽 루프)
    best_ns = rows[0][2] / rows[0][1] * 1e9
    worst_ns = rows[1][2] / rows[1][1] * 1e9
    forms = (
        ("O(n)", lambda n: n),
        ("O(n log n)", lambda n: n * math.log2(max(n, 2))),
        ("O(n^2)", lambda n: n * n),
        ("O(n^3)", lambda n: n * n * n),
        ("O(2^n)", lambda n: 2.0**n),
        ("O(n!)", lambda n: math.gamma(n + 1)),
    )

    def max_n(f, budget):
        lo, hi = 1, 1
        while f(hi) < budget and hi < 10**10:
            hi *= 2
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if f(mid) <= budget:
                lo = mid
            else:
                hi = mid - 1
        return lo

    b_best, b_worst = 1e9 / best_ns, 1e9 / worst_ns
    print(f"  최선 단가 = 연속 접근 {best_ns:.1f} ns  -> 1초에 {b_best:,.0f} 연산")
    print(f"  최악 단가 = 무작위 접근 {worst_ns:.1f} ns  -> 1초에 {b_worst:,.0f} 연산")
    print(f"  {'복잡도':<12} {'최대 N (최선)':>16} {'최대 N (최악)':>16}")
    for label, f in forms:
        print(f"  {label:<12} {max_n(f, b_best):>16,} {max_n(f, b_worst):>16,}")


if __name__ == "__main__":
    main()
