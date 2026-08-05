#!/usr/bin/env python3
"""XI-7 — 연결 하나당 스레드 하나의 비용을 실측한다.

무엇을 재는가
    1. 스레드 N개를 띄웠을 때 늘어나는 가상 메모리(VmSize)와 상주 메모리(VmRSS).
       기본 스택 크기(ulimit -s)가 스레드마다 예약되므로 VmSize 가 먼저 자란다.
       실제로 만져진 페이지만 RSS 로 잡히므로 둘의 차이가 크다 — 그 차이가 요점이다.
    2. 스레드 생성 시간과 컨텍스트 스위치 한 번의 비용.
    3. 같은 수의 fd 를 이벤트 루프(selectors)에 등록했을 때의 메모리·시간·poll 비용.

각 측정은 fork 한 자식 프로세스에서 한다. 한 프로세스에서 연달아 재면 앞 단계가
반납한 힙을 뒤 단계가 재사용해 메모리 증가분이 0으로 나온다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / 4코어).
시간과 메모리는 별도 패스로 잰다 — tracemalloc 은 쓰지 않는다.

사용법: python3.13 tools/bench/thread_vs_eventloop_memory.py [N] [반복]
"""

from __future__ import annotations

import json
import os
import resource
import selectors
import socket
import statistics
import sys
import threading
import time


def status_kb(key: str) -> int:
    with open("/proc/self/status", encoding="utf-8") as f:
        for line in f:
            if line.startswith(key):
                return int(line.split()[1])
    return -1


def in_child(fn, *args):
    """fn 을 자식 프로세스에서 실행하고 dict 결과를 파이프로 받는다."""
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(r)
        try:
            out = fn(*args)
            os.write(w, json.dumps(out).encode())
        finally:
            os.close(w)
            os._exit(0)
    os.close(w)
    buf = b""
    while chunk := os.read(r, 65536):
        buf += chunk
    os.close(r)
    os.waitpid(pid, 0)
    return json.loads(buf)


def measure_threads(n: int) -> dict[str, float]:
    stop = threading.Event()
    base_vsz, base_rss = status_kb("VmSize:"), status_kb("VmRSS:")

    t0 = time.perf_counter()
    ts = [threading.Thread(target=stop.wait, daemon=True) for _ in range(n)]
    for t in ts:
        t.start()
    spawn = time.perf_counter() - t0

    while threading.active_count() < n + 1:  # 전부 올라온 뒤에 잰다
        time.sleep(0.001)
    vsz, rss = status_kb("VmSize:") - base_vsz, status_kb("VmRSS:") - base_rss

    stop.set()
    for t in ts:
        t.join()
    return {"vsz_kb": vsz, "rss_kb": rss, "spawn_ms": spawn * 1000}


def measure_selector(n: int) -> dict[str, float]:
    base_vsz, base_rss = status_kb("VmSize:"), status_kb("VmRSS:")
    sel = selectors.DefaultSelector()
    pairs = []

    t0 = time.perf_counter()
    for _ in range(n):
        a, b = socket.socketpair()
        pairs.append((a, b))
        sel.register(a, selectors.EVENT_READ)
    setup = time.perf_counter() - t0

    vsz, rss = status_kb("VmSize:") - base_vsz, status_kb("VmRSS:") - base_rss

    # 전부 놀고 있을 때 poll 한 번의 비용. epoll 은 등록된 fd 수와 무관하다.
    t0 = time.perf_counter()
    for _ in range(500):
        sel.select(timeout=0)
    poll_us = (time.perf_counter() - t0) / 500 * 1e6

    sel.close()
    for a, b in pairs:
        a.close()
        b.close()
    return {"vsz_kb": vsz, "rss_kb": rss, "setup_ms": setup * 1000, "poll_us": poll_us}


def measure_switch(rounds: int = 20000) -> dict[str, float]:
    """두 스레드가 이벤트로 핑퐁하며 강제로 컨텍스트 스위치를 낸다."""
    a, b = threading.Event(), threading.Event()

    def pong():
        for _ in range(rounds):
            a.wait()
            a.clear()
            b.set()

    t = threading.Thread(target=pong)
    t.start()
    t0 = time.perf_counter()
    for _ in range(rounds):
        a.set()
        b.wait()
        b.clear()
    dt = time.perf_counter() - t0
    t.join()
    # 왕복 한 번에 스위치 두 번
    return {"switch_us": dt / (rounds * 2) * 1e6}


def measure_call(rounds: int = 200000) -> dict[str, float]:
    """비교군: 같은 일을 한 스레드 안에서 함수 호출로 처리했을 때."""
    state = [0]

    def handler():
        state[0] += 1

    t0 = time.perf_counter()
    for _ in range(rounds):
        handler()
    dt = time.perf_counter() - t0
    return {"call_us": dt / rounds * 1e6}


def med_range(xs: list[float], p: int = 1) -> str:
    return f"{statistics.median(xs):.{p}f} ({min(xs):.{p}f}~{max(xs):.{p}f})"


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    reps = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    soft, _ = resource.getrlimit(resource.RLIMIT_STACK)
    print(f"기본 스레드 스택(ulimit -s): {soft // 1024} KiB")
    print(f"스레드/fd {n}개 · {reps}회 반복 · 중앙값(최소~최대)\n")

    th = [in_child(measure_threads, n) for _ in range(reps)]
    print("[thread-per-connection]")
    print(f"  VmSize 증가 : {med_range([r['vsz_kb'] / 1024 for r in th])} MiB")
    print(f"  VmRSS  증가 : {med_range([r['rss_kb'] / 1024 for r in th])} MiB")
    print(f"  생성 시간   : {med_range([r['spawn_ms'] for r in th])} ms")
    print(f"  스레드당 VmSize: {statistics.median([r['vsz_kb'] for r in th]) / n:.0f} KiB")
    print(f"  스레드당 VmRSS : {statistics.median([r['rss_kb'] for r in th]) / n:.1f} KiB")

    se = [in_child(measure_selector, n) for _ in range(reps)]
    print("\n[event loop / selectors]")
    print(f"  VmSize 증가 : {med_range([r['vsz_kb'] / 1024 for r in se])} MiB")
    print(f"  VmRSS  증가 : {med_range([r['rss_kb'] / 1024 for r in se])} MiB")
    print(f"  등록 시간   : {med_range([r['setup_ms'] for r in se])} ms")
    print(f"  poll 1회    : {med_range([r['poll_us'] for r in se], 2)} us (전부 유휴)")

    sw = [in_child(measure_switch) for _ in range(reps)]
    ca = [in_child(measure_call) for _ in range(reps)]
    print("\n[디스패치 한 번의 비용]")
    print(f"  스레드 컨텍스트 스위치: {med_range([r['switch_us'] for r in sw], 2)} us")
    print(f"  같은 스레드 안 함수 호출: {med_range([r['call_us'] for r in ca], 3)} us")


if __name__ == "__main__":
    main()
