#!/usr/bin/env python3
"""0-12 — 랜덤 스트레스 테스트 하네스 (Python 쪽).

네 조각으로 이루어진다. 이 구조는 문제가 바뀌어도 그대로다.

    gen(rng)   무작위 입력 하나를 만든다 — **작게**
    brute(t)   느리지만 확실히 맞는 답
    fast(t)    빠른 답 (검증 대상)
    main()     둘이 갈릴 때까지 돌리고, 갈리면 입력을 줄인다

검증 대상은 "정렬된 배열에서 a[i] + a[j] == x (i < j) 인 쌍의 개수"를 세는
투 포인터다. 눈으로는 맞아 보이지만 중복 값에서 깨진다.

사용법:
    python3.13 tools/bench/stress_pair_sum.py [반복횟수] [fixed]
"""
from __future__ import annotations

import random
import sys


# --- 1. 생성기: 작게, 그리고 값 범위를 좁게 -------------------------------
def gen(rng):
    n = rng.randint(1, 6)          # 크게 만들면 어디가 문제인지 안 보인다
    x = rng.randint(0, 6)          # 값 범위를 좁혀야 중복이 생긴다
    a = sorted(rng.randint(0, 3) for _ in range(n))
    return (a, x)


# --- 2. 브루트포스: O(n^2). 느려도 된다. 맞기만 하면 된다 -----------------
def brute(t):
    a, x = t
    cnt = 0
    for i in range(len(a)):
        for j in range(i + 1, len(a)):
            if a[i] + a[j] == x:
                cnt += 1
    return cnt


# --- 3. 검증 대상: O(n) 투 포인터 ------------------------------------------
def fast(t):
    a, x = t
    i, j, cnt = 0, len(a) - 1, 0
    while i < j:
        s = a[i] + a[j]
        if s == x:
            cnt += 1               # ❌ 같은 값이 여럿이면 한 번만 세고 지나간다
            i += 1
            j -= 1
        elif s < x:
            i += 1
        else:
            j -= 1
    return cnt


# --- 3b. 고친 판: 반례를 보고 나서 짠다 -----------------------------------
def fixed(t):
    """축소된 반례가 알려 준 것을 반영한 판. 같은 값 덩어리를 한꺼번에 센다."""
    a, x = t
    i, j, cnt = 0, len(a) - 1, 0
    while i < j:
        s = a[i] + a[j]
        if s < x:
            i += 1
        elif s > x:
            j -= 1
        elif a[i] == a[j]:             # 남은 구간이 전부 같은 값이면 조합으로 센다
            m = j - i + 1
            cnt += m * (m - 1) // 2
            break
        else:
            ci = 1
            while a[i + 1] == a[i]:
                i += 1
                ci += 1
            cj = 1
            while a[j - 1] == a[j]:
                j -= 1
                cj += 1
            cnt += ci * cj             # 왼쪽 덩어리 x 오른쪽 덩어리
            i += 1
            j -= 1
    return cnt


# 검사 대상을 바꿔 끼우는 자리. 하네스 나머지는 손대지 않는다.
TARGET = fast


def fails(t):
    return brute(t) != TARGET(t)


# --- 4. 축소: 실패를 유지하면서 입력을 더 못 줄일 때까지 깎는다 -----------
def shrink(t):
    """실패하는 입력 t 를 최소 실패 입력으로 줄인다.

    한 번에 한 곳만 건드리고, 실패가 유지될 때만 채택한다. 이 단조성이
    종료를 보장한다 — 채택될 때마다 (길이, 값의 합) 이 반드시 줄어든다.
    """
    a, x = t
    changed = True
    steps = 0
    while changed:
        changed = False
        # (a) 원소 하나 지우기
        for i in range(len(a)):
            cand = (a[:i] + a[i + 1:], x)
            steps += 1
            if fails(cand):
                a, changed = cand[0], True
                break
        if changed:
            continue
        # (b) 원소 하나 줄이기
        for i in range(len(a)):
            if a[i] > 0:
                b = a[:]
                b[i] -= 1
                cand = (sorted(b), x)
                steps += 1
                if fails(cand):
                    a, changed = cand[0], True
                    break
        if changed:
            continue
        # (c) x 줄이기
        if x > 0:
            cand = (a, x - 1)
            steps += 1
            if fails(cand):
                x, changed = x - 1, True
    return (a, x), steps


def main():
    global TARGET
    iters = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
    if len(sys.argv) > 2 and sys.argv[2] == "fixed":
        TARGET = fixed
        print("검사 대상: fixed()")
    else:
        print("검사 대상: fast()")
    rng = random.Random(20260804)
    for it in range(1, iters + 1):
        t = gen(rng)
        if fails(t):
            print(f"[{it}회차] 불일치 발견")
            print(f"  입력   a={t[0]} x={t[1]}")
            print(f"  brute  {brute(t)}")
            print(f"  대상   {TARGET(t)}")
            small, steps = shrink(t)
            print(f"  -- 축소 {steps}회 시도 --")
            print(f"  최소 입력 a={small[0]} x={small[1]}")
            print(f"  brute  {brute(small)}")
            print(f"  대상   {TARGET(small)}")
            return 1
        if it % 20000 == 0:
            print(f"  {it}회 통과")
    print(f"{iters}회 전부 일치")
    return 0


if __name__ == "__main__":
    sys.exit(main())
