# XII-10 Template Method / Chain of Responsibility

::: lead
흐름의 모양을 어디에 적어 둘 것인가 — 뼈대 한 벌에 구멍을 뚫을 것인가, 받을 사람을 줄 세울 것인가.
:::

## 1. 문제

창고 관제 시스템이 밤마다 장비 로그를 걷어 온도 통계를 낸다. 장비는 세 기종이고, 셋의 로그 형식이 전부 다르다. 알파는 쉼표로, 브라보는 파이프로, 델타는 공백으로 이름과 값을 나눈다.

수집기는 기종마다 하나씩, 세 벌이 있다. 세 벌은 이렇게 만들어졌다. 첫 기종용을 짜고, 두 번째 기종이 들어왔을 때 그 파일을 복사해 구분자만 바꿨다. 세 번째도 같은 방식이었다. 그 순간에는 그것이 가장 빠른 길이었고, 실제로 가장 빠른 길이 맞았다.

문제는 그다음에 온다. 현장에서 센서가 고장 나면 장비가 온도 자리에 `-999`를 채워 보낸다는 사실이 나중에 밝혀진다. 요구는 한 줄이다. **"-999인 레코드는 통계에서 뺀다."**

고칠 자리가 세 곳이다. 세 곳을 다 고쳐야 하고, 세 곳이 서로 다른 파일에 있고, 서로 다른 이름의 함수 안에 있다. 두 곳을 고치고 세 번째를 잊는 데는 오후 한 번이면 충분하다.

그리고 이 실수는 **조용하다.** 프로그램은 죽지 않는다. 통계가 나온다. 그 통계가 틀렸을 뿐이다.

::: danger
빠뜨린 수집기는 예외를 던지지 않는다. `-999`는 유효한 실수이고, 평균 계산은 정상적으로 끝난다. 화면에는 창고 온도가 영하 300도라고 찍힌다. **터지는 버그는 배포 전에 잡히고, 조용한 버그는 분기 보고서에서 잡힌다.**
:::

수를 세어 보면 구조가 보인다. 기종이 $m$개, 이런 식으로 "전 기종 공통 규칙"이 $r$개 늘면 고칠 자리는 $m \times r$개다. 기종은 앞으로도 늘고 공통 규칙도 앞으로도 는다. 두 축이 곱해지는 자리에 사람의 기억력을 놓아 둔 것이 이 설계의 실제 결함이다.

같은 시스템 안에 성격이 다른 두 번째 문제가 있다. 수집 도중 나는 오류다. 형식이 깨진 줄, 파일을 읽다 난 I/O 오류, 값이 물리적으로 불가능한 범위, 그리고 나중에 추가된 인증 만료. 오류마다 대응이 다르다. 형식 오류는 그 줄만 버리고 계속하면 되고, I/O 오류는 잠시 뒤 다시 읽어야 하고, 범위 오류는 값을 경계로 자르고 지나가고, 인증 만료는 사람을 불러야 한다.

이쪽은 `if-elif`가 자란다. 오류 종류가 하나 늘 때마다 같은 함수에 `elif`가 한 줄 붙는다. 더 나쁜 것은 **오류를 만든 곳과 처리하는 곳이 다르다**는 점이다. 파서는 자기가 낸 오류를 어떻게 처리할지 모르고, 그 판단은 상황에 따라 달라진다. 야간 배치에서는 넘어가야 하고 실시간 수집에서는 멈춰야 한다.

## 2. 무엇이 달라져야 하는가

두 문제는 형태가 다르다. 갈라서 봐야 한다.

**첫 번째 문제에서 변하는 것은 딱 한 단계다.** 수집 절차를 적어 보면 이렇다.

```text nolines
  1. 빈 줄이면 건너뛴다              <- 세 기종 공통
  2. 한 줄을 이름과 값으로 쪼갠다     <- 기종마다 다르다
  3. 값이 -999면 버린다              <- 세 기종 공통
  4. 결과에 모은다                   <- 세 기종 공통
```

네 단계 중 셋이 고정이고 하나가 변한다. 그런데 지금 코드는 **네 단계를 통째로 세 번 적어 두었다.** 고정된 셋까지 함께 복제된 것이 문제의 전부다.

그러면 방향은 정해진다. **순서를 한 곳에만 적고, 변하는 단계 자리에 구멍을 뚫는다.** 구멍을 무엇으로 메울지는 기종별로 따로 준다.

```text nolines
  collect(lines)                  <- 순서는 여기 한 벌뿐이다
    │
    ├── 빈 줄 건너뛰기
    ├── split_record(ln)          <- 구멍. 기종이 채운다
    ├── -999 버리기
    └── 모으기
```

이 구조에서 아까의 요구는 **한 줄 수정**이다. 기종이 열 개로 늘어도 한 줄이다. $m \times r$이 $r$로 줄었다.

::: note
여기서 제어의 방향이 뒤집힌다. 기종별 코드가 절차를 부르는 것이 아니라, **절차가 기종별 코드를 부른다.** 기종별 코드는 자기가 언제 불릴지 모른다. 이 뒤집힘이 이 구조의 힘이자 곧 §6에서 볼 비용이다.
:::

**두 번째 문제에서 변하는 것은 "누가 처리하는가"다.** 오류를 낸 쪽은 처리자를 지목할 수 없다. 처리자 후보들만 알고 있고, 그중 누구 것인지는 오류를 봐야 정해진다.

여기서 `if-elif`가 잘못인 이유는 길어져서가 아니다. **판정과 처리가 한 함수에 갇혀서** 다른 조합을 만들 수 없기 때문이다. 야간 배치용 대응과 실시간 수집용 대응을 함께 두려면 그 함수를 통째로 두 벌 만들어야 한다.

바꿀 방향은 이렇다. **후보를 줄로 세우고, 각자에게 "이거 네 것이냐"를 앞에서부터 물어본다.** 자기 것이면 처리하고 멈추고, 아니면 다음에게 넘긴다. 줄의 구성은 부르는 쪽이 정한다.

```text nolines
  ev ──▶ [parse] ──▶ [io] ──▶ [range] ──▶ ???
             │         │         │
             내 것?    내 것?    내 것?
```

줄 끝에 물음표를 남겨 둔 것은 의도적이다. **줄 끝까지 갔는데 아무도 받지 않으면 무슨 일이 일어나는가.** 이것이 이 구조의 유일하고 치명적인 함정이고, §3에서 실행해서 보인다.

## 3. 구현

### 3.1 복제된 절차가 어긋나는 것

먼저 지금 있는 코드다. 알파와 브라보에는 `-999` 처리가 들어갔고, 델타에는 빠졌다.

::: dual
```python title="복제된 수집기 — 요구가 두 곳에만 반영됐다"
BAD_TEMP = -999.0                          # 센서 고장 시 장비가 내보내는 표식

def collect_alpha(lines):
    out = []
    for ln in lines:
        if not ln:
            continue
        name, temp = ln.split(",")         # 알파 기종은 쉼표로 나눈다
        temp = float(temp)
        if temp == BAD_TEMP:               # 나중에 들어온 요구 — 여기는 고쳤다
            continue
        out.append((name, temp))
    return out

def collect_bravo(lines):
    out = []
    for ln in lines:
        if not ln:
            continue
        name, temp = ln.split("|")         # 브라보 기종은 파이프로 나눈다
        temp = float(temp)
        if temp == BAD_TEMP:               # 여기도 고쳤다
            continue
        out.append((name, temp))
    return out

def collect_delta(lines):
    out = []
    for ln in lines:
        if not ln:
            continue
        name, temp = ln.split(" ")         # 델타 기종은 공백으로 나눈다
        temp = float(temp)
        out.append((name, temp))           # 여기만 빠뜨렸다
    return out

def mean(recs):
    return sum(t for _, t in recs) / len(recs)

alpha = ["a1,21.0", "a2,-999", "", "a3,21.8"]
bravo = ["b1|22.5", "b2|-999", "b3|21.5"]
delta = ["d1 21.2", "d2 -999", "d3 21.6"]

print(f"alpha 평균 {mean(collect_alpha(alpha)):.1f}")
print(f"bravo 평균 {mean(collect_bravo(bravo)):.1f}")
print(f"delta 평균 {mean(collect_delta(delta)):.1f}")
```
```cpp title="복제된 수집기 — 요구가 두 곳에만 반영됐다"
#include <iomanip>
#include <iostream>
#include <string>
#include <utility>
#include <vector>
using namespace std;

const double BAD_TEMP = -999.0;            // 센서 고장 시 장비가 내보내는 표식

using Rec = pair<string, double>;

Rec split_at(const string& ln, char sep) { // 문자열 분할은 표준에 없다
    size_t p = ln.find(sep);
    return {ln.substr(0, p), stod(ln.substr(p + 1))};
}

vector<Rec> collect_alpha(const vector<string>& lines) {
    vector<Rec> out;
    for (const string& ln : lines) {
        if (ln.empty())
            continue;
        auto [name, temp] = split_at(ln, ',');   // 알파 기종은 쉼표로 나눈다
        if (temp == BAD_TEMP)                    // 나중에 들어온 요구 — 여기는 고쳤다
            continue;
        out.push_back({name, temp});
    }
    return out;
}

vector<Rec> collect_bravo(const vector<string>& lines) {
    vector<Rec> out;
    for (const string& ln : lines) {
        if (ln.empty())
            continue;
        auto [name, temp] = split_at(ln, '|');   // 브라보 기종은 파이프로 나눈다
        if (temp == BAD_TEMP)                    // 여기도 고쳤다
            continue;
        out.push_back({name, temp});
    }
    return out;
}

vector<Rec> collect_delta(const vector<string>& lines) {
    vector<Rec> out;
    for (const string& ln : lines) {
        if (ln.empty())
            continue;
        auto [name, temp] = split_at(ln, ' ');   // 델타 기종은 공백으로 나눈다
        out.push_back({name, temp});             // 여기만 빠뜨렸다
    }
    return out;
}

double mean(const vector<Rec>& recs) {
    double s = 0;
    for (const auto& r : recs) s += r.second;
    return s / recs.size();
}

int main() {
    vector<string> alpha = {"a1,21.0", "a2,-999", "", "a3,21.8"};
    vector<string> bravo = {"b1|22.5", "b2|-999", "b3|21.5"};
    vector<string> delta = {"d1 21.2", "d2 -999", "d3 21.6"};

    cout << fixed << setprecision(1);
    cout << "alpha 평균 " << mean(collect_alpha(alpha)) << "\n";
    cout << "bravo 평균 " << mean(collect_bravo(bravo)) << "\n";
    cout << "delta 평균 " << mean(collect_delta(delta)) << "\n";
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
alpha 평균 21.4
bravo 평균 22.0
delta 평균 -318.7
```

**비용:** 실행 시간은 세 판 모두 $O(n)$ — 줄 하나를 한 번씩만 본다. 문제는 실행 시간이 아니라 **수정 비용**이고, 그쪽이 $O(m \times r)$이다. 기종 $m$개마다 공통 규칙 $r$개를 따로 적어 두었기 때문에 규칙 하나가 바뀌면 $m$군데를 손대야 한다. 알고리즘의 복잡도는 같은데 유지보수의 복잡도가 다른 것이 이 절의 주제다.

### 3.2 순서를 한 곳에 고정한다

절차를 한 벌만 남기고 변하는 단계에 구멍을 뚫는다. 아래 블록은 같은 구조를 **두 가지 방식**으로 보인다. 위쪽은 상속으로 구멍을 메우고, 아래쪽은 함수를 넘겨 메운다. 둘의 출력은 같다.

::: dual
```python title="골격 한 벌 — 상속판과 함수판"
BAD_TEMP = -999.0

class Collector:
    def collect(self, lines):              # 골격. 이 함수는 한 벌뿐이다
        out = []
        for ln in lines:
            if not ln:
                continue
            name, temp = self.split_record(ln)   # 구멍
            if temp == BAD_TEMP:                 # 요구는 이 한 곳에만 산다
                continue
            out.append((name, temp))
        return out

    def split_record(self, ln):
        raise NotImplementedError

class Alpha(Collector):
    def split_record(self, ln):
        name, temp = ln.split(",")
        return name, float(temp)

class Bravo(Collector):
    def split_record(self, ln):
        name, temp = ln.split("|")
        return name, float(temp)

class Delta(Collector):
    def split_record(self, ln):
        name, temp = ln.split(" ")
        return name, float(temp)

def collect(lines, split_record):          # 함수판 — 상속이 없다. 골격은 똑같다
    out = []
    for ln in lines:
        if not ln:
            continue
        name, temp = split_record(ln)
        if temp == BAD_TEMP:
            continue
        out.append((name, temp))
    return out

def mean(recs):
    return sum(t for _, t in recs) / len(recs)

def split_delta(ln):
    name, temp = ln.split(" ")
    return name, float(temp)

alpha = ["a1,21.0", "a2,-999", "", "a3,21.8"]
bravo = ["b1|22.5", "b2|-999", "b3|21.5"]
delta = ["d1 21.2", "d2 -999", "d3 21.6"]

print(f"상속판 alpha {mean(Alpha().collect(alpha)):.1f}")
print(f"상속판 bravo {mean(Bravo().collect(bravo)):.1f}")
print(f"상속판 delta {mean(Delta().collect(delta)):.1f}")
print(f"함수판 delta {mean(collect(delta, split_delta)):.1f}")
```
```cpp title="골격 한 벌 — 상속판과 함수판"
#include <functional>
#include <iomanip>
#include <iostream>
#include <string>
#include <utility>
#include <vector>
using namespace std;

const double BAD_TEMP = -999.0;

using Rec = pair<string, double>;

Rec split_at(const string& ln, char sep) {
    size_t p = ln.find(sep);
    return {ln.substr(0, p), stod(ln.substr(p + 1))};
}

struct Collector {
    virtual ~Collector() = default;

    vector<Rec> collect(const vector<string>& lines) const {   // 골격. 이 함수는 한 벌뿐이다
        vector<Rec> out;
        for (const string& ln : lines) {
            if (ln.empty())
                continue;
            auto [name, temp] = split_record(ln);              // 구멍
            if (temp == BAD_TEMP)                              // 요구는 이 한 곳에만 산다
                continue;
            out.push_back({name, temp});
        }
        return out;
    }

    virtual Rec split_record(const string& ln) const = 0;
};

struct Alpha : Collector {
    Rec split_record(const string& ln) const override { return split_at(ln, ','); }
};
struct Bravo : Collector {
    Rec split_record(const string& ln) const override { return split_at(ln, '|'); }
};
struct Delta : Collector {
    Rec split_record(const string& ln) const override { return split_at(ln, ' '); }
};

// 함수판 — 상속이 없다. 골격은 똑같다
vector<Rec> collect(const vector<string>& lines,
                    const function<Rec(const string&)>& split_record) {
    vector<Rec> out;
    for (const string& ln : lines) {
        if (ln.empty())
            continue;
        auto [name, temp] = split_record(ln);
        if (temp == BAD_TEMP)
            continue;
        out.push_back({name, temp});
    }
    return out;
}

double mean(const vector<Rec>& recs) {
    double s = 0;
    for (const auto& r : recs) s += r.second;
    return s / recs.size();
}

Rec split_delta(const string& ln) { return split_at(ln, ' '); }

int main() {
    vector<string> alpha = {"a1,21.0", "a2,-999", "", "a3,21.8"};
    vector<string> bravo = {"b1|22.5", "b2|-999", "b3|21.5"};
    vector<string> delta = {"d1 21.2", "d2 -999", "d3 21.6"};

    cout << fixed << setprecision(1);
    cout << "상속판 alpha " << mean(Alpha().collect(alpha)) << "\n";
    cout << "상속판 bravo " << mean(Bravo().collect(bravo)) << "\n";
    cout << "상속판 delta " << mean(Delta().collect(delta)) << "\n";
    cout << "함수판 delta " << mean(collect(delta, split_delta)) << "\n";
    return 0;
}
```
:::

```console
상속판 alpha 21.4
상속판 bravo 22.0
상속판 delta 21.4
함수판 delta 21.4
```

델타가 21.4로 돌아왔다. 고친 것은 `-999` 검사 **한 줄**이고, 그 한 줄이 세 기종에 동시에 적용됐다.

**비용:** 실행 시간은 여전히 $O(n)$ — 줄마다 구멍 호출 한 번이 추가될 뿐이고 그 호출이 $O(1)$이다. 수정 비용이 $O(m \times r)$에서 $O(r)$로 떨어진 것이 이 구조가 산 것이다. 대신 호출이 간접 호출로 바뀌면서 상수가 붙는다 — C++의 가상 함수 호출은 vtable을 한 번 더 읽고 인라인되지 않는다. 줄 하나당 나노초 단위이므로 로그 배치에서는 무시할 수 있지만, 제어 루프의 내부 반복에서는 이 상수가 그대로 주기에 실린다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 구멍의 선언 | `raise NotImplementedError`. 안 채우면 **호출할 때** 터진다 | `= 0` 순수 가상 함수. 안 채우면 **컴파일 때** 막힌다 |
| 함수판의 인자 타입 | 그냥 넘긴다. 호출 가능하기만 하면 된다 | `std::function<Rec(const string&)>` — 시그니처를 적어야 하고 `<functional>`이 필요하다 |
| 함수판의 비용 | 일반 호출과 같다 | `std::function`은 타입 소거라 힙 할당·간접 호출이 붙는다. 템플릿 인자로 받으면 인라인된다 |
| 문자열 분할 | `str.split(sep)` 내장 | 표준에 없다. `find` + `substr`로 직접 짠다 |

::: warn
함수판이 상속판보다 짧다는 것이 이 표의 핵심이 아니다. 핵심은 **테스트**다. 상속판의 골격을 테스트하려면 하위 클래스를 하나 만들어야 한다. 함수판은 `collect(lines, lambda ln: ("x", 1.0))` 한 줄이면 골격만 격리해서 검사할 수 있다. Python에서 상속 계층을 먼저 그리는 습관은 대개 이 이득을 그냥 버린다.
:::

::: note
그렇다고 Python에서 클래스가 늘 과잉인 것은 아니다. **구멍이 두 개를 넘어가면** 함수 여러 개를 인자로 줄줄이 넘기는 쪽이 더 읽기 나빠진다. 그때는 훅을 담은 작은 딕셔너리나 클래스가 낫다. 경계는 대략 이렇다 — 구멍이 하나면 함수, 구멍이 여럿이고 그것들이 **상태를 공유하면** 클래스.
:::

### 3.3 받을 사람을 줄 세운다

오류 처리로 넘어간다. 핸들러를 하나로 잇고, 각자 "내 것이냐"를 판단한다.

::: dual
```python title="핸들러 줄 세우기 — 끝이 비었을 때와 아닐 때"
class Handler:
    def __init__(self):
        self.nxt = None

    def handle(self, ev):
        if self.can(ev):
            self.act(ev)
            return True
        if self.nxt is not None:       # 내 것이 아니면 다음에게 넘긴다
            return self.nxt.handle(ev)
        return False                   # 줄 끝. 아무도 받지 않았다

    def can(self, ev):
        return False

    def act(self, ev):
        pass

class ParseHandler(Handler):
    def can(self, ev):
        return ev == "parse"
    def act(self, ev):
        print(f"  {ev:6s} -> 그 줄만 버리고 계속한다")

class IoHandler(Handler):
    def can(self, ev):
        return ev == "io"
    def act(self, ev):
        print(f"  {ev:6s} -> 3초 뒤 다시 읽는다")

class RangeHandler(Handler):
    def can(self, ev):
        return ev == "range"
    def act(self, ev):
        print(f"  {ev:6s} -> 값을 경계로 자르고 계속한다")

class Fallback(Handler):
    def can(self, ev):
        return True                    # 무엇이든 받는다
    def act(self, ev):
        print(f"  {ev:6s} -> 미상 오류로 기록하고 상위로 올린다")

def chain(*handlers):
    for a, b in zip(handlers, handlers[1:]):
        a.nxt = b
    return handlers[0]

events = ["parse", "io", "range", "auth"]

print("[1차] 줄 끝이 비어 있다")
head = chain(ParseHandler(), IoHandler(), RangeHandler())
done = sum(head.handle(ev) for ev in events)
print(f"  처리 {done} / {len(events)}")

print("[2차] 줄 끝에 기본 핸들러를 둔다")
head = chain(ParseHandler(), IoHandler(), RangeHandler(), Fallback())
done = sum(head.handle(ev) for ev in events)
print(f"  처리 {done} / {len(events)}")
```
```cpp title="핸들러 줄 세우기 — 끝이 비었을 때와 아닐 때"
#include <iomanip>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
using namespace std;

struct Handler {
    virtual ~Handler() = default;
    unique_ptr<Handler> nxt;

    bool handle(const string& ev) const {
        if (can(ev)) {
            act(ev);
            return true;
        }
        if (nxt)                       // 내 것이 아니면 다음에게 넘긴다
            return nxt->handle(ev);
        return false;                  // 줄 끝. 아무도 받지 않았다
    }

    virtual bool can(const string& ev) const { return false; }
    virtual void act(const string& ev) const {}
};

struct ParseHandler : Handler {
    bool can(const string& ev) const override { return ev == "parse"; }
    void act(const string& ev) const override {
        cout << "  " << setw(6) << left << ev << " -> 그 줄만 버리고 계속한다\n";
    }
};

struct IoHandler : Handler {
    bool can(const string& ev) const override { return ev == "io"; }
    void act(const string& ev) const override {
        cout << "  " << setw(6) << left << ev << " -> 3초 뒤 다시 읽는다\n";
    }
};

struct RangeHandler : Handler {
    bool can(const string& ev) const override { return ev == "range"; }
    void act(const string& ev) const override {
        cout << "  " << setw(6) << left << ev << " -> 값을 경계로 자르고 계속한다\n";
    }
};

struct Fallback : Handler {
    bool can(const string& ev) const override { return true; }   // 무엇이든 받는다
    void act(const string& ev) const override {
        cout << "  " << setw(6) << left << ev << " -> 미상 오류로 기록하고 상위로 올린다\n";
    }
};

unique_ptr<Handler> chain(vector<unique_ptr<Handler>> handlers) {
    for (size_t i = handlers.size() - 1; i > 0; --i)
        handlers[i - 1]->nxt = move(handlers[i]);
    return move(handlers[0]);
}

int main() {
    vector<string> events = {"parse", "io", "range", "auth"};

    cout << "[1차] 줄 끝이 비어 있다\n";
    unique_ptr<Handler> head;
    {
        vector<unique_ptr<Handler>> hs;
        hs.push_back(make_unique<ParseHandler>());
        hs.push_back(make_unique<IoHandler>());
        hs.push_back(make_unique<RangeHandler>());
        head = chain(move(hs));
    }
    int done = 0;
    for (const string& ev : events) done += head->handle(ev);
    cout << "  처리 " << done << " / " << events.size() << "\n";

    cout << "[2차] 줄 끝에 기본 핸들러를 둔다\n";
    {
        vector<unique_ptr<Handler>> hs;
        hs.push_back(make_unique<ParseHandler>());
        hs.push_back(make_unique<IoHandler>());
        hs.push_back(make_unique<RangeHandler>());
        hs.push_back(make_unique<Fallback>());
        head = chain(move(hs));
    }
    done = 0;
    for (const string& ev : events) done += head->handle(ev);
    cout << "  처리 " << done << " / " << events.size() << "\n";
    return 0;
}
```
:::

```console
[1차] 줄 끝이 비어 있다
  parse  -> 그 줄만 버리고 계속한다
  io     -> 3초 뒤 다시 읽는다
  range  -> 값을 경계로 자르고 계속한다
  처리 3 / 4
[2차] 줄 끝에 기본 핸들러를 둔다
  parse  -> 그 줄만 버리고 계속한다
  io     -> 3초 뒤 다시 읽는다
  range  -> 값을 경계로 자르고 계속한다
  auth   -> 미상 오류로 기록하고 상위로 올린다
  처리 4 / 4
```

1차에서 `auth`는 **아무 줄도 남기지 않았다.** 예외도 없고 로그도 없다. `처리 3 / 4`라는 숫자를 세어 보지 않으면 하나가 사라졌다는 사실 자체를 알 수 없다. 2차에서 줄 끝에 무엇이든 받는 핸들러를 하나 세우자 4/4가 됐다.

**비용:** 시간 $O(k)$ — 핸들러 $k$개를 앞에서부터 한 번씩 물어보므로 판정이 최대 $k$회다. 공간은 재귀 호출이 $O(k)$ 스택을 쓴다. 최악은 아무도 받지 않는 경우이고, 그때 $O(k)$를 전부 쓰고 아무 일도 일어나지 않는다. **가장 비싼 경로가 가장 조용한 경로**라는 것이 이 구조의 성격이다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 줄 연결 | `a.nxt = b`. 참조만 대입, 수명은 GC가 본다 | `unique_ptr`로 앞이 뒤를 소유한다. 뒤에서부터 `move`로 엮는다 |
| 줄 재구성 | 같은 핸들러 객체를 다른 줄에 다시 끼울 수 있다 | `unique_ptr`는 옮겨지므로 원래 줄이 끊긴다. 공유하려면 `shared_ptr` |
| 기본 구현 | `can`이 `False`를 반환하는 기본 메서드 | 순수 가상으로 두면 기본 핸들러도 다 구현해야 하므로 가상 함수 + 기본 본문 |
| 반환값 무시 | 조용히 버려진다 | `[[nodiscard]]`를 붙이면 컴파일러가 경고한다 |

::: danger
`handle`의 반환값을 안 보는 호출자가 이 구조의 실제 사고 지점이다. C++에서는 `bool handle(...)`에 `[[nodiscard]]`를 붙여 컴파일러에게 감시를 넘길 수 있다. Python에는 그 장치가 없다. **줄 끝에 무엇이든 받는 핸들러를 반드시 세우는 것**이 두 언어 공통의 방어책이고, 그것이 없는 줄은 미완성이다.
:::

::: pitfall
- **줄의 순서가 암묵적 계약이 된다.** `range`가 `parse` 앞에 오면 결과가 달라지는 경우가 생긴다. 순서에 의미가 있으면 그 의미를 코드가 아니라 문서에 적어야 한다는 뜻이고, 그것은 나중에 반드시 어긋난다.
- **두 핸들러가 같은 이벤트를 받겠다고 하면 앞에 선 쪽이 이긴다.** 조용히 이긴다. 판정 조건이 겹치는지 검사하는 코드는 아무 데도 없다.
- **깊은 줄은 스택 추적을 어지럽힌다.** 핸들러 20개짜리 줄에서 예외가 나면 스택에 `handle`이 20번 쌓인다. 반복문으로 펴면 스택은 얕아지지만 "다음에게 넘긴다"는 각자의 판단이 밖으로 나가 버린다.
- **자기 자신을 다시 넣으면 무한 재귀다.** 줄을 동적으로 조립하는 코드에서 실제로 일어난다.
:::

## 4. 이제 이름을 붙인다

3.2가 **Template Method**다. 상위 클래스가 알고리즘의 골격을 확정하고, 그 안의 특정 단계를 하위 클래스가 재정의한다. 골격 메서드(`collect`)는 재정의 대상이 아니고, 구멍(`split_record`)만 재정의 대상이다. 구멍을 **훅 메서드**라 부른다.

의도는 한 문장이다. **"순서는 내가 정한다. 내용은 네가 채워라."** 부모가 자식을 부르는 이 방향을 제어의 역전(inversion of control)이라 하고, 프레임워크와 라이브러리를 가르는 기준이기도 하다. 라이브러리는 당신이 부르고, 프레임워크는 당신을 부른다.

3.3이 **Chain of Responsibility**(책임 연쇄)다. 요청을 보낸 쪽과 처리하는 쪽을 끊고, 처리자 후보를 줄로 이어 요청이 그 줄을 타고 흐르게 한다. 각 핸들러는 자기 것이면 처리하고 멈추거나, 아니면 다음에게 넘긴다.

두 패턴이 한 챕터에 묶인 이유는 둘 다 **흐름의 모양을 고정한다**는 점이 같기 때문이다. 다른 것은 고정하는 층위다. Template Method는 **한 알고리즘 안의 단계 순서**를 고정하고, Chain of Responsibility는 **여러 객체를 지나가는 경로**를 고정한다.

::: note
[XII-4 Decorator / Composite](#/xii-4)의 Decorator와 구조가 거의 같다는 점이 자주 혼동을 만든다. 둘 다 객체를 감싸 이어 붙이고, 요청이 그 사슬을 따라 흐른다. **차이는 의도에 있다.** Decorator는 기능을 덧입히고 **항상 다음으로 넘긴다.** Chain of Responsibility는 처리자를 찾는 것이 목적이고 **멈출 수 있다.** 그래서 웹 미들웨어는 둘 다로 설명된다 — 인증 미들웨어가 401을 반환하고 끊으면 그 순간은 책임 연쇄고, 요청 로깅 미들웨어가 기록만 하고 넘기면 그 순간은 데코레이터다.
:::

## 5. 어디에 박혀 있는가

**단위 테스트 프레임워크**가 Template Method의 가장 흔한 사례다. `setUp` → 테스트 메서드 → `tearDown`이라는 순서는 프레임워크가 고정하고, 당신은 구멍만 채운다. 테스트가 예외로 죽어도 `tearDown`이 도는 것은 그 순서가 당신 코드 밖에 있기 때문이다.

**공유 인터럽트 라인**이 Chain of Responsibility의 가장 정확한 사례다. 하나의 IRQ 번호를 여러 장치가 나눠 쓸 때, 커널은 그 번호에 등록된 핸들러들을 순서대로 호출한다. 각 핸들러는 자기 장치의 상태 레지스터를 읽어 "이번 인터럽트가 내 것인가"를 판정하고, 아니면 "내 것이 아니다"를 반환해 다음 핸들러로 넘긴다. 아무도 자기 것이라고 하지 않는 인터럽트가 반복되면 커널은 그 라인을 아예 막아 버린다 — 3.3에서 본 "아무도 안 받는 요청" 문제를 운영체제 수준에서 감시하고 있는 것이다.

**웹 프레임워크의 미들웨어 체인**도 같은 구조다. 요청이 인증 → 로깅 → 라우팅 순으로 흐르고, 인증이 실패하면 그 자리에서 응답을 만들어 반환하며 뒤로 넘기지 않는다.

**로깅 라이브러리의 로거 계층**은 두 패턴이 겹쳐 있다. 로그 레코드는 `app.db.pool` 로거에서 `app.db`, `app`, 루트로 거슬러 올라가며 각 단계의 핸들러를 만난다. 이 전파는 책임 연쇄이고, "레코드를 만들고 → 포맷하고 → 내보낸다"는 각 핸들러 내부의 고정 순서는 Template Method다.

**로봇 미들웨어의 라이프사이클 노드**도 Template Method다. `configure` → `activate` → `deactivate` → `cleanup`이라는 상태 전이 순서는 프레임워크가 고정하고, 각 전이에서 무엇을 할지만 당신이 채운다. 그 순서가 고정되어 있어야 관제 쪽에서 노드 수십 개의 상태를 한꺼번에 다룰 수 있다. 상태 전이 자체는 [XI-6 상태 기계](#/xi-6)에서 다룬다.

## 6. 언제 쓰지 말아야 하는가

**Template Method — 구현체가 하나뿐일 때.** 기종이 하나인데 골격 클래스와 하위 클래스를 나누면 얻는 것이 없다. 파일 두 개, 클래스 두 개가 늘고 흐름을 읽으려면 두 곳을 오가야 한다. 두 번째 구현체가 실제로 생겼을 때 나눠도 늦지 않다.

**Template Method — 상속 축이 이미 다른 것에 쓰였을 때.** 상속은 축이 하나다. `Collector`를 상속해 기종별로 나누고 나면, 이번에는 "동기 수집기 / 비동기 수집기"라는 두 번째 축을 상속으로 표현할 수 없다. 조합이 $m \times n$개의 클래스로 폭발한다. 축이 둘 이상이면 상속이 아니라 [XII-6 Strategy](#/xii-6)처럼 **끼워 넣는 방식**이 맞다.

**Template Method — 구멍이 다섯 개를 넘어갈 때.** 하위 클래스를 새로 쓰는 사람이 다섯 개 중 무엇이 필수이고 무엇이 선택인지 알 방법이 없다. 그 시점에서 골격은 이미 골격이 아니라 설정 파일이고, 명시적인 설정 객체로 바꾸는 편이 정직하다.

**Chain of Responsibility — 후보가 셋 미만이고 조건이 상호배타일 때.** 딕셔너리 하나로 끝난다. `HANDLERS[ev]()`가 $O(1)$이고, 등록되지 않은 키가 `KeyError`로 즉시 터진다. 조용히 사라지는 것보다 낫다. 줄 세우기가 값을 하는 조건은 **판정이 단순 동등 비교가 아닐 때**(범위·패턴·상태 조합), 그리고 **줄의 구성을 실행 중에 바꿔야 할 때**다.

**Chain of Responsibility — 반드시 누군가 처리해야 하는 요청일 때.** 이 구조는 "아무도 안 받음"을 정상 흐름으로 허용한다. 그 허용이 필요 없다면 구조가 요구사항보다 헐거운 것이고, 헐거운 만큼이 버그의 서식지가 된다.

::: warn
두 패턴 모두 **흐름을 파일 여러 개에 흩는다.** 디버거로 `collect`에 들어가면 다음 줄이 어느 파일의 `split_record`인지는 실행해 봐야 알고, 미들웨어 체인에서는 요청이 지나간 경로가 코드 어디에도 한눈에 적혀 있지 않다. 새로 합류한 사람이 "여기서 무슨 일이 일어나는가"를 못 찾는 비용은 실재하고, 간접 계층 하나당 한 번씩 든다. 이 비용을 지불할 만큼 변화가 잦은 자리인지 먼저 확인하라. 남용의 일반론은 [XII-15 안티패턴](#/xii-15)에서 다시 다룬다.
:::

## 연습

::: quiz
**1. 야간 배치와 실시간 수집의 오류 정책이 다르다**

- 상황: 같은 수집 파이프라인을 야간 배치와 실시간 수집이 함께 쓴다. 야간에는 형식 오류를 넘어가고, 실시간에서는 즉시 멈추고 알림을 보내야 한다. 지금은 파이프라인 안에 `if is_batch:`가 박혀 있다.
- 무엇이 변하고 무엇이 고정인가: 오류의 **종류**는 고정이고, 그 종류에 대한 **대응**이 실행 환경마다 변한다. 파이프라인이 오류를 감지하는 지점은 고정이다.
- 어떤 구조이고 무엇을 대가로 치르는가: 대응을 파이프라인 밖에서 조립해 주입한다. 대가는 "어떤 대응이 실제로 걸렸는가"가 실행 시점에만 정해진다는 것이다. 조립 지점을 한 곳으로 모으고 조립 결과를 시작 시 로그로 남겨 이 비용을 갚아라.

**2. 훅이 여덟 개인 골격**

- 상황: 리포트 생성 골격에 훅이 여덟 개다. 새 리포트를 추가하는 사람이 매번 어느 훅을 채워야 하는지 물어본다.
- 무엇이 변하고 무엇이 고정인가: 여덟 개 중 실제로 리포트마다 다른 것이 두세 개고 나머지는 항상 기본값이다. 즉 "변한다고 선언된 것"과 "실제로 변하는 것"이 어긋나 있다.
- 어떤 구조이고 무엇을 대가로 치르는가: 실제로 변하는 것만 남기고 나머지는 골격 안으로 되돌린다. 판단 기준은 "지금까지 이 훅을 재정의한 하위 클래스가 몇 개인가"이고, 0개면 훅이 아니다.

**3. 줄 끝에서 사라지는 이벤트**

- 상황: 이벤트 처리 줄에 핸들러가 열두 개다. 특정 이벤트가 처리되지 않는다는 제보가 들어왔는데 로그에는 아무 흔적이 없다.
- 무엇이 변하고 무엇이 고정인가: 줄의 구성은 배포마다 변하고, "요청은 반드시 어딘가에서 결말이 난다"는 불변식은 고정이어야 한다.
- 어떤 구조이고 무엇을 대가로 치르는가: 줄 끝에 무엇이든 받는 핸들러를 세우고, 그 핸들러가 기록을 남기게 한다. 대가는 진짜 오류가 경고 로그에 묻힐 수 있다는 것이고, 그래서 이 핸들러가 남기는 것은 경고가 아니라 계측 지표여야 한다.
:::

## 요약

- 절차 네 단계 중 하나만 바뀌는데 네 단계를 통째로 복제하면, 공통 규칙 하나를 고칠 때 $m \times r$군데를 손대야 한다. 순서를 한 곳에 고정하고 변하는 단계에 구멍을 뚫으면 $O(r)$이 된다. 이것이 **Template Method**다.
- 처리자가 미리 정해지지 않는 요청은 후보를 줄로 세우고 앞에서부터 물어본다. 이것이 **Chain of Responsibility**다.
- 책임 연쇄의 유일한 치명적 함정은 **줄 끝에서 요청이 조용히 사라지는 것**이다. 무엇이든 받는 핸들러를 줄 끝에 세워야 완성이다.
- Decorator와 구조가 같고 의도가 다르다. Decorator는 항상 넘기고, 책임 연쇄는 멈출 수 있다.
- Python에서 Template Method는 함수 하나를 넘기는 것으로 접힌다. 구멍이 하나면 함수, 구멍이 여럿이고 상태를 공유하면 클래스가 경계다.
- 상속으로 만든 골격은 축이 하나뿐이다. 두 번째 변화 축이 생기면 클래스가 곱으로 늘어난다.
- 두 패턴 다 흐름을 파일 여럿에 흩는다. 변화가 잦지 않은 자리라면 그 비용이 이득보다 크다.

**다음 절**: [XII-11 Mediator](#/xii-11) — 개체 스무 개가 서로를 직접 알면 결합이 190쌍이 된다. 그 숫자를 20으로 되돌리는 대신 무엇을 내주는가.
