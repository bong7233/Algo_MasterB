# XII-2 Adapter

::: lead
장비 종류가 하나 늘 때마다 상위 로직을 고치게 되는 구조는 어디서 시작되고 어떻게 끊는가.
:::

## 1. 문제

온도를 읽는 장비 세 대가 붙어 있다. 벤더가 셋이고 SDK가 셋이다.

| 벤더 | 읽는 함수 | 돌려주는 값 |
|---|---|---|
| Acme | `read_celsius()` | 섭씨, 실수 |
| Bolt | `get_temp_f10()` | 화씨의 10배, 정수 |
| Core | `poll()` | 켈빈, 실수 |

이름이 다르고 단위가 다르고 타입이 다르다. **그리고 셋 다 우리가 고칠 수 없다.** 벤더가 배포하는 바이너리이거나 다른 팀의 소유이거나 표준 규격이다. 이것이 이 문제의 전제다 — 맞춰야 하는 쪽은 언제나 우리다.

상위 로직이 할 일은 단순하다. 전체 평균 온도를 내고, 임계값을 넘은 장비 수를 센다. 그래서 이렇게 짠다.

```text nolines
  for vendor, dev in devices:
      if   vendor == "acme": c = dev.read_celsius()
      elif vendor == "bolt": c = (dev.get_temp_f10() / 10.0 - 32.0) * 5.0 / 9.0
      elif vendor == "core": c = dev.poll() - 273.15
      else:                  c = 0.0
```

돌아간다. 그리고 여기서부터 썩는다.

**첫 번째 균열: 이 분기가 한 곳에 있지 않다.** 평균을 내는 함수에 하나, 경보를 판정하는 함수에 하나, 화면에 표시하는 함수에 하나. 같은 세 줄이 세 곳에 복사되어 있다. 복사본이 셋이면 넷째 벤더가 들어올 때 **셋을 다 찾아야 한다.**

**두 번째 균열: 단위 변환식이 상위 로직 안에 있다.** `(f10 / 10.0 - 32.0) * 5.0 / 9.0`은 온도 계산이지 평균 계산이 아니다. 평균을 고치러 온 사람이 화씨 변환식을 읽게 되고, 화씨 변환식이 틀렸을 때 평균 함수의 테스트가 깨진다.

**세 번째 균열이 가장 비싸다. `else` 가지가 값을 만들어 낸다.** 넷째 벤더가 들어왔는데 아무도 이 분기를 고치지 않으면 그 장비는 `0.0`으로 읽힌다. 예외도 로그도 없다. 평균이 조용히 내려가고, 실제로는 임계값을 넘은 장비가 정상으로 보고된다. ==장애가 아니라 잘못된 정상이 돌아온다는 것이 이 구조의 최악이다.==

문제의 뿌리는 한 줄로 적힌다. **상위 로직이 벤더를 안다.** 벤더 이름이 상위 코드에 문자열로 박혀 있는 한, 벤더가 늘어날 때마다 상위 코드가 열린다.

## 2. 무엇이 달라져야 하는가

변하는 것과 변하지 않는 것을 갈라 본다.

| | 내용 |
|---|---|
| 변하는 것 | 함수 이름, 단위, 반환 타입, 연결 절차, 오류 표현 — 전부 벤더마다 다르다 |
| 변하지 않는 것 | **상위가 원하는 것은 "섭씨 온도 하나"다.** 벤더가 몇이든 이 문장은 그대로다 |

변하지 않는 쪽을 코드에 이름으로 적어 두는 것이 전부다.

```text nolines
  interface Thermometer:
      celsius() -> float
```

한 줄짜리 인터페이스다. 그리고 **이 인터페이스는 벤더의 것이 아니라 상위의 것이다.** 이 소유권이 이 절의 핵심이다.

```text nolines
  before                              after

  report_bad                          report_good
     |  knows "acme","bolt","core"       |  knows only Thermometer
     |  and their units                  v
     v                               Thermometer          <- 상위가 소유하는 인터페이스
  AcmeSensor  BoltDevice  CoreProbe      ^
  (vendor SDKs)                          |  implemented by
                                     AcmeAdapter  BoltAdapter  CoreAdapter
                                         |            |            |
                                         v            v            v
                                     AcmeSensor   BoltDevice   CoreProbe
```

왼쪽에서 화살표는 상위에서 벤더로 곧장 간다. 오른쪽에서는 상위가 자기 인터페이스를 가리키고, **벤더 쪽에서 그 인터페이스로 화살표가 올라온다.** 의존 방향이 뒤집혔다. 벤더 SDK는 여전히 아무것도 모르고 아무것도 고쳐지지 않았다 — 사이에 낀 얇은 껍데기가 방향을 돌린 것이다.

껍데기 하나가 하는 일은 세 가지뿐이다. **이름을 맞추고, 단위를 맞추고, 오류 표현을 맞춘다.** 그 외에 아무것도 하지 않는다. 이 제약이 뒤에서 중요해진다.

이제 넷째 벤더가 들어오면 무엇이 열리는지 세어 본다. 껍데기 하나를 새로 쓰고 목록에 넣는다. **상위 로직에서 열리는 파일은 0개다.** 앞 절의 세 균열이 동시에 사라진다 — 분기가 없으니 복사본도 없고, 변환식이 껍데기 안으로 들어갔으니 평균 함수는 온도 계산을 모르며, `else` 가지가 없으니 조용히 0을 만들 자리도 없다.

## 3. 구현

세 벤더로 시작해 넷째를 붙인다. 나쁜 판과 좋은 판을 한 프로그램에서 나란히 돌린다. 넷째를 붙일 때 **양쪽 다 상위 로직(`report_bad` / `report_good`)은 한 줄도 고치지 않는다.**

::: dual
```python title="이기종 온도계 — 상위가 분기하는 판과 인터페이스를 소유하는 판"
from typing import Protocol

LIMIT = 25.0                                  # 임계 온도(섭씨)


# --- 벤더 SDK. 이름도 단위도 제각각이고 우리가 고칠 수 없다 ---
class AcmeSensor:
    def read_celsius(self): return 21.0       # 섭씨 실수


class BoltDevice:
    def get_temp_f10(self): return 734        # 화씨의 10배, 정수


class CoreProbe:
    def poll(self): return 299.15             # 켈빈 실수


class DeltaUnit:                              # 나중에 들어오는 네 번째 벤더
    def sample(self): return 31000            # 밀리섭씨, 정수


# --- 나쁜 판: 상위 로직이 벤더 이름을 안다 ---
def report_bad(devices):
    total, over = 0.0, 0
    for vendor, dev in devices:
        if vendor == "acme":
            c = dev.read_celsius()
        elif vendor == "bolt":
            c = (dev.get_temp_f10() / 10.0 - 32.0) * 5.0 / 9.0
        elif vendor == "core":
            c = dev.poll() - 273.15
        else:
            c = 0.0                           # 모르는 벤더는 0도로 — 여기가 함정이다
        total += c
        if c > LIMIT:
            over += 1
    return total / len(devices), over


# --- 좋은 판: 상위가 인터페이스를 소유하고 벤더가 거기 맞춰진다 ---
class Thermometer(Protocol):                  # 상위가 필요로 하는 것은 이 한 가지뿐이다
    def celsius(self) -> float: ...


class AcmeAdapter:
    def __init__(self, inner): self.inner = inner
    def celsius(self): return self.inner.read_celsius()


class BoltAdapter:
    def __init__(self, inner): self.inner = inner
    def celsius(self): return (self.inner.get_temp_f10() / 10.0 - 32.0) * 5.0 / 9.0


class CoreAdapter:
    def __init__(self, inner): self.inner = inner
    def celsius(self): return self.inner.poll() - 273.15


class DeltaAdapter:                           # 새 벤더에 대해 새로 쓰는 것은 이것뿐이다
    def __init__(self, inner): self.inner = inner
    def celsius(self): return self.inner.sample() / 1000.0


def report_good(devices):
    total, over = 0.0, 0
    for dev in devices:                       # 벤더 이름이 한 번도 나오지 않는다
        c = dev.celsius()
        total += c
        if c > LIMIT:
            over += 1
    return total / len(devices), over


acme, bolt, core, delta = AcmeSensor(), BoltDevice(), CoreProbe(), DeltaUnit()

bad = [("acme", acme), ("bolt", bolt), ("core", core)]
good = [AcmeAdapter(acme), BoltAdapter(bolt), CoreAdapter(core)]

print("[1] 벤더 3종 — 두 판이 같은 답을 낸다")
m, o = report_bad(bad)
print(f"  bad  : 평균 {m:.2f} C, 임계 초과 {o}대")
m, o = report_good(good)
print(f"  good : 평균 {m:.2f} C, 임계 초과 {o}대")

print("[2] 네 번째 벤더가 들어왔다. report_bad 와 report_good 은 한 줄도 고치지 않는다")
bad.append(("delta", delta))
good.append(DeltaAdapter(delta))              # 어댑터 한 개를 목록에 넣었을 뿐이다
m, o = report_bad(bad)
print(f"  bad  : 평균 {m:.2f} C, 임계 초과 {o}대")
m, o = report_good(good)
print(f"  good : 평균 {m:.2f} C, 임계 초과 {o}대")

print(f"[3] delta 의 참값은 {delta.sample() / 1000.0:.2f} C 다")
print("  bad 는 delta 를 0.00 C 로 읽어 평균을 끌어내렸고 임계 초과도 놓쳤다")
```
```cpp title="이기종 온도계 — 상위가 분기하는 판과 인터페이스를 소유하는 판"
#include <cstdio>
#include <memory>
#include <string>
#include <utility>
#include <variant>
#include <vector>
using namespace std;

const double LIMIT = 25.0;                    // 임계 온도(섭씨)

// --- 벤더 SDK. 이름도 단위도 제각각이고 우리가 고칠 수 없다 ---
struct AcmeSensor {
    double read_celsius() const { return 21.0; }      // 섭씨 실수
};
struct BoltDevice {
    int get_temp_f10() const { return 734; }          // 화씨의 10배, 정수
};
struct CoreProbe {
    double poll() const { return 299.15; }            // 켈빈 실수
};
struct DeltaUnit {                            // 나중에 들어오는 네 번째 벤더
    int sample() const { return 31000; }              // 밀리섭씨, 정수
};

// --- 나쁜 판: 상위 로직이 벤더 이름을 안다 ---
using Dev = variant<AcmeSensor, BoltDevice, CoreProbe, DeltaUnit>;

pair<double, int> report_bad(const vector<pair<string, Dev>>& devices) {
    double total = 0.0;
    int over = 0;
    for (const auto& [vendor, dev] : devices) {
        double c;
        if (vendor == "acme")
            c = get<AcmeSensor>(dev).read_celsius();
        else if (vendor == "bolt")
            c = (get<BoltDevice>(dev).get_temp_f10() / 10.0 - 32.0) * 5.0 / 9.0;
        else if (vendor == "core")
            c = get<CoreProbe>(dev).poll() - 273.15;
        else
            c = 0.0;                          // 모르는 벤더는 0도로 — 여기가 함정이다
        total += c;
        if (c > LIMIT) over += 1;
    }
    return {total / devices.size(), over};
}

// --- 좋은 판: 상위가 인터페이스를 소유하고 벤더가 거기 맞춰진다 ---
struct Thermometer {                          // 상위가 필요로 하는 것은 이 한 가지뿐이다
    virtual ~Thermometer() = default;
    virtual double celsius() const = 0;
};

struct AcmeAdapter : Thermometer {
    AcmeSensor inner;
    explicit AcmeAdapter(AcmeSensor inner) : inner(inner) {}
    double celsius() const override { return inner.read_celsius(); }
};
struct BoltAdapter : Thermometer {
    BoltDevice inner;
    explicit BoltAdapter(BoltDevice inner) : inner(inner) {}
    double celsius() const override { return (inner.get_temp_f10() / 10.0 - 32.0) * 5.0 / 9.0; }
};
struct CoreAdapter : Thermometer {
    CoreProbe inner;
    explicit CoreAdapter(CoreProbe inner) : inner(inner) {}
    double celsius() const override { return inner.poll() - 273.15; }
};
struct DeltaAdapter : Thermometer {           // 새 벤더에 대해 새로 쓰는 것은 이것뿐이다
    DeltaUnit inner;
    explicit DeltaAdapter(DeltaUnit inner) : inner(inner) {}
    double celsius() const override { return inner.sample() / 1000.0; }
};

pair<double, int> report_good(const vector<unique_ptr<Thermometer>>& devices) {
    double total = 0.0;
    int over = 0;
    for (const auto& dev : devices) {         // 벤더 이름이 한 번도 나오지 않는다
        double c = dev->celsius();
        total += c;
        if (c > LIMIT) over += 1;
    }
    return {total / devices.size(), over};
}

int main() {
    AcmeSensor acme; BoltDevice bolt; CoreProbe core; DeltaUnit delta;

    vector<pair<string, Dev>> bad = {{"acme", acme}, {"bolt", bolt}, {"core", core}};
    vector<unique_ptr<Thermometer>> good;
    good.push_back(make_unique<AcmeAdapter>(acme));
    good.push_back(make_unique<BoltAdapter>(bolt));
    good.push_back(make_unique<CoreAdapter>(core));

    printf("[1] 벤더 3종 — 두 판이 같은 답을 낸다\n");
    auto [m1, o1] = report_bad(bad);
    printf("  bad  : 평균 %.2f C, 임계 초과 %d대\n", m1, o1);
    auto [m2, o2] = report_good(good);
    printf("  good : 평균 %.2f C, 임계 초과 %d대\n", m2, o2);

    printf("[2] 네 번째 벤더가 들어왔다. report_bad 와 report_good 은 한 줄도 고치지 않는다\n");
    bad.push_back({"delta", delta});
    good.push_back(make_unique<DeltaAdapter>(delta));  // 어댑터 한 개를 목록에 넣었을 뿐이다
    auto [m3, o3] = report_bad(bad);
    printf("  bad  : 평균 %.2f C, 임계 초과 %d대\n", m3, o3);
    auto [m4, o4] = report_good(good);
    printf("  good : 평균 %.2f C, 임계 초과 %d대\n", m4, o4);

    printf("[3] delta 의 참값은 %.2f C 다\n", delta.sample() / 1000.0);
    printf("  bad 는 delta 를 0.00 C 로 읽어 평균을 끌어내렸고 임계 초과도 놓쳤다\n");
    return 0;
}
```
:::

두 언어의 출력은 한 글자도 다르지 않다.

```console
[1] 벤더 3종 — 두 판이 같은 답을 낸다
  bad  : 평균 23.33 C, 임계 초과 1대
  good : 평균 23.33 C, 임계 초과 1대
[2] 네 번째 벤더가 들어왔다. report_bad 와 report_good 은 한 줄도 고치지 않는다
  bad  : 평균 17.50 C, 임계 초과 1대
  good : 평균 25.25 C, 임계 초과 2대
[3] delta 의 참값은 31.00 C 다
  bad 는 delta 를 0.00 C 로 읽어 평균을 끌어내렸고 임계 초과도 놓쳤다
```

**복잡도:** 두 판 모두 시간 $O(n)$ — 장비 $n$대를 한 번씩 훑는다. 나쁜 판은 장비 하나당 벤더 종류 $k$개까지 문자열을 비교하므로 정확히는 $O(nk)$이고, 좋은 판은 장비 하나당 가상 호출 한 번이라 $O(n)$이다. 공간은 둘 다 $O(n)$ — 좋은 판은 장비마다 껍데기 객체가 하나씩 더 붙지만 껍데기가 드는 것은 포인터 하나 크기이므로 차수가 바뀌지 않는다.

**차수보다 중요한 것이 `[2]`에 있다.** 넷째 벤더가 들어왔을 때 좋은 판은 평균 25.25도에 초과 2대를 정확히 냈고, 나쁜 판은 평균 17.50도에 초과 1대를 냈다. 참값은 31.00도다. **나쁜 판은 실패하지 않았다 — 틀린 답을 정상적으로 돌려줬다.** 나쁜 판을 고치려면 `report_bad`와, 현실에서는 같은 분기를 복사해 둔 다른 함수들까지 전부 열어야 한다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 인터페이스 선언 | `typing.Protocol` — **구현체가 상속하지 않아도 된다**(구조적 서브타이핑) | 순수 가상 함수를 가진 기반 클래스. 껍데기가 **반드시 상속해야** 한다 |
| 검사 시점 | `Protocol`은 실행에 영향이 없다. 타입 검사기가 정적으로 본다 | 상속하지 않으면 컴파일이 안 된다 |
| 이종 목록 | 리스트에 아무 객체나 담긴다. 덕 타이핑이 런타임에 해결한다 | `vector<unique_ptr<Thermometer>>`. 기반 클래스 포인터가 있어야 한 통에 담긴다 |
| 나쁜 판의 이종 목록 | 타입이 달라도 그냥 담긴다 | 담을 공통 타입이 없어 `std::variant`가 필요하다. **나쁜 판이 C++에서 더 아프다** |
| 벤더 객체 소유 | 껍데기가 참조를 든다. GC가 수명을 본다 | 값으로 담거나 `unique_ptr`/`shared_ptr`로 소유를 명시해야 한다 |
| 소멸 | 자동 | 기반 클래스에 **가상 소멸자가 없으면 파생 소멸자가 안 불린다** |

::: note
Python 쪽에서 `Protocol`을 쓸지 그냥 덕 타이핑으로 갈지는 판단이 필요한 지점이다. 런타임만 보면 `Thermometer` 선언은 없어도 된다 — `celsius()`를 가진 객체면 `report_good`은 돌아간다.

그럼에도 적는 이유는 이 절의 명제가 **"상위가 인터페이스를 소유한다"** 이기 때문이다. 소유물이 코드에 이름으로 존재하지 않으면 그 명제는 주석에만 있다. `Protocol`을 고른 것은 ABC와 달리 **껍데기가 상속하지 않아도 되기 때문**이다. 껍데기는 벤더 코드를 건드리지 않는 것이 본분이고, 상속을 강요하지 않는 인터페이스가 그 성질과 맞는다.

반대로 껍데기가 여러 개이고 공통 뼈대 코드를 공유해야 한다면 ABC가 낫다. 기준은 **"공유할 구현이 있는가"** 다. 없으면 `Protocol`, 있으면 ABC다.
:::

껍데기를 만드는 방식은 둘이다. 위 코드는 벤더 객체를 **안에 담았다**(합성). 다른 방식은 벤더 클래스를 **상속하는** 것이다.

```cpp title="상속으로 맞추는 방식 (조각) — 위 코드의 Thermometer 와 BoltDevice 를 이어받는다"
struct BoltAdapterBySubclass : Thermometer, private BoltDevice {
    double celsius() const override {
        return (get_temp_f10() / 10.0 - 32.0) * 5.0 / 9.0;   // 상속받은 멤버를 바로 부른다
    }
};
```

짧아 보이지만 실무에서 지는 쪽이다. 이유가 넷 있다. ① 벤더 클래스가 `final`이거나 생성자가 비공개면 상속이 아예 안 된다. ② 벤더 객체를 이미 다른 곳에서 만들어 건네받는 경우 — 실제 SDK는 대개 팩토리 함수로 객체를 준다 — 상속으로는 그 객체를 감쌀 수 없다. ③ 한 껍데기가 벤더 객체 **둘**을 조합해야 하는 순간 상속으로는 표현이 안 된다. ④ 다중 상속이 없는 언어에서는 선택지 자체가 없다. 그리고 상속은 벤더의 공개 멤버를 전부 물려받아 껍데기의 표면을 넓힌다 — `private` 상속으로 막을 수 있지만 그 방어가 필요하다는 것 자체가 신호다.

::: pitfall
- **`else` 가지에서 기본값을 만든다.** 모르는 벤더에 `0.0`을 돌려주는 순간 결함이 정상 응답으로 위장한다. 모르면 모른다고 돌려주거나 던져라.
- **껍데기에 정책을 넣는다.** "이 벤더는 값이 튀니까 3회 평균을 낸다"를 껍데기 안에 넣으면 그것은 더 이상 변환이 아니다. 필터링은 상위의 정책이고, 껍데기 안에 숨으면 벤더마다 다른 정책이 생겨도 아무도 모른다.
- **인터페이스에 벤더 고유 항목을 뚫는다.** `raw_handle()`이나 `vendor_name()`을 인터페이스에 추가하면 상위가 다시 벤더로 분기하기 시작한다. 뒤에서 다시 다룬다.
- **C++에서 가상 소멸자를 빠뜨린다.** `unique_ptr<Thermometer>`가 파생 객체를 소멸시킬 때 기반 소멸자가 가상이 아니면 정의되지 않은 동작이다. 벤더 객체를 안에 들고 있으면 그 자원이 그대로 샌다.
- **오류를 변환하지 않는다.** 벤더 A는 `-999`를 반환하고 벤더 B는 예외를 던진다면, 그 차이를 껍데기가 흡수하지 않는 한 상위는 여전히 벤더를 알아야 한다.
:::

## 4. 이제 이름을 붙인다

이 구조의 이름이 **Adapter**다. GoF의 의도는 한 문장이다 — *클래스의 인터페이스를 클라이언트가 기대하는 다른 인터페이스로 변환한다.* 참여자는 넷이다.

| 참여자 | 이 코드에서 | 역할 |
|---|---|---|
| Target | `Thermometer` | 클라이언트가 기대하는 인터페이스. **클라이언트 쪽이 소유한다** |
| Adaptee | `AcmeSensor`, `BoltDevice`, … | 맞춰야 하는 기존 코드. 고칠 수 없다 |
| Adapter | `AcmeAdapter`, … | Target을 구현하면서 Adaptee에 위임한다 |
| Client | `report_good` | Target만 알고 Adaptee를 모른다 |

앞 절의 두 방식에도 이름이 있다. 벤더 객체를 안에 담는 쪽이 **객체 어댑터**(object adapter), 상속하는 쪽이 **클래스 어댑터**(class adapter)다. 실무에서 객체 어댑터가 이기는 이유는 앞에서 넷 열거했고, 한 줄로 줄이면 **합성은 대상이 무엇이든 감쌀 수 있고 상속은 상속 가능한 것만 감쌀 수 있다**는 것이다.

Adapter는 이 Part에서 언어 차이가 가장 얕은 패턴이기도 하다. [XII-1](#/xii-1)의 표에서 Strategy·Command·Singleton은 Python에서 구조가 접혔지만, Adapter는 접히지 않는다. **변환 코드는 어느 언어에서든 어딘가에 실체로 존재해야 하기 때문이다.** 단위 환산식은 언어 기능으로 대신할 수 없다. Python에서 얇아지는 것은 인터페이스 선언 쪽뿐이고, 껍데기 자체는 두 언어에서 같은 크기다.

인접 패턴과의 경계는 셋 다 "무엇을 앞에 끼운다"는 점에서 헷갈린다. **인터페이스를 다른 것으로 바꾸면 Adapter, 여러 개를 하나의 좁은 창구로 줄이면 Facade, 인터페이스를 그대로 두고 대신 서면 Proxy다.** 셋의 구분은 [XII-3 Facade / Bridge / Proxy](#/xii-3)에서 본론으로 다룬다.

## 5. 어디에 박혀 있는가

**데이터베이스 드라이버가 가장 큰 실사례다.** ODBC와 JDBC는 그 자체가 Target 인터페이스이고, 각 DBMS의 드라이버가 Adapter다. 애플리케이션은 `Connection`과 `Statement`만 알고, 실제 와이어 프로토콜이 PostgreSQL인지 MySQL인지 모른다. Python의 DB-API 2.0도 같은 자리에 있다 — `connect()`, `cursor()`, `execute()`라는 Target을 표준이 정하고 각 드라이버 패키지가 거기 맞춘다. **인터페이스를 표준화 기구가 소유하는 것이 이 사례의 특징이다.**

**Java 표준 라이브러리는 이름에 대놓고 적어 뒀다.** `InputStreamReader`는 바이트 스트림(`InputStream`)을 문자 스트림(`Reader`)으로 변환한다. 두 인터페이스가 다르고, 변환의 실체는 문자 인코딩 해석이다. Python의 `io.TextIOWrapper`가 같은 일을 한다 — 이진 버퍼를 감싸 텍스트 인터페이스로 내놓는다. `open()`이 텍스트 모드에서 돌려주는 객체가 바로 그것이다.

**하드웨어 추상화 계층(HAL)이 이 절의 예제 그대로다.** 운영체제의 블록 디바이스 드라이버는 디스크 컨트롤러가 무엇이든 "섹터를 읽고 쓴다"는 하나의 인터페이스로 맞춘다. 파일시스템은 SATA인지 NVMe인지 모른 채 동작한다. 로봇 미들웨어의 장비 드라이버 노드도 같다 — 라이다 벤더가 셋이어도 상위 인지 노드는 같은 형식의 점군 메시지 하나만 구독한다. **드라이버가 하는 일의 대부분은 알고리즘이 아니라 변환이다.**

**C++의 `std::function`은 타입 소거로 구현된 어댑터다.** 함수 포인터, 람다, 함수 객체, 멤버 함수 바인딩은 전부 타입이 다르고 호출 규약도 다르다. `std::function<int(int)>`은 그 전부를 하나의 호출 인터페이스로 맞춘다. [XII-1](#/xii-1)의 예제에서 형식기들을 한 `unordered_map`에 담을 수 있었던 이유가 이것이다.

## 6. 언제 쓰지 말아야 하는가

**첫째, 벤더가 하나뿐이고 늘 계획이 없을 때.** [XII-1 §2](#/xii-1)의 기준이 그대로 적용된다. 다만 이 패턴은 세 번째 조건에 자주 걸린다 — 실제 장비 없이 테스트하려면 가짜 온도계가 필요하고, 그 가짜가 두 번째 구현체다. **외부 세계에 닿는 경계는 구현체가 하나여도 어댑터가 정당해지는 대표적인 자리다.**

**둘째, 어댑터가 새기 시작할 때.** 새는 어댑터(leaky adapter)는 벤더의 특성을 인터페이스 밖으로 흘리는 어댑터다. 신호는 뚜렷하다.

```text nolines
  interface Thermometer:
      celsius() -> float
      raw_handle() -> object          <- 벤더 핸들을 그대로 내보낸다
      vendor_name() -> str            <- 상위가 이걸로 다시 분기한다
      supports_fast_mode() -> bool    <- 벤더별 기능 질의
```

셋 중 하나라도 인터페이스에 있으면 상위 로직은 다시 벤더별로 분기한다. 어댑터를 다 만들어 놓고 `if dev.vendor_name() == "bolt"`가 상위에 남아 있으면, 그 코드는 나쁜 판에 껍데기 비용만 얹은 상태다. ==새는 어댑터는 없는 어댑터보다 나쁘다 — 문제가 해결됐다는 착시를 주기 때문이다.==

**셋째, 어댑터가 정책을 담기 시작할 때.** 변환은 어댑터의 일이지만 재시도 횟수, 이상치 필터, 캐시 유효 기간은 상위의 정책이다. 정책이 어댑터 안으로 들어가면 벤더마다 다른 정책이 생기고, 그 사실이 어디에도 적히지 않는다. 껍데기 하나가 다섯 줄을 넘어가기 시작하면 그 자리에서 무엇이 들어갔는지 확인하라.

**성능은 이 목록에 없다.** 간접 호출 한 겹이 실제로 얼마인지 재 보면 이렇다.

::: perf
| 호출 방식 | 시간 | 호출당 |
|---|---|---|
| C++ 직접 호출(인라인 가능) | 0.033초 / 5천만 회 | 0.66 ns |
| C++ 가상 호출(어댑터 한 겹) | 0.101초 / 5천만 회 | 2.01 ns |
| C++ `std::function` 호출 | 0.087초 / 5천만 회 | 1.74 ns |
| Python 메서드 직접 호출 | 0.343초 / 500만 회 | 68.6 ns |
| Python 어댑터 한 겹 | 0.461초 / 500만 회 | 92.3 ns |

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측, 3회 실행의 중앙값. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 측정 스크립트는 `tools/bench/indirection_call_cost.cpp` 와 `.py` 다.)

C++에서 어댑터 한 겹이 더하는 것은 **호출당 약 1.4 나노초**다. 장비 100대를 100 Hz로 읽어도 초당 만 번이고, 더해지는 시간은 14 마이크로초다. Python은 한 겹이 약 24 나노초를 더해 1.4배가 되는데, 배수는 커 보여도 절대값은 여전히 마이크로초 미만이다.

C++ 쪽에서 가상 호출이 직접 호출의 3배인 것도 겉보기만큼 크지 않다. 직접 호출이 인라인되어 사실상 사라진 것이 분모이기 때문이다. **비교 대상이 0에 가까울 때 배수는 정보를 주지 않는다.** 어댑터가 실제로 성능을 해치는 경우는 호출 자체가 아니라 그 안에서 매번 문자열을 만들거나 메모리를 할당할 때다.
:::

**간접 계층의 비용은 CPU가 아니라 사람이 치른다.** 스택이 한 겹 깊어지고, 실제 코드를 찾으려면 파일을 하나 더 열어야 한다. 그 비용은 벤더가 둘 이상일 때 즉시 회수된다.

## 연습

::: quiz
설계 질문이다. 코드를 짜지 마라. 세 가지를 적어라.

**1. 결제 게이트웨이 두 곳.** 한 곳은 성공 시 `{"result": "OK"}`를, 다른 곳은 HTTP 200과 빈 본문을 돌려준다. 실패 표현은 각각 에러 코드 문자열과 HTTP 4xx다. 지금 주문 서비스가 두 응답 형태를 모두 알고 분기한다.
- 상황: 무엇이 상위로 새고 있는가. 인터페이스는 누가 소유해야 하는가.
- 무엇이 변하고 무엇이 고정인가:
- 어떤 패턴이고, 무엇을 대가로 치르는가:

**2. 사내 로그 수집기.** 서비스마다 로그 형식이 다르다. 한 팀은 JSON, 한 팀은 공백 구분 텍스트, 한 팀은 벤더 장비가 뱉는 고정폭 레코드다. 수집기는 셋 다 받아 하나의 스키마로 저장해야 하고, 팀은 계속 는다.
- 상황: 껍데기 하나가 해야 할 일과 하지 말아야 할 일을 각각 적어라.
- 무엇이 변하고 무엇이 고정인가:
- 어떤 패턴이고, 무엇을 대가로 치르는가:

**3. 어댑터가 이미 있는 코드베이스.** 카메라 어댑터 인터페이스에 `celsius()`에 해당하는 `grab_frame()` 말고도 `get_vendor()`, `native_handle()`, `set_vendor_specific_option(key, value)` 세 메서드가 있다. 상위 코드에는 `if cam.get_vendor() == "flir"` 분기가 네 곳 남아 있다.
- 상황: 이 어댑터는 무엇을 해결했고 무엇을 해결하지 못했는가.
- 무엇이 변하고 무엇이 고정인가:
- 어떤 패턴이고, 무엇을 대가로 치르는가:

::: answer
**1.** 상위로 새고 있는 것은 **성공·실패의 표현 방식**이다. 인터페이스는 주문 서비스가 소유해야 한다 — 게이트웨이가 정한 형태를 그대로 받아 쓰면 게이트웨이가 늘 때마다 주문 서비스가 열린다. 변하는 것은 응답 형식과 오류 표현이고, 고정된 것은 "금액과 주문 번호를 주면 성공 여부와 거래 ID가 돌아온다"다. Adapter이고, 대가는 **오류 표현을 지금 설계해야 한다**는 것이다. 게이트웨이별 에러 코드를 상위의 오류 종류(잔액 부족·카드 거절·통신 실패)로 사상해야 하고, 이 사상을 미루면 `raw_error()`가 인터페이스에 생기면서 새는 어댑터가 된다.

**2.** 껍데기가 할 일은 **파싱과 필드 사상**뿐이다. 하지 말아야 할 일은 유효성 정책(어떤 로그를 버릴지), 재시도, 샘플링, 시각 보정이다. 전부 상위의 정책이고 팀마다 달라지면 안 되는 것들이다. 변하는 것은 입력 형식이고 고정된 것은 저장 스키마다. Adapter이고, 팀이 계속 늘기 때문에 파서를 이름으로 찾아 붙이는 등록기가 함께 온다([XII-5](#/xii-5)). 대가는 형식별 파서가 파일마다 흩어져 "이 로그가 왜 이렇게 저장됐는가"를 추적할 때 파일을 두 번 여는 것이다.

**3.** 해결한 것은 **프레임을 가져오는 호출의 이름과 형식**이고, 해결하지 못한 것은 **벤더별 기능 차이**다. `get_vendor()`와 `set_vendor_specific_option()`이 인터페이스에 있는 한 상위는 벤더를 알고 분기하며, 네 곳의 분기가 그 증거다. 이 어댑터는 새고 있다. 변하는 것은 프레임 획득 방식이고, 고정되어야 하는 것은 상위가 실제로 필요로 하는 능력의 목록이다. 고치는 방향은 인터페이스를 넓히는 것이 아니라 **네 곳의 분기가 무엇을 하려는지 조사해 그 의도를 인터페이스의 능력으로 승격시키는 것**이다. 예를 들어 `set_vendor_specific_option("exposure", …)`이 반복된다면 `set_exposure(ms)`가 인터페이스에 들어가야 한다. 대가는 벤더가 지원하지 않는 능력을 어떻게 표현할지 정해야 한다는 것이고, 그 답이 다시 `supports_*()`가 되면 처음으로 돌아간다.
:::
:::

## 요약

- 문제의 뿌리는 하나다. **상위 로직이 벤더를 안다.** 벤더 이름이 상위 코드에 박혀 있으면 벤더가 늘 때마다 상위가 열린다.
- 해법도 하나다. 상위가 자기에게 필요한 인터페이스를 **소유**하고, 벤더마다 그 인터페이스로 맞춰 주는 얇은 껍데기를 둔다. 의존 방향이 뒤집힌다.
- 껍데기가 하는 일은 셋뿐이다. **이름을 맞추고, 단위를 맞추고, 오류 표현을 맞춘다.** 정책이 들어가면 그것은 더 이상 껍데기가 아니다.
- 나쁜 판의 최악은 실패가 아니라 **잘못된 정상**이다. 예제에서 넷째 벤더는 0.00도로 읽혀 평균을 17.50도로 만들고 임계 초과를 놓쳤다. 참값은 31.00도다.
- **객체 어댑터**(합성)가 **클래스 어댑터**(상속)를 이긴다. 합성은 대상이 무엇이든 감쌀 수 있고 상속은 상속 가능한 것만 감쌀 수 있다.
- 이 패턴은 언어가 지우지 못한다. 인터페이스 선언은 Python에서 얇아지지만 **변환 코드 자체는 어느 언어에서든 실체로 존재해야 한다.**
- 실무에서는 DB 드라이버(ODBC·JDBC·DB-API), `InputStreamReader` / `io.TextIOWrapper`, 블록 디바이스 드라이버, 장비 드라이버 노드, `std::function`이 전부 이 자리에 있다.
- **새는 어댑터가 없는 어댑터보다 나쁘다.** `vendor_name()`이나 `native_handle()`이 인터페이스에 있으면 상위는 여전히 분기하고 있고, 껍데기 비용만 얹힌 상태다.

**다음 절**: [XII-3 Facade / Bridge / Proxy](#/xii-3) — 무언가를 앞에 끼운다는 점에서 같아 보이는 셋을 가른다. 좁히는 것, 곱셈을 덧셈으로 바꾸는 것, 같은 얼굴로 대신 서는 것.
