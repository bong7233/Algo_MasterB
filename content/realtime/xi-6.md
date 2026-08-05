# XI-6 상태 기계

::: lead
"어느 상태에서든 비상정지는 먹어야 한다"를 상태마다 한 줄씩 적고 있다면, 상태를 하나 더 넣는 순간 무엇이 빠지는가.
:::

## 1. 문제

로봇 미션 실행기는 작업 오더를 받아 이동하고, 집고, 옮기고, 놓고, 돌아온다. 여기에 충전과 비상정지, 고장 처리가 붙는다. 상태는 여덟 개다.

```text nolines
idle  moving  picking  placing  returning  charging  estopped  faulted
```

이벤트는 아홉 개다.

```text nolines
order  arrived  grabbed  dropped  charge  charged  estop  error  clear
```

전이를 표로 적으면 $8 \times 9 = 72$칸이고, 그중 실제로 채워지는 것은 21칸이다. 21줄을 세어 보면 분포가 이상하다.

| 종류 | 줄 수 |
|---|---|
| 상태 고유 전이 (`order`, `arrived`, `grabbed`, …) | 9 |
| `estop` — 여섯 상태에서 전부 `estopped`로 | 6 |
| `error` — 여섯 상태에서 전부 `faulted`로 | 6 |

**전체의 57%가 같은 말을 반복한 줄이다.** 그리고 이 반복은 늘어난다. 바코드를 읽는 `scanning` 상태를 하나 넣으면 고유 전이 한 줄이 아니라 **세 줄**이 필요하다. 고유 전이 하나, `estop` 하나, `error` 하나.

문제는 줄 수가 아니라 **빠뜨렸을 때 아무도 알려주지 않는다는 것**이다. `scanning + estop` 줄을 잊으면 코드는 잘 돌고 테스트도 통과한다. 바코드를 읽는 0.5초 동안 비상정지 버튼이 안 먹을 뿐이다. 그 0.5초는 평소에 오지 않는다.

일반화하면 이렇다. 상태 $n$개와 이벤트 $m$개의 평평한 기계에서 전이가 놓일 자리는 $nm$개이고, **모든 상태에 공통인 이벤트가 $k$개면 그 이벤트만으로 $kn$줄이 든다.** 상태가 늘 때마다 $k$줄이 함께 늘고, 그 $k$줄은 새 상태를 추가하는 사람이 기억해서 써야 한다.

::: note
이 챕터는 [XII-8 State](#/xii-8)와 대상이 같고 묻는 것이 다르다. **XII-8은 "상태 판정을 코드 어디에 두는가"를 묻는 설계 이야기**다 — `if` 사슬을 다형성으로 대체하는 쪽이다. **XI-6은 "상태 기계를 무엇으로 만드는가"를 묻는 자료구조·실행 모델 이야기**다 — 전이를 2차원 배열에 담을지 딕셔너리에 담을지, 폭발한 전이를 계층으로 어떻게 접을지, 아예 전이를 없앨 수 있는지. XII-8을 읽었으면 §4로 바로 가도 된다.
:::

## 2. 접는다

평평한 기계부터 본다. 아래 위젯이 §1의 여덟 상태 · 아홉 이벤트 기계 전부다.

::: widget state-machine {
  "kind": "fsm",
  "title": "미션 실행기 (평평한 FSM)",
  "states": [
    {"id": "idle", "label": "idle", "initial": true},
    {"id": "moving", "label": "moving", "note": "주행 시작"},
    {"id": "picking", "label": "picking"},
    {"id": "placing", "label": "placing"},
    {"id": "returning", "label": "returning"},
    {"id": "charging", "label": "charging"},
    {"id": "estopped", "label": "estopped", "note": "주행 정지"},
    {"id": "faulted", "label": "faulted", "note": "주행 정지"}
  ],
  "events": ["order", "arrived", "grabbed", "dropped", "charge", "charged", "estop", "error", "clear"],
  "transitions": [
    {"from": "idle", "on": "order", "to": "moving"},
    {"from": "idle", "on": "charge", "to": "charging"},
    {"from": "moving", "on": "arrived", "to": "picking"},
    {"from": "picking", "on": "grabbed", "to": "placing"},
    {"from": "placing", "on": "dropped", "to": "returning"},
    {"from": "returning", "on": "arrived", "to": "idle"},
    {"from": "charging", "on": "charged", "to": "idle"},
    {"from": "estopped", "on": "clear", "to": "idle"},
    {"from": "faulted", "on": "clear", "to": "idle"},
    {"from": "idle", "on": "estop", "to": "estopped"},
    {"from": "moving", "on": "estop", "to": "estopped"},
    {"from": "picking", "on": "estop", "to": "estopped"},
    {"from": "placing", "on": "estop", "to": "estopped"},
    {"from": "returning", "on": "estop", "to": "estopped"},
    {"from": "charging", "on": "estop", "to": "estopped"},
    {"from": "idle", "on": "error", "to": "faulted"},
    {"from": "moving", "on": "error", "to": "faulted"},
    {"from": "picking", "on": "error", "to": "faulted"},
    {"from": "placing", "on": "error", "to": "faulted"},
    {"from": "returning", "on": "error", "to": "faulted"},
    {"from": "charging", "on": "error", "to": "faulted"}
  ],
  "script": ["order", "arrived", "estop", "grabbed", "clear", "order", "arrived", "grabbed", "dropped", "error", "clear"],
  "showMatrix": true,
  "showRejected": true
}
:::

위젯은 왼쪽에 상태 그래프를, 오른쪽에 $8 \times 9$ 격자를 나란히 띄운다. 스텝을 넘길 때마다 현재 상태가 옮겨 가고 격자에서 방금 조회한 칸이 켜진다. 표에 그 칸이 없으면 거부이고, 거부는 오류가 아니라 정상 동작이다 — 네 번째 스텝의 `grabbed`가 그것이다.

여기서 봐야 할 것은 격자의 **`estop` 열과 `error` 열**이다. 두 열이 위에서 아래까지 거의 꽉 차 있다. 그래프에서는 이 열두 개의 간선이 화살표 뭉치로 보여서 세기가 어렵지만, 격자에서는 열 하나가 통째로 채워진 모양으로 보인다. ==같은 규칙이 열두 번 적혀 있다는 사실이 격자에서만 눈에 띈다.==

접는 방법은 하나다. **상태들을 묶어 부모 상태를 만들고, 공통 전이를 부모에 한 번만 적는다.** 이것이 계층적 상태 기계다.

```text nolines
operational                          <- 부모. estop / error 를 여기 한 줄씩
  |
  +-- idle       order, charge
  +-- moving     arrived
  +-- picking    grabbed
  +-- placing    dropped
  +-- returning  arrived
  +-- charging   charged

estopped   clear                     <- 부모 밖. 비상정지 상태는 묶이지 않는다
faulted    clear
```

조회 규칙도 하나다. **자기 표에서 찾고, 없으면 부모 표에서 찾는다.** 이 한 줄이 계층 상태 기계 실행기의 전부다.

- 평평한 기계: 전이 **21줄**
- 계층 기계: 고유 9줄 + 부모 2줄 = **11줄**

`scanning`을 넣을 때 드는 줄도 달라진다. 평평한 쪽은 네 줄(들어오는 간선 하나를 고치고, 나가는 간선 하나, `estop` 하나, `error` 하나), 계층 쪽은 두 줄이다. **그리고 계층 쪽에서는 빠뜨릴 수 있는 줄이 없다.** `scanning`은 `operational`의 자식이므로 비상정지가 자동으로 걸린다. §1의 사고가 구조적으로 불가능해진다.

일반형으로 적으면 공통 이벤트 $k$개가 차지하는 줄이 평평에서 $kn$, 계층에서 $k$다. 지금 $k=2$, $n=6$이라 12줄 대 2줄이다.

## 3. 손으로 따라가기

::: trace
**계층 기계**를 이벤트 열에 따라 돌린다. 조회는 두 단계다 — 먼저 자기 상태의 표, 없으면 부모 `operational`의 표. 둘 다 없으면 거부이고 아무것도 바꾸지 않는다.

부모 표에 있는 것은 두 줄뿐이다: `estop -> estopped`, `error -> faulted`.

| 스텝 | 이벤트 | 현재 상태 | 자기 표 | 부모 표 | 다음 상태 |
|---|---|---|---|---|---|
| 0 | order | idle | 있음 → moving | 안 봄 | moving |
| 1 | arrived | moving | 있음 → picking | 안 봄 | picking |
| 2 | estop | picking | 없음 | **있음 → estopped** | estopped |
| 3 | grabbed | | | | |
| 4 | clear | | | | |
| 5 | order | | | | |
| 6 | arrived | | | | |

세 가지를 확인하라.

- [ ] 스텝 3에서 부모 표를 보는가. `estopped`의 부모는 무엇인가
- [ ] 부모 표까지 봤는데 없으면 어떻게 되는가. 상태가 바뀌는가
- [ ] 스텝 2를 **평평한 기계**로 하면 조회가 몇 번인가. 결과는 같은가
:::

::: answer
| 스텝 | 이벤트 | 현재 상태 | 자기 표 | 부모 표 | 다음 상태 |
|---|---|---|---|---|---|
| 0 | order | idle | 있음 → moving | 안 봄 | moving |
| 1 | arrived | moving | 있음 → picking | 안 봄 | picking |
| 2 | estop | picking | 없음 | **있음 → estopped** | estopped |
| 3 | grabbed | estopped | 없음 | **부모 없음** | estopped (거부) |
| 4 | clear | estopped | 있음 → idle | 안 봄 | idle |
| 5 | order | idle | 있음 → moving | 안 봄 | moving |
| 6 | arrived | moving | 있음 → picking | 안 봄 | picking |

스텝 3이 요점이다. `estopped`는 `operational`의 자식이 **아니다.** 그래서 부모 표를 볼 자리가 없고, 조회는 자기 표에서 끝난다. 이 배치가 규칙 하나를 표현한다 — ==비상정지 상태에서는 비상정지가 다시 걸리지 않는다.== 어디에도 그런 `if`를 쓰지 않았고, `estopped`를 부모 밖에 둔 것이 전부다.

**계층은 공통 전이를 모으는 장치이면서 동시에 예외를 표현하는 장치다.** 부모에 넣으면 전부에 적용되고, 부모 밖으로 빼면 그 상태만 면제된다. 평평한 기계에서 이 면제는 "그 줄을 안 쓴다"로 표현되는데, 안 쓴 것과 잊은 것이 코드에서 구별되지 않는다.

평평한 기계로 하면 스텝 2의 조회는 한 번이다. `(picking, estop)` 칸이 직접 채워져 있다. 결과는 같고 조회 횟수만 다르다. **접는 것은 표현의 문제이지 의미의 문제가 아니다** — §4의 코드가 이 등가성을 출력으로 확인한다.
:::

## 4. 구현

전이를 무엇에 담을지부터 정한다. 여기서는 **(상태 × 이벤트) 2차원 정수 배열**을 쓴다. 칸의 값이 도착 상태의 인덱스이고 빈칸은 `-1`이다. 이 표현을 고른 이유가 셋 있다.

- $nm$ 격자가 **문자 그대로** 배열이 된다. §1의 72칸이 코드에 그대로 있다.
- 조회가 인덱싱 두 번이라 진짜 $O(1)$이다. 해시도 비교도 없다.
- 두 언어에서 같은 모양이 나온다. 딕셔너리와 `switch`는 언어마다 갈리고, 그 차이는 코드 뒤 표에서 다룬다.

아래 코드는 평평한 표와 계층 표를 둘 다 만들고, **같은 이벤트 열에 대해 두 기계가 같은 상태 열을 내는지** 확인한다. 접기가 의미를 바꾸지 않았다는 것을 주장이 아니라 출력으로 보인다.

::: dual
```python title="평평한 FSM과 계층 FSM — 줄 수는 다르고 의미는 같다"
STATES = ["idle", "moving", "picking", "placing", "returning", "charging", "estopped", "faulted"]
EVENTS = ["order", "arrived", "grabbed", "dropped", "charge", "charged", "estop", "error", "clear"]

# 각 상태의 부모. 빈 문자열이면 부모가 없다.
PARENT = ["operational", "operational", "operational", "operational",
          "operational", "operational", "", ""]

# 상태 고유 전이 9줄. 두 기계가 공유한다.
OWN = [
    ("idle", "order", "moving"), ("idle", "charge", "charging"),
    ("moving", "arrived", "picking"), ("picking", "grabbed", "placing"),
    ("placing", "dropped", "returning"), ("returning", "arrived", "idle"),
    ("charging", "charged", "idle"),
    ("estopped", "clear", "idle"), ("faulted", "clear", "idle"),
]

# 평평한 기계는 공통 이벤트를 상태마다 한 줄씩 복제한다 — 이 12줄이 폭발의 정체다.
COPIED = [(s, e, t)
          for e, t in (("estop", "estopped"), ("error", "faulted"))
          for s in STATES[:6]]

# 계층 기계는 같은 12줄을 부모 상태 operational 의 2줄로 접는다.
GROUP = [("operational", "estop", "estopped"), ("operational", "error", "faulted")]

SCRIPT = ["order", "arrived", "estop", "grabbed", "clear",
          "order", "arrived", "grabbed", "dropped", "error", "clear"]


def index(xs, x):
    return xs.index(x)


def build(rows):
    """(상태 x 이벤트) 2차원 표. 빈칸은 -1 — 표에 없으면 거부다."""
    table = [[-1] * len(EVENTS) for _ in STATES]
    for f, e, t in rows:
        table[index(STATES, f)][index(EVENTS, e)] = index(STATES, t)
    return table


FLAT = build(OWN + COPIED)      # 21줄이 들어간 표
CHILD = build(OWN)              # 9줄만 들어간 표


def step(hier, s, e):
    """hier=False 면 평평한 조회 한 번. True 면 자기 표 → 부모 표 순으로 올라간다."""
    table = CHILD if hier else FLAT
    nxt = table[s][e]
    if nxt >= 0 or not hier:
        return nxt
    p = PARENT[s]
    while p:
        for pf, pe, pt in GROUP:
            if pf == p and pe == EVENTS[e]:
                return index(STATES, pt)
        p = ""                  # operational 위에는 부모가 없다
    return -1


def run(hier):
    cur = index(STATES, "idle")
    out = []
    for name in SCRIPT:
        nxt = step(hier, cur, index(EVENTS, name))
        if nxt >= 0:
            cur = nxt
            out.append(STATES[cur])
        else:
            out.append("(거부) " + STATES[cur])
    return out


seq_flat = run(False)
seq_hier = run(True)
cells = len(STATES) * len(EVENTS)

print(f"평평 FSM  전이 {len(OWN) + len(COPIED)}줄  "
      f"표 {len(STATES)}x{len(EVENTS)}={cells}칸 중 {len(OWN) + len(COPIED)}칸")
print(f"          그중 공통 이벤트(estop, error)를 복제한 줄 {len(COPIED)}")
print(f"계층 FSM  전이 {len(OWN) + len(GROUP)}줄  (고유 {len(OWN)} + 부모 {len(GROUP)})")
print(f"이벤트 {len(SCRIPT)}개에 대한 상태 열 일치: {seq_flat == seq_hier}")
print()
print("이벤트     상태")
for name, st in zip(SCRIPT, seq_flat):
    print(f"{name:<10} {st}")
print()
# 상태를 하나 더 넣으면 각각 몇 줄을 쓰는가: moving 과 picking 사이의 scanning
add_flat = 1 + 1 + len(GROUP)   # 고유 전이 1 + 들어오는 간선 1 + 공통 이벤트 복제 2
add_hier = 1 + 1                # 고유 전이 1 + 들어오는 간선 1. 공통은 부모가 이미 갖고 있다
print(f"scanning 을 넣으면  평평 +{add_flat}줄  계층 +{add_hier}줄")
print(f"상태가 n개일 때 공통 이벤트 k개가 차지하는 줄: 평평 k*n, 계층 k "
      f"(지금 k={len(GROUP)}, n=6 -> {len(GROUP) * 6} 대 {len(GROUP)})")
```
```cpp title="평평한 FSM과 계층 FSM — 줄 수는 다르고 의미는 같다"
#include <iomanip>
#include <iostream>
#include <string>
#include <tuple>
#include <vector>
using namespace std;

const vector<string> STATES = {"idle", "moving", "picking", "placing",
                               "returning", "charging", "estopped", "faulted"};
const vector<string> EVENTS = {"order", "arrived", "grabbed", "dropped", "charge",
                               "charged", "estop", "error", "clear"};

// 각 상태의 부모. 빈 문자열이면 부모가 없다.
const vector<string> PARENT = {"operational", "operational", "operational", "operational",
                               "operational", "operational", "", ""};

using Row = tuple<string, string, string>;

// 상태 고유 전이 9줄. 두 기계가 공유한다.
const vector<Row> OWN = {
    {"idle", "order", "moving"}, {"idle", "charge", "charging"},
    {"moving", "arrived", "picking"}, {"picking", "grabbed", "placing"},
    {"placing", "dropped", "returning"}, {"returning", "arrived", "idle"},
    {"charging", "charged", "idle"},
    {"estopped", "clear", "idle"}, {"faulted", "clear", "idle"},
};

// 평평한 기계는 공통 이벤트를 상태마다 한 줄씩 복제한다 — 이 12줄이 폭발의 정체다.
vector<Row> copied() {
    vector<Row> out;
    for (auto& [e, t] : vector<pair<string, string>>{{"estop", "estopped"}, {"error", "faulted"}})
        for (int s = 0; s < 6; s++) out.push_back({STATES[s], e, t});
    return out;
}
const vector<Row> COPIED = copied();

// 계층 기계는 같은 12줄을 부모 상태 operational 의 2줄로 접는다.
const vector<Row> GROUP = {{"operational", "estop", "estopped"},
                           {"operational", "error", "faulted"}};

const vector<string> SCRIPT = {"order", "arrived", "estop", "grabbed", "clear",
                               "order", "arrived", "grabbed", "dropped", "error", "clear"};

int index_of(const vector<string>& xs, const string& x) {
    for (int i = 0; i < (int)xs.size(); i++) if (xs[i] == x) return i;
    return -1;
}

// (상태 x 이벤트) 2차원 표. 빈칸은 -1 — 표에 없으면 거부다.
vector<vector<int>> build(const vector<Row>& rows) {
    vector<vector<int>> table(STATES.size(), vector<int>(EVENTS.size(), -1));
    for (auto& [f, e, t] : rows)
        table[index_of(STATES, f)][index_of(EVENTS, e)] = index_of(STATES, t);
    return table;
}

vector<Row> concat(vector<Row> a, const vector<Row>& b) {
    a.insert(a.end(), b.begin(), b.end());
    return a;
}

const vector<vector<int>> FLAT = build(concat(OWN, COPIED));   // 21줄이 들어간 표
const vector<vector<int>> CHILD = build(OWN);                  // 9줄만 들어간 표

// hier=false 면 평평한 조회 한 번. true 면 자기 표 → 부모 표 순으로 올라간다.
int step(bool hier, int s, int e) {
    const vector<vector<int>>& table = hier ? CHILD : FLAT;
    int nxt = table[s][e];
    if (nxt >= 0 || !hier) return nxt;
    string p = PARENT[s];
    while (!p.empty()) {
        for (auto& [pf, pe, pt] : GROUP)
            if (pf == p && pe == EVENTS[e]) return index_of(STATES, pt);
        p = "";                 // operational 위에는 부모가 없다
    }
    return -1;
}

vector<string> run(bool hier) {
    int cur = index_of(STATES, "idle");
    vector<string> out;
    for (const string& name : SCRIPT) {
        int nxt = step(hier, cur, index_of(EVENTS, name));
        if (nxt >= 0) { cur = nxt; out.push_back(STATES[cur]); }
        else out.push_back("(거부) " + STATES[cur]);
    }
    return out;
}

int main() {
    vector<string> seq_flat = run(false), seq_hier = run(true);
    size_t cells = STATES.size() * EVENTS.size();
    size_t flat_rows = OWN.size() + COPIED.size();

    cout << "평평 FSM  전이 " << flat_rows << "줄  표 " << STATES.size() << "x" << EVENTS.size()
         << "=" << cells << "칸 중 " << flat_rows << "칸\n";
    cout << "          그중 공통 이벤트(estop, error)를 복제한 줄 " << COPIED.size() << "\n";
    cout << "계층 FSM  전이 " << OWN.size() + GROUP.size() << "줄  (고유 " << OWN.size()
         << " + 부모 " << GROUP.size() << ")\n";
    cout << "이벤트 " << SCRIPT.size() << "개에 대한 상태 열 일치: "
         << (seq_flat == seq_hier ? "True" : "False") << "\n\n";

    cout << "이벤트     상태\n";
    for (size_t i = 0; i < SCRIPT.size(); i++)
        cout << left << setw(10) << SCRIPT[i] << " " << seq_flat[i] << "\n";
    cout << "\n";

    // 상태를 하나 더 넣으면 각각 몇 줄을 쓰는가: moving 과 picking 사이의 scanning
    size_t add_flat = 1 + 1 + GROUP.size();   // 고유 전이 1 + 들어오는 간선 1 + 공통 이벤트 복제 2
    size_t add_hier = 1 + 1;                  // 고유 전이 1 + 들어오는 간선 1. 공통은 부모가 이미 갖고 있다
    cout << "scanning 을 넣으면  평평 +" << add_flat << "줄  계층 +" << add_hier << "줄\n";
    cout << "상태가 n개일 때 공통 이벤트 k개가 차지하는 줄: 평평 k*n, 계층 k (지금 k="
         << GROUP.size() << ", n=6 -> " << GROUP.size() * 6 << " 대 " << GROUP.size() << ")\n";
}
```
:::

```console
평평 FSM  전이 21줄  표 8x9=72칸 중 21칸
          그중 공통 이벤트(estop, error)를 복제한 줄 12
계층 FSM  전이 11줄  (고유 9 + 부모 2)
이벤트 11개에 대한 상태 열 일치: True

이벤트     상태
order      moving
arrived    picking
estop      estopped
grabbed    (거부) estopped
clear      idle
order      moving

scanning 을 넣으면  평평 +4줄  계층 +2줄
상태가 n개일 때 공통 이벤트 k개가 차지하는 줄: 평평 k*n, 계층 k (지금 k=2, n=6 -> 12 대 2)
```

**복잡도:** 평평한 조회는 시간 $O(1)$ — 배열 인덱싱 두 번이고 그게 전부다. 계층 조회는 $O(d)$ — 부모 사슬을 최악 $d$단계 올라가고 단계마다 그 부모의 전이 목록을 훑는다. 여기서는 $d = 1$이라 상수와 구별되지 않는다. 공간은 평평·계층 모두 $O(nm)$ — 2차원 배열이 빈칸까지 자리를 잡기 때문이다. 채워진 칸이 21개뿐인데 72칸을 쓰는 것이 배열 표현의 대가이고, **희소한 큰 기계에서는 이 대가가 커져 딕셔너리로 간다.** 상태 300개 · 이벤트 100개면 3만 칸 중 대부분이 `-1`이다.

계층은 조회 비용을 조금 늘려 줄 수를 절반으로 줄인 것이다. 여기서 실제로 산 것은 줄 수가 아니라 **빠뜨릴 수 없다는 성질**이다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 2차원 표 | `[[-1] * m for _ in range(n)]`. 행마다 별도 리스트 객체이고 원소는 정수 객체 포인터다 | `vector<vector<int>>`도 행이 흩어진다. **`array<array<int, M>, N>`이면 한 덩어리**라 캐시에 통째로 올라간다. 상태 기계는 표가 작아 이 차이가 실제로 난다 |
| 딕셔너리 표현 | `{(state, event): next}`가 관용적이다. 희소한 표에서 메모리가 줄고 조회는 평균 $O(1)$ | `map`은 $O(\log n)$, `unordered_map`은 평균 $O(1)$이되 `pair` 해시를 직접 써야 한다. **정수 인덱스 배열이 있는데 굳이 갈 이유가 적다** |
| `switch` 표현 | `switch`가 없다. `if` 사슬이나 딕셔너리 디스패치로 대신한다 | `switch (state)` 안에 `switch (event)`. 컴파일러가 점프 테이블로 만들어 배열 조회와 같은 코드가 나온다. **다만 전이 규칙이 코드에 흩어져 열거가 불가능해진다** |
| 함수 포인터 표 | 함수도 객체라 `dict`에 그대로 넣는다 | `void (*)(Ctx&)` 배열, 또는 `std::function` 배열. 전자는 간접 호출 한 번, 후자는 힙 할당이 붙을 수 있어 실시간 경로에서 갈린다 |
| 상태 이름 | 문자열 그대로 쓰다가 인덱스로 바꾼다 | `enum class State : int`로 두면 인덱스와 이름이 하나가 되고, **`switch`에서 빠진 상태를 컴파일러가 경고한다**(`-Wswitch`) |
| 빈칸 표기 | `None`도 되지만 `-1`이 두 언어에서 같다 | `-1`. `optional<int>`도 되지만 배열이 커져 실익이 없다 |

::: pitfall
- **`switch` 안에 전이를 흩는 것.** 성능은 배열과 같지만 "지금 이 상태에서 무엇이 가능한가"를 물으면 코드를 읽어야 답이 나온다. 전이가 데이터가 아니라 제어 흐름이 되는 순간 [XII-8](#/xii-8) §4.1의 문제로 되돌아간다.
- **계층을 두 단계 넘게 쌓는 것.** 조회가 부모 사슬을 타고 올라가므로 어느 층에서 규칙이 잡혔는지 추적이 어려워진다. 두 단계면 대개 충분하고, 그 이상이 필요하면 축이 잘못 나뉜 것이다.
- **진입·퇴장 동작을 계층에서 잊는 것.** 자식에서 자식으로 옮길 때 부모의 진입 동작을 다시 실행할지 말지는 규칙으로 정해야 한다. 정하지 않으면 `moving → picking`에서 주행 모터를 껐다 켜는 코드가 생긴다.
- **직교하는 축을 상태로 곱하는 것.** "온라인 여부 × 실행 여부 × 편집 중"을 평평하게 펴면 상태가 여덟 개다. 축이 하나 더 붙으면 열여섯 개다. 처방은 상태를 더 만드는 것이 아니라 **축을 나누는 것**이고, 계층 또는 병렬 상태가 그 도구다.
- **거부를 예외로 만드는 것.** 표에 없으면 아무 일도 일어나지 않는 것이 정상이다. 예외를 던지면 웹훅이 두 번 오는 정도로 시스템이 멎는다.
:::

## 5. Behavior Tree

계층은 공통 전이를 줄인다. 줄이지 못하는 것이 하나 남는다. **"실패하면 어디로 돌아가는가"** 다.

미션 도중 물건을 못 잡으면 다시 시도해야 한다. 세 번 실패하면 고장으로 보고해야 한다. 배터리가 떨어지면 하던 일을 멈추고 충전소로 가야 하고, 충전이 끝나면 **하던 일을 이어서** 해야 한다. 이것을 FSM으로 적으면 상태마다 "여기서 실패하면 어디로"를 각각 써야 하고, 그 간선이 최악 $n^2$개로 자란다. 게다가 "집기 절차"를 다른 미션에서 재사용하려면 그 절차가 가진 바깥 간선을 전부 새 기계에 맞게 다시 그려야 한다. **FSM의 부품은 통째로 옮겨지지 않는다. 간선이 바깥을 가리키기 때문이다.**

Behavior Tree는 그 간선을 없앤다. 방법은 두 가지다.

**첫째, 전이 대신 트리 구조에 우선순위를 둔다.** 루트에서 왼쪽부터 훑어 내려가고, 먼저 만나는 것이 먼저다. 비상정지 검사를 트리 맨 왼쪽 위에 두면 **모든 상황에서 먼저 검사된다.** §1이 12줄로 적던 규칙이 여기서는 노드 하나다.

**둘째, 노드는 세 값만 돌려준다.** 성공(Success) · 실패(Failure) · 진행 중(Running). 부모가 그 값을 보고 다음을 정한다.

| 노드 | 자식을 어떻게 보는가 |
|---|---|
| Sequence | 왼쪽부터. 성공이면 다음으로, 아니면 그 값을 그대로 올린다. 전부 성공해야 성공 |
| Fallback | 왼쪽부터. 실패면 다음으로, 아니면 그 값을 그대로 올린다. 하나만 성공하면 성공 |
| Decorator | 자식 하나를 감싸 결과를 변형한다. 반복, 반전, 재시도, 타임아웃 |
| 잎(Action/Condition) | 실제로 무언가 하거나 참·거짓을 답한다 |

Sequence와 Fallback이 여러 자식을 같은 인터페이스로 합성하는 **Composite**이고, Decorator는 하나를 감싸 결과만 바꾸는 **Decorator**다. 이름이 같은 이유는 같은 것이기 때문이다 — [XII-4 Decorator / Composite](#/xii-4)가 그 구조를 다룬다. **Behavior Tree는 그 두 패턴으로 지은 인터프리터다.**

실행 모델은 **tick**이다. 정해진 주기마다 루트를 호출하고, 루트가 트리를 훑어 내려가 지금 할 일을 찾는다. 여기서 흔히 놓치는 것이 하나 있다.

> ==진행 상태는 트리가 아니라 블랙보드에 있다.== 매 tick 루트에서 다시 내려오는데도 하던 일을 이어 하는 이유는, "어디까지 했는가"가 세계의 상태(로봇 위치, 물건을 들었는지)로 표현되어 있기 때문이다.

아래 트리가 §1의 미션이다. 비상정지가 왼쪽 위 한 자리를 차지한다.

```text nolines
root (Fallback)
  |
  +-- Emergency (Sequence)
  |     +-- estop?      조건
  |     +-- Stop        아무것도 하지 않는다
  |
  +-- Mission (Fallback)
        +-- Deliver (Sequence)     hasItem? -> Move(8) -> Place
        +-- Fetch   (Sequence)     Move(4) -> Pick
```

::: dual
```python title="Behavior Tree — tick 기반 실행"
# 노드 = (이름, 종류, 인자, 자식 인덱스). 트리를 배열 하나로 들고 있으면
# 두 언어의 구조가 같아지고, tick 이 배열 인덱스 재귀가 된다.
NODES = [
    ("root",      "fallback", 0, [1, 4]),
    ("Emergency", "sequence", 0, [2, 3]),
    ("estop?",    "cond_estop", 0, []),
    ("Stop",      "act_stop", 0, []),
    ("Mission",   "fallback", 0, [5, 9]),
    ("Deliver",   "sequence", 0, [6, 7, 8]),
    ("hasItem?",  "cond_item", 0, []),
    ("Move(8)",   "act_move", 8, []),
    ("Place",     "act_place", 8, []),
    ("Fetch",     "sequence", 0, [10, 11]),
    ("Move(4)",   "act_move", 4, []),
    ("Pick",      "act_pick", 4, []),
]
TICKS = 14
PICKUP, DROP = 4, 8

pos = 0                 # 블랙보드: 진행 상태는 트리가 아니라 여기 있다
item = False
estop = False
path = []


def tick(i):
    """S=성공, F=실패, R=진행 중. 매 tick 루트에서 다시 내려온다."""
    global pos, item
    name, kind, arg, kids = NODES[i]
    if kind == "sequence":              # 하나라도 S 가 아니면 거기서 멈춘다
        for k in kids:
            r = tick(k)
            if r != "S":
                return r
        return "S"
    if kind == "fallback":              # 하나라도 F 가 아니면 거기서 멈춘다
        for k in kids:
            r = tick(k)
            if r != "F":
                return r
        return "F"
    if kind == "cond_estop":
        r = "S" if estop else "F"
    elif kind == "cond_item":
        r = "S" if item else "F"
    elif kind == "act_stop":
        r = "S"                         # 아무것도 하지 않는 것이 이 노드의 일이다
    elif kind == "act_move":
        if pos == arg:
            r = "S"
        else:
            pos += 1 if pos < arg else -1
            r = "S" if pos == arg else "R"
    elif kind == "act_pick":
        r = "F" if pos != PICKUP else "S"
        if r == "S":
            item = True
    else:                               # act_place
        r = "F" if pos != DROP else "S"
        if r == "S":
            item = False
    path.append(name + ":" + r)
    return r


print("tick estop pos item  방문한 잎" + " " * 29 + "root  방문 수")
visits = 0
for t in range(1, TICKS + 1):
    estop = 6 <= t <= 8
    path = []
    root = tick(0)
    visits += len(path)
    line = " ".join(path)
    print(f"{t:<5}{'E' if estop else '.':<6}{pos:<4}{'O' if item else '.':<6}"
          f"{line:<38}{root:<6}{len(path)}")
print(f"노드 {len(NODES)}개, {TICKS}tick 동안 잎 방문 {visits}회 "
      f"(tick 당 평균 {visits / TICKS:.1f})")
```
```cpp title="Behavior Tree — tick 기반 실행"
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>
using namespace std;

// 노드 = (이름, 종류, 인자, 자식 인덱스). 트리를 배열 하나로 들고 있으면
// 두 언어의 구조가 같아지고, tick 이 배열 인덱스 재귀가 된다.
struct Node { string name, kind; int arg; vector<int> kids; };
const vector<Node> NODES = {
    {"root",      "fallback",   0, {1, 4}},
    {"Emergency", "sequence",   0, {2, 3}},
    {"estop?",    "cond_estop", 0, {}},
    {"Stop",      "act_stop",   0, {}},
    {"Mission",   "fallback",   0, {5, 9}},
    {"Deliver",   "sequence",   0, {6, 7, 8}},
    {"hasItem?",  "cond_item",  0, {}},
    {"Move(8)",   "act_move",   8, {}},
    {"Place",     "act_place",  8, {}},
    {"Fetch",     "sequence",   0, {10, 11}},
    {"Move(4)",   "act_move",   4, {}},
    {"Pick",      "act_pick",   4, {}},
};
const int TICKS = 14;
const int PICKUP = 4, DROP = 8;

int pos = 0;            // 블랙보드: 진행 상태는 트리가 아니라 여기 있다
bool item = false;
bool estop = false;
vector<string> path;

// S=성공, F=실패, R=진행 중. 매 tick 루트에서 다시 내려온다.
string tick(int i) {
    const Node& nd = NODES[i];
    if (nd.kind == "sequence") {        // 하나라도 S 가 아니면 거기서 멈춘다
        for (int k : nd.kids) {
            string r = tick(k);
            if (r != "S") return r;
        }
        return "S";
    }
    if (nd.kind == "fallback") {        // 하나라도 F 가 아니면 거기서 멈춘다
        for (int k : nd.kids) {
            string r = tick(k);
            if (r != "F") return r;
        }
        return "F";
    }
    string r;
    if (nd.kind == "cond_estop") {
        r = estop ? "S" : "F";
    } else if (nd.kind == "cond_item") {
        r = item ? "S" : "F";
    } else if (nd.kind == "act_stop") {
        r = "S";                        // 아무것도 하지 않는 것이 이 노드의 일이다
    } else if (nd.kind == "act_move") {
        if (pos == nd.arg) {
            r = "S";
        } else {
            pos += (pos < nd.arg) ? 1 : -1;
            r = (pos == nd.arg) ? "S" : "R";
        }
    } else if (nd.kind == "act_pick") {
        r = (pos != PICKUP) ? "F" : "S";
        if (r == "S") item = true;
    } else {                            // act_place
        r = (pos != DROP) ? "F" : "S";
        if (r == "S") item = false;
    }
    path.push_back(nd.name + ":" + r);
    return r;
}

int main() {
    cout << "tick estop pos item  방문한 잎" << string(29, ' ') << "root  방문 수\n";
    int visits = 0;
    for (int t = 1; t <= TICKS; t++) {
        estop = (6 <= t && t <= 8);
        path.clear();
        string root = tick(0);
        visits += (int)path.size();
        string line;
        for (size_t j = 0; j < path.size(); j++) line += (j ? " " : "") + path[j];
        cout << left << setw(5) << t << setw(6) << (estop ? "E" : ".")
             << setw(4) << pos << setw(6) << (item ? "O" : ".")
             << setw(38) << line << setw(6) << root << path.size() << "\n";
    }
    printf("노드 %d개, %dtick 동안 잎 방문 %d회 (tick 당 평균 %.1f)\n",
           (int)NODES.size(), TICKS, visits, (double)visits / TICKS);
}
```
:::

```console
tick estop pos item  방문한 잎                             root  방문 수
1    .     1   .     estop?:F hasItem?:F Move(4):R         R     3
2    .     2   .     estop?:F hasItem?:F Move(4):R         R     3
3    .     3   .     estop?:F hasItem?:F Move(4):R         R     3
4    .     4   O     estop?:F hasItem?:F Move(4):S Pick:S  S     4
5    .     5   O     estop?:F hasItem?:S Move(8):R         R     3
6    E     5   O     estop?:S Stop:S                       S     2
7    E     5   O     estop?:S Stop:S                       S     2
8    E     5   O     estop?:S Stop:S                       S     2
9    .     6   O     estop?:F hasItem?:S Move(8):R         R     3
노드 12개, 14tick 동안 잎 방문 41회 (tick 당 평균 2.9)
```

**복잡도:** tick 하나가 최악 $O(N)$ — 노드 $N$개를 전부 방문하는 경우다. 실제로는 Sequence·Fallback이 조기 반환하므로 훨씬 적고, 위 실행에서는 잎 방문이 tick당 평균 2.9회였다(잎 6개 중). 공간은 트리 자체가 $O(N)$이고 실행 중 추가로 드는 것은 재귀 깊이 $O(h)$뿐이다 — **상태 변수가 없기 때문에 tick 사이에 남는 것이 없다.** 이것이 FSM과의 근본적인 비용 차이다. FSM은 현재 상태 정수 하나로 조회가 $O(1)$이고, BT는 매 tick 트리를 다시 내려온다. **BT는 조회 비용을 내고 전이를 없앤 것이다.**

출력에서 세 가지를 보라.

- **`estop?`가 모든 tick에 검사된다.** 여덟 상태 어디에 있든 예외 없다. §1이 12줄로 적던 규칙이 여기서는 트리 맨 위 노드 하나다.
- **tick 6~8에서 로봇이 멈춘다.** `pos`가 5에 고정되고 `Mission` 쪽은 아예 방문되지 않는다.
- **tick 9에서 `Move(8)`이 이어진다.** 미션을 처음부터 다시 하지 않는다. `pos=5`와 `item=O`가 블랙보드에 남아 있어서 트리가 그 지점을 다시 찾아낸다. **재개 로직을 아무 데도 쓰지 않았다.**

| 언어 차이 | Python | C++ |
|---|---|---|
| 노드 디스패치 | 종류 문자열로 분기했다. 실무에서는 `dict`에 함수를 담아 `HANDLERS[kind](node)`로 디스패치한다 | 같은 자리를 `enum` + `switch`, 또는 순수 가상 함수 `virtual Status tick()`이 채운다. 후자가 라이브러리에서 흔하다 |
| 트리 표현 | 배열 + 인덱스로 두면 두 언어가 같아진다. 파이썬만 쓴다면 중첩 리스트나 객체 그래프가 자연스럽다 | 배열 + 인덱스가 **캐시에 유리하다.** 노드마다 `new`로 흩으면 tick마다 포인터를 따라다닌다 |
| 블랙보드 | 모듈 전역 또는 `dict` 하나. 타입 검사는 없다 | `struct Blackboard`. 필드가 컴파일 시점에 확정되고, 실시간 경로라면 동적 할당이 없어야 한다 |
| 반환값 | 문자열 `"S"/"F"/"R"`로 두어 출력이 그대로 나온다 | 실무에서는 `enum class Status { Success, Failure, Running }`. **`switch`에서 빠뜨린 값을 컴파일러가 잡는다** |
| 재귀 깊이 | 기본 1000. 깊은 트리는 [0-2](#/0-2)의 `setrecursionlimit`가 필요하다 | 스택 한도까지. 실시간 경로에서는 깊이 상한을 정하고 반복으로 펴는 쪽이 안전하다 |

::: pitfall
- **진행 상태를 노드 안에 두는 것.** "몇 번째 자식까지 했다"를 Sequence가 기억하기 시작하면 그 순간 BT가 FSM이 된다. 상태는 블랙보드에 둔다. 기억하는 Sequence(memory node)가 필요한 경우가 있지만, **끼어들기가 일어났을 때 그 기억을 언제 지울지를 반드시 함께 정해야 한다.**
- **tick 안에서 블로킹하는 것.** tick은 매 주기 끝나야 한다. 잎에서 네트워크를 기다리면 그 주기 전체가 멈춘다. 오래 걸리는 일은 시작만 하고 `Running`을 돌려준 뒤 다음 tick에서 완료를 확인한다.
- **조건 노드에 부수 효과를 넣는 것.** 조건은 매 tick 여러 번 평가될 수 있다. 값을 바꾸면 tick 횟수에 따라 결과가 달라진다.
- **트리를 깊게 만드는 것.** tick 비용이 노드 수에 비례한다. 100Hz로 도는 미션 실행기에 노드 수천 개를 두면 그 자체가 [XI-5](#/xi-5)의 $C$가 된다.
- **BT를 상태 기계가 필요한 자리에 쓰는 것.** "지금 무슨 단계인지"를 바깥에 보고해야 하는 시스템(주문 상태, 연결 상태)에서 BT는 답이 없다. **BT에는 이름 붙은 현재 상태가 없다.**
:::

## 6. 어디에 박혀 있는가

**TCP 연결이 평평한 FSM의 교과서다.** `LISTEN`, `SYN-SENT`, `ESTABLISHED`, `FIN-WAIT-1` 같은 상태와 도착 세그먼트의 조합이 표준 문서에 상태 전이 표로 실린다. 상태 수가 열 몇 개로 고정이고 계층이 필요할 만큼 공통 이벤트가 많지 않아 평평한 표가 그대로 산다.

**어휘 분석기와 프로토콜 파서는 표가 아니면 불가능하다.** 상태가 수백 개라 손으로는 못 쓴다. 도구가 규칙에서 2차원 배열을 **생성**하고, 실행기는 §4의 `step` 한 줄이다.

**UI의 화면 전환과 제스처 인식이 계층적 상태 기계를 쓴다.** "어느 화면에 있든 뒤로 가기는 먹는다"가 §2의 부모 전이 한 줄이다. 화면을 추가할 때 그것을 다시 쓰지 않아도 되는 것이 그 구조의 값이다.

**게임 AI가 FSM에서 Behavior Tree로 옮겨 간 것이 이 챕터의 역사적 사건이다.** 적 캐릭터의 행동이 순찰·추적·공격·후퇴 넷일 때는 FSM이 낫다. 여기에 엄폐·재장전·회복·팀 신호가 붙으면 간선이 $n^2$로 자라고, "어떤 행동 중에도 체력이 낮으면 후퇴"를 모든 상태에 적어야 한다. BT에서는 그 규칙이 트리 왼쪽 위의 서브트리 하나다.

**로봇 미션 실행기도 같은 경로를 지났다.** BT 쪽이 이긴 이유는 성능이 아니라 **서브트리가 통째로 재사용되기 때문**이다. "물건 집기" 서브트리는 바깥으로 나가는 간선이 없어서 다른 미션 트리에 그대로 붙는다. FSM의 "picking 상태"는 그럴 수 없다 — 그 상태에서 나가는 간선이 원래 기계의 상태 이름을 알고 있다.

**작업 오더의 생명주기는 여전히 FSM이다.** `created → assigned → running → done`은 데이터베이스에 저장되고 API로 나가야 하는 값이다. 그 설계는 [XII-8 State](#/xii-8)가 다룬다.

## 7. 셋 중 무엇을 고르는가

| | 평평한 FSM | 계층 FSM | Behavior Tree |
|---|---|---|---|
| 현재 상태 | 정수 하나. 저장·전송 가능 | 정수 하나(+ 부모 정보) | **없다.** 블랙보드만 있다 |
| 조회 비용 | $O(1)$ | $O(d)$ | tick당 $O(N)$ |
| 공통 규칙 | 상태마다 복제, $kn$줄 | 부모에 한 줄, $k$줄 | 트리 위쪽 노드 하나 |
| 부품 재사용 | 어렵다. 간선이 바깥을 가리킨다 | 서브트리 단위로 어느 정도 | **쉽다.** 간선이 없다 |
| 실패·재시도 | 간선을 직접 그린다 | 같음 | Decorator 하나 |
| 잘 맞는 곳 | 프로토콜, 파서, 주문 상태 | UI 전환, 장비 모드 | 미션 실행기, 게임 AI |

판단 순서는 셋이다.

1. **현재 상태를 바깥에 이름으로 보고해야 하는가.** 그렇다면 FSM이다. BT에는 답할 이름이 없다.
2. **공통 이벤트가 상태마다 복제되고 있는가.** 그렇다면 계층으로 접는다. $k$가 2만 되어도 상태가 늘 때마다 두 줄씩 붙는다.
3. **"실패하면 다시" 와 "하던 일을 이어서"가 규칙의 절반 이상인가.** 그렇다면 BT다. 그것을 FSM으로 적으면 간선이 상태 수의 제곱으로 자란다.

셋은 배타적이지 않다. 실제 시스템은 대개 겹쳐 쓴다. 작업 오더의 생명주기는 FSM이고, 그 오더를 실행하는 미션 실행기는 BT다. 오더가 `running`인 동안 BT가 돌고, BT 루트가 성공을 돌려주면 오더에 `finish` 이벤트가 간다. **두 기계는 서로의 안쪽을 모른다.**

## 연습

::: quiz
**1. 배터리 부족을 어디에 넣는가**
- 상황: §2의 미션 실행기에 "배터리가 20% 아래면 하던 일을 멈추고 충전소로 간다"를 넣는다. 충전이 끝나면 중단한 지점부터 이어서 해야 한다.
- 무엇이 변하는가: 규칙 자체는 `estop`과 같은 모양이다 — 모든 작업 상태에서 같은 반응. 다른 것은 **되돌아올 곳을 기억해야 한다**는 점이다. `estop`은 이어서 할 필요가 없어서 `clear → idle` 한 줄로 끝났다.
- 어떤 구조이고 대가는 무엇인가: 계층 FSM에 넣으면 부모 전이 한 줄로 가지만, "어느 자식에서 왔는가"를 상태 밖 변수에 저장해야 한다. 그 변수가 상태와 어긋날 수 있다는 것이 대가다(이력 상태를 지원하는 계층 기계가 이 문제를 다룬다). BT라면 위치와 소지품이 이미 블랙보드에 있어 재개가 공짜이고, 대가는 "지금 충전 중"이라는 사실을 바깥에 보고할 이름이 없다는 것이다.

**2. 상태 300개짜리 프로토콜 파서**
- 상황: 바이트 하나마다 상태를 옮기는 파서. 상태 300개, 입력 심볼 256종.
- 무엇이 변하는가: 표가 $300 \times 256 = 76{,}800$칸이다. 채워진 칸은 그중 일부다. 그리고 이 조회가 바이트마다 일어난다.
- 어떤 구조이고 대가는 무엇인가: 조회 비용이 지배하므로 2차원 배열을 유지한다. `int` 대신 `int16_t`를 쓰면 표가 절반이 되어 캐시에 더 들어간다. 계층으로 접는 것은 여기서 손해다 — 바이트마다 부모 사슬을 타면 상수가 그대로 늘어난다. **$k$가 작고 조회가 잦으면 접지 않는 것이 옳다.**

**3. 서브트리를 재사용하려는데 조건이 다르다**
- 상황: "물건 집기" 서브트리를 두 미션에서 쓴다. 한쪽은 세 번까지 재시도하고, 다른 쪽은 한 번 실패하면 즉시 보고해야 한다.
- 무엇이 변하는가: 서브트리 내부는 그대로다. 변하는 것은 실패를 어떻게 다룰지뿐이다.
- 어떤 구조이고 대가는 무엇인가: 재시도 규칙을 서브트리 안에 넣지 말고 **Decorator로 감싼다**([XII-4](#/xii-4)). 한쪽은 `Retry(3)`으로, 다른 쪽은 그대로 붙인다. 대가는 트리가 한 단계 깊어지는 것이고, 얻는 것은 서브트리가 두 미션에서 **같은 파일 하나**로 남는다는 것이다. FSM에서 같은 요구를 처리하려면 재시도 횟수를 상태에 넣어 상태 수를 곱해야 한다.
:::

## 요약

- 평평한 FSM에서 상태 $n$개 · 이벤트 $m$개면 전이가 놓일 자리는 $nm$개이고, **모든 상태에 공통인 이벤트 $k$개는 그것만으로 $kn$줄을 차지한다.** §4의 기계에서 21줄 중 12줄이 그것이었다.
- 진짜 위험은 줄 수가 아니라 **새 상태를 넣을 때 그 $k$줄을 사람이 기억해야 한다는 것**이다. 빠뜨려도 아무도 알려주지 않는다.
- **계층 상태 기계**는 공통 전이를 부모에 한 번만 적는다. 21줄이 11줄이 되고, 조회는 "자기 표 → 부모 표"로 늘어난다. 접기가 의미를 바꾸지 않는다는 것은 §4가 출력으로 확인한다.
- 부모 밖에 두는 것이 곧 예외 표현이다. `estopped`를 `operational` 밖에 둔 것이 "비상정지 중에는 비상정지가 안 걸린다"의 전부다.
- 전이 표현은 **2차원 배열**($O(1)$ 조회, $O(nm)$ 공간), **딕셔너리**(희소한 표에 유리), **`switch`**(빠르지만 열거 불가)로 갈린다. C++에서는 `enum class` + `-Wswitch`가 빠진 상태를 컴파일러에 잡히게 한다.
- **Behavior Tree**는 전이를 없애고 트리 구조에 우선순위를 둔다. 노드는 성공·실패·진행 중 셋만 돌려주고, Sequence·Fallback이 Composite, 감싸는 노드가 Decorator다([XII-4](#/xii-4)).
- BT의 진행 상태는 트리가 아니라 **블랙보드**에 있다. 그래서 매 tick 루트에서 다시 내려와도 하던 일을 이어 하고, 서브트리가 통째로 재사용된다. 대가는 tick당 $O(N)$과 **이름 붙은 현재 상태가 없다는 것**이다.
- 이 챕터는 상태 기계를 무엇으로 만드는가를 다뤘다. 상태 판정을 코드 어디에 둘 것인가는 [XII-8 State](#/xii-8)다.

**다음 절**: [XI-7 이벤트 루프와 백프레셔](#/xi-7) — 상태 기계에 이벤트를 넣어 주는 쪽. 이벤트가 처리 속도보다 빨리 들어오면 무엇이 먼저 무너지는가.
