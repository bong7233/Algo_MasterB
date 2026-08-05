"""링 버퍼 인덱스 접기: `% cap` 과 `& (cap-1)` 의 실제 차이 (Python).

용량이 2의 거듭제곱이면 나머지 연산을 비트 마스크로 바꿀 수 있다.
커널·오디오 링 버퍼가 2의 거듭제곱 용량을 고집하는 근거가 이것인데,
그 근거가 Python 에서도 유효한지는 재 봐야 안다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/ringbuffer_mod_vs_mask.py
"""

import statistics
import timeit

CAP = 1024
N = 2_000_000
REPEAT = 7


def bench(stmt, setup):
    ts = timeit.repeat(stmt, setup=setup, number=1, repeat=REPEAT)
    return statistics.median(ts), min(ts), max(ts)


SETUP = f"cap = {CAP}; mask = cap - 1; n = {N}"

MOD = """
i = 0
for _ in range(n):
    i = (i + 1) % cap
"""

MASK = """
i = 0
for _ in range(n):
    i = (i + 1) & mask
"""

# 비교 기준선: 접지 않는 루프. 나머지 연산 자체의 비용이 루프 오버헤드에
# 묻히는지 보려면 루프만 도는 시간을 알아야 한다.
BARE = """
i = 0
for _ in range(n):
    i = i + 1
"""

if __name__ == "__main__":
    for name, stmt in (("bare", BARE), ("%  cap", MOD), ("& mask", MASK)):
        med, lo, hi = bench(stmt, SETUP)
        print(f"{name:8s} 중앙값 {med:.3f}초  범위 {lo:.3f}~{hi:.3f}  ({N:,}회, {REPEAT}회 실행)")
