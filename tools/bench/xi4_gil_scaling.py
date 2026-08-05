"""스레드 풀의 배수 — CPU 바운드와 I/O 바운드에서 GIL 이 하는 일. XI-4.

같은 작업량을 1스레드 / 4스레드(코어 4) / 4프로세스로 나눠 돌린다.
CPU 바운드는 스레드로 빨라지지 않고, I/O 바운드는 빨라진다.
5회 실행해 중앙값과 범위를 낸다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4코어)

사용법:
    python3.13 tools/bench/xi4_gil_scaling.py
"""

import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

CHUNKS = 8
CPU_WORK = 3_000_000     # 청크 하나의 반복 횟수
IO_WORK = 0.05           # 청크 하나가 자는 시간(초)
REPS = 5


def cpu_task(n):
    s = 0
    for i in range(n):
        s += i * i
    return s


def io_task(sec):
    time.sleep(sec)
    return 1


def timed(fn):
    t0 = time.perf_counter()
    fn()
    return time.perf_counter() - t0


def with_threads(k, task, arg):
    def go():
        with ThreadPoolExecutor(max_workers=k) as ex:
            list(ex.map(task, [arg] * CHUNKS))
    return go


def with_processes(k, task, arg):
    def go():
        with ProcessPoolExecutor(max_workers=k) as ex:
            list(ex.map(task, [arg] * CHUNKS))
    return go


def report(label, ts, base=None):
    med = statistics.median(ts)
    extra = f" · {base / med:.2f}배" if base else ""
    print(f"{label}: 중앙값 {med:.2f}초 (범위 {min(ts):.2f} ~ {max(ts):.2f}){extra}")
    return med


def main():
    print(f"python {sys.version.split()[0]} · GIL={sys._is_gil_enabled()} · 코어 4 · "
          f"청크 {CHUNKS}개 · {REPS}회 반복")

    print("\n-- CPU 바운드 (정수 루프) --")
    b1 = report("스레드 1", [timed(with_threads(1, cpu_task, CPU_WORK)) for _ in range(REPS)])
    report("스레드 4", [timed(with_threads(4, cpu_task, CPU_WORK)) for _ in range(REPS)], b1)
    report("프로세스 4", [timed(with_processes(4, cpu_task, CPU_WORK)) for _ in range(REPS)], b1)

    print("\n-- I/O 바운드 (sleep) --")
    b2 = report("스레드 1", [timed(with_threads(1, io_task, IO_WORK)) for _ in range(REPS)])
    report("스레드 4", [timed(with_threads(4, io_task, IO_WORK)) for _ in range(REPS)], b2)
    report("스레드 8", [timed(with_threads(8, io_task, IO_WORK)) for _ in range(REPS)], b2)


if __name__ == "__main__":
    main()
