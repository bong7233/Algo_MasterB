#!/usr/bin/env python3
"""0-6 §vector — cpp_vector_growth.cpp 의 Python 대응.

CPython list 도 같은 일을 한다. 다만 증가 배수가 2가 아니라 약 1.125 이고,
용량을 직접 물어보는 API 가 없어 sys.getsizeof 로 역산한다.

    python3.13 tools/bench/py_list_growth_cmp.py
"""
import sys


def capacity(lst: list) -> int:
    """PyListObject 헤더(56바이트)를 빼고 포인터 8바이트로 나눈다."""
    return (sys.getsizeof(lst) - sys.getsizeof([])) // 8


def main() -> None:
    v: list[int] = []
    cap = capacity(v)
    print(f"append 0회: size=0 capacity={cap}")
    reallocs = 0
    for i in range(1000):
        v.append(i)
        c = capacity(v)
        if c != cap:
            reallocs += 1
            print(f"append {i + 1:4d}회: size={len(v):4d} capacity={c:4d}  (재할당 {reallocs}번째)")
            cap = c
    print(f"원소 1000개를 넣는 동안 재할당 {reallocs}번, 최종 capacity={cap}")


if __name__ == "__main__":
    main()
