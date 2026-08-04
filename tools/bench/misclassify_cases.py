"""I-5 오분류 사례집 · I-6 5분 프로토콜의 모든 반례를 한 번에 재현한다.

본문에 적힌 숫자(4 대 2, 5 대 4, 15 대 30, 0 대 2, 12 대 18)가 어디서
나왔는지 손으로 따라갈 수 있어야 하고, 손으로 따라간 결과가 맞는지
기계로도 확인할 수 있어야 한다. 이 스크립트가 뒤쪽을 맡는다.

    python3.13 tools/bench/misclassify_cases.py
"""

import heapq
from collections import deque


# ── 사례 1. 그리디로 보이는 DP — 동전 {1, 4, 5} 로 8원 ──────────────────
def coin_greedy(coins, target):
    coins = sorted(coins, reverse=True)
    count, rest = 0, target
    for c in coins:
        count += rest // c
        rest -= (rest // c) * c
    return count if rest == 0 else -1


def coin_dp(coins, target):
    INF = target + 1
    dp = [0] + [INF] * target
    for v in range(1, target + 1):
        for c in coins:
            if c <= v and dp[v - c] + 1 < dp[v]:
                dp[v] = dp[v - c] + 1
    return dp[target] if dp[target] < INF else -1


# ── 사례 2. DP로 보이는 BFS — 5에서 17로 (-1 / +1 / ×2, 각 1초) ─────────
LIMIT = 100_000
INF = 10**9


def hide_forward_dp(n, k):
    dp = [INF] * (LIMIT + 1)
    dp[n] = 0
    for x in range(n + 1, k + 1):
        best = dp[x - 1] + 1
        if x % 2 == 0:
            best = min(best, dp[x // 2] + 1)
        dp[x] = best
    return dp[k]


def hide_bfs(n, k):
    dist = [-1] * (LIMIT + 1)
    dist[n] = 0
    q = deque([n])
    while q:
        x = q.popleft()
        if x == k:
            return dist[x]
        for nx in (x - 1, x + 1, x * 2):
            if 0 <= nx <= LIMIT and dist[nx] == -1:
                dist[nx] = dist[x] + 1
                q.append(nx)
    return -1


# ── 사례 3. 정렬로 보이는 우선순위 큐 — (마감, 가치) 세 개 ──────────────
def sched_sort_only(tasks):
    tasks = sorted(tasks)
    total, used = 0, 0
    for deadline, value in tasks:
        if used + 1 <= deadline:
            used += 1
            total += value
    return total


def sched_sort_and_heap(tasks):
    tasks = sorted(tasks)
    heap: list[int] = []
    total = 0
    for deadline, value in tasks:
        heapq.heappush(heap, value)
        total += value
        if len(heap) > deadline:
            total -= heapq.heappop(heap)
    return total


# ── 사례 5. 투 포인터로 보이는 누적합 — 음수가 섞인 수열 ────────────────
def window_two_pointer(a, S):
    lo, s, best = 0, 0, None
    for hi in range(len(a)):
        s += a[hi]
        while s >= S:
            L = hi - lo + 1
            best = L if best is None else min(best, L)
            s -= a[lo]
            lo += 1
    return 0 if best is None else best


def window_brute(a, S):
    best = None
    for i in range(len(a)):
        for j in range(i, len(a)):
            if sum(a[i : j + 1]) >= S:
                L = j - i + 1
                best = L if best is None else min(best, L)
    return 0 if best is None else best


# ── I-6 ::: trace — 0/1 배낭에서 비율 그리디가 지는 입력 ────────────────
def knap_ratio_greedy(items, K):
    cap, total = K, 0
    for w, v in sorted(items, key=lambda t: -t[1] / t[0]):
        if w <= cap:
            cap -= w
            total += v
    return total


def knap_dp(items, K):
    dp = [0] * (K + 1)
    for w, v in items:
        for c in range(K, w - 1, -1):
            dp[c] = max(dp[c], dp[c - w] + v)
    return dp[K]


if __name__ == "__main__":
    print("사례 1  동전 {1,4,5} 로 8원   그리디", coin_greedy([1, 4, 5], 8),
          "/ DP", coin_dp([1, 4, 5], 8))
    print("사례 2  5 → 17               한 방향 DP", hide_forward_dp(5, 17),
          "/ BFS", hide_bfs(5, 17))
    tasks = [(1, 5), (2, 10), (2, 20)]
    print("사례 3  (마감,가치)", tasks, " 정렬만", sched_sort_only(tasks),
          "/ 정렬+힙", sched_sort_and_heap(tasks))
    a, S = [5, -10, 5, 5], 10
    print("사례 5 ", a, "S =", S, "        투 포인터", window_two_pointer(a, S),
          "/ 전수조사", window_brute(a, S))
    items, K = [(6, 12), (5, 9), (5, 9)], 10
    print("I-6     배낭", items, "K =", K, " 비율 그리디", knap_ratio_greedy(items, K),
          "/ DP", knap_dp(items, K))
    print("I-5 §5  500! 뒤의 0 개수 =",
          500 // 5 + 500 // 25 + 500 // 125 + 500 // 625)
    print("I-5 §5  10^11 mod 12 =", pow(10, 11, 12), "=", (10**11) % 12)
