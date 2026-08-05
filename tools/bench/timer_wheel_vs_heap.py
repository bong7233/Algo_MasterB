#!/usr/bin/env python3
"""XI-8 — 힙 기반 지연 큐와 계층 타이머 휠을 같은 부하로 돌린다.

부하는 두 가지다.
    cancel90 : 타이머의 90%가 만료 전에 취소된다. TCP 재전송 타임아웃이 이 모양이다.
    expire   : 하나도 취소되지 않고 전부 만료된다. 휠에 가장 불리한 경우.

두 구조 모두 같은 발화 순서를 내야 한다(같은 tick 에 같은 집합). 그것을 먼저 확인하고
시간을 잰다 — 답이 다르면 빠른 쪽은 의미가 없다.

측정 환경: CLAUDE.md §1-3. 시간과 메모리는 별도 패스로 잰다.
사용법: python3.13 tools/bench/timer_wheel_vs_heap.py [N] [반복]
"""

from __future__ import annotations

import heapq
import statistics
import sys
import time

HORIZON = 65536
SLOTS, LEVELS = 64, 3


def workload(n: int, cancel_ratio: int) -> tuple[list[int], dict[int, list[int]]]:
    """결정적 LCG 로 만든 부하. 씨앗이 같으면 두 구조가 같은 입력을 본다."""
    state = 12345

    def rnd() -> int:
        nonlocal state
        state = (state * 1103515245 + 12345) % (1 << 31)
        return state

    delays, cancel_at = [], {}
    for tid in range(n):
        d = (rnd() >> 8) % HORIZON + 1
        delays.append(d)
        if cancel_ratio and (rnd() >> 8) % 10 < cancel_ratio:
            cancel_at.setdefault(d // 2, []).append(tid)
    return delays, cancel_at


def run_heap(delays, cancel_at, collect=False):
    h, dead, fired = [], set(), {}
    for tid, d in enumerate(delays):
        heapq.heappush(h, (d, tid))
    for tid in cancel_at.get(0, ()):
        dead.add(tid)
    for now in range(1, HORIZON + 1):
        for tid in cancel_at.get(now, ()):
            dead.add(tid)
        out = []
        while h and h[0][0] <= now:
            _, tid = heapq.heappop(h)
            if tid not in dead:
                out.append(tid)
        if collect and out:
            fired[now] = sorted(out)
    return fired


def run_wheel(delays, cancel_at, collect=False):
    w = [[{} for _ in range(SLOTS)] for _ in range(LEVELS)]
    where, fired = {}, {}
    span = [SLOTS ** (L + 1) for L in range(LEVELS)]
    step = [SLOTS**L for L in range(LEVELS)]

    def place(due, tid, now):
        d = due - now
        for L in range(LEVELS):
            if d < span[L]:
                idx = (due // step[L]) % SLOTS
                w[L][idx][tid] = due
                where[tid] = (L, idx)
                return

    def cascade(L, now):
        if L >= LEVELS:
            return
        idx = (now // step[L]) % SLOTS
        items, w[L][idx] = w[L][idx], {}
        for tid, due in items.items():
            place(due, tid, now)
        if idx == 0:
            cascade(L + 1, now)

    for tid, d in enumerate(delays):
        place(d, tid, 0)
    for tid in cancel_at.get(0, ()):
        L, idx = where.pop(tid)
        del w[L][idx][tid]
    for now in range(1, HORIZON + 1):
        for tid in cancel_at.get(now, ()):
            L, idx = where.pop(tid)
            del w[L][idx][tid]
        if now % SLOTS == 0:
            cascade(1, now)
        idx = now % SLOTS
        out, w[0][idx] = w[0][idx], {}
        for tid in out:
            del where[tid]
        if collect and out:
            fired[now] = sorted(out)
    return fired


def med_range(xs: list[float]) -> str:
    return f"{statistics.median(xs):.0f} ({min(xs):.0f}~{max(xs):.0f})"


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
    reps = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    print(f"타이머 {n:,}개 · tick {HORIZON:,}회 · {reps}회 반복 · 중앙값(최소~최대) ms")

    for label, ratio in (("cancel90", 9), ("expire", 0)):
        delays, cancel_at = workload(n, ratio)
        cancels = sum(len(v) for v in cancel_at.values())
        assert run_heap(delays, cancel_at, True) == run_wheel(delays, cancel_at, True), "발화 불일치"

        hs, ws = [], []
        for _ in range(reps):
            t0 = time.perf_counter()
            run_heap(delays, cancel_at)
            hs.append((time.perf_counter() - t0) * 1000)
            t0 = time.perf_counter()
            run_wheel(delays, cancel_at)
            ws.append((time.perf_counter() - t0) * 1000)
        print(f"\n[{label}] 취소 {cancels:,}개 · 발화 순서 일치 확인")
        print(f"  heap (heapq)  : {med_range(hs)}")
        print(f"  wheel (64x3)  : {med_range(ws)}")
        print(f"  배수          : {statistics.median(hs) / statistics.median(ws):.1f}x")


if __name__ == "__main__":
    main()
