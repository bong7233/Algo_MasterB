#!/usr/bin/env python3.13
"""경로 모양 트리에서 재귀 DFS 가 실제로 어디서 무너지는가 (IV-8).

측정 환경은 CLAUDE.md §1-3 고정: Ubuntu 24.04 / CPython 3.13.12.

세 가지를 순서대로 잰다.
    1. 기본 재귀 한도(1000)에서 정점 100,000개 경로 트리를 재귀 DFS 로 훑는다.
       → RecursionError. 몇 번째 깊이에서 터지는지 함께 찍는다.
    2. sys.setrecursionlimit 을 올리고 같은 것을 시도한다.
       → 파이썬 예외가 아니라 **C 스택이 죽는다.** 별도 프로세스로 돌려
         종료 신호를 확인한다. 이 항목이 이 스크립트의 핵심이다 —
         "한도만 올리면 된다" 는 흔한 오해가 여기서 깨진다.
    3. 명시적 스택으로 바꾼 반복 DFS 로 같은 트리를 훑고 시간을 잰다.

실행:
    python3.13 tools/bench/tree_dfs_recursion_depth.py
"""

from __future__ import annotations

import subprocess
import sys
import time

N = 100_000


def build_path_tree(n: int) -> list[list[int]]:
    """1 - 2 - 3 - ... - n 한 줄로 이어진 트리. 깊이가 곧 정점 수다."""
    adj: list[list[int]] = [[] for _ in range(n + 1)]
    for v in range(1, n):
        adj[v].append(v + 1)
        adj[v + 1].append(v)
    return adj


def recursive_dfs(adj, root):
    size = [1] * len(adj)

    def go(v, parent):
        for nx in adj[v]:
            if nx == parent:
                continue
            go(nx, v)
            size[v] += size[nx]

    go(root, 0)
    return size


def iterative_dfs(adj, root):
    """부모 방향만 막으면 방문 배열이 필요 없다 — 본문 §4 와 같은 구현."""
    size = [1] * len(adj)
    order = []
    parent = [0] * len(adj)
    stack = [root]
    parent[root] = 0
    while stack:
        v = stack.pop()
        order.append(v)
        for nx in adj[v]:
            if nx == parent[v]:
                continue
            parent[nx] = v
            stack.append(nx)
    for v in reversed(order):          # 방문 역순 = 후위 순서
        if parent[v]:
            size[parent[v]] += size[v]
    return size


CHILD = r"""
import sys
sys.setrecursionlimit(300000)
n = 100000
adj = [[] for _ in range(n + 1)]
for v in range(1, n):
    adj[v].append(v + 1)
    adj[v + 1].append(v)
size = [1] * (n + 1)
def go(v, parent):
    for nx in adj[v]:
        if nx == parent:
            continue
        go(nx, v)
        size[v] += size[nx]
go(1, 0)
print("survived", size[1])
"""


def main() -> None:
    print(f"CPython {sys.version.split()[0]} / 경로 모양 트리 정점 {N:,}개")
    adj = build_path_tree(N)

    # 1. 기본 한도
    print(f"\n[1] 기본 재귀 한도 = {sys.getrecursionlimit()}")
    depth = 0

    def probe(k=0):
        nonlocal depth
        depth = k
        probe(k + 1)

    try:
        probe()
    except RecursionError:
        pass
    print(f"    실제로 들어간 최대 깊이: {depth}")
    try:
        recursive_dfs(adj, 1)
        print("    재귀 DFS 성공 (예상 밖)")
    except RecursionError as e:
        print(f"    재귀 DFS 실패: RecursionError — {e}")

    # 2. 한도를 올린 뒤 — 자식 프로세스로 돌린다. 죽으면 이 프로세스도 죽는다.
    print("\n[2] sys.setrecursionlimit(300000) 후 같은 재귀 DFS (자식 프로세스)")
    r = subprocess.run([sys.executable, "-c", CHILD], capture_output=True, text=True)
    print(f"    종료 코드: {r.returncode}")
    if r.returncode == 0:
        print(f"    stdout: {r.stdout.strip()}")
    else:
        tail = (r.stderr or "").strip().splitlines()[-1:] or ["(stderr 없음)"]
        print(f"    죽었다. 마지막 stderr: {tail[0]}")
        if r.returncode < 0:
            print(f"    시그널 {-r.returncode} 로 종료 — 파이썬 예외가 아니라 C 스택 오버플로다")

    # 3. 반복 DFS
    print("\n[3] 명시적 스택 반복 DFS")
    t0 = time.perf_counter()
    size = iterative_dfs(adj, 1)
    dt = time.perf_counter() - t0
    print(f"    성공. size[1] = {size[1]:,} / {dt:.3f}초")


if __name__ == "__main__":
    main()
