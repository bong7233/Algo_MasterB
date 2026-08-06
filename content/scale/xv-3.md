# XV-3 LSM Tree와 SSTable

::: lead
[XV-2](#/xv-2)의 B-Tree는 삽입마다 무작위 위치를 고쳐 쓴다. 그 대신 쓰기를 전부 줄 세워 순서대로만 쓴다면 무엇을 얻고 무엇을 내주는가.
:::

## 1. 문제

B-Tree는 읽기를 빠르게 만드는 데 성공했다 — [XV-2](#/xv-2)에서 10만 개 중 평균 3번의 블록 읽기로 답을 찾았다. 그런데 그 대가는 **쓰기**에 있다. 키 하나를 삽입할 때마다 트리를 뿌리에서 리프까지 내려가 **그 키가 속한 자리를 정확히 찾아 고쳐 쓴다.** 다음 삽입은 전혀 다른 자리를 고친다. [XV-1](#/xv-1)의 실측이 이미 보여준 사실이 여기서 그대로 청구된다 — **무작위 위치를 건드리는 쓰기는 순차 쓰기보다 자릿수로 느리다.**

초당 수만 건씩 새 값이 들어오는 시계열 수집기, 로그 적재기, 이벤트 스토어를 생각해 보자. 쓰기가 지배적이고 대부분 새로운 키다. B-Tree로 이 워크로드를 받으면 쓰기마다 디스크의 무작위 위치 하나를 열어 고쳐 쓴다. 회전 디스크라면 탐색(seek)이 병목이 되고, SSD라도 무작위 쓰기는 순차 쓰기보다 여전히 느리며 플래시 마모도 더 준다.

**질문을 뒤집으면 답이 보인다.** 쓰기를 무작위 위치에 바로 반영하지 말고, 일단 메모리에 모아 뒀다가 **다 찬 다음에 통째로 디스크 끝에 순서대로 붙이면(append) 어떤가.** 각 쓰기가 어디로 갈지는 이미 정해져 있지 않지만, 디스크에 쓰는 동작 자체는 항상 "지금 끝에 이어 붙이기" 하나뿐이다. append는 탐색이 필요 없는 가장 싼 디스크 동작이다.

## 2. 아이디어

### 2.1 memtable, 그리고 다 차면 통째로 내려쓴다

**LSM Tree**(Log-Structured Merge-Tree)의 구조는 이렇다.

```text nolines
   쓰기 요청
      │
      v
   [ memtable ]  <- 메모리의 정렬 자료구조 (여기서는 딕셔너리 + 정렬)
      │  다 차면
      v
   [ L0 조각 ]  [ L0 조각 ]  [ L0 조각 ]   <- 디스크에 순차로 append된 정렬 파일들(SSTable)
      │              │             │
      └──────────────┴─────────────┘        <- 다 쌓이면 컴팩션
                     │
                     v
              [   L1 조각   ]   <- 겹치는 키를 정리해 하나로 다시 쓴 정렬 파일
```

쓰기는 항상 memtable에만 반영된다. memtable이 다 차면 그 내용을 키 순서로 정렬해 디스크에 새 파일로 **한 번에 순차로 통째 쓴다.** 이 파일이 **SSTable**(Sorted String Table)이다 — 한 번 쓰이면 다시 고치지 않는다는 뜻에서 불변(immutable)이다. 같은 키를 나중에 또 쓰면 새 SSTable에 새 값이 들어갈 뿐, 옛 SSTable의 값을 지우러 가지 않는다. **제자리 갱신을 아예 하지 않는 것**이 이 구조의 핵심이다.

### 2.2 컴팩션 — 쌓인 조각을 정리한다

SSTable이 계속 쌓이기만 하면 두 가지가 나빠진다. 디스크 공간이 낭비되고(같은 키의 옛 값이 계속 남는다), 조회가 느려진다(한 키를 찾으려면 조각을 전부 뒤져야 할 수 있다). **컴팩션**은 여러 SSTable을 병합해 겹치는 키를 정리하고 더 적은 수의 큰 조각으로 다시 쓰는 과정이다. 병합은 이미 정렬된 파일 여러 개를 합치는 것이라 [VI-3](#/vi-3) 투 포인터의 다중 판, k-way merge다.

::: widget lsm-compaction {"memtableCap":2,"l0Threshold":2,"ops":[["put",1,"a"],["put",2,"b"],["put",3,"c"],["put",1,"z"],["put",4,"d"]],"showAmplification":true}
:::

**opts 명세.** `memtableCap`은 memtable이 몇 개의 키를 담으면 플러시할지, `l0Threshold`는 L0 조각이 몇 개 쌓이면 컴팩션을 시작할지다. `ops`는 `["put", key, value]` 순서열이고 스텝마다 재생한다. `showAmplification`이 `true`이면 위젯 하단에 지금까지 "논리 쓰기 수"와 "디스크에 실제로 쓰인 항목 수"를 나란히 세어 **쓰기 증폭 배율**을 실시간으로 보여준다. 컴팩션이 일어나는 스텝에서는 합쳐지는 조각들이 하나로 흘러들어가는 애니메이션과 함께, **버려지는 옛 값**(같은 키의 더 이전 값)을 흐리게 표시해 "다시 쓰인다"는 사실을 눈에 보이게 한다.

이 연산열을 손으로 옮기면 이렇다. 키 1을 두 번 쓴다(`a` 그리고 나중에 `z`). 두 값이 서로 다른 SSTable에 흩어져 있다가, 컴팩션이 일어나는 순간 **둘 다 다시 읽혀서** 더 최신인 `z`만 살아남고 `a`는 버려진다. 그 "다시 읽고 다시 쓰기"가 정확히 쓰기 증폭의 실체다.

### 2.3 조회는 여러 곳을 봐야 한다 — 이것이 B-Tree와의 교환이다

쓰기를 순차로 바꾼 대가는 읽기 쪽에서 나온다. 키 하나를 찾으려면 **memtable부터 시작해 최신 SSTable, 그다음 예전 SSTable 순으로 값을 찾을 때까지 본다.** 컴팩션 직후에는 조각이 적어 빠르지만, 쓰기가 쌓여 컴팩션 사이 구간에 있으면 조각을 여러 개 봐야 할 수 있다. [XV-2](#/xv-2)의 B-Tree는 정확히 반대다 — 쓰기가 비싸고 읽기는 항상 $O(\log_M n)$으로 예측 가능하다.

$$\text{쓰기 증폭} = \frac{\text{디스크에 실제로 쓴 바이트}}{\text{사용자가 논리적으로 쓴 바이트}}, \qquad \text{읽기 증폭} = \frac{\text{조회 한 번당 실제로 읽은 SSTable 수}}{1}$$

**"어느 쪽이 낫다"가 아니라 교환이다.** B-Tree는 읽기 증폭이 거의 1에 가깝고(운 좋으면 내부 노드에서 끝난다) 쓰기가 무작위다. LSM은 쓰기가 순차이고 쌌지만 읽기 증폭이 1보다 크다. 블룸 필터([XV-4](#/xv-4))는 이 읽기 증폭을 줄이는 장치이지, 없애는 장치가 아니다 — "이 SSTable에 이 키가 없다"를 미리 알려줘 헛걸음을 줄일 뿐, 있는 키를 찾는 데는 여전히 여러 조각을 봐야 한다.

## 3. 손으로 따라가기

::: trace
`memtable_cap=2`(두 개 차면 플러시), `l0_threshold=2`(L0 조각이 두 개 쌓이면 컴팩션)로 `put(1,a) put(2,b) put(3,c) put(1,z) put(4,d)`를 순서대로 실행한다. `l0`은 조각 개수, `l1`은 컴팩션으로 합쳐진 내용이다.

| 연산 | memtable | l0 | l1 |
|---|---|---|---|
| put(1,a) | {1:a} | 0개 | [] |
| put(2,b) | {} (플러시 → l0에 T1=[(1,a),(2,b)] 추가) | 1개: [T1] | [] |
| put(3,c) | {3:c} | 1개: [T1] | |
| put(1,z) | | | |
| put(4,d) | | | |
:::

::: answer
| 연산 | memtable | l0 | l1 |
|---|---|---|---|
| put(1,a) | {1:a} | 0개 | [] |
| put(2,b) | {} (플러시 → l0에 T1=[(1,a),(2,b)] 추가) | 1개: [T1] | [] |
| put(3,c) | {3:c} | 1개: [T1] | [] |
| put(1,z) | {} (플러시 → T2=[(1,z),(3,c)] 추가 → l0 2개, threshold 도달 → **컴팩션**) | 0개 | [(1,z), (2,b), (3,c)] |
| put(4,d) | {4:d} | 0개 | [(1,z), (2,b), (3,c)] |
:::

세 가지를 확인하라.

- [ ] 컴팩션 순간 **T1과 T2가 둘 다 다시 읽힌다.** 두 조각의 원소 수를 합치면 4인데, 컴팩션 결과 l1의 원소 수는 3이다. 어느 값이 사라졌고 왜인가.
- [ ] 키 1의 값이 `a`에서 `z`로 바뀌었다는 사실이 어디서 확정되는가 — put(1,z)를 실행한 순간인가, 컴팩션이 일어난 순간인가. `get(1)`을 put(1,z) 직후(아직 컴팩션 전, l0에 T1과 T2가 모두 있는 상태)에 호출하면 어느 테이블에서 답을 찾는가.
- [ ] put이 다섯 번인데 디스크에 실제로 쓰인 항목 수(T1의 2개 + T2의 2개 + l1의 3개)는 몇 개인가. 쓰기 증폭을 분수로 써 보라.
:::

## 4. 구현

레벨을 둘만 둔 단순화 판이다 — memtable, L0(플러시 직후 쌓이는 조각들), L1(컴팩션으로 합쳐진 조각 하나). 실전 LSM은 L1도 다시 쌓이면 L2로 컴팩션하는 식으로 레벨이 늘어나지만, 증폭이 생기는 원리는 레벨 두 개로도 그대로 드러난다.

::: dual
```python title="LSM Tree — memtable, SSTable 플러시, 컴팩션"
import random


class LSMTree:
    """memtable -> L0 여러 조각 -> 컴팩션으로 L1 하나로 병합. 단순화를 위해 레벨을 둘만 둔다."""

    def __init__(self, memtable_cap, l0_threshold):
        self.memtable_cap = memtable_cap
        self.l0_threshold = l0_threshold
        self.memtable = {}
        self.l0 = []             # append 순서. 뒤로 갈수록 최신
        self.l1 = []             # 컴팩션으로 합쳐진 정렬 테이블 하나
        self.bytes_written = 0   # 디스크에 실제로 쓴 항목 수 (쓰기 증폭의 분자)
        self.bytes_logical = 0   # 사용자가 요청한 쓰기 수 (분모)

    def put(self, key, value):
        self.memtable[key] = value
        self.bytes_logical += 1
        if len(self.memtable) >= self.memtable_cap:
            self.flush()

    def flush(self):
        """memtable을 정렬해 그대로 디스크에 순차로 append한다."""
        table = sorted(self.memtable.items())
        self.memtable = {}
        self.bytes_written += len(table)
        self.l0.append(table)
        if len(self.l0) >= self.l0_threshold:
            self.compact()

    def compact(self):
        """L0의 조각 전부와 기존 L1을 합쳐 새 L1 하나로 다시 쓴다.
        같은 키가 여럿이면 가장 나중에 쓰인 값(더 최신인 테이블)이 이긴다."""
        merged = dict(self.l1)
        for table in self.l0:          # 오래된 테이블부터 겹쳐 써서 최신이 이긴다
            merged.update(table)
        self.l1 = sorted(merged.items())
        self.bytes_written += len(self.l1)   # L1 전체를 다시 쓴다 — 쓰기 증폭의 원천
        self.l0 = []

    def _bsearch(self, table, key):
        lo, hi = 0, len(table) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if table[mid][0] == key:
                return table[mid][1]
            if table[mid][0] < key:
                lo = mid + 1
            else:
                hi = mid - 1
        return None

    def get(self, key):
        """memtable -> L0(최신 우선) -> L1 순으로 본다. 본 테이블 수를 함께 돌려준다."""
        reads = 1
        if key in self.memtable:
            return self.memtable[key], reads
        for table in reversed(self.l0):
            reads += 1
            v = self._bsearch(table, key)
            if v is not None:
                return v, reads
        reads += 1
        return self._bsearch(self.l1, key), reads


def main():
    print("[1] 컴팩션 추적 — memtable=2, L0 threshold=2")
    t = LSMTree(memtable_cap=2, l0_threshold=2)
    for k, v in ((1, "a"), (2, "b"), (3, "c"), (1, "z"), (4, "d")):
        t.put(k, v)
        print("  put(%d,%r)  memtable=%s  l0=%s  l1=%s" % (k, v, t.memtable, t.l0, t.l1))

    print("[2] 증폭 실측 — N=20000, 키 범위 2000 (갱신이 잦다)")
    random.seed(0)
    t2 = LSMTree(memtable_cap=200, l0_threshold=4)
    truth = {}
    n = 20000
    for _ in range(n):
        k = random.randrange(2000)
        v = random.randrange(10 ** 6)
        t2.put(k, v)
        truth[k] = v
    t2.flush()
    if t2.l0:
        t2.compact()

    keys = list(truth.keys())
    random.shuffle(keys)
    sample = keys[:300]
    mismatches = 0
    total_reads = 0
    for k in sample:
        got, reads = t2.get(k)
        total_reads += reads
        if got != truth[k]:
            mismatches += 1

    amp = t2.bytes_written / t2.bytes_logical
    print("  논리 쓰기 %d, 실제 디스크 쓰기 %d, 쓰기 증폭 %.2fx" %
          (t2.bytes_logical, t2.bytes_written, amp))
    print("  조회 %d건, 불일치 %d건, 평균 테이블 접근 %.2f" %
          (len(sample), mismatches, total_reads / len(sample)))


main()
```
```cpp title="LSM Tree — memtable, SSTable 플러시, 컴팩션"
#include <algorithm>
#include <cstdio>
#include <map>
#include <optional>
#include <random>
#include <string>
#include <vector>
using namespace std;

using Entry = pair<long long, long long>;   // (key, value)
using Table = vector<Entry>;

struct LSMTree {
    // memtable -> L0 여러 조각 -> 컴팩션으로 L1 하나로 병합. 단순화를 위해 레벨을 둘만 둔다.
    int memtable_cap, l0_threshold;
    map<long long, long long> memtable;
    vector<Table> l0;            // append 순서. 뒤로 갈수록 최신
    Table l1;                    // 컴팩션으로 합쳐진 정렬 테이블 하나
    long long bytes_written = 0; // 디스크에 실제로 쓴 항목 수 (쓰기 증폭의 분자)
    long long bytes_logical = 0; // 사용자가 요청한 쓰기 수 (분모)

    LSMTree(int cap, int threshold) : memtable_cap(cap), l0_threshold(threshold) {}

    void put(long long key, long long value) {
        memtable[key] = value;
        bytes_logical += 1;
        if ((int)memtable.size() >= memtable_cap) flush();
    }

    void flush() {
        // memtable을 정렬해 그대로 디스크에 순차로 append한다
        Table table(memtable.begin(), memtable.end());
        memtable.clear();
        bytes_written += (long long)table.size();
        l0.push_back(table);
        if ((int)l0.size() >= l0_threshold) compact();
    }

    void compact() {
        // L0의 조각 전부와 기존 L1을 합쳐 새 L1 하나로 다시 쓴다.
        // 같은 키가 여럿이면 가장 나중에 쓰인 값(더 최신인 테이블)이 이긴다.
        map<long long, long long> merged(l1.begin(), l1.end());
        for (auto& table : l0)               // 오래된 테이블부터 겹쳐 써서 최신이 이긴다
            for (auto& kv : table) merged[kv.first] = kv.second;
        l1.assign(merged.begin(), merged.end());
        bytes_written += (long long)l1.size(); // L1 전체를 다시 쓴다 — 쓰기 증폭의 원천
        l0.clear();
    }

    optional<long long> bsearch_table(const Table& table, long long key) {
        int lo = 0, hi = (int)table.size() - 1;
        while (lo <= hi) {
            int mid = (lo + hi) / 2;
            if (table[mid].first == key) return table[mid].second;
            if (table[mid].first < key) lo = mid + 1;
            else hi = mid - 1;
        }
        return nullopt;
    }

    pair<optional<long long>, int> get(long long key) {
        // memtable -> L0(최신 우선) -> L1 순으로 본다. 본 테이블 수를 함께 돌려준다.
        int reads = 1;
        auto it = memtable.find(key);
        if (it != memtable.end()) return {it->second, reads};
        for (auto rit = l0.rbegin(); rit != l0.rend(); ++rit) {
            reads += 1;
            auto v = bsearch_table(*rit, key);
            if (v) return {v, reads};
        }
        reads += 1;
        return {bsearch_table(l1, key), reads};
    }
};

string fmt_table(const Table& t) {
    string s = "[";
    for (size_t i = 0; i < t.size(); i++) {
        if (i) s += ", ";
        s += "(" + to_string(t[i].first) + ", " + to_string(t[i].second) + ")";
    }
    return s + "]";
}

int main() {
    printf("[1] 컴팩션 추적 — memtable=2, L0 threshold=2\n");
    LSMTree t(2, 2);
    long long ks[] = {1, 2, 3, 1, 4};
    long long vs[] = {'a', 'b', 'c', 'z', 'd'};
    for (int i = 0; i < 5; i++) {
        t.put(ks[i], vs[i]);
        printf("  put(%lld,'%c')  memtable_size=%zu  l0=%zu개  l1=%s\n",
               ks[i], (char)vs[i], t.memtable.size(), t.l0.size(), fmt_table(t.l1).c_str());
    }

    printf("[2] 증폭 실측 — N=20000, 키 범위 2000 (갱신이 잦다)\n");
    mt19937 rng(0);
    uniform_int_distribution<int> key_dist(0, 1999);
    uniform_int_distribution<int> val_dist(0, 999999);
    LSMTree t2(200, 4);
    map<long long, long long> truth;
    int n = 20000;
    for (int i = 0; i < n; i++) {
        long long k = key_dist(rng), v = val_dist(rng);
        t2.put(k, v);
        truth[k] = v;
    }
    t2.flush();
    if (!t2.l0.empty()) t2.compact();

    vector<long long> keys;
    for (auto& kv : truth) keys.push_back(kv.first);
    shuffle(keys.begin(), keys.end(), rng);
    int sample_n = min(300, (int)keys.size());
    int mismatches = 0;
    long long total_reads = 0;
    for (int i = 0; i < sample_n; i++) {
        long long k = keys[i];
        auto [got, reads] = t2.get(k);
        total_reads += reads;
        if (!got || *got != truth[k]) mismatches++;
    }

    double amp = (double)t2.bytes_written / t2.bytes_logical;
    printf("  논리 쓰기 %lld, 실제 디스크 쓰기 %lld, 쓰기 증폭 %.2fx\n",
           t2.bytes_logical, t2.bytes_written, amp);
    printf("  조회 %d건, 불일치 %d건, 평균 테이블 접근 %.2f\n",
           sample_n, mismatches, (double)total_reads / sample_n);
    return 0;
}
```
:::

**복잡도:** `put`은 상각 $O(1)$, `get`은 최악 $O(L \log k)$다($L$은 살펴야 하는 조각 수, $k$는 조각당 원소 수). 근거는 코드 직후에 이어진다.

```console title="Python 출력"
[1] 컴팩션 추적 — memtable=2, L0 threshold=2
  put(1,'a')  memtable={1: 'a'}  l0=[]  l1=[]
  put(2,'b')  memtable={}  l0=[[(1, 'a'), (2, 'b')]]  l1=[]
  put(3,'c')  memtable={3: 'c'}  l0=[[(1, 'a'), (2, 'b')]]  l1=[]
  put(1,'z')  memtable={}  l0=[]  l1=[(1, 'z'), (2, 'b'), (3, 'c')]
  put(4,'d')  memtable={4: 'd'}  l0=[]  l1=[(1, 'z'), (2, 'b'), (3, 'c')]
[2] 증폭 실측 — N=20000, 키 범위 2000 (갱신이 잦다)
  논리 쓰기 20000, 실제 디스크 쓰기 63126, 쓰기 증폭 3.16x
  조회 300건, 불일치 0건, 평균 테이블 접근 2.00
```

```console title="C++ 출력"
[1] 컴팩션 추적 — memtable=2, L0 threshold=2
  put(1,'a')  memtable_size=1  l0=0개  l1=[]
  put(2,'b')  memtable_size=0  l0=1개  l1=[]
  put(3,'c')  memtable_size=1  l0=1개  l1=[]
  put(1,'z')  memtable_size=0  l0=0개  l1=[(1, 122), (2, 98), (3, 99)]
  put(4,'d')  memtable_size=1  l0=0개  l1=[(1, 122), (2, 98), (3, 99)]
[2] 증폭 실측 — N=20000, 키 범위 2000 (갱신이 잦다)
  논리 쓰기 20000, 실제 디스크 쓰기 63151, 쓰기 증폭 3.16x
  조회 300건, 불일치 0건, 평균 테이블 접근 2.00
```

두 출력의 핵심 숫자 — 쓰기 증폭 3.16배, 조회 300건 불일치 0건, 평균 테이블 접근 2.00 — 는 같다. 나머지 차이는 아래 표로 선언한다.

근거는 이렇다. 플러시가 $memtable\_cap$번의 쓰기마다 한 번씩 그 $memtable\_cap$개를 정렬해 쓰므로 쓰기 한 번당 상각 $O(\log(memtable\_cap))$이고, 컴팩션까지 상각하면 각 항목이 레벨을 넘어갈 때마다 다시 쓰이므로 총 상각 비용은 **레벨 수에 비례**한다(레벨이 둘이면 최대 2배, 이 챕터의 3.16배가 그 상각 비용의 실측이다). `get`의 $L$은 컴팩션 직후 최소, 컴팩션 직전 최대다. 공간은 $O(n)$이지만 컴팩션 전에는 옛 값이 아직 안 지워져 **일시적으로 $n$보다 크다**(공간 증폭).

| 언어 차이 | Python | C++ |
|---|---|---|
| memtable 자료구조 | `dict` — 삽입 순서 보존, 정렬은 flush 시점에 한 번 | `std::map` — 항상 정렬 상태를 유지하는 레드-블랙 트리([II-9](#/ii-9)) |
| 값 타입 | 문자열을 그대로 저장(`'a'`, `'z'`) | `long long`으로 통일해 저장 — 데모의 문자 값은 아스키 코드로 찍힌다(`'z'` → 122) |
| 무작위 스트림 | `random.randrange` | `mt19937` + `uniform_int_distribution` — 알고리즘이 달라 **같은 시드라도 뽑히는 값이 다르다** |
| 실제 디스크 쓰기 수 | 63,126 | 63,151 — 위와 같은 이유로 근소하게 다르다. 쓰기 증폭 배율(3.16배)은 반올림 후 일치한다 |
| 없는 값 표현 | `None` | `std::optional<long long>` |

::: pitfall
- **컴팩션에서 "최신"을 잘못 정한다.** `l1`을 먼저 채우고 `l0`의 조각을 오래된 것부터 겹쳐 써야 진짜 최신 값이 남는다. 순서를 반대로 하면 옛 값이 새 값을 덮어써 **데이터가 조용히 롤백된다.** 위 코드의 주석 "오래된 테이블부터 겹쳐 써서 최신이 이긴다"가 그 순서 자체다.
- **삭제를 값이 없는 것과 혼동한다.** 이 구현은 삭제를 다루지 않지만, 실전 LSM은 키를 지울 때도 그 자리에 아무것도 안 쓰는 것이 아니라 **삭제됐다는 표시(tombstone)를 새로 쓴다.** 그러지 않으면 옛 SSTable에 남아 있는 값이 다시 조회에 걸려 "지운 값이 되살아나는" 결함이 난다.
- **컴팩션을 안 하면 읽기가 계속 느려진다는 것을 잊는다.** L0를 무한정 쌓아 두면 공간은 아끼는 것처럼 보이지만 `get`의 최악 시간이 조각 수만큼 늘어난다. 컴팩션을 미루는 것은 쓰기 비용을 읽기 비용으로 미루는 것이지 없애는 것이 아니다.
- **쓰기 증폭을 압축률과 혼동한다.** 3.16배는 같은 바이트를 몇 번 다시 썼는지이지, 파일이 압축돼서 작아졌는지와 무관하다. 두 수치는 독립적으로 개선된다.
:::

## 5. 어디에 쓰이는가

**RocksDB와 LevelDB가 이 챕터의 구조 그대로다.** 이름부터 "Log-Structured Merge"에서 왔고, memtable(스킵 리스트로 구현, [XV-5](#/xv-5)) → SSTable → 레벨별 컴팩션이라는 골격이 동일하다. RocksDB는 페이스북(현 Meta)이 만들어 여러 데이터베이스의 저장 엔진으로 쓰인다.

**Cassandra와 대부분의 시계열 데이터베이스가 LSM을 쓴다.** 쓰기가 압도적으로 많고 최근 데이터 위주로 조회하는 워크로드(온도 센서 로그, 메트릭, 이벤트)에서 LSM의 "쓰기는 싸고 읽기는 조각 수만큼"이라는 교환이 정확히 들어맞는다 — 최근 데이터는 아직 컴팩션이 안 된 L0에 있어 오히려 빨리 찾힌다.

**[XV-2](#/xv-2) B-Tree와의 대비가 이 두 챕터의 요점이다.** 관계형 데이터베이스가 B+Tree를 쓰는 것은 읽기·갱신이 섞인 워크로드에서 예측 가능한 읽기가 더 중요하기 때문이고, 시계열·로그·이벤트 스토어가 LSM을 쓰는 것은 쓰기가 압도적으로 많고 최근 데이터 위주 조회라 순차 쓰기의 이득이 더 크기 때문이다. **어느 쪽이 일반적으로 낫다는 결론은 없다** — 워크로드의 읽기 대 쓰기 비율이 결정한다.

## 연습

::: quiz
설계 질문 3단 형식이다. **상황 → 무엇이 병목인가 → 어떤 구조이고 대가는 무엇인가.**

**1. 컴팩션 정책 선택.** L0 조각이 쌓일 때마다 이 챕터처럼 **전부** 합쳐 하나의 큰 L1으로 다시 쓸지, 크기가 비슷한 조각끼리만 합칠지 정해야 한다.
- 상황: 컴팩션 방식에 따라 쓰기 증폭과 조각 수(읽기 증폭)의 비율이 달라진다.
- 무엇이 병목인가: 전부 합치는 판(이 챕터의 단순화 판)은 L1이 커질수록 컴팩션 한 번의 비용이 커진다 — 작은 조각 하나를 합치려고 거대한 L1 전체를 다시 쓴다.
- 어떤 구조와 대가: 크기가 비슷한 것끼리 합치는 **크기 계층(size-tiered)** 컴팩션은 쓰기 증폭이 낮지만 조각 수가 늘어 읽기 증폭이 커진다. 레벨마다 크기 상한을 정해 그 안에서만 합치는 **레벨(leveled)** 컴팩션은 읽기 증폭이 낮지만 쓰기 증폭이 늘어난다. RocksDB는 기본이 레벨 컴팩션이다.

**2. 최근 데이터 위주 조회.** 최근 한 시간 데이터를 조회하는 요청이 대부분이고, 오래된 데이터는 거의 안 본다.
- 상황: 데이터의 "온도"가 시간에 따라 급격히 식는다.
- 무엇이 병목인가: 컴팩션이 안 된 L0가 오히려 최근 데이터를 빨리 찾는 자리라, 컴팩션을 너무 자주 하면 최근 데이터까지 깊은 레벨로 밀어 넣어 손해다.
- 어떤 구조와 대가: 레벨을 시간 구간에 맞춰 나누고(시계열 DB가 흔히 쓰는 방식) 오래된 레벨일수록 압축률을 높여 공간 증폭을 줄인다. 대가는 레벨 경계에 걸친 범위 조회가 여러 레벨을 다 봐야 한다는 것이다.

**3. 삭제가 잦은 워크로드.** 사용자가 키를 지우는 요청이 쓰기의 상당 비율을 차지한다.
- 상황: tombstone이 계속 쌓인다.
- 무엇이 병목인가: tombstone도 SSTable에 쓰이는 데이터라 쓰기 증폭에 그대로 더해지고, 컴팩션이 늦으면 이미 지운 값이 디스크 공간을 계속 차지한다(공간 증폭).
- 어떤 구조와 대가: 컴팩션 주기를 앞당기거나 tombstone 전용 압축을 강하게 건다. 대가는 컴팩션 빈도가 늘어난 만큼 쓰기 경로의 백그라운드 부하가 커지고, 그 부하가 순간적으로 쓰기 지연(latency spike)을 만들 수 있다는 것이다.
:::

## 요약

- B-Tree는 삽입마다 무작위 위치를 제자리에서 고쳐 쓴다. LSM은 쓰기를 memtable에 모았다가 다 차면 통째로 순차 append한다 — [XV-1](#/xv-1)의 순차·무작위 배수가 여기서 설계 선택으로 나타난다.
- SSTable은 한 번 쓰이면 다시 고치지 않는 불변 정렬 파일이다. 같은 키의 새 값은 새 SSTable에 쌓이고, 옛 값은 컴팩션 때 정리된다.
- 컴팩션은 여러 SSTable을 병합해 겹치는 키를 정리하는 과정이다. 오래된 것부터 겹쳐 써야 최신 값이 남는다.
- 조회는 memtable → 최신 SSTable → 오래된 SSTable 순으로 값을 찾을 때까지 본다. 조각 수가 읽기 증폭이다.
- 실측: memtable 200, L0 threshold 4, 2만 건 쓰기(키 2천개 범위, 갱신 잦음)에서 **쓰기 증폭 3.16배**, 무작위 300건 조회에서 **평균 테이블 접근 2.00회**, 정답과 불일치 0건.
- B-Tree와 LSM은 "어느 쪽이 낫다"가 아니라 교환이다. B-Tree는 읽기가 예측 가능하고 쓰기가 무작위다. LSM은 쓰기가 순차이고 싸지만 읽기가 조각 수만큼 늘어난다.
- 블룸 필터는 이 읽기 증폭을 줄이는 다음 챕터의 장치이지, 컴팩션을 대신하지 않는다.

**다음 절**: [XV-4 블룸 필터와 쿠쿠 필터](#/xv-4) — "이 SSTable에 이 키가 없다"를 미리 걸러 이 챕터가 남긴 읽기 증폭을 줄인다.
