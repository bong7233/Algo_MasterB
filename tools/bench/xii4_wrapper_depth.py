"""XII-4 §6 — 감싸는 계층을 한 겹 더 쌓을 때 무엇이 늘어나는가.

    python3.13 tools/bench/xii4_wrapper_depth.py

같은 잎(leaf) 하나를 k겹으로 감싸고 두 가지를 잰다.

    1. 잎에서 예외가 났을 때 트레이스백에 찍히는 프레임 수
       — 감싸는 계층은 스택 깊이를 그대로 늘린다. 장애를 읽는 사람이 치르는 비용이다.
    2. 한 번 호출하는 데 걸리는 시간
       — 겹당 순비용을 ns 로 환산한다.

숫자 자체보다 "겹당 일정하게 늘어난다"는 형태가 요점이다.
"""

import time
import traceback


def leaf():
    raise RuntimeError("잎에서 실패")


def wrap(child):
    def wrapper():
        return child()
    return wrapper


def ok_leaf():
    return 1


def build(depth, base):
    f = base
    for _ in range(depth):
        f = wrap(f)
    return f


def frames_at(depth):
    f = build(depth, leaf)
    try:
        f()
    except RuntimeError:
        return len(traceback.extract_tb(__import__("sys").exc_info()[2]))
    return -1


def nanos_at(depth, calls=2_000_000):
    f = build(depth, ok_leaf)
    best = min(_time_calls(f, calls) for _ in range(3))
    return best / calls * 1e9


def _time_calls(f, calls):
    t0 = time.perf_counter()
    for _ in range(calls):
        f()
    return time.perf_counter() - t0


def main():
    print("겹 수  트레이스백 프레임  호출 시간(ns)")
    for d in range(0, 7):
        print(f"{d:>4}  {frames_at(d):>14}  {nanos_at(d):>13.1f}")


if __name__ == "__main__":
    main()
