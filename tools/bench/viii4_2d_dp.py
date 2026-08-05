#!/usr/bin/env python3
"""VIII-4 의 수치와 정확성 검증 — 2차원 DP.

무엇을 재는가
    1. 격자 경로 수: DP 와 경로 완전열거의 일치 (벽 있는 경우 포함)
    2. 편집 거리: DP 와 메모 없는 재귀의 일치, 그리고 복원한 연산 열이
       실제로 A 를 B 로 만드는가 (값만 맞고 복원이 틀리는 버그를 잡는다)
    3. 전체 표판과 두 줄 롤링판의 시간·메모리
    4. 무작위 대조 (M7 부칙 §7)

측정 환경은 CLAUDE.md §1-3 고정. 실행:
    python3.13 tools/bench/viii4_2d_dp.py
"""

from __future__ import annotations

import random
import sys
import time
import tracemalloc


# ------------------------------------------------------------- 격자 경로 수

def grid_paths_dp(rows: int, cols: int, wall: set[tuple[int, int]]) -> int:
    dp = [[0] * cols for _ in range(rows)]
    dp[0][0] = 0 if (0, 0) in wall else 1
    for r in range(rows):
        for c in range(cols):
            if (r, c) == (0, 0):
                continue
            if (r, c) in wall:
                continue
            up = dp[r - 1][c] if r > 0 else 0
            left = dp[r][c - 1] if c > 0 else 0
            dp[r][c] = up + left
    return dp[rows - 1][cols - 1]


def grid_paths_enumerate(rows: int, cols: int, wall: set[tuple[int, int]]) -> int:
    """경로를 하나씩 실제로 걸어 본다. 작은 격자에서만."""
    def go(r: int, c: int) -> int:
        if r >= rows or c >= cols or (r, c) in wall:
            return 0
        if (r, c) == (rows - 1, cols - 1):
            return 1
        return go(r + 1, c) + go(r, c + 1)
    if (0, 0) in wall:
        return 0
    return go(0, 0)


# --------------------------------------------------------------- 편집 거리

def edit_dp(a: str, b: str) -> tuple[int, list[list[int]]]:
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[n][m], dp


def edit_rolling(a: str, b: str) -> int:
    n, m = len(a), len(b)
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                cur[j] = prev[j - 1]
            else:
                cur[j] = 1 + min(prev[j], cur[j - 1], prev[j - 1])
        prev = cur
    return prev[m]


def edit_brute(a: str, b: str) -> int:
    """메모 없는 재귀. 짧은 문자열에서만."""
    def go(i: int, j: int) -> int:
        if i == 0:
            return j
        if j == 0:
            return i
        if a[i - 1] == b[j - 1]:
            return go(i - 1, j - 1)
        return 1 + min(go(i - 1, j), go(i, j - 1), go(i - 1, j - 1))
    return go(len(a), len(b))


def edit_ops(a: str, b: str, dp: list[list[int]]) -> list[str]:
    """표를 거꾸로 걸어 연산 열을 복원한다."""
    i, j = len(a), len(b)
    ops: list[str] = []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            i, j = i - 1, j - 1
            continue
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append(f"교체 {i} {a[i-1]}->{b[j-1]}")
            i, j = i - 1, j - 1
        elif j > 0 and dp[i][j] == dp[i][j - 1] + 1:
            ops.append(f"삽입 {i+1} {b[j-1]}")
            j -= 1
        else:
            ops.append(f"삭제 {i} {a[i-1]}")
            i -= 1
    ops.reverse()
    return ops


def apply_ops(a: str, ops: list[str]) -> str:
    """복원한 연산을 실제로 적용해 본다. 연산은 A 기준 인덱스라 뒤에서부터 적용한다."""
    s = list(a)
    for op in reversed(ops):
        kind, pos, arg = op.split(" ")
        p = int(pos)
        if kind == "교체":
            s[p - 1] = arg.split("->")[1]
        elif kind == "삭제":
            del s[p - 1]
        else:
            s.insert(p - 1, arg)
    return "".join(s)


def main() -> None:
    sys.setrecursionlimit(100000)
    random.seed(4242)

    print("[1] 격자 경로 수 — DP vs 경로 완전열거")
    bad = 0
    for _ in range(300):
        rows = random.randint(1, 6)
        cols = random.randint(1, 6)
        wall = set()
        for _ in range(random.randint(0, 4)):
            r, c = random.randrange(rows), random.randrange(cols)
            if (r, c) in ((0, 0), (rows - 1, cols - 1)):
                continue
            wall.add((r, c))
        if grid_paths_dp(rows, cols, wall) != grid_paths_enumerate(rows, cols, wall):
            bad += 1
            print(f"    불일치! rows={rows} cols={cols} wall={sorted(wall)}")
    print(f"    300회 무작위 대조, 불일치 {bad}건")
    print(f"    본문 예제 5×6, 벽 (1,2)(2,4): DP={grid_paths_dp(5, 6, {(1,2),(2,4)})}"
          f" 열거={grid_paths_enumerate(5, 6, {(1,2),(2,4)})}")
    print(f"    벽 없는 5×6: DP={grid_paths_dp(5, 6, set())} (C(9,4)=126)")

    print("\n[2] 편집 거리 — DP vs 완전탐색 재귀 vs 롤링, 그리고 복원 검증")
    bad = 0
    alphabet = "abcd"
    for _ in range(400):
        a = "".join(random.choice(alphabet) for _ in range(random.randint(0, 7)))
        b = "".join(random.choice(alphabet) for _ in range(random.randint(0, 7)))
        d, dp = edit_dp(a, b)
        if d != edit_brute(a, b) or d != edit_rolling(a, b):
            bad += 1
            print(f"    불일치! a={a!r} b={b!r} dp={d} brute={edit_brute(a,b)} roll={edit_rolling(a,b)}")
            continue
        ops = edit_ops(a, b, dp)
        if len(ops) != d or apply_ops(a, ops) != b:
            bad += 1
            print(f"    복원 실패! a={a!r} b={b!r} d={d} ops={ops} -> {apply_ops(a, ops)!r}")
    print(f"    400회 무작위 대조(값·롤링·복원), 불일치 {bad}건")

    for a, b in (("abc", "yabd"), ("kitten", "sitting"), ("sunday", "saturday"), ("cat", "cat")):
        d, dp = edit_dp(a, b)
        ops = edit_ops(a, b, dp)
        print(f"    {a!r} -> {b!r} : 거리 {d}, 연산 {ops}, 적용 결과 {apply_ops(a, ops)!r}")

    print("\n[3] 전체 표 vs 두 줄 롤링 (문자열 길이 3000×3000)")
    n = 3000
    a = "".join(random.choice("abcdefgh") for _ in range(n))
    b = "".join(random.choice("abcdefgh") for _ in range(n))

    tracemalloc.start()
    t0 = time.perf_counter()
    d_full, _dp = edit_dp(a, b)
    t_full = time.perf_counter() - t0
    _, peak_full = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    del _dp

    tracemalloc.start()
    t0 = time.perf_counter()
    d_roll = edit_rolling(a, b)
    t_roll = time.perf_counter() - t0
    _, peak_roll = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert d_full == d_roll
    print(f"    거리 {d_full} (두 판 일치)")
    print(f"    전체 표 {t_full*1000:9.1f} ms  최대 메모리 {peak_full/1024/1024:8.2f} MB")
    print(f"    두 줄   {t_roll*1000:9.1f} ms  최대 메모리 {peak_roll/1024/1024:8.2f} MB")
    print(f"    메모리 비 {peak_full / max(peak_roll, 1):.0f}배")

    print("\n[4] 완전탐색 재귀가 언제 죽는가 (편집 거리, 같은 길이 문자열)")
    for k in (6, 8, 10, 12):
        a = "a" * k
        b = "b" * k
        t0 = time.perf_counter()
        edit_brute(a, b)
        el = time.perf_counter() - t0
        print(f"    길이 {k:>3} : {el*1000:9.1f} ms")


if __name__ == "__main__":
    main()
