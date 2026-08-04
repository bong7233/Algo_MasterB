"""상태 스냅샷의 세 가지 방식 비용 — III-5 §4의 ::: perf 근거.

측정 대상
    (a) copy.deepcopy(grid)      — 중첩 리스트를 재귀적으로 전부 새로 만든다
    (b) [row[:] for row in grid] — 행만 얕게 복사한다 (원소가 불변이면 충분)
    (c) 한 칸 바꾸고 되돌리기     — 복사를 아예 안 한다

실행: python3.13 tools/bench/sim_snapshot_cost.py
환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
"""

from __future__ import annotations

import copy
import statistics
import sys
import timeit

N = 50
REPEAT = 3
LOOPS = 2000


def make_grid() -> list[list[int]]:
    return [[(r * N + c) % 7 for c in range(N)] for r in range(N)]


def bench(stmt, setup_globals, loops=LOOPS):
    t = timeit.Timer(stmt, globals=setup_globals)
    return statistics.median(t.repeat(REPEAT, loops))


def main() -> int:
    g = make_grid()
    env = {"g": g, "copy": copy, "N": N}

    deep = bench("copy.deepcopy(g)", env)
    shallow = bench("[row[:] for row in g]", env)
    restore = bench(
        "old = g[7][11]\ng[7][11] = 9\ng[7][11] = old",
        env,
    )

    print(f"격자 {N}x{N}, 각 {LOOPS}회 (3회 실행의 중앙값)")
    print(f"  deepcopy          : {deep:.4f}초")
    print(f"  행별 얕은 복사     : {shallow:.4f}초   ({deep / shallow:.0f}배 빠름)")
    print(f"  한 칸 바꾸고 되돌림 : {restore:.6f}초 ({deep / restore:.0f}배 빠름)")

    # 얕은 복사의 함정: 원소가 리스트면 안쪽이 공유된다.
    nested = [[[0]] * 3 for _ in range(3)]
    sh = [row[:] for row in nested]
    sh[0][0][0] = 1
    print(f"  얕은 복사가 원본을 오염시키는가: {nested[0][0][0] == 1}")

    # [[0]*n]*m 별칭 함정 (0-3 연결)
    bad = [[0] * 3] * 3
    bad[0][0] = 1
    print(f"  [[0]*3]*3 에서 한 칸을 바꾸면 몇 행이 바뀌는가: {sum(r[0] == 1 for r in bad)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
