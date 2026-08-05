"""II-2 §4 — Python 에서 같은 프레임을 세 가지로 쪼갠다.

    python3.13 tools/bench/ii2_parse.py 200000

    split     : C 로 구현된 한 번의 훑기. 필드마다 str 객체가 생긴다
    수동 루프 : 파이썬 레벨에서 문자를 하나씩 본다. 같은 O(n) 인데 상수가 다르다
    정규식    : 컴파일된 패턴으로 훑는다

교훈은 C++ 쪽과 반대 방향이다. C++ 에서는 표준 스트림이 느려서 직접 짜는 편이
빠르지만, Python 에서는 표준 함수가 C 구현이라 직접 짜는 순간 느려진다.
"""

import re
import sys
import time

fields = int(sys.argv[1]) if len(sys.argv) > 1 else 200000
line = "|".join(f"field{i}" for i in range(fields))

t0 = time.perf_counter()
n1 = sum(len(tok) for tok in line.split("|"))
t1 = time.perf_counter()

n2 = 0
cur = 0
for ch in line:
    if ch == "|":
        n2 += cur
        cur = 0
    else:
        cur += 1
n2 += cur
t2 = time.perf_counter()

pat = re.compile(r"[^|]*")
n3 = sum(len(m.group()) for m in pat.finditer(line) if m.group())
t3 = time.perf_counter()

a, b, c = t1 - t0, t2 - t1, t3 - t2
print(f"필드 {fields}개, 줄 길이 {len(line)}자 (합 {n1}/{n2}/{n3})")
print(f"split      {a:.4f} s")
print(f"수동 루프  {b:.4f} s  ({b / a:.1f}배 느림)")
print(f"정규식     {c:.4f} s  ({c / a:.1f}배 느림)")
