# IV-2 DFS

::: lead
한 갈래를 끝까지 밀고 되돌아오는 탐색이 무엇을 세어 주고 무엇을 잡아 주는가.
:::

## 1. 문제

빌드 설정 파일에 이런 줄들이 있다.

```text nolines
    core     needs  util
    util     needs  logging
    logging  needs  core
    app      needs  core
```

빌드는 시작하지 못한다. `core`를 만들려면 `util`이 먼저고, `util`을 만들려면 `logging`이 먼저고, `logging`을 만들려면 다시 `core`가 먼저다. 세 모듈이 서로를 기다린다. 화면에는 아무 일도 일어나지 않거나 스택 오버플로 한 줄이 뜬다.

모듈이 넷이면 눈으로 보인다. 모듈이 3,000개이고 의존 줄이 40,000개면 안 보인다. 필요한 것은 **"이 관계에 순환이 있는가, 있다면 어느 모듈들인가"**를 기계적으로 찾는 절차다.

같은 절차가 다른 얼굴로도 필요하다. 컴퓨터 $N$대의 연결 목록에서 **몇 개의 덩어리로 나뉘는가**. 이미지에서 흰 픽셀들이 **몇 개의 물체를 이루는가**. 참조가 서로를 붙들고 있어 **아무도 해제하지 못하는 객체 무리가 있는가**.

넷의 공통점은 하나다. **한 점에서 출발해 갈 수 있는 데까지 가 보고, 그 과정에서 무엇을 만났는지 기록하는 것.** 그것이 DFS다.

## 2. 아이디어

DFS의 규칙은 두 줄이다.

1. 지금 정점을 방문 표시하고, 아직 안 간 이웃이 있으면 **그리로 내려간다.**
2. 갈 이웃이 없으면 **왔던 곳으로 돌아간다.**

::: widget grid-search {"algos":["dfs","bfs"],"rows":15,"cols":15,"walls":"maze","start":[1,1],"goal":[13,13]}
:::

위젯은 같은 미로에서 DFS와 BFS를 나란히 재생한다. 색이 진한 칸이 먼저 확장된 칸이다. **두 그림의 모양이 완전히 다르다.** BFS는 시작점을 중심으로 고르게 번지는 반면, DFS는 한 줄기가 미로 깊숙이 뻗어 들어갔다가 막히면 되돌아 나와 다른 갈림길로 새는 실뭉치를 그린다. 목표 칸에 닿았을 때 DFS가 지나온 경로는 대개 최단이 아니다 — 이 사실이 [IV-3](#/iv-3)이 존재하는 이유다.

되돌아오는 동작이 곧 **스택**이다. "지금 어디까지 내려왔는지"를 기억해 두었다가 막히면 하나씩 꺼내 되짚는다. 이 스택을 직접 만들 수도 있고, **재귀 호출의 호출 스택을 그대로 빌릴 수도 있다.** 재귀로 쓴 DFS가 짧은 이유가 이것이고, 그 대가가 §4의 깊이 제한이다. 호출 스택의 정체는 [II-4 스택](#/ii-4)에, 재귀를 믿고 쓰는 법은 [III-1 재귀 사고법](#/iii-1)에 있다.

### 2.1 연결 요소 세기

DFS 한 번은 "시작점에서 갈 수 있는 정점 전부"를 방문한다. 그러면 세는 절차가 저절로 나온다.

```text nolines
    for v in 0..V-1:
        if not visited[v]:
            count += 1          <- 새 덩어리가 시작됐다
            dfs(v)              <- 그 덩어리를 통째로 칠한다
```

바깥 루프가 정점을 훑고, 아직 안 칠해진 정점을 만날 때마다 새 덩어리가 시작된 것이다. **바깥 루프는 $V$번 돌지만 `dfs`가 실제로 일을 하는 것은 덩어리 수만큼뿐이다.** 각 정점은 정확히 한 번 방문되므로 전체가 $O(V+E)$로 끝난다.

### 2.2 사이클 검출 — 무방향과 방향은 다른 문제다

여기가 이 챕터에서 가장 자주 틀리는 지점이다. **두 경우의 판정 규칙이 다르고, 한쪽 규칙을 다른 쪽에 쓰면 조용히 틀린 답이 나온다.**

**무방향 그래프.** 이미 방문한 이웃을 만났으면 사이클인가? 아니다. `u`에서 `v`로 내려왔으면 `v`의 이웃 목록에는 `u`가 들어 있고, `u`는 방금 방문했다. **모든 간선이 사이클로 오인된다.** 그래서 판정에 조건이 하나 붙는다.

> 이미 방문한 이웃이 **내가 방금 내려온 그 정점(부모)이 아니면** 사이클이다.

**방향 그래프.** 부모 검사는 여기서 쓸 수 없다. 방향 그래프에서 `u → v` 간선이 있다고 `v → u`가 있는 것이 아니므로 되돌아가는 간선 자체가 없다. 대신 다른 구분이 필요하다.

```text nolines
    white   아직 안 봤다
    gray    지금 재귀 스택 위에 있다        <- 아직 빠져나오지 않았다
    black   다 보고 빠져나왔다
```

> 지금 보고 있는 간선의 끝점이 **회색**이면 사이클이다. **검정**이면 사이클이 아니다.

이유는 회색의 뜻에 있다. 끝점이 회색이라는 것은 그 정점에서 출발해 지금 여기까지 내려온 경로가 아직 살아 있다는 뜻이고, 거기에 간선 하나를 더하면 닫힌 고리가 된다. 검정은 이미 다 탐색하고 빠져나온 정점이라 지금 위치에서 그리로 가는 길은 있어도 **되돌아오는 길이 없다.** 그냥 두 갈래가 같은 곳으로 합류한 것뿐이다.

```text nolines
    0 --> 1 --> 3          3 is black when 2 --> 3 is examined   (no cycle)
    |           ^
    +---> 2 ----+
          ^  |
          |  v
          +- 4              2 is gray when 4 --> 2 is examined    (cycle)
```

**방향 그래프에 "방문했으면 사이클" 규칙을 쓰면 위 그림의 `2 → 3`이 사이클로 잡힌다.** 실제로는 사이클이 아니다. 이 오탐은 DAG(사이클 없는 방향 그래프)를 사이클 있다고 보고하고, 위상 정렬([IV-6](#/iv-6))이 멀쩡히 되는 그래프를 거절하게 만든다.

## 3. 손으로 따라가기

::: trace
방향 그래프. 정점 5개, 간선 `0→1  0→2  1→3  2→3  2→4  4→2`. 시작은 0이고, 이웃은 번호가 작은 것부터 본다.

세 색으로 추적한다. **회색은 재귀 스택 위에 있는 정점**이고, **검정은 다 보고 빠져나온 정점**이다. 표의 `회색` 열은 스택의 아래에서 위 순서로 적는다.

| 스텝 | 연산 | 회색(재귀 스택) | 검정 | 판정 |
|---|---|---|---|---|
| 0 | 진입 0 | [0] | {} | — |
| 1 | 진입 1 | [0, 1] | {} | — |
| 2 | 진입 3 | [0, 1, 3] | {} | — |
| 3 | 나감 3 | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |

세 가지를 확인하라.

- [ ] 간선 `2→3`을 검사하는 순간 정점 3은 무슨 색인가. 사이클인가
- [ ] 간선 `4→2`를 검사하는 순간 정점 2는 무슨 색인가. 사이클인가
- [ ] "방문했으면 사이클"이라는 규칙으로 판정하면 몇 번 스텝에서 무엇이라고 답하는가
:::

::: answer
| 스텝 | 연산 | 회색(재귀 스택) | 검정 | 판정 |
|---|---|---|---|---|
| 0 | 진입 0 | [0] | {} | — |
| 1 | 진입 1 | [0, 1] | {} | — |
| 2 | 진입 3 | [0, 1, 3] | {} | — |
| 3 | 나감 3 | [0, 1] | {3} | — |
| 4 | 나감 1 | [0] | {1, 3} | — |
| 5 | 진입 2 | [0, 2] | {1, 3} | — |
| 6 | 간선 2→3 검사 | [0, 2] | {1, 3} | 3은 **검정** → 사이클 아님 |
| 7 | 진입 4 | [0, 2, 4] | {1, 3} | — |
| 8 | 간선 4→2 검사 | [0, 2, 4] | {1, 3} | 2는 **회색** → **사이클** |

스텝 6과 8이 이 표의 전부다. **두 스텝 모두 "이미 본 정점으로 가는 간선"인데 판정이 정반대다.**

스텝 6에서 정점 3은 이미 다 탐색하고 빠져나왔다. 3에서 출발하는 길은 전부 막다른 골목이었고, 그래서 3으로 아무리 들어가도 2로 돌아올 수 없다. 두 갈래(`0→1→3`과 `0→2→3`)가 같은 곳에서 만난 것뿐이다.

스텝 8에서 정점 2는 아직 재귀 스택 위에 있다. `2 → 4`로 내려온 길이 아직 살아 있다는 뜻이고, 여기에 `4 → 2`를 더하면 `2 → 4 → 2`가 닫힌다. **회색은 "여기서 나에게로 오는 길이 이미 깔려 있다"는 표시다.**

세 번째 질문이 오탐의 정체다. "방문했으면 사이클" 규칙은 **스텝 6에서 사이클이 있다고 답한다.** 정답은 사이클 있음이지만 근거가 틀렸다 — 이 그래프는 `2→4→2` 때문에 사이클이 있는 것이지 `2→3` 때문이 아니다. 그리고 간선 `4→2`를 지우면 사이클이 없는 DAG가 되는데, 틀린 규칙은 **여전히 스텝 6에서 사이클이 있다고 답한다.** 오탐이 정답에 가려 안 보이다가 입력이 바뀌는 순간 드러나는 전형적인 모양이다.
:::

## 4. 구현

먼저 연결 요소다. 같은 알고리즘을 재귀와 명시적 스택 두 가지로 쓴다.

::: dual
```python title="연결 요소 — 재귀 DFS와 스택 DFS"
import sys

sys.setrecursionlimit(300000)      # 왜: 기본 한도 1,000은 깊은 그래프에서 즉시 넘는다

V = 8
edges = [(0, 1), (1, 2), (3, 4), (5, 6), (6, 7), (5, 7)]
adj = [[] for _ in range(V)]
for u, v in edges:
    adj[u].append(v)
    adj[v].append(u)


def dfs_recursive(start, seen, order):
    seen[start] = True
    order.append(start)
    for nx in adj[start]:
        if not seen[nx]:
            dfs_recursive(nx, seen, order)


def dfs_stack(start, seen, order):
    st = [start]
    seen[start] = True             # 스택에 넣을 때 찍는다 — 같은 정점이 두 번 들어가지 않는다
    while st:
        x = st.pop()
        order.append(x)
        for nx in adj[x]:
            if not seen[nx]:
                seen[nx] = True
                st.append(nx)


def components(dfs):
    seen = [False] * V
    sizes = []
    order = []
    for v in range(V):
        if not seen[v]:            # 아직 안 칠해진 정점 = 새 덩어리의 시작
            before = len(order)
            dfs(v, seen, order)
            sizes.append(len(order) - before)
    return sizes, order


sizes_r, order_r = components(dfs_recursive)
sizes_s, order_s = components(dfs_stack)
print("재귀 방문 순서 :", " ".join(map(str, order_r)))
print("스택 방문 순서 :", " ".join(map(str, order_s)))
print("연결 요소 개수 :", len(sizes_r))
print("각 요소의 크기 :", " ".join(map(str, sizes_r)), "/", " ".join(map(str, sizes_s)))
```
```cpp title="연결 요소 — 재귀 DFS와 스택 DFS"
#include <iostream>
#include <vector>
using namespace std;

const int V = 8;
vector<vector<int>> adj(V);

void dfs_recursive(int start, vector<bool> &seen, vector<int> &order) {
    seen[start] = true;
    order.push_back(start);
    for (int nx : adj[start])
        if (!seen[nx]) dfs_recursive(nx, seen, order);
}

void dfs_stack(int start, vector<bool> &seen, vector<int> &order) {
    vector<int> st = {start};
    seen[start] = true;   // 스택에 넣을 때 찍는다 — 같은 정점이 두 번 들어가지 않는다
    while (!st.empty()) {
        int x = st.back();
        st.pop_back();
        order.push_back(x);
        for (int nx : adj[x])
            if (!seen[nx]) {
                seen[nx] = true;
                st.push_back(nx);
            }
    }
}

pair<vector<int>, vector<int>> components(void (*dfs)(int, vector<bool> &, vector<int> &)) {
    vector<bool> seen(V, false);
    vector<int> sizes, order;
    for (int v = 0; v < V; v++)
        if (!seen[v]) {            // 아직 안 칠해진 정점 = 새 덩어리의 시작
            int before = (int)order.size();
            dfs(v, seen, order);
            sizes.push_back((int)order.size() - before);
        }
    return {sizes, order};
}

void show(const vector<int> &a) { for (int x : a) cout << " " << x; }

int main() {
    vector<pair<int, int>> edges = {{0, 1}, {1, 2}, {3, 4}, {5, 6}, {6, 7}, {5, 7}};
    for (auto [u, v] : edges) {
        adj[u].push_back(v);
        adj[v].push_back(u);
    }
    auto [sizes_r, order_r] = components(dfs_recursive);
    auto [sizes_s, order_s] = components(dfs_stack);
    cout << "재귀 방문 순서 :"; show(order_r);
    cout << "\n스택 방문 순서 :"; show(order_s);
    cout << "\n연결 요소 개수 : " << sizes_r.size();
    cout << "\n각 요소의 크기 :"; show(sizes_r); cout << " /"; show(sizes_s);
    cout << "\n";
    return 0;
}
```
:::

```console
재귀 방문 순서 : 0 1 2 3 4 5 6 7
스택 방문 순서 : 0 1 2 3 4 5 7 6
연결 요소 개수 : 3
각 요소의 크기 : 3 2 3 / 3 2 3
```

**복잡도:** 시간 $O(V + E)$ — 각 정점은 `seen`이 찍히는 순간 한 번만 큐/스택에 들어가고, 꺼낼 때 자기 인접 리스트를 한 번 훑는다. 이웃 훑기를 전 정점에 대해 더하면 차수의 합, 즉 무방향에서 $2E$다. 공간 $O(V)$ — `seen` 배열과 스택. **스택의 최악 깊이가 $V$라는 점이 재귀 구현에서 문제가 된다.**

방문 순서가 갈리는 것에 주의하라. 재귀는 `5 → 6 → 7`, 스택은 `5 → 7 → 6`이다. **스택은 마지막에 넣은 것을 먼저 꺼내므로 이웃을 넣은 순서의 역순으로 내려간다.** 방문 순서 자체가 답인 문제(백준 1260이 그렇다)에서는 스택에 넣기 전 이웃을 역순으로 정렬해 맞춘다. 순서가 상관없는 문제에서는 신경 쓸 필요가 없다.

::: perf
$1000 \times 1000$ 격자를 한 줄로 이어진 뱀 모양 통로로 채우면 길이 500,500칸이고 DFS의 깊이가 그대로 500,500이 된다.

| | 결과 |
|---|---|
| 기본 재귀 한도(1,000) | `RecursionError` — 통로의 앞부분에서 죽는다 |
| 한도를 510,500으로 올린 재귀 | 694 ms, 최대 깊이 500,500 |
| 명시적 스택 | 448 ms, **스택 최대 길이 1** |

> (Linux x86-64 / CPython 3.13 실측, 3회 실행의 중앙값. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 측정 스크립트는 `tools/bench/dfs_recursion_vs_stack.py` 다.)

시간은 1.55배 차이지만 **읽을 곳은 마지막 줄이다.** 재귀는 프레임 50만 개를 동시에 들고 있고, 명시적 스택은 같은 탐색을 원소 한 개로 해낸다. 한 줄 통로에서는 갈림길이 없어 스택에 쌓일 것이 없기 때문이다. 프레임 하나에는 지역 변수와 복귀 주소가 함께 들어가므로, 같은 일을 하면서 메모리를 다섯 자릿수 배로 더 쓰는 셈이다.

CPython 3.12부터 순수 Python 함수의 재귀는 C 스택을 쓰지 않아 한도만 올리면 깊이 50만이 실제로 통과한다. **C++에는 이 안전망이 없다.** 기본 스택 8MB에 프레임이 수십 바이트면 깊이 수십만에서 세그멘테이션 폴트가 나고, 예외도 메시지도 없이 죽는다. 자세한 것은 [0-10 언어별 상수와 TLE 대응](#/0-10)에 있다.
:::

이제 사이클 검출이다. 무방향의 부모 검사, 방향의 3색 칠하기, 그리고 **방향 그래프에 무방향 규칙을 쓴 틀린 판정**을 나란히 돌린다.

::: dual
```python title="사이클 검출 — 무방향과 방향"
import sys

sys.setrecursionlimit(300000)


def has_cycle_undirected(n, edges):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
    seen = [False] * n

    def go(x, parent):
        seen[x] = True
        for nx in adj[x]:
            if not seen[nx]:
                if go(nx, x):
                    return True
            elif nx != parent:     # 방금 내려온 곳이 아닌데 이미 봤다 → 고리가 닫힌다
                return True
        return False

    return any(go(v, -1) for v in range(n) if not seen[v])


def has_cycle_directed(n, edges, use_wrong_rule=False):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)         # 방향 그래프 — 한쪽에만 넣는다
    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * n

    def go(x):
        color[x] = GRAY          # 지금 재귀 스택 위에 있다
        for nx in adj[x]:
            if use_wrong_rule:
                if color[nx] != WHITE:   # ❌ 검정까지 사이클로 센다
                    return True
            elif color[nx] == GRAY:      # ✅ 회색만 사이클이다
                return True
            if color[nx] == WHITE and go(nx):
                return True
        color[x] = BLACK         # 다 보고 빠져나왔다
        return False

    return any(go(v) for v in range(n) if color[v] == WHITE)


tree = [(0, 1), (1, 2), (1, 3)]
ring = [(0, 1), (1, 2), (2, 0)]
diamond = [(0, 1), (0, 2), (1, 3), (2, 3)]
trap = [(0, 1), (0, 2), (1, 3), (2, 3), (2, 4), (4, 2)]

print("무방향 트리        :", has_cycle_undirected(4, tree))
print("무방향 삼각형      :", has_cycle_undirected(3, ring))
print("방향 다이아몬드    :", has_cycle_directed(4, diamond))
print("방향 다이아몬드(X) :", has_cycle_directed(4, diamond, use_wrong_rule=True))
print("방향 손추적 그래프 :", has_cycle_directed(5, trap))
```
```cpp title="사이클 검출 — 무방향과 방향"
#include <functional>
#include <iostream>
#include <vector>
using namespace std;

bool has_cycle_undirected(int n, const vector<pair<int, int>> &edges) {
    vector<vector<int>> adj(n);
    for (auto [u, v] : edges) {
        adj[u].push_back(v);
        adj[v].push_back(u);
    }
    vector<bool> seen(n, false);

    function<bool(int, int)> go = [&](int x, int parent) {
        seen[x] = true;
        for (int nx : adj[x]) {
            if (!seen[nx]) {
                if (go(nx, x)) return true;
            } else if (nx != parent) {  // 방금 내려온 곳이 아닌데 이미 봤다 → 고리가 닫힌다
                return true;
            }
        }
        return false;
    };

    for (int v = 0; v < n; v++)
        if (!seen[v] && go(v, -1)) return true;
    return false;
}

bool has_cycle_directed(int n, const vector<pair<int, int>> &edges,
                        bool use_wrong_rule = false) {
    vector<vector<int>> adj(n);
    for (auto [u, v] : edges) adj[u].push_back(v);   // 방향 그래프 — 한쪽에만 넣는다
    const int WHITE = 0, GRAY = 1, BLACK = 2;
    vector<int> color(n, WHITE);

    function<bool(int)> go = [&](int x) {
        color[x] = GRAY;                 // 지금 재귀 스택 위에 있다
        for (int nx : adj[x]) {
            if (use_wrong_rule) {
                if (color[nx] != WHITE) return true;   // ❌ 검정까지 사이클로 센다
            } else if (color[nx] == GRAY) {            // ✅ 회색만 사이클이다
                return true;
            }
            if (color[nx] == WHITE && go(nx)) return true;
        }
        color[x] = BLACK;                // 다 보고 빠져나왔다
        return false;
    };

    for (int v = 0; v < n; v++)
        if (color[v] == WHITE && go(v)) return true;
    return false;
}

void show(const char *label, bool v) {
    cout << label << " : " << (v ? "True" : "False") << "\n";
}

int main() {
    vector<pair<int, int>> tree = {{0, 1}, {1, 2}, {1, 3}};
    vector<pair<int, int>> ring = {{0, 1}, {1, 2}, {2, 0}};
    vector<pair<int, int>> diamond = {{0, 1}, {0, 2}, {1, 3}, {2, 3}};
    vector<pair<int, int>> trap = {{0, 1}, {0, 2}, {1, 3}, {2, 3}, {2, 4}, {4, 2}};

    show("무방향 트리       ", has_cycle_undirected(4, tree));
    show("무방향 삼각형     ", has_cycle_undirected(3, ring));
    show("방향 다이아몬드   ", has_cycle_directed(4, diamond));
    show("방향 다이아몬드(X)", has_cycle_directed(4, diamond, true));
    show("방향 손추적 그래프", has_cycle_directed(5, trap));
    return 0;
}
```
:::

```console
무방향 트리        : False
무방향 삼각형      : True
방향 다이아몬드    : False
방향 다이아몬드(X) : True
방향 손추적 그래프 : True
```

**복잡도:** 둘 다 시간 $O(V+E)$ / 공간 $O(V)$ — 정점마다 색을 한 번 회색으로, 한 번 검정으로 바꾸고 간선을 정확히 한 번씩 검사한다. 사이클을 찾는 순간 즉시 빠져나오므로 실제로는 더 빨리 끝나는 경우가 많지만 최악은 전체 탐색과 같다.

**네 번째 줄이 이 코드의 목적이다.** `diamond`는 사이클이 없는 DAG인데 틀린 규칙은 `True`를 낸다. `0→2` 다음에 `2→3`을 검사할 때 3은 이미 검정인데, 틀린 규칙은 흰색이 아니면 전부 사이클로 세기 때문이다. **이 오탐은 사이클이 실제로 있는 입력에서는 정답과 구분되지 않는다.** `trap`에서 두 규칙이 똑같이 `True`를 내는 것이 그 증거다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 재귀 깊이 | 기본 1,000. `sys.setrecursionlimit`으로 올릴 수 있고 3.12부터 C 스택을 쓰지 않는다 | 한도 자체가 없고 OS 스택(기본 8MB)까지. 넘으면 **예외 없이 세그멘테이션 폴트** |
| 중첩 함수의 캡처 | 안쪽 `def`가 바깥 지역 변수를 그대로 읽는다 | 람다에 `[&]` 캡처가 필요하고, 재귀 람다는 `std::function`으로 받아야 자기 이름을 쓸 수 있다 |
| 색 배열 | `[0] * n` | `vector<int>(n, WHITE)`. `vector<bool>`은 비트 압축이라 색 3종에는 못 쓴다([0-6](#/0-6)) |
| 기본 인자 | `use_wrong_rule=False` | `bool use_wrong_rule = false` — 선언 쪽에만 적는다 |

::: pitfall
- **무방향 그래프에서 부모 검사를 빠뜨린다.** 간선 하나짜리 그래프도 사이클로 잡힌다. 가장 먼저 의심할 곳이다.
- **부모를 정점 번호로만 비교하는데 중복 간선이 있다.** `u`와 `v` 사이에 간선이 두 개면 그것 자체가 길이 2짜리 사이클인데 부모 검사가 둘 다 걸러 낸다. 중복 간선을 허용하는 지문이면 **부모 정점이 아니라 방금 타고 온 간선의 번호**를 넘겨야 한다.
- **방향 그래프에 "방문했으면 사이클" 규칙을 쓴다.** 위 코드의 네 번째 줄이 그 결과다. DAG를 사이클 있다고 보고한다.
- **`color[x] = BLACK`을 빠뜨린다.** 전부 회색으로 남으면 두 갈래가 합류하는 지점마다 사이클로 잡힌다. 검정 칠은 재귀에서 **빠져나오는 자리**에 있어야 한다.
- **재귀 깊이를 안 본다.** 정점 $10^5$개짜리 경로 그래프는 깊이 $10^5$이다. Python은 한도를 올려야 하고 C++은 스택이 버티는지 계산해야 한다. 깊이가 불안하면 명시적 스택으로 바꾼다.
- **연결 요소를 셀 때 바깥 루프를 빠뜨린다.** `dfs(0)` 한 번은 0이 속한 덩어리만 칠한다. 그래프가 연결되어 있다는 보장이 지문에 없으면 반드시 전 정점을 훑어야 한다.
:::

## 5. 어디에 쓰이는가

**모듈 시스템의 순환 의존 검사가 방향 사이클 검출이다.** Python의 `import`, Java의 패키지, C++의 헤더 포함, 프런트엔드 번들러의 모듈 그래프에 전부 같은 검사가 들어 있다. 도입부의 빌드 설정이 그 예이고, 순환이 없다는 것을 확인한 다음 실제 빌드 순서를 정하는 것이 [IV-6 위상 정렬](#/iv-6)이다. **순환 검출과 위상 정렬은 같은 탐색의 두 출력이다** — 검정 칠이 끝나는 순서를 뒤집으면 그것이 곧 위상 순서다.

**가비지 컬렉터의 mark 단계가 DFS다.** 루트 집합(전역 변수, 스택 위의 참조)에서 출발해 도달 가능한 객체를 전부 칠하고, 안 칠해진 것을 회수한다. 참조 카운팅만으로는 서로를 붙들고 있는 객체 무리를 못 없애는 이유가 여기 있다 — 그 무리는 루트에서 도달 불가능한데 카운트는 0이 아니다. 순환 참조와 소유권 문제는 [XI-11 순환 참조와 소유권](#/xi-11)에서 다룬다.

**교착 상태 검출이 자원 할당 그래프의 사이클 검출이다.** "프로세스 $P$가 자원 $R$을 쥐고 있다", "$P$가 $R$을 기다린다"를 간선으로 두면 방향 그래프가 되고, 사이클은 아무도 양보하지 않는 대기 고리를 뜻한다. 데이터베이스의 락 매니저와 다중 로봇 관제의 교차로 제어가 같은 그래프를 본다. [V-10 교착 검출과 회피](#/v-10)가 이것을 정면으로 다룬다.

**연결 요소는 이미지 처리의 blob 검출 그 자체다.** 이진화한 이미지에서 흰 픽셀 덩어리마다 번호를 붙이는 작업이고, 격자를 암묵 그래프로 보면 §2.1의 절차가 그대로 적용된다. [IV-5 플러드필과 연결 요소 라벨링](#/iv-5)에서 이어진다.

## 6. 이 유형을 알아보는 법

::: classify
- 신호어: "연결되어 있는", "몇 개의 덩어리", "몇 개의 그룹", "서로 도달 가능한", "순환이 있는지", "사이클을 이루는", "감염되는 컴퓨터의 수"
- 제약조건: 정점 $V \le 10^5$, 간선 $E \le 2 \times 10^5$에 $O(V+E)$. 최단 거리가 아니라 **도달 가능성만** 묻는다. 격자면 $N, M \le 1000$
- 혼동 주의: 같은 도달 가능성 질문이라도 **최소 이동 횟수**를 물으면 DFS가 아니라 BFS다([IV-3](#/iv-3)). 연결 여부만 반복해서 묻고 간선이 하나씩 추가되면 유니온 파인드가 더 싸다([IX-1](#/ix-1)). 방향 그래프에서 순환이 없음을 확인한 뒤 순서까지 뽑아야 하면 위상 정렬이다([IV-6](#/iv-6))
- 반례 함정: 무방향과 방향의 판정 규칙을 바꿔 쓰는 것. 방향 그래프에 "방문했으면 사이클"을 쓰면 `0→1, 0→2, 1→3, 2→3` 같은 DAG를 사이클 있다고 답한다. 그리고 그래프가 연결되어 있다는 보장이 없으면 시작점 하나로는 절반도 못 본다
:::

::: interview
**"DFS와 BFS 중 무엇을 쓰겠습니까."**
답의 뼈대는 목적이다. 도달 가능성·연결 요소·사이클·위상 순서면 DFS, 최소 이동 횟수면 BFS다. 메모리 이야기를 덧붙이면 좋다 — DFS의 스택 최악 깊이는 $V$이고 BFS의 큐 최대 길이는 한 층의 크기다. 격자에서는 후자가 대개 더 작다.

**"방향 그래프에서 사이클을 어떻게 찾습니까."**
회색과 검정을 구분한다는 말이 반드시 나와야 한다. "방문 배열 하나로는 안 됩니다. 지금 재귀 스택 위에 있는 정점과 이미 빠져나온 정점을 구분해야 하고, 스택 위에 있는 정점으로 가는 간선만 사이클입니다." 여기서 멈추면 절반이고, **"방문 하나로 판정하면 DAG를 사이클로 오인합니다"**까지 말하면 실제로 짜 본 사람의 답이 된다.
:::

## 연습

::: quiz
앞의 둘은 연결 요소, 뒤의 둘은 사이클이다. **코드를 짜기 전에 무방향인지 방향인지부터 확정하라.**

**1. 백준 2606 바이러스 (실버 3)** — https://www.acmicpc.net/problem/2606
- 신호: "1번 컴퓨터를 통해 감염되는 컴퓨터의 수". 최소 횟수가 아니라 **개수**만 묻는다.
- 상태: 컴퓨터 번호 하나. 1번이 속한 연결 요소의 크기가 답이고, 자기 자신은 빼야 한다.
- 자료구조: 인접 리스트 + 방문 배열. 시작점이 하나로 고정이라 바깥 루프도 필요 없다.

**2. 백준 11724 연결 요소의 개수 (실버 2)** — https://www.acmicpc.net/problem/11724
- 신호: "연결 요소의 개수를 출력하시오". $N \le 1000$, $M \le N(N-1)/2$.
- 상태: 정점 번호 하나. §2.1의 바깥 루프가 그대로 답이다.
- 자료구조: 인접 리스트 + 방문 배열. 유니온 파인드로도 풀리지만([IX-1](#/ix-1)), 간선이 한 번에 다 주어지므로 탐색 한 번이 더 짧다. 두 방법의 복잡도를 비교해 보라.

**3. 백준 16947 서울 지하철 2호선 (골드 3)** — https://www.acmicpc.net/problem/16947
- 신호: "순환선에 속한 역", 그리고 각 역에서 순환선까지의 거리. $N \le 3000$이고 간선도 $N$개다.
- 상태: 두 단계다. 먼저 **무방향 사이클**을 찾아 순환선 소속을 표시하고, 그다음 순환선 전체를 시작점으로 두고 거리를 잰다. 두 번째 단계가 [IV-4](#/iv-4)의 다중 시작점 BFS다.
- 자료구조: 인접 리스트 + 부모 검사 DFS. 간선 수가 정점 수와 같다는 조건이 "사이클이 정확히 하나"를 보증한다. 그 사실을 어떻게 쓰는지가 이 문제의 핵심이다.

**4. 백준 9466 텀 프로젝트 (골드 3)** — https://www.acmicpc.net/problem/9466
- 신호: 각자 한 명씩 지목하고, 지목이 고리를 이루면 팀이 된다. 정점마다 나가는 간선이 **정확히 하나**인 방향 그래프다. $n \le 100{,}000$.
- 상태: 학생 번호 하나. 팀에 속하지 못한 학생 수 = 전체 − 사이클에 속한 학생 수.
- 자료구조: 색 배열(흰/회/검) + 반복 DFS. 나가는 간선이 하나뿐이라 재귀 대신 한 줄로 따라가도 되고, 그 편이 깊이 10만을 안전하게 넘긴다. **정점마다 탐색을 한 번씩만 하도록 검정 칠을 제대로 하는 것**이 시간 초과와 통과를 가른다.
:::

## 요약

- DFS는 두 줄이다. 안 간 이웃이 있으면 내려가고, 없으면 되돌아온다. 되돌아오기를 맡는 것이 스택이고, 재귀는 호출 스택을 빌려 쓰는 것이다.
- 바깥 루프로 전 정점을 훑으며 미방문 정점마다 DFS를 시작하면 **연결 요소의 개수와 크기**가 나온다. 전체가 $O(V+E)$다.
- **무방향 사이클은 부모 검사**로 판정한다. 부모 검사를 빼면 간선 하나짜리 그래프도 사이클이 된다.
- **방향 사이클은 회색(재귀 스택 위)과 검정(빠져나옴)을 구분**해 판정한다. 회색으로 가는 간선만 사이클이다.
- 두 규칙을 바꿔 쓰면 조용히 틀린다. `0→1, 0→2, 1→3, 2→3`은 DAG인데 "방문했으면 사이클" 규칙은 사이클이라고 답한다.
- 재귀 DFS의 최악 깊이는 정점 수다. 뱀 모양 통로 50만 칸에서 재귀는 프레임 50만 개를 들고, **같은 탐색을 명시적 스택은 원소 한 개로 해낸다.**
- 실무에서는 모듈 순환 의존 검사, 가비지 컬렉터의 mark 단계, 교착 상태 검출이 전부 이 탐색이다.

**다음 절**: [IV-3 BFS와 최단 거리](#/iv-3) — 큐가 거리 순으로 정렬된다는 성질 하나로 최단 거리가 나오고, 그 성질이 가중치 앞에서 어떻게 무너지는지 본다.
