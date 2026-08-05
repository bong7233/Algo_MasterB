# XII-7 Observer / Publish-Subscribe

::: lead
"값이 하나 바뀌었다"는 사실을 여러 곳에 알려야 할 때, 알리는 쪽은 받는 쪽을 얼마나 알아야 하는가.
:::

## 1. 문제

창고 관제 시스템에서 로봇 수십 대가 1초에 한 번 배터리 잔량을 올린다. 처음 요구는 하나였다. 화면에 그린다.

```python title="첫 판 (조각) — 요구가 하나일 때"
def on_reading(robot, pct):
    display.show(robot, pct)
```

두 달 사이 요구가 셋 늘었다. 전부 정당한 요구다.

- 배터리 이력을 감사 로그에 남긴다. 사고가 나면 그 로그로 원인을 찾는다.
- 20% 미만이면 충전소에 배차를 건다.
- 임계치 미만이면 관리자에게 알림을 보낸다.

요구를 하나 받아들일 때마다 이 함수에 줄이 하나 붙고, 생성자에 인자가 하나 붙는다. 넉 달 뒤의 모습이다.

```python title="넉 달 뒤 (조각) — 요구가 넷일 때"
def on_reading(self, robot, pct):
    self.display.show(robot, pct)
    self.audit.write(robot, pct)
    self.alert.notify(robot, pct)
    if pct < 20:
        self.charger.request(robot)
```

다섯 줄이다. 짧고 읽힌다. **문제가 없어 보이는 것이 이 코드의 성질이다.** 무너진 것은 코드의 모양이 아니라 의존 방향이다.

```text nolines
                     ┌──▶ Display        <- 화면에 그린다
  BatteryMonitor ────┼──▶ AuditLog       <- 감사 로그
                     ├──▶ AlertService   <- 알림 발송
                     └──▶ Charger        <- 충전 배차
```

배터리 값을 읽는 일과 화면·로그·알림·충전 사이에는 아무 인과가 없다. 그런데 화살표는 전부 모니터에서 나간다. 이 방향이 세 가지를 앗아간다.

**첫째, 재사용이 막힌다.** 이 모니터를 다른 시스템에 들고 가려면 화면과 충전소와 알림 서버를 함께 들고 가야 한다. 배터리 잔량을 읽는 20줄이 인프라 넷에 묶여 있다.

**둘째, 테스트가 막힌다.** 모니터 하나를 세우려면 협력자 넷을 다 세워야 한다. "18%를 넣으면 충전 배차가 걸리는가"라는 한 줄짜리 검사를 하려고 가짜 화면과 가짜 알림 서버를 만든다. 이 마찰이 쌓이면 테스트를 안 쓰게 된다.

**셋째, 고장이 전파된다.** 네 호출이 한 함수 안에 줄지어 있으므로 앞의 하나가 예외를 던지면 뒤는 실행되지 않는다. ==알림 서버가 죽으면 충전 배차가 걸리지 않는다.== 로봇은 바닥에서 배터리가 나가 멈춘다. 알림과 충전 사이에는 아무 관계가 없는데, 코드가 둘을 한 함수에 꿰어 놓았다는 이유만으로 하나가 다른 하나를 죽인다.

앞의 둘은 설계 취향 문제로 보일 수 있다. 셋째는 아니다. **셋째는 장애다.** §3.1에서 실제로 돌려 본다.

## 2. 무엇이 달라져야 하는가

가르는 선은 하나다.

- **변하지 않는 것:** "로봇 R3의 배터리가 18%로 갱신되었다"는 사실.
- **변하는 것:** 그 사실로 무엇을 하는가. 그리고 **받는 쪽의 목록**.

지금 코드는 이 둘을 한 함수에 섞어 두었다. 사실을 만드는 코드가 목록도 들고 있다. 목록은 요구가 들어올 때마다 바뀌는 쪽인데, 그것이 바뀌지 않는 쪽의 파일에 박혀 있다.

### 2.1 화살표를 뒤집는다

생산자가 소비자를 아는 대신, **소비자가 생산자에 등록한다.** 생산자가 아는 것은 "호출 가능한 것들의 목록" 하나로 줄어든다. 목록에 무엇이 들었는지, 그것이 화면인지 충전소인지는 알지 못하고 알 필요도 없다.

이 한 번의 반전이 §1의 셋을 전부 되돌린다. 모니터는 협력자 없이 만들어지고(테스트가 된다), 다른 시스템에 그대로 옮겨지고(재사용이 된다), 통지 루프가 예외를 하나씩 격리하면 한 소비자의 죽음이 다음 소비자에게 가지 않는다(고장이 갇힌다). 새 요구는 생산자 바깥에서 **등록 한 줄**로 끝난다.

### 2.2 목록마저 떼어 낸다 — 수명의 문제

여기서 멈추면 남는 결합이 하나 있다. 등록하려면 소비자가 생산자 객체를 손에 쥐어야 한다. `monitor.subscribe(...)`를 부르려면 `monitor`라는 변수가 그 자리에 있어야 한다. 이 전제가 깨지는 자리가 실제 시스템에 늘 있다.

- **생산자가 아직 없다.** 관제 화면은 떠 있는데 로봇은 아직 접속하지 않았다.
- **생산자가 이미 죽었다.** R3이 정비로 빠지고 R7이 들어온다. 화면은 교체를 알아채면 안 된다.
- **생산자가 다른 프로세스에 있다.** 참조라는 것 자체가 성립하지 않는다.

셋의 공통점은 하나다. ==생산자와 소비자의 수명이 서로 다르다.== 객체 참조로 붙이면 짧은 쪽의 수명이 긴 쪽을 지배한다.

그래서 한 걸음 더 간다. 중간에 **이름표만 아는 제3자**를 세운다. 생산자는 "이 이름으로 값을 낸다"고 하고, 소비자는 "이 이름의 값을 받겠다"고 한다. 양쪽 다 제3자만 알고 서로는 영영 모른다.

```text nolines
  A)  Producer ──▶ [ callback list ] ◀── Consumer      <- 소비자가 생산자를 쥔다
  B)  Producer ──▶ [ broker: "battery" ] ◀── Consumer  <- 양쪽 다 이름만 안다
```

A와 B는 같은 것의 두 단계가 아니다. **다른 구조다.** A에서는 등록하는 순간 두 객체가 서로를 알고, B에서는 끝까지 모른다. 그 차이가 §4에서 이름이 갈리는 지점이다.

## 3. 구현

### 3.1 지금 있는 코드 — 하나가 죽으면 뒤가 죽는다

::: dual
```python title="직접 호출 — 알림 서버가 죽었을 때"
class Display:
    def show(self, robot, pct):
        print(f"[화면] {robot} {pct}%")


class AuditLog:
    def write(self, robot, pct):
        print(f"[감사] {robot} {pct}%")


class AlertService:
    def notify(self, robot, pct):
        raise RuntimeError("알림 서버 응답 없음")


class Charger:
    def __init__(self):
        self.dispatched = False

    def request(self, robot):
        self.dispatched = True
        print(f"[충전] {robot} 충전소 배차")


class BatteryMonitor:
    # ❌ 소비자 네 종류를 전부 알고 있다. 요구가 늘 때마다 이 클래스가 자란다.
    def __init__(self, display, audit, alert, charger):
        self.display = display
        self.audit = audit
        self.alert = alert
        self.charger = charger

    def on_reading(self, robot, pct):
        self.display.show(robot, pct)
        self.audit.write(robot, pct)
        self.alert.notify(robot, pct)   # 알림 요구로 끼워 넣은 한 줄
        if pct < 20:
            self.charger.request(robot)


display, audit, alert = Display(), AuditLog(), AlertService()
charger = Charger()
monitor = BatteryMonitor(display, audit, alert, charger)
try:
    monitor.on_reading("R3", 18)
except RuntimeError as e:
    print(f"[예외] {e}")
print("충전 배차:", "완료" if charger.dispatched else "안 됨")
```
```cpp title="직접 호출 — 알림 서버가 죽었을 때"
#include <iostream>
#include <stdexcept>
#include <string>
using namespace std;

struct Display {
    void show(const string& robot, int pct) {
        cout << "[화면] " << robot << " " << pct << "%\n";
    }
};

struct AuditLog {
    void write(const string& robot, int pct) {
        cout << "[감사] " << robot << " " << pct << "%\n";
    }
};

struct AlertService {
    void notify(const string& robot, int pct) {
        (void)robot; (void)pct;
        throw runtime_error("알림 서버 응답 없음");
    }
};

struct Charger {
    bool dispatched = false;
    void request(const string& robot) {
        dispatched = true;
        cout << "[충전] " << robot << " 충전소 배차\n";
    }
};

struct BatteryMonitor {
    // ❌ 소비자 네 종류를 전부 알고 있다. 요구가 늘 때마다 이 클래스가 자란다.
    Display& display;
    AuditLog& audit;
    AlertService& alert;
    Charger& charger;

    BatteryMonitor(Display& d, AuditLog& au, AlertService& al, Charger& c)
        : display(d), audit(au), alert(al), charger(c) {}

    void on_reading(const string& robot, int pct) {
        display.show(robot, pct);
        audit.write(robot, pct);
        alert.notify(robot, pct);       // 알림 요구로 끼워 넣은 한 줄
        if (pct < 20) charger.request(robot);
    }
};

int main() {
    Display display; AuditLog audit; AlertService alert;
    Charger charger;
    BatteryMonitor monitor(display, audit, alert, charger);
    try {
        monitor.on_reading("R3", 18);
    } catch (const runtime_error& e) {
        cout << "[예외] " << e.what() << "\n";
    }
    cout << "충전 배차: " << (charger.dispatched ? "완료" : "안 됨") << "\n";
}
```
:::

```console
[화면] R3 18%
[감사] R3 18%
[예외] 알림 서버 응답 없음
충전 배차: 안 됨
```

**복잡도:** 통지 시간 $O(1)$ — 소비자 수가 소스에 박혀 있어 호출 횟수가 컴파일 시점에 정해진다. 공간 $O(1)$. 이 코드의 진짜 비용은 복잡도가 아니라 **수정 비용**이다. 소비자가 하나 늘면 생성자와 통지 함수 두 곳을 고쳐야 하고, 그 둘은 배터리와 아무 상관 없는 요구 때문에 열린다.

마지막 줄이 §1의 셋째다. **알림 서버 하나가 충전 배차를 죽였다.** 이 사고는 코드 리뷰에서 잘 잡히지 않는다. 다섯 줄 어디에도 이상한 곳이 없기 때문이다.

### 3.2 목록으로 바꾼다

::: dual
```python title="목록 통지 — 요구가 하나 더 들어왔을 때"
class BatteryMonitor:
    # ✅ 소비자를 하나도 모른다. 요구가 늘어도 이 클래스는 자라지 않는다.
    def __init__(self):
        self.subs = {}
        self.next_token = 0

    def subscribe(self, fn):
        self.next_token += 1
        self.subs[self.next_token] = fn
        return self.next_token          # 해제 손잡이를 반드시 돌려준다

    def unsubscribe(self, token):
        self.subs.pop(token, None)

    def on_reading(self, robot, pct):
        for token, fn in list(self.subs.items()):   # 사본 순회 — 재진입 방어
            try:
                fn(robot, pct)
            except Exception as e:                  # 한 구독자의 실패를 격리한다
                print(f"[격리] 구독자 {token} 예외: {e}")


def show(robot, pct):
    print(f"[화면] {robot} {pct}%")


def audit(robot, pct):
    print(f"[감사] {robot} {pct}%")


def alert(robot, pct):
    raise RuntimeError("알림 서버 응답 없음")


class Charger:
    def __init__(self):
        self.dispatched = False

    def on_reading(self, robot, pct):
        if pct < 20:
            self.dispatched = True
            print(f"[충전] {robot} 충전소 배차")


charger = Charger()
monitor = BatteryMonitor()
monitor.subscribe(show)
monitor.subscribe(audit)
monitor.subscribe(alert)

print("-- 충전 배차 요구가 들어오기 전")
monitor.on_reading("R3", 18)
print("충전 배차:", "완료" if charger.dispatched else "안 됨")

token = monitor.subscribe(charger.on_reading)   # 모니터 코드 수정 0줄
print("-- 충전 배차 요구가 들어온 뒤")
monitor.on_reading("R3", 18)
print("충전 배차:", "완료" if charger.dispatched else "안 됨")

monitor.unsubscribe(token)
print("해제 후 구독자 수:", len(monitor.subs))
```
```cpp title="목록 통지 — 요구가 하나 더 들어왔을 때"
#include <exception>
#include <functional>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
using namespace std;

struct BatteryMonitor {
    // ✅ 소비자를 하나도 모른다. 요구가 늘어도 이 클래스는 자라지 않는다.
    using Fn = function<void(const string&, int)>;
    map<int, Fn> subs;
    int next_token = 0;

    int subscribe(Fn fn) {
        next_token += 1;
        subs[next_token] = move(fn);
        return next_token;              // 해제 손잡이를 반드시 돌려준다
    }

    void unsubscribe(int token) {
        subs.erase(token);
    }

    void on_reading(const string& robot, int pct) {
        map<int, Fn> snapshot = subs;               // 사본 순회 — 재진입 방어
        for (auto& [token, fn] : snapshot) {
            try {
                fn(robot, pct);
            } catch (const exception& e) {           // 한 구독자의 실패를 격리한다
                cout << "[격리] 구독자 " << token << " 예외: " << e.what() << "\n";
            }
        }
    }
};

void show(const string& robot, int pct) {
    cout << "[화면] " << robot << " " << pct << "%\n";
}

void audit(const string& robot, int pct) {
    cout << "[감사] " << robot << " " << pct << "%\n";
}

void alert(const string& robot, int pct) {
    (void)robot; (void)pct;
    throw runtime_error("알림 서버 응답 없음");
}

struct Charger {
    bool dispatched = false;

    void on_reading(const string& robot, int pct) {
        if (pct < 20) {
            dispatched = true;
            cout << "[충전] " << robot << " 충전소 배차\n";
        }
    }
};

int main() {
    Charger charger;
    BatteryMonitor monitor;
    monitor.subscribe(show);
    monitor.subscribe(audit);
    monitor.subscribe(alert);

    cout << "-- 충전 배차 요구가 들어오기 전\n";
    monitor.on_reading("R3", 18);
    cout << "충전 배차: " << (charger.dispatched ? "완료" : "안 됨") << "\n";

    int token = monitor.subscribe(              // 모니터 코드 수정 0줄
        [&charger](const string& r, int p) { charger.on_reading(r, p); });
    cout << "-- 충전 배차 요구가 들어온 뒤\n";
    monitor.on_reading("R3", 18);
    cout << "충전 배차: " << (charger.dispatched ? "완료" : "안 됨") << "\n";

    monitor.unsubscribe(token);
    cout << "해제 후 구독자 수: " << monitor.subs.size() << "\n";
}
```
:::

```console
-- 충전 배차 요구가 들어오기 전
[화면] R3 18%
[감사] R3 18%
[격리] 구독자 3 예외: 알림 서버 응답 없음
충전 배차: 안 됨
-- 충전 배차 요구가 들어온 뒤
[화면] R3 18%
[감사] R3 18%
[격리] 구독자 3 예외: 알림 서버 응답 없음
[충전] R3 충전소 배차
충전 배차: 완료
```

**복잡도:** 통지 시간 $O(k)$ — 등록된 수신자 $k$개를 한 번씩 부른다. 등록·해제는 사전 연산 한 번이라 $O(1)$. 공간 $O(k)$. 상수를 말해 두면, 동기 통지는 $k$개를 **생산자의 스레드가 차례로** 실행한다. 하나가 10밀리초를 쓰면 통지 전체가 10밀리초 늘고 그만큼 다음 센서 값을 읽는 주기가 밀린다. 이 지점의 처방은 [XI-7 이벤트 루프와 백프레셔](#/xi-7)에 있다.

두 판의 차이는 출력 두 줄이 아니다.

- **충전 배차 요구를 추가하면서 `BatteryMonitor`를 한 글자도 고치지 않았다.** 고친 곳은 등록 한 줄뿐이고 그 줄은 모니터 밖에 있다.
- 알림이 여전히 실패하는데 충전 배차는 걸렸다. **고장이 한 구독자 안에 갇혔다.**
- 모니터를 인자 없이 만들 수 있다. 협력자 넷 없이 `on_reading`을 검사할 수 있다는 뜻이다.

::: warn
예외 격리는 공짜가 아니다. 삼킨 예외는 조용히 사라진다. 격리 로그를 남기지 않으면 알림이 두 달째 실패하고 있어도 아무도 모른다. **격리는 로그·지표와 한 몸이어야 한다.**
:::

### 3.3 중간에 제3자를 둔다

목록 방식이 못 하는 것은 §2.2의 셋이다. 발행자가 없는 시점의 구독, 발행자 교체, 프로세스 횡단. 중개자를 넣으면 셋이 한꺼번에 풀린다.

::: dual
```python title="중개자 — 수명이 갈라진다"
class Reading:
    def __init__(self, name, pct):
        self.name, self.pct = name, pct


class Broker:
    # 발행자도 구독자도 여기만 안다. 서로는 영영 모른다.
    def __init__(self):
        self.topics = {}
        self.next_token = 0

    def subscribe(self, topic, fn):
        self.next_token += 1
        self.topics.setdefault(topic, {})[self.next_token] = fn
        return self.next_token

    def unsubscribe(self, topic, token):
        self.topics.get(topic, {}).pop(token, None)

    def publish(self, topic, msg):
        for token, fn in list(self.topics.get(topic, {}).items()):
            fn(msg)


class RobotAgent:
    # 발행자. 자기가 만든 값을 누가 받는지 알지 못한다.
    def __init__(self, broker, name):
        self.broker, self.name = broker, name

    def report(self, pct):
        self.broker.publish("battery", Reading(self.name, pct))


class Dashboard:
    def __init__(self):
        self.received = 0

    def on_battery(self, msg):
        self.received += 1
        print(f"[집계] {msg.name} {msg.pct}%")


broker = Broker()

# 1) 발행자가 하나도 없는 시점에 이미 구독할 수 있다
broker.subscribe("battery", lambda m: print(f"[화면] {m.name} {m.pct}%"))
print("발행자 0개 상태에서 구독 완료")

# 2) 발행자가 생겼다가 사라진다
agent = RobotAgent(broker, "R3")
agent.report(18)
del agent
print("발행자 R3 소멸")

# 3) 지각 구독자는 그 앞의 발행을 받지 못한다
dashboard = Dashboard()
broker.subscribe("battery", dashboard.on_battery)
print("지각 구독자 등록")

# 4) 다른 발행자가 같은 토픽에 발행한다. 구독자는 교체를 알아채지 못한다
agent = RobotAgent(broker, "R7")
agent.report(42)

print("총 발행 2건 중 지각 구독자 수신:", dashboard.received, "건")
print("브로커가 아는 토픽 수:", len(broker.topics))
```
```cpp title="중개자 — 수명이 갈라진다"
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <string>
using namespace std;

struct Reading {
    string name;
    int pct;
    Reading(string n, int p) : name(move(n)), pct(p) {}
};

struct Broker {
    // 발행자도 구독자도 여기만 안다. 서로는 영영 모른다.
    using Fn = function<void(const Reading&)>;
    map<string, map<int, Fn>> topics;
    int next_token = 0;

    int subscribe(const string& topic, Fn fn) {
        next_token += 1;
        topics[topic][next_token] = move(fn);
        return next_token;
    }

    void unsubscribe(const string& topic, int token) {
        auto it = topics.find(topic);
        if (it != topics.end()) it->second.erase(token);
    }

    void publish(const string& topic, const Reading& msg) {
        auto it = topics.find(topic);
        if (it == topics.end()) return;
        map<int, Fn> snapshot = it->second;
        for (auto& [token, fn] : snapshot) fn(msg);
    }
};

struct RobotAgent {
    // 발행자. 자기가 만든 값을 누가 받는지 알지 못한다.
    Broker& broker;
    string name;
    RobotAgent(Broker& b, string n) : broker(b), name(move(n)) {}

    void report(int pct) {
        broker.publish("battery", Reading(name, pct));
    }
};

struct Dashboard {
    int received = 0;

    void on_battery(const Reading& msg) {
        received += 1;
        cout << "[집계] " << msg.name << " " << msg.pct << "%\n";
    }
};

int main() {
    Broker broker;

    // 1) 발행자가 하나도 없는 시점에 이미 구독할 수 있다
    broker.subscribe("battery",
                     [](const Reading& m) { cout << "[화면] " << m.name << " " << m.pct << "%\n"; });
    cout << "발행자 0개 상태에서 구독 완료\n";

    // 2) 발행자가 생겼다가 사라진다
    auto agent = make_unique<RobotAgent>(broker, "R3");
    agent->report(18);
    agent.reset();
    cout << "발행자 R3 소멸\n";

    // 3) 지각 구독자는 그 앞의 발행을 받지 못한다
    Dashboard dashboard;
    broker.subscribe("battery", [&dashboard](const Reading& m) { dashboard.on_battery(m); });
    cout << "지각 구독자 등록\n";

    // 4) 다른 발행자가 같은 토픽에 발행한다. 구독자는 교체를 알아채지 못한다
    agent = make_unique<RobotAgent>(broker, "R7");
    agent->report(42);

    cout << "총 발행 2건 중 지각 구독자 수신: " << dashboard.received << " 건\n";
    cout << "브로커가 아는 토픽 수: " << broker.topics.size() << "\n";
}
```
:::

```console
발행자 0개 상태에서 구독 완료
[화면] R3 18%
발행자 R3 소멸
지각 구독자 등록
[화면] R7 42%
[집계] R7 42%
총 발행 2건 중 지각 구독자 수신: 1 건
브로커가 아는 토픽 수: 1
```

**복잡도:** 발행 시간 $O(\log T + k)$ — 토픽 이름으로 목록을 찾는 데 C++ `std::map` 기준 $O(\log T)$($T$는 토픽 수), 그 목록의 수신자 $k$개를 부르는 데 $O(k)$. Python `dict`는 해시라 평균 $O(1) + O(k)$다. 공간 $O(T + \sum k)$ — 토픽별 목록의 총합.

출력 네 줄이 §2.2의 셋을 그대로 증명한다. 발행자가 0개일 때 구독이 성립했고, R3이 소멸한 뒤에도 구독이 살아 있었고, R7으로 바뀐 것을 화면은 알아채지 못했다. **어느 쪽도 상대의 참조를 한 번도 쥐지 않았다.**

다섯째 줄도 중요하다. 지각 구독자는 총 발행 2건 중 1건만 받았다. 이것이 이 구조의 기본 성질이다 — 구독은 **그 시점 이후**에만 유효하다. 실제 시스템이 "마지막 값 보존(retained)"이나 "오프셋부터 재생"을 옵션으로 파는 이유가 이 한 줄이다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 페이로드 타입 | 토픽마다 아무 객체나 실린다. 브로커는 타입을 모른다 | 브로커가 페이로드 타입을 하나로 고정해야 한다. 섞으려면 `std::any`나 직렬화로 타입을 지워야 한다 |
| 콜백 타입 | 호출 가능하면 전부 된다. 함수·람다·바운드 메서드·`__call__` 객체 | `std::function<void(const Reading&)>` 한 종류로 감싼다. 힙 할당이 붙을 수 있다 |
| 소비자 수명 | 목록이 콜백을 참조하므로 GC 대상에서 빠진다. 해제하지 않으면 샌다 | 같은 문제 + 캡처한 참조가 먼저 죽으면 **댕글링**이다. 예외가 아니라 정의되지 않은 동작으로 나타난다 |
| 발행자 소멸 | `del`은 참조를 지울 뿐이고 실제 소멸 시점은 참조 수에 달렸다 | 스코프·`unique_ptr::reset` 시점에 소멸자가 확정적으로 돈다 |

## 3.4 콜백 지옥의 정체

이 구조로 옮기면 §1의 문제는 사라지고 새 문제가 셋 생긴다. 전부 실제로 나는 버그다.

**첫째, 해제하지 않으면 샌다.** 등록은 생산자가 소비자를 붙드는 참조를 만든다. 화면 하나가 닫혀도 그 콜백이 목록에 남아 있으면 화면 객체 전체가 살아 있고, 1초에 한 번 도는 통지가 죽은 화면을 계속 그린다. 처방은 규율이다.

- **`subscribe`는 반드시 해제 손잡이를 돌려준다.** §3.2의 `token`이 그것이다. 손잡이를 안 주는 API는 해제를 잊게 만든다. 익명 람다로 등록해 놓고 나중에 "같은 함수를 다시 넘겨서 해제하라"는 API가 최악이다 — 같은 람다를 다시 만들 방법이 없다.
- **구독 수명을 객체 수명에 묶는다.** C++이면 소멸자에서 해제하는 구독 핸들(RAII), Python이면 `with` 블록이나 `weakref`다.
- **구독자 수를 지표로 내보낸다.** 이 수가 단조 증가하면 그것이 누수다. 코드를 읽어서는 못 찾고 그래프에서는 한눈에 보인다.

**둘째, 통지 중에 목록을 건드리면 부서진다.** 수신자가 통지를 받은 자리에서 자기를 해제하거나 새로 등록하면, 지금 돌고 있는 순회가 자기 발밑을 바꾼다.

```python title="사본 없이 순회하면 (조각)"
for token, fn in self.subs.items():   # ❌ 사본이 아니다
    fn(robot, pct)                    #    이 안에서 unsubscribe 가 불리면
```

```console
RuntimeError: dictionary changed size during iteration
```

::: danger
Python은 그 자리에서 예외를 던진다. **C++은 던지지 않는다.** `std::map`은 지운 원소의 반복자만 무효화하지만 그 무효화된 반복자를 증가시키는 순간이 정의되지 않은 동작이고, 목록이 `std::vector`라면 재할당으로 전부 무효화된다. 대개는 그냥 통과하다가 전혀 다른 곳에서 터진다. ==시끄럽게 죽는 쪽이 여기서는 이점이다.== §3.2와 §3.3이 사본을 만들고 도는 이유가 이것이다.

사본을 도는 것은 정책 선택이기도 하다. **통지 도중에 등록한 수신자는 이번 통지를 받지 못한다.** 이 규칙을 문서에 적어라. 적지 않으면 사람마다 다르게 가정하고, 그 차이는 재현되지 않는 버그로 나온다.
:::

**셋째, 순서에 기대면 무너진다.** 목록은 등록 순서를 기억하므로 "감사 로그가 먼저 찍히고 화면이 나중"이 우연히 성립한다. 그 우연에 기대는 코드가 반드시 생긴다. 그런데 등록 순서는 초기화 순서이고, 초기화 순서는 리팩터링 한 번에 바뀐다. 중개자를 쓰면 보장은 더 약해진다 — 실무의 브로커는 대개 **같은 토픽 안에서만** 순서를 지키고 토픽 사이에는 아무 보장이 없다.

수신자끼리 순서 의존이 있다면 그것은 수신자 두 개가 아니라 **파이프라인 한 개**다. 하나로 합치거나, 앞 단계가 끝난 뒤 다음 이름으로 다시 발행해 단계를 코드에 드러내라.

## 4. 이제 이름을 붙인다

§3.2가 **Observer**다. 참여자는 넷이고, 이름과 코드의 대응은 이렇다.

| 참여자 | §3.2의 대응 | 하는 일 |
|---|---|---|
| Subject | `BatteryMonitor` | 등록·해제·통지를 제공한다. 관찰자 목록을 소유한다 |
| Observer | 콜백의 형태(`fn(robot, pct)`) | 통지를 받는 쪽이 만족해야 할 모양 |
| ConcreteObserver | `show`, `audit`, `charger.on_reading` | 받은 값으로 자기 일을 한다 |
| Client | `main` | 누가 무엇을 구독할지 결정한다. **이 결정만 여기 있다** |

§3.3이 **Publish-Subscribe**다. 둘을 같은 것으로 소개하는 자료가 많은데, 차이는 하나로 요약된다. ==주체가 수신자를 직접 들고 있는가.==

| | Observer | Publish-Subscribe |
|---|---|---|
| 참조 | 주체가 관찰자 목록을 소유한다. 등록하려면 관찰자가 주체를 손에 쥐어야 한다 | 양쪽 다 브로커만 안다. 서로의 참조를 한 번도 쥐지 않는다 |
| 붙이는 열쇠 | 객체 참조 | 토픽 이름 |
| 수명 | 주체가 없으면 등록도 없다. 주체가 죽으면 통지도 끝난다 | **끊긴다.** 발행자가 생기기 전에 구독할 수 있고, 발행자가 죽어도 구독은 남는다 |
| 실행 | 대개 동기. 주체의 스레드가 관찰자를 부른다 | 대개 비동기. 브로커가 큐를 사이에 둔다 |
| 경계 | 한 프로세스 안 | 프로세스·기계를 넘는다 |
| 대가 | 목록 하나. 거의 없다 | 브로커 자체. 큐, 유실·중복 정책, 순서 정책, 운영 |

**수명 분리가 브로커가 존재하는 이유의 전부다.** 비동기도, 프로세스 횡단도, 재생 기능도 수명이 끊긴 뒤에 따라온 결과다. 브로커를 "성능을 위해 넣는 것"으로 이해하면 방향이 반대가 된다.

토픽 기반 메시징 시스템의 정체가 정확히 이것이다. §3.3의 `subscribe`·`unsubscribe`·`publish` 세 메서드가 뼈대이고, 제품은 그 위에 셋을 얹는다. **통지를 함수 호출이 아니라 큐에 넣기**, **페이로드를 객체가 아니라 바이트열로 직렬화하기**, **유실·중복·순서에 대한 정책 정하기**. 세 번째가 얹히는 순간 프로세스와 기계를 넘어가고, 그 대가로 "정확히 한 번 배달"이라는 어려운 문제가 따라 들어온다.

::: note
통지가 값을 실어 보내는가(push), 아니면 "바뀌었다"만 알리고 수신자가 되물어 가는가(pull). §3은 전부 push다. pull은 페이로드를 안 만들어도 되지만 수신자가 주체를 다시 참조해야 하므로 §2.2의 수명 문제가 되살아난다. **중개자를 쓸 때 pull은 성립하지 않는다.** 되물을 상대가 없기 때문이다.
:::

## 5. 어디에 박혀 있는가

**GUI 이벤트 등록이 그대로 §3.2다.** 버튼에 클릭 처리기를 붙이는 것이 등록이고, 창을 닫을 때 떼는 것이 해제다. 브라우저의 `removeEventListener`가 "등록할 때와 같은 함수 객체"를 요구하는 설계가 §3.4의 첫 번째 함정을 대량 생산한다. 익명 함수로 등록하면 뗄 방법이 사라진다.

**메시지 브로커의 토픽 구독이 §3.3이다.** 여기서 값을 하는 지점은 처리량이 아니라 **배포**다. 새 구독자를 붙이거나 떼는 데 발행자를 재배포하지 않는다. 발행자와 구독자가 서로 다른 팀 소유일 때 이 성질이 조직 경계를 그대로 코드 경계로 만든다.

**로봇 미들웨어의 토픽도 같은 구조다.** 센서 노드가 값을 발행하고 여러 노드가 구독한다. 노드가 프로세스 단위로 죽고 살아나는 환경이라 §2.2의 수명 문제가 상시로 일어나고, 그래서 중개 구조가 기본값이다.

**데이터베이스의 변경 데이터 캡처(CDC)가 §1을 §3.3으로 바꾼 사례다.** 애플리케이션이 저장 직후에 캐시 무효화·검색 색인 갱신·알림을 차례로 부르는 코드는 §1의 `on_reading`과 정확히 같은 모양이고, 같은 방식으로 썩는다. CDC는 "행이 바뀌었다"는 사실만 로그로 발행하고 나머지를 전부 구독자로 밀어낸다.

**언어에 내장된 형태도 있다.** C#의 `event`, Qt의 시그널·슬롯이 등록·해제·통지를 문법으로 제공한다. 언어가 흡수하면 패턴은 이름을 잃고 기능이 된다 — 그것이 패턴의 정상적인 최후다.

## 6. 언제 쓰지 말아야 하는가

**수신자가 하나뿐이고 늘 계획이 없을 때.** 얻는 것은 목록 하나이고 잃는 것은 직접 호출이다. 함수 하나 부르면 될 자리를 등록·해제·통지 세 메서드로 감싸면, 읽는 사람은 "이 값이 어디로 가는가"를 알기 위해 등록하는 곳을 전부 찾아야 한다. 구현체가 하나뿐인데 인터페이스를 뽑는 것과 같은 낭비다.

**흐름을 읽어야 하는 코드.** 이 패턴의 대가는 정확히 하나다. ==호출 스택이 끊긴다.== 직접 호출은 스택 트레이스가 원인부터 결과까지 한 줄로 이어지지만, 통지는 "누가 이걸 등록했는가"가 스택 어디에도 없다. 디버거로 거슬러 올라가면 통지 루프에서 끝난다. 이벤트 버스 하나에 시스템 전체를 실으면 결합이 사라지는 것이 아니라 **코드에서 보이지 않는 곳으로 옮겨 간다.** [XII-15 안티패턴](#/xii-15)에서 다시 다룬다.

**순서와 원자성이 요구일 때.** "A 다음에 B, 둘 중 하나가 실패하면 전부 되돌린다"는 통지로 표현되지 않는다. 그것은 알림이 아니라 명령이고 트랜잭션이다. 그쪽은 [XII-9 Command](#/xii-9)의 영역이다.

**동기 통지에 무거운 일을 실을 때.** 생산자의 스레드가 수신자 전부를 차례로 실행한다는 사실을 잊으면, 1초 주기 루프에 300밀리초짜리 네트워크 호출이 조용히 끼어든다. 큐를 사이에 두는 것이 처방인데, 큐를 두는 순간 **경계 없는 큐**라는 더 큰 문제가 생긴다. 소비자가 느리면 큐가 무한히 자라고 메모리가 먼저 죽는다. 이것이 대규모 발행-구독 시스템이 실제로 무너지는 첫 번째 경로이고, 처방은 [XI-7 이벤트 루프와 백프레셔](#/xi-7)에 있다.

## 연습

::: quiz
**1. 로그 수집 파이프라인**
- 상황: 애플리케이션이 로그를 파일에 쓰고, 별도 수집기가 그것을 읽어 여러 저장소로 보낸다. 이제 "특정 오류 로그는 즉시 알림"이라는 요구가 들어왔다.
- 무엇이 변하고 무엇이 고정인가: "로그 한 줄이 생성되었다"는 사실이 고정이고, 그것을 받는 쪽의 목록과 각자의 처리가 변한다. 알림은 저장소와 다른 속도로 동작한다.
- 어떤 구조이고 무엇을 대가로 치르는가: 수집기와 처리기 사이를 중개자로 끊는다. 대가는 유실 정책이다 — 알림 처리기가 죽어 있는 동안의 로그를 재생할 것인지, 버릴 것인지를 **먼저** 정해야 한다. 정하지 않으면 장애 때 결정된다.

**2. 편집기의 문서 모델**
- 상황: 문서 객체 하나를 미니맵·개요 창·상태 표시줄이 함께 본다. 문서가 바뀌면 셋이 갱신되어야 한다. 창은 열리고 닫힌다.
- 무엇이 변하고 무엇이 고정인가: "문서가 바뀌었다"가 고정, 보는 쪽의 수가 변한다. 문서와 창은 같은 프로세스에 있고 문서가 창보다 오래 산다.
- 어떤 구조이고 무엇을 대가로 치르는가: 브로커는 과잉이다. 수명이 이미 정렬되어 있고 프로세스를 넘지 않는다. 목록 방식으로 충분하고, 대가는 창을 닫을 때의 해제 규율 하나다. 그것을 놓치면 닫은 창이 메모리에 남아 계속 갱신된다.

**3. 결제 완료 이후**
- 상황: 결제가 끝나면 재고 차감, 영수증 발송, 적립금 반영이 일어난다. 셋 다 "결제 완료"에 반응한다.
- 무엇이 변하고 무엇이 고정인가: 겉보기에는 반응하는 쪽의 목록이 변하는 것 같다. 그러나 재고 차감은 실패하면 결제도 무효여야 한다.
- 어떤 구조이고 무엇을 대가로 치르는가: **재고 차감은 구독자가 아니다.** 결제와 원자적으로 묶여야 하는 같은 트랜잭션이다. 영수증과 적립금만 통지로 뺀다. 요구를 "반응하는 것"으로 뭉뚱그리면 이 선이 지워지고, 그 순간 돈이 맞지 않기 시작한다.
:::

## 요약

- 생산자가 소비자를 직접 부르면 재사용·테스트·고장 격리 셋을 한꺼번에 잃는다. 셋째는 취향이 아니라 장애다.
- 화살표를 뒤집어 소비자가 등록하게 하면 생산자가 아는 것이 "호출 가능한 목록" 하나로 줄고, 새 요구는 생산자 바깥의 등록 한 줄이 된다. 이것이 **Observer**다.
- 목록마저 제3자에게 떼어 내면 발행자와 구독자가 서로의 참조를 쥐지 않는다. 이것이 **Publish-Subscribe**이고, 둘을 가르는 것은 **수명 분리** 하나다.
- 브로커가 존재하는 이유는 성능이 아니라 수명이다. 비동기와 프로세스 횡단은 수명이 끊긴 뒤에 따라온 결과다.
- 새로 생기는 버그는 셋이다. **해제 누락**(구독자 수 지표로 잡는다), **통지 중 목록 변경**(사본을 돌고 정책을 문서화한다), **등록 순서 의존**(순서가 필요하면 그것은 파이프라인이다).
- 대가는 하나뿐이고 크다. 호출 스택이 끊겨 흐름이 코드에서 보이지 않는다. 수신자가 하나뿐이면 쓰지 마라.
- 동기 통지는 생산자의 스레드를 쓰고, 비동기 통지는 경계 없는 큐를 만든다. 후자의 처방은 [XI-7 이벤트 루프와 백프레셔](#/xi-7)다.

**다음 절**: [XII-8 State](#/xii-8) — 통지가 아니라 **상태**가 흩어질 때. 작업 오더의 상태 판정이 여섯 곳에 흩어지면 상태를 하나 추가하는 데 무엇이 무너지는지 실행해서 본다.
