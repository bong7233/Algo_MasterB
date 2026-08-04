#!/usr/bin/env python3
"""재귀 DFS와 명시적 스택 DFS — IV-2 본문 수치.

격자 DFS 의 최악 깊이는 정점 수와 같다. 한 줄로 이어진 뱀 모양 통로를 만들면
1000×1000 격자에서 깊이가 10^6 에 이른다. 이 스크립트는 세 가지를 잰다.

    1. 기본 재귀 한도(1000)에서 재귀 DFS 가 몇 칸 만에 죽는가
    2. 한도를 올렸을 때 통과하는가, 시간이 얼마나 드는가
    3. 명시적 스택으로 바꾼 같은 알고리즘의 시간

0-10 이 "깊이 10^5 를 넘는 DFS 는 반복으로 바꾼다" 고 결론짓고 그 변환을 IV-2 로
넘긴다. 여기서 그 근거 수치를 만든다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
사용법: python3.13 tools/bench/dfs_recursion_vs_stack.py
"""

import sys
import time
from statistics import median

N = 1000          # N×N 격자
REPEAT = 3


def snake(n=N):
    """뱀 모양 통로. 벽 0, 길 1. 전부 한 줄로 이어져 최악 깊이를 만든다."""
    g = [[0] * n for _ in range(n)]
    for r in range(0, n, 2):
        for c in range(n):
            g[r][c] = 1
    for r in range(1, n, 2):
        c = n - 1 if (r // 2) % 2 == 0 else 0
        g[r][c] = 1
    return g


def dfs_recursive(g, sr, sc):
    n = len(g)
    seen = [[False] * n for _ in range(n)]
    depth = [0]

    def go(r, c, d):
        seen[r][c] = True
        if d > depth[0]:
            depth[0] = d
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and g[nr][nc] and not seen[nr][nc]:
                go(nr, nc, d + 1)

    go(sr, sc, 1)
    return sum(map(sum, ([1 if v else 0 for v in row] for row in seen))), depth[0]


def dfs_stack(g, sr, sc):
    n = len(g)
    seen = [[False] * n for _ in range(n)]
    st = [(sr, sc)]
    seen[sr][sc] = True
    cnt, peak = 0, 1
    while st:
        r, c = st.pop()
        cnt += 1
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and g[nr][nc] and not seen[nr][nc]:
                seen[nr][nc] = True
                st.append((nr, nc))
                peak = max(peak, len(st))
    return cnt, peak


def bench(fn, *a):
    ts, out = [], None
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        out = fn(*a)
        ts.append(time.perf_counter() - t0)
    return median(ts), out


def main():
    g = snake()
    cells = sum(map(sum, g))
    print(f"{N}×{N} 뱀 모양 통로  (길 {cells:,}칸, 전부 한 줄로 이어짐)")

    print(f"기본 재귀 한도: {sys.getrecursionlimit()}")
    try:
        dfs_recursive(g, 0, 0)
        print("  기본 한도로 통과 (예상 밖)")
    except RecursionError:
        print("  RecursionError — 기본 한도로는 통로의 앞부분에서 죽는다")

    sys.setrecursionlimit(cells + 10000)
    try:
        t_rec, (n_rec, d_rec) = bench(dfs_recursive, g, 0, 0)
        print(f"한도를 {sys.getrecursionlimit():,}으로 올린 재귀: "
              f"{t_rec * 1000:.0f} ms, 방문 {n_rec:,}칸, 최대 깊이 {d_rec:,}")
    except RecursionError:
        print("한도를 올려도 RecursionError")

    t_st, (n_st, peak) = bench(dfs_stack, g, 0, 0)
    print(f"명시적 스택: {t_st * 1000:.0f} ms, 방문 {n_st:,}칸, 스택 최대 {peak:,}")
    print(f"  배수: 시간 {t_rec / t_st:.2f}배")


if __name__ == "__main__":
    main()
