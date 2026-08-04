#!/usr/bin/env python3
"""II-7 — 두 번 정렬해서 다중 키를 만드는 관용구 (Python 쪽).

`list.sort` 는 Timsort 이고 **항상 안정**이다. 그래서 이 관용구는 n 과 무관하게
성립한다. 같은 코드를 C++ 의 `std::sort` 로 옮기면 n = 17 부터 깨진다 —
`sort_multikey.cpp` 가 그 지점을 찾아 찍는다.

이 스크립트는 그 대조군이다. n 을 2부터 200까지 전부 확인한다.

사용법:
    python3.13 tools/bench/sort_multikey.py
"""
from __future__ import annotations


def make(n: int) -> list[tuple[int, int]]:
    """(점수, 제출 시각). 점수는 두 종류만 두어 동점 구간을 길게 만든다."""
    return [(100 if i % 2 == 0 else 90, i) for i in range(n)]


def two_pass(rows: list[tuple[int, int]]) -> list[tuple[int, int]]:
    rows = list(rows)
    rows.sort(key=lambda r: r[1])          # 약한 기준: 시각 오름차순
    rows.sort(key=lambda r: -r[0])         # 강한 기준: 점수 내림차순
    return rows


def ok(rows: list[tuple[int, int]]) -> bool:
    return all(
        not (a[0] == b[0] and a[1] > b[1])
        for a, b in zip(rows, rows[1:])
    )


def main() -> None:
    broken = [n for n in range(2, 201) if not ok(two_pass(make(n)))]
    if broken:
        print(f"Timsort 가 깨진 n: {broken[:10]}")
    else:
        print("list.sort 는 n <= 200 전 구간에서 안 깨진다")

    n = 17
    print(f"\nn = {n} 의 결과 (점수:시각), 점수 100 구간만")
    got = [t for s, t in two_pass(make(n)) if s == 100]
    print("list.sort   :", " ".join(map(str, got)))


if __name__ == "__main__":
    main()
