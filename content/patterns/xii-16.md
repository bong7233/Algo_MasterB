# XII-16 패턴 선택 결정 트리

::: lead
열다섯 개의 이름을 다 알아도 상황 앞에서 못 고르면 아무것도 아니다. 그 판단을 절차로 만든다.
:::

## 1. 문제

패턴 카탈로그를 다 읽은 사람이 설계 회의에서 가장 자주 하는 말은 "여기에 팩토리를 쓰면 될 것 같은데요"다. 그다음 질문은 "왜요"이고, 거기서 대개 막힌다.

막히는 이유는 지식의 부재가 아니다. **패턴을 이름 순으로 배우면 이름에서 상황으로 가는 화살표만 생긴다.** 실제로 필요한 것은 반대 방향이다. 상황이 먼저 있고 이름은 마지막에 붙는다.

그리고 방향이 뒤집힌 채로 쓰면 두 가지 실패가 나온다. 하나는 **이름을 먼저 고르고 문제를 거기 맞추는 것**이다. 옵저버를 쓰기로 정한 뒤 굳이 통지할 것을 만든다. 다른 하나는 **비슷한 둘 사이에서 못 고르는 것**이다. 어댑터와 파사드는 둘 다 "다른 얼굴을 씌운다"이고, 데코레이터와 프록시는 둘 다 "같은 인터페이스로 감싼다"이며, 상태와 전략은 클래스 그림이 완전히 같다. 그림이 같으면 그림으로는 못 고른다.

[I-4 결정 트리 전문](#/i-4)이 알고리즘에 대해 같은 문제를 풀었다. 방법도 같다. **두 개의 축을 세우고, 지문이 아니라 요구사항 문장에서 축의 값을 읽는다.**

## 2. 두 개의 축

### 2.1 첫째 축 — 무엇이 변하는가

패턴은 전부 "변하는 것을 변하지 않는 것에서 떼어 내는 방법"이다([XII-1 패턴을 왜 배우는가](#/xii-1)). 그래서 첫 질문은 하나다. **이 시스템에서 앞으로 늘어날 것은 무엇인가.** 답은 다섯 갈래다.

- **알고리즘·정책이 는다.** 압축 방식이, 경로 계획기가, 요금 규칙이 늘어난다.
- **생성되는 구체 타입이 는다.** 드라이버 기종이, 문서 형식이, 플러그인이 늘어난다.
- **호출자가 보는 모양이 문제다.** 있는 것을 그대로 쓸 수 없거나, 너무 많은 것이 보이거나, 감싸서 무언가를 더해야 한다.
- **변화를 알려야 할 대상이 는다.** 상태가 바뀌었을 때 반응해야 할 곳이 늘어난다.
- **상태에 따라 행동이 달라진다.** 같은 입력이 지금 어느 상태냐에 따라 다른 결과를 낸다.

### 2.2 둘째 축 — 어떤 제약이 붙는가

첫 축만으로는 갈라지지 않는다. 같은 갈래 안에서 답을 가르는 것은 요구사항에 붙은 제약이다.

| 제약 문장 | 무엇을 요구하는가 | 어디로 가는가 |
|---|---|---|
| "실행 중에 바꿀 수 있어야 한다" | 객체를 갈아 끼울 지점 | Strategy, plugin registry |
| "취소하거나 다시 실행할 수 있어야 한다" | 요청이 **객체로 남아야** 한다 | Command |
| "보내는 쪽과 받는 쪽이 서로를 몰라야 한다" | 이름만의 결합 | Observer |
| "받는 쪽이 없어도 보내는 쪽이 돌아야 한다" | **수명의 분리** | broker / event bus |
| "이것들은 항상 같은 조합이어야 한다" | 가족 단위의 일관성 | Abstract Factory |
| "순서는 고정이고 일부만 달라진다" | 골격의 고정 | Template Method |
| "호출자가 기다리면 안 된다" | 실행 흐름의 분리 | Active Object |

두 축을 곱하면 답이 하나로 좁혀진다. 그리고 좁혀지지 않으면 **아직 요구사항이 덜 적힌 것**이다 — 그때 필요한 것은 패턴이 아니라 질문 하나 더다.

### 2.3 셋째 축이 하나 더 있다 — 어떤 언어인가

두 축으로 잎에 도달했는데 **그 잎이 이 언어에서는 이름이 필요 없는 경우**가 있다. Part XII 를 관통한 명제가 이것이다. GoF 카탈로그의 상당수는 C++ 의 제약에서 나왔고, 그 제약이 없는 언어에서는 패턴의 존재가 흐려진다.

| 잎 | Python 에서의 최소 형태 | 이름과 구조가 다시 필요해지는 경계 |
|---|---|---|
| Strategy | 함수를 인자로 넘긴다 | 전략이 상태를 들 때, 여러 전략을 이름으로 등록·발견할 때 |
| Command | 클로저 하나 | 되돌리기 이력·직렬화·재시도 횟수가 붙을 때 |
| Template Method | 고차 함수에 훅을 넘긴다 | 훅이 넷을 넘고 기본 구현이 필요할 때 |
| Abstract Factory | 덕 타이핑이라 팩토리 인터페이스가 없어도 된다 | 가족의 일관성을 타입으로 강제해야 할 때 |
| Singleton | 모듈이 이미 싱글톤이다 | 없다. 대개 클래스를 만들 이유가 없다 |
| Iterator | 언어에 내장됐다 | 없다 |

**"Python 에서는 필요 없다"로 끝내면 절반만 맞다.** 오른쪽 열이 그 경계이고, 규모가 커지면 같은 언어에서도 결국 이름과 구조가 생긴다. 반대로 C++ 에서도 `std::function` 과 람다가 들어온 뒤로 Strategy 를 클래스 계층으로 짤 이유가 크게 줄었다. **패턴은 언어의 빈틈을 메우는 것이고, 언어가 그 빈틈을 메우면 패턴은 사라진다.**

::: deep
GoF 는 패턴을 생성·구조·행위 셋으로 나눴다. 그 분류는 **카탈로그를 찾아보기 위한 색인**이지 선택 절차가 아니다. 어댑터와 데코레이터가 같은 "구조" 칸에 있다는 사실은 둘을 고르는 데 아무 도움이 되지 않는다 — 둘의 클래스 그림이 거의 같기 때문이다. 실제로 가르는 것은 **의도**다. 어댑터는 인터페이스를 바꾸고 기능은 그대로 두며, 데코레이터는 인터페이스를 그대로 두고 기능을 더한다.

이 절의 트리가 색인이 아니라 절차인 이유가 이것이다. 첫 질문이 "무엇이 변하는가"인 것은 우연이 아니라 **패턴의 정의 자체가 변하는 것의 분리**이기 때문이고, 둘째 질문이 제약인 것은 같은 변화를 서로 다른 요구가 다른 모양으로 밀어내기 때문이다. 카탈로그의 칸이 아니라 요구사항 문장이 답을 정한다.
:::

### 2.4 결정 트리

```text nolines
  STEP 1   what varies ?
    ├── an algorithm or a policy          ──▶ go to 2.1
    ├── which concrete type gets created  ──▶ go to 2.2
    ├── the shape a caller sees           ──▶ go to 2.3
    ├── who must be told about a change   ──▶ go to 2.4
    └── behaviour that depends on state   ──▶ go to 2.5
```

```text nolines
  2.1  an algorithm or a policy varies
    ├── swap it at run time                   ──▶ Strategy                (XII-6)
    ├── the request is queued / undone        ──▶ Command                 (XII-9)
    ├── order is fixed, only steps vary       ──▶ Template Method         (XII-10)
    └── one of many handlers may take it      ──▶ Chain of Responsibility (XII-10)

  2.2  creation varies
    ├── a subclass decides the product        ──▶ Factory Method          (XII-5)
    ├── a family must stay consistent         ──▶ Abstract Factory        (XII-5)
    ├── many optional parts, one result       ──▶ Builder                 (XII-5)
    ├── found by name at run time             ──▶ plugin registry         (XII-14)
    └── exactly one, and it is physical       ──▶ Singleton, read first   (XII-12)

  2.3  the shape a caller sees varies
    ├── an existing type has the wrong shape  ──▶ Adapter                 (XII-2)
    ├── a subsystem needs a single door       ──▶ Facade                  (XII-3)
    ├── abstraction and impl vary separately  ──▶ Bridge                  (XII-3)
    ├── access is controlled or delayed       ──▶ Proxy                   (XII-3)
    ├── behaviour is added in layers          ──▶ Decorator               (XII-4)
    └── one and many must look alike          ──▶ Composite               (XII-4)

  2.4  notification varies
    ├── publisher must not know subscribers   ──▶ Observer                (XII-7)
    ├── lifetimes must be decoupled as well   ──▶ broker / event bus      (XII-7)
    └── n-to-n wiring must be centralised     ──▶ Mediator                (XII-11)

  2.5  behaviour depends on state
    ├── transitions are the real logic        ──▶ State                   (XII-8)
    └── work must leave the caller thread     ──▶ Active Object           (XII-13)
```

트리의 잎에 도달했다면 아직 한 단계가 남았다. **지금 뽑을 것인가.** 그 판단은 §6에 있다.

## 3. 두 후보가 갈리는 자리

트리에서 가장 자주 갈리는 지점을 하나 돌려 본다. 문서에 변환을 건다. 요구가 "변환 방식을 실행 중에 바꿀 수 있어야 한다"뿐이면 함수를 갈아 끼우면 되고, 요구에 "되돌릴 수 있어야 한다"가 하나 더 붙으면 그것으로는 안 된다.

::: dual
```python title="같은 그림, 다른 답 — 함수 교체와 요청 객체"
TEXT = "hello world"


def upper(s):
    return s.upper()


def reverse(s):
    return s[::-1]


# 후보 1 — 바뀌는 것이 "어떻게 변환하는가" 뿐이라고 보고 함수를 갈아끼운다
def apply_strategy(doc, transform):
    return transform(doc)


# 후보 2 — 바뀌는 것을 "요청 그 자체" 로 보고 객체에 담는다
class TransformCommand:
    def __init__(self, transform):
        self._transform = transform
        self._before = ""

    def execute(self, doc):
        self._before = doc              # 되돌릴 것을 명령이 직접 기억한다
        return self._transform(doc)

    def undo(self, doc):
        return self._before             # doc 은 무시한다. 되돌릴 값은 이미 안에 있다


doc = apply_strategy(TEXT, upper)
print("전략 방식:", doc, "| 되돌리기: 전략은 이전 상태를 모른다")
doc = apply_strategy(doc, reverse)
print("전략 방식: 런타임 교체 ->", doc)

history, doc = [], TEXT
for t in (upper, reverse):
    cmd = TransformCommand(t)
    doc = cmd.execute(doc)
    history.append(cmd)
print("명령 방식:", doc)
while history:
    doc = history.pop().undo(doc)
    print("명령 방식: 되돌리기 ->", doc)
```
```cpp title="같은 그림, 다른 답 — 함수 교체와 요청 객체"
#include <algorithm>
#include <cctype>
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;

const string TEXT = "hello world";

string upper(string s) {
    for (char& c : s) c = toupper((unsigned char)c);
    return s;
}

string reverse_(string s) {
    reverse(s.begin(), s.end());
    return s;
}

using Transform = function<string(string)>;

// 후보 1 — 바뀌는 것이 "어떻게 변환하는가" 뿐이라고 보고 함수를 갈아끼운다
string apply_strategy(const string& doc, const Transform& transform) {
    return transform(doc);
}

// 후보 2 — 바뀌는 것을 "요청 그 자체" 로 보고 객체에 담는다
class TransformCommand {
public:
    explicit TransformCommand(Transform transform) : _transform(std::move(transform)) {}

    string execute(const string& doc) {
        _before = doc;                  // 되돌릴 것을 명령이 직접 기억한다
        return _transform(doc);
    }

    string undo(const string& doc) {
        (void)doc;                      // doc 은 무시한다. 되돌릴 값은 이미 안에 있다
        return _before;
    }

private:
    Transform _transform;
    string _before;
};

int main() {
    string doc = apply_strategy(TEXT, upper);
    cout << "전략 방식: " << doc << " | 되돌리기: 전략은 이전 상태를 모른다\n";
    doc = apply_strategy(doc, reverse_);
    cout << "전략 방식: 런타임 교체 -> " << doc << "\n";

    vector<shared_ptr<TransformCommand>> history;
    doc = TEXT;
    for (const Transform& t : vector<Transform>{upper, reverse_}) {
        auto cmd = make_shared<TransformCommand>(t);
        doc = cmd->execute(doc);
        history.push_back(cmd);
    }
    cout << "명령 방식: " << doc << "\n";
    while (!history.empty()) {
        doc = history.back()->undo(doc);
        history.pop_back();
        cout << "명령 방식: 되돌리기 -> " << doc << "\n";
    }
    return 0;
}
```
:::

```console
전략 방식: HELLO WORLD | 되돌리기: 전략은 이전 상태를 모른다
전략 방식: 런타임 교체 -> DLROW OLLEH
명령 방식: DLROW OLLEH
명령 방식: 되돌리기 -> HELLO WORLD
명령 방식: 되돌리기 -> hello world
```

두 후보의 클래스 그림은 사실상 같다. 갈라진 것은 **요구사항 문장 하나**다. "되돌릴 수 있어야 한다"가 붙는 순간 요청은 **실행 후에도 남아 있어야 하고**, 남으려면 객체여야 한다. 그림이 아니라 요구가 답을 정한다.

**복잡도:** 실행 비용은 둘 다 변환 한 번, 시간 $O(1)$이다(변환 자체의 비용 제외). 차이는 공간이다. 전략 방식은 $O(1)$ — 아무것도 기억하지 않는다. 명령 방식은 되돌리기 이력 $h$ 개마다 이전 상태를 들고 있으므로 $O(h \cdot |doc|)$이고, 문서가 크면 이 곱이 곧바로 문제가 된다. 그래서 실제 편집기는 문서 전체가 아니라 **역연산이나 차분만** 저장한다 — 되돌리기를 어떤 방식으로 표현할지가 이 패턴의 진짜 설계 결정이다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 전략의 정체 | 그냥 함수. 클래스 계층이 필요 없다 | `std::function` 또는 순수 가상 클래스. 전자가 짧고 후자가 빠르다 |
| 명령의 정체 | 클로저 두 개(실행·취소)로도 된다 | 상태를 들어야 하므로 클래스 쪽이 자연스럽다 |
| 이름 충돌 | `reverse` 를 그냥 쓴다 | `std::reverse` 와 겹쳐 `reverse_` 로 피했다. `using namespace std` 의 대가다 |
| 이력 소유권 | 참조 계수 | `shared_ptr` 로 명시. 되돌리기 이력이 명령을 살려 둔다는 사실이 타입에 드러난다 |

## 4. 냄새에서 패턴으로

트리는 요구사항에서 출발한다. 실제로는 요구사항보다 **코드의 냄새**를 먼저 만나는 경우가 많다. 그쪽 입구도 만들어 둔다.

| 눈에 띄는 냄새 | 무엇을 뜻하는가 | 어디로 | 무엇을 대가로 치르는가 |
|---|---|---|---|
| 같은 `if type ==` 사슬이 여러 함수에 반복된다 | 타입에 따른 분기가 흩어졌다 | Strategy [XII-6](#/xii-6) / State [XII-8](#/xii-8) | 클래스 수가 분기 수만큼 는다 |
| 기종이 늘 때마다 상위 로직을 고친다 | 변환 계층이 없다 | Adapter [XII-2](#/xii-2) | 기종마다 어댑터 하나 |
| 새 기능마다 `new` 하는 곳을 찾아 고친다 | 생성이 흩어졌다 | Factory [XII-5](#/xii-5) | 간접 계층 하나, 진입점 찾기가 어려워진다 |
| 생성자 인자가 아홉 개다 | 선택적 조립이다 | Builder [XII-5](#/xii-5) | 코드가 길어지고 필수값 검증 시점이 늦어진다 |
| 호출부가 서브시스템 클래스 일곱 개를 안다 | 창구가 없다 | Facade [XII-3](#/xii-3) | 파사드가 커지면 God Object 로 간다 |
| 기능 조합마다 서브클래스를 만든다 | 조합 폭발이다 | Decorator [XII-4](#/xii-4) | 스택이 깊어지고 순서에 의미가 생긴다 |
| A가 바뀔 때마다 B·C·D를 직접 부른다 | 통지가 하드코딩됐다 | Observer [XII-7](#/xii-7) | 흐름이 코드에서 안 보인다. 순서 보장이 없다 |
| 모듈 n개가 서로를 직접 부른다 | n:n 배선이다 | Mediator [XII-11](#/xii-11) | 중재자가 자라면 God Object [XII-15](#/xii-15) |
| 상태 플래그 다섯 개의 조합을 검사한다 | 상태가 암묵적이다 | State [XII-8](#/xii-8) | 전이가 클래스에 흩어진다 |
| 실행 취소·재시도·감사 로그를 요구받는다 | 요청이 남아야 한다 | Command [XII-9](#/xii-9) | 이력의 메모리, 되돌리기 표현의 설계 |
| 알고리즘 골격이 복붙으로 여섯 벌이다 | 공통 순서가 안 뽑혔다 | Template Method [XII-10](#/xii-10) | 상속 결합. 훅이 늘면 읽기 어렵다 |
| 전역 접근자가 코드 전체에 흩어져 있다 | 의존이 숨었다 | 주입으로 되돌린다 [XII-12](#/xii-12) | 인자가 늘고 조립 지점이 커진다 |
| 락을 잊은 호출부가 나왔다 | 규약이 문서에만 있다 | Monitor [XII-13](#/xii-13) | 여러 객체에 걸친 원자성을 잃는다 |
| 판단 로직을 장비 없이 못 돌린다 | 경계가 없다 | 포트&어댑터 [XII-14](#/xii-14) | 조립 코드가 새로 생긴다 |
| 인터페이스마다 구현이 하나씩이다 | **아직 아무것도 안 샀다** | 되돌린다 [XII-15](#/xii-15) | 없다. 되돌리는 것이 이득이다 |

::: warn
표를 거꾸로 읽지 마라. 냄새가 있어야 패턴이고, 패턴이 있다고 냄새가 사라지는 것이 아니다. 오른쪽 끝 열이 그 이유다 — **모든 행에 대가가 있다.** 대가 없는 행은 마지막 하나뿐이고, 그것은 무언가를 더하는 것이 아니라 걷어내는 행이다.
:::

## 5. 이 절차를 어디서 쓰는가

**설계 리뷰에서 쓴다.** "여기 팩토리를 씁시다"는 결론이지 근거가 아니다. 두 축을 채우면 근거가 된다 — "늘어나는 것은 드라이버 기종이고(축 1), 설정 파일로 실행 중에 고를 수 있어야 한다(축 2). 그래서 레지스트리다." 이 형식으로 말하면 반대도 같은 형식으로 온다. "기종이 정말 늘어납니까"가 그것이고, 그 질문이 설계를 구한다.

**코드 리뷰에서 쓴다.** §4의 표는 리뷰 코멘트의 형식을 바꾼다. "이건 좀 복잡한데요" 대신 "같은 `if type ==` 사슬이 세 함수에 있습니다. 타입이 더 늘어납니까?"가 된다. 뒤쪽은 상대가 답할 수 있는 질문이다.

**기술 면접에서 쓴다.** 패턴 질문의 대부분은 정의를 묻지 않는다. 상황을 주고 무엇을 쓰겠냐고 묻는다. 이름부터 말하는 답과 축부터 말하는 답은 다르게 들린다. 자세한 것은 아래 상자에 있다.

**그리고 이 절차의 마지막 항목이 가장 자주 쓰인다** — 잎에 도달한 뒤 "지금 뽑을 것인가"에서 **아니오**가 나오는 경우가 실제로는 절반을 넘는다.

::: interview
"이 상황에 어떤 디자인 패턴을 쓰겠습니까"에 이름부터 답하면 그다음 질문에서 무너진다. 순서를 뒤집는다.

**답변 뼈대 네 단계.** ① **무엇이 변하는지 먼저 말한다.** "여기서 늘어나는 것은 결제 수단입니다." ② **제약을 말한다.** "그리고 결제 실패 시 되돌려야 합니다." ③ **그래서 이름을 댄다.** "요청이 실행 후에도 남아야 하므로 Command 입니다." ④ **대가를 스스로 말한다.** "대신 이력의 메모리와 되돌리기 표현을 설계해야 합니다."

네 번째가 결정적이다. **대가를 말하지 않는 답은 패턴을 카탈로그로 배운 티가 난다.** 그리고 "이 경우에는 안 쓰겠습니다"가 정답인 질문이 실제로 나온다 — 구현이 하나뿐인 상황을 일부러 주는 경우다. 그때 인터페이스를 뽑겠다고 답하면 [XII-15 안티패턴](#/xii-15)의 마지막 항목을 모르는 것으로 읽힌다.
:::

## 6. 언제 패턴을 고르지 않는가

트리의 잎에 도달했다는 것은 **후보가 정해졌다**는 뜻이지 **지금 넣으라**는 뜻이 아니다. 마지막 관문은 넷이다.

**첫째, 구현체가 몇 개인가.** 하나면 넣지 않는다. 둘이어도 대개 이르다. 셋에서 뽑는다. 이 규칙 하나가 [XII-15 안티패턴](#/xii-15)의 마지막 항목 전체를 막는다.

**둘째, 이 코드를 몇 명이 얼마 동안 만지는가.** 혼자 두 주 쓰고 버릴 도구에는 어떤 패턴도 필요 없다. 패턴이 파는 것은 **변경 비용의 절감**이고, 변경이 없으면 그 상품은 팔리지 않는다.

**셋째, 그 간접 계층이 실행 경로의 어디에 있는가.** 초당 백만 번 도는 루프 안에 가상 호출을 넣으면 잰다. 대개는 무시할 만하고, 무시할 수 없는 자리가 실제로 있다. **재지 않고 "패턴은 느리다"라고 말하는 것과 "패턴은 공짜다"라고 말하는 것은 똑같이 틀렸다.**

**넷째, 없앨 수 있는 문제인가.** 가장 좋은 답은 패턴이 아니라 **요구를 없애는 것**일 때가 있다. 기종이 늘어나지 않도록 규격을 하나로 정하는 협상이 어댑터 계층보다 싸다면 그쪽이 맞다. 설계 결정은 코드 안에서만 내리는 것이 아니다.

## 7. 이 유형을 알아보는 법

::: classify
- 신호어: "런타임에 바꿀 수 있어야 한다", "취소하거나 다시 실행할 수 있어야 한다", "새 기종이 추가돼도 상위 로직은 고치지 않는다", "보내는 쪽은 받는 쪽을 몰라야 한다", "설정 파일로 조립할 수 있어야 한다", "이 값들은 항상 같은 조합이어야 한다"
- 제약조건: 구현체가 3개 이상이거나, 가짜 구현으로 시험할 이유가 있을 것. 그 코드를 여러 명이 여러 달 만질 것. 간접 호출이 실행 경로의 뜨거운 루프 안이 아닐 것 — 뜨거운 루프라면 넣기 전에 잰다
- 혼동 주의: 되돌리기·큐가 필요하면 Strategy([XII-6](#/xii-6))가 아니라 Command([XII-9](#/xii-9))다. 모양을 맞추는 것이면 Adapter([XII-2](#/xii-2)), 보이는 것을 줄이는 것이면 Facade([XII-3](#/xii-3))다. 기능을 더하면 Decorator([XII-4](#/xii-4)), 접근을 통제하면 Proxy([XII-3](#/xii-3))다. 밖에서 갈아 끼우면 Strategy, 스스로 다음을 정하면 State([XII-8](#/xii-8))다. 한 방향 통지는 Observer([XII-7](#/xii-7)), n:n 배선은 Mediator([XII-11](#/xii-11))다
- 반례 함정: 축을 맞게 골랐는데 **시점이 이른** 경우. 구현체가 하나뿐인데 트리의 잎까지 갔다면 답은 잎이 아니라 "아직 아니다"다. 그리고 중재자·파사드처럼 **자라면 안티패턴이 되는 잎**은 상한을 함께 정하지 않으면 [XII-15](#/xii-15)로 간다
:::

## 연습

::: quiz
**1. 창고 로봇의 경로 계획기.** 지금 A\* 하나뿐이다. 반년 뒤 좁은 통로용 계획기를 추가할 계획이 있고, 현장마다 어느 것을 쓸지 설정으로 정하고 싶다.
- 상황: 알고리즘이 늘어날 예정이고, 선택은 실행 중에 이뤄진다.
- 무엇이 변하고 무엇이 고정인가: "출발지와 목적지를 받아 경로를 돌려준다"는 고정이다. 변하는 것은 그 안의 알고리즘이다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 축 1은 알고리즘, 축 2는 런타임 교체 → Strategy. **단 지금은 구현이 하나다.** 정답은 인터페이스만 함수 시그니처로 잡아 두고 클래스 계층은 두 번째 계획기가 실제로 올 때 뽑는 것이다.

**2. 작업 오더의 재시도.** 창고 작업 오더가 실패하면 되돌리고 다시 시도해야 한다. 감사 로그에 누가 무엇을 언제 요청했는지도 남겨야 한다.
- 상황: 요청이 실행 후에도 필요하다.
- 무엇이 변하고 무엇이 고정인가: 작업의 종류는 늘어난다. 고정된 것은 "요청은 기록되고 되돌릴 수 있다"이다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 축 2의 "취소·재실행"이 답을 정한다 → Command. 대가는 되돌리기를 무엇으로 표현할지의 설계이고, 상태 전체를 저장하면 §3의 $O(h \cdot |doc|)$ 를 그대로 문다.

**3. 여덟 장비의 조율.** 장비 여덟 대가 교차로를 공유한다. 지금은 서로 직접 통신하고, 배선이 28개다.
- 상황: n:n 배선이다.
- 무엇이 변하고 무엇이 고정인가: 장비의 개별 동작은 고정이다. 변하는 것은 조율 규칙이다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 축 1은 통지, 축 2는 n:n 중앙화 → Mediator. **대가를 미리 정해야 한다** — 중재자가 장비 상태를 들기 시작하면 God Object 로 간다. 상태는 장비가 갖고 중재자는 배선만 한다는 규칙을 처음부터 문서가 아니라 코드로 강제한다.

**4. 아니오가 정답인 경우를 만들어라.** 위 셋 중 하나를 골라, 조건을 바꿔서 "패턴을 넣지 않는다"가 정답이 되게 하라. 무엇을 바꿔야 하는가. 그 조건이 얼마나 흔하다고 보는가.
:::

## 요약

- 패턴을 이름 순으로 배우면 **이름에서 상황으로 가는 화살표만** 생긴다. 필요한 것은 반대 방향이다.
- 축은 둘이다. **무엇이 변하는가**(알고리즘·생성·구조·통지·상태)와 **어떤 제약이 붙는가**(런타임 교체·되돌리기·수명 분리·가족 일관성).
- 두 축을 곱해도 안 좁혀지면 패턴이 부족한 것이 아니라 **요구사항이 덜 적힌 것**이다.
- 클래스 그림이 같은 후보들은 그림으로 못 고른다. **요구사항 문장 하나**가 가른다 — "되돌릴 수 있어야 한다"가 Strategy 와 Command 를 가르는 전부다.
- 냄새에서 출발하는 입구도 있다. 단 §4의 표는 **오른쪽 끝 열과 함께** 읽는다. 대가 없는 행은 걷어내는 행 하나뿐이다.
- 트리의 잎은 후보이지 결론이 아니다. 마지막 관문은 넷이다 — **구현체 수, 유지 기간, 실행 경로의 뜨거움, 요구 자체를 없앨 수 있는가.**
- 이 Part 를 통과한 뒤 남아야 할 문장은 하나다. ==패턴은 언어의 빈틈과 변경의 비용을 메우는 것이지, 좋은 설계의 증거가 아니다.==

**다음 절**: [XIII-1 점유 격자 지도와 로그 오즈 갱신](#/xiii-1) — 센서가 틀릴 수 있다는 전제 위에서 지도를 세우는 법. 확률을 로그로 바꾸면 곱셈이 덧셈이 된다.
