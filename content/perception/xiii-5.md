# XIII-5 ICP

::: lead
두 점군이 같은 장면을 다른 위치에서 찍었다. 점 하나하나의 대응 관계 없이, 둘을 겹치는 변환을 어떻게 찾는가.
:::

## 1. 문제

라이다가 20 Hz로 도는 로봇을 생각한다. 이번 스캔은 점 300개, 다음 스캔도 점 300개다. 두 스캔 사이에 로봇이 얼마나 움직였는지 알고 싶다 — 그것이 곧 오도메트리(odometry)다.

문제는 점에 이름표가 없다는 것이다. 이번 스캔의 점 47번과 다음 스캔의 점 47번이 벽의 같은 지점을 찍었다는 보장이 전혀 없다. 라이다는 매 회전마다 각도를 기준으로 점을 쏘고, 로봇이 움직이면 같은 벽이 다른 각도 다른 순번으로 찍힌다. **대응 관계 자체가 미지수다.**

대응이 이미 있다면 문제는 쉽다. 점 쌍 $(p_i, q_i)$가 주어지면 $\sum_i \| R p_i + t - q_i \|^2$을 최소화하는 회전 $R$과 이동 $t$를 닫힌 형태로 구할 수 있다 — 뒤에서 그 식을 그대로 쓴다. 그런데 로봇공학에서 실제로 손에 쥐는 것은 점의 좌표뿐이고 대응은 없다.

여기서 순환이 생긴다. **대응을 알아야 정렬을 계산할 수 있고, 정렬이 맞아야 대응이 보인다.** 두 점군이 이미 거의 겹쳐 있다면 "가장 가까운 점"이 곧 대응일 가능성이 높다. 하지만 처음에는 안 겹쳐 있다. ICP(Iterative Closest Point)는 이 순환을 끊는 대신 반복해서 좁힌다 — 지금 위치에서 최근접을 대응으로 삼고, 그 대응으로 정렬을 갱신하고, 갱신된 위치에서 다시 최근접을 구한다. 대응이 틀렸어도 대략은 맞는 방향으로 움직이고, 그 결과 다음 최근접은 조금 더 정확해진다.

::: note
"점군 정합(point cloud registration)"이 이 문제의 이름이다. ICP는 그중 가장 오래되고 가장 널리 쓰이는 방법이지 유일한 방법은 아니다. 이 챕터는 2D의 강체 변환(회전 + 이동)만 다룬다 — 3D로 가면 회전의 표현이 복잡해지지만(쿼터니언, SVD), 반복의 뼈대는 그대로다.
:::

## 2. 아이디어

ICP 한 바퀴는 세 단계다.

```text nolines
correspond (nearest neighbor)  ->  estimate (R, t)  ->  apply (move P)  ->  check RMSE
        ^                                                                        |
        +---------------------- repeat until RMSE stops shrinking ---------------+
```

**대응(correspond).** 움직이는 점군을 소스 $P$, 고정된 점군을 타깃 $Q$라 하자. $P$의 점 하나마다 $Q$에서 유클리드 거리가 가장 가까운 점을 찾는다. 이것이 "진짜" 대응이라는 보장은 없다 — 그냥 지금 위치에서 최선의 추측이다.

**추정(estimate).** 방금 찾은 대응 쌍으로 $\sum \| R p_i + t - q_i \|^2$을 최소화하는 $R, t$를 구한다. 여기가 이 챕터의 핵심 공식이다. 두 점군의 무게중심(centroid) $\bar p, \bar q$을 빼서 중심을 원점에 맞추면, 이동 $t$는 회전과 독립적으로 $t = \bar q - R \bar p$로 정해진다는 사실이 남는다 — 회전만 따로 풀면 된다. 2D에서는 SVD 없이 각 하나로 회전이 나온다.

$$\theta = \operatorname{atan2}\!\big(S_{xy} - S_{yx},\ S_{xx} + S_{yy}\big), \qquad S_{jk} = \sum_i (p_{i,j} - \bar p_j)(q_{i,k} - \bar q_k)$$

이 식이 왜 맞는지는 산문으로 설명할 수 있다. 회전 각도 $\theta$가 대응 쌍들을 얼마나 잘 맞추는지는 $\sum_i (R p_i) \cdot q_i$를 최대화하는 문제와 같고, 이 내적의 합을 전개하면 $\cos\theta$의 계수와 $\sin\theta$의 계수가 각각 $S_{xx}+S_{yy}$와 $S_{xy}-S_{yx}$로 떨어진다. $A\cos\theta + B\sin\theta$의 최댓값은 $\theta = \operatorname{atan2}(B, A)$에서 나온다 — 삼각함수 최댓값의 표준형이다. 유도를 전개하지 않고 결과만 쓰는 이유는 이 챕터의 목표가 "수식을 외우는 것"이 아니라 "이 값이 왜 필요한지 한 문장으로 답하는 것"이기 때문이다.

**적용(apply).** 구한 $R, t$를 소스 점군 전체에 적용해 이동시킨다. 이제 소스가 타깃에 조금 더 가까워졌다.

**확인(check).** 정합 오차를 RMSE(root mean squared error, 대응 쌍 거리 제곱의 평균의 제곱근)로 잰다. 오차가 더는 줄지 않으면 멈춘다.

**대응이 정확하면 반복이 필요 없다는 것이 핵심 성질이다.** 위 공식은 닫힌 형태이지 경사 하강이 아니다. 대응이 옳다면 단 한 번의 계산으로 정확한 회전과 이동이 나온다. 그런데도 여러 번 반복하는 이유는 대응이 처음부터 옳지 않기 때문이다. 잘못된 대응으로 구한 변환은 근사적으로만 맞고, 그 근사가 점군을 조금 옮기면 다음 최근접 탐색의 결과가 달라진다 — 그렇게 대응 자체가 반복마다 갱신된다. **ICP가 반복하는 대상은 변환이 아니라 대응이다.** 변환은 매번 그 대응에 대해 정확히 풀린다.

이 반복이 항상 참값으로 수렴하는 것은 아니다. 초기 위치가 너무 멀면 최근접이 계속 엉뚱한 점을 가리키고, 그 상태에서 수렴한 결과는 지역 최적해일 뿐 전역 최적이 아니다. 실무에서 ICP에 오도메트리나 IMU 적분값 같은 **초기 추정치**를 먼저 물려주는 이유가 이것이다 — [XIII-3 칼만 필터와 EKF](#/xiii-3)가 만드는 값이 그 초기 추정치의 흔한 출처다. 대칭인 형상(정사각형, 원형 기둥)도 위험하다. 회전해도 점군 모양이 그대로이므로 최근접이 여러 회전각에서 똑같이 좋아 보이고, 어느 쪽으로 수렴할지 대응 자체가 결정하지 못한다.

## 3. 손으로 따라가기

::: trace
소스 $P = \{(0,0), (2,0), (2,1), (0,1)\}$, 타깃 $Q = \{(1,0), (3,0), (3,1), (1,1)\}$. $Q$는 $P$를 $(1, 0)$만큼 평행이동한 것이다 — 참값은 회전 없음, 이동 $(1,0)$.

초기 위치(반복 전)는 $P$ 그대로다. 대응은 **동률이면 먼저 찾은 후보를 유지**하는 규칙으로 정한다(인덱스가 작은 쪽부터 훑는다).

| 반복 | 대응 (P0,P1,P2,P3 → Q인덱스) | $\theta$ (도) | $(t_x, t_y)$ | RMSE |
|---|---|---|---|---|
| 0 | [0, 0, 2, 3] | −18.435 | (0.393, 0.342) | 0.8178 |
| 1 |  |  |  |  |
| 2 |  |  |  |  |

`P1 = (2,0)`이 `Q0 = (1,0)`과 `Q1 = (3,0)`에 정확히 같은 거리(제곱거리 1)라는 것을 직접 확인하라 — 동률이 왜 생기는지, 그리고 규칙이 어느 쪽을 골랐는지.

반복 0에서 구한 $\theta, t$를 $P$ 전체에 적용하면 새 위치가 나온다. 회전 변환은 $x' = \cos\theta \cdot x - \sin\theta \cdot y + t_x$, $y' = \sin\theta \cdot x + \cos\theta \cdot y + t_y$이고, $\cos(-18.435°) \approx 0.9487$, $\sin(-18.435°) \approx -0.3162$다.

**두 가지를 채워라.**

1. $P_1 = (2, 0)$을 위 식에 대입해 새 위치를 구하고, $Q$의 네 점 중 어디에 가장 가까운지 제곱거리로 비교하라. 반복 0의 대응([0,0,2,3])과 같은가, 다른가.
2. 대응이 전부 올바른 일대일 관계가 되면(정답 상자에서 확인) 2절이 말한 성질에 따라 그다음 RMSE가 어떻게 될지 예상하라. 정확히 계산할 필요는 없다 — 방향만 맞히면 된다.
:::

::: answer
| 반복 | 대응 (P0,P1,P2,P3 → Q인덱스) | $\theta$ (도) | $(t_x, t_y)$ | RMSE |
|---|---|---|---|---|
| 0 | [0, 0, 2, 3] | −18.435 | (0.393, 0.342) | 0.8178 |
| 1 | [0, 1, 2, 3] | 18.435 | (0.735, −0.449) | 0.0000 |
| 2 | [0, 1, 2, 3] | 0.000 | (0.000, 0.000) | 0.0000 |

반복 0의 변환을 적용한 뒤 위치는 $P_0 \approx (0.393, 0.342)$, $P_1 \approx (2.290, -0.290)$, $P_2 \approx (2.607, 0.658)$, $P_3 \approx (0.709, 1.291)$이다. 이제 $Q$와 비교하면 $P_1$의 최근접이 더는 $Q_0$가 아니라 $Q_1 = (3,0)$이다(제곱거리 0.588 대 1.749) — **대응이 정답 쌍 [0,1,2,3]으로 정확히 맞춰졌다.**

대응이 옳아졌으므로 2절의 성질대로 반복 1의 변환은 근사가 아니라 정확한 해다. $\theta = 18.435°$와 반복 0의 $-18.435°$를 합치면 $0°$ — 참값(회전 없음)과 일치한다. RMSE가 정확히 0.0000으로 떨어진다. 반복 2는 대응도 변환도 더는 바뀌지 않는다 — **수렴이 종료 조건이 아니라 계산으로 확인되는 사실이다.**

반복 0이 진동처럼 보이는 이유도 여기서 설명된다. 틀린 대응 두 쌍(P1, P3가 각각 엉뚱한 점에 붙음)이 회전을 억지로 만들어냈고, 반복 1은 그 억지 회전을 정확히 되돌리는 동시에 올바른 이동을 찾아낸다. **오차가 매끄럽게 줄어드는 것이 아니라, 대응이 맞는 순간 한 번에 사라질 수 있다** — 이것이 경사 하강 계열 최적화와 ICP의 실질적인 차이다.
:::

## 4. 구현

::: dual
```python title="ICP — 2D 점군 정합"
import math


def apply_transform(points, theta, t):
    c, s = math.cos(theta), math.sin(theta)
    return [(c * x - s * y + t[0], s * x + c * y + t[1]) for x, y in points]


def nearest_neighbor(p, target):
    best_j, best_d2 = -1, None
    for j, q in enumerate(target):
        d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
        if best_d2 is None or d2 < best_d2:      # 동률이면 먼저 발견한 쪽을 유지한다
            best_d2, best_j = d2, j
    return best_j


def icp(source, target, max_iters=5, tol=1e-6):
    current = list(source)
    prev_rmse = None
    for it in range(max_iters):
        matches = [nearest_neighbor(p, target) for p in current]
        matched_q = [target[j] for j in matches]

        cx = sum(p[0] for p in current) / len(current)
        cy = sum(p[1] for p in current) / len(current)
        qx = sum(q[0] for q in matched_q) / len(matched_q)
        qy = sum(q[1] for q in matched_q) / len(matched_q)

        Sxx = Sxy = Syx = Syy = 0.0
        for (px, py), (qx_, qy_) in zip(current, matched_q):
            dpx, dpy = px - cx, py - cy
            dqx, dqy = qx_ - qx, qy_ - qy
            Sxx += dpx * dqx
            Sxy += dpx * dqy
            Syx += dpy * dqx
            Syy += dpy * dqy

        theta = math.atan2(Sxy - Syx, Sxx + Syy)   # 2D 닫힌 형식 — SVD 없이 각 하나로 최적 회전을 구한다
        c, s = math.cos(theta), math.sin(theta)
        tx = qx - (c * cx - s * cy)
        ty = qy - (s * cx + c * cy)

        current = apply_transform(current, theta, (tx, ty))
        rmse = math.sqrt(sum((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
                              for a, b in zip(current, matched_q)) / len(current))

        print(f"iter={it} match={matches} theta_deg={math.degrees(theta):6.3f} "
              f"t=({tx:6.3f},{ty:6.3f}) rmse={rmse:.4f}")

        if prev_rmse is not None and abs(prev_rmse - rmse) < tol:
            break
        prev_rmse = rmse
    return current


source = [(0.0, 0.0), (2.0, 0.0), (2.0, 1.0), (0.0, 1.0)]
target = [(1.0, 0.0), (3.0, 0.0), (3.0, 1.0), (1.0, 1.0)]
icp(source, target)
```
```cpp title="ICP — 2D 점군 정합"
#include <cmath>
#include <cstdio>
#include <vector>
using namespace std;

vector<pair<double,double>> apply_transform(const vector<pair<double,double>>& points, double theta, pair<double,double> t) {
    double c = cos(theta), s = sin(theta);
    vector<pair<double,double>> out;
    for (auto [x, y] : points)
        out.push_back({c*x - s*y + t.first, s*x + c*y + t.second});
    return out;
}

int nearest_neighbor(pair<double,double> p, const vector<pair<double,double>>& target) {
    int best_j = -1;
    double best_d2 = -1;
    for (int j = 0; j < (int)target.size(); j++) {
        double dx = p.first - target[j].first, dy = p.second - target[j].second;
        double d2 = dx*dx + dy*dy;
        if (best_j == -1 || d2 < best_d2) { best_d2 = d2; best_j = j; }  // 동률이면 먼저 발견한 쪽을 유지한다
    }
    return best_j;
}

vector<pair<double,double>> icp(vector<pair<double,double>> source, const vector<pair<double,double>>& target, int max_iters=5, double tol=1e-6) {
    vector<pair<double,double>> current = source;
    double prev_rmse = -1;
    bool has_prev = false;
    for (int it = 0; it < max_iters; it++) {
        vector<int> matches;
        vector<pair<double,double>> matched_q;
        for (auto& p : current) {
            int j = nearest_neighbor(p, target);
            matches.push_back(j);
            matched_q.push_back(target[j]);
        }

        double cx = 0, cy = 0, qx = 0, qy = 0;
        int n = current.size();
        for (auto& p : current) { cx += p.first; cy += p.second; }
        cx /= n; cy /= n;
        for (auto& q : matched_q) { qx += q.first; qy += q.second; }
        qx /= n; qy /= n;

        double Sxx = 0, Sxy = 0, Syx = 0, Syy = 0;
        for (int i = 0; i < n; i++) {
            double dpx = current[i].first - cx, dpy = current[i].second - cy;
            double dqx = matched_q[i].first - qx, dqy = matched_q[i].second - qy;
            Sxx += dpx*dqx; Sxy += dpx*dqy; Syx += dpy*dqx; Syy += dpy*dqy;
        }

        double theta = atan2(Sxy - Syx, Sxx + Syy);  // 2D 닫힌 형식 — SVD 없이 각 하나로 최적 회전을 구한다
        double c = cos(theta), s = sin(theta);
        double tx = qx - (c*cx - s*cy);
        double ty = qy - (s*cx + c*cy);

        current = apply_transform(current, theta, {tx, ty});
        double rmse = 0;
        for (int i = 0; i < n; i++) {
            double dx = current[i].first - matched_q[i].first;
            double dy = current[i].second - matched_q[i].second;
            rmse += dx*dx + dy*dy;
        }
        rmse = sqrt(rmse / n);

        printf("iter=%d match=[", it);
        for (int i = 0; i < n; i++) printf("%s%d", i ? ", " : "", matches[i]);
        printf("] theta_deg=%6.3f t=(%6.3f,%6.3f) rmse=%.4f\n",
               theta * 180.0 / M_PI, tx, ty, rmse);

        if (has_prev && fabs(prev_rmse - rmse) < tol) break;
        prev_rmse = rmse; has_prev = true;
    }
    return current;
}

int main() {
    vector<pair<double,double>> source = {{0.0,0.0},{2.0,0.0},{2.0,1.0},{0.0,1.0}};
    vector<pair<double,double>> target = {{1.0,0.0},{3.0,0.0},{3.0,1.0},{1.0,1.0}};
    icp(source, target);
    return 0;
}
```
:::

두 언어의 출력은 한 글자도 다르지 않다.

```console
iter=0 match=[0, 0, 2, 3] theta_deg=-18.435 t=( 0.393, 0.342) rmse=0.8178
iter=1 match=[0, 1, 2, 3] theta_deg=18.435 t=( 0.735,-0.449) rmse=0.0000
iter=2 match=[0, 1, 2, 3] theta_deg= 0.000 t=( 0.000, 0.000) rmse=0.0000
```

**복잡도:** 시간 $O(k \cdot n \cdot m)$ — 반복마다 소스 점 $n$개 각각이 타깃 점 $m$개 전부와 거리를 재므로 대응 탐색이 $O(nm)$이고, 이것이 회전·이동 추정의 $O(n)$을 압도한다. $k$는 반복 횟수(보통 수십 이하로 수렴). 공간 $O(n+m)$ — 점 좌표와 대응 배열만 든다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 구조 분해 | `for x, y in points` | `for (auto [x, y] : points)` — C++17 구조적 바인딩 |
| 삼각함수 | `math.atan2`, `math.cos` | `std::atan2`, `std::cos` — 이름과 동작이 동일 |
| 반환값 없는 매치 표시 | `best_d2 = None` 초기값 | `best_j = -1`로 판정(음수 인덱스가 없다는 사실에 의존) |
| 출력 형식 | f-string `:6.3f` | `printf("%6.3f", ...)` — 폭·정밀도 지정 문법이 다르다 |

::: pitfall
- **RMSE를 `== 0`으로 비교해 멈추려 한다.** 부동소수점 연산은 반올림 오차가 남는다. 반드시 `abs(prev - cur) < tol`처럼 허용 오차를 두고 비교한다 — [X-7 부동소수점의 함정](#/x-7)이 이 문제를 정면으로 다룬다.
- **최근접의 동률 처리를 규칙 없이 둔다.** `<`로 비교하면 먼저 찾은 후보가 이기고, `<=`로 비교하면 나중 후보가 이긴다. 둘 중 하나로 고정하지 않으면 같은 입력에서 언어나 반복 순서에 따라 다른 결과가 나올 수 있다.
- **초기 위치가 점군 크기에 비해 너무 멀다.** 이동량이 점군 자체의 지름보다 크면 첫 대응이 소스 전체를 타깃의 점 하나로 몰아붙이는 축퇴가 생긴다. 반복해도 그 함정에서 못 빠져나온다 — 오도메트리 같은 사전 추정이 필요한 이유다.
- **대칭 형상을 그대로 쓴다.** 정사각형·원기둥처럼 회전 대칭이 있으면 여러 회전각이 똑같이 좋은 대응을 만들어 어느 방향으로도 수렴이 안정되지 않는다.
- **이상치를 그대로 대응에 포함시킨다.** 동적 장애물이나 센서 노이즈로 생긴 점 하나가 최근접으로 잡히면 회전·이동 추정 전체가 그 점 쪽으로 끌려간다. [XIII-6 RANSAC](#/xiii-6)이 바로 이 문제, "일부 대응이 틀렸을 때 강건하게 모델을 추정하는 법"을 다룬다.
:::

## 5. 어디에 쓰이는가

**LiDAR 스캔 매칭이 ICP의 원형이다.** 연속한 두 스캔을 정합해 로봇의 상대 이동을 추정하는 것이 스캔 매칭이고, 이 값이 바퀴 오도메트리를 보정하거나 대체한다. 실내 이동 로봇이 바닥 슬립으로 바퀴 오도메트리가 틀어질 때도, 라이다가 벽을 계속 본다면 스캔 매칭은 흔들리지 않는다.

**대응 탐색이 실무의 병목이다.** 위 구현은 소스 점마다 타깃 전체를 훑는 전수 탐색이라 $O(nm)$이고, 점 개수가 늘면 급격히 느려진다.

| 점 개수 $n = m$ | 한 번의 대응 탐색 |
|---|---|
| 500 | 0.042초 |
| 2,000 | 0.662초 |
| 5,000 | 4.218초 |

> (Linux x86-64 / CPython 3.13 실측, 3회 실행의 중앙값. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 측정 스크립트는 `tools/bench/icp_nn_cost.py`다.)

점이 4배 늘면(500 → 2,000) 시간이 약 16배, 2.5배 늘면(2,000 → 5,000) 약 6.4배 늘었다 — $O(n^2)$ 그대로다. 20 Hz로 도는 라이다가 스캔당 점 수백~수천 개를 내는데, 매 프레임 이 비용을 두 번 이상 반복문 안에서 문다면 실시간을 지킬 수 없다. 실무 구현은 이 선형 탐색을 [XI-9 공간 인덱스](#/xi-9)의 KD 트리로 바꿔 대응 탐색을 $O(n \log m)$으로 낮춘다. 알고리즘의 뼈대(대응 → 추정 → 적용 → 확인)는 그대로이고, 바뀌는 것은 대응을 찾는 자료구조뿐이다.

**추정된 상대 이동은 그 자체로 끝나지 않는다.** 연속한 두 스캔 사이의 변환이 쌓이면 오차도 함께 쌓인다 — 100번째 스캔의 위치 추정은 이전 99번의 오차를 전부 짊어진다. 이 누적 오차를 되돌리는 장치가 [XIII-7 포즈 그래프 최적화와 루프 클로저](#/xiii-7)다. ICP는 그 포즈 그래프의 간선 하나(연속 스캔 간의 상대 변환, 또는 루프 클로저가 감지된 두 스캔 간의 상대 변환)를 만드는 도구로 다시 등장한다.

::: interview
**"ICP가 지역 최적해에 빠지는 이유를 설명하고, 실무에서 어떻게 대응합니까."**
답변 뼈대는 순환 구조다. 대응은 지금 위치에서 최근접으로 정하고, 위치는 그 대응으로 갱신한다. 초기 위치가 참값에서 멀면 최근접 자체가 계속 틀린 점을 가리키고, 그 틀린 대응에 최적인 변환으로 수렴해 버린다 — 대응이 틀렸다는 것 자체를 알고리즘이 알 방법이 없다. 대응은 "지금 상태에서의 최선"일 뿐 "진짜 대응"이 아니기 때문이다. 실무 대응은 좋은 초기값을 물려주는 것이다. 바퀴 오도메트리, IMU 적분, 이전 프레임의 속도로 외삽한 값이 흔히 쓰인다.

**"점 대 점 거리 대신 다른 오차 함수를 쓸 수 있습니까."**
점-대-평면(point-to-plane) ICP가 실무 표준에 가깝다. 타깃 점의 국소 표면 법선을 미리 구해 두고, 점 사이 거리 대신 법선 방향 거리만 최소화한다. 평평한 벽처럼 표면을 따라 미끄러지는 자유도가 있는 장면에서 점-대-점보다 빠르고 안정적으로 수렴한다 — 다만 법선을 추정하는 전처리가 추가로 필요하다.

**"이상치가 섞인 대응을 어떻게 걸러냅니까."**
거리 임계값으로 먼 대응을 아예 제외하는 방법이 가장 단순하고, 각 반복에서 임계값을 점점 좁히는 방식(trimmed ICP)도 쓴다. 원리는 [XIII-6 RANSAC](#/xiii-6)과 같다 — 잘못된 대응이 최적화를 지배하지 못하게 막는다.
:::

## 연습

이 챕터는 코딩테스트 대표문제가 약하다. ICP의 난이도는 대응 탐색이라는 조합적 구조가 아니라 최적화 문제(회전·이동을 닫힌 형태로 유도하는 것)에 있고, 이런 유형은 경쟁 프로그래밍 문제집보다 로보틱스·컴퓨터 비전 과제로 나온다. 대신 설계 판단을 묻는다.

::: quiz
각 상황에서 ① 무엇이 대응을 어렵게 만드는가 ② ICP를 그대로 쓸 수 있는가, 바꿔야 하는가 ③ 바꾼다면 무엇을 바꾸는가를 순서대로 답하라.

**1. 실내 복도에서의 스캔 매칭**
좁고 긴 복도는 진행 방향으로 특징이 거의 없다(양옆 벽만 보인다).
- 대응이 어려운 이유: 복도 방향으로 점군을 밀어도 벽까지의 거리는 거의 그대로다. 그 방향의 이동에 대해 오차 함수가 거의 평평하다.
- 판단: ICP는 돌아가지만 진행 방향 추정이 불안정하다. 회전과 옆 방향 이동은 잘 잡히고 진행 방향만 흔들린다.
- 바꿀 것: 점-대-평면으로 바꿔도 이 축의 정보 부족 자체는 못 없앤다. 바퀴 오도메트리처럼 다른 센서로 진행 방향 이동을 보강해야 한다.

**2. 동적 장애물이 지나가는 스캔**
로비 한가운데를 사람이 걸어 지나가는 순간 스캔을 두 번 찍었다.
- 대응이 어려운 이유: 사람이 찍힌 점들은 애초에 정적 지도의 어떤 점과도 대응되지 않는다. 억지로 최근접을 찾으면 잘못된 대응이 생긴다.
- 판단: ICP를 그대로 쓰면 이 이상치들이 회전·이동 추정을 왜곡한다.
- 바꿀 것: 거리 임계값으로 먼 대응을 제외하거나, RANSAC 스타일로 인라이어만 골라 재적합한다([XIII-6](#/xiii-6)).

**3. 첫 스캔과 참값 위치를 모를 때**
로봇을 처음 켰다. 초기 위치 추정이 전혀 없다.
- 대응이 어려운 이유: 항등 변환을 초기값으로 주면 두 점군이 우연히 겹치지 않는 한 최근접이 전부 엉뚱한 방향을 가리킨다.
- 판단: ICP 단독으로는 위험하다. 지역 최적해에 빠질 확률이 초기 오차에 비례해 커진다.
- 바꿀 것: 특징점 기반의 전역 정합(예: 특징 서술자로 대략의 초기 변환을 먼저 추정)을 앞에 두고, ICP는 그 결과를 다듬는 정제 단계로만 쓴다.
:::

## 요약

- ICP는 대응을 모르는 두 점군을 정렬하는 문제를 **대응 추정과 변환 추정의 반복**으로 푼다. 둘 중 하나만 있으면 다른 하나가 쉬워지는 순환을 반복으로 끊는다.
- 매 반복은 최근접으로 대응을 정하고, 그 대응에 대해 **닫힌 형태**로 회전·이동을 구한다. 반복하는 것은 변환 자체가 아니라 대응이다.
- 2D 회전은 SVD 없이 $\theta = \operatorname{atan2}(S_{xy}-S_{yx},\, S_{xx}+S_{yy})$ 하나로 구해진다. 이동은 두 무게중심의 차 $\bar q - R\bar p$다.
- 대응이 옳아지는 순간 RMSE가 매끄럽게가 아니라 **한 번에** 떨어질 수 있다 — 예제에서 반복 1이 그렇다.
- 초기 위치가 너무 멀거나 형상이 대칭이면 지역 최적해에 갇힌다. 실무는 오도메트리 같은 초기 추정치로 이 위험을 줄인다.
- 전수 대응 탐색은 $O(nm)$이라 점이 늘면 빠르게 느려진다(500점 0.04초 → 5,000점 4.2초, 실측). [XI-9 공간 인덱스](#/xi-9)의 KD 트리가 이 비용을 낮춘다.
- 이상치 대응은 [XIII-6 RANSAC](#/xiii-6)의 문제이고, 누적된 정합 오차를 되돌리는 것은 [XIII-7 포즈 그래프 최적화와 루프 클로저](#/xiii-7)의 문제다.

**다음 절**: [XIII-6 RANSAC](#/xiii-6) — 대응 중 일부가 틀렸을 때, 그 이상치에 흔들리지 않고 모델을 추정하는 법.
