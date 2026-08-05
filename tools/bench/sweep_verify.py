#!/usr/bin/env python3
"""VI-6 검증 — 스위핑의 세 답을 좌표 단위 브루트포스와 대조한다.

왜 필요한가
    스위핑의 정확성은 전부 **같은 좌표에 놓인 이벤트의 처리 순서**에 걸려 있다.
    닫힘 구간에서 끝(-1)을 시작(+1)보다 먼저 처리하면 최대 겹침이 1 모자라고,
    반열림 구간에서 시작을 먼저 처리하면 1 남는다. 두 오류 모두 대부분의
    입력에서는 같은 답을 낸다. 무작위 입력에서만 갈린다.

무엇을 검사하는가
    1. 최대 겹침 수 (반열림 [s, e) 기준)
    2. 합집합 길이
    3. 덩어리 수
    4. 동점 처리 순서를 뒤집으면 실제로 답이 달라지는가
    5. 본문 손추적 예제의 값

사용법
    python3.13 tools/bench/sweep_verify.py
"""

import random

LO, HI = 0, 24


def sweep(segs, end_first=True):
    """반열림 [s, e) 로 훑는다. end_first=True 면 같은 좌표에서 -1 을 먼저."""
    ev = []
    for s, e in segs:
        ev.append((s, +1))
        ev.append((e, -1))
    # 같은 좌표에서 -1 을 먼저 처리하려면 delta 오름차순으로 정렬한다
    ev.sort(key=lambda t: (t[0], t[1] if end_first else -t[1]))

    open_cnt = 0
    best = 0
    length = 0
    blocks = 0
    prev = None
    i = 0
    while i < len(ev):
        x = ev[i][0]
        if prev is not None and open_cnt > 0:
            length += x - prev
        was_open = open_cnt > 0
        while i < len(ev) and ev[i][0] == x:
            open_cnt += ev[i][1]
            i += 1
        if not was_open and open_cnt > 0:
            blocks += 1
        best = max(best, open_cnt)
        prev = x
    return best, length, blocks


def sweep_per_event(segs, start_first):
    """이벤트를 하나씩 처리하며 그때마다 최댓값을 갱신한다.

    같은 좌표에 시작(+1)과 끝(-1)이 함께 있을 때 어느 쪽을 먼저 처리하느냐가
    "끝점에서 맞닿는 것을 겹침으로 세는가"를 결정한다. 이것이 스위핑의 오프바이원이다.
    """
    ev = []
    for s, e in segs:
        ev.append((s, +1))
        ev.append((e, -1))
    ev.sort(key=lambda t: (t[0], -t[1] if start_first else t[1]))
    open_cnt, best = 0, 0
    for _, d in ev:
        open_cnt += d
        best = max(best, open_cnt)
    return best


def brute_closed_point(segs):
    """닫힌 구간 [s, e] 로 보고, 정수 점마다 몇 개가 덮는지 센다."""
    cover = [0] * (HI + 2)
    for s, e in segs:
        for x in range(s, e + 1):
            cover[x] += 1
    return max(cover)


def brute(segs):
    """단위 칸마다 몇 개가 덮는지 직접 센다. 반열림 [s, e)."""
    cover = [0] * (HI - LO)
    for s, e in segs:
        for x in range(s, e):
            cover[x - LO] += 1
    best = max(cover) if cover else 0
    length = sum(1 for c in cover if c)
    blocks, prev = 0, 0
    for c in cover:
        if c and not prev:
            blocks += 1
        prev = c
    return best, length, blocks


def main():
    random.seed(20260805)
    trials = 5000

    bad = 0
    for _ in range(trials):
        segs = []
        for _ in range(random.randint(1, 6)):
            s = random.randint(LO, HI - 1)
            e = random.randint(s + 1, HI)
            segs.append((s, e))
        if sweep(segs) != brute(segs):
            bad += 1
    print(f"스위핑 vs 좌표 브루트포스 : {trials}회, 불일치 {bad}건")

    start_bad, end_bad, differ = 0, 0, 0
    for _ in range(trials):
        segs = []
        for _ in range(random.randint(2, 6)):
            s = random.randint(LO, HI - 1)
            e = random.randint(s, HI)
            segs.append((s, e))
        want = brute_closed_point(segs)         # 닫힌 구간: 끝점이 맞닿아도 겹침이다
        a = sweep_per_event(segs, start_first=True)
        b = sweep_per_event(segs, start_first=False)
        if a != want:
            start_bad += 1
        if b != want:
            end_bad += 1
        if a != b:
            differ += 1
    print(f"닫힌 구간 최대 겹침 — 시작(+1) 먼저 : {trials}회, 불일치 {start_bad}건")
    print(f"닫힌 구간 최대 겹침 — 끝(-1)  먼저 : {trials}회, 불일치 {end_bad}건 (틀려야 정상)")
    print(f"두 순서가 실제로 답이 갈린 입력    : {differ}건")

    segs = [(1, 5), (2, 6), (4, 7), (8, 9)]
    print(f"본문 손추적 segs={segs}")
    print(f"  스위핑    (최대겹침, 길이, 덩어리) = {sweep(segs)}")
    print(f"  브루트포스(최대겹침, 길이, 덩어리) = {brute(segs)}")

    tie = [(1, 2), (2, 3)]
    print(f"동점 예제 segs={tie} (닫힌 구간으로 볼 때 정답 {brute_closed_point(tie)})")
    print(f"  시작(+1) 먼저 = {sweep_per_event(tie, True)} / "
          f"끝(-1) 먼저 = {sweep_per_event(tie, False)}")


if __name__ == "__main__":
    main()
