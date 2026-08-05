#!/usr/bin/env python3
"""V-8 — 상태에 시간 축을 더하면 상태 공간이 몇 배로 불어나는가.

본문(V-8)이 인용하는 수치의 측정 스크립트다. 도달 불가능한 목표를 두어
탐색을 끝까지 소진시킨다. 그래야 "이 알고리즘이 최악의 경우 몇 개의 상태를
들고 있어야 하는가" 가 그대로 측정된다. 확장 수는 결정론적이라 기기와
무관하게 재현되고, 시간과 메모리만 기기에 따라 달라진다.

측정 환경(CLAUDE.md §1-3): Ubuntu 24.04 x86-64 / CPython 3.13.

    python3.13 tools/bench/spacetime_state_growth.py
"""

from __future__ import annotations

import heapq
import statistics
import time
import tracemalloc

MOVES = [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]


def make_grid(n: int) -> list[str]:
    """가운데 세로벽으로 완전히 갈라 목표를 도달 불가능하게 만든다."""
    rows = []
    for r in range(n):
        rows.append("".join("#" if c == n // 2 else "." for c in range(n)))
    return rows


def walkable(grid, cell):
    r, c = cell
    return 0 <= r < len(grid) and 0 <= c < len(grid[0]) and grid[r][c] != "#"


def manhattan(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def plain_astar(grid, start, goal):
    """상태 = 칸. V-5의 A* 그대로다."""
    open_ = [(manhattan(start, goal), 0, start)]
    came = {start: None}
    expanded = 0
    while open_:
        f, g, cell = heapq.heappop(open_)
        expanded += 1
        if cell == goal:
            return expanded, len(came)
        for dr, dc in MOVES[1:]:
            nxt = (cell[0] + dr, cell[1] + dc)
            if not walkable(grid, nxt) or nxt in came:
                continue
            came[nxt] = cell
            heapq.heappush(open_, (g + 1 + manhattan(nxt, goal), g + 1, nxt))
    return expanded, len(came)


def spacetime_astar(grid, start, goal, horizon):
    """상태 = (칸, 시각). 대기가 행동에 추가된다. V-8 본문의 plan() 과 같은 뼈대."""
    open_ = [(manhattan(start, goal), 0, start)]
    came = {(start, 0): None}
    expanded = 0
    while open_:
        f, t, cell = heapq.heappop(open_)
        expanded += 1
        if cell == goal:
            return expanded, len(came)
        if t >= horizon:
            continue
        for dr, dc in MOVES:
            nxt = (cell[0] + dr, cell[1] + dc)
            if not walkable(grid, nxt) or (nxt, t + 1) in came:
                continue
            came[(nxt, t + 1)] = (cell, t)
            heapq.heappush(open_, (t + 1 + manhattan(nxt, goal), t + 1, nxt))
    return expanded, len(came)


def timed(fn, reps=3):
    out, ts = None, []
    for _ in range(reps):
        t0 = time.perf_counter()
        out = fn()
        ts.append((time.perf_counter() - t0) * 1000)
    return out, statistics.median(ts)


def peak_kib(fn) -> float:
    tracemalloc.start()
    fn()
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return peak / 1024


def main() -> None:
    n = 41
    grid = make_grid(n)
    start, goal = (0, 0), (n - 1, n - 1)
    cells = sum(row.count(".") for row in grid)
    print(f"격자 {n}x{n}, 통행 가능한 칸 {cells:,}개, 목표는 벽 반대편(도달 불가)")
    print(f"{'탐색':28s} {'확장':>10s} {'보관 상태':>12s} {'시간':>9s} {'최대 메모리':>12s}")

    (ex, st), ms = timed(lambda: plain_astar(grid, start, goal))
    kib = peak_kib(lambda: plain_astar(grid, start, goal))
    base = st
    print(f"{'A* (상태 = 칸)':28s} {ex:9,d} {st:11,d} {ms:7.1f}ms {kib:9.0f}KiB")

    for horizon in (25, 50, 100):
        (ex, st), ms = timed(lambda: spacetime_astar(grid, start, goal, horizon))
        kib = peak_kib(lambda: spacetime_astar(grid, start, goal, horizon))
        label = f"시공간 A* (T = {horizon})"
        print(
            f"{label:28s} {ex:9,d} {st:11,d} {ms:7.1f}ms {kib:9.0f}KiB"
            f"  상태 {st / base:.1f}배"
        )


if __name__ == "__main__":
    main()
