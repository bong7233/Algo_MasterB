# XII-9 Command

::: lead
"이걸 해라"를 지금 실행하는 대신 하나의 값으로 만들면, 큐에 넣고 기록하고 다시 시도하고 되돌리는 일이 전부 따라온다.
:::

## 1. 문제

관제 콘솔에 버튼이 하나 있다. **R3 감속.** 누르면 로봇이 느려진다.

```python title="첫 판 (조각) — 요구가 하나일 때"
def on_click_slow_down():
    robot.set_speed(50)
```

한 줄이고, 이보다 단순할 수 없다. 여기에 운영에서 요구가 넷 들어온다.

1. **장비가 오프라인이면 나중에 실행하라.** 무선이 끊기는 일이 하루에 몇 번 있다. 지금 구조에서는 그 순간 누른 명령이 그냥 사라진다.
2. **누가 언제 무엇을 시켰는지 남겨라.** 사고 조사에 쓴다.
3. **실패하면 다시 시도하라.**
4. **직전 동작을 되돌려라.** 잘못 누른 버튼을 취소할 수 있어야 한다.

넷은 서로 무관한 요구처럼 보인다. 그런데 전부 같은 벽에 부딪힌다. ==함수 호출은 값이 아니다.== 호출은 일어나거나 일어나지 않는 사건이다. 변수에 담기지 않고, 리스트에 들어가지 않고, 파일에 쓰이지 않고, 뒤집히지 않는다.

- **나중에 실행하려면** 호출을 미뤄 두어야 하는데, 미룰 수 있는 형태로 손에 쥘 방법이 없다. `robot.set_speed(50)`이라고 쓰는 순간 이미 실행된 것이다.
- **로그로 남기려면** 호출을 들여다볼 수 있어야 한다. 지금은 호출부마다 로그 문자열을 따로 만들어 붙이는 수밖에 없고, 그래서 호출을 고칠 때 로그를 같이 안 고치는 순간부터 **로그가 거짓말을 시작한다.**
- **재시도하려면** 실패한 호출이 어딘가 남아 있어야 하는데, 예외를 잡은 시점에 남은 것은 예외뿐이다.
- **되돌리려면** 역연산을 알아야 한다. `set_speed(50)`을 되돌리는 것은 `set_speed(?)`인데, 물음표에 들어갈 값은 실행 직전의 속도이고 그것은 아무 데도 없다.

넷째가 가장 엄격한 요구다. **되돌리기는 "무엇을 했는가"만으로 부족하고 "그 전이 무엇이었는가"를 함께 요구한다.** 이 요구가 설계를 확정한다.

## 2. 무엇이 달라져야 하는가

- **변하지 않는 것:** 로봇에게 속도를 지시한다는 동작. `Robot.set_speed`는 손대지 않는다.
- **변하는 것:** 그 지시를 **언제, 몇 번, 어떤 순서로, 되돌릴 수 있게** 실행하는가.

지금 코드는 이 둘을 한 줄에 붙여 놓았다. `robot.set_speed(50)`은 "무엇을 할 것인가"와 "지금 할 것인가"를 동시에 말한다. 둘을 떼면 앞쪽이 손에 잡히는 값이 된다.

| 요구 | 요청이 값이 되면 |
|---|---|
| 지연 실행 | 리스트에 넣어 둔다 |
| 감사 로그 | 값에게 이름을 물어본다 |
| 재시도 | 실패한 값을 버리지 않고 한 번 더 부른다 |
| 되돌리기 | 값이 역연산에 필요한 것을 함께 들고 있게 한다 |

앞의 셋과 넷째 사이에 선이 하나 있다. ==앞의 셋은 값이 불투명해도 된다.== 부를 수만 있으면 큐에 넣고 다시 부를 수 있다. 넷째만 값의 **내부**를 요구한다. 이름을 물어보는 것도, 파일에 쓰는 것도, 역연산을 만드는 것도 전부 안을 들여다보는 일이다.

이 선이 어디에 그어지는지가 이 챕터의 핵심이다. 두 언어 모두 **불투명한 값**은 문법으로 이미 제공하고, 그것으로 요구 세 개까지 풀린다. 나머지 하나가 구조를 요구한다.

```text nolines
  caller ──▶ receiver                       <- 지금: 호출이 즉시 일어난다
  caller ──▶ [ value ] ──▶ receiver         <- 값을 사이에 두면 시점이 갈라진다
                 ▲
             queue / log / undo             <- 이 셋이 값에만 붙는다
```

## 3. 구현

### 3.1 지금 있는 코드 — 명령이 사라진다

::: dual
```python title="직접 호출 — 오프라인 장비에 명령을 보낼 때"
class Robot:
    def __init__(self, name, online):
        self.name = name
        self.online = online
        self.speed = 100

    def set_speed(self, value):
        if not self.online:
            raise ConnectionError(f"{self.name} 오프라인")
        self.speed = value
        print(f"[장비] {self.name} 속도 {value}")


r3 = Robot("R3", True)
r7 = Robot("R7", False)

lost = 0
plan = [(r3, 50), (r7, 0), (r3, 30)]
for target, value in plan:
    try:
        target.set_speed(value)      # ❌ 콘솔이 장비를 직접 부른다. 호출은 값이 아니다
    except ConnectionError as e:
        lost += 1
        print(f"[유실] {e}")

print(f"유실 {lost}건 — 다시 시도할 대상이 아무 데도 남아 있지 않다")
print("취소 요청 — 직전에 무엇을 시켰는지 기록이 없다")
print(f"현재 속도 R3={r3.speed} R7={r7.speed}")
```
```cpp title="직접 호출 — 오프라인 장비에 명령을 보낼 때"
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
using namespace std;

struct Robot {
    string name;
    bool online;
    int speed = 100;
    Robot(string n, bool o) : name(move(n)), online(o) {}

    void set_speed(int value) {
        if (!online) throw runtime_error(name + " 오프라인");
        speed = value;
        cout << "[장비] " << name << " 속도 " << value << "\n";
    }
};

int main() {
    Robot r3("R3", true);
    Robot r7("R7", false);

    int lost = 0;
    vector<pair<reference_wrapper<Robot>, int>> plan = {{r3, 50}, {r7, 0}, {r3, 30}};
    for (auto& [target, value] : plan) {
        try {
            target.get().set_speed(value);  // ❌ 콘솔이 장비를 직접 부른다. 호출은 값이 아니다
        } catch (const runtime_error& e) {
            lost += 1;
            cout << "[유실] " << e.what() << "\n";
        }
    }

    cout << "유실 " << lost << "건 — 다시 시도할 대상이 아무 데도 남아 있지 않다\n";
    cout << "취소 요청 — 직전에 무엇을 시켰는지 기록이 없다\n";
    cout << "현재 속도 R3=" << r3.speed << " R7=" << r7.speed << "\n";
}
```
:::

```console
[장비] R3 속도 50
[유실] R7 오프라인
[장비] R3 속도 30
유실 1건 — 다시 시도할 대상이 아무 데도 남아 있지 않다
취소 요청 — 직전에 무엇을 시켰는지 기록이 없다
현재 속도 R3=30 R7=100
```

**복잡도:** 실행 시간 $O(1)$ — 위임 한 번. 이 코드에서 재야 하는 것은 **복구 비용**이고 그것은 유한하지 않다. 유실된 명령을 되살리는 방법이 존재하지 않아서 사람이 무엇을 눌렀는지 기억해 다시 눌러야 한다. 공간 $O(1)$ — 아무것도 남기지 않는다는 뜻이고, 그것이 문제다.

R7의 속도가 100 그대로다. 명령은 예외 한 줄로 바뀌어 사라졌고, `except` 블록이 할 수 있는 일은 그것을 출력하는 것뿐이었다. **되돌리기는 시도조차 못 한다.** 직전에 무엇을 시켰는지가 프로그램 어디에도 없다.

### 3.2 호출을 값으로 만든다 — 언어가 이미 준다

두 언어 모두 "부를 수 있는 것"을 값으로 만드는 문법을 갖고 있다. Python은 `functools.partial`, C++은 람다다.

📖 `functools.partial(fn, *args)` — 함수와 인자 일부를 미리 묶어 새 호출 가능 객체를 만든다. 생성 $O(1)$.
   `partial(robot.set_speed, 50)`은 인자 없이 부르면 `robot.set_speed(50)`이 되는 값이다.
   쓰는 곳: 지연 실행, 콜백 등록([XII-7 Observer / Publish-Subscribe](#/xii-7)).
   C++ 대응: 람다 캡처 `[&robot]{ robot.set_speed(50); }`. `std::bind`도 같은 일을 하지만 현대 C++은 람다를 쓴다.

::: dual
```python title="클로저 큐 — 지연·재시도까지"
from functools import partial


class Robot:
    def __init__(self, name, online):
        self.name = name
        self.online = online
        self.speed = 100

    def set_speed(self, value):
        if not self.online:
            raise ConnectionError(f"{self.name} 오프라인")
        self.speed = value
        print(f"[장비] {self.name} 속도 {value}")


r3 = Robot("R3", True)
r7 = Robot("R7", False)

# 호출을 값으로 만든다. Python 에서는 이 한 줄이 전부다.
queue = [partial(r3.set_speed, 50), partial(r7.set_speed, 0), partial(r3.set_speed, 30)]
print(f"[큐] 명령 {len(queue)}건 적재")

pending = []
for cmd in queue:
    try:
        cmd()
    except ConnectionError as e:
        pending.append(cmd)              # 유실이 아니라 보류다
        print(f"[보류] {e}")

r7.online = True
print("R7 온라인 복귀 — 보류분 재시도")
waiting, pending = pending, []
for cmd in waiting:
    cmd()
print(f"남은 보류 {len(pending)}건 / 유실 0건")

print("무엇을 하는 명령인지 물어보기: 불가")   # 대상과 인자가 클로저 안에 잠긴다
print("파일로 남기기: 불가")                   # 직렬화 경로가 없다
print("되돌리기: 불가")                        # 역연산을 담을 자리가 없다
```
```cpp title="클로저 큐 — 지연·재시도까지"
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
using namespace std;

struct Robot {
    string name;
    bool online;
    int speed = 100;
    Robot(string n, bool o) : name(move(n)), online(o) {}

    void set_speed(int value) {
        if (!online) throw runtime_error(name + " 오프라인");
        speed = value;
        cout << "[장비] " << name << " 속도 " << value << "\n";
    }
};

int main() {
    Robot r3("R3", true);
    Robot r7("R7", false);

    // 호출을 값으로 만든다. C++ 에서도 람다 + std::function 이면 된다.
    vector<function<void()>> queue = {[&r3] { r3.set_speed(50); },
                                      [&r7] { r7.set_speed(0); },
                                      [&r3] { r3.set_speed(30); }};
    cout << "[큐] 명령 " << queue.size() << "건 적재\n";

    vector<function<void()>> pending;
    for (auto& cmd : queue) {
        try {
            cmd();
        } catch (const runtime_error& e) {
            pending.push_back(cmd);          // 유실이 아니라 보류다
            cout << "[보류] " << e.what() << "\n";
        }
    }

    r7.online = true;
    cout << "R7 온라인 복귀 — 보류분 재시도\n";
    vector<function<void()>> waiting = move(pending);
    pending.clear();
    for (auto& cmd : waiting) cmd();
    cout << "남은 보류 " << pending.size() << "건 / 유실 0건\n";

    cout << "무엇을 하는 명령인지 물어보기: 불가\n";  // 대상과 인자가 클로저 안에 잠긴다
    cout << "파일로 남기기: 불가\n";                  // 직렬화 경로가 없다
    cout << "되돌리기: 불가\n";                       // 역연산을 담을 자리가 없다
}
```
:::

```console
[큐] 명령 3건 적재
[장비] R3 속도 50
[보류] R7 오프라인
[장비] R3 속도 30
R7 온라인 복귀 — 보류분 재시도
[장비] R7 속도 0
남은 보류 0건 / 유실 0건
무엇을 하는 명령인지 물어보기: 불가
파일로 남기기: 불가
되돌리기: 불가
```

**복잡도:** 적재 시간 $O(1)$ 분할상환 — 배열 끝에 추가한다. 실행 $O(k)$ — 큐에 든 $k$개를 한 번씩 부른다. 공간 $O(k \times c)$ — $c$는 한 명령이 붙잡고 있는 캡처 크기다. 상수를 말해 두면, C++의 `std::function`은 캡처가 작으면 내부 저장 공간에 들어가고 크면 힙에 할당한다. 초당 수천 개를 만드는 경로라면 이 할당이 실측에 잡힌다.

**요구 셋이 풀렸다.** 유실이 0이 되었고, 오프라인 장비의 명령이 큐에 남아 재시도되었으며, 실행 시점이 호출 시점과 분리되었다. **여기까지는 클래스가 필요 없다.** 설계 패턴 카탈로그의 클래스 계층을 세우기 전에 이 판이 먼저다.

마지막 세 줄이 경계다. 이 값들은 **부를 수는 있어도 물어볼 수는 없다.** 무엇을 대상으로 하는지, 인자가 무엇인지, 되돌리면 어떻게 되는지가 클로저 안에 잠겨 있고 꺼낼 표준 경로가 없다. 그래서 세 가지를 못 한다.

- **감사 로그.** 큐에 든 것을 나열해 "대기 중: R7 속도 0"이라고 화면에 띄울 수 없다.
- **재시작 생존.** 프로세스가 죽으면 보류 큐가 통째로 사라진다. 다른 기계의 워커에게 넘길 수도 없다. 넘기려면 바이트로 만들어야 하는데 클로저는 바이트가 되지 않는다.
- **되돌리기.** 역연산을 담을 자리가 없다.

### 3.3 값의 내부가 필요해지는 지점

세 요구 중 하나라도 실제로 있으면 값에 구조를 준다. 이름을 답하고, 자기를 기록으로 만들고, 자기를 뒤집는 것까지 값이 한다.

::: dual
```python title="명령 객체 — 기록·재시도·되돌리기"
from typing import Protocol


class Command(Protocol):
    # 상속을 강제하지 않는다. 구조가 맞으면 명령이다
    def name(self) -> str: ...
    def run(self) -> None: ...
    def undo(self) -> None: ...
    def record(self) -> str: ...


class Robot:
    def __init__(self, name, online):
        self.name = name
        self.online = online
        self.speed = 100

    def set_speed(self, value):
        if not self.online:
            raise ConnectionError(f"{self.name} 오프라인")
        self.speed = value
        print(f"[장비] {self.name} 속도 {value}")


class SetSpeed:
    def __init__(self, robot, value):
        self.robot = robot
        self.value = value
        self.before = 0          # 역연산에 필요한 상태. 실행 시점에 잡는다

    def name(self):
        return f"SetSpeed({self.robot.name},{self.value})"

    def run(self):
        self.before = self.robot.speed
        self.robot.set_speed(self.value)

    def undo(self):
        self.robot.set_speed(self.before)

    def record(self):
        return '{"cmd":"SetSpeed","robot":"' + self.robot.name + '","value":' + str(self.value) + "}"


class Console:
    def __init__(self):
        self.history = []
        self.pending = []

    def submit(self, cmd):
        try:
            cmd.run()
            print(f"[감사] {cmd.name()} 성공")
            self.history.append(cmd)
        except ConnectionError as e:
            print(f"[보류] {cmd.name()} — {e}")
            self.pending.append(cmd)

    def retry(self):
        waiting, self.pending = self.pending, []
        for cmd in waiting:
            self.submit(cmd)

    def undo_last(self):
        if not self.history:
            return
        cmd = self.history.pop()
        cmd.undo()
        print(f"[취소] {cmd.name()} 되돌림")


r3 = Robot("R3", True)
r7 = Robot("R7", False)
console = Console()
console.submit(SetSpeed(r3, 50))
console.submit(SetSpeed(r7, 0))
console.submit(SetSpeed(r3, 30))
print(f"현재 R3 속도 {r3.speed}")

console.undo_last()
print(f"되돌린 뒤 R3 속도 {r3.speed}")

r7.online = True
console.retry()

print("재시작 대비 기록:")
for cmd in console.history:
    print(" ", cmd.record())
```
```cpp title="명령 객체 — 기록·재시도·되돌리기"
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
using namespace std;

struct Command {
    // 상속을 강제한다. 이 계층이 없으면 한 컨테이너에 담을 수 없다
    virtual ~Command() = default;
    virtual string name() const = 0;
    virtual void run() = 0;
    virtual void undo() = 0;
    virtual string record() const = 0;
};

struct Robot {
    string name;
    bool online;
    int speed = 100;
    Robot(string n, bool o) : name(move(n)), online(o) {}

    void set_speed(int value) {
        if (!online) throw runtime_error(name + " 오프라인");
        speed = value;
        cout << "[장비] " << name << " 속도 " << value << "\n";
    }
};

struct SetSpeed : Command {
    Robot& robot;
    int value;
    int before = 0;              // 역연산에 필요한 상태. 실행 시점에 잡는다

    SetSpeed(Robot& r, int v) : robot(r), value(v) {}

    string name() const override {
        return "SetSpeed(" + robot.name + "," + to_string(value) + ")";
    }

    void run() override {
        before = robot.speed;
        robot.set_speed(value);
    }

    void undo() override {
        robot.set_speed(before);
    }

    string record() const override {
        return "{\"cmd\":\"SetSpeed\",\"robot\":\"" + robot.name + "\",\"value\":" +
               to_string(value) + "}";
    }
};

struct Console {
    vector<unique_ptr<Command>> history;
    vector<unique_ptr<Command>> pending;

    void submit(unique_ptr<Command> cmd) {
        try {
            cmd->run();
            cout << "[감사] " << cmd->name() << " 성공\n";
            history.push_back(move(cmd));
        } catch (const runtime_error& e) {
            cout << "[보류] " << cmd->name() << " — " << e.what() << "\n";
            pending.push_back(move(cmd));
        }
    }

    void retry() {
        vector<unique_ptr<Command>> waiting = move(pending);
        pending.clear();
        for (auto& cmd : waiting) submit(move(cmd));
    }

    void undo_last() {
        if (history.empty()) return;
        unique_ptr<Command> cmd = move(history.back());
        history.pop_back();
        cmd->undo();
        cout << "[취소] " << cmd->name() << " 되돌림\n";
    }
};

int main() {
    Robot r3("R3", true);
    Robot r7("R7", false);
    Console console;
    console.submit(make_unique<SetSpeed>(r3, 50));
    console.submit(make_unique<SetSpeed>(r7, 0));
    console.submit(make_unique<SetSpeed>(r3, 30));
    cout << "현재 R3 속도 " << r3.speed << "\n";

    console.undo_last();
    cout << "되돌린 뒤 R3 속도 " << r3.speed << "\n";

    r7.online = true;
    console.retry();

    cout << "재시작 대비 기록:\n";
    for (auto& cmd : console.history) cout << "  " << cmd->record() << "\n";
}
```
:::

```console
[장비] R3 속도 50
[감사] SetSpeed(R3,50) 성공
[보류] SetSpeed(R7,0) — R7 오프라인
[장비] R3 속도 30
[감사] SetSpeed(R3,30) 성공
현재 R3 속도 30
[장비] R3 속도 50
[취소] SetSpeed(R3,30) 되돌림
되돌린 뒤 R3 속도 50
[장비] R7 속도 0
[감사] SetSpeed(R7,0) 성공
재시작 대비 기록:
  {"cmd":"SetSpeed","robot":"R3","value":50}
  {"cmd":"SetSpeed","robot":"R7","value":0}
```

**복잡도:** 실행·기록 시간 $O(1)$ — 위임 한 번과 배열 끝 추가 한 번. 되돌리기 $O(1)$ — 이력 스택의 `pop` 한 번이고, 자료구조는 [II-4 스택](#/ii-4)이 그대로다. 공간 $O(h \times s)$ — $h$는 이력 길이, $s$는 명령 하나가 들고 있는 이전 상태의 크기. ==되돌리기의 진짜 비용은 시간이 아니라 메모리다.== 여기서는 `before`가 정수 하나라 $s$가 4바이트지만, 되돌릴 대상이 이미지 한 장이면 $s$가 수 메가바이트가 되고 이력 100단계가 곧 수백 메가바이트다.

::: danger
`before`를 잡는 시점이 **생성 시점이 아니라 `run()` 안**이라는 점이 이 구현의 핵심이다. 명령은 만들어지자마자 실행되지 않는다 — 큐에서 몇 초를 기다릴 수도 있고, 그 사이 다른 명령이 같은 로봇의 속도를 바꿀 수도 있다. 생성 시점의 값을 저장해 두면 되돌리기가 **그 사이의 변경까지 함께 되돌려 버린다.**

출력에서 확인할 수 있다. `SetSpeed(R3,30)`을 되돌리자 속도가 50으로 갔다. 100(초기값)이 아니라 50이다. 직전에 실행된 명령이 남긴 값으로 돌아간 것이고, 그것이 옳다.
:::

| 언어 차이 | Python | C++ |
|---|---|---|
| 인터페이스 | `Protocol`은 **선언일 뿐**이다. `SetSpeed`는 상속하지 않고 구조만 맞춘다. 정적 검사기와 사람이 읽으라고 두는 것이다 | 추상 기반 클래스 상속이 **필수다.** `vector<unique_ptr<Command>>` 하나에 여러 명령을 담으려면 공통 기반 타입이 있어야 한다 |
| 값으로서의 호출 | `partial`·클로저·바운드 메서드가 전부 1급 값 | 람다는 각각 **다른 익명 타입**이다. 한 컨테이너에 담으려면 `std::function`으로 지워야 하고 그 지점에 비용이 붙는다 |
| 소유권 | 참조 계수가 처리한다. 큐와 이력이 같은 객체를 가리켜도 문제없다 | `unique_ptr`로 소유를 한 곳에만 둔다. 큐에서 이력으로 넘길 때 `move`가 그 이동을 코드에 드러낸다 |
| 직렬화 | `dataclasses.asdict`나 `__dict__`로 필드를 꺼낼 수 있다 | 표준 리플렉션이 없다. `record()` 같은 함수를 명령마다 **손으로** 써야 한다 |
| 명령 하나의 코드량 | 약 20줄 | 약 25줄. 차이가 작다 — 클로저 판(§3.2)에서 벌어졌던 격차가 여기서는 거의 사라진다 |

**언어가 패턴을 지운다는 명제가 여기서 정확히 절반만 성립한다.** §3.2에서 Python은 한 줄, C++도 람다 한 줄이었고 클래스 계층은 양쪽 다 필요 없었다. 그런데 §3.3에 오면 두 언어의 코드가 거의 같아진다. **구조가 필요해진 이유가 언어의 빈틈이 아니라 요구(되돌리기·직렬화·검사)이기 때문이다.** 언어가 메워 주는 것은 "호출을 값으로 만들기"까지이고, "값의 내부를 열어 보기"는 어느 언어에서도 설계로 만들어야 한다.

## 4. 이제 이름을 붙인다

§3.3이 **Command** 패턴이다. 한 문장으로 줄이면 *요청을 객체로 만든다*이고, 나머지는 전부 그 한 수에서 따라 나온 결과다.

| 참여자 | §3.3의 대응 | 하는 일 |
|---|---|---|
| Command | `Command` | 명령이 답해야 할 것: 실행, 되돌리기, 이름, 기록 |
| ConcreteCommand | `SetSpeed` | 수신자와 인자를 들고 있고, 되돌리기에 필요한 이전 상태를 잡는다 |
| Receiver | `Robot` | 실제 일을 하는 쪽. **명령의 존재를 모른다** |
| Invoker | `Console` | 명령을 받아 실행 시점을 정한다. 큐·이력·재시도가 여기 있다 |
| Client | `main` | 어떤 명령을 만들지 정한다 |

Receiver가 명령을 모른다는 점이 중요하다. `Robot`은 §3.1부터 §3.3까지 한 글자도 바뀌지 않았다. 큐도 이력도 재시도도 로봇 바깥에서 붙었다.

이 패턴이 다른 것들과 붙는 자리가 셋 있다.

- **되돌리기의 자료구조는 스택이다.** 이력에 `push`하고 되돌릴 때 `pop`한다. 다시 실행(redo)이 필요하면 되돌린 명령을 두 번째 스택에 쌓는다. [II-4 스택](#/ii-4)의 응용이 그대로다.
- **여러 명령을 하나로 묶으면 매크로 명령이 된다.** 묶음도 `run`과 `undo`를 갖는 명령이고, `undo`는 **역순으로** 부른다. 이것이 [XII-4 Decorator / Composite](#/xii-4)의 Composite와 같은 구조다.
- **명령 기록을 지우지 않고 쌓으면 로그가 된다.** 그 로그를 처음부터 다시 실행하면 상태가 복원된다. 데이터베이스의 WAL과 이벤트 소싱이 이 성질 위에 서 있다.

## 5. 어디에 박혀 있는가

**편집기의 실행 취소.** 가장 순수한 사례다. 한 번의 편집이 하나의 명령이고, 명령은 "무엇을 넣었는가"와 "그 자리에 무엇이 있었는가"를 함께 들고 있다. §3.3의 `before`가 그것이다. 실무의 편집기가 문자 하나마다 명령을 만들지 않고 입력이 끊길 때까지 묶는 것은 이력 메모리 $O(h \times s)$ 때문이다.

**분산 작업 큐.** 이쪽에서는 명령 객체가 선택이 아니다. 작업을 만든 프로세스와 실행하는 워커가 다른 기계에 있으므로 **명령이 바이트열이 되어야 하고**, 클로저는 바이트열이 되지 않는다. `record()`에 해당하는 직렬화가 큐 시스템의 요구로 강제되는 구조다. 큐에 들어가는 것은 함수가 아니라 "무엇을, 어떤 인자로"라는 데이터다.

**데이터베이스의 WAL과 이벤트 소싱.** 데이터를 고치기 전에 "이 페이지를 이렇게 바꾼다"는 명령을 먼저 로그에 적는다. 장애 후 복구는 그 로그를 다시 실행하는 일(redo)이고, 트랜잭션 취소는 역연산을 실행하는 일(undo)이다. **이 구조 전체가 명령을 값으로 만들었기 때문에 가능하다.** 자세한 것은 [XV-3 LSM Tree와 SSTable](#/xv-3)에서 다룬다.

**스레드 풀의 작업 큐.** 반대 사례로 봐 둘 것. 여기서는 되돌리기도, 직렬화도, 감사도 필요 없다. 그래서 §3.2의 클로저로 충분하고, 실제로 대부분의 스레드 풀 API가 함수 객체 하나만 받는다. [XI-4 스레드 풀과 작업 큐](#/xi-4)가 그 이야기다. **명령 객체를 만들지 않는 것이 옳은 자리를 아는 것이 패턴을 아는 것의 절반이다.**

**하나의 동작에 여러 입구가 있을 때.** 툴바 버튼, 메뉴 항목, 단축키가 같은 동작을 가리키는 구조가 이 패턴의 원래 무대다. 셋이 각자 로직을 부르면 셋이 조금씩 달라지고, 명령 하나를 셋이 가리키면 "지금 이 명령이 실행 가능한가"라는 질문도 한 곳에서 답할 수 있다. 회색으로 비활성화된 메뉴 항목이 그 답이다.

## 6. 언제 쓰지 말아야 하는가

**큐·기록·재시도·되돌리기 중 아무것도 필요 없을 때.** 그냥 부르면 된다. 클래스 하나를 더하면 호출 지점에서 실제 동작까지 파일이 하나 더 끼고, 스택 트레이스가 한 단계 깊어진다.

**클로저로 되는 자리에 클래스를 만들 때.** §3.2가 요구 넷 중 셋을 풀었다는 사실이 이 챕터에서 가장 실용적인 부분이다. 지연 실행과 재시도만 필요하면 거기서 멈춰라. 카탈로그의 그림을 먼저 보고 시작하면 이 판을 건너뛰게 되고, 그것이 패턴 책이 만드는 대표적인 낭비다.

**되돌릴 수 없는 것에 되돌리기를 약속할 때.** `undo()`는 **소프트웨어 상태에만** 성립한다. 로봇이 실제로 이동했다면 속도를 되돌려도 위치는 돌아오지 않고, 발송된 메일은 회수되지 않는다. 이 경우 필요한 것은 되돌리기가 아니라 **보상 동작**이다 — 원래 상태로 가는 것이 아니라 "취소 메일을 한 통 더 보낸다"는 새로운 명령이다. 둘을 같은 `undo()`라는 이름 아래 두면, 되돌아갔다고 믿는 화면과 되돌아가지 않은 현실이 어긋난다.

**이력에 상한을 두지 않을 때.** 되돌리기 이력은 지우지 않으면 무한히 자란다. 위의 복잡도 $O(h \times s)$에서 $h$는 사용자가 정한다. 상한을 정하고 오래된 것부터 버려라. 값의 크기 $s$가 큰 도메인(이미지, 문서 전체)에서는 전체 스냅샷 대신 차이만 저장하는 쪽으로 간다.

**명령이 수신자를 다 알게 될 때.** 명령 클래스가 늘면서 "명령이 시스템의 모든 서비스를 참조하는" 상태로 흐르기 쉽다. 그러면 명령 계층이 God Object가 된다. 명령 하나가 아는 수신자는 하나가 기본이고, 둘 이상이 필요하면 그것은 여러 명령의 묶음이거나 [XII-11 Mediator](#/xii-11)가 할 일이다. [XII-15 안티패턴](#/xii-15)에서 다시 다룬다.

## 연습

::: quiz
**1. 배포 도구의 롤백**
- 상황: 배포 스크립트가 설정 변경, 컨테이너 교체, 트래픽 전환을 차례로 한다. 실패하면 이미 끝난 단계를 되돌려야 한다.
- 무엇이 변하고 무엇이 고정인가: 단계의 목록과 순서가 변한다. "각 단계는 실행되고 되돌려진다"가 고정이다.
- 어떤 구조이고 무엇을 대가로 치르는가: 단계마다 실행과 역연산을 함께 들고 있게 하고, 실패 지점부터 **역순으로** 되돌린다. 대가는 역연산의 정직성이다 — 트래픽 전환은 되돌릴 수 있지만 이미 처리된 요청은 되돌릴 수 없다. 각 단계에 "이것은 진짜 역연산인가 보상 동작인가"를 명시하지 않으면 롤백이 성공했다는 보고와 실제 상태가 갈라진다.

**2. 오프라인 우선 모바일 앱**
- 상황: 네트워크가 없을 때도 사용자가 편집할 수 있어야 하고, 연결이 돌아오면 서버에 반영해야 한다. 앱은 그 사이에 재시작될 수 있다.
- 무엇이 변하고 무엇이 고정인가: 편집의 종류가 변한다. "편집은 저장되었다가 나중에 전송된다"가 고정이다.
- 어떤 구조이고 무엇을 대가로 치르는가: 재시작을 넘어 살아남아야 하므로 클로저는 탈락이다. 각 편집이 **디스크에 쓸 수 있는 데이터**여야 한다. 대가는 두 가지다. 명령마다 직렬화 형식을 손으로 만들어야 하고, 그 형식이 앱 버전을 넘어 호환되어야 한다 — 구버전이 만든 명령을 신버전이 읽어야 한다.

**3. 로봇 관제의 비상 정지**
- 상황: 모든 명령이 큐를 거쳐 실행된다. 비상 정지 버튼이 눌리면 대기 중인 명령을 전부 버리고 즉시 정지해야 한다.
- 무엇이 변하고 무엇이 고정인가: 명령의 종류가 변한다. 고정인 것은 "모든 명령은 큐를 거친다"인데, **비상 정지가 그 고정을 깬다.**
- 어떤 구조이고 무엇을 대가로 치르는가: 비상 정지를 큐에 넣으면 앞의 명령들이 먼저 실행된다. 그것이 위험하다면 비상 정지는 명령이 아니라 큐를 건너뛰는 별도 경로여야 한다. 이 패턴의 대가가 여기서 드러난다 — **큐 하나를 두는 순간 지연이 생기고, 지연이 허용되지 않는 요구가 반드시 하나는 있다.**
:::

## 요약

- 함수 호출은 값이 아니다. 그래서 미룰 수도, 기록할 수도, 다시 시도할 수도, 되돌릴 수도 없다. 요구 넷이 전부 이 한 가지 벽에서 막힌다.
- 호출을 값으로 만드는 것까지는 **언어가 이미 해 준다.** Python의 `partial`, C++의 람다 하나로 지연·큐잉·재시도 셋이 풀린다. 여기서 멈추는 것이 옳은 자리가 많다.
- 나머지 하나(되돌리기)와 두 가지 부수 요구(직렬화, 검사)가 값의 **내부**를 요구한다. 그 지점에서만 명령 객체가 필요하다.
- 되돌리기는 역연산을 요구하고, 역연산은 **실행 직전의 상태**를 요구한다. 그 상태를 잡는 시점은 생성 시점이 아니라 실행 시점이다.
- 되돌리기의 비용은 시간이 아니라 메모리다. $O(h \times s)$의 두 항 모두 상한을 정해야 한다.
- 이 구조가 **Command**다. 수신자는 명령의 존재를 모르고, 큐·이력·재시도는 전부 실행자 쪽에 붙는다. 되돌리기 이력은 스택이고, 명령의 묶음은 Composite이며, 지우지 않은 기록은 로그가 된다.
- 되돌릴 수 없는 부수 효과에 `undo()`라는 이름을 붙이지 마라. 그것은 되돌리기가 아니라 보상 동작이고, 새로운 명령이다.

**다음 절**: [XII-10 Template Method / Chain of Responsibility](#/xii-10) — 명령을 실행하기 전후로 공통 절차를 끼우고 싶을 때. 골격을 고정하고 빈칸만 채우는 방법과, 처리기를 사슬로 잇는 방법.
