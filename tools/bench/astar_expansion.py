#!/usr/bin/env python3
"""V-5 — 휴리스틱이 확장 칸 수를 얼마나 줄이는가.

본문(V-5)이 인용하는 수치의 측정 스크립트다. 확장 칸 수는 결정론적 값이라
기기와 무관하게 재현되고, 시간만 기기에 따라 달라진다.

측정 환경(CLAUDE.md §1-3): Ubuntu 24.04 x86-64 / CPython 3.13.

    python3.13 tools/bench/astar_expansion.py
"""

from __future__ import annotations

import heapq
import statistics
import time

DR = (-1, 1, 0, 0)
DC = (0, 0, -1, 1)
INF = 10 ** 9


def make_grid(n: int, kind: str):
    """kind: open / wall — wall 은 가운데를 세로로 막아 우회를 강제한다."""
    wall = [[False] * n for _ in range(n)]
    if kind == "wall":
        mid = n // 2
        for r in range(0, int(n * 0.72)):
            wall[r][mid] = True
    return wall


def search(wall, n, s, g, use_h):
    gr, gc = g
    dist = [[INF] * n for _ in range(n)]
    dist[s[0]][s[1]] = 0
    h0 = abs(s[0] - gr) + abs(s[1] - gc) if use_h else 0
    pq = [(h0, 0, s[0], s[1])]
    expanded = 0
    while pq:
        _, gu, r, c = heapq.heappop(pq)
        if gu > dist[r][c]:
            continue
        expanded += 1
        if r == gr and c == gc:
            return gu, expanded
        for k in range(4):
            nr, nc = r + DR[k], c + DC[k]
            if not (0 <= nr < n and 0 <= nc < n):
                continue
            if wall[nr][nc]:
                continue
            ng = gu + 1
            if ng < dist[nr][nc]:
                dist[nr][nc] = ng
                h = abs(nr - gr) + abs(nc - gc) if use_h else 0
                heapq.heappush(pq, (ng + h, ng, nr, nc))
    return INF, expanded


def timed(fn, reps=3):
    ts = []
    out = None
    for _ in range(reps):
        t0 = time.perf_counter()
        out = fn()
        ts.append((time.perf_counter() - t0) * 1000)
    return out, statistics.median(ts)


def main() -> None:
    n = 201
    cases = [
        ("열린 격자 · 목표가 정면", "open", (n // 2, 0), (n // 2, n - 1)),
        ("열린 격자 · 목표가 대각선 반대편", "open", (0, 0), (n - 1, n - 1)),
        ("가운데 세로벽 · 목표가 정면", "wall", (n // 2, 0), (n // 2, n - 1)),
    ]
    print(f"격자 {n}x{n} (칸 {n * n:,}개), 4-이웃, 이동 비용 1")
    print(f"{'배치':32s} {'비용':>5s} {'다익스트라':>12s} {'A*(맨해튼)':>12s} {'비율':>6s}")
    for label, kind, s, g in cases:
        wall = make_grid(n, kind)
        (cd, ed), td = timed(lambda: search(wall, n, s, g, False))
        (cm, em), tm = timed(lambda: search(wall, n, s, g, True))
        assert cd == cm, (cd, cm)
        print(
            f"{label:32s} {cd:5d} {ed:7,d}칸 {td:6.1f}ms"
            f" {em:7,d}칸 {tm:6.1f}ms {ed / em:5.2f}배"
        )


if __name__ == "__main__":
    main()
