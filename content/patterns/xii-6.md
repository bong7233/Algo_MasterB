# XII-6 Strategy

::: lead
알고리즘을 값처럼 다룰 수 있으면 무엇이 가능해지고, 그 값을 담는 그릇은 언어마다 얼마나 커지는가.

:::

## 1. 문제

텔레메트리 수집기를 짠다. 장비에서 초당 수천 개의 샘플이 올라오고, 그대로 저장하면 디스크가 하루를 못 버틴다. 그래서 저장 전에 데이터를 줄인다.

첫 요구는 하나다.

> 8비트 정밀도면 충분하다. 8단위로 양자화해서 저장한다.

`for` 문 하나로 끝난다. 그런데 두 번째 요구가 온다.

> 진동 분석용 채널은 양자화하면 안 된다. 그 채널은 원본 그대로 저장한다.

이제 함수에 `if` 가 하나 생긴다. 세 번째 요구.

> 온도 채널은 4개씩 평균 내서 저장한다. 그 정도 해상도면 된다.

`if` 가 둘이 된다. 여기까지는 아무 문제도 없어 보인다. 문제는 **줄이는 방법에 따라 달라지는 것이 하나가 아니라는** 데서 시작된다.

줄이는 방법마다 다른 것을 세어 보면 이렇다. 알고리즘 자체, 그 방법이 무손실인지, 최악 오차의 상한, 저장 메타데이터에 적을 이름, 복원 절차. 다섯 가지고 **각각이 자기 자리에서 `if` 사슬이 된다.**

::: warn
사슬이 하나면 새 방법을 추가할 때 한 곳만 고친다. 사슬이 다섯이면 다섯 곳이고, **하나를 빠뜨려도 컴파일은 통과한다.** `else` 가 기본값을 돌려주기 때문이다.
:::

여기서 특히 위험한 사슬이 있다. **무손실 여부를 판정하는 사슬이다.** 이 판정을 보고 시스템이 원본을 지운다. 새로 추가한 방법이 이 사슬에 없으면 `else` 가 "무손실"을 돌려주고, 원본은 지워지고, 손실된 데이터만 남는다. ==분기 하나를 빠뜨린 대가가 복구 불가능한 데이터 손실이다.==

그리고 이 구조로는 애초에 못 하는 것들이 있다.

- **런타임에 방법을 바꾸는 것.** 디스크가 차면 더 공격적으로 줄이고 싶은데, 방법이 문자열로 함수 안에 박혀 있다.
- **여러 방법을 같은 입력에 돌려 비교하는 것.** 어느 쪽이 오차 대비 이득이 큰지 재려면 방법을 목록에 담아야 하는데, `if` 사슬은 목록에 담기지 않는다.
- **테스트에서 가짜를 끼우는 것.** 사슬에 없는 것은 존재할 수 없다.

셋 다 같은 이유로 막힌다. **알고리즘이 값이 아니기 때문이다.**

## 2. 무엇이 달라져야 하는가

변하지 않는 것은 이것 하나다.

```text nolines
  samples  ──▶  [ reduce ]  ──▶  samples        <- 줄이는 무언가
```

들어가는 것도 샘플 목록이고 나오는 것도 샘플 목록이다. 어떤 방법을 쓰든 이 계약은 같다.

변하는 것은 상자 안이다. 그렇다면 **상자 안을 인자로 받으면 된다.** 그 순간 셋이 동시에 풀린다 — 값이므로 변수에 담을 수 있고(런타임 교체), 목록에 넣을 수 있고(비교), 밖에서 만들어 넣을 수 있다(테스트).

이것이 이 챕터의 전부다. 나머지는 **그 값을 무엇으로 표현하느냐**의 문제이고, 여기서 두 언어가 크게 갈린다.

**연산이 하나뿐이면 그 값은 함수다.** Python 에서는 함수가 이미 값이므로 할 일이 없다. C++ 에서도 `std::function` 이나 함수 포인터로 담을 수 있다.

**연산이 둘 이상이거나 데이터가 딸려 오면 그 값은 묶음이어야 한다.** §1에서 센 다섯 가지가 그것이다 — 알고리즘 하나에 무손실 여부와 오차 상한이 붙어 다닌다. 함수 하나로는 그 셋을 못 담는다. 이때 두 언어 모두 타입이 필요해지고, **그 지점에서 두 언어의 코드 크기가 다시 비슷해진다.**

그래서 이 챕터는 세 단계로 간다. 사슬이 번식한 상태, 연산이 하나일 때, 그리고 메타데이터가 붙는 순간.

## 3. 구현

샘플은 여덟 개로 고정한다. 줄이는 방법은 셋이다 — 그대로 두는 `raw`, 8단위로 양자화하는 `q8`, 네 개씩 평균 내는 `avg4`. `avg4` 가 방금 추가된 방법이다.

### 3.1 사슬이 번식한 상태

::: dual
```python title="나쁜 판 — 무손실 판정 사슬에 한 줄을 빠뜨렸다"
DATA = [100, 103, 107, 112, 118, 125, 133, 142]


def reduce_samples(name, xs):          # 사슬 1 — 여기에는 avg4 를 추가했다
    if name == "raw":
        return list(xs)
    if name == "q8":
        return [(x // 8) * 8 for x in xs]
    if name == "avg4":
        out = []
        for i in range(0, len(xs), 4):
            block = xs[i:i + 4]
            out += [sum(block) // len(block)] * len(block)
        return out
    raise ValueError(name)


def is_lossless(name):                 # 사슬 2 — 여기에는 추가하지 않았다
    if name == "q8":
        return False
    return True                        # else 가 조용히 True 를 돌려준다


def store(name, xs):
    out = reduce_samples(name, xs)
    err = max(abs(a - b) for a, b in zip(xs, out))
    lossless = is_lossless(name)
    action = "원본 삭제" if lossless else "원본 보존"
    print(f"{name:<5} 무손실 보고={'True ' if lossless else 'False'}  "
          f"실제 최대 오차={err:>2}  {action}")


for name in ("raw", "q8", "avg4"):
    store(name, DATA)
```
```cpp title="나쁜 판 — 무손실 판정 사슬에 한 줄을 빠뜨렸다"
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
using namespace std;

vector<int> DATA = {100, 103, 107, 112, 118, 125, 133, 142};

vector<int> reduce_samples(const string& name, const vector<int>& xs) {
    if (name == "raw") return xs;      // 사슬 1 — 여기에는 avg4 를 추가했다
    if (name == "q8") {
        vector<int> out;
        for (int x : xs) out.push_back((x / 8) * 8);
        return out;
    }
    if (name == "avg4") {
        vector<int> out;
        for (size_t i = 0; i < xs.size(); i += 4) {
            size_t n = min<size_t>(4, xs.size() - i);
            int sum = 0;
            for (size_t k = 0; k < n; k++) sum += xs[i + k];
            for (size_t k = 0; k < n; k++) out.push_back(sum / (int)n);
        }
        return out;
    }
    throw invalid_argument(name);
}

bool is_lossless(const string& name) {  // 사슬 2 — 여기에는 추가하지 않았다
    if (name == "q8") return false;
    return true;                        // else 가 조용히 true 를 돌려준다
}

void store(const string& name, const vector<int>& xs) {
    vector<int> out = reduce_samples(name, xs);
    int err = 0;
    for (size_t i = 0; i < xs.size(); i++) err = max(err, abs(xs[i] - out[i]));
    bool lossless = is_lossless(name);
    string action = lossless ? "원본 삭제" : "원본 보존";
    cout << left << setw(5) << name << " 무손실 보고=" << (lossless ? "True " : "False")
         << "  실제 최대 오차=" << right << setw(2) << err << "  " << action << "\n";
}

int main() {
    for (string name : {"raw", "q8", "avg4"}) store(name, DATA);
    return 0;
}
```
:::

**복잡도:** 시간 $O(N + K)$ — 샘플 $N$개를 한 번 훑고, 방법 이름을 사슬에서 찾느라 최대 $K$번 비교한다. $K$는 방법의 수이고 보통 한 자리이므로 실행 시간은 문제가 아니다. **문제는 변경 비용 $O(C)$다** — 방법 하나를 추가할 때 고쳐야 하는 사슬의 수에 비례하고, 그 $C$가 몇인지는 아무도 세지 않는다.

```console
raw   무손실 보고=True   실제 최대 오차= 0  원본 삭제
q8    무손실 보고=False  실제 최대 오차= 7  원본 보존
avg4  무손실 보고=True   실제 최대 오차=13  원본 삭제
```

**셋째 줄을 보라.** `avg4` 는 실제로 최대 13의 오차를 냈는데 무손실로 보고됐고, 그래서 원본이 삭제됐다. 13은 작은 수가 아니다 — 원본이 100~142 범위이므로 10% 가까운 오차이고, 진동 분석에서 이 정도면 신호가 아니라 잡음이다. **그리고 원본은 이미 없다.**

이 버그의 성질을 정확히 보자. `reduce_samples` 는 완벽히 옳고 `is_lossless` 도 자기 자리에서는 옳다. 틀린 것은 **둘이 같은 지식을 나눠 갖고 있다**는 사실이다. 방법에 대한 지식이 두 곳에 있으면 두 곳이 어긋날 수 있고, 어긋났다는 것을 알려 주는 장치가 없다.

### 3.2 알고리즘을 값으로

먼저 알고리즘 자체만 값으로 만든다. 무손실 판정은 아직 그대로 둔다 — 한 번에 하나씩 고친다.

::: dual
```python title="알고리즘을 값으로 — 선택 사슬이 사라진다"
DATA = [100, 103, 107, 112, 118, 125, 133, 142]


def raw(xs):
    return list(xs)


def q8(xs):
    return [(x // 8) * 8 for x in xs]


def avg4(xs):
    out = []
    for i in range(0, len(xs), 4):
        block = xs[i:i + 4]
        out += [sum(block) // len(block)] * len(block)
    return out


REDUCERS = {"raw": raw, "q8": q8, "avg4": avg4}   # 알고리즘이 값이므로 표에 담긴다


def store(name, reduce, xs):
    out = reduce(xs)                              # 전략을 인자로 받는다
    err = max(abs(a - b) for a, b in zip(xs, out))
    print(f"{name:<5} 출력={out}  최대 오차={err:>2}")


for name in ("raw", "q8", "avg4"):     # 표의 순회 순서는 언어마다 다르다. 순서를 못 박는다
    store(name, REDUCERS[name], DATA)
```
```cpp title="알고리즘을 값으로 — 선택 사슬이 사라진다"
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>
using namespace std;

vector<int> DATA = {100, 103, 107, 112, 118, 125, 133, 142};

struct Reducer {                                  // 값이 되려면 타입이 있어야 한다
    virtual ~Reducer() = default;
    virtual vector<int> apply(const vector<int>& xs) const = 0;
};

struct Raw : Reducer {
    vector<int> apply(const vector<int>& xs) const override { return xs; }
};

struct Q8 : Reducer {
    vector<int> apply(const vector<int>& xs) const override {
        vector<int> out;
        for (int x : xs) out.push_back((x / 8) * 8);
        return out;
    }
};

struct Avg4 : Reducer {
    vector<int> apply(const vector<int>& xs) const override {
        vector<int> out;
        for (size_t i = 0; i < xs.size(); i += 4) {
            size_t n = min<size_t>(4, xs.size() - i);
            int sum = 0;
            for (size_t k = 0; k < n; k++) sum += xs[i + k];
            for (size_t k = 0; k < n; k++) out.push_back(sum / (int)n);
        }
        return out;
    }
};

void store(const string& name, const Reducer& reduce, const vector<int>& xs) {
    vector<int> out = reduce.apply(xs);           // 전략을 인자로 받는다
    int err = 0;
    string body;
    for (size_t i = 0; i < xs.size(); i++) {
        err = max(err, abs(xs[i] - out[i]));
        body += (i ? ", " : "") + to_string(out[i]);
    }
    cout << left << setw(5) << name << " 출력=[" << body << "]  최대 오차="
         << right << setw(2) << err << "\n";
}

int main() {
    map<string, unique_ptr<Reducer>> reducers;    // 알고리즘이 값이므로 표에 담긴다
    reducers["raw"] = make_unique<Raw>();
    reducers["q8"] = make_unique<Q8>();
    reducers["avg4"] = make_unique<Avg4>();
    // 표의 순회 순서는 언어마다 다르다. 순서를 못 박는다
    for (string name : {"raw", "q8", "avg4"}) store(name, *reducers[name], DATA);
    return 0;
}
```
:::

**복잡도:** 시간 $O(N)$ — 사슬 비교 $K$항이 사라졌다. 표 조회는 Python 이 평균 $O(1)$, C++ `map` 이 $O(\log K)$다. 실행 시간에서 달라진 것은 이 항뿐이고, **달라진 것은 변경 비용이다 — 새 방법 하나가 고치는 곳이 함수 하나(또는 클래스 하나)와 표 한 줄이다.**

```console
raw   출력=[100, 103, 107, 112, 118, 125, 133, 142]  최대 오차= 0
q8    출력=[96, 96, 104, 112, 112, 120, 128, 136]  최대 오차= 7
avg4  출력=[105, 105, 105, 105, 129, 129, 129, 129]  최대 오차=13
```

같은 일을 하는 코드인데 두 언어의 부피가 다르다. 세어 보면 이렇다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 전략의 타입 선언 | **없다.** 함수가 이미 값이다 | `struct Reducer` + 순수 가상 함수 = 4줄 |
| 구현 하나당 | `def` 한 줄 + 본문 | `struct X : Reducer` + `override` 서명 = 최소 3줄 껍데기 |
| 표에 담기 | `{"raw": raw, ...}` 한 줄 | `map<string, unique_ptr<Reducer>>` + 세 줄의 `make_unique` |
| 소유권 | 없다. 함수는 모듈이 들고 있다 | `unique_ptr` 로 명시. 표가 전략을 소유한다 |
| 표의 순회 순서 | `dict` 는 **넣은 순서** | `map` 은 **키 정렬 순서**. 순서에 기대면 두 판의 출력이 갈린다 |
| 세 알고리즘을 뺀 골격 | **1줄** — 표 한 줄 | **14줄** — 인터페이스 4 + 구현 껍데기 3×2 + 표와 등록 4 |

**C++ 도 이 정도로 클 필요는 없다.** 연산이 하나뿐이면 `map<string, function<vector<int>(const vector<int>&)>>` 로 두고 람다를 담으면 골격이 두 줄로 줄어든다. 그러면 두 언어의 크기는 거의 같아진다.

그러니 정확한 명제는 "C++ 은 클래스가 필요하고 Python 은 아니다"가 아니다. ==**연산이 하나이고 딸린 데이터가 없으면 두 언어 모두 함수 하나로 끝난다.**== 그리고 다음 절이 그 조건이 깨지는 지점이다.

### 3.3 메타데이터가 붙는 순간

3.1의 진짜 버그는 아직 살아 있다. 무손실 여부가 여전히 별도 사슬에 있기 때문이다. 그것을 전략 쪽으로 옮기면 어떻게 되는가.

::: dual
```python title="전략이 데이터를 갖는 순간 — Python 도 타입이 필요해진다"
from typing import Protocol

DATA = [100, 103, 107, 112, 118, 125, 133, 142]


class Reducer(Protocol):               # 계약을 선언한다. 상속은 강제하지 않는다
    lossless: bool

    def apply(self, xs: list[int]) -> list[int]: ...


class Raw:
    lossless = True

    def apply(self, xs):
        return list(xs)


class Q8:
    lossless = False                   # 알고리즘과 그 성질이 한 자리에 있다

    def apply(self, xs):
        return [(x // 8) * 8 for x in xs]


class Avg4:
    lossless = False

    def apply(self, xs):
        out = []
        for i in range(0, len(xs), 4):
            block = xs[i:i + 4]
            out += [sum(block) // len(block)] * len(block)
        return out


def store(name, reducer: Reducer, xs):
    out = reducer.apply(xs)
    err = max(abs(a - b) for a, b in zip(xs, out))
    action = "원본 삭제" if reducer.lossless else "원본 보존"
    print(f"{name:<5} 무손실={'True ' if reducer.lossless else 'False'}  "
          f"실제 최대 오차={err:>2}  {action}")


REDUCERS = {"raw": Raw(), "q8": Q8(), "avg4": Avg4()}
for name in ("raw", "q8", "avg4"):
    store(name, REDUCERS[name], DATA)
```
```cpp title="전략이 데이터를 갖는 순간 — Python 도 타입이 필요해진다"
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>
using namespace std;

vector<int> DATA = {100, 103, 107, 112, 118, 125, 133, 142};

struct Reducer {                       // 계약을 선언한다. 구현은 상속으로 강제된다
    virtual ~Reducer() = default;
    virtual bool lossless() const = 0;
    virtual vector<int> apply(const vector<int>& xs) const = 0;
};

struct Raw : Reducer {
    bool lossless() const override { return true; }
    vector<int> apply(const vector<int>& xs) const override { return xs; }
};

struct Q8 : Reducer {
    bool lossless() const override { return false; }   // 알고리즘과 성질이 한 자리에
    vector<int> apply(const vector<int>& xs) const override {
        vector<int> out;
        for (int x : xs) out.push_back((x / 8) * 8);
        return out;
    }
};

struct Avg4 : Reducer {
    bool lossless() const override { return false; }
    vector<int> apply(const vector<int>& xs) const override {
        vector<int> out;
        for (size_t i = 0; i < xs.size(); i += 4) {
            size_t n = min<size_t>(4, xs.size() - i);
            int sum = 0;
            for (size_t k = 0; k < n; k++) sum += xs[i + k];
            for (size_t k = 0; k < n; k++) out.push_back(sum / (int)n);
        }
        return out;
    }
};

void store(const string& name, const Reducer& reducer, const vector<int>& xs) {
    vector<int> out = reducer.apply(xs);
    int err = 0;
    for (size_t i = 0; i < xs.size(); i++) err = max(err, abs(xs[i] - out[i]));
    string action = reducer.lossless() ? "원본 삭제" : "원본 보존";
    cout << left << setw(5) << name << " 무손실="
         << (reducer.lossless() ? "True " : "False") << "  실제 최대 오차="
         << right << setw(2) << err << "  " << action << "\n";
}

int main() {
    map<string, unique_ptr<Reducer>> reducers;
    reducers["raw"] = make_unique<Raw>();
    reducers["q8"] = make_unique<Q8>();
    reducers["avg4"] = make_unique<Avg4>();
    for (string name : {"raw", "q8", "avg4"}) store(name, *reducers[name], DATA);
    return 0;
}
```
:::

**복잡도:** 실행 시간은 3.2와 같다 — $O(N)$에 표 조회. 달라진 것은 **틀릴 수 있는 경우의 수다.** 사슬이 둘일 때는 방법 $K$개마다 두 곳이 어긋날 수 있어 불일치 가능한 조합이 $K$가지였고, 지금은 0이다. 성질을 알고리즘에서 떼어낼 방법이 없기 때문이다.

```console
raw   무손실=True   실제 최대 오차= 0  원본 삭제
q8    무손실=False  실제 최대 오차= 7  원본 보존
avg4  무손실=False  실제 최대 오차=13  원본 보존
```

**셋째 줄이 고쳐졌다.** `avg4` 가 손실 방법으로 보고되고 원본이 보존된다. 고쳐진 이유는 검사를 추가해서가 아니라 **빠뜨릴 자리를 없앴기 때문이다.** `Avg4` 를 쓰면서 `lossless` 를 모르는 것은 불가능하다.

여기서 두 언어의 크기가 다시 붙는다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 전략의 표현 | 클래스. 함수로는 `lossless` 를 담을 수 없다 | 클래스. 3.2와 같다 |
| 계약 선언 | `Protocol` — 상속 없이 구조만 맞으면 된다. 검사는 정적 도구가 한다 | 순수 가상 함수 — 상속이 강제되고 검사는 컴파일러가 한다 |
| 계약 위반 시점 | **런타임.** `lossless` 없는 객체를 넣으면 `AttributeError` | **컴파일 타임.** 구현 안 하면 추상 클래스라 인스턴스화 불가 |
| 골격 크기 | 클래스 3개 × 2줄 껍데기 + Protocol 4줄 | 인터페이스 5줄 + 클래스 3개 × 2줄 껍데기 |

::: note
Python 에서 `Reducer(Protocol)` 을 선언하고도 `class Raw:` 가 그것을 상속하지 않는 것이 요점이다. **Protocol 은 구조적 타이핑이다** — 이름이 맞으면 맞는 것이고, 상속 관계는 필요 없다. 그래서 남이 만든 클래스도, 테스트용 가짜도, 심지어 `lossless` 속성을 붙인 함수 객체도 그대로 전략이 된다. 상속을 강제하지 않으면서 계약을 문서화하고 정적 검사에 걸리게 하는 것이 이 선언의 값이다.

`Protocol` 대신 `ABC` 를 쓰면 상속이 강제되고 계약 위반이 인스턴스화 시점에 잡힌다. **남의 타입을 전략으로 받아야 하면 `Protocol`, 내 계층 안에서만 구현되고 실수를 일찍 잡고 싶으면 `ABC`** 로 가른다. 여기서 `Protocol` 을 고른 이유는 테스트 가짜를 상속 없이 끼우는 것이 이 자리의 주된 용도이기 때문이다.
:::

**전략이 상태를 갖기 시작하면 함수 판은 완전히 무너진다.** 예를 들어 `avg4` 가 블록 경계를 넘어 이어지는 이동 평균으로 바뀌면, 직전 블록의 꼬리를 기억해야 한다. 상태를 함수에 붙이면 그 함수를 두 스트림에 동시에 쓸 수 없다 — 두 스트림이 같은 상태를 공유해 버린다. 객체면 인스턴스를 둘 만들면 그만이다. ==상태가 붙는 순간, 전략은 값이 아니라 **개체**가 된다.==

::: pitfall
- **전략에 상태를 두고 인스턴스를 하나만 만든다.** 전역 표에 `Avg4()` 하나를 담아 두고 여러 스트림이 함께 쓰면, 한 스트림의 꼬리가 다른 스트림의 결과에 섞인다. 상태 있는 전략은 **표에 인스턴스가 아니라 만드는 법을 담아야 한다**([XII-5](#/xii-5)의 등록표가 그것이다).
- **Python 에서 함수에 속성을 붙여 메타데이터를 흉내낸다.** `q8.lossless = False` 는 동작하지만, 선언되지 않은 속성이라 오타(`q8.losless = False`)가 조용히 통과하고 다른 코드가 `lossless` 를 읽을 때 `AttributeError` 로 터진다. 메타데이터가 하나를 넘으면 클래스로 간다.
- **C++ 에서 전략을 값으로 복사한다.** `Reducer` 를 값으로 받으면 슬라이싱이 일어나 파생 부분이 잘려 나간다. 참조(`const Reducer&`)나 포인터로만 다룬다.
- **인터페이스가 최소 공배수로 부푼다.** 전략마다 필요한 설정이 다르다고 인터페이스에 `configure(dict)` 를 넣는 순간, 타입 검사는 사라지고 오타는 런타임까지 간다. 설정은 전략을 **만들 때** 생성자로 넣는다.
:::

## 4. 이제 이름을 붙인다

**Strategy** — 알고리즘군을 각각 캡슐화해 교체 가능하게 만들고, 알고리즘을 쓰는 쪽과 독립적으로 변하게 한다. 참여자는 셋이다.

```text nolines
  Context  ──uses──▶  Strategy          <- 인터페이스. 여기서는 Reducer
     |                    ^
     |                    +-- ConcreteStrategyA   <- Raw
     |                    +-- ConcreteStrategyB   <- Q8
     |                    +-- ConcreteStrategyC   <- Avg4
     +-- 전략을 밖에서 받아 들고 있다가 필요할 때 호출한다
```

`store` 가 Context 다. 전략을 **밖에서 받는다**는 것이 이 패턴의 핵심이고, 그래서 Context 는 어떤 전략들이 존재하는지 알지 못한다.

**State(XII-8)와 헷갈리는 것이 가장 흔하다.** 구조는 거의 같다 — 인터페이스 하나에 구현 여럿, Context 가 그중 하나를 들고 있다. 다른 것은 **누가 고르는가**다. 전략은 밖에서 정해져 들어오고 스스로 바뀌지 않는다. 상태는 자기가 다음 상태를 정하고 Context 를 갈아 끼운다. 압축 방법이 스스로 다음 압축 방법을 고르지는 않는다([XII-8 State](#/xii-8)).

**Template Method(XII-10)와의 차이는 상속이냐 합성이냐다.** 골격을 부모 클래스에 두고 빈 칸을 자식이 채우면 Template Method 이고, 골격이 전략 객체를 호출하면 Strategy 다. 전자는 컴파일 타임에 고정되고 후자는 런타임에 바뀐다. 그리고 전자는 상속 계층 하나당 조합이 하나뿐이라, 채울 빈 칸이 둘이 되는 순간 조합이 곱으로 늘어 클래스가 폭발한다([XII-10](#/xii-10)).

**Bridge(XII-3)와는 의도가 다르다.** 구조는 또 닮았지만 Bridge 는 추상과 구현을 따로 변하게 하려는 것이고, Strategy 는 한 가지 일을 하는 방법을 바꾸려는 것이다. 판별법은 간단하다 — **인터페이스 뒤에 있는 것들이 "같은 일의 다른 방법"이면 Strategy 다.**

## 5. 어디에 박혀 있는가

**경로 플래너 교체.** [Part V](#/v-14)가 만든 것이 전부 같은 자리에 꽂힌다. A\*([V-5](#/v-5))도, D\* Lite([V-7](#/v-7))도, RRT([V-13](#/v-13))도 `plan(start, goal, costmap) -> path` 라는 같은 계약을 만족한다. 그래서 코스트맵을 만들고 경로를 받아 추종하는 상위 로직은 어느 플래너가 꽂혔는지 모른 채 동작한다.

**그리고 [V-14 계보 총정리](#/v-14)의 선택 기준 표가 곧 전략 선택 로직이다.** 지도가 정적이면 A\*, 장애물이 자주 바뀌면 D\* Lite, 구성 공간이 고차원이면 RRT — 이 판단은 상위 로직 어딘가의 `if` 가 아니라 **설정과 상황이 정한다.** 여기서 3.3의 교훈이 그대로 적용된다. 플래너마다 다른 것은 알고리즘만이 아니다. 최적성을 보장하는가, 완결적인가, 재계획 비용이 얼마인가가 딸려 다니고, 그것들을 별도 표에 두면 어긋난다.

**D\* Lite 는 상태를 가진 전략의 교과서적인 예다.** 내부에 우선순위 큐와 `rhs` 값 배열을 들고 있고, 그 상태가 있어야 부분 재계획이 성립한다([V-7](#/v-7)). 함수 하나로는 표현할 수 없고, 두 로봇이 같은 인스턴스를 공유하면 서로의 탐색 트리를 망가뜨린다. 3.3의 마지막 문단이 말한 것이 이 상황이다.

**컨트롤러 교체.** 전역 경로를 실제 속도 명령으로 바꾸는 지역 플래너도 같은 축이다. DWA 와 TEB 는 같은 입력(경로, 코스트맵, 현재 속도)을 받아 같은 출력(속도 명령)을 낸다([V-12](#/v-12)). 전역 플래너와 지역 플래너를 따로 고를 수 있다는 것이 이 구조의 산물이다.

**비교자는 전략이다.** `sort(key=...)` 와 `std::sort(first, last, comp)` 의 마지막 인자가 정확히 이 패턴이고, 정렬 알고리즘 자체는 아무것도 모른 채 "둘 중 어느 것이 앞인가"만 물어본다([II-7 정렬](#/ii-7)). C++ 쪽은 여기서 한 걸음 더 간다 — 비교자를 **템플릿 인자**로 받으므로 전략이 컴파일 타임에 확정되고 인라인된다. `std::unordered_map<K, V, Hash, KeyEqual>` 의 셋째·넷째 인자도 같은 것으로, **해시 함수와 동등 비교가 컴파일 타임 전략**이다([0-8 반복자·람다·비교자](#/0-8)).

**압축·인코딩 협상.** HTTP 응답에서 gzip 을 쓸지 무압축으로 보낼지는 요청 헤더가 정하고, 서버는 이름으로 인코더를 찾아 스트림에 꽂는다. 인코더를 찾는 축은 [XII-5](#/xii-5)의 등록표이고 꽂아서 쓰는 축이 여기다. 그리고 인코더에는 §1이 센 메타데이터가 실제로 딸려 온다 — 이름, 스트리밍 가능 여부, 압축률 대비 CPU 비용. 그래서 실제 구현은 3.3의 형태다.

**캐시 교체 정책.** LRU·LFU·ARC 는 "무엇을 버릴 것인가"라는 같은 질문에 다르게 답한다([XV-9 캐시 교체 정책](#/xv-9)). 전부 상태를 가진 전략이라는 것이 특징이다 — 접근 이력을 들고 있어야 판단할 수 있으므로, 함수로 접을 수 없고 캐시 인스턴스마다 하나씩 있어야 한다.

## 6. 언제 쓰지 말아야 하는가

**구현체가 하나뿐인데 인터페이스를 뽑는 것이 가장 흔한 낭비다.** 줄이는 방법이 `q8` 하나뿐이라면 `q8(xs)` 라고 부르는 것이 옳다. 인터페이스는 두 번째 구현이 실제로 왔을 때 뽑는 편이 낫다 — 그때 뽑아야 **두 구현이 실제로 공유하는 것**을 보고 계약을 정할 수 있다. 하나만 보고 만든 인터페이스는 두 번째가 왔을 때 대개 맞지 않는다.

**전략이 둘이고 앞으로도 둘이면 `if` 하나가 더 읽힌다.** 파일 다섯 개에 흩어진 클래스 셋보다 한 함수 안의 `if` 둘이 진입점을 찾기 쉽다. 갈아 끼울 일이 없는데 갈아 끼울 수 있게 만드는 것은 비용만 남는다. 전략이 값을 하는 조건은 **실제로 교체가 일어나는가**이지 교체가 상상 가능한가가 아니다.

**뜨거운 루프에서는 간접 호출이 인라인을 막는다.** 같은 계산을 세 가지 방식으로 1억 번 부르면 이렇다.

```console
n=100000000  구현 종류=2
템플릿        0.1201 s
가상 함수    0.1937 s
std::function    0.2391 s
가상/템플릿=1.60배  std::function/템플릿=2.01배
```

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 스크립트: `tools/bench/xii6_strategy_dispatch.cpp`)

호출 한 번의 순비용은 가상 함수가 약 0.8ns, `std::function` 이 약 1.2ns 다. **절대값은 작다.** 1.6배로 보이는 이유는 호출 안에서 하는 일이 덧셈 두 번뿐이기 때문이고, 호출 안이 조금이라도 무거워지면 이 배수는 즉시 1에 가까워진다. 그러므로 판단 기준은 배수가 아니라 이것이다 — **한 번의 호출이 하는 일이 몇 나노초인가.** 픽셀 하나, 격자 칸 하나, 점군의 점 하나마다 전략을 부르는 루프에서만 문제가 되고, 그때는 전략을 템플릿 인자로 올려 컴파일 타임에 고정한다.

Python 쪽은 사정이 다르다.

```console
본문에 박음         0.7187 s
함수 전달          0.7714 s
메서드 호출         0.7767 s
n=5000000
함수 호출 순비용   10.6 ns/회  (1.07배)
메서드 호출 순비용 11.6 ns/회  (1.08배)
```

> (Linux x86-64 / CPython 3.13 실측. 스크립트: `tools/bench/xii6_strategy_dispatch.py`)

호출당 순비용은 약 11ns 로 C++ 의 열 배가 넘지만, **비율로는 7~8%에 그친다.** 주변 코드가 그만큼 느리기 때문이다. ==간접 호출의 절대 비용은 C++ 이 훨씬 싸고, 상대 비용은 C++ 에서 더 크게 보인다.== 그래서 "전략 패턴은 느리다"는 말은 언어를 빼고는 성립하지 않는다. Python 에서 전략을 함수로 넘기는 것은 사실상 공짜다.

**전략이 컨텍스트의 내부를 요구하기 시작하면 경계가 잘못 그어진 것이다.** 전략에 넘기는 인자가 늘어나 결국 컨텍스트 자신을 통째로 넘기게 됐다면, 그것은 전략이 아니라 컨텍스트의 메서드다. 인터페이스를 하나 더 두고도 결합은 그대로이고, 대신 호출 경로만 한 겹 깊어졌다.

**설정 방식이 전략마다 다르면 인터페이스가 부푼다.** 플래너마다 필요한 파라미터가 다르다는 이유로 `configure(map<string,string>)` 같은 것을 인터페이스에 넣으면, 타입 검사가 통째로 사라지고 오타는 현장에서 발견된다. 이것이 플러그인 구조에서 실제로 가장 자주 무너지는 지점이다. 설정은 전략을 **만들 때** 생성자로 받고, 인터페이스에는 실행에 필요한 것만 남긴다.

## 연습

::: quiz
각 상황에서 **전략이 함수 하나로 충분한지, 타입이 필요한지** 먼저 판정하라. 판정 기준은 연산의 수와 딸린 데이터의 유무, 그리고 상태다.

**1. 재시도 백오프**
- 상황: 통신 실패 시 재시도 간격을 정한다. 지금은 고정 100ms. 요구가 붙는다 — 지수 백오프, 지터 추가, 그리고 "이 오류 코드는 재시도하지 않는다"는 판정.
- 무엇이 변하고 무엇이 고정인가: 고정은 `delay(attempt) -> ms`. 그런데 마지막 요구는 **연산이 하나 더 늘어난 것**이다 — `should_retry(error) -> bool`. 이 순간 함수 하나로는 부족해진다.
- 어떤 패턴이고 무엇을 대가로 치르는가: Strategy. 연산이 둘이 되는 순간 3.3의 형태로 간다. 지터가 난수를 쓰므로 **전략이 난수 상태를 갖게 되고**, 그러면 인스턴스를 공유하면 안 된다는 제약이 따라온다.

**2. 로그 샘플링**
- 상황: 로그가 초당 수만 줄이라 일부만 남긴다. 정책은 `전부 / N개당 하나 / 확률 p / 에러만`. 운영 중에 정책을 바꿀 수 있어야 하고, 지금 몇 %가 남고 있는지 대시보드에 표시해야 한다.
- 무엇이 변하고 무엇이 고정인가: 고정은 `keep(record) -> bool`. 그런데 "N개당 하나"는 카운터를 갖고 "몇 %가 남는가"는 정책 자신만 답할 수 있다. **상태와 메타데이터가 둘 다 붙는다.**
- 어떤 패턴이고 무엇을 대가로 치르는가: 상태를 가진 Strategy. 대가는 동시성이다 — 여러 스레드가 같은 정책 객체의 카운터를 건드리므로 원자적 연산이나 락이 필요해진다([XI-3](#/xi-3)). 함수였다면 없었을 문제이고, 상태를 붙인 대가다.

**3. 좌표 변환 파이프라인**
- 상황: 센서 좌표를 로봇 좌표로 바꾸는 변환이 장비 모델마다 다르다. 지금은 모델 이름으로 분기한다. 요구가 붙는다 — 변환을 역방향으로도 적용해야 하고, 캘리브레이션 파일에서 파라미터를 읽어야 한다.
- 무엇이 변하고 무엇이 고정인가: 고정은 변환의 입출력 형태. 변하는 것은 파라미터와 방향. **역변환 요구가 연산을 둘로 만들고, 캘리브레이션 파라미터가 전략에 데이터를 붙인다.**
- 어떤 패턴이고 무엇을 대가로 치르는가: Strategy + 생성 시점 설정 주입. 파라미터를 `configure()` 로 나중에 넣지 말고 생성자로 받아야 §6의 마지막 함정을 피한다. 만드는 쪽은 [XII-5](#/xii-5)의 등록표다.
:::

## 요약

- 알고리즘이 `if` 사슬 안에 있으면 **값이 아니다.** 변수에 담을 수도, 목록에 넣을 수도, 밖에서 주입할 수도 없다. 런타임 교체·비교·테스트 대역이 전부 이 한 가지 이유로 막힌다.
- 더 위험한 것은 **사슬이 여럿이라는 것**이다. 방법에 대한 지식이 두 곳에 있으면 어긋날 수 있고, `else` 의 기본값이 그 어긋남을 숨긴다. §3.1에서 손실 압축이 무손실로 보고되어 원본이 삭제됐다.
- 처방은 하나다. **알고리즘을 인자로 받는다.** 그러면 사슬이 사라지고 변경 비용이 $O(1)$이 된다.
- **연산이 하나이고 딸린 데이터가 없으면 두 언어 모두 함수 하나로 끝난다.** Python 은 함수가 이미 값이고, C++ 도 `std::function` 으로 접을 수 있다. 이 조건에서 C++ 의 클래스 계층은 12줄의 껍데기이고 Python 은 1줄이다.
- **연산이 둘이 되거나 메타데이터가 붙거나 상태가 생기면 Python 도 클래스가 된다.** 그 경계에서 두 언어의 크기는 다시 비슷해진다. 차이는 계약을 어떻게 선언하느냐뿐이다 — `Protocol` 은 구조로, 순수 가상 함수는 상속으로.
- 성질을 알고리즘 옆에 두면 **빠뜨릴 자리가 없어진다.** 검사를 추가해서 고친 것이 아니라 틀릴 수 있는 조합을 0으로 만들어서 고친 것이다.
- 대가는 간접 호출이다. C++ 에서 가상 호출은 템플릿 대비 1.6배(호출당 약 0.8ns), Python 에서 함수 호출은 1.07배(호출당 약 11ns)다. **절대값은 C++ 이 싸고 상대값은 C++ 이 비싸다.** 뜨거운 루프에서만 문제가 되고, 그때는 템플릿으로 올린다.

**다음 절**: [XII-7 Observer / Publish-Subscribe](#/xii-7) — 전략은 부르는 쪽이 누구를 부를지 골랐다. 이번엔 **부르는 쪽이 누구를 부르는지 모르는** 구조다.
