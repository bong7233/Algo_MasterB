# XV-7 머클 트리와 해시 체인

::: lead
두 데이터 집합이 다른지는 해시 하나로 안다. **어디가** 다른지는 무엇으로 아는가.
:::

## 1. 문제

리포지토리에 파일이 수천 개 있다. 커밋 하나가 그중 파일 하나를 고쳤을 뿐인데, `git status`는 즉시 그 파일 하나를 지목한다. 순진하게 짜면 이전 커밋의 파일 전부를 다시 열어 지금 파일과 바이트 단위로 비교해야 한다. 파일이 만 개면 비교도 만 번이다.

분산 저장소 두 대가 같은 데이터의 복제본을 들고 있는 상황도 같은 모양이다. 네트워크로 동기화하기 전에 "어느 블록이 달라졌는가"를 알아야 그 블록만 보낼 수 있다. 모르면 방법이 둘뿐이다.

- **전부 보낸다.** 안전하지만 대역폭이 데이터 크기와 같다. 데이터가 100GB면 트래픽도 100GB다.
- **양쪽에서 전체 해시 하나씩 계산해 비교한다.** 다른지 같은지는 안다. **어디가** 다른지는 이 해시 하나에서 전혀 안 나온다.** 비트 하나가 다르든 전부 다르든 결과는 "다름" 한 마디다.

필요한 것은 그 사이 어딘가다. **"다름"이라는 판정을 잘게 쪼개서, 같은 조각은 아예 들여다보지 않고 다른 조각으로만 파고드는 방법.** [II-6 해시](#/ii-6)에서 본 해시 함수 하나로는 이걸 할 수 없다 — 해시는 "같다/다르다"만 답하지 "어디서부터 다른가"는 답하지 않는다. 답을 아는 것은 해시 하나가 아니라 **해시들의 계층 구조**다.

## 2. 아이디어

### 2.1 리프를 묶어 올라간다

데이터를 고정 크기 블록(리프)으로 나누고, 각 블록의 해시를 구한다. 그다음 인접한 두 해시를 이어 붙여 다시 해시한다. 그 결과가 부모 노드다. 부모끼리 또 묶어 올라가면 결국 해시 하나, **루트**가 남는다.

```text nolines
   레벨 3            [ H(H01,H23) ]                <- 루트. 전체를 대표하는 해시 하나
                       /          \
   레벨 2      [H(h0,h1)]      [H(h2,h3)]           <- 두 리프씩 묶은 해시
                /    \            /    \
   레벨 1     h0      h1        h2      h3          <- 리프 해시. H(블록0) ... H(블록3)
              |       |         |       |
              블록0   블록1     블록2    블록3        <- 원본 데이터
```

**루트 하나가 그 아래 전부를 대표한다.** 두 트리의 루트가 같으면 두 데이터 집합은 (해시 충돌을 무시하면) 완전히 같다 — 아직 §1의 "전체 해시 하나"와 다를 게 없다. 차이는 **루트가 다를 때** 나온다.

### 2.2 다른 자리로만 내려간다

루트가 다르면, 그 루트를 만든 **두 자식의 해시**를 비교한다. 한쪽 자식 해시가 같으면 그 밑의 블록들은 전부 같다는 뜻이므로 **그 서브트리는 통째로 건너뛴다.** 다른 쪽 자식만 다시 반으로 쪼개 내려간다. 이 과정을 리프에 닿을 때까지 반복한다.

매 단계에서 절반이 통째로 걸러진다. 리프가 $n$개면 이 과정은 트리의 높이, 즉 $\log_2 n$단계만 거친다. **전체를 비교하면 $O(n)$인데, 트리를 타고 내려가면 $O(\log n)$번의 해시 비교로 "어느 리프가 다른가"가 나온다.** 값이 다른 리프가 $k$개면 $O(k \log(n/k))$로 늘어나지만, 흔한 상황(대부분 같고 일부만 다름)에서는 여전히 $n$보다 훨씬 작다.

이게 다다. **부분만 비교해 차이를 찾는다**는 이 챕터의 명제는 "해시를 계층으로 쌓아서 같은 서브트리를 건너뛴다"는 이 한 문장으로 끝난다.

### 2.3 해시 체인은 다른 모양이다

머클 트리가 데이터를 **가로로** 묶는 구조라면, 해시 체인은 **세로로** 잇는 구조다. 각 블록이 자기 내용뿐 아니라 **바로 앞 블록의 해시**를 포함해서 자신의 해시를 만든다.

```text nolines
   블록1 --[H]--> h1
                   |
   블록2 + h1 --[H]--> h2
                        |
   블록3 + h2 --[H]--> h3
```

체인은 트리와 달리 **뒤로 갈수록 앞 전체를 되짚는 유일한 값**을 만든다. 앞 블록 하나를 몰래 바꾸면 그다음 블록의 해시부터 전부 달라진다 — 앞을 고치고 뒤를 안 고칠 수 없다. 트리가 "어디가 다른가"를 빠르게 찾는 구조라면, 체인은 "순서와 이력이 조작되지 않았는가"를 보장하는 구조다. git의 커밋은 **직전 커밋의 해시를 포함한다는 점에서 체인이고**, 각 커밋이 **파일 트리 전체를 머클 트리로 가리킨다는 점에서 트리**다. 둘이 한 시스템 안에 같이 있다.

## 3. 손으로 따라가기

::: trace
리프 8개(블록0 ~ 블록7)로 만든 두 머클 트리를 비교한다. 한쪽(A)은 원본이고 다른 쪽(B)은 **블록5만** 고쳤다. 레벨 0이 리프, 레벨 3이 루트다. 루트에서 시작해 해시가 다른 노드로만 내려간다. `대상 리프`는 그 노드가 대표하는 리프 범위다.

| 단계 | 검사 노드 (레벨,번호) | 대상 리프 | A 해시 | B 해시 | 같은가 | 다음 행동 |
|---|---|---|---|---|---|---|
| 1 | (3, 0) | 0~7 | `04a9d8b7` | `9f5181fd` | 아니오 | 두 자식 (2,0), (2,1) 모두 본다 |
| 2 | (2, 0) | 0~3 | `7f889647` | `7f889647` | **예** | 여기서 멈춘다 — 리프 0~3은 통째로 건너뛴다 |
| 3 | (2, 1) | 4~7 | | | | |
| 4 | (1, 2) | 4~5 | | | | |
| 5 | (1, 3) | 6~7 | | | | |
| 6 | (0, 4) | 4 | | | | |
| 7 | (0, 5) | 5 | | | | |

세 가지를 채워라.

- [ ] 3단계의 (2,1)이 다르다면, 4단계와 5단계 중 **하나만** 다시 갈라진다. 어느 쪽이고 왜인가
- [ ] 7단계까지 내려가서 확정되는 "달라진 리프 번호"는 몇 번인가
- [ ] 전체 리프 8개를 하나씩 비교했다면 몇 번을 비교해야 했는가. 이 트리는 몇 번 만에 끝냈는가
:::

::: answer
| 단계 | 검사 노드 (레벨,번호) | 대상 리프 | A 해시 | B 해시 | 같은가 | 다음 행동 |
|---|---|---|---|---|---|---|
| 1 | (3, 0) | 0~7 | `04a9d8b7` | `9f5181fd` | 아니오 | 두 자식 (2,0), (2,1) 모두 본다 |
| 2 | (2, 0) | 0~3 | `7f889647` | `7f889647` | 예 | 여기서 멈춘다 — 리프 0~3은 통째로 건너뛴다 |
| 3 | (2, 1) | 4~7 | `5bf1061d` | `8e2df6e9` | 아니오 | 두 자식 (1,2), (1,3) 모두 본다 |
| 4 | (1, 2) | 4~5 | `9853c786` | `c892fb1d` | 아니오 | 두 자식 (0,4), (0,5) 모두 본다 |
| 5 | (1, 3) | 6~7 | `5040c25d` | `5040c25d` | 예 | 여기서 멈춘다 — 리프 6~7은 건너뛴다 |
| 6 | (0, 4) | 4 | `5b0e0e62` | `5b0e0e62` | 예 | 리프이므로 종료 — 블록4는 같다 |
| 7 | (0, 5) | 5 | `5c0e0ff5` | `bfc8eded` | 아니오 | 리프이므로 종료 — **블록5가 다르다** |

4단계에서 (1,2)만 다시 갈라지고 (1,3)은 갈라지지 않는 것이 아니라, **3단계에서 (2,1)이 다르다고 판명된 뒤 그 두 자식 (1,2)와 (1,3)을 "모두" 검사한다.** 검사해 본 결과 (1,3)이 우연히 같아서(리프 6, 7이 안 바뀌었으므로) 거기서 멈추는 것이다. **"검사한다"와 "다르다"는 다른 일이다** — 다르지 않은 노드도 한 번은 열어 봐야 같다는 것을 확인할 수 있다.

7단계에서 확정되는 것은 **블록5**다. 전체 비교였다면 8번, 이 트리는 **7번** 검사로 끝났다. 리프 8개에서는 절약이 크지 않아 보이지만, [4. 구현](#4-구현)의 실측에서 리프가 늘어날수록 격차가 벌어지는 것을 본다.
:::

## 4. 구현

리프 해시와 노드 해시를 합쳐 트리를 쌓고(`build_levels`), 두 트리를 루트부터 비교하며 다른 자리로만 내려가는 함수(`diff`)가 전부다. 해시 함수는 교육용으로 **FNV-1a**(32비트, 결정적이고 빠르다)를 쓴다. 실제 시스템은 충돌 확률이 무시할 만큼 낮은 SHA-256급을 쓴다 — 알고리즘의 뼈대는 어느 해시를 꽂아도 똑같다.

::: dual
```python title="머클 트리 — 트리로 쌓고, 다른 자리로만 내려가며 비교한다"
MASK = 0xFFFFFFFF


def fnv1a(data: bytes) -> int:
    h = 0x811C9DC5
    for b in data:
        h ^= b
        h = (h * 0x01000193) & MASK
    return h


def leaf_hash(data: str) -> int:
    return fnv1a(data.encode())


def node_hash(left: int, right: int) -> int:
    return fnv1a(("%08x%08x" % (left, right)).encode())


def build_levels(leaves):
    """levels[0] = 리프 해시, levels[-1] = [루트]. 리프 개수는 2의 거듭제곱이어야 한다."""
    level = [leaf_hash(x) for x in leaves]
    levels = [level]
    while len(level) > 1:
        nxt = [node_hash(level[i], level[i + 1]) for i in range(0, len(level), 2)]
        levels.append(nxt)
        level = nxt
    return levels


def diff(a_leaves, b_leaves):
    """루트에서 시작해 해시가 다른 자리로만 내려간다. (달라진 리프 번호, 검사한 노드 수)."""
    a_levels = build_levels(a_leaves)
    b_levels = build_levels(b_leaves)
    top = len(a_levels) - 1
    diffs = []
    checked = 0

    def walk(level, idx):
        nonlocal checked
        checked += 1
        if a_levels[level][idx] == b_levels[level][idx]:
            return                          # 여기서 서브트리 전체를 건너뛴다
        if level == 0:
            diffs.append(idx)
            return
        walk(level - 1, idx * 2)
        walk(level - 1, idx * 2 + 1)

    walk(top, 0)
    return sorted(diffs), checked


LEAVES = ["block%d" % i for i in range(8)]
CHANGED = list(LEAVES)
CHANGED[5] = "block5-EDITED"

levels_a = build_levels(LEAVES)
levels_b = build_levels(CHANGED)
print("리프 8개, 노드 총 %d개 (리프 8 + 내부 7)" % (2 * len(LEAVES) - 1))
print("루트 A = %08x" % levels_a[-1][0])
print("루트 B = %08x" % levels_b[-1][0])
diffs, checked = diff(LEAVES, CHANGED)
print("달라진 리프 = %s" % diffs)
print("검사한 노드 수 = %d개  (전부 비교했다면 리프 %d개를 다 열어야 한다)" % (checked, len(LEAVES)))

N = 1024
big_a = ["item%d" % i for i in range(N)]
big_b = list(big_a)
big_b[777] = "item777-EDITED"
_, checked_big = diff(big_a, big_b)
import math
print("리프 %d개, 1개 변경 -> 검사한 노드 수 = %d개  (log2(%d) = %.1f)" % (N, checked_big, N, math.log2(N)))
```
```cpp title="머클 트리 — 트리로 쌓고, 다른 자리로만 내려가며 비교한다"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>
using namespace std;

const uint32_t MASK = 0xFFFFFFFFu;

uint32_t fnv1a(const string& data) {
    uint32_t h = 0x811C9DC5u;
    for (unsigned char b : data) {
        h ^= b;
        h = (h * 0x01000193u) & MASK;
    }
    return h;
}

uint32_t leaf_hash(const string& data) { return fnv1a(data); }

uint32_t node_hash(uint32_t left, uint32_t right) {
    char buf[17];
    snprintf(buf, sizeof buf, "%08x%08x", left, right);
    return fnv1a(string(buf));
}

// levels[0] = 리프 해시, levels[-1] = [루트]. 리프 개수는 2의 거듭제곱이어야 한다.
vector<vector<uint32_t>> build_levels(const vector<string>& leaves) {
    vector<uint32_t> level;
    for (auto& x : leaves) level.push_back(leaf_hash(x));
    vector<vector<uint32_t>> levels = {level};
    while (level.size() > 1) {
        vector<uint32_t> nxt;
        for (size_t i = 0; i < level.size(); i += 2)
            nxt.push_back(node_hash(level[i], level[i + 1]));
        levels.push_back(nxt);
        level = nxt;
    }
    return levels;
}

// 루트에서 시작해 해시가 다른 자리로만 내려간다. (달라진 리프 번호, 검사한 노드 수).
pair<vector<int>, int> diff(const vector<string>& a_leaves, const vector<string>& b_leaves) {
    auto a_levels = build_levels(a_leaves);
    auto b_levels = build_levels(b_leaves);
    int top = (int)a_levels.size() - 1;
    vector<int> diffs;
    int checked = 0;

    function<void(int, int)> walk = [&](int level, int idx) {
        checked += 1;
        if (a_levels[level][idx] == b_levels[level][idx]) return;   // 서브트리 전체를 건너뛴다
        if (level == 0) { diffs.push_back(idx); return; }
        walk(level - 1, idx * 2);
        walk(level - 1, idx * 2 + 1);
    };
    walk(top, 0);
    sort(diffs.begin(), diffs.end());
    return {diffs, checked};
}

int main() {
    vector<string> LEAVES;
    for (int i = 0; i < 8; i++) LEAVES.push_back("block" + to_string(i));
    vector<string> CHANGED = LEAVES;
    CHANGED[5] = "block5-EDITED";

    auto levels_a = build_levels(LEAVES);
    auto levels_b = build_levels(CHANGED);
    printf("리프 8개, 노드 총 %d개 (리프 8 + 내부 7)\n", (int)(2 * LEAVES.size() - 1));
    printf("루트 A = %08x\n", levels_a.back()[0]);
    printf("루트 B = %08x\n", levels_b.back()[0]);
    auto [diffs, checked] = diff(LEAVES, CHANGED);
    string ds = "[";
    for (size_t i = 0; i < diffs.size(); i++) { if (i) ds += ", "; ds += to_string(diffs[i]); }
    ds += "]";
    printf("달라진 리프 = %s\n", ds.c_str());
    printf("검사한 노드 수 = %d개  (전부 비교했다면 리프 %d개를 다 열어야 한다)\n", checked, (int)LEAVES.size());

    int N = 1024;
    vector<string> big_a, big_b;
    for (int i = 0; i < N; i++) big_a.push_back("item" + to_string(i));
    big_b = big_a;
    big_b[777] = "item777-EDITED";
    auto [diffs_big, checked_big] = diff(big_a, big_b);
    printf("리프 %d개, 1개 변경 -> 검사한 노드 수 = %d개  (log2(%d) = %.1f)\n",
           N, checked_big, N, log2((double)N));
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
리프 8개, 노드 총 15개 (리프 8 + 내부 7)
루트 A = 04a9d8b7
루트 B = 9f5181fd
달라진 리프 = [5]
검사한 노드 수 = 7개  (전부 비교했다면 리프 8개를 다 열어야 한다)
리프 1024개, 1개 변경 -> 검사한 노드 수 = 21개  (log2(1024) = 10.0)
```

**복잡도:** 트리를 쌓는 `build_levels`는 시간 $O(n)$ / 공간 $O(n)$ — 리프 $n$개에서 시작해 매 레벨 노드 수가 절반씩 줄어드는 등비수열의 합이 $2n$이다. `diff`는 두 트리가 완전히 같으면 $O(1)$(루트 비교 한 번), 리프 $k$개가 다르면 $O(k \log(n/k))$ — 다른 리프로 가는 경로마다 트리 높이만큼 노드를 검사하고, 안 다른 서브트리는 진입 즉시 멈춘다. 리프 1024개에서 1개가 다를 때 검사 노드가 21개인 것이 $2\log_2(1024) + 1$과 정확히 맞는다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 재귀 클로저 | 중첩 함수 `walk`가 `nonlocal checked`로 바깥 변수를 직접 수정한다 | `std::function`과 캡처 `[&]`로 참조 캡처해야 같은 일이 된다. 캡처를 값(`[=]`)으로 하면 `checked`가 각 호출마다 복사돼 누적이 깨진다 |
| 해시 출력 폭 | `%08x`가 32비트를 8자리 16진수로 고정 | `%08x`도 동일. 단 `uint32_t`를 명시하지 않으면 플랫폼에 따라 자리수가 흔들린다 |
| 정수 오버플로 방지 | 임의 정밀도라 `& MASK`가 사실상 장식이지만 의도를 명시한다 | `uint32_t` 곱셈은 자동으로 32비트에서 랩어라운드한다. `& MASK`는 없어도 되지만 **의도를 코드에 남긴다** |

::: pitfall
- **리프 개수가 2의 거듭제곱이 아닌데 그대로 짝을 짓는다.** 이 구현은 홀수 레벨에서 마지막 원소가 짝을 못 찾으면 조용히 멈춘다. 실제 시스템(Bitcoin 등)은 **마지막 리프를 복제**해 짝을 채운다 — 그 규칙이 없으면 리프 순서가 같은데 개수만 다른 두 트리의 루트가 우연히 같아지는 경로가 생긴다.
- **노드 해시에 "왼쪽인지 오른쪽인지"를 안 새긴다.** `H(a,b)`와 `H(b,a)`를 다르게 만들지 않으면 자식 둘의 순서를 바꿔도 같은 부모 해시가 나온다 — 이 구현은 문자열을 순서대로 이어 붙여 막았지만, 덧셈처럼 교환법칙이 성립하는 결합 방식을 쓰면 뚫린다.
- **"다르다"에서 멈추고 "어디가"는 안 판다.** 루트만 비교하고 만족하면 §1의 원래 문제로 되돌아간다. 이 챕터의 핵심은 다르다는 판정 자체가 아니라 **다른 자리로 내려가는 재귀**다.
:::

## 5. 어디에 쓰이는가

**git의 트리 오브젝트가 머클 트리 그 자체다.** 커밋마다 디렉터리 하나가 트리 오브젝트 하나이고, 그 안에 파일(블롭)과 하위 디렉터리(트리)의 해시가 나란히 적힌다. 이 레포에서 직접 확인할 수 있다. 최근 커밋 `65b539e`는 `tools/bench/`에 파일 두 개를 추가했을 뿐이고, `content/`는 건드리지 않았다.

```text
$ git cat-file -p 65b539e^{tree} | grep -E "content|tools"
040000 tree 49f5177a2dd272e1f30f955f1c72cee3803334bb	content
040000 tree eb54c0b1b4015271e482c4f35eec2033d4969340	tools

$ git cat-file -p cdf7894^{tree} | grep -E "content|tools"
040000 tree 49f5177a2dd272e1f30f955f1c72cee3803334bb	content
040000 tree f5b0ce260d0facedc96cd6dd82bacc9b36b62916	tools
```

`content` 트리의 해시 `49f5177a...`는 두 커밋에서 **한 글자도 다르지 않다.** git은 이 값만 보고 `content/` 아래 수백 개 파일을 단 한 번도 열지 않고 "여기는 안 바뀌었다"고 판정한다. `tools` 트리는 해시가 다르므로 한 단계 더 내려간다.

```text
$ git cat-file -p eb54c0b1b4015271e482c4f35eec2033d4969340
040000 tree 84cef8bde0c21dbc33893895bce27f0abe081a06	bench
100644 blob ba010dd3b8ada231712cfe36e33ec91682cfa190	check_code.py
100644 blob 3d5531a4abe10901d1eea58479ff807fb7f8a8b8	check_content.py
...

$ git cat-file -p f5b0ce260d0facedc96cd6dd82bacc9b36b62916
040000 tree 7cb896d0bfe753d2555be710ecb0298610cb4569	bench
100644 blob ba010dd3b8ada231712cfe36e33ec91682cfa190	check_code.py
100644 blob 3d5531a4abe10901d1eea58479ff807fb7f8a8b8	check_content.py
...
```

`bench` 트리의 해시만 갈리고 나머지 다섯 블롭(`check_code.py` 등)의 해시는 완전히 같다. §3의 트리를 그대로 두 단계 내려온 것이다 — **루트 → 서브트리 → 블롭까지, 안 바뀐 가지는 한 번도 열리지 않았다.** `git status`가 파일 수천 개짜리 저장소에서도 즉시 답하는 이유가 이것이다.

**Amazon Dynamo류의 리플리카 동기화**도 같은 구조를 쓴다(DeCandia 외, 2007, *Dynamo: Amazon's Highly Available Key-value Store*). 노드 두 대가 같은 데이터의 복제본을 들고 각자 머클 트리를 만든 뒤, 루트부터 주고받으며 다른 서브트리로만 내려간다. 네트워크 왕복이 $O(\log n)$번이면 끝나고, 마지막에 **정말로 다른 리프**만 전송한다.

**루트 해시 하나로 전체 무결성을 증명**하는 데도 쓴다. 블록체인의 거래 목록이 머클 트리로 묶이고, 블록 헤더에는 루트 하나만 들어간다. 거래 하나가 그 블록에 포함됐다는 것을 증명하려면 전체 거래 목록이 필요 없다 — 루트까지 가는 경로의 형제 노드 $\log n$개(머클 증명)만 있으면 된다.

## 연습

::: quiz
**1. 두 리전에 복제된 오브젝트 스토리지**
- 상황: 같은 버킷을 서울과 도쿄 리전에 복제한다. 야간 배치로 수백만 개 오브젝트 중 바뀐 것만 재동기화해야 한다.
- 무엇이 병목이거나 깨지는가: 오브젝트 메타데이터를 전부 주고받아 비교하면 그 자체가 큰 트래픽이다. 오브젝트 키를 정렬해 병합 비교하는 방법(§XV-12의 외부 정렬과 같은 모양)도 있지만, 매번 전체 키 목록을 두 리전이 주고받아야 한다.
- 어떤 구조이고 무엇을 대가로 치르는가: 오브젝트 키 범위를 리프로 나눈 머클 트리를 양쪽이 유지한다. 루트만 먼저 비교해 같으면 끝이고, 다르면 로그 스케일로 내려가 바뀐 범위만 찾는다. 대가는 **트리를 최신으로 유지하는 비용**이다 — 오브젝트가 하나 바뀔 때마다 리프에서 루트까지 경로 전체를 다시 해시해야 한다.

**2. 대용량 설정 파일 배포 시스템**
- 상황: 서버 수천 대에 같은 설정 번들(수 MB)을 배포한다. 대부분의 서버는 이미 최신 번들을 갖고 있고, 극소수만 이전 버전이다.
- 무엇이 병목이거나 깨지는가: 매번 전체 번들을 모든 서버에 밀어 넣으면 이미 최신인 서버에서도 대역폭이 낭비된다. 서버가 "나는 최신인지" 스스로 판정할 방법이 필요하다.
- 어떤 구조이고 무엇을 대가로 치르는가: 번들을 청크로 나눠 머클 트리로 묶고 **루트 해시만** 서버에 내려보낸다. 서버는 자기가 가진 번들의 루트를 계산해 비교하고, 같으면 아무 것도 받지 않는다. 다르면 그제서야 트리를 타고 내려가 바뀐 청크만 요청한다. 대가는 서버마다 청크 해시를 계산하는 CPU 비용이고, 청크가 작을수록 정밀해지지만 트리 관리 오버헤드가 커진다.

**3. 로그 저장소의 변조 탐지**
- 상황: 감사 로그를 append-only로 저장한다. 나중에 누군가 중간의 로그 한 줄을 몰래 고쳤는지 검증해야 한다.
- 무엇이 병목이거나 깨지는가: 로그 전체를 매번 통째로 다시 해시해 저장해 둔 값과 비교하면 검증 한 번에 로그 전체를 읽어야 하고, **어느 줄이 바뀌었는지도 알려주지 않는다.**
- 어떤 구조이고 무엇을 대가로 치르는가: 각 로그 줄이 이전 줄의 해시를 포함하는 해시 체인으로 저장하면 중간 하나를 고치는 순간 그 뒤 전부의 해시가 어긋나 변조가 드러난다. 대신 **어느 줄인지 빠르게 찾으려면** 체인 위에 별도의 머클 트리를 얹어야 한다 — 체인은 "변조 여부"를, 트리는 "어디"를 답한다. 둘의 역할이 §2.3에서 갈린 그대로다.
:::

## 요약

- 전체 해시 하나는 "다른지 같은지"만 답한다. **"어디가 다른지"는 해시를 계층으로 쌓아야 나온다.**
- 머클 트리는 리프 해시를 두 개씩 묶어 부모 해시를 만들며 올라간다. 루트가 같으면 그 아래 전부가 같다.
- 두 트리를 비교할 때는 **루트에서 시작해 해시가 다른 자식으로만 내려간다.** 같은 자식은 서브트리 전체를 건너뛴다.
- 리프 $n$개 중 $k$개가 다르면 검사 비용은 $O(k \log(n/k))$다. 실측에서 리프 1024개 중 1개가 다를 때 검사한 노드는 21개였다 — 전부 비교했다면 1024개다.
- 해시 체인은 다른 구조다. **머클 트리는 가로로 묶어 "어디가 다른가"를 빠르게 찾고, 해시 체인은 세로로 이어 "이력이 조작되지 않았는가"를 보장한다.** git의 커밋 하나가 둘을 동시에 쓴다.
- 이 레포의 실제 커밋 두 개(`65b539e`, `cdf7894`)를 `git cat-file -p`로 열어 보면 안 바뀐 `content/` 트리의 해시가 한 글자도 다르지 않고, 바뀐 `tools/` 트리만 갈라져 내려가는 것을 직접 확인할 수 있다.
- Dynamo류의 리플리카 동기화, 블록체인의 거래 증명, 설정 배포 시스템이 전부 같은 구조를 쓴다.

**다음 절**: [XV-8 일관성 해싱](#/xv-8) — 데이터를 여러 노드에 나누고, 노드 수가 바뀔 때 옮겨야 할 키를 최소화하는 문제로 넘어간다.
