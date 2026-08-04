#!/usr/bin/env python3
"""0-2 — input() vs sys.stdin.readline vs sys.stdin.buffer 읽기 속도.

왜 하위 프로세스를 쓰는가: input() 은 sys.stdin 을 통째로 소비하므로 한 프로세스
안에서 세 방식을 연달아 잴 수 없다. 같은 파일을 stdin 으로 물린 자식 프로세스를
세 번 띄워 각각 벽시계 시간을 잰다.

사용법: python3.13 tools/bench/py_input_readline.py
"""
import os
import subprocess
import sys
import tempfile
import time

N = 1_000_000
REPEAT = 3

READERS = {
    "input()": (
        "import sys\n"
        "n=int(input())\n"
        "s=0\n"
        "for _ in range(n): s+=int(input())\n"
        "print(s, file=sys.stderr)\n"
    ),
    "sys.stdin.readline": (
        "import sys\n"
        "rl=sys.stdin.readline\n"
        "n=int(rl())\n"
        "s=0\n"
        "for _ in range(n): s+=int(rl())\n"
        "print(s, file=sys.stderr)\n"
    ),
    "sys.stdin.buffer.read().split()": (
        "import sys\n"
        "d=sys.stdin.buffer.read().split()\n"
        "n=int(d[0])\n"
        "s=0\n"
        "for i in range(1,n+1): s+=int(d[i])\n"
        "print(s, file=sys.stderr)\n"
    ),
}


def main() -> None:
    fd, path = tempfile.mkstemp(suffix=".txt")
    with os.fdopen(fd, "w") as f:
        f.write(f"{N}\n")
        f.write("".join(f"{i % 1000}\n" for i in range(N)))

    print(f"입력: {N:,}줄 (파일 {os.path.getsize(path):,} 바이트)")
    base = None
    for name, src in READERS.items():
        best = min(_time_once(src, path) for _ in range(REPEAT))
        if base is None:
            base = best
        print(f"  {name:<32} {best:6.3f}s   x{base / best:4.1f} 빠름")
    os.remove(path)


def _time_once(src: str, path: str) -> float:
    with open(path, "rb") as fin:
        t = time.perf_counter()
        subprocess.run(
            [sys.executable, "-c", src],
            stdin=fin,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        return time.perf_counter() - t


if __name__ == "__main__":
    main()
