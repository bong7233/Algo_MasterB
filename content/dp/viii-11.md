# VIII-11 DP 상태 정의 실패 사례집

::: lead
상태가 부족하면 코드가 아니라 답이 틀린다. 그리고 그 답은 예제에서 맞는다.
:::

## 1. 문제

DP에서 틀리는 자리는 정해져 있다. [VIII-1](#/viii-1)의 네 칸 중 **첫 칸**이다. 점화식·초기값·계산 순서는 상태가 정해지면 대체로 따라 나오고, 그 셋에서 난 실수는 값이 눈에 띄게 어긋나서 금방 잡힌다. 상태가 부족한 코드는 다르다. **잘 돌고, 예제를 통과하고, 대부분의 입력에서 맞는 답을 낸다.**

부족한 상태가 내는 증상은 세 가지뿐이다.

| 증상 | 무슨 일이 벌어지는가 | 사례 |
|---|---|---|
| ① 한 칸에 서로 다른 처지가 겹친다 | 값 하나가 여러 처지를 대표하는데 그 대표가 앞으로도 최선이라는 보장이 없다 | 사례 2, 사례 5 |
| ② 나중 결정이 이전 결정을 무효로 만든다 | 이미 쓴 자원을 다시 쓰거나, 이미 어긴 규칙을 또 어긴다 | 사례 1, 사례 3 |
| ③ 답이 루프 순서에 따라 달라진다 | 규칙이 상태가 아니라 계산 순서에 얹혀 있고, 어느 쪽이 의도인지 코드에 안 적혀 있다 | 사례 4 |

이 챕터는 [I-5 오분류 사례집](#/i-5)과 같은 형식을 쓴다. 사례마다 네 단계다.

**① 지문** — 실제 문제의 문장으로. **② 왜 그 상태가 자연스러운가** — 그 판단을 변호한다. **③ 반례** — 손으로 검산되는 크기로, 숫자를 끝까지. **④ 무엇을 상태에 더했어야 했는가.**

두 번째 단계를 진지하게 쓰는 이유는 I-5와 같다. **틀린 상태를 조롱하면 같은 상태를 다시 고른다.**

::: note
본문의 모든 숫자는 `tools/bench/viii11_bad_states.py`가 한 번에 출력한다. 다섯 사례 각각에 대해 반례의 값과, 무작위 500건에서 **부족한 상태가 실제로 틀린 횟수**를 함께 찍는다. 반례는 주장이 아니라 계산이다.
:::

## 2. 사례 1 — 규칙을 상태에 안 새긴다

### 지문

> 계단은 한 번에 한 계단 또는 두 계단씩 오를 수 있다. **연속된 세 개의 계단을 모두 밟아서는 안 된다.** 마지막 계단은 반드시 밟아야 한다. 각 계단에 점수가 적혀 있을 때 얻을 수 있는 총점의 최댓값을 구하라.

### 왜 그 상태가 자연스러운가

첫째, **"$i$번 계단까지의 최대 점수"는 이 문제에서 묻는 것 그대로다.** 문제가 최댓값을 물으니 상태도 최댓값이어야 할 것 같다.

둘째, **점화식이 즉시 써진다.** $i$에 오려면 $i-1$이나 $i-2$에서 왔다.

$$dp[i] = a[i] + \max(dp[i-1],\; dp[i-2])$$

셋째, **연속 세 칸 금지가 이 식에 이미 반영된 것처럼 보인다.** 한 번에 두 칸까지만 오르므로 $i-2$에서 오는 선택지가 있고, 그 선택지가 "건너뛰기"를 표현한다고 읽힌다. 실제로 $i-2$에서 오는 항이 없으면 연속 금지를 지킬 방법이 아예 없으니 절반은 맞는 생각이다.

무너지는 곳은 한 군데다. **$dp[i-1]$은 "$i-1$까지 최대"일 뿐, $i-1$에 어떻게 도착했는지를 모른다.** $i-2$와 $i-1$을 연달아 밟고 왔는지 아닌지가 지워져 있고, 그 정보 없이는 "지금 $i$를 밟아도 되는가"를 판정할 수 없다.

### 손으로 따라가기

::: trace
계단 점수 `[10, 20, 15, 25]`. **틀린 점화식** $dp[i] = a[i] + \max(dp[i-1], dp[i-2])$를 그대로 채운다. `어디서` 열에는 최댓값을 준 쪽의 번호를 적는다.

| i | a[i] | dp[i-1] | dp[i-2] | dp[i] | 어디서 |
|---|---|---|---|---|---|
| 0 | 10 | — | — | 10 | 시작 |
| 1 | 20 | 10 | — | 30 | 0 |
| 2 | 15 | | | | |
| 3 | 25 | | | | |

세 가지를 확인하라.

- [ ] `어디서` 열을 3에서 거꾸로 따라가면 어떤 계단을 밟는가. 그 열이 "연속 세 칸 금지"를 지키는가
- [ ] 규칙을 지키는 조합을 손으로 전부 세어라. 계단이 4개뿐이라 다섯 가지도 안 된다. 진짜 최댓값은 얼마인가
- [ ] 표의 **어느 칸에서 처음** 규칙을 어긴 값이 들어왔는가
:::

::: answer
| i | a[i] | dp[i-1] | dp[i-2] | dp[i] | 어디서 |
|---|---|---|---|---|---|
| 0 | 10 | — | — | 10 | 시작 |
| 1 | 20 | 10 | — | 30 | 0 |
| 2 | 15 | 30 | 10 | 45 | 1 |
| 3 | 25 | 45 | 30 | 70 | 2 |

첫 번째. 3 → 2 → 1 → 0이므로 **네 계단을 전부 밟는다.** 연속 세 칸 금지를 두 번 어겼다. 표가 낸 70은 애초에 존재할 수 없는 점수다.

두 번째. 마지막 칸 3을 반드시 밟고, 간격이 2를 넘지 않고, 연속 세 칸이 없는 조합은 넷뿐이다.

| 밟는 계단 | 점수 | 규칙 |
|---|---|---|
| 0, 1, 3 | 10+20+25 = **55** | 통과 |
| 0, 2, 3 | 10+15+25 = 50 | 통과 |
| 1, 3 | 20+25 = 45 | 통과 |
| 2, 3 | 15+25 = 40 | 통과 |
| 0, 1, 2, 3 | 70 | 연속 세 칸 |

**정답은 55다.** 표는 70을 냈다.

세 번째. 위반은 $dp[3]$이 아니라 **$dp[2] = 45$에서 이미 들어왔다.** 45는 0, 1, 2를 다 밟은 값이고 그 자체가 불법이다. $dp[2]$를 채울 때 $dp[1] = 30$을 읽었는데, 그 30이 "0과 1을 **연달아** 밟은 값"이라는 사실이 어디에도 남아 있지 않았다. ==상태에 없는 정보는 다음 칸에서 복원되지 않는다.==
:::

### 무엇을 상태에 더했어야 했는가

**"지금 계단이 연속으로 몇 번째인가."** 값이 1 또는 2뿐이라 축 하나가 늘고 상태 수는 두 배가 된다.

$dp[i][1]$ = $i$를 밟았고 **직전 칸은 건너뛰었다.** $dp[i][2]$ = $i$를 밟았고 **직전 칸도 밟았다.**

$$dp[i][1] = a[i] + \max(dp[i-2][1],\, dp[i-2][2]), \qquad dp[i][2] = a[i] + dp[i-1][1]$$

두 번째 식의 오른쪽에 $dp[i-1][2]$가 없다는 것이 규칙 그 자체다. 직전 칸이 이미 연속 두 번째였다면 $i$를 밟는 순간 세 칸이 된다.

::: dual
```python title="계단 오르기 — 부족한 상태와 축을 하나 더한 상태"
from itertools import product

A = [10, 20, 15, 25]
NEG = -10 ** 9


def bad(a):
    """dp[i] = i 번 계단까지의 최대 점수. 연속으로 몇 개째인지는 기억하지 않는다."""
    n = len(a)
    dp = [0] * n
    frm = [-1] * n
    dp[0] = a[0]
    dp[1] = a[1] + dp[0]
    frm[1] = 0
    for i in range(2, n):
        if dp[i - 1] >= dp[i - 2]:
            dp[i], frm[i] = a[i] + dp[i - 1], i - 1
        else:
            dp[i], frm[i] = a[i] + dp[i - 2], i - 2
    out, i = [], n - 1
    while i != -1:
        out.append(i)
        i = frm[i]
    out.reverse()
    return dp[n - 1], out


def good(a):
    """dp[i][r] = i 번을 밟고 그것이 연속 r 번째일 때의 최대 점수. r 은 1 또는 2."""
    n = len(a)
    dp = [[NEG, NEG, NEG] for _ in range(n)]
    pi = [[-1, -1, -1] for _ in range(n)]      # 직전 계단 번호
    pr = [[0, 0, 0] for _ in range(n)]         # 그때의 연속 횟수
    dp[0][1] = a[0]
    dp[1][1] = a[1]                            # 0 번을 건너뛰고 1 번을 밟는다
    dp[1][2] = a[1] + dp[0][1]
    pi[1][2], pr[1][2] = 0, 1
    for i in range(2, n):
        r0 = 1 if dp[i - 2][1] >= dp[i - 2][2] else 2
        dp[i][1] = a[i] + dp[i - 2][r0]        # 직전 칸을 건너뛰었으니 연속 1 번째
        pi[i][1], pr[i][1] = i - 2, r0
        dp[i][2] = a[i] + dp[i - 1][1]         # 직전 칸을 밟았으니 그쪽이 연속 1 번째여야 한다
        pi[i][2], pr[i][2] = i - 1, 1
    r = 1 if dp[n - 1][1] >= dp[n - 1][2] else 2
    out, i = [], n - 1
    while i != -1:
        out.append(i)
        i, r = pi[i][r], pr[i][r]
    out.reverse()
    return max(dp[n - 1][1], dp[n - 1][2]), out


def brute(a):
    """마지막 계단 필수, 한 번에 1~2칸, 연속 3칸 금지. 전수 조사."""
    n = len(a)
    best, bpath = NEG, []
    for take in product((0, 1), repeat=n):
        idx = [i for i, t in enumerate(take) if t]
        if not idx or idx[-1] != n - 1 or idx[0] > 1:
            continue                           # 마지막은 필수, 첫 두 칸을 다 건너뛰면 못 간다
        ok = all(idx[j + 1] - idx[j] <= 2 for j in range(len(idx) - 1))
        for j in range(len(idx) - 2):
            if idx[j + 2] - idx[j] == 2:       # 연속 세 칸
                ok = False
        if ok and sum(a[i] for i in idx) > best:
            best, bpath = sum(a[i] for i in idx), idx
    return best, bpath


vb, pb = bad(A)
vg, pg = good(A)
vt, pt = brute(A)
print("계단 점수 %s" % A)
print("  부족한 상태 dp[i]         = %d   밟은 계단 %s" % (vb, pb))
print("  연속 횟수를 넣은 dp[i][r] = %d   밟은 계단 %s" % (vg, pg))
print("  완전탐색                  = %d   밟은 계단 %s" % (vt, pt))
```
```cpp title="계단 오르기 — 부족한 상태와 축을 하나 더한 상태"
#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>
using namespace std;

vector<int> A = {10, 20, 15, 25};
const int NEG = -1000000000;

string fmt(const vector<int>& v) {
    string s = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) s += ", "; s += to_string(v[i]); }
    return s + "]";
}

// dp[i] = i 번 계단까지의 최대 점수. 연속으로 몇 개째인지는 기억하지 않는다.
pair<int, vector<int>> bad(const vector<int>& a) {
    int n = (int)a.size();
    vector<int> dp(n, 0), frm(n, -1);
    dp[0] = a[0];
    dp[1] = a[1] + dp[0];
    frm[1] = 0;
    for (int i = 2; i < n; i++) {
        if (dp[i - 1] >= dp[i - 2]) { dp[i] = a[i] + dp[i - 1]; frm[i] = i - 1; }
        else                        { dp[i] = a[i] + dp[i - 2]; frm[i] = i - 2; }
    }
    vector<int> out;
    for (int i = n - 1; i != -1; i = frm[i]) out.push_back(i);
    reverse(out.begin(), out.end());
    return {dp[n - 1], out};
}

// dp[i][r] = i 번을 밟고 그것이 연속 r 번째일 때의 최대 점수. r 은 1 또는 2.
pair<int, vector<int>> good(const vector<int>& a) {
    int n = (int)a.size();
    vector<vector<int>> dp(n, vector<int>(3, NEG));
    vector<vector<int>> pi(n, vector<int>(3, -1));   // 직전 계단 번호
    vector<vector<int>> pr(n, vector<int>(3, 0));    // 그때의 연속 횟수
    dp[0][1] = a[0];
    dp[1][1] = a[1];                                 // 0 번을 건너뛰고 1 번을 밟는다
    dp[1][2] = a[1] + dp[0][1];
    pi[1][2] = 0; pr[1][2] = 1;
    for (int i = 2; i < n; i++) {
        int r0 = dp[i - 2][1] >= dp[i - 2][2] ? 1 : 2;
        dp[i][1] = a[i] + dp[i - 2][r0];             // 직전 칸을 건너뛰었으니 연속 1 번째
        pi[i][1] = i - 2; pr[i][1] = r0;
        dp[i][2] = a[i] + dp[i - 1][1];              // 직전 칸도 밟았으니 그쪽이 연속 1 번째여야 한다
        pi[i][2] = i - 1; pr[i][2] = 1;
    }
    int r = dp[n - 1][1] >= dp[n - 1][2] ? 1 : 2;
    vector<int> out;
    for (int i = n - 1; i != -1; ) {
        out.push_back(i);
        int ni = pi[i][r], nr = pr[i][r];
        i = ni; r = nr;
    }
    reverse(out.begin(), out.end());
    return {max(dp[n - 1][1], dp[n - 1][2]), out};
}

// 마지막 계단 필수, 한 번에 1~2칸, 연속 3칸 금지. 전수 조사.
pair<int, vector<int>> brute(const vector<int>& a) {
    int n = (int)a.size(), best = NEG;
    vector<int> bpath;
    for (int m = 0; m < (1 << n); m++) {
        vector<int> idx;
        for (int i = 0; i < n; i++) if (m >> i & 1) idx.push_back(i);
        if (idx.empty() || idx.back() != n - 1 || idx[0] > 1) continue;
        bool ok = true;
        for (size_t j = 0; j + 1 < idx.size(); j++) if (idx[j + 1] - idx[j] > 2) ok = false;
        for (size_t j = 0; j + 2 < idx.size(); j++) if (idx[j + 2] - idx[j] == 2) ok = false;
        if (!ok) continue;
        int s = 0;
        for (int i : idx) s += a[i];
        if (s > best) { best = s; bpath = idx; }
    }
    return {best, bpath};
}

int main() {
    auto [vb, pb] = bad(A);
    auto [vg, pg] = good(A);
    auto [vt, pt] = brute(A);
    printf("계단 점수 %s\n", fmt(A).c_str());
    printf("  부족한 상태 dp[i]         = %d   밟은 계단 %s\n", vb, fmt(pb).c_str());
    printf("  연속 횟수를 넣은 dp[i][r] = %d   밟은 계단 %s\n", vg, fmt(pg).c_str());
    printf("  완전탐색                  = %d   밟은 계단 %s\n", vt, fmt(pt).c_str());
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
계단 점수 [10, 20, 15, 25]
  부족한 상태 dp[i]         = 70   밟은 계단 [0, 1, 2, 3]
  연속 횟수를 넣은 dp[i][r] = 55   밟은 계단 [0, 1, 3]
  완전탐색                  = 55   밟은 계단 [0, 1, 3]
```

**복잡도:** 부족한 판은 시간 $O(n)$ / 공간 $O(n)$ — 칸마다 후보 둘을 비교한다. 축을 하나 더한 판도 시간 $O(n)$ / 공간 $O(n)$ — 칸이 두 배가 되고 각 칸의 비용은 그대로라 상수만 2배다. ==옳은 상태의 값이 두 배 비쌌을 뿐이고, 틀린 답은 그 두 배를 아껴서 얻은 것이다.==

무작위 500건($n \le 10$, 점수에 음수 포함)에서 부족한 판이 완전탐색과 어긋난 것이 **353건**이고, 축을 더한 판은 500건 전부 일치했다.

## 3. 사례 2 — "까지"와 "로 끝나는"을 섞는다

### 지문

> 연속된 부분 수열 중 그 합이 가장 큰 것을 구하라. 수열의 원소에는 음수가 있다. ([VIII-3](#/viii-3)의 최대 부분합)

### 왜 그 상태가 자연스러운가

문제가 "가장 큰 것"을 물으니 $dp[i]$를 **"앞 $i+1$개 안에서의 최대 부분합"** 으로 두는 것이 문장 그대로다. 그리고 답이 $dp[n-1]$ 하나로 나와서 깔끔하다. 전이도 그럴듯하다 — $i$를 안 쓰면 $dp[i-1]$ 그대로이고, 쓰면 지금까지의 최고에 $a[i]$를 붙인다.

$$dp[i] = \max(dp[i-1],\; dp[i-1] + a[i])$$

### 반례

`a = [2, -3, 4]`. 원소 셋이다.

| i | a[i] | dp[i-1] | dp[i-1] + a[i] | dp[i] |
|---|---|---|---|---|
| 0 | 2 | — | — | 2 |
| 1 | -3 | 2 | -1 | 2 |
| 2 | 4 | 2 | **6** | **6** |

**6이다.** 그런데 실제 부분 수열을 전부 적으면 이렇다.

| 구간 | [0,0] | [0,1] | [0,2] | [1,1] | [1,2] | [2,2] |
|---|---|---|---|---|---|---|
| 합 | 2 | -1 | 3 | -3 | 1 | **4** |

**정답은 4다.** 6은 $2 + 4$, 즉 **가운데의 $-3$을 건너뛴 값**이다. 연속이라는 조건을 어긴 수열의 합이다.

무엇이 깨졌는지는 명확하다. $dp[1] = 2$는 구간 $[0,0]$의 합이고 **1번 자리에서 끝나지 않는다.** 그런데 $dp[2]$는 그 2에 $a[2]$를 이어 붙였다. **이어 붙이려면 앞이 바로 직전에서 끝나 있어야 하는데, "까지"로 정의한 상태에는 어디서 끝났는지가 없다.**

### 무엇을 상태에 더했어야 했는가

더한 것이 아니라 **정의를 바꿔야 한다.** $dp[i]$ = **$i$에서 끝나는** 부분합의 최댓값.

$$dp[i] = \max(a[i],\; dp[i-1] + a[i])$$

같은 배열에 대해 $dp = [2, -3, 4]$가 되고, 답은 $dp[n-1]$이 아니라 **$dp$ 전체의 최댓값**인 4다. ==끝점을 상태에 고정하면 이어 붙이기가 합법이 되고, 대신 답을 마지막 칸에서 읽을 수 없게 된다.== 둘은 한 세트다.

무작위 500건($n \le 8$)에서 "까지" 판이 틀린 것이 **354건**이고 "로 끝나는" 판은 500건 전부 맞았다.

이 교환은 DP 전체에서 반복된다. [VIII-6](#/viii-6)의 LIS도 "$i$까지의 최장 길이"가 아니라 "$i$로 끝나는 최장 길이"로 정의해야 이어 붙이기가 성립한다.

## 4. 사례 3 — 자원을 쓴 흔적을 지운다

### 지문

> 물건마다 무게와 가치가 있다. 배낭의 용량을 넘지 않게 담아 가치 합을 최대로 하라. **각 물건은 한 개씩만 있다.** ([VIII-5](#/viii-5)의 0/1 배낭)

### 왜 그 상태가 자연스러운가

[VIII-5](#/viii-5)가 2차원 표 $dp[i][c]$를 한 줄로 접었다. 각 행이 바로 윗 행만 읽으므로 배열 한 줄이면 된다는 논증은 옳고, 접은 코드는 실제로 돈다. **그래서 접는 순간 물건 축이 사라졌다는 사실이 눈에 안 들어온다.**

### 반례

물건이 하나뿐이다. 무게 2, 가치 3. 용량 6.

용량을 **오름차순**으로 도는 한 줄 배낭을 손으로 채운다.

| c | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| dp[c-2] + 3 | — | 0+3 | 0+3 | 3+3 | 3+3 | 6+3 |
| dp[c] | 0 | 3 | 3 | **6** | 6 | **9** |

**9다.** 물건이 하나인데 가치 9를 얻었다 — 같은 물건을 세 번 담았다. 정답은 3이다.

$dp[4]$가 읽은 $dp[2] = 3$이 문제다. 그 3은 **이번 물건을 이미 쓴 값**이다. 2차원 표에서는 $dp[i][c]$가 $dp[i-1][c-w]$를 읽어서 "이 물건을 쓰기 전"이 보장됐는데, 한 줄로 접고 오름차순으로 돌면 왼쪽 칸이 이미 갱신되어 있다.

### 무엇을 상태에 더했어야 했는가

여기서 답이 갈린다. **상태를 되살리거나, 계산 순서로 대신하거나.**

- 2차원 $dp[i][c]$로 되돌리면 물건 축이 상태에 명시된다. 공간은 $O(nW)$다.
- 한 줄을 유지하되 용량을 **내림차순**으로 돌면 $dp[c-w]$가 아직 안 갱신된 칸, 즉 윗 행의 값이다. 공간은 $O(W)$다.

두 번째가 실전의 표준이고, 그 코드는 [VIII-5](#/viii-5)에 있다. 여기서 봐야 할 것은 코드가 아니라 **"각 물건 한 번"이라는 규칙이 상태에서 계산 순서로 옮겨 갔다**는 사실이다. 루프 방향 한 글자가 규칙 전체를 지고 있고, 그 사실은 코드 어디에도 안 적혀 있다. **주석으로 적어라.**

무작위 500건(물건 5개 이하, 용량 15 이하)에서 오름차순 판이 틀린 것이 **354건**이다.

## 5. 사례 4 — 답이 루프 순서에 따라 달라진다

### 지문

> $n$가지 동전이 있고 각 동전은 몇 개든 쓸 수 있다. 합이 $k$원이 되는 **경우의 수**를 구하라. $1+2$와 $2+1$은 **같은 경우로 센다.**

### 왜 그 상태가 자연스러운가

[VIII-1](#/viii-1)의 거스름돈에서 $\min$을 $+$로 바꾸면 개수 DP가 된다는 것을 이미 봤다. 상태는 그대로 $dp[x]$ = **$x$원을 만드는 경우의 수**, 초기값은 $dp[0] = 1$이다. 코드도 최솟값 판에서 한 글자만 바꾸면 된다.

```text nolines
   for x in 1..k:            for c in coins:
       for c in coins:  vs       for x in c..k:
           dp[x] += dp[x-c]          dp[x] += dp[x-c]
```

**두 판 모두 문법적으로 옳고 둘 다 돌아간다.** 그런데 답이 다르다.

### 반례

동전 `{1, 2}`, 목표 3원.

| 금액 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 금액 바깥 / 동전 안쪽 | 1 | 2 | **3** | 5 | 8 | 13 |
| 동전 바깥 / 금액 안쪽 | 1 | 2 | **2** | 3 | 3 | 4 |

3원에서 갈린다. 분해를 직접 적으면 이유가 즉시 보인다.

| 판 | 3원의 분해 | 개수 |
|---|---|---|
| 금액 바깥 | `1+1+1`, `1+2`, `2+1` | 3 |
| 동전 바깥 | `1+1+1`, `1+2` | 2 |

**금액을 바깥에 두면 순열을 센다.** $dp[3]$을 채울 때 "마지막에 쓴 동전"으로 갈라지므로 `1+2`와 `2+1`이 서로 다른 갈래가 된다. 첫 줄이 피보나치가 되는 것도 그래서다.

**동전을 바깥에 두면 조합을 센다.** 1원짜리를 다 처리한 뒤에 2원짜리를 처리하므로 동전 종류에 **순서가 강제**되고, 각 조합이 정확히 한 번 만들어진다.

### 무엇을 상태에 더했어야 했는가

**"몇 번째 동전 종류까지 검토했는가."** 즉 $dp[i][x]$다. 사례 3의 배낭에서 사라졌던 것과 **같은 축**이고, 실제로 두 문제는 같은 표다.

그리고 사례 3과 같은 결말을 맞는다 — 그 축을 상태에 두지 않고 **바깥 루프의 순서**로 대신할 수 있다. 대신하는 순간 "조합을 센다"는 규칙이 코드의 구조에만 남고 이름으로는 사라진다. ==루프 두 개의 순서를 바꿔도 컴파일이 되고 답만 달라지는 코드는, 규칙 하나가 상태 밖에 나가 있다는 신호다.==

무작위 500건(동전 4종 이하, 목표 14 이하)에서 순열 판과 조합 완전탐색이 어긋난 것이 **190건**이다. 나머지 310건은 동전이 한 종류거나 목표가 작아서 순열과 조합이 우연히 같았다.

::: dual
```python title="동전 경우의 수 — 루프 순서가 세는 대상을 바꾼다"
COINS = [1, 2]
LIMIT = 6


def perm_count(coins, limit):
    """금액이 바깥, 동전이 안쪽. dp[x] 를 채울 때 모든 동전을 다시 본다."""
    dp = [0] * (limit + 1)
    dp[0] = 1
    for x in range(1, limit + 1):
        for c in coins:
            if c <= x:
                dp[x] += dp[x - c]
    return dp


def comb_count(coins, limit):
    """동전이 바깥, 금액이 안쪽. 동전 종류에 순서를 강제한다."""
    dp = [0] * (limit + 1)
    dp[0] = 1
    for c in coins:
        for x in range(c, limit + 1):
            dp[x] += dp[x - c]
    return dp


def enumerate_ordered(coins, target):
    """순서를 구분해서 실제 분해를 전부 만든다."""
    if target == 0:
        return [[]]
    out = []
    for c in coins:
        if c <= target:
            for rest in enumerate_ordered(coins, target - c):
                out.append([c] + rest)
    return out


def enumerate_unordered(coins, target, i=0):
    """동전 종류를 오름차순으로만 쓴다 — 같은 조합을 한 번만 만든다."""
    if target == 0:
        return [[]]
    if i == len(coins):
        return []
    out = []
    for rest in enumerate_unordered(coins, target, i + 1):
        out.append(rest)
    if coins[i] <= target:
        for rest in enumerate_unordered(coins, target - coins[i], i):
            out.append([coins[i]] + rest)
    return out


p = perm_count(COINS, LIMIT)
q = comb_count(COINS, LIMIT)
print("동전 %s — 금액별 경우의 수" % COINS)
print("  금액      1  2  3  4  5  6")
print("  순열 판  " + "".join("%3d" % p[x] for x in range(1, LIMIT + 1)))
print("  조합 판  " + "".join("%3d" % q[x] for x in range(1, LIMIT + 1)))
print("  3 원의 실제 분해")
print("    순서 구분   %s  (%d가지)"
      % (sorted(enumerate_ordered(COINS, 3)), len(enumerate_ordered(COINS, 3))))
print("    순서 무시   %s  (%d가지)"
      % (sorted(enumerate_unordered(COINS, 3)), len(enumerate_unordered(COINS, 3))))
```
```cpp title="동전 경우의 수 — 루프 순서가 세는 대상을 바꾼다"
#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>
using namespace std;

vector<int> COINS = {1, 2};
const int LIMIT = 6;

// 금액이 바깥, 동전이 안쪽. dp[x] 를 채울 때 모든 동전을 다시 본다.
vector<long long> perm_count(const vector<int>& coins, int limit) {
    vector<long long> dp(limit + 1, 0);
    dp[0] = 1;
    for (int x = 1; x <= limit; x++)
        for (int c : coins)
            if (c <= x) dp[x] += dp[x - c];
    return dp;
}

// 동전이 바깥, 금액이 안쪽. 동전 종류에 순서를 강제한다.
vector<long long> comb_count(const vector<int>& coins, int limit) {
    vector<long long> dp(limit + 1, 0);
    dp[0] = 1;
    for (int c : coins)
        for (int x = c; x <= limit; x++) dp[x] += dp[x - c];
    return dp;
}

// 순서를 구분해서 실제 분해를 전부 만든다.
vector<vector<int>> enumerate_ordered(const vector<int>& coins, int target) {
    if (target == 0) return {{}};
    vector<vector<int>> out;
    for (int c : coins)
        if (c <= target)
            for (auto rest : enumerate_ordered(coins, target - c)) {
                vector<int> one = {c};
                one.insert(one.end(), rest.begin(), rest.end());
                out.push_back(one);
            }
    return out;
}

// 동전 종류를 오름차순으로만 쓴다 — 같은 조합을 한 번만 만든다.
vector<vector<int>> enumerate_unordered(const vector<int>& coins, int target, int i = 0) {
    if (target == 0) return {{}};
    if (i == (int)coins.size()) return {};
    vector<vector<int>> out;
    for (auto rest : enumerate_unordered(coins, target, i + 1)) out.push_back(rest);
    if (coins[i] <= target)
        for (auto rest : enumerate_unordered(coins, target - coins[i], i)) {
            vector<int> one = {coins[i]};
            one.insert(one.end(), rest.begin(), rest.end());
            out.push_back(one);
        }
    return out;
}

string fmt1(const vector<int>& v) {
    string s = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) s += ", "; s += to_string(v[i]); }
    return s + "]";
}

string fmt2(vector<vector<int>> v) {
    sort(v.begin(), v.end());
    string s = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) s += ", "; s += fmt1(v[i]); }
    return s + "]";
}

int main() {
    vector<long long> p = perm_count(COINS, LIMIT), q = comb_count(COINS, LIMIT);
    printf("동전 %s — 금액별 경우의 수\n", fmt1(COINS).c_str());
    printf("  금액      1  2  3  4  5  6\n");
    string a = "  순열 판  ", b = "  조합 판  ";
    for (int x = 1; x <= LIMIT; x++) {
        char buf[16];
        snprintf(buf, sizeof buf, "%3lld", p[x]); a += buf;
        snprintf(buf, sizeof buf, "%3lld", q[x]); b += buf;
    }
    printf("%s\n%s\n", a.c_str(), b.c_str());
    printf("  3 원의 실제 분해\n");
    auto o = enumerate_ordered(COINS, 3);
    auto u = enumerate_unordered(COINS, 3);
    printf("    순서 구분   %s  (%d가지)\n", fmt2(o).c_str(), (int)o.size());
    printf("    순서 무시   %s  (%d가지)\n", fmt2(u).c_str(), (int)u.size());
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
동전 [1, 2] — 금액별 경우의 수
  금액      1  2  3  4  5  6
  순열 판    1  2  3  5  8 13
  조합 판    1  2  2  3  3  4
  3 원의 실제 분해
    순서 구분   [[1, 1, 1], [1, 2], [2, 1]]  (3가지)
    순서 무시   [[1, 1, 1], [1, 2]]  (2가지)
```

**복잡도:** 두 DP 모두 시간 $O(nk)$ / 공간 $O(k)$ — 동전 $n$종과 금액 $k$가지의 곱이고 배열은 한 줄이다. **루프 순서만 다르고 복잡도는 완전히 같다.** 열거 함수는 분해의 개수만큼 나오므로 순열 판이 지수로 부푼다 — 여기서는 검산용으로 $k=3$에만 쓴다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 경우의 수 크기 | 임의 정밀도라 그대로 커진다 | $k$가 조금만 커도 `int`를 넘는다. `long long` 또는 나머지 연산이 필요하다 |
| 중첩 리스트 정렬 | `sorted`가 사전식으로 비교한다 | `sort`도 `vector<vector<int>>`를 사전식으로 비교한다. 결과가 같다 |
| 기본 인자 | `def enumerate_unordered(coins, target, i=0)` | 선언에서 `int i = 0`. **재귀 호출에서는 명시해야 한다** |

## 6. 사례 5 — 대표 하나만 남긴다

### 지문

> 모든 도시를 정확히 한 번씩 방문하고 출발 도시로 돌아오는 최소 비용 경로를 구하라. 비용은 방향에 따라 다르다. ([VIII-9](#/viii-9)의 외판원 순회)

### 왜 그 상태가 자연스러운가

[VIII-9](#/viii-9)가 이미 예고한 실패다. 목표가 "전부 방문"이니 방문 집합이 곧 진행도로 읽히고, $dp[\text{mask}]$ 하나면 충분해 보인다. 전이에 필요한 "현재 위치"는 **그 최솟값을 낸 도시를 따로 적어 두면 되지 않는가.**

상태가 절반으로 줄고($2^n \times n \to 2^n$), 코드도 짧아지고, **작은 예제에서 답이 맞는다.**

### 반례

도시 4개. 비대칭 비용 행렬이다.

```text nolines
        to 0   to 1   to 2   to 3
   0        0      5      6      9
   1        1      0      8      4
   2        1      3      0      2
   3        6      8      4      0
```

두 판이 마스크마다 무엇을 들고 있는지 나란히 놓는다.

| mask | dp[mask] (대표 하나) | at | dp[mask][0..3] (전부) |
|---|---|---|---|
| 0011 | 5 | 1 | ., 5, ., . |
| 0101 | 6 | 2 | ., ., 6, . |
| **0111** | **9** | **1** | **., 9, 13, .** |
| 1001 | 9 | 3 | ., ., ., 9 |
| 1011 | 9 | 3 | ., 17, ., 9 |
| 1101 | 8 | 3 | ., ., 13, 8 |
| 1111 | 13 | 3 | ., 16, 13, 13 |

갈라지는 자리는 `0111`이다. 도시 $\{0,1,2\}$를 방문한 경로가 둘 있다.

- $0 \to 2 \to 1$, 비용 $6 + 3 = 9$, 지금 **1**에 있다
- $0 \to 1 \to 2$, 비용 $5 + 8 = 13$, 지금 **2**에 있다

대표 하나만 남기는 판은 싼 쪽인 9를 남기고 13을 버린다. 그 뒤로 갈 수 있는 곳은 3뿐이라 $9 + cost[1][3] = 13$, 마지막에 $cost[3][0] = 6$을 더해 **19**다.

전부 남기는 판은 다른 길을 찾는다. $dp[1011][3] = 9$는 $0 \to 1 \to 3$이고, 거기서 2로 가면 $9 + cost[3][2] = 13$, 돌아오는 $cost[2][0] = 1$을 더해 **14**다. 완전탐색도 14이고 경로는 $0 \to 1 \to 3 \to 2 \to 0$이다.

**19와 14다.** 버린 13이 최적해의 조각이었던 것이 아니다 — 더 결정적인 것은, 대표를 하나 남기는 순간 $0 \to 1 \to \cdots$로 시작하는 모든 경로가 `0111`을 통과하지 못하게 되어 탐색에서 통째로 빠졌다는 점이다.

### 무엇을 상태에 더했어야 했는가

**현재 위치.** 그것이 $dp[\text{mask}][i]$이고 [VIII-9](#/viii-9)의 표다.

판정 기준은 언제나 같다. **"같은 칸에 도달한 두 경로를 서로 바꿔 끼워도 앞으로 할 수 있는 일이 같은가."** 여기서는 다르다 — 1에 서 있는 것과 2에 서 있는 것은 다음 이동 비용이 다르다. 다르면 그 정보는 상태에 들어가야 한다.

::: dual
```python title="외판원 순회 — 대표 하나만 남기는 판과 전부 남기는 판"
from itertools import permutations

INF = 10 ** 9
COST = [
    [0, 5, 6, 9],
    [1, 0, 8, 4],
    [1, 3, 0, 2],
    [6, 8, 4, 0],
]


def bad(cost):
    """dp[mask] 하나만 두고, 그 최솟값을 낸 위치 at[mask] 를 부가 정보로 들고 다닌다."""
    n = len(cost)
    full = (1 << n) - 1
    dp = [INF] * (1 << n)
    at = [0] * (1 << n)
    dp[1] = 0
    for mask in range(1 << n):
        if dp[mask] == INF:
            continue
        i = at[mask]                            # 이 마스크의 "대표" 위치 하나
        for j in range(n):
            if mask >> j & 1:
                continue
            nm = mask | (1 << j)
            v = dp[mask] + cost[i][j]
            if v < dp[nm]:
                dp[nm] = v
                at[nm] = j
    return dp[full] + cost[at[full]][0], dp, at


def good(cost):
    """dp[mask][i] — 현재 위치가 상태의 일부다."""
    n = len(cost)
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1 << n):
        for i in range(n):
            if dp[mask][i] == INF:
                continue
            for j in range(n):
                if mask >> j & 1:
                    continue
                nm = mask | (1 << j)
                v = dp[mask][i] + cost[i][j]
                if v < dp[nm][j]:
                    dp[nm][j] = v
    return min(dp[full][i] + cost[i][0] for i in range(1, n)), dp


def brute(cost):
    n = len(cost)
    best, order = INF, ()
    for p in permutations(range(1, n)):
        prev, s = 0, 0
        for x in p:
            s += cost[prev][x]
            prev = x
        s += cost[prev][0]
        if s < best:
            best, order = s, (0,) + p
    return best, order


n = len(COST)
vb, dpb, at = bad(COST)
vg, dpg = good(COST)
vt, order = brute(COST)
print("[1] 비용 행렬 (행 i 에서 열 j 로)")
for row in COST:
    print("    " + "".join("%3d" % x for x in row))
print("[2] 마스크별로 두 판이 무엇을 들고 있는가")
print("    mask   dp[mask] at   dp[mask][0..3]")
for mask in range(1 << n):
    if mask & 1 == 0 or dpb[mask] == INF:
        continue
    cells = "".join("%5s" % ("." if dpg[mask][i] == INF else dpg[mask][i]) for i in range(n))
    print("    %s   %5d %2d   %s" % (format(mask, "04b"), dpb[mask], at[mask], cells))
print("[3] 답")
print("    현재 위치를 뺀 판 = %d" % vb)
print("    dp[mask][last]    = %d" % vg)
print("    완전탐색          = %d   경로 %s" % (vt, list(order)))
```
```cpp title="외판원 순회 — 대표 하나만 남기는 판과 전부 남기는 판"
#include <algorithm>
#include <bitset>
#include <cstdio>
#include <numeric>
#include <string>
#include <vector>
using namespace std;

const int INF = 1000000000;
vector<vector<int>> COST = {
    {0, 5, 6, 9},
    {1, 0, 8, 4},
    {1, 3, 0, 2},
    {6, 8, 4, 0},
};

// dp[mask] 하나만 두고, 그 최솟값을 낸 위치 at[mask] 를 부가 정보로 들고 다닌다.
int bad(const vector<vector<int>>& cost, vector<int>& dp, vector<int>& at) {
    int n = (int)cost.size(), full = (1 << n) - 1;
    dp.assign(1 << n, INF);
    at.assign(1 << n, 0);
    dp[1] = 0;
    for (int mask = 0; mask < (1 << n); mask++) {
        if (dp[mask] == INF) continue;
        int i = at[mask];                       // 이 마스크의 "대표" 위치 하나
        for (int j = 0; j < n; j++) {
            if (mask >> j & 1) continue;
            int nm = mask | (1 << j);
            int v = dp[mask] + cost[i][j];
            if (v < dp[nm]) { dp[nm] = v; at[nm] = j; }
        }
    }
    return dp[full] + cost[at[full]][0];
}

// dp[mask][i] — 현재 위치가 상태의 일부다.
int good(const vector<vector<int>>& cost, vector<vector<int>>& dp) {
    int n = (int)cost.size(), full = (1 << n) - 1;
    dp.assign(1 << n, vector<int>(n, INF));
    dp[1][0] = 0;
    for (int mask = 0; mask < (1 << n); mask++)
        for (int i = 0; i < n; i++) {
            if (dp[mask][i] == INF) continue;
            for (int j = 0; j < n; j++) {
                if (mask >> j & 1) continue;
                int nm = mask | (1 << j);
                int v = dp[mask][i] + cost[i][j];
                if (v < dp[nm][j]) dp[nm][j] = v;
            }
        }
    int best = INF;
    for (int i = 1; i < n; i++) best = min(best, dp[full][i] + cost[i][0]);
    return best;
}

pair<int, vector<int>> brute(const vector<vector<int>>& cost) {
    int n = (int)cost.size();
    vector<int> p(n - 1);
    iota(p.begin(), p.end(), 1);
    int best = INF;
    vector<int> order;
    do {
        int prev = 0, s = 0;
        for (int x : p) { s += cost[prev][x]; prev = x; }
        s += cost[prev][0];
        if (s < best) {
            best = s;
            order = {0};
            order.insert(order.end(), p.begin(), p.end());
        }
    } while (next_permutation(p.begin(), p.end()));
    return {best, order};
}

string fmt(const vector<int>& v) {
    string s = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) s += ", "; s += to_string(v[i]); }
    return s + "]";
}

int main() {
    int n = (int)COST.size();
    vector<int> dpb, at;
    vector<vector<int>> dpg;
    int vb = bad(COST, dpb, at);
    int vg = good(COST, dpg);
    auto [vt, order] = brute(COST);
    printf("[1] 비용 행렬 (행 i 에서 열 j 로)\n");
    for (auto& row : COST) {
        string s = "    ";
        for (int x : row) { char buf[16]; snprintf(buf, sizeof buf, "%3d", x); s += buf; }
        printf("%s\n", s.c_str());
    }
    printf("[2] 마스크별로 두 판이 무엇을 들고 있는가\n");
    printf("    mask   dp[mask] at   dp[mask][0..3]\n");
    for (int mask = 0; mask < (1 << n); mask++) {
        if ((mask & 1) == 0 || dpb[mask] == INF) continue;
        string cells;
        for (int i = 0; i < n; i++) {
            char buf[16];
            if (dpg[mask][i] == INF) snprintf(buf, sizeof buf, "%5s", ".");
            else snprintf(buf, sizeof buf, "%5d", dpg[mask][i]);
            cells += buf;
        }
        printf("    %s   %5d %2d   %s\n",
               bitset<4>(mask).to_string().c_str(), dpb[mask], at[mask], cells.c_str());
    }
    printf("[3] 답\n");
    printf("    현재 위치를 뺀 판 = %d\n", vb);
    printf("    dp[mask][last]    = %d\n", vg);
    printf("    완전탐색          = %d   경로 %s\n", vt, fmt(order).c_str());
    return 0;
}
```
:::

두 언어의 출력은 같다. 틀린 판이 $O(2^n \cdot n)$, 옳은 판이 $O(2^n \cdot n^2)$이다.

```console
[1] 비용 행렬 (행 i 에서 열 j 로)
      0  5  6  9
      1  0  8  4
      1  3  0  2
      6  8  4  0
[2] 마스크별로 두 판이 무엇을 들고 있는가
    mask   dp[mask] at   dp[mask][0..3]
    0001       0  0       0    .    .    .
    0011       5  1       .    5    .    .
    0101       6  2       .    .    6    .
    0111       9  1       .    9   13    .
    1001       9  3       .    .    .    9
    1011       9  3       .   17    .    9
    1101       8  3       .    .   13    8
    1111      13  3       .   16   13   13
[3] 답
    현재 위치를 뺀 판 = 19
    dp[mask][last]    = 14
    완전탐색          = 14   경로 [0, 1, 3, 2]
```

**복잡도:** 대표 하나만 남기는 판은 시간 $O(2^n \cdot n)$ / 공간 $O(2^n)$ — 마스크마다 다음 도시 $n$가지만 본다. 온전한 판은 시간 $O(2^n \cdot n^2)$ / 공간 $O(2^n \cdot n)$ — 마스크마다 현재 위치 $n$가지가 더 붙는다([VIII-9](#/viii-9)). **틀린 판이 $n$배 싸다.** 사례 1과 같은 구조다.

무작위 500건($n \le 6$)에서 대표 하나만 남기는 판이 완전탐색과 어긋난 것이 **200건**이다. 나머지 300건은 우연히 맞았다.

## 7. 다섯 사례의 공통 구조

세 가지가 겹칠 때만 이 실패가 완성된다.

**첫째, 부족한 상태가 언제나 더 싸다.** 계단은 축이 하나 적고, 배낭은 배열이 한 줄이고, 외판원 순회는 상태가 $n$분의 1이다. 싼 쪽부터 검토하는 좋은 습관이 실패의 **방향**을 정한다. [I-5](#/i-5)에서 본 것과 같은 구조다.

**둘째, 작은 예제에서 맞는다.** 무작위 대조에서 부족한 판이 틀린 비율은 사례마다 38%에서 71% 사이였다. 뒤집으면 **최소 4분의 1 이상의 입력에서 옳은 답을 낸다.** 예제 두세 개로는 절대 안 걸린다.

**셋째, 실패가 조용하다.** 값이 어긋날 뿐 예외도 경고도 없다. 계단의 70은 존재할 수 없는 점수인데 표 어디에도 그 사실이 안 적힌다. ==DP는 자기가 불법 상태를 만들었다는 것을 스스로 알 방법이 없다.==

세 조건 중 깰 수 있는 것은 둘째다. **$n = 4 \sim 6$짜리 완전탐색과 무작위로 대조하라.** 이 챕터의 숫자 전부가 그렇게 얻어졌다.

## 8. 상태가 충분한지 자문하는 체크리스트

Part VIII 전체를 여기서 회수한다. 코드를 짜기 전에 일곱 줄을 통과시킨다.

1. **한 문장으로 써지는가.** `dp[...] = ...`의 오른쪽이 한국어 명사절로 끝나야 한다. "$i$번째까지의 최적" 같은 모호한 말이 나오면 "**$i$에서 끝나는**"인지 "**$i$까지 중 어디서 끝나도 되는**"인지 지금 정하라(사례 2).
2. **바꿔치기 시험.** 같은 칸에 도달한 서로 다른 두 경로를 골라 서로 바꿔 끼운다. **앞으로 할 수 있는 일이 달라지면 상태가 부족하다.** 이 한 줄이 사례 1과 사례 5를 동시에 잡는다.
3. **규칙마다 새겨진 자리를 지목하라.** 지문의 제약(연속 금지, 한 번만, 순서 무관) 각각에 대해 그것을 강제하는 것이 상태의 어느 축인지, 아니면 계산 순서·루프 방향인지 말한다. **어디에도 없으면 그 규칙은 코드에 없다.**
4. **루프 순서를 바꿔 본다.** 답이 달라지면 규칙 하나가 순서에 얹혀 있다는 뜻이다(사례 3, 4). 그 자체는 정상이지만 **의도한 것인지 확인하고 주석으로 적어라.**
5. **읽는 칸이 전부 확정되어 있는가.** 자기 자신이나 아직 안 채운 칸을 읽지 않는지 본다([VIII-1](#/viii-1) ④).
6. **축을 하나 늘려 보고 답이 달라지는지 본다.** 달라지면 원래 상태가 부족했던 것이고, 안 달라지면 그 축은 군더더기다. **어느 쪽이든 정보를 얻는다.**
7. **완전탐색과 대조했는가.** $n = 4 \sim 6$, 무작위 수백 건. 이것을 안 하고 제출한 DP는 검증된 적이 없는 DP다([0-12](#/0-12)).

::: pitfall
- **문제가 묻는 것을 그대로 상태로 쓴다.** 문제는 답을 묻고 상태는 부분문제를 가리킨다. 둘이 같은 경우가 오히려 드물다.
- **상태를 줄이는 것을 최적화라고 부른다.** 상태를 줄여서 얻는 것은 속도이고 잃는 것은 정답일 수 있다. **줄이기 전에 바꿔치기 시험을 통과시켜라.**
- **틀린 답을 점화식 탓으로 돌린다.** 점화식을 몇 번 고쳐도 안 맞으면 상태를 의심하라. 상태가 부족하면 그 위의 어떤 점화식도 맞지 않는다.
- **반례를 크게 만들려 한다.** 이 챕터의 반례는 원소 4개 이하다. 크게 만들려는 생각이 반례 만들기 자체를 포기하게 한다.
- **한 줄로 접은 코드를 2차원 표보다 먼저 짠다.** 접기는 검증이 끝난 뒤에 하는 일이다(사례 3).
- **`INF`나 도달 불가 칸을 0으로 둔다.** 상태 정의와 별개의 실수처럼 보이지만 결과는 같다 — 존재하지 않는 경로가 답에 섞인다([VIII-1](#/viii-1)).
:::

## 9. 어디에 쓰이는가

**HTTP 캐시 키 설계가 같은 실패를 낸다.** 캐시는 `키 → 응답`의 표이고, 그 키가 곧 상태 정의다. 같은 URL이라도 언어 설정이나 인증 여부에 따라 응답이 달라지는데 키에 URL만 넣으면 **서로 다른 처지가 한 칸에 겹쳐 들어가고, 먼저 들어온 응답이 나중 요청을 대표한다.** 사례 5의 `at[mask]`와 정확히 같은 실패이고, 증상도 같다 — 대부분의 요청에서 옳은 응답이 나가고 가끔 남의 것이 나간다. HTTP의 `Vary` 헤더는 "응답을 가르는 축을 키에 추가하라"는 지시이고, 그것이 §8의 3번 항목이다.

**상태 기계 설계도 같다.** 작업 오더를 `대기 / 진행 / 완료 / 취소` 넷으로 두면 "취소된 뒤 재시도된 건"과 "처음 들어온 건"이 같은 `대기`에 겹친다. 다음에 허용되는 전이가 달라지는데 상태가 그것을 구분하지 못하면, 그 구분은 결국 상태 밖의 `if` 문 더미로 새어 나간다([XI-6](#/xi-6), [XII-8](#/xii-8)). ==상태를 덜 잡은 대가는 언제나 상태 밖의 임시방편으로 지불된다.==

## 10. 이 유형을 알아보는 법

::: classify
- 신호어: 지문에 **"연속해서 K번은 안 된다", "각각 한 번씩만", "순서가 바뀐 것은 같은 경우로 센다", "이전에 선택한 것과 달라야 한다"** 같은 **조건절**이 붙어 있다. 조건절 하나가 상태의 축 하나를 요구한다
- 제약조건: 상태 수 × 전이 수가 $10^7 \sim 10^8$ 이하여야 하므로([0-9](#/0-9)) 축을 무한정 늘릴 수는 없다. 축 하나가 늘 때 상태 수가 몇 배가 되는지 먼저 계산하라 — 값이 2~3가지인 축은 거의 공짜이고, $2^n$짜리 축은 $N \le 20$을 강요한다([VIII-9](#/viii-9))
- 혼동 주의: 답이 느린 것과 틀린 것은 다른 문제다. 느린 쪽은 점화식의 오른쪽을 고치고([VIII-10](#/viii-10)), 틀린 쪽은 상태를 고친다. **점화식을 고쳐서 안 맞으면 상태를 의심하라.** 그리디로 착각한 경우는 [I-5](#/i-5)의 첫 사례다
- 반례 함정: 부족한 상태가 예제와 작은 입력에서 맞는다. 무작위 대조에서도 최소 29%는 맞았다. **한 번 맞은 것은 근거가 아니다.** 특히 대칭 비용 행렬이나 양수만 있는 수열처럼 "착한" 입력만 시험하면 끝까지 안 걸린다
:::

::: interview
**"DP 답이 예제는 맞는데 제출하면 틀립니다. 무엇부터 봅니까."**
"상태 정의부터 봅니다. 같은 칸에 도달한 서로 다른 두 경로를 골라서, 그 둘을 바꿔 끼워도 앞으로 할 수 있는 일이 같은지 확인합니다. 다르면 그 차이가 상태에 들어가야 합니다." 이어서 **"작은 입력에서 완전탐색과 대조한다"** 를 붙인다. $n = 5$짜리 무작위 입력 수백 건이면 대개 몇 초 안에 반례가 나온다.

**"1차원으로 접은 0/1 배낭에서 용량 루프를 왜 내림차순으로 돕니까."**
"2차원 표에서 `dp[i][c]`는 `dp[i-1][c-w]`, 즉 이 물건을 쓰기 전 값을 읽습니다. 한 줄로 접으면 그 보장을 루프 방향이 대신합니다. 내림차순이면 `dp[c-w]`가 아직 갱신 안 된 칸이라 윗 행이고, 오름차순이면 이미 이번 물건을 쓴 값이라 같은 물건이 여러 번 들어갑니다. 무게 2 가치 3짜리 물건 하나에 용량 6이면 오름차순은 9를 냅니다." **규칙이 상태에서 계산 순서로 옮겨 갔다**는 한 문장까지 붙이면 완성이다.
:::

## 연습

::: quiz
네 문제 모두 **자연스러운 상태가 부족하다.** 코드를 짜기 전에 §8의 2번(바꿔치기 시험)을 먼저 통과시켜라.

**1. 백준 2579 계단 오르기 (실버 3)** — https://www.acmicpc.net/problem/2579
- 신호: "연속된 세 개의 계단을 모두 밟아서는 안 된다"는 **조건절**. 사례 1 그대로다.
- 상태: $dp[i][r]$ — $i$를 밟았고 그것이 연속 $r$번째. $r$이 두 값뿐이라 상태가 두 배로만 는다.
- 자료구조: $N \times 2$ 배열. `dp[i][2]`가 `dp[i-1][2]`를 **읽지 않는다**는 것이 규칙 그 자체다. 왜 읽으면 안 되는지 말할 수 있어야 한다.

**2. 백준 1149 RGB거리 (실버 1)** — https://www.acmicpc.net/problem/1149
- 신호: "이웃한 집과 같은 색이면 안 된다". $dp[i]$ = $i$번 집까지의 최소 비용으로 두면 다음 집이 무슨 색을 못 쓰는지 알 수 없다.
- 상태: $dp[i][c]$ — $i$번 집을 색 $c$로 칠했을 때의 최소 비용. **색이 상태에 들어가야 하는 이유가 사례 5의 "현재 위치"와 같다.**
- 자료구조: $N \times 3$ 배열. 답은 마지막 행의 최솟값이지 마지막 칸이 아니다 — 사례 2와 같은 구조다.

**3. 백준 2293 동전 1 (골드 5)** — https://www.acmicpc.net/problem/2293
- 신호: "$1+1+2$와 $1+2+1$은 같은 경우". 사례 4의 조합 판이다.
- 상태: $dp[x]$ = $x$원을 만드는 조합의 수. **동전 축은 상태가 아니라 바깥 루프에 있다.**
- 자료구조: 배열 한 줄. 두 루프의 순서를 바꿔 돌려 보고 답이 어떻게 달라지는지 직접 확인하라. 달라진 그 값이 무엇을 센 것인지 말할 수 있어야 한다.

**4. 백준 2098 외판원 순회 (골드 1)** — https://www.acmicpc.net/problem/2098
- 신호: "모든 도시를 거쳐 다시 출발 도시로". 사례 5다.
- 상태: $dp[\text{mask}][i]$. 먼저 $dp[\text{mask}]$만으로 짜서 예제를 통과시켜 본 뒤, 이 챕터의 반례 행렬을 넣어 무너지는 것을 확인하라.
- 자료구조: $2^{16} \times 16$ 배열. **상태를 절반으로 줄이려는 유혹이 정확히 어디서 오는지**를 그 실험에서 체감할 수 있다.
:::

## 요약

- DP에서 틀리는 자리는 거의 언제나 **상태 정의**다. 점화식·초기값·계산 순서의 실수는 값이 크게 어긋나 금방 잡히지만, 부족한 상태는 조용히 그럴듯한 답을 낸다.
- 증상은 셋이다. **같은 칸에 서로 다른 처지가 겹치고, 나중 결정이 이전 결정을 무효로 만들고, 답이 루프 순서에 따라 달라진다.**
- **계단 오르기:** 연속 횟수를 상태에 안 넣으면 `[10,20,15,25]`에서 70이 나온다. 정답은 55이고 70은 존재할 수 없는 조합이다.
- **최대 부분합:** "$i$까지"로 정의하면 `[2,-3,4]`에서 6이 나온다. 정답은 4다. **"$i$로 끝나는"으로 바꾸면 이어 붙이기가 합법이 되고, 대신 답을 마지막 칸에서 못 읽는다.**
- **0/1 배낭:** 한 줄로 접고 용량을 오름차순으로 돌면 같은 물건이 여러 번 들어간다. 물건 하나(무게 2, 가치 3)와 용량 6에서 9가 나온다.
- **동전 경우의 수:** 루프 순서가 순열과 조합을 가른다. `{1,2}`로 3원이 3과 2다. **컴파일되는 두 코드가 다른 답을 내면 규칙 하나가 상태 밖에 있다.**
- **외판원 순회:** 마스크마다 대표 하나만 남기면 4개 도시에서 19와 14로 갈린다. 판정 기준은 **바꿔치기 시험**이다.
- 부족한 상태는 언제나 더 싸고, 무작위 입력의 29~71%에서 옳은 답을 낸다. **$n = 4 \sim 6$ 완전탐색과의 무작위 대조**만이 이것을 잡는다.

**다음 절**: [IX-1 유니온 파인드](#/ix-1) — Part IX가 시작된다. "이 둘이 같은 덩어리인가"를 거의 상수 시간에 답하는 자료구조부터 본다.
