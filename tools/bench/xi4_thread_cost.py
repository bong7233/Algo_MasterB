"""스레드 생성 비용 대 풀에 작업 하나 맡기는 비용 — XI-4.

작업마다 스레드를 새로 만드는 구조가 왜 무너지는가를 수치로 만든다.
7회 실행해 중앙값과 범위를 낸다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4코어)

사용법:
    python3.13 tools/bench/xi4_thread_cost.py
"""

import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

N = 20_000
REPS = 7


def noop():
    pass


def per_thread():
    t0 = time.perf_counter()
    for _ in range(N):
        t = threading.Thread(target=noop)
        t.start()
        t.join()
    return time.perf_counter() - t0


def per_task(pool):
    t0 = time.perf_counter()
    futs = [pool.submit(noop) for _ in range(N)]
    for f in futs:
        f.result()
    return time.perf_counter() - t0


def report(label, ts):
    med = statistics.median(ts)
    print(f"{label}: 중앙값 {med / N * 1e6:.1f} µs/개 "
          f"(범위 {min(ts) / N * 1e6:.1f} ~ {max(ts) / N * 1e6:.1f})")


def main():
    print(f"python {sys.version.split()[0]} · GIL={sys._is_gil_enabled()} · "
          f"코어 4 · {N:,}개 · {REPS}회 반복")
    a = [per_thread() for _ in range(REPS)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        b = [per_task(pool) for _ in range(REPS)]
    report("스레드 생성+종료", a)
    report("풀에 작업 제출  ", b)


if __name__ == "__main__":
    main()
