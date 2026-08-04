#!/usr/bin/env python3
"""III-6 — 불변식 검사를 코드에 박아 두면 얼마나 느려지는가 (Python).

시뮬레이션 한 스텝마다 불변식 두 개를 assert 로 검사한다.

  - 좌표가 격자 안에 있다
  - 살아 있는 개체 수가 보존된다

`python3.13 -O` 로 돌리면 assert 문이 통째로 사라진다. 같은 파일을 두 모드로
돌려 그 차이를 잰다. 제출 직전에 지우는 것이 아니라 **끄는** 것이라는 사실이
이 스크립트의 요점이다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13).
사용법: python3.13 tools/bench/invariant_cost.py
"""

from __future__ import annotations

import subprocess
import sys
import time

H = W = 50
STEPS = 1_000_000
DR = (-1, 0, 1, 0)
DC = (0, 1, 0, -1)


def run() -> tuple[int, float]:
    r = c = 0
    alive = 7
    t0 = time.perf_counter()
    for step in range(STEPS):
        d = step & 3
        nr, nc = r + DR[d], c + DC[d]
        if 0 <= nr < H and 0 <= nc < W:
            r, c = nr, nc
        assert 0 <= r < H and 0 <= c < W, f"좌표가 격자를 벗어났다: {(r, c)}"
        assert alive == 7, f"개체 수가 보존되지 않았다: {alive}"
    return r * W + c, time.perf_counter() - t0


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--child":
        val, dt = run()
        print(f"{val} {dt:.4f}")
        return

    out = {}
    for label, opt in (("assert 켬", []), ("assert 끔 (-O)", ["-O"])):
        best = []
        for _ in range(3):
            r = subprocess.run(
                [sys.executable, *opt, __file__, "--child"],
                capture_output=True,
                text=True,
            )
            val, dt = r.stdout.split()
            best.append(float(dt))
        out[label] = sorted(best)[1]
        print(f"{label:<16} {out[label]:8.4f}초   (체크섬 {val})")
    a, b = out["assert 켬"], out["assert 끔 (-O)"]
    print(f"\n{STEPS:,} 스텝 · 스텝당 assert 2개 — 검사 비용 {a - b:.4f}초 ({a / b:.2f}배)")


if __name__ == "__main__":
    main()
