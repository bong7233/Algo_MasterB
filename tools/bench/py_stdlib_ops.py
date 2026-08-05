#!/usr/bin/env python3
"""0-4 — 표준 라이브러리를 쓸 때와 손으로 짤 때의 실제 차이.

표준 라이브러리 함수의 상당수는 C 로 구현되어 있다. 같은 복잡도라도 상수가
자릿수로 차이 난다. "직접 짜도 O 는 같으니 괜찮다"가 왜 틀린지를 잰다.

사용법: python3.13 tools/bench/py_stdlib_ops.py
"""
import bisect
import heapq
import random
import sys
import time
from collections import Counter, defaultdict, deque
from functools import cmp_to_key, lru_cache


def bar(title: str) -> None:
    print(f"\n{'=' * 4} {title}")


def timed(fn, *a):
    t = time.perf_counter()
    r = fn(*a)
    return time.perf_counter() - t, r


def bench_heapq(n: int = 500_000, k: int = 100) -> None:
    bar(f"heapq — {n:,}개에서 가장 작은 {k}개 뽑기")
    rnd = random.Random(1)
    data = [rnd.randrange(10**9) for _ in range(n)]

    t1, r1 = timed(lambda: sorted(data)[:k])
    t2, r2 = timed(lambda: heapq.nsmallest(k, data))
    assert r1 == r2
    print(f"  sorted(data)[:k]      {t1:7.4f}s   (n log n)")
    print(f"  heapq.nsmallest(k, .) {t2:7.4f}s   (n log k)   x{t1 / t2:.1f} 빠름")

    bar("heapq — 힙 만들기: heapify vs heappush 반복")
    t1, _ = timed(_heapify_all, data)
    t2, _ = timed(_push_all, data)
    print(f"  heapq.heapify(a)      {t1:7.4f}s   O(n)")
    print(f"  heappush 를 n 번      {t2:7.4f}s   O(n log n)   x{t2 / t1:.1f} 느림")


def _heapify_all(data):
    a = data[:]
    heapq.heapify(a)
    return a


def _push_all(data):
    a = []
    for x in data:
        heapq.heappush(a, x)
    return a


def bench_bisect(n: int = 200_000, q: int = 200_000) -> None:
    bar(f"bisect — 정렬된 {n:,}개에서 {q:,}번 위치 찾기")
    a = list(range(0, 2 * n, 2))
    rnd = random.Random(1)
    qs = [rnd.randrange(2 * n) for _ in range(q)]

    t1, r1 = timed(lambda: sum(bisect.bisect_left(a, x) for x in qs))
    print(f"  bisect.bisect_left    {t1:7.4f}s   O(q log n)")

    small = qs[:400]
    t2, _ = timed(lambda: sum(_linear(a, x) for x in small))
    scaled = t2 * (q / len(small))
    print(f"  손으로 선형 탐색       {scaled:7.4f}s   O(q n)  ({len(small)}번 재고 환산)")
    print(f"                        x{scaled / t1:,.0f} 느림")
    assert r1 >= 0


def _linear(a, x):
    for i, v in enumerate(a):
        if v >= x:
            return i
    return len(a)


def bench_counter(n: int = 1_000_000) -> None:
    bar(f"Counter — {n:,}개의 빈도 세기")
    rnd = random.Random(1)
    data = [rnd.randrange(1000) for _ in range(n)]

    t1, r1 = timed(lambda: Counter(data))
    t2, r2 = timed(_manual_dict, data)
    t3, r3 = timed(_manual_defaultdict, data)
    assert dict(r1) == r2 == dict(r3)
    print(f"  Counter(data)              {t1:7.4f}s")
    print(f"  dict + get(x, 0) + 1       {t2:7.4f}s   x{t2 / t1:.1f} 느림")
    print(f"  defaultdict(int) 로 += 1   {t3:7.4f}s   x{t3 / t1:.1f} 느림")

    c = Counter(data)
    t4, _ = timed(lambda: c.most_common(3))
    print(f"  most_common(3)             {t4:7.4f}s")


def _manual_dict(data):
    d = {}
    for x in data:
        d[x] = d.get(x, 0) + 1
    return d


def _manual_defaultdict(data):
    d = defaultdict(int)
    for x in data:
        d[x] += 1
    return d


def bench_lru_cache() -> None:
    bar("functools.lru_cache — 메모이제이션")

    def fib_slow(n):
        return n if n < 2 else fib_slow(n - 1) + fib_slow(n - 2)

    @lru_cache(maxsize=None)
    def fib_fast(n):
        return n if n < 2 else fib_fast(n - 1) + fib_fast(n - 2)

    t1, r1 = timed(fib_slow, 30)
    t2, r2 = timed(fib_fast, 30)
    assert r1 == r2
    print(f"  fib(30) 캐시 없음   {t1:7.4f}s   호출 {2 * r1 - 1:,}회 (지수)")
    print(f"  fib(30) lru_cache   {t2:7.4f}s   호출 31회 (선형)   x{t1 / t2:,.0f} 빠름")
    print(f"  캐시 상태: {fib_fast.cache_info()}")

    t3, _ = timed(fib_fast, 30)
    print(f"  두 번째 호출        {t3:7.6f}s   전부 캐시 적중")


def bench_cmp_to_key(n: int = 200_000) -> None:
    bar(f"functools.cmp_to_key — {n:,}개 정렬")
    rnd = random.Random(1)
    data = [(rnd.randrange(1000), rnd.randrange(1000)) for _ in range(n)]

    t1, r1 = timed(lambda: sorted(data, key=lambda p: (p[0], -p[1])))
    t2, r2 = timed(lambda: sorted(data, key=cmp_to_key(_cmp)))
    assert r1 == r2
    print(f"  key= 로 튜플 반환        {t1:7.4f}s")
    print(f"  cmp_to_key(비교 함수)    {t2:7.4f}s   x{t2 / t1:.1f} 느림")
    print("  (같은 O(n log n) 이다. 차이는 전부 상수다)")


def _cmp(a, b):
    if a[0] != b[0]:
        return -1 if a[0] < b[0] else 1
    if a[1] != b[1]:
        return -1 if a[1] > b[1] else 1
    return 0


def bench_deque(n: int = 200_000) -> None:
    bar(f"deque — 큐로 쓸 때 ({n:,}회 push/pop)")
    t1, _ = timed(_deque_queue, n)
    t2, _ = timed(_list_queue, n)
    print(f"  deque (popleft)   {t1:7.4f}s")
    print(f"  list  (pop(0))    {t2:7.4f}s   x{t2 / t1:,.0f} 느림")
    print(f"  빈 deque {sys.getsizeof(deque()):>4}바이트, 빈 list {sys.getsizeof([]):>4}바이트")


def _deque_queue(n):
    q = deque()
    for i in range(n):
        q.append(i)
    s = 0
    while q:
        s += q.popleft()
    return s


def _list_queue(n):
    q = []
    for i in range(n):
        q.append(i)
    s = 0
    while q:
        s += q.pop(0)
    return s


if __name__ == "__main__":
    bench_heapq()
    bench_bisect()
    bench_counter()
    bench_lru_cache()
    bench_cmp_to_key()
    bench_deque()
