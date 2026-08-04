#!/usr/bin/env python3
"""0-13 — 정렬 안정성이 언제 실제로 갈리는가 (Python 쪽).

`list.sort` 와 `sorted` 는 **안정 정렬**이다(Timsort). C++ 의 `std::sort` 는
안정성을 보장하지 않는다. 그런데 원소가 몇 개 안 되면 std::sort 도 안정적으로
보인다 — introsort 가 작은 구간을 삽입 정렬로 끝내기 때문이다.

그래서 "작은 입력으로 테스트하고 통과했다"가 근거가 되지 못한다. 이 스크립트는
n 을 키워 가며 안정성이 어디서 깨지는지 본다.

`sort_stability.cpp` 와 1:1 로 대응한다.

사용법:
    python3.13 tools/bench/sort_stability.py
"""
from __future__ import annotations


def is_stable(n: int) -> bool:
    """(키, 원래 순서) 쌍을 키로만 정렬한 뒤 원래 순서가 보존됐는지 본다."""
    pairs = [(i % 2, i) for i in range(n)]
    pairs.sort(key=lambda t: t[0])
    last = -1
    for k, order in pairs:
        if k == 0:
            if order < last:
                return False
            last = order
    return True


if __name__ == "__main__":
    print("Python list.sort(key=...)")
    for n in (4, 8, 16, 32, 40, 64, 1000):
        print(f"  n={n:>5}: 안정 = {is_stable(n)}")
