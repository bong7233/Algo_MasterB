#!/usr/bin/env python3
"""IX-3 펜윅 트리 — 정확성 대조 + 세그먼트 트리 대비 코드 길이·속도 (CPython 3.13).

    python3.13 tools/bench/ix3_fenwick.py

두 가지를 확인한다.
  1. 정확성: 무작위 배열에 점 갱신을 섞어 가며 펜윅 트리의 구간 합이
     완전탐색(느린 prefix 재계산)과 항상 일치하는지 본다.
  2. 코드 길이와 속도: 같은 일(점 갱신 + 구간 합 질의)을 하는 펜윅 트리와
     재귀 세그먼트 트리를 나란히 재고 시간을 잰다.

측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / CPython 3.13 / x86-64)
"""
from __future__ import annotations

import random
import time
from statistics import median

REPEAT = 3


# ─────────────────────────────────────────────────────────────────────
# 펜윅 트리 — 본문 IX-3 의 구현과 동일하다
# ─────────────────────────────────────────────────────────────────────
class Fenwick:
    """1-indexed 펜윅 트리. tree[i] 는 (i - (i & -i), i] 구간의 합을 들고 있다."""

    def __init__(self, n):
        self.n = n
        self.tree = [0] * (n + 1)

    def update(self, i, delta):
        while i <= self.n:
            self.tree[i] += delta
            i += i & -i

    def prefix(self, i):
        s = 0
        while i > 0:
            s += self.tree[i]
            i -= i & -i
        return s

    def range_sum(self, l, r):
        return self.prefix(r) - self.prefix(l - 1) if r >= l else 0


# ─────────────────────────────────────────────────────────────────────
# 재귀 세그먼트 트리 — IX-2 가 다룰 형태를 그대로 옮겼다 (점 갱신 + 구간 합만).
# 이 파일에서만 쓰는 비교용 구현이다.
# ─────────────────────────────────────────────────────────────────────
class SegTree:
    def __init__(self, arr):
        self.n = len(arr)
        self.tree = [0] * (4 * self.n)
        self._build(arr, 1, 0, self.n - 1)

    def _build(self, arr, node, lo, hi):
        if lo == hi:
            self.tree[node] = arr[lo]
            return
        mid = (lo + hi) // 2
        self._build(arr, node * 2, lo, mid)
        self._build(arr, node * 2 + 1, mid + 1, hi)
        self.tree[node] = self.tree[node * 2] + self.tree[node * 2 + 1]

    def update(self, idx, val, node=1, lo=None, hi=None):
        if lo is None:
            lo, hi = 0, self.n - 1
        if lo == hi:
            self.tree[node] = val
            return
        mid = (lo + hi) // 2
        if idx <= mid:
            self.update(idx, val, node * 2, lo, mid)
        else:
            self.update(idx, val, node * 2 + 1, mid + 1, hi)
        self.tree[node] = self.tree[node * 2] + self.tree[node * 2 + 1]

    def query(self, l, r, node=1, lo=None, hi=None):
        if lo is None:
            lo, hi = 0, self.n - 1
        if r < lo or hi < l:
            return 0
        if l <= lo and hi <= r:
            return self.tree[node]
        mid = (lo + hi) // 2
        return self.query(l, r, node * 2, lo, mid) + self.query(l, r, node * 2 + 1, mid + 1, hi)


def core_lines(cls) -> int:
    """클래스 본문에서 빈 줄·주석·docstring 만 있는 줄을 뺀 실제 코드 줄 수."""
    import inspect

    src = inspect.getsource(cls)
    n = 0
    in_doc = False
    for raw in src.split("\n")[1:]:  # 첫 줄(class 선언)은 제외
        s = raw.strip()
        if not s:
            continue
        if s.startswith('"""'):
            in_doc = not in_doc if s.count('"""') == 1 else in_doc
            continue
        if in_doc:
            continue
        if s.startswith("#"):
            continue
        n += 1
    return n


def correctness_check():
    random.seed(1)
    trials, mismatches = 300, 0
    for _ in range(trials):
        n = random.randint(1, 40)
        a = [random.randint(-20, 20) for _ in range(n)]
        ft = Fenwick(n)
        for i, v in enumerate(a, start=1):
            ft.update(i, v)
        for _ in range(20):
            op = random.choice(("query", "update"))
            if op == "query":
                l = random.randint(1, n)
                r = random.randint(l, n)
                got = ft.range_sum(l, r)
                want = sum(a[l - 1 : r])
                if got != want:
                    mismatches += 1
            else:
                idx = random.randint(1, n)
                delta = random.randint(-10, 10)
                ft.update(idx, delta)
                a[idx - 1] += delta
    print(f"[정확성] 무작위 {trials}건(배열마다 질의·갱신 20회) — 불일치 {mismatches}건")


def speed_and_size():
    N, Q = 200_000, 100_000
    random.seed(2)
    arr = [random.randint(1, 100) for _ in range(N)]

    def build_fenwick():
        ft = Fenwick(N)
        for i, v in enumerate(arr, start=1):
            ft.update(i, v)
        return ft

    def build_segtree():
        return SegTree(arr)

    ops = []
    for _ in range(Q):
        if random.random() < 0.5:
            ops.append(("u", random.randint(0, N - 1), random.randint(1, 100)))
        else:
            l = random.randint(0, N - 1)
            r = random.randint(l, N - 1)
            ops.append(("q", l, r))

    def run_fenwick():
        ft = build_fenwick()
        cur = list(arr)  # 펜윅은 "더하기"가 기본이라 절대값 갱신을 델타로 바꾸려면 현재값을 따로 들고 있어야 한다
        for kind, x, y in ops:
            if kind == "u":
                ft.update(x + 1, y - cur[x])
                cur[x] = y
            else:
                ft.range_sum(x + 1, y + 1)

    def run_segtree():
        st = build_segtree()
        for kind, x, y in ops:
            if kind == "u":
                st.update(x, y)
            else:
                st.query(x, y)

    def timeit(fn):
        ts = []
        for _ in range(REPEAT):
            t0 = time.perf_counter()
            fn()
            ts.append(time.perf_counter() - t0)
        return ts

    tf = timeit(run_fenwick)
    ts = timeit(run_segtree)
    print(f"[코드 길이] Fenwick 핵심 로직 {core_lines(Fenwick)}줄 / SegTree(재귀) 핵심 로직 {core_lines(SegTree)}줄")
    print(f"[속도] N={N:,} Q={Q:,}(갱신·질의 섞음), {REPEAT}회 측정")
    print(f"  Fenwick  : {[round(t, 3) for t in tf]}  중앙값 {median(tf):.3f}s")
    print(f"  SegTree  : {[round(t, 3) for t in ts]}  중앙값 {median(ts):.3f}s")


if __name__ == "__main__":
    correctness_check()
    speed_and_size()
