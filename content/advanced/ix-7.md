# IX-7 문자열 매칭

::: lead
텍스트에서 패턴을 찾을 때, 이미 비교해 본 글자를 다시 볼 필요가 있는가?
:::

## 1. 문제

텍스트 편집기의 찾기 기능, 로그 파일에서 오류 서명을 찾는 스크립트, `grep` — 전부 같은 질문을 던진다. 텍스트 `T`(길이 `n`) 안에서 패턴 `P`(길이 `m`)가 나타나는 자리를 전부 찾아라.

가장 순진한 방법은 이렇다. 텍스트의 자리 0부터 시작해 패턴과 한 글자씩 비교한다. 어긋나면 시작 자리를 하나 옮기고 **패턴의 처음부터 다시** 비교한다. 코드로는 이중 루프 하나면 끝난다.

이 방법이 왜 느린지는 조금만 짓궂은 텍스트에서 바로 드러난다. 텍스트가 `A`를 4999개 늘어놓고 마지막에 `B`를 하나 붙인 것(길이 5000)이고, 패턴이 `A`를 499개 늘어놓고 마지막에 `B`를 붙인 것(길이 500)이라 하자. 시작 자리 0에서 비교하면 처음 499개는 전부 `A`=`A`로 맞다가 500번째(패턴의 마지막 `B`)에서 텍스트의 `A`와 어긋난다 — **499번 맞고 나서 딱 한 번 튕긴다.** 시작 자리를 1로 옮기면 똑같은 일이 또 벌어진다. 이 낭비가 시작 자리마다 반복된다.

실제로 세어 보면(`tools/bench/ix7_naive_vs_kmp.py`) 이 입력에서 순진한 이중 루프는 **2,250,500번** 비교한다. 텍스트 길이 5000, 패턴 길이 500인데 비교 횟수가 그 곱(250만)에 근접한다 — $O(nm)$ 그대로다. §4에서 만들 KMP는 같은 입력에서 **9,500번**만 비교하고 똑같이 자리 4500에서 일치를 찾아낸다. **237배 차이다.**

```console
naive: matches=[4500] comparisons=2250500
kmp  : matches=[4500] comparisons=9500
```

낭비의 정체는 명확하다. 시작 자리 `i`에서 499개의 `A`가 일치했다는 것은 **텍스트의 그 구간이 무엇으로 이루어져 있는지 이미 안다는 뜻이다.** 그런데 시작 자리를 `i+1`로 옮기는 순간 그 정보를 통째로 버리고 텍스트를 처음부터 다시 읽는다. 로그가 수십만 줄이고 패턴이 특정 오류 코드 문자열이면, 이 낭비가 초 단위로 쌓인다.

## 2. 아이디어

핵심 통찰은 하나다. **이미 맞춰 본 부분에 대한 정보를 버리지 않는다.**

패턴이 `ABABAC`라고 하자. 텍스트를 훑다가 처음 다섯 글자 `ABABA`까지 맞고 여섯 번째(`C`)에서 어긋났다면, 그 순간 텍스트의 최근 다섯 글자가 정확히 `ABABA`라는 것을 이미 안다. 다음 시도로 시작 자리를 하나씩 옮기며 처음부터 다시 비교할 필요가 없다 — **`ABABA`라는 문자열 자체가 자신의 접두사와 접미사가 얼마나 겹치는지**를 미리 알고 있으면, 그 겹친 만큼만 건너뛰고 이어서 비교하면 된다.

`ABABA`의 접두사 중 접미사와 같은 것을 찾아보면 `ABA`(길이 3)가 앞에도 있고 뒤에도 있다. 그러니 다음 시도는 시작 자리를 통째로 옮기는 대신, **패턴 쪽 포인터만 3칸 뒤로 물리고 텍스트 포인터는 그대로 둔 채** 이어서 비교하면 된다. 텍스트를 다시 읽지 않는다.

이 "접두사와 접미사가 얼마나 겹치는가"를 패턴의 모든 길이에 대해 미리 계산해 둔 표가 **실패 함수**(부분 일치 테이블)다. `pi[i]`는 패턴의 앞 `i+1`글자 안에서, **자기 자신과 완전히 겹치지 않는** 최장 접두사=접미사의 길이다. 매칭이 실패하는 순간 패턴 포인터는 `pi[직전까지 맞춘 길이 - 1]`로 점프하고, **텍스트 포인터는 단 한 번도 되돌아가지 않는다.** 이것이 KMP가 $O(n+m)$인 이유의 전부다 — 텍스트를 최대 한 번만 훑기 때문이다.

라빈-카프는 완전히 다른 접근이다. 패턴을 통째로 비교하는 대신 **패턴의 해시값**을 미리 계산해 두고, 텍스트의 길이 `m`짜리 창을 한 칸씩 밀며 그 창의 해시값과 비교한다. 창을 미는 연산이 $O(1)$이 되도록 **롤링 해시**를 쓴다 — 앞쪽 한 글자를 빼고 뒤쪽 한 글자를 더하는 계산만으로 새 해시를 구한다. 해시값 하나만 비교하면 되므로 패턴이 아무리 길어도 창 하나를 미는 비용은 상수다.

문제는 **해시가 같다고 문자열이 같다는 보장이 없다는 것**이다. 서로 다른 두 문자열이 같은 해시값을 낼 수 있고(충돌), 이 경우 실제로는 일치하지 않는데 일치했다고 착각하는 **spurious hit**(가짜 일치)이 생긴다. 그래서 해시가 일치하는 자리마다 반드시 실제 문자를 한 번 더 비교해 확인해야 한다. 이 확인을 생략하면 오답이고, 확인을 넣어도 최악의 경우(모든 창이 충돌하는 적대적 입력)에는 다시 $O(nm)$으로 돌아간다 — 평균은 $O(n+m)$이지만 보장은 아니다.

두 알고리즘은 용도가 다르다. **KMP는 한 텍스트에서 한 패턴을 찾을 때 최악의 경우도 보장된다.** 라빈-카프는 **같은 텍스트에서 여러 패턴을 동시에 찾거나(패턴마다 해시만 비교하면 되므로), 2차원 격자에서 패턴을 찾을 때**(이미지 매칭 — 행 방향으로 해시를 굴린 뒤 그 결과를 다시 열 방향으로 굴린다) 유리하다.

## 3. 손으로 따라가기

::: trace
패턴 `P = ABABAC`(길이 6). `pi[i]`는 `P[0..i]`의 접두사=접미사 최장 길이다. `k`는 비교 직전까지 이어져 온 겹침 길이.

| i | P[i] | 비교 대상 P[k] | 갱신 | pi[i] |
|---|---|---|---|---|
| 0 | A | — (k=0, 첫 글자는 항상 0) | — | 0 |
| 1 | B | k=0, P[0]=A, 불일치 | k 그대로 0 | 0 |
| 2 | A | k=0, P[0]=A, 일치 | k=1 | 1 |
| 3 | B | | | |
| 4 | A | | | |
| 5 | C | | | |

세 가지를 채워라. i=3, i=4는 순조롭다. **i=5에서 무슨 일이 나는지가 이 표의 핵심이다** — 한 번에 안 끝나고 여러 번 후퇴할 수 있다.
:::

::: answer
| i | P[i] | 비교 대상 P[k] | 갱신 | pi[i] |
|---|---|---|---|---|
| 0 | A | — (k=0, 첫 글자는 항상 0) | — | 0 |
| 1 | B | k=0, P[0]=A, 불일치 | k 그대로 0 | 0 |
| 2 | A | k=0, P[0]=A, 일치 | k=1 | 1 |
| 3 | B | k=1, P[1]=B, 일치 | k=2 | 2 |
| 4 | A | k=2, P[2]=A, 일치 | k=3 | 3 |
| 5 | C | k=3, P[3]=B, 불일치 → k=pi[2]=1, P[1]=B, 불일치 → k=pi[0]=0, P[0]=A, 불일치 | k=0 | 0 |

i=5에서 세 번 연속 불일치가 나는데, 그때마다 **패턴 포인터만** `pi`를 따라 후퇴한다. 이 표는 패턴 하나만으로 완결되고 아직 텍스트는 등장하지도 않았다 — 실패 함수는 패턴의 성질이지 매칭의 성질이 아니다.
:::

이어서 이 `pi = [0, 0, 1, 2, 3, 0]`을 실제 검색에 쓴다.

::: trace
텍스트 `T = ABABABABAC`(길이 10). `i`는 텍스트 포인터, `k`는 패턴 포인터(지금까지 일치한 길이).

| i | T[i] | 비교 전 k | 결과 | 비교 후 k |
|---|---|---|---|---|
| 0 | A | 0 | 일치 | 1 |
| 1 | B | 1 | 일치 | 2 |
| 2 | A | 2 | 일치 | 3 |
| 3 | B | | | |
| ... | | | | |
| 9 | C | | | |

i=3부터 8까지는 계속 일치가 이어지지 않는다 — 중간에 한 번 어긋난다. **그 자리에서 k가 몇 칸 물러나는지, 그리고 i가 그 순간에도 전진만 하는지**를 확인하라.
:::

::: answer
| i | T[i] | 비교 전 k | 결과 | 비교 후 k |
|---|---|---|---|---|
| 0 | A | 0 | 일치 | 1 |
| 1 | B | 1 | 일치 | 2 |
| 2 | A | 2 | 일치 | 3 |
| 3 | B | 3 | 일치 | 4 |
| 4 | A | 4 | 일치 | 5 |
| 5 | B | 5 | P[5]=C 와 불일치 → k=pi[4]=3, P[3]=B 와 재비교, 일치 | 4 |
| 6 | A | 4 | 일치 | 5 |
| 7 | B | 5 | P[5]=C 와 불일치 → k=pi[4]=3, P[3]=B 와 재비교, 일치 | 4 |
| 8 | A | 4 | 일치 | 5 |
| 9 | C | 5 | 일치, k=6=패턴 길이 → **매칭!** 시작 자리 = 9-6+1 = 4 | pi[5]=0으로 재설정 |

`i`열을 보라 — 0부터 9까지 **한 번도 줄지 않는다.** i=5에서 불일치가 났을 때 물러난 것은 `k`뿐이고, `k`가 세 칸(5→4)만 물러난 것도 실패 함수가 "직전까지 맞춘 `ABABA`의 접두사=접미사 겹침이 3"이라는 것을 이미 계산해 뒀기 때문이다. 텍스트를 다시 읽었다면 i=5에서 실패한 뒤 i=1로 되돌아가 재시도했을 것이다.
:::

## 4. 구현

::: dual
```python title="KMP — 실패 함수와 검색"
def build_failure(pattern):
    """실패 함수(부분 일치 테이블). pi[i] = pattern[0..i] 의 접두사=접미사 최대 길이."""
    m = len(pattern)
    pi = [0] * m
    k = 0
    for i in range(1, m):
        while k > 0 and pattern[i] != pattern[k]:
            k = pi[k - 1]           # 실패한 만큼 후퇴하지 않고 pi 를 따라 점프한다
        if pattern[i] == pattern[k]:
            k += 1
        pi[i] = k
    return pi


def kmp_search(text, pattern):
    """텍스트 포인터 i 는 절대 되돌아가지 않는다. 패턴 포인터 k 만 pi 를 따라 점프한다."""
    pi = build_failure(pattern)
    k = 0
    matches = []
    for i, ch in enumerate(text):
        while k > 0 and ch != pattern[k]:
            k = pi[k - 1]
        if ch == pattern[k]:
            k += 1
        if k == len(pattern):
            matches.append(i - len(pattern) + 1)
            k = pi[k - 1]            # 매칭 후에도 실패 함수를 따라 물러나야 겹치는 매칭을 안 놓친다
    return matches


pattern = "ABABAC"
text = "ABABABABAC"
pi = build_failure(pattern)
matches = kmp_search(text, pattern)
print("pattern  =", pattern)
print("pi       =", pi)
print("text     =", text)
print("matches  =", matches)
```
```cpp title="KMP — 실패 함수와 검색"
#include <cstdio>
#include <string>
#include <vector>
using namespace std;

vector<int> build_failure(const string& pattern) {
    // 실패 함수(부분 일치 테이블). pi[i] = pattern[0..i] 의 접두사=접미사 최대 길이.
    int m = (int)pattern.size();
    vector<int> pi(m, 0);
    int k = 0;
    for (int i = 1; i < m; i++) {
        while (k > 0 && pattern[i] != pattern[k])
            k = pi[k - 1];          // 실패한 만큼 후퇴하지 않고 pi 를 따라 점프한다
        if (pattern[i] == pattern[k]) k++;
        pi[i] = k;
    }
    return pi;
}

vector<int> kmp_search(const string& text, const string& pattern) {
    // 텍스트 포인터 i 는 절대 되돌아가지 않는다. 패턴 포인터 k 만 pi 를 따라 점프한다.
    vector<int> pi = build_failure(pattern);
    int k = 0;
    vector<int> matches;
    for (int i = 0; i < (int)text.size(); i++) {
        char ch = text[i];
        while (k > 0 && ch != pattern[k])
            k = pi[k - 1];
        if (ch == pattern[k]) k++;
        if (k == (int)pattern.size()) {
            matches.push_back(i - (int)pattern.size() + 1);
            k = pi[k - 1];           // 매칭 후에도 실패 함수를 따라 물러나야 겹치는 매칭을 안 놓친다
        }
    }
    return matches;
}

int main() {
    string pattern = "ABABAC";
    string text = "ABABABABAC";
    vector<int> pi = build_failure(pattern);
    vector<int> matches = kmp_search(text, pattern);
    printf("pattern  = %s\n", pattern.c_str());
    printf("pi       = [");
    for (size_t i = 0; i < pi.size(); i++) printf("%s%d", i ? ", " : "", pi[i]);
    printf("]\n");
    printf("text     = %s\n", text.c_str());
    printf("matches  = [");
    for (size_t i = 0; i < matches.size(); i++) printf("%s%d", i ? ", " : "", matches[i]);
    printf("]\n");
    return 0;
}
```
:::

```console
pattern  = ABABAC
pi       = [0, 0, 1, 2, 3, 0]
text     = ABABABABAC
matches  = [4]
```

**복잡도:** 시간 $O(n+m)$ — 실패 함수 전처리가 $O(m)$이다(패턴 포인터 `k`는 매 단계 최대 1 증가하고 `while`에서만 줄어드는데, 전체 감소량이 총 증가량을 넘을 수 없으므로 아모르티즈드 $O(m)$). 검색도 같은 논리로 $O(n)$이다 — 텍스트 포인터 `i`는 매번 정확히 1씩만 전진하고 절대 되돌아가지 않으며, 패턴 포인터 `k`의 후퇴 총량도 `k`가 늘어난 총량을 넘지 못해 아모르티즈드 $O(n)$이다. 공간 $O(m)$ — 실패 함수 배열.

| 언어 차이 | Python | C++ |
|---|---|---|
| 문자열 인덱싱 | `text[i]`가 매번 길이 1짜리 문자열 객체를 만든다 | `string::operator[]`가 `char` 참조를 반환, 둘 다 $O(1)$이지만 상수는 C++이 작다 |
| 배열 vs 벡터 | `pi = [0] * m`이 파이썬 리스트(포인터 배열) | `vector<int> pi(m, 0)`이 연속 메모리 — 캐시 지역성이 더 좋다 |

::: dual
```python title="라빈-카프 — 롤링 해시와 spurious hit 검증"
BASE = 256

def rabin_karp(text, pattern, mod):
    """해시가 같아도 반드시 실제 문자를 비교해 확인한다 — spurious hit 대응."""
    n, m = len(text), len(pattern)
    high = pow(BASE, m - 1, mod)      # 맨 앞 자리를 밀어낼 때 쓰는 자릿값
    hp = ht = 0
    for i in range(m):
        hp = (hp * BASE + ord(pattern[i])) % mod
        ht = (ht * BASE + ord(text[i])) % mod
    matches, spurious = [], []
    for i in range(n - m + 1):
        if i > 0:                                     # 창을 한 칸 밀며 해시를 O(1)에 갱신
            ht = ((ht - ord(text[i - 1]) * high) * BASE + ord(text[i + m - 1])) % mod
        if ht == hp:
            if text[i:i + m] == pattern:               # 해시가 같아도 반드시 확인한다
                matches.append(i)
            else:
                spurious.append(i)
    return matches, spurious


text, pattern = "AAAABABBBC", "AAAA"
m_weak, s_weak = rabin_karp(text, pattern, mod=7)           # 일부러 약한 나머지
m_safe, s_safe = rabin_karp(text, pattern, mod=1_000_000_007)
print("mod=7          matches=%s spurious=%s" % (m_weak, s_weak))
print("mod=1e9+7      matches=%s spurious=%s" % (m_safe, s_safe))
```
```cpp title="라빈-카프 — 롤링 해시와 spurious hit 검증"
#include <cstdio>
#include <string>
#include <vector>
using namespace std;

long long power_mod(long long base, long long exp, long long mod) {
    long long r = 1 % mod;
    base %= mod;
    while (exp > 0) {
        if (exp & 1) r = r * base % mod;
        base = base * base % mod;
        exp >>= 1;
    }
    return r;
}

void rabin_karp(const string& text, const string& pattern, long long mod,
                 vector<int>& matches, vector<int>& spurious) {
    // 해시가 같아도 반드시 실제 문자를 비교해 확인한다 — spurious hit 대응.
    int n = (int)text.size(), m = (int)pattern.size();
    long long BASE = 256;
    long long high = power_mod(BASE, m - 1, mod);    // 맨 앞 자리를 밀어낼 때 쓰는 자릿값
    long long hp = 0, ht = 0;
    for (int i = 0; i < m; i++) {
        hp = (hp * BASE + (unsigned char)pattern[i]) % mod;
        ht = (ht * BASE + (unsigned char)text[i]) % mod;
    }
    for (int i = 0; i + m <= n; i++) {
        if (i > 0) {                                 // 창을 한 칸 밀며 해시를 O(1)에 갱신
            long long sub = (ht - (unsigned char)text[i - 1] * high % mod + mod) % mod;
            ht = (sub * BASE + (unsigned char)text[i + m - 1]) % mod;
        }
        if (ht == hp) {
            if (text.substr(i, m) == pattern) matches.push_back(i);   // 해시가 같아도 반드시 확인한다
            else spurious.push_back(i);
        }
    }
}

int main() {
    string text = "AAAABABBBC", pattern = "AAAA";
    vector<int> m_weak, s_weak, m_safe, s_safe;
    rabin_karp(text, pattern, 7, m_weak, s_weak);                 // 일부러 약한 나머지
    rabin_karp(text, pattern, 1000000007, m_safe, s_safe);
    auto fmt = [](const vector<int>& v) {
        string s = "[";
        for (size_t i = 0; i < v.size(); i++) { if (i) s += ", "; s += to_string(v[i]); }
        return s + "]";
    };
    printf("mod=7          matches=%s spurious=%s\n", fmt(m_weak).c_str(), fmt(s_weak).c_str());
    printf("mod=1e9+7      matches=%s spurious=%s\n", fmt(m_safe).c_str(), fmt(s_safe).c_str());
    return 0;
}
```
:::

```console
mod=7          matches=[0] spurious=[5]
mod=1e9+7      matches=[0] spurious=[]
```

`mod=7`처럼 약한 나머지를 쓰면 `AAAA`와 `ABBB`가 같은 해시(2)를 낸다. 자리 5(`ABBB`)에서 해시가 일치하지만 실제 문자열은 다르므로 `spurious`에 걸린다 — 검증 없이 해시만 믿었다면 이 자리를 오답으로 답했을 것이다. `mod=1e9+7`처럼 충분히 큰 소수를 쓰면 이 작은 예제에서는 충돌이 사라진다.

**복잡도:** 평균 시간 $O(n+m)$ — 해시 전처리 $O(m)$, 창을 미는 연산이 각각 $O(1)$이라 텍스트를 한 번 훑는 데 $O(n)$. 단 **해시 충돌이 몰리는 적대적 입력에서는 매 충돌마다 실제 문자열을 검증해야 하므로 최악 $O(nm)$이다.** 공간 $O(1)$(해시값 몇 개) — 실패 함수처럼 패턴 길이만 한 배열을 두지 않는다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 나머지 연산의 부호 | `%`가 항상 0 이상을 낸다 | `%`는 피연산자 부호를 따라간다 — 뺄셈 뒤에는 `+ mod`로 보정해야 한다 |
| 정수 오버플로 | 임의 정밀도라 `BASE`를 곱해도 안전 | `long long`을 안 쓰면 `high * text[i-1]`류 계산에서 오버플로한다 |
| 거듭제곱 나머지 | `pow(BASE, m-1, mod)` 내장 | 직접 분할정복 거듭제곱(`power_mod`)을 짜야 한다 |

::: pitfall
- **`k = pi[k-1]`을 매칭 성공 후에 빼먹는다.** 매칭을 찾은 뒤 `k`를 패턴 길이로 그대로 두면 겹치는 매칭(패턴 `AA`, 텍스트 `AAA`처럼)을 놓친다. 매칭 후에도 실패했을 때와 똑같이 `pi`를 따라 물러나야 한다.
- **실패 함수의 인덱스 기준을 헷갈린다.** `pi[i]`는 `P[0..i]`(길이 `i+1`)에 대한 값이지 `P[0..i-1]`이 아니다. 오프바이원이 나면 대개 여기다.
- **라빈-카프에서 검증을 생략한다.** 해시가 같으면 바로 "찾았다"고 답하면 안 된다. 위 예제에서 `mod=7`을 쓰면 자리 5에서 오탐이 그대로 답에 섞인다.
- **단일 해시로 충분하다고 믿는다.** 경쟁 프로그래밍 저지 중에는 잘 알려진 (base, mod) 조합을 겨냥해 일부러 충돌을 유발하는 안티-해시 테스트 케이스가 있다. `mod`를 큰 소수로 잡고, 필요하면 서로 다른 두 개의 (base, mod) 쌍으로 이중 해시를 쓴다.
:::

## 5. 어디에 쓰이는가

**로그 스캔이 KMP·라빈-카프가 매일 실행되는 자리다.** 서버 로그 수백만 줄에서 특정 오류 서명이나 요청 ID를 찾는 스크립트는, 파일을 스트리밍으로 읽으며 텍스트 포인터를 뒤로 물리지 않고 앞으로만 훑어야 한다 — 로그는 디스크에서 순차로 읽어야 빠르고, 한 번 지나간 바이트를 다시 읽는 것은 그 자체로 I/O 낭비다. KMP의 "텍스트 포인터가 절대 되돌아가지 않는다"는 성질이 정확히 이 제약과 맞아떨어진다.

**`grep` 계열 도구의 근본 원리도 같은 곳에서 나온다.** GNU grep이 실제로 쓰는 것은 상황에 따라 Boyer-Moore 계열의 스킵 테이블이나, 여러 패턴을 한 번에 훑는 Aho-Corasick(KMP의 실패 함수를 여러 패턴으로 확장한 구조)이지만, 무엇을 쓰든 원칙은 하나다 — **이미 비교한 문자에서 얻은 정보를 다음 비교에 써먹는다.** 순진한 이중 루프처럼 매번 백지에서 다시 시작하는 방식은 대용량 로그를 훑는 도구로 쓰이지 않는다.

## 6. 이 유형을 알아보는 법

::: classify
- 신호어: "문자열 S에서 P가 몇 번/어디에 나타나는가", "부분 문자열인지 판별", "패턴이 텍스트에 포함되는가", 로그에서 "특정 문구를 찾아라"
- 제약조건: 텍스트 길이 $n$, 패턴 길이 $m$이 합쳐서 $10^6$ 근방까지 흔하다. $O(nm)$은 $n=m=1000$만 넘어도 위험하고, $n, m \ge 10^5$면 반드시 $O(n+m)$급이 필요하다([0-9](#/0-9))
- 혼동 주의: 패턴이 **여러 개**면 Aho-Corasick으로 확장한다(KMP 실패 함수의 다중 패턴 버전, 이 챕터 범위 밖). 문자열 안의 **가장 짧은 반복 주기**를 물으면 실패 함수 하나로 곧장 풀리는 별개 유형이다 — `pi[m-1]`이 힌트를 준다. 임의 두 부분 문자열을 비교하는 문제는 접미사 배열·접미사 자동자가 필요해 이 책 범위 밖이다
- 반례 함정: `text.find()`나 `in` 연산자로 통과하는 작은 예제가 실전 크기(수십만 자)에서 시간 초과로 죽는다. C++에서 `string::find`를 반복 호출하거나 직접 짠 이중 루프는 그대로 $O(nm)$이다
:::

::: interview
**"KMP가 왜 텍스트를 두 번 이상 안 읽습니까?"** 실패 함수가 "지금까지 맞춘 부분의 접두사=접미사 겹침"을 미리 계산해 두기 때문에, 매칭이 실패해도 텍스트 쪽에서 이미 확인된 정보(그 구간이 무엇으로 이루어져 있는지)는 그대로 유효하다. 그래서 패턴 포인터만 그 겹침만큼 후퇴시키고, 텍스트 포인터는 전진만 한다. "포인터가 되돌아가지 않는다"는 사실 자체가 $O(n)$ 상한의 근거다.
:::

## 연습

::: quiz
**1. 백준 1786 찾기 (골드 1)** — https://www.acmicpc.net/problem/1786
- 신호: 텍스트에서 패턴이 나타나는 **모든** 자리를 구하라. 텍스트 길이가 최대 백만.
- 상태: 실패 함수 `pi[0..m-1]`과 검색 중의 패턴 포인터 `k`.
- 자료구조: `pi` 배열 하나. 매칭이 될 때마다 `k`를 0으로 초기화하지 않고 `pi[k-1]`로 물려야 겹치는 매칭도 놓치지 않는다.

**2. 백준 1305 광고 (골드 5)** — https://www.acmicpc.net/problem/1305
- 신호: 무한 반복되는 문자열에서 한 조각만 봤을 때, 원래 반복 단위의 최소 길이를 구하라.
- 상태: 실패 함수 하나로 끝난다. 전체 문자열의 `pi[n-1]`이 "접두사=접미사로 겹치는 최대 길이"이므로, 전체 길이에서 그 값을 빼면 겹치지 않는 최소 반복 단위 길이다.
- 자료구조: 검색 단계는 필요 없다. 실패 함수 계산 함수 하나만 그대로 재사용한다 — "매칭"이 아니라 "자기 자신과의 겹침"을 묻는 문제라는 것을 알아채는 게 전부다.

**3. 백준 16916 부분 문자열 (실버 1)** — https://www.acmicpc.net/problem/16916
- 신호: P가 S의 부분 문자열인지 참/거짓만 묻는다. 문자열 길이가 최대 백만.
- 상태: KMP라면 실패 함수 + 검색 포인터. 라빈-카프라면 패턴 해시 하나와 텍스트의 굴리는 해시.
- 자료구조: 존재 여부만 물으므로 어느 쪽을 골라도 되지만, 라빈-카프를 고른다면 **반드시 해시 일치 시 실제 문자열 비교를 넣어야** 정답을 보장한다.
:::

## 요약

- 순진한 매칭은 시작 자리마다 패턴을 처음부터 다시 비교해 $O(nm)$이다. 텍스트 길이 5000·패턴 500 예제에서 225만 번 비교한다.
- KMP의 핵심은 **실패 함수**다. `pi[i]`가 "패턴 앞 `i+1`글자의 접두사=접미사 최장 겹침"을 미리 계산해 두면, 매칭 실패 시 패턴 포인터만 그 값만큼 후퇴하고 **텍스트 포인터는 절대 되돌아가지 않는다.**
- 같은 예제에서 KMP는 9,500번만 비교한다 — 237배 차이.
- 라빈-카프는 **롤링 해시**로 창을 $O(1)$에 민다. 해시가 같아도 실제로 같다는 보장이 없어 **반드시 문자 비교로 검증**해야 한다 — 검증을 생략하면 spurious hit이 오답으로 이어진다.
- 여러 패턴을 동시에 찾거나 2차원 매칭에는 라빈-카프 계열의 해시 비교가 자연스럽게 확장된다. 최악의 경우 보장이 필요하면 KMP다.
- 로그 스캔과 `grep`류 도구가 이 원리 위에 서 있다 — 어떤 구체적 알고리즘을 쓰든 "이미 읽은 문자를 버리지 않는다"는 원칙은 같다.

**다음 절**: [IX-8 네트워크 플로우 입문](#/ix-8) — 이번엔 문자열이 아니라 그래프다. 파이프로 연결된 네트워크에서 흘려보낼 수 있는 최대량을 구한다.
