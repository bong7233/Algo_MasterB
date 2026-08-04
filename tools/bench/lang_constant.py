#!/usr/bin/env python3
"""0-10 — Python 과 C++ 의 상수 배수 (Python 쪽).

계산 루프의 배수는 `ops_budget.py` 에서 잰다. 이 스크립트는 그 표가 다루지
않는 세 축을 잰다.

    1. 입출력 — 코테에서 TLE 의 상당수가 알고리즘이 아니라 여기서 난다
    2. 재귀   — 호출 프레임 비용과 깊이 한계
    3. 문자열 — 누적 방식에 따라 복잡도 자체가 달라진다

`lang_constant.cpp` 와 워크로드가 1:1 로 대응한다.

사용법:
    python3.13 tools/bench/lang_constant.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

N_INPUT = 1_000_000
DATA = "/tmp/algobook_lang_constant_input.txt"
REPS = 3


def median(xs):
    return sorted(xs)[len(xs) // 2]


def make_input():
    if os.path.exists(DATA) and os.path.getsize(DATA) > 0:
        return
    with open(DATA, "w") as f:
        f.write(f"{N_INPUT}\n")
        f.write("\n".join(str((i * 2654435761) % 1000000007) for i in range(N_INPUT)))
        f.write("\n")


# --- 입력: 같은 파일을 세 가지 방법으로 읽는다 -----------------------------
READERS = {
    "input()": r"""
import sys
n = int(input()); s = 0
for _ in range(n): s += int(input())
print(s)
""",
    "sys.stdin.readline": r"""
import sys
rl = sys.stdin.readline
n = int(rl()); s = 0
for _ in range(n): s += int(rl())
print(s)
""",
    "sys.stdin.buffer.read().split()": r"""
import sys
data = sys.stdin.buffer.read().split()
n = int(data[0]); s = 0
for i in range(1, n + 1): s += int(data[i])
print(s)
""",
}

WRITERS = {
    "print() 줄마다": r"""
import sys
n = 1000000
for i in range(n): print(i)
""",
    "sys.stdout.write + join": r"""
import sys
n = 1000000
sys.stdout.write("\n".join(map(str, range(n))))
sys.stdout.write("\n")
""",
}


def time_script(src, stdin_path=None):
    path = "/tmp/algobook_lc_tmp.py"
    with open(path, "w") as f:
        f.write(src)
    ts = []
    for _ in range(REPS):
        fin = open(stdin_path, "rb") if stdin_path else subprocess.DEVNULL
        fout = open(os.devnull, "wb")
        t = time.perf_counter()
        subprocess.run([sys.executable, path], stdin=fin, stdout=fout, check=True)
        ts.append(time.perf_counter() - t)
        if stdin_path:
            fin.close()
        fout.close()
    return median(ts)


# --- 재귀 ------------------------------------------------------------------
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)


def fib_iter(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def depth(n):
    if n == 0:
        return 0
    return 1 + depth(n - 1)


# --- 문자열 ----------------------------------------------------------------
def str_concat(n):
    s = ""
    for i in range(n):
        s += "x"
    return len(s)


def str_join(n):
    return len("".join("x" for _ in range(n)))


def main():
    make_input()
    print(f"입력 파일: {DATA}  ({os.path.getsize(DATA):,} 바이트, 정수 {N_INPUT:,}개)")

    print("\n=== 입력 읽기 (정수 100만 개) ===")
    base = None
    for name, src in READERS.items():
        el = time_script(src, DATA)
        if base is None:
            base = el
        print(f"  {name:<34} {el:7.3f}s   가장 느린 방법 대비 x{base / el:5.1f}")

    print("\n=== 출력 쓰기 (정수 100만 줄) ===")
    base = None
    for name, src in WRITERS.items():
        el = time_script(src)
        if base is None:
            base = el
        print(f"  {name:<34} {el:7.3f}s   가장 느린 방법 대비 x{base / el:5.1f}")

    print("\n=== 재귀 ===")
    ts = []
    for _ in range(REPS):
        t = time.perf_counter()
        fib(30)
        ts.append(time.perf_counter() - t)
    rec = median(ts)
    calls = 2692537  # fib(30) 의 실제 호출 횟수
    print(f"  fib(30) 재귀       {rec:7.3f}s   호출 {calls:,}회 -> {rec / calls * 1e9:.0f} ns/호출")
    ts = []
    for _ in range(REPS):
        t = time.perf_counter()
        fib_iter(30)
        ts.append(time.perf_counter() - t)
    print(f"  fib(30) 반복       {median(ts) * 1e6:7.3f}us  (같은 답, 호출 0회)")

    print("\n  재귀 깊이 한계:")
    print(f"    기본 sys.getrecursionlimit() = {sys.getrecursionlimit():,}")
    try:
        depth(sys.getrecursionlimit() + 100)
        print("    기본 한계 + 100: 통과 (예상 밖)")
    except RecursionError:
        print("    기본 한계 + 100: RecursionError")
    sys.setrecursionlimit(300_000)
    for d in (10_000, 100_000, 200_000):
        try:
            depth(d)
            print(f"    setrecursionlimit(300000) 후 깊이 {d:>7,}: 통과")
        except RecursionError:
            print(f"    setrecursionlimit(300000) 후 깊이 {d:>7,}: RecursionError")

    print("\n=== 문자열 누적 (100만 문자) ===")
    n = 1_000_000
    ts = []
    for _ in range(REPS):
        t = time.perf_counter()
        str_concat(n)
        ts.append(time.perf_counter() - t)
    c = median(ts)
    ts = []
    for _ in range(REPS):
        t = time.perf_counter()
        str_join(n)
        ts.append(time.perf_counter() - t)
    j = median(ts)
    print(f"  s += 'x'  {c:7.4f}s")
    print(f"  ''.join   {j:7.4f}s   x{c / j:.1f}")


if __name__ == "__main__":
    main()
