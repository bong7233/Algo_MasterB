#!/usr/bin/env python3
"""VI-4 검증 — 누적 합·차분 배열을 브루트포스와 대조한다.

왜 필요한가
    누적 합과 차분 배열의 버그는 전부 인덱스 하나 차이에서 나온다. 그리고 그
    버그는 대부분의 입력에서 옳은 답을 낸다. 무작위 입력에서 순진한 O(n·q)
    구현과 한 번이라도 갈리면 그 자리가 오프바이원이다.

    2차원 포함배제(+A -B -C +D)는 특히 부호 하나만 틀려도 "그럴듯한" 값이
    나오므로 눈으로는 못 잡는다.

무엇을 검사하는가
    1. 1차원 누적 합 vs 매번 더하기
    2. 1차원 차분 배열 vs 매번 구간 순회하며 더하기
    3. 2차원 누적 합(포함배제) vs 이중 루프 합
    4. 2차원 차분 배열(네 귀퉁이) vs 매번 직사각형 순회하며 더하기
    5. 본문에 실린 손추적 예제의 값

사용법
    python3.13 tools/bench/prefix_diff_verify.py
"""

import random


# ---------------------------------------------------------------- 1차원
def prefix_1d(a):
    S = [0] * (len(a) + 1)
    for i, v in enumerate(a):
        S[i + 1] = S[i] + v
    return S


def diff_1d(n, ops):
    D = [0] * (n + 1)
    for l, r, v in ops:
        D[l] += v
        D[r + 1] -= v
    out, run = [], 0
    for i in range(n):
        run += D[i]
        out.append(run)
    return out


def diff_1d_naive(n, ops):
    a = [0] * n
    for l, r, v in ops:
        for i in range(l, r + 1):
            a[i] += v
    return a


# ---------------------------------------------------------------- 2차원
def prefix_2d(g):
    R, C = len(g), len(g[0])
    S = [[0] * (C + 1) for _ in range(R + 1)]
    for r in range(1, R + 1):
        for c in range(1, C + 1):
            S[r][c] = g[r - 1][c - 1] + S[r - 1][c] + S[r][c - 1] - S[r - 1][c - 1]
    return S


def rect_sum(S, r1, c1, r2, c2):
    return S[r2 + 1][c2 + 1] - S[r1][c2 + 1] - S[r2 + 1][c1] + S[r1][c1]


def diff_2d(R, C, ops):
    D = [[0] * (C + 2) for _ in range(R + 2)]
    for r1, c1, r2, c2, v in ops:
        D[r1][c1] += v
        D[r1][c2 + 1] -= v
        D[r2 + 1][c1] -= v
        D[r2 + 1][c2 + 1] += v
    g = [[0] * C for _ in range(R)]
    for r in range(R):
        for c in range(C):
            up = g[r - 1][c] if r else 0
            left = g[r][c - 1] if c else 0
            diag = g[r - 1][c - 1] if (r and c) else 0
            g[r][c] = D[r][c] + up + left - diag
    return g


def diff_2d_naive(R, C, ops):
    g = [[0] * C for _ in range(R)]
    for r1, c1, r2, c2, v in ops:
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                g[r][c] += v
    return g


def main():
    random.seed(20260805)
    trials = 3000

    bad = 0
    for _ in range(trials):
        n = random.randint(1, 12)
        a = [random.randint(-9, 9) for _ in range(n)]
        S = prefix_1d(a)
        for _ in range(6):
            l = random.randrange(n)
            r = random.randrange(l, n)
            if S[r + 1] - S[l] != sum(a[l:r + 1]):
                bad += 1
    print(f"1D 누적 합       : {trials}회 x 6질의, 불일치 {bad}건")

    bad = 0
    for _ in range(trials):
        n = random.randint(1, 12)
        ops = []
        for _ in range(random.randint(1, 6)):
            l = random.randrange(n)
            r = random.randrange(l, n)
            ops.append((l, r, random.randint(-5, 5)))
        if diff_1d(n, ops) != diff_1d_naive(n, ops):
            bad += 1
    print(f"1D 차분 배열     : {trials}회, 불일치 {bad}건")

    bad = 0
    for _ in range(trials):
        R, C = random.randint(1, 7), random.randint(1, 7)
        g = [[random.randint(-9, 9) for _ in range(C)] for _ in range(R)]
        S = prefix_2d(g)
        for _ in range(6):
            r1, r2 = sorted(random.choices(range(R), k=2))
            c1, c2 = sorted(random.choices(range(C), k=2))
            want = sum(g[r][c] for r in range(r1, r2 + 1) for c in range(c1, c2 + 1))
            if rect_sum(S, r1, c1, r2, c2) != want:
                bad += 1
    print(f"2D 누적 합(포함배제): {trials}회 x 6질의, 불일치 {bad}건")

    bad = 0
    for _ in range(trials):
        R, C = random.randint(1, 7), random.randint(1, 7)
        ops = []
        for _ in range(random.randint(1, 5)):
            r1, r2 = sorted(random.choices(range(R), k=2))
            c1, c2 = sorted(random.choices(range(C), k=2))
            ops.append((r1, c1, r2, c2, random.randint(-5, 5)))
        if diff_2d(R, C, ops) != diff_2d_naive(R, C, ops):
            bad += 1
    print(f"2D 차분(네 귀퉁이): {trials}회, 불일치 {bad}건")

    # 본문 손추적 예제
    n = 8
    ops = [(1, 4, 3), (3, 6, 5), (0, 2, 2)]
    got = diff_1d(n, ops)
    print(f"본문 손추적 결과  : {got}  (브루트포스 {diff_1d_naive(n, ops)})")
    assert got == diff_1d_naive(n, ops)

    # 본문 2차원 예제
    g = [[3, 1, 4, 1],
         [5, 9, 2, 6],
         [5, 3, 5, 8],
         [9, 7, 9, 3]]
    S = prefix_2d(g)
    r1, c1, r2, c2 = 1, 1, 2, 2
    want = sum(g[r][c] for r in range(r1, r2 + 1) for c in range(c1, c2 + 1))
    print(f"본문 2D 질의      : rect_sum={rect_sum(S, r1, c1, r2, c2)}  브루트포스={want}")
    assert rect_sum(S, r1, c1, r2, c2) == want


if __name__ == "__main__":
    main()
