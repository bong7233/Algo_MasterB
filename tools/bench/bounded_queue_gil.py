"""소비자를 늘리면 빨라지는가 — GIL 이 가르는 두 경우 (Python).

유계 큐에 일감을 넣고 소비자 스레드 수를 1 → 2 → 4 로 늘린다(코어 4).
소비자가 하는 일을 두 종류로 나눈다.
  - CPU 바운드: 순수 파이썬 산술 루프. GIL 을 놓지 않는다.
  - I/O 바운드: `time.sleep`. 잠드는 동안 GIL 을 놓는다.

같은 큐, 같은 구조인데 결과가 정반대로 갈린다. 그 갈림길이
"Python 에서 스레드를 쓸 것인가 프로세스를 쓸 것인가" 의 판단 기준이다.
비교를 위해 CPU 바운드는 `multiprocessing` 판도 함께 잰다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/bounded_queue_gil.py
"""

import multiprocessing as mp
import queue
import statistics
import sys
import threading
import time

TASKS = 48
SPIN = 60_000      # CPU 바운드 한 건의 크기
NAP = 0.02         # I/O 바운드 한 건의 대기
REPEAT = 5


def cpu_work(_):
    s = 0
    for i in range(SPIN):
        s += i * i
    return s


def io_work(_):
    time.sleep(NAP)
    return 0


def run_threads(work, nthreads):
    q = queue.Queue()
    for i in range(TASKS):
        q.put(i)
    for _ in range(nthreads):
        q.put(None)          # 독약 — 소비자 수만큼 넣는다

    def consumer():
        while True:
            item = q.get()
            if item is None:
                return
            work(item)

    ts = [threading.Thread(target=consumer) for _ in range(nthreads)]
    t0 = time.perf_counter()
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return time.perf_counter() - t0


def run_processes(nprocs):
    t0 = time.perf_counter()
    with mp.Pool(nprocs) as pool:
        pool.map(cpu_work, range(TASKS), chunksize=max(1, TASKS // nprocs))
    return time.perf_counter() - t0


def survey(label, fn, ns):
    base = None
    for n in ns:
        ts = [fn(n) for _ in range(REPEAT)]
        med = statistics.median(ts)
        if base is None:
            base = med
        print(f"{label:22s} 스레드 {n}: 중앙값 {med:6.3f}초 "
              f"({min(ts):.3f}~{max(ts):.3f})  가속 {base / med:.2f}배")


if __name__ == "__main__":
    print(f"GIL 켜짐: {sys._is_gil_enabled()} / 코어 4 / 작업 {TASKS}건, {REPEAT}회 실행")
    survey("CPU 바운드(스레드)", lambda n: run_threads(cpu_work, n), (1, 2, 4))
    survey("I/O 바운드(스레드)", lambda n: run_threads(io_work, n), (1, 2, 4))
    survey("CPU 바운드(프로세스)", run_processes, (1, 2, 4))
