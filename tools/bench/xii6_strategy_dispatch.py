"""XII-6 §6 — Python 에서 전략을 함수로 넘길 때의 호출 비용.

    python3.13 tools/bench/xii6_strategy_dispatch.py 5000000

셋 다 같은 계산(맨해튼 휴리스틱)을 N번 한다. 다른 것은 그 계산에 도달하는 경로다.
    본문에 박음 : 호출이 없다
    함수 전달   : 파이썬 함수 호출 한 번
    메서드 호출 : 속성 조회 + 바운드 메서드 생성 + 호출

세 번 돌려 최소값을 쓴다. 최소값이 가장 잡음이 적은 추정치다.
호출 한 번의 순비용은 (전략판 - 인라인판) / N 으로 읽는다.
"""

import sys
import time


def manhattan(x, y):
    return abs(x) + abs(y)


class Manhattan:
    def h(self, x, y):
        return abs(x) + abs(y)


def loop_inline(n):
    acc = 0
    for i in range(n):
        x, y = i % 1000 - 500, i % 777 - 388
        acc += abs(x) + abs(y)
    return acc


def loop_func(n, f):
    acc = 0
    for i in range(n):
        acc += f(i % 1000 - 500, i % 777 - 388)
    return acc


def loop_method(n, obj):
    acc = 0
    for i in range(n):
        acc += obj.h(i % 1000 - 500, i % 777 - 388)
    return acc


def best(name, body, reps=3):
    times = []
    for _ in range(reps):
        t0 = time.perf_counter()
        acc = body()
        times.append(time.perf_counter() - t0)
    sec = min(times)
    print(f"{name:<14} {sec:.4f} s   acc={acc}")
    return sec


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5_000_000
    t_i = best("본문에 박음", lambda: loop_inline(n))
    t_f = best("함수 전달", lambda: loop_func(n, manhattan))
    t_m = best("메서드 호출", lambda: loop_method(n, Manhattan()))
    print(f"n={n}")
    print(f"함수 호출 순비용   {(t_f - t_i) / n * 1e9:.1f} ns/회  ({t_f / t_i:.2f}배)")
    print(f"메서드 호출 순비용 {(t_m - t_i) / n * 1e9:.1f} ns/회  ({t_m / t_i:.2f}배)")


if __name__ == "__main__":
    main()
