"""이중 버퍼의 실제 비용 — III-6 §4의 ::: perf 근거.

"동시 갱신은 새 격자가 필요해서 느리다"는 통념을 재는 스크립트다.
같은 확산 스텝을 세 방식으로 T턴 돌린다.

    (a) 매 턴 새 격자 할당      — 가장 순진한 이중 버퍼
    (b) 버퍼 두 개를 미리 잡고 교환 — 할당이 두 번뿐이다
    (c) 제자리 갱신              — 규칙을 어기지만 비용의 하한선

실행: python3.13 tools/bench/sim_double_buffer_cost.py
환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
"""

from __future__ import annotations

import statistics
import sys
import time

R = C = 50
TURNS = 300
REPEAT = 3


def seed():
    return [[(r * C + c) % 5 for c in range(C)] for r in range(R)]


def step_into(src, dst):
    """src 를 읽어 dst 에 쓴다. 읽는 곳과 쓰는 곳이 절대 겹치지 않는다."""
    for r in range(R):
        sr = src[r]
        dr = dst[r]
        up = src[r - 1] if r > 0 else None
        dn = src[r + 1] if r + 1 < R else None
        for c in range(C):
            s = sr[c]
            if c > 0:
                s += sr[c - 1]
            if c + 1 < C:
                s += sr[c + 1]
            if up is not None:
                s += up[c]
            if dn is not None:
                s += dn[c]
            dr[c] = s % 5


def run_alloc():
    g = seed()
    for _ in range(TURNS):
        nxt = [[0] * C for _ in range(R)]
        step_into(g, nxt)
        g = nxt
    return g[7][11]


def run_swap():
    g = seed()
    buf = [[0] * C for _ in range(R)]
    for _ in range(TURNS):
        step_into(g, buf)
        g, buf = buf, g
    return g[7][11]


def run_inplace():
    g = seed()
    for _ in range(TURNS):
        step_into(g, g)  # 읽는 곳과 쓰는 곳이 같다 — 결과가 규칙과 다르다
    return g[7][11]


def timed(fn):
    out = []
    val = None
    for _ in range(REPEAT):
        t = time.perf_counter()
        val = fn()
        out.append(time.perf_counter() - t)
    return statistics.median(out), val


def main() -> int:
    a, va = timed(run_alloc)
    b, vb = timed(run_swap)
    c, vc = timed(run_inplace)
    print(f"격자 {R}x{C}, {TURNS}턴 (3회 실행의 중앙값)")
    print(f"  매 턴 새 격자 할당 : {a:.4f}초   결과 {va}")
    print(f"  버퍼 두 개 교환    : {b:.4f}초   결과 {vb}   ({(a - b) / a * 100:.1f}% 절감)")
    print(f"  제자리 갱신        : {c:.4f}초   결과 {vc}")
    print(f"  제자리 갱신의 답이 이중 버퍼와 같은가: {vc == va}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
