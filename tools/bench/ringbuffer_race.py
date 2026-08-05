"""링 버퍼에 생산자가 둘이 되는 순간 (Python).

링 버퍼는 생산자 하나·소비자 하나(SPSC)일 때만 락 없이 성립한다.
생산자가 둘이 되면 `head` 갱신이 LOAD/ADD/STORE 세 조각으로 나뉘고
그 사이에 스레드가 갈리면 두 스레드가 같은 슬롯에 쓴다.

GIL 이 있어도 이 경쟁은 일어난다 — GIL 은 바이트코드 사이에서 풀리기 때문이다.
`sys._is_gil_enabled()` 로 이 인터프리터의 GIL 상태를 함께 찍는다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/ringbuffer_race.py
"""

import sys
import threading

CAP = 1 << 16
PER_THREAD = 20_000
ROUNDS = 200


class RingUnsafe:
    def __init__(self, cap):
        self.buf = [0] * cap
        self.cap = cap
        self.head = 0

    def push(self, x):
        h = self.head                    # LOAD
        self.buf[h] = x                  # STORE (슬롯)
        self.head = (h + 1) % self.cap   # ADD + STORE (인덱스)


class RingLocked(RingUnsafe):
    def __init__(self, cap):
        super().__init__(cap)
        self.lk = threading.Lock()

    def push(self, x):
        with self.lk:
            super().push(x)


def one_round(cls, threads=2):
    q = cls(CAP)

    def work():
        for _ in range(PER_THREAD):
            q.push(1)

    ts = [threading.Thread(target=work) for _ in range(threads)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return q.head, sum(q.buf)


def survey(cls, name):
    bad = 0
    worst = 0
    expected = PER_THREAD * 2
    for _ in range(ROUNDS):
        head, total = one_round(cls)
        if head != expected or total != expected:
            bad += 1
            worst = max(worst, expected - min(head, total))
    print(f"{name:10s} {ROUNDS}회 중 {bad}회 어긋남  (기대 {expected}, 최대 유실 {worst})")
    return bad


if __name__ == "__main__":
    print("GIL 켜짐:", sys._is_gil_enabled(), " / 코어 4 / 생산자 스레드 2")
    survey(RingUnsafe, "락 없음")
    survey(RingLocked, "락 있음")
