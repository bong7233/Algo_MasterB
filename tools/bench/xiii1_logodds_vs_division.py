"""점유 격자 셀 갱신: 확률 나눗셈 형태와 로그 오즈 덧셈 형태의 실제 비용 (Python).

두 형태는 수학적으로 같은 베이즈 갱신을 계산한다. 나눗셈 형태는 매 갱신마다
정규화 상수를 다시 구하고, 덧셈 형태(로그 오즈)는 그 정규화가 필요 없다.
셀 하나를 500만 번 갱신해 그 차이를 잰다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/xiii1_logodds_vs_division.py
"""

import math
import time

N = 5_000_000
P_HIT = 0.9  # P(z=hit | occ). 대칭으로 P(z=miss | free) = 0.9 를 쓴다.


def division_form(n):
    """p_t = P(z|occ) p_{t-1} / [P(z|occ) p_{t-1} + P(z|free)(1-p_{t-1})] 을 그대로 반복."""
    p = 0.5
    a, b = P_HIT, 1 - P_HIT
    for _ in range(n):
        num = a * p
        den = num + b * (1 - p)
        p = num / den
        if p > 0.999 or p < 0.001:  # 계속 같은 계산이 되도록 중간에 되돌린다
            p = 0.5
    return p


def addition_form(n):
    """l_t = l_{t-1} + log(P(z|occ)/P(z|free)) 만 반복. 정규화가 없다."""
    l = 0.0
    inc = math.log(P_HIT / (1 - P_HIT))
    for _ in range(n):
        l = l + inc
        if l > 5 or l < -5:
            l = 0.0
    return l


if __name__ == "__main__":
    t0 = time.perf_counter()
    division_form(N)
    t1 = time.perf_counter()
    addition_form(N)
    t2 = time.perf_counter()
    print(f"division form : {t1 - t0:.4f}s")
    print(f"addition form : {t2 - t1:.4f}s")
