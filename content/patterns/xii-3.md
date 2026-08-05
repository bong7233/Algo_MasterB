# XII-3 Facade / Bridge / Proxy

::: lead
셋 다 무언가를 앞에 끼운다. 그런데 끼우는 이유가 서로 다르고, 그 차이가 전부다.
:::

## 1. 문제

세 가지 상황을 먼저 본다. 겉보기에는 셋 다 "호출부와 진짜 사이에 무언가를 하나 넣는" 이야기다.

### 상황 하나 — 순서를 아는 곳이 여럿이다

로그를 서버로 올리는 코드다. 순서가 정해져 있다. 세션 토큰을 얻고, 데이터를 압축하고, 압축된 덩어리를 토큰과 함께 보낸다.

```text nolines
  token = store.token()
  blob  = comp.pack(data)
  up.send(token, blob)
```

이 세 줄이 호출부 세 곳에 각각 복사되어 있다. 지금은 문제가 없다. 세 곳 다 같은 순서를 밟는다.

요구가 하나 는다. **보내기 전에 토큰을 갱신해야 한다.** 세 곳을 다 찾아 `store.refresh()`를 넣어야 하는데, 사람이 세 곳을 다 찾는 일은 자주 실패한다. 두 곳만 고쳐지면 나머지 한 곳은 만료된 토큰으로 계속 보낸다. **컴파일도 되고 테스트도 대부분 통과한다.** 서버가 가끔 401을 돌려주고, 원인은 "어떤 경로로 올렸느냐"에 달려 있다.

### 상황 둘 — 종류가 두 축으로 늘어난다

도형을 그리는 코드다. 도형이 원·사각형·삼각형 세 가지이고, 출력 방식이 SVG와 아스키 두 가지다. 조합마다 클래스를 하나씩 만들었다. `CircleSvg`, `CircleAscii`, `RectSvg`, `RectAscii`, `TriSvg`, `TriAscii` — 여섯 개다.

여기에 JSON 출력을 추가하라는 요구가 온다. **새로 써야 하는 클래스가 세 개다.** 도형이 하나 늘면 출력 방식 수만큼 늘고, 출력 방식이 하나 늘면 도형 수만큼 는다. 클래스 수가 두 축의 **곱**으로 자란다.

곱셈은 금방 감당이 안 된다. 도형 8종에 출력 6종이면 48개다. 그리고 이 48개 중 절반은 아무도 쓰지 않는다.

### 상황 셋 — 진짜가 비싸다

장비 보정 테이블이 100개 있다. 하나를 읽어 들이는 데 디스크 I/O가 필요하다. 프로그램 시작 시 전부 읽어 두면 시작이 느리고, 실제로 한 실행에서 쓰이는 것은 한두 개다.

그래서 호출부에서 "필요할 때 읽자"고 짠다. 그러면 호출부마다 `if table is None: table = load(...)`가 붙는다. 조회하는 곳이 열 곳이면 이 검사가 열 곳에 있고, 그중 한 곳에서 로드를 빠뜨리면 그 경로만 죽는다. **호출부가 진짜의 사정을 알게 되는 것이 문제다.**

---

세 상황은 같은 처방으로 보인다. "사이에 하나 넣는다." 그런데 넣는 것의 성질이 셋 다 다르다. 그 차이를 흐리면 셋을 구별하지 못한 채 셋 다 어설프게 쓰게 된다. **이 절의 본론은 그 구별이다.**

## 2. 무엇이 달라져야 하는가

세 상황에서 무엇이 변하고 무엇이 고정인지 나란히 적으면 갈라진다.

| | 상황 하나 | 상황 둘 | 상황 셋 |
|---|---|---|---|
| 변하는 것 | 절차의 단계와 순서 | 도형 축과 출력 축이 **각각 따로** | 자원을 언제 만드는가 |
| 고정된 것 | "데이터를 올린다"는 목적 | "도형을 그린다"는 연산 | 조회 인터페이스 |
| 끼우는 것의 인터페이스 | 뒤보다 **좁다** | 두 축을 **잇는다** | 뒤와 **똑같다** |
| 뒤에 직접 닿을 수 있는가 | 그렇다 | 그렇다 | 대개 아니다 |

마지막 두 행이 판별의 핵심이다.

**상황 하나에서 끼운 것은 인터페이스를 좁힌다.** 세션·압축·업로드라는 세 객체의 표면을 `upload(data)` 하나로 줄인다. 잃는 것은 세밀한 제어이고 얻는 것은 순서를 아는 곳이 하나로 줄어드는 것이다. **뒤의 세 객체는 여전히 살아 있고 필요하면 직접 부를 수 있다** — 이것이 중요하다. 창구는 길을 하나 더 놓는 것이지 문을 잠그는 것이 아니다.

**상황 둘에서 끼우는 것은 두 축을 잇는 고리다.** 도형이 출력 방식을 **들고** 있으면 조합마다 클래스를 만들 필요가 없다. 도형은 "무엇을 그릴지"만 알고, 출력 방식은 "어떻게 그릴지"만 안다. 산수가 이 결정의 전부다.

```text nolines
  shapes = m, backends = n

  combination classes : m * n        3 x 3 = 9,  8 x 6 = 48
  two separate axes   : m + n        3 + 3 = 6,  8 + 6 = 14
```

$m = 8$, $n = 6$이면 48 대 14다. 그리고 **증가율이 다르다.** 조합 방식에서 출력 방식을 하나 더하면 클래스가 $m$개 늘고, 축을 가른 방식에서는 1개 는다. ==$m \cdot n$과 $m + n$의 차이가 이 구조를 정당화하는 전부이고, 그래서 두 축이 실제로 둘 다 자랄 때만 정당하다.==

**상황 셋에서 끼우는 것은 진짜와 똑같은 얼굴을 한 대역이다.** 호출부는 `get(key)`를 부르고 그것이 진짜인지 대역인지 모른다. 인터페이스가 같기 때문에 호출부는 한 줄도 바뀌지 않는다. 대역은 그 뒤에서 "아직 안 만들었으면 지금 만든다"를 한 곳에서 처리한다. 인터페이스가 같다는 성질 하나가 이것을 앞의 둘과 갈라놓는다 — 좁히지도 않고, 잇지도 않고, **대신 선다.**

## 3. 구현

세 상황을 차례로 짠다. 매번 나쁜 판과 좋은 판을 한 프로그램에서 나란히 돌린다.

### 3.1 창구 하나로 줄이기

호출부 세 곳이 순서를 각자 아는 판(`site_*_v1`)과, 순서를 아는 곳이 하나뿐인 판(`upload_*`)이다. 요구가 늘었을 때 나쁜 판은 세 곳을 고쳐야 하는데 **두 곳만 찾은 상태**를 그대로 돌린다.

::: dual
```python title="업로드 절차 — 순서를 아는 곳이 셋인 판과 하나인 판"
class SessionStore:
    def __init__(self): self.fresh = False
    def refresh(self): self.fresh = True      # 만료된 토큰을 갱신한다
    def token(self):
        t = "t2" if self.fresh else "t1"      # t1 은 만료된 토큰이다
        self.fresh = False                    # 토큰은 한 번 쓰면 다시 만료된다
        return t


class Compressor:
    def pack(self, data): return f"[{data}]"


class Uploader:
    def send(self, token, blob): return f"sent(token={token}, blob={blob})"


store, comp, up = SessionStore(), Compressor(), Uploader()

# --- 나쁜 판: 호출부 세 곳이 각자 순서를 안다 ---
def site_a_v1(data): return up.send(store.token(), comp.pack(data))
def site_b_v1(data): return up.send(store.token(), comp.pack(data))
def site_c_v1(data): return up.send(store.token(), comp.pack(data))

# 요구가 늘어 세 곳을 다 찾아 고쳐야 하는데 두 곳만 찾았다
def site_a_v2(data): store.refresh(); return up.send(store.token(), comp.pack(data))
def site_b_v2(data): store.refresh(); return up.send(store.token(), comp.pack(data))
# site_c 에는 v2 가 없다

# --- 좋은 판: 순서를 아는 곳이 하나뿐이다 ---
def upload_v1(data): return up.send(store.token(), comp.pack(data))
def upload_v2(data): store.refresh(); return up.send(store.token(), comp.pack(data))

def site_good(send_one, data): return send_one(data)   # 호출부는 순서를 모른다

print("[1] 요구가 하나일 때 — 두 판이 같다")
for name, fn in (("A", site_a_v1), ("B", site_b_v1), ("C", site_c_v1)):
    print(f"  bad  {name}: {fn('log')}")
for name in ("A", "B", "C"):
    print(f"  good {name}: {site_good(upload_v1, 'log')}")

print("[2] '보내기 전에 토큰을 갱신하라' 는 요구가 늘었다")
print(f"  bad  A: {site_a_v2('log')}   고쳤다")
print(f"  bad  B: {site_b_v2('log')}   고쳤다")
print(f"  bad  C: {site_c_v1('log')}   못 찾았다 — 만료 토큰으로 보냈다")
for name in ("A", "B", "C"):
    print(f"  good {name}: {site_good(upload_v2, 'log')}   호출부는 한 줄도 안 고쳤다")

print("[3] 고쳐야 할 곳: bad 는 3곳(2곳만 찾음), good 은 1곳")
```
```cpp title="업로드 절차 — 순서를 아는 곳이 셋인 판과 하나인 판"
#include <functional>
#include <iostream>
#include <string>
using namespace std;

struct SessionStore {
    bool fresh = false;
    void refresh() { fresh = true; }          // 만료된 토큰을 갱신한다
    string token() {
        string t = fresh ? "t2" : "t1";       // t1 은 만료된 토큰이다
        fresh = false;                        // 토큰은 한 번 쓰면 다시 만료된다
        return t;
    }
};

struct Compressor {
    string pack(const string& data) { return "[" + data + "]"; }
};

struct Uploader {
    string send(const string& token, const string& blob) {
        return "sent(token=" + token + ", blob=" + blob + ")";
    }
};

SessionStore store; Compressor comp; Uploader up;

// --- 나쁜 판: 호출부 세 곳이 각자 순서를 안다 ---
string site_a_v1(const string& data) { return up.send(store.token(), comp.pack(data)); }
string site_b_v1(const string& data) { return up.send(store.token(), comp.pack(data)); }
string site_c_v1(const string& data) { return up.send(store.token(), comp.pack(data)); }

// 요구가 늘어 세 곳을 다 찾아 고쳐야 하는데 두 곳만 찾았다
string site_a_v2(const string& data) { store.refresh(); return up.send(store.token(), comp.pack(data)); }
string site_b_v2(const string& data) { store.refresh(); return up.send(store.token(), comp.pack(data)); }
// site_c 에는 v2 가 없다

// --- 좋은 판: 순서를 아는 곳이 하나뿐이다 ---
string upload_v1(const string& data) { return up.send(store.token(), comp.pack(data)); }
string upload_v2(const string& data) { store.refresh(); return up.send(store.token(), comp.pack(data)); }

string site_good(const function<string(const string&)>& send_one, const string& data) {
    return send_one(data);                    // 호출부는 순서를 모른다
}

int main() {
    cout << "[1] 요구가 하나일 때 — 두 판이 같다\n";
    cout << "  bad  A: " << site_a_v1("log") << "\n";
    cout << "  bad  B: " << site_b_v1("log") << "\n";
    cout << "  bad  C: " << site_c_v1("log") << "\n";
    for (const string& name : {string("A"), string("B"), string("C")})
        cout << "  good " << name << ": " << site_good(upload_v1, "log") << "\n";

    cout << "[2] '보내기 전에 토큰을 갱신하라' 는 요구가 늘었다\n";
    cout << "  bad  A: " << site_a_v2("log") << "   고쳤다\n";
    cout << "  bad  B: " << site_b_v2("log") << "   고쳤다\n";
    cout << "  bad  C: " << site_c_v1("log") << "   못 찾았다 — 만료 토큰으로 보냈다\n";
    for (const string& name : {string("A"), string("B"), string("C")})
        cout << "  good " << name << ": " << site_good(upload_v2, "log")
             << "   호출부는 한 줄도 안 고쳤다\n";

    cout << "[3] 고쳐야 할 곳: bad 는 3곳(2곳만 찾음), good 은 1곳\n";
    return 0;
}
```
:::

```console
[1] 요구가 하나일 때 — 두 판이 같다
  bad  A: sent(token=t1, blob=[log])
  bad  B: sent(token=t1, blob=[log])
  bad  C: sent(token=t1, blob=[log])
  good A: sent(token=t1, blob=[log])
  good B: sent(token=t1, blob=[log])
  good C: sent(token=t1, blob=[log])
[2] '보내기 전에 토큰을 갱신하라' 는 요구가 늘었다
  bad  A: sent(token=t2, blob=[log])   고쳤다
  bad  B: sent(token=t2, blob=[log])   고쳤다
  bad  C: sent(token=t1, blob=[log])   못 찾았다 — 만료 토큰으로 보냈다
  good A: sent(token=t2, blob=[log])   호출부는 한 줄도 안 고쳤다
  good B: sent(token=t2, blob=[log])   호출부는 한 줄도 안 고쳤다
  good C: sent(token=t2, blob=[log])   호출부는 한 줄도 안 고쳤다
```

**복잡도:** 호출 한 번의 시간·공간은 두 판이 같다. 시간 $O(s)$ — 단계 $s$개를 순서대로 밟을 뿐이고 창구는 그 호출을 한 겹 감쌀 뿐이다. 공간 $O(1)$ — 창구는 상태를 갖지 않는다.

**차이는 수정 지점의 개수에 있고 그것은 복잡도로 표현되지 않는다.** 절차가 한 단계 바뀔 때 나쁜 판은 호출부 $c$곳을 전부 열어야 하므로 수정 지점이 $O(c)$이고, 좋은 판은 $O(1)$이다. 출력의 `bad C`가 그 $O(c)$가 실패하는 장면이다 — 만료 토큰 `t1`으로 보냈고 아무도 예외를 보지 못했다.

### 3.2 두 축 가르기

조합마다 클래스를 만든 판과, 도형이 출력 방식을 들고 있는 판이다.

::: dual
```python title="도형 x 출력 — 조합마다 클래스를 만드는 판과 축을 가르는 판"
# --- 나쁜 판: 도형 x 렌더러 조합마다 클래스를 하나씩 만든다 ---
class CircleSvg:
    def draw(self): return '<circle size="2"/>'
class CircleAscii:
    def draw(self): return "circle:##"
class RectSvg:
    def draw(self): return '<rect size="3"/>'
class RectAscii:
    def draw(self): return "rect:###"
class TriSvg:
    def draw(self): return '<tri size="4"/>'
class TriAscii:
    def draw(self): return "tri:####"

COMBOS = {
    "circle/svg": CircleSvg(), "circle/ascii": CircleAscii(),
    "rect/svg": RectSvg(),     "rect/ascii": RectAscii(),
    "tri/svg": TriSvg(),       "tri/ascii": TriAscii(),
}

def draw_bad(key):
    obj = COMBOS.get(key)
    return obj.draw() if obj is not None else "<없는 조합>"


# --- 좋은 판: 두 축을 갈라 놓고 실행 시점에 잇는다 ---
class SvgRenderer:
    def render(self, name, size): return f'<{name} size="{size}"/>'
class AsciiRenderer:
    def render(self, name, size): return f"{name}:{'#' * size}"
class JsonRenderer:                          # 새 렌더러 — 이것 하나만 추가했다
    def render(self, name, size): return '{"shape":"%s","size":%d}' % (name, size)

class Shape:
    def __init__(self, renderer): self.renderer = renderer
class Circle(Shape):
    def draw(self): return self.renderer.render("circle", 2)
class Rect(Shape):
    def draw(self): return self.renderer.render("rect", 3)
class Tri(Shape):
    def draw(self): return self.renderer.render("tri", 4)

SHAPES = {"circle": Circle, "rect": Rect, "tri": Tri}
RENDERERS = {"svg": SvgRenderer(), "ascii": AsciiRenderer(), "json": JsonRenderer()}

def draw_good(key):
    name, backend = key.split("/")
    return SHAPES[name](RENDERERS[backend]).draw()


print("[1] 도형 3종 x 렌더러 2종 — 두 판이 같다")
for key in ("circle/svg", "rect/ascii", "tri/svg"):
    print(f"  bad  {key:12}: {draw_bad(key)}")
    print(f"  good {key:12}: {draw_good(key)}")

print("[2] json 렌더러 요구. 좋은 판은 렌더러 클래스 하나만 추가했다")
for key in ("circle/json", "rect/json", "tri/json"):
    print(f"  bad  {key:12}: {draw_bad(key)}")
    print(f"  good {key:12}: {draw_good(key)}")

m, n = len(SHAPES), len(RENDERERS)
print(f"[3] 도형 {m}종 x 렌더러 {n}종을 지원하려면 클래스가 몇 개 필요한가")
print(f"  bad  : {m} x {n} = {m * n}개. 지금 {len(COMBOS)}개뿐이라 {m * n - len(COMBOS)}개가 비어 있다")
print(f"  good : {m} + {n} = {m + n}개. 방금 늘어난 것은 렌더러 1개다")
print(f"  렌더러가 하나 더 늘면 bad 는 {m} x {n + 1} = {m * (n + 1)}개, good 은 {m} + {n + 1} = {m + n + 1}개")
```
```cpp title="도형 x 출력 — 조합마다 클래스를 만드는 판과 축을 가르는 판"
#include <functional>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <string>
using namespace std;

// --- 나쁜 판: 도형 x 렌더러 조합마다 클래스를 하나씩 만든다 ---
struct Drawable {
    virtual ~Drawable() = default;
    virtual string draw() const = 0;
};
struct CircleSvg : Drawable {
    string draw() const override { return "<circle size=\"2\"/>"; }
};
struct CircleAscii : Drawable {
    string draw() const override { return "circle:##"; }
};
struct RectSvg : Drawable {
    string draw() const override { return "<rect size=\"3\"/>"; }
};
struct RectAscii : Drawable {
    string draw() const override { return "rect:###"; }
};
struct TriSvg : Drawable {
    string draw() const override { return "<tri size=\"4\"/>"; }
};
struct TriAscii : Drawable {
    string draw() const override { return "tri:####"; }
};

map<string, unique_ptr<Drawable>> COMBOS;

string draw_bad(const string& key) {
    auto it = COMBOS.find(key);
    return it != COMBOS.end() ? it->second->draw() : "<없는 조합>";
}

// --- 좋은 판: 두 축을 갈라 놓고 실행 시점에 잇는다 ---
struct Renderer {
    virtual ~Renderer() = default;
    virtual string render(const string& name, int size) const = 0;
};
struct SvgRenderer : Renderer {
    string render(const string& name, int size) const override {
        return "<" + name + " size=\"" + to_string(size) + "\"/>";
    }
};
struct AsciiRenderer : Renderer {
    string render(const string& name, int size) const override {
        return name + ":" + string(size, '#');
    }
};
struct JsonRenderer : Renderer {             // 새 렌더러 — 이것 하나만 추가했다
    string render(const string& name, int size) const override {
        return "{\"shape\":\"" + name + "\",\"size\":" + to_string(size) + "}";
    }
};

struct Shape {
    shared_ptr<Renderer> renderer;
    explicit Shape(shared_ptr<Renderer> renderer) : renderer(move(renderer)) {}
    virtual ~Shape() = default;
    virtual string draw() const = 0;
};
struct Circle : Shape {
    using Shape::Shape;
    string draw() const override { return renderer->render("circle", 2); }
};
struct Rect : Shape {
    using Shape::Shape;
    string draw() const override { return renderer->render("rect", 3); }
};
struct Tri : Shape {
    using Shape::Shape;
    string draw() const override { return renderer->render("tri", 4); }
};

map<string, function<unique_ptr<Shape>(shared_ptr<Renderer>)>> SHAPES;
map<string, shared_ptr<Renderer>> RENDERERS;

string draw_good(const string& key) {
    size_t slash = key.find('/');
    string name = key.substr(0, slash), backend = key.substr(slash + 1);
    return SHAPES[name](RENDERERS[backend])->draw();
}

int main() {
    COMBOS["circle/svg"] = make_unique<CircleSvg>();
    COMBOS["circle/ascii"] = make_unique<CircleAscii>();
    COMBOS["rect/svg"] = make_unique<RectSvg>();
    COMBOS["rect/ascii"] = make_unique<RectAscii>();
    COMBOS["tri/svg"] = make_unique<TriSvg>();
    COMBOS["tri/ascii"] = make_unique<TriAscii>();

    SHAPES["circle"] = [](shared_ptr<Renderer> r) -> unique_ptr<Shape> { return make_unique<Circle>(move(r)); };
    SHAPES["rect"] = [](shared_ptr<Renderer> r) -> unique_ptr<Shape> { return make_unique<Rect>(move(r)); };
    SHAPES["tri"] = [](shared_ptr<Renderer> r) -> unique_ptr<Shape> { return make_unique<Tri>(move(r)); };
    RENDERERS["svg"] = make_shared<SvgRenderer>();
    RENDERERS["ascii"] = make_shared<AsciiRenderer>();
    RENDERERS["json"] = make_shared<JsonRenderer>();

    cout << "[1] 도형 3종 x 렌더러 2종 — 두 판이 같다\n";
    for (const string& key : {string("circle/svg"), string("rect/ascii"), string("tri/svg")}) {
        cout << "  bad  " << left << setw(12) << key << ": " << draw_bad(key) << "\n";
        cout << "  good " << left << setw(12) << key << ": " << draw_good(key) << "\n";
    }

    cout << "[2] json 렌더러 요구. 좋은 판은 렌더러 클래스 하나만 추가했다\n";
    for (const string& key : {string("circle/json"), string("rect/json"), string("tri/json")}) {
        cout << "  bad  " << left << setw(12) << key << ": " << draw_bad(key) << "\n";
        cout << "  good " << left << setw(12) << key << ": " << draw_good(key) << "\n";
    }

    int m = (int)SHAPES.size(), n = (int)RENDERERS.size();
    cout << "[3] 도형 " << m << "종 x 렌더러 " << n << "종을 지원하려면 클래스가 몇 개 필요한가\n";
    cout << "  bad  : " << m << " x " << n << " = " << m * n << "개. 지금 " << COMBOS.size()
         << "개뿐이라 " << m * n - (int)COMBOS.size() << "개가 비어 있다\n";
    cout << "  good : " << m << " + " << n << " = " << m + n << "개. 방금 늘어난 것은 렌더러 1개다\n";
    cout << "  렌더러가 하나 더 늘면 bad 는 " << m << " x " << n + 1 << " = " << m * (n + 1)
         << "개, good 은 " << m << " + " << n + 1 << " = " << m + n + 1 << "개\n";
    return 0;
}
```
:::

**복잡도:** 그리는 호출 자체는 두 판 다 시간 $O(1)$이다 — 조회 한 번에 호출 한두 번이고, 축을 가른 쪽은 도형에서 출력 방식으로 가는 위임 호출이 하나 더 붙을 뿐이다. **차수가 갈리는 것은 실행 시간이 아니라 코드의 크기다.** 조합 방식은 클래스 수가 $O(mn)$이고 축을 가른 방식은 $O(m + n)$이다. $m = 8$, $n = 6$이면 48 대 14이고, 축 하나가 늘어날 때 각각 $m$개와 1개가 늘어난다.

`[2]`의 출력이 곱셈의 대가다. 나쁜 판은 세 조합에서 `<없는 조합>`을 돌려준다 — 클래스 세 개를 더 쓰기 전까지 그 조합은 존재하지 않는다. 좋은 판은 렌더러 클래스 하나로 세 조합이 동시에 살아난다.

두 언어의 출력은 한 글자도 다르지 않다.

```console
[1] 도형 3종 x 렌더러 2종 — 두 판이 같다
  bad  circle/svg  : <circle size="2"/>
  good circle/svg  : <circle size="2"/>
  bad  rect/ascii  : rect:###
  good rect/ascii  : rect:###
  bad  tri/svg     : <tri size="4"/>
  good tri/svg     : <tri size="4"/>
[2] json 렌더러 요구. 좋은 판은 렌더러 클래스 하나만 추가했다
  bad  circle/json : <없는 조합>
  good circle/json : {"shape":"circle","size":2}
  bad  rect/json   : <없는 조합>
  good rect/json   : {"shape":"rect","size":3}
  bad  tri/json    : <없는 조합>
  good tri/json    : {"shape":"tri","size":4}
[3] 도형 3종 x 렌더러 3종을 지원하려면 클래스가 몇 개 필요한가
  bad  : 3 x 3 = 9개. 지금 6개뿐이라 3개가 비어 있다
  good : 3 + 3 = 6개. 방금 늘어난 것은 렌더러 1개다
  렌더러가 하나 더 늘면 bad 는 3 x 4 = 12개, good 은 3 + 4 = 7개
```

### 3.3 같은 얼굴로 대신 서기

전부 미리 만드는 판과, 처음 쓰일 때 만드는 대역이다. **`get`의 모양은 두 판이 같고, 호출부 `lookup`은 둘을 구별하지 못한다.**

::: dual
```python title="보정 테이블 — 전부 미리 만드는 판과 처음 쓰일 때 만드는 대역"
LOADS = 0


def load_table(name):                        # 무거운 자원 — 디스크에서 통째로 읽는다고 하자
    global LOADS
    LOADS += 1
    return {"k": name + "!"}


class RealTable:                             # 진짜. 만들어지는 순간 로드한다
    def __init__(self, name): self.data = load_table(name)
    def get(self, k): return self.data[k]


class LazyTable:                             # 대역. get 의 모양이 진짜와 똑같다
    def __init__(self, name): self.name, self.real = name, None
    def get(self, k):
        if self.real is None:
            self.real = RealTable(self.name)  # 처음 쓰일 때 비로소 만든다
        return self.real.get(k)


def lookup(tables, i, k):                    # 호출부. 진짜인지 대역인지 알지 못한다
    return tables[i].get(k)


def run(cls, count):
    global LOADS
    LOADS = 0
    tables = [cls(f"T{i}") for i in range(count)]
    v = lookup(tables, 0, "k")               # 조회를 먼저 하고 그 뒤에 로드 횟수를 읽는다
    return LOADS, v


print("[1] 표 3개를 준비하고 그중 하나만 조회한다")
n, v = run(RealTable, 3); print(f"  eager : 로드 {n}회, 값 {v}")
n, v = run(LazyTable, 3); print(f"  lazy  : 로드 {n}회, 값 {v}")

print("[2] 표가 100개로 늘었다. 조회하는 것은 여전히 하나다")
n, v = run(RealTable, 100); print(f"  eager : 로드 {n}회, 값 {v}")
n, v = run(LazyTable, 100); print(f"  lazy  : 로드 {n}회, 값 {v}")

print("[3] 대역은 언제 로드하는가")
LOADS = 0
tables = [LazyTable(f"T{i}") for i in range(100)]
print(f"  대역 100개를 만든 직후 : 로드 {LOADS}회")
lookup(tables, 0, "k")
print(f"  get 을 한 번 부른 뒤   : 로드 {LOADS}회")
lookup(tables, 0, "k"); lookup(tables, 0, "k")
print(f"  같은 것을 두 번 더     : 로드 {LOADS}회")
```
```cpp title="보정 테이블 — 전부 미리 만드는 판과 처음 쓰일 때 만드는 대역"
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>
using namespace std;

int LOADS = 0;

map<string, string> load_table(const string& name) {  // 무거운 자원 — 디스크에서 통째로 읽는다고 하자
    LOADS += 1;
    return {{"k", name + "!"}};
}

struct Table {
    virtual ~Table() = default;
    virtual string get(const string& k) = 0;
};

struct RealTable : Table {                   // 진짜. 만들어지는 순간 로드한다
    map<string, string> data;
    explicit RealTable(const string& name) : data(load_table(name)) {}
    string get(const string& k) override { return data[k]; }
};

struct LazyTable : Table {                   // 대역. get 의 모양이 진짜와 똑같다
    string name;
    unique_ptr<RealTable> real;
    explicit LazyTable(const string& name) : name(name) {}
    string get(const string& k) override {
        if (!real)
            real = make_unique<RealTable>(name);  // 처음 쓰일 때 비로소 만든다
        return real->get(k);
    }
};

string lookup(vector<unique_ptr<Table>>& tables, int i, const string& k) {
    return tables[i]->get(k);                // 호출부. 진짜인지 대역인지 알지 못한다
}

pair<int, string> run(const function<unique_ptr<Table>(const string&)>& cls, int count) {
    LOADS = 0;
    vector<unique_ptr<Table>> tables;
    for (int i = 0; i < count; i++) tables.push_back(cls("T" + to_string(i)));
    string v = lookup(tables, 0, "k");       // 조회를 먼저 하고 그 뒤에 로드 횟수를 읽는다
    return {LOADS, v};
}

int main() {
    auto real = [](const string& n) -> unique_ptr<Table> { return make_unique<RealTable>(n); };
    auto lazy = [](const string& n) -> unique_ptr<Table> { return make_unique<LazyTable>(n); };

    cout << "[1] 표 3개를 준비하고 그중 하나만 조회한다\n";
    auto [n1, v1] = run(real, 3); cout << "  eager : 로드 " << n1 << "회, 값 " << v1 << "\n";
    auto [n2, v2] = run(lazy, 3); cout << "  lazy  : 로드 " << n2 << "회, 값 " << v2 << "\n";

    cout << "[2] 표가 100개로 늘었다. 조회하는 것은 여전히 하나다\n";
    auto [n3, v3] = run(real, 100); cout << "  eager : 로드 " << n3 << "회, 값 " << v3 << "\n";
    auto [n4, v4] = run(lazy, 100); cout << "  lazy  : 로드 " << n4 << "회, 값 " << v4 << "\n";

    cout << "[3] 대역은 언제 로드하는가\n";
    LOADS = 0;
    vector<unique_ptr<Table>> tables;
    for (int i = 0; i < 100; i++) tables.push_back(make_unique<LazyTable>("T" + to_string(i)));
    cout << "  대역 100개를 만든 직후 : 로드 " << LOADS << "회\n";
    lookup(tables, 0, "k");
    cout << "  get 을 한 번 부른 뒤   : 로드 " << LOADS << "회\n";
    lookup(tables, 0, "k"); lookup(tables, 0, "k");
    cout << "  같은 것을 두 번 더     : 로드 " << LOADS << "회\n";
    return 0;
}
```
:::

```console
[1] 표 3개를 준비하고 그중 하나만 조회한다
  eager : 로드 3회, 값 T0!
  lazy  : 로드 1회, 값 T0!
[2] 표가 100개로 늘었다. 조회하는 것은 여전히 하나다
  eager : 로드 100회, 값 T0!
  lazy  : 로드 1회, 값 T0!
[3] 대역은 언제 로드하는가
  대역 100개를 만든 직후 : 로드 0회
  get 을 한 번 부른 뒤   : 로드 1회
  같은 것을 두 번 더     : 로드 1회
```

**복잡도:** 표 $n$개 중 실제로 쓰이는 것이 $u$개일 때 미리 만드는 판은 로드 $O(n)$회에 메모리 $O(n)$이고, 대역은 로드 $O(u)$회에 메모리 $O(u)$다. 근거는 `[3]`에 있다 — 대역은 생성 시점에 아무것도 하지 않고 첫 `get`에서 한 번만 만들며, 그 뒤 호출은 이미 만든 것을 재사용해 로드가 늘지 않는다. 조회 자체는 두 판 다 $O(1)$이고, 대역은 "이미 만들었는가" 검사 한 번이 상수로 붙는다.

`[2]`가 $O(n)$과 $O(u)$의 차이다. 표가 100개로 늘어도 대역의 로드는 1회에 머문다. 그리고 `[3]`이 이 구조의 대가를 같이 보여 준다 — **로드는 생성이 아니라 첫 `get`에서 일어난다.** 값싸 보이는 조회 한 번이 디스크 I/O를 일으킨다는 뜻이고, 뒤에서 다시 다룬다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 인터페이스 | 덕 타이핑. `get`만 있으면 한 목록에 담긴다 | 순수 가상 `Table`이 있어야 `vector`에 함께 담긴다 |
| 아직 없음 표현 | `None` | `unique_ptr`가 비어 있음(`!real`). 소유권이 함께 표현된다 |
| 좁히는 창구 | 함수 하나면 된다. 클래스가 필요 없다 | 자유 함수로 충분하지만 상태를 들면 클래스가 된다 |
| 두 축 잇기 | `Shape`가 렌더러를 속성으로 든다. 타입 제약 없음 | `shared_ptr<Renderer>`로 **공유 소유**를 명시해야 한다 |
| 조합 클래스 등록 | 클래스 객체를 그대로 `dict`에 넣는다 | 클래스는 값이 아니다. 생성 람다를 `function`으로 감싼다 |
| 소멸 | 자동 | 기반 클래스에 가상 소멸자가 없으면 파생 소멸자가 안 불린다 |

::: danger
`[3]`의 마지막 두 줄이 실무에서 가장 자주 사고를 낸다. 대역은 진짜와 인터페이스가 같기 때문에 **성능 특성에 대해 거짓말을 한다.** 호출부는 `get`이 메모리 조회라고 믿는데 실제로는 첫 호출에서 디스크나 네트워크로 나간다.

ORM의 N+1 문제가 정확히 이 구조다. 주문 100건을 불러온 뒤 `order.customer.name`을 순회하면 그 접근 하나하나가 쿼리 한 번을 낸다. 코드에는 속성 접근만 보이고 쿼리는 보이지 않는다. 루프 안에서 이런 접근을 하면 쿼리가 100번 나가고, 그 사실은 프로파일러나 쿼리 로그를 켜기 전까지 드러나지 않는다.

방어는 둘이다. **대역이 언제 진짜를 만드는지를 이름이나 문서로 드러내고**, 루프 앞에서 필요한 것을 한 번에 가져오는 경로를 따로 둔다. 지연 로딩 자체가 나쁜 것이 아니라 **지연 로딩인 줄 모르고 루프를 도는 것이 나쁘다.**
:::

## 4. 이제 이름을 붙인다

셋에 이름을 붙인다.

| | 이름 | 한 문장 | 인터페이스 | 뒤에 직접 닿는가 |
|---|---|---|---|---|
| 3.1 | **Facade** | 여러 개를 하나의 좁은 창구로 줄인다 | 뒤보다 **좁다** | 닿는다 |
| 3.2 | **Bridge** | 추상 축과 구현 축을 갈라 곱셈을 덧셈으로 만든다 | 두 축을 **잇는다** | 해당 없음 |
| 3.3 | **Proxy** | 진짜와 같은 얼굴로 대신 선다 | 뒤와 **같다** | 대개 아니다 |

**Facade의 판별 기준은 "좁아졌는가"다.** 창구가 서브시스템의 메서드를 그대로 다 노출하면 그것은 파사드가 아니라 위임 계층이다. 그리고 파사드는 뒤를 잠그지 않는다 — 세밀한 제어가 필요한 호출부는 여전히 세션·압축·업로더를 직접 부를 수 있다. **파사드는 편한 길을 하나 더 놓는 것이지 유일한 길을 만드는 것이 아니다.**

**Bridge의 판별 기준은 축이 둘이라는 것이다.** GoF의 표현으로는 *추상과 구현을 분리해 둘이 독립적으로 변할 수 있게 한다*이고, 여기서 "구현"은 상속의 구현이 아니라 **두 번째 축**을 뜻한다. 이 이름이 헷갈리는 이유가 그 단어에 있다. 축의 개수로 보면 흔들리지 않는다 — 축이 하나면 Bridge가 아니다.

**Proxy의 판별 기준은 인터페이스가 같다는 것 하나다.** 무엇을 대신하느냐에 따라 종류가 갈린다. 처음 쓰일 때 만드는 **가상 프록시**(3.3의 예제), 다른 프로세스·다른 기계의 객체를 대신하는 **원격 프록시**, 권한을 검사하는 **보호 프록시**, 결과를 기억하는 **캐싱 프록시**다. 넷 다 인터페이스는 진짜와 같다.

::: note
[XII-2 Adapter](#/xii-2)까지 넷을 한 줄로 가른다. **네 패턴 모두 호출부와 진짜 사이에 무언가를 끼우지만 인터페이스의 관계가 다르다.**

| 패턴 | 끼운 것의 인터페이스 |
|---|---|
| Adapter | 뒤와 **다르다**. 호출부가 원하는 모양으로 바꾼다 |
| Facade | 뒤보다 **좁다**. 여러 개를 하나로 줄인다 |
| Proxy | 뒤와 **같다**. 대신 서는 것이 목적이다 |
| Decorator | 뒤와 **같다**. 기능을 얹는 것이 목적이다([XII-4](#/xii-4)) |

Proxy와 Decorator는 인터페이스가 같다는 점에서 구조가 거의 같고, 갈리는 것은 의도다. 프록시는 **접근을 통제**하고 데코레이터는 **책임을 추가**한다. 프록시는 대개 진짜의 수명까지 관리하고, 데코레이터는 밖에서 받은 것을 감싸기만 한다.
:::

**언어가 이 셋을 어떻게 바꾸는가.** Facade는 Python에서 함수 하나로 접힌다 — 3.1의 좋은 판이 클래스가 아니라 `upload`라는 함수인 것이 그 증거이고, C++에서도 자유 함수로 충분하다. Bridge는 접히지 않는다. 두 축이 실재하고 각 축의 종류가 실재하므로 어느 언어에서든 클래스 수는 $m + n$개다. Proxy는 언어가 지원을 준다 — Python은 `__getattr__`로 위임을 자동화할 수 있고, C++에는 그런 장치가 없어 인터페이스의 모든 메서드를 손으로 위임해야 한다. **메서드가 많은 인터페이스의 프록시는 C++에서 실제로 비싸고, 그 비용이 프록시를 얇게 유지하라는 압력이 된다.**

## 5. 어디에 박혀 있는가

**Facade는 라이브러리의 얼굴이다.** Python의 `requests`가 `urllib3` 위에 놓인 파사드다. 커넥션 풀, 재시도, 인코딩 협상, 쿠키 처리를 `requests.get(url)` 하나로 줄인다. 그리고 뒤를 잠그지 않는다 — 세밀한 제어가 필요하면 `urllib3`을 직접 쓸 수 있다. 파사드의 성질이 그대로 보이는 사례다. 운영체제의 시스템 콜 래퍼도 같은 자리에 있다. `fopen`은 파일 디스크립터·버퍼·시스템 콜을 하나의 창구로 줄인다.

**Bridge는 백엔드를 갈아 끼우는 자리에 있다.** Python의 `logging`이 그 예다. `Logger`가 추상 축이고 `Handler`가 구현 축이다. 로거는 "이 메시지를 이 수준으로 남긴다"만 알고, 핸들러는 "파일에 쓴다 / 소켓으로 보낸다 / 회전시킨다"만 안다. 로거 종류가 $m$개이고 출력 대상이 $n$개여도 클래스는 $m + n$개다. `FileLogger`, `SocketLogger`, `RotatingFileLogger`가 따로 존재했다면 곱셈이었을 것이다. GUI 툴킷의 위젯과 플랫폼 백엔드, 그래픽 API 추상화 계층도 같은 구조다.

**Proxy는 경계마다 있다.** RPC 스텁이 원격 프록시다 — 호출부는 지역 객체의 메서드를 부르고, 스텁이 직렬화·전송·역직렬화를 대신한다. gRPC의 생성된 클라이언트 코드가 그것이다. ORM의 지연 로딩 관계가 가상 프록시이고, 리버스 프록시와 CDN이 캐싱 프록시다. **운영체제의 요구 페이징도 같은 발상이다** — 매핑된 메모리는 진짜 메모리와 같은 얼굴을 하고 있고, 처음 접근할 때 페이지 폴트가 나서 그때 비로소 물리 페이지가 붙는다. 3.3의 `LazyTable`이 커널에서 하는 일과 구조가 같다.

## 6. 언제 쓰지 말아야 하는가

**Facade — 좁히지 않으면 파사드가 아니다.** 서브시스템의 메서드를 하나씩 그대로 전달하는 클래스는 파사드가 아니라 중복이다. 뒤가 바뀔 때 창구도 같이 바뀌므로 수정 지점이 오히려 늘어난다. 그리고 파사드는 God Object로 자라기 쉽다 — 호출부가 "이것도 창구를 통해 하고 싶다"고 요구할 때마다 메서드가 하나씩 붙고, 몇 달 뒤에는 서브시스템 전체를 다시 노출하는 거대 클래스가 된다. 판정은 셈으로 한다. **창구의 메서드 수가 뒤의 메서드 수에 가까워지면 그것은 이미 파사드가 아니다.** 이 경로는 [XII-15 안티패턴](#/xii-15)에서 다시 다룬다.

**Bridge — 축이 하나면 비용만 남는다.** 두 축을 가르는 근거는 $m \cdot n$과 $m + n$의 차이인데, $n = 1$이면 $m \cdot 1 = m$이고 $m + 1$이 오히려 더 크다. **출력 방식이 하나뿐인데 렌더러 인터페이스를 뽑았다면 클래스가 하나 늘고 호출이 한 겹 깊어졌을 뿐이다.** [XII-1 §2](#/xii-1)의 기준이 여기서 두 번 적용된다 — 두 축 **각각**이 자랄 근거가 있어야 한다. 한 축만 자란다면 필요한 것은 축 분리가 [XII-6 Strategy](#/xii-6)다.

**Proxy — 같은 얼굴이 거짓말이 될 때.** §3.3의 `::: danger`가 그것이다. 프록시는 인터페이스가 같기 때문에 호출부가 비용을 예측할 수 없다. 지연 로딩·원격 호출·캐시 미스가 전부 평범한 메서드 호출로 보인다. 실시간 경로에서 이것은 위험하다 — 제어 주기 안에서 도는 코드가 네트워크로 나가는지 알 수 없기 때문이다. 경계는 이렇게 그으면 된다. **비용이 자릿수 단위로 달라지는 것을 같은 인터페이스 뒤에 숨기지 마라.** 원격 호출은 지역 호출과 같은 얼굴을 해서는 안 되고, 실패 방식이 다르기 때문에 더욱 그렇다. 지역 호출은 예외를 던지지 않지만 원격 호출은 타임아웃되고 부분 실패한다.

셋에 공통된 마지막 경고가 있다. **간접 계층은 스택을 깊게 하고 진입점을 흐린다.** 파사드·다리·대역이 겹쳐 쌓이면 `get(key)` 한 번의 실제 동작을 알아내는 데 파일 다섯 개를 연다. 각 겹은 각자 근거를 대야 한다.

## 연습

::: quiz
설계 질문이다. 코드를 짜지 마라. 세 가지를 적어라.

**1. 결제·재고·배송 세 서비스를 순서대로 부르는 주문 확정 절차.** 지금 이 순서를 아는 곳이 웹 API 핸들러, 배치 작업, 관리자 도구 세 곳이다. 곧 "확정 전에 쿠폰 유효성을 검사한다"가 추가된다.
- 상황: 순서가 바뀔 때 열리는 파일이 몇 개인가.
- 무엇이 변하고 무엇이 고정인가:
- 어떤 패턴이고, 무엇을 대가로 치르는가:

**2. 리포트 생성기.** 리포트 종류가 매출·재고·감사 세 가지이고, 출력 형식이 PDF·엑셀 두 가지다. 지금 클래스가 `SalesPdf`, `SalesExcel` 식으로 여섯 개다. 다음 분기에 CSV와 HTML이 추가되고, 리포트 종류도 둘 더 는다.
- 상황: 지금 몇 개이고 요구를 다 받으면 몇 개가 되는가. 축을 가르면 몇 개인가.
- 무엇이 변하고 무엇이 고정인가:
- 어떤 패턴이고, 무엇을 대가로 치르는가:

**3. 사용자 프로필 서비스.** 프로필 객체에 아바타 이미지가 딸려 있고 이미지는 오브젝트 스토리지에 있다. 목록 화면은 이름만 쓰고 상세 화면만 이미지를 쓴다. 지금은 프로필을 만들 때 이미지를 항상 같이 받아 온다.
- 상황: 목록 100건을 그릴 때 낭비되는 요청이 몇 건인가. 고친 뒤 새로 생기는 위험은 무엇인가.
- 무엇이 변하고 무엇이 고정인가:
- 어떤 패턴이고, 무엇을 대가로 치르는가:

::: answer
**1.** 순서가 바뀌면 세 곳이 열리고, 셋 중 하나를 놓치면 그 경로만 조용히 옛 절차로 돈다. 변하는 것은 단계의 구성과 순서이고, 고정된 것은 "주문을 확정한다"는 목적이다. Facade이고 — 순서를 아는 곳을 `confirm_order(order)` 하나로 줄인다 — 대가는 셋이다. ① 세 호출부의 요구가 조금씩 다르면 창구에 인자가 붙기 시작한다. ② 창구가 자라 결국 서브시스템 전체를 다시 노출할 위험이 있다. ③ 실패 처리가 창구 안으로 들어가면서 호출부가 부분 실패를 구별하지 못하게 된다. 셋 중 마지막이 가장 자주 실제 문제가 된다.

**2.** 지금 $3 \times 2 = 6$개다. 요구를 다 받으면 리포트 5종에 형식 4종이라 $5 \times 4 = 20$개이고, 축을 가르면 $5 + 4 = 9$개다. 변하는 것은 리포트 종류와 출력 형식이며 **둘이 서로 무관하게 변한다** — 이것이 축 분리의 근거다. 고정된 것은 "데이터를 모아 형식에 맞춰 낸다"는 절차의 뼈대다. Bridge이고, 대가는 두 축이 만나는 지점의 인터페이스를 지금 설계해야 한다는 것이다. 리포트가 형식에 요구하는 것(표, 차트, 페이지 나눔)을 추상화해야 하는데, 이 추상화가 부정확하면 "엑셀에서만 되는 것"이 인터페이스에 새기 시작하고 그러면 축이 다시 붙는다.

**3.** 목록 100건에서 이미지 요청 100건이 전부 낭비다. 변하는 것은 이미지를 언제 가져오는가이고, 고정된 것은 프로필 객체의 인터페이스다 — 상세 화면 코드는 바뀌면 안 된다. 가상 프록시이고, 이미지를 처음 접근할 때 가져온다. 새로 생기는 위험이 이 문제의 핵심이다. **속성 접근이 네트워크 호출이 된다.** 누군가 목록 화면에서 아바타를 한 줄 추가하면 100건의 요청이 조용히 되살아나고, 코드에는 속성 접근만 보인다. ORM의 N+1과 같은 함정이다. 방어는 이름으로 드러내는 것(`avatar` 대신 `fetch_avatar()`)과, 목록이 필요한 것을 한 번에 가져오는 경로를 따로 두는 것이다.
:::
:::

## 요약

- 셋 다 호출부와 진짜 사이에 무언가를 끼운다. **가르는 것은 끼운 것의 인터페이스가 뒤와 어떤 관계인가다.**
- **Facade** — 뒤보다 **좁다**. 여러 객체의 표면을 하나의 창구로 줄이고, **뒤는 여전히 직접 닿을 수 있다.** 좁아지지 않았으면 파사드가 아니다.
- **Bridge** — 두 축을 갈라 **곱셈을 덧셈으로 바꾼다.** $m \cdot n$이 $m + n$이 되고, 축 하나가 늘 때 $m$개 대신 1개가 는다. 예제에서 렌더러 하나를 추가하자 세 조합이 동시에 살아났다.
- **Proxy** — 뒤와 **같은 인터페이스**로 대신 선다. 가상(지연 로딩)·원격·보호·캐싱 네 종류가 있고, 같은 얼굴이라는 성질이 존재 이유이자 최대 위험이다.
- 절차의 단계가 바뀔 때 창구가 없으면 수정 지점이 $O(c)$이고 창구가 있으면 $O(1)$이다. 예제의 `bad C`가 그 $O(c)$가 실패한 장면이다 — 만료 토큰으로 보내고 아무도 못 봤다.
- 축을 가르는 근거는 산수 하나다. **$n = 1$이면 $m + 1 > m$이라 손해다.** 두 축이 **각각** 자랄 근거가 있어야 한다.
- 대역의 대가는 **성능 특성에 대한 거짓말**이다. 값싸 보이는 속성 접근이 I/O를 일으키고, 루프 안에 들어가면 ORM의 N+1이 된다. 비용이 자릿수로 달라지는 것을 같은 인터페이스 뒤에 숨기지 마라.
- Adapter까지 넷을 한 줄로: **다르게 바꾸면 Adapter, 좁히면 Facade, 그대로 대신 서면 Proxy, 그대로 얹으면 Decorator다.**

**다음 절**: [XII-4 Decorator / Composite](#/xii-4) — 같은 인터페이스를 유지한 채 기능을 겹겹이 쌓는 것과, 하나와 여럿을 같은 것으로 다루는 것. 미들웨어 체인과 Behavior Tree가 그 두 얼굴이다.
