#!/usr/bin/env python3
"""II-9 본문 수치 — Python 에는 균형 트리가 없다. 그래서 무엇으로 버티는가.

측정 1  삽입 n 번 + "x 이상인 가장 작은 키" 질의 n 번
          (a) bisect.insort  — 삽입이 O(n) 이지만 이동이 C 레벨 memmove
          (b) 직접 짠 BST    — 삽입·질의가 평균 O(log n) 이지만 전부 인터프리터
측정 2  insort 의 크기별 증가율. O(n^2) 이면 n 을 두 배로 늘렸을 때 4배가 된다.

실행:  python3.13 tools/bench/ordered_insert_cost.py
"""

from __future__ import annotations

import bisect
import random
import time

REPEAT = 3


def median(xs: list[float]) -> float:
    return sorted(xs)[len(xs) // 2]


def run_insort(ins: list[int], qry: list[int]) -> int:
    a: list[int] = []
    total = 0
    for x, q in zip(ins, qry):
        bisect.insort(a, x)
        i = bisect.bisect_left(a, q)
        if i < len(a):
            total += a[i]
    return total


class BST:
    """균형을 잡지 않는 이진 탐색 트리. 노드를 배열 세 개로 나눠 담는다."""

    __slots__ = ("key", "left", "right")

    def __init__(self) -> None:
        self.key: list[int] = []
        self.left: list[int] = []
        self.right: list[int] = []

    def insert(self, v: int) -> None:
        key, left, right = self.key, self.left, self.right
        if not key:
            key.append(v); left.append(-1); right.append(-1)
            return
        cur = 0
        while True:
            if v < key[cur]:
                if left[cur] == -1:
                    left[cur] = len(key)
                    break
                cur = left[cur]
            else:
                if right[cur] == -1:
                    right[cur] = len(key)
                    break
                cur = right[cur]
        key.append(v); left.append(-1); right.append(-1)

    def lower_bound(self, v: int) -> int | None:
        """v 이상인 키 중 가장 작은 것. 없으면 None."""
        key, left, right = self.key, self.left, self.right
        cur, best = 0 if key else -1, None
        while cur != -1:
            if key[cur] >= v:
                best = key[cur]
                cur = left[cur]
            else:
                cur = right[cur]
        return best


def run_bst(ins: list[int], qry: list[int]) -> int:
    t = BST()
    total = 0
    for x, q in zip(ins, qry):
        t.insert(x)
        r = t.lower_bound(q)
        if r is not None:
            total += r
    return total


def bench(fn, *args):
    times, out = [], None
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        out = fn(*args)
        times.append(time.perf_counter() - t0)
    return median(times), out


def main() -> None:
    rnd = random.Random(20240817)
    n = 200_000
    ins = [rnd.randrange(10 ** 9) for _ in range(n)]
    qry = [rnd.randrange(10 ** 9) for _ in range(n)]

    print(f"== 측정 1: 삽입 {n:,}회 + 하한 질의 {n:,}회 ==")
    t_ins, r1 = bench(run_insort, ins, qry)
    t_bst, r2 = bench(run_bst, ins, qry)
    assert r1 == r2, (r1, r2)
    print(f"  bisect.insort : {t_ins:7.3f} 초  (1.00 배)")
    print(f"  직접 짠 BST   : {t_bst:7.3f} 초  ({t_bst / t_ins:.2f} 배)")

    print("\n== 측정 2: insort 의 크기별 증가율 ==")
    prev = None
    for m in (100_000, 200_000, 400_000, 800_000):
        data = [rnd.randrange(10 ** 9) for _ in range(m)]
        t, _ = bench(run_insort, data, data)
        ratio = f"{t / prev:.2f} 배" if prev else "-"
        print(f"  n = {m:>7,} : {t:7.3f} 초   직전 대비 {ratio}")
        prev = t


if __name__ == "__main__":
    main()
