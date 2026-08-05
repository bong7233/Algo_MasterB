"""VII-3 본문 수치 — 답을 선형으로 훑는 것과 이분 탐색하는 것의 차이.

같은 판정 함수 feasible(x) 를 쓴다. 다른 것은 x 를 고르는 순서뿐이다.
선형은 답 근처까지 x 를 하나씩 올리며 판정하고, 이분은 구간을 절반씩 접는다.
판정 비용이 O(K) 이므로 총비용은 (판정 횟수) x K 다 — 그 곱을 눈으로 보이는 것이 목적이다.

측정 환경은 CLAUDE.md §1-3.
실행:  python3.13 tools/bench/vii3_parametric_vs_linear.py
"""

import time

K = 100          # 랜선 개수. 판정 한 번의 비용이 곧 K 다
HI = 50_000      # 답 후보 구간의 오른쪽 끝 (반열림)
N = 137          # 만들어야 하는 랜선 개수
REPEAT = 5

# 난수 대신 결정적 수열을 쓴다. 두 언어의 난수 생성기가 달라도 입력이 같아야
# 표의 두 열을 나란히 놓을 수 있다.
a = [(i * 7919 + 13) % (HI - 1) + 1 for i in range(K)]

calls = 0


def feasible(x):
    """길이 x 로 자르면 N 개 이상 나오는가. x 가 커질수록 참에서 거짓으로 한 번 뒤집힌다."""
    global calls
    calls += 1
    total = 0
    for v in a:
        total += v // x
    return total >= N


def solve_linear():
    """x 를 1 부터 올리며 마지막 참을 기억한다. 판정 횟수가 곧 답의 크기다."""
    best = 0
    for x in range(1, HI):
        if feasible(x):
            best = x
        else:
            break          # 단조라서 처음 거짓에서 멈춰도 된다. 그래도 답 크기만큼 돈다
    return best


def solve_binary():
    """p(x) = not feasible(x) 는 F...FT...T 다. 첫 참을 찾고 한 칸 왼쪽이 답."""
    lo, hi = 1, HI
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if not feasible(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo - 1


def timed(fn):
    best = None
    times = []
    for _ in range(REPEAT):
        t0 = time.perf_counter()
        best = fn()
        times.append(time.perf_counter() - t0)
    times.sort()
    return best, times[len(times) // 2]


calls = 0
ans_lin, t_lin = timed(solve_linear)
calls_lin = calls // REPEAT

calls = 0
ans_bin, t_bin = timed(solve_binary)
calls_bin = calls // REPEAT

print(f"K = {K}  HI = {HI}  N = {N}")
print(f"선형  답={ans_lin}  판정 호출={calls_lin:>7}  {t_lin * 1e3:9.3f} ms")
print(f"이분  답={ans_bin}  판정 호출={calls_bin:>7}  {t_bin * 1e6:9.3f} us")
print(f"두 답이 같은가: {ans_lin == ans_bin}")
print(f"판정 호출 비 = {calls_lin / calls_bin:.1f}배, 시간 비 = {t_lin / t_bin:.1f}배")

# 실제 제약(길이 <= 2^31-1)에서 이분 탐색이 부르는 판정 횟수
lo, hi, cnt = 1, 2**31, 0
while lo < hi:
    mid = lo + (hi - lo) // 2
    cnt += 1
    lo = mid + 1 if mid < 1_400_000_000 else lo
    if mid >= 1_400_000_000:
        hi = mid
print(f"구간 폭 2^31 일 때 이분 탐색의 판정 호출 = {cnt}회")
