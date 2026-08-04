#!/usr/bin/env python3
"""0-2 — Python 정수의 임의 정밀도 비용.

int 는 자릿수 제한이 없다. 오버플로가 없다는 뜻이고, 동시에 자릿수가 늘면
연산 비용이 늘어난다는 뜻이다. 어디서부터 늘어나는지를 잰다.

사용법: python3.13 tools/bench/py_bigint_cost.py
"""
import sys
import time


def size_by_bits() -> None:
    print("정수 하나의 메모리 (sys.getsizeof, 바이트)")
    for name, v in (
        ("0", 0),
        ("1", 1),
        ("2^30 - 1", 2**30 - 1),
        ("2^30", 2**30),
        ("2^63 - 1", 2**63 - 1),
        ("2^64", 2**64),
        ("2^1000", 2**1000),
    ):
        print(f"  {name:<12} {sys.getsizeof(v):>5}")
    print("  (C++ 의 int 는 4, long long 은 8 — 고정이다)")


def add_cost(loops: int = 2_000_000) -> None:
    print(f"\n덧셈 {loops:,}회 — 피연산자 크기별")
    base = None
    for name, a, b in (
        ("30비트", 10**9, 10**9 - 7),
        ("64비트", 10**18, 10**18 - 7),
        ("128비트", 10**38, 10**38 - 7),
        ("1024비트", 2**1024, 2**1024 - 7),
    ):
        t = time.perf_counter()
        s = 0
        for _ in range(loops):
            s = a + b
        el = time.perf_counter() - t
        if base is None:
            base = el
        print(f"  {name:<10} {el:7.4f}s   30비트 대비 x{el / base:.2f}")


def mul_cost(loops: int = 200_000) -> None:
    print(f"\n곱셈 {loops:,}회 — 피연산자 크기별")
    base = None
    for name, a, b in (
        ("30비트", 10**9, 10**9 - 7),
        ("64비트", 10**18, 10**18 - 7),
        ("1024비트", 2**1024, 2**1024 - 7),
        ("8192비트", 2**8192, 2**8192 - 7),
    ):
        t = time.perf_counter()
        for _ in range(loops):
            a * b
        el = time.perf_counter() - t
        if base is None:
            base = el
        print(f"  {name:<10} {el:7.4f}s   30비트 대비 x{el / base:6.1f}")


def str_conversion() -> None:
    # 2진 -> 10진 변환은 진법이 서로의 거듭제곱이 아니라 자릿수 전체를 건드린다.
    # 교과서적 알고리즘은 O(d^2) 이고, 그래서 3.11 이 자릿수 제한을 도입했다.
    # 다만 아래 실측이 보이듯 3.13 의 실제 증가율은 제곱보다 훨씬 완만하다.
    print("\n큰 수를 문자열로 바꾸기")
    print(f"  기본 자릿수 제한: {sys.get_int_max_str_digits()}  <- 넘기면 ValueError")
    try:
        str(2**100_000)
    except ValueError as e:
        print(f"  str(2**100000) -> ValueError: {str(e)[:60]}...")
    sys.set_int_max_str_digits(20_000_000)  # 왜: 제한을 풀어야 비용을 잴 수 있다
    prev = None
    for bits in (200_000, 400_000, 800_000, 1_600_000):
        v = 2**bits
        best = min(_str_once(v) for _ in range(3))
        ratio = "" if prev is None else f"   크기 2배 -> x{best / prev:.1f}"
        print(f"  2^{bits:<9} str() {best:8.4f}s{ratio}")
        prev = best
    print("  (x4 에 가까우면 제곱, x2 에 가까우면 선형에 가깝다는 뜻이다)")


def _str_once(v: int) -> float:
    t = time.perf_counter()
    str(v)
    return time.perf_counter() - t


def factorial_cost() -> None:
    print("\n오버플로가 없다는 것의 값어치")
    import math

    t = time.perf_counter()
    f = math.factorial(2000)
    el = time.perf_counter() - t
    print(f"  2000! = {len(str(f)):,}자리, {el:.4f}s 만에 정확히 계산된다")
    print("  C++ 의 unsigned long long 은 20! 에서 이미 넘친다")
    print(f"  20!  = {math.factorial(20)}  (2^64 = {2**64})")
    print(f"  21!  = {math.factorial(21)}  <- 2^64 초과")


if __name__ == "__main__":
    size_by_bits()
    add_cost()
    mul_cost()
    str_conversion()
    factorial_cost()
