"""II-1 §5 — Python 리스트의 리스트에서도 순회 순서가 시간을 가른다.

    python3.13 tools/bench/ii1_row_major.py 2000

C++ 쪽(`ii1_row_major.cpp`)보다 배수가 작다. Python 의 `list` 는 값이 아니라
객체 포인터를 담으므로 행 우선 순회조차 이미 포인터 한 번을 더 따라가고,
그 비용이 캐시 미스를 덮어 버리기 때문이다. 배수 자체가 이 언어 차이의 크기다.
"""

import sys
import time

n = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
a = [[1] * n for _ in range(n)]

t0 = time.perf_counter()
s1 = 0
for row in a:
    for v in row:
        s1 += v
t1 = time.perf_counter()

s2 = 0
for c in range(n):
    for r in range(n):
        s2 += a[r][c]
t2 = time.perf_counter()

row_t, col_t = t1 - t0, t2 - t1
print(f"n={n} (원소 {n * n}개, 합 {s1}/{s2})")
print(f"행 우선  {row_t:.4f} s")
print(f"열 우선  {col_t:.4f} s  ({col_t / row_t:.1f}배)")
