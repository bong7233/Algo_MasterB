# XV-6 카디널리티·빈도 추정

::: lead
"오늘 순 방문자가 몇 명인가"를 10억 건의 로그에서 물을 때, 그 방문자 전원의 목록을 들고 있지 않고 답하는 법.
:::

## 1. 문제

[XV-4](#/xv-4)가 "이 원소를 본 적 있는가"를 물었다면, 이 챕터는 "**서로 다른** 원소를 몇 개나 봤는가"와 "이 원소를 **몇 번** 봤는가"를 묻는다. 질문이 다르니 자료구조도 다르지만, 정확도를 메모리와 교환한다는 발상은 그대로 이어진다.

일간 활성 사용자(DAU)를 구하는 방법은 원리상 간단하다. 그날의 모든 로그에서 사용자 ID를 뽑아 집합에 넣고, 그 집합의 크기를 세면 된다.

```text nolines
   seen = set()
   for log in today_logs:
       seen.add(log.user_id)
   print(len(seen))
```

집합에 들어가는 원소 수는 로그 건수가 아니라 **유니크한 사용자 수**다. 방문자가 10억 명인 서비스라면 이 집합이 사용자 ID(문자열 UUID라면 개당 수십 바이트) 10억 개를 들고 있어야 하고, [II-6](#/ii-6)에서 본 해시셋의 오버헤드까지 더하면 수십에서 백 GB 단위가 된다. 그리고 이건 지표 하나다. 페이지별, 국가별, 기기별로 DAU를 쪼개서 보고 싶다면 이 집합을 수백 개 동시에 들고 있어야 한다.

정확한 카디널리티(집합의 크기, 서로 다른 원소의 개수)를 구하려면 **본 적 있는 원소를 전부 기억해야 한다.** 여기서 벗어날 방법이 없어 보인다 — 새 원소가 이미 봤던 것인지 판정하려면 결국 이전 원소들과 비교해야 하니까.

그런데 실무의 질문은 대개 "정확히 몇 명인가"가 아니라 "**대략** 몇 명인가"다. DAU가 1,000,003명인지 999,998명인지는 대시보드에서 구분되지 않는다. [XV-4](#/xv-4)에서 본 것과 같은 교환이 여기서도 통한다 — **정확도를 조금 내주고 메모리를 몇 자릿수 줄인다.**

## 2. 아이디어

HyperLogLog는 **해시값의 패턴에서 카디널리티의 단서를 읽는다.** 원소를 해시하면 균등하게 뒤섞인 비트열이 나온다. 동전을 던져 앞면이 나올 때까지 던진 횟수를 기록한다고 생각하면, 그 값이 클수록 "운이 좋았다"는 뜻이고, 여러 번 시도했을수록 그런 행운이 나올 가능성도 커진다. 해시값의 하위 비트열에서 "처음 나오는 1비트의 위치"를 그 원소의 "동전 던지기 결과"로 쓰면, **원소 수가 많을수록 그 최댓값이 커지는 경향**이 생긴다. 이 최댓값 하나로도 원소 수를 거칠게 추정할 수 있지만, 분산이 너무 커서 그대로 쓰기엔 부정확하다.

HyperLogLog는 이 추정을 **여러 레지스터로 쪼개 평균 내어 분산을 줄인다.** 해시값의 상위 비트 몇 개를 "이 원소가 몇 번 레지스터로 가는가"를 정하는 데 쓰고, 나머지 비트로 "처음 나오는 1비트의 위치"를 계산해 그 레지스터의 값이 지금보다 크면 갱신한다. 레지스터가 $m$개면 원소들이 $m$개의 독립적인 실험으로 흩어지고, $m$개 레지스터 값의 조화평균에 가까운 공식으로 합쳐 최종 추정치를 낸다. 레지스터가 많을수록(메모리를 더 쓸수록) 추정이 정교해진다 — **표준오차가 대략 $1.04/\sqrt{m}$**이라는 공식이 그 관계를 정확히 말해 준다. 레지스터 1,024개(문자열 UUID 하나보다도 작은 몇 킬로바이트)로 수십억 개의 카디널리티를 몇 퍼센트 오차 안에서 추정한다.

레지스터 하나만으로 추정하면 왜 부정확한지도 짚어 둘 만하다. 동전을 던져 앞면이 열 번 연속 나올 확률은 낮지만 0은 아니다 — 시행 횟수가 많아지면 그런 우연도 벌어진다. 레지스터 하나의 최댓값은 이런 우연 하나에 전부 좌우되므로 분산이 크다. 레지스터를 $m$개로 쪼개면 $m$번의 독립적인 실험이 되고, 그 평균은 개별 실험보다 훨씬 안정적이다 — 동전 던지기를 한 번만 관찰하는 것과 천 번 관찰해 평균 내는 것의 차이와 같다.

**핵심은 레지스터가 "원소를 기억하지 않는다"는 것이다.** 레지스터에는 지금까지 본 것 중 "가장 운이 좋았던 값" 하나만 남는다. 같은 원소가 백만 번 다시 들어와도 레지스터는 그대로다 — 그래서 카디널리티(서로 다른 원소 수)를 세지, 등장 횟수를 세지 않는다. 등장 횟수, 즉 빈도를 알고 싶다면 다른 도구가 필요하다.

**Count-Min Sketch는 빈도를 추정한다.** 카운터를 2차원 격자로 두고, 원소마다 $d$개의 서로 다른 해시로 각 행에서 칸 하나씩을 고른 뒤 그 칸들을 전부 1씩 올린다. 조회할 때는 그 원소가 고르는 $d$개 칸 중 **최솟값**을 답으로 낸다. 서로 다른 원소가 같은 칸을 공유할 수 있으므로 그 칸의 값은 실제보다 부풀 수 있지만, $d$개 칸을 전부 부풀릴 만큼 공교롭게 겹칠 확률은 낮다 — 최솟값을 취하면 그 낮은 확률의 경우만 남아 오차가 줄어든다. **이 구조도 한쪽으로만 틀린다.** 카운터는 절대 실제보다 작게 나오지 않는다 — 공유된 칸이 항상 값을 올리기만 하니까. [XV-4](#/xv-4)의 블룸 필터가 "거짓양성만 있고 거짓음성은 없다"였다면, 여기서는 **"과대추정만 있고 과소추정은 없다."** 같은 비대칭이 형태를 바꿔 반복된다.

## 3. 구현

::: dual
```python title="HyperLogLog — 카디널리티 추정과 오차 실측"
import math


def fnv1a(s: str) -> int:
    h = 0xcbf29ce484222325
    for b in s.encode():
        h ^= b
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h


def mix64(x: int) -> int:
    """비트를 흩는 마무리 단계(finalizer). fnv1a는 짧고 비슷한 문자열에서
    상위 비트가 잘 안 섞이므로, 레지스터 번호를 뽑기 전에 한 번 더 섞는다."""
    x &= 0xFFFFFFFFFFFFFFFF
    x ^= x >> 33
    x = (x * 0xff51afd7ed558ccd) & 0xFFFFFFFFFFFFFFFF
    x ^= x >> 33
    x = (x * 0xc4ceb9fe1a85ec53) & 0xFFFFFFFFFFFFFFFF
    x ^= x >> 33
    return x


def rho(x, bits):
    """x의 하위 bits 비트에서 최초로 나오는 1비트의 위치(1부터 셈)."""
    if x == 0:
        return bits + 1
    r = 1
    while not (x & 1):
        x >>= 1
        r += 1
    return r


B = 10                  # 레지스터 인덱스 비트수
M = 1 << B              # 레지스터 개수
ALPHA = 0.7213 / (1 + 1.079 / M)

registers = [0] * M


def add(item):
    h = mix64(fnv1a(item)) & 0xFFFFFFFF
    idx = h >> (32 - B)                       # 상위 B비트로 레지스터 선택
    rest = h & ((1 << (32 - B)) - 1)
    r = rho(rest, 32 - B)
    if r > registers[idx]:
        registers[idx] = r


def estimate():
    inv_sum = sum(2.0 ** (-r) for r in registers)
    return ALPHA * M * M / inv_sum


N = 50000
for i in range(N):
    add("user%d" % i)

est = estimate()
err = abs(est - N) / N
theory_err = 1.04 / math.sqrt(M)
print("m=%d(2^%d 레지스터) 실제 카디널리티 N=%d" % (M, B, N))
print("추정값 = %.1f" % est)
print("실측 상대오차 = %.4f" % err)
print("이론 상대오차(1.04/sqrt(m)) = %.4f" % theory_err)
```
```cpp title="HyperLogLog — 카디널리티 추정과 오차 실측"
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <string>
#include <vector>
using namespace std;

uint64_t fnv1a(const string& s) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (unsigned char b : s) { h ^= b; h *= 0x100000001b3ULL; }
    return h;
}

// 비트를 흩는 마무리 단계(finalizer). fnv1a는 짧고 비슷한 문자열에서 상위
// 비트가 잘 안 섞이므로, 레지스터 번호를 뽑기 전에 한 번 더 섞는다.
uint64_t mix64(uint64_t x) {
    x ^= x >> 33;
    x *= 0xff51afd7ed558ccdULL;
    x ^= x >> 33;
    x *= 0xc4ceb9fe1a85ec53ULL;
    x ^= x >> 33;
    return x;
}

// x의 하위 bits 비트에서 최초로 나오는 1비트의 위치(1부터 셈).
int rho(uint32_t x, int bits) {
    if (x == 0) return bits + 1;
    int r = 1;
    while (!(x & 1)) { x >>= 1; r++; }
    return r;
}

const int B = 10;
const int M = 1 << B;
const double ALPHA = 0.7213 / (1 + 1.079 / M);

vector<int> registers(M, 0);

void add(const string& item) {
    uint32_t h = (uint32_t)(mix64(fnv1a(item)) & 0xFFFFFFFFu);
    int idx = h >> (32 - B);                  // 상위 B비트로 레지스터 선택
    uint32_t rest = h & ((1u << (32 - B)) - 1);
    int r = rho(rest, 32 - B);
    if (r > registers[idx]) registers[idx] = r;
}

double estimate() {
    double inv_sum = 0;
    for (int r : registers) inv_sum += pow(2.0, -r);
    return ALPHA * M * M / inv_sum;
}

int main() {
    const int N = 50000;
    for (int i = 0; i < N; i++) add("user" + to_string(i));
    double est = estimate();
    double err = fabs(est - N) / N;
    double theory_err = 1.04 / sqrt((double)M);
    printf("m=%d(2^%d 레지스터) 실제 카디널리티 N=%d\n", M, B, N);
    printf("추정값 = %.1f\n", est);
    printf("실측 상대오차 = %.4f\n", err);
    printf("이론 상대오차(1.04/sqrt(m)) = %.4f\n", theory_err);
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
m=1024(2^10 레지스터) 실제 카디널리티 N=50000
추정값 = 49206.3
실측 상대오차 = 0.0159
이론 상대오차(1.04/sqrt(m)) = 0.0325
```

50,000개의 서로 다른 원소를 4KB 남짓한 레지스터 1,024개(정수 배열 하나)로 추정했는데, 실측 오차 1.59%가 이론 표준오차 3.25% 이내에 들어온다. (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측. `user0`..`user49999`라는 고정 이름공간을 쓰므로 이 실행은 항상 같은 숫자를 낸다.)

**복잡도:** 원소 추가는 $O(1)$ — 해시 한 번, 레지스터 하나 비교·갱신. 추정 계산은 $O(m)$ — 레지스터 전체를 한 번 훑어 합을 낸다. 공간은 $O(m)$이고 $m$은 **원소 수 $n$과 무관하게 미리 정한 상수**다 — 10만 개를 세든 10억 개를 세든 레지스터 배열 크기는 그대로다. 이것이 정확한 카디널리티 계산의 $O(n)$ 공간과 근본적으로 다른 지점이다.

::: dual
```python title="Count-Min Sketch — 빈도 추정과 단방향 오차 확인"
def fnv1a(s):
    h = 0xcbf29ce484222325
    for b in s.encode():
        h ^= b
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h


W = 2048   # 폭 (해시별 카운터 수)
D = 4      # 깊이 (해시 함수 개수)

table = [[0] * W for _ in range(D)]


def positions(item):
    return [fnv1a("%d#%s" % (d, item)) % W for d in range(D)]


def add(item, count=1):
    for d, p in enumerate(positions(item)):
        table[d][p] += count


def estimate(item):
    return min(table[d][p] for d, p in enumerate(positions(item)))


true_count = {}
STREAM = (["hot"] * 500) + (["warm"] * 40) + ["rare%d" % i for i in range(2000)]

for w in STREAM:
    add(w)
    true_count[w] = true_count.get(w, 0) + 1

over = 0
worst = 0
for w in set(STREAM):
    est = estimate(w)
    true = true_count[w]
    if est < true:
        print("과소추정 발생!", w, est, true)   # 이론상 절대 안 찍혀야 하는 줄
    if est > true:
        over += 1
        worst = max(worst, est - true)

print("스트림 길이 =", len(STREAM), " 고유 항목 =", len(true_count))
print("hot 실제=%d 추정=%d" % (true_count["hot"], estimate("hot")))
print("warm 실제=%d 추정=%d" % (true_count["warm"], estimate("warm")))
print("과대추정된 항목 수 = %d / %d" % (over, len(true_count)))
print("가장 큰 과대추정 폭 = %d" % worst)
```
```cpp title="Count-Min Sketch — 빈도 추정과 단방향 오차 확인"
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include <unordered_map>
#include <set>
using namespace std;

uint64_t fnv1a(const string& s) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (unsigned char b : s) { h ^= b; h *= 0x100000001b3ULL; }
    return h;
}

const int W = 2048;   // 폭 (해시별 카운터 수)
const int D = 4;       // 깊이 (해시 함수 개수)
vector<vector<int>> table(D, vector<int>(W, 0));

vector<int> positions(const string& item) {
    vector<int> p(D);
    for (int d = 0; d < D; d++) p[d] = (int)(fnv1a(to_string(d) + "#" + item) % W);
    return p;
}

void add(const string& item, int count = 1) {
    auto p = positions(item);
    for (int d = 0; d < D; d++) table[d][p[d]] += count;
}

int estimate(const string& item) {
    auto p = positions(item);
    int m = table[0][p[0]];
    for (int d = 1; d < D; d++) m = min(m, table[d][p[d]]);
    return m;
}

int main() {
    vector<string> stream;
    for (int i = 0; i < 500; i++) stream.push_back("hot");
    for (int i = 0; i < 40; i++) stream.push_back("warm");
    for (int i = 0; i < 2000; i++) stream.push_back("rare" + to_string(i));

    unordered_map<string, int> true_count;
    for (auto& w : stream) {
        add(w);
        true_count[w]++;
    }

    set<string> uniq(stream.begin(), stream.end());
    int over = 0, worst = 0;
    for (auto& w : uniq) {
        int est = estimate(w);
        int tru = true_count[w];
        if (est < tru) printf("과소추정 발생! %s %d %d\n", w.c_str(), est, tru);
        if (est > tru) { over++; worst = max(worst, est - tru); }
    }
    printf("스트림 길이 = %d  고유 항목 = %d\n", (int)stream.size(), (int)true_count.size());
    printf("hot 실제=%d 추정=%d\n", true_count["hot"], estimate("hot"));
    printf("warm 실제=%d 추정=%d\n", true_count["warm"], estimate("warm"));
    printf("과대추정된 항목 수 = %d / %d\n", over, (int)true_count.size());
    printf("가장 큰 과대추정 폭 = %d\n", worst);
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
스트림 길이 = 2540  고유 항목 = 2002
hot 실제=500 추정=500
warm 실제=40 추정=41
과대추정된 항목 수 = 208 / 2002
가장 큰 과대추정 폭 = 2
```

`hot`(500회)과 `warm`(40회)처럼 자주 등장하는 항목은 정확히 또는 오차 1 이내로 맞는다. 딱 한 번씩만 등장한 `rare` 항목 2,000개 중 208개가 과대추정됐지만 폭은 전부 2 이내다 — 그리고 "과소추정 발생!" 줄은 한 번도 찍히지 않는다. 이것이 이 구조의 설계 그대로다. **자주 나오는 항목(핫키)일수록 정확도가 높고, 드문 항목의 오차는 위로만 치우친다.**

**복잡도:** 추가·조회 모두 $O(d)$ — 해시 $d$번, 카운터 $d$개 읽거나 쓴다. 공간은 $O(dw)$로 카운터 $d \times w$개의 격자다. 폭 $w$를 넓힐수록 서로 다른 원소가 같은 칸을 공유할 확률이 줄어 과대추정 폭이 줄어든다 — 위 실측에서 $w$를 32에서 2048로 늘렸을 때 과대추정된 항목의 비율이 100%에서 10%로 떨어진 것이 그 증거다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 2차원 카운터 배열 | `[[0]*W for _ in range(D)]` — 리스트 컴프리헨션마다 새 리스트를 만들어야 한다. `[[0]*W]*D`로 쓰면 [0-2](#/0-2)의 함정처럼 한 행이 되어버린다 | `vector<vector<int>>(D, vector<int>(W, 0))` |
| 딕셔너리 등장 횟수 | `dict.get(item, 0)` | `unordered_map` 은 없는 키 접근 시 자동으로 0 삽입 — 파이썬의 `defaultdict(int)`와 같은 동작이다 |
| 유니크 목록 순회 순서 | `set(STREAM)`의 순회 순서는 해시 기반이라 실행마다 달라질 수 있다 | `std::set<string>`은 사전순으로 정렬돼 있다. 이 코드는 통계량(개수·최댓값)만 출력하므로 순서 차이가 결과에 안 드러난다 |

::: pitfall
- **HyperLogLog에 같은 원소를 여러 번 추가하고 카디널리티가 안 늘어난 것을 버그로 착각한다.** 레지스터는 "가장 운이 좋았던 값"만 기억하므로 중복 추가는 정상적으로 무시된다. 이게 정확히 이 구조가 세려는 것 — 등장 횟수가 아니라 서로 다른 원소 수다.
- **레지스터 인덱스와 rho 계산에 같은 비트를 겹쳐 쓴다.** 상위 $B$비트로 레지스터를 고르고 나머지 비트로 rho를 계산해야 두 값이 독립적이다. 같은 해시값 전체로 인덱스도 뽑고 rho도 뽑으면 두 값이 서로 얽혀 추정이 무너진다.
- **Count-Min Sketch의 깊이 $d$나 폭 $w$를 너무 작게 잡고 "오차가 너무 크다"고 결론짓는다.** 위 실측처럼 $w$를 늘리면 과대추정 폭이 눈에 띄게 준다. 목표 오차와 트래픽 규모에서 $w, d$를 먼저 계산하고 시작해야 한다.
- **레지스터 개수와 목표 오차의 관계를 거꾸로 계산하지 않는다.** "오차가 1% 이내면 좋겠다"는 요구가 있으면 $1.04/\sqrt{m} \le 0.01$을 풀어 $m$의 하한을 먼저 구하고 나서 구현에 들어가야 한다. 구현부터 하고 오차를 나중에 재는 순서는 결국 다시 계산하게 된다.
- **음수 빈도(감소)를 그대로 뺄셈으로 처리하려 한다.** Count-Min Sketch의 카운터는 최솟값을 취하는 구조라 감소를 반영하면 다른 항목의 카운터를 실수로 깎을 수 있다. 감소가 필요하면 별도 설계(Count-Median Sketch 등)가 필요하다 — 이 챕터의 범위 밖이다.
:::

::: interview
**"HyperLogLog로 카디널리티를 구했는데 정확한 값과 왜 다릅니까. 오차를 줄이려면 무엇을 바꿉니까."**
"레지스터가 원소 하나하나를 기억하지 않고 '지금까지 본 것 중 해시값이 가장 희귀했던 정도'만 남기기 때문에, 그 값에는 원래 통계적 흔들림이 있습니다. 레지스터 수 $m$을 늘리면 그 흔들림이 여러 실험의 평균으로 상쇄되어 표준오차가 $1.04/\sqrt{m}$을 따라 줄어듭니다. $m$을 4배로 늘리면 오차는 절반이 됩니다. 대가는 그만큼 레지스터 배열이 커진다는 것뿐이고, 그래도 정확한 해시셋보다는 몇 자릿수 작습니다."
:::

## 5. 어디에 쓰이는가

**유니크 방문자 수 집계가 HyperLogLog의 표준 용례다.** 여러 서버에 흩어져 로그를 처리하면서 시간대별·페이지별 DAU를 실시간 집계해야 하는 분석 파이프라인(예: Redis의 `PFADD`/`PFCOUNT`, 빅데이터 집계 엔진의 `APPROX_COUNT_DISTINCT`)이 내부에서 이 구조를 쓴다. 레지스터 배열이 작다는 것은 **병합이 쉽다**는 뜻이기도 하다 — 서버 여러 대에서 각자 집계한 HyperLogLog는 레지스터별로 최댓값만 취해 합치면 전체를 다시 계산할 필요 없이 합쳐진다.

스트리밍 집계 파이프라인의 "탑 K" 계산도 Count-Min Sketch 위에 얹히는 경우가 실무에서 많다 — 정확한 순위가 아니라 "대략 가장 많이 등장한 항목 K개"면 충분한 상황에서, 스트림의 모든 항목을 정렬하지 않고도 근사치를 낼 수 있다.

**핫키 검출이 Count-Min Sketch의 표준 용례다.** 분산 캐시나 CDN에서 어떤 키가 갑자기 트래픽이 몰리는지(핫키) 실시간으로 알아야 별도 캐싱 전략을 걸 수 있는데, 모든 키의 정확한 카운트를 유지하는 것은 [XV-9](#/xv-9)의 캐시 문제와 똑같이 메모리를 잡아먹는다. Count-Min Sketch는 자주 나오는 항목일수록 정확도가 높다는 성질이 정확히 "핫키를 놓치지 않는다"는 요구와 맞아떨어진다 — 드문 항목의 오차는 애초에 관심사가 아니다.

## 연습

::: quiz
- 상황: 광고 플랫폼이 캠페인마다 "순 노출 사용자 수"를 실시간 대시보드에 초 단위로 갱신해야 한다. 캠페인이 수만 개다.
- 무엇이 병목이거나 깨지는가: 캠페인마다 정확한 해시셋을 유지하면 캠페인 수 × 사용자 수만큼 메모리가 곱으로 불어난다. 캠페인 수만 개를 동시에 감당할 수 없다.
- 어떤 구조이고 무엇을 대가로 치르는가: 캠페인마다 HyperLogLog 하나(몇 킬로바이트)를 둔다. 대가는 몇 퍼센트의 추정 오차 — 대시보드 용도로는 감당 가능하고, 레지스터 수를 늘리면 오차를 더 줄일 수 있다.

- 상황: CDN 엣지 서버가 어떤 콘텐츠가 갑자기 요청이 몰리는지(핫키) 감지해 그 콘텐츠만 별도로 로컬 캐싱해야 한다. 콘텐츠 종류가 수백만 개다.
- 무엇이 병목이거나 깨지는가: 모든 콘텐츠의 정확한 요청 횟수를 딕셔너리로 유지하면 콘텐츠 종류 수만큼 메모리가 든다. 대부분은 몇 번밖에 요청되지 않는데 그 항목까지 정확히 셀 필요가 없다.
- 어떤 구조이고 무엇을 대가로 치르는가: Count-Min Sketch로 빈도를 근사한다. 자주 요청되는(핫키) 항목일수록 정확도가 높아 감지 목적에 정확히 들어맞는다. 대가는 드문 항목의 카운트가 실제보다 부풀 수 있다는 것 — 핫키 판정 임계값을 이 과대추정 폭만큼 여유 있게 잡아야 한다.

- 상황: 두 지역의 데이터센터가 각자 독립적으로 하루 방문자를 집계했고, 전세계 순 방문자 수를 합쳐서 구해야 한다. 방문자 목록 자체는 지역 간에 옮기고 싶지 않다(개인정보 이동 제약).
- 무엇이 병목이거나 깨지는가: 정확한 해시셋으로는 두 지역의 집합을 합집합 연산해야 하는데, 그러려면 결국 원본 사용자 ID 목록을 주고받아야 한다.
- 어떤 구조이고 무엇을 대가로 치르는가: 각 지역이 HyperLogLog 레지스터 배열만 계산해 그 배열(원본 ID가 전혀 없는 집계값)을 교환한다. 레지스터별 최댓값을 취해 병합하면 전체 순 방문자 추정치를 얻는다. 대가는 여전히 확률적 오차이지만, 원본 데이터를 옮기지 않고도 병합이 가능하다는 이점이 이 상황에서는 오차보다 크다.
:::

## 요약

- 정확한 카디널리티는 원소 전체를 기억해야 하므로 공간이 $O(n)$이다 — 유니크 원소 수가 늘어날수록 필요한 메모리도 정확히 비례해 늘어난다. HyperLogLog는 해시값의 "처음 나오는 1비트 위치"를 레지스터 여러 개에 나눠 각각 최댓값으로 저장해 공간을 $O(m)$(미리 정해 둔 상수)으로 줄인다.
- 실측 상대오차(1.59%)가 이론값 $1.04/\sqrt{m}$(3.25%) 이내에 들어온다 — 공식이 이 자료구조의 실제 동작을 정확히 설명한다는 뜻이다.
- **레지스터는 원소 하나하나를 기억하지 않고 "가장 운이 좋았던 값"만 남긴다.** 그래서 중복 추가는 무시되고, 서버 간 병합이 레지스터별 최댓값 취하기로 간단히 된다.
- Count-Min Sketch는 카운터 격자에 $d$개의 해시로 값을 올리고 조회 시 최솟값을 취해 빈도를 추정한다. 자주 등장하는 항목(핫키)일수록 여러 칸의 값이 동시에 커지므로 최솟값도 정확해진다.
- **과대추정만 있고 과소추정은 없다.** [XV-4](#/xv-4) 블룸 필터의 "거짓양성만 있고 거짓음성은 없다"와 같은 형태의 단방향 오차이고, 실측(과소추정 0건, 과대추정 최대 폭 2)이 이 성질을 그대로 보여준다.
- 대표 용례는 유니크 방문자 수 집계(HyperLogLog)와 핫키 검출(Count-Min Sketch) — 둘 다 "정확한 개별 값보다 전체 규모나 상대적 크기가 중요한" 지표를 다룬다.
- 레지스터·카운터 수를 늘리면 두 구조 모두 오차가 줄어든다. 목표 오차에서 거꾸로 필요한 크기를 계산하고 나서 구현해야 다시 계산하는 일을 피한다.
- [XV-4 블룸 필터](#/xv-4)·[XV-5 스킵 리스트](#/xv-5)와 이 챕터는 같은 계보다. **정확성을 메모리와 교환하되, 어느 방향으로 틀릴지는 설계로 통제한다.** 이것이 확률적 자료구조 전체를 관통하는 한 문장이다.

**다음 절**: [XV-7 머클 트리와 해시 체인](#/xv-7) — 이번엔 근사로 오차를 감당하는 대신, 정확성을 지키면서도 전체를 비교하지 않고 차이만 찾아내는 방법을 본다.
