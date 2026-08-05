"""Python 의 순환 참조는 누가 언제 치우는가 — XI-11 §4·§5 의 수치.

세 가지를 확인한다.
  (1) 순환은 참조 계수만으로는 절대 회수되지 않는다. 순환 수집기가 치운다.
  (2) 수집기를 끄면 C++ 와 똑같이 샌다. 공짜가 아니다.
  (3) `__del__` 이 달린 순환도 3.4(PEP 442) 이후로는 회수된다.

사용법: python3.13 tools/bench/py_gc_cycle.py
"""

import gc
import statistics
import sys
import time

PAIRS = 200000


class Node:
    __slots__ = ("id", "payload", "peer")

    def __init__(self, i):
        self.id = i
        self.payload = bytearray(256)
        self.peer = None


class NoisyNode(Node):
    __slots__ = ()
    destroyed = 0

    def __del__(self):
        NoisyNode.destroyed += 1


def rss_mb():
    with open("/proc/self/statm") as f:
        return int(f.read().split()[1]) * 4096 / 1024 / 1024


def make_cycles(cls, n):
    for i in range(n):
        a, b = cls(2 * i), cls(2 * i + 1)
        a.peer = b
        b.peer = a


def main():
    print(f"CPython {sys.version.split()[0]} · GIL {sys._is_gil_enabled()}")
    print(f"쌍 {PAIRS:,}개 · 노드 하나에 256바이트 페이로드\n")

    # (1) 수집기를 끈 채 만들고 놓아 버린다 — 참조 계수만으로는 아무것도 안 사라진다
    gc.collect()
    gc.disable()
    before = rss_mb()
    make_cycles(Node, PAIRS)
    after = rss_mb()
    print(f"[수집기 끔] 만들고 전부 놓아 버린 뒤 RSS 증가: {after - before:.0f} MB")

    # (2) 수집기를 부르면 회수된다
    t0 = time.perf_counter()
    n = gc.collect()
    t1 = time.perf_counter()
    print(f"[수집기 호출] 회수한 객체 {n:,}개 · {(t1 - t0) * 1000:.0f} ms"
          f" · RSS {rss_mb() - before:+.0f} MB")

    # (3) __del__ 이 달린 순환. 3.4 이전에는 gc.garbage 로 밀려나 영영 안 치워졌다
    gc.enable()
    NoisyNode.destroyed = 0
    make_cycles(NoisyNode, 1000)
    gc.collect()
    print(f"[__del__ 있는 순환 1,000쌍] 소멸자 호출 {NoisyNode.destroyed}회"
          f" · gc.garbage {len(gc.garbage)}개")

    # (4) 수집기가 켜져 있을 때의 비용. 순환이 없어도 세대 스캔은 돈다
    print()
    for label, enabled in (("수집기 켬", True), ("수집기 끔", False)):
        ts = []
        for _ in range(5):
            gc.collect()
            gc.enable() if enabled else gc.disable()
            t0 = time.perf_counter()
            make_cycles(Node, 50000)
            ts.append((time.perf_counter() - t0) * 1000)
            gc.enable()
            gc.collect()
        v = sorted(ts)
        print(f"  {label} · 5만 쌍 만들기 {statistics.median(v):.0f} ms"
              f"  ({v[0]:.0f} ~ {v[-1]:.0f})")


if __name__ == "__main__":
    main()
