# XII-8 State

::: lead
"지금 무슨 단계인가"에 따라 동작이 갈리는 코드에서, 단계를 하나 더 늘리면 어디가 무너지는가.
:::

## 1. 문제

창고 관제 시스템의 작업 오더는 다섯 단계를 지난다. 생성(`created`) → 배차(`assigned`) → 실행(`running`) → 완료(`done`), 그리고 중간에 취소(`canceled`). 상태는 문자열 하나로 들고 있다.

기능은 이 상태를 보고 갈린다. 그리고 보는 곳이 한 곳이 아니다.

```python title="작업 오더 (조각) — 판정이 다섯 곳에 있다"
def assign(self):    ...  if self.status == "created": ...
def start(self):     ...  if self.status == "assigned": ...
def finish(self):    ...  if self.status == "running": ...
def cancel(self):    ...  if self.status not in ("done", "canceled"): ...
def can_edit(self):  ...  return self.status not in ("running", "done", "canceled")
```

여기까지는 멀쩡하다. 다섯 함수가 각자 한 줄씩만 판정하고, 각 줄이 읽으면 이해된다.

이제 요구가 하나 들어온다. **"실행 중인 작업을 일시정지했다가 재개할 수 있어야 한다."** 상태 하나(`paused`)와 이벤트 둘(`pause`, `resume`)이 는다.

바뀌어야 하는 곳이 어디인지 코드는 알려주지 않는다. 새 상태의 이름이 어디에도 없으므로 `grep paused`는 아무것도 찾지 못한다. 찾아야 하는 것은 **`status`를 보는 모든 곳**이고, 그것을 사람이 기억해서 다섯 군데를 다 열어야 한다. 넷을 고치고 하나를 빠뜨려도 아무 일도 일어나지 않는다. 컴파일러도, 타입 검사기도, 테스트도 말이 없다.

무엇이 이것을 어렵게 만드는지가 중요하다. 세 가지가 겹쳐 있다.

- **판정이 흩어져 있다.** 상태 전이라는 하나의 규칙이 다섯 파일에 나뉘어 있다.
- **부정형 조건이 새 상태를 자동으로 삼킨다.** `not in ("done", "canceled")`는 "여기 안 적힌 것은 전부 허용"이라는 뜻이다. 새 상태를 추가하는 순간 그 조건은 **아무도 결정하지 않은 채로** 허용 쪽에 붙는다. 긍정형(`== "running"`)은 새 상태를 자동으로 거부하므로 최악이 "안 되네"지만, 부정형은 최악이 "되면 안 되는데 되네"다.
- **합법 전이 전체를 어디서도 볼 수 없다.** "지금 paused에서 무엇이 되는가"를 답하려면 다섯 함수를 다 읽고 머리로 합성해야 한다. 문서에 적힌 표와 코드가 맞는지 확인할 방법이 없다.

§4.1에서 이 셋이 실제로 구멍 하나를 만드는 것을 출력으로 본다.

## 2. 무엇이 달라져야 하는가

가르는 선은 여기다.

- **변하지 않는 것:** 작업 오더가 들고 있는 데이터와 바깥에 보이는 API. `assign()`, `start()`, `cancel()`은 그대로다.
- **변하는 것:** 각 상태에서 무엇이 허용되고 그 결과가 어디로 가는가. 그리고 상태의 목록 자체.

지금 코드는 변하는 쪽을 다섯 함수에 나눠 뿌려 놓았다. 방향은 하나다. ==전이 지식을 한 곳으로 모은다.== 모으고 나면 따라오는 성질이 셋이다.

**첫째, 합법 전이가 열거 가능해진다.** 상태 $S$개와 이벤트 $E$개의 격자 $S \times E$에서 어떤 칸이 열려 있는지가 한 화면에 나온다. 이것이 없으면 "이 오더가 지금 취소될 수 있나?"가 코드를 읽어야 답이 나오는 질문이고, 있으면 표를 보면 되는 질문이다.

**둘째, 검사 가능해진다.** 요구사항 문서의 표와 코드의 표를 기계로 대조할 수 있다. §4의 코드가 실제로 그 대조를 돌린다.

**셋째, 새 상태 추가가 국소 변경이 된다.** `paused`를 넣는 일이 "다섯 곳을 찾아 고치기"에서 "한 곳에 줄 몇 개 더하기"로 바뀐다.

::: widget state-machine {
  "kind": "fsm",
  "title": "작업 오더",
  "states": [
    {"id": "created", "label": "created", "initial": true},
    {"id": "assigned", "label": "assigned", "note": "로봇 배차"},
    {"id": "running", "label": "running", "note": "타이머 시작"},
    {"id": "paused", "label": "paused", "note": "타이머 정지"},
    {"id": "done", "label": "done", "terminal": true, "note": "정산"},
    {"id": "canceled", "label": "canceled", "terminal": true, "note": "정산"}
  ],
  "events": ["assign", "start", "pause", "resume", "finish", "cancel", "edit"],
  "transitions": [
    {"from": "created", "on": "assign", "to": "assigned"},
    {"from": "created", "on": "cancel", "to": "canceled"},
    {"from": "created", "on": "edit", "to": "created"},
    {"from": "assigned", "on": "start", "to": "running"},
    {"from": "assigned", "on": "cancel", "to": "canceled"},
    {"from": "assigned", "on": "edit", "to": "assigned"},
    {"from": "running", "on": "pause", "to": "paused"},
    {"from": "running", "on": "finish", "to": "done"},
    {"from": "running", "on": "cancel", "to": "canceled"},
    {"from": "paused", "on": "resume", "to": "running"},
    {"from": "paused", "on": "cancel", "to": "canceled"}
  ],
  "script": ["assign", "start", "pause", "finish", "resume", "finish", "cancel"],
  "showMatrix": true,
  "showRejected": true
}
:::

위젯은 왼쪽에 상태 그래프를, 오른쪽에 $6 \times 7$ 격자를 나란히 띄운다. 스텝을 하나 진행할 때마다 현재 상태 노드가 옮겨 가고, 격자에서 방금 시도한 칸이 켜진다. **거부된 이벤트는 건너뛰지 않고 거부된 칸으로 표시된다.** 네 번째 스텝의 `finish`가 그것이다 — `paused` 행의 `finish` 칸이 비어 있으므로 상태도 타이머도 그대로 있다. 거부는 오류가 아니라 이 기계의 정상 동작이고, 격자에서 비어 있는 31칸이 전부 그 정상 동작이다.

격자가 그래프 옆에 함께 있는 이유는 둘이 서로를 보완하기 때문이다. 그래프는 "어디로 갈 수 있는가"를 보이고, 격자는 **"어디로 갈 수 없는가"를 보인다.** §1의 버그는 후자에서만 눈에 띈다.

## 3. 손으로 따라가기

::: trace
전이는 위젯의 표를 쓴다. 시작 상태는 `created`, 타이머는 꺼짐이다.
이벤트 열: `assign, start, pause, finish, resume, finish, cancel`

`(상태, 이벤트)` 조회에 실패하면 **아무것도 바꾸지 않고** 거부한다.

| 스텝 | 이벤트 | 현재 상태 | 조회 | 다음 상태 | 진입 동작 | 타이머 |
|---|---|---|---|---|---|---|
| 0 | assign | created | 있음 → assigned | assigned | 로봇 배차 | 꺼짐 |
| 1 | start | assigned | 있음 → running | running | 타이머 시작 | 켜짐 |
| 2 | pause | | | | | |
| 3 | finish | | | | | |
| 4 | resume | | | | | |
| 5 | finish | | | | | |
| 6 | cancel | | | | | |

세 가지를 확인하라.

- [ ] 조회에 실패한 스텝에서 상태와 타이머가 **둘 다** 그대로인가
- [ ] 타이머는 몇 번 켜지고 몇 번 꺼지는가. 마지막에 어느 쪽인가
- [ ] 마지막 스텝이 거부되는 이유는 무엇인가. `done`에서 나가는 간선이 몇 개인가
:::

::: answer
| 스텝 | 이벤트 | 현재 상태 | 조회 | 다음 상태 | 진입 동작 | 타이머 |
|---|---|---|---|---|---|---|
| 0 | assign | created | 있음 → assigned | assigned | 로봇 배차 | 꺼짐 |
| 1 | start | assigned | 있음 → running | running | 타이머 시작 | 켜짐 |
| 2 | pause | running | 있음 → paused | paused | 타이머 정지 | 꺼짐 |
| 3 | finish | paused | **없음** | paused | — | 꺼짐 |
| 4 | resume | paused | 있음 → running | running | 타이머 시작 | 켜짐 |
| 5 | finish | running | 있음 → done | done | 정산 | 꺼짐 |
| 6 | cancel | done | **없음** | done | — | 꺼짐 |

스텝 3과 6이 거부다. 둘 다 표에 그 칸이 없어서 거부되었고, **거부의 이유가 조회 실패 하나뿐이라는 것이 요점이다.** 어디에도 "완료된 오더는 취소할 수 없다"고 적은 `if`가 없다. `done`에서 나가는 간선이 0개라는 사실이 그 규칙 전체다.

타이머는 두 번 켜지고 세 번 꺼진다(스텝 2·5, 그리고 처음부터 꺼짐). 여기서 볼 것은 횟수가 아니라 ==타이머를 만지는 코드가 진입 동작 한 곳뿐==이라는 사실이다. `timer_on`을 이벤트 처리기마다 켜고 끄면 상태와 어긋나는 조합이 반드시 생긴다. 상태가 `paused`인데 타이머가 도는 순간은 그렇게 만들어진다.

이 표에 `edit` 이벤트가 없다는 점도 봐 둘 것. 상태를 바꾸지 않는 이벤트라 이런 훈련에서 빠지기 쉽고, **눈에 안 띄는 판정이 실제로 틀린다.** §4.1이 그 사례다.
:::

## 4. 구현

### 4.1 지금 있는 코드 — 다섯 곳 중 하나를 놓쳤다

`paused`를 넣으면서 다섯 판정을 전부 검토했다. `assign`·`start`·`finish`는 긍정형이라 손댈 것이 없었고, `cancel`은 부정형이지만 `paused`도 취소 가능해야 하므로 마침 맞았다. 남은 하나가 `can_edit`이다.

아래 코드는 각 상태에서 각 이벤트가 허용되는지를 **전수 조사**해서 격자로 찍고, 요구사항 문서의 표(`SPEC`)와 대조한다.

::: dual
```python title="흩어진 판정 — paused 추가 후 전수 조사"
STATES = ["created", "assigned", "running", "paused", "done", "canceled"]
EVENTS = ["assign", "start", "pause", "resume", "finish", "cancel", "edit"]
SPEC = {                                   # 요구사항 문서에 적힌 합법 전이
    "created": ["assign", "cancel", "edit"],
    "assigned": ["start", "cancel", "edit"],
    "running": ["pause", "finish", "cancel"],
    "paused": ["resume", "cancel"],
    "done": [],
    "canceled": [],
}


class WorkOrder:
    # ❌ 상태 판정이 흩어져 있다. paused 를 넣으려면 전부 찾아 고쳐야 한다.
    def __init__(self, status):
        self.status = status

    def assign(self):                                  # 판정 1
        if self.status == "created":
            self.status = "assigned"
            return True
        return False

    def start(self):                                   # 판정 2
        if self.status == "assigned":
            self.status = "running"
            return True
        return False

    def finish(self):                                  # 판정 3
        if self.status == "running":
            self.status = "done"
            return True
        return False

    def cancel(self):                                  # 판정 4 — 부정형 조건
        if self.status not in ("done", "canceled"):
            self.status = "canceled"
            return True
        return False

    def can_edit(self):                                # 판정 5 — 부정형 조건
        return self.status not in ("running", "done", "canceled")

    def pause(self):                                   # paused 요구로 새로 추가
        if self.status == "running":
            self.status = "paused"
            return True
        return False

    def resume(self):                                  # paused 요구로 새로 추가
        if self.status == "paused":
            self.status = "running"
            return True
        return False


def probe(state, event):
    o = WorkOrder(state)
    if event == "assign":
        return o.assign()
    if event == "start":
        return o.start()
    if event == "pause":
        return o.pause()
    if event == "resume":
        return o.resume()
    if event == "finish":
        return o.finish()
    if event == "cancel":
        return o.cancel()
    return o.can_edit()


def row(name, cells):
    return (name.ljust(10) + "".join(c.ljust(7) for c in cells)).rstrip()


print(row("state", EVENTS))
gap = []
for s in STATES:
    cells = []
    for e in EVENTS:
        ok = probe(s, e)
        cells.append("O" if ok else ".")
        if ok != (e in SPEC[s]):
            gap.append((s, e, ok))
    print(row(s, cells))

print(f"명세와 어긋난 칸: {len(gap)}개")
for s, e, ok in gap:
    print(f"  {s} x {e}: 구현={'허용' if ok else '거부'} / 명세={'거부' if ok else '허용'}")
```
```cpp title="흩어진 판정 — paused 추가 후 전수 조사"
#include <iomanip>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <tuple>
#include <vector>
using namespace std;

const vector<string> STATES = {"created", "assigned", "running", "paused", "done", "canceled"};
const vector<string> EVENTS = {"assign", "start", "pause", "resume", "finish", "cancel", "edit"};
const map<string, set<string>> SPEC = {     // 요구사항 문서에 적힌 합법 전이
    {"created", {"assign", "cancel", "edit"}},
    {"assigned", {"start", "cancel", "edit"}},
    {"running", {"pause", "finish", "cancel"}},
    {"paused", {"resume", "cancel"}},
    {"done", {}},
    {"canceled", {}},
};

struct WorkOrder {
    // ❌ 상태 판정이 흩어져 있다. paused 를 넣으려면 전부 찾아 고쳐야 한다.
    string status;
    explicit WorkOrder(string s) : status(move(s)) {}

    bool assign() {                                     // 판정 1
        if (status == "created") { status = "assigned"; return true; }
        return false;
    }

    bool start() {                                      // 판정 2
        if (status == "assigned") { status = "running"; return true; }
        return false;
    }

    bool finish() {                                     // 판정 3
        if (status == "running") { status = "done"; return true; }
        return false;
    }

    bool cancel() {                                     // 판정 4 — 부정형 조건
        if (status != "done" && status != "canceled") { status = "canceled"; return true; }
        return false;
    }

    bool can_edit() {                                   // 판정 5 — 부정형 조건
        return status != "running" && status != "done" && status != "canceled";
    }

    bool pause() {                                      // paused 요구로 새로 추가
        if (status == "running") { status = "paused"; return true; }
        return false;
    }

    bool resume() {                                     // paused 요구로 새로 추가
        if (status == "paused") { status = "running"; return true; }
        return false;
    }
};

bool probe(const string& state, const string& event) {
    WorkOrder o(state);
    if (event == "assign") return o.assign();
    if (event == "start") return o.start();
    if (event == "pause") return o.pause();
    if (event == "resume") return o.resume();
    if (event == "finish") return o.finish();
    if (event == "cancel") return o.cancel();
    return o.can_edit();
}

string row(const string& name, const vector<string>& cells) {
    ostringstream os;
    os << left << setw(10) << name;
    for (const string& c : cells) os << setw(7) << c;
    string s = os.str();
    while (!s.empty() && s.back() == ' ') s.pop_back();
    return s;
}

int main() {
    cout << row("state", EVENTS) << "\n";
    vector<tuple<string, string, bool>> gap;
    for (const string& s : STATES) {
        vector<string> cells;
        for (const string& e : EVENTS) {
            bool ok = probe(s, e);
            cells.push_back(ok ? "O" : ".");
            bool legal = SPEC.at(s).count(e) > 0;
            if (ok != legal) gap.emplace_back(s, e, ok);
        }
        cout << row(s, cells) << "\n";
    }

    cout << "명세와 어긋난 칸: " << gap.size() << "개\n";
    for (auto& [s, e, ok] : gap) {
        cout << "  " << s << " x " << e << ": 구현=" << (ok ? "허용" : "거부")
             << " / 명세=" << (ok ? "거부" : "허용") << "\n";
    }
}
```
:::

```console
state     assign start  pause  resume finish cancel edit
created   O      .      .      .      .      O      O
assigned  .      O      .      .      .      O      O
running   .      .      O      .      O      O      .
paused    .      .      .      O      .      O      O
done      .      .      .      .      .      .      .
canceled  .      .      .      .      .      .      .
명세와 어긋난 칸: 1개
  paused x edit: 구현=허용 / 명세=거부
```

**복잡도:** 전수 조사 시간 $O(S \times E)$ — 상태 6개와 이벤트 7개의 모든 조합을 한 번씩 시도하므로 42회다. 판정 하나는 문자열 비교 서너 번이라 $O(1)$. 공간 $O(S \times E)$ — 격자를 담을 때만. 이 코드에서 진짜로 재야 하는 것은 **판정 지점의 수**이고, 그것은 5다.

`paused` 행의 `edit` 칸이 `O`다. **일시정지된 오더의 목적지를 편집할 수 있다.** 로봇이 절반쯤 이동한 상태에서 목적지가 바뀌면 그다음에 무슨 일이 일어나는지는 아무도 설계하지 않았다. `can_edit` 한 곳을 놓쳤다는 것이 원인의 전부이고, 놓치기 쉬웠던 이유는 그것이 부정형 조건이었기 때문이다.

여기서 배울 것은 "조심하라"가 아니다. ==다섯 곳을 사람이 빠짐없이 검토해야 하는 구조 자체가 결함이다.== 다음에 상태가 하나 더 늘면 검토할 곳은 일곱 곳이 된다.

### 4.2 표 한 곳으로 모은다

::: dual
```python title="전이 표 — 같은 전수 조사"
STATES = ["created", "assigned", "running", "paused", "done", "canceled"]
EVENTS = ["assign", "start", "pause", "resume", "finish", "cancel", "edit"]
SPEC = {                                   # 요구사항 문서에 적힌 합법 전이
    "created": ["assign", "cancel", "edit"],
    "assigned": ["start", "cancel", "edit"],
    "running": ["pause", "finish", "cancel"],
    "paused": ["resume", "cancel"],
    "done": [],
    "canceled": [],
}

# ✅ 전이 지식이 여기 한 곳에 다 있다. paused 요구로 늘어난 것은 아래 세 줄뿐이다.
TRANSITIONS = {
    ("created", "assign"): "assigned",
    ("created", "cancel"): "canceled",
    ("created", "edit"): "created",
    ("assigned", "start"): "running",
    ("assigned", "cancel"): "canceled",
    ("assigned", "edit"): "assigned",
    ("running", "pause"): "paused",        # <- 추가
    ("running", "finish"): "done",
    ("running", "cancel"): "canceled",
    ("paused", "resume"): "running",       # <- 추가
    ("paused", "cancel"): "canceled",      # <- 추가
}


class WorkOrder:
    def __init__(self, status):
        self.status = status

    def apply(self, event):
        nxt = TRANSITIONS.get((self.status, event))    # 판정은 이 한 줄이 전부다
        if nxt is None:
            return False
        self.status = nxt
        return True


def probe(state, event):
    return WorkOrder(state).apply(event)


def row(name, cells):
    return (name.ljust(10) + "".join(c.ljust(7) for c in cells)).rstrip()


print(row("state", EVENTS))
gap = []
legal = 0
for s in STATES:
    cells = []
    for e in EVENTS:
        ok = probe(s, e)
        cells.append("O" if ok else ".")
        legal += 1 if ok else 0
        if ok != (e in SPEC[s]):
            gap.append((s, e, ok))
    print(row(s, cells))

print(f"합법 칸 {legal}개 / 전체 {len(STATES) * len(EVENTS)}칸")
print(f"명세와 어긋난 칸: {len(gap)}개")
```
```cpp title="전이 표 — 같은 전수 조사"
#include <iomanip>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <tuple>
#include <utility>
#include <vector>
using namespace std;

const vector<string> STATES = {"created", "assigned", "running", "paused", "done", "canceled"};
const vector<string> EVENTS = {"assign", "start", "pause", "resume", "finish", "cancel", "edit"};
const map<string, set<string>> SPEC = {     // 요구사항 문서에 적힌 합법 전이
    {"created", {"assign", "cancel", "edit"}},
    {"assigned", {"start", "cancel", "edit"}},
    {"running", {"pause", "finish", "cancel"}},
    {"paused", {"resume", "cancel"}},
    {"done", {}},
    {"canceled", {}},
};

// ✅ 전이 지식이 여기 한 곳에 다 있다. paused 요구로 늘어난 것은 아래 세 줄뿐이다.
const map<pair<string, string>, string> TRANSITIONS = {
    {{"created", "assign"}, "assigned"},
    {{"created", "cancel"}, "canceled"},
    {{"created", "edit"}, "created"},
    {{"assigned", "start"}, "running"},
    {{"assigned", "cancel"}, "canceled"},
    {{"assigned", "edit"}, "assigned"},
    {{"running", "pause"}, "paused"},        // <- 추가
    {{"running", "finish"}, "done"},
    {{"running", "cancel"}, "canceled"},
    {{"paused", "resume"}, "running"},       // <- 추가
    {{"paused", "cancel"}, "canceled"},      // <- 추가
};

struct WorkOrder {
    string status;
    explicit WorkOrder(string s) : status(move(s)) {}

    bool apply(const string& event) {
        auto it = TRANSITIONS.find({status, event});     // 판정은 이 한 줄이 전부다
        if (it == TRANSITIONS.end()) return false;
        status = it->second;
        return true;
    }
};

bool probe(const string& state, const string& event) {
    return WorkOrder(state).apply(event);
}

string row(const string& name, const vector<string>& cells) {
    ostringstream os;
    os << left << setw(10) << name;
    for (const string& c : cells) os << setw(7) << c;
    string s = os.str();
    while (!s.empty() && s.back() == ' ') s.pop_back();
    return s;
}

int main() {
    cout << row("state", EVENTS) << "\n";
    vector<tuple<string, string, bool>> gap;
    int legal = 0;
    for (const string& s : STATES) {
        vector<string> cells;
        for (const string& e : EVENTS) {
            bool ok = probe(s, e);
            cells.push_back(ok ? "O" : ".");
            legal += ok ? 1 : 0;
            if (ok != (SPEC.at(s).count(e) > 0)) gap.emplace_back(s, e, ok);
        }
        cout << row(s, cells) << "\n";
    }

    cout << "합법 칸 " << legal << "개 / 전체 " << STATES.size() * EVENTS.size() << "칸\n";
    cout << "명세와 어긋난 칸: " << gap.size() << "개\n";
}
```
:::

```console
state     assign start  pause  resume finish cancel edit
created   O      .      .      .      .      O      O
assigned  .      O      .      .      .      O      O
running   .      .      O      .      O      O      .
paused    .      .      .      O      .      O      .
done      .      .      .      .      .      .      .
canceled  .      .      .      .      .      .      .
합법 칸 11개 / 전체 42칸
명세와 어긋난 칸: 0개
```

**복잡도:** 이벤트 처리 시간 — Python은 `dict` 조회 한 번이라 평균 $O(1)$, C++ `std::map`은 균형 트리 탐색이라 $O(\log n)$($n$은 전이 수 11). 공간 $O(n)$ — 합법 전이만 저장하고 거부는 저장하지 않는다. 상수를 말해 두면, 이 조회의 비용은 문자열 비교 몇 번이라 §4.1의 `if` 사슬과 실측상 구별되지 않는다. **이 변경은 성능 변경이 아니다.**

바뀐 것은 셋이다.

- **`paused` 추가로 늘어난 줄이 셋이고, 전부 한 곳에 있다.** 다섯 함수를 순회할 일이 없다.
- **부정형 조건이 사라졌다.** 표에 없으면 거부다. 새 상태를 추가해도 아무 칸이 저절로 열리지 않는다. §1의 세 번째 원인이 구조적으로 제거되었다.
- **격자가 곧 코드다.** 42칸 중 11칸이 열려 있다는 문장이 코드에서 직접 나온다. 나머지 31칸은 누가 결정한 것이 아니라 **결정하지 않았기 때문에 닫힌 것**이고, 그것이 안전한 기본값이다.

::: note
`SPEC`과 `TRANSITIONS`가 결국 같은 내용이라 대조가 형식적으로 보인다. 그것이 요점이다. §4.1에서는 명세가 사람 머릿속에만 있고 구현이 다섯 곳에 흩어져 있어 **대조 자체가 불가능**했다. 여기서는 둘 다 각각 한 화면이라 눈으로 대조된다. 검사 코드는 그 대조를 자동화한 것뿐이다.
:::

### 4.3 상태마다 동작이 다르면 객체로 간다

표는 "어디로 가는가"만 담는다. 상태마다 **들어갈 때 할 일**이 다르면 표에 담을 자리가 없다. `assigned`에 들어가면 로봇을 배차하고, `running`에 들어가면 타이머를 켜고, `paused`에 들어가면 끈다. §3의 손추적이 따라간 것이 이 기계다.

::: dual
```python title="상태 객체 — 진입 동작까지 상태가 갖는다"
class State:
    # 전이 지식과 진입 동작을 상태 자신이 들고 있다.
    name = "?"
    edges = {}

    def on_enter(self, order):
        pass


class Created(State):
    name = "created"
    edges = {"assign": "assigned", "cancel": "canceled", "edit": "created"}


class Assigned(State):
    name = "assigned"
    edges = {"start": "running", "cancel": "canceled", "edit": "assigned"}

    def on_enter(self, order):
        print(f"  [배차] {order.oid} 로봇 배정 요청")


class Running(State):
    name = "running"
    edges = {"pause": "paused", "finish": "done", "cancel": "canceled"}

    def on_enter(self, order):
        order.timer_on = True
        print(f"  [타이머] {order.oid} 시작")


class Paused(State):
    name = "paused"
    edges = {"resume": "running", "cancel": "canceled"}

    def on_enter(self, order):
        order.timer_on = False
        print(f"  [타이머] {order.oid} 정지")


class Done(State):
    name = "done"
    edges = {}

    def on_enter(self, order):
        order.timer_on = False
        print(f"  [정산] {order.oid} 완료 처리")


class Canceled(State):
    name = "canceled"
    edges = {}

    def on_enter(self, order):
        order.timer_on = False
        print(f"  [정산] {order.oid} 취소 처리")


STATES = {c.name: c() for c in (Created, Assigned, Running, Paused, Done, Canceled)}


class WorkOrder:
    def __init__(self, oid):
        self.oid = oid
        self.state = STATES["created"]
        self.timer_on = False

    def apply(self, event):
        nxt = self.state.edges.get(event)
        if nxt is None:
            print(f"[거부] {self.state.name} + {event}")
            return False
        print(f"[전이] {self.state.name} + {event} -> {nxt}")
        if nxt != self.state.name:
            self.state = STATES[nxt]
            self.state.on_enter(self)
        return True


order = WorkOrder("W-100")
for event in ["assign", "start", "pause", "finish", "resume", "finish", "cancel"]:
    order.apply(event)
print(f"최종 상태 {order.state.name} / 타이머 {'켜짐' if order.timer_on else '꺼짐'}")
```
```cpp title="상태 객체 — 진입 동작까지 상태가 갖는다"
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>
using namespace std;

struct WorkOrder;

struct State {
    // 전이 지식과 진입 동작을 상태 자신이 들고 있다.
    virtual ~State() = default;
    virtual string name() const = 0;
    virtual const map<string, string>& edges() const = 0;
    virtual void on_enter(WorkOrder&) const {}
};

struct Created : State {
    string name() const override { return "created"; }
    const map<string, string>& edges() const override {
        static const map<string, string> e{
            {"assign", "assigned"}, {"cancel", "canceled"}, {"edit", "created"}};
        return e;
    }
};

struct Assigned : State {
    string name() const override { return "assigned"; }
    const map<string, string>& edges() const override {
        static const map<string, string> e{
            {"start", "running"}, {"cancel", "canceled"}, {"edit", "assigned"}};
        return e;
    }
    void on_enter(WorkOrder& order) const override;
};

struct Running : State {
    string name() const override { return "running"; }
    const map<string, string>& edges() const override {
        static const map<string, string> e{
            {"pause", "paused"}, {"finish", "done"}, {"cancel", "canceled"}};
        return e;
    }
    void on_enter(WorkOrder& order) const override;
};

struct Paused : State {
    string name() const override { return "paused"; }
    const map<string, string>& edges() const override {
        static const map<string, string> e{{"resume", "running"}, {"cancel", "canceled"}};
        return e;
    }
    void on_enter(WorkOrder& order) const override;
};

struct Done : State {
    string name() const override { return "done"; }
    const map<string, string>& edges() const override {
        static const map<string, string> e{};
        return e;
    }
    void on_enter(WorkOrder& order) const override;
};

struct Canceled : State {
    string name() const override { return "canceled"; }
    const map<string, string>& edges() const override {
        static const map<string, string> e{};
        return e;
    }
    void on_enter(WorkOrder& order) const override;
};

const map<string, shared_ptr<State>>& STATES() {
    static const map<string, shared_ptr<State>> t{
        {"created", make_shared<Created>()},   {"assigned", make_shared<Assigned>()},
        {"running", make_shared<Running>()},   {"paused", make_shared<Paused>()},
        {"done", make_shared<Done>()},         {"canceled", make_shared<Canceled>()}};
    return t;
}

struct WorkOrder {
    string oid;
    shared_ptr<State> state;
    bool timer_on = false;

    explicit WorkOrder(string id) : oid(move(id)), state(STATES().at("created")) {}

    bool apply(const string& event) {
        const auto& e = state->edges();
        auto it = e.find(event);
        if (it == e.end()) {
            cout << "[거부] " << state->name() << " + " << event << "\n";
            return false;
        }
        const string& nxt = it->second;
        cout << "[전이] " << state->name() << " + " << event << " -> " << nxt << "\n";
        if (nxt != state->name()) {
            state = STATES().at(nxt);
            state->on_enter(*this);
        }
        return true;
    }
};

void Assigned::on_enter(WorkOrder& order) const {
    cout << "  [배차] " << order.oid << " 로봇 배정 요청\n";
}

void Running::on_enter(WorkOrder& order) const {
    order.timer_on = true;
    cout << "  [타이머] " << order.oid << " 시작\n";
}

void Paused::on_enter(WorkOrder& order) const {
    order.timer_on = false;
    cout << "  [타이머] " << order.oid << " 정지\n";
}

void Done::on_enter(WorkOrder& order) const {
    order.timer_on = false;
    cout << "  [정산] " << order.oid << " 완료 처리\n";
}

void Canceled::on_enter(WorkOrder& order) const {
    order.timer_on = false;
    cout << "  [정산] " << order.oid << " 취소 처리\n";
}

int main() {
    WorkOrder order("W-100");
    for (const string& event : vector<string>{"assign", "start", "pause", "finish",
                                              "resume", "finish", "cancel"}) {
        order.apply(event);
    }
    cout << "최종 상태 " << order.state->name() << " / 타이머 "
         << (order.timer_on ? "켜짐" : "꺼짐") << "\n";
}
```
:::

```console
[전이] created + assign -> assigned
  [배차] W-100 로봇 배정 요청
[전이] assigned + start -> running
  [타이머] W-100 시작
[전이] running + pause -> paused
  [타이머] W-100 정지
[거부] paused + finish
[전이] paused + resume -> running
  [타이머] W-100 시작
[전이] running + finish -> done
  [정산] W-100 완료 처리
[거부] done + cancel
최종 상태 done / 타이머 꺼짐
```

**복잡도:** 이벤트 처리 시간 $O(\log d)$ — 현재 상태의 간선 맵에서 이벤트를 찾는 한 번의 탐색이고 $d$는 그 상태의 간선 수(여기서는 최대 3)다. 여기에 C++은 가상 함수 호출 한 번(간접 분기 하나)이 더 붙는다. 공간 $O(S + n)$ — 상태 객체 $S$개는 레지스트리에 하나씩만 만들어 공유하고, 간선 $n$개는 상태별로 나뉘어 저장된다.

§3의 손추적 표와 출력이 한 줄씩 대응한다. `[거부]` 두 줄이 표의 "없음" 두 줄이다.

::: warn
상태 객체는 레지스트리에 **하나씩만** 만들어 모든 오더가 공유한다. 그래서 상태 객체에 특정 오더의 데이터를 넣으면 안 된다. 오더별 데이터는 전부 `order` 쪽에 있고 상태는 `order`를 인자로 받는다. 이 규율을 어기면 오더 A의 타이머 값을 오더 B가 읽는 사고가 난다.
:::

| 언어 차이 | Python | C++ |
|---|---|---|
| 상태 인터페이스 | 클래스 속성 `edges`와 메서드 하나. 상속은 기본 구현 재사용 목적일 뿐이고 덕 타이핑이면 상속 없이도 된다 | 순수 가상 함수를 가진 추상 기반 클래스가 **필요하다.** 그것 없이는 여섯 상태를 한 컨테이너에 담을 수 없다 |
| 상태 테이블 | `{c.name: c() for c in (...)}` 한 줄 | 함수 안의 `static` 지역 변수로 초기화 순서를 확정한다. 전역 객체로 두면 다른 번역 단위와의 초기화 순서가 정해지지 않는다 |
| 소유권 | 참조 계수가 알아서 한다 | `shared_ptr`로 레지스트리와 오더가 함께 소유한다. 원시 포인터로 두면 레지스트리 수명에 묶인다 |
| 전방 선언 | 필요 없다 | `on_enter(WorkOrder&)`가 `WorkOrder`보다 먼저 나오므로 전방 선언 후 정의를 뒤로 뺀다 |
| 코드량 | 여섯 상태에 약 60줄 | 같은 것에 약 110줄. **이 차이가 §7의 손익분기점을 언어마다 다르게 만든다** |

## 5. 이제 이름을 붙인다

§4.3이 **State** 패턴이다.

| 참여자 | §4.3의 대응 | 하는 일 |
|---|---|---|
| Context | `WorkOrder` | 현재 상태를 참조로 들고 있고, 요청을 그쪽에 위임한다 |
| State | `State` | 상태들이 공통으로 답해야 하는 것: 어떤 이벤트를 받고, 들어올 때 무엇을 하는가 |
| ConcreteState | `Created` … `Canceled` | 자기 상태에서의 전이와 진입 동작 |

이름이 붙지 않는 것도 말해 두어야 한다. **§4.2의 전이 표는 이 패턴이 아니다.** 표는 데이터고 패턴은 객체 구조다. 둘은 같은 문제를 풀고, 무엇을 쓸지는 §7에서 정한다. 패턴 이름을 안다는 것과 그것을 써야 한다는 것은 다른 문제다.

### 5.1 Strategy와 무엇이 다른가

클래스 다이어그램만 놓으면 [XII-6 Strategy](#/xii-6)와 구별되지 않는다. 둘 다 문맥 객체가 인터페이스 하나를 들고 위임한다. 차이는 그림이 아니라 **전이를 누가 쥐고 있는가**에 있다.

| | Strategy | State |
|---|---|---|
| 누가 고르는가 | **바깥.** 클라이언트가 주입한다 | **자신.** 현재 상태가 다음 상태를 정한다 |
| 언제 바뀌는가 | 대개 한 번. 생성 시점이나 설정 변경 시점 | 이벤트마다. 실행 중에 계속 |
| 서로를 아는가 | 모른다. 두 전략이 서로의 존재를 알 필요가 없다 | **안다.** `Running`은 `Paused`라는 이름을 알아야 한다 |
| 후보들의 관계 | 대체 가능하다. 어느 것을 넣어도 결과의 종류가 같다 | 대체 불가능하다. 지금 어느 것인지가 곧 의미다 |
| 의도 | 같은 일을 **다른 방법**으로 | 같은 요청에 **시간에 따라 다르게** |
| 안 쓰면 | 알고리즘 선택이 `if`로 흩어진다 | 상태 판정이 `if`로 흩어진다 |

한 문장으로 줄이면 이렇다. ==Strategy는 바깥에서 골라 넣고 스스로 바뀌지 않는다. State는 스스로 다음을 고른다.== 그래서 상태 객체들은 서로의 이름을 알아야 하고 전략 객체들은 끝까지 서로를 모른다. 같은 모양의 코드를 두고 어느 쪽인지 물으려면 **"다음 것을 누가 정하는가"** 하나만 보면 된다.

이 결합의 차이는 실무에서 바로 나타난다. 전략은 플러그인으로 뽑아 외부에서 등록할 수 있지만, 상태는 그러기 어렵다. 상태 하나를 새 파일로 추가해도 기존 상태 중 누군가가 그것을 가리켜야 도달 가능해지기 때문이다. **State는 열린 집합이 아니다.**

## 6. 어디에 박혀 있는가

**TCP 연결이 교과서적 사례다.** `LISTEN`, `SYN-SENT`, `ESTABLISHED`, `FIN-WAIT-1` 같은 상태에서 도착한 세그먼트에 대한 반응이 완전히 다르다. 같은 FIN 패킷이 `ESTABLISHED`에서는 종료 절차의 시작이고 `TIME-WAIT`에서는 재전송된 중복이다. 표준 문서가 이 규칙을 **상태 전이 표로** 싣는다는 사실 자체가 §2의 논지다 — 이 규칙은 산문으로 적히지 않는다.

**어휘 분석기와 프로토콜 파서.** 문자 하나를 받아 상태를 옮기는 기계이고, 문자열 리터럴 안인지 이스케이프 직후인지에 따라 같은 `"`가 다른 뜻이 된다. 이쪽은 전이 표(또는 표를 코드로 생성하는 도구)가 압도적으로 흔하다. 상태 수가 수백 개라 클래스로 만들 수 없기 때문이다.

**주문·결제·배송의 상태.** 이 도메인에서 상태 전이는 구현 세부가 아니라 **제품 요구 자체**다. "환불된 주문은 재배송할 수 없다"는 문장이 곧 격자의 빈칸 하나다. §4.2의 대조 코드가 그대로 회귀 테스트가 된다.

**CI 잡의 생명주기.** `queued` → `running` → `succeeded` / `failed` / `canceled`. 여기에 재시도가 붙으면 `failed`에서 `queued`로 돌아가는 간선이 생기고, 그 순간 종료 상태였던 것이 종료 상태가 아니게 된다. 상태 기계로 적어 두지 않으면 이런 변경이 코드 다섯 곳을 조용히 어긋나게 만든다.

**로봇 미션 실행기.** 대기 → 이동 → 작업 → 복귀에 오류 처리와 복구가 얽힌다. 상태가 늘고 계층이 생기는 쪽이라 [XI-6 상태 기계](#/xi-6)에서 계층적 상태 기계와 Behavior Tree로 이어진다. 교차로에서 여러 대가 통행권을 주고받는 상황은 [V-10 교착 검출과 회피](#/v-10)의 문제로 넘어간다 — 상태 기계 하나로는 두 대 사이의 교착을 막지 못한다.

## 7. 언제 쓰지 말아야 하는가

**상태 셋, 전이 둘이면 `if`가 낫다.** 클래스 다섯 개를 만드는 순간 파일이 다섯 개 늘고, 흐름을 읽으려면 파일 다섯 개를 오간다. `enum` 하나와 `switch` 하나로 끝나는 것을 패턴으로 감싸는 것은 손해다. 손익분기점은 대략 이렇다.

- 상태마다 **행동**이 다른가, 아니면 허용·거부만 다른가. 후자면 **표**로 충분하다.
- 상태마다 **자기 데이터**가 붙는가(재시도 횟수, 일시정지 시각). 붙으면 객체 쪽이다.
- **진입·퇴장 동작**이 있는가. 있으면 객체 쪽이다.
- 상태 수 × 이벤트 수가 스무 칸을 넘는가. 넘으면 어느 쪽이든 흩어진 `if`는 이미 실패다.

넷 중 하나도 해당하지 않으면 `enum` + `switch`가 정답이다. 두 개 이상이면 상태 객체다. 그 사이면 표다. **C++에서는 이 경계가 Python보다 오른쪽에 있다** — §4.3의 언어 차이 표가 보이듯 같은 여섯 상태에 코드가 두 배 가까이 들기 때문이다.

**상태가 직교하면 곱하지 마라.** 온라인 여부 × 실행 여부 × 편집 중 여부를 하나의 평면 상태로 만들면 상태가 여덟 개가 되고, 축이 하나 더 붙으면 열여섯 개가 된다. 이것이 상태 폭발이고, 처방은 상태를 더 만드는 것이 아니라 **축을 나누는 것**이다. 계층적 상태 기계나 병렬 상태로 가는 지점이고 [XI-6 상태 기계](#/xi-6)에서 다룬다.

**저장되는 것은 객체가 아니라 이름이다.** 상태 객체는 편하지만 데이터베이스와 API에 나가는 것은 `"paused"`라는 문자열 하나여야 한다. 객체는 그 문자열에서 복원되는 것이지 직렬화되는 것이 아니다. 이 선을 흐리면 상태 클래스 이름을 바꾸는 리팩터링이 곧 데이터 마이그레이션이 된다. §4.3이 `name`을 문자열로 들고 레지스트리를 이름으로 색인하는 이유다.

**진입 동작에 무거운 일을 넣지 마라.** `on_enter`에서 네트워크를 호출하면 상태 전이가 실패할 수 있게 된다. "전이는 성공했는데 진입 동작이 실패했다"는 상태는 표 어디에도 없다. 부수 효과는 전이 뒤에 별도로 큐에 넣는 편이 안전하고, 그 큐가 [XII-9 Command](#/xii-9)의 주제다.

## 연습

::: quiz
**1. 재시도가 붙은 CI 잡**
- 상황: `queued → running → succeeded/failed`로 도는 잡에 "실패하면 최대 3회까지 자동 재시도"가 붙는다.
- 무엇이 변하고 무엇이 고정인가: 상태 목록은 그대로다. 변하는 것은 `failed`가 더 이상 종료 상태가 아니라는 사실과, **재시도 횟수라는 데이터가 상태와 함께 다닌다**는 점이다.
- 어떤 구조이고 무엇을 대가로 치르는가: 전이 표에 `failed + retry → queued`를 넣는 것으로 시작하되, 횟수 조건은 표에 담기지 않는다. 표에 가드(조건)를 붙이거나 상태를 객체로 올려야 하고, 어느 쪽이든 **"표를 보면 전부 안다"는 성질이 깨진다**는 것이 대가다. 그 순간 격자 옆에 가드 목록을 함께 두어야 한다.

**2. 문서 편집기의 도구 모드**
- 상황: 선택 도구, 펜 도구, 지우개가 있고 클릭·드래그에 대한 반응이 각각 다르다. 도구는 툴바에서 고른다.
- 무엇이 변하고 무엇이 고정인가: 입력 이벤트의 종류가 고정이고 반응이 변한다. **다음 도구를 고르는 것은 사용자이지 현재 도구가 아니다.**
- 어떤 구조이고 무엇을 대가로 치르는가: 이것은 상태가 아니라 전략이다. 도구끼리 서로를 알 필요가 없고 전이 표도 없다. 여기에 상태 기계를 씌우면 존재하지 않는 전이 관계를 발명하게 된다. 단 펜 도구 안의 "누르는 중 / 뗀 상태"는 상태다 — **한 시스템 안에 둘이 겹쳐 있다.**

**3. 결제 상태와 외부 PG**
- 상황: `pending → paid → refunded`. 그런데 상태를 바꾸는 사건이 사용자 요청이 아니라 외부 결제사의 웹훅으로 온다. 웹훅은 순서가 뒤바뀌어 도착하기도 하고 같은 것이 두 번 오기도 한다.
- 무엇이 변하고 무엇이 고정인가: 전이 규칙은 고정이다. 변하는 것은 이벤트의 신뢰성이다.
- 어떤 구조이고 무엇을 대가로 치르는가: 전이 표는 그대로 두고 **거부를 오류로 취급하지 않는 것**이 핵심이다. 이미 `paid`인데 `paid` 웹훅이 또 오면 거부가 아니라 무시여야 한다(멱등). 격자에 "허용/거부" 두 값만 두면 이 요구를 표현할 수 없고, "허용/무시/거부" 세 값이 필요해진다. 상태 기계의 출력이 불리언 하나라는 가정이 여기서 깨진다.
:::

## 요약

- 상태 판정이 여러 함수에 흩어지면 상태를 하나 추가하는 일이 "사람이 전부 찾아 고치기"가 된다. 빠뜨려도 아무도 알려주지 않는다.
- **부정형 조건이 특히 위험하다.** `not in (...)`은 새 상태를 아무도 결정하지 않은 채 허용 쪽에 붙인다. §4.1의 구멍이 정확히 그것이었다.
- 전이 지식을 한 곳에 모으면 합법 전이가 **열거 가능**해지고, 요구사항 문서와 **기계로 대조** 가능해진다. 42칸 중 11칸이 열려 있다는 문장이 코드에서 직접 나온다.
- 표로 갈지 객체로 갈지는 **상태마다 행동이 다른가**로 갈린다. 허용·거부만 다르면 표, 진입 동작과 상태별 데이터가 있으면 객체다. 셋 이하의 상태에는 `enum` + `switch`가 낫다.
- 상태 객체를 쓰는 판이 **State** 패턴이다. 상태 객체는 공유되므로 오더별 데이터를 담으면 안 되고, 저장되는 것은 객체가 아니라 이름 문자열이다.
- **State와 Strategy는 구조가 같고 의도가 다르다.** 전략은 바깥에서 골라 넣고 스스로 바뀌지 않으며 서로를 모른다. 상태는 스스로 다음을 고르고 서로의 이름을 안다. "다음 것을 누가 정하는가"가 유일한 판별 기준이다.
- 축이 직교하면 상태를 곱하지 말고 나눠라. 그 방향이 [XI-6 상태 기계](#/xi-6)의 계층적 상태 기계다.

**다음 절**: [XII-9 Command](#/xii-9) — 상태를 바꾸는 **요청** 쪽을 본다. 요청을 객체로 만들면 큐에 넣고, 로그로 남기고, 되돌릴 수 있게 된다.
