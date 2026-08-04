"""I-5 §5 — "완전탐색으로 보이는 수학"의 실측 근거 (Python 쪽).

Python 에서 21억 번을 실제로 돌리면 측정 자체가 끝나지 않는다. 그래서
**1,000만 번만 재고 그 값을 그대로 적는다.** 21억 회 값을 비례식으로
환산해 본문에 싣지 않는다 — 그것은 실측이 아니라 추정이다.

    python3.13 tools/bench/modpow_bruteforce.py
"""

import time

A, C = 10, 1000000007
N = 10_000_000  # 실제로 잰 반복 횟수. 1629 의 상한(21억)이 아니다.

t0 = time.perf_counter()
acc = 1
for _ in range(N):
    acc = acc * A % C
t1 = time.perf_counter()
print(f"brute force  N={N:,}  result={acc}  {t1 - t0:.3f} s")

# 내장 pow(A, B, C) 는 분할 정복 거듭제곱이다. 상한 그대로 넣어도 즉시 끝난다.
B = 2147483647
t0 = time.perf_counter()
fast = pow(A, B, C)
t1 = time.perf_counter()
print(f"pow(A,B,C)   B={B:,}  result={fast}  {t1 - t0:.6f} s")
