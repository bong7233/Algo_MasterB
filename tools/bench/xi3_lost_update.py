"""잃어버린 갱신(lost update) 재현율 측정 — XI-3.

무엇을 재는가
    (1) 전역 정수에 대한 순수 `x += 1` 을 4스레드로 돌렸을 때 유실이 나는가
    (2) 읽기와 쓰기 사이에 함수 호출이 하나 끼었을 때 유실이 나는가
    (3) 스위치 간격(sys.setswitchinterval)에 따라 (2)의 유실률이 어떻게 변하는가
    (4) 락을 걸면 (2)가 어떻게 되는가

    (1)이 멀쩡한 것은 CPython 이 스레드 전환 검사를 특정 바이트코드(루프 뒤로 가는
    점프, 함수 진입)에서만 하기 때문이지 `+=` 가 원자적이어서가 아니다. (2)가 그것을
    보인다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4코어)

사용법:
    python3.13 tools/bench/xi3_lost_update.py
"""

import statistics
import sys
import threading

N_THREADS = 4          # 코어 수와 같게 둔다
N_EACH = 100_000
EXPECT = N_THREADS * N_EACH
ROUNDS = 100

counter = 0
lock = threading.Lock()


def add_one(v):
    return v + 1


def bump_bare():
    global counter
    for _ in range(N_EACH):
        counter += 1                 # LOAD / ADD / STORE — 원자적이 아니다


def bump_call():
    global counter
    for _ in range(N_EACH):
        tmp = counter                # 읽기
        counter = add_one(tmp)       # 함수 호출 뒤 쓰기. 호출 진입에서 GIL 이 풀릴 수 있다


def bump_call_locked():
    global counter
    for _ in range(N_EACH):
        with lock:
            tmp = counter
            counter = add_one(tmp)


def one_run(job):
    global counter
    counter = 0
    ts = [threading.Thread(target=job) for _ in range(N_THREADS)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return counter


def trial(label, job, rounds=ROUNDS):
    vals = [one_run(job) for _ in range(rounds)]
    ratios = [(EXPECT - v) / EXPECT * 100 for v in vals]
    bad = sum(1 for v in vals if v != EXPECT)
    print(f"[{label}] {rounds}회 중 유실 {bad}회")
    print(f"    최종값 중앙값 {int(statistics.median(vals)):,} / 기대 {EXPECT:,} "
          f"(범위 {min(vals):,} ~ {max(vals):,})")
    print(f"    유실률 중앙값 {statistics.median(ratios):.0f}% "
          f"(범위 {min(ratios):.0f} ~ {max(ratios):.0f}%)")
    return bad


def main():
    print(f"python {sys.version.split()[0]} · GIL={sys._is_gil_enabled()} · "
          f"스레드 {N_THREADS} · 코어 4 · 각 {N_EACH:,}회 · {ROUNDS}회 반복")

    for si in (0.005, 0.0001, 0.000001):
        sys.setswitchinterval(si)
        trial(f"순수 += · switchinterval={si}", bump_bare)

    for si in (0.005, 0.0001, 0.000001):
        sys.setswitchinterval(si)
        trial(f"함수 호출 낀 읽기-쓰기 · switchinterval={si}", bump_call)

    sys.setswitchinterval(0.000001)
    trial("함수 호출 + 락 · switchinterval=1e-06", bump_call_locked)


if __name__ == "__main__":
    main()
