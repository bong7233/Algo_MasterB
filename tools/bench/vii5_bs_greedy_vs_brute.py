"""VII-5 본문 수치 — "최대값을 최소화" 를 완전탐색으로 푸는 것과 이분+그리디로 푸는 것.

문제: 길이 a[0..n-1] 을 순서를 지킨 채 m 개의 연속 묶음으로 나눈다.
      묶음 합의 최댓값을 최소화하라.

완전탐색은 칸막이 위치 C(n-1, m-1) 가지를 전부 만든다.
이분+그리디는 답 x 를 이분 탐색하고, 판정은 "x 를 넘기 직전까지 채우기" 한 번이다.

두 가지를 잰다.
  1. 정확성 — 작은 입력 전수에서 두 답이 같은가 (이분 탐색을 믿을 근거)
  2. 비용   — n 이 조금만 늘어도 완전탐색이 어디서 무너지는가

측정 환경은 CLAUDE.md §1-3.
실행:  python3.13 tools/bench/vii5_bs_greedy_vs_brute.py
"""

import random
import time
from itertools import combinations

calls = 0


def groups_needed(a, x):
    """크기 x 인 묶음으로 순서대로 채울 때 필요한 묶음 수. x 가 작을수록 많다."""
    global calls
    calls += 1
    cnt, cur = 1, 0
    for v in a:
        if cur + v > x:
            cnt += 1
            cur = v
        else:
            cur += v
    return cnt


def solve_binary(a, m):
    """p(x) = (groups_needed(x) <= m) 는 F...FT...T 다. 첫 참이 답."""
    lo, hi = max(a), sum(a) + 1
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if groups_needed(a, mid) <= m:
            hi = mid
        else:
            lo = mid + 1
    return lo


def solve_brute(a, m):
    """칸막이 위치를 전부 고른다. 답은 같아야 한다."""
    n = len(a)
    best = None
    for cuts in combinations(range(1, n), m - 1):
        bounds = (0,) + cuts + (n,)
        worst = max(sum(a[bounds[i]:bounds[i + 1]]) for i in range(m))
        if best is None or worst < best:
            best = worst
    return best


# 1. 정확성 — 작은 입력 전수 대조
random.seed(20260805)
bad = tried = 0
for _ in range(2000):
    n = random.randint(2, 9)
    m = random.randint(1, n)
    a = [random.randint(1, 20) for _ in range(n)]
    tried += 1
    if solve_binary(a, m) != solve_brute(a, m):
        bad += 1
print(f"무작위 소형 케이스 {tried}개 대조 — 불일치 {bad}건")

# 경계 입력도 따로 본다
edge = [([5], 1), ([1, 1, 1, 1], 4), ([9, 1, 1], 2), ([1, 1, 9], 2), ([7, 7, 7], 1)]
bad_e = 0
for a, m in edge:
    if solve_binary(a, m) != solve_brute(a, m):
        bad_e += 1
print(f"경계 케이스 {len(edge)}개 대조 — 불일치 {bad_e}건")


def timed(fn, repeat=3):
    ts = []
    ans = None
    for _ in range(repeat):
        t0 = time.perf_counter()
        ans = fn()
        ts.append(time.perf_counter() - t0)
    ts.sort()
    return ans, ts[len(ts) // 2]


# 2. 비용 — n 이 늘 때 완전탐색이 무너지는 지점
print(f"\n{'n':>4} {'m':>3} {'분할 가짓수':>12} {'완전탐색':>12} {'이분+그리디':>12} {'판정 호출':>8}")
for n, m in ((12, 4), (16, 5), (20, 6), (24, 6)):
    a = [random.randint(1, 100) for _ in range(n)]
    from math import comb
    cases = comb(n - 1, m - 1)
    ans_b, t_b = timed(lambda: solve_brute(a, m))
    calls = 0
    ans_s, t_s = timed(lambda: solve_binary(a, m))
    print(f"{n:>4} {m:>3} {cases:>12,} {t_b * 1e3:9.3f} ms {t_s * 1e6:9.1f} us "
          f"{calls // 3:>8}  답 {ans_b}=={ans_s}")

# 실제 제약 규모에서는 이분+그리디만 남는다
n = 100_000
a = [random.randint(1, 10_000) for _ in range(n)]
calls = 0
ans, t = timed(lambda: solve_binary(a, 100))
print(f"\nn = {n:,}  m = 100 → 답 {ans}, {t * 1e3:.1f} ms, 판정 호출 {calls // 3}회")
