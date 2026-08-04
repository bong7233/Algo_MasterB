#!/usr/bin/env python3
"""0-3 — str 불변성의 비용: 루프 += vs ''.join vs io.StringIO.

문자열은 불변이라 `s += t` 는 매번 새 객체를 만들고 s 전체를 복사한다.
CPython 에는 참조 수가 1인 str 에 한해 realloc 으로 때우는 최적화가 있는데,
그 조건이 깨지는 순간 O(n^2) 이 그대로 드러난다. 두 경우를 다 잰다.

사용법: python3.13 tools/bench/py_str_concat.py
"""
import io
import time

CHUNK = "abcdefghij"  # 10 글자


def plus_equal(n: int) -> int:
    s = ""
    for _ in range(n):
        s += CHUNK
    return len(s)


def plus_equal_pinned(n: int) -> int:
    """참조가 하나 더 살아 있어 in-place realloc 최적화가 막힌 경우."""
    s = ""
    keep = s
    for _ in range(n):
        s += CHUNK
        keep = s  # 왜: 참조 수를 2로 만들어 realloc 경로를 차단한다
    return len(keep)


def join(n: int) -> int:
    parts = []
    for _ in range(n):
        parts.append(CHUNK)
    return len("".join(parts))


def stringio(n: int) -> int:
    buf = io.StringIO()
    for _ in range(n):
        buf.write(CHUNK)
    return len(buf.getvalue())


def main() -> None:
    for n in (50_000, 100_000, 200_000):
        print(f"\n조각 {n:,}개 (총 {n * len(CHUNK):,} 글자)")
        rows = []
        for name, fn in (
            ("s += t (참조 1개)", plus_equal),
            ("s += t (참조 2개)", plus_equal_pinned),
            ("''.join(parts)", join),
            ("io.StringIO", stringio),
        ):
            t = time.perf_counter()
            fn(n)
            rows.append((name, time.perf_counter() - t))
        base = dict(rows)["''.join(parts)"]
        for name, el in rows:
            print(f"  {name:<20} {el:8.4f}s   join 대비 x{el / base:8.1f}")


if __name__ == "__main__":
    main()
