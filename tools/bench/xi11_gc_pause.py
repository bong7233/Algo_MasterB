"""순환 수집기의 멈춤 시간은 무엇에 비례하는가 — XI-11 §4 의 수치.

순환 참조를 회수해 주는 것은 공짜가 아니다. 참조 계수는 계수가 0이 되는 그 자리에서
끝나지만, 순환 수집기는 **살아 있는 컨테이너 객체를 전부 훑어야** 순환인지 아닌지를
판정할 수 있다. 그래서 멈춤 시간은 쓰레기의 양이 아니라 **살아 있는 객체의 수**에
비례한다 — 아무것도 회수할 것이 없어도 시간이 든다.

두 가지를 잰다.
  1. 쓰레기가 하나도 없는 상태에서 `gc.collect()` 가 얼마나 걸리는가.
     살아 있는 노드 수를 5만 -> 40만으로 늘리며 본다.
  2. 같은 노드 수에서 순환 쓰레기를 회수할 때의 시간.

시간과 메모리는 별도 패스다(§1-3). 이 스크립트는 시간만 잰다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13.12 / 4 코어).
실행: python3.13 tools/bench/xi11_gc_pause.py
"""

import gc
import statistics
import sys
import time

REPEAT = 7


class Node:
    __slots__ = ("id", "peer")

    def __init__(self, i):
        self.id = i
        self.peer = None


def live_chain(n):
    """서로를 가리키는 노드 n 개를 만들어 **살려 둔다**. 쓰레기가 아니다."""
    nodes = [Node(i) for i in range(n)]
    for i, nd in enumerate(nodes):
        nd.peer = nodes[(i + 1) % n]      # 순환이지만 뿌리에서 도달 가능하다
    return nodes


def collect_ms():
    gc.collect()                          # 앞의 쓰레기를 미리 치운다
    t0 = time.perf_counter()
    gc.collect()                          # 잴 대상 — 회수할 것이 없는 전체 수집
    return (time.perf_counter() - t0) * 1000


def garbage_collect_ms(n):
    """순환 쓰레기 n 쌍을 만들어 놓고 회수하는 데 걸리는 시간."""
    gc.collect()
    gc.disable()
    for i in range(n):
        a, b = Node(2 * i), Node(2 * i + 1)
        a.peer = b
        b.peer = a
    del a, b
    gc.enable()
    t0 = time.perf_counter()
    gc.collect()
    return (time.perf_counter() - t0) * 1000


def show(label, samples):
    v = sorted(samples)
    print(f"  {label:34s} 중앙값 {statistics.median(v):6.1f} ms  "
          f"({v[0]:.1f} ~ {v[-1]:.1f})")


if __name__ == "__main__":
    print(f"CPython {sys.version.split()[0]} · GIL {sys._is_gil_enabled()} · 코어 4 "
          f"· {REPEAT}회 실행")

    print("쓰레기가 하나도 없을 때의 전체 수집")
    for n in (50000, 100000, 200000, 400000):
        keep = live_chain(n)
        show(f"살아 있는 노드 {n:,}개", [collect_ms() for _ in range(REPEAT)])
        del keep
        gc.collect()

    print("순환 쓰레기를 회수할 때")
    for n in (50000, 100000, 200000):
        show(f"순환 {n:,}쌍 회수", [garbage_collect_ms(n) for _ in range(REPEAT)])
