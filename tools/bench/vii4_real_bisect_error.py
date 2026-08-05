"""VII-4 본문 수치 — 실수 이분 탐색을 몇 번 돌리면 오차가 얼마가 되는가.

정확해를 아는 함수(세제곱근)로 잰다. 반복 횟수 k 를 늘리면서
(1) 남은 구간 폭, (2) 정확해와의 절대오차, (3) 상대오차를 같이 본다.
어느 지점부터 더 돌려도 오차가 줄지 않는지가 이 측정의 목적이다.

그리고 큰 값에서 절대 EPS 가 무의미해지는 것을 double 의 간격(ULP)으로 확인한다.

측정 환경은 CLAUDE.md §1-3.
실행:  python3.13 tools/bench/vii4_real_bisect_error.py
"""

import math

TARGET = 2.0
EXACT = math.cbrt(TARGET)          # 정확해. 이것과 비교한다


def cbrt_bisect(iters):
    """[0, 2) 에서 x^3 >= 2 의 경계를 iters 번 접는다."""
    lo, hi = 0.0, 2.0
    for _ in range(iters):
        mid = lo + (hi - lo) / 2
        if mid * mid * mid >= TARGET:
            hi = mid
        else:
            lo = mid
    return lo, hi


print(f"정확해 cbrt(2) = {EXACT:.17g}")
print(f"{'k':>4} {'폭':>12} {'절대오차':>12} {'상대오차':>12}")
for k in (10, 20, 30, 40, 50, 60, 70, 80, 100, 200):
    lo, hi = cbrt_bisect(k)
    width = hi - lo
    err = abs(lo - EXACT)
    rel = err / EXACT
    print(f"{k:>4} {width:12.3e} {err:12.3e} {rel:12.3e}")

# 폭이 더 줄지 않는 지점 — double 이 두 수 사이에 아무 값도 못 만든다
lo, hi = 0.0, 2.0
prev = hi - lo
stop = -1
for k in range(1, 501):
    mid = lo + (hi - lo) / 2
    if mid * mid * mid >= TARGET:
        hi = mid
    else:
        lo = mid
    if hi - lo == prev:
        stop = k
        break
    prev = hi - lo
print(f"\n폭이 더 줄지 않게 된 반복 = {stop}회, 그때의 폭 = {prev:.3e}")
print(f"1.26 근처의 double 간격(ULP) = {math.ulp(1.26):.3e}")

# 큰 값에서는 절대 EPS 가 애초에 표현 불가능하다
for x in (1.0, 1e6, 1.4e9, 1e15, 1e18):
    print(f"x = {x:9.2e} 에서 ULP = {math.ulp(x):.3e}  (EPS=1e-9 보다 "
          f"{'크다 → 절대오차 1e-9 는 불가능' if math.ulp(x) > 1e-9 else '작다 → 가능'})")
