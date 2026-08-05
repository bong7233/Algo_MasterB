# XII-5 Factory Method / Abstract Factory / Builder

::: lead
객체를 만드는 일이 복잡해질 때, 그 복잡함은 서로 다른 세 가지이고 처방도 세 가지다.

:::

## 1. 문제

설비 통합 게이트웨이를 짠다. 현장의 장비는 기종마다 프로토콜이 다르고, 상위 로직이 그 차이를 모르게 하는 변환 계층은 이미 만들었다([XII-2 Adapter](#/xii-2)). 남은 질문 하나가 이 챕터다. ==**누가 어떤 변환 계층을 만드는가.**==

설정 파일에는 이 한 줄만 있다.

```text nolines
devices:
  - id: press-01
    kind: modbus
```

`kind` 는 문자열이고 코드가 필요로 하는 것은 객체다. 그 사이를 잇는 것은 처음엔 `if` 하나다.

**요구가 늘어나면서 그 `if` 가 번식한다.** 기종마다 다른 것이 클래스만이 아니기 때문이다. 기본 타임아웃이 다르고, 진단 코드 해석이 다르고, 로그 접두사가 다르고, 재연결 정책이 다르다. 각각이 자기 자리에서 `if kind == ...` 사슬이 된다. 사슬 네 개가 파일 네 개에 흩어진다.

**기종이 하나 늘 때 무슨 일이 벌어지는가.** 사슬 네 개를 전부 찾아 고쳐야 한다. 하나를 빠뜨려도 컴파일은 통과한다. `else` 가 기본값을 돌려주기 때문이다. 그리고 그 기본값은 대체로 `0` 이나 `None` 이라서, 실패는 배포 뒤 현장에서 처음 드러난다. ==분기를 빠뜨린 것을 알려 주는 것은 타입 시스템이 아니라 장비다.==

**두 번째 복잡함은 종류가 다르다.** 시뮬레이션 모드가 필요해진다. 드라이버를 가짜로 바꾸는 것만으로는 안 된다. 시계도 가짜여야 한다 — 시뮬레이션은 실제 시간보다 빨리 돌아야 하고, 타임아웃 판정이 벽시계에 걸리면 테스트가 기계 성능에 따라 통과하고 실패한다. 그런데 드라이버와 시계는 서로 다른 두 곳에서 만들어진다. **실기 드라이버에 시뮬 시계를 물리는 조합이 아무 저항 없이 컴파일된다.**

**세 번째 복잡함은 또 다르다.** 접속 설정 객체의 필드가 열 개고 그중 일곱 개가 선택적이다. 생성자 인자를 열 개 늘어놓으면 호출부는 `("plc.local", 502, 100, 3, false, true, 2, 0, false, "")` 가 된다. 인자 두 개를 바꿔 넣어도 컴파일된다. 필드를 하나씩 채우게 만들면 이번엔 **절반만 채워진 설정 객체가 시스템을 돌아다닌다.**

::: warn
셋을 하나의 문제로 뭉뚱그리면 처방도 뭉개진다. 흩어진 결정, 어긋나는 조합, 반쯤 만들어진 물건 — **이 셋은 다른 병이다.**
:::

## 2. 무엇이 달라져야 하는가

### 병 1 — 결정이 흩어져 있다

변하는 것은 "이 문자열에 어떤 구체 타입이 대응하는가"다. 변하지 않는 것은 상위 로직이 쓰는 인터페이스다.

핵심은 **그 지식이 몇 군데에 있는가**다. 사슬 하나에만 있으면 기종 추가는 한 줄이고, 네 군데에 있으면 네 줄이며 그중 하나를 빠뜨린다. 그러므로 처방은 "기종마다 다른 모든 것을 그 기종의 타입 하나에 모으고, 문자열에서 그 타입으로 가는 표를 딱 하나 둔다"이다. 타임아웃도, 로그 접두사도 그 타입의 것이다. **표를 하나로 만드는 것보다 표를 하나만 두게 만드는 것이 중요하다.**

### 병 2 — 함께 만들어져야 하는 것들이 따로 만들어진다

여기서 변하는 것은 타입이 아니라 **조합**이다. 드라이버와 시계는 각각 두 가지고 조합은 넷인데, 그중 둘만 유효하다.

```text nolines
             sim clock   real clock
  sim dev       OK          BAD
  real dev      BAD          OK
```

병 1의 처방을 두 번 적용하면 이 표가 안 지켜진다. 드라이버 레지스트리와 시계 레지스트리를 따로 두면 각각은 잘 동작하고, 어긋난 조합도 잘 만들어진다. ==필요한 것은 두 물건을 **한 곳에서 함께** 만드는 것이다.== 만드는 주체가 하나면 어긋날 방법이 없다.

**이 조건이 병 1과 병 2를 가른다.** 제품이 여럿이고 그 사이에 일관성 제약이 있는가. 없으면 병 1의 처방으로 충분하고, 물건마다 만드는 함수를 따로 두는 것이 더 짧다. 있으면 묶어야 한다. 대부분의 자료가 이 조건을 말하지 않고 "제품군을 만든다"고만 적는데, **일관성 제약이 없으면 묶을 이유도 없다.**

### 병 3 — 조립이 끝나기 전의 물건은 유효하지 않다

변하는 것은 어떤 필드를 채우는가이고, 변하지 않는 것은 "완성된 설정은 항상 유효하다"는 성질이다.

인자를 순서대로 받는 방식은 **인자에 이름이 없어서** 무너진다. `50` 과 `3` 이 자리를 바꿔도 둘 다 정수라 타입 검사가 못 잡는다. 필드를 하나씩 채우는 방식은 **중간 상태가 타입으로 표현되지 않아서** 무너진다. `port` 를 안 채운 객체와 채운 객체가 같은 타입이면 검증할 지점이 없다.

그래서 필요한 것은 둘이다. **인자에 이름을 붙일 것**, 그리고 **조립 중인 것과 완성된 것을 구별할 것.** 조립이 끝나는 순간을 명시적으로 만들면 검증이 들어갈 자리가 생긴다.

## 3. 구현

### 3.1 사슬이 번식한 상태

기종 셋을 지원한다. `ethercat` 은 방금 추가한 기종이다.

::: dual
```python title="나쁜 판 — 같은 분기가 두 곳에 있다"
class Modbus:
    handshake_ms = 30

class CanOpen:
    handshake_ms = 40

class EtherCat:                       # 새로 추가한 기종
    handshake_ms = 10


def make_driver(kind):                # 사슬 1 — 여기에는 추가했다
    if kind == "modbus":
        return Modbus()
    if kind == "canopen":
        return CanOpen()
    if kind == "ethercat":
        return EtherCat()
    raise ValueError(kind)


def default_timeout_ms(kind):         # 사슬 2 — 여기에는 추가하지 않았다
    if kind == "modbus":
        return 100
    if kind == "canopen":
        return 50
    return 0                          # else 가 조용히 0을 돌려준다


def connect(kind):
    drv = make_driver(kind)
    limit = default_timeout_ms(kind)
    ok = drv.handshake_ms <= limit
    print(f"{kind:<9} timeout={limit:>3}ms  handshake={drv.handshake_ms:>3}ms  "
          f"{'연결' if ok else '실패'}")


for kind in ("modbus", "canopen", "ethercat"):
    connect(kind)
```
```cpp title="나쁜 판 — 같은 분기가 두 곳에 있다"
#include <iomanip>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
using namespace std;

struct Driver {
    virtual ~Driver() = default;
    virtual int handshake_ms() const = 0;
};
struct Modbus : Driver {
    int handshake_ms() const override { return 30; }
};
struct CanOpen : Driver {
    int handshake_ms() const override { return 40; }
};
struct EtherCat : Driver {            // 새로 추가한 기종
    int handshake_ms() const override { return 10; }
};

unique_ptr<Driver> make_driver(const string& kind) {   // 사슬 1 — 여기에는 추가했다
    if (kind == "modbus") return make_unique<Modbus>();
    if (kind == "canopen") return make_unique<CanOpen>();
    if (kind == "ethercat") return make_unique<EtherCat>();
    throw invalid_argument(kind);
}

int default_timeout_ms(const string& kind) {           // 사슬 2 — 여기에는 추가하지 않았다
    if (kind == "modbus") return 100;
    if (kind == "canopen") return 50;
    return 0;                         // else 가 조용히 0을 돌려준다
}

void connect(const string& kind) {
    auto drv = make_driver(kind);
    int limit = default_timeout_ms(kind);
    bool ok = drv->handshake_ms() <= limit;
    cout << left << setw(9) << kind << " timeout=" << right << setw(3) << limit
         << "ms  handshake=" << setw(3) << drv->handshake_ms() << "ms  "
         << (ok ? "연결" : "실패") << "\n";
}

int main() {
    for (string kind : {"modbus", "canopen", "ethercat"}) connect(kind);
    return 0;
}
```
:::

**복잡도:** 조회 시간 $O(K)$ — 사슬을 위에서부터 비교하므로 기종 수 $K$에 비례한다. 하지만 여기서 아픈 것은 시간이 아니다. **변경 비용이 $O(C)$다** — 기종 하나를 추가할 때 고쳐야 하는 사슬의 수 $C$에 비례하고, 컴파일러는 $C$가 몇인지 모른다.

```console
modbus    timeout=100ms  handshake= 30ms  연결
canopen   timeout= 50ms  handshake= 40ms  연결
ethercat  timeout=  0ms  handshake= 10ms  실패
```

**셋 중 가장 빠른 장비가 혼자 실패한다.** `ethercat` 의 핸드셰이크는 10ms 로 가장 짧은데 타임아웃이 0ms 다. 사슬 2에 한 줄을 안 넣었기 때문이고, 그 사실은 코드 어디에도 드러나지 않는다. `else` 가 `raise` 였다면 즉시 터졌을 것이다 — **기본값을 돌려주는 `else` 가 이 버그의 공범이다.**

### 3.2 기종에 대한 지식을 기종 안으로

기종마다 다른 것을 전부 그 기종의 타입에 모으고, 문자열 → 타입 표를 하나만 둔다.

::: dual
```python title="좋은 판 — 등록표 하나만 둔다"
REGISTRY = {}


def register(cls):                    # 클래스 정의와 등록이 한 자리에 있다
    REGISTRY[cls.kind] = cls
    return cls


@register
class Modbus:
    kind = "modbus"
    timeout_ms = 100
    handshake_ms = 30


@register
class CanOpen:
    kind = "canopen"
    timeout_ms = 50
    handshake_ms = 40


@register
class EtherCat:                       # 새 기종이 고치는 곳은 이 블록 하나뿐이다
    kind = "ethercat"
    timeout_ms = 20
    handshake_ms = 10


def create(kind):
    if kind not in REGISTRY:          # 모르는 기종은 즉시 터진다. 기본값을 만들지 않는다
        raise ValueError(f"등록되지 않은 기종: {kind}")
    return REGISTRY[kind]()


def connect(kind):
    drv = create(kind)
    ok = drv.handshake_ms <= drv.timeout_ms
    print(f"{kind:<9} timeout={drv.timeout_ms:>3}ms  handshake={drv.handshake_ms:>3}ms  "
          f"{'연결' if ok else '실패'}")


for kind in ("modbus", "canopen", "ethercat"):
    connect(kind)
```
```cpp title="좋은 판 — 등록표 하나만 둔다"
#include <functional>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
using namespace std;

struct Driver {
    virtual ~Driver() = default;
    virtual int timeout_ms() const = 0;
    virtual int handshake_ms() const = 0;
};

using Maker = function<unique_ptr<Driver>()>;

map<string, Maker>& registry() {      // 함수 안의 static — 초기화 순서를 보장한다
    static map<string, Maker> r;
    return r;
}

bool add(const string& kind, Maker m) {
    registry()[kind] = std::move(m);
    return true;
}

struct Modbus : Driver {
    int timeout_ms() const override { return 100; }
    int handshake_ms() const override { return 30; }
};
static bool reg_modbus = add("modbus", [] { return make_unique<Modbus>(); });

struct CanOpen : Driver {
    int timeout_ms() const override { return 50; }
    int handshake_ms() const override { return 40; }
};
static bool reg_canopen = add("canopen", [] { return make_unique<CanOpen>(); });

struct EtherCat : Driver {            // 새 기종이 고치는 곳은 이 블록 하나뿐이다
    int timeout_ms() const override { return 20; }
    int handshake_ms() const override { return 10; }
};
static bool reg_ethercat = add("ethercat", [] { return make_unique<EtherCat>(); });

unique_ptr<Driver> create(const string& kind) {
    auto it = registry().find(kind);
    if (it == registry().end())       // 모르는 기종은 즉시 터진다. 기본값을 만들지 않는다
        throw invalid_argument("등록되지 않은 기종: " + kind);
    return it->second();
}

void connect(const string& kind) {
    auto drv = create(kind);
    bool ok = drv->handshake_ms() <= drv->timeout_ms();
    cout << left << setw(9) << kind << " timeout=" << right << setw(3) << drv->timeout_ms()
         << "ms  handshake=" << setw(3) << drv->handshake_ms() << "ms  "
         << (ok ? "연결" : "실패") << "\n";
}

int main() {
    for (string kind : {"modbus", "canopen", "ethercat"}) connect(kind);
    return 0;
}
```
:::

**복잡도:** 조회 시간 $O(\log K)$ — C++ 은 `map` 이 균형 트리라 비교 $\log K$회, Python 은 해시라 평균 $O(1)$이다([II-6 해시](#/ii-6)). **변경 비용이 $O(1)$로 떨어진 것이 요점이다** — 기종 하나가 고치는 곳은 클래스 하나이고, 그 클래스가 자기에 대한 모든 지식을 들고 있다.

```console
modbus    timeout=100ms  handshake= 30ms  연결
canopen   timeout= 50ms  handshake= 40ms  연결
ethercat  timeout= 20ms  handshake= 10ms  연결
```

**`ethercat` 이 연결된다.** 타임아웃이 클래스 안에 있으니 빠뜨릴 자리가 없다. 그리고 모르는 기종을 넣으면 예외가 나므로, 오타는 배포 뒤가 아니라 설정을 읽는 순간 드러난다.

::: danger
C++ 의 `static bool reg_modbus = add(...)` 는 **같은 번역 단위 안에서만** 안전하다. 드라이버를 별도 `.cpp` 로 나누고 정적 라이브러리로 묶으면, 링커가 "아무도 참조하지 않는 오브젝트 파일"이라며 통째로 빼 버린다. 등록 코드가 실행되지 않고 레지스트리는 조용히 빈 채로 남는다. 증상은 "설정에 적힌 기종이 등록되지 않았다"는 런타임 예외이고 원인은 링커다. 정적 라이브러리 대신 오브젝트를 직접 링크하거나 `--whole-archive` 를 쓴다.

Python 도 같은 병을 앓는다. `@register` 는 **모듈이 임포트되어야** 실행된다. 플러그인 디렉터리를 스캔해 임포트하지 않으면 레지스트리는 비어 있다. ==등록 방식의 진짜 비용은 문법이 아니라 "등록이 실행되는 시점"이다.==
:::

### 3.3 함께 만들어져야 하는 것들

이제 병 2다. 드라이버와 시계가 짝이 맞아야 한다. 시뮬 시계는 스스로 흐르지 않고 시뮬 장비가 밀어 준다. 실기 시계는 스스로 흐른다.

::: dual
```python title="짝을 한 곳에서 만든다"
class SimClock:
    def __init__(self):
        self.t = 0

    def now(self):
        return self.t                 # 스스로 흐르지 않는다. 누군가 밀어 줘야 한다


class RealClock:
    def __init__(self):
        self.t = 0

    def now(self):
        self.t += 10                  # 벽시계는 부를 때마다 흐른다
        return self.t


class SimDevice:
    def __init__(self, clock):
        self.clock = clock

    def read(self):
        self.clock.t += 10            # 시뮬 장비가 시뮬 시계를 민다
        return "sim"


class RealDevice:
    def read(self):
        return "real"


class SimSetup:                     # 시계를 자기가 들고, 장비에게도 그 시계를 준다
    def __init__(self):
        self.clock = SimClock()

    def make_clock(self):
        return self.clock

    def make_device(self):
        return SimDevice(self.clock)


class RealSetup:
    def __init__(self):
        self.clock = RealClock()

    def make_clock(self):
        return self.clock

    def make_device(self):
        return RealDevice()


def run(label, device, clock):
    parts = []
    for _ in range(3):
        value = device.read()         # 읽고 나서 시각을 찍는다. 순서가 결과를 바꾼다
        parts.append(f"{value} t={clock.now()}")
    print(f"[{label}] " + " | ".join(parts))


run("짝 어긋남", RealDevice(), SimClock())     # 따로 만들면 이 조합이 그냥 만들어진다
f = SimSetup()
run("묶음 sim", f.make_device(), f.make_clock())
g = RealSetup()
run("묶음 real", g.make_device(), g.make_clock())
```
```cpp title="짝을 한 곳에서 만든다"
#include <iostream>
#include <memory>
#include <string>
#include <vector>
using namespace std;

struct Clock {
    virtual ~Clock() = default;
    virtual int now() = 0;
};
struct SimClock : Clock {
    int t = 0;
    int now() override { return t; }  // 스스로 흐르지 않는다. 누군가 밀어 줘야 한다
};
struct RealClock : Clock {
    int t = 0;
    int now() override {
        t += 10;                      // 벽시계는 부를 때마다 흐른다
        return t;
    }
};

struct Device {
    virtual ~Device() = default;
    virtual string read() = 0;
};
struct SimDevice : Device {
    shared_ptr<SimClock> clock;       // 시계를 만든 쪽과 공유한다 → shared_ptr
    explicit SimDevice(shared_ptr<SimClock> c) : clock(std::move(c)) {}
    string read() override {
        clock->t += 10;               // 시뮬 장비가 시뮬 시계를 민다
        return "sim";
    }
};
struct RealDevice : Device {
    string read() override { return "real"; }
};

struct Setup {                      // 시계를 자기가 들고, 장비에게도 그 시계를 준다
    virtual ~Setup() = default;
    virtual shared_ptr<Clock> make_clock() = 0;
    virtual unique_ptr<Device> make_device() = 0;
};
struct SimSetup : Setup {
    shared_ptr<SimClock> clock = make_shared<SimClock>();
    shared_ptr<Clock> make_clock() override { return clock; }
    unique_ptr<Device> make_device() override { return make_unique<SimDevice>(clock); }
};
struct RealSetup : Setup {
    shared_ptr<RealClock> clock = make_shared<RealClock>();
    shared_ptr<Clock> make_clock() override { return clock; }
    unique_ptr<Device> make_device() override { return make_unique<RealDevice>(); }
};

void run(const string& label, Device& device, Clock& clock) {
    string out;
    for (int i = 0; i < 3; i++) {
        string value = device.read();  // 읽고 나서 시각을 찍는다. 순서가 결과를 바꾼다
        out += (i ? " | " : "") + value + " t=" + to_string(clock.now());
    }
    cout << "[" << label << "] " << out << "\n";
}

int main() {
    RealDevice loose_device;          // 따로 만들면 이 조합이 그냥 만들어진다
    SimClock loose_clock;
    run("짝 어긋남", loose_device, loose_clock);

    SimSetup f;
    auto fd = f.make_device();
    auto fc = f.make_clock();
    run("묶음 sim", *fd, *fc);

    RealSetup g;
    auto gd = g.make_device();
    auto gc = g.make_clock();
    run("묶음 real", *gd, *gc);
    return 0;
}
```
:::

**복잡도:** 생성 시간 $O(P)$ — 제품 종류 $P$개를 한 번씩 만든다. 여기서 중요한 것은 복잡도가 아니라 **가능한 조합의 수다.** 따로 만들면 $2^P$가지가 컴파일되고 그중 대부분이 틀렸다. 묶으면 묶음 구현 수만큼, 즉 유효한 조합만 존재한다.

```console
[짝 어긋남] real t=0 | real t=0 | real t=0
[묶음 sim] sim t=10 | sim t=20 | sim t=30
[묶음 real] real t=10 | real t=20 | real t=30
```

**첫 줄의 `t=0` 이 멈춰 있다.** 실기 장비는 시뮬 시계를 밀지 않고 시뮬 시계는 스스로 흐르지 않으므로, 시간이 영원히 0이다. 이 상태에서는 **타임아웃 판정이 절대 발동하지 않는다.** 장비가 응답하지 않아도 시스템은 영원히 기다린다. 두 객체는 각각 완벽하게 동작하고, 틀린 것은 조합뿐이다.

::: note
Python 은 덕 타이핑이라 `Setup` 인터페이스를 선언하지 않았다. `make_clock` 과 `make_device` 만 있으면 어떤 객체든 이 자리에 들어간다. **그런데 만드는 객체 자체는 사라지지 않았다.** 일관성은 타입의 문제가 아니라 "두 물건이 같은 상태를 공유해야 한다"는 문제이고, 그 상태를 담을 무언가가 필요하기 때문이다. 언어가 지워 주는 것은 인터페이스 선언이지 객체가 아니다.
:::

::: danger
`run` 안에서 읽기와 시각 찍기를 **한 식에 몰아 쓰면 두 언어의 결과가 갈린다.** `device.read() + " t=" + to_string(clock.now())` 은 C++17 에서도 `operator+` 피연산자의 평가 순서가 정해져 있지 않아, 컴파일러가 시각을 먼저 찍으면 `sim t=0 | sim t=10 | sim t=20` 이 나온다. Python 의 f-스트링은 왼쪽부터 평가하므로 `t=10` 부터 시작한다. **부수 효과가 있는 호출 둘을 한 식에 넣지 마라.** 위 코드가 값을 지역 변수에 먼저 받는 이유가 이것이다.
:::

### 3.4 반쯤 만들어진 물건

병 3이다. 여기서 두 언어가 가장 크게 갈린다.

::: dual
```python title="설정 객체 — 이름 붙은 인자와 완성 시점의 검증"
from dataclasses import dataclass


@dataclass(frozen=True, kw_only=True)   # frozen: 완성 뒤 못 바꾼다 / kw_only: 위치 인자 금지
class Config:
    host: str
    port: int = 502
    timeout_ms: int = 100
    retries: int = 1
    tls: bool = False

    def __post_init__(self):            # 생성이 끝나는 지점 = 검증할 자리
        if not 1 <= self.port <= 65535:
            raise ValueError("port 는 1..65535 여야 한다")


def show(label, c):
    tls = "on" if c.tls else "off"
    print(f"[{label}] {c.host}:{c.port} timeout={c.timeout_ms}ms "
          f"retries={c.retries} tls={tls}")

try:
    Config("plc.local", 502, 3, 50, False)      # timeout 과 retries 를 바꿔 넣은 호출
except TypeError:
    print("[위치 인자] TypeError — 언어가 막았다")

show("이름 붙은 인자", Config(host="plc.local", timeout_ms=50, retries=3, tls=True))

try:
    Config(host="plc.local", port=0)
except ValueError as e:
    print(f"[검증] {e}")
```
```cpp title="설정 객체 — 이름 붙은 인자와 완성 시점의 검증"
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
using namespace std;

struct Config {
    string host;
    int port = 502;
    int timeout_ms = 100;
    int retries = 1;
    bool tls = false;
};

void show(const string& label, const Config& c) {
    cout << "[" << label << "] " << c.host << ":" << c.port
         << " timeout=" << c.timeout_ms << "ms retries=" << c.retries
         << " tls=" << (c.tls ? "on" : "off") << "\n";
}

class ConfigDraft {                   // 조립 중인 것과 완성된 것을 타입으로 가른다
    Config c_;
public:
    explicit ConfigDraft(string host) { c_.host = std::move(host); }
    ConfigDraft& port(int v) { c_.port = v; return *this; }
    ConfigDraft& timeout_ms(int v) { c_.timeout_ms = v; return *this; }
    ConfigDraft& retries(int v) { c_.retries = v; return *this; }
    ConfigDraft& tls(bool v) { c_.tls = v; return *this; }
    Config build() const {              // 생성이 끝나는 지점 = 검증할 자리
        if (c_.port < 1 || c_.port > 65535)
            throw invalid_argument("port 는 1..65535 여야 한다");
        return c_;
    }
};

int main() {
    Config swapped{"plc.local", 502, 3, 50, false};  // timeout 과 retries 를 바꿔 넣었다
    show("위치 인자", swapped);
    show("이름 붙은 인자",
         ConfigDraft("plc.local").timeout_ms(50).retries(3).tls(true).build());
    try {
        ConfigDraft("plc.local").port(0).build();
    } catch (const invalid_argument& e) {
        cout << "[검증] " << e.what() << "\n";
    }
    return 0;
}
```
:::

| 언어 차이 | Python | C++ |
|---|---|---|
| 위치 인자 실수 | `kw_only=True` 로 **언어가 막는다**. 출력 1행이 `TypeError` | 막을 방법이 없다. 자리를 바꿔도 컴파일되고 출력 1행이 틀린 설정 |
| 인자에 이름 붙이기 | 호출부에서 `timeout_ms=50` | 이름이 없다. 조립기의 **메서드 이름**이 그 역할을 대신한다 |
| 기본값 | 필드 선언에 `= 502` | 멤버 초기화자 `= 502`. 다만 집합체 초기화로 우회된다 |
| 불변성 | `frozen=True` 가 대입을 막는다 | `build()` 가 값을 돌려주고, 원하면 멤버를 `const` 로 |
| 검증 자리 | `__post_init__` — 생성자가 끝나는 지점 | `build()` — 조립기와 완성품이 다른 타입이므로 그 경계가 곧 검증 지점 |
| 필요한 코드 | `Config` 정의 **11줄** | `Config` 7줄 + 조립기 14줄 = **21줄** |

**복잡도:** 조립 시간 $O(F)$ — 채우는 필드 수만큼 호출이 일어난다. 공간은 완성품 하나분에 조립기 하나분이 더 붙는다. C++ 판은 `build()` 가 `Config` 를 값으로 복사하므로, 설정 객체가 크면 이동 생성자를 쓰거나 `build() &&` 로 소유권을 넘긴다.

두 출력이 다르고, 그 차이가 이 절의 결론이다.

```console
(Python)
[위치 인자] TypeError — 언어가 막았다
[이름 붙은 인자] plc.local:502 timeout=50ms retries=3 tls=on
[검증] port 는 1..65535 여야 한다

(C++)
[위치 인자] plc.local:502 timeout=3ms retries=50 tls=off
[이름 붙은 인자] plc.local:502 timeout=50ms retries=3 tls=on
[검증] port 는 1..65535 여야 한다
```

**첫 줄이 이 챕터의 핵심 장면이다.** 같은 실수 — `timeout_ms=50, retries=3` 을 자리 바꿔 쓴 것 — 를 Python 은 `TypeError` 로 막았고 C++ 은 조용히 받아들여 `timeout=3ms retries=50` 이라는 틀린 설정을 만들었다. 3ms 타임아웃은 어떤 장비도 통과하지 못하고, 50회 재시도는 장애 시 복구를 50배 느리게 만든다. **둘 다 잘 컴파일된 코드다.**

**조립기 코드의 절반은 Python 에서 언어 기능으로 사라진다.** 남는 절반은 사라지지 않는다 — `__post_init__` 의 검증이 그것이다. 조립 중인 상태와 완성 상태를 가르는 일 자체는 언어가 대신해 주지 않고, 다만 그 경계를 **생성자가 끝나는 순간**으로 옮겨 놓았을 뿐이다.

::: pitfall
- **`kw_only=True` 없이 `frozen=True` 만 쓰면 절반만 얻는다.** 위치 인자가 허용되므로 자리 바꿈 버그가 그대로 살아 있다. 필드가 넷을 넘으면 항상 같이 쓴다.
- **조립기의 `build()` 를 여러 번 부르면** 같은 조립기에서 여러 설정이 나온다. 조립기 상태가 남아 있으므로 두 번째 호출이 첫 번째의 설정을 물려받는다. 의도한 것이 아니면 `build() &&` 로 한 번만 부르게 강제한다.
- **C++ 의 집합체 초기화가 조립기를 우회한다.** `Config{...}` 가 여전히 가능하므로 조립기는 규율일 뿐 강제가 아니다. 강제하려면 생성자를 `private` 으로 두고 조립기를 `friend` 로 만든다.
- **검증을 조립 중에 하면 순서 의존이 생긴다.** `port` 와 `tls` 를 함께 봐야 하는 규칙("tls 면 포트는 502가 아니어야 한다")은 마지막 한 번에만 검사할 수 있다.
:::

## 4. 이제 이름을 붙인다

셋은 GoF 카탈로그의 서로 다른 항목이고, 서로 다른 병에 대응한다.

**Factory Method** — 객체를 만드는 일을 인터페이스로 두고, 어떤 구체 클래스를 만들지는 그 인터페이스의 구현이 정한다. 원래 GoF 형태는 서브클래스가 정하는 것이다.

```text nolines
  Creator            <- factoryMethod() 를 선언하고, 나머지 로직은 그것을 쓴다
      ^
      +-- ConcreteCreator   <- factoryMethod() 를 구현해 구체 타입을 고른다
```

3.2가 쓴 등록표는 **서브클래스 대신 표가 결정하는 변형**이고, 문헌에서 흔히 레지스트리 기반 팩토리라고 부른다. 결정을 한 곳으로 모은다는 의도가 같으므로 같은 계보로 읽는다. 다만 `create(kind)` 같은 자유 함수 하나뿐이라면 그것은 GoF 의 Factory Method 가 아니라 **정적 팩토리 함수**다. 이름을 정확히 쓰는 편이 낫다 — 상속 계층이 없는 것을 Factory Method 라고 부르면 다음 사람이 없는 계층을 찾는다.

**Abstract Factory** — 서로 관련된 제품들의 **군(family)** 을 만드는 인터페이스. 구현 하나가 한 군을 담당한다.

```text nolines
  AbstractFactory        <- makeClock(), makeDevice()
      ^
      +-- SimFactory     <- 시뮬 군 전체를 담당한다
      +-- RealFactory    <- 실기 군 전체를 담당한다
```

**이 패턴의 존재 이유는 제품이 여럿이라는 것이 아니라 제품들이 서로 맞아야 한다는 것이다.** 3.3의 `t=0` 이 그 제약이 깨졌을 때의 모습이다. 일관성 제약이 없다면 Abstract Factory 는 그냥 함수 두 개를 클래스로 감싼 것이고, 그때는 쓰지 않는 것이 맞다.

**Builder** — 복잡한 객체의 조립 과정을 표현과 분리하고, 조립이 끝나는 시점을 명시한다. GoF 의 원형에는 조립 순서를 지시하는 Director 가 있지만, 실무에서 널리 쓰이는 것은 3.4의 **메서드 연쇄(fluent) 형태**다. Director 는 같은 조립 절차로 여러 표현을 만들어야 할 때만 값을 한다.

## 5. 어디에 박혀 있는가

**플러그인 아키텍처.** 설정 파일의 문자열이 클래스가 되는 모든 시스템이 3.2의 구조다. 경로 플래너를 이름으로 갈아 끼우는 것([V-14 계보 총정리](#/v-14)), 로그 핸들러를 설정으로 지정하는 것, 직렬화 포맷을 문자열로 고르는 것이 전부 등록표 하나와 그 표를 채우는 등록 코드로 되어 있다. Python `logging` 의 설정 딕셔너리가 `'()'` 키로 임의의 호출 가능 객체를 지정할 수 있는 것이 그 예이고, **설정이 코드보다 늦게 정해진다**는 요구가 이 구조를 강제한다.

**코덱 레지스트리.** `"utf-8"` 이라는 문자열로 인코더를 찾아 오는 조회가 바로 그 표다. 새 인코딩을 추가한다는 것은 표에 항목을 하나 넣는 일이고, 문자열을 쓰는 코드는 아무것도 모른다. 압축 알고리즘을 이름으로 고르는 것도 같다 — 다만 **고른 뒤 그것을 어떻게 갈아 끼우느냐**는 [XII-6 Strategy](#/xii-6)의 이야기다. 만드는 축과 쓰는 축이 다르다.

**테스트 더블의 일관성.** 3.3은 만들어 낸 예가 아니다. 시뮬레이션 시계와 시뮬레이션 장비를 따로 주입하는 테스트 하네스는 실제로 짝이 어긋나고, 증상은 "테스트가 가끔 통과한다"로 나타난다. 시간을 제어하려면 시간을 읽는 모든 것이 같은 시계를 봐야 하고, 그것을 보장하는 가장 싼 방법이 **한 객체가 둘 다 만드는 것**이다.

**데이터베이스 드라이버.** 연결 객체가 커서를 만들고, 커서가 결과 집합을 만든다. SQLite 연결에서 만든 커서를 PostgreSQL 연결에 쓸 수 없는 이유가 이것이다 — 제품군이 서로를 알고 있고, 그 결속은 연결 객체 하나가 전부를 만들기 때문에 유지된다.

**불변 설정 객체.** 접속 설정, 요청 스펙, 빌드 구성처럼 필드가 많고 대부분 선택적이며 완성 뒤에 바뀌면 안 되는 것들이 3.4의 형태로 만들어진다. HTTP 요청을 메서드 연쇄로 조립하고 마지막에 보내는 클라이언트 API 가 그 모양이고, **마지막 호출이 있기 전까지는 요청이 존재하지 않는다**는 것이 그 API 의 핵심 성질이다.

## 6. 언제 쓰지 말아야 하는가

**구현체가 하나뿐인데 팩토리를 만드는 것이 가장 흔한 낭비다.** 드라이버가 한 종류뿐이면 `Modbus()` 라고 쓰는 것이 옳다. 팩토리는 "두 번째 구현이 생겼을 때" 넣어도 늦지 않고, 그때 넣는 편이 실제로 무엇이 달라야 하는지를 보고 넣게 되어 인터페이스가 더 정확해진다. 하나짜리 인터페이스는 두 번째 구현이 왔을 때 대개 맞지 않아 다시 고쳐진다.

**등록표는 실행 시점에 대한 의존을 만든다.** 3.2의 `::: danger` 가 그 비용이다. `if` 사슬은 컴파일러가 보증하지만 등록표는 아무도 보증하지 않는다 — 등록 코드가 실행됐는지는 실행해 봐야 안다. 기종이 셋이고 앞으로도 셋이면 `if` 사슬 하나가 더 안전하고 더 잘 읽힌다. ==표로 바꾸는 것이 값을 하는 것은 항목이 여러 파일에 흩어져 각자 추가되기 시작할 때다.==

**일관성 제약이 없는데 Abstract Factory 를 쓰면 간접 계층만 남는다.** 제품 둘이 서로 무관하다면 팩토리 인터페이스는 함수 두 개를 클래스에 넣은 것에 지나지 않고, 호출부는 `factory.make_x()` 라고 한 단계 더 타이핑하게 될 뿐이다. 판정 기준은 하나다 — **잘못된 조합이 실제로 만들어질 수 있고 그것이 버그인가.** 아니면 쓰지 않는다.

**Abstract Factory 는 제품 추가에 약하다.** 제품 종류를 하나 늘리면 모든 팩토리 구현을 고쳐야 한다. 군이 다섯이면 다섯 곳이다. 팩토리 계열이 잘하는 것은 **군을 늘리는 것**이지 제품을 늘리는 것이 아니다. 제품이 자주 늘고 군은 안 는다면 이 구조는 방향이 반대다.

**Python 에서 빌더는 대개 필요 없다.** 3.4가 보인 대로 이름 붙은 인자와 기본값이 빌더가 하던 일의 대부분을 대신한다. 그래도 빌더가 남는 경우는 셋이다 — 조립이 **여러 단계에 걸쳐 다른 곳에서** 일어날 때, 조립 도중 외부 자원(연결, 파일)을 잡아야 할 때, 그리고 완성품의 표현이 여러 가지일 때. 그 셋이 아닌데 빌더를 쓰면 생성자 하나로 끝날 일을 클래스 두 개로 만든 것이다.

**빌더는 필드가 적으면 손해다.** 필드가 셋 이하면 이름 붙은 인자 세 개가 더 짧고 더 안전하다. 빌더는 메서드 호출이 곧 필드 대입이라 **필수 필드를 빠뜨려도 컴파일된다** — `build()` 의 검증이 그 구멍을 메우지만, 그것은 런타임 검사이지 타입 검사가 아니다. 생성자는 필수 인자를 컴파일 타임에 강제한다. **필수 필드는 생성자로, 선택 필드는 빌더로** 가르는 것이 3.4의 `ConfigBuilder("plc.local")` 가 호스트만 생성자로 받는 이유다.

## 연습

::: quiz
각 상황에서 **어떤 병인지 먼저 진단하라.** 흩어진 결정인가, 어긋나는 조합인가, 반쯤 만들어진 물건인가. 셋은 처방이 다르다.

**1. 이미지 인코더 선택**
- 상황: 저장 포맷을 `png / jpeg / webp` 중 설정으로 고른다. 포맷마다 기본 품질값과 확장자와 MIME 타입이 다르다. 지금은 세 곳의 `if` 사슬로 되어 있고, 곧 `avif` 가 추가된다.
- 무엇이 변하고 무엇이 고정인가: 고정은 `encode(image) -> bytes`. 변하는 것은 포맷마다 다른 값 네 개. **그 네 값이 서로 무관한 곳에 흩어져 있다는 것이 병이다.**
- 어떤 패턴이고 무엇을 대가로 치르는가: 등록표 기반 팩토리. 포맷별 값 전부를 그 포맷의 타입에 모은다. 대가는 등록 실행 시점 의존이고, 포맷이 넷에서 멈춘다면 `if` 사슬이 더 낫다.

**2. 좌표 프레임과 단위계**
- 상황: 센서 파이프라인이 좌표 변환기와 단위 변환기를 쓴다. 실기는 미터·라디안, 레거시 장비는 밀리미터·도(degree). 둘을 각각 설정으로 고를 수 있게 했더니 미터 변환기 + 도 변환기 조합이 만들어져 각도만 57배 틀린 결과가 나왔다.
- 무엇이 변하고 무엇이 고정인가: 고정은 두 변환기의 인터페이스. 변하는 것은 단위계 **하나**다 — 두 개로 보인 것이 실은 하나였다.
- 어떤 패턴이고 무엇을 대가로 치르는가: Abstract Factory. 단위계 하나가 두 변환기를 함께 만든다. 대가는 제품이 늘 때 모든 단위계 구현을 고쳐야 한다는 것. 설정 항목을 둘에서 하나로 줄이는 것만으로도 절반은 해결된다는 것을 먼저 확인하라.

**3. 리포트 생성기**
- 상황: 같은 집계 결과로 PDF·HTML·CSV 세 가지 리포트를 만든다. 조립 절차는 셋 다 같다 — 표지, 요약, 표 여러 개, 부록 순서. 표현만 다르다.
- 무엇이 변하고 무엇이 고정인가: 고정은 **조립 순서**. 변하는 것은 각 단계가 만들어 내는 표현.
- 어떤 패턴이고 무엇을 대가로 치르는가: 이것이 GoF 원형 Builder 가 값을 하는 드문 경우다 — 조립 절차를 아는 쪽(Director)과 표현을 아는 쪽(Builder)이 분리된다. 대가는 세 표현의 능력이 다를 때 공통 절차가 최소 공배수로 수렴한다는 것. CSV 가 표지를 표현할 수 없으면 그 단계는 빈 구현이 된다.
:::

## 요약

- 생성이 복잡해지는 방식은 셋이고 서로 다른 병이다 — **결정이 흩어진다 / 조합이 어긋난다 / 반쯤 만들어진 물건이 돌아다닌다.**
- 흩어진 결정의 처방은 **기종에 대한 모든 지식을 그 타입에 모으고 표를 하나만 두는 것**이다. 사슬이 둘 이상이면 하나를 빠뜨리고, `else` 의 기본값이 그 실수를 숨긴다.
- 등록표의 진짜 비용은 문법이 아니라 **등록이 실행되는 시점**이다. C++ 은 링커가 오브젝트를 빼 버리고, Python 은 모듈이 임포트되지 않는다. 둘 다 조용히 빈 표로 끝난다.
- **Abstract Factory 의 존재 이유는 제품이 여럿이라는 것이 아니라 제품끼리 맞아야 한다는 것이다.** 일관성 제약이 없으면 쓰지 않는다.
- Builder 가 푸는 것은 **인자에 이름이 없다는 것**과 **조립 중인 상태가 타입으로 구별되지 않는다는 것** 둘이다.
- 그 둘 중 앞엣것을 Python 은 `kw_only=True` 로 언어가 지운다. 같은 자리 바꿈 실수를 Python 은 `TypeError` 로 막고 C++ 은 조용히 통과시킨다. **뒤엣것은 언어가 지워 주지 않고 `__post_init__` 으로 남는다.**
- 구현체가 하나뿐인데 팩토리를 뽑는 것, 필드가 셋인데 빌더를 세우는 것이 이 계열에서 가장 흔한 낭비다.

**다음 절**: [XII-6 Strategy](#/xii-6) — 만드는 문제가 풀리면, 이번엔 **만들어 놓은 것을 어떻게 갈아 끼우느냐**가 남는다. 그리고 그 답은 두 언어에서 크기가 열 배 다르다.
