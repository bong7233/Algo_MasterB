# XI-1 링 버퍼(원형 큐)

::: lead
칸 수가 정해진 버퍼로 끝없이 흐르는 데이터를 받으려면, 넘칠 때 무엇을 버릴지를 먼저 정해야 한다.
:::

## 1. 문제

오디오 출력 장치는 초당 48,000개의 샘플을 요구한다. 드라이버는 256 샘플짜리 블록을 5.3 ms마다 하나씩 가져가고, 그 사이에 애플리케이션은 다음 블록을 만들어 놓아야 한다. 늦으면 장치는 빈 블록을 재생한다. 그것이 스피커에서 "틱" 소리로 나온다.

이 자리에 커지는 리스트를 놓으면 두 가지가 동시에 무너진다.

첫째, **큐가 무한히 자란다.** 만드는 쪽이 조금이라도 빠르면 메모리를 다 쓸 때까지 자란다. 지연도 같이 자란다 — 큐에 3초치가 쌓여 있으면 지금 넣은 소리가 3초 뒤에 난다. 데이터를 하나도 안 버렸는데 결과는 이미 쓸모가 없다.

둘째, **실시간 경로에서 메모리 할당은 금지다.** `append`는 언젠가 재할당을 하고([0-3](#/0-3)), 그 재할당이 몇 마이크로초 걸릴지는 아무도 보장하지 않는다. 5.3 ms 예산 안에서 보장 없는 연산은 쓸 수 없다.

그래서 답은 처음부터 좁혀져 있다. **고정 크기 배열 하나를 미리 잡고 그 안에서만 돈다.**

[II-5 큐와 덱](#/ii-5)에서 이 구조의 골격은 이미 봤다. 앞에서 꺼낼 때 원소를 밀지 않고 `head`만 옮기면 $O(1)$이고, 배열 끝에 닿으면 `% cap`으로 0에 되돌아온다. 논리적으로 원이고 물리적으로 배열이다. 거기까지가 "큐를 싸게 만드는 법"이었다.

크기가 고정되는 순간 II-5가 미뤄 둔 두 질문이 남는다.

- **가득 찬 것과 빈 것을 어떻게 구분하는가.** `head == tail`은 양쪽 모두에서 참이다.
- **가득 찼는데 또 들어오면 무엇을 버리는가.** 무한히 자라는 큐에는 아예 없던 질문이다.

이 절은 그 둘이 전부다.

## 2. 아이디어

### 2.1 인덱스 둘이 서로 다른 속도로 기어간다

쓰는 위치와 읽는 위치를 따로 든다. 쓰면 `head`가 하나 늘고, 읽으면 `tail`이 하나 는다. 둘 다 배열 끝에서 0으로 접힌다.

```text nolines
   cap = 8

     0     1     2     3     4     5     6     7
   +-----+-----+-----+-----+-----+-----+-----+-----+
   |  -  |  -  |  C  |  D  |  E  |  -  |  -  |  -  |
   +-----+-----+-----+-----+-----+-----+-----+-----+
               ^                 ^
               tail              head        <- 읽을 자리 / 쓸 자리
                                             <- 사이 구간이 미읽음
```

미읽음은 `tail`에서 `head`까지의 구간이다. 그 구간이 배열 끝을 넘어 0으로 이어지는 순간이 링 버퍼의 특징이고, 동시에 버그가 시작되는 지점이다.

### 2.2 `head == tail`이 두 번 나온다

비었을 때 `head == tail`이다. 그런데 `cap`개를 다 채워도 `head`가 한 바퀴 돌아 `tail`과 만난다. **두 인덱스만으로는 정반대의 두 상태가 같은 모양이 된다.** 이것이 링 버퍼 구현에서 가장 흔한 결함이고, 해법은 셋뿐이다.

| 해법 | 가득 판정 | 대가 |
|---|---|---|
| ① 한 칸 비워 둔다 | `(head + 1) % cap == tail` | 담기는 것이 `cap - 1`개. 용량 계산이 한 칸씩 어긋나 헷갈린다 |
| ② 개수를 따로 센다 | `count == cap` | 공유 변수가 셋이 된다. **생산자와 소비자가 같은 변수를 쓴다** |
| ③ 접지 않는 시퀀스 번호 | `head - tail == cap` | 인덱스를 쓸 때마다 접어야 한다. 정수 범위를 신경 써야 한다 |

③이 실무에서 가장 많이 쓰인다. `head`와 `tail`을 "지금까지 쓴 총 개수"와 "지금까지 읽은 총 개수"로 두고, 배열에 접근할 때만 `% cap`으로 접는다. 이렇게 하면 **생산자는 `head`만 쓰고 소비자는 `tail`만 쓴다.** 둘이 같은 변수를 건드리지 않는다는 이 성질이 락 없는 구현의 전제가 된다([XI-3](#/xi-3)).

②는 반대다. `count`를 양쪽이 증감하므로 락이 없으면 즉시 깨진다. 단일 스레드에서 읽기 쉬운 코드가 동시성에서 최악이 되는 전형이다.

::: note
③에서 정수가 넘치면 어떻게 되는가. 부호 **없는** 정수를 쓰면 자연히 맞는다 — `head`와 `tail`이 같은 폭으로 함께 넘치므로 `head - tail`은 그대로 옳다. 부호 있는 정수의 오버플로는 C++에서 미정의 동작이므로 이 트릭을 쓸 수 없다([0-5](#/0-5)). Python 정수는 넘치지 않아 자릿수만 조용히 늘어난다.
:::

### 2.3 버퍼를 키우면 유실이 사라지는가

::: widget ringbuffer-concurrency {"capacity":8,"produce":3,"consume":1,"steps":60,"policy":"overwrite","modes":["overwrite","drop","block"]}
:::

위젯은 생산 3회마다 소비 1회라는 고정된 비율로 60번의 연산을 재생한다. 링 아래 막대가 점유이고, 그 아래가 생산·소비·유실·굶음 카운터다. 한 스텝씩 넘겨 보면 점유가 계단처럼 올라 8/8에 닿고, 그 뒤로는 생산할 때마다 `tail`이 함께 밀린다 — 읽히지 못한 가장 오래된 값이 덮이는 순간이다.

여기서 **용량 칸을 8에서 16으로 올려 보라.** 유실이 23에서 15로 줄지만 0이 되지 않는다. 4로 내리면 27이다. 값은 §4에서 코드로 다시 확인한다.

이 표가 이 절의 핵심 명제다. **버퍼는 순간적인 요동을 흡수할 뿐 평균 속도 차이를 흡수하지 못한다.** 생산이 소비보다 빠르면 점유는 단조 증가하고, 용량이 얼마든 언젠가 찬다. 용량을 키우는 것은 유실이 시작되는 시점을 늦출 뿐이다. 그리고 그 대가로 지연이 늘어난다 — 8칸짜리 오디오 버퍼는 8블록치 지연을, 64칸짜리는 64블록치 지연을 만든다.

"버퍼가 자꾸 넘치니 크기를 늘리자"는 대응이 통하지 않는 이유가 이것이다. 넘치는 원인은 크기가 아니라 속도 차이다.

### 2.4 가득 찼을 때 무엇을 버릴 것인가

넘치는 것 자체는 못 막는다. 정할 수 있는 것은 **누가 죽는가**뿐이고, 그 선택이 곧 시스템의 성격이다.

| 정책 | 가득 찼을 때 | 죽는 것 | 쓰는 곳 |
|---|---|---|---|
| **덮어쓰기** | 가장 오래된 미읽음을 덮는다 | 오래된 데이터 | 오디오 출력, 센서 최신 자세 — **최신값만 의미가 있다** |
| **버리기** | 새로 온 것을 거부한다 | 새 데이터 | 로그 수집, 계측 — 이미 받은 것을 지키는 편이 낫다 |
| **막기** | 생산자를 기다리게 한다 | 아무것도 안 죽는다. 대신 생산자가 느려진다 | 파이프라인 단계 사이 — 그 느려짐이 상류로 전파되는 것이 배압이다([XI-7](#/xi-7)) |

위젯의 정책 탭을 바꿔 보면 같은 일정에서 카운터가 어떻게 갈리는지 보인다. 셋 중에 옳은 것은 없다. **요구사항이 정하는 것이지 자료구조가 정하는 것이 아니다.**

반대 방향의 사고도 있다. 소비가 생산보다 빠르면 버퍼는 자주 비고 소비자는 읽을 것이 없는 채로 호출된다. 이것이 **언더런**이고, 오디오에서는 무음 블록이 재생돼 소리가 튄다. 유실은 하나도 없지만 결과는 똑같이 나쁘다.

## 3. 손으로 따라가기

::: trace
용량 4, 정책은 덮어쓰기. 연산은 **생산 3회 → 소비 1회**의 반복이다.

`head`는 다음에 쓸 자리, `tail`은 다음에 읽을 자리, 점유는 미읽음 개수다. 처음에는 셋 다 0이다.

| 스텝 | 동작 | head | tail | 점유 | 결과 |
|---|---|---|---|---|---|
| 0 | (시작) | 0 | 0 | 0 | — |
| 1 | 생산 | 1 | 0 | 1 | OK |
| 2 | 생산 | 2 | 0 | 2 | OK |
| 3 | 생산 | 3 | 0 | 3 | OK |
| 4 | 소비 | 3 | 1 | 2 | OK |
| 5 | 생산 |  |  |  |  |
| 6 | 생산 |  |  |  |  |
| 7 | 생산 |  |  |  |  |
| 8 | 소비 |  |  |  |  |
| 9 | 생산 |  |  |  |  |
| 10 | 생산 |  |  |  |  |

세 가지에 답하라.

- [ ] `head == tail`이 되는 스텝을 전부 찾아라. 스텝 0과 또 어디인가
- [ ] 그 스텝의 두 인덱스 값**만** 보고 가득인지 빈지 판정할 수 있는가
- [ ] 덮어쓰기가 처음 일어나는 스텝은 몇 번이고, 그때 `tail`은 왜 함께 움직이는가
:::

::: answer
| 스텝 | 동작 | head | tail | 점유 | 결과 |
|---|---|---|---|---|---|
| 0 | (시작) | 0 | 0 | 0 | — |
| 1 | 생산 | 1 | 0 | 1 | OK |
| 2 | 생산 | 2 | 0 | 2 | OK |
| 3 | 생산 | 3 | 0 | 3 | OK |
| 4 | 소비 | 3 | 1 | 2 | OK |
| 5 | 생산 | 0 | 1 | 3 | OK |
| 6 | 생산 | 1 | 1 | 4 | OK |
| 7 | 생산 | 2 | 2 | 4 | 덮임 |
| 8 | 소비 | 2 | 3 | 3 | OK |
| 9 | 생산 | 3 | 3 | 4 | OK |
| 10 | 생산 | 0 | 0 | 4 | 덮임 |

`head == tail`인 스텝은 0(비었다), 6(가득 찼다), 9(가득 찼다), 10(가득 찼다)이다.

**두 인덱스만으로는 판정할 수 없다.** 스텝 0과 스텝 6은 `head = tail = 0`과 `head = tail = 1`로, 값만 다를 뿐 관계는 똑같다. 하나는 아무것도 없고 하나는 꽉 찼다. 점유 열이 표에 있으니 우리는 구분하지만, 그 열이 곧 §2-2의 해법 ②다. 그 열을 지우면 코드도 구분하지 못한다.

덮어쓰기는 스텝 7에서 처음 일어난다. 점유가 4/4인 채로 생산이 왔으므로 가장 오래된 미읽음이 있는 자리, 즉 `tail`이 가리키던 슬롯 1이 새 값으로 덮인다. 그 값은 이제 읽을 수 없으니 `tail`도 한 칸 밀어야 한다. **`head`와 `tail`이 함께 움직이는 유일한 연산이 오버런이고, 그것이 곧 유실의 정의다.**

스텝 9는 소비 직후라 점유가 3이었으므로 정상 생산이다. 그 결과 다시 `head == tail == 3`이 되고, 스텝 10에서 또 덮인다.
:::

## 4. 구현

### 4.1 가득과 빔을 구분하는 세 가지

§2-2의 세 해법을 그대로 코드로 옮긴다. 셋 다 용량 4로 만들어 넣을 수 있을 때까지 넣고 상태를 찍는다.

::: dual
```python title="가득과 빔을 구분하는 세 가지 링 버퍼"
CAP = 4


class GapRing:
    """① 한 칸을 비워 둔다. 인덱스 둘만 들지만 담기는 것은 cap - 1 개다."""
    def __init__(self, cap):
        self.buf = [None] * cap
        self.cap = cap
        self.head = 0          # 다음에 쓸 자리
        self.tail = 0          # 다음에 읽을 자리

    def empty(self):
        return self.head == self.tail

    def full(self):
        return (self.head + 1) % self.cap == self.tail

    def size(self):
        return (self.head - self.tail) % self.cap

    def push(self, x):
        if self.full():
            return False
        self.buf[self.head] = x
        self.head = (self.head + 1) % self.cap
        return True


class CountRing:
    """② 개수를 따로 센다. cap 칸을 다 쓰지만 공유 변수가 셋이 된다."""
    def __init__(self, cap):
        self.buf = [None] * cap
        self.cap = cap
        self.head = 0
        self.tail = 0
        self.count = 0

    def empty(self):
        return self.count == 0

    def full(self):
        return self.count == self.cap

    def size(self):
        return self.count

    def push(self, x):
        if self.full():
            return False
        self.buf[self.head] = x
        self.head = (self.head + 1) % self.cap
        self.count += 1        # 생산자도 소비자도 이 한 변수를 건드린다
        return True


class SeqRing:
    """③ 접지 않는 시퀀스 번호. 배열에 닿을 때만 접는다."""
    def __init__(self, cap):
        self.buf = [None] * cap
        self.cap = cap
        self.head = 0          # 지금까지 쓴 총 개수
        self.tail = 0          # 지금까지 읽은 총 개수

    def empty(self):
        return self.head == self.tail

    def full(self):
        return self.head - self.tail == self.cap

    def size(self):
        return self.head - self.tail

    def push(self, x):
        if self.full():
            return False
        self.buf[self.head % self.cap] = x
        self.head += 1         # 생산자는 head 만, 소비자는 tail 만 쓴다
        return True


def report(name, r):
    n = 0
    while r.push(n):
        n += 1
    print(f"{name:9s} 담긴 개수 {r.size()}/{r.cap}  head={r.head} tail={r.tail}  "
          f"full={r.full()} empty={r.empty()}  head==tail? {r.head == r.tail}")


for name, cls in (("GapRing", GapRing), ("CountRing", CountRing), ("SeqRing", SeqRing)):
    report(name, cls(CAP))
```
```cpp title="가득과 빔을 구분하는 세 가지 링 버퍼"
#include <cstdio>
#include <string>
#include <vector>
using namespace std;

const int CAP = 4;

// ① 한 칸을 비워 둔다. 인덱스 둘만 들지만 담기는 것은 cap - 1 개다.
struct GapRing {
    vector<int> buf;
    int cap, head = 0, tail = 0;   // head=다음에 쓸 자리, tail=다음에 읽을 자리
    GapRing(int cap) : buf(cap, 0), cap(cap) {}

    bool empty() const { return head == tail; }
    bool full() const { return (head + 1) % cap == tail; }
    int size() const { return (head - tail + cap) % cap; }

    bool push(int x) {
        if (full()) return false;
        buf[head] = x;
        head = (head + 1) % cap;
        return true;
    }
};

// ② 개수를 따로 센다. cap 칸을 다 쓰지만 공유 변수가 셋이 된다.
struct CountRing {
    vector<int> buf;
    int cap, head = 0, tail = 0, count = 0;
    CountRing(int cap) : buf(cap, 0), cap(cap) {}

    bool empty() const { return count == 0; }
    bool full() const { return count == cap; }
    int size() const { return count; }

    bool push(int x) {
        if (full()) return false;
        buf[head] = x;
        head = (head + 1) % cap;
        count += 1;               // 생산자도 소비자도 이 한 변수를 건드린다
        return true;
    }
};

// ③ 접지 않는 시퀀스 번호. 배열에 닿을 때만 접는다.
struct SeqRing {
    vector<int> buf;
    int cap, head = 0, tail = 0;  // 지금까지 쓴 총 개수 / 읽은 총 개수
    SeqRing(int cap) : buf(cap, 0), cap(cap) {}

    bool empty() const { return head == tail; }
    bool full() const { return head - tail == cap; }
    int size() const { return head - tail; }

    bool push(int x) {
        if (full()) return false;
        buf[head % cap] = x;
        head += 1;                // 생산자는 head 만, 소비자는 tail 만 쓴다
        return true;
    }
};

string tf(bool b) { return b ? "True" : "False"; }

template <class R>
void report(const char* name, R r) {
    int n = 0;
    while (r.push(n)) n++;
    printf("%-9s 담긴 개수 %d/%d  head=%d tail=%d  full=%s empty=%s  head==tail? %s\n",
           name, r.size(), r.cap, r.head, r.tail,
           tf(r.full()).c_str(), tf(r.empty()).c_str(), tf(r.head == r.tail).c_str());
}

int main() {
    report("GapRing", GapRing(CAP));
    report("CountRing", CountRing(CAP));
    report("SeqRing", SeqRing(CAP));
    return 0;
}
```
:::

**복잡도:** `push`·`full`·`empty`·`size` 전부 시간 $O(1)$ — 나머지 연산 한 번과 대입 두어 번뿐이고 원소를 미는 루프가 없다. 공간 $O(\text{cap})$ — 담긴 개수와 무관하게 처음 잡은 배열 하나다.

두 언어의 출력이 같다.

```console
GapRing   담긴 개수 3/4  head=3 tail=0  full=True empty=False  head==tail? False
CountRing 담긴 개수 4/4  head=0 tail=0  full=True empty=False  head==tail? True
SeqRing   담긴 개수 4/4  head=4 tail=0  full=True empty=False  head==tail? False
```

읽을 곳은 세 군데다. `GapRing`은 **4칸짜리인데 3개만 담긴다.** `CountRing`은 가득 찬 상태에서 `head == tail`이 참인데도 `full()`이 옳게 나온다 — `count`가 있기 때문이다. `SeqRing`은 `head=4, tail=0`이라 애초에 모호함이 생기지 않는다. 같은 자료구조의 세 얼굴이고, 셋 중 무엇을 고르는가는 §2-2의 대가 표가 정한다.

### 4.2 정책이 카운터를 어떻게 가르는가

위젯이 재생한 일정을 그대로 계산한다. 생산 $p$회마다 소비 $c$회라는 정수비로 인터리빙을 고정하면 실행마다 같은 답이 나오고, 그러면서도 "속도가 다르면 무슨 일이 나는가"는 그대로 남는다.

::: dual
```python title="오버런·언더런과 정책 셋"
def schedule(p, c, n):
    """생산 p회마다 소비 c회. 두 쪽의 평균 속도 차이를 정수비로 고정한다."""
    ops = []
    while len(ops) < n:
        ops += ["P"] * min(p, n - len(ops))
        ops += ["C"] * min(c, n - len(ops))
    return ops


def simulate(cap, p, c, n, policy):
    head = tail = occ = 0
    produced = consumed = lost = blocked = starved = 0
    for op in schedule(p, c, n):
        if op == "P":
            if occ == cap:
                if policy == "overwrite":          # 가장 오래된 미읽음을 덮는다
                    head = (head + 1) % cap
                    tail = (tail + 1) % cap        # 읽히지 못한 것이 밀려난다
                    produced += 1
                    lost += 1
                elif policy == "drop":             # 새것을 버린다
                    produced += 1
                    lost += 1
                else:                              # block — 생산자가 기다린다
                    blocked += 1
            else:
                head = (head + 1) % cap
                occ += 1
                produced += 1
        else:
            if occ == 0:
                starved += 1                       # 언더런 — 읽을 것이 없다
            else:
                tail = (tail + 1) % cap
                occ -= 1
                consumed += 1
    return produced, consumed, lost, blocked, starved


def show(cap, p, c, n, policy):
    pr, co, lo, bl, st = simulate(cap, p, c, n, policy)
    print(f"{policy:9s} cap={cap:2d}: 생산 {pr:2d} 소비 {co:2d} "
          f"유실 {lo:2d} 대기 {bl:2d} 굶음 {st:2d}")


print("생산 3 : 소비 1, 60스텝 — 버퍼를 키우면 유실이 사라지는가")
for cap in (4, 8, 12, 16):
    show(cap, 3, 1, 60, "overwrite")
print("같은 조건, 정책만 바꾼다 (cap=8)")
show(8, 3, 1, 60, "drop")
show(8, 3, 1, 60, "block")
print("속도를 뒤집는다 — 생산 1 : 소비 3, 60스텝")
show(8, 1, 3, 60, "overwrite")
```
```cpp title="오버런·언더런과 정책 셋"
#include <cstdio>
#include <string>
#include <vector>
using namespace std;

// 생산 p회마다 소비 c회. 두 쪽의 평균 속도 차이를 정수비로 고정한다.
vector<char> schedule(int p, int c, int n) {
    vector<char> ops;
    while ((int)ops.size() < n) {
        for (int i = 0; i < p && (int)ops.size() < n; i++) ops.push_back('P');
        for (int i = 0; i < c && (int)ops.size() < n; i++) ops.push_back('C');
    }
    return ops;
}

struct Stat { int produced, consumed, lost, blocked, starved; };

Stat simulate(int cap, int p, int c, int n, const string& policy) {
    int head = 0, tail = 0, occ = 0;
    int produced = 0, consumed = 0, lost = 0, blocked = 0, starved = 0;
    for (char op : schedule(p, c, n)) {
        if (op == 'P') {
            if (occ == cap) {
                if (policy == "overwrite") {          // 가장 오래된 미읽음을 덮는다
                    head = (head + 1) % cap;
                    tail = (tail + 1) % cap;          // 읽히지 못한 것이 밀려난다
                    produced += 1;
                    lost += 1;
                } else if (policy == "drop") {        // 새것을 버린다
                    produced += 1;
                    lost += 1;
                } else {                              // block — 생산자가 기다린다
                    blocked += 1;
                }
            } else {
                head = (head + 1) % cap;
                occ += 1;
                produced += 1;
            }
        } else {
            if (occ == 0) {
                starved += 1;                         // 언더런 — 읽을 것이 없다
            } else {
                tail = (tail + 1) % cap;
                occ -= 1;
                consumed += 1;
            }
        }
    }
    return {produced, consumed, lost, blocked, starved};
}

void show(int cap, int p, int c, int n, const string& policy) {
    Stat s = simulate(cap, p, c, n, policy);
    printf("%-9s cap=%2d: 생산 %2d 소비 %2d 유실 %2d 대기 %2d 굶음 %2d\n",
           policy.c_str(), cap, s.produced, s.consumed, s.lost, s.blocked, s.starved);
}

int main() {
    printf("생산 3 : 소비 1, 60스텝 — 버퍼를 키우면 유실이 사라지는가\n");
    for (int cap : {4, 8, 12, 16}) show(cap, 3, 1, 60, "overwrite");
    printf("같은 조건, 정책만 바꾼다 (cap=8)\n");
    show(8, 3, 1, 60, "drop");
    show(8, 3, 1, 60, "block");
    printf("속도를 뒤집는다 — 생산 1 : 소비 3, 60스텝\n");
    show(8, 1, 3, 60, "overwrite");
    return 0;
}
```
:::

**복잡도:** 시간 $O(n)$ — 연산 하나마다 상수 개의 인덱스 갱신만 하므로 스텝 수에 비례한다. 용량은 비용에 들어가지 않는다. 공간 $O(1)$ — 이 시뮬레이션은 슬롯 내용을 저장하지 않고 인덱스와 카운터만 든다.

```console
생산 3 : 소비 1, 60스텝 — 버퍼를 키우면 유실이 사라지는가
overwrite cap= 4: 생산 45 소비 15 유실 27 대기  0 굶음  0
overwrite cap= 8: 생산 45 소비 15 유실 23 대기  0 굶음  0
overwrite cap=12: 생산 45 소비 15 유실 19 대기  0 굶음  0
overwrite cap=16: 생산 45 소비 15 유실 15 대기  0 굶음  0
같은 조건, 정책만 바꾼다 (cap=8)
drop      cap= 8: 생산 45 소비 15 유실 23 대기  0 굶음  0
block     cap= 8: 생산 22 소비 15 유실  0 대기 23 굶음  0
속도를 뒤집는다 — 생산 1 : 소비 3, 60스텝
overwrite cap= 8: 생산 15 소비 15 유실  0 대기  0 굶음 30
```

용량을 4배로 키우는 동안 유실은 27 → 15로 **절반도 못 줄었다.** 위젯의 카운터와 같은 값이다. 45개를 만드는 동안 15개만 소비했으니 30개는 어디로든 사라져야 한다 — 버퍼가 흡수한 것은 그중 처음 몇 개뿐이다.

`drop`은 유실 개수가 `overwrite`와 똑같이 23이다. **몇 개를 잃는가는 정책이 못 바꾼다. 정책이 바꾸는 것은 누가 죽는가다.** `block`은 유실이 0인 대신 생산이 45에서 22로 떨어졌다 — 23번 기다렸다는 뜻이고, 그 기다림은 상류의 누군가가 감당한다.

마지막 줄은 반대 사고다. 소비가 빠르면 굶음이 30회다. 유실 0, 즉 데이터는 하나도 안 잃었는데 소비자는 절반 이상의 호출에서 빈손으로 돌아갔다.

::: perf
용량이 2의 거듭제곱이면 `i % cap`을 `i & (cap - 1)`로 바꿀 수 있다. 커널과 오디오 링 버퍼가 용량을 2의 거듭제곱으로 고집하는 근거가 이것인데, 실제 차이는 언어마다 완전히 다르다.

| | 연산당 | 기준선 대비 |
|---|---|---|
| C++ `% cap` (cap이 런타임 값) | 8.7 ns | — |
| C++ `& mask` | **0.61 ns** | **14배 빠르다** |
| C++ `% 1024` (컴파일 시점 상수) | 1.84 ns | 4.7배 |
| Python `% cap` | 2,000만 회에 0.131초 (중앙값, 0.129~0.136) | — |
| Python `& mask` | 2,000만 회에 0.127초 (중앙값, 0.123~0.130) | **3%. 사실상 차이 없다** |

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측, 7회 실행의 중앙값과 범위. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 측정 스크립트는 `tools/bench/ringbuffer_mod_vs_mask.py` 와 `.cpp` 다.)

C++에서 14배는 무시할 수 없다. 정수 나눗셈은 CPU에서 가장 느린 산술 명령 중 하나이고, 링 버퍼는 원소마다 최소 한 번 그것을 한다. 초당 48,000 샘플이면 초당 48,000번이다.

Python에서는 3%다. 나머지 연산 자체는 C++과 비슷하게 비싸지만, 바이트코드 디스패치와 객체 처리가 워낙 커서 그 안에 묻힌다. 접지 않는 루프만 도는 데도 0.085초가 걸린다 — 즉 `%`가 더하는 몫은 연산당 23 ns이고 `&`는 21 ns다. **Python에서 용량을 2의 거듭제곱으로 맞추는 것은 성능 근거로는 정당화되지 않는다.** 그래도 맞추고 싶다면 이유는 다른 데 있어야 한다.
:::

::: pitfall
- **`head == tail`을 빔 판정으로만 쓴다.** 가득 찼을 때도 참이다. 넣은 만큼 조용히 사라지는 버그가 되고, 부하가 낮을 때는 절대 재현되지 않는다.
- **`size()`를 `head - tail`로 쓴다.** 접힌 인덱스에서는 음수가 나온다. C++의 `%`는 피연산자가 음수면 음수를 돌려주므로 `(head - tail + cap) % cap`이 필요하다. Python의 `%`는 항상 음이 아니라 그냥 통과한다 — **같은 식이 한쪽에서만 틀리는 전형적인 자리다.**
- **가득 판정을 빼고 무조건 덮어쓴다.** 덮어쓰기 정책이라면 `tail`도 함께 밀어야 한다. 안 밀면 `tail`이 이미 덮인 슬롯을 가리켜 **소비자가 새 데이터를 가장 오래된 것으로 읽는다.**
- **꺼낸 자리를 안 지운다.** Python에서 슬롯에 참조가 남으면 그 객체는 회수되지 않는다. 고정 크기 버퍼가 메모리를 붙잡고 있는다.
- **용량 0이나 1을 허용한다.** 한 칸 비우기 방식에서 용량 1은 담을 수 있는 것이 0개다. 생성 시점에 막아라.
:::

## 5. 생산자가 둘이 되는 순간

링 버퍼가 락 없이 성립하는 것은 **생산자 하나·소비자 하나(SPSC)**일 때뿐이다. 그 전제가 자료구조의 일부라는 사실이 자주 빠진다.

::: trace
생산자 A와 B가 락 없이 같은 링에 `push`한다. `push`는 세 조각이다.

```text nolines
  h = head          <- (1) 읽고
  buf[h] = x        <- (2) 쓰고
  head = h + 1      <- (3) 되쓴다
```

셋이 나뉘어 있으므로 그 사이에서 스레드가 갈릴 수 있다. `head = 0`에서 시작해 A가 `a1`을, B가 `b1`을 넣는다. **두 값이 다 살아남지 못하는 인터리빙을 만들어라.**

| 스텝 | 생산자 A | 생산자 B | head | buf[0] | buf[1] |
|---|---|---|---|---|---|
| 1 | h = head (=0) | | 0 | · | · |
| 2 | | h = head (=0) | 0 | · | · |
| 3 | buf[0] = a1 | | 0 | a1 | · |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |

- [ ] 끝났을 때 `head`는 얼마인가. 두 번 넣었는데 맞는 값인가
- [ ] 살아남은 값은 몇 개인가
:::

::: answer
| 스텝 | 생산자 A | 생산자 B | head | buf[0] | buf[1] |
|---|---|---|---|---|---|
| 1 | h = head (=0) | | 0 | · | · |
| 2 | | h = head (=0) | 0 | · | · |
| 3 | buf[0] = a1 | | 0 | a1 | · |
| 4 | | buf[0] = b1 | 0 | b1 | · |
| 5 | head = 1 | | 1 | b1 | · |
| 6 | | head = 1 | 1 | b1 | · |

두 번 넣었는데 `head`는 1이고, 살아남은 값은 `b1` 하나다. `a1`은 쓰였다가 덮였고 아무도 그것을 모른다.

**버퍼가 가득 차서 잃은 것이 아니다.** 점유는 1이고 빈 칸이 셋이다. 유실 카운터도 0이다. §2-4의 정책은 여기서 아무 도움이 안 된다 — 정책은 "가득 찼을 때"의 규칙이고, 이것은 가득 차지도 않았는데 사라진 경우다. 카운터를 믿고 만든 모니터링은 이 손실을 영원히 못 본다.
:::

📖 `threading.Thread(target=f)` — 함수 `f`를 새 스레드에서 돌린다. `start()`로 띄우고 `join()`으로 끝날 때까지 기다린다.
　 쓰는 곳: 이 절의 경쟁 재현, 유계 큐([XI-2](#/xi-2)), 스레드 풀([XI-4](#/xi-4)).
　 C++ 대응: `std::thread` — 생성자가 곧 `start`다. 소멸 전에 `join()`이나 `detach()`를 부르지 않으면 프로그램이 `std::terminate`로 죽는다. 이 차이가 실수의 진원지다.

📖 `threading.Lock()` — 한 번에 한 스레드만 통과시키는 자물쇠. `acquire()` / `release()`, 또는 `with lock:`.
　 재진입이 안 된다 — 같은 스레드가 두 번 잡으면 자기 자신을 기다리며 멈춘다. 재진입이 필요하면 `threading.RLock`이다.
　 C++ 대응: `std::mutex`, `std::lock_guard`. 재진입판은 `std::recursive_mutex`.

이제 이것을 실제로 터뜨린다. 생산자 스레드 둘(코어 4)이 각각 20만 번 `push`하고, 끝난 뒤 버퍼에 실제로 기록된 개수를 센다. 락을 건 판과 안 건 판을 나란히 돌린다.

::: dual
```python title="생산자 둘 — 락 없는 링 버퍼가 무엇을 잃는가"
import threading

CAP, PER, ROUNDS = 1 << 20, 200_000, 20


def tag(x):                     # push 안에 흔히 있는 한 줄 — 시퀀스 부여·포맷
    return x


class Ring:
    def __init__(self, cap, lock):
        self.buf = [0] * cap
        self.cap = cap
        self.head = 0
        self.lock = lock

    def push(self, x):
        if self.lock:
            self.lock.acquire()
        h = self.head                     # ① 읽고
        self.buf[h] = tag(x)              # ② 쓰고
        self.head = (h + 1) % self.cap    # ③ 되쓴다 — 셋 사이에서 갈리면 겹친다
        if self.lock:
            self.lock.release()


def one_round(lock):
    q = Ring(CAP, lock)

    def work():
        for _ in range(PER):
            q.push(1)

    a, b = threading.Thread(target=work), threading.Thread(target=work)
    a.start(); b.start(); a.join(); b.join()
    return sum(q.buf)


def survey(locked, label):
    bad = tot = 0
    for _ in range(ROUNDS):
        got = one_round(threading.Lock() if locked else None)
        tot += got
        bad += (got != PER * 2)
    # 회차 수와 평균은 실행마다 흔들린다. 지면에는 재현되는 사실만 싣고,
    # 흔들리는 값의 범위는 아래 "언어 차이" 표에 적는다.
    print(f"{label} 어긋난 회차 {'있음' if bad else '없음'} ({ROUNDS}회 중), "
          f"기록량 {'미달' if tot // ROUNDS < PER * 2 else '정확'}")


print("생산자 2 / 코어 4")
survey(False, "락 없음:")
survey(True, "락 있음:")
```
```cpp title="생산자 둘 — 락 없는 링 버퍼가 무엇을 잃는가"
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int CAP = 1 << 20, PER = 200000, ROUNDS = 20;

int tag(int x) { return x; }       // push 안에 흔히 있는 한 줄 — 시퀀스 부여·포맷

struct Ring {
    vector<int> buf;
    int cap, head = 0;
    mutex mu;
    bool lock;
    Ring(int cap, bool lock) : buf(cap, 0), cap(cap), lock(lock) {}

    void push(int x) {
        if (lock) mu.lock();
        int h = head;                  // ① 읽고
        buf[h] = tag(x);               // ② 쓰고
        head = (h + 1) % cap;          // ③ 되쓴다 — 셋 사이에서 갈리면 겹친다
        if (lock) mu.unlock();
    }
};

long long one_round(bool lock) {
    Ring q(CAP, lock);
    auto work = [&] { for (int i = 0; i < PER; i++) q.push(1); };
    thread a(work), b(work);
    a.join(); b.join();
    long long s = 0;
    for (int v : q.buf) s += v;
    return s;
}

void survey(bool locked, const char* label) {
    int bad = 0;
    long long tot = 0;
    for (int r = 0; r < ROUNDS; r++) {
        long long got = one_round(locked);
        tot += got;
        bad += (got != (long long)PER * 2);
    }
    // 회차 수와 평균은 실행마다 흔들린다. 지면에는 재현되는 사실만 싣는다.
    printf("%s 어긋난 회차 %s (%d회 중), 기록량 %s\n",
           label, bad ? "있음" : "없음", ROUNDS,
           tot / ROUNDS < (long long)PER * 2 ? "미달" : "정확");
}

int main() {
    printf("생산자 2 / 코어 4\n");
    survey(false, "락 없음:");
    survey(true, "락 있음:");
    return 0;
}
```
:::

**복잡도:** `push` 한 번은 락이 있든 없든 시간 $O(1)$이다. 달라지는 것은 상수다 — 경합 없는 락은 왕복 200 ns 안쪽이지만(수치는 [XI-2](#/xi-2)), 경합하면 대기 시간에 상한이 없다. 공간은 양쪽 다 $O(\text{cap})$.

**두 언어의 출력이 다르다. 그 차이가 이 절의 결론이다.**

| 언어 차이 | Python | C++ |
|---|---|---|
| 락 없는 20회 실행 | **18~19회 어긋남**, 평균 기록량 34만 / 40만 | **20회 전부 어긋남**, 평균 기록량 19만~21만 / 40만 |
| 왜 다른가 | GIL이 한 번에 한 스레드만 실행시킨다. 그래도 `push` 도중에 스위치가 나면 그대로 깨진다 | 진짜 병렬이라 두 스레드가 같은 순간에 같은 슬롯에 쓴다. 표준상 **미정의 동작** |
| 스위치가 나는 곳 | CPython 3.13은 아무 바이트코드 사이가 아니라 `RESUME`·`JUMP_BACKWARD`·`CALL` 같은 특정 지점에서만 갈린다. `tag()` 호출이 그 지점을 하나 만들었다 | 명령 경계 어디서든. 컴파일러 재배치와 CPU 재배치까지 겹친다([XI-3](#/xi-3)) |
| 락을 건 판 | 20회 모두 정확히 40만 | 20회 모두 정확히 40만 |

```console
생산자 2 / 코어 4
락 없음: 어긋난 회차 있음 (20회 중), 기록량 미달
락 있음: 어긋난 회차 없음 (20회 중), 기록량 정확
```

==출력에 회차 수와 평균값을 찍지 않는 것이 의도다.== 두 값은 실행마다 흔들린다 — 같은 코드를 다시 돌리면 19회가 18회가 되고 평균이 34만에서 35만으로 움직인다. **흔들리는 값을 네 자리까지 지면에 박으면 독자가 재현했을 때 책이 틀린 것이 된다.** 재현되는 사실만 출력에 남기고, 흔들리는 값의 범위는 위 표에 적었다.

::: danger
표의 세 번째 줄이 이 절에서 가장 위험한 문장이다. `tag()` 호출을 지우면 — 즉 `push` 본문에 함수 호출이 하나도 없게 만들면 — **같은 실험에서 Python은 100회 중 0회 어긋난다.** 호출 하나를 넣고 빼는 것으로 결과가 뒤집힌다.

그러니 "GIL이 있으니 안전하다"는 **언어의 보장이 아니라 구현 세부에 기댄 착각이다.** 스위치 지점의 배치는 CPython 버전마다 바뀌고, 코드에 로그 한 줄·포맷 한 줄을 넣는 순간 새 스위치 지점이 생긴다. 오늘 도는 코드가 내일 깨지고, 깨진 뒤에도 재현되지 않는다.
:::

## 6. 어디에 쓰이는가

**오디오 I/O가 이 자료구조의 원형이다.** 장치 드라이버와 애플리케이션 사이에 고정 크기 링 버퍼가 있고, 드라이버 콜백은 실시간 우선순위로 돈다. 버퍼가 비면 언더런이고 무음이 재생된다 — 그것이 "틱"이나 "지직"으로 들린다. 반대로 크게 잡으면 유실은 줄지만 입력에서 출력까지의 지연이 늘어난다. 오디오 설정의 버퍼 크기 값이 늘 "안정성 대 지연"의 저울로 설명되는 이유가 이것이다.

**커널 로그 버퍼가 덮어쓰기 정책의 대표다.** `dmesg`가 보여 주는 것은 고정 크기 링 버퍼의 내용이고, 새 메시지가 계속 들어오면 오래된 것이 조용히 덮인다. 부팅 직후의 로그가 사라져 있는 것은 고장이 아니라 설계다 — 커널은 로그를 쓰겠다고 메모리 할당을 기다릴 수 없다.

**네트워크 카드의 수신 링이 같은 구조다.** 카드는 패킷을 링의 다음 칸에 DMA로 쓰고, 커널은 반대편에서 꺼낸다. 커널이 늦으면 카드는 새 패킷을 버린다 — 버리기 정책이다. 인터페이스 통계에 잡히는 드롭 수가 바로 이 카운터이고, "네트워크가 느리다"의 원인이 대역폭이 아니라 소비 속도인 경우를 이 숫자가 가른다.

**제어 루프와 통신 스레드 사이도 링 버퍼다.** 제어 루프는 정해진 주기를 지켜야 하므로 통신을 기다릴 수 없다. 통신 스레드가 링에 쓰고 제어 루프는 가장 최신 것만 읽는다. 그 둘을 안전하게 잇는 방법이 [XI-2 생산자-소비자와 유계 큐](#/xi-2)다.

::: interview
**"고정 크기 링 버퍼에서 가득 찬 것과 빈 것을 어떻게 구분합니까."**
세 답을 다 대고 대가를 말하면 끝난다. 한 칸 비우기(용량 손해), 개수 세기(공유 변수가 늘어 락 없는 구현이 막힌다), 접지 않는 시퀀스 번호(생산자는 `head`만 소비자는 `tail`만 쓴다). 마지막 답까지 가면 질문이 자연스럽게 락프리로 넘어간다.

**"버퍼가 자꾸 넘칩니다. 크기를 얼마로 키우면 됩니까."**
정답은 숫자가 아니다. **평균 생산 속도가 평균 소비 속도보다 크면 어떤 크기도 부족하다.** 버퍼는 요동을 흡수하는 장치이지 속도 차이를 흡수하는 장치가 아니다. 되물어야 할 것은 셋이다 — 평균 속도가 정말 다른가, 다르다면 소비를 빠르게 할 것인가 생산을 막을 것인가, 막을 수 없다면 무엇을 버려도 되는가.

**"오디오에는 왜 덮어쓰기를 씁니까."**
최신값만 의미가 있기 때문이다. 3초 전 샘플을 뒤늦게 재생하는 것은 아무 가치가 없다. 반대로 로그는 이미 받은 것이 더 귀하므로 새것을 버린다. **정책은 데이터의 시간 가치가 정한다.**
:::

## 연습

::: quiz
코드가 아니라 설계를 답하는 문제다. 각 상황에서 ① 무엇이 넘치거나 경쟁하는가 ② 어떤 구조를 쓰고 ③ 그 선택의 대가는 무엇인가를 순서대로 쓴다.

**1. 라이다 스캔 버퍼**
회전 라이다가 20 Hz로 스캔 한 장을 뱉는다. 인지 모듈은 한 장을 처리하는 데 평균 40 ms, 가끔 120 ms가 걸린다. 처리 결과는 "가장 최근 스캔에 대한 판단"이어야 한다.
- 넘치는 것: 생산 20 Hz(50 ms) 대 평균 소비 25 Hz. 평균으로는 여유가 있고 순간적으로만 밀린다 — 버퍼가 실제로 도움이 되는 조건이다.
- 구조와 정책: 작은 링 버퍼 + 덮어쓰기. 밀린 동안 쌓인 옛 스캔은 처리해 봐야 이미 틀린 판단이다.
- 대가: 120 ms 스파이크 동안 스캔 두 장을 버린다. 그 사실을 카운터로 남기지 않으면 "가끔 반응이 굼뜬 이유"를 영원히 못 찾는다.

**2. 결제 이벤트 큐**
결제 서버가 이벤트를 정산 배치로 넘긴다. 하나도 잃으면 안 된다.
- 넘치는 것: 배치가 멈춰 있는 동안 이벤트가 쌓인다.
- 구조와 정책: 막기(배압). 유실이 허용되지 않으므로 덮어쓰기와 버리기는 후보에서 탈락이다.
- 대가: 생산자가 멈춘다. 결제 API의 응답이 느려지고 그것이 사용자에게 보인다. **막기는 문제를 없애는 것이 아니라 상류로 옮기는 것이다** — 어디까지 전파돼도 되는지를 먼저 정해야 한다([XI-7](#/xi-7)).

**3. 여러 워커가 한 링에 로그를 쓴다**
워커 스레드 여덟 개(코어 4)가 같은 링 버퍼에 로그 줄을 넣고, 기록 스레드 하나가 꺼내 파일에 쓴다.
- 경쟁하는 것: 생산자가 여덟이므로 §5의 인터리빙이 그대로 일어난다. 가득 차지 않아도 줄이 사라진다.
- 구조: 링 버퍼 하나 + 락, 또는 **워커마다 자기 링을 하나씩** 두고 기록 스레드가 여러 링을 훑는다. 후자는 각 링이 SPSC라 락이 필요 없다.
- 대가: 전자는 워커 여덟이 한 락에서 줄을 선다. 후자는 락이 사라지는 대신 로그의 전역 순서가 깨지고, 기록 스레드가 순서를 다시 맞춰야 한다.

**4. 용량을 정하는 근거**
센서가 100 Hz로 값을 보내고 소비자는 평균 100 Hz로 처리하는데, 10 ms마다 한 번씩 최대 50 ms 동안 다른 일을 하느라 멈춘다.
- 넘치는 것: 평균은 같고 순간만 밀린다. 이 경우에만 버퍼가 답이 된다.
- 구조: 최악의 정지 시간 동안 쌓이는 양이 용량의 하한이다. 50 ms × 100 Hz = 5개이므로 그 이상.
- 대가: 여유를 크게 잡을수록 지연이 늘어난다. **용량은 "최악의 정지 시간 × 생산 속도"에서 시작해 지연 예산이 허락하는 만큼만 올리는 값이지, 넉넉히 잡는 값이 아니다.**
:::

## 요약

- 링 버퍼는 고정 크기 배열 위에서 인덱스 둘을 굴려 양 끝 연산을 $O(1)$로 만든다. 크기가 고정이라는 것은 결함이 아니라, **넘칠 때 무엇을 버릴지를 강제로 정하게 만드는 성질**이다.
- `head == tail`은 비었을 때와 가득 찼을 때 모두 참이다. 해법은 한 칸 비우기·개수 세기·접지 않는 시퀀스 번호 셋뿐이고, 셋의 대가가 다르다.
- 시퀀스 번호 방식은 생산자가 `head`만, 소비자가 `tail`만 쓰게 만든다. 그 성질이 락 없는 구현의 전제다.
- **버퍼는 순간적인 요동을 흡수할 뿐 평균 속도 차이를 흡수하지 못한다.** 생산 3 : 소비 1에서 용량을 4배로 키워도 유실은 27에서 15로만 줄었다.
- 정책 셋은 잃는 개수를 바꾸지 못하고 **누가 죽는지**를 바꾼다. 덮어쓰기는 오래된 것, 버리기는 새것, 막기는 생산자의 속도를 죽인다.
- 용량이 2의 거듭제곱이면 `% cap`을 `& (cap-1)`로 바꿀 수 있다. C++에서는 연산당 8.7 ns → 0.61 ns로 14배지만, Python에서는 3%로 사실상 차이가 없다.
- 링 버퍼가 락 없이 옳은 것은 생산자 하나·소비자 하나일 때뿐이다. 생산자가 둘이 되면 가득 차지 않았는데도 값이 사라지고, **유실 카운터는 0을 가리킨다.**

**다음 절**: [XI-2 생산자-소비자와 유계 큐](#/xi-2) — 이 링 버퍼를 두 스레드가 안전하게 나눠 쓰려면 무엇이 더 필요한가. 기다리는 방법 하나로 CPU 점유율이 5%와 101%로 갈린다.
