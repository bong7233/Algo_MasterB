#!/usr/bin/env python3
"""0-3 — dict/set 의 리사이즈 시점과 비용, 그리고 순회 순서.

dict 는 채움률이 2/3 를 넘으면 커진다. set 은 3/5 다. getsizeof 의 계단이
그 시점을 그대로 드러낸다. 해시 충돌이 최악일 때 조회가 어떻게 되는지도 잰다.

사용법: python3.13 tools/bench/py_dict_set_resize.py
"""
import sys
import time


def resize_steps(kind: str, limit: int = 200_000) -> None:
    print(f"\n{kind} 의 getsizeof 계단")
    c = {} if kind == "dict" else set()
    prev = sys.getsizeof(c)
    print(f"  비었을 때 {prev} 바이트")
    print("  원소 수 | getsizeof | 직전 대비 배수")
    for i in range(limit):
        if kind == "dict":
            c[i] = i
        else:
            c.add(i)
        cur = sys.getsizeof(c)
        if cur != prev:
            print(f"  {len(c):>7} | {cur:>9} | x{cur / prev:.2f}")
            prev = cur
            if len(c) > 50_000:
                break


class BadHash:
    """모든 키의 해시가 같다 — 개방 주소법이 최악으로 도는 경우."""

    __slots__ = ("v",)

    def __init__(self, v: int) -> None:
        self.v = v

    def __hash__(self) -> int:
        return 0

    def __eq__(self, other: object) -> bool:
        return isinstance(other, BadHash) and self.v == other.v


def collision_cost(n: int = 4_000) -> None:
    print(f"\n해시 충돌 최악 vs 정상 — 원소 {n:,}개 삽입")
    t = time.perf_counter()
    good = {i: i for i in range(n)}
    tg = time.perf_counter() - t

    t = time.perf_counter()
    bad = {BadHash(i): i for i in range(n)}
    tb = time.perf_counter() - t
    print(f"  정상 해시 {tg:8.5f}s")
    print(f"  단일 해시 {tb:8.5f}s   x{tb / tg:,.0f} 느림")
    assert len(good) == len(bad) == n


def order_demo() -> None:
    print("\n순회 순서")
    d = {}
    for k in ("banana", "apple", "cherry"):
        d[k] = 1
    print(f"  dict 삽입 순서 유지 : {list(d)}")
    del d["apple"]
    d["apple"] = 1
    print(f"  삭제 후 재삽입      : {list(d)}")
    s = set()
    for k in ("banana", "apple", "cherry"):
        s.add(k)
    print(f"  set (해시 순서)     : {list(s)}")
    print(f"  set(range(10))      : {list(set(range(10)))}")
    print(f"  set(range(10,20))   : {list(set(range(10, 20)))}")


def membership_cost(n: int = 200_000) -> None:
    print(f"\n포함 검사 {n:,}회")
    data = list(range(n))
    ds = set(data)
    probes = list(range(0, n, max(1, n // 2_000)))

    t = time.perf_counter()
    hit = sum(1 for x in probes if x in ds)
    ts = time.perf_counter() - t

    t = time.perf_counter()
    hit2 = sum(1 for x in probes if x in data)
    tl = time.perf_counter() - t
    assert hit == hit2
    print(f"  x in set  ({len(probes):,}회) {ts:8.5f}s")
    print(f"  x in list ({len(probes):,}회) {tl:8.5f}s   x{tl / ts:,.0f} 느림")


def sizes() -> None:
    print("\n같은 원소를 담은 컨테이너의 크기 (원소 객체 제외)")
    for n in (0, 1, 5, 10, 1_000):
        lst = list(range(n))
        tup = tuple(range(n))
        st = set(range(n))
        dc = {i: i for i in range(n)}
        print(
            f"  n={n:>5}  list={sys.getsizeof(lst):>8}  tuple={sys.getsizeof(tup):>8}"
            f"  set={sys.getsizeof(st):>8}  dict={sys.getsizeof(dc):>8}"
        )


if __name__ == "__main__":
    resize_steps("dict")
    resize_steps("set")
    collision_cost()
    order_demo()
    membership_cost()
    sizes()
