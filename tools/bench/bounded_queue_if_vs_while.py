"""조건변수 대기를 `if` 로 감쌌을 때 실제로 무엇이 깨지는가 (Python).

교과서는 "가짜 깨움(spurious wakeup) 때문에 `while` 로 감싸라" 고 쓴다.
리눅스에서 진짜 가짜 깨움은 드물다. 그러나 소비자가 둘 이상이면
**통지 도둑질**이 흔하게 일어난다 — 깨어난 소비자가 락을 다시 잡기 전에
다른 소비자가 먼저 가져가서, 깬 쪽이 빈 큐를 만난다.

`if` 판과 `while` 판을 각각 200회 돌려 실패 횟수를 센다. 생산 간격을 0으로 두면
큐가 빌 틈이 없어 `if` 판도 통과한다 — 부하가 낮으면 경쟁이 숨는다는 것을
같은 스크립트 안에서 보이기 위해 두 조건을 다 잰다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/bounded_queue_if_vs_while.py
"""

import threading
import time

ROUNDS = 200
ITEMS = 200
CONSUMERS = 3      # 코어 4


def one_round(recheck, gap):
    box = []
    cv = threading.Condition()
    done = [False]
    bad = [0]
    got = [0]

    def producer():
        for i in range(ITEMS):
            if gap:
                time.sleep(gap)
            with cv:
                box.append(i)
                cv.notify_all()      # 대기자 전원을 깨운다. 일감은 하나뿐이다
        with cv:
            done[0] = True
            cv.notify_all()

    def consumer():
        while True:
            with cv:
                if recheck:
                    while not box and not done[0]:
                        cv.wait()    # ✅ 깨어날 때마다 조건을 다시 본다
                else:
                    if not box and not done[0]:
                        cv.wait()    # ❌ 깨어났으면 조건이 참이라고 믿는다
                if done[0] and not box:
                    return
                try:
                    box.pop()
                    got[0] += 1
                except IndexError:
                    bad[0] += 1      # 빈 큐에서 꺼냈다 — 통지를 도둑맞았다

    ts = [threading.Thread(target=consumer) for _ in range(CONSUMERS)]
    p = threading.Thread(target=producer)
    for t in ts:
        t.start()
    p.start()
    p.join()
    for t in ts:
        t.join()
    return bad[0], got[0]


def survey(recheck, gap, label):
    rounds_bad = 0
    total_bad = 0
    for _ in range(ROUNDS):
        bad, got = one_round(recheck, gap)
        assert got == ITEMS, (got, ITEMS)
        total_bad += bad
        if bad:
            rounds_bad += 1
    print(f"{label:34s} {rounds_bad:3d}/{ROUNDS} 회 실패   빈 큐 pop 총 {total_bad}회")


if __name__ == "__main__":
    print(f"소비자 {CONSUMERS} / 코어 4 / 항목 {ITEMS}개 / {ROUNDS}회 반복")
    survey(False, 0.0002, "if   판, 생산 간격 0.2ms")
    survey(True, 0.0002, "while 판, 생산 간격 0.2ms")
    survey(False, 0, "if   판, 생산 간격 0 (큐가 안 빈다)")
