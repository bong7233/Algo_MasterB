"""II-4 §4 — Python 에서 재귀와 명시적 스택의 비용, 그리고 깊이 한계.

    python3.13 tools/bench/ii4_recursion_cost.py 2000

대상은 C++ 판(`ii4_recursion_cost.cpp`)과 같은 "왼쪽으로만 뻗은 이진 트리" 다.
노드는 (값, 왼쪽, 오른쪽) 튜플로 만든다.

마지막에 기본 재귀 한도(1000)에서 무슨 일이 일어나는지도 함께 찍는다.
숫자보다 이쪽이 실전에서 먼저 문제가 된다 — 깊이 10^5 짜리 DFS 는
알고리즘이 옳아도 기본 설정에서 죽는다.
"""

import sys
import time


def sum_rec(p):
    if p is None:
        return 0
    val, left, right = p
    return val + sum_rec(left) + sum_rec(right)


def sum_iter(root):
    s = 0
    st = [root]
    while st:
        p = st.pop()
        if p is None:
            continue
        val, left, right = p
        s += val
        st.append(right)
        st.append(left)
    return s


depth = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
rounds = max(1, 2000000 // depth)

sys.setrecursionlimit(depth * 4 + 1000)
root = None
for _ in range(depth):
    root = (1, root, None)

t0 = time.perf_counter()
a = 0
for _ in range(rounds):
    a += sum_rec(root)
t1 = time.perf_counter()
b = 0
for _ in range(rounds):
    b += sum_iter(root)
t2 = time.perf_counter()

tr, ti = t1 - t0, t2 - t1
print(f"깊이 {depth}, {rounds}회 반복 (총 방문 {depth * rounds}회, 합 {a}/{b})")
print(f"재귀        {tr:.4f} s")
print(f"명시적 스택 {ti:.4f} s  ({ti / tr:.2f}배)")

# 기본 한도에서의 동작. 값을 바꾸지 않고 새 인터프리터 기준을 그대로 보인다.
sys.setrecursionlimit(1000)
deep = None
for _ in range(5000):
    deep = (1, deep, None)
try:
    sum_rec(deep)
    print("깊이 5000: 통과")
except RecursionError as e:
    print(f"깊이 5000, 재귀 한도 1000: RecursionError — {e}")
print(f"명시적 스택으로는 같은 깊이도 통과: {sum_iter(deep)}")
