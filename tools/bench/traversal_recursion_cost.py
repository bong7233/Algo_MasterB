#!/usr/bin/env python3
"""II-10 본문 수치 — 재귀 순회와 명시적 스택 순회의 실제 차이 (Python 쪽).

측정 1  균형 이진 트리(노드 100만, 깊이 20)를 후위 순회하며 서브트리 크기 합산
          (a) 재귀
          (b) 명시적 스택
측정 2  한쪽으로 늘어진 사슬 트리에서 재귀가 몇 깊이에 죽는가.
        기본 재귀 한도는 1000 이고, 그것이 트리 노드 수의 한계가 된다.

실행:  python3.13 tools/bench/traversal_recursion_cost.py
"""

from __future__ import annotations

import sys
import time

REPEAT = 3


def median(xs: list[float]) -> float:
    return sorted(xs)[len(xs) // 2]


def build_balanced(n: int) -> tuple[list[int], list[int]]:
    """완전 이진 트리. 노드 i 의 자식은 2i+1, 2i+2 이고 없으면 -1."""
    left = [(2 * i + 1) if 2 * i + 1 < n else -1 for i in range(n)]
    right = [(2 * i + 2) if 2 * i + 2 < n else -1 for i in range(n)]
    return left, right


def build_chain(n: int) -> tuple[list[int], list[int]]:
    """오른쪽으로만 뻗은 사슬. 정렬된 입력으로 만든 BST 와 같은 모양이다."""
    left = [-1] * n
    right = [(i + 1) if i + 1 < n else -1 for i in range(n)]
    return left, right


def post_recursive(left: list[int], right: list[int], root: int) -> int:
    def go(u: int) -> int:
        if u == -1:
            return 0
        return go(left[u]) + go(right[u]) + 1   # 자식이 먼저, 자기가 나중
    return go(root)


def post_iterative(left: list[int], right: list[int], root: int) -> int:
    size = 0
    stack = [(root, False)]
    while stack:
        u, expanded = stack.pop()
        if u == -1:
            continue
        if expanded:            # 자식을 이미 펼친 노드 — 이제 자기 차례다
            size += 1
        else:
            stack.append((u, True))
            stack.append((right[u], False))
            stack.append((left[u], False))
    return size


def bench(fn, *args):
    times, out = [], None
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        out = fn(*args)
        times.append(time.perf_counter() - t0)
    return median(times), out


def max_recursion_depth(left: list[int], right: list[int]) -> int:
    """기본 재귀 한도에서 몇 노드까지 내려가다 죽는가."""
    reached = 0

    def go(u: int, d: int) -> int:
        nonlocal reached
        if u == -1:
            return 0
        if d > reached:
            reached = d
        return go(left[u], d + 1) + go(right[u], d + 1) + 1

    try:
        go(0, 1)
        return -1                      # 끝까지 갔다
    except RecursionError:
        return reached


def main() -> None:
    n = 1_000_000
    left, right = build_balanced(n)
    print(f"== 측정 1: 균형 트리 {n:,}노드 후위 순회 ==")
    sys.setrecursionlimit(10_000)      # 깊이 20 이면 한도는 문제가 아니다
    t_rec, r1 = bench(post_recursive, left, right, 0)
    t_it, r2 = bench(post_iterative, left, right, 0)
    assert r1 == r2 == n, (r1, r2)
    print(f"  재귀        : {t_rec:7.3f} 초  (1.00 배)")
    print(f"  명시적 스택 : {t_it:7.3f} 초  ({t_it / t_rec:.2f} 배)")

    print("\n== 측정 2: 사슬 트리에서 재귀가 죽는 깊이 ==")
    sys.setrecursionlimit(1000)        # CPython 기본값
    print(f"  sys.getrecursionlimit() = {sys.getrecursionlimit()}")
    for m in (900, 10_000):
        cl, cr = build_chain(m)
        d = max_recursion_depth(cl, cr)
        if d == -1:
            print(f"  사슬 {m:>6,}노드 : 재귀 성공")
        else:
            print(f"  사슬 {m:>6,}노드 : RecursionError — 깊이 {d} 에서 멈춤")
        sys.setrecursionlimit(1000)
        t_it2, size = bench(post_iterative, cl, cr, 0)
        print(f"                     명시적 스택은 {size:,}노드를 {t_it2:.4f}초에 완주")


if __name__ == "__main__":
    main()
