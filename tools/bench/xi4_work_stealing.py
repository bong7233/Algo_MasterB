"""워크 스틸링에서 일이 실제로 어떻게 나뉘는가 — XI-4.

작업 2만 건을 워커 0의 덱에만 몰아 두고 워커 4개(코어 4)를 동시에 출발시킨다.
훔치기가 동작하면 넷이 나눠 갖는다. GIL 이 있는 Python 에서는 나눠 가지지 못하는
경우가 흔하다는 것을 워커별 처리 건수로 본다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4코어)

사용법:
    python3.13 tools/bench/xi4_work_stealing.py
"""

import statistics
import sys
import threading
from collections import deque

N_WORKERS, N_TASKS = 4, 20000
RUNS = 10


def one_run():
    decks = [deque() for _ in range(N_WORKERS)]
    locks = [threading.Lock() for _ in range(N_WORKERS)]
    decks[0].extend(range(N_TASKS))
    go = threading.Event()
    processed = [0] * N_WORKERS

    def take_own(w):
        with locks[w]:
            return decks[w].pop() if decks[w] else None

    def steal(w):
        for k in range(1, N_WORKERS):
            v = (w + k) % N_WORKERS
            with locks[v]:
                if decks[v]:
                    return decks[v].popleft()
        return None

    def worker(w):
        go.wait()
        while True:
            job = take_own(w)
            if job is None:
                job = steal(w)
                if job is None:
                    return
            processed[w] += 1

    ws = [threading.Thread(target=worker, args=(w,)) for w in range(N_WORKERS)]
    for w in ws:
        w.start()
    go.set()
    for w in ws:
        w.join()
    return processed


def main():
    print(f"python {sys.version.split()[0]} · GIL={sys._is_gil_enabled()} · "
          f"워커 {N_WORKERS} · 코어 4 · 작업 {N_TASKS:,}건 · {RUNS}회 실행")
    shares = []
    for r in range(RUNS):
        p = one_run()
        assert sum(p) == N_TASKS
        share = max(p) / N_TASKS * 100
        shares.append(share)
        print(f"  {r + 1:2}회차 워커별 {p} · 최다 워커 몫 {share:.0f}%")
    print(f"최다 워커 몫 중앙값 {statistics.median(shares):.0f}% "
          f"(범위 {min(shares):.0f} ~ {max(shares):.0f}%) · 이상적 분배는 25%")


if __name__ == "__main__":
    main()
