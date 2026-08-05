#!/usr/bin/env python3
"""VI-5 검증 — 좌표 압축과 "끝점 + 1" 함정을 브루트포스와 대조한다.

왜 필요한가
    좌표 압축 자체는 세 줄이라 틀릴 곳이 없어 보인다. 실제로 틀리는 곳은
    **구간의 끝점을 압축할 때**다. 닫힌 구간 [l, r] 을 끝점만 모아 압축하면
    서로 다른 입력이 같은 압축 좌표로 뭉개진다. 그 사실을 무작위 입력에서
    브루트포스와 대조해 확인한다.

무엇을 검사하는가
    1. rank(정렬 + 중복 제거 + 이분 탐색)가 "자신보다 작은 서로 다른 값의 수"와 같은가
    2. 끝점만 압축한 덩어리 세기가 브루트포스와 갈리는가 (갈려야 정상)
    3. 끝점 + 1 을 함께 압축한 반열림 판이 브루트포스와 항상 같은가
    4. 칠해진 칸 수(길이)도 같은가
    5. 본문에 실린 두 반례의 값

사용법
    python3.13 tools/bench/coord_compress_verify.py
"""

import bisect
import random


def compress(values):
    xs = sorted(set(values))
    return xs, [bisect.bisect_left(xs, v) for v in values]


def blocks_naive(segs, lo, hi):
    """칸 단위로 직접 칠해 덩어리 수와 칠해진 칸 수를 센다."""
    painted = [False] * (hi - lo + 1)
    for l, r in segs:
        for x in range(l, r + 1):
            painted[x - lo] = True
    blocks, cells, prev = 0, 0, False
    for p in painted:
        if p:
            cells += 1
            if not prev:
                blocks += 1
        prev = p
    return blocks, cells


def blocks_wrong(segs):
    """끝점만 압축한다 — 구간 사이의 빈틈이 사라진다."""
    xs = sorted({v for l, r in segs for v in (l, r)})
    cover = [0] * len(xs)
    for l, r in segs:
        for i in range(bisect.bisect_left(xs, l), bisect.bisect_left(xs, r) + 1):
            cover[i] = 1
    blocks, prev = 0, 0
    for c in cover:
        if c and not prev:
            blocks += 1
        prev = c
    return blocks


def blocks_right(segs):
    """끝점 + 1 까지 압축해 반열림 [l, r+1) 로 다룬다."""
    xs = sorted({v for l, r in segs for v in (l, r + 1)})
    slots = len(xs) - 1
    cover = [0] * slots
    for l, r in segs:
        for i in range(bisect.bisect_left(xs, l), bisect.bisect_left(xs, r + 1)):
            cover[i] = 1
    blocks, cells, prev = 0, 0, 0
    for i, c in enumerate(cover):
        if c:
            cells += xs[i + 1] - xs[i]
            if not prev:
                blocks += 1
        prev = c
    return blocks, cells


def main():
    random.seed(20260805)
    trials = 4000

    bad = 0
    for _ in range(trials):
        vals = [random.randint(-20, 20) for _ in range(random.randint(1, 10))]
        _, ranks = compress(vals)
        for v, got in zip(vals, ranks):
            want = len({u for u in vals if u < v})
            if got != want:
                bad += 1
    print(f"압축 순위 vs 정의  : {trials}회, 불일치 {bad}건")

    wrong_hits, right_bad, cell_bad = 0, 0, 0
    for _ in range(trials):
        segs = []
        for _ in range(random.randint(1, 5)):
            l = random.randint(0, 18)
            r = random.randint(l, min(20, l + 6))
            segs.append((l, r))
        want_blocks, want_cells = blocks_naive(segs, 0, 20)
        if blocks_wrong(segs) != want_blocks:
            wrong_hits += 1
        gb, gc = blocks_right(segs)
        if gb != want_blocks:
            right_bad += 1
        if gc != want_cells:
            cell_bad += 1
    print(f"끝점만 압축        : {trials}회 중 브루트포스와 갈린 것 {wrong_hits}건 (갈려야 정상)")
    print(f"끝점+1 압축(덩어리): {trials}회, 불일치 {right_bad}건")
    print(f"끝점+1 압축(칸 수) : {trials}회, 불일치 {cell_bad}건")

    # 본문 반례: 두 입력이 끝점만 압축하면 같은 것이 된다
    for segs in ([(1, 2), (3, 4)], [(1, 2), (4, 5)]):
        want, cells = blocks_naive(segs, 0, 6)
        print(f"  segs={segs}  브루트포스 덩어리={want} 칸={cells} / "
              f"끝점만={blocks_wrong(segs)} / 끝점+1={blocks_right(segs)}")

    # 본문 손추적 예제
    segs = [(1, 2), (4, 5), (2, 3)]
    print(f"본문 손추적 segs={segs} 브루트포스={blocks_naive(segs, 0, 8)} "
          f"끝점+1={blocks_right(segs)}")


if __name__ == "__main__":
    main()
