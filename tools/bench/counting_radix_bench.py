#!/usr/bin/env python3
"""II-7 — 계수 정렬이 시간이 아니라 메모리를 사기도 한다 (Python 쪽).

`list.sort()` 는 C 로 짠 Timsort 라 순수 파이썬 루프로 짠 계수 정렬보다 대개
빠르다. 그래서 Python 에서 계수 정렬을 쓰는 이유는 속도가 아니다.
==정수 1,000만 개를 리스트로 들고 있으면 메모리가 먼저 터진다.==

이 스크립트는 같은 입력을 두 방법으로 처리하고 **최대 상주 메모리(RSS)** 를
잰다. 모드마다 프로세스를 새로 띄운다 — RSS 는 최고 수위선이라 한 프로세스
안에서 두 방법을 재면 뒤쪽이 앞쪽에 오염된다.

사용법:
    python3.13 tools/bench/counting_radix_bench.py
"""
from __future__ import annotations

import resource
import subprocess
import sys
import time

N = 2_000_000
K = 10_000
SEED = 20250804


def make_ints() -> list[int]:
    import random

    random.seed(SEED)
    return [random.randrange(1, K + 1) for _ in range(N)]


def counting_sort(a: list[int], k: int) -> list[int]:
    cnt = [0] * (k + 1)
    for x in a:
        cnt[x] += 1
    out = []
    for v in range(1, k + 1):
        out.extend([v] * cnt[v])   # 같은 값을 통째로 이어 붙인다. 이 확장은 C 루프다
    return out


def mode_sort() -> None:
    a = make_ints()
    t = time.perf_counter()
    a.sort()
    dt = time.perf_counter() - t
    report("list.sort()", dt, a[0], a[-1])


def mode_count() -> None:
    a = make_ints()
    t = time.perf_counter()
    out = counting_sort(a, K)
    dt = time.perf_counter() - t
    report("계수 정렬", dt, out[0], out[-1])


def mode_count_nolist() -> None:
    """원본 리스트를 들고 있지 않는 경우 — 읽으면서 바로 세면 이렇게 된다.

    주의: 이 모드의 시간에는 입력 생성이 섞여 있다(생성을 미리 해 두면 리스트를
    들게 되어 재려던 것이 사라진다). 비교할 값은 시간이 아니라 RSS 열이다.
    """
    import random

    random.seed(SEED)
    cnt = [0] * (K + 1)
    t = time.perf_counter()
    for _ in range(N):
        cnt[random.randrange(1, K + 1)] += 1
    dt = time.perf_counter() - t
    report("계수 정렬(입력 미보관·생성 포함)", dt, 0, 0)


def report(name: str, dt: float, lo: int, hi: int) -> None:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(f"{name}\t{dt:.3f}\t{rss:.1f}\t{lo}\t{hi}")


MODES = {
    "sort": mode_sort,
    "count": mode_count,
    "count-nolist": mode_count_nolist,
}


def main() -> None:
    if len(sys.argv) > 1:
        MODES[sys.argv[1]]()
        return

    print(f"n = {N:,}, 값 범위 K = {K:,}  (Python 3.13)")
    print(f"{'방법':<24} {'시간':>8} {'최대 RSS':>12}")
    print("-" * 48)
    for m in MODES:
        r = subprocess.run(
            [sys.executable, __file__, m], capture_output=True, text=True, check=True
        )
        name, dt, rss, *_ = r.stdout.strip().split("\t")
        print(f"{name:<24} {float(dt):>7.3f}초 {float(rss):>10.1f} MB")


if __name__ == "__main__":
    main()
