#!/usr/bin/env python3
"""VI-1·VI-2 검증 — 그리디의 정렬 키를 완전탐색과 대조한다.

왜 필요한가
    두 챕터의 핵심 수치는 "무작위 입력에서 정렬 키별 정답률"이다. 본문 코드는
    LCG 씨앗 하나로 500회를 돌리고 끝 순 500 / 시작 순 441 / 짧은 순 492 를
    낸다. 그 숫자가 **알고리즘의 성질인지 그 씨앗의 우연인지**는 씨앗을 바꿔
    봐야 안다. 씨앗 하나에서만 성립하는 비율을 본문에 적으면 그것은 실측이
    아니라 일화다.

    같은 이유로 VI-1 의 반례 탐색("19번째 시도에서 찾았다")도 씨앗에 달려
    있다. 여기서는 씨앗을 여러 개 굴려 **몇 번째쯤 걸리는지의 분포**를 본다.

무엇을 검사하는가
    1. 끝 순 그리디(VI-1)가 완전탐색과 언제나 같은가 — 0 이어야 정상
    2. 세 정렬 키(VI-2 Q1)의 정답률이 씨앗을 바꿔도 같은 자리에 있는가
    3. 밀도 그리디(VI-1 §4.2)가 몇 번째 시도에서 죽는가
    4. Q2 의 힙 · 스위핑 · 완전탐색 세 답이 언제나 일치하는가
    5. Q3 의 마감 순 그리디가 순열 전수와 언제나 같은가
    6. 본문에 실린 반례 두 개의 값

사용법
    python3.13 tools/bench/greedy_sortkey_verify.py
"""

import heapq
import itertools
import random
import statistics
from functools import cmp_to_key


# ------------------------------------------------------------------ VI-1 / Q1
def greedy_end(jobs):
    """끝 이른 순 — 교환 논법이 지목한 키."""
    picked, last = 0, None
    for s, e in sorted(jobs, key=lambda j: j[1]):
        if last is None or s >= last:
            picked += 1
            last = e
    return picked


def greedy_key(jobs, key):
    """세 키를 공정하게 비교하려고 겹침을 매번 전부 검사한다."""
    if key == "end":
        order = sorted(jobs, key=lambda j: j[1])
    elif key == "start":
        order = sorted(jobs, key=lambda j: j[0])
    else:
        order = sorted(jobs, key=lambda j: j[1] - j[0])
    chosen = []
    for s, e in order:
        if all(not (s < ce and cs < e) for cs, ce in chosen):
            chosen.append((s, e))
    return len(chosen)


def brute_schedule(jobs):
    """부분집합 전수 — 정답의 정의 그대로."""
    best = 0
    for r in range(len(jobs), 0, -1):
        if r <= best:
            break
        for cmb in itertools.combinations(jobs, r):
            seq = sorted(cmb, key=lambda j: j[1])
            if all(seq[i][0] >= seq[i - 1][1] for i in range(1, len(seq))):
                best = r
                break
    return best


# ------------------------------------------------------------------ VI-1 §4.2
def by_density(a, b):
    """밀도 내림차순, 같으면 무게 오름차순. 본문과 같이 교차곱으로 비교한다 —
    v/w 를 부동소수로 계산하면 같은 밀도가 다르게 판정될 수 있다(X-7)."""
    if a[1] * b[0] != b[1] * a[0]:
        return -1 if a[1] * b[0] > b[1] * a[0] else 1
    if a[0] != b[0]:
        return -1 if a[0] < b[0] else 1
    return 0


def greedy_knapsack(items, cap):
    """밀도(가치/무게) 내림차순으로 담는다 — VI-1 §4.2 가 반증하는 그리디."""
    order = sorted(items, key=cmp_to_key(by_density))
    total, room = 0, cap
    for w, v in order:
        if w <= room:
            room -= w
            total += v
    return total


def brute_knapsack(items, cap):
    best = 0
    for r in range(len(items) + 1):
        for cmb in itertools.combinations(items, r):
            if sum(w for w, _ in cmb) <= cap:
                best = max(best, sum(v for _, v in cmb))
    return best


# ------------------------------------------------------------------ VI-2 Q2
def min_rooms_heap(lect):
    rooms = []
    for s, e in sorted(lect):
        if rooms and rooms[0] <= s:
            heapq.heappop(rooms)
        heapq.heappush(rooms, e)
    return len(rooms)


def min_rooms_sweep(lect):
    ev = sorted([(s, 1) for s, _ in lect] + [(e, -1) for _, e in lect])
    cur = best = 0
    for _, d in ev:
        cur += d
        best = max(best, cur)
    return best


def brute_overlap(lect):
    """겹침의 최댓값은 어떤 구간의 시작 시각에서 발생한다."""
    return max((sum(1 for s2, e2 in lect if s2 <= s < e2) for s, _ in lect), default=0)


# ------------------------------------------------------------------ VI-2 Q3
def max_lateness(order):
    t = worst = 0
    for dur, due in order:
        t += dur
        worst = max(worst, t - due)
    return worst


def greedy_edf(jobs):
    return max_lateness(sorted(jobs, key=lambda j: j[1]))


def brute_lateness(jobs):
    return min(max_lateness(o) for o in itertools.permutations(jobs))


# ------------------------------------------------------------------ 본체
def main():
    print("[1] VI-2 Q1 — 정렬 키 세 개의 정답률 (씨앗 20개 × 500회)")
    rates = {"end": [], "start": [], "length": []}
    for seed in range(20):
        rng = random.Random(20260805 + seed)
        hit = {"end": 0, "start": 0, "length": 0}
        for _ in range(500):
            n = rng.randint(1, 7)
            trial = []
            for _ in range(n):
                s = rng.randrange(12)
                trial.append((s, s + 1 + rng.randrange(6)))
            best = brute_schedule(trial)
            for k in hit:
                if greedy_key(trial, k) == best:
                    hit[k] += 1
        for k in rates:
            rates[k].append(hit[k])
    for k, label in (("end", "끝 순"), ("start", "시작 순"), ("length", "짧은 순")):
        v = rates[k]
        print(f"    {label:<7} 중앙값 {statistics.median(v):6.1f}/500  "
              f"범위 {min(v)}~{max(v)}  평균 {statistics.mean(v):.1f} "
              f"({statistics.mean(v) / 5:.1f}%)")

    print("\n[2] VI-1 — 끝 순 그리디 vs 완전탐색 (씨앗 20개 × 500회)")
    bad = 0
    for seed in range(20):
        rng = random.Random(770 + seed)
        for _ in range(500):
            n = rng.randint(1, 8)
            trial = []
            for _ in range(n):
                s = rng.randrange(12)
                trial.append((s, s + 1 + rng.randrange(5)))
            if greedy_end(trial) != brute_schedule(trial):
                bad += 1
    print(f"    10,000회 중 불일치 {bad}건 (0 이어야 정상 — 교환 논법이 보증한다)")

    print("\n[3] VI-1 §4.2 — 밀도 그리디가 몇 번째 시도에서 죽는가 (씨앗 200개)")
    firsts = []
    for seed in range(200):
        rng = random.Random(7770 + seed)
        for t in range(1, 1001):
            items = [(1 + rng.randrange(9), 1 + rng.randrange(15)) for _ in range(4)]
            cap = 5 + rng.randrange(12)
            if greedy_knapsack(items, cap) != brute_knapsack(items, cap):
                firsts.append(t)
                break
    print(f"    첫 반례까지의 시도 수: 중앙값 {statistics.median(firsts):.0f}회  "
          f"범위 {min(firsts)}~{max(firsts)}회  (200개 씨앗 전부에서 발견)")
    hand = [(6, 10), (5, 7), (5, 7)]
    print(f"    본문 손 예제 {hand} cap=10 → 그리디 {greedy_knapsack(hand, 10)} "
          f"/ 최적 {brute_knapsack(hand, 10)}")

    print("\n[4] VI-2 Q2 — 힙 · 스위핑 · 완전탐색 (씨앗 20개 × 500회)")
    bad = 0
    for seed in range(20):
        rng = random.Random(31337 + seed)
        for _ in range(500):
            n = rng.randint(1, 9)
            trial = []
            for _ in range(n):
                s = rng.randrange(15)
                trial.append((s, s + 1 + rng.randrange(7)))
            if not (min_rooms_heap(trial) == min_rooms_sweep(trial) == brute_overlap(trial)):
                bad += 1
    print(f"    10,000회 중 세 답이 갈린 경우 {bad}건")

    print("\n[5] VI-2 Q3 — 마감 순 그리디 vs 순열 전수 (씨앗 20개 × 300회)")
    bad = 0
    for seed in range(20):
        rng = random.Random(4242 + seed)
        for _ in range(300):
            n = rng.randint(1, 6)
            trial = [(1 + rng.randrange(6), 1 + rng.randrange(14)) for _ in range(n)]
            if greedy_edf(trial) != brute_lateness(trial):
                bad += 1
    print(f"    6,000회 중 불일치 {bad}건")

    print("\n[6] 본문 반례 두 개")
    for name, case in (("A", [(1, 10), (2, 3), (4, 5)]), ("B", [(0, 5), (4, 6), (5, 10)])):
        print(f"    case {name} {case} → 끝 {greedy_key(case, 'end')} "
              f"/ 시작 {greedy_key(case, 'start')} / 짧은 {greedy_key(case, 'length')} "
              f"/ 완전탐색 {brute_schedule(case)}")
    lect = [(1, 5), (2, 4), (3, 9), (6, 8), (7, 10)]
    print(f"    본문 손추적 {lect} → 힙 {min_rooms_heap(lect)} "
          f"/ 스위핑 {min_rooms_sweep(lect)} / 완전탐색 {brute_overlap(lect)}")
    jobs = [(3, 4), (2, 3), (1, 10)]
    print(f"    Q3 예제 {jobs} → EDF {greedy_edf(jobs)} / 순열 전수 {brute_lateness(jobs)}")


if __name__ == "__main__":
    main()
