"""링 버퍼에 생산자가 둘이 되는 순간 (Python).

링 버퍼가 락 없이 성립하는 것은 생산자 하나·소비자 하나(SPSC)일 때뿐이다.
생산자가 둘이면 `head` 갱신이 LOAD/ADD/STORE 로 나뉘고, 그 사이에서 스레드가
갈리면 두 생산자가 같은 슬롯에 쓴다.

여기서 재는 것은 두 가지다.
  1. 순수한 인덱스 갱신만 있는 판 — CPython 3.13 은 스위치 지점이 특정 명령
     (RESUME / JUMP_BACKWARD / CALL 등)에만 있어서 이 구간이 잘 안 갈린다.
  2. 임계 구간 안에 함수 호출이 하나 낀 판 — 호출이 곧 스위치 지점이라 갈린다.

즉 "GIL 이 있으니 안전하다" 는 언어의 보장이 아니라 구현 세부에 기댄 착각이고,
코드 한 줄로 무너진다. 그 사실을 100회 반복의 재현율로 적는다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/ringbuffer_race.py
"""

import sys
import threading

CAP = 1 << 20
ROUNDS = 100


def tag(x):
    """실무의 push 안에 흔히 들어가는 한 줄 — 타임스탬프·시퀀스 부여·포맷.
    호출 하나가 임계 구간에 스위치 지점을 만든다."""
    return x


class Ring:
    def __init__(self, cap, hooked):
        self.buf = [0] * cap
        self.cap = cap
        self.head = 0
        self.hooked = hooked

    def push(self, x):
        h = self.head
        self.buf[h] = tag(x) if self.hooked else x
        self.head = (h + 1) % self.cap


def one_round(per, hooked, nthreads=2):
    q = Ring(CAP, hooked)

    def work():
        for _ in range(per):
            q.push(1)

    ts = [threading.Thread(target=work) for _ in range(nthreads)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return q.head, sum(q.buf)


def survey(per, hooked, label):
    bad = 0
    got_total = 0
    want = per * 2
    for _ in range(ROUNDS):
        head, written = one_round(per, hooked)
        got_total += written
        if head != want or written != want:
            bad += 1
    print(f"{label:34s} {bad:3d}/{ROUNDS} 회 어긋남   "
          f"평균 기록량 {got_total / ROUNDS:8.0f} / {want}")


if __name__ == "__main__":
    print("GIL 켜짐:", sys._is_gil_enabled(),
          "/ 스위치 간격", sys.getswitchinterval(), "초 / 코어 4 / 생산자 2")
    survey(20_000, False, "호출 없는 push, 2만 회")
    survey(20_000, True, "호출 낀 push, 2만 회")
    survey(200_000, True, "호출 낀 push, 20만 회")
