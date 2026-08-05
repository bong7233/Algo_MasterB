#!/usr/bin/env python3
"""VIII-2 의 수치와 정확성 검증 — 하향식(메모) vs 상향식(표).

무엇을 재는가
    1. 같은 문제(1로 만들기)를 두 방향으로 풀 때의 시간과 **최대 재귀 깊이**
    2. functools.lru_cache 와 직접 만든 dict 메모의 비용 차이
    3. 상태 공간이 희소할 때 상향식이 버리는 일의 양
       (부분합 — 무게가 크고 개수가 적으면 닿는 상태는 표의 극히 일부다)
    4. 두 방향의 답이 브루트포스와 일치하는가 (M7 부칙 §7)

측정 환경은 CLAUDE.md §1-3 고정. 실행:
    python3.13 tools/bench/viii2_memo_vs_table.py
"""

from __future__ import annotations

import functools
import random
import sys
import time


# ---------------------------------------------------------------- 1로 만들기

def top_down(n: int) -> tuple[int, int, int]:
    """반환: (답, 계산한 상태 수, 최대 재귀 깊이)."""
    memo = {1: 0}
    stat = {"max_depth": 0, "computed": 1}

    def go(x: int, depth: int) -> int:
        if depth > stat["max_depth"]:
            stat["max_depth"] = depth
        if x in memo:
            return memo[x]
        best = go(x - 1, depth + 1) + 1
        if x % 2 == 0:
            best = min(best, go(x // 2, depth + 1) + 1)
        if x % 3 == 0:
            best = min(best, go(x // 3, depth + 1) + 1)
        memo[x] = best
        stat["computed"] += 1
        return best

    ans = go(n, 1)
    return ans, stat["computed"], stat["max_depth"]


def bottom_up(n: int) -> int:
    dp = [0] * (n + 1)
    for x in range(2, n + 1):
        best = dp[x - 1] + 1
        if x % 2 == 0 and dp[x // 2] + 1 < best:
            best = dp[x // 2] + 1
        if x % 3 == 0 and dp[x // 3] + 1 < best:
            best = dp[x // 3] + 1
        dp[x] = best
    return dp[n]


def brute_min_ops(n: int) -> int:
    """메모 없는 완전탐색. 작은 n 에서만 돌린다."""
    if n == 1:
        return 0
    best = brute_min_ops(n - 1) + 1
    if n % 2 == 0:
        best = min(best, brute_min_ops(n // 2) + 1)
    if n % 3 == 0:
        best = min(best, brute_min_ops(n // 3) + 1)
    return best


# ---------------------------------------------------------------- 희소 상태

WEIGHTS = [812371, 455129, 690001, 137777, 908213, 51233,
           377777, 641009, 219999, 705001, 88811, 493337]
CAP = 3_000_000


def subset_top_down(ws: list[int], cap: int) -> tuple[int, int]:
    """(최대 합, 실제로 계산한 상태 수). 상태는 (인덱스, 남은 용량)."""
    memo: dict[tuple[int, int], int] = {}

    def go(i: int, left: int) -> int:
        if i == len(ws):
            return 0
        key = (i, left)
        hit = memo.get(key)
        if hit is not None:
            return hit
        best = go(i + 1, left)
        if ws[i] <= left:
            cand = ws[i] + go(i + 1, left - ws[i])
            if cand > best:
                best = cand
        memo[key] = best
        return best

    ans = go(0, cap)
    return ans, len(memo)


def subset_bottom_up(ws: list[int], cap: int) -> tuple[int, int]:
    """(최대 합, 표의 칸 수). 표는 실제로 만들지 않고 한 줄만 굴린다 — 그래도 칸 수는 같다."""
    dp = bytearray(cap + 1)
    dp[0] = 1
    for w in ws:
        for c in range(cap, w - 1, -1):
            if dp[c - w]:
                dp[c] = 1
    best = max(c for c in range(cap + 1) if dp[c])
    return best, (len(ws) + 1) * (cap + 1)


def main() -> None:
    sys.setrecursionlimit(2_000_000)

    print("[1] 1로 만들기 — 두 방향의 시간과 최대 재귀 깊이")
    for n in (100_000, 1_000_000):
        t0 = time.perf_counter()
        a1, computed, depth = top_down(n)
        t_td = time.perf_counter() - t0
        t0 = time.perf_counter()
        a2 = bottom_up(n)
        t_bu = time.perf_counter() - t0
        assert a1 == a2, (a1, a2)
        print(f"    n={n:>9,}  답 {a1}")
        print(f"        하향식 {t_td*1000:8.1f} ms  계산한 상태 {computed:>9,}  최대 재귀 깊이 {depth:>9,}")
        print(f"        상향식 {t_bu*1000:8.1f} ms  표 칸 수     {n+1:>9,}")
        print(f"        하향식/상향식 = {t_td / t_bu:.2f}배")

    print("\n[2] Python 기본 재귀 한도(1000)로 하향식이 어디까지 가는가")
    sys.setrecursionlimit(1000)
    for n in (500, 2000):
        try:
            top_down(n)
            print(f"    n={n:>5}  통과")
        except RecursionError:
            print(f"    n={n:>5}  RecursionError")
    sys.setrecursionlimit(2_000_000)

    print("\n[3] lru_cache 를 씌우면 재귀 깊이 한도가 따로 논다")
    # lru_cache 는 C 로 구현되어 있다. 파이썬 프레임 사이에 C 프레임이 끼므로
    # setrecursionlimit 을 아무리 올려도 C 스택 가드에 먼저 걸린다.
    @functools.lru_cache(maxsize=None)
    def chain(x: int) -> int:
        return 0 if x == 0 else chain(x - 1) + 1

    def plain(x: int) -> int:
        return 0 if x == 0 else plain(x - 1) + 1

    def deepest(f) -> int:
        lo, hi = 1, 2_000_000
        while lo < hi:
            mid = (lo + hi + 1) // 2
            try:
                f(mid)
                lo = mid
            except RecursionError:
                hi = mid - 1
            if hasattr(f, "cache_clear"):
                f.cache_clear()
        return lo

    print(f"    setrecursionlimit(2,000,000) 상태에서 도달 가능한 깊이")
    print(f"        순수 파이썬 재귀 : {deepest(plain):>9,}")
    print(f"        lru_cache 재귀   : {deepest(chain):>9,}")

    print("\n[3b] lru_cache vs 직접 dict 메모 vs 상향식 — 격자 경로 수 400×400")
    R = C = 400

    @functools.lru_cache(maxsize=None)
    def paths_lru(r: int, c: int) -> int:
        if r == 0 or c == 0:
            return 1
        return paths_lru(r - 1, c) + paths_lru(r, c - 1)

    def paths_dict(r0: int, c0: int) -> int:
        memo: dict[tuple[int, int], int] = {}

        def go(r: int, c: int) -> int:
            if r == 0 or c == 0:
                return 1
            key = (r, c)
            hit = memo.get(key)
            if hit is not None:
                return hit
            v = go(r - 1, c) + go(r, c - 1)
            memo[key] = v
            return v

        return go(r0, c0)

    def paths_table(r0: int, c0: int) -> int:
        dp = [[1] * (c0 + 1) for _ in range(r0 + 1)]
        for r in range(1, r0 + 1):
            for c in range(1, c0 + 1):
                dp[r][c] = dp[r - 1][c] + dp[r][c - 1]
        return dp[r0][c0]

    t0 = time.perf_counter(); p1 = paths_lru(R, C); t_lru = time.perf_counter() - t0
    t0 = time.perf_counter(); p2 = paths_dict(R, C); t_dict = time.perf_counter() - t0
    t0 = time.perf_counter(); p3 = paths_table(R, C); t_tab = time.perf_counter() - t0
    assert p1 == p2 == p3
    print(f"    lru_cache {t_lru*1000:8.1f} ms / dict 메모 {t_dict*1000:8.1f} ms / 상향식 표 {t_tab*1000:8.1f} ms")
    print(f"    (세 값 모두 같은 정수: 자릿수 {len(str(p1))})")

    print("\n[4] 희소 상태 — 부분합(무게 12개, 용량 3,000,000)")
    t0 = time.perf_counter()
    a_td, states = subset_top_down(WEIGHTS, CAP)
    t_td = time.perf_counter() - t0
    t0 = time.perf_counter()
    a_bu, cells = subset_bottom_up(WEIGHTS, CAP)
    t_bu = time.perf_counter() - t0
    assert a_td == a_bu, (a_td, a_bu)
    print(f"    답 {a_td:,}")
    print(f"    하향식 {t_td*1000:8.1f} ms  계산한 상태 {states:>12,}")
    print(f"    상향식 {t_bu*1000:8.1f} ms  표 칸 수     {cells:>12,}")
    print(f"    닿는 상태는 표의 {states / cells * 100:.5f}%")

    print("\n[5] 브루트포스 대조 (M7 §7)")
    bad = 0
    for n in range(1, 121):
        b = brute_min_ops(n)
        t, _, _ = top_down(n)
        u = bottom_up(n) if n >= 2 else 0
        if not (b == t == u):
            bad += 1
            print(f"    불일치! n={n} brute={b} top={t} bottom={u}")
    print(f"    n=1..120 전부 대조, 불일치 {bad}건")

    random.seed(1234)
    bad = 0
    for _ in range(300):
        k = random.randint(1, 8)
        ws = [random.randint(1, 40) for _ in range(k)]
        cap = random.randint(0, 80)
        best_bf = 0
        for mask in range(1 << k):
            s = sum(ws[i] for i in range(k) if mask >> i & 1)
            if s <= cap and s > best_bf:
                best_bf = s
        a, _ = subset_top_down(ws, cap)
        if a != best_bf:
            bad += 1
            print(f"    부분합 불일치! ws={ws} cap={cap} memo={a} bf={best_bf}")
    print(f"    부분합 300회 무작위 대조, 불일치 {bad}건")


if __name__ == "__main__":
    main()
