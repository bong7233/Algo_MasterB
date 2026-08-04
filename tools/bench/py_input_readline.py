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


CPP_SRC = r"""
#include <cstdio>
#include <iostream>
using namespace std;
int main(int argc, char** argv) {
    if (argc > 1) { ios_base::sync_with_stdio(false); cin.tie(nullptr); }
    int n, x; long long s = 0;
    cin >> n;
    for (int i = 0; i < n; i++) { cin >> x; s += x; }
    fprintf(stderr, "%lld\n", s);
    return 0;
}
"""


def main() -> None:
    fd, path = tempfile.mkstemp(suffix=".txt")
    with os.fdopen(fd, "w") as f:
        f.write(f"{N}\n")
        f.write("".join(f"{i % 1000}\n" for i in range(N)))

    print(f"입력: {N:,}줄 (파일 {os.path.getsize(path):,} 바이트)")
    print("\n[Python] 같은 합을 구하는 세 가지 읽기 방식")
    base = None
    for name, src in READERS.items():
        best = min(_time_once(src, path) for _ in range(REPEAT))
        if base is None:
            base = best
        print(f"  {name:<32} {best:6.3f}s   x{base / best:4.1f} 빠름")

    print("\n[분해] input() 의 3.8배는 어디서 오는가")
    _breakdown(path)

    print("\n[C++] 같은 입력, 같은 계산 — 비교 기준선")
    _cpp(path)
    os.remove(path)
    _output()


# 읽기만 하고 계산은 하지 않는다. 순수한 한 줄 읽기 비용만 남긴다.
BREAKDOWN = {
    "readline() 만": "import sys\nrl=sys.stdin.readline\nfor _ in range(%d): rl()\n",
    "readline().rstrip()": (
        "import sys\nrl=sys.stdin.readline\nfor _ in range(%d): rl().rstrip()\n"
    ),
    "input()": "for _ in range(%d): input()\n",
}


def _breakdown(path: str) -> None:
    for name, tmpl in BREAKDOWN.items():
        best = min(_time_once(tmpl % N, path) for _ in range(REPEAT))
        print(f"  {name:<32} {best:6.3f}s")
    print("  -> rstrip 이 차지하는 몫은 작다. 나머지는 input() 자신의 호출 비용이다")


WRITERS = {
    "print(x) 를 n 번": "for i in range(%d): print(i)\n" % N,
    "sys.stdout.write": (
        "import sys\nw=sys.stdout.write\nfor i in range(%d): w(f'{i}\\n')\n" % N
    ),
    "'\\n'.join 한 번에": (
        "import sys\nsys.stdout.write('\\n'.join(map(str, range(%d))) + '\\n')\n" % N
    ),
}


def _output() -> None:
    """출력도 같은 병목이다. 표준 출력을 /dev/null 로 버리고 순수 비용만 잰다."""
    print(f"\n[Python] 같은 {N:,}줄을 쓰는 세 가지 방식 (출력은 /dev/null)")
    base = None
    for name, src in WRITERS.items():
        best = min(_time_out(src) for _ in range(REPEAT))
        if base is None:
            base = best
        print(f"  {name:<32} {best:6.3f}s   x{base / best:4.1f} 빠름")


def _time_out(src: str) -> float:
    with open(os.devnull, "wb") as out:
        t = time.perf_counter()
        subprocess.run([sys.executable, "-c", src], stdout=out, check=True)
        return time.perf_counter() - t


def _cpp(path: str) -> None:
    """C++ 쪽 기준선. 자세한 해부는 0-5 에 있고 여기서는 자릿수만 본다."""
    src = tempfile.mktemp(suffix=".cpp")
    exe = tempfile.mktemp()
    with open(src, "w") as f:
        f.write(CPP_SRC)
    r = subprocess.run(
        ["g++", "-std=c++17", "-O2", src, "-o", exe],
        capture_output=True,
    )
    if r.returncode != 0:
        print("  (g++ 없음 — 건너뜀)")
        return
    for name, args in (("cin (동기화 기본값)", []), ("cin + sync_with_stdio(false)", ["1"])):
        best = min(_time_exe([exe] + args, path) for _ in range(REPEAT))
        print(f"  {name:<32} {best:6.3f}s")
    os.remove(src)
    os.remove(exe)


def _time_exe(cmd: list[str], path: str) -> float:
    with open(path, "rb") as fin:
        t = time.perf_counter()
        subprocess.run(cmd, stdin=fin, stderr=subprocess.DEVNULL, check=True)
        return time.perf_counter() - t


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
