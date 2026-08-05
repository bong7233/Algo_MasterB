#!/usr/bin/env python3.13
"""트리 DP 를 재귀로 짜면 어디서 무너지는가 (VIII-8).

측정 환경은 CLAUDE.md §1-3 고정: Ubuntu 24.04 / CPython 3.13.12.

IV-8 의 `tree_dfs_recursion_depth.py` 는 서브트리 크기(값 하나)를 올렸다.
여기서는 정점마다 값 **두 개**(고른다/안 고른다)를 올리는 트리 DP 를 같은 경로 모양
트리에 돌린다. 프레임이 무거워졌을 때 경계가 어디로 움직이는지가 이 스크립트의 목적이다.

    1. 기본 재귀 한도에서 정점 100,000 개 경로 트리 → RecursionError. 실제 도달 깊이도 찍는다.
    2. sys.setrecursionlimit 을 올린 뒤 같은 것 (별도 프로세스 — C 스택이 죽으면 신호로 끝난다).
    3. 명시적 스택 반복 후위 판 — 시간과 정답을 함께 확인한다.
    4. 무작위 작은 트리에서 DP 를 **모든 부분집합 완전탐색**과 대조한다.

실행:
    python3.13 tools/bench/viii8_tree_dp_recursion.py
"""

from __future__ import annotations

import random
import subprocess
import sys
import time

N = 100_000


def path_tree(n: int, rng: random.Random) -> tuple[list[list[int]], list[int]]:
    """1 - 2 - 3 - ... - n 한 줄. 재귀 깊이가 곧 정점 수다."""
    adj: list[list[int]] = [[] for _ in range(n + 1)]
    for v in range(1, n):
        adj[v].append(v + 1)
        adj[v + 1].append(v)
    w = [0] + [rng.randint(1, 100) for _ in range(n)]
    return adj, w


def dp_recursive(adj, w, root):
    """dp[v][0] = v 를 안 고를 때, dp[v][1] = v 를 고를 때의 서브트리 최댓값."""
    n = len(adj) - 1
    dp = [[0, 0] for _ in range(n + 1)]

    def go(v: int, parent: int) -> None:
        dp[v][0] = 0
        dp[v][1] = w[v]
        for nx in adj[v]:
            if nx == parent:
                continue
            go(nx, v)
            dp[v][0] += max(dp[nx][0], dp[nx][1])   # 자식이 끝난 뒤에만 더할 수 있다
            dp[v][1] += dp[nx][0]

    go(root, 0)
    return max(dp[root][0], dp[root][1])


def dp_iterative(adj, w, root):
    """전위 순서를 기록해 두고 거꾸로 훑는다 — 뒤집은 전위가 후위의 성질을 갖는다."""
    n = len(adj) - 1
    parent = [0] * (n + 1)
    order = []
    stack = [root]
    seen = [False] * (n + 1)
    seen[root] = True
    while stack:
        v = stack.pop()
        order.append(v)
        for nx in adj[v]:
            if not seen[nx]:
                seen[nx] = True
                parent[nx] = v
                stack.append(nx)

    dp0 = [0] * (n + 1)
    dp1 = list(w)
    for v in reversed(order):
        p = parent[v]
        if v != root:
            dp0[p] += max(dp0[v], dp1[v])
            dp1[p] += dp0[v]
    return max(dp0[root], dp1[root])


def brute(adj, w, n):
    """모든 부분집합을 다 본다. 인접한 둘이 함께 뽑히면 버린다."""
    best = 0
    for mask in range(1 << n):
        ok = True
        for v in range(1, n + 1):
            if not (mask >> (v - 1)) & 1:
                continue
            for nx in adj[v]:
                if nx > v and (mask >> (nx - 1)) & 1:
                    ok = False
                    break
            if not ok:
                break
        if ok:
            s = sum(w[v] for v in range(1, n + 1) if (mask >> (v - 1)) & 1)
            best = max(best, s)
    return best


def greedy_heavy(adj, w, n):
    """무거운 정점부터 고른다 — 트리 DP 자리에서 가장 먼저 떠오르는 그리디."""
    blocked = [False] * (n + 1)
    tot = 0
    for v in sorted(range(1, n + 1), key=lambda x: -w[x]):
        if blocked[v]:
            continue
        tot += w[v]
        for nx in adj[v]:
            blocked[nx] = True
    return tot


def greedy_leaves(adj, w, n):
    """잎만 전부 고른다 — 잎끼리는 인접하지 않으므로 언제나 유효한 답이다."""
    if n == 1:
        return w[1]
    return sum(w[v] for v in range(1, n + 1) if len(adj[v]) == 1)


CHILD = r"""
import sys, random
sys.setrecursionlimit(%d)
n = %d
adj = [[] for _ in range(n + 1)]
for v in range(1, n):
    adj[v].append(v + 1); adj[v + 1].append(v)
rng = random.Random(7)
w = [0] + [rng.randint(1, 100) for _ in range(n)]
dp = [[0, 0] for _ in range(n + 1)]
def go(v, parent):
    dp[v][0] = 0; dp[v][1] = w[v]
    for nx in adj[v]:
        if nx == parent: continue
        go(nx, v)
        dp[v][0] += max(dp[nx][0], dp[nx][1]); dp[v][1] += dp[nx][0]
go(1, 0)
print(max(dp[1][0], dp[1][1]))
"""


def main() -> None:
    rng = random.Random(7)
    adj, w = path_tree(N, rng)

    print("[1] 기본 재귀 한도 (%d) 에서 정점 %d 개 경로 트리" % (sys.getrecursionlimit(), N))
    depth = [0]

    def probe(k: int) -> None:
        depth[0] = k
        probe(k + 1)

    try:
        probe(1)
    except RecursionError:
        pass
    print("    실제로 들어간 깊이: %d" % depth[0])
    try:
        dp_recursive(adj, w, 1)
        print("    통과 (예상 밖)")
    except RecursionError:
        print("    RecursionError — 트리 DP 도 같은 자리에서 죽는다")

    print("[2] setrecursionlimit(300000) 후 별도 프로세스에서 재시도")
    p = subprocess.run([sys.executable, "-c", CHILD % (300_000, N)],
                       capture_output=True, text=True)
    if p.returncode == 0:
        print("    통과. 답 = %s" % p.stdout.strip())
    else:
        print("    종료 코드 %d (음수면 신호로 죽은 것 — C 스택 고갈)" % p.returncode)

    print("[3] 반복 후위 판")
    ts = []
    for _ in range(3):
        t0 = time.perf_counter()
        ans = dp_iterative(adj, w, 1)
        ts.append(time.perf_counter() - t0)
    ts.sort()
    print("    답 = %d, %.4f s (중앙값 3회)" % (ans, ts[1]))

    print("[4] 무작위 대조 — 트리 DP vs 모든 부분집합 완전탐색")
    bad = 0
    r2 = random.Random(20250805)
    for t in range(300):
        n = r2.randint(1, 14)
        a2: list[list[int]] = [[] for _ in range(n + 1)]
        for v in range(2, n + 1):
            p = r2.randint(1, v - 1)          # 무작위 트리 (부모를 앞쪽에서 고른다)
            a2[v].append(p)
            a2[p].append(v)
        w2 = [0] + [r2.randint(1, 20) for _ in range(n)]
        x = dp_iterative(a2, w2, 1)
        y = brute(a2, w2, n)
        if x != y:
            bad += 1
            print("    불일치! n=%d dp=%d brute=%d" % (n, x, y))
    print("    불일치 %d건 / 300건" % bad)

    print("[5] 그리디 두 가지가 최적을 놓치는 비율 (무작위 트리 1,000개)")
    r3 = random.Random(20250805)
    lost_heavy = lost_leaf = 0
    for _ in range(1000):
        n = r3.randint(3, 12)
        a3: list[list[int]] = [[] for _ in range(n + 1)]
        for v in range(2, n + 1):
            p = r3.randint(1, v - 1)
            a3[v].append(p)
            a3[p].append(v)
        w3 = [0] + [r3.randint(1, 20) for _ in range(n)]
        opt = dp_iterative(a3, w3, 1)
        if greedy_heavy(a3, w3, n) < opt:
            lost_heavy += 1
        if greedy_leaves(a3, w3, n) < opt:
            lost_leaf += 1
    print("    무거운 것부터: %d회(%.1f%%) / 잎만 고르기: %d회(%.1f%%)"
          % (lost_heavy, lost_heavy / 10, lost_leaf, lost_leaf / 10))


if __name__ == "__main__":
    main()
