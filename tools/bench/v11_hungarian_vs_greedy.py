"""V-11 본문 수치 검증 — 탐욕적 할당과 헝가리안의 차이를 무작위 행렬로 잰다.

본문 §1·§5 의 숫자가 여기서 나온다. 무작위 비용 행렬에서
    (1) 헝가리안이 탐욕보다 나쁜 적이 한 번이라도 있는가  (없어야 한다)
    (2) 탐욕이 엄밀히 더 비쌌던 비율
    (3) 그때 초과 비용의 평균 비율
를 출력한다.

실행: python3 tools/bench/v11_hungarian_vs_greedy.py
"""

import random

INF = float("inf")


def hungarian(a):
    """n×n 비용 행렬의 최소 비용 완전 할당. O(n^3).

    u[i], v[j] 는 i 행과 j 열에서 지금까지 뺀 상수의 누계(쌍대 변수)다.
    축소 비용 a[i][j] - u[i] - v[j] 는 항상 0 이상으로 유지된다.
    """
    n = len(a)
    u = [0.0] * (n + 1)
    v = [0.0] * (n + 1)
    p = [0] * (n + 1)      # p[j] = j 열에 배정된 행 (0 이면 비어 있음)
    way = [0] * (n + 1)    # 증가 경로 복원용
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [INF] * (n + 1)
        used = [False] * (n + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], INF, 0
            for j in range(1, n + 1):
                if used[j]:
                    continue
                cur = a[i0 - 1][j - 1] - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j], way[j] = cur, j0
                if minv[j] < delta:
                    delta, j1 = minv[j], j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
    total = sum(a[p[j] - 1][j - 1] for j in range(1, n + 1))
    return total


def greedy(a):
    """남은 칸 중 가장 싼 것부터 확정한다."""
    n = len(a)
    rows, cols, total = set(range(n)), set(range(n)), 0
    while rows:
        best = min((a[i][j], i, j) for i in rows for j in cols)
        total += best[0]
        rows.discard(best[1])
        cols.discard(best[2])
    return total


def run(n, trials, rng):
    worse = 0
    excess = []
    for _ in range(trials):
        a = [[rng.randint(1, 99) for _ in range(n)] for _ in range(n)]
        h, g = hungarian(a), greedy(a)
        assert h <= g + 1e-9, (a, h, g)   # 헝가리안이 탐욕보다 나쁘면 구현이 틀린 것이다
        if g > h + 1e-9:
            worse += 1
            excess.append((g - h) / h)
    avg = 100 * sum(excess) / len(excess) if excess else 0.0
    print(
        f"{n}x{n} {trials}회: 헝가리안 <= 탐욕 항상 성립. "
        f"탐욕이 더 비쌌던 경우 {worse}회 ({100 * worse / trials:.1f}%), "
        f"그때 초과 비용 평균 {avg:.1f}%"
    )
    return worse, avg


if __name__ == "__main__":
    rng = random.Random(20260805)
    run(5, 200, rng)
    run(8, 200, rng)
