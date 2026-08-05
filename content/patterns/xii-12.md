# XII-12 Singleton과 그 함정

::: lead
"하나만 있으면 된다"와 "어디서나 닿아야 한다"는 다른 요구다. 그 둘을 묶으면 무엇이 부서지는가.
:::

## 1. 문제

관제 서비스에 설정이 하나 있다. 온도 단위, 로그 수준, 장비 접속 주소 같은 것들이다. 프로세스 전체가 같은 설정을 봐야 하고, 설정 객체가 두 개 생기면 그것 자체가 버그다.

그래서 이렇게 짠다. 클래스 안에 인스턴스를 하나 담아 두고, 필요한 곳에서 `Config.instance()`로 꺼낸다. 없으면 그때 만든다.

**이 선택의 매력은 진짜다.** 설정을 쓰는 코드는 서른 군데인데 설정을 만드는 코드는 한 군데도 없어도 된다. 함수 시그니처가 깨끗해진다. 스물다섯 단계 아래 깊숙한 함수가 설정을 하나 읽어야 할 때, 스물다섯 개의 함수에 인자를 하나씩 추가하는 대신 그 자리에서 `Config.instance()`를 부르면 된다. 로거도, 장치 핸들도, 연결 풀도 같은 논리로 같은 모양이 된다.

문제는 반년쯤 뒤 테스트를 짜기 시작할 때 온다.

테스트 두 개가 있다. 하나는 기본 단위가 섭씨라는 것을 확인하고, 다른 하나는 단위를 화씨로 바꾸고 변환이 맞는지 확인한다. 각각 따로 돌리면 둘 다 통과한다. 같이 돌리면 순서에 따라 결과가 달라진다.

그리고 이 실패는 진단이 어렵다. 실패하는 테스트는 `test_default`인데 **버그는 `test_fahrenheit` 안에 있다.** 두 테스트 사이에는 어떤 인자도, 반환값도, 공유 객체도 오간 적이 없다. 소스만 봐서는 연결점이 보이지 않는다. 연결은 코드가 아니라 **프로세스 전역 상태**를 통해 이루어졌다.

증상은 이렇게 나타난다. 테스트 파일 이름을 바꿨더니 CI가 깨진다. 테스트를 병렬로 돌리려고 했더니 무작위로 실패한다. 어떤 개발자 기계에서만 통과한다. 하나를 지우면 다른 하나가 고쳐진다.

::: danger
전역 가변 상태가 있는 테스트 스위트는 **테스트 순서가 결과의 일부**다. 순서는 파일 이름, 실행기 버전, 병렬 워커 수에 따라 바뀐다. 즉 **결과가 재현되지 않는다.** 재현되지 않는 실패는 대개 "가끔 그러는" 것으로 분류되고, 그 분류가 붙는 순간 그 테스트는 신호를 잃는다.
:::

여기에 더해, 설정을 읽는 함수의 시그니처를 다시 보라.

```text nolines
  format_temp(celsius)          <- 인자는 온도 하나뿐이다
      내부에서 Config.instance() <- 그런데 설정에 의존한다
```

이 함수는 **시그니처에 적히지 않은 의존성**을 갖는다. 호출하는 쪽은 함수 본문을 열어 보기 전에는 설정이 결과를 바꾼다는 사실을 알 수 없다. 함수 서른 개가 이런 상태면 "이 설정을 바꾸면 무엇이 영향을 받는가"라는 질문에 답할 방법이 전문 검색밖에 없다.

## 2. 무엇이 달라져야 하는가

요구를 둘로 갈라야 한다. 처음부터 두 개였다.

| 요구 | 내용 | 어디서 지키나 |
|---|---|---|
| 유일성 | 이 객체는 프로세스에 하나만 존재한다 | **조립 지점** — 한 번만 만들면 끝난다 |
| 접근성 | 깊은 곳에서도 이 객체에 닿아야 한다 | **전달** — 인자로 넘긴다 |

지금 코드는 둘을 한 클래스에 묶어 놓았다. 그리고 **부서지는 것은 전부 두 번째 요구를 전역으로 해결한 데서 나온다.** 유일성 자체는 아무것도 부수지 않는다. 객체를 한 번만 만드는 것은 그냥 생성 코드를 한 줄만 쓰면 되는 일이고, 그 규율은 조립 코드가 지킨다.

가른 다음 각각을 보면 답이 나온다.

**유일성은 타입이 강제할 문제가 아니다.** "실수로 두 개를 만들면 어쩌나"라는 걱정은 실제로는 거의 일어나지 않는다. 설정 객체를 두 번 만드는 코드는 코드 리뷰에서 눈에 띈다. 반면 전역 접근점이 만드는 문제는 눈에 띄지 않는다 — 그것이 §1에서 본 것이다.

**접근성은 전달로 푼다.** 필요한 곳에 인자로 넘긴다. 그러면 시그니처가 의존성을 선언하고, 테스트는 자기만의 객체를 만들어 넘기고, 테스트끼리 공유하는 상태가 없어진다. 순서가 결과를 바꿀 수 없다.

::: note
"스물다섯 단계 아래까지 인자를 넘기라는 말인가"라는 반론은 정당하다. 답은 두 가지다. 첫째, 그 깊이가 이미 설계 신호다 — 스물다섯 단계 중 스물넷은 그 값을 쓰지도 않으면서 나르고 있다. 둘째, 실무에서는 필요한 의존성을 **생성 시점에 한 번 받아 두는 객체**를 쓴다. 그러면 넘기는 것은 호출마다가 아니라 조립 때 한 번이다.
:::

## 3. 구현

### 3.1 전역 하나가 테스트를 오염시키는 것

같은 테스트 두 개를, 따로 · 순서 A · 순서 B 세 가지로 돌려 본다.

::: dual
```python title="전역 설정 — 테스트 순서가 결과를 바꾼다"
class Config:
    _instance = None

    def __init__(self):
        self.unit = "C"                 # 기본 단위는 섭씨

    @classmethod
    def instance(cls):
        if cls._instance is None:       # 게으른 초기화
            cls._instance = Config()
        return cls._instance

    @classmethod
    def reset_for_demo(cls):            # 실제 코드에는 없는 함수다. 본문 참조
        cls._instance = None

def format_temp(celsius):
    cfg = Config.instance()             # 시그니처에 없는 의존성
    if cfg.unit == "F":
        return f"{celsius * 9 / 5 + 32:.1f}F"
    return f"{celsius:.1f}C"

def test_default():                     # 기본값이 섭씨라는 것을 확인한다
    return format_temp(21.5) == "21.5C"

def test_fahrenheit():                  # 화씨로 바꾸고 확인한다
    Config.instance().unit = "F"
    return format_temp(21.5) == "70.7F"

def verdict(ok):
    return "PASS" if ok else "FAIL"

print("[따로] 테스트마다 새 프로세스 — 상태가 초기화된다")
Config.reset_for_demo()
print("  test_default    ", verdict(test_default()))
Config.reset_for_demo()
print("  test_fahrenheit ", verdict(test_fahrenheit()))

print("[같이 · 순서 A] default -> fahrenheit")
Config.reset_for_demo()
print("  test_default    ", verdict(test_default()))
print("  test_fahrenheit ", verdict(test_fahrenheit()))

print("[같이 · 순서 B] fahrenheit -> default")
Config.reset_for_demo()
print("  test_fahrenheit ", verdict(test_fahrenheit()))
print("  test_default    ", verdict(test_default()))
print("  남은 unit =", Config.instance().unit)
```
```cpp title="전역 설정 — 테스트 순서가 결과를 바꾼다"
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
using namespace std;

struct Config {
    string unit = "C";                  // 기본 단위는 섭씨

    static unique_ptr<Config>& slot() {
        static unique_ptr<Config> p;
        return p;
    }
    static Config& instance() {
        if (!slot())                    // 게으른 초기화
            slot() = make_unique<Config>();
        return *slot();
    }
    static void reset_for_demo() {      // 실제 코드에는 없는 함수다. 본문 참조
        slot().reset();
    }
};

string format_temp(double celsius) {
    Config& cfg = Config::instance();   // 시그니처에 없는 의존성
    ostringstream os;
    os << fixed << setprecision(1);
    if (cfg.unit == "F") {
        os << celsius * 9 / 5 + 32 << "F";
        return os.str();
    }
    os << celsius << "C";
    return os.str();
}

bool test_default() {                   // 기본값이 섭씨라는 것을 확인한다
    return format_temp(21.5) == "21.5C";
}

bool test_fahrenheit() {                // 화씨로 바꾸고 확인한다
    Config::instance().unit = "F";
    return format_temp(21.5) == "70.7F";
}

string verdict(bool ok) { return ok ? "PASS" : "FAIL"; }

int main() {
    cout << "[따로] 테스트마다 새 프로세스 — 상태가 초기화된다\n";
    Config::reset_for_demo();
    cout << "  test_default     " << verdict(test_default()) << "\n";
    Config::reset_for_demo();
    cout << "  test_fahrenheit  " << verdict(test_fahrenheit()) << "\n";

    cout << "[같이 · 순서 A] default -> fahrenheit\n";
    Config::reset_for_demo();
    cout << "  test_default     " << verdict(test_default()) << "\n";
    cout << "  test_fahrenheit  " << verdict(test_fahrenheit()) << "\n";

    cout << "[같이 · 순서 B] fahrenheit -> default\n";
    Config::reset_for_demo();
    cout << "  test_fahrenheit  " << verdict(test_fahrenheit()) << "\n";
    cout << "  test_default     " << verdict(test_default()) << "\n";
    cout << "  남은 unit = " << Config::instance().unit << "\n";
    return 0;
}
```
:::

**비용:** `instance()` 호출은 시간 $O(1)$ — 널 검사 하나와 역참조 하나다. 공간도 객체 하나다. **이 패턴이 비싼 지점은 실행 비용이 아니다.** 테스트를 격리하려면 프로세스를 분리해야 하고, 프로세스 기동 비용은 함수 호출보다 여섯 자릿수쯤 비싸다. 전역 하나를 아낀 대가를 테스트 실행 시간으로 갚는 구조가 된다. 아래 출력이 그 이유를 보인다.

두 언어의 출력은 같다.

```console
[따로] 테스트마다 새 프로세스 — 상태가 초기화된다
  test_default     PASS
  test_fahrenheit  PASS
[같이 · 순서 A] default -> fahrenheit
  test_default     PASS
  test_fahrenheit  PASS
[같이 · 순서 B] fahrenheit -> default
  test_fahrenheit  PASS
  test_default     FAIL
  남은 unit = F
```

**따로 돌리면 둘 다 통과하고, 순서 B로 같이 돌리면 하나가 실패한다.** 두 테스트의 소스 어디에도 상대를 참조하는 줄이 없다. 마지막 줄이 범인을 보여 준다 — `test_fahrenheit`가 바꿔 놓은 `unit = F`가 프로세스에 그대로 남아 있다.

::: warn
`reset_for_demo`는 한 프로세스 안에서 "따로 돌린 경우"를 흉내 내려고 넣었다. 실제 테스트 하네스에는 이런 함수가 없다. **그리고 이 함수를 실제 코드에 넣고 싶어지는 순간이 바로 신호다** — 테스트를 위해 전역을 되돌리는 뒷문을 만들고 있다면, 그것은 싱글톤이 테스트를 오염시킨다는 사실을 코드로 자백한 것이다. 뒷문은 문제를 가리지 못한다. 되돌리는 것을 하나라도 빠뜨리면 오염이 그대로 남고, 병렬 실행에서는 되돌리는 행위 자체가 다른 워커를 깨뜨린다.
:::

### 3.2 넘겨받는 판

전역을 없애고 인자로 받는다. 클래스에서 사라진 것은 `_instance`, `instance()`, `reset_for_demo()` 세 개다.

::: dual
```python title="주입판 — 순서를 바꿔도 결과가 같다"
class Config:
    def __init__(self, unit="C"):       # 전역이 아니다. 그냥 객체다
        self.unit = unit

def format_temp(cfg, celsius):          # 의존성이 시그니처에 적혀 있다
    if cfg.unit == "F":
        return f"{celsius * 9 / 5 + 32:.1f}F"
    return f"{celsius:.1f}C"

def test_default():
    cfg = Config()                      # 이 테스트만의 설정
    return format_temp(cfg, 21.5) == "21.5C"

def test_fahrenheit():
    cfg = Config(unit="F")              # 이 테스트만의 설정
    return format_temp(cfg, 21.5) == "70.7F"

def verdict(ok):
    return "PASS" if ok else "FAIL"

print("[같이 · 순서 A] default -> fahrenheit")
print("  test_default    ", verdict(test_default()))
print("  test_fahrenheit ", verdict(test_fahrenheit()))

print("[같이 · 순서 B] fahrenheit -> default")
print("  test_fahrenheit ", verdict(test_fahrenheit()))
print("  test_default    ", verdict(test_default()))

print("[두 번 반복] 순서 B 를 한 번 더")
print("  test_fahrenheit ", verdict(test_fahrenheit()))
print("  test_default    ", verdict(test_default()))
```
```cpp title="주입판 — 순서를 바꿔도 결과가 같다"
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
using namespace std;

struct Config {
    string unit;
    explicit Config(string unit = "C") : unit(move(unit)) {}   // 전역이 아니다. 그냥 객체다
};

string format_temp(const Config& cfg, double celsius) {        // 의존성이 시그니처에 적혀 있다
    ostringstream os;
    os << fixed << setprecision(1);
    if (cfg.unit == "F") {
        os << celsius * 9 / 5 + 32 << "F";
        return os.str();
    }
    os << celsius << "C";
    return os.str();
}

bool test_default() {
    Config cfg;                         // 이 테스트만의 설정
    return format_temp(cfg, 21.5) == "21.5C";
}

bool test_fahrenheit() {
    Config cfg("F");                    // 이 테스트만의 설정
    return format_temp(cfg, 21.5) == "70.7F";
}

string verdict(bool ok) { return ok ? "PASS" : "FAIL"; }

int main() {
    cout << "[같이 · 순서 A] default -> fahrenheit\n";
    cout << "  test_default     " << verdict(test_default()) << "\n";
    cout << "  test_fahrenheit  " << verdict(test_fahrenheit()) << "\n";

    cout << "[같이 · 순서 B] fahrenheit -> default\n";
    cout << "  test_fahrenheit  " << verdict(test_fahrenheit()) << "\n";
    cout << "  test_default     " << verdict(test_default()) << "\n";

    cout << "[두 번 반복] 순서 B 를 한 번 더\n";
    cout << "  test_fahrenheit  " << verdict(test_fahrenheit()) << "\n";
    cout << "  test_default     " << verdict(test_default()) << "\n";
    return 0;
}
```
:::

```console
[같이 · 순서 A] default -> fahrenheit
  test_default     PASS
  test_fahrenheit  PASS
[같이 · 순서 B] fahrenheit -> default
  test_fahrenheit  PASS
  test_default     PASS
[두 번 반복] 순서 B 를 한 번 더
  test_fahrenheit  PASS
  test_default     PASS
```

순서를 바꿔도, 두 번 돌려도 결과가 같다. 두 테스트가 공유하는 것이 아무것도 없으므로 **다른 스레드나 다른 프로세스에서 동시에 돌려도 안전하다.** 테스트를 병렬화할 수 있느냐는 이 한 가지 성질에 달려 있다.

**비용:** 호출당 인자 하나가 늘고, 참조 전달이므로 시간 $O(1)$에 복사 없음. 유일성은 이제 `main`에서 `Config`를 한 번만 만드는 것으로 지킨다 — 타입이 아니라 **조립 코드**가 지킨다. 잃는 것은 "아무 데서나 손을 뻗으면 닿는" 편의고, 그것이 §1의 문제 자체였다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 유일성의 기본값 | **모듈이 이미 싱글톤이다.** `import config`는 몇 번 해도 같은 모듈 객체를 준다 | 전역 변수, 함수 지역 정적, 정적 멤버 — 전부 손으로 만들어야 한다 |
| 그래서 생기는 일 | 패턴이 **보이지 않는다.** 모듈 최상위에 변수를 하나 두면 그것이 전역 가변 상태인데 클래스도 `instance()`도 없어 눈에 안 띈다 | `instance()`가 코드에 찍혀 있어 최소한 검색은 된다 |
| 게으른 초기화의 스레드 안전 | GIL이 있어도 `if is None` 과 대입 사이에서 스레드가 갈릴 수 있다. 둘이 각각 만든다 | C++11부터 **함수 지역 정적**의 초기화는 표준이 스레드 안전을 보장한다 |
| 소멸 시점 | 인터프리터 종료 시. 다른 전역이 이미 정리됐을 수 있다 | 정적 저장 기간 객체의 소멸은 생성의 역순. 순서가 얽히면 소멸 후 접근이 된다 |

::: danger
Python 쪽 칸이 이 표에서 가장 위험한 줄이다. **모듈 전역이 싱글톤이라는 사실은 이 패턴을 없애는 것이 아니라 감춘다.** `settings.py` 최상위에 `CURRENT_UNIT = "C"`를 두고 여기저기서 그것을 바꾸면, §3.1과 **정확히 같은 테스트 오염**이 일어난다. 클래스도 `instance()`도 없어서 코드 리뷰에서 "싱글톤이네요"라는 말이 나오지 않을 뿐이다. Python 코드베이스가 전역 상태를 모르게 쌓는 경로가 이것이다.
:::

### 3.3 C++에만 있는 두 번째 함정 — 초기화 순서

전역을 클래스 정적 멤버나 네임스페이스 전역으로 두면 C++에는 문제가 하나 더 붙는다. **서로 다른 번역 단위(.cpp 파일)에 있는 전역들의 초기화 순서는 표준이 정하지 않는다.**

::: deep
아래는 번역 단위 셋이다. `banner`가 다른 파일의 `site_name`을 읽는다.

```cpp title="정적 초기화 순서 (조각) — 번역 단위 셋"
// site.cpp
#include <string>
std::string site_name = "warehouse-A";

// banner.cpp
#include <string>
extern std::string site_name;
std::string banner = "hello " + site_name;   // 다른 번역 단위의 전역을 읽는다

// main.cpp
#include <iostream>
#include <string>
extern std::string banner;
int main() { std::cout << "[" << banner << "]\n"; }
```

소스는 한 글자도 바꾸지 않고 **링크 순서만** 바꿔 두 번 빌드하면 결과가 다르다.

```console
site.cpp 를 먼저 링크: [hello warehouse-A]
banner.cpp 를 먼저 링크: [hello ]
```

(Linux x86-64 / g++ 13 `-std=c++17 -O2` 실측. 재현 스크립트는 `tools/bench/siof_link_order.sh`.)

두 번째 경우, `banner`를 만들 때 `site_name`은 아직 생성자가 돌지 않았다. 정적 저장 기간 객체는 동적 초기화 전에 0으로 채워지므로 빈 `std::string`처럼 보이고, 프로그램은 죽지 않고 빈 문자열을 붙인다. **미정의 동작이 죽지 않는 형태로 나타난 것**이고, 이런 것이 가장 늦게 발견된다.
:::

::: tip
해법은 전역 변수를 **함수 지역 정적**으로 바꾸는 것이다. 함수 지역 정적은 **그 함수가 처음 불릴 때** 초기화되므로, 사용 시점에 반드시 초기화가 끝나 있다.

```cpp title="함수 지역 정적으로 순서를 강제한다"
#include <iostream>
#include <string>

std::string& site_name() {                 // 함수 지역 정적. 첫 호출 때 만들어진다
    static std::string s = "warehouse-A";
    return s;
}

std::string& banner() {
    static std::string b = "hello " + site_name();   // 여기서 site_name 이 먼저 완성된다
    return b;
}

int main() {
    std::cout << "[" << banner() << "]\n";
    return 0;
}
```

이 판은 링크 순서와 무관하게 항상 `[hello warehouse-A]`를 출력한다.
:::

::: note
C++11부터 함수 지역 정적의 초기화는 **스레드 안전이 표준으로 보장된다.** 두 스레드가 동시에 진입하면 하나가 초기화하고 다른 하나는 끝날 때까지 기다린다. 이것을 매직 스태틱(magic static)이라 부른다. **그러므로 싱글톤을 위해 이중 검사 잠금(double-checked locking)을 손으로 짜는 것은 지금은 틀린 조언이다.** 그 관용구는 C++11 이전에 메모리 모델이 없던 시절의 산물이고, 손으로 짜면 미묘하게 틀리기 쉽다. 함수 지역 정적을 쓰면 컴파일러가 대신 해 준다.
:::

## 4. 이제 이름을 붙인다

**Singleton**이다. 클래스의 인스턴스가 하나뿐임을 보장하고, 그 인스턴스에 대한 전역 접근점을 제공한다.

정의에 **두 가지**가 들어 있다는 점이 이 패턴의 전부다. GoF의 원문도 두 절로 되어 있다 — "인스턴스가 하나임을 보장한다"와 "전역 접근점을 제공한다". §2에서 갈랐던 두 요구가 정의 안에 그대로 묶여 있다.

앞의 것은 거의 해가 없다. 뒤의 것이 전역 가변 상태이고, 이 챕터의 모든 증상이 거기서 나왔다.

::: interview
**"싱글톤의 문제가 뭔가요?"** 는 자주 나오는 질문이고, "전역 변수라서 나쁘다"까지만 답하면 절반이다. 뼈대는 이렇게 잡는다.

1. **두 책임이 묶여 있다.** 유일성 보장과 전역 접근점은 별개의 요구인데 한 클래스가 둘 다 진다. 부서지는 것은 전부 후자에서 나온다.
2. **가장 먼저 드러나는 비용은 테스트다.** 전역 가변 상태는 테스트 사이에 남으므로 실행 순서가 결과를 바꾸고, 테스트를 병렬로 못 돌린다. 격리하려면 프로세스를 나눠야 한다.
3. **의존성이 시그니처에서 사라진다.** 함수를 보고 무엇에 의존하는지 알 수 없고, 그래서 영향 범위를 정적으로 계산할 수 없다.
4. **대안은 주입이다.** 하나만 만드는 것은 조립 지점에서 지키고, 필요한 곳에는 넘긴다.
5. **그럼에도 받아들일 조건**을 말할 수 있으면 좋다 — 상태가 불변이거나, 진짜 물리 자원 하나에 대응하거나, 교체할 필요가 없는 것.

C++이면 여기에 **초기화 순서와 매직 스태틱**을 얹는다. "번역 단위 간 초기화 순서는 정해져 있지 않고, 함수 지역 정적으로 옮기면 사용 시점 초기화가 되며 C++11부터 그 초기화는 스레드 안전이다"까지 말하면 충분하다.
:::

## 5. 어디에 박혀 있는가

**로깅 라이브러리의 루트 로거**가 대표적이다. 프로세스 전체가 같은 로거 계층을 공유하고, 어디서든 이름으로 로거를 얻는다. 이것이 널리 받아들여지는 이유가 있다 — 로깅은 부수 효과가 출력뿐이고, 테스트가 로그 내용에 의존하는 경우가 드물다. **전역이 안전한 조건은 "그 상태가 프로그램의 결과를 바꾸지 않을 때"** 이고 로깅은 대체로 거기 해당한다. 그리고 그 조건이 깨지는 순간, 즉 로그 수준을 바꾸는 테스트를 짜는 순간, 곧바로 §3.1과 같은 오염이 나타난다.

**커널의 전역 자료구조**는 유일성이 물리적으로 강제되는 경우다. 프로세스 테이블, 인터럽트 벡터, 메모리 존 목록은 기계에 하나뿐인 것에 대응한다. 여기서는 "하나여야 한다"가 설계 선택이 아니라 사실이다.

**장치 핸들**도 비슷하다. 시리얼 포트 하나를 두 객체가 각각 열면 운영체제가 막거나 데이터가 섞인다. 다만 이 경우에도 흔한 실무 해법은 전역 접근점이 아니라 **하나만 열고 그 핸들을 넘기는 것**이다. 그래야 테스트에서 가짜 장치로 갈아끼울 수 있다.

**의존성 주입 컨테이너**는 이 문제에 대한 산업의 답이다. 프레임워크가 객체를 만들고 수명을 관리하며, "이 타입은 프로세스에 하나"라는 선언을 컨테이너 설정으로 표현한다. 유일성은 지켜지는데 전역 접근점은 없다 — 각 객체는 자기가 필요한 것을 생성자로 받는다. **§2에서 가른 두 요구를 실제로 분리한 것**이 이 도구의 정체다.

**Python의 모듈**은 언어에 내장된 싱글톤이다. `import` 한 번이면 이후의 모든 `import`가 같은 객체를 준다. 그래서 Python에서는 이 패턴을 명시적으로 구현할 일이 거의 없고, 동시에 그래서 전역 상태가 쌓이는 것도 눈에 안 띈다.

## 6. 언제 쓰지 말아야 하는가

**상태가 변할 때.** 이것이 유일하고 충분한 판단 기준에 가깝다. 읽기만 하는 것(빌드 시점에 정해진 룩업 테이블, 상수)이면 전역이어도 §3.1의 문제가 생기지 않는다. **누군가 쓰는 순간** 테스트 오염, 순서 의존, 경쟁 조건이 한꺼번에 딸려 온다.

**테스트에서 갈아끼워야 할 때.** 데이터베이스 연결, HTTP 클라이언트, 시계, 난수원, 장비 드라이버 — 전부 테스트에서 가짜로 바꿔야 하는 것들이다. 전역 접근점으로 두면 갈아끼우기 위해 다시 전역을 조작해야 하고, 그러면 §3.1로 돌아간다. **시계를 싱글톤으로 둔 코드는 시간에 의존하는 로직을 테스트할 수 없다.**

**"편의를 위해" 쓸 때.** 인자를 넘기기 귀찮아서 전역으로 두는 것은 결합을 코드에서 지우고 런타임으로 옮기는 것이다. 컴파일러도 타입 검사기도 이 결합을 볼 수 없게 된다.

**초기화에 순서가 있을 때.** 설정이 로거보다 먼저 준비되어야 하고 로거가 연결 풀보다 먼저여야 한다면, 그 순서는 명시적인 조립 코드가 적어야 한다. 게으른 초기화에 맡기면 순서가 **호출 순서**로 결정되고, 그 호출 순서는 코드 어디에도 적혀 있지 않다. C++에서는 여기에 §3.3의 번역 단위 문제까지 겹친다.

**여러 인스턴스가 필요해질 가능성이 있을 때.** "설정은 당연히 하나"라고 두었는데 멀티테넌트 요구가 들어오거나, 한 프로세스가 두 현장을 관제하게 되거나, 테스트가 두 설정을 비교하려 한다. 싱글톤을 되돌리는 작업은 그것을 참조하는 **모든 지점**을 고치는 작업이다.

### 그럼에도 받아들일 만한 경우

- **불변이고 만들기 비싼 것.** 프로그램 수명 내내 안 바뀌는 룩업 테이블, 미리 계산한 상수표.
- **물리적으로 하나인 자원에 대응하고, 테스트가 그것을 건드리지 않을 때.**
- **작은 프로그램.** 스크립트 200줄에 의존성 주입 컨테이너를 넣는 것은 그 자체로 과잉이다. 다만 200줄은 2,000줄이 된다.

받아들이더라도 **전역 접근점 없이** 하는 편이 낫다. 객체는 하나만 만들되 `main`이나 조립 함수에서 만들고, 필요한 곳에 넘긴다. 유일성은 얻고 전역 상태는 피한다. 이 분리를 지키면 나중에 두 개가 필요해져도 고칠 곳이 조립 지점 한 군데다.

## 연습

::: quiz
**1. 시계를 전역으로 둔 코드**

- 상황: 타임아웃 로직을 테스트해야 하는데 현재 시각을 전역 함수로 읽고 있다. 테스트가 실제로 30초를 기다린다.
- 무엇이 변하고 무엇이 고정인가: "시간이 흐르면 타임아웃된다"는 규칙은 고정이고, **시간의 출처**가 변해야 한다.
- 어떤 구조이고 무엇을 대가로 치르는가: 시각을 반환하는 것을 인자로 받는다. 테스트는 원하는 값을 반환하는 가짜를 넘긴다. 대가는 시각을 쓰는 모든 함수의 시그니처가 하나 늘어난다는 것이고, 그 대가로 30초짜리 테스트가 마이크로초가 된다.

**2. 로그 수준을 바꾸는 테스트**

- 상황: 로거는 전역이고 그동안 문제가 없었다. 그런데 "에러 로그가 실제로 남는가"를 확인하는 테스트를 추가하자 다른 테스트들이 깨지기 시작했다.
- 무엇이 변하고 무엇이 고정인가: 로거가 전역이라는 사실은 그대로인데, **그 전역을 쓰는 테스트가 생겼다**는 점이 변했다.
- 어떤 구조이고 무엇을 대가로 치르는가: 판단 기준은 "그 전역이 프로그램의 결과를 바꾸는가"이고, 테스트가 로그를 검증하는 순간 답이 바뀐다. 검증 대상이 되는 로거만 주입으로 바꾸는 것이 최소 수정이다.

**3. 두 현장을 관제하게 됐다**

- 상황: 설정 싱글톤을 쓰는 관제 서비스가 한 프로세스에서 두 현장을 다루게 됐다. 현장마다 장비 주소와 단위가 다르다.
- 무엇이 변하고 무엇이 고정인가: 설정의 **구조**는 고정이고, 인스턴스 수가 1에서 N으로 변한다.
- 어떤 구조이고 무엇을 대가로 치르는가: 전역 접근점을 참조하는 모든 지점을 찾아 인자로 바꿔야 한다. 대가는 그 작업의 크기가 참조 지점 수에 비례한다는 것이고, 그것이 처음부터 주입으로 시작하는 이유다.
:::

## 요약

- 싱글톤은 **유일성 보장**과 **전역 접근점** 두 가지를 한 클래스에 묶는다. 부서지는 것은 전부 두 번째에서 나온다.
- 가장 먼저 드러나는 비용은 테스트다. §3.1의 두 테스트는 따로 돌리면 둘 다 통과하고, 순서를 바꿔 같이 돌리면 하나가 실패한다. 두 테스트의 소스에는 서로를 참조하는 줄이 없다.
- 전역 가변 상태가 있으면 **테스트 순서가 결과의 일부**가 된다. 순서는 파일 이름과 실행기 버전에 따라 바뀌므로 실패가 재현되지 않는다.
- 전역을 되돌리는 뒷문을 만들고 싶어지는 순간이 신호다. 그 함수의 존재가 곧 자백이다.
- 전역에서 읽는 함수는 시그니처가 의존성을 숨긴다. 영향 범위를 정적으로 계산할 수 없게 된다.
- C++에서는 번역 단위 간 정적 초기화 순서가 정해져 있지 않다. 링크 순서만 바꿔도 결과가 달라진다. 함수 지역 정적으로 옮기면 사용 시점 초기화가 되고, C++11부터 그 초기화는 스레드 안전이다.
- Python에서는 모듈이 이미 싱글톤이라 이 패턴이 보이지 않는다. 보이지 않는 만큼 전역 상태가 조용히 쌓인다.
- 대안은 주입이다. 하나만 만드는 규율은 조립 지점이 지키고, 접근은 인자로 푼다.

**다음 절**: [XII-13 동시성 패턴](#/xii-13) — 스레드가 여럿이면 객체 하나를 공유하는 방식 자체가 설계 결정이 된다.
