#!/usr/bin/env python3
"""0-5 §입출력 — cpp_io_sync.cpp 의 Python 대응.

같은 입력을 세 방식으로 읽고 각각의 시간을 표준 에러로 낸다.
C++ 쪽과 같은 구간(첫 읽기 직전 ~ 마지막 정수)만 잰다.

    python3.13 tools/bench/cpp_io_sync_py.py input   < input.txt
    python3.13 tools/bench/cpp_io_sync_py.py readline < input.txt
    python3.13 tools/bench/cpp_io_sync_py.py bufread  < input.txt
"""
import sys
import time


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "input"
    t0 = time.perf_counter()

    if mode == "input":
        n = int(input())
        total = 0
        for _ in range(n):
            total += int(input())
    elif mode == "readline":
        rl = sys.stdin.readline
        n = int(rl())
        total = 0
        for _ in range(n):
            total += int(rl())
    else:  # bufread — 전부 읽고 한 번에 쪼갠다
        data = sys.stdin.buffer.read().split()
        n = int(data[0])
        total = sum(map(int, data[1 : n + 1]))

    sec = time.perf_counter() - t0
    print(f"{mode} n={n} sum={total} {sec:.4f}", file=sys.stderr)


if __name__ == "__main__":
    main()
