#!/usr/bin/env python3
"""XI-5 본문의 RM 이용률 한계 표를 만든다.

    U_lub(n) = n * (2^(1/n) - 1)

n 이 커질수록 ln 2 로 수렴한다. 본문이 "0.693 아래면 태스크 수와 무관하게 안전하다"
고 말할 수 있는 근거가 이 수렴이다. 측정이 아니라 계산이므로 기기와 무관하게 같은
값이 나온다 — 그래도 지면의 숫자를 손으로 옮기지 않기 위해 스크립트로 남긴다.

사용법: python3.13 tools/bench/xi5_rm_bound.py
"""

import math

print("  n   n(2^(1/n)-1)")
for n in (1, 2, 3, 4, 5, 10, 100, 1000):
    print(f"{n:>5}   {n * (2 ** (1 / n) - 1):.4f}")
print(f"  inf   {math.log(2):.4f}   (= ln 2)")
