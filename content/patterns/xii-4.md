# XII-4 Decorator / Composite

::: lead
여러 개를 묶은 것과 하나를 감싼 것을 호출하는 쪽이 둘 다 "하나"로 볼 수 있으면, 그때 무엇이 가능해지는가.
:::

## 1. 문제

순찰 로봇의 미션 실행기를 짠다. 첫 요구는 한 줄이다.

> 충전소로 이동하고, 도킹하고, 충전한다.

세 동작을 차례로 부르고 하나라도 실패하면 멈추는 함수 하나면 된다. 열 줄이 안 된다. 여기까지는 어떤 설계도 필요 없고, 이 시점에 구조를 잡겠다고 추상화를 꺼내는 것은 [XII-15 안티패턴](#/xii-15)이 조기 추상화라고 부르는 바로 그것이다.

문제는 요구가 하나씩 늘어나는 방식에 있다.

**요구 1 — "실패하면 재시도한다."** 함수에 `retry` 인자를 붙이고 각 동작을 `for` 로 감싼다. 아직 괜찮다.

**요구 2 — "배터리가 80% 이상이면 미션 자체를 돌지 않는다."** 함수 맨 앞에 `if` 를 하나 넣는다. 아직도 괜찮다.

**요구 3 — "이동은 재시도하지 않는다. 경로가 막힌 것이라면 즉시 상위에 알려야 재계획이 돈다."** 여기서 처음으로 무언가 부러진다. `retry` 는 함수 전체에 일괄로 걸려 있어서 동작마다 다르게 줄 수가 없다. 고치는 방법은 함수 안에 `if name == "move"` 를 넣는 것이다. ==재시도 정책이 동작 이름을 알게 된 순간, 그 함수는 미션의 내용을 알아 버렸다.==

**요구 4 — "충전이 실패하면 다른 충전소로 가서 같은 절차를 다시 시도한다."** 이제 미션 안에 미션이 들어간다. 함수의 시그니처는 이렇게 자란다.

```text nolines
run_mission(steps)                                     1주차
run_mission(steps, retry)                              재시도 요구 뒤
run_mission(steps, retry, battery_min)                 조건 요구 뒤
run_mission(steps, retry, battery_min, no_retry_set)   동작별 정책 요구 뒤
run_mission(steps, retry, battery_min, no_retry_set, fallback_steps)
```

인자가 늘어나는 것이 병이 아니다. 병은 **미션의 구조가 전부 이 함수 하나의 제어 흐름으로 표현되고 있다**는 데 있다. 순서·조건·재시도·대안은 서로 독립적인 개념인데, 한 함수의 `for` 와 `if` 안에서 섞여 있으니 하나를 바꾸면 나머지가 흔들린다. 그리고 미션을 설정 파일에서 읽어 오라는 요구가 들어오는 순간 이 코드는 끝난다. 제어 흐름은 데이터로 쓸 수 없다.

::: warn
이 함수가 나쁜 이유는 길어서가 아니다. **미션을 바꾸는 일과 실행 방식을 바꾸는 일이 같은 파일의 같은 함수를 고치게 만든다**는 것이 이유다. 길이는 증상이다.
:::

## 2. 무엇이 달라져야 하는가

변하는 것과 변하지 않는 것을 갈라 보자.

**변하지 않는 것은 딱 하나다.** 미션의 어떤 조각이든, 실행하면 성공이나 실패를 돌려준다. 이동도, 도킹도, "세 개를 차례로"도, "세 번까지 다시"도 전부 그렇다.

**변하는 것은 나머지 전부다.** 조각이 몇 개인지, 어떤 순서인지, 어떤 조건이 붙는지, 실패하면 무엇을 하는지.

여기서 두 가지 서로 다른 조립 방식이 나온다.

**첫째, 여러 개를 묶은 것도 하나로 취급한다.** "이동·도킹·충전을 차례로"라는 묶음이 그 자체로 실행하면 성공/실패를 내는 조각이라면, 호출하는 쪽은 자기가 든 것이 낱개인지 묶음인지 몰라도 된다. 그리고 묶음이 조각이므로 묶음 안에 묶음을 넣을 수 있다. 요구 4의 "미션 안의 미션"이 특별한 경우가 아니라 그냥 트리의 한 층이 된다.

**둘째, 하나를 감싸서 성질을 더한다.** "세 번까지 다시 한다"는 그 자체로는 미션이 아니다. 무언가를 감싸야 의미가 생긴다. 감싼 결과가 여전히 같은 조각이면 감싼 것을 또 감쌀 수 있다. 재시도한 것에 조건을 걸고, 조건 걸린 것에 로그를 붙이는 일이 순서만 바꿔 가며 무한히 가능해진다.

두 방식은 겉보기에 다르지만 같은 한 가지에 기대고 있다. ==묶은 것도, 감싼 것도, 원래의 것과 **구별할 수 없어야** 한다.== 구별할 수 있으면 호출하는 쪽이 다시 종류를 따지기 시작하고, 우리는 `if` 사슬로 돌아간다.

그렇게 하면 요구 1~4가 전부 **트리를 만드는 방식의 차이**로 내려온다.

```text nolines
        Guard(battery < 80)
                 │
             Sequence
      ┌──────────┼──────────┐
      │          │          │
  Action(move)  Retry(3)   Action(charge)
                 │
            Action(dock)
```

이 그림에서 `Retry(3)` 은 자식이 하나뿐이고 그 자식을 여러 번 부른다. `Sequence` 는 자식이 여럿이고 순서대로 부르다 하나라도 실패하면 멈춘다. `Guard` 는 조건이 참일 때만 자식을 부른다. 셋 다 실행하면 성공/실패를 내는 조각이고, 그래서 셋 다 서로의 자식이 될 수 있다.

**요구 3이 어떻게 풀렸는지 보라.** "이동은 재시도하지 않는다"는 `Action(move)` 를 `Retry` 로 감싸지 않는 것이다. 정책을 담은 코드에 예외 조건이 들어가는 대신, 트리의 모양이 달라진다. 그리고 트리는 데이터다 — 설정 파일에서 읽어 만들 수 있다.

## 3. 구현

### 3.1 지금 있는 것

먼저 지금의 실행기를 실제로 돌린다. 세계는 고정된 시나리오다. 각 동작이 몇 번째 시도에 성공하는지를 표로 준다. `99` 는 "이번 판에서는 끝내 성공하지 않는다"는 뜻이고, 경로가 막힌 상황을 이렇게 표현한다.

::: dual
```python title="나쁜 판 — 한 함수가 미션 구조를 전부 들고 있다"
class World:
    """시나리오와 로그. need[name] 은 그 동작이 성공하는 시도 번호다."""

    def __init__(self, need):
        self.need = need
        self.tries = {}
        self.log = []

    def act(self, name):
        self.tries[name] = self.tries.get(name, 0) + 1
        ok = self.tries[name] >= self.need[name]
        self.log.append(f"{name}{self.tries[name]}{'O' if ok else 'X'}")
        return ok


# 요구가 하나 들어올 때마다 이 함수의 인자와 본문이 자란다
def run_mission(w, battery, retry):
    if battery >= 80:                      # 요구 2가 남긴 줄
        return True
    for name in ("move", "dock", "charge"):
        ok = False
        for attempt in range(retry):       # 요구 1이 남긴 줄. 전 동작에 일괄 적용된다
            ok = w.act(name)
            if ok:
                break
        if not ok:
            return False
    return True


def report(label, w, ok):
    trail = " | ".join(w.log) if w.log else "(동작 없음)"
    print(f"[{label}] {'성공' if ok else '실패'}  {trail}")


SCENARIOS = [
    ("정상", 35, {"move": 1, "dock": 3, "charge": 1}),
    ("경로 막힘", 35, {"move": 99, "dock": 3, "charge": 1}),
    ("배터리 충분", 90, {"move": 1, "dock": 3, "charge": 1}),
]

for label, battery, need in SCENARIOS:
    w = World(need)
    report(label, w, run_mission(w, battery, retry=3))
```
```cpp title="나쁜 판 — 한 함수가 미션 구조를 전부 들고 있다"
#include <iostream>
#include <map>
#include <string>
#include <vector>
using namespace std;

struct World {
    // 시나리오와 로그. need[name] 은 그 동작이 성공하는 시도 번호다.
    map<string, int> need;
    map<string, int> tries;
    vector<string> log;

    explicit World(map<string, int> n) : need(move(n)) {}

    bool act(const string& name) {
        tries[name] += 1;
        bool ok = tries[name] >= need[name];
        log.push_back(name + to_string(tries[name]) + (ok ? "O" : "X"));
        return ok;
    }
};

// 요구가 하나 들어올 때마다 이 함수의 인자와 본문이 자란다
bool run_mission(World& w, int battery, int retry) {
    if (battery >= 80)                         // 요구 2가 남긴 줄
        return true;
    for (string name : {"move", "dock", "charge"}) {
        bool ok = false;
        for (int attempt = 0; attempt < retry; attempt++) {  // 요구 1이 남긴 줄
            ok = w.act(name);
            if (ok) break;
        }
        if (!ok) return false;
    }
    return true;
}

void report(const string& label, const World& w, bool ok) {
    string trail;
    for (size_t i = 0; i < w.log.size(); i++)
        trail += (i ? " | " : "") + w.log[i];
    if (trail.empty()) trail = "(동작 없음)";
    cout << "[" << label << "] " << (ok ? "성공" : "실패") << "  " << trail << "\n";
}

int main() {
    vector<pair<string, pair<int, map<string, int>>>> scenarios = {
        {"정상", {35, {{"move", 1}, {"dock", 3}, {"charge", 1}}}},
        {"경로 막힘", {35, {{"move", 99}, {"dock", 3}, {"charge", 1}}}},
        {"배터리 충분", {90, {{"move", 1}, {"dock", 3}, {"charge", 1}}}},
    };
    for (auto& s : scenarios) {
        World w(s.second.second);
        report(s.first, w, run_mission(w, s.second.first, 3));
    }
    return 0;
}
```
:::

**복잡도:** 시간 $O(S \cdot R)$ — 동작 $S$개 각각을 최대 $R$번 시도한다. **변경 비용이 진짜 문제다.** 미션 구조가 하나 바뀔 때 고치는 지점이 $O(1)$개가 아니라 **함수 본문 한 곳에 계속 누적**된다.

출력은 이렇다.

```console
[정상] 성공  move1O | dock1X | dock2X | dock3O | charge1O
[경로 막힘] 실패  move1X | move2X | move3X
[배터리 충분] 성공  (동작 없음)
```

두 번째 줄이 요구 3의 위반이다. **경로가 막혔는데 세 번을 시도했다.** `retry=3` 이 전 동작에 일괄로 걸려 있어서 이동만 빼는 방법이 없다. 이 상태에서 재계획은 두 번의 헛시도만큼 늦게 시작된다.

### 3.2 조각을 같은 모양으로 맞추면

이제 조각마다 클래스를 하나씩 두고, 전부 `tick(w) -> bool` 하나만 갖게 한다.

::: dual
```python title="좋은 판 — 조각을 트리로 조립한다"
class World:
    def __init__(self, need):
        self.need = need
        self.tries = {}
        self.log = []

    def act(self, name):
        self.tries[name] = self.tries.get(name, 0) + 1
        ok = self.tries[name] >= self.need[name]
        self.log.append(f"{name}{self.tries[name]}{'O' if ok else 'X'}")
        return ok


class Action:                                  # 잎. 실제로 세계를 건드리는 유일한 곳
    def __init__(self, name):
        self.name = name

    def tick(self, w):
        return w.act(self.name)


class Sequence:                                # 여럿을 묶어 하나로 만든다
    def __init__(self, *children):
        self.children = children

    def tick(self, w):
        for c in self.children:
            if not c.tick(w):
                return False                   # 하나라도 실패하면 거기서 끝
        return True


class Retry:                                   # 하나를 감싸 성질을 더한다
    def __init__(self, child, n):
        self.child, self.n = child, n

    def tick(self, w):
        for _ in range(self.n):
            if self.child.tick(w):
                return True
        return False


class Guard:                                   # 조건이 거짓이면 자식을 부르지 않는다
    def __init__(self, pred, child):
        self.pred, self.child = pred, child

    def tick(self, w):
        return self.child.tick(w) if self.pred() else True


def build(battery):
    return Guard(lambda: battery < 80,
                 Sequence(Action("move"),      # 이동은 감싸지 않는다 = 재시도 없음
                          Retry(Action("dock"), 3),
                          Action("charge")))


def report(label, w, ok):
    trail = " | ".join(w.log) if w.log else "(동작 없음)"
    print(f"[{label}] {'성공' if ok else '실패'}  {trail}")


SCENARIOS = [
    ("정상", 35, {"move": 1, "dock": 3, "charge": 1}),
    ("경로 막힘", 35, {"move": 99, "dock": 3, "charge": 1}),
    ("배터리 충분", 90, {"move": 1, "dock": 3, "charge": 1}),
]

for label, battery, need in SCENARIOS:
    w = World(need)
    report(label, w, build(battery).tick(w))
```
```cpp title="좋은 판 — 조각을 트리로 조립한다"
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>
using namespace std;

struct World {
    map<string, int> need;
    map<string, int> tries;
    vector<string> log;

    explicit World(map<string, int> n) : need(std::move(n)) {}

    bool act(const string& name) {
        tries[name] += 1;
        bool ok = tries[name] >= need[name];
        log.push_back(name + to_string(tries[name]) + (ok ? "O" : "X"));
        return ok;
    }
};

struct Node {
    virtual ~Node() = default;
    virtual bool tick(World& w) = 0;
};
using NodePtr = unique_ptr<Node>;               // 트리가 자식을 소유한다

struct Action : Node {                          // 잎. 실제로 세계를 건드리는 유일한 곳
    string name;
    explicit Action(string n) : name(std::move(n)) {}
    bool tick(World& w) override { return w.act(name); }
};

struct Sequence : Node {                        // 여럿을 묶어 하나로 만든다
    vector<NodePtr> children;
    explicit Sequence(vector<NodePtr> cs) : children(std::move(cs)) {}
    bool tick(World& w) override {
        for (auto& c : children)
            if (!c->tick(w)) return false;      // 하나라도 실패하면 거기서 끝
        return true;
    }
};

struct Retry : Node {                           // 하나를 감싸 성질을 더한다
    NodePtr child;
    int n;
    Retry(NodePtr c, int n) : child(std::move(c)), n(n) {}
    bool tick(World& w) override {
        for (int i = 0; i < n; i++)
            if (child->tick(w)) return true;
        return false;
    }
};

struct Guard : Node {                           // 조건이 거짓이면 자식을 부르지 않는다
    function<bool()> pred;
    NodePtr child;
    Guard(function<bool()> p, NodePtr c) : pred(std::move(p)), child(std::move(c)) {}
    bool tick(World& w) override { return pred() ? child->tick(w) : true; }
};

template <class... Cs>                          // C++17 폴드 표현식. 자식을 소유권째 모은다
NodePtr sequence(Cs&&... cs) {
    vector<NodePtr> v;
    (v.push_back(std::move(cs)), ...);
    return make_unique<Sequence>(std::move(v));
}

NodePtr build(int battery) {
    return make_unique<Guard>(
        [battery] { return battery < 80; },
        sequence(make_unique<Action>("move"),   // 이동은 감싸지 않는다 = 재시도 없음
                 make_unique<Retry>(make_unique<Action>("dock"), 3),
                 make_unique<Action>("charge")));
}

void report(const string& label, const World& w, bool ok) {
    string trail;
    for (size_t i = 0; i < w.log.size(); i++)
        trail += (i ? " | " : "") + w.log[i];
    if (trail.empty()) trail = "(동작 없음)";
    cout << "[" << label << "] " << (ok ? "성공" : "실패") << "  " << trail << "\n";
}

int main() {
    vector<pair<string, pair<int, map<string, int>>>> scenarios = {
        {"정상", {35, {{"move", 1}, {"dock", 3}, {"charge", 1}}}},
        {"경로 막힘", {35, {{"move", 99}, {"dock", 3}, {"charge", 1}}}},
        {"배터리 충분", {90, {{"move", 1}, {"dock", 3}, {"charge", 1}}}},
    };
    for (auto& s : scenarios) {
        World w(s.second.second);
        report(s.first, w, build(s.second.first)->tick(w));
    }
    return 0;
}
```
:::

**복잡도:** 한 틱의 시간 $O(N \cdot R)$ — 트리의 노드 $N$개를 최대 한 번씩 방문하고, `Retry(k)` 아래의 부분트리만 최대 $k$배로 다시 방문한다. 공간 $O(D)$ — 재귀 깊이는 트리 높이 $D$이고 노드 수가 아니다. **변경 비용은 $O(1)$이다** — 미션 구조가 바뀌면 `build()` 한 줄, 새로운 조립 방식이 필요하면 클래스 하나. 실행기 쪽은 손대지 않는다.

출력이 이렇게 바뀐다.

```console
[정상] 성공  move1O | dock1X | dock2X | dock3O | charge1O
[경로 막힘] 실패  move1X
[배터리 충분] 성공  (동작 없음)
```

첫째·셋째 줄은 그대로다. **둘째 줄이 `move1X` 하나로 줄었다.** 요구 3이 코드의 조건문이 아니라 트리의 모양으로 표현됐기 때문이다. `Action("move")` 를 `Retry` 로 감싸지 않았을 뿐이고, 실행기는 그런 요구가 있다는 사실조차 모른다.

::: tip
`Sequence` 가 자식을 `vector<NodePtr>` 로 **소유**하는 것이 중요하다. 트리는 조립된 뒤 통째로 넘겨지고 통째로 버려진다. 소유권이 트리 모양과 정확히 겹치므로 `unique_ptr` 이 정답이고, 여기서 `shared_ptr` 을 쓰면 "누가 이 노드를 또 들고 있나"를 영원히 추적하게 된다([XI-11 순환 참조와 소유권](#/xi-11)).
:::

### 3.3 클래스를 걷어내면 어디까지 가는가

`tick` 하나뿐인 클래스는 함수와 다를 게 없다. 실제로 노드를 전부 함수로 접을 수 있다.

::: dual
```python title="함수로 접은 판 — 노드가 클로저가 된다"
class World:
    def __init__(self, need):
        self.need, self.tries, self.log = need, {}, []

    def act(self, name):
        self.tries[name] = self.tries.get(name, 0) + 1
        ok = self.tries[name] >= self.need[name]
        self.log.append(f"{name}{self.tries[name]}{'O' if ok else 'X'}")
        return ok


def action(name):
    return lambda w: w.act(name)


def sequence(*cs):
    return lambda w: all(c(w) for c in cs)      # all 은 첫 False 에서 멈춘다


def retry(c, n):
    return lambda w: any(c(w) for _ in range(n))


def guard(pred, c):
    return lambda w: c(w) if pred() else True


def build(battery):
    return guard(lambda: battery < 80,
                 sequence(action("move"),
                          retry(action("dock"), 3),
                          action("charge")))


SCENARIOS = [
    ("정상", 35, {"move": 1, "dock": 3, "charge": 1}),
    ("경로 막힘", 35, {"move": 99, "dock": 3, "charge": 1}),
    ("배터리 충분", 90, {"move": 1, "dock": 3, "charge": 1}),
]

for label, battery, need in SCENARIOS:
    w = World(need)
    ok = build(battery)(w)
    trail = " | ".join(w.log) if w.log else "(동작 없음)"
    print(f"[{label}] {'성공' if ok else '실패'}  {trail}")
```
```cpp title="함수로 접은 판 — 노드가 클로저가 된다"
#include <functional>
#include <iostream>
#include <map>
#include <string>
#include <utility>
#include <vector>
using namespace std;

struct World {
    map<string, int> need, tries;
    vector<string> log;
    explicit World(map<string, int> n) : need(std::move(n)) {}
    bool act(const string& name) {
        tries[name] += 1;
        bool ok = tries[name] >= need[name];
        log.push_back(name + to_string(tries[name]) + (ok ? "O" : "X"));
        return ok;
    }
};

using Node = function<bool(World&)>;            // 타입 하나. 상속 계층이 사라진다

Node action(string name) {
    return [name](World& w) { return w.act(name); };
}

Node sequence(vector<Node> cs) {
    return [cs](World& w) {
        for (auto& c : cs)
            if (!c(w)) return false;            // 첫 실패에서 멈춘다
        return true;
    };
}

Node retry(Node c, int n) {
    return [c, n](World& w) {
        for (int i = 0; i < n; i++)
            if (c(w)) return true;
        return false;
    };
}

Node guard(function<bool()> pred, Node c) {
    return [pred, c](World& w) { return pred() ? c(w) : true; };
}

Node build(int battery) {
    return guard([battery] { return battery < 80; },
                 sequence({action("move"),
                           retry(action("dock"), 3),
                           action("charge")}));
}

int main() {
    vector<pair<string, pair<int, map<string, int>>>> scenarios = {
        {"정상", {35, {{"move", 1}, {"dock", 3}, {"charge", 1}}}},
        {"경로 막힘", {35, {{"move", 99}, {"dock", 3}, {"charge", 1}}}},
        {"배터리 충분", {90, {{"move", 1}, {"dock", 3}, {"charge", 1}}}},
    };
    for (auto& s : scenarios) {
        World w(s.second.second);
        bool ok = build(s.second.first)(w);
        string trail;
        for (size_t i = 0; i < w.log.size(); i++)
            trail += (i ? " | " : "") + w.log[i];
        if (trail.empty()) trail = "(동작 없음)";
        cout << "[" << s.first << "] " << (ok ? "성공" : "실패") << "  " << trail << "\n";
    }
    return 0;
}
```
:::

**복잡도:** 3.2와 완전히 같다 — 한 틱 $O(N \cdot R)$, 공간 $O(D)$. 바뀐 것은 **조각 하나가 vtable 대신 클로저**라는 것뿐이다.

출력은 3.2와 한 글자도 다르지 않다. 그런데 잃은 것이 있다.

**트리를 들여다볼 수 없다.** 클로저가 된 순간 `sequence` 의 자식 목록도, 노드의 이름도 밖에서 읽을 수 없다. 그래서 이 판으로는 못 하는 것이 셋이다.

| 하려는 것 | 클래스 판 | 함수 판 |
|---|---|---|
| 실행 중인 노드를 화면에 표시 | 노드에 이름과 자식이 있다 | 클로저 안이라 접근 불가 |
| 설정 파일 → 트리 로드, 트리 → 파일 저장 | 노드 종류가 타입이므로 이름으로 매핑 | 역직렬화할 대상이 없다 |
| 트리를 순회하며 정적 검사 | 자식을 따라 내려간다 | 자식이 캡처 안에 숨었다 |

**그래서 판단 기준은 언어가 아니라 트리를 데이터로 다뤄야 하느냐다.** 두 언어 모두 접을 수 있고 두 언어 모두 접지 않을 수 있다. 미션 트리가 코드 안에 고정돼 있으면 함수 판이 짧고 옳다. 운영 중에 트리를 보여 주고 고쳐야 하면 클래스 판이어야 한다. 실제 Behavior Tree 엔진들이 클래스와 XML 로 가는 이유가 이것이다 — 트리는 코드가 아니라 **자산**이고, 자산은 읽고 쓰고 그릴 수 있어야 한다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 인터페이스 선언 | 없음. `tick` 만 있으면 트리에 낀다(덕 타이핑) | `struct Node` 순수 가상 함수. 없으면 컴파일 안 된다 |
| 자식 소유 | 참조를 담을 뿐. GC 가 정리한다 | `unique_ptr` 로 명시. 트리 모양 = 소유 그래프 |
| 가변 인자 자식 | `def __init__(self, *children)` | `template <class... Cs>` + C++17 폴드 표현식 |
| 접은 판의 타입 | 그냥 함수 객체 | `std::function<bool(World&)>` — 타입 소거 한 겹 |
| 조건 노드 | `lambda` 를 그대로 담는다 | `std::function<bool()>` 으로 받아야 담긴다 |

::: pitfall
- **`Sequence` 의 단축 평가를 빼먹는다.** `all([c.tick(w) for c in cs])` 는 리스트를 먼저 다 만들므로 **실패한 뒤의 동작까지 실행한다.** 로봇에서는 이것이 그대로 사고다. 반드시 제너레이터(`all(c.tick(w) for c in cs)`)나 명시적 `for` 루프여야 한다.
- **감싸는 순서를 바꿔도 컴파일된다.** `Retry(Guard(p, a), 3)` 과 `Guard(p, Retry(a, 3))` 은 둘 다 유효하고 동작이 다르다. 앞엣것은 조건을 매 시도마다 다시 본다. 어느 쪽이 맞는지는 요구가 정하고, 타입은 아무 말도 해 주지 않는다.
- **C++ 에서 `Node` 에 가상 소멸자를 안 붙인다.** `unique_ptr<Node>` 가 파생 객체를 지울 때 미정의 동작이다. 파생 클래스의 멤버가 소멸되지 않아 누수가 조용히 쌓인다.
- **감싼 것을 두 트리에 넣는다.** `unique_ptr` 이면 컴파일이 막아 주지만 Python 은 막지 않는다. 노드가 상태를 들고 있으면 두 트리가 그 상태를 공유해 버린다.
:::

## 4. 이제 이름을 붙인다

3.2에서 만든 두 가지는 GoF 카탈로그의 서로 다른 항목이고, 이름이 있다.

**Composite** — 잎(`Action`)과 가지(`Sequence`)가 같은 인터페이스(`Node`)를 구현해서, 클라이언트가 개별 객체와 복합 객체를 구별 없이 다루게 한다. 참여자는 셋이다.

```text nolines
  Component   <- 공통 인터페이스. 여기서는 Node::tick
      ^
      +-- Leaf        <- 자식이 없다. Action
      +-- Composite   <- 자식 목록을 갖고, 요청을 자식에게 전달한다. Sequence
```

핵심은 `Composite` 가 `Component` 를 **구현하면서 동시에 담는다**는 것이다. 이 재귀가 트리를 만든다. `Sequence` 안에 `Sequence` 가 들어가는 것이 특별 처리 없이 되는 이유다.

**Decorator** — 객체를 같은 인터페이스의 다른 객체로 감싸서, 인터페이스를 유지한 채 책임을 더한다. `Retry` 와 `Guard` 가 그것이다.

```text nolines
  Component
      ^
      +-- ConcreteComponent   <- 감싸이는 쪽. Action
      +-- Decorator           <- Component 를 하나 갖고, 앞뒤로 무언가를 한다
              ^
              +-- Retry, Guard
```

**둘의 차이는 자식의 수가 아니라 의도다.** Composite 는 **여럿을 하나로 보이게** 하는 것이 목적이고, Decorator 는 **하나에 성질을 더하는** 것이 목적이다. 구조가 닮은 것은 우연이 아니다 — 둘 다 "자기와 같은 인터페이스를 담는다"는 같은 재귀에 기대고 있고, GoF 자신도 Decorator 를 "자식이 하나뿐인 퇴화한 Composite"로 부를 수 있다고 적었다.

::: note
`Guard` 는 Decorator 의 특수한 경우로, Behavior Tree 문헌에서는 조건부 실행을 하는 데코레이터를 따로 부르는 이름이 있다. 이름이 무엇이든 구조는 같다 — 자식 하나를 갖고, 같은 인터페이스를 내보이고, 자식을 부를지 말지를 결정한다.
:::

**Interpreter 와 헷갈리지 마라.** Composite 로 만든 트리에 "의미를 평가하는" 연산을 얹고 트리가 문법 구조를 표현하면 그것은 Interpreter 다. 미션 트리는 문법이 아니라 실행 계획이므로 Composite 로 충분하다.

## 5. 어디에 박혀 있는가

**Behavior Tree.** 로봇 미션 실행기의 표준 형태이고, 3.2가 그 최소 골격이다. 실제 엔진은 `tick` 이 `bool` 대신 `SUCCESS / FAILURE / RUNNING` 세 값을 돌려주는 것만 다르다. `RUNNING` 이 있어야 한 틱에 끝나지 않는 동작(이동)을 표현할 수 있고, 그래서 트리 전체가 제어 주기마다 루트부터 다시 틱된다. 이 구조가 계층적 상태 기계를 대체한 이유는 [XI-6 상태 기계](#/xi-6)에서 다룬다 — 요약하면 **상태 기계는 전이가 $O(n^2)$로 늘고 트리는 노드 추가가 $O(1)$이다.**

**미들웨어 체인.** HTTP 서버에서 로깅·인증·재시도·타임아웃은 각각 "요청을 받아 응답을 내는 것"을 감싸서 "요청을 받아 응답을 내는 것"을 만든다. 인터페이스가 유지되므로 순서만 바꿔 끼울 수 있고, 서버 코어는 자기 앞에 몇 겹이 쌓였는지 모른다. WSGI/ASGI 앱, Express 의 `use`, gRPC 인터셉터가 전부 같은 모양이다. 그리고 순서가 의미를 바꾼다는 3.3의 함정이 여기서 실제 장애가 된다 — 인증을 로깅 밖에 두면 인증 실패가 로그에 안 남는다.

**코스트맵 레이어.** 경로계획이 쓰는 비용 격자는 정적 지도 레이어 위에 장애물 레이어, 그 위에 인플레이션 레이어를 쌓아 만든다. 각 레이어는 "격자를 받아 격자를 갱신한다"는 같은 계약을 갖고, 최종 격자는 레이어를 순서대로 적용한 결과다. 플래너는 몇 개의 레이어가 있었는지 모른 채 완성된 격자만 본다([V-12 지역 경로계획](#/v-12)).

**스트림 래핑.** 파일 핸들을 버퍼링으로 감싸고, 그것을 압축으로 감싸고, 다시 텍스트 디코딩으로 감싼다. 각 겹이 "읽으면 바이트를 준다"는 인터페이스를 유지하기 때문에 순서를 바꿔 조립할 수 있다. Python 의 `io` 계층(`FileIO` → `BufferedReader` → `TextIOWrapper`)이 그대로 이 구조다. 압축 알고리즘 자체를 바꿔 끼우는 축은 [XII-6 Strategy](#/xii-6)의 이야기이고, 겹을 쌓는 축이 여기다.

**파일시스템과 씬 그래프.** 디렉터리가 파일과 디렉터리를 담고, 크기를 물으면 자식들의 합을 낸다. 좌표 프레임 트리도, DOM 도 같다. 순회 자체는 [II-10 트리 순회](#/ii-10)에서 다룬 그것이고, Composite 는 그 트리를 **타입 수준에서** 성립시키는 쪽이다.

## 6. 언제 쓰지 말아야 하는가

**겹이 깊어지면 스택 트레이스가 읽히지 않는다.** 감싸는 계층 하나가 호출 스택 한 겹이다. 잎에서 예외가 났을 때 트레이스백에 찍히는 프레임 수를 실제로 세면 이렇다.

```console
겹 수  트레이스백 프레임  호출 시간(ns)
   0               2           34.8
   1               3           57.9
   2               4           90.4
   3               5          118.9
   4               6          142.0
   5               7          163.7
   6               8          189.6
```

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 스크립트: `tools/bench/xii4_wrapper_depth.py`)

겹당 프레임 하나, 호출당 약 26ns 다. 시간은 대개 문제가 안 된다. **프레임이 문제다.** 여섯 겹이면 장애 로그에서 진짜 실패 지점까지 여섯 줄의 래퍼를 지나야 하고, 그 여섯 줄은 전부 `return child.tick(w)` 처럼 생겨서 서로 구별되지 않는다.

**어느 호출 지점에서도 실효 동작이 보이지 않는다.** 이것이 더 큰 비용이다. `build()` 를 읽지 않으면 이 미션이 재시도를 하는지, 조건이 붙었는지 알 수 없다. 조립이 설정 파일로 빠지면 코드만 봐서는 영영 알 수 없다. ==분기를 지운 대가로 흐름을 잃는다.== 그 교환이 유리한 것은 조립의 가짓수가 실제로 많을 때뿐이다.

**구현체가 하나뿐인데 인터페이스를 뽑는 것이 가장 흔한 낭비다.** 노드 종류가 `Action` 과 `Sequence` 둘뿐이고 깊이가 2를 안 넘으면, 리스트를 도는 `for` 문 하나가 더 짧고 더 잘 읽힌다. 트리가 필요해지는 것은 **중첩이 실제로 일어난 다음**이다.

**Composite 는 잎에만 있는 연산을 만나면 무너진다.** 인터페이스에 `add_child` 를 넣으면 잎도 그 메서드를 갖게 되어 런타임에 거절해야 한다. 안 넣으면 클라이언트가 다시 종류를 따져야 한다. GoF 가 투명성(transparency)과 안전성(safety)의 교환이라고 부른 문제이고, **어느 쪽도 공짜가 아니다.** 트리를 조립하는 코드와 순회하는 코드를 분리해 조립 쪽에서만 구체 타입을 아는 것이 실무의 타협점이다.

**Decorator 는 감싸는 대상의 계약을 넓히면 깨진다.** 감싼 것이 원본보다 더 많은 것을 요구하거나 더 적은 것을 보장하면 그것은 데코레이터가 아니라 다른 객체이고, 호출자가 종류를 알아야 한다. `Retry` 가 "여러 번 실행될 수 있다"는 성질을 더한 순간, 자식이 멱등하지 않으면 이 트리는 틀린다 — **감싸는 쪽이 감싸이는 쪽의 계약을 바꿔 버린 것이다.** 도킹은 여러 번 시도해도 되지만 "카운터를 1 증가"는 그렇지 않다.

## 연습

::: quiz
정답 코드는 없다. 각 상황에서 **무엇이 변하고 무엇이 고정인지** 먼저 적고, 그 다음에 구조를 정하라.

**1. 로그 파이프라인**
- 상황: 로그 한 줄을 받아 처리하는 함수가 있다. 요구가 순서대로 들어온다 — ① 민감 정보 마스킹 ② 초당 1000줄 넘으면 버리기 ③ 실패 시 3회 재시도 ④ 처리 시간 측정. 넷 다 켜고 끌 수 있어야 하고, 마스킹은 항상 가장 먼저 적용돼야 한다.
- 무엇이 변하고 무엇이 고정인가: 고정된 것은 `handle(line) -> bool` 하나다. 변하는 것은 겹의 구성과 순서. "마스킹이 가장 먼저"라는 제약이 **조립 순서에 대한 요구**라는 것을 알아채라 — 그것을 코드로 강제할 방법이 인터페이스 안에는 없다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 데코레이터 체인. 대가는 §6의 두 가지 — 스택 깊이와, 실효 동작이 조립부에만 있다는 것. 순서 제약은 조립 함수 한 곳에서 검사하는 수밖에 없다.

**2. 조직도 인건비 집계**
- 상황: 회사 조직도에서 임의의 부서의 총 인건비를 구한다. 부서는 팀과 부서를 담고, 팀은 사람을 담는다. 나중에 "부서장은 자기 부서의 총액을 볼 수 있지만 하위 팀의 개인별 급여는 못 본다"는 요구가 붙는다.
- 무엇이 변하고 무엇이 고정인가: 고정은 `cost() -> int`. 변하는 것은 트리의 모양. 뒤에 붙은 요구는 **집계 연산이 아니라 접근 제어**이고, 이것을 같은 인터페이스에 밀어 넣으면 노드가 권한을 알게 된다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 집계는 Composite. 접근 제어는 트리 밖에 두거나 [XII-3 Facade / Bridge / Proxy](#/xii-3)의 보호 프록시로 감싼다. 트리 노드에 권한 검사를 넣는 순간 조직도가 인증 시스템에 의존한다.

**3. 코스트맵 레이어**
- 상황: 격자에 정적 지도·장애물·인플레이션 세 레이어를 순서대로 적용한다. 요구가 추가된다 — 특정 구역에서만 인플레이션 반경을 두 배로. 그리고 디버깅을 위해 각 레이어 적용 후의 격자를 저장할 수 있어야 한다.
- 무엇이 변하고 무엇이 고정인가: 고정은 `apply(grid) -> grid`. 첫 요구는 새 레이어 하나로 풀리지만, **둘째 요구는 겹 사이에 끼어드는 것**이라 레이어가 아니라 감싸는 쪽이다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 레이어 목록은 Composite 에 가깝고, 스냅샷 저장은 각 레이어를 감싸는 데코레이터다. 대가는 디버그 겹이 켜졌을 때와 꺼졌을 때 **성능 특성이 달라진다**는 것 — 격자 복사가 매 주기마다 들어간다.
:::

## 요약

- 요구가 늘 때 한 함수의 `for` 와 `if` 가 자라는 것이 문제의 형태다. 병은 길이가 아니라 **미션 구조와 실행 방식이 같은 코드에 섞여 있다**는 것이다.
- 변하지 않는 것을 `tick(w) -> bool` 하나로 고정하면, 순서·조건·재시도·대안이 전부 **트리를 조립하는 방식의 차이**로 내려온다.
- **Composite** 는 잎과 가지가 같은 인터페이스를 구현해 호출자가 낱개와 묶음을 구별하지 않게 한다. 묶음이 자기와 같은 타입을 담기 때문에 중첩이 공짜로 따라온다.
- **Decorator** 는 같은 인터페이스로 감싸 성질을 더한다. 구조는 자식 하나짜리 Composite 와 같고, 다른 것은 의도다.
- 노드가 메서드 하나뿐이면 두 언어 모두 클로저로 접을 수 있다. **접으면 트리를 데이터로 다룰 수 없다** — 시각화·직렬화·정적 검사가 전부 사라진다. 그것이 필요하면 클래스로 남긴다.
- 대가는 스택 깊이(겹당 프레임 하나, 호출당 약 26ns)와 **흐름의 소실**이다. 어느 호출 지점에서도 실효 동작이 보이지 않는다.
- 노드 종류가 둘이고 깊이가 2를 안 넘으면 `for` 문 하나가 옳다. 트리는 중첩이 실제로 일어난 다음에 필요해진다.

**다음 절**: [XII-5 Factory Method / Abstract Factory / Builder](#/xii-5) — 트리를 조립하는 코드가 길어지면, 이번엔 **누가 그것을 만드는가**가 문제가 된다.
