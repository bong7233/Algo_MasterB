# VI-2 구간 스케줄링·회의실 배정

::: lead
같은 구간 목록에 무엇을 묻느냐에 따라 정렬 키와 자료구조가 어떻게 갈리는가.
:::

## 1. 문제

예약 시스템에 요청이 쌓인다. 각 요청은 `(시작, 끝)` 하나다. 같은 목록을 두고 운영이 묻는 질문은 세 가지고, **셋은 서로 다른 문제다.**

```text nolines
  requests : (1,10) (2,3) (4,5) (0,5) (5,10) ...

  Q1  "장비가 하나뿐이다. 최대 몇 건을 받을 수 있는가?"
  Q2  "전부 받으려면 장비가 몇 대 필요한가?"
  Q3  "작업마다 마감이 있다. 가장 늦은 지연을 얼마까지 줄일 수 있는가?"
```

Q1은 요청을 **버리는** 문제다. Q2는 전부 받되 **자원을 늘리는** 문제다. Q3은 전부 받고 자원도 하나인데 **순서만** 바꾸는 문제다. 입력 형태가 같아서 하나로 보이고, 그래서 Q1의 코드를 Q2에 그대로 갖다 쓰는 사고가 실제로 일어난다.

셋 다 그리디로 풀린다. 그런데 **정렬 키가 다르고, 두 개는 자료구조까지 다르다.**

| | 무엇을 최적화하는가 | 정렬 키 | 자료구조 |
|---|---|---|---|
| Q1 최대 개수 | 승인 건수 최대 | **끝** 오름차순 | 변수 하나 |
| Q2 최소 자원 | 자원 수 최소 | **시작** 오름차순 | **최소 힙** |
| Q3 최소 지연 | 최대 지연 최소 | **마감** 오름차순 | 변수 하나 |

Q1에서 시작 순으로 정렬하면 틀린 답이 나온다. Q2에서 끝 순으로 정렬하면 힙이 무의미해진다. ==구간 문제에서 정렬 키는 취향이 아니라 알고리즘 그 자체다.== 이 챕터는 세 질문을 차례로 풀되, 매번 **왜 그 키인가**를 [VI-1](#/vi-1)의 교환 논법으로 되짚는다.

## 2. 아이디어

### 2.1 Q1 — 정렬 키 세 후보와 두 개의 반례

"끝 이른 순"이 정답이라는 것은 [VI-1](#/vi-1)이 증명했다. 여기서는 나머지 둘이 **어떤 입력에서** 죽는지를 숫자로 확인한다. 반례를 손에 쥐고 있어야 시험장에서 키를 헷갈리지 않는다.

**후보 A — 시작이 이른 것부터.** 가장 자연스럽다. 먼저 온 요청을 먼저 받는 것이 공정해 보이기도 한다.

```text nolines
  case A :  (1,10)  (2,3)  (4,5)

  0    2    4    6    8   10
  |----|----|----|----|----|
  [========= (1,10) ========]
       [(2,3)]
            [(4,5)]
```

시작 순 정렬은 `(1,10)`을 먼저 본다. 담는다. 그다음 `(2,3)`은 겹치고, `(4,5)`도 겹친다. **답 1.** 끝 순 정렬은 `(2,3)`, `(4,5)`, `(1,10)` 순으로 보고 앞의 둘을 담는다. **답 2.**

무엇이 잘못됐는지가 그림에 그대로 있다. `(1,10)`은 **일찍 시작하지만 늦게 끝난다.** 자원을 오래 잡아먹는 요청을 먼저 승인하면 그 뒤가 통째로 죽는다. 남는 것은 시작 시각이 아니라 **끝난 시각**이다.

**후보 B — 짧은 것부터.** A의 반례를 보고 나면 "그럼 짧은 것부터"가 떠오른다. 자원을 적게 쓰는 것부터 담으니 더 많이 담을 것 같다.

```text nolines
  case B :  (0,5)  (4,6)  (5,10)

  0    2    4    6    8   10
  |----|----|----|----|----|
  [==== (0,5) ====]
            [(4,6)]
              [==== (5,10) ====]
```

가장 짧은 것은 길이 2인 `(4,6)`이다. 담는다. 그런데 `(4,6)`은 `(0,5)`와도 겹치고(4 < 5) `(5,10)`과도 겹친다(5 < 6). **답 1.** 끝 순 정렬은 `(0,5)`를 담고 `(4,6)`을 버린 뒤 `(5,10)`을 담는다. **답 2.**

짧은 구간이 **두 구간의 경계에 걸쳐 있으면** 하나를 담느라 둘을 죽인다. 길이는 이 문제가 묻는 값과 아무 상관이 없다.

**후보 C — 끝이 이른 것부터.** 두 반례 모두에서 2를 낸다. 그리고 [VI-1](#/vi-1)의 교환 논법이 모든 입력에서 최적임을 보증한다. **자원이 가장 일찍 풀리는 것을 고르면 남은 시간이 최대가 된다** — 이 한 문장이 정렬 키의 근거 전부다.

::: warn
후보 A와 B는 각각 **자기 반례에서만** 죽는다. case A에서 짧은 순은 2를 내고, case B에서 시작 순은 2를 낸다. 반례 하나로 두 키를 동시에 죽일 수 없다는 뜻이고, 그래서 "예제를 통과했다"가 키의 근거가 되지 못한다. 4절의 무작위 대조에서 이 사실이 숫자로 나온다.
:::

### 2.2 Q2 — 자원 개수는 겹침의 최댓값이다

전부 받되 장비를 몇 대 사야 하는가. 답부터 말하면 **어느 한 시점에 동시에 진행되는 요청 수의 최댓값**이고, 그 값이 필요조건인 동시에 충분조건이다.

필요한 것은 자명하다. 세 요청이 동시에 돌아가는 순간이 있으면 장비 두 대로는 불가능하다. 충분하다는 것은 구성으로 보인다 — **시작 시각 순으로 요청을 처리하면서, 이미 비어 있는 장비가 있으면 재사용하고 없으면 한 대를 더 산다.** 이때 새로 사는 순간은 "지금 시작하는 요청과 겹치는 요청이 이미 그 수만큼 돌고 있다"는 뜻이므로, 산 대수가 곧 겹침의 최댓값이다.

여기서 자료구조가 결정된다. 매 요청마다 필요한 정보는 **"가장 먼저 비는 장비가 언제 비는가"** 하나다. 전체를 정렬해 둘 수 없다 — 장비의 반납 시각이 요청을 처리할 때마다 바뀌기 때문이다. 스텝마다 최솟값 하나를 $O(\log n)$에 주는 자료구조가 **최소 힙**이다([II-8](#/ii-8)).

같은 답을 얻는 두 번째 길이 있다. 시작을 `+1`, 끝을 `-1`인 이벤트로 바꿔 시각 순으로 정렬하고 누적합의 최댓값을 본다. 이것이 **스위핑**이고 [VI-6](#/vi-6)에서 일반화한다. 두 방법은 같은 값을 다르게 세는 것뿐이다.

::: danger
스위핑에서 **같은 시각에 끝나는 이벤트와 시작하는 이벤트가 겹칠 때 순서**가 답을 바꾼다. `(1,5)`와 `(5,9)`는 겹치지 않으므로 장비 하나로 충분하다. 이벤트를 `(5, +1)`, `(5, -1)` 순으로 처리하면 순간 카운터가 2가 되어 답이 2로 나온다.

**끝(`-1`)을 먼저 처리해야 한다.** 튜플 `(시각, 델타)`를 그대로 오름차순 정렬하면 `-1 < +1`이라 자동으로 그렇게 된다. 이 정렬이 우연히 맞는 것에 기대지 말고, 구간이 반닫힘 `[s, e)`인지 닫힘 `[s, e]`인지를 지문에서 확인한 뒤 델타 부호를 정하라. 힙 쪽도 같은 문제가 `rooms[0] <= s`의 등호 하나에 걸려 있다.
:::

### 2.3 Q3 — 마감이 이른 것부터, 그리고 인접 교환

작업마다 소요 시간 `dur`과 마감 `due`가 있다. 기계는 하나고 한 번에 하나만, 중단 없이 처리한다. 작업이 끝난 시각이 마감을 넘긴 만큼이 **지연**이고, 목표는 **가장 큰 지연을 최소로** 만드는 것이다.

정답은 **마감 이른 순**이다. 소요 시간은 정렬에 쓰지 않는다 — 이것이 직관에 어긋나서 자주 틀린다. "짧은 것부터 처리하면 전체가 빨리 끝난다"는 다른 목적함수(평균 대기 시간)의 답이다.

증명은 교환 논법의 변형인 **인접 교환**이다. 어떤 최적 순서에 마감이 늦은 작업 $i$가 마감이 이른 작업 $j$보다 **바로 앞에** 있다고 하자. 둘을 맞바꾼다.

```text nolines
  before :  ... [ i ][ j ] ...      due(i) > due(j)
  after  :  ... [ j ][ i ] ...

  the pair ends at the same time T in both orders
  after : j ends earlier than before  -> lateness(j) can only drop
          i ends at T, lateness(i) = T - due(i) < T - due(j) = old lateness(j)
```

두 작업이 차지하는 시간 덩어리의 **끝 시각 $T$는 순서와 무관하다.** 바꾼 뒤 $j$는 더 일찍 끝나므로 $j$의 지연은 줄거나 같다. $i$는 $T$에 끝나는데, $i$의 마감이 $j$보다 늦으므로 $T - due(i)$는 바꾸기 전 $j$의 지연 $T - due(j)$보다 **작다.** 나머지 작업의 끝 시각은 하나도 변하지 않았다. 따라서 최대 지연은 늘지 않는다.

이런 **역전 쌍**(마감 늦은 것이 앞에 있는 쌍)이 하나도 없는 순서가 마감 오름차순이고, 역전 쌍을 하나씩 없애면서 최적성을 잃지 않으므로 마감 오름차순도 최적이다. ==인접한 것만 바꿔도 되는 이유는 인접 교환이 다른 작업의 끝 시각을 건드리지 않기 때문이다.==

::: note
쉬는 시간(idle)을 두는 것이 이득인 경우는 없다. 모든 작업이 언제든 시작 가능하므로, 쉬는 시간을 없애 앞으로 당기면 모든 작업의 끝 시각이 줄거나 같고 지연도 그렇다. 그래서 이 문제의 답은 **순서 하나로 결정된다.**
:::

## 3. 손으로 따라가기

Q2의 힙이 어떻게 움직이는지가 이 챕터에서 가장 눈에 안 보이는 부분이다. 관찰할 것은 **힙의 내용**(각 장비가 비는 시각)과 **재사용인지 신규인지**, 그리고 **힙 크기**(그것이 곧 답이다)다.

::: trace
입력: 강의 `(1,5) (2,4) (3,9) (6,8) (7,10)`. 시작 시각 오름차순으로 처리한다.

규칙은 두 줄이다. **힙이 비어 있지 않고 `힙의 최솟값 <= 시작`이면** 그 값을 빼고(장비 재사용) 새 끝 시각을 넣는다. **아니면** 그냥 넣는다(장비 추가).

| 스텝 | 강의 | 힙 최솟값 | 재사용? | 처리 후 힙 | 힙 크기 |
|---|---|---|---|---|---|
| 0 | (1,5) | — (빈 힙) | 신규 | [5] | 1 |
| 1 | (2,4) | 5 > 2 | 신규 | [4, 5] | 2 |
| 2 | (3,9) | 4 > 3 | 신규 | [4, 5, 9] | 3 |
| 3 | (6,8) | | | | |
| 4 | (7,10) | | | | |
:::

::: answer
| 스텝 | 강의 | 힙 최솟값 | 재사용? | 처리 후 힙 | 힙 크기 |
|---|---|---|---|---|---|
| 0 | (1,5) | — (빈 힙) | 신규 | [5] | 1 |
| 1 | (2,4) | 5 > 2 | 신규 | [4, 5] | 2 |
| 2 | (3,9) | 4 > 3 | 신규 | [4, 5, 9] | 3 |
| 3 | (6,8) | **4 ≤ 6** | **재사용** | [5, 8, 9] | 3 |
| 4 | (7,10) | **5 ≤ 7** | **재사용** | [8, 9, 10] | 3 |

**답은 3이다.** 힙 크기는 스텝 2에서 3이 된 뒤 한 번도 줄지 않는다 — 힙에서 빼는 것은 재사용할 때뿐이고 그때 곧바로 하나를 넣으므로, ==힙 크기는 늘거나 그대로이지 절대 줄지 않는다.== 그래서 마지막 힙 크기가 곧 최댓값이고, 따로 최댓값을 기록할 변수가 필요 없다.

스텝 3을 손으로 확인하라. 시각 6에 살아 있는 강의는 `(3,9)` 하나뿐인데 힙에는 세 개가 들어 있다. `[5, 8, 9]`의 5와 8은 **이미 끝난 강의의 흔적이 아니라 지금 비어 있는 장비의 반납 시각**이다. 힙은 "지금 몇 개가 돌고 있는가"를 세는 것이 아니라 "지금까지 몇 대를 샀는가"를 센다. 두 값이 다르다는 것이 이 알고리즘의 요점이다.

스텝 3에서 `4 ≤ 6`의 **등호**를 확인하라. 강의가 4에 끝나고 다음이 6에 시작하니 여유가 있지만, `(4,6)` 같은 딱 붙는 경우라면 등호가 답을 가른다. `<`로 쓰면 붙은 강의마다 장비를 한 대씩 더 사게 된다.
:::

## 4. 구현

### 4.1 Q1 — 세 정렬 키를 한 번에 비교한다

세 키를 각각 짜서 완전탐색과 대조한다. 반례 두 개에서의 값과, 무작위 500회에서 **각 키가 정답과 몇 번 일치하는지**를 함께 낸다.

::: dual
```python title="Q1 최대 개수 — 정렬 키 세 개를 완전탐색과 대조한다"
seed = 20240

def next_rand(m):
    global seed
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % m


def count_greedy(jobs, key):
    if key == "end":
        order = sorted(jobs, key=lambda job: job[1])          # 끝 이른 순
    elif key == "start":
        order = sorted(jobs, key=lambda job: job[0])          # 시작 이른 순
    else:
        order = sorted(jobs, key=lambda job: job[1] - job[0])  # 짧은 순
    chosen = []
    for s, e in order:
        ok = True
        for cs, ce in chosen:                                  # 이미 담은 것과 하나라도 겹치면 버린다
            if s < ce and cs < e:
                ok = False
                break
        if ok:
            chosen.append((s, e))
    return len(chosen)


def brute_best(jobs):
    n = len(jobs)
    best = 0
    for mask in range(1 << n):
        chosen = [jobs[i] for i in range(n) if (mask >> i) & 1]
        chosen.sort(key=lambda job: job[1])
        ok = True
        for i in range(1, len(chosen)):
            if chosen[i][0] < chosen[i - 1][1]:
                ok = False
                break
        if ok and len(chosen) > best:
            best = len(chosen)
    return best


case_a = [(1, 10), (2, 3), (4, 5)]
case_b = [(0, 5), (4, 6), (5, 10)]
for name, case in (("A", case_a), ("B", case_b)):
    print("case " + name + " : end = " + str(count_greedy(case, "end")) +
          ", start = " + str(count_greedy(case, "start")) +
          ", length = " + str(count_greedy(case, "length")) +
          ", brute = " + str(brute_best(case)))

hit = {"end": 0, "start": 0, "length": 0}
for t in range(500):
    n = 1 + next_rand(7)
    trial = []
    for i in range(n):
        s = next_rand(12)
        trial.append((s, s + 1 + next_rand(6)))
    best = brute_best(trial)
    for key in ("end", "start", "length"):
        if count_greedy(trial, key) == best:
            hit[key] += 1
print("random 500 : end = " + str(hit["end"]) +
      ", start = " + str(hit["start"]) +
      ", length = " + str(hit["length"]))
```
```cpp title="Q1 최대 개수 — 정렬 키 세 개를 완전탐색과 대조한다"
#include <algorithm>
#include <iostream>
#include <string>
#include <vector>
using namespace std;

using Job = pair<int, int>;
unsigned long long seed = 20240;

int next_rand(int m) {
    seed = (seed * 1103515245ULL + 12345ULL) % 2147483648ULL;
    return (int)(seed % (unsigned long long)m);
}

int count_greedy(vector<Job> jobs, string key) {
    vector<Job> order = jobs;
    if (key == "end")
        sort(order.begin(), order.end(),                       // 끝 이른 순
             [](Job a, Job b) { return a.second < b.second; });
    else if (key == "start")
        sort(order.begin(), order.end(),                       // 시작 이른 순
             [](Job a, Job b) { return a.first < b.first; });
    else
        sort(order.begin(), order.end(),                       // 짧은 순
             [](Job a, Job b) { return a.second - a.first < b.second - b.first; });
    vector<Job> chosen;
    for (auto [s, e] : order) {
        bool ok = true;
        for (auto [cs, ce] : chosen)                           // 이미 담은 것과 하나라도 겹치면 버린다
            if (s < ce && cs < e) {
                ok = false;
                break;
            }
        if (ok) chosen.push_back({s, e});
    }
    return (int)chosen.size();
}

int brute_best(const vector<Job>& jobs) {
    int n = (int)jobs.size();
    int best = 0;
    for (int mask = 0; mask < (1 << n); mask++) {
        vector<Job> chosen;
        for (int i = 0; i < n; i++)
            if ((mask >> i) & 1) chosen.push_back(jobs[i]);
        sort(chosen.begin(), chosen.end(), [](Job a, Job b) { return a.second < b.second; });
        bool ok = true;
        for (size_t i = 1; i < chosen.size(); i++)
            if (chosen[i].first < chosen[i - 1].second) {
                ok = false;
                break;
            }
        if (ok && (int)chosen.size() > best) best = (int)chosen.size();
    }
    return best;
}

int main() {
    vector<Job> case_a = {{1, 10}, {2, 3}, {4, 5}};
    vector<Job> case_b = {{0, 5}, {4, 6}, {5, 10}};
    vector<pair<string, vector<Job>>> cases = {{"A", case_a}, {"B", case_b}};
    for (auto [name, c] : cases)
        cout << "case " << name << " : end = " << count_greedy(c, "end")
             << ", start = " << count_greedy(c, "start")
             << ", length = " << count_greedy(c, "length")
             << ", brute = " << brute_best(c) << "\n";

    int hit_end = 0, hit_start = 0, hit_length = 0;
    for (int t = 0; t < 500; t++) {
        int n = 1 + next_rand(7);
        vector<Job> trial;
        for (int i = 0; i < n; i++) {
            int s = next_rand(12);
            trial.push_back({s, s + 1 + next_rand(6)});
        }
        int best = brute_best(trial);
        if (count_greedy(trial, "end") == best) hit_end++;
        if (count_greedy(trial, "start") == best) hit_start++;
        if (count_greedy(trial, "length") == best) hit_length++;
    }
    cout << "random 500 : end = " << hit_end << ", start = " << hit_start
         << ", length = " << hit_length << "\n";
    return 0;
}
```
:::

```console
case A : end = 2, start = 1, length = 2, brute = 2
case B : end = 2, start = 2, length = 1, brute = 2
random 500 : end = 500, start = 441, length = 492
```

**복잡도:** 여기 실린 `count_greedy`는 시간 $O(n^2)$ — 담을 때마다 이미 담은 것 전부와 겹침을 검사하기 때문이다. 세 키를 **공정하게** 비교하려고 일부러 이렇게 짰다. 끝 순 정렬에서는 마지막에 담은 것의 끝 시각 하나만 비교하면 충분하므로 $O(n \log n)$로 떨어진다 — 정렬이 지배하고 이후에는 각 구간을 한 번씩만 본다. 공간은 $O(n)$.

| 언어 차이 | Python | C++ |
|---|---|---|
| 세 갈래 정렬 | `key=` 에 다른 람다를 넘긴다 | 세 번의 `sort` 호출. 비교자는 값 두 개를 받는다 |
| 문자열 비교 | `key == "end"` | `key == "end"` — `std::string`이면 같다. `char*`로 쓰면 **포인터 비교**가 되어 조용히 틀린다 |
| 구조 분해 | `for cs, ce in chosen` | `for (auto [cs, ce] : chosen)` — C++17 구조적 바인딩 |

숫자 세 개가 이 절의 결론이다. **끝 순은 500/500, 시작 순은 441/500, 짧은 순은 492/500.** 짧은 순이 특히 위험하다 — 98%를 맞힌다. 손으로 만든 예제 몇 개로는 절대 안 걸린다. ==정답률이 높은 틀린 알고리즘이 정답률이 낮은 틀린 알고리즘보다 나쁘다.==

세 숫자는 난수 씨앗 하나에서 나온 값이다. **씨앗 하나의 결과를 비율이라고 부르면 그것은 실측이 아니라 일화다.** 씨앗을 20개로 늘려 같은 실험을 반복하면 끝 순은 예외 없이 500/500이고, 시작 순은 425\~450, 짧은 순은 488\~495에 머문다(평균 87.4%와 98.3%, 측정 스크립트 `tools/bench/greedy_sortkey_verify.py`). 끝 순만 씨앗과 무관하게 완전한 것은 우연이 아니라 [VI-1](#/vi-1)의 교환 논법이 그것을 보증하기 때문이다. **나머지 둘의 정답률은 입력 분포가 정하고, 증명이 있는 쪽만 분포와 무관하다.**

### 4.2 Q2 — 최소 힙과 스위핑, 그리고 정직한 대조

같은 값을 세는 세 가지 방법을 나란히 두고 서로를 검증한다.

::: dual
```python title="Q2 최소 자원 개수 — 힙 · 스위핑 · 완전탐색"
import heapq

seed = 31337

def next_rand(m):
    global seed
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % m


def min_rooms_heap(lectures):
    lectures = sorted(lectures)                     # 시작 시각 오름차순
    rooms = []                                      # 각 방이 비는 시각(= 끝 시각)의 최소 힙
    for s, e in lectures:
        if rooms and rooms[0] <= s:                 # 가장 먼저 비는 방이 이미 비었으면 재사용
            heapq.heappop(rooms)
        heapq.heappush(rooms, e)                    # 그 방(또는 새 방)의 반납 시각을 갱신
    return len(rooms)


def min_rooms_sweep(lectures):
    events = []
    for s, e in lectures:
        events.append((s, 1))                       # 시작 = +1
        events.append((e, -1))                      # 끝 = -1
    events.sort()                                   # 같은 시각이면 -1 이 먼저 — 붙은 강의는 방을 물려받는다
    cur, best = 0, 0
    for t, d in events:
        cur += d
        if cur > best:
            best = cur
    return best


def brute_overlap(lectures):
    best = 0
    for s, e in lectures:                           # 겹침의 최댓값은 어떤 시작 시각에서 나온다
        cnt = 0
        for s2, e2 in lectures:
            if s2 <= s < e2:
                cnt += 1
        if cnt > best:
            best = cnt
    return best


lectures = [(1, 5), (2, 4), (3, 9), (6, 8), (7, 10)]
print("heap = " + str(min_rooms_heap(lectures)) +
      ", sweep = " + str(min_rooms_sweep(lectures)) +
      ", brute = " + str(brute_overlap(lectures)))

same = 0
for t in range(500):
    n = 1 + next_rand(9)
    trial = []
    for i in range(n):
        s = next_rand(15)
        trial.append((s, s + 1 + next_rand(7)))
    if min_rooms_heap(trial) == min_rooms_sweep(trial) == brute_overlap(trial):
        same += 1
print("random 500 : all three agree = " + str(same))
```
```cpp title="Q2 최소 자원 개수 — 힙 · 스위핑 · 완전탐색"
#include <algorithm>
#include <iostream>
#include <queue>
#include <vector>
using namespace std;

using Job = pair<int, int>;
unsigned long long seed = 31337;

int next_rand(int m) {
    seed = (seed * 1103515245ULL + 12345ULL) % 2147483648ULL;
    return (int)(seed % (unsigned long long)m);
}

int min_rooms_heap(vector<Job> lectures) {
    sort(lectures.begin(), lectures.end());          // 시작 시각 오름차순
    priority_queue<int, vector<int>, greater<int>> rooms;  // 최소 힙 — 기본이 최대 힙이라 명시한다
    for (auto [s, e] : lectures) {
        if (!rooms.empty() && rooms.top() <= s)      // 가장 먼저 비는 방이 이미 비었으면 재사용
            rooms.pop();
        rooms.push(e);                               // 그 방(또는 새 방)의 반납 시각을 갱신
    }
    return (int)rooms.size();
}

int min_rooms_sweep(const vector<Job>& lectures) {
    vector<Job> events;
    for (auto [s, e] : lectures) {
        events.push_back({s, 1});                    // 시작 = +1
        events.push_back({e, -1});                   // 끝 = -1
    }
    sort(events.begin(), events.end());              // 같은 시각이면 -1 이 먼저 — 붙은 강의는 방을 물려받는다
    int cur = 0, best = 0;
    for (auto [t, d] : events) {
        cur += d;
        if (cur > best) best = cur;
    }
    return best;
}

int brute_overlap(const vector<Job>& lectures) {
    int best = 0;
    for (auto [s, e] : lectures) {                   // 겹침의 최댓값은 어떤 시작 시각에서 나온다
        int cnt = 0;
        for (auto [s2, e2] : lectures)
            if (s2 <= s && s < e2) cnt++;
        if (cnt > best) best = cnt;
    }
    return best;
}

int main() {
    vector<Job> lectures = {{1, 5}, {2, 4}, {3, 9}, {6, 8}, {7, 10}};
    cout << "heap = " << min_rooms_heap(lectures)
         << ", sweep = " << min_rooms_sweep(lectures)
         << ", brute = " << brute_overlap(lectures) << "\n";

    int same = 0;
    for (int t = 0; t < 500; t++) {
        int n = 1 + next_rand(9);
        vector<Job> trial;
        for (int i = 0; i < n; i++) {
            int s = next_rand(15);
            trial.push_back({s, s + 1 + next_rand(7)});
        }
        int a = min_rooms_heap(trial), b = min_rooms_sweep(trial), c = brute_overlap(trial);
        if (a == b && b == c) same++;
    }
    cout << "random 500 : all three agree = " << same << "\n";
    return 0;
}
```
:::

```console
heap = 3, sweep = 3, brute = 3
random 500 : all three agree = 500
```

**복잡도:** 힙 쪽은 시간 $O(n \log n)$ — 정렬 $O(n \log n)$에, 강의마다 push 한 번과 pop 최대 한 번이 붙고 각각 $O(\log n)$이므로 힙 연산 전체가 $O(n \log n)$이다. 공간 $O(n)$ — 힙에 최대 $n$개. 스위핑도 시간 $O(n \log n)$ — 이벤트가 $2n$개이고 정렬이 지배하며 이후 훑기는 $O(n)$이다. 완전탐색은 시간 $O(n^2)$ — 시작 시각마다 전체를 센다. **세 방법의 자릿수가 같아서 대조 비용이 거의 공짜다.**

| 언어 차이 | Python | C++ |
|---|---|---|
| 힙 방향 | `heapq`는 **최소 힙 고정** | `priority_queue`는 **최대 힙 기본**. `greater<int>`를 세 번째 인자로 명시해야 최소 힙 |
| 힙 최솟값 읽기 | `rooms[0]` — 리스트 첨자로 그냥 읽는다 | `rooms.top()` — 읽기와 제거가 **두 단계**(`top` 후 `pop`) |
| 힙 크기 | `len(rooms)` | `rooms.size()` — 부호 없는 타입이라 `int` 비교 시 경고가 난다. 캐스팅하라 |
| 연쇄 비교 | `a == b == c`가 그대로 동작한다 | `a == b == c`는 `(a == b) == c`로 읽혀 **조용히 틀린다.** `a == b && b == c`로 써야 한다 |

세 방법이 500번 모두 같은 값을 냈다. 특히 **완전탐색이 "겹침의 최댓값은 어떤 구간의 시작 시각에서 발생한다"는 사실 하나에만 기대고 있다**는 점이 중요하다. 힙도 스위핑도 안 쓰는 이 정직한 정의가 나머지 둘을 검증한다.

### 4.3 Q3 — 마감 순 정렬을 순열 전수와 대조한다

인접 교환 증명이 맞다면 마감 오름차순이 **모든 순서 중 최소**여야 한다. 순서를 전부 만들어 확인한다.

::: dual
```python title="Q3 최소 지연 — 마감 순 그리디를 순열 전수와 대조한다"
from itertools import permutations

seed = 4242

def next_rand(m):
    global seed
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % m


def max_lateness(order):
    t, worst = 0, 0
    for dur, due in order:
        t += dur                                    # 쉬는 시간을 두는 것은 언제나 손해다
        if t - due > worst:
            worst = t - due                         # 지연 = 끝난 시각 - 마감. 음수는 0으로 본다
    return worst


def greedy_edf(jobs):
    return max_lateness(sorted(jobs, key=lambda job: job[1]))   # 마감 이른 순


def brute_lateness(jobs):
    best = -1
    for order in permutations(jobs):                # 순서 전수 — 정답의 정의 그대로
        cur = max_lateness(order)
        if best < 0 or cur < best:
            best = cur
    return best


jobs = [(3, 4), (2, 3), (1, 10)]
print("edf = " + str(greedy_edf(jobs)) + ", brute = " + str(brute_lateness(jobs)))

same = 0
for t in range(300):
    n = 1 + next_rand(6)
    trial = []
    for i in range(n):
        trial.append((1 + next_rand(6), 1 + next_rand(14)))
    if greedy_edf(trial) == brute_lateness(trial):
        same += 1
print("random 300 : edf == brute = " + str(same))
```
```cpp title="Q3 최소 지연 — 마감 순 그리디를 순열 전수와 대조한다"
#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

using Job = pair<int, int>;
unsigned long long seed = 4242;

int next_rand(int m) {
    seed = (seed * 1103515245ULL + 12345ULL) % 2147483648ULL;
    return (int)(seed % (unsigned long long)m);
}

int max_lateness(const vector<Job>& order) {
    int t = 0, worst = 0;
    for (auto [dur, due] : order) {
        t += dur;                                   // 쉬는 시간을 두는 것은 언제나 손해다
        if (t - due > worst) worst = t - due;       // 지연 = 끝난 시각 - 마감. 음수는 0으로 본다
    }
    return worst;
}

int greedy_edf(vector<Job> jobs) {
    sort(jobs.begin(), jobs.end(),                  // 마감 이른 순
         [](Job a, Job b) { return a.second < b.second; });
    return max_lateness(jobs);
}

int brute_lateness(vector<Job> jobs) {
    sort(jobs.begin(), jobs.end());                 // next_permutation 은 정렬된 상태에서 시작해야 전부 돈다
    int best = -1;
    do {                                            // 순서 전수 — 정답의 정의 그대로
        int cur = max_lateness(jobs);
        if (best < 0 || cur < best) best = cur;
    } while (next_permutation(jobs.begin(), jobs.end()));
    return best;
}

int main() {
    vector<Job> jobs = {{3, 4}, {2, 3}, {1, 10}};
    cout << "edf = " << greedy_edf(jobs) << ", brute = " << brute_lateness(jobs) << "\n";

    int same = 0;
    for (int t = 0; t < 300; t++) {
        int n = 1 + next_rand(6);
        vector<Job> trial;
        for (int i = 0; i < n; i++) trial.push_back({1 + next_rand(6), 1 + next_rand(14)});
        if (greedy_edf(trial) == brute_lateness(trial)) same++;
    }
    cout << "random 300 : edf == brute = " << same << "\n";
    return 0;
}
```
:::

```console
edf = 1, brute = 1
random 300 : edf == brute = 300
```

**복잡도:** 그리디는 시간 $O(n \log n)$ — 정렬 한 번에 순서대로 한 번 훑기. 순열 전수는 시간 $O(n! \cdot n)$ — 순서가 $n!$개이고 각각 $n$개 작업의 끝 시각을 누적한다. $n = 6$에서 720가지라 순식간이고, $n = 12$면 4억 8천만 가지라 손댈 수 없다. **대조 코드에 쓸 수 있는 $n$의 상한을 알고 있어야 한다**([0-9](#/0-9)).

| 언어 차이 | Python | C++ |
|---|---|---|
| 순열 생성 | `itertools.permutations(jobs)` — 원본 순서와 무관하게 $n!$개를 전부 낸다 | `next_permutation` — **정렬된 상태에서 시작**해야 전부 돈다. 중복 원소가 있으면 서로 다른 순열만 낸다 |
| 반복 형태 | `for order in permutations(...)` | `do { ... } while (next_permutation(...))` — 첫 순열을 먼저 처리해야 하므로 `do-while` |

::: pitfall
- **Q1에 Q2의 정렬 키를 쓴다.** 시작 순 정렬은 무작위 500회에서 441회만 맞는다. 두 문제는 지문이 두 줄 다를 뿐이라 코드를 재사용하다 섞인다.
- **Q2에서 "지금 겹치는 개수"와 "지금까지 산 장비 수"를 혼동한다.** 힙 크기는 후자다. 손추적의 스텝 3이 그 차이를 보여 준다.
- **경계에서 등호를 틀린다.** `rooms[0] <= s`의 등호 하나가 붙은 회의의 방 공유를 결정한다. 스위핑에서는 같은 시각의 `-1`이 `+1`보다 먼저 처리되어야 같은 답이 나온다.
- **Q3에서 소요 시간으로 정렬한다.** 짧은 것부터는 평균 대기 시간을 줄이는 답이지 최대 지연을 줄이는 답이 아니다. 목적함수가 바뀌면 정렬 키가 바뀐다.
- **Q3에서 지연을 음수까지 누적한다.** 마감보다 일찍 끝난 것은 지연 0이지 음수가 아니다. `max(0, ...)`를 빼먹으면 여유가 큰 작업 하나가 답을 음수로 끌어내린다.
:::

## 5. 어디에 쓰이는가

**회의실·장비 예약 시스템**이 Q2 그대로다. 예약 요청을 전부 수락하려면 자원이 몇 개 필요한가를 계산하는 것이 용량 산정이고, 반대로 자원 수가 고정이면 "겹침이 자원 수를 넘는 순간"을 찾아 거절하거나 대기열로 보낸다. 실무 코드에서 이 판정을 `for` 이중 루프로 짜 놓은 경우가 흔한데, 요청이 수만 건이 되면 $O(n^2)$이 그대로 응답 시간이 된다. 이벤트 스위핑으로 바꾸면 정렬 한 번이다.

**CPU와 로봇의 작업 스케줄링**에서 Q3의 마감 순 정렬은 **EDF(Earliest Deadline First)** 라는 이름으로 실시간 시스템의 표준 정책 중 하나다. 주기적 태스크의 마감(다음 주기 시작)이 이른 것부터 CPU를 준다. 여기서 다룬 최대 지연 최소화가 그 정책의 근거이고, 우선순위 큐가 그 구현이다([XI-5](#/xi-5)). 로봇 작업 오더도 같다 — 마감이 붙은 이송 작업 목록에서 어떤 것을 먼저 보낼지가 이 문제다.

**할당과 스케줄링이 갈리는 지점**도 짚어 둘 만하다. Q2는 "장비 몇 대"만 세지만, **어느 요청을 어느 장비에 붙일지**까지 정해야 하면 문제가 달라진다. 장비마다 능력이나 비용이 다르면 그리디가 무너지고 할당 문제로 간다([V-11](#/v-11)). 힙 풀이가 그대로 배정표를 주는 것은 **모든 장비가 동일하다**는 가정 덕분이다.

::: interview
**"예약이 겹치는지 검사하는 API를 만들어야 합니다. 어떻게 하겠습니까?"**

먼저 되묻는다. **"겹침 여부만 알면 됩니까, 최대 동시 개수가 필요합니까, 아니면 최대한 많이 수락해야 합니까?"** 세 질문에 세 알고리즘이 붙는다는 것을 아는 것이 답의 절반이다.

그다음은 자료구조다. 요청이 한 번에 다 주어지면 정렬 후 스위핑 $O(n \log n)$이다. 요청이 하나씩 들어오고 매번 판정해야 하면 정렬을 다시 할 수 없으므로 구간 트리나 정렬 유지 자료구조가 필요하다([II-9](#/ii-9)). **"전부 주어진 뒤 한 번"과 "들어올 때마다"의 차이가 정렬과 동적 자료구조를 가른다**([I-5](#/i-5)).

경계 조건을 먼저 말하면 신뢰가 붙는다. "끝나는 시각과 시작하는 시각이 같으면 겹치는 것으로 볼지 정해야 합니다. 반닫힘 구간 `[s, e)`로 정의하면 판정이 `s1 < e2 && s2 < e1` 한 줄로 끝납니다."
:::

## 6. 이 유형을 알아보는 법

::: classify
- 신호어: "회의실", "강의실", "예약", "겹치지 않게", "최대 몇 개", "몇 개가 필요한가" + 입력이 `(시작, 끝)` 쌍의 목록
- 제약조건: $N \le 10^5\!\sim\!10^6$이라 정렬 $O(n \log n)$이 상한이다. 시각 값의 범위가 커도(최대 $10^9$) 값 자체를 배열 인덱스로 쓰지 않으므로 무관하다. 범위가 작으면 좌표별 카운팅도 되지만 그때는 [VI-4](#/vi-4)·[VI-5](#/vi-5)
- 혼동 주의: **묻는 것이 "최대 개수"면 끝 순 정렬 + 변수 하나**, **"자원 개수"면 시작 순 정렬 + 최소 힙**([II-8](#/ii-8)), **"최대 지연 최소화"면 마감 순 정렬**이다. 구간에 가치가 붙어 "가치 합 최대"가 되면 그리디가 깨지고 구간 DP다([VIII-7](#/viii-7)). 이벤트를 한 방향으로 훑는 일반형은 [VI-6](#/vi-6)
- 반례 함정: **끝나는 시각이 같은 구간이 여럿 있는 입력**, **시작과 끝이 딱 붙는 구간**(`(1,5)`와 `(5,9)`), **한 구간이 다른 구간을 통째로 덮는 입력**(`(1,10)`이 `(2,3)`을 덮는다). 셋 다 등호 하나로 답이 갈린다
:::

## 연습

::: quiz
세 문제가 같은 입력 형태에 서로 다른 질문을 한다. **정렬 키와 자료구조를 먼저 정한 뒤에 코드를 열어라.**

**1. 백준 1931 회의실 배정 (실버 1)** — https://www.acmicpc.net/problem/1931
- 지문: 회의 N개의 시작·끝 시각이 주어진다. 회의실 하나로 열 수 있는 회의의 최대 개수. `N ≤ 100,000`.
- 3단 사고: 신호는 "겹치지 않게" + "최대 개수". 상태는 "마지막으로 승인한 회의의 끝 시각" 하나뿐이다. 자료구조는 정렬된 배열과 변수 하나. **끝 시각이 같은 회의가 여럿일 때 시작 시각으로 어떻게 2차 정렬해야 하는지**를 확인하라 — 시작 == 끝인 길이 0짜리 회의가 입력에 들어 있다.

**2. 백준 11000 강의실 배정 (골드 5)** — https://www.acmicpc.net/problem/11000
- 지문: 수업 N개를 전부 열려면 강의실이 최소 몇 개 필요한가. `N ≤ 200,000`.
- 3단 사고: 신호는 "전부"와 "최소 개수" — 1931과 정반대로 **버리는 것이 없다.** 상태는 "지금 쓰고 있는 강의실들의 반납 시각 집합"이고, 매 스텝 필요한 것은 그중 최솟값 하나다. 그래서 자료구조가 최소 힙이다. 스위핑으로 풀어 두 답이 같은지 대조해 보라.

**3. 백준 2170 선 긋기 (골드 5)** — https://www.acmicpc.net/problem/2170
- 지문: 직선 위에 선분을 여러 번 긋는다. 겹친 부분은 한 번만 센다. 그려진 선의 총 길이. `N ≤ 1,000,000`, 좌표는 절댓값 $10^9$ 이하.
- 3단 사고: 신호는 "겹친 부분은 한 번만" — 개수가 아니라 **길이의 합집합**을 묻는다. 상태는 "지금 이어지고 있는 덩어리의 시작과 끝"이다. 정렬 키가 **시작** 오름차순인 이유를 말하라 — 끝 순으로 정렬하면 덩어리가 이어지는지를 판정할 수 없다. 좌표 범위 때문에 C++이면 누적 길이에 `long long`이 필요하다.
:::

## 요약

- 같은 `(시작, 끝)` 목록에 세 가지 질문이 붙고, **셋은 정렬 키가 다른 다른 문제**다. 최대 개수는 끝 순, 최소 자원은 시작 순 + 최소 힙, 최소 지연은 마감 순이다.
- Q1에서 **시작 순은 `(1,10) (2,3) (4,5)`에서 1을 내고 정답은 2**, **짧은 순은 `(0,5) (4,6) (5,10)`에서 1을 내고 정답은 2**다. 무작위 500회 정답률은 끝 순 500, 시작 순 441, 짧은 순 492다.
- **정답률 98%짜리 틀린 알고리즘이 가장 위험하다.** 손으로 만든 예제로는 걸리지 않는다.
- Q2의 답은 **어느 시점의 최대 동시 진행 수**다. 힙 크기는 "지금 겹치는 개수"가 아니라 "지금까지 산 자원 수"이고, 한 번 늘면 줄지 않으므로 마지막 크기가 곧 답이다.
- Q3의 근거는 **인접 교환**이다. 이웃한 두 작업을 맞바꿔도 그 덩어리의 끝 시각이 변하지 않으므로 역전 쌍을 하나씩 없앨 수 있고, 역전 쌍이 없는 순서가 마감 오름차순이다.
- 경계는 전부 **등호 하나**에 걸려 있다. `rooms[0] <= s`, 스위핑에서 `-1`을 `+1`보다 먼저 — 반닫힘 구간인지 닫힘 구간인지를 지문에서 먼저 확정하라.
- 실무에서는 예약 시스템의 용량 산정이 Q2 그대로이고, Q3의 마감 순 정렬은 실시간 스케줄링의 EDF다.

**다음 절**: [VI-3 투 포인터와 슬라이딩 윈도우](#/vi-3) — 정렬해 둔 배열 위를 두 포인터가 훑는다. 포인터가 한 번도 되돌아가지 않아도 되는 조건이 무엇이고, 그것이 왜 이중 루프를 $O(n)$으로 접는지를 본다.
