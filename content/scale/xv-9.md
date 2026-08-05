# XV-9 캐시 교체 정책

::: lead
캐시는 언젠가 가득 찬다. 그 순간 "무엇을 내보낼 것인가"가 캐시 설계의 전부다.
:::

## 1. 문제

캐시는 항상 원본보다 작다. 그래서 캐시가 다 차면 새 항목을 넣기 위해 기존 항목 하나를 반드시 버려야 한다. **무엇을 버릴지 정하는 규칙이 캐시 정책이다.** 이 규칙 하나가 히트율을 몇 배씩 갈라놓는다 — 캐시의 크기나 저장 매체보다 이 규칙이 성능을 더 많이 좌우하는 경우가 흔하다.

가장 직관적인 규칙은 "제일 오래 안 쓴 것을 버린다"(LRU)다. 최근에 쓴 것일수록 곧 다시 쓰일 가능성이 높다는 **시간적 지역성**을 가정한다. 이 가정은 대개 맞는다 — 다만 늘 맞지는 않는다.

가정이 깨지는 대표적인 상황이 **캐시보다 큰 순환 스캔**이다. 데이터베이스가 배치 작업으로 테이블 전체를 훑는다고 하자. 테이블 크기가 캐시보다 크면, 스캔이 캐시를 한 바퀴 도는 동안 **정말로 자주 쓰이는 소수의 "핫" 레코드**까지 전부 밀려난다. 스캔은 각 레코드를 딱 한 번만 쓰고 지나가는데, 그 한 번의 방문이 최근 사용 기록에서는 "방금 쓴 것"으로 잡혀 핫 레코드보다 우선권을 갖는다. **LRU에게는 "방금 한 번 쓰고 다시 안 쓸 것"과 "방금 썼고 곧 또 쓸 것"이 구분되지 않는다.** 이 챕터는 그 구분을 넣는 정책들의 이야기다.

## 2. 아이디어

### 2.1 LRU — 최근성만 본다

캐시를 순서가 있는 목록으로 두고, 쓸 때마다 그 항목을 맨 뒤(최신)로 옮긴다. 가득 차면 맨 앞(가장 오래 안 쓴 것)을 버린다. [II-3 연결 리스트](#/ii-3) + [II-6 해시](#/ii-6)로 $O(1)$에 구현된다 — 해시로 항목의 위치를 즉시 찾고, 연결 리스트로 순서를 $O(1)$에 옮긴다.

### 2.2 LFU — 빈도를 본다

"최근에 썼는가" 대신 "**얼마나 자주** 썼는가"를 센다. 가득 차면 누적 사용 횟수가 가장 적은 항목을 버린다. 스캔으로 한 번 스쳐 간 레코드는 빈도 1에 머물지만, 핫 레코드는 계속 불려 빈도가 쌓인다. **빈도가 한 번 핫 레코드 쪽으로 벌어지고 나면, 그 뒤로 스캔이 아무리 지나가도 핫 레코드는 항상 최저 빈도보다 위에 있어 밀려나지 않는다.** 이게 §1의 문제를 정확히 겨냥한다.

대가도 있다. **과거의 인기가 계속 힘을 낸다.** 어제까지 핫했던 레코드가 오늘은 안 쓰이는데도 누적 빈도가 높다는 이유만으로 캐시를 계속 차지할 수 있다. LRU가 "너무 최근만 본다"면 LFU는 "너무 과거를 오래 본다" — 그래서 실무 구현은 빈도를 시간이 지나면 깎는 **에이징**을 덧붙인다.

### 2.3 ARC — 최근성과 빈도를 함께, 그리고 스스로 배분을 조절한다

LRU와 LFU 중 하나를 고정으로 선택하는 대신, 두 개의 LRU 목록을 나란히 두는 방법도 있다. 하나는 **딱 한 번만 쓰인 항목**(최근성 목록), 다른 하나는 **두 번 이상 쓰인 항목**(빈도 목록)이다. **ARC**(Adaptive Replacement Cache)는 이 두 목록의 크기 배분을 접근 패턴에 맞춰 스스로 늘리고 줄인다 — 순환 스캔이 심해지면 빈도 목록 쪽에 자리를 더 내주고, 반대 패턴이면 되돌린다. LRU·LFU가 "이번 워크로드에 어느 쪽이 맞는가"를 사람이 미리 정해야 하는 데 비해, ARC는 그 판단 자체를 실행 중에 관찰해서 조정한다는 것이 핵심이다.

### 2.4 W-TinyLFU — 빈도를 작은 공간에, 그리고 입구에서 거른다

LFU의 문제 하나는 **모든 키의 빈도를 계속 들고 있어야 한다**는 것이다 — 캐시에 없는 키라도 "얼마나 자주 요청됐는지"를 알아야 새로 들어올 자격이 있는지 판단할 수 있다. **W-TinyLFU**는 이 빈도 추정을 [XV-6 카디널리티·빈도 추정](#/xv-6)의 **Count-Min Sketch**로 압축한다 — 정확한 빈도가 아니라 근사치를 아주 작은 공간에 담는다. 그리고 새 항목이 들어오려 할 때 "지금 캐시에서 내보낼 후보보다 이 새 항목의 (추정) 빈도가 높은가"를 **입구에서** 검사한다(TinyLFU 필터). 스캔으로 밀려드는, 다시 안 쓰일 항목은 이 문턱을 못 넘어 아예 캐시에 들어가지도 못한다. Caffeine·최신 RocksDB 블록 캐시가 이 계열을 쓴다.

## 3. 손으로 따라가기

::: trace
캐시 용량 3. 핫 키 `h`와 스캔 키 `s1, s2, s3`가 순서대로 들어온다. LRU 정책이다.

캐시 상태는 **오래된 순 → 최신순**으로 적는다.

| 단계 | 접근 키 | 결과 | 캐시 상태 (오래된순→최신순) | 쫓겨난 키 |
|---|---|---|---|---|
| 1 | h | 미스 | [h] | — |
| 2 | s1 | 미스 | [h, s1] | — |
| 3 | s2 | | | |
| 4 | s3 | | | |
| 5 | h | | | |

세 가지를 확인하라.

- [ ] 4단계에서 캐시가 가득 찬 뒤 `s3`가 들어오면 누가 쫓겨나는가
- [ ] 5단계에서 `h`를 다시 찾을 때 히트인가 미스인가. 캐시 용량 3에 스캔 키가 딱 2개(`s1`, `s2`)뿐이었다면 결과가 달라지는가
- [ ] 이 표에서 "핫 키가 밀려나는 것"이 몇 단계에서 확정되는가
:::

::: answer
| 단계 | 접근 키 | 결과 | 캐시 상태 (오래된순→최신순) | 쫓겨난 키 |
|---|---|---|---|---|
| 1 | h | 미스 | [h] | — |
| 2 | s1 | 미스 | [h, s1] | — |
| 3 | s2 | 미스 | [h, s1, s2] | — (용량 3, 아직 안 참) |
| 4 | s3 | 미스 | [s1, s2, s3] | **h** |
| 5 | h | 미스 | [s2, s3, h] | s1 |

4단계에서 `h`가 쫓겨난다. `h`는 1단계에서 넣은 뒤 한 번도 다시 안 쓰였으므로 순서상 **가장 오래 안 쓴 것**이고, 캐시가 꽉 찬 채로 새 키가 들어오면 그 자리를 내준다.

5단계의 `h`는 **미스**다. 캐시 용량이 스캔 길이(2, `s1`·`s2`)보다 컸다면 `h`는 4단계에서 안 쫓겨나 5단계에 히트했을 것이다. **핫 키가 살아남는지는 "캐시 용량이 그 사이 끼어드는 스캔 길이보다 큰가"에 달려 있다.** 스캔이 캐시보다 커지는 순간부터 LRU에게는 방어할 방법이 없다.

밀려나는 것은 4단계에서 이미 확정된다 — 5단계는 그 결과를 확인할 뿐이다.
:::

## 4. 구현

LRU는 연결 리스트(순서) + 해시(위치 찾기)로, LFU는 "빈도 → 그 빈도를 가진 키들의 목록" 버킷들과 최저 빈도 포인터로 짠다. 두 캐시 모두 삽입·조회·축출이 $O(1)$이다.

::: dual
```python title="LRU·LFU — 순환 스캔에 섞인 핫 키의 생존율"
from collections import OrderedDict, defaultdict


class LRUCache:
    def __init__(self, cap):
        self.cap = cap
        self.data = OrderedDict()
        self.hits = 0
        self.misses = 0

    def access(self, key):
        if key in self.data:
            self.hits += 1
            self.data.move_to_end(key)          # 방금 썼으니 맨 뒤(최신)로
        else:
            self.misses += 1
            if len(self.data) >= self.cap:
                self.data.popitem(last=False)    # 맨 앞(가장 오래 안 쓴 것)을 내보낸다
            self.data[key] = True


class LFUCache:
    def __init__(self, cap):
        self.cap = cap
        self.freq = {}
        self.buckets = defaultdict(OrderedDict)  # freq -> {key: True}, 삽입 순서 유지
        self.min_freq = 0
        self.hits = 0
        self.misses = 0

    def access(self, key):
        if key in self.freq:
            self.hits += 1
            f = self.freq[key]
            del self.buckets[f][key]
            if not self.buckets[f] and self.min_freq == f:
                self.min_freq += 1
            self.freq[key] = f + 1
            self.buckets[f + 1][key] = True
        else:
            self.misses += 1
            if len(self.freq) >= self.cap:
                evict, _ = self.buckets[self.min_freq].popitem(last=False)  # 최저 빈도 중 가장 오래된 것
                del self.freq[evict]
            self.freq[key] = 1
            self.buckets[1][key] = True
            self.min_freq = 1


def build_trace(hot, cycles, scan_len):
    """핫 키 5개를 두 번 연달아 찍어 빈도 2를 만든 뒤(부트스트랩), 사이클마다
    핫 키를 한 번씩만 찍고 한 번도 안 겹치는 스캔 키 다발을 흘려보낸다."""
    trace = []
    for h in hot:
        trace += [h, h]
    ctr = 0
    for _ in range(cycles):
        for h in hot:
            trace.append(h)
        for _ in range(scan_len):
            trace.append("scan%d" % ctr)
            ctr += 1
    return trace


def run(cache_cls, cap, trace, hot_set):
    c = cache_cls(cap)
    hot_hits = 0
    hot_total = 0
    for key in trace:
        is_hot = key in hot_set
        was_hit = key in (c.data if isinstance(c, LRUCache) else c.freq)
        c.access(key)
        if is_hot:
            hot_total += 1
            if was_hit:
                hot_hits += 1
    total = c.hits + c.misses
    return c.hits, total, hot_hits, hot_total


CAP = 20
HOT = ["h0", "h1", "h2", "h3", "h4"]
CYCLES = 20
SCAN_LEN = 40
trace = build_trace(HOT, CYCLES, SCAN_LEN)
hot_set = set(HOT)

print("총 접근 %d회  (핫 키 %d개, 사이클 %d회, 사이클당 스캔 %d개)" % (len(trace), len(HOT), CYCLES, SCAN_LEN))
for name, cls in (("LRU", LRUCache), ("LFU", LFUCache)):
    hits, total, hot_hits, hot_total = run(cls, CAP, trace, hot_set)
    print("%s  전체 히트율 %5.1f%% (%d/%d)   핫 키만 히트율 %5.1f%% (%d/%d)"
          % (name, 100 * hits / total, hits, total,
             100 * hot_hits / hot_total, hot_hits, hot_total))
```
```cpp title="LRU·LFU — 순환 스캔에 섞인 핫 키의 생존율"
#include <cstdio>
#include <list>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>
using namespace std;

struct LRUCache {
    int cap;
    list<string> data;                                    // 앞 = 가장 오래 안 씀, 뒤 = 최신
    unordered_map<string, list<string>::iterator> pos;
    int hits = 0, misses = 0;

    LRUCache(int cap_) : cap(cap_) {}

    bool contains(const string& key) { return pos.count(key) > 0; }

    void access(const string& key) {
        auto it = pos.find(key);
        if (it != pos.end()) {
            hits += 1;
            data.splice(data.end(), data, it->second);     // 방금 썼으니 맨 뒤(최신)로
        } else {
            misses += 1;
            if ((int)data.size() >= cap) {
                pos.erase(data.front());
                data.pop_front();                            // 맨 앞(가장 오래 안 쓴 것)을 내보낸다
            }
            data.push_back(key);
            pos[key] = prev(data.end());
        }
    }
};

struct LFUCache {
    int cap;
    unordered_map<string, int> freq;
    unordered_map<int, list<string>> buckets;               // freq -> [key...], 삽입 순서 유지
    unordered_map<string, list<string>::iterator> pos;
    int min_freq = 0;
    int hits = 0, misses = 0;

    LFUCache(int cap_) : cap(cap_) {}

    bool contains(const string& key) { return freq.count(key) > 0; }

    void access(const string& key) {
        auto it = freq.find(key);
        if (it != freq.end()) {
            hits += 1;
            int f = it->second;
            buckets[f].erase(pos[key]);
            if (buckets[f].empty() && min_freq == f) min_freq += 1;
            freq[key] = f + 1;
            buckets[f + 1].push_back(key);
            pos[key] = prev(buckets[f + 1].end());
        } else {
            misses += 1;
            if ((int)freq.size() >= cap) {
                string evict = buckets[min_freq].front();     // 최저 빈도 중 가장 오래된 것
                buckets[min_freq].pop_front();
                freq.erase(evict);
                pos.erase(evict);
            }
            freq[key] = 1;
            buckets[1].push_back(key);
            pos[key] = prev(buckets[1].end());
            min_freq = 1;
        }
    }
};

// 핫 키 5개를 두 번 연달아 찍어 빈도 2를 만든 뒤(부트스트랩), 사이클마다
// 핫 키를 한 번씩만 찍고 한 번도 안 겹치는 스캔 키 다발을 흘려보낸다.
vector<string> build_trace(const vector<string>& hot, int cycles, int scan_len) {
    vector<string> trace;
    for (auto& h : hot) { trace.push_back(h); trace.push_back(h); }
    int ctr = 0;
    for (int c = 0; c < cycles; c++) {
        for (auto& h : hot) trace.push_back(h);
        for (int i = 0; i < scan_len; i++) trace.push_back("scan" + to_string(ctr++));
    }
    return trace;
}

template <typename Cache>
void run(Cache& c, const vector<string>& trace, const set<string>& hot_set,
         int& hits, int& total, int& hot_hits, int& hot_total) {
    hot_hits = 0;
    hot_total = 0;
    for (auto& key : trace) {
        bool is_hot = hot_set.count(key) > 0;
        bool was_hit = c.contains(key);
        c.access(key);
        if (is_hot) {
            hot_total += 1;
            if (was_hit) hot_hits += 1;
        }
    }
    hits = c.hits;
    total = c.hits + c.misses;
}

int main() {
    int CAP = 20;
    vector<string> HOT = {"h0", "h1", "h2", "h3", "h4"};
    int CYCLES = 20, SCAN_LEN = 40;
    vector<string> trace = build_trace(HOT, CYCLES, SCAN_LEN);
    set<string> hot_set(HOT.begin(), HOT.end());

    printf("총 접근 %d회  (핫 키 %d개, 사이클 %d회, 사이클당 스캔 %d개)\n",
           (int)trace.size(), (int)HOT.size(), CYCLES, SCAN_LEN);

    {
        LRUCache c(CAP);
        int hits, total, hot_hits, hot_total;
        run(c, trace, hot_set, hits, total, hot_hits, hot_total);
        printf("LRU  전체 히트율 %5.1f%% (%d/%d)   핫 키만 히트율 %5.1f%% (%d/%d)\n",
               100.0 * hits / total, hits, total,
               100.0 * hot_hits / hot_total, hot_hits, hot_total);
    }
    {
        LFUCache c(CAP);
        int hits, total, hot_hits, hot_total;
        run(c, trace, hot_set, hits, total, hot_hits, hot_total);
        printf("LFU  전체 히트율 %5.1f%% (%d/%d)   핫 키만 히트율 %5.1f%% (%d/%d)\n",
               100.0 * hits / total, hits, total,
               100.0 * hot_hits / hot_total, hot_hits, hot_total);
    }
    return 0;
}
```
:::

두 언어의 출력은 같다.

```console
총 접근 910회  (핫 키 5개, 사이클 20회, 사이클당 스캔 40개)
LRU  전체 히트율   1.1% (10/910)   핫 키만 히트율   9.1% (10/110)
LFU  전체 히트율  11.5% (105/910)   핫 키만 히트율  95.5% (105/110)
```

전체 히트율은 둘 다 낮다 — 트래픽의 대부분(사이클당 40/45)이 원래부터 한 번도 안 겹치는 스캔이라 **어떤 정책도 그 부분은 못 맞힌다.** 볼 곳은 **핫 키만 뗀 히트율**이다. LRU는 캐시 용량(20)보다 스캔 한 번(40)이 커서 핫 키가 매 사이클 밀려나 **9.1%**에 머문다 — §3의 손추적과 같은 실패다. LFU는 부트스트랩으로 빈도 2를 확보한 뒤로는 스캔이 아무리 지나가도 밀리지 않아 **95.5%**다.

**복잡도:** LRU는 조회·삽입·축출 모두 $O(1)$ — 해시로 노드 위치를 즉시 찾고 연결 리스트 스플라이스로 순서를 옮긴다. LFU도 $O(1)$ — 버킷 이동과 최저 빈도 갱신이 각각 상수 시간이다. 공간은 둘 다 $O(\text{cap})$이지만 LFU가 빈도 정수 하나를 더 든다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 순서 있는 딕셔너리 | `OrderedDict` + `move_to_end`/`popitem(last=False)` | `list` + `unordered_map<string, iterator>`. `splice`로 노드를 옮겨도 반복자가 무효화되지 않는다는 것이 핵심 — `vector`였다면 재할당 때마다 전부 무효화됐다 |
| 버킷 삭제 시점 | `defaultdict`가 빈 버킷을 자동으로 만들어 두므로 `del buckets[f][key]` 뒤 빈 여부만 검사 | `unordered_map<int, list<...>>::operator[]`도 없는 키를 기본 생성하므로 동일하게 동작한다 |
| 캐시 종류 판별 | `isinstance(c, LRUCache)`로 런타임에 분기 | 템플릿 `run<Cache>`이 컴파일 타임에 갈라져 분기가 아예 없다 — `contains` 멤버 함수로 통일했다 |

::: pitfall
- **LRU를 "그냥 최근 걸 남긴다"로만 이해한다.** 정확히는 **매 접근마다 순서를 갱신**해야 한다 — 조회(읽기)만 해도 그 항목은 "방금 쓴 것"이 된다. 쓰기만 순서에 반영하고 읽기는 반영을 빠뜨리면 자주 읽히기만 하는 항목이 조용히 밀려난다.
- **LFU에서 빈도를 절대 안 깎는다.** 이 구현은 교육용으로 단순화했다 — 실무 LFU는 시간이 지나면 빈도를 감쇠시키는 에이징이 없으면 §2.2의 "과거의 인기가 계속 힘을 낸다" 문제를 그대로 겪는다.
- **정책을 캐시 크기로 메꾸려 한다.** LRU가 순환 스캔에 약한 것은 캐시를 키운다고 근본적으로 없어지지 않는다 — 스캔이 캐시보다 크기만 하면 같은 실패가 재현된다(§3 손추적의 마지막 질문). 크기를 늘리는 것과 정책을 바꾸는 것은 다른 처방이다.
:::

::: widget cache-policy {"policies":["lru","lfu"],"capacity":20,"trace":"hot5-scan40x20","metric":"hot-only"}
:::

위젯은 아직 구현 전이라 이 챕터에서는 자리표시자로만 걸어 둔다. 의도한 형태는 §4의 코드가 만든 접근 순서(`trace`)를 위 스텝 재생기로 한 칸씩 넘기며, 정책별 캐시 내용물과 그 순간까지의 히트율을 나란히 보여주는 것이다. `policies`는 동시에 비교할 정책 목록, `capacity`는 캐시 용량, `trace`는 미리 정의된 접근 패턴의 이름(예: 이 챕터의 "핫5+스캔40×20사이클"), `metric`은 화면에 띄울 히트율이 전체 기준인지 핫 키만 기준인지를 고른다.

## 5. 어디에 쓰이는가

**CPU 캐시**가 이 챕터의 원형이다. L1·L2·L3 캐시는 하드웨어로 구현된 LRU 근사 정책(실제로는 완전한 LRU가 너무 비싸 **유사 LRU**를 쓴다)으로 캐시 라인을 축출한다. 순환 스캔이 CPU 캐시를 오염시키는 문제는 [XV-1](#/xv-1)의 계층 구조 표에서 본 지연 배수(L1 대 메인 메모리 100배) 그대로를 반복해서 물게 만든다.

**CDN 엣지 캐시**는 콘텐츠별로 접근 빈도가 극단적으로 갈린다 — 소수의 인기 콘텐츠가 트래픽 대부분을 차지하고 나머지는 한 번 보고 끝인 롱테일이다. §4의 "핫 키 대 스캔"이 그대로 재현되는 자리이고, 그래서 CDN·프록시 캐시 다수가 순수 LRU 대신 빈도 기반 또는 ARC류를 쓴다.

**애플리케이션 캐시**(Caffeine, Guava Cache)는 W-TinyLFU를 기본값으로 채택했다 — 범용 워크로드에서 LRU 대비 히트율 개선이 실측으로 보고되어 있고, Count-Min Sketch 덕에 메모리 오버헤드도 작다. 특정 워크로드 하나에 맞춰 손으로 튜닝하는 대신, 접근 패턴을 실행 중에 관찰해 정책 자체가 따라가게 만든 것이 이 계열 공통의 방향이다.

**정책 선택은 [XI-1 링 버퍼](#/xi-1)의 결론과 같은 모양이다.** 거기서 오버런 정책(덮어쓰기/버리기/막기)에 "옳은 것은 없고 무엇을 죽일지 고르는 것"이라고 했다. 캐시 정책도 같다 — LRU는 "오래된 것"을, LFU는 "인기 없던 것"을 죽인다. **어느 쪽이 항상 옳은 것이 아니라 워크로드의 접근 패턴이 답을 정한다.**

## 연습

::: quiz
**1. 상품 상세 페이지 캐시와 크롤러 트래픽**
- 상황: 이커머스 사이트가 상품 상세 페이지를 캐시한다. 인기 상품 수백 개가 트래픽 대부분을 차지하는데, 검색 엔진 크롤러가 주기적으로 전체 상품(수백만 개)을 순회하며 각 페이지를 한 번씩 요청한다.
- 무엇이 병목이거나 깨지는가: 크롤러의 순회가 캐시 용량보다 훨씬 크다. 순수 LRU라면 크롤러가 지나갈 때마다 인기 상품의 캐시 항목이 전부 밀려나고, 실제 사용자 트래픽이 캐시 미스로 데이터베이스를 두드린다.
- 어떤 구조이고 무엇을 대가로 치르는가: LFU 계열로 바꾸면 인기 상품이 누적 빈도로 보호된다. 대가는 신상품이다 — 방금 나온 인기 상품은 아직 빈도를 못 쌓아 크롤러의 최근 방문(빈도 1)과 구분이 안 되고, 인기가 붙기 전까지 캐시에서 밀릴 수 있다. W-TinyLFU의 입구 필터가 이 문제를 완전히 없애지는 못하고 완화할 뿐이다.

**2. 시계열 대시보드의 최근 N분 조회**
- 상황: 모니터링 대시보드가 "최근 5분"·"최근 1시간" 같은 시간 창 데이터를 캐시한다. 사용자는 대부분 방금 갱신된 최신 구간을 본다.
- 무엇이 병목이거나 깨지는가: 오래된 시간 구간의 조회 빈도는 낮지만 0은 아니다(가끔 지난 장애를 되짚어 본다). 순수 LFU라면 예전에 누적된 빈도가 높은 구간이 지금은 거의 안 보는데도 자리를 계속 차지할 수 있다.
- 어떤 구조이고 무엇을 대가로 치르는가: 이 워크로드는 최신 데이터가 곧 인기 데이터인 경우가 대부분이라 LRU가 오히려 자연스럽다 — 시간적 지역성 가정이 실제로 맞는 사례다. 대가는 순환 스캔형 배치 작업(예: 야간 리포트 생성이 전체 기간을 훑는 경우)이 섞이면 §1의 문제가 그대로 재현된다는 것이다.

**3. 인증 토큰 검증 캐시**
- 상황: API 게이트웨이가 요청마다 토큰을 검증한다. 검증 자체는 비싸서(서명 확인 + DB 조회) 결과를 짧게 캐시한다. 정상 트래픽 외에 봇이 무작위로 생성한 유효하지 않은 토큰이 섞여 들어온다.
- 무엇이 병목이거나 깨지는가: 무효 토큰은 전부 서로 다른 값이라 캐시에 넣어 봐야 다시 조회될 일이 없다 — §1의 스캔과 같은 성질이다. 이 무효 토큰들이 캐시에 들어가는 것 자체가 유효한 사용자의 토큰을 밀어낸다.
- 어떤 구조이고 무엇을 대가로 치르는가: W-TinyLFU류의 **입구 필터**가 정확히 이 상황을 겨냥한다 — 한 번도 못 본 값은 기존 항목보다 추정 빈도가 낮으므로 애초에 캐시에 들어가지 못한다. 대가는 필터 자체가 근사치라는 것이다. Count-Min Sketch의 거짓양성([XV-4](#/xv-4)와 같은 종류의 오차)으로 정말 새로운 정상 토큰이 부당하게 문턱을 못 넘는 경우가 드물게 생긴다.
:::

## 요약

- 캐시가 가득 차면 무엇을 버릴지 정하는 것이 정책이다. **옳은 정책은 없고, 접근 패턴에 맞는 정책이 있을 뿐이다.**
- **LRU**는 최근성만 본다. 구현이 단순하고 $O(1)$이지만, 캐시보다 큰 순환 스캔이 섞이면 핫 데이터까지 함께 밀려난다.
- **LFU**는 누적 빈도를 본다. 한 번 쌓인 빈도 우위는 스캔이 아무리 지나가도 깨지지 않는다. 대가는 과거의 인기가 계속 힘을 낸다는 것 — 에이징이 없으면 안 쓰이는 항목도 안 밀린다.
- **ARC**는 최근성 목록과 빈도 목록의 배분을 실행 중에 스스로 조절한다. **W-TinyLFU**는 빈도를 Count-Min Sketch로 작게 압축하고 입구에서 필터링한다.
- 실측: 캐시 20, 핫 키 5개, 사이클당 스캔 40개인 패턴에서 핫 키만 뗀 히트율이 LRU **9.1%**, LFU **95.5%**였다.
- CPU 캐시의 유사 LRU, CDN의 빈도 기반 정책, Caffeine·최신 RocksDB의 W-TinyLFU가 전부 이 장의 트레이드오프를 실제로 겪고 고른 결과다.
- [XI-1 링 버퍼](#/xi-1)의 오버런 정책과 같은 계보다 — **정책은 무엇을 잃을지 고르는 문제이지, 잃지 않는 방법을 찾는 문제가 아니다.**

**다음 절**: [XV-10 레이트 리미팅](#/xv-10) — 요청이 너무 많이 들어올 때 무엇을 막을지 정하는 문제로 넘어간다. 토큰 버킷, 리키 버킷, 슬라이딩 윈도우가 답이다.
