#!/usr/bin/env python3
"""0-4 — Timsort 가 기존 정렬 구간(run)을 알아보는지 실측.

Timsort 는 이미 정렬된 구간을 병합 단위로 재사용한다. 그래서 입력의 "정렬된
정도"에 따라 시간이 O(n log n) 에서 O(n) 쪽으로 내려간다. 비교 기반 정렬의
하한이 O(n log n) 이라는 명제는 '무작위 입력'에 대한 것이다.

사용법: python3.13 tools/bench/py_timsort.py
"""
import random
import time

N = 2_000_000
REPEAT = 3


def make(kind: str, n: int) -> list[int]:
    rnd = random.Random(1)
    if kind == "무작위":
        return [rnd.randrange(n) for _ in range(n)]
    if kind == "이미 오름차순":
        return list(range(n))
    if kind == "이미 내림차순":
        return list(range(n, 0, -1))
    if kind == "런 2개 (앞뒤 절반씩 정렬)":
        return list(range(n // 2)) + list(range(n // 2))
    if kind == "99% 정렬 + 1% 흐트러짐":
        a = list(range(n))
        for _ in range(n // 100):
            i = rnd.randrange(n)
            j = rnd.randrange(n)
            a[i], a[j] = a[j], a[i]
        return a
    if kind == "전부 같은 값":
        return [7] * n
    raise ValueError(kind)


KINDS = [
    "무작위",
    "이미 오름차순",
    "이미 내림차순",
    "런 2개 (앞뒤 절반씩 정렬)",
    "99% 정렬 + 1% 흐트러짐",
    "전부 같은 값",
]


def main() -> None:
    print(f"list.sort() — 원소 {N:,}개, {REPEAT}회 중 최솟값")
    base = None
    for kind in KINDS:
        src = make(kind, N)
        best = min(_time(src) for _ in range(REPEAT))
        if base is None:
            base = best
        print(f"  {kind:<28} {best:6.3f}s   무작위 대비 x{best / base:5.2f}")

    print("\n비교 횟수 계측 (원소 200,000개) — 실제로 몇 번 비교하는가")
    for kind in KINDS:
        src = make(kind, 200_000)
        cnt = _count_compares(src)
        print(f"  {kind:<28} {cnt:>12,}회   n log2 n = {int(200_000 * 17.6):,}")

    print("\n갤러핑(galloping) — 두 런의 값 범위가 겹치는가로 갈린다 (원소 200,000개)")
    h = 100_000
    cases = {
        # 앞 런의 값이 전부 뒤 런보다 크다 -> 한쪽이 연달아 이긴다 -> 갤러핑 발동
        "겹치지 않는 두 런": list(range(h, 2 * h)) + list(range(h)),
        # 지퍼처럼 한 번씩 번갈아 이긴다 -> 연승이 안 쌓여 갤러핑이 안 걸린다
        "지퍼처럼 맞물린 두 런": list(range(0, 2 * h, 2)) + list(range(1, 2 * h, 2)),
    }
    for kind, src in cases.items():
        print(f"  {kind:<28} {_count_compares(src):>12,}회")

    print("\n안정성 — 같은 키의 원래 순서가 보존되는가")
    data = [("b", 1), ("a", 2), ("b", 3), ("a", 4)]
    print(f"  원본                    {data}")
    print(f"  sorted(key=첫 원소)     {sorted(data, key=lambda p: p[0])}")


def _time(src: list[int]) -> float:
    a = src[:]
    t = time.perf_counter()
    a.sort()
    return time.perf_counter() - t


class Counted:
    """__lt__ 호출 횟수를 세는 래퍼. sort 는 오직 < 만 쓴다."""

    __slots__ = ("v",)
    n = 0

    def __init__(self, v: int) -> None:
        self.v = v

    def __lt__(self, other: "Counted") -> bool:
        Counted.n += 1
        return self.v < other.v


def _count_compares(src: list[int]) -> int:
    a = [Counted(v) for v in src]
    Counted.n = 0
    a.sort()
    return Counted.n


if __name__ == "__main__":
    main()
