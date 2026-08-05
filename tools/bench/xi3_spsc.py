"""Python 의 생산자-소비자 처리량 — XI-3.

C++ 의 SPSC 락프리 큐에 대응하는 자리에 Python 은 무엇을 쓰는가.
`queue.Queue`(락+조건변수)와 `collections.deque`(C 레벨에서 append/popleft 가
GIL 하에 원자적)를 같은 조건에서 잰다. 7회 실행해 중앙값과 범위를 낸다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4코어)

사용법:
    python3.13 tools/bench/xi3_spsc.py
"""

import queue
import statistics
import sys
import threading
import time
from collections import deque

N = 200_000
CAP = 1024
REPS = 7


def run_queue():
    q = queue.Queue(maxsize=CAP)
    total = [0]

    def prod():
        for _ in range(N):
            q.put(1)

    def cons():
        s = 0
        for _ in range(N):
            s += q.get()
        total[0] = s

    t0 = time.perf_counter()
    tp, tc = threading.Thread(target=prod), threading.Thread(target=cons)
    tp.start()
    tc.start()
    tp.join()
    tc.join()
    d = time.perf_counter() - t0
    assert total[0] == N, total[0]
    return d


def run_deque():
    dq = deque()
    total = [0]

    def prod():
        for _ in range(N):
            while len(dq) >= CAP:
                time.sleep(0)
            dq.append(1)          # C 레벨 한 연산. GIL 아래에서 원자적이다

    def cons():
        s = 0
        got = 0
        while got < N:
            try:
                s += dq.popleft()  # 비었으면 IndexError. 그것이 곧 "비었음" 신호다
                got += 1
            except IndexError:
                time.sleep(0)
        total[0] = s

    t0 = time.perf_counter()
    tp, tc = threading.Thread(target=prod), threading.Thread(target=cons)
    tp.start()
    tc.start()
    tp.join()
    tc.join()
    d = time.perf_counter() - t0
    assert total[0] == N, total[0]
    return d


def report(label, ts):
    med = statistics.median(ts)
    print(f"{label}: 중앙값 {med:.2f}초 (범위 {min(ts):.2f} ~ {max(ts):.2f}) · "
          f"{med / N * 1e9:.0f} ns/개 · {N / med / 1e6:.2f}M개/초")


def main():
    print(f"python {sys.version.split()[0]} · GIL={sys._is_gil_enabled()} · "
          f"생산자 1 · 소비자 1 · 코어 4 · {N:,}개 · {REPS}회 반복")
    a = [run_queue() for _ in range(REPS)]
    b = [run_deque() for _ in range(REPS)]
    report("queue.Queue", a)
    report("deque", b)


if __name__ == "__main__":
    main()
