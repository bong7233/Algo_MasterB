"""차원의 저주 실측 — KD 트리 최근접 탐색이 차원에 따라 방문하는 노드 비율.

XI-9 §2 의 표와 §4 의 수치가 여기서 나온다.
가지치기가 먹히는 정도만 보므로 시간이 아니라 "방문 노드 / 전체 노드" 를 센다.
비율은 기계와 무관하게 재현된다.

사용법: python3.13 tools/bench/kdtree_curse.py
"""

import random
import sys

sys.setrecursionlimit(100000)


def build(pts, K):
    """KD 트리 = 인덱스 배열의 재귀적 재배치. 노드 = 부분구간의 중앙."""
    n = len(pts)
    idx = list(range(n))

    def rec(lo, hi, depth):
        if hi - lo <= 0:
            return
        axis = depth % K
        idx[lo:hi] = sorted(idx[lo:hi], key=lambda i: (pts[i][axis], i))
        mid = (lo + hi) // 2
        rec(lo, mid, depth + 1)
        rec(mid + 1, hi, depth + 1)

    rec(0, n, 0)
    return idx


def nearest(pts, idx, q, K):
    n = len(pts)
    best_d = float("inf")
    best_i = -1
    visited = 0

    def dist2(p):
        return sum((p[k] - q[k]) ** 2 for k in range(K))

    def rec(lo, hi, depth):
        nonlocal best_d, best_i, visited
        if hi - lo <= 0:
            return
        mid = (lo + hi) // 2
        visited += 1
        p = pts[idx[mid]]
        d = dist2(p)
        if d < best_d:
            best_d, best_i = d, idx[mid]
        axis = depth % K
        diff = q[axis] - p[axis]
        if diff < 0:
            near = (lo, mid)
            far = (mid + 1, hi)
        else:
            near = (mid + 1, hi)
            far = (lo, mid)
        rec(near[0], near[1], depth + 1)
        if diff * diff < best_d:
            rec(far[0], far[1], depth + 1)

    rec(0, n, 0)
    return best_i, best_d, visited


def brute(pts, q, K):
    best_d, best_i = float("inf"), -1
    for i, p in enumerate(pts):
        d = sum((p[k] - q[k]) ** 2 for k in range(K))
        if d < best_d:
            best_d, best_i = d, i
    return best_i, best_d


def main():
    N = 4000
    QUERIES = 200
    SEEDS = (1, 2, 3, 4, 5)
    print(f"점 {N}개 · 질의 {QUERIES}회 × 씨앗 {len(SEEDS)}개 · 좌표 [0,1000) 균일 난수")
    print(f"{'차원':>4} {'방문(중앙값)':>14} {'전체 대비':>10} {'10~90%':>18} {'전수 대조':>10}")
    for K in (2, 4, 8, 16, 32):
        vs = []
        ok = True
        for s in SEEDS:
            rng = random.Random(20260805 + 1000 * s + K)
            pts = [tuple(rng.randrange(1000) for _ in range(K)) for _ in range(N)]
            idx = build(pts, K)
            for _ in range(QUERIES):
                q = tuple(rng.randrange(1000) for _ in range(K))
                _, bd, v = nearest(pts, idx, q, K)
                _, cd = brute(pts, q, K)
                if bd != cd:
                    ok = False
                vs.append(v)
        vs.sort()
        med = vs[len(vs) // 2]
        lo = vs[int(len(vs) * 0.1)]
        hi = vs[int(len(vs) * 0.9)]
        band = f"{lo:,}~{hi:,}"
        print(
            f"{K:>4} {med:>14,} {med / N:>9.1%} {band:>18} "
            f"{'일치' if ok else '불일치':>10}"
        )


if __name__ == "__main__":
    main()
