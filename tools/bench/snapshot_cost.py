#!/usr/bin/env python3
"""III-5 — 상태를 되돌리는 세 가지 방법의 비용 (Python).

시뮬레이션·백트래킹에서 "한 수 두고 되돌리기" 를 구현하는 방법은 셋이다.

  deepcopy : copy.deepcopy 로 격자 전체를 복제해 두고 실패하면 통째로 되돌린다
  slice    : [row[:] for row in grid] — 얕은 복사의 2단 조합. 정수 격자면 이걸로 충분하다
  undo     : 바꾼 칸만 (r, c, 이전값) 으로 기록해 두고 역순으로 되돌린다

한 수가 건드리는 칸 수를 K 로 두면 앞의 둘은 O(H·W), 마지막은 O(K) 다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13).
사용법: python3.13 tools/bench/snapshot_cost.py [H] [W] [moves]
"""

from __future__ import annotations

import copy
import sys
import time

TOUCH = 4   # 한 수가 바꾸는 칸 수


def make_grid(h, w):
    return [[(r * w + c) % 10 for c in range(w)] for r in range(h)]


def cells(step, h, w):
    return [((step * 7 + i * 13) % h, (step * 11 + i * 5) % w) for i in range(TOUCH)]


def by_deepcopy(grid, h, w, moves):
    acc = 0
    for step in range(moves):
        saved = copy.deepcopy(grid)
        for r, c in cells(step, h, w):
            grid[r][c] += 1
            acc += grid[r][c]
        grid = saved                      # 되돌리기 = 복제본으로 교체
    return acc


def by_slice(grid, h, w, moves):
    acc = 0
    for step in range(moves):
        saved = [row[:] for row in grid]
        for r, c in cells(step, h, w):
            grid[r][c] += 1
            acc += grid[r][c]
        grid = saved
    return acc


def by_undo(grid, h, w, moves):
    acc = 0
    for step in range(moves):
        log = []
        for r, c in cells(step, h, w):
            log.append((r, c, grid[r][c]))   # 바꾸기 전 값만 남긴다
            grid[r][c] += 1
            acc += grid[r][c]
        for r, c, old in reversed(log):      # 역순 복원 — 같은 칸을 두 번 건드려도 안전하다
            grid[r][c] = old
    return acc


def timeit(fn, h, w, moves, reps=3):
    ts, val = [], None
    for _ in range(reps):
        grid = make_grid(h, w)
        t0 = time.perf_counter()
        val = fn(grid, h, w, moves)
        ts.append(time.perf_counter() - t0)
    return sorted(ts)[len(ts) // 2], val


def main():
    h = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    w = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    moves = int(sys.argv[3]) if len(sys.argv) > 3 else 100_000

    print(f"격자 {h}×{w} = {h * w}칸, 수 {moves:,}회, 한 수가 건드리는 칸 {TOUCH}개")
    res = {}
    for name, fn in (("deepcopy", by_deepcopy), ("slice", by_slice), ("undo", by_undo)):
        dt, val = timeit(fn, h, w, moves)
        res[name] = dt
        print(f"  {name:<9} {dt:8.4f}초   체크섬 {val}")
    print(
        f"\n  undo 를 1 로 두면  slice {res['slice'] / res['undo']:.1f}배, "
        f"deepcopy {res['deepcopy'] / res['undo']:.0f}배"
    )


if __name__ == "__main__":
    main()
