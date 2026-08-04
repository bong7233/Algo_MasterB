#!/usr/bin/env python3
"""III-1 — 재귀의 실제 비용: 깊이 한도와 프레임 값

세 가지를 잰다.

  A. 기본 재귀 한도에서 실제로 도달하는 깊이 (sys.setrecursionlimit 을 건드리지 않은 상태)
  B. 한도를 크게 올렸을 때 무슨 일이 일어나는가 — 한도는 파이썬이 세는 숫자일 뿐이고
     진짜 한계는 OS 가 준 C 스택이다
  C. 같은 계산을 재귀로 짤 때와 반복으로 짤 때의 시간

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13).
사용법: python3.13 tools/bench/recursion_cost.py
"""

from __future__ import annotations

import resource
import subprocess
import sys
import time

PROBE = r"""
import sys
sys.setrecursionlimit({limit})
depth = 0
def go():
    global depth
    depth += 1
    go()
try:
    go()
except RecursionError:
    print("RecursionError", depth)
"""


def probe(limit: int) -> str:
    """자식 프로세스에서 바닥까지 내려가 본다. 죽으면 종료 신호를 그대로 보고한다.

    최대 상주 메모리(RSS)를 함께 재는 이유: 3.12 이후 CPython 은 파이썬 함수끼리의
    호출에 C 스택을 쓰지 않는다. 그래서 깊이 한도를 올리면 죽는 대신 **메모리를 먹는다.**
    한도가 사라진 것이 아니라 한도의 종류가 바뀐 것이다.
    """
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    r = subprocess.run(
        [sys.executable, "-c", PROBE.format(limit=limit)],
        capture_output=True,
        text=True,
    )
    after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    rss = max(after - before, 0) / 1024.0
    if r.returncode < 0:
        return f"프로세스가 신호 {-r.returncode} 로 죽음 (스택 오버플로), 자식 RSS {rss:.0f} MB"
    last = (r.stdout or r.stderr).strip().splitlines()[-1]
    return f"{last}, 자식 RSS {rss:.0f} MB"


def sum_rec(n: int) -> int:
    if n == 0:
        return 0
    return n + sum_rec(n - 1)


def sum_loop(n: int) -> int:
    total = 0
    for i in range(1, n + 1):
        total += i
    return total


def timeit(fn, *args, reps: int = 3) -> float:
    ts = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn(*args)
        ts.append(time.perf_counter() - t0)
    return sorted(ts)[len(ts) // 2]


def main() -> None:
    print(f"python: {sys.version.split()[0]}")
    print(f"기본 재귀 한도: {sys.getrecursionlimit()}")
    print("A. 기본 한도에서 도달한 깊이 :", probe(sys.getrecursionlimit()))
    print("B. 한도 1,000,000 으로 올린 뒤 :", probe(1_000_000))

    n, reps = 20_000, 200
    sys.setrecursionlimit(n + 100)
    t_rec = timeit(lambda: [sum_rec(n) for _ in range(reps // 10)])
    t_loop = timeit(lambda: [sum_loop(n) for _ in range(reps // 10)])
    print(
        f"C. 1..{n:,} 합 {reps // 10}회 — 재귀 {t_rec:.4f}초 / 반복 {t_loop:.4f}초 "
        f"(재귀가 {t_rec / t_loop:.1f}배)"
    )


if __name__ == "__main__":
    main()
