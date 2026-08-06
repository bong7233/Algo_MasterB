# XV-2 B-Tree와 B+Tree

::: lead
균형 이진 탐색 트리는 높이가 $\log_2 n$이다. 그런데 왜 실제 데이터베이스 인덱스는 이진 트리를 쓰지 않는가.
:::

## 1. 문제

[II-9](#/ii-9)의 레드-블랙 트리는 노드 하나에 키 하나를 두고 자식을 최대 둘만 둔다. 그 설계는 메모리 안에서는 최선이다 — 포인터를 하나씩 따라가는 비용이 어디서나 같기 때문이다. 그 트리를 그대로 디스크에 옮기면 다른 문제가 생긴다.

행 십억 개짜리 테이블에 레드-블랙 트리로 인덱스를 만들었다고 하자. 높이는 $\log_2 10^9 \approx 30$이다. [XV-1](#/xv-1)이 세운 전제를 그대로 적용하면, 조회 한 번은 30번의 포인터 따라가기가 아니라 **최악 30번의 블록 읽기**다. 노드 하나가 흩어진 디스크 위치에 있으므로 순차 읽기의 이점도 없다. NVMe SSD 기준 대략적 자릿수(~100 μs)만 잡아도 조회 한 번이 3 ms 근처까지 간다 — 초당 몇백 건이 상한이 된다는 뜻이다.

**노드 하나에 키를 하나가 아니라 수백 개 담으면 어떨까.** 블록 하나를 읽을 때마다 어차피 4KB를 통째로 가져온다. 그 4KB 안에 키 하나만 넣고 버리는 것은 [XV-1](#/xv-1)이 보여준 "묶어서 옮기는 단위를 알뜰하게 못 쓰는" 실수 그 자체다. B-Tree는 노드 하나를 디스크 블록 하나에 맞춰 **키를 최대한 채운다.** 자식이 둘이 아니라 수백 개가 되면 트리 높이가 $\log_2$가 아니라 $\log_{\text{수백}}$으로 줄고, 위의 30번은 3번 근처로 떨어진다.

## 2. 아이디어

### 2.1 노드 하나가 디스크 블록 하나다

B-Tree는 **다진 탐색 트리**다. 노드마다 키를 여러 개 정렬해 담고, 키 사이사이에 자식을 하나씩 둔다. 자식 수를 $M$(order)이라 하면 한 노드는 키를 최대 $M-1$개, 자식을 최대 $M$개 가진다.

```text nolines
   노드 하나 (order=5, 키 최대 4개)

   [ 10 | 25 | 40 | 58 ]
     |    |    |    |    \
    <10  10~25 25~40 40~58 >58     <- 각 구간이 자식 하나를 가리킨다
```

탐색은 이진 탐색 트리와 같은 발상이지만 한 노드 안에서 갈 방향을 정할 때 **여러 키와 한 번에 비교**한다. 노드 하나를 읽는 비용(디스크 접근 한 번)이 그 안의 키를 몇 개 보든 똑같으므로, 노드 하나에 키를 많이 욱여넣을수록 **다음 레벨로 내려가는 횟수, 즉 디스크 접근 횟수가 줄어든다.** 실무의 $M$은 대개 수백에서 수천이다 — 블록 크기(4KB)를 키와 포인터 크기로 나눈 값이기 때문이다.

::: widget btree-ops {"order":4,"ops":[["insert",10],["insert",20],["insert",5],["insert",6],["insert",12],["insert",30],["insert",7],["insert",17]],"mode":"disk-blocks"}
:::

**opts 명세.** `order`는 노드 하나가 가질 수 있는 최대 자식 수(위 예는 4, 즉 노드당 키 최대 3개)다. `ops`는 재생할 연산의 순서열이고 각 원소는 `["insert", key]` 또는 `["search", key]` 형태다. `mode`가 `"disk-blocks"`이면 위젯은 각 연산이 방문한 노드마다 "블록 읽기 1회"로 세어 하단에 누적 카운터를 보여주고, 분할이 일어난 노드는 갈라지는 애니메이션과 함께 새 노드에 다른 배경을 준다. 스텝을 앞뒤로 옮기면 그 시점까지의 트리 모양과 누적 블록 읽기 수가 함께 바뀐다. 4분할 이상은 필요 없고 트리 하나만 그린다.

위 연산열을 손으로 옮기면 이렇다. 노드 하나가 키 셋을 넘으면(= order 4에서 4개가 되면) 가운데 키가 부모로 올라가고 나머지 절반씩이 두 노드로 갈라진다. 그 갈라짐이 반복되면서 뿌리까지 올라가면 트리 전체의 높이가 하나 늘어난다 — 리프가 늘어나는 것이 아니라 **뿌리 위에 새 뿌리가 생기는 방식**으로 큰다는 것이 이 구조의 핵심이다. 아래 손추적이 이 과정을 정확히 그 순서로 보여준다.

### 2.2 B+Tree — 같은 골격, 다른 데이터 배치

B-Tree는 내부 노드에도 실제 데이터(또는 데이터를 가리키는 포인터)를 둔다. **B+Tree**는 데이터를 **리프에만** 두고, 내부 노드는 오직 "어느 자식으로 갈지"를 정하는 이정표로만 쓴다. 그리고 리프끼리 연결 리스트로 이어 둔다.

```text nolines
   B-Tree 내부 노드          B+Tree 내부 노드
   [10*, 25*, 40*]           [10, 25, 40]        <- 키만, 데이터 없음
    각 키가 데이터도 가리킴     리프로만 내려가는 이정표

   B+Tree 리프
   [1,3,7] -> [10,15,22] -> [25,30] -> [40,55]    <- 화살표는 형제 리프로의 포인터
```

이 차이가 두 가지를 만든다. 첫째, 내부 노드에 데이터가 없으니 **같은 4KB에 더 많은 키를 담을 수 있고, 그만큼 자식 수가 늘어 트리가 더 납작해진다.** 둘째, 리프가 연결 리스트로 이어져 있어 **범위 조회**(`WHERE age BETWEEN 20 AND 30` 같은 질의)가 뿌리부터 다시 내려갈 필요 없이 리프 하나를 찾은 뒤 옆으로 훑기만 하면 된다. 그 대가로 같은 키가 내부 노드와 리프에 중복해서 나타날 수 있다. 관계형 데이터베이스의 인덱스가 거의 예외 없이 B-Tree가 아니라 **B+Tree**를 쓰는 이유가 이 둘이다. 이 챕터의 구현은 데이터가 어디에 있는지의 차이를 제외하면 골격이 같은 B-Tree로 삽입·분할을 보인다 — 분할 로직 자체는 두 구조가 같다.

## 3. 손으로 따라가기

::: trace
`order=3`인 B-Tree(노드당 키 최대 2개)에 10, 20, 30, 40, 50을 순서대로 넣는다. 노드가 키 3개가 되면 가운데 키(둘째)가 부모로 올라가고 나머지가 좌우로 갈라진다. `height` 열은 뿌리에서 리프까지의 레벨 수다.

| 삽입 | 무슨 일이 일어나는가 | 뿌리의 키 | height |
|---|---|---|---|
| 10 | 뿌리에 그냥 넣는다 | [10] | 1 |
| 20 | 뿌리에 그냥 넣는다(아직 2개, 넘치지 않음) | [10, 20] | 1 |
| 30 | 뿌리가 [10,20,30]으로 넘친다 → 20이 위로, [10]과 [30]으로 갈라진다 → **새 뿌리 생성** | | |
| 40 | | | |
| 50 | | | |
:::

::: answer
| 삽입 | 무슨 일이 일어나는가 | 뿌리의 키 | height |
|---|---|---|---|
| 10 | 뿌리에 그냥 넣는다 | [10] | 1 |
| 20 | 뿌리에 그냥 넣는다(아직 2개, 넘치지 않음) | [10, 20] | 1 |
| 30 | 뿌리가 [10,20,30]으로 넘친다 → 20이 위로, [10]과 [30]으로 갈라진다 → **새 뿌리 생성** | [20] | 2 |
| 40 | 오른쪽 리프에 들어간다. [30,40]은 아직 2개라 안 넘친다 | [20] | 2 |
| 50 | 오른쪽 리프가 [30,40,50]으로 넘친다 → 40이 위로 올라가 **뿌리에 합류**([20,40]) → 리프 셋으로 갈라진다 | [20, 40] | 2 |
:::

세 가지를 확인하라.

- [ ] 높이가 늘어난 것은 30을 넣었을 때 **한 번뿐**이다. 그 뒤로 40, 50을 더 넣어도 높이 2를 유지한다 — 넘친 노드가 리프든 뿌리든, 분할이 뿌리까지 전파되지 않으면 높이는 그대로다.
- [ ] 이진 탐색 트리라면 10, 20, 30, 40, 50을 이 순서로 넣었을 때(회전 없이) 무엇이 되는가. 그 모양과 B-Tree의 높이 2를 비교하라.
- [ ] 40을 넣을 때 20을 다시 방문하는데도 뿌리의 키 목록이 안 바뀐다. **어느 노드가 넘쳐야 부모가 바뀌는지** 한 줄로 답하라.

## 4. 구현

order를 매개변수로 받는 일반형 B-Tree다. 삽입은 뿌리에서 리프까지 내려가 키를 넣고, 넘친 노드를 그 자리에서 둘로 가르며 **가운데 키를 부모에게 돌려주는 방식**으로 위로 전파한다. 부모가 없으면(뿌리가 넘치면) 새 뿌리를 만든다 — 3절에서 본 것과 같은 그 순간이다.

::: dual
```python title="B-Tree — 삽입과 노드 분할"
ORDER = 3  # 자식 최대 개수. 키는 최대 ORDER-1개


class Node:
    def __init__(self, leaf=True):
        self.keys = []
        self.children = []
        self.leaf = leaf


def find_child_index(node, key):
    """key 가 들어갈 자식(또는 삽입 위치)의 인덱스."""
    i = 0
    while i < len(node.keys) and key > node.keys[i]:
        i += 1
    return i


def split(node):
    """키가 넘친 노드를 절반으로 가르고 가운데 키를 위로 올린다."""
    mid = len(node.keys) // 2
    up_key = node.keys[mid]
    left = Node(node.leaf)
    right = Node(node.leaf)
    left.keys = node.keys[:mid]
    right.keys = node.keys[mid + 1:]
    if not node.leaf:
        left.children = node.children[:mid + 1]
        right.children = node.children[mid + 1:]
    return up_key, left, right


def insert_rec(node, key, blocks):
    """뿌리에서 리프까지 내려가며 삽입한다. 넘치면 (올릴 키, 왼쪽, 오른쪽)을 돌려준다."""
    blocks[0] += 1                          # 블록(노드) 하나를 읽었다
    if node.leaf:
        i = find_child_index(node, key)
        node.keys.insert(i, key)
        if len(node.keys) > ORDER - 1:
            return split(node)
        return None
    i = find_child_index(node, key)
    result = insert_rec(node.children[i], key, blocks)
    if result is None:
        return None
    up_key, left, right = result
    node.keys.insert(i, up_key)
    node.children[i:i + 1] = [left, right]
    if len(node.keys) > ORDER - 1:
        return split(node)
    return None


def insert(root, key, blocks):
    result = insert_rec(root, key, blocks)
    if result is None:
        return root
    up_key, left, right = result
    new_root = Node(leaf=False)             # 분할이 뿌리까지 올라오면 새 뿌리를 만든다
    new_root.keys = [up_key]
    new_root.children = [left, right]
    return new_root


def search(node, key, blocks):
    blocks[0] += 1                          # 블록 읽기 — 이 챕터가 세는 단위
    i = find_child_index(node, key)
    if i < len(node.keys) and node.keys[i] == key:
        return True
    if node.leaf:
        return False
    return search(node.children[i], key, blocks)


def height(node):
    h = 1
    while not node.leaf:
        h += 1
        node = node.children[0]
    return h


def binary_search_steps(arr, key):
    """정렬 배열 이분 탐색 — 대조군. 비교 1회 = 원소 하나가 다른 블록에 있다면 블록 1회."""
    lo, hi, steps = 0, len(arr) - 1, 0
    while lo <= hi:
        steps += 1
        mid = (lo + hi) // 2
        if arr[mid] == key:
            return True, steps
        if arr[mid] < key:
            lo = mid + 1
        else:
            hi = mid - 1
    return False, steps


def main():
    import random

    print("[1] 삽입 추적 — ORDER=3, 10, 20, 30, 40, 50")
    root = Node()
    for k in (10, 20, 30, 40, 50):
        blocks = [0]
        root = insert(root, k, blocks)
        print("  insert %2d  height=%d  root.keys=%s" % (k, height(root), root.keys))

    print("[2] 대조 — B-Tree 탐색 대 정렬 배열 이분 탐색, ORDER=128, N=100000")
    global ORDER
    ORDER = 128
    random.seed(0)
    values = random.sample(range(1, 2_000_000), 100_000)
    root = Node()
    for v in values:
        root = insert(root, v, [0])
    sorted_vals = sorted(values)
    present_set = set(values)

    query = values[:250] + random.sample(range(2_000_000, 4_000_000), 250)
    random.shuffle(query)

    mismatches = 0
    bt_blocks_total = 0
    bs_steps_total = 0
    for q in query:
        blocks = [0]
        bt_found = search(root, q, blocks)
        bs_found, steps = binary_search_steps(sorted_vals, q)
        if bt_found != bs_found or bt_found != (q in present_set):
            mismatches += 1
        bt_blocks_total += blocks[0]
        bs_steps_total += steps

    n = len(query)
    print("  질의 %d건, 불일치 %d건" % (n, mismatches))
    print("  트리 높이 %d" % height(root))
    print("  평균 B-Tree 블록 읽기 %.2f" % (bt_blocks_total / n))
    print("  평균 이분 탐색 비교 %.2f" % (bs_steps_total / n))


main()
```
```cpp title="B-Tree — 삽입과 노드 분할"
#include <algorithm>
#include <cstdio>
#include <optional>
#include <random>
#include <set>
#include <vector>
using namespace std;

int ORDER = 3;  // 자식 최대 개수. 키는 최대 ORDER-1개

struct Node {
    vector<long long> keys;
    vector<Node*> children;
    bool leaf;
    Node(bool leaf_ = true) : leaf(leaf_) {}
};

struct SplitResult {
    long long up_key;
    Node* left;
    Node* right;
};

int find_child_index(Node* node, long long key) {
    // key 가 들어갈 자식(또는 삽입 위치)의 인덱스
    int i = 0;
    while (i < (int)node->keys.size() && key > node->keys[i]) i++;
    return i;
}

SplitResult split(Node* node) {
    // 키가 넘친 노드를 절반으로 가르고 가운데 키를 위로 올린다
    int mid = (int)node->keys.size() / 2;
    long long up_key = node->keys[mid];
    Node* left = new Node(node->leaf);
    Node* right = new Node(node->leaf);
    left->keys.assign(node->keys.begin(), node->keys.begin() + mid);
    right->keys.assign(node->keys.begin() + mid + 1, node->keys.end());
    if (!node->leaf) {
        left->children.assign(node->children.begin(), node->children.begin() + mid + 1);
        right->children.assign(node->children.begin() + mid + 1, node->children.end());
    }
    return {up_key, left, right};
}

optional<SplitResult> insert_rec(Node* node, long long key, long long& blocks) {
    // 뿌리에서 리프까지 내려가며 삽입한다. 넘치면 (올릴 키, 왼쪽, 오른쪽)을 돌려준다
    blocks += 1;                            // 블록(노드) 하나를 읽었다
    if (node->leaf) {
        int i = find_child_index(node, key);
        node->keys.insert(node->keys.begin() + i, key);
        if ((int)node->keys.size() > ORDER - 1) return split(node);
        return nullopt;
    }
    int i = find_child_index(node, key);
    auto result = insert_rec(node->children[i], key, blocks);
    if (!result) return nullopt;
    long long up_key = result->up_key;
    node->keys.insert(node->keys.begin() + i, up_key);
    node->children.erase(node->children.begin() + i);
    node->children.insert(node->children.begin() + i, {result->left, result->right});
    if ((int)node->keys.size() > ORDER - 1) return split(node);
    return nullopt;
}

Node* insert(Node* root, long long key, long long& blocks) {
    auto result = insert_rec(root, key, blocks);
    if (!result) return root;
    Node* new_root = new Node(false);       // 분할이 뿌리까지 올라오면 새 뿌리를 만든다
    new_root->keys = {result->up_key};
    new_root->children = {result->left, result->right};
    return new_root;
}

bool search(Node* node, long long key, long long& blocks) {
    blocks += 1;                            // 블록 읽기 — 이 챕터가 세는 단위
    int i = find_child_index(node, key);
    if (i < (int)node->keys.size() && node->keys[i] == key) return true;
    if (node->leaf) return false;
    return search(node->children[i], key, blocks);
}

int height(Node* node) {
    int h = 1;
    while (!node->leaf) { h++; node = node->children[0]; }
    return h;
}

// 정렬 배열 이분 탐색 — 대조군. 비교 1회 = 원소 하나가 다른 블록에 있다면 블록 1회.
pair<bool, int> binary_search_steps(const vector<long long>& arr, long long key) {
    int lo = 0, hi = (int)arr.size() - 1, steps = 0;
    while (lo <= hi) {
        steps++;
        int mid = (lo + hi) / 2;
        if (arr[mid] == key) return {true, steps};
        if (arr[mid] < key) lo = mid + 1;
        else hi = mid - 1;
    }
    return {false, steps};
}

int main() {
    printf("[1] 삽입 추적 — ORDER=3, 10, 20, 30, 40, 50\n");
    Node* root = new Node();
    for (long long k : {10, 20, 30, 40, 50}) {
        long long blocks = 0;
        root = insert(root, k, blocks);
        printf("  insert %2lld  height=%d  root.keys=[", k, height(root));
        for (size_t j = 0; j < root->keys.size(); j++) {
            if (j) printf(", ");
            printf("%lld", root->keys[j]);
        }
        printf("]\n");
    }

    printf("[2] 대조 — B-Tree 탐색 대 정렬 배열 이분 탐색, ORDER=128, N=100000\n");
    ORDER = 128;
    mt19937 rng(0);
    vector<long long> pool_vec;
    for (long long v = 1; v < 2000000; v++) pool_vec.push_back(v);
    shuffle(pool_vec.begin(), pool_vec.end(), rng);
    vector<long long> values(pool_vec.begin(), pool_vec.begin() + 100000);

    root = new Node();
    for (long long v : values) {
        long long blocks = 0;
        root = insert(root, v, blocks);
    }
    vector<long long> sorted_vals = values;
    sort(sorted_vals.begin(), sorted_vals.end());
    set<long long> present_set(values.begin(), values.end());

    vector<long long> absent_pool;
    for (long long v = 2000000; v < 4000000; v++) absent_pool.push_back(v);
    shuffle(absent_pool.begin(), absent_pool.end(), rng);

    vector<long long> query(values.begin(), values.begin() + 250);
    query.insert(query.end(), absent_pool.begin(), absent_pool.begin() + 250);
    shuffle(query.begin(), query.end(), rng);

    int mismatches = 0;
    long long bt_blocks_total = 0, bs_steps_total = 0;
    for (long long q : query) {
        long long blocks = 0;
        bool bt_found = search(root, q, blocks);
        auto [bs_found, steps] = binary_search_steps(sorted_vals, q);
        bool expect = present_set.count(q) > 0;
        if (bt_found != bs_found || bt_found != expect) mismatches++;
        bt_blocks_total += blocks;
        bs_steps_total += steps;
    }

    int n = (int)query.size();
    printf("  질의 %d건, 불일치 %d건\n", n, mismatches);
    printf("  트리 높이 %d\n", height(root));
    printf("  평균 B-Tree 블록 읽기 %.2f\n", (double)bt_blocks_total / n);
    printf("  평균 이분 탐색 비교 %.2f\n", (double)bs_steps_total / n);
    return 0;
}
```
:::

**복잡도:** 삽입·탐색 모두 시간 $O(\log_M n)$ — 트리 높이가 $\log_M n$이고 레벨마다 노드 하나(블록 하나)를 읽으므로 **디스크 접근은 $O(\log_M n)$번**이다. 근거는 코드 직후에 이어진다.

```console title="Python 출력"
[1] 삽입 추적 — ORDER=3, 10, 20, 30, 40, 50
  insert 10  height=1  root.keys=[10]
  insert 20  height=1  root.keys=[10, 20]
  insert 30  height=2  root.keys=[20]
  insert 40  height=2  root.keys=[20]
  insert 50  height=2  root.keys=[20, 40]
[2] 대조 — B-Tree 탐색 대 정렬 배열 이분 탐색, ORDER=128, N=100000
  질의 500건, 불일치 0건
  트리 높이 3
  평균 B-Tree 블록 읽기 2.96
  평균 이분 탐색 비교 16.30
```

```console title="C++ 출력"
[1] 삽입 추적 — ORDER=3, 10, 20, 30, 40, 50
  insert 10  height=1  root.keys=[10]
  insert 20  height=1  root.keys=[10, 20]
  insert 30  height=2  root.keys=[20]
  insert 40  height=2  root.keys=[20]
  insert 50  height=2  root.keys=[20, 40]
[2] 대조 — B-Tree 탐색 대 정렬 배열 이분 탐색, ORDER=128, N=100000
  질의 500건, 불일치 0건
  트리 높이 3
  평균 B-Tree 블록 읽기 2.97
  평균 이분 탐색 비교 16.30
```

각 레벨에서 노드 하나를 읽어 그 안의 키 최대 $M-1$개를 훑으므로(구현은 선형 훑기라 노드당 $O(M)$, 실전에서는 노드 내부 이분 탐색으로 $O(\log M)$까지 줄인다) 총 비교는 $O(M \log_M n)$이다. $M$이 클수록 비교 횟수는 늘어도 접근 횟수는 줄어드는 것이 이 구조의 교환이다. 공간 $O(n)$ — 키 하나당 저장은 상수 배.

실측이 그 교환을 보여준다. 10만 개짜리 데이터에서 order 128 B-Tree는 평균 **블록 3회**로 답을 찾고, 정렬 배열 이분 탐색은 (배열이 통째로 디스크에 있다고 가정하면) **16회**를 오간다. 무작위 500건 대조에서 두 방식과 정답 집합(Python `set`)이 **불일치 0건**으로 일치했다 — B-Tree가 정답을 낸다는 것과, 그 정답을 더 적은 블록 읽기로 낸다는 것은 별개의 주장이고 위 실측이 둘 다 확인한다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 분할 결과 전달 | `None` 또는 `(up_key, left, right)` 튜플 | `std::optional<SplitResult>` |
| 무작위 표본 | `random.sample` — 별도 셔플 없이 표본 추출 | `std::shuffle` + 앞에서 자르기. 표본 알고리즘이 달라 **같은 시드라도 뽑히는 값이 다르다** |
| 무작위 표본의 결과 | 평균 블록 읽기 2.96 | 평균 블록 읽기 2.97 |
| 노드 메모리 | 가비지 컬렉터가 회수 | `new` 로 만들고 해제하지 않는다 — 데모 프로그램이라 종료 시 OS가 회수한다. 실전 구현은 소유권을 정해야 한다 |
| 재귀 반환 없음 표현 | `return None` | `return nullopt` |

::: pitfall
- **분할을 삽입이 끝난 뒤에만 하려고 한다.** 이 구현처럼 리프에서 뿌리 쪽으로 분할을 전파하는 대신, 실전 구현 다수는 **내려가는 길에 미리 분할한다** — 꽉 찬 자식으로 내려가기 직전에 그 자식을 쪼갠다. 두 방식 다 옳지만 섞으면 안 된다. 이 챕터는 전파 방식을 썼다는 것을 분명히 해 둔다.
- **뿌리가 넘쳤는데 새 뿌리를 안 만든다.** `insert_rec`이 분할 결과를 돌려줬는데 호출부가 무시하면 그 키가 조용히 사라진다. 뿌리는 부모가 없는 유일한 노드라 **분할 처리가 재귀 밖, 최상위 `insert` 함수에만 있다.**
- **`order`를 너무 작게 잡고 실무 수치인 것처럼 읽는다.** 위 손추적의 `order=3`은 분할 과정을 눈으로 보기 위한 값이다. 실무 B+Tree는 블록 크기 나누기 키 크기로 정해지고 대개 수백에서 수천이다. `order`가 커질수록 트리는 더 납작해지고 손추적은 더 안 보인다 — 그래서 둘을 나눠 실었다.
- **키 하나로 한 번에 한 노드씩만 삽입한다고 여긴다.** 실전 DB는 삽입을 모아 한 번에 처리하거나(배치), B+Tree 자체가 아니라 그 앞에 LSM처럼 쓰기를 순차화하는 계층을 둔다([XV-3](#/xv-3)). B-Tree가 느린 것은 삽입이 아니라 **삽입이 무작위 위치를 제자리 갱신**하기 때문이다 — 다음 챕터가 그 지점만 다르게 푼다.
:::

## 5. 어디에 쓰이는가

**관계형 데이터베이스의 인덱스는 거의 전부 B+Tree다.** PostgreSQL의 기본 인덱스, MySQL InnoDB의 클러스터드 인덱스가 그렇다. 클러스터드 인덱스는 한 걸음 더 나아가 **테이블의 실제 행 데이터를 B+Tree의 리프에 직접 둔다** — 그러면 기본 키로 조회할 때 인덱스를 찾은 것이 곧 행을 찾은 것이 되어 별도의 조회가 없다.

**파일시스템도 같은 구조를 쓴다.** NTFS는 디렉터리 항목을 B+Tree로 관리하고, ext4·XFS는 확장 영역 매핑에 B-Tree 계열 구조(HTree, B+Tree)를 쓴다. 디렉터리 안 파일이 수만 개가 넘어도 이름으로 찾는 속도가 거의 안 떨어지는 이유가 이것이다 — 선형 목록이었다면 파일 수에 비례해 느려졌을 것이다.

**[II-9](#/ii-9)의 레드-블랙 트리와 이 챕터의 관계는 "메모리판과 디스크판"이다.** 둘 다 정렬 순서를 유지하며 로그 높이를 보장하지만, 레드-블랙 트리는 포인터 하나 따라가는 비용이 균일한 세계를 가정하고 B-Tree는 그 비용이 자릿수로 벌어지는 세계를 가정한다. [XV-5 스킵 리스트](#/xv-5)는 또 다른 답이다 — 균형을 확률로 잡아 회전 없이 삽입하는, 같은 "정렬 유지" 문제의 세 번째 해법이다.

## 연습

::: quiz
설계 질문 3단 형식이다. **상황 → 무엇이 병목인가 → 어떤 구조이고 대가는 무엇인가.**

**1. 시계열 데이터베이스의 기본 인덱스.** 타임스탬프로 정렬된 채 저장되고, 조회는 대부분 "이 구간의 전부"를 묻는 범위 조회다.
- 상황: 점 조회보다 범위 조회가 압도적으로 많다.
- 무엇이 병목인가: 내부 노드까지 훑어야 하는 구조라면 범위의 시작점을 찾은 뒤 다시 뿌리로 돌아가 다음 키를 찾는 낭비가 반복된다.
- 어떤 구조와 대가: B+Tree. 리프가 연결 리스트로 이어져 있어 시작점만 찾으면 옆으로 훑기만 하면 된다. 대가는 내부 노드에 데이터를 못 두므로 점 조회가 항상 리프까지 내려가야 한다는 것 — B-Tree라면 운이 좋으면 내부 노드에서 끝날 수도 있다.

**2. order를 얼마로 잡을 것인가.** 새 인덱스를 설계하며 노드 하나의 자식 수(order)를 정해야 한다. 디스크 블록은 4KB, 키는 8바이트, 자식 포인터는 8바이트다.
- 상황: order를 키우면 트리가 납작해져 블록 읽기가 줄지만, 한 노드 안에서 훑는 비교 횟수는 늘어난다.
- 무엇이 병목인가: 블록 읽기(디스크 접근, [XV-1](#/xv-1) 표에서 다섯 자릿수 느림)와 노드 내부 비교(메모리 접근, 두 자릿수 빠름)는 비용이 네 자릿수 넘게 차이 난다.
- 어떤 구조와 대가: 블록 크기를 최대한 채우는 order — 4KB를 (키+포인터) 16바이트로 나누면 대략 256. 대가는 없다시피 하다. 노드 내부의 추가 비교는 메모리에서 일어나므로 디스크 접근 한 번 아끼는 이득에 비하면 무시할 만하다. **이것이 order가 실무에서 항상 크게 잡히는 이유다.**

**3. 쓰기가 아주 잦은 워크로드.** 초당 쓰기가 수만 건이고 대부분 새 키다.
- 상황: 삽입마다 트리의 무작위 위치를 제자리에서 고친다.
- 무엇이 병목인가: 제자리 갱신은 무작위 쓰기이고, [XV-1](#/xv-1)의 실측처럼 무작위 접근은 순차 접근보다 자릿수로 느리다. B-Tree 자체는 이 문제를 풀지 않는다 — 접근 횟수를 줄일 뿐 접근을 순차로 만들지는 않는다.
- 어떤 구조와 대가: 쓰기를 메모리에 모았다가 순차로 통째 흘려보내는 구조. 다음 챕터가 정확히 이 문제를 다룬다.
:::

## 요약

- 레드-블랙 트리를 그대로 디스크에 두면 높이만큼 디스크 접근이 필요하고, 그 접근 하나하나가 [XV-1](#/xv-1)의 다섯 자릿수 배수를 문다.
- B-Tree는 노드 하나에 키를 여러 개 담아 자식 수를 키운다. 자식이 많을수록 트리가 납작해지고, 트리 높이가 곧 디스크 접근 횟수다.
- 삽입은 리프에 넣고, 넘친 노드를 절반으로 갈라 가운데 키를 부모에게 올린다. 그 전파가 뿌리까지 닿으면 **새 뿌리가 생기고 그때만 높이가 는다.**
- B+Tree는 데이터를 리프에만 두고 내부 노드는 이정표로만 쓴다. 리프끼리 연결해 범위 조회를 옆으로 훑는 것으로 바꾸고, 그래서 관계형 DB 인덱스의 실질 표준이다.
- 실측: order 128, 10만 개에서 B-Tree는 평균 블록 3회, 정렬 배열 이분 탐색은 16회. 무작위 500건 대조에서 정답 불일치 0건.
- order는 디스크 블록 크기가 정한다. 블록을 최대한 채우는 것이 언제나 이득이다 — 노드 내부 비교는 메모리에서 공짜에 가깝고, 아끼는 것은 자릿수로 비싼 디스크 접근이다.
- B-Tree가 못 푸는 문제가 남아 있다. 삽입은 여전히 무작위 위치의 제자리 갱신이다.

**다음 절**: [XV-3 LSM Tree와 SSTable](#/xv-3) — 제자리 갱신을 버리고 쓰기를 전부 순차 append로 바꾸면 무엇을 얻고 무엇을 내주는지 본다.
