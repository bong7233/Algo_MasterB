#!/usr/bin/env python3.13
"""4-이웃과 8-이웃 라벨링의 실제 비용 차이 (IV-5).

측정 환경은 CLAUDE.md §1-3 고정: Ubuntu 24.04 / CPython 3.13.12.

이웃 검사 횟수는 정확히 2배다. 실행 시간도 2배인가를 잰다.
대각선 이웃 (r±1, c±1) 은 위아래 이웃과 같은 행을 읽으므로 이미 캐시에 올라와
있고, 세로 이웃 (r±1, c) 만이 새 캐시 라인을 부른다 — 그 예측이 맞는지 본다.

같은 격자를 두 번 라벨링하되, 결과가 달라지지 않도록 **연결 요소가 하나뿐인
격자**(전부 1)를 쓴다. 덩어리 구조가 달라지면 시간 비교가 오염된다.

실행:
    python3.13 tools/bench/ccl_neighbor_cost.py
"""

from __future__ import annotations

import time
from collections import deque

D4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]
D8 = D4 + [(-1, -1), (-1, 1), (1, -1), (1, 1)]

H = W = 1200


def label(grid, delta):
    h, w = len(grid), len(grid[0])
    lab = [[0] * w for _ in range(h)]
    count = 0
    peak = 0
    for sr in range(h):
        for sc in range(w):
            if grid[sr][sc] == 0 or lab[sr][sc] != 0:
                continue
            count += 1
            lab[sr][sc] = count
            q = deque([(sr, sc)])
            while q:
                if len(q) > peak:
                    peak = len(q)
                r, c = q.popleft()
                for dr, dc in delta:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < h and 0 <= nc < w:
                        if grid[nr][nc] == 1 and lab[nr][nc] == 0:
                            lab[nr][nc] = count
                            q.append((nr, nc))
    return count, peak


def main() -> None:
    grid = [[1] * W for _ in range(H)]
    print(f"{H}x{W} 격자 = {H * W:,} 칸, 전부 1 (연결 요소 1개)")
    for name, delta in (("4-이웃", D4), ("8-이웃", D8)):
        best = None
        for _ in range(3):
            t0 = time.perf_counter()
            count, peak = label(grid, delta)
            dt = time.perf_counter() - t0
            best = dt if best is None else min(best, dt)
        print(f"  {name}: {best:.3f}초  덩어리 {count}개  큐 최대 길이 {peak:,}")


if __name__ == "__main__":
    main()
