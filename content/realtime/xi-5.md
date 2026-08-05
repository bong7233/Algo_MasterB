# XI-5 실시간 스케줄링 개념

::: lead
평균 2ms에 끝나는 제어 루프가 왜 기한을 놓치는가. 그리고 우선순위를 정확히 매겼는데도 왜 높은 쪽이 낮은 쪽을 기다리게 되는가.
:::

## 1. 문제

이동 로봇의 제어 루프가 10ms마다 한 번 돌아야 한다. 바퀴 엔코더를 읽고, 목표 속도와의 차이를 계산하고, 모터에 명령을 내린다. 이 루프의 실행 시간을 100만 번 재서 다음 통계가 나왔다고 하자.

```text nolines
평균 2.1ms / 중앙값 2.0ms / p99 3.4ms / 최댓값 14.8ms
```

평균은 여유가 넘친다. p99도 안전하다. 그런데 로봇은 가끔 튄다. 원인은 마지막 숫자 하나다. **한 번이라도 10ms를 넘으면 그 주기의 모터 명령이 나가지 않는다.** 명령이 안 나가면 모터는 직전 명령을 계속 유지하고, 그동안 로봇은 목표에서 벗어난 채로 움직인다.

여기서 갈리는 것이 이 챕터 전체의 전제다.

> **실시간은 빠른 것이 아니라 기한을 지키는 것이다.**

1ms 평균에 최악 20ms인 시스템보다 항상 5ms인 시스템이 실시간 관점에서 낫다. 후자는 5ms 주기를 보장하고 전자는 아무것도 보장하지 못한다. 그래서 처리량과 평균 지연을 재는 벤치마크는 실시간 시스템의 판정 근거가 되지 못한다. **재야 하는 것은 최악값이고, 최악값은 평균을 아무리 많이 모아도 나오지 않는다.**

문제는 이것이 한 태스크의 이야기가 아니라는 데 있다. 실제 시스템에는 제어 루프 말고도 통신 수신, 로그 기록, 상태 보고가 함께 돈다. 어느 것을 먼저 돌릴지 정하는 규칙이 스케줄링 정책이고, 정책에 따라 **같은 태스크 집합이 기한을 지키기도 하고 놓치기도 한다.** §4에서 그 두 결과를 나란히 출력으로 본다.

## 2. 태스크를 숫자로 적는다

먼저 태스크를 세 숫자로 줄인다. 이 축약이 없으면 판정이라는 것 자체가 성립하지 않는다.

| 기호 | 이름 | 뜻 |
|---|---|---|
| $C$ | 최악 실행 시간 | 한 번 도는 데 걸리는 시간의 **최댓값**. 평균이 아니다 |
| $T$ | 주기 | 이 태스크가 다시 깨어나는 간격 |
| $D$ | 상대 마감 | 깨어난 시점부터 이만큼 안에 끝나야 한다. 여기서는 $D = T$로 둔다 |

한 태스크가 CPU를 차지하는 비율은 $C/T$다. 이것을 전부 더한 것이 **이용률**이다.

$$U = \sum_{i=1}^{n} \frac{C_i}{T_i}$$

$U > 1$이면 어떤 정책으로도 불가능하다. 요구하는 일이 시간보다 많다. 문제는 $U \le 1$인데도 놓치는 경우가 있다는 것이고, 그것이 정책을 고르는 이유다.

**RM(Rate Monotonic)** — 주기가 짧은 태스크에 높은 우선순위를 준다. 우선순위는 처음에 정해지면 실행 내내 바뀌지 않는다(고정 우선순위). 판정식은 이렇다.

$$U \le n\left(2^{1/n} - 1\right)$$

이것을 만족하면 **반드시** 스케줄 가능하다. 만족하지 않으면 될 수도 있고 안 될 수도 있다 — 충분조건이지 필요조건이 아니다.

**EDF(Earliest Deadline First)** — 지금 마감이 가장 가까운 잡에 CPU를 준다. 우선순위가 매 순간 바뀐다(동적 우선순위). 판정식은 이것뿐이다.

$$U \le 1$$

$D = T$인 주기 태스크 집합에서 이 조건은 **필요충분**이다. EDF는 CPU를 100%까지 쓴다.

RM의 한계는 태스크 수가 늘수록 낮아지다가 한 값으로 수렴한다.

| $n$ | 1 | 2 | 3 | 5 | 10 | 100 | $\infty$ |
|---|---|---|---|---|---|---|---|
| $n(2^{1/n}-1)$ | 1.0000 | 0.8284 | 0.7798 | 0.7435 | 0.7177 | 0.6956 | 0.6931 |

$$\lim_{n \to \infty} n\left(2^{1/n} - 1\right) = \ln 2 \approx 0.693$$

읽는 법은 하나다. **이용률을 69% 아래로 유지하면 태스크가 몇 개든 RM으로 안전하다.** 그 위로 올라가면 태스크 집합을 하나씩 따져 봐야 하고, 82.8%(태스크 2개)를 넘기면 RM은 보장을 포기한다. 나머지 30%를 쓰지 못하는 것이 고정 우선순위의 값이다. 표는 `tools/bench/xi5_rm_bound.py`가 계산한다.

::: note
$\ln 2$가 나오는 이유는 최악의 태스크 집합을 대입하고 극한을 취하면 $\lim_{n\to\infty} n(2^{1/n}-1) = \lim_{n\to\infty} n \cdot \frac{\ln 2}{n} = \ln 2$가 되기 때문이다($2^{1/n} = e^{\ln 2 / n} \approx 1 + \ln 2 / n$). 상수 0.693은 우연이 아니라 지수의 밑이 2라는 사실에서 곧장 나온다.
:::

$U$가 한계와 1 사이에 있는 태스크 집합이 이 챕터의 표본이다. $T_1 = (C{=}2,\ T{=}5)$, $T_2 = (C{=}4,\ T{=}7)$이면

$$U = \frac{2}{5} + \frac{4}{7} = 0.971$$

이다. RM 한계 0.828보다 크고 1보다 작다. **EDF는 반드시 지키고, RM은 보장이 없다.** 실제로 어느 쪽이 놓치는지는 돌려 봐야 안다.

## 3. 손으로 따라가기

::: trace
위 두 태스크를 **RM**으로 돌린다. $T_1$의 주기가 5로 더 짧으니 $T_1$이 항상 이긴다.

시각 $t$의 슬롯은 1단위다. 각 태스크는 주기가 돌아올 때마다 새 잡을 내고, 그 잡의 마감은 `깨어난 시각 + 주기`다. `남은 T1`·`남은 T2`는 슬롯이 **끝난 뒤**의 값을 적는다.

| t | 실행 | 남은 T1 | 남은 T2 | T1 마감 | T2 마감 |
|---|---|---|---|---|---|
| 0 | T1 | 1 | 4 | 5 | 7 |
| 1 | T1 | 0 | 4 | 5 | 7 |
| 2 | T2 | 0 | 3 | 5 | 7 |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |

세 가지를 확인하라.

- [ ] $t=5$에서 무슨 일이 일어나는가. 그때 실행 중이던 태스크는 어떻게 되는가
- [ ] $t=7$ 시점에 $T_2$의 남은 실행 시간은 얼마인가. $T_2$의 마감은 언제인가
- [ ] 같은 표를 **EDF**로 다시 채워라. $t=5$에서 선택이 어떻게 갈리는가
:::

::: answer
| t | 실행 | 남은 T1 | 남은 T2 | T1 마감 | T2 마감 |
|---|---|---|---|---|---|
| 0 | T1 | 1 | 4 | 5 | 7 |
| 1 | T1 | 0 | 4 | 5 | 7 |
| 2 | T2 | 0 | 3 | 5 | 7 |
| 3 | T2 | 0 | 2 | 5 | 7 |
| 4 | T2 | 0 | 1 | 5 | 7 |
| 5 | **T1** | 1 | 1 | 10 | 7 |
| 6 | T1 | 0 | 1 | 10 | 7 |

$t=5$에서 $T_1$의 새 잡이 나온다. RM은 주기만 보므로 마감이 7로 코앞인 $T_2$를 **선점**하고 $T_1$을 돌린다. $T_2$는 1단위를 남긴 채 $t=7$의 마감을 맞는다. **마감 실패다.**

EDF로 채우면 $t=5$에서 갈린다. 그 시점의 마감은 $T_1$이 10, $T_2$가 7이다. EDF는 7 쪽을 골라 $T_2$를 마저 돌리고, $T_2$는 $t=6$에 끝난다. $T_1$은 $t=6,7$에 돌아 마감 10을 여유 있게 지킨다. **한 슬롯의 선택이 두 정책의 전부다.**

RM이 틀린 선택을 한 것이 아니다. RM은 마감을 볼 수 없다 — 우선순위가 주기에서 한 번 정해지고 실행 중에 바뀌지 않기 때문이다. 그 정보를 버린 대가가 이 실패다.
:::

## 4. 구현

두 정책을 같은 시뮬레이터에 넣고 하이퍼피리어드($\mathrm{lcm}(5,7) = 35$)만큼 돌린다. 여기까지 보면 패턴이 반복되므로 그 뒤는 볼 필요가 없다.

**실제 스레드를 쓰지 않는다.** 스레드를 쓰면 같은 코드가 실행마다 다른 타임라인을 내고, 그러면 이 절이 아무것도 증명하지 못한다. 시간은 정수 슬롯이고 스케줄러는 순수 함수다.

::: dual
```python title="RM과 EDF — 같은 태스크 집합, 다른 결과"
# 태스크 = (이름, 실행시간 C, 주기 T). 마감은 주기와 같다고 둔다(D = T).
TASKS = [("T1", 2, 5), ("T2", 4, 7)]
HYPER = 35                      # 하이퍼피리어드 lcm(5, 7). 여기까지가 한 주기다


def simulate(policy):
    """1단위 슬롯의 가상 시간 시뮬레이션. 실제 스레드가 없으므로 결과가 결정적이다."""
    n = len(TASKS)
    rem = [0] * n               # 현재 잡의 남은 실행 시간
    dl = [0] * n                # 현재 잡의 절대 마감
    slots = []
    misses = []
    for t in range(HYPER):
        for i in range(n):      # 주기가 오면 새 잡이 나온다. 마감을 넘긴 잡은 버린다
            if t % TASKS[i][2] == 0:
                rem[i] = TASKS[i][1]
                dl[i] = t + TASKS[i][2]
        run, best = -1, 0
        for i in range(n):
            if rem[i] == 0:
                continue
            key = TASKS[i][2] if policy == "RM" else dl[i]   # RM=주기, EDF=마감
            if run < 0 or key < best:
                best, run = key, i
        slots.append(str(run + 1) if run >= 0 else ".")
        if run >= 0:
            rem[run] -= 1
        for i in range(n):      # 슬롯이 끝난 시각 t+1 에 마감이 걸렸는지 본다
            if dl[i] == t + 1 and rem[i] > 0:
                misses.append((t + 1, TASKS[i][0], rem[i]))
    return "".join(slots), misses


def ruler(width, step):
    buf = [" "] * width
    for k in range(0, width, step):
        for j, ch in enumerate(str(k)):
            if k + j < width:
                buf[k + j] = ch
    return "".join(buf).rstrip()


u = 0.0
for name, c, p in TASKS:
    u += c / p
    print(f"{name}  C={c} T={p}  U_i={c/p:.3f}")
bound = len(TASKS) * (2 ** (1 / len(TASKS)) - 1)
print(f"전체 이용률 U = {u:.3f}")
print(f"RM  한계 n(2^(1/n)-1) = {bound:.3f}  ->  {'보장' if u <= bound else '보장 없음'}")
print(f"EDF 한계 1.000                 ->  {'보장' if u <= 1.0 else '보장 없음'}")
print()
print("t    " + ruler(HYPER, 5))
for policy in ("RM", "EDF"):
    line, _ = simulate(policy)
    print(f"{policy:<4} {line}")
print()
for policy in ("RM", "EDF"):
    _, misses = simulate(policy)
    detail = "".join(f"  t={t} {nm} 남은 실행 {r}" for t, nm, r in misses)
    print(f"{policy:<4}마감 실패 {len(misses)}회{detail}")
```
```cpp title="RM과 EDF — 같은 태스크 집합, 다른 결과"
#include <cmath>
#include <cstdio>
#include <string>
#include <tuple>
#include <vector>
using namespace std;

// 태스크 = (이름, 실행시간 C, 주기 T). 마감은 주기와 같다고 둔다(D = T).
const vector<tuple<string, int, int>> TASKS = {{"T1", 2, 5}, {"T2", 4, 7}};
const int HYPER = 35;           // 하이퍼피리어드 lcm(5, 7). 여기까지가 한 주기다

struct Miss { int t; string name; int rem; };

// 1단위 슬롯의 가상 시간 시뮬레이션. 실제 스레드가 없으므로 결과가 결정적이다.
pair<string, vector<Miss>> simulate(const string& policy) {
    int n = (int)TASKS.size();
    vector<int> rem(n, 0);      // 현재 잡의 남은 실행 시간
    vector<int> dl(n, 0);       // 현재 잡의 절대 마감
    string slots;
    vector<Miss> misses;
    for (int t = 0; t < HYPER; t++) {
        for (int i = 0; i < n; i++)   // 주기가 오면 새 잡이 나온다. 마감을 넘긴 잡은 버린다
            if (t % get<2>(TASKS[i]) == 0) {
                rem[i] = get<1>(TASKS[i]);
                dl[i] = t + get<2>(TASKS[i]);
            }
        int run = -1, best = 0;
        for (int i = 0; i < n; i++) {
            if (rem[i] == 0) continue;
            int key = (policy == "RM") ? get<2>(TASKS[i]) : dl[i];   // RM=주기, EDF=마감
            if (run < 0 || key < best) { best = key; run = i; }
        }
        slots += (run >= 0) ? char('1' + run) : '.';
        if (run >= 0) rem[run] -= 1;
        for (int i = 0; i < n; i++)   // 슬롯이 끝난 시각 t+1 에 마감이 걸렸는지 본다
            if (dl[i] == t + 1 && rem[i] > 0)
                misses.push_back({t + 1, get<0>(TASKS[i]), rem[i]});
    }
    return {slots, misses};
}

string ruler(int width, int step) {
    string buf(width, ' ');
    for (int k = 0; k < width; k += step) {
        string s = to_string(k);
        for (int j = 0; j < (int)s.size(); j++)
            if (k + j < width) buf[k + j] = s[j];
    }
    while (!buf.empty() && buf.back() == ' ') buf.pop_back();
    return buf;
}

int main() {
    double u = 0.0;
    for (auto& [name, c, p] : TASKS) {
        u += (double)c / p;
        printf("%s  C=%d T=%d  U_i=%.3f\n", name.c_str(), c, p, (double)c / p);
    }
    int n = (int)TASKS.size();
    double bound = n * (pow(2.0, 1.0 / n) - 1.0);
    printf("전체 이용률 U = %.3f\n", u);
    printf("RM  한계 n(2^(1/n)-1) = %.3f  ->  %s\n", bound, u <= bound ? "보장" : "보장 없음");
    printf("EDF 한계 1.000                 ->  %s\n", u <= 1.0 ? "보장" : "보장 없음");
    printf("\n");
    printf("t    %s\n", ruler(HYPER, 5).c_str());
    for (const string& policy : {string("RM"), string("EDF")})
        printf("%-4s %s\n", policy.c_str(), simulate(policy).first.c_str());
    printf("\n");
    for (const string& policy : {string("RM"), string("EDF")}) {
        auto misses = simulate(policy).second;
        string detail;
        for (auto& m : misses)
            detail += "  t=" + to_string(m.t) + " " + m.name + " 남은 실행 " + to_string(m.rem);
        printf("%-4s마감 실패 %d회%s\n", policy.c_str(), (int)misses.size(), detail.c_str());
    }
}
```
:::

```console
T1  C=2 T=5  U_i=0.400
T2  C=4 T=7  U_i=0.571
전체 이용률 U = 0.971
RM  한계 n(2^(1/n)-1) = 0.828  ->  보장 없음
EDF 한계 1.000                 ->  보장

t    0    5    10   15   20   25   30
RM   1122211222112.21122211222112221122.
EDF  1122221122221121122211222211221122.

RM  마감 실패 1회  t=7 T2 남은 실행 1
EDF 마감 실패 0회
```

**복잡도:** 시간 $O(H \cdot n)$ — 슬롯 $H$개마다 태스크 $n$개를 전부 훑어 최소 키를 찾으므로 슬롯당 $O(n)$이다. 태스크가 수백 개면 이 선형 탐색을 힙으로 바꾼다. 그러면 슬롯당 $O(\log n)$이 되고, 그 힙이 곧 [II-8 힙과 우선순위 큐](#/ii-8)의 우선순위 큐다 — **RM은 키가 주기라 힙이 정적이고, EDF는 키가 마감이라 잡이 나올 때마다 힙이 갱신된다.** 공간 $O(n)$ — 태스크마다 남은 실행 시간과 마감 하나씩. 타임라인 문자열은 출력용이라 세지 않는다.

두 줄만 읽으면 된다. **RM은 $t=7$에서 $T_2$의 마감을 1단위 남기고 놓쳤고, EDF는 35슬롯 동안 한 번도 놓치지 않았다.** 이용률은 같다. 달라진 것은 $t=5$의 선택 하나다.

RM 타임라인의 $t=13$에 찍힌 `.`도 봐 둘 것. 마감을 놓친 잡을 버렸기 때문에 생긴 빈 슬롯이다. **놓친 뒤에는 CPU가 남는다** — 실패는 과부하로만 오는 것이 아니라 순서 하나로도 온다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 태스크 표현 | 튜플 목록. `TASKS[i][2]`로 꺼낸다 | `tuple` + `get<2>`, 또는 필드 이름이 있는 `struct`. 실무 코드는 `struct` 쪽이다 |
| 최솟값 선택 | 리스트 순회. `min(..., key=...)`로도 되지만 인덱스가 필요해 풀어 썼다 | 같은 순회. `std::min_element` + 람다 비교자도 같은 결과 |
| 실수 서식 | `f"{x:.3f}"` | `printf("%.3f")`. 두 서식의 반올림이 같아 출력이 정확히 일치한다 |
| 실제 스케줄링 API | 리눅스에서 `os.sched_setscheduler(tid, os.SCHED_FIFO, os.sched_param(p))`가 있다. 스레드 단위로 걸려면 `threading.get_native_id()`로 tid를 얻는다 | `std::thread`에는 없다. `native_handle()`로 내려가 `pthread_setschedparam`을 부른다. 어느 쪽이든 실시간 우선순위는 권한이 필요하다 |
| 실시간 적합성 | GC 정지와 인터프리터 오버헤드가 최악값에 그대로 얹힌다. **최악값을 보장해야 하는 경로에 두지 않는다** | 최악값을 다룰 수는 있다. 단 `new`·`std::string`의 동적 할당이 같은 문제를 만들어 실시간 경로에서는 할당을 미리 끝낸다 |

::: pitfall
- **$C$에 평균을 넣는 것.** 판정식은 최악 실행 시간을 전제한다. 평균을 넣으면 계산은 통과하고 시스템은 실패한다. §1의 표에서 넣어야 할 숫자는 2.1이 아니라 14.8이다.
- **$U \le 1$을 스케줄 가능의 증명으로 쓰는 것.** EDF에서만 참이다. RM에서는 $U = 0.971$이 위 출력처럼 실패한다.
- **RM 한계를 넘겼다고 불가능이라고 단정하는 것.** 충분조건이다. 한계를 넘겨도 되는 집합이 많고, 판정하려면 실제로 돌리거나 응답시간 분석을 해야 한다.
- **주기가 조화 관계일 때를 일반화하는 것.** 주기가 전부 배수 관계($2, 4, 8$)면 RM은 $U \le 1$까지 간다. 그 경험을 주기가 5와 7인 집합에 적용하면 위 출력을 만난다.
- **마감을 놓친 잡을 어떻게 할지 정하지 않는 것.** 버릴지, 늦게라도 끝낼지, 다음 잡을 건너뛸지는 정책이다. 위 코드는 버린다. 정하지 않으면 놓친 뒤의 동작이 코드 어딘가에 우연히 결정된다.
:::

## 5. 우선순위 역전

우선순위를 정확히 매겼는데도 순서가 뒤집히는 경로가 하나 있다. **공유 자원이다.**

세 태스크가 있다. `H`는 우선순위가 가장 높고, `M`은 중간, `L`은 가장 낮다. `H`와 `L`은 같은 자료구조를 만지므로 같은 뮤텍스를 쓴다. `M`은 그 자료구조와 무관하다.

일어나는 일은 이렇다. `L`이 먼저 깨어나 락을 잡는다. `H`가 깨어나 `L`을 선점하지만 곧 같은 락을 요구하며 막힌다. 여기까지는 정상이다 — `H`는 `L`이 임계 구역을 나올 때까지만 기다리면 된다. 그런데 `M`이 깨어난다. `M`은 `L`보다 우선순위가 높으니 `L`을 선점한다. `L`이 못 돌면 락이 안 풀리고, 락이 안 풀리면 `H`도 못 돈다.

==결과적으로 `M`이 `H`를 막는다.== 둘 사이에 아무 관계도 없는데 그렇게 된다. 그리고 이 지연에는 **상한이 없다.** `M` 같은 중간 우선순위 태스크가 몇 개든, 얼마나 오래 돌든 `H`는 그만큼 더 기다린다.

처방은 **우선순위 상속**이다. 락을 쥔 태스크가 자기보다 높은 태스크를 막고 있으면, 그 순간 락을 쥔 쪽의 우선순위를 기다리는 쪽만큼 올린다. 락을 놓으면 원래대로 돌아온다. 위 시나리오에서는 `L`이 잠시 `H`의 우선순위를 얻어 `M`을 이기고, 임계 구역을 마치고 락을 놓는다. **`H`의 대기 시간이 `L`의 임계 구역 길이로 묶인다.**

::: trace
`L`은 $t=0$에 깨어나 6단위를 돌고, 1단위 실행 후 락을 잡아 4단위째에 놓는다.
`H`는 $t=2$에 깨어나 3단위를 돌고, 1단위 실행 후 같은 락을 요구한다.
`M`은 $t=3$에 깨어나 5단위를 돌고 락을 쓰지 않는다.

**우선순위 상속이 없는** 경우다. `락 주인`은 슬롯이 끝난 뒤의 값이다.

| t | 실행 | 락 주인 | 막힌 태스크 | 이유 |
|---|---|---|---|---|
| 0 | L | — | — | L만 깨어 있다 |
| 1 | L | L | — | L이 락을 잡았다 |
| 2 | H | L | — | H가 L을 선점. 아직 락을 요구하지 않았다 |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |

세 가지를 확인하라.

- [ ] $t=3$에서 `H`가 락을 요구한다. 그때 CPU를 받는 것은 누구이고 왜인가
- [ ] `M`이 다 돌 때까지 `H`는 몇 슬롯을 기다리는가. `M`의 실행 시간이 50이면 몇 슬롯인가
- [ ] 상속을 켜면 $t=3$에서 누가 도는가. `H`는 언제 끝나는가
:::

::: answer
| t | 실행 | 락 주인 | 막힌 태스크 | 이유 |
|---|---|---|---|---|
| 0 | L | — | — | L만 깨어 있다 |
| 1 | L | L | — | L이 락을 잡았다 |
| 2 | H | L | — | H가 L을 선점. 아직 락을 요구하지 않았다 |
| 3 | **M** | L | H | H가 락을 요구해 막혔다. 남은 것 중 M이 가장 높다 |
| 4 | M | L | H | |
| 5 | M | L | H | |
| 6 | M | L | H | |
| 7 | M | L | H | M이 끝난다 |
| 8 | L | L | H | 이제야 L이 돈다 |
| 9 | L | — | — | L이 락을 놓는다 |
| 10 | H | — | — | H가 풀려 다시 돈다 |

$t=3$에서 `H`가 막히는 순간 준비 상태인 것은 `M`과 `L`뿐이고, 그중 우선순위가 높은 `M`이 CPU를 받는다. 스케줄러는 규칙대로 동작했다. **버그는 스케줄러가 아니라 "락을 쥔 태스크의 우선순위가 그 사실을 반영하지 않는다"는 데 있다.**

`H`는 $t=3$부터 $t=9$까지 7슬롯을 막혀 있다. 그중 5슬롯이 `M` 때문이고, `M`의 실행 시간이 50이면 그대로 50슬롯이 된다. **상한이 없다는 것이 이 지연의 성질이다.**

상속을 켜면 $t=3$에서 `L`이 `H`의 우선순위를 물려받아 `M`을 이긴다. `L`은 $t=3,4$에 돌아 락을 놓고, `H`는 $t=5$에 풀려 $t=7$에 끝난다.
:::

::: dual
```python title="우선순위 역전과 상속 — 같은 태스크, 상속만 끄고 켜기"
# (이름, 기본 우선순위(클수록 높음), 도착, 총 실행, 락 획득 시점, 락 반납 시점)
#   락 시점은 그 태스크가 몇 단위 실행한 뒤인가로 적는다. -1 은 락을 안 쓴다는 뜻.
BASE = [("H", 3, 2, 3, 1, 3), ("M", 2, 3, 5, -1, -1), ("L", 1, 0, 6, 1, 4)]
DEADLINE_H = 8                  # H 의 상대 마감. 도착 후 8단위 안에 끝나야 한다


def simulate(tasks, horizon, inherit):
    """가상 시간 슬롯 시뮬레이션. 실제 스레드가 없으므로 인터리빙이 결정적이다."""
    n = len(tasks)
    done = [0] * n
    owner = -1                  # 락을 쥔 태스크. -1 이면 비어 있다
    slots = []
    finish = [-1] * n
    for t in range(horizon):
        ready, blocked = [], []
        for i in range(n):
            _, _, rel, work, la, _ = tasks[i]
            if t < rel or done[i] == work:
                continue
            if la >= 0 and done[i] == la and owner >= 0 and owner != i:
                blocked.append(i)       # 남이 쥔 락을 기다린다
            else:
                ready.append(i)
        prio = [tasks[i][1] for i in range(n)]
        if inherit and owner >= 0 and blocked:      # 우선순위 상속
            top = max(tasks[i][1] for i in blocked)
            if top > prio[owner]:
                prio[owner] = top
        run = -1
        for i in ready:
            if run < 0 or prio[i] > prio[run]:
                run = i
        slots.append(tasks[run][0] if run >= 0 else ".")
        if run >= 0:
            la, lr = tasks[run][4], tasks[run][5]
            if la >= 0 and done[run] == la:
                owner = run
            done[run] += 1
            if lr >= 0 and done[run] == lr and owner == run:
                owner = -1
            if done[run] == tasks[run][3]:
                finish[run] = t + 1
    return "".join(slots), finish


def ruler(width, step):
    buf = [" "] * width
    for k in range(0, width, step):
        for j, ch in enumerate(str(k)):
            if k + j < width:
                buf[k + j] = ch
    return "".join(buf).rstrip()


print("t       " + ruler(15, 5))
for inherit in (False, True):
    line, finish = simulate(BASE, 15, inherit)
    tag = "상속 켬  " if inherit else "상속 끔  "
    print(f"{tag}{line}   H 완료 t={finish[0]}")
print()
print("M 실행량  상속 끔 H 응답  상속 켬 H 응답")
for mw in (5, 20, 50):
    row = []
    for inherit in (False, True):
        tasks = [(nm, p, r, mw if nm == "M" else w, la, lr) for nm, p, r, w, la, lr in BASE]
        _, finish = simulate(tasks, 200, inherit)
        row.append(finish[0] - BASE[0][2])
    print(f"{mw:<9} {row[0]:<14} {row[1]}")
print()
for inherit in (False, True):
    _, finish = simulate(BASE, 15, inherit)
    rt = finish[0] - BASE[0][2]
    tag = "상속 켬" if inherit else "상속 끔"
    print(f"{tag}: H 응답시간 {rt}, 마감 {DEADLINE_H} -> {'지킴' if rt <= DEADLINE_H else '놓침'}")
```
```cpp title="우선순위 역전과 상속 — 같은 태스크, 상속만 끄고 켜기"
#include <cstdio>
#include <string>
#include <tuple>
#include <vector>
using namespace std;

// (이름, 기본 우선순위(클수록 높음), 도착, 총 실행, 락 획득 시점, 락 반납 시점)
//   락 시점은 그 태스크가 몇 단위 실행한 뒤인가로 적는다. -1 은 락을 안 쓴다는 뜻.
struct Task { string name; int prio, rel, work, la, lr; };
const vector<Task> BASE = {{"H", 3, 2, 3, 1, 3}, {"M", 2, 3, 5, -1, -1}, {"L", 1, 0, 6, 1, 4}};
const int DEADLINE_H = 8;       // H 의 상대 마감. 도착 후 8단위 안에 끝나야 한다

// 가상 시간 슬롯 시뮬레이션. 실제 스레드가 없으므로 인터리빙이 결정적이다.
pair<string, vector<int>> simulate(const vector<Task>& tasks, int horizon, bool inherit) {
    int n = (int)tasks.size();
    vector<int> done(n, 0);
    int owner = -1;             // 락을 쥔 태스크. -1 이면 비어 있다
    string slots;
    vector<int> finish(n, -1);
    for (int t = 0; t < horizon; t++) {
        vector<int> ready, blocked;
        for (int i = 0; i < n; i++) {
            const Task& tk = tasks[i];
            if (t < tk.rel || done[i] == tk.work) continue;
            if (tk.la >= 0 && done[i] == tk.la && owner >= 0 && owner != i)
                blocked.push_back(i);       // 남이 쥔 락을 기다린다
            else
                ready.push_back(i);
        }
        vector<int> prio(n);
        for (int i = 0; i < n; i++) prio[i] = tasks[i].prio;
        if (inherit && owner >= 0 && !blocked.empty()) {        // 우선순위 상속
            int top = tasks[blocked[0]].prio;
            for (int i : blocked) if (tasks[i].prio > top) top = tasks[i].prio;
            if (top > prio[owner]) prio[owner] = top;
        }
        int run = -1;
        for (int i : ready)
            if (run < 0 || prio[i] > prio[run]) run = i;
        slots += (run >= 0) ? tasks[run].name : ".";
        if (run >= 0) {
            int la = tasks[run].la, lr = tasks[run].lr;
            if (la >= 0 && done[run] == la) owner = run;
            done[run] += 1;
            if (lr >= 0 && done[run] == lr && owner == run) owner = -1;
            if (done[run] == tasks[run].work) finish[run] = t + 1;
        }
    }
    return {slots, finish};
}

string ruler(int width, int step) {
    string buf(width, ' ');
    for (int k = 0; k < width; k += step) {
        string s = to_string(k);
        for (int j = 0; j < (int)s.size(); j++)
            if (k + j < width) buf[k + j] = s[j];
    }
    while (!buf.empty() && buf.back() == ' ') buf.pop_back();
    return buf;
}

int main() {
    printf("t       %s\n", ruler(15, 5).c_str());
    for (bool inherit : {false, true}) {
        auto [line, finish] = simulate(BASE, 15, inherit);
        printf("%s%s   H 완료 t=%d\n", inherit ? "상속 켬  " : "상속 끔  ", line.c_str(), finish[0]);
    }
    printf("\n");
    printf("M 실행량  상속 끔 H 응답  상속 켬 H 응답\n");
    for (int mw : {5, 20, 50}) {
        int row[2];
        for (int k = 0; k < 2; k++) {
            vector<Task> tasks = BASE;
            for (Task& tk : tasks) if (tk.name == "M") tk.work = mw;
            row[k] = simulate(tasks, 200, k == 1).second[0] - BASE[0].rel;
        }
        printf("%-9d %-14d %d\n", mw, row[0], row[1]);
    }
    printf("\n");
    for (bool inherit : {false, true}) {
        auto [line, finish] = simulate(BASE, 15, inherit);
        int rt = finish[0] - BASE[0].rel;
        printf("%s: H 응답시간 %d, 마감 %d -> %s\n", inherit ? "상속 켬" : "상속 끔",
               rt, DEADLINE_H, rt <= DEADLINE_H ? "지킴" : "놓침");
    }
}
```
:::

```console
t       0    5    10
상속 끔  LLHMMMMMLLHHLL.   H 완료 t=12
상속 켬  LLHLLHHMMMMMLL.   H 완료 t=7

M 실행량  상속 끔 H 응답  상속 켬 H 응답
5         10             5
20        25             5
50        55             5

상속 끔: H 응답시간 10, 마감 8 -> 놓침
상속 켬: H 응답시간 5, 마감 8 -> 지킴
```

**복잡도:** 슬롯당 $O(n)$ — 매 슬롯 태스크 $n$개를 훑어 준비/차단을 가르고 최고 우선순위를 고른다. 상속 계산도 차단된 태스크를 한 번 훑는 $O(n)$이라 차수를 바꾸지 않는다. 전체 $O(\text{horizon} \cdot n)$. 공간 $O(n)$ — 진행량·완료 시각·유효 우선순위가 태스크마다 하나씩. 실제 커널 구현에서 중요한 상수는 다른 데 있다. **상속은 락을 걸 때마다가 아니라 실제로 충돌이 났을 때만 발동하므로, 경합이 없으면 비용이 0이다.**

가운데 표가 이 절의 핵심이다. `M`의 실행량이 5·20·50으로 늘 때 상속을 끄면 `H`의 응답시간이 10·25·55로 따라 늘고, 켜면 **5에 고정된다.** 그 5는 `L`의 임계 구역 길이이고, 그것이 상속이 주는 상한이다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 우선순위 상속 지원 | `threading.Lock`에 상속이 없다. 애초에 GIL이 있어 CPU 바운드 스레드가 겹치지 않으므로 이 문제의 형태가 다르다 | POSIX `pthread_mutexattr_setprotocol`로 `PTHREAD_PRIO_INHERIT`를 건다. `std::mutex`에는 이 설정이 없어 `pthread_mutex_t`를 직접 쓴다 |
| 숨은 공유 자원 | **GIL 자체가 §5의 락이다.** 이 환경의 CPython 3.13은 기본 빌드라 `sys._is_gil_enabled()`가 `True`다. 뮤텍스를 하나도 쓰지 않아도 CPU 바운드 스레드끼리 GIL을 두고 같은 구조로 경쟁한다 | 그런 전역 락이 없다. 대신 공유 자원을 전부 직접 세야 하고, 세지 않은 것이 §5의 시나리오가 된다 |
| 임계 구역 길이 | 인터프리터라 같은 코드에서 더 길다. 상속이 있어도 상한 자체가 커진다 | 상한을 짧게 유지할 수 있다. 그래서 실시간 경로가 C++로 남는다 |
| 시뮬레이션 코드 | 튜플 언패킹으로 태스크를 푼다 | `struct` 필드. C++17 구조적 바인딩(`auto& [line, finish]`)이 Python 언패킹과 같은 자리를 채운다 |

::: warn
상속이 만병통치는 아니다. 락을 두 개 이상 중첩해서 잡으면 상속이 사슬처럼 전파되고(연쇄 상속), 두 태스크가 락 두 개를 반대 순서로 잡으면 **상속이 있어도 교착한다.** 상속은 우선순위 문제를 풀지 순서 문제를 풀지 않는다. 교착 자체는 [V-10 교착 검출과 회피](#/v-10)의 주제다.

지연의 상한을 더 조이려면 우선순위 상한 프로토콜(priority ceiling)로 간다. 락마다 그것을 쓰는 태스크 중 최고 우선순위를 미리 적어 두고, 락을 잡는 순간 그 값으로 올리는 방식이다. 상속보다 강한 보장을 주는 대신 락과 태스크의 관계를 정적으로 다 알아야 한다. **이 책은 여기까지가 범위다.**
:::

## 6. 어디에 박혀 있는가

**리눅스 커널의 `SCHED_FIFO`·`SCHED_RR`이 고정 우선순위 스케줄러다.** 우선순위 1~99를 주면 그 안에서는 높은 쪽이 항상 이긴다. RM은 이 위에 "주기가 짧은 것에 높은 번호를 준다"는 배정 규칙을 얹은 것이다. 커널이 RM을 구현하는 것이 아니라 **RM이 배정 정책이고 커널은 고정 우선순위 실행기**라는 구분이 중요하다. `SCHED_DEADLINE`은 이쪽이 아니라 EDF 계열이고, 잡마다 실행 시간과 마감을 명시한다.

**뮤텍스의 우선순위 상속은 POSIX 표준 기능이다.** `pthread_mutexattr_setprotocol(&attr, PTHREAD_PRIO_INHERIT)` 한 줄이 §5의 처방이다. 기본값이 아니라는 점이 중요하다 — 켜지 않으면 §5의 왼쪽 타임라인이 그대로 나온다.

**오디오 콜백이 가장 흔한 경성 실시간 경로다.** 사운드 카드가 5.8ms마다 256샘플을 요구하고, 한 번이라도 늦으면 소리가 튄다. 그래서 이 콜백 안에서는 메모리 할당도, 락도, 파일 I/O도 금지다. 전부 최악 실행 시간에 상한이 없기 때문이다. 데이터는 미리 할당한 링 버퍼로 주고받는다 — [XI-1 링 버퍼(원형 큐)](#/xi-1)가 이 자리에 있는 이유다.

**게임 엔진의 프레임 예산도 같은 구조다.** 60fps면 16.7ms가 마감이고, 물리·렌더·오디오·네트워크가 그 안을 나눠 쓴다. "평균 프레임 시간"이 아니라 **1% low(하위 1% 프레임의 시간)**를 보는 관행이 §1의 명제와 정확히 같다.

**로봇 제어 스택은 주기가 다른 루프를 계층으로 쌓는다.** 모터 제어 1kHz, 궤적 추종 100Hz, 경로 계획 10Hz. 주기가 짧은 쪽이 우선순위가 높다는 배정이 곧 RM이고, 이 셋의 이용률 합이 §2의 $U$다. 경로 계획이 가끔 오래 걸려도 제어 루프가 선점하므로 로봇은 흔들리지 않는다.

## 7. 이 챕터의 경계

여기서 다룬 것은 판정과 개념이다. 실제로 기한을 지키는 시스템을 만들려면 더 필요한 것이 있고, 그것들은 이 책의 범위가 아니다.

- **최악 실행 시간을 어떻게 구하는가.** 측정으로는 상한이 나오지 않는다(가장 나쁜 입력을 못 봤을 수 있다). 정적 분석 도구와 하드웨어 모델이 필요한 별도 분야다.
- **일반 리눅스는 경성 실시간 OS가 아니다.** 커널 선점 지연, 인터럽트 처리, 페이지 폴트가 최악값에 얹힌다. `PREEMPT_RT` 패치나 전용 RTOS가 그 지점을 다룬다.
- **여러 코어가 있으면 판정식이 달라진다.** 위 판정은 전부 단일 코어 기준이다. 멀티코어에서는 "이용률 합이 코어 수 이하"가 충분조건이 되지 못한다.

::: interview
**"실시간 시스템이 무엇인가"** — 빠른 시스템이라고 답하면 거기서 끝난다. 답의 뼈대는 셋이다. ① 기한을 지키는 것이 정의이고 평균이 아니라 최악값이 기준이다. ② 그래서 경성(놓치면 실패)과 연성(놓치면 품질 저하)을 구분한다. ③ 판정은 이용률과 정책으로 한다 — RM은 $n(2^{1/n}-1)$까지 보장하고 EDF는 1까지 간다.

**"EDF가 더 좋은데 왜 RM을 쓰는가"** — 셋을 들면 충분하다. ① 구현이 단순하다. 우선순위가 고정이라 힙을 갱신할 필요가 없고 커널 API가 그대로 있다. ② 과부하 시 동작이 예측 가능하다. RM은 낮은 우선순위부터 무너지지만, EDF는 과부하가 나면 도미노처럼 전부 무너질 수 있다. ③ 어느 태스크가 먼저 희생될지 설계자가 지정할 수 있다.

**"우선순위 역전을 설명하라"** — 시나리오를 세 태스크로 말하는 것이 가장 빠르다. 낮은 쪽이 락을 쥔 채 중간 쪽에 선점당하면 높은 쪽이 무한정 기다린다. 처방은 우선순위 상속이고, 그것이 대기 시간을 임계 구역 길이로 묶는다. 한 걸음 더 나가려면 "상속은 교착을 막지 못한다"를 덧붙인다.
:::

## 연습

::: quiz
**1. 로그 기록이 제어 루프를 늦춘다**
- 상황: 1kHz 제어 루프와 10Hz 로그 기록 태스크가 있다. 로그 태스크는 디스크에 쓸 때 가끔 30ms를 쓴다. 제어 루프가 그 30ms 동안 밀린다.
- 무엇이 변하는가: 로그 태스크의 $C$가 사실상 무한대다. 디스크 지연에 상한이 없기 때문이다. 그러면 이용률 계산 자체가 성립하지 않는다.
- 어떤 구조이고 대가는 무엇인가: 상한 없는 작업을 실시간 태스크로 두지 않는다. 제어 루프는 링 버퍼에 기록만 하고([XI-1](#/xi-1)), 별도의 비실시간 스레드가 그것을 꺼내 디스크에 쓴다. 대가는 버퍼가 가득 차면 로그가 유실된다는 것이고, **유실을 받아들이는 것이 곧 제어 루프를 지키는 선택**이다.

**2. RM 한계를 넘긴 세 태스크**
- 상황: $(C,T)$가 $(1,4), (2,6), (2,10)$인 세 태스크. $U = 0.25 + 0.333 + 0.2 = 0.783$이고 RM 한계 $0.780$을 아주 조금 넘긴다.
- 무엇이 변하는가: 판정식이 답을 주지 못한다. 넘겼다는 것은 "보장 없음"이지 "불가능"이 아니다.
- 어떤 구조이고 대가는 무엇인가: 하이퍼피리어드 $\mathrm{lcm}(4,6,10) = 60$까지 시뮬레이션하거나 응답시간 분석을 한다. §4의 코드에 태스크를 넣으면 그대로 나온다. 대가는 태스크가 하나라도 바뀌면 판정을 다시 해야 한다는 것이다 — **판정식은 그 재검토를 면제해 주는 대신 여유를 요구한다.**

**3. 우선순위를 올려 달라는 요청**
- 상황: 통신 태스크가 가끔 메시지를 놓친다. 담당자가 우선순위를 제어 루프보다 높게 올려 달라고 요청한다.
- 무엇이 변하는가: 통신 태스크의 $C$는 메시지 폭주 시 커진다. 그것을 제어 루프 위에 두면 제어 루프의 최악 지연이 통신 태스크의 최악 실행 시간만큼 늘어난다.
- 어떤 구조이고 대가는 무엇인가: 우선순위는 중요도가 아니라 **주기와 마감**으로 정한다(RM). 통신을 살리려면 우선순위가 아니라 버퍼 크기와 배압을 손봐야 하고, 그 주제가 [XI-7 이벤트 루프와 백프레셔](#/xi-7)다. 우선순위로 푸는 것의 대가는 언제나 다른 태스크의 마감이다.
:::

## 요약

- **실시간은 빠른 것이 아니라 기한을 지키는 것이다.** 기준은 평균이 아니라 최악값이고, 평균만 재는 벤치마크는 이 판정에 쓸 수 없다.
- 태스크를 $(C, T, D)$ 세 숫자로 줄이면 판정이 가능해진다. $C$에는 반드시 **최악** 실행 시간을 넣는다.
- **RM**은 주기가 짧은 쪽에 높은 우선순위를 고정으로 준다. $U \le n(2^{1/n}-1)$이면 보장되고, 이 한계는 $\ln 2 \approx 0.693$으로 수렴한다. **충분조건이지 필요조건이 아니다.**
- **EDF**는 마감이 가까운 잡을 고른다. $D=T$인 주기 태스크에서 $U \le 1$이 필요충분이다. §4의 $U = 0.971$ 집합에서 RM은 놓치고 EDF는 지킨다 — 갈린 곳은 $t=5$의 선택 하나다.
- 스케줄러의 엔진은 우선순위 큐다([II-8](#/ii-8)). RM은 키가 주기라 힙이 정적이고, EDF는 키가 마감이라 잡마다 갱신된다.
- **우선순위 역전**은 낮은 태스크가 락을 쥔 채 중간 태스크에 선점당할 때 일어나고, 그 지연에는 상한이 없다. §5의 표에서 `M`이 커질수록 `H`의 응답시간이 그대로 따라 늘어난다.
- **우선순위 상속**은 그 지연을 임계 구역 길이로 묶는다. 경합이 없으면 비용이 0이고, 교착은 막지 못한다.

**다음 절**: [XI-6 상태 기계](#/xi-6) — 기한을 지키는 태스크 안쪽에서 "지금 무엇을 하는 중인가"를 어떤 자료구조로 들고 있을 것인가.
