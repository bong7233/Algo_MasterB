"""락 한 번의 값 (Python).

"큐 연산은 O(1)" 은 락이 없을 때의 이야기다. 유계 큐의 push/pop 은 매번
락을 잡았다 놓는다. 경합이 없을 때의 락 비용과, 자물쇠 없는 같은 연산의
비용을 나란히 재서 상수를 눈에 보이게 만든다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/bounded_queue_lock_cost.py
"""

import statistics
import timeit

N = 1_000_000
REPEAT = 7


def bench(stmt, setup):
    ts = timeit.repeat(stmt, setup=setup, number=1, repeat=REPEAT)
    return statistics.median(ts), min(ts), max(ts)


CASES = [
    ("락 없는 append/pop", "d = []", f"""
for _ in range({N}):
    d.append(1)
    d.pop()
"""),
    ("Lock 으로 감싼 것", "import threading; d = []; lk = threading.Lock()", f"""
for _ in range({N}):
    with lk:
        d.append(1)
        d.pop()
"""),
    ("queue.Queue(유계)", "import queue; q = queue.Queue(maxsize=8)", f"""
for _ in range({N}):
    q.put(1)
    q.get()
"""),
]

if __name__ == "__main__":
    print(f"{N:,}회 왕복, {REPEAT}회 실행, 경합 없음(단일 스레드), 코어 4")
    for name, setup, stmt in CASES:
        med, lo, hi = bench(stmt, setup)
        print(f"{name:20s} 중앙값 {med:.3f}초 ({lo:.3f}~{hi:.3f})  "
              f"왕복당 {med / N * 1e9:.0f} ns")
