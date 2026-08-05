"""VII-4 본문 수치 — 실수 이분 탐색의 폭이 어디서 멈추는가.

while (hi - lo > EPS) 가 끝나지 않는 것은 이론이 아니라 실행 결과다.
구간 [0, 1e18] 에서 답이 1.4e9 근처면 그 자리의 double 간격이 EPS 보다 크다.

측정 환경은 CLAUDE.md §1-3.
실행:  python3.13 tools/bench/real_bisect_eps_stall.py
       g++ -std=c++17 -O2 tools/bench/real_bisect_eps_stall.cpp -o /tmp/eps && /tmp/eps
"""

EPS = 1e-9
lo, hi = 0.0, 1.0e18            # 답은 sqrt(2e18) ~ 1.414e9 근처다
prev = hi - lo
stuck_at = -1

for k in range(1, 301):         # 원래 조건은 while hi - lo > EPS 다. 안 끝나므로 상한을 건다
    mid = lo + (hi - lo) / 2
    if mid * mid >= 2.0e18:
        hi = mid
    else:
        lo = mid
    width = hi - lo
    if width == prev:           # 폭이 줄지 않았다 = 측도가 죽었다
        stuck_at = k
        break
    prev = width

print(f"폭이 줄지 않게 된 반복  = {stuck_at}")
print(f"그때의 폭             = {prev:.6e}")
print(f"EPS                   = {EPS:.6e}")
print(f"while (hi-lo > EPS) 는 여기서 {'영원히 참' if prev > EPS else '거짓이 된다'}")
