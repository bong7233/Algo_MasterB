#!/usr/bin/env python3
"""III-4 — 가지치기가 탐색 트리를 얼마나 줄이는가 (노드 수 실측).

노드의 정의: `place(row)` 호출 1회. 즉 "부분 배치 하나를 검사한 사건" 하나가 노드 하나다.
같은 정의를 세 전략에 그대로 적용해야 비교가 성립한다.

  none  : 아무것도 안 자른다. 마지막 행까지 다 놓고 나서 유효성을 판정한다.  트리 크기 = sum N^r
  col   : 열 충돌만 자른다. 결과적으로 순열을 세는 것과 같다.               트리 크기 = sum P(N,r)
  full  : 열 + 두 대각선을 자른다. 코딩테스트에서 쓰는 그 코드.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / 4코어).
사용법: python3.13 tools/bench/nqueens_prune.py [N]
"""

from __future__ import annotations

import sys
import time


def solve(n: int, prune: str) -> tuple[int, int]:
    """(해의 개수, 방문한 노드 수)."""
    col = [False] * n
    diag1 = [False] * (2 * n)   # r + c
    diag2 = [False] * (2 * n)   # r - c + n
    pos = [0] * n
    nodes = 0
    solutions = 0

    def valid_all() -> bool:
        for i in range(n):
            for j in range(i + 1, n):
                if pos[i] == pos[j] or j - i == abs(pos[j] - pos[i]):
                    return False
        return True

    def place(row: int) -> None:
        nonlocal nodes, solutions
        nodes += 1
        if row == n:
            # none/col 은 남은 조건을 잎에서 판정한다. 세 전략의 해의 개수가
            # 같아야 "같은 문제를 다른 크기의 트리로 풀었다" 는 비교가 성립한다.
            if prune == "full" or valid_all():
                solutions += 1
            return
        for c in range(n):
            if prune != "none" and col[c]:
                continue
            if prune == "full" and (diag1[row + c] or diag2[row - c + n]):
                continue
            col[c] = True
            diag1[row + c] = True
            diag2[row - c + n] = True
            pos[row] = c
            place(row + 1)
            col[c] = False
            diag1[row + c] = False
            diag2[row - c + n] = False

    place(0)
    return solutions, nodes


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    sys.setrecursionlimit(10000)
    print(f"N = {n}")
    print(f"{'전략':<6} {'해':>8} {'노드':>14} {'시간(초)':>10}")
    for prune in ("none", "col", "full"):
        times = []
        for _ in range(3):          # 3회 실행의 중앙값. 노드 수는 결정론적이라 한 번이면 된다
            t0 = time.perf_counter()
            sols, nodes = solve(n, prune)
            times.append(time.perf_counter() - t0)
        dt = sorted(times)[1]
        print(f"{prune:<6} {sols:>8,} {nodes:>14,} {dt:>10.3f}")


if __name__ == "__main__":
    main()
