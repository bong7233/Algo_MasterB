# XII-14 아키텍처 패턴

::: lead
클래스 하나가 아니라 모듈 전체를 어떻게 놓을 것인가. 그리고 그 배치가 무엇을 대가로 무엇을 사는가.
:::

## 1. 문제

주행 제어 프로그램이 한 파일에서 시작한다. 라이다를 읽고, 거리를 보고, 정지할지 진행할지 정하고, 바퀴에 값을 넣는다. 100줄이고 잘 돈다.

여섯 달 뒤 그 파일은 3,000줄이다. 그동안 일어난 일은 전부 합리적이었다. 라이다 모델이 하나 늘었고, 정지 조건에 배터리 잔량이 들어갔고, 로그 포맷이 두 번 바뀌었고, 시뮬레이터에서도 돌려야 해서 분기가 생겼다.

그리고 세 가지가 동시에 불가능해진다.

**첫째, 판단 로직을 검증할 수 없다.** "전방 0.8미터에서 멈추는가"를 확인하려면 라이다가 꽂힌 실제 장비가 있어야 한다. 판단이 장비 읽기와 같은 함수 안에 있기 때문이다. 시험을 돌리려면 하드웨어를 예약해야 하고, 그래서 아무도 안 돌린다.

**둘째, 부품 하나를 바꾸면 상관없는 곳이 깨진다.** 라이다 드라이버를 새 모델로 갈면 정지 판단 코드까지 손이 간다. 둘 사이에 경계가 없어서, 드라이버가 돌려주는 배열의 모양이 곧 판단 로직의 입력 형식이다.

**셋째, 기능 하나를 더하려면 코어를 고쳐야 한다.** 새 필터 단계를 넣고 싶으면 파이프라인을 도는 함수 안의 `if` 사슬에 한 줄을 추가한다. 그 함수는 이제 존재하는 모든 단계의 이름을 알고 있고, 아무 관계 없는 두 기능이 같은 함수에서 만나 서로의 변경에 노출된다.

::: note
[XII-2 Adapter](#/xii-2)부터 [XII-12 Singleton과 그 함정](#/xii-12)까지는 클래스 몇 개 사이의 배치를 다뤘다. 여기서 다루는 것은 같은 발상을 **모듈·프로세스·계층 단위**로 올린 것이다. 규모가 바뀌면 대가도 바뀐다 — 클래스 하나를 잘못 나누면 파일 하나를 고치면 되지만, 모듈 경계를 잘못 그으면 그 경계는 조직의 담당 범위가 되어 몇 년을 간다.
:::

## 2. 무엇이 달라져야 하는가

세 문제는 하나의 질문으로 모인다. **무엇이 무엇을 알아야 하는가.**

지금은 모두가 모두를 안다. 판단 코드가 드라이버를 알고, 드라이버가 로그 포맷을 알고, 파이프라인 코어가 모든 단계의 이름을 안다. 아는 것이 곧 의존이고, 의존은 방향이 있는 화살표다. 화살표가 아무 데나 뻗으면 어느 것도 따로 떼어 낼 수 없다.

**첫째, 시간 축으로 가른다.** 읽고, 정하고, 움직인다. 이 셋은 성질이 다르다. 읽기는 바깥 세계에 달렸고, 정하기는 순수한 계산이며, 움직이기는 다시 바깥 세계다. 가운데를 **입력만 받아 출력만 내는 함수**로 만들면 장비 없이 표로 검증된다. 대신 대가가 생긴다 — 계층을 지날 때마다 한 주기씩 늦어져서, 새 관측이 구동에 닿기까지 계층 수만큼의 지연이 붙는다.

**둘째, 의존의 화살표를 안쪽으로 돌린다.** 지금은 안쪽(업무 규칙)이 바깥쪽(드라이버·DB·화면)을 안다. 이것을 뒤집는다. **안쪽이 필요한 것의 모양만 선언하고, 바깥쪽이 그 모양에 맞춘다.** 인터페이스의 소유자가 바뀌는 것이 요점이다. 그러면 같은 자리에 실장비 구현도, 가짜 구현도 꽂힌다.

**셋째, 이름과 구현을 표로 잇는다.** 코어가 단계의 이름을 아는 대신, 단계들이 자기 이름을 코어의 표에 등록한다. 코어는 표만 안다. 새 단계는 표에 한 줄을 더하고, 코어는 한 줄도 안 바뀐다.

**넷째, 단계를 앞 단계의 출력만 보는 함수로 만든다.** 그러면 순서를 문자열 하나로 조립할 수 있고 각 단계를 따로 시험할 수 있다. 이 성질은 **각 단계가 상태를 안 들 때만** 성립한다. 한 단계가 지난 호출을 기억하는 순간 합성은 깨진다.

**다섯째, 순서를 미리 정할 수 없으면 순서를 없앤다.** 네 번째까지는 "무엇을 언제 하는가"가 설계 시점에 정해진다는 전제 위에 있다. 그 전제가 깨지는 문제가 있다 — 여러 전문가 모듈이 각자 아는 것만 알고, 누가 언제 기여할지는 그때 상황에 달린 경우다. 그러면 **공유 저장소 하나를 두고 전부가 읽고 쓰며, 중재자가 다음에 누구를 부를지 정한다.**

```text nolines
  dependency arrows                       stages
      outside                             in ──▶ [f1] ──▶ [f2] ──▶ [f3] ──▶ out
        │  adapters                             └── each sees only the previous output
        ▼
     ┌──────┐  ports are declared here
     │domain│  <- nothing inside points outward
     └──────┘
                                          blackboard
  layers                                     ┌───────────────┐
     sense ──▶ plan ──▶ act                   │ shared state  │
       └── one cycle of lag per layer         └───────────────┘
                                             ▲   ▲   ▲
                                             k1  k2  k3   <- specialists, order decided at runtime
```

## 3. 구현

### 3.1 읽기·판단·구동을 가른다

한 덩어리 판과 세 계층 판을 나란히 돌린다. 실장비가 없는 환경을 흉내 내려고 드라이버 호출은 예외를 던진다. 이어서 **엄격한 계층이 무엇을 잃는지**를 스텝 수로 잰다. 전방 거리가 스텝 3에서 0.5미터로 떨어지고, 정지 임계는 1.0미터다.

::: dual
```python title="계층 분리와 그 대가 — 한 덩어리·3계층·반사 경로"
WORLD = [3.0, 2.5, 2.0, 0.5, 0.4, 0.3, 0.3]   # 스텝별 전방 거리. 스텝 3에서 장애물이 나타난다
BRAKE_DIST = 1.0


def read_lidar_hw(step):
    raise RuntimeError("드라이버 없음")        # 실장비가 없는 환경


# 나쁜 판 — 읽기·판단·구동이 한 함수에 뒤엉켜 있다
def cycle_monolith(step, log):
    dist = read_lidar_hw(step)                 # 판단을 보려면 장비부터 있어야 한다
    log.append("STOP" if dist < BRAKE_DIST else "GO")


# 좋은 판 — 세 계층으로 가른다. plan 은 입력만 받는 순수 함수다
def sense(step, world):
    return {"dist": world[step]}

def plan(obs):
    return "STOP" if obs["dist"] < BRAKE_DIST else "GO"

def act(cmd, log):
    log.append(cmd)


# 엄격한 계층 — 각 계층이 자기 주기로 돌고 결과를 아래로 넘긴다
def run_strict(world):
    obs_buf, cmd_buf, log = None, None, []
    for step in range(len(world)):
        if cmd_buf is not None:
            act(cmd_buf, log)                  # 두 주기 전의 관측이 이제야 구동에 닿는다
        else:
            log.append("GO")
        cmd_buf = plan(obs_buf) if obs_buf is not None else None
        obs_buf = sense(step, world)
    return log


# 반사 계층을 하나 얹는다 — 급한 것은 계층을 건너뛴다
def run_reflex(world):
    obs_buf, cmd_buf, log = None, None, []
    for step in range(len(world)):
        obs_now = sense(step, world)
        if obs_now["dist"] < BRAKE_DIST:       # 계획을 기다리지 않는다
            log.append("STOP")
        elif cmd_buf is not None:
            act(cmd_buf, log)
        else:
            log.append("GO")
        cmd_buf = plan(obs_buf) if obs_buf is not None else None
        obs_buf = obs_now
    return log


def first_stop(log):
    return log.index("STOP") if "STOP" in log else -1


log = []
try:
    cycle_monolith(0, log)
    print("한 덩어리: 판단 로직 검증 성공")
except RuntimeError as e:
    print("한 덩어리: 판단 로직을 검증할 수 없다 —", e)

cases = [({"dist": 2.0}, "GO"), ({"dist": 0.5}, "STOP"), ({"dist": 1.0}, "GO")]
ok = sum(1 for obs, want in cases if plan(obs) == want)
print(f"3계층    : plan() 단독 검증 {ok}/{len(cases)} 통과 — 장비가 필요 없다")

print("엄격 계층: 장애물 스텝 3 → 정지 스텝", first_stop(run_strict(WORLD)))
print("반사 계층: 장애물 스텝 3 → 정지 스텝", first_stop(run_reflex(WORLD)))
```
```cpp title="계층 분리와 그 대가 — 한 덩어리·3계층·반사 경로"
#include <algorithm>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
using namespace std;

const vector<double> WORLD = {3.0, 2.5, 2.0, 0.5, 0.4, 0.3, 0.3};  // 스텝 3에서 장애물이 나타난다
const double BRAKE_DIST = 1.0;

struct Obs { double dist; };

double read_lidar_hw(int step) {
    (void)step;
    throw runtime_error("드라이버 없음");      // 실장비가 없는 환경
}

// 나쁜 판 — 읽기·판단·구동이 한 함수에 뒤엉켜 있다
void cycle_monolith(int step, vector<string>& log) {
    double dist = read_lidar_hw(step);         // 판단을 보려면 장비부터 있어야 한다
    log.push_back(dist < BRAKE_DIST ? "STOP" : "GO");
}

// 좋은 판 — 세 계층으로 가른다. plan 은 입력만 받는 순수 함수다
Obs sense(int step, const vector<double>& world) { return Obs{world[step]}; }

string plan(const Obs& obs) { return obs.dist < BRAKE_DIST ? "STOP" : "GO"; }

void act(const string& cmd, vector<string>& log) { log.push_back(cmd); }

// 엄격한 계층 — 각 계층이 자기 주기로 돌고 결과를 아래로 넘긴다
vector<string> run_strict(const vector<double>& world) {
    optional<Obs> obs_buf;
    optional<string> cmd_buf;
    vector<string> log;
    for (int step = 0; step < (int)world.size(); step++) {
        if (cmd_buf) act(*cmd_buf, log);       // 두 주기 전의 관측이 이제야 구동에 닿는다
        else log.push_back("GO");
        cmd_buf = obs_buf ? optional<string>(plan(*obs_buf)) : nullopt;
        obs_buf = sense(step, world);
    }
    return log;
}

// 반사 계층을 하나 얹는다 — 급한 것은 계층을 건너뛴다
vector<string> run_reflex(const vector<double>& world) {
    optional<Obs> obs_buf;
    optional<string> cmd_buf;
    vector<string> log;
    for (int step = 0; step < (int)world.size(); step++) {
        Obs obs_now = sense(step, world);
        if (obs_now.dist < BRAKE_DIST) log.push_back("STOP");   // 계획을 기다리지 않는다
        else if (cmd_buf) act(*cmd_buf, log);
        else log.push_back("GO");
        cmd_buf = obs_buf ? optional<string>(plan(*obs_buf)) : nullopt;
        obs_buf = obs_now;
    }
    return log;
}

int first_stop(const vector<string>& log) {
    auto it = find(log.begin(), log.end(), "STOP");
    return it == log.end() ? -1 : (int)(it - log.begin());
}

int main() {
    vector<string> log;
    try {
        cycle_monolith(0, log);
        cout << "한 덩어리: 판단 로직 검증 성공\n";
    } catch (const runtime_error& e) {
        cout << "한 덩어리: 판단 로직을 검증할 수 없다 — " << e.what() << "\n";
    }

    vector<pair<Obs, string>> cases = {{{2.0}, "GO"}, {{0.5}, "STOP"}, {{1.0}, "GO"}};
    int ok = 0;
    for (auto& c : cases) if (plan(c.first) == c.second) ok++;
    cout << "3계층    : plan() 단독 검증 " << ok << "/" << cases.size()
         << " 통과 — 장비가 필요 없다\n";

    cout << "엄격 계층: 장애물 스텝 3 → 정지 스텝 " << first_stop(run_strict(WORLD)) << "\n";
    cout << "반사 계층: 장애물 스텝 3 → 정지 스텝 " << first_stop(run_reflex(WORLD)) << "\n";
    return 0;
}
```
:::

```console
한 덩어리: 판단 로직을 검증할 수 없다 — 드라이버 없음
3계층    : plan() 단독 검증 3/3 통과 — 장비가 필요 없다
엄격 계층: 장애물 스텝 3 → 정지 스텝 5
반사 계층: 장애물 스텝 3 → 정지 스텝 3
```

**복잡도:** 주기 하나의 계산량은 두 판이 같다 — 계층을 나눠도 시간 $O(1)$이다. 달라지는 것은 **지연**이다. 계층이 $L$ 개이고 각 계층이 자기 주기로 돌면 새 관측이 구동에 닿기까지 $O(L)$ 주기가 걸린다. 위 출력의 `5 - 3 = 2` 가 그 $L-1$ 이다. 반사 경로는 관측을 그 주기 안에서 바로 쓰므로 $O(1)$이고, 대신 그 경로에는 계획이 관여하지 않아 **똑똑하지 않은 결정**만 넣을 수 있다. 공간은 계층 사이 버퍼가 $O(L)$.

| 언어 차이 | Python | C++ |
|---|---|---|
| "아직 없음" 표현 | `None` 을 그냥 쓴다 | `std::optional<T>`. C++17 이전에는 포인터나 플래그로 흉내 냈다 |
| 관측 구조체 | `dict` 한 줄 | `struct Obs`. 필드가 컴파일 시점에 고정된다 |
| 계층 경계의 강제 | 없다. 규약과 리뷰로 지킨다 | 헤더를 안 넘기면 물리적으로 못 부른다 |
| 실패 전달 | 예외가 관용구다 | 예외도 되지만 실시간 경로에서는 반환값으로 쓰는 쪽이 흔하다 |

::: warn
"엄격 계층이 느리다"를 "계층을 나누지 말자"로 읽으면 안 된다. 위 출력에서 3계층 판은 **장비 없이 판단 로직 세 건을 검증했다.** 한 덩어리 판은 한 건도 못 했다. 두 판의 차이는 속도와 검증 가능성의 교환이고, 답은 계층을 없애는 것이 아니라 **급한 것만 계층을 건너뛰게 하는 것**이다.
:::

### 3.2 의존의 화살표를 안쪽으로 돌린다

배터리 잔여 시간을 계산하는 업무 규칙이 있다. 나쁜 판에서는 그 함수가 시리얼 드라이버를 직접 연다. 좋은 판에서는 규칙이 필요한 모양만 선언하고 바깥이 그 모양에 맞춘다.

::: dual
```python title="포트를 안쪽에 두기 — 직접 의존과 포트/어댑터"
from typing import Protocol


class DriverError(Exception):
    pass


def open_serial(port):
    raise DriverError(f"{port} 를 열 수 없음")     # 실장비가 없는 환경


# 나쁜 판 — 도메인 규칙이 구체 드라이버를 직접 붙들고 있다
def hours_left_direct(load_w):
    v = open_serial("/dev/ttyUSB0")               # 바깥이 안쪽을 오염시킨다
    return (v * 50.0) / load_w


# 좋은 판 — 도메인이 포트를 정의하고, 바깥이 그 모양에 맞춘다
class BatteryPort(Protocol):                      # 이 선언은 도메인 쪽에 있다
    def voltage(self) -> float: ...


def hours_left(battery: BatteryPort, load_w):     # 도메인 규칙. 드라이버를 모른다
    return (battery.voltage() * 50.0) / load_w


class SerialBmsAdapter:                           # 바깥 어댑터
    def voltage(self):
        return open_serial("/dev/ttyUSB0")


class FakeBattery:                                # 시험용 어댑터
    def __init__(self, v):
        self._v = v

    def voltage(self):
        return self._v


try:
    hours_left_direct(100.0)
    print("직접 의존  : 도메인 검증 통과")
except DriverError as e:
    print("직접 의존  : 도메인을 검증할 수 없다 —", e)

cases = [(FakeBattery(48.0), 100.0, 24.0), (FakeBattery(24.0), 200.0, 6.0)]
ok = sum(1 for b, load, want in cases if abs(hours_left(b, load) - want) < 1e-9)
print(f"포트/어댑터: 가짜 어댑터로 도메인 검증 {ok}/{len(cases)} 통과")

try:
    hours_left(SerialBmsAdapter(), 100.0)
    print("포트/어댑터: 실장비 어댑터 통과")
except DriverError as e:
    print("포트/어댑터: 실장비 어댑터는 여전히", e, "— 도메인 코드는 한 줄도 안 바뀌었다")
```
```cpp title="포트를 안쪽에 두기 — 직접 의존과 포트/어댑터"
#include <cmath>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
using namespace std;

struct DriverError : runtime_error {
    explicit DriverError(const string& m) : runtime_error(m) {}
};

double open_serial(const string& port) {
    throw DriverError(port + " 를 열 수 없음");     // 실장비가 없는 환경
}

// 나쁜 판 — 도메인 규칙이 구체 드라이버를 직접 붙들고 있다
double hours_left_direct(double load_w) {
    double v = open_serial("/dev/ttyUSB0");        // 바깥이 안쪽을 오염시킨다
    return (v * 50.0) / load_w;
}

// 좋은 판 — 도메인이 포트를 정의하고, 바깥이 그 모양에 맞춘다
struct BatteryPort {                               // 이 선언은 도메인 쪽에 있다
    virtual double voltage() const = 0;
    virtual ~BatteryPort() = default;
};

double hours_left(const BatteryPort& battery, double load_w) {  // 도메인 규칙. 드라이버를 모른다
    return (battery.voltage() * 50.0) / load_w;
}

struct SerialBmsAdapter : BatteryPort {            // 바깥 어댑터
    double voltage() const override { return open_serial("/dev/ttyUSB0"); }
};

struct FakeBattery : BatteryPort {                 // 시험용 어댑터
    explicit FakeBattery(double v) : _v(v) {}
    double voltage() const override { return _v; }
    double _v;
};

int main() {
    try {
        hours_left_direct(100.0);
        cout << "직접 의존  : 도메인 검증 통과\n";
    } catch (const DriverError& e) {
        cout << "직접 의존  : 도메인을 검증할 수 없다 — " << e.what() << "\n";
    }

    vector<unique_ptr<BatteryPort>> fakes;
    fakes.push_back(make_unique<FakeBattery>(48.0));
    fakes.push_back(make_unique<FakeBattery>(24.0));
    vector<pair<double, double>> cases = {{100.0, 24.0}, {200.0, 6.0}};
    int ok = 0;
    for (size_t i = 0; i < cases.size(); i++)
        if (fabs(hours_left(*fakes[i], cases[i].first) - cases[i].second) < 1e-9) ok++;
    cout << "포트/어댑터: 가짜 어댑터로 도메인 검증 " << ok << "/" << cases.size() << " 통과\n";

    try {
        SerialBmsAdapter real;
        hours_left(real, 100.0);
        cout << "포트/어댑터: 실장비 어댑터 통과\n";
    } catch (const DriverError& e) {
        cout << "포트/어댑터: 실장비 어댑터는 여전히 " << e.what()
             << " — 도메인 코드는 한 줄도 안 바뀌었다\n";
    }
    return 0;
}
```
:::

```console
직접 의존  : 도메인을 검증할 수 없다 — /dev/ttyUSB0 를 열 수 없음
포트/어댑터: 가짜 어댑터로 도메인 검증 2/2 통과
포트/어댑터: 실장비 어댑터는 여전히 /dev/ttyUSB0 를 열 수 없음 — 도메인 코드는 한 줄도 안 바뀌었다
```

**복잡도:** 포트를 하나 거치는 실행 비용은 시간 $O(1)$ — 가상 함수 호출 한 번, 곧 간접 분기 하나다. 상수는 대개 무시할 만하지만 **인라인 확장이 막힌다는 점**이 뜨거운 루프에서 문제가 된다. 한 픽셀마다 포트를 부르면 함수 호출 오버헤드가 계산 자체를 넘어선다. 그런 자리에서는 포트를 **한 픽셀이 아니라 한 프레임 단위로** 잡는다. 공간은 어댑터 객체 하나당 $O(1)$이고, 가상 함수 테이블 포인터가 객체마다 8바이트씩 붙는다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 포트 선언 | `Protocol` — 구조가 맞으면 상속 없이 꽂힌다. **서드파티 클래스를 그대로 어댑터로 쓸 수 있다** | 순수 가상 클래스를 상속해야 한다. 서드파티를 감쌀 얇은 클래스가 하나 더 필요하다 |
| 검사 시점 | 실행 시점. `Protocol` 은 타입 검사기에게만 말한다 | 컴파일 시점. 메서드 하나만 빠져도 안 된다 |
| 소유권 | 참조 계수 | `unique_ptr` 로 명시한다. 포트는 참조로 받고 소유는 조립하는 쪽이 한다 |
| 대안 | 함수 하나면 되는 포트는 그냥 함수를 넘긴다 | `std::function` 으로 같은 일을 하되 호출 비용이 조금 더 든다 |

::: tip
포트가 메서드 하나뿐이라면 Python 에서는 클래스를 만들 이유가 없다. `hours_left(read_voltage, load_w)` 로 함수를 그냥 넘겨라. **클래스가 필요해지는 경계는 셋이다** — 포트에 메서드가 둘 이상 생길 때, 어댑터가 상태(연결·재시도 카운터)를 들 때, 여러 구현을 이름으로 등록·발견해야 할 때. 그 전까지 인터페이스 선언은 비용만 있고 이득이 없다. [XII-15 안티패턴](#/xii-15)의 마지막 항목이 정확히 이 이야기다.
:::

### 3.3 단계를 표에 등록하고 문자열로 조립한다

파이프라인 코어가 단계 이름을 전부 아는 판과, 표만 아는 판을 비교한다. 마지막 두 줄이 이 구조가 성립하는 **조건**을 드러낸다.

::: dual
```python title="단계 조립 — 하드코딩·레지스트리·상태가 걸친 단계"
DATA = [1, 12, -4, 7]


# 나쁜 판 — 코어가 단계 이름을 전부 알고 있다
def run_hardcoded(spec, xs):
    for name in spec.split("|"):
        if name == "trim":
            xs = [max(x, 0) for x in xs]
        elif name == "scale":
            xs = [x * 2 for x in xs]
        else:
            return None            # 새 단계는 이 함수를 고쳐야 들어온다
    return xs


# 좋은 판 — 코어는 이름과 함수의 표만 안다
REGISTRY = {}

def register(name):
    def deco(fn):
        REGISTRY[name] = fn
        return fn
    return deco

def build(spec):
    stages = [REGISTRY[n] for n in spec.split("|")]
    def run(xs):
        for st in stages:          # 각 단계는 앞 단계의 출력만 본다
            xs = st(xs)
        return xs
    return run

@register("trim")
def trim(xs):
    return [max(x, 0) for x in xs]

@register("scale")
def scale(xs):
    return [x * 2 for x in xs]

@register("clip")                  # 나중에 온 단계. 코어는 한 줄도 안 바뀐다
def clip(xs):
    return [min(x, 10) for x in xs]


# 단계가 상태를 들면 합성 규칙이 깨진다
@register("movingavg")
def movingavg(xs, _prev=[0]):
    out = []
    for x in xs:
        out.append((x + _prev[0]) // 2)
        _prev[0] = x               # 이 줄 하나가 단계를 순수 함수가 아니게 만든다
    return out


print("하드코딩  : trim|scale ->", run_hardcoded("trim|scale", DATA))
print("하드코딩  : trim|scale|clip ->", run_hardcoded("trim|scale|clip", DATA))
print("레지스트리: trim|scale|clip ->", build("trim|scale|clip")(DATA))

pure = build("trim|scale|clip")
print("상태 없는 단계: 1회차", pure(DATA), "2회차", pure(DATA))

stateful = build("movingavg")
first = stateful([4, 8, 2, 6])
second = stateful([4, 8, 2, 6])
print("상태 있는 단계: 1회차", first, "2회차", second)
```
```cpp title="단계 조립 — 하드코딩·레지스트리·상태가 걸친 단계"
#include <algorithm>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>
using namespace std;

using Stage = function<vector<int>(vector<int>)>;
const vector<int> DATA = {1, 12, -4, 7};

vector<string> split(const string& s, char sep) {
    vector<string> out;
    size_t start = 0;
    while (true) {
        size_t p = s.find(sep, start);
        out.push_back(s.substr(start, p == string::npos ? string::npos : p - start));
        if (p == string::npos) break;
        start = p + 1;
    }
    return out;
}

string join(const optional<vector<int>>& v) {
    if (!v) return "None";
    string s = "[";
    for (size_t i = 0; i < v->size(); i++) s += (i ? ", " : "") + to_string((*v)[i]);
    return s + "]";
}

// 나쁜 판 — 코어가 단계 이름을 전부 알고 있다
optional<vector<int>> run_hardcoded(const string& spec, vector<int> xs) {
    for (const string& name : split(spec, '|')) {
        if (name == "trim")
            for (int& x : xs) x = max(x, 0);
        else if (name == "scale")
            for (int& x : xs) x = x * 2;
        else
            return nullopt;          // 새 단계는 이 함수를 고쳐야 들어온다
    }
    return xs;
}

// 좋은 판 — 코어는 이름과 함수의 표만 안다
map<string, Stage> REGISTRY;

void register_stage(const string& name, Stage fn) { REGISTRY[name] = fn; }

Stage build(const string& spec) {
    vector<Stage> stages;
    for (const string& n : split(spec, '|')) stages.push_back(REGISTRY.at(n));
    return [stages](vector<int> xs) {
        for (const Stage& st : stages) xs = st(xs);   // 각 단계는 앞 단계의 출력만 본다
        return xs;
    };
}

int main() {
    register_stage("trim", [](vector<int> xs) {
        for (int& x : xs) x = max(x, 0);
        return xs;
    });
    register_stage("scale", [](vector<int> xs) {
        for (int& x : xs) x = x * 2;
        return xs;
    });
    register_stage("clip", [](vector<int> xs) {       // 나중에 온 단계. 코어는 한 줄도 안 바뀐다
        for (int& x : xs) x = min(x, 10);
        return xs;
    });

    // 단계가 상태를 들면 합성 규칙이 깨진다
    auto prev = make_shared<int>(0);
    register_stage("movingavg", [prev](vector<int> xs) {
        vector<int> out;
        for (int x : xs) {
            out.push_back((x + *prev) / 2);
            *prev = x;                                // 이 줄 하나가 단계를 순수 함수가 아니게 만든다
        }
        return out;
    });

    cout << "하드코딩  : trim|scale -> " << join(run_hardcoded("trim|scale", DATA)) << "\n";
    cout << "하드코딩  : trim|scale|clip -> " << join(run_hardcoded("trim|scale|clip", DATA)) << "\n";
    cout << "레지스트리: trim|scale|clip -> " << join(build("trim|scale|clip")(DATA)) << "\n";

    Stage pure = build("trim|scale|clip");
    cout << "상태 없는 단계: 1회차 " << join(pure(DATA)) << " 2회차 " << join(pure(DATA)) << "\n";

    Stage stateful = build("movingavg");
    vector<int> first = stateful({4, 8, 2, 6});
    vector<int> second = stateful({4, 8, 2, 6});
    cout << "상태 있는 단계: 1회차 " << join(first) << " 2회차 " << join(second) << "\n";
    return 0;
}
```
:::

```console
하드코딩  : trim|scale -> [2, 24, 0, 14]
하드코딩  : trim|scale|clip -> None
레지스트리: trim|scale|clip -> [2, 10, 0, 10]
상태 없는 단계: 1회차 [2, 10, 0, 10] 2회차 [2, 10, 0, 10]
상태 있는 단계: 1회차 [2, 6, 5, 4] 2회차 [5, 6, 5, 4]
```

마지막 줄이 요점이다. **같은 파이프라인에 같은 입력을 두 번 흘렸는데 결과가 다르다.** `movingavg` 가 지난 호출의 마지막 값을 기억하기 때문이고, 그 순간 이 단계는 함수가 아니라 객체가 된다. 재현 불가능한 버그는 대개 이 자리에서 나온다.

**복잡도:** 조립은 단계 수 $S$ 에 대해 $O(S \log R)$ — 이름마다 표를 한 번 찾고, 표가 균형 트리면 조회가 $O(\log R)$이다($R$ = 등록된 단계 수). 실행은 원소 $N$ 개가 단계 $S$ 개를 지나므로 $O(S \cdot N)$이고, 이것은 하드코딩 판과 같다. **레지스트리가 무는 추가 비용은 조립 한 번뿐이고 실행 경로에는 없다.** 공간은 단계마다 중간 배열을 새로 만들 때 순간 최대 $O(N)$이며, 스트리밍으로 흘리면 $O(1)$까지 내려간다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 등록 시점 | 데코레이터가 **정의 지점에서** 자동 등록한다 | 명시적 호출이나 정적 초기화 객체가 필요하다 |
| 단계의 타입 | 아무 호출 가능 객체나 된다 | `std::function<...>` 으로 서명이 고정된다. 안 맞으면 컴파일이 안 된다 |
| 숨은 상태 | 가변 기본 인자 `_prev=[0]` — 파이썬의 유명한 함정이 여기서는 시연 도구다 | 람다가 `shared_ptr` 을 캡처한다. 캡처 목록에 드러나므로 조금 더 눈에 띈다 |
| 진짜 플러그인 | `importlib` 로 모듈을 실행 중에 읽어들인다 | `dlopen` 으로 공유 라이브러리를 연다. ABI 호환이 별도 문제가 된다 |

::: pitfall
- **레지스트리 키를 오타 낸다.** 하드코딩 판은 컴파일러가 잡아 주던 것을 문자열로 바꿨으므로 실패가 실행 시점으로 밀린다. 조립 직후 전체 이름을 한 번 검사해 **시작 시점에 죽게** 만들어라.
- **단계에 상태를 넣는다.** 위 출력이 그 결과다. 상태가 꼭 필요하면 단계 함수가 아니라 **상태를 인자로 받아 새 상태를 돌려주는 모양**으로 바꾼다.
- **플러그인 로딩 순서에 의존한다.** 등록 순서가 동작을 바꾸면 그것은 이미 파이프라인이 아니다.
- **파이프라인이 예외를 삼킨다.** 중간 단계가 실패했는데 다음 단계가 그대로 도는 구조는 원인 추적을 불가능하게 만든다.
:::

## 4. 이제 이름을 붙인다

**계층형 아키텍처 / Sense-Plan-Act.** 시스템을 감지·계획·구동 세 층으로 쌓고 데이터가 한 방향으로 흐르게 한다. 1980년대 로보틱스의 표준 구조였고, 지금도 데이터가 위에서 아래로만 흐르는 모든 계층형 설계가 같은 모양이다. 대가는 3.1에서 잰 그대로다 — **계층 수만큼의 지연.** 이 한계 때문에 Brooks 가 1986년에 subsumption architecture 를 내놓았고, 감지에서 구동으로 바로 가는 낮은 층이 필요할 때 위층을 억누른다는 발상이 거기서 나왔다. 오늘날의 실용적 답은 둘 중 하나를 고르는 것이 아니라 **계획 경로 옆에 반사 경로를 두는 것**이다. 긴급 정지는 계획을 통과하지 않는다.

**포트&어댑터 / 헥사고날.** 도메인이 필요한 것의 인터페이스(포트)를 **자기 안에** 선언하고, 바깥의 어댑터가 그 포트를 구현한다. 의존의 화살표는 언제나 안쪽을 향한다. [XII-2 Adapter](#/xii-2)가 클래스 하나를 다른 인터페이스에 맞추는 것이라면, 이것은 **시스템 전체를 그 원리로 세운 것**이다. 참여자는 도메인, 포트, 주도하는 어댑터(화면·API), 주도되는 어댑터(DB·장비)다. 얻는 것은 3.2의 출력 그대로 — 도메인이 바깥 없이 검증된다.

**플러그인 아키텍처.** 안정된 인터페이스 하나, 이름과 구현을 잇는 레지스트리, 그리고 등록을 일으키는 발견 절차(모듈 스캔·설정 파일·동적 로딩). [XII-5 Factory Method / Abstract Factory / Builder](#/xii-5)의 팩토리를 시스템 크기로 올린 것이고, 다른 점은 **구현이 코어와 함께 빌드되지 않아도 된다**는 것이다. 코어는 자기가 모르는 구현을 실행 중에 얻는다.

**파이프-필터.** 각 단계가 앞 단계의 출력만 보고 다음 단계에 넘긴다. 추론하기 쉬운 이유는 하나다 — **각 단계가 자기 입력의 함수이기 때문**이다. 그래서 단계를 따로 시험하고, 순서를 바꾸고, 병렬로 돌리고, 중간에 하나를 끼워 넣을 수 있다. 깨지는 지점도 하나다. **단계에 걸쳐 유지되어야 하는 상태가 생기면** 그 성질이 전부 사라진다. 3.3의 마지막 줄이 그 증거다.

**블랙보드.** 공유 저장소 하나를 두고 여러 전문가 모듈이 각자 읽고 쓴다. 제어 모듈이 현재 칠판 상태를 보고 다음에 누구를 부를지 정한다. 앞의 넷과 결정적으로 다른 점은 **실행 순서가 설계 시점에 정해지지 않는다**는 것이다. 음성 인식, 센서 융합, 진단 시스템처럼 "어떤 단서가 언제 나올지 모르는" 문제에서 나왔다.

::: warn
블랙보드는 정직하게 소개해야 하는 패턴이다. 모듈 사이의 직접 결합을 없앤 대신 **모두가 같은 자료구조에 결합된다.** 칠판의 한 필드를 바꾸면 누가 영향받는지 알 수 없고, 여러 모듈이 동시에 쓰면 그 자리가 [XII-13 동시성 패턴](#/xii-13)의 문제로 그대로 바뀐다. 누가 어느 필드의 주인인지를 문서가 아니라 **코드로 정하지 않으면** 이 구조는 몇 달 안에 [XII-15 안티패턴](#/xii-15)의 God Object 로 수렴한다. 순서를 정말 미리 못 정하는 문제에만 쓴다.
:::

## 5. 어디에 박혀 있는가

**셸 파이프라인이 파이프-필터의 원형이다.** `grep | sort | uniq -c` 가 그대로 3.3의 `trim|scale|clip` 이다. 각 프로그램이 표준 입력만 보고 표준 출력만 내기 때문에 조합이 무한히 늘어난다. 컴파일러의 단계 구성(어휘 분석 → 구문 분석 → 의미 분석 → 최적화 → 코드 생성)도 같고, 영상 처리 라이브러리의 필터 체인도 같다. 스트림 처리 프레임워크에서 상태 있는 연산자를 특별 취급하는 이유가 3.3의 마지막 줄이다 — 상태가 있는 순간 재시도·재생·병렬화가 전부 어려워진다.

**빌드 시스템의 플러그인 구조.** 확장은 이름과 함께 등록되고, 코어는 "이런 이름의 작업이 있으면 실행하라"만 안다. 웹 서버의 미들웨어, 에디터의 확장, 데이터베이스의 스토리지 엔진 교체가 전부 같은 모양이다. 코어를 다시 빌드하지 않고 기능을 붙일 수 있다는 성질 하나로 생태계가 생긴다.

**의존성 주입 프레임워크는 포트&어댑터를 자동화한 것이다.** 도메인이 인터페이스로 선언한 자리를 실행 시점에 구현으로 채워 준다. 프레임워크가 하는 일은 **조립뿐**이고, 그 조립을 손으로 해도 구조는 같다. 이 구조가 있는 코드베이스에서는 테스트가 실제 데이터베이스 없이 돌고, 없는 코드베이스에서는 테스트를 돌리려고 컨테이너를 띄운다.

**로봇 소프트웨어의 전역/지역 분리가 계층형이다.** 전역 계획은 초 단위로 경로를 다시 뽑고, 지역 계획은 수십 밀리초마다 속도 명령을 낸다. 위층이 느리게 똑똑하고 아래층이 빠르게 단순하다는 배치가 3.1에서 잰 지연 문제에 대한 답이다. 이 분업은 [V-12 지역 경로계획](#/v-12)에서 알고리즘 수준으로 다시 다룬다.

## 6. 언제 쓰지 말아야 하는가

**시스템이 작으면 전부 비용이다.** 300줄짜리 도구에 포트와 어댑터와 레지스트리를 넣으면, 무엇이 실제로 실행되는지 알아내려고 파일 다섯 개를 열어야 한다. 화살표를 정리해서 얻는 것은 **바꿀 일이 있을 때만** 값을 한다.

**계층은 지연을 만든다.** 3.1이 잰 것이 그것이고, 계층이 다섯이면 다섯 주기다. 마감이 빡빡한 경로에서는 계층을 접거나 반사 경로를 따로 내야 한다. 그리고 계층마다 자료 형식을 새로 정의하면 **같은 값을 세 번 복사하고 세 번 변환하는** 코드가 생긴다. 계층 경계는 의미가 실제로 바뀌는 자리에만 그어라.

**포트가 하나의 구현만 가질 때 헥사고날은 이름값만 한다.** 어댑터가 영원히 하나뿐이라면 그 인터페이스는 간접 계층 하나를 추가한 것 이상이 아니다. 판정 기준은 "여러 구현이 있는가"가 아니라 **"가짜 구현으로 시험할 이유가 있는가"**다. 그 이유가 있으면 구현이 하나여도 정당하고, 없으면 둘이어도 아깝다.

**플러그인은 진단을 어렵게 만든다.** 실행 중에 결정되는 것이 늘수록 "지금 무엇이 도는가"를 정적으로 알 수 없다. 오타 하나가 실행 시점 실패가 되고, 버전이 어긋난 플러그인은 코어를 조용히 오작동시킨다. 확장 지점은 **실제로 밖에서 확장될 것**에만 열어라.

**파이프-필터는 단계 간 상태가 있으면 맞지 않는다.** 그 상황에서 억지로 필터를 유지하려고 전역 변수나 숨은 캐시를 두는 것이 최악이다. 3.3의 출력이 그 결과이고, 그때 필요한 것은 파이프라인이 아니라 상태를 명시적으로 들고 다니는 다른 구조다.

## 연습

::: quiz
설계 질문이다. 답은 다이어그램 한 장과 잃는 것 한 줄로 쓴다.

**1. 결제 규칙과 세 가지 입구.** 주문 금액 계산 규칙이 있고, 이것을 웹 화면·모바일 API·야간 배치가 모두 쓴다. 지금은 세 곳에 각각 복사되어 있고 이미 한 번 어긋났다.
- 상황: 규칙이 입구마다 있다.
- 무엇이 변하고 무엇이 고정인가: 규칙은 고정이다. 변하는 것은 입구의 수와 종류다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 규칙을 안쪽으로 옮기고 입구를 어댑터로 만든다. 대가는 호출 경로가 한 단계 깊어지는 것과, 입구마다 다른 예외 처리를 어디에 둘지 새로 정해야 한다는 것이다.

**2. 영상 처리 체인.** 카메라 프레임에 보정·왜곡 제거·검출을 순서대로 건다. 검출기는 지난 프레임의 결과를 참고해 추적을 유지해야 한다.
- 상황: 앞 두 단계는 순수하고 마지막 단계는 아니다.
- 무엇이 변하고 무엇이 고정인가: 단계 순서는 고정이다. 변하는 것은 **어느 단계가 기억을 갖는가**다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 앞 둘은 필터로 두고 마지막은 상태를 명시적으로 주고받는 다른 모양으로 뺀다. 전부를 필터로 만들려는 시도가 3.3의 마지막 줄을 만든다.

**3. 진단 시스템.** 장비 이상의 원인을 찾는다. 전류 파형, 온도 이력, 정비 기록, 소음 스펙트럼을 각각 아는 모듈이 넷 있고, 어느 것이 결정적 단서를 줄지는 사건마다 다르다.
- 상황: 실행 순서를 설계 시점에 정할 수 없다.
- 무엇이 변하고 무엇이 고정인가: 전문가 모듈의 능력은 고정이다. 변하는 것은 호출 순서다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 공유 저장소와 중재자를 둔다. 대가는 모두가 그 저장소의 형식에 결합된다는 것이고, 필드마다 주인을 정해 두지 않으면 몇 달 뒤 아무도 못 고치는 자료구조가 된다.

**4. 되돌리는 판단.** 위 세 답 중 하나를 골라, 그 시스템의 규모가 10분의 1이라고 하자. 그래도 그 구조를 쓰겠는가. 쓰지 않겠다면 몇 명이 몇 달 동안 만질 때부터 값을 하기 시작하는가.
:::

## 요약

- 아키텍처 패턴은 클래스가 아니라 **모듈 사이의 화살표 방향**을 정하는 일이다. 잘못 그은 경계는 조직의 담당 범위가 되어 오래 남는다.
- **계층형(Sense-Plan-Act)** — 읽기·판단·구동을 가르면 판단이 장비 없이 검증된다. 대가는 계층 수만큼의 지연이고, 답은 계층을 없애는 것이 아니라 **반사 경로를 따로 내는 것**이다.
- **포트&어댑터** — 도메인이 인터페이스를 소유하고 바깥이 맞춘다. 의존의 화살표가 언제나 안쪽을 향한다. 판정 기준은 구현의 수가 아니라 **가짜 구현으로 시험할 이유가 있는가**다.
- **플러그인 아키텍처** — 안정된 인터페이스 + 레지스트리 + 발견. 팩토리를 시스템 크기로 올린 것이며, 대가는 오타가 실행 시점 실패가 되는 것이다.
- **파이프-필터** — 각 단계가 자기 입력의 함수이기 때문에 추론하기 쉽다. **단계에 상태가 붙는 순간 그 성질이 전부 사라진다.**
- **블랙보드** — 실행 순서를 미리 못 정할 때만 쓴다. 결합을 낮춘 대가로 공유 상태의 동기화와 소유권 문제를 얻는다.
- 다섯 모두 작은 시스템에서는 순수한 비용이다. **바꿀 일이 있을 때만 값을 한다.**

**다음 절**: [XII-15 안티패턴](#/xii-15) — 지금까지의 모든 패턴이 잘못 쓰였을 때 어떤 모양이 되는가.
