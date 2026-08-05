#!/usr/bin/env python3
"""VI-6 의 수치 — 스위핑이 무엇을 대신하고 시간의 어디로 가는가.

무엇을 재는가
    1. 쌍마다 겹침을 세는 O(n^2) 과 이벤트를 훑는 O(n log n) 의 실제 격차
    2. 스위핑 시간의 몇 %가 정렬인가 — "스위핑은 정렬이 본체다" 를 수치로
    3. 구간 수를 10배씩 늘렸을 때 시간이 몇 배가 되는가
    4. 좌표 범위가 10^9 일 때 차분 배열(VI-4)이 요구하는 메모리

측정 환경은 CLAUDE.md §1-3 고정. 실행:
    python3.13 tools/bench/sweep_scale.py
"""

from __future__ import annotations

import random
import statistics
import time

COORD_MAX = 10**9


def make_segs(n: int, seed: int) -> list[tuple[int, int]]:
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        s = rnd.randrange(0, COORD_MAX - 1000)
        out.append((s, s + rnd.randrange(1, 100_000)))
    return out


def sweep(segs: list[tuple[int, int]]) -> tuple[int, int]:
    """(최대 겹침, 합집합 길이). 반열림 [s, e)."""
    ev = []
    for s, e in segs:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort()                       # -1 < +1 이라 같은 좌표에서 끝이 먼저 처리된다
    open_cnt = best = length = 0
    prev = None
    for x, d in ev:
        if open_cnt > 0 and prev is not None:
            length += x - prev
        open_cnt += d
        if open_cnt > best:
            best = open_cnt
        prev = x
    return best, length


def sweep_sort_only(segs: list[tuple[int, int]]) -> None:
    """스위핑에서 정렬까지만 — 나머지 훑기와의 비중을 재기 위한 것."""
    ev = []
    for s, e in segs:
        ev.append((s, 1))
        ev.append((e, -1))
    ev.sort()


def pairwise_max_overlap(segs: list[tuple[int, int]]) -> int:
    """O(n^2) — 각 구간의 시작점에서 몇 개가 열려 있는지 직접 센다."""
    best = 0
    for s, _ in segs:
        cnt = 0
        for a, b in segs:
            if a <= s < b:
                cnt += 1
        if cnt > best:
            best = cnt
    return best


def timeit(fn, *args, reps: int = 3) -> float:
    ts = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn(*args)
        ts.append(time.perf_counter() - t0)
    return statistics.median(ts) * 1000.0


def main() -> None:
    print("[1] 쌍 검사 O(n^2) vs 스위핑 O(n log n) — 답이 같은지도 함께 본다")
    for n in (2_000, 8_000, 20_000):
        segs = make_segs(n, seed=n)
        t_pair = timeit(pairwise_max_overlap, segs, reps=3)
        t_sweep = timeit(sweep, segs, reps=3)
        a = pairwise_max_overlap(segs)
        b, _ = sweep(segs)
        print(f"    n={n:>7,}  쌍 검사 {t_pair:9.1f} ms / 스위핑 {t_sweep:7.1f} ms "
              f"({t_pair / t_sweep:7.1f}배)  최대 겹침 {a}={b} {'OK' if a == b else '불일치!'}")

    print("\n[2] 스위핑 시간의 어디가 정렬인가")
    for n in (100_000, 1_000_000):
        segs = make_segs(n, seed=n)
        t_all = timeit(sweep, segs, reps=3)
        t_sort = timeit(sweep_sort_only, segs, reps=3)
        print(f"    n={n:>9,}  전체 {t_all:8.1f} ms / 정렬까지 {t_sort:8.1f} ms "
              f"= {t_sort / t_all * 100:.0f}%")

    print("\n[3] 구간 수를 10배로 — n log n 은 10배보다 조금 더 는다")
    prev = None
    for n in (10_000, 100_000, 1_000_000):
        segs = make_segs(n, seed=n)
        t = timeit(sweep, segs, reps=3)
        ratio = f"{t / prev:5.1f}배" if prev else "    -"
        print(f"    n={n:>9,}  {t:8.1f} ms   직전 대비 {ratio}")
        prev = t

    print("\n[4] 같은 문제를 차분 배열(VI-4)로 풀면 — 좌표 범위가 곧 메모리다")
    cells = COORD_MAX + 1
    print(f"    좌표 범위 {COORD_MAX:,} -> 칸 {cells:,}")
    print(f"    C++ int 배열      : {cells * 4 / 2**30:.2f} GiB")
    print(f"    Python list(포인터): {cells * 8 / 2**30:.2f} GiB")
    print("    (산술이지 측정이 아니다. 512 MB 제한에서는 선언 자체가 불가능하다.)")


if __name__ == "__main__":
    main()
