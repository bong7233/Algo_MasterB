# XV-4 블룸 필터와 쿠쿠 필터

::: lead
"이 URL을 이미 크롤링했는가"를 10억 개 집합에 대해 매번 물어야 할 때, 그 집합을 통째로 들고 있지 않고 답하는 법.
:::

## 1. 문제

크롤러가 URL을 하나 볼 때마다 "이미 방문했는가"를 물어야 한다. 방문한 URL이 10억 개면 답은 간단해 보인다 — 해시셋에 전부 넣고 조회하면 된다. `set`은 [II-6](#/ii-6)에서 본 것처럼 평균 $O(1)$ 조회다.

문제는 크기다. URL 하나가 평균 60바이트라 치면, 문자열 자체와 해시 테이블의 버킷 오버헤드를 합쳐 항목당 100바이트를 훌쩍 넘긴다. 10억 개면 100GB 안팎이다. 크롤러 서버 한 대의 메모리에 다 들어가지 않는다. [XV-1](#/xv-1)에서 본 문제가 여기서도 반복된다 — 메모리를 벗어나는 순간 디스크를 뒤져야 하고, 초당 수천 건의 "이미 봤는가" 질문에 디스크 접근은 너무 느리다.

그런데 이 질문에는 특이한 점이 있다. **"있다"의 정답이 조금 틀려도 감당할 수 있다.** 새 URL을 "이미 봤다"고 잘못 판단하면 그 URL을 한 번 덜 크롤링할 뿐이다. 손해는 있지만 치명적이지 않다. 반대로 "안 봤다"고 잘못 판단해 이미 크롤링한 URL을 또 크롤링하면 낭비가 반복될 뿐 정확성은 안 깨진다. **한쪽 방향의 오류만 허용되는 질문**이고, 그 비대칭을 이용하면 집합 전체를 저장하지 않고도 답할 수 있다.

블룸 필터는 이 교환을 정면으로 받아들인다. 10억 개를 100GB가 아니라 1~2GB의 비트 배열로 표현하고, 대신 가끔 틀린다 — 단 **한 방향으로만.**

## 2. 아이디어

::: widget bloom-filter {"m":40,"k":3,"items":["cat","dog","bird"],"query":"rat","mode":"insert-then-query","show":["bits","hashPositions","falsePositive"]}
:::

비트 배열 $m$칸을 전부 0으로 채운 채로 시작한다. 원소를 넣을 때는 서로 다른 해시 함수 $k$개로 그 원소를 $k$개의 칸에 매핑하고, 그 칸을 전부 1로 켠다. 조회할 때는 같은 $k$개 칸을 다시 계산해서 **전부 1인지** 본다.

- 하나라도 0이면 — 그 원소를 넣은 적이 없다. **이건 확실하다.** 넣었다면 그 칸은 반드시 1이었을 것이다.
- $k$개가 전부 1이면 — 넣었을 수도 있고, **다른 원소들이 우연히 그 칸들을 전부 채워 놓은 것일 수도 있다.**

이것이 비대칭의 정체다. **"없다"는 항상 옳다. "있다"는 틀릴 수 있다.** 이걸 거짓양성(false positive)이라 부르고, 거짓음성(false negative)은 원천적으로 나오지 않는다. 크롤러 예시에서 딱 필요한 그 성질이다 — "이미 봤다"는 가끔 틀려도 되고 "안 봤다"는 절대 틀리면 안 된다.

원소가 쌓일수록 켜진 칸이 늘어나고, 우연히 다 켜진 칸으로 이루어진 조회가 늘어난다. 그래서 원소 수 $n$이 늘면 거짓양성률도 오른다. **비트 하나를 끄는 연산이 없다는 것**도 중요하다. 여러 원소가 같은 칸을 공유하므로, 원소 하나를 지우려고 그 칸을 0으로 되돌리면 그 칸을 같이 쓰던 다른 원소들이 갑자기 "없다"고 오판된다 — 이건 거짓음성이고, 블룸 필터가 절대 내면 안 되는 오류다. **그래서 표준 블룸 필터는 삭제를 지원하지 않는다.**

쿠쿠 필터는 다른 길을 택한다. 비트를 공유해서 켜는 대신, 원소마다 짧은 지문(fingerprint)을 만들어 **두 후보 슬롯 중 하나**에 저장한다. 슬롯이 이미 차 있으면 그 자리의 기존 지문을 다른 후보 슬롯으로 쫓아낸다(cuckoo hashing의 그 새 이름이다) — 쫓겨난 지문이 또 남의 자리를 쫓아내며 몇 번 튕기다가 빈 자리에 안착한다. 지문이 슬롯 하나를 독점하므로 **그 지문만 지우면 된다.** 다른 원소의 자리를 건드리지 않는다. 대가는 두 가지다. 지문이 짧을수록(공간을 아낄수록) 서로 다른 원소가 같은 지문을 가질 확률이 올라가 거짓양성이 늘고, 테이블이 꽉 차면(적재율 90% 근방) 쫓아내기가 계속 실패해 삽입 자체가 막힌다.

## 3. 손으로 따라가기

::: trace
$m = 20$칸, $k = 2$. 손으로 계산 가능한 단순 해시를 쓴다 — $h_1(x) = (\sum \text{문자코드}) \bmod 20$, $h_2(x) = (\sum \text{문자코드} \times 7 + 3) \bmod 20$. (실제 구현은 더 나은 해시를 쓴다. 여기서는 계산 과정만 본다.)

| 연산 | 문자코드 합 | $h_1$ | $h_2$ | 켜지는 칸 | 그 시점 비트(켜진 칸만) |
|---|---|---|---|---|---|
| insert("cat") | 99+97+116=312 | 12 | 7 | 12, 7 | {7, 12} |
| insert("dog") | 100+111+103=314 | 14 | 1 | 14, 1 | {1, 7, 12, 14} |
| query("fox") | | | | | |
| query("rat") | | | | | |
:::

::: answer
| 연산 | 문자코드 합 | $h_1$ | $h_2$ | 켜지는 칸 | 그 시점 비트(켜진 칸만) |
|---|---|---|---|---|---|
| insert("cat") | 312 | 12 | 7 | 12, 7 | {7, 12} |
| insert("dog") | 314 | 14 | 1 | 14, 1 | {1, 7, 12, 14} |
| query("fox") | 102+111+120=333 | 13 | 14 | 13, 14 확인 | 13은 꺼져 있음 → **"없다" (정확)** |
| query("rat") | 114+97+116=327 | 7 | 12 | 7, 12 확인 | 둘 다 켜져 있음 → **"있다" (거짓양성)** |
:::

"rat"는 한 번도 넣은 적이 없다. 그런데 우연히 $h_1(\text{rat}) = 7$과 $h_2(\text{rat}) = 12$가 "cat"과 "dog"이 이미 켜 놓은 칸과 정확히 겹쳐서 필터는 "있다"고 답한다. 이것이 거짓양성이다. 반대로 "fox"는 두 칸 중 하나(13)가 꺼져 있어서 필터가 확신을 갖고 "없다"고 답한다 — **이 판정은 절대 틀리지 않는다.**

## 4. 구현

::: dual
```python title="블룸 필터 — 삽입·조회·거짓양성률 실측"
import math


M = 100000   # 비트 배열 크기
N = 10000    # 삽입 원소 수
K = 7        # 해시 함수 개수


def fnv1a(s: str) -> int:
    """FNV-1a 64비트 해시. 표준 라이브러리 hash()는 실행마다 시드가
    바뀌어(문자열 해시 무작위화) 재현이 안 되므로 직접 구현한다."""
    h = 0xcbf29ce484222325
    for b in s.encode():
        h ^= b
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h


def positions(item, m, k):
    """서로 독립적인 k개의 칸. 해시마다 다른 솔트를 섞어 만든다."""
    for i in range(k):
        yield fnv1a("%d#%s" % (i, item)) % m


bits = bytearray(M)
for i in range(N):
    for p in positions("item%d" % i, M, K):
        bits[p] = 1

fp = 0
Q = 200000
for i in range(Q):
    item = "q%d" % i          # 삽입한 적 없는 이름공간
    if all(bits[p] for p in positions(item, M, K)):
        fp += 1

measured = fp / Q
theory = (1 - math.exp(-K * N / M)) ** K
print("m=%d n=%d k=%d" % (M, N, K))
print("측정 거짓양성률 = %.5f (%d/%d)" % (measured, fp, Q))
print("이론 거짓양성률 = %.5f" % theory)
```
```cpp title="블룸 필터 — 삽입·조회·거짓양성률 실측"
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <string>
#include <vector>
using namespace std;

const int M = 100000;
const int N = 10000;
const int K = 7;

// FNV-1a 64비트 해시. 표준 hash<string> 대신 직접 구현해 두 언어의
// 결과가 정확히 일치하도록 만든다.
uint64_t fnv1a(const string& s) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (unsigned char b : s) {
        h ^= b;
        h *= 0x100000001b3ULL;
    }
    return h;
}

// 서로 독립적인 k개의 칸. 해시마다 다른 솔트를 섞어 만든다.
void positions(const string& item, int m, int k, vector<int>& out) {
    out.clear();
    for (int i = 0; i < k; i++)
        out.push_back((int)(fnv1a(to_string(i) + "#" + item) % (uint64_t)m));
}

int main() {
    vector<uint8_t> bits(M, 0);
    vector<int> pos;
    for (int i = 0; i < N; i++) {
        positions("item" + to_string(i), M, K, pos);
        for (int p : pos) bits[p] = 1;
    }
    int fp = 0, Q = 200000;
    for (int i = 0; i < Q; i++) {
        positions("q" + to_string(i), M, K, pos);   // 삽입한 적 없는 이름공간
        bool all_set = true;
        for (int p : pos) if (!bits[p]) { all_set = false; break; }
        if (all_set) fp++;
    }
    double measured = (double)fp / Q;
    double theory = pow(1.0 - exp(-1.0 * K * N / M), K);
    printf("m=%d n=%d k=%d\n", M, N, K);
    printf("측정 거짓양성률 = %.5f (%d/%d)\n", measured, fp, Q);
    printf("이론 거짓양성률 = %.5f\n", theory);
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
m=100000 n=10000 k=7
측정 거짓양성률 = 0.00838 (1676/200000)
이론 거짓양성률 = 0.00819
```

측정값 0.00838이 이론값 $(1-e^{-kn/m})^k = 0.00819$와 거의 일치한다. 삽입 이름공간(`item0`..`item9999`)과 조회 이름공간(`q0`..`q199999`)을 서로 겹치지 않게 고정 문자열로 정해 두었기 때문에, 이 실행은 난수 시드와 무관하게 항상 같은 숫자를 낸다. (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측.)

**복잡도:** 삽입·조회 모두 시간 $O(k)$ — 해시 $k$번 계산하고 비트 $k$개를 읽거나 쓴다. $n$이나 $m$과 무관하다. 공간 $O(m)$ — 원소 하나당 비트 하나가 아니라 배열 전체가 $m$비트다. 원소 수가 아니라 **미리 정한 용량**이 공간을 결정한다는 점이 해시셋과 근본적으로 다르다.

::: dual
```python title="쿠쿠 필터 — 지문 삽입·조회·삭제"
M = 16       # 슬롯 수
FBITS = 8    # 지문 비트수
MAX_KICK = 20


def fnv1a(s: str) -> int:
    h = 0xcbf29ce484222325
    for b in s.encode():
        h ^= b
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h


def fingerprint(x: str) -> int:
    fp = fnv1a("fp#" + x) & ((1 << FBITS) - 1)
    return fp if fp != 0 else 1     # 0은 "빈 슬롯" 표식으로 남겨 둔다


def index1(x: str) -> int:
    return fnv1a("i1#" + x) % M


def index2(i: int, fp: int) -> int:
    # 부분키 쿠쿠 해싱: 지문만 알면 index2를 계산할 수 있다.
    # i ^ h(fp) 는 자기 자신에 대해 대합(involution)이라
    # index2(index2(i, fp), fp) == i 가 항상 성립한다.
    return (i ^ fnv1a("i2#" + str(fp))) % M


table = [0] * M


def insert(x: str) -> bool:
    fp = fingerprint(x)
    i = index1(x)
    for _ in range(MAX_KICK):
        if table[i] == 0:
            table[i] = fp
            return True
        table[i], fp = fp, table[i]   # 기존 지문을 쫓아내고 그 자리를 차지한다
        i = index2(i, fp)             # 쫓겨난 지문의 다른 후보 슬롯
    return False


def lookup(x: str) -> bool:
    fp = fingerprint(x)
    i = index1(x)
    j = index2(i, fp)
    return table[i] == fp or table[j] == fp


def delete(x: str) -> bool:
    fp = fingerprint(x)
    i = index1(x)
    j = index2(i, fp)
    if table[i] == fp:
        table[i] = 0
        return True
    if table[j] == fp:
        table[j] = 0
        return True
    return False


for w in ["cat", "dog", "owl", "fox", "cow", "bee"]:
    print(w, insert(w))
print("table", table)
print("lookup cat", lookup("cat"))
print("delete dog", delete("dog"))
print("lookup dog after delete", lookup("dog"))
print("lookup cat still there", lookup("cat"))
print("lookup owl still there", lookup("owl"))
```
```cpp title="쿠쿠 필터 — 지문 삽입·조회·삭제"
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
using namespace std;

const int M = 16;
const int FBITS = 8;
const int MAX_KICK = 20;

uint64_t fnv1a(const string& s) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (unsigned char b : s) { h ^= b; h *= 0x100000001b3ULL; }
    return h;
}

int fingerprint(const string& x) {
    int fp = (int)(fnv1a("fp#" + x) & ((1u << FBITS) - 1));
    return fp != 0 ? fp : 1;        // 0은 "빈 슬롯" 표식으로 남겨 둔다
}

int index1(const string& x) { return (int)(fnv1a("i1#" + x) % M); }

// 부분키 쿠쿠 해싱: i ^ h(fp) 는 대합이라 index2(index2(i,fp),fp) == i.
int index2(int i, int fp) { return (int)((i ^ fnv1a("i2#" + to_string(fp))) % M); }

vector<int> table(M, 0);

bool insert(const string& x) {
    int fp = fingerprint(x);
    int i = index1(x);
    for (int t = 0; t < MAX_KICK; t++) {
        if (table[i] == 0) { table[i] = fp; return true; }
        swap(table[i], fp);         // 기존 지문을 쫓아내고 그 자리를 차지한다
        i = index2(i, fp);          // 쫓겨난 지문의 다른 후보 슬롯
    }
    return false;
}

bool lookup(const string& x) {
    int fp = fingerprint(x);
    int i = index1(x);
    int j = index2(i, fp);
    return table[i] == fp || table[j] == fp;
}

bool erase_key(const string& x) {
    int fp = fingerprint(x);
    int i = index1(x);
    int j = index2(i, fp);
    if (table[i] == fp) { table[i] = 0; return true; }
    if (table[j] == fp) { table[j] = 0; return true; }
    return false;
}

int main() {
    vector<string> words = {"cat", "dog", "owl", "fox", "cow", "bee"};
    for (auto& w : words) printf("%s %s\n", w.c_str(), insert(w) ? "True" : "False");
    printf("table [");
    for (int i = 0; i < M; i++) printf("%s%d", i ? ", " : "", table[i]);
    printf("]\n");
    printf("lookup cat %s\n", lookup("cat") ? "True" : "False");
    printf("delete dog %s\n", erase_key("dog") ? "True" : "False");
    printf("lookup dog after delete %s\n", lookup("dog") ? "True" : "False");
    printf("lookup cat still there %s\n", lookup("cat") ? "True" : "False");
    printf("lookup owl still there %s\n", lookup("owl") ? "True" : "False");
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
cat True
dog True
owl True
fox True
cow True
bee True
table [156, 0, 0, 0, 0, 0, 0, 0, 60, 117, 62, 71, 0, 0, 114, 0]
lookup cat True
delete dog True
lookup dog after delete False
lookup cat still there True
lookup owl still there True
```

**복잡도:** 삽입은 평균 $O(1)$, 최악 $O(\text{MAX\_KICK})$ — 적재율이 낮으면 대개 첫 시도에서 빈 슬롯을 찾지만, 테이블이 꽉 차 갈수록 쫓아내기 사슬이 길어진다. 조회·삭제는 $O(1)$ — 후보 슬롯 두 곳만 본다. 공간은 원소당 지문 비트수(여기선 8비트)로, 같은 오차율의 블룸 필터보다 조금 더 압축된다.

`dog`을 지운 뒤 `dog`의 조회만 `False`로 바뀌고 `cat`·`owl`은 그대로 `True`다. 블룸 필터라면 `dog`이 켰던 비트 중 다른 원소와 공유되지 않은 비트만 확신을 갖고 끌 수 있는데, 어느 비트가 공유되는지 필터 자신은 알 방법이 없다 — 그래서 아예 끄지 않는 쪽을 표준으로 삼는다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 비트 배열 | `bytearray` — 원소당 1바이트, 파이썬 레벨에선 어차피 이보다 압축 못 한다 | `vector<uint8_t>`. 진짜 1비트씩 packing하려면 `vector<bool>`(특수화된 비트 벡터)이나 `std::bitset` |
| 정수 오버플로 | 없음. `& 0xFFFFFFFFFFFFFFFF`로 64비트를 흉내만 낸다 | `uint64_t` 곱셈은 자동으로 64비트에서 랩어라운드한다 — 마스킹이 필요 없다 |
| 지문 스왑 | `table[i], fp = fp, table[i]` 튜플 언패킹 | `swap(table[i], fp)` |

::: pitfall
- **해시 함수 $k$개를 서로 다른 알고리즘으로 만들려 하지 마라.** 한 개의 좋은 해시에 서로 다른 솔트를 섞는 편이 구현이 간단하고 품질도 충분하다. 위 코드가 그 방식이다.
- **`hash()` 내장 함수를 그대로 쓰면 재현이 안 된다.** 파이썬은 보안을 위해 문자열 해시를 실행마다 무작위 시드로 섞는다(`PYTHONHASHSEED`). 같은 입력인데 실행마다 거짓양성률이 달라 보이는 원인 대부분이 이것이다. C++의 `std::hash<std::string>`도 구현체마다 다르고 표준이 값을 못박지 않으므로, 두 언어의 결과를 맞춰야 하는 상황에서는 위 코드처럼 직접 구현한 해시를 쓰는 편이 안전하다.
- **적재율을 안 재고 $m$을 정한다.** 위 실측처럼 $kn/m$을 계산해 목표 거짓양성률에 맞는 $m$을 먼저 정하라. 원소 수를 못 예측하면 $m$이 작아 필터가 거의 항상 "있다"고 답하는 지경까지 간다 — 비트가 거의 다 켜지면 어떤 조회도 걸러지지 않으므로, 필터를 두는 의미 자체가 사라진다.
- **쿠쿠 필터에서 지문을 0으로 만들 수 있다는 것을 놓친다.** 0은 "빈 슬롯" 표식과 충돌하므로, 계산된 지문이 0이면 강제로 다른 값(위 코드는 1)으로 바꿔야 한다. 안 바꾸면 방금 넣은 원소가 자기 자신을 "없다"고 답하는 버그가 난다.
:::

::: interview
**"블룸 필터의 $m$(비트 수)과 $k$(해시 개수)를 어떻게 정합니까."**
"목표 원소 수 $n$과 허용 가능한 거짓양성률 $p$에서 거꾸로 계산합니다. $m = -\frac{n \ln p}{(\ln 2)^2}$로 필요한 비트 수를 구하고, 그 $m, n$에서 최적 해시 개수는 $k = \frac{m}{n}\ln 2$입니다. 예를 들어 원소 백만 개에 거짓양성률 1%를 원하면 $m$은 약 950만 비트(1.2MB 근방)이고 $k$는 7 근처입니다. 해시 개수를 최적값보다 늘리면 오히려 거짓양성률이 다시 오릅니다 — 비트가 더 빨리 차기 때문입니다."
:::

## 5. 어디에 쓰이는가

**LSM Tree의 SSTable 스킵이 블룸 필터의 대표 용례다.** RocksDB나 LevelDB 같은 구현체가 실제로 이 방식을 쓴다. [XV-3](#/xv-3)에서 본 것처럼 LSM은 데이터가 여러 레벨의 SSTable로 흩어져 있어 하나를 조회하려면 여러 파일을 뒤질 수 있다. 각 SSTable마다 블룸 필터를 하나씩 붙여 두면, 조회할 키가 그 파일에 "없다"고 필터가 확신할 때 그 파일을 아예 열지 않고 건너뛴다. 디스크 접근 한 번을 메모리 안의 비트 검사로 대체하는 것이고, 거짓음성이 없다는 성질이 정확히 이 용도에 필요한 보장이다 — 필터가 "없다"고 하면 정말 없다.

크롤러의 중복 URL 검출, CDN 캐시의 "이 콘텐츠를 캐시에 넣을 가치가 있는가"(한 번만 요청된 항목은 거르는 필터) 같은 용례도 같은 형태다. **모두 "존재 여부를 확인하되, 정답이 틀려도 한쪽 방향으로만 틀리는 것을 감당할 수 있는" 상황**이다.

브라우저의 안전하지 않은 URL 차단 기능도 같은 형태로 동작한다고 알려져 있다 — 알려진 악성 URL 수억 개의 목록을 기기마다 내려받아 정확히 대조하는 대신, 블룸 필터로 "이 URL은 목록에 없을 수도 있다"를 로컬에서 즉시 걸러내고, 필터가 "있을 수도 있다"고 답한 소수의 경우에만 서버에 재확인을 요청한다. 로컬 저장 공간과 네트워크 왕복 둘 다를 아끼는 설계다.

## 연습

::: quiz
- 상황: 검색 엔진 크롤러가 하루 수십억 건의 URL을 본다. 이미 방문한 URL 집합은 서버 한 대의 메모리를 넘는다.
- 무엇이 병목이거나 깨지는가: 해시셋으로 정확히 관리하면 항목당 100바이트가 넘어 메모리가 수백 GB로 부푼다. 디스크로 옮기면 초당 수천 건의 조회가 디스크 지연에 걸린다.
- 어떤 구조이고 무엇을 대가로 치르는가: 블룸 필터로 "방문한 적 있다"만 빠르게 걸러낸다. 대가는 가끔 새 URL을 잘못 걸러 크롤링을 한 번 놓치는 것 — 크롤러 입장에서는 URL 하나를 나중에 다시 발견할 기회가 있으므로 감당 가능하다.

- 상황: 분산 캐시에서 만료된 항목을 지워야 하는데, 그 항목이 블룸 필터로 존재 여부를 표시되어 있었다.
- 무엇이 병목이거나 깨지는가: 그 항목이 켠 비트를 그냥 끄면, 같은 비트를 공유하는 다른(살아 있는) 항목까지 "없다"고 오판된다 — 거짓음성이 생겨 원래 감당할 수 없던 방향의 오류가 발생한다.
- 어떤 구조이고 무엇을 대가로 치르는가: 삭제가 필요하면 처음부터 쿠쿠 필터를 쓴다. 지문이 슬롯 하나를 독점하므로 그 슬롯만 비우면 되고 다른 항목은 영향받지 않는다. 대가는 적재율이 높을 때 삽입이 실패할 수 있다는 것 — 테이블 크기를 여유 있게 잡아야 한다.

- 상황: 초당 수만 건의 요청 URL 중 일부만 실제 콘텐츠 서버까지 보내고, 캐시 미스가 확실한 것은 앞단에서 걸러 응답 시간을 줄이고 싶다.
- 무엇이 병목이거나 깨지는가: 모든 요청을 캐시 서버까지 보내면 캐시 서버의 조회 자체가 병목이 된다. 애초에 캐시에 없는 것이 뻔한 요청까지 왕복시키는 낭비다.
- 어떤 구조이고 무엇을 대가로 치르는가: 캐시 앞단에 "캐시에 있을 수도 있는 키" 블룸 필터를 둔다. 필터가 "없다"고 하면 캐시 서버를 아예 안 거치고 원본으로 보낸다. 대가는 필터 갱신 지연 — 캐시에 방금 채워진 키가 필터에 아직 반영 안 됐으면 불필요한 원본 요청이 한 번 더 나간다.
:::

## 요약

- 블룸 필터는 비트 배열 $m$칸과 해시 함수 $k$개로 집합 소속을 근사한다. 원소를 넣으면 $k$개 칸을 켜고, 조회는 그 칸이 전부 켜져 있는지 본다.
- **거짓양성은 있고 거짓음성은 없다.** "없다"는 항상 옳고 "있다"는 우연히 틀릴 수 있다. 이 비대칭이 성립하는 상황에서만 쓸모가 있는 구조다.
- 실측 거짓양성률(0.00838)이 이론값 $(1-e^{-kn/m})^k = 0.00819$와 거의 일치한다 — 공식이 실제로 이 필터의 동작을 정확히 설명한다.
- 비트가 여러 원소에 공유되므로 **표준 블룸 필터는 삭제를 지원하지 않는다.** 비트 하나를 끄면 그 비트를 공유하는 다른 원소가 거짓음성을 얻는다.
- 쿠쿠 필터는 원소마다 짧은 지문을 두 후보 슬롯 중 하나에 저장해 **슬롯 하나를 원소 하나가 독점**하게 만든다. 그래서 삭제가 가능하다. 대가는 적재율이 높을 때 삽입 실패 가능성이 생긴다는 것이다.
- 대표 용례는 [XV-3](#/xv-3) LSM Tree의 SSTable 스킵 — 디스크 파일을 열기 전에 "이 파일엔 없다"를 메모리에서 걸러낸다.
- 이 챕터에서 시작한 **정확성을 메모리와 교환하는 계보**는 [XV-5 스킵 리스트](#/xv-5)와 [XV-6 카디널리티·빈도 추정](#/xv-6)으로 이어진다. 세 챕터가 공통으로 답하는 질문은 하나다 — 정답을 조금 양보하면 메모리를 몇 자릿수까지 줄일 수 있는가.

**다음 절**: [XV-5 스킵 리스트](#/xv-5) — 이번엔 존재 여부가 아니라 정렬 순서를, 근사가 아니라 확률로 유지하는 자료구조를 본다.
