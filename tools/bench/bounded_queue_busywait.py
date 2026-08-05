"""바쁜 대기와 조건변수의 CPU 비용 (Python).

유계 큐가 비었을 때 소비자는 기다려야 한다. 기다리는 방법이 둘이다.
  1. 바쁜 대기 — `while queue.empty(): pass`. 큐를 계속 들여다본다.
  2. 조건변수 — `cv.wait()`. 커널이 스레드를 재우고 통지가 올 때 깨운다.

둘 다 "기다린다" 지만 벽시계 시간이 아니라 **CPU 시간**을 재면 갈린다.
바쁜 대기는 아무 일도 안 하면서 코어를 하나 통째로 태운다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/bounded_queue_busywait.py
"""

import statistics
import threading
import time

ITEMS = 200
GAP = 0.002          # 생산자가 한 개 만드는 데 걸리는 시간(느린 상류를 흉내낸다)
REPEAT = 5


def cpu_time():
    """이 프로세스가 실제로 CPU 를 쥔 시간. 벽시계와 다르다."""
    t = time.process_time()
    return t


def run_busy():
    box = []
    done = [False]
    got = [0]

    def producer():
        for i in range(ITEMS):
            time.sleep(GAP)
            box.append(i)
        done[0] = True

    def consumer():
        while True:
            if box:
                box.pop(0)
                got[0] += 1
            elif done[0]:
                return
            # 아무 일도 안 하지만 루프는 전속력으로 돈다

    p = threading.Thread(target=producer)
    c = threading.Thread(target=consumer)
    t0, c0 = time.perf_counter(), cpu_time()
    p.start(); c.start(); p.join(); c.join()
    return time.perf_counter() - t0, cpu_time() - c0, got[0]


def run_cv():
    box = []
    done = [False]
    got = [0]
    cv = threading.Condition()

    def producer():
        for i in range(ITEMS):
            time.sleep(GAP)
            with cv:
                box.append(i)
                cv.notify()
        with cv:
            done[0] = True
            cv.notify_all()

    def consumer():
        while True:
            with cv:
                while not box and not done[0]:
                    cv.wait()          # 락을 놓고 잠든다
                if box:
                    box.pop(0)
                    got[0] += 1
                    continue
                return

    p = threading.Thread(target=producer)
    c = threading.Thread(target=consumer)
    t0, c0 = time.perf_counter(), cpu_time()
    p.start(); c.start(); p.join(); c.join()
    return time.perf_counter() - t0, cpu_time() - c0, got[0]


def survey(fn, name):
    walls, cpus = [], []
    for _ in range(REPEAT):
        w, c, got = fn()
        assert got == ITEMS, got
        walls.append(w); cpus.append(c)
    print(f"{name:10s} 벽시계 중앙값 {statistics.median(walls):.3f}초 "
          f"({min(walls):.3f}~{max(walls):.3f})   "
          f"CPU 중앙값 {statistics.median(cpus):.3f}초 "
          f"({min(cpus):.3f}~{max(cpus):.3f})   "
          f"점유율 {statistics.median(cpus) / statistics.median(walls) * 100:.0f}%")


if __name__ == "__main__":
    print(f"항목 {ITEMS}개, 생산 간격 {GAP * 1000:.0f}ms, {REPEAT}회 실행, 코어 4")
    survey(run_busy, "바쁜 대기")
    survey(run_cv, "조건변수")
