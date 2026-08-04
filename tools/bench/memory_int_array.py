#!/usr/bin/env python3
"""I-2 — 정수 1천만 개를 담는 세 가지 방법의 실제 메모리 사용량.

메모리 제한 역산에서 쓰이는 수치의 근거다. 제약조건의 "메모리 제한 128MB"는
`int` 배열 몇 개까지 허용되는가로 번역되는데, 그 환산이 언어마다 다르다.

측정 방법: 케이스마다 새 프로세스를 띄우고 그 프로세스가 스스로 자신의 최대
상주 메모리(RUSAGE_SELF 의 ru_maxrss)를 찍게 한다. 부모에서 RUSAGE_CHILDREN
을 읽으면 그 값이 자식 전체의 최대값이라 단조 증가해서 두 번째 케이스부터
가려진다. sys.getsizeof 도 쓸 수 없다 — 컨테이너 자신의 크기만 돌려주고
원소 객체의 크기를 빼먹기 때문이다.

사용법: python3.13 tools/bench/memory_int_array.py
"""

from __future__ import annotations

import subprocess
import sys

N = 10_000_000

CASES = {
    "list(range(N))": f"a = list(range({N}))",
    "list, 값이 전부 0": f"a = [0] * {N}",
    "array('i')": f"import array; a = array.array('i', bytes(4 * {N}))",
    "bytearray(N)": f"a = bytearray({N})",
    "baseline (빈 인터프리터)": "a = None",
}

REPORT = (
    "\nimport resource;"
    "print(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)"
)


def peak_mb(stmt: str) -> float:
    """stmt 를 실행한 새 프로세스가 스스로 보고한 최대 상주 메모리(MB)."""
    out = subprocess.run(
        [sys.executable, "-c", stmt + REPORT],
        check=True,
        capture_output=True,
        text=True,
    )
    return int(out.stdout.strip()) / 1024.0  # ru_maxrss 는 리눅스에서 KB 단위


def main() -> None:
    print(f"N = {N:,}  (Python {sys.version.split()[0]})")
    print(f"  {'자료구조':<26} | 최대 상주 메모리 | 원소당 바이트")
    for name, stmt in CASES.items():
        peak = peak_mb(stmt)
        per = peak * 1024 * 1024 / N
        print(f"  {name:<24} | {peak:>13.1f} MB | {per:>10.1f} B")


if __name__ == "__main__":
    main()
