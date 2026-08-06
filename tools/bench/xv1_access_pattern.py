"""XV-1 — 순차 접근 대 무작위 접근. 같은 바이트 수를 두 순서로 읽을 때
걸리는 시간을 잰다. CLAUDE.md §1-3 환경에서 실행한다.

python3.13 tools/bench/xv1_access_pattern.py
"""
import random
import time

N = 20_000_000  # int64 배열, 약 160MB — 캐시보다 훨씬 크다
REPEAT = 2


def make_array(n):
    return list(range(n))


def seq_sum(a):
    s = 0
    for v in a:
        s += v
    return s


def rand_sum(a, idx):
    s = 0
    for i in idx:
        s += a[i]
    return s


def main():
    a = make_array(N)
    idx = list(range(N))
    random.seed(0)
    random.shuffle(idx)

    for _ in range(REPEAT):
        t0 = time.perf_counter()
        s1 = seq_sum(a)
        t1 = time.perf_counter()
        print("순차 접근: %.3f 초 (합 %d)" % (t1 - t0, s1))

    for _ in range(REPEAT):
        t0 = time.perf_counter()
        s2 = rand_sum(a, idx)
        t1 = time.perf_counter()
        print("무작위 접근: %.3f 초 (합 %d)" % (t1 - t0, s2))


if __name__ == "__main__":
    main()
