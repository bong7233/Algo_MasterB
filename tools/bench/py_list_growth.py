#!/usr/bin/env python3
"""0-3 — list 의 실제 과할당(over-allocation) 패턴과 앞/뒤 삽입 비용.

sys.getsizeof 는 객체 자신의 크기만 돌려준다. list 의 경우 헤더 + 포인터
배열의 바이트 수이고, 원소 객체의 크기는 포함하지 않는다. 그래서 이 값의
계단이 곧 재할당 시점이다.

사용법: python3.13 tools/bench/py_list_growth.py
"""
import sys
import time
from collections import deque

PTR = 8  # x86-64 CPython 의 PyObject* 크기


def growth_steps(limit: int = 200) -> None:
    a: list[int] = []
    prev = sys.getsizeof(a)
    print(f"len=0 에서 getsizeof={prev} 바이트 (빈 헤더)")
    header = prev
    print("  len | getsizeof | 확보된 슬롯 | 직전 대비 증가")
    for i in range(limit):
        a.append(i)
        cur = sys.getsizeof(a)
        if cur != prev:
            slots = (cur - header) // PTR
            print(f"  {len(a):>4} | {cur:>9} | {slots:>10} | +{(cur - prev) // PTR} 슬롯")
            prev = cur


def front_vs_back(n: int = 100_000) -> None:
    print(f"\n앞쪽 삽입 {n:,}회")
    a: list[int] = []
    t = time.perf_counter()
    for i in range(n):
        a.insert(0, i)
    li = time.perf_counter() - t

    d: deque[int] = deque()
    t = time.perf_counter()
    for i in range(n):
        d.appendleft(i)
    dq = time.perf_counter() - t

    b: list[int] = []
    t = time.perf_counter()
    for i in range(n):
        b.append(i)
    ap = time.perf_counter() - t

    print(f"  list.insert(0, x)   {li:8.4f}s")
    print(f"  deque.appendleft(x) {dq:8.4f}s   x{li / dq:,.0f} 빠름")
    print(f"  list.append(x)      {ap:8.4f}s   x{li / ap:,.0f} 빠름")


def front_pop(n: int = 100_000) -> None:
    print(f"\n앞쪽 제거 {n:,}회")
    a = list(range(n))
    t = time.perf_counter()
    while a:
        a.pop(0)
    li = time.perf_counter() - t

    d = deque(range(n))
    t = time.perf_counter()
    while d:
        d.popleft()
    dq = time.perf_counter() - t
    print(f"  list.pop(0)     {li:8.4f}s")
    print(f"  deque.popleft() {dq:8.4f}s   x{li / dq:,.0f} 빠름")


def quadratic_check() -> None:
    print("\ninsert(0, x) 가 정말 O(n^2) 인가 — n 을 2배씩")
    prev = None
    for n in (25_000, 50_000, 100_000, 200_000):
        a: list[int] = []
        t = time.perf_counter()
        for i in range(n):
            a.insert(0, i)
        el = time.perf_counter() - t
        ratio = "" if prev is None else f"   직전 대비 x{el / prev:.1f}"
        print(f"  n={n:>7,} {el:7.4f}s{ratio}")
        prev = el


if __name__ == "__main__":
    growth_steps()
    front_vs_back()
    front_pop()
    quadratic_check()
