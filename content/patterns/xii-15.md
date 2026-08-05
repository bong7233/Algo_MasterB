# XII-15 안티패턴

::: lead
패턴 책이 실패하는 방식은 하나다 — 모든 패턴을 좋게만 소개하는 것. 이 절은 그 무게추다.
:::

## 1. 문제

안티패턴은 "나쁜 코드의 목록"이 아니다. 나쁜 코드는 그냥 고치면 된다. 안티패턴은 **각 단계가 전부 합리적이었는데 결과가 나쁜 구조**를 가리킨다. 그래서 범인을 찾을 수 없고, 그래서 되돌리기 어렵다.

지금까지 열네 개의 절이 "이럴 때 이렇게 놓아라"를 말했다. 그 조언은 전부 조건부다. 조건을 확인하지 않고 적용하면 같은 배치가 정반대의 결과를 낸다. 중재자를 두라는 조언([XII-11 Mediator](#/xii-11))은 결합을 줄이지만, 중재자에 상한을 두지 않으면 그것이 곧 이 절의 첫 항목이 된다. 인터페이스를 뽑으라는 조언은 교체 가능성을 사지만, 교체할 것이 없으면 아무것도 사지 못한다.

그래서 이 절은 다섯 항목마다 네 단계를 밟는다.

**① 무엇처럼 보이는가** — 코드에서 눈에 띄는 모양. **② 왜 그렇게 됐는가** — 그 선택을 변호한다. **③ 무엇을 잃는가** — 돌려서 출력으로 보인다. **④ 어떻게 나오는가** — 되돌리는 절차.

두 번째 단계가 핵심이다. ==기원을 조롱하면 같은 구조를 다시 만든다.== 왜 그럴듯했는지를 정확히 알아야 다음번에 그 그럴듯함을 알아본다.

::: note
이 절의 다섯 예제는 전부 돌아간다. 각 항목의 "나쁜 판"은 설명이 아니라 **실제로 무너지는 프로그램**이고, 출력이 그 무너짐이다. 안티패턴을 글로만 읽으면 "나는 저렇게 안 쓴다"로 끝난다. 자기 코드에서 알아보게 만드는 것은 증상의 모양이다.
:::

## 2. God Object

### 무엇처럼 보이는가

클래스 하나가 1,500줄이고 필드가 마흔 개다. 이름이 `Manager`, `Controller`, `Engine`, `System` 으로 끝난다. 새 기능이 들어올 자리를 찾을 때 아무도 고민하지 않는다 — 거기 넣으면 된다는 것을 다 알기 때문이다.

### 왜 그렇게 됐는가

**처음에는 옳은 판단이었다.** 기능이 셋일 때 클래스 셋으로 나누면 그 셋 사이에 참조를 주고받는 배선이 생긴다. 한 객체에 두면 배선이 없다. 작은 프로그램에서 이것은 실제로 더 단순하다.

**그리고 매 단계가 국소적으로 합리적이었다.** 새 기능이 기존 상태를 두 개쯤 참조해야 한다. 그 상태가 이미 그 클래스에 있으니 메서드를 거기 추가하는 것이 가장 짧은 길이다. 다른 곳에 두면 상태를 넘겨야 하고, 그것은 더 많은 코드다. **매번 짧은 길을 고른 결과가 God Object 다.**

**상한 없는 중재자가 같은 자리에 도착한다.** 모듈끼리 직접 말하지 말고 중재자를 통하라는 조언을 따르면 결합은 줄어든다. 그런데 새 상호작용이 생길 때마다 중재자에 메서드가 하나씩 붙는다. 규칙이 없으면 중재자는 모든 참여자를 알고 모든 상태를 들게 되고, **결합을 없애려고 만든 것이 결합의 집결지가 된다.**

### 무엇을 잃는가

무관해 보이는 변경이 다른 기능을 깬다. 아래는 경로 계산과 로그 출력이 같은 작업용 버퍼를 공유하는 객체다. 로그를 켜는 한 줄이 경로를 오염시킨다.

::: dual
```python title="God Object — 공유 버퍼가 무관한 두 기능을 잇는다"
def join(xs):
    return "[" + ", ".join(xs) + "]"


# 나쁜 판 — 한 객체가 경로·로그를 다 들고, 작업용 버퍼까지 공유한다
class RobotManager:
    def __init__(self, log_enabled):
        self.buf = []                      # "임시로 쓰는 공용 버퍼"
        self.log_enabled = log_enabled
        self.lines = []

    def compute_path(self, n):
        self.buf.clear()
        for i in range(n):
            if self.log_enabled and i % 2 == 0 and i > 0:
                self.format_log(i)         # 나중에 끼워 넣은 한 줄
            self.buf.append(str(i))
        return list(self.buf)

    def format_log(self, i):
        self.buf.clear()                   # 로그 담당자는 buf 가 자기 것이라고 믿었다
        self.buf.append("tick")
        self.lines.append(f"step {i}")


# 좋은 판 — 책임마다 객체를 나누고, 각자 자기 버퍼만 만진다
class PathPlanner:
    def __init__(self):
        self._buf = []

    def compute_path(self, n):
        self._buf = [str(i) for i in range(n)]
        return list(self._buf)


class Logger:
    def __init__(self):
        self._buf = []
        self.lines = []

    def format_log(self, i):
        self._buf = ["tick"]
        self.lines.append(f"step {i}")


print("God Object, 로그 끄고:", join(RobotManager(False).compute_path(4)))
print("God Object, 로그 켜고:", join(RobotManager(True).compute_path(4)))

planner, logger = PathPlanner(), Logger()
path = planner.compute_path(4)
for i in range(4):
    if i % 2 == 0 and i > 0:
        logger.format_log(i)
print("분리한 판, 로그 켜고:", join(path), "| 로그", join(logger.lines))
```
```cpp title="God Object — 공유 버퍼가 무관한 두 기능을 잇는다"
#include <iostream>
#include <string>
#include <vector>
using namespace std;

string join(const vector<string>& xs) {
    string s = "[";
    for (size_t i = 0; i < xs.size(); i++) s += (i ? ", " : "") + xs[i];
    return s + "]";
}

// 나쁜 판 — 한 객체가 경로·로그를 다 들고, 작업용 버퍼까지 공유한다
class RobotManager {
public:
    explicit RobotManager(bool log_enabled) : log_enabled(log_enabled) {}

    vector<string> compute_path(int n) {
        buf.clear();
        for (int i = 0; i < n; i++) {
            if (log_enabled && i % 2 == 0 && i > 0)
                format_log(i);             // 나중에 끼워 넣은 한 줄
            buf.push_back(to_string(i));
        }
        return buf;
    }

    void format_log(int i) {
        buf.clear();                       // 로그 담당자는 buf 가 자기 것이라고 믿었다
        buf.push_back("tick");
        lines.push_back("step " + to_string(i));
    }

    vector<string> buf;                    // "임시로 쓰는 공용 버퍼"
    bool log_enabled;
    vector<string> lines;
};

// 좋은 판 — 책임마다 객체를 나누고, 각자 자기 버퍼만 만진다
class PathPlanner {
public:
    vector<string> compute_path(int n) {
        _buf.clear();
        for (int i = 0; i < n; i++) _buf.push_back(to_string(i));
        return _buf;
    }
private:
    vector<string> _buf;
};

class Logger {
public:
    void format_log(int i) {
        _buf = {"tick"};
        lines.push_back("step " + to_string(i));
    }
    vector<string> lines;
private:
    vector<string> _buf;
};

int main() {
    RobotManager off(false), on(true);
    cout << "God Object, 로그 끄고: " << join(off.compute_path(4)) << "\n";
    cout << "God Object, 로그 켜고: " << join(on.compute_path(4)) << "\n";

    PathPlanner planner;
    Logger logger;
    vector<string> path = planner.compute_path(4);
    for (int i = 0; i < 4; i++)
        if (i % 2 == 0 && i > 0) logger.format_log(i);
    cout << "분리한 판, 로그 켜고: " << join(path) << " | 로그 " << join(logger.lines) << "\n";
    return 0;
}
```
:::

```console
God Object, 로그 끄고: [0, 1, 2, 3]
God Object, 로그 켜고: [tick, 2, 3]
분리한 판, 로그 켜고: [0, 1, 2, 3] | 로그 [step 2]
```

**복잡도:** 실행 비용은 두 판이 같다 — 시간 $O(n)$이다. 달라지는 것은 **변경의 비용**이다. 책임 $k$ 개가 같은 상태를 공유하면 서로 간섭할 수 있는 쌍이 $O(k^2)$ 개이므로, 한 책임을 고칠 때 원칙적으로 나머지 $k-1$ 개를 전부 확인해야 한다. 위 예제는 $k = 2$ 라서 눈에 보이지만 $k = 40$ 이면 확인은 실질적으로 불가능해지고, 그때부터 "고치면 다른 데가 터진다"가 상수가 된다. 분리한 판에서 이 수는 0이다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 필드 감추기 | `_buf` 는 관례. 밖에서 여전히 만져진다 | `private` 이 강제한다. 이 예제가 성립하려면 `buf` 를 일부러 `public` 으로 둬야 했다 |
| 신호 | 없다. 큰 클래스도 잘 돈다 | 헤더가 커지고 재빌드가 느려지는 것이 물리적 신호가 된다 |

### 어떻게 나오는가

한 번에 나누려 하면 실패한다. 순서가 있다.

1. **상태부터 센다.** 필드 목록을 놓고 각 필드를 실제로 읽고 쓰는 메서드를 표시한다. 함께 움직이는 필드 덩어리가 곧 떼어 낼 후보다.
2. **가장 바깥의 덩어리부터 뗀다.** 다른 필드를 안 건드리는 것부터. 위 예제의 `lines` 가 그런 필드다.
3. **공유 버퍼를 먼저 없앤다.** "임시로 쓰는 공용 버퍼"는 God Object 의 심장이다. 지역 변수로 바꾸는 것만으로 간섭 쌍이 크게 준다.
4. **중재자에는 상한을 정한다.** 중재자가 참여자의 상태를 **들기 시작하면** 이미 넘어간 것이다. 중재자는 배선만 하고 상태는 참여자가 갖는다.

## 3. 싱글톤 남용

### 무엇처럼 보이는가

`Config.instance()`, `Logger.instance()`, `Db.instance()` 가 코드 어디에서나 불린다. 함수 시그니처만 봐서는 그 함수가 무엇에 의존하는지 알 수 없다.

### 왜 그렇게 됐는가

**설정은 정말로 하나다.** 프로세스에 설정 파일이 하나뿐인 것은 사실이고, 그 사실을 타입으로 표현한 것이 싱글톤이다. **그리고 전달이 귀찮다.** 설정을 인자로 넘기려면 중간의 함수 열 개가 쓰지도 않는 인자를 받아 넘겨야 한다.

문제는 싱글톤이 두 가지를 한꺼번에 한다는 데 있다. **개수를 하나로 강제하는 것**과 **어디서나 접근하게 하는 것**은 다른 요구인데, 관용구 하나가 둘을 묶어 판다. 실제로 필요한 것은 대개 앞쪽뿐이고, 문제를 만드는 것은 뒤쪽이다.

### 무엇을 잃는가

전역 상태는 호출 사이에 살아남는다. 시험 두 개를 순서대로 돌리면 앞 시험이 남긴 값이 뒤 시험을 깨뜨린다.

::: dual
```python title="싱글톤 남용 — 앞 시험이 뒤 시험을 깨뜨린다"
DEFAULT_SPEED = 2.0


# 나쁜 판 — 설정이 전역에 하나뿐이고, 아무나 그 자리에서 바꾼다
class Config:
    _inst = None

    def __init__(self):
        self.max_speed = DEFAULT_SPEED

    @classmethod
    def instance(cls):
        if cls._inst is None:
            cls._inst = Config()
        return cls._inst


def brake_distance(speed):
    return speed * speed


def test_low_speed_singleton():
    Config.instance().max_speed = 0.5          # 이 줄이 다음 시험까지 살아남는다
    return brake_distance(Config.instance().max_speed) == 0.25


def test_default_speed_singleton():
    return brake_distance(Config.instance().max_speed) == 4.0


# 좋은 판 — 설정을 인자로 받는다. 시험마다 자기 설정을 만든다
def test_low_speed_injected():
    cfg = Config()
    cfg.max_speed = 0.5
    return brake_distance(cfg.max_speed) == 0.25


def test_default_speed_injected():
    cfg = Config()
    return brake_distance(cfg.max_speed) == 4.0


def verdict(ok):
    return "통과" if ok else "실패"


print("싱글톤: test_low_speed", verdict(test_low_speed_singleton()),
      "/ test_default_speed", verdict(test_default_speed_singleton()))
print("주입판: test_low_speed", verdict(test_low_speed_injected()),
      "/ test_default_speed", verdict(test_default_speed_injected()))
```
```cpp title="싱글톤 남용 — 앞 시험이 뒤 시험을 깨뜨린다"
#include <iostream>
#include <string>
using namespace std;

const double DEFAULT_SPEED = 2.0;

// 나쁜 판 — 설정이 전역에 하나뿐이고, 아무나 그 자리에서 바꾼다
class Config {
public:
    double max_speed = DEFAULT_SPEED;

    static Config& instance() {
        static Config inst;          // 지역 정적 — C++ 에서 가장 흔한 싱글톤 관용구
        return inst;
    }
};

double brake_distance(double speed) { return speed * speed; }

bool test_low_speed_singleton() {
    Config::instance().max_speed = 0.5;        // 이 줄이 다음 시험까지 살아남는다
    return brake_distance(Config::instance().max_speed) == 0.25;
}

bool test_default_speed_singleton() {
    return brake_distance(Config::instance().max_speed) == 4.0;
}

// 좋은 판 — 설정을 인자로 받는다. 시험마다 자기 설정을 만든다
bool test_low_speed_injected() {
    Config cfg;
    cfg.max_speed = 0.5;
    return brake_distance(cfg.max_speed) == 0.25;
}

bool test_default_speed_injected() {
    Config cfg;
    return brake_distance(cfg.max_speed) == 4.0;
}

string verdict(bool ok) { return ok ? "통과" : "실패"; }

int main() {
    cout << "싱글톤: test_low_speed " << verdict(test_low_speed_singleton())
         << " / test_default_speed " << verdict(test_default_speed_singleton()) << "\n";
    cout << "주입판: test_low_speed " << verdict(test_low_speed_injected())
         << " / test_default_speed " << verdict(test_default_speed_injected()) << "\n";
    return 0;
}
```
:::

```console
싱글톤: test_low_speed 통과 / test_default_speed 실패
주입판: test_low_speed 통과 / test_default_speed 통과
```

**복잡도:** 접근 비용은 시간 $O(1)$이고, 그것이 이 관용구가 살아남은 이유다. 대가는 실행 비용이 아니라 **검증 비용**이다. 시험 $T$ 개가 전역 상태 하나를 공유하면 결과가 실행 순열에 달리므로 원칙적으로 $T!$ 가지 순서가 다른 답을 낼 수 있고, 실무에서는 "혼자 돌리면 통과하는데 전체를 돌리면 실패한다"로 나타난다. 병렬 실행도 막힌다 — 시험 스위트의 벽시계 시간이 $O(T)$ 로 고정된다. 주입판에서는 시험 하나가 다른 시험에 대해 독립이므로 순열이 사라진다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 가장 쉬운 싱글톤 | **모듈이 이미 싱글톤이다.** 모듈 수준 변수 하나면 끝이고, 클래스를 만들 이유가 없다 | 지역 정적. C++11부터 초기화가 스레드 안전임을 표준이 보장한다 |
| 파괴 순서 | 인터프리터 종료 시점. 종료 중 접근이 위험하다 | 정적 소멸 순서가 번역 단위 간에 정의되지 않는다 — 유명한 파괴 순서 참사 |
| 시험 격리 | `monkeypatch` 로 모듈 변수를 갈아 끼울 수 있다 | 다시 빌드하지 않으면 갈아 끼울 방법이 사실상 없다 |

### 어떻게 나오는가

한 번에 다 없애려 들지 마라. **접근 지점부터 줄인다.** 전역 인스턴스를 그대로 두되, 그것을 읽는 곳을 한 군데(조립 지점)로 모으고 나머지는 인자로 받게 바꾼다. 그러면 시험은 인자를 넣어 격리되고, 운영 코드는 그대로 돈다. 왜 제어 소프트웨어에서 싱글톤이 특히 위험한지, 그리고 개수 강제와 전역 접근을 어떻게 떼어 내는지는 [XII-12 Singleton과 그 함정](#/xii-12)에 있다.

## 4. 스마트 UI

### 무엇처럼 보이는가

버튼 처리기 안에 할인율 계산이 있다. 화면 컨트롤러가 데이터베이스에 직접 질의하고, 유효성 검사가 입력 위젯에 붙어 있다. 업무 규칙을 찾으려면 화면 코드를 읽어야 한다.

### 왜 그렇게 됐는가

**첫 화면 하나만 있을 때는 이것이 가장 빠르다.** 화면 하나짜리 도구에서 규칙을 별도 계층으로 빼면 파일 셋이 생기고, 그중 둘은 한 줄짜리다. 도구 제작기가 그렇게 만들도록 유도하기도 한다 — 이벤트 처리기를 열면 커서가 거기 있고, 거기 쓰면 즉시 돈다.

**그리고 요구가 화면 단위로 온다.** "이 버튼을 누르면 이렇게 되게 해 달라"는 요청은 화면의 언어로 오고, 화면 코드에 쓰는 것이 요청과 코드의 거리가 가장 짧다.

### 무엇을 잃는가

두 번째 인터페이스가 필요해지는 순간 청구서가 온다. 규칙이 화면 안에 있으므로 옮겨 적어야 하고, 옮겨 적은 것은 어긋난다.

::: dual
```python title="스마트 UI — 두 번째 입구에서 규칙이 갈라진다"
BASE_FEE = 5000
FREE_KG = 5
PER_KG = 300


# 나쁜 판 — 요금 규칙이 화면 코드 안에 있다
def cli_screen(weight):
    fee = BASE_FEE
    if weight > FREE_KG:
        fee += (weight - FREE_KG) * PER_KG     # 규칙이 여기 산다
    return f"{fee}원"


def api_handler(weight):
    fee = BASE_FEE                             # 두 번째 화면을 만들며 옮겨 적다 흘렸다
    return {"fee": fee}


# 좋은 판 — 규칙을 도메인 함수 하나로 빼고, 두 화면이 같은 것을 부른다
def shipping_fee(weight):
    fee = BASE_FEE
    if weight > FREE_KG:
        fee += (weight - FREE_KG) * PER_KG
    return fee


def cli_screen2(weight):
    return f"{shipping_fee(weight)}원"


def api_handler2(weight):
    return {"fee": shipping_fee(weight)}


w = 10
print(f"스마트 UI : CLI {cli_screen(w)} / API {api_handler(w)['fee']}원")
print(f"도메인 분리: CLI {cli_screen2(w)} / API {api_handler2(w)['fee']}원")
```
```cpp title="스마트 UI — 두 번째 입구에서 규칙이 갈라진다"
#include <iostream>
#include <string>
using namespace std;

const int BASE_FEE = 5000;
const int FREE_KG = 5;
const int PER_KG = 300;

// 나쁜 판 — 요금 규칙이 화면 코드 안에 있다
string cli_screen(int weight) {
    int fee = BASE_FEE;
    if (weight > FREE_KG) fee += (weight - FREE_KG) * PER_KG;   // 규칙이 여기 산다
    return to_string(fee) + "원";
}

int api_handler(int weight) {
    (void)weight;
    int fee = BASE_FEE;                    // 두 번째 화면을 만들며 옮겨 적다 흘렸다
    return fee;
}

// 좋은 판 — 규칙을 도메인 함수 하나로 빼고, 두 화면이 같은 것을 부른다
int shipping_fee(int weight) {
    int fee = BASE_FEE;
    if (weight > FREE_KG) fee += (weight - FREE_KG) * PER_KG;
    return fee;
}

string cli_screen2(int weight) { return to_string(shipping_fee(weight)) + "원"; }

int api_handler2(int weight) { return shipping_fee(weight); }

int main() {
    int w = 10;
    cout << "스마트 UI : CLI " << cli_screen(w) << " / API " << api_handler(w) << "원\n";
    cout << "도메인 분리: CLI " << cli_screen2(w) << " / API " << api_handler2(w) << "원\n";
    return 0;
}
```
:::

```console
스마트 UI : CLI 6500원 / API 5000원
도메인 분리: CLI 6500원 / API 6500원
```

같은 무게에 두 가지 요금이 나왔다. 이런 종류의 불일치는 **한쪽이 틀렸다는 사실 자체를 아무도 모르는 채로** 몇 달을 간다. 둘을 비교하는 코드가 어디에도 없기 때문이다.

**복잡도:** 규칙이 인터페이스 $I$ 개에 복제되면 규칙 하나를 바꾸는 비용이 $O(I)$ 가 되고, 서로 어긋날 수 있는 쌍이 $O(I^2)$ 개 생긴다. 규칙을 한 함수로 빼면 변경 비용은 $O(1)$, 불일치 쌍은 0이다. 실행 비용은 함수 호출 하나만큼 늘 뿐이다 — 이 안티패턴은 **성능을 위해 감수하는 종류가 아니다.**

| 언어 차이 | Python | C++ |
|---|---|---|
| 규칙을 빼는 비용 | 함수 하나. 클래스도 인터페이스도 필요 없다 | 함수 하나. 헤더에 선언을 하나 더할 뿐이다 |
| 중복 탐지 | 정적 분석기가 잡아 주기도 한다 | 컴파일러는 못 잡는다. 둘 다 정상 코드다 |

### 어떻게 나오는가

**규칙을 통째로 옮기려 하지 말고 하나씩 뺀다.** 화면 코드에서 계산식 한 덩어리를 함수로 뽑아 같은 파일 아래쪽에 두는 것부터 시작한다. 그것만으로도 두 번째 입구가 생겼을 때 부를 대상이 존재한다. 그 함수들이 늘어나면 파일을 옮기고, 그때 [XII-14 아키텍처 패턴](#/xii-14)의 포트&어댑터가 자연스러운 다음 단계가 된다. **판정 기준은 한 줄이다 — 화면 없이 그 규칙을 시험할 수 있는가.**

## 5. 순환 의존

### 무엇처럼 보이는가

모듈 A가 B를 참조하고 B가 A를 참조한다. 파이썬이면 import 순서에 따라 초기화가 덜 된 모듈을 만나고, C++이면 헤더가 서로를 포함해 전방 선언과 포인터로 우회한다. 어느 쪽이든 **둘 중 하나만 떼어 낼 수 없다.**

### 왜 그렇게 됐는가

**양방향 참조는 도메인에서 자연스럽다.** 주문은 청구를 알아야 하고, 청구도 주문 정보를 알아야 한다. 현실의 두 개념이 서로를 언급하니 코드도 그렇게 쓴다. **그리고 한 줄이면 된다.** 필요한 함수가 저쪽에 있으니 import 한 줄을 추가한다. 그 한 줄이 사이클을 만든다는 사실은 그 순간 보이지 않는다.

### 무엇을 잃는가

의존 그래프에 방향이 있는 사이클이 생기면 **"먼저 만들 것"의 순서가 아예 정의되지 않는다.** 빌드 순서, 링크 순서, 초기화 순서가 전부 이 순서다. 그리고 이것을 찾는 방법은 이미 배운 것이다 — 방향 그래프의 사이클 검출이고, 곧 [IV-2 DFS](#/iv-2)의 색칠이다.

::: dual
```python title="순환 의존 — 빌드 순서가 정의되지 않는다"
NODES = ["ui", "order", "billing", "payment"]

# 나쁜 판 — billing 이 order 를 직접 부른다. 화살표가 되돌아온다
CYCLIC = {"ui": ["order"], "order": ["billing"], "billing": ["order", "payment"], "payment": []}

# 좋은 판 — billing 은 결과를 이벤트로 올리고, 연결은 위에서 한다
ACYCLIC = {"ui": ["order"], "order": ["billing"], "billing": ["payment"], "payment": []}

WHITE, GRAY, BLACK = 0, 1, 2


def build_order(graph):
    """의존이 먼저 오도록 정렬한다. 사이클이 있으면 (None, 사이클 경로)."""
    color = {n: WHITE for n in NODES}
    stack, out = [], []

    def dfs(u):
        color[u] = GRAY                      # 지금 재귀 경로 위에 있다
        stack.append(u)
        for v in graph[u]:
            if color[v] == GRAY:             # 회색을 다시 만나면 역방향 간선이다
                cut = stack[stack.index(v):] + [v]
                return cut
            if color[v] == WHITE:
                cyc = dfs(v)
                if cyc:
                    return cyc
        color[u] = BLACK
        stack.pop()
        out.append(u)                        # 자식을 다 끝낸 뒤 담는다
        return None

    for n in NODES:
        if color[n] == WHITE:
            cyc = dfs(n)
            if cyc:
                return None, cyc
    return out, None


def join(xs):
    return "[" + ", ".join(xs) + "]"


order, cyc = build_order(CYCLIC)
print("순환 있음  : 빌드 순서 없음 — 사이클", " -> ".join(cyc))

order, cyc = build_order(ACYCLIC)
print("경계 정리 후: 빌드 순서", join(order))
```
```cpp title="순환 의존 — 빌드 순서가 정의되지 않는다"
#include <algorithm>
#include <functional>
#include <iostream>
#include <map>
#include <string>
#include <vector>
using namespace std;

using Graph = map<string, vector<string>>;
const vector<string> NODES = {"ui", "order", "billing", "payment"};

// 나쁜 판 — billing 이 order 를 직접 부른다. 화살표가 되돌아온다
const Graph CYCLIC = {{"ui", {"order"}}, {"order", {"billing"}},
                      {"billing", {"order", "payment"}}, {"payment", {}}};

// 좋은 판 — billing 은 결과를 이벤트로 올리고, 연결은 위에서 한다
const Graph ACYCLIC = {{"ui", {"order"}}, {"order", {"billing"}},
                       {"billing", {"payment"}}, {"payment", {}}};

const int WHITE = 0, GRAY = 1, BLACK = 2;

// 의존이 먼저 오도록 정렬한다. 사이클이 있으면 out 이 비고 cyc 에 경로가 담긴다
void build_order(const Graph& graph, vector<string>& out, vector<string>& cyc) {
    map<string, int> color;
    for (const string& n : NODES) color[n] = WHITE;
    vector<string> stack;
    out.clear();
    cyc.clear();

    function<bool(const string&)> dfs = [&](const string& u) {
        color[u] = GRAY;                     // 지금 재귀 경로 위에 있다
        stack.push_back(u);
        for (const string& v : graph.at(u)) {
            if (color[v] == GRAY) {          // 회색을 다시 만나면 역방향 간선이다
                auto it = find(stack.begin(), stack.end(), v);
                cyc.assign(it, stack.end());
                cyc.push_back(v);
                return true;
            }
            if (color[v] == WHITE && dfs(v)) return true;
        }
        color[u] = BLACK;
        stack.pop_back();
        out.push_back(u);                    // 자식을 다 끝낸 뒤 담는다
        return false;
    };

    for (const string& n : NODES)
        if (color[n] == WHITE && dfs(n)) {
            out.clear();
            return;
        }
}

string join(const vector<string>& xs, const string& sep) {
    string s;
    for (size_t i = 0; i < xs.size(); i++) s += (i ? sep : "") + xs[i];
    return s;
}

int main() {
    vector<string> order, cyc;
    build_order(CYCLIC, order, cyc);
    cout << "순환 있음  : 빌드 순서 없음 — 사이클 " << join(cyc, " -> ") << "\n";

    build_order(ACYCLIC, order, cyc);
    cout << "경계 정리 후: 빌드 순서 [" << join(order, ", ") << "]\n";
    return 0;
}
```
:::

```console
순환 있음  : 빌드 순서 없음 — 사이클 order -> billing -> order
경계 정리 후: 빌드 순서 [payment, billing, order, ui]
```

**복잡도:** 검출은 시간 $O(V + E)$ — DFS 가 각 정점을 한 번 색칠하고 각 간선을 한 번 본다. 공간은 색 배열과 재귀 스택으로 $O(V)$. 사이클이 없을 때 나오는 후위 순서의 역이 곧 위상 정렬이고, 그래서 **"빌드 순서를 뽑는 일"과 "순환을 찾는 일"은 같은 한 번의 순회다**([IV-6 위상 정렬](#/iv-6)). 사이클이 있으면 위상 순서는 존재하지 않는다 — 도구가 못 찾는 것이 아니라 없는 것이다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 증상 | `ImportError` 또는 부분 초기화된 모듈. 실행 시점에 터진다 | 헤더 순환은 전방 선언으로 우회되어 **증상이 안 보인다.** 링크 단계나 정적 초기화 순서에서 늦게 나온다 |
| 재귀 깊이 | 기본 1,000. 모듈 수천 개 그래프에서는 반복형으로 바꿔야 한다 | 스택 한도까지 |
| 도구 | `importlib` 그래프를 떠서 이 코드에 그대로 넣을 수 있다 | 빌드 시스템이 이미 이 그래프를 갖고 있다 |

### 어떻게 나오는가

세 가지 중 하나다.

1. **의존을 뒤집는다.** 아래 모듈이 위를 부르는 대신 **결과를 이벤트로 올린다.** 위 예제가 이것이고, [XII-7 Observer / Publish-Subscribe](#/xii-7)가 그 도구다.
2. **공통 부분을 아래로 뺀다.** A와 B가 서로 필요로 하는 것이 사실은 둘 다 쓰는 공통 개념이면, 그것을 C로 빼고 A·B 모두 C를 향하게 한다.
3. **경계를 다시 긋는다.** 두 모듈이 매번 서로를 부른다면 애초에 하나의 개념이었을 수 있다. 억지로 나눈 경계는 사이클로 티가 난다.

**그리고 사이클 검사를 CI에 넣어라.** 순환은 한 줄로 생기고 사람 눈으로는 안 보인다. 위 코드가 그대로 그 검사기다.

## 6. 조기 추상화

### 무엇처럼 보이는가

인터페이스 하나에 구현이 하나다. `AbstractXFactory`, `IXProvider`, `XStrategy` 가 있고 각각의 구현체는 정확히 하나씩이다. 실제 코드를 찾으려면 파일 넷을 지나야 한다.

### 왜 그렇게 됐는가

**나중을 위한 대비는 미덕처럼 보인다.** "나중에 다른 구현이 생길 테니 지금 인터페이스를 뽑아 두자"는 문장에 반대하기 어렵다. **그리고 좋은 조언을 따른 것이다.** 이 Part 의 절반이 "변하는 것을 인터페이스 뒤로 감춰라"를 말했다. 조건을 빼고 읽으면 정확히 이 결과가 나온다.

### 무엇을 잃는가

간접 계층 하나의 값은 나중에 실제로 갈아 끼울 때 회수된다. 문제는 **하나의 사례만 보고 뽑은 인터페이스가 두 번째 사례에 안 맞는다**는 것이다. 아래는 CSV 하나만 보고 "행 단위"로 잡은 인터페이스에 JSON 구현을 붙인 결과다.

::: dual
```python title="조기 추상화 — 하나만 보고 뽑은 인터페이스가 둘째에서 깨진다"
RECORDS = [1, 2]


def valid_csv(s):
    return s.count("\n") == 3 and s.startswith("id\n")


def valid_json(s):                         # 배열 껍데기만 본다. 예제용 최소 검사다
    return s.startswith("[") and s.endswith("]")


def verdict(ok):
    return "유효" if ok else "유효하지 않음"


# 나쁜 판 — CSV 하나만 보고 "행 단위" 로 뽑은 인터페이스
class RowExporter:
    def header(self):
        raise NotImplementedError

    def row(self, rec):
        raise NotImplementedError


class CsvRow(RowExporter):
    def header(self):
        return "id\n"

    def row(self, rec):
        return f"{rec}\n"


class JsonRow(RowExporter):                # 한 행씩 뱉으라니 문서 껍데기를 붙일 자리가 없다
    def header(self):
        return ""

    def row(self, rec):
        return '{"id": %d}' % rec


def export_rows(exp, recs):
    return exp.header() + "".join(exp.row(r) for r in recs)


# 좋은 판 — 두 번째 구현을 보고 나서 문서 단위로 다시 잡는다
class DocExporter:
    def export_all(self, recs):
        raise NotImplementedError


class CsvDoc(DocExporter):
    def export_all(self, recs):
        return "id\n" + "".join(f"{r}\n" for r in recs)


class JsonDoc(DocExporter):
    def export_all(self, recs):
        return "[" + ", ".join('{"id": %d}' % r for r in recs) + "]"


csv_out, json_out = export_rows(CsvRow(), RECORDS), export_rows(JsonRow(), RECORDS)
print("행 단위 인터페이스 : csv", verdict(valid_csv(csv_out)),
      "/ json", verdict(valid_json(json_out)), "—", json_out)

csv_out, json_out = CsvDoc().export_all(RECORDS), JsonDoc().export_all(RECORDS)
print("문서 단위 인터페이스: csv", verdict(valid_csv(csv_out)),
      "/ json", verdict(valid_json(json_out)), "—", json_out)
```
```cpp title="조기 추상화 — 하나만 보고 뽑은 인터페이스가 둘째에서 깨진다"
#include <iostream>
#include <memory>
#include <string>
#include <vector>
using namespace std;

const vector<int> RECORDS = {1, 2};

bool valid_csv(const string& s) {
    int nl = 0;
    for (char c : s) if (c == '\n') nl++;
    return nl == 3 && s.rfind("id\n", 0) == 0;
}

bool valid_json(const string& s) {          // 배열 껍데기만 본다. 예제용 최소 검사다
    return !s.empty() && s.front() == '[' && s.back() == ']';
}

string verdict(bool ok) { return ok ? "유효" : "유효하지 않음"; }

// 나쁜 판 — CSV 하나만 보고 "행 단위" 로 뽑은 인터페이스
struct RowExporter {
    virtual string header() const = 0;
    virtual string row(int rec) const = 0;
    virtual ~RowExporter() = default;
};

struct CsvRow : RowExporter {
    string header() const override { return "id\n"; }
    string row(int rec) const override { return to_string(rec) + "\n"; }
};

struct JsonRow : RowExporter {              // 한 행씩 뱉으라니 문서 껍데기를 붙일 자리가 없다
    string header() const override { return ""; }
    string row(int rec) const override { return "{\"id\": " + to_string(rec) + "}"; }
};

string export_rows(const RowExporter& exp, const vector<int>& recs) {
    string s = exp.header();
    for (int r : recs) s += exp.row(r);
    return s;
}

// 좋은 판 — 두 번째 구현을 보고 나서 문서 단위로 다시 잡는다
struct DocExporter {
    virtual string export_all(const vector<int>& recs) const = 0;
    virtual ~DocExporter() = default;
};

struct CsvDoc : DocExporter {
    string export_all(const vector<int>& recs) const override {
        string s = "id\n";
        for (int r : recs) s += to_string(r) + "\n";
        return s;
    }
};

struct JsonDoc : DocExporter {
    string export_all(const vector<int>& recs) const override {
        string s = "[";
        for (size_t i = 0; i < recs.size(); i++)
            s += (i ? ", " : "") + string("{\"id\": ") + to_string(recs[i]) + "}";
        return s + "]";
    }
};

int main() {
    string csv_out = export_rows(CsvRow(), RECORDS);
    string json_out = export_rows(JsonRow(), RECORDS);
    cout << "행 단위 인터페이스 : csv " << verdict(valid_csv(csv_out))
         << " / json " << verdict(valid_json(json_out)) << " — " << json_out << "\n";

    csv_out = CsvDoc().export_all(RECORDS);
    json_out = JsonDoc().export_all(RECORDS);
    cout << "문서 단위 인터페이스: csv " << verdict(valid_csv(csv_out))
         << " / json " << verdict(valid_json(json_out)) << " — " << json_out << "\n";
    return 0;
}
```
:::

```console
행 단위 인터페이스 : csv 유효 / json 유효하지 않음 — {"id": 1}{"id": 2}
문서 단위 인터페이스: csv 유효 / json 유효 — [{"id": 1}, {"id": 2}]
```

미리 뽑아 둔 인터페이스는 두 번째 구현이 왔을 때 **도움이 되지 않았을 뿐 아니라 방해가 됐다.** 문서 전체의 문맥이 필요한 형식을 행 단위 서명에 밀어 넣었기 때문이다.

**복잡도:** 실행 비용은 가상 호출 하나, 시간 $O(1)$이다. 진짜 비용은 사람 쪽에 있다. 간접 계층이 $d$ 겹이면 "이 호출이 실제로 무엇을 하는가"를 알아내는 데 파일 $d$ 개를 지나야 하고, 이 상수가 신규 참여자에게 가장 크다. 그리고 잘못 뽑힌 인터페이스를 고치는 비용은 **그때까지 만들어진 구현체 수 $K$ 에 비례한 $O(K)$** 다. $K = 1$ 일 때 고치는 것이 가장 싸고, 그래서 **구현체가 하나뿐일 때 인터페이스를 뽑아 두는 것은 가장 비싼 시점에 결정을 굳히는 일**이 된다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 인터페이스가 필요한가 | 덕 타이핑이라 대부분 필요 없다. 필요한 것은 **함수 하나**인 경우가 많다 | 정적 타입이라 다형성을 쓰려면 공통 기반이 필요하다. 그래서 조기 추상화의 유혹이 더 크다 |
| 되돌리기 비용 | 인터페이스 클래스를 지우고 함수를 넘긴다 | 헤더·가상 테이블·소유권까지 걷어내야 한다 |
| 이름 | `export` 를 메서드 이름으로 쓸 수 있다 | `export` 는 예약어다. 그래서 양쪽 다 `export_all` 로 맞췄다 |

### 어떻게 나오는가

**규칙 셋.** ① 구현체가 하나면 인터페이스를 만들지 않는다. ② 두 번째가 왔을 때도 아직 뽑지 않는다 — 둘의 공통점은 우연일 수 있다. ③ **세 번째에서 뽑는다.** 셋을 보고 나면 무엇이 진짜 변하는 축인지가 드러난다. 이것이 rule of three 이고, 이 절의 예제는 그 규칙을 어겼을 때 정확히 무슨 일이 나는지를 보인 것이다.

예외는 [XII-14 아키텍처 패턴](#/xii-14)에서 말한 그대로다. **구현이 하나여도 "가짜 구현으로 시험할 이유"가 있으면 정당하다.** 그때는 구현체가 실질적으로 둘이다.

::: warn
[XII-1 패턴을 왜 배우는가](#/xii-1)의 판정 기준을 다시 적는다. ==구현체가 정확히 하나인 인터페이스는 아직 아무것도 사지 못한 비용이다.== 이 문장은 다섯 안티패턴 중 가장 자주 필요하다. 나머지 넷은 코드가 커진 뒤에 나타나지만, 이것은 **첫날부터** 만들어진다.
:::

## 7. 다섯의 공통 구조

다섯은 서로 다른 자리에서 생기지만 모양이 같다.

**전부 국소적으로는 최선의 선택이었다.** God Object 의 각 추가는 가장 짧은 길이었고, 싱글톤은 전달의 번거로움을 없앴고, 스마트 UI 는 요청과 코드의 거리를 최소화했고, 순환 의존은 필요한 함수를 한 줄로 가져왔고, 조기 추상화는 좋은 조언을 따랐다. **국소 최적의 연속이 전역 최적이 아니라는 것**이 이 다섯의 공통 명제다.

**전부 신호 없이 자란다.** 어느 선을 넘는 순간에 경고가 나오지 않는다. 넘었다는 것은 나중에 "고치면 다른 데가 터진다", "혼자 돌리면 통과한다", "두 화면이 다른 답을 낸다", "빌드 순서를 못 정한다", "실제 코드를 못 찾겠다"로 알게 된다. 그래서 **징후를 미리 정해 두고 자동으로 재는 것**이 유일한 방어다.

| 안티패턴 | 자동으로 잴 수 있는 징후 |
|---|---|
| God Object | 클래스의 줄 수·필드 수, 한 필드를 만지는 메서드 수 |
| 싱글톤 남용 | 전역 접근자(`instance()`)를 부르는 위치의 수, 시험 순서를 섞었을 때의 실패율 |
| 스마트 UI | 화면 계층에서 도메인 타입·DB를 참조하는 횟수 |
| 순환 의존 | 모듈 그래프의 사이클 — 이 절의 코드가 그대로 검사기다 |
| 조기 추상화 | 구현체가 하나뿐인 인터페이스의 수 |

## 8. 언제 이것들이 안티패턴이 아닌가

**규모가 판정을 뒤집는다.** 200줄짜리 스크립트에서 모든 것을 한 클래스에 담는 것은 God Object 가 아니라 그냥 프로그램이다. 화면 하나뿐인 도구에서 규칙을 화면 코드에 두는 것은 스마트 UI 가 아니라 적정 설계다. **판정 기준은 코드의 모양이 아니라 "몇 명이 얼마 동안 이것을 고칠 것인가"다.**

**싱글톤이 옳은 자리가 있다.** 하드웨어 자원이 물리적으로 하나뿐일 때 — 프로세스가 붙잡는 장치 핸들 하나 — 개수를 하나로 강제하는 것은 정확한 모델링이다. 문제가 되는 것은 개수 강제가 아니라 **전역 접근**이므로, 인스턴스를 하나만 만들되 그것을 인자로 넘기면 둘을 떼어 낼 수 있다.

**순환이 허용되는 층위가 있다.** 클래스 두 개가 서로를 참조하는 것(부모와 자식 노드)은 자료구조로서 정상이다. 문제가 되는 것은 **모듈·패키지·빌드 단위**의 순환이다. 층위를 섞어 "양방향 참조는 전부 나쁘다"로 읽으면 트리와 그래프를 못 만든다. 객체 그래프의 순환 참조가 만드는 메모리 문제는 [XI-11 순환 참조와 소유권](#/xi-11)에 있다.

**그리고 이 절 자체가 남용될 수 있다.** 안티패턴 이름을 아는 것의 가장 흔한 부작용은 **정상적인 코드에 딱지를 붙이는 것**이다. "이건 God Object 아닌가요"는 리뷰 코멘트가 아니다. 리뷰 코멘트는 "이 필드를 이 두 메서드가 다른 뜻으로 씁니다"다. ==이름은 진단의 결론이지 진단 자체가 아니다.==

## 연습

::: quiz
**1. 커진 중재자.** 장비 열 대를 조율하는 중재자가 있다. 지금 메서드가 60개이고 장비 상태 사본을 들고 있다. 새 장비를 붙일 때마다 중재자를 고친다.
- 상황: 결합을 없애려고 만든 것이 결합의 집결지가 됐다.
- 무엇이 변하고 무엇이 고정인가: 장비끼리 직접 말하지 않는다는 원칙은 고정이다. 변하는 것은 **중재자가 상태를 드는가**다.
- 어떤 안티패턴이고 어떻게 나오는가: 상한 없는 중재자가 God Object 로 간 경우다. 상태를 참여자에게 돌려주고 중재자는 배선만 남긴다. 대가는 참여자가 자기 상태를 관리해야 한다는 것이다.

**2. 통과하는 시험, 실패하는 스위트.** 시험 200개가 개별로는 전부 통과하는데 전체를 돌리면 셋이 실패한다. 실패하는 셋은 매번 다르다.
- 상황: 시험 사이에 무언가가 살아남는다.
- 무엇이 변하고 무엇이 고정인가: 시험의 내용은 고정이다. 변하는 것은 실행 순서다.
- 어떤 안티패턴이고 어떻게 나오는가: 전역 상태다. 접근 지점을 세고, 가장 많이 불리는 것부터 인자로 바꾼다. 순서를 무작위로 섞어 돌리는 옵션을 CI에 켜 두면 이 문제가 다시 숨지 못한다.

**3. 인터페이스 넷, 구현 넷.** 새 팀원이 "결제가 실제로 어디서 일어나는지 못 찾겠다"고 한다. 인터페이스가 넷이고 각각 구현이 하나씩이다.
- 상황: 간접 계층이 이해를 막고 있다.
- 무엇이 변하고 무엇이 고정인가: 결제 로직은 고정이다. 변하는 것은 그것을 몇 겹으로 감쌌는가다.
- 어떤 안티패턴이고 어떻게 나오는가: 조기 추상화다. 구현체가 하나인 인터페이스부터 하나씩 인라인한다. **되돌리는 것도 리팩터링이다.**

**4. 판정을 뒤집어 보라.** 위 셋 중 하나를 골라, 그 시스템이 한 사람이 두 달 쓰고 버릴 도구라고 하자. 그래도 고치겠는가. 고치지 않는다면 그 판단의 근거는 무엇인가.
:::

## 요약

- 안티패턴은 나쁜 코드의 목록이 아니라 **국소적으로 합리적인 선택이 쌓여 만들어진 구조**다. 그래서 범인이 없고 되돌리기 어렵다.
- **God Object** — 매번 가장 짧은 길을 고른 결과. 공유 버퍼가 심장이고, 상한 없는 중재자가 같은 자리에 도착한다. 간섭 쌍이 $O(k^2)$ 로 는다.
- **싱글톤 남용** — 개수 강제와 전역 접근을 한 관용구가 묶어 판다. 문제는 뒤쪽이고, 대가는 실행 속도가 아니라 **시험 격리**다.
- **스마트 UI** — 첫 화면에서는 가장 빠른 길이다. 청구서는 **두 번째 인터페이스에서** 온다. 같은 입력에 두 답이 나오고, 아무도 그 사실을 모른다.
- **순환 의존** — 방향 그래프의 사이클이고, 그래서 검출은 [IV-2 DFS](#/iv-2)의 색칠 한 번이다. 사이클이 있으면 빌드 순서는 못 찾는 것이 아니라 **존재하지 않는다.**
- **조기 추상화** — 가장 흔하고 첫날부터 생긴다. 하나만 보고 뽑은 인터페이스는 두 번째에서 안 맞는다. **rule of three**: 셋을 보고 뽑는다.
- 다섯 모두 신호 없이 자라므로 **징후를 자동으로 재는 것**이 유일한 방어다. 그리고 규모가 작으면 다섯 다 안티패턴이 아니다.

**다음 절**: [XII-16 패턴 선택 결정 트리](#/xii-16) — 열다섯 절을 한 장의 판단 절차로 접는다.
