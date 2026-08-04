#!/usr/bin/env python3
"""II-8 본문 수치 — 힙이 없을 때의 비용과 heapify 의 실제 이득 (Python 쪽).

측정 1  스케줄러 루프: "가장 급한 것 하나를 꺼내고 새 작업을 하나 넣는다" 를
        n 번 반복한다. 세 가지 구현을 같은 입력으로 돌린다.
          (a) 매 스텝 정렬     — 리스트를 정렬해 맨 앞을 꺼낸다
          (b) 선형 최솟값 스캔 — 정렬하지 않고 매번 전체를 훑어 최솟값을 찾는다
          (c) 힙               — heapq

측정 2  빌드 비용: 같은 배열로 힙을 만드는 두 방법.
          (a) heappush 를 n 번
          (b) heapify 한 번

실행:  python3.13 tools/bench/heap_build_cost.py
"""

from __future__ import annotations

import heapq
import random
import time

REPEAT = 3


def median(xs: list[float]) -> float:
    return sorted(xs)[len(xs) // 2]


def bench(fn, *args) -> tuple[float, object]:
    times, out = [], None
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        out = fn(*args)
        times.append(time.perf_counter() - t0)
    return median(times), out


# ---------------------------------------------------------------- 측정 1

def loop_sort(tasks: list[int], incoming: list[int]) -> int:
    """매 스텝 정렬하고 맨 앞을 꺼낸다."""
    a = list(tasks)
    total = 0
    for x in incoming:
        a.sort()
        total += a[0]
        a[0] = x          # 꺼낸 자리에 새 작업을 넣는다 (다음 바퀴에 다시 정렬된다)
    return total


def loop_scan(tasks: list[int], incoming: list[int]) -> int:
    """정렬하지 않고 매번 전체를 훑어 최솟값을 찾는다."""
    a = list(tasks)
    total = 0
    for x in incoming:
        k = 0
        for i in range(1, len(a)):
            if a[i] < a[k]:
                k = i
        total += a[k]
        a[k] = x
    return total


def loop_heap(tasks: list[int], incoming: list[int]) -> int:
    a = list(tasks)
    heapq.heapify(a)
    total = 0
    for x in incoming:
        total += heapq.heapreplace(a, x)   # pop 후 push 를 한 번에
    return total


# ---------------------------------------------------------------- 측정 2

def build_push(data: list[int]) -> list[int]:
    h: list[int] = []
    for x in data:
        heapq.heappush(h, x)
    return h


def build_heapify(data: list[int]) -> list[int]:
    h = list(data)
    heapq.heapify(h)
    return h


def main() -> None:
    rnd = random.Random(20240817)

    n = 20_000
    tasks = [rnd.randrange(10 ** 9) for _ in range(n)]
    incoming = [rnd.randrange(10 ** 9) for _ in range(n)]

    print(f"== 측정 1: 스케줄러 루프 (작업 {n:,}개, 꺼내고 넣기 {n:,}회) ==")
    t_sort, r1 = bench(loop_sort, tasks, incoming)
    t_scan, r2 = bench(loop_scan, tasks, incoming)
    t_heap, r3 = bench(loop_heap, tasks, incoming)
    assert r1 == r2 == r3, (r1, r2, r3)     # 세 구현이 같은 답을 내야 비교가 성립한다
    print(f"  매 스텝 정렬     {t_sort:8.3f} 초   ({t_sort / t_heap:6.1f} 배)")
    print(f"  선형 최솟값 스캔 {t_scan:8.3f} 초   ({t_scan / t_heap:6.1f} 배)")
    print(f"  힙(heapq)        {t_heap:8.3f} 초   (   1.0 배)")

    m = 1_000_000
    data = [rnd.randrange(10 ** 9) for _ in range(m)]
    print(f"\n== 측정 2: 힙 빌드 ({m:,}개) ==")
    t_push, h1 = bench(build_push, data)
    t_heapify, h2 = bench(build_heapify, data)
    assert h1[0] == h2[0]
    print(f"  heappush {m:,}회 {t_push:8.3f} 초   ({t_push / t_heapify:6.2f} 배)")
    print(f"  heapify 한 번    {t_heapify:8.3f} 초   (   1.00 배)")


if __name__ == "__main__":
    main()
