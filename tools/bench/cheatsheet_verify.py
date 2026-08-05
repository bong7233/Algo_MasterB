#!/usr/bin/env python3
"""0-13 — 치트시트의 모든 대응을 실제로 돌려 확인한다 (Python 쪽).

`cheatsheet_verify.cpp` 와 **같은 라벨로 같은 값을 출력한다.**
두 출력을 diff 했을 때 남는 줄이 곧 "언어가 실제로 갈리는 지점"이고,
그 목록이 0-13 의 함정 표가 된다. 표를 손으로 적고 맞기를 비는 대신
diff 가 표를 만들게 하는 구조다.

사용법:
    python3.13 tools/bench/cheatsheet_verify.py > /tmp/py.txt
    g++ -std=c++17 -O2 tools/bench/cheatsheet_verify.cpp -o /tmp/cv && /tmp/cv > /tmp/cpp.txt
    diff /tmp/py.txt /tmp/cpp.txt
"""
from __future__ import annotations

import bisect
import heapq
import math
from collections import Counter, defaultdict, deque
from itertools import accumulate, permutations


def p(label, value):
    print(f"{label:<34}| {value}")


def main():
    # --- 동적 배열 --------------------------------------------------------
    a = [5, 1, 4, 1, 3]
    p("list literal", a)
    a.append(9)
    p("append/push_back", a)
    p("len/size", len(a))
    p("a[0], a[-1] / a.front(), a.back()", (a[0], a[-1]))
    p("slice a[1:4] / 부분 복사", a[1:4])
    a.pop()
    p("pop/pop_back", a)
    p("sorted / sort", sorted(a))
    p("reverse sorted", sorted(a, reverse=True))
    p("in / find", 4 in a)
    p("index / find 위치", a.index(4))
    p("count", a.count(1))

    # --- 2차원 ------------------------------------------------------------
    g = [[0] * 3 for _ in range(2)]
    g[0][1] = 7
    p("2D init 후 g[0][1]=7", g)

    # --- 덱 ---------------------------------------------------------------
    d = deque([2, 3])
    d.appendleft(1)
    d.append(4)
    p("deque appendleft/append", list(d))
    p("popleft/pop_front", d.popleft())
    p("pop/pop_back", d.pop())

    # --- 해시맵 -----------------------------------------------------------
    m = {}
    for w in ["a", "b", "a", "c", "a"]:
        m[w] = m.get(w, 0) + 1
    p("dict 카운트", sorted(m.items()))
    p("dict get 기본값", m.get("z", 0))
    p("in / count(key)", "b" in m)
    dd = defaultdict(list)
    dd["x"].append(1)
    dd["x"].append(2)
    p("defaultdict(list)", dict(dd))
    p("Counter most_common(1)", Counter("aabbbcc").most_common(1))

    # --- 집합 -------------------------------------------------------------
    s1, s2 = {1, 2, 3}, {2, 3, 4}
    p("set 교집합", sorted(s1 & s2))
    p("set 합집합", sorted(s1 | s2))
    p("set 차집합", sorted(s1 - s2))

    # --- 정렬된 맵 / 이분 탐색 --------------------------------------------
    b = [1, 3, 3, 5, 7, 9]
    p("bisect_left / lower_bound", bisect.bisect_left(b, 3))
    p("bisect_right / upper_bound", bisect.bisect_right(b, 3))
    p("개수 = upper - lower", bisect.bisect_right(b, 3) - bisect.bisect_left(b, 3))
    p("bisect_left 없는 값", bisect.bisect_left(b, 4))

    # --- 힙 ---------------------------------------------------------------
    h = []
    for v in [5, 1, 4]:
        heapq.heappush(h, v)
    p("heap 기본 방향에서 첫 pop", heapq.heappop(h))
    h2 = []
    for v in [5, 1, 4]:
        heapq.heappush(h2, -v)
    p("최대 힙 흉내 첫 pop", -heapq.heappop(h2))

    # --- 정렬 키·비교자 ---------------------------------------------------
    ps = [(2, "b"), (1, "c"), (2, "a"), (1, "a")]
    p("key=첫 원소 (안정 정렬)", sorted(ps, key=lambda t: t[0]))
    p("key=(-첫, 둘째)", sorted(ps, key=lambda t: (-t[0], t[1])))

    # --- 관용구 -----------------------------------------------------------
    xs = [10, 20, 30]
    p("enumerate", [(i, v) for i, v in enumerate(xs)])
    p("zip", list(zip(xs, "abc")))
    p("sum / accumulate", sum(xs))
    p("max / max_element", max(xs))
    p("min / min_element", min(xs))
    p("any", any(v > 25 for v in xs))
    p("all", all(v > 5 for v in xs))
    p("누적합 / partial_sum", list(accumulate(xs)))
    p("reversed", list(reversed(xs)))
    p("list comprehension / transform", [v * v for v in xs])
    p("중복 제거 후 정렬", sorted(set([3, 1, 3, 2])))

    # --- 문자열 -----------------------------------------------------------
    t = "the quick brown"
    p("split", t.split())
    p("join", "-".join(t.split()))
    p("substr", t[4:9])
    p("find", t.find("quick"))
    p("문자열 뒤집기", t[::-1])
    p("정수 -> 문자열", str(12345) + "!")
    p("문자열 -> 정수", int("00042") + 1)
    p("문자 코드", ord("a"))
    p("코드 -> 문자", chr(98))

    # --- 순열 -------------------------------------------------------------
    p("순열 개수 (3개)", len(list(permutations([1, 2, 3]))))
    p("첫 두 순열", [list(x) for x in list(permutations([1, 2, 3]))[:2]])

    # --- 수 ---------------------------------------------------------------
    p("정수 나눗셈 양수 7/2", 7 // 2)
    p("정수 나눗셈 음수 -7/2", -7 // 2)
    p("나머지 음수 -7%2", -7 % 2)
    p("거듭제곱 mod", pow(2, 100, 1000000007))
    p("gcd", math.gcd(12, 18))
    p("정수 상한", "없음(임의 정밀도)")
    p("2^64 계산", 2**64)
    p("실수 0.1+0.2 == 0.3", 0.1 + 0.2 == 0.3)
    p("실수 0.1+0.2", f"{0.1 + 0.2:.17f}")
    p("floor / trunc (-3.5)", (math.floor(-3.5), math.trunc(-3.5)))


if __name__ == "__main__":
    main()
