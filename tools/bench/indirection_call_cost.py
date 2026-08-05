"""XII-2 §6 의 수치 근거 — Python 쪽 간접 계층 비용.

C++ 판(indirection_call_cost.cpp)의 대응이다. Python 에는 가상 함수 테이블 대신
속성 조회가 있고, 어댑터 한 겹은 곧 메서드 호출 한 번이 더해지는 것이다.

세 가지를 잰다.
  1. 지역 함수 직접 호출
  2. 객체의 메서드 호출 (어댑터 없이 벤더 객체를 그대로 부르는 경우)
  3. 어댑터 객체의 메서드가 벤더 객체의 메서드를 다시 부르는 경우 (한 겹 추가)

실행: python3.13 tools/bench/indirection_call_cost.py
"""

import statistics
import time

N = 5_000_000


class Vendor:
    def __init__(self, v):
        self.v = v

    def read_raw(self):
        return self.v + 1


class Adapter:
    """벤더 객체를 감싸 상위 인터페이스로 맞춘다 — 호출이 한 번 더 튄다."""

    def __init__(self, inner):
        self.inner = inner

    def read(self):
        return self.inner.read_raw()


def plain(v):
    return v + 1


def bench(label, fn, repeats=3):
    times = []
    for _ in range(repeats):
        t0 = time.perf_counter()
        fn()
        times.append(time.perf_counter() - t0)
    med = statistics.median(times)
    print(f"{label:<16}: {med:.3f} s  = {med * 1e9 / N:.1f} ns/call")
    return med


def main():
    vendor = Vendor(3)
    adapter = Adapter(vendor)

    def run_plain():
        acc = 0
        for _ in range(N):
            acc += plain(3)
        return acc

    def run_method():
        acc = 0
        for _ in range(N):
            acc += vendor.read_raw()
        return acc

    def run_adapter():
        acc = 0
        for _ in range(N):
            acc += adapter.read()
        return acc

    t_plain = bench("함수 직접 호출", run_plain)
    t_method = bench("메서드 호출", run_method)
    t_adapter = bench("어댑터 한 겹", run_adapter)
    print(f"어댑터 - 메서드 : {(t_adapter - t_method) * 1e9 / N:.1f} ns/call")
    print(f"어댑터 / 메서드 : {t_adapter / t_method:.2f}배")
    _ = t_plain


if __name__ == "__main__":
    main()
