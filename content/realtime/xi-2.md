# XI-2 생산자-소비자와 유계 큐

::: lead
버퍼를 두 스레드가 나눠 쓰는 순간, 자료구조에 없던 문제 하나가 생긴다 — 읽을 것이 없을 때 무엇을 하며 기다리는가.
:::

## 1. 문제

제어 루프는 5 ms마다 한 바퀴를 돌아야 한다. 같은 루프 안에서 상태를 서버로 올려 보내면 그 주기가 깨진다. 소켓 쓰기는 상대가 느리면 수십 밀리초를 붙잡고, 그 시간은 아무도 보장해 주지 않는다.

그래서 둘을 스레드로 가른다. 제어 루프는 계산만 하고 결과를 버퍼에 넣는다. 통신 스레드가 버퍼에서 꺼내 보낸다. 통신이 막혀도 제어 루프는 자기 주기를 지킨다.

가운데 놓는 버퍼는 [XI-1](#/xi-1)의 링 버퍼다. 고정 크기고, 넘칠 때 무엇을 버릴지를 정책으로 정했다. 그런데 XI-1의 코드는 전부 **한 스레드**에서 돌았다. 두 스레드가 같은 링을 잡는 순간 두 가지가 더 필요해진다.

첫째는 상호배제다. XI-1 §5가 이미 보였다 — 생산자가 둘이 되면 가득 차지 않았는데도 값이 사라지고 유실 카운터는 0을 가리킨다. 이 절은 그 위에 락을 얹은 상태에서 출발한다. 락 자체의 원리와 그것을 없애는 방법은 [XI-3](#/xi-3)이 다룬다.

둘째가 이 절의 주제다. **큐가 비었을 때 소비자는 무엇을 하는가.**

가장 먼저 떠오르는 답은 계속 들여다보는 것이다.

```text nolines
  while (queue.empty()) { }      # keep looking until something arrives
  item = queue.pop()
```

돌기는 돈다. 그리고 코어 하나를 통째로 태운다.

::: perf
항목 200개를 2 ms 간격으로 생산하고 소비자 하나가 받는다. 소비자가 하는 일은 없다 — 오는 대로 버린다. 벽시계 시간이 아니라 **CPU 시간**을 재면 두 방법이 갈린다.

| 소비자의 기다리는 법 | 벽시계 중앙값 | CPU 중앙값 | CPU 점유율 |
|---|---|---|---|
| Python 바쁜 대기 | 1.46초 | 1.47초 | **101%** |
| Python 조건변수 | 0.43초 | 0.022~0.027초 | **5~6%** |
| C++ 바쁜 대기 | 0.43초 | 0.43초 | **102%** |
| C++ 조건변수 | 0.43초 | 0.016~0.018초 | **4%** |

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측, 5회 실행의 중앙값을 두 번 재실행한 범위. 코어 4. 측정 스크립트는 `tools/bench/bounded_queue_busywait.py` 와 `.cpp` 다.)

읽을 것이 둘이다. **CPU 시간이 C++에서 25배, Python에서 60배 차이 난다.** 아무 일도 안 하면서 코어를 하나 다 쓴 것이다.

그리고 Python 쪽은 **벽시계까지 3.4배 나빠졌다.** 회전하는 소비자가 GIL을 계속 되잡는 바람에 생산자가 밀렸기 때문이다. C++에서는 벽시계가 같다 — 코어가 남으니 회전 소비자는 자기 코어만 태운다. **회전 대기의 대가는 언어에 따라 "전기"이기도 하고 "전기 + 남의 진행"이기도 하다.**
:::

## 2. 아이디어

### 2.1 유계 큐는 링 버퍼에 세 가지를 얹은 것이다

::: widget ringbuffer-concurrency {"capacity":6,"produce":2,"consume":3,"steps":48,"policy":"block","modes":["block"]}
:::

위젯은 생산 2회마다 소비 3회라는 일정으로 48번의 연산을 재생한다. XI-1에서는 생산이 빨랐고 정책 셋을 갈아 끼웠다. 여기서는 반대로 **소비가 빠르고 정책은 막기 하나**다. 그것이 유계 큐가 놓이는 자리이기 때문이다 — 아무것도 버릴 수 없으니 기다린다.

한 스텝씩 넘겨 보면 점유가 0과 2 사이에서 진동하고, **굶음 카운터가 계속 올라간다.** 소비자가 빈 큐를 만나는 순간이 그것이다. 반대 비율로 돌리면 이번에는 대기 카운터가 오른다. 유계 큐에는 이렇게 **경계가 둘**이다.

- **가득 참** — 생산자가 넣을 자리가 없다. 버리지 않기로 했으므로 기다린다.
- **빔** — 소비자가 꺼낼 것이 없다. 만들어 낼 수 없으므로 기다린다.

그래서 유계 큐 = **링 버퍼 + 락 하나 + 조건변수 둘**이다. 락은 두 인덱스와 개수를 한 덩어리로 지키고, 조건변수는 각각 "자리가 났다"와 "물건이 들어왔다"를 알린다.

📖 `threading.Condition(lock)` — 특정 락에 붙은 대기열. `wait()`는 **그 락을 놓고 잠들었다가**, 통지를 받으면 **락을 다시 잡은 뒤에** 돌아온다. `notify()`는 대기자 하나, `notify_all()`은 전원을 깨운다.
　 인자를 주지 않으면 자기 락을 새로 만든다. **한 자료구조에 조건이 둘이면 락 하나를 공유하는 두 `Condition`을 만든다.**
　 쓰는 곳: 유계 큐, 스레드 풀의 작업 큐([XI-4](#/xi-4)).
　 C++ 대응: `std::condition_variable` — `wait(lk)`에 `unique_lock`을 넘긴다. 락과 조건변수가 별개의 객체라 짝을 매번 손으로 맞춰야 한다.

### 2.2 `wait`은 락을 놓았다가 다시 잡는다

이 한 문장을 모르면 첫 구현이 반드시 멈춘다. 생산자가 "가득 참"을 확인하는 것은 **락을 쥔 채**다. 그 상태로 그냥 잠들면 소비자는 락을 못 잡고, 소비자가 못 꺼내니 자리는 영원히 안 난다. 서로가 서로를 기다리는 교착이다.

```text nolines
  producer                          consumer
  --------                          --------
  lock()                            (blocked on lock)
  count == cap  -> full             .
  wait()  ---- releases lock ---->  lock() acquired
  (sleeping)                        count--, notify()
  (woken)                           unlock()
  <---- re-acquires lock -------    .
  re-check count, then push
```

`wait`은 그래서 **원자적으로 "락을 놓고 잠든다"**를 한다. 놓는 것과 잠드는 것 사이에 틈이 있으면 그 틈에서 통지가 지나가 버린다. 깨어날 때는 반대로 **락을 다시 잡은 뒤에** 반환한다 — 그러므로 `wait` 다음 줄은 언제나 임계 구역 안이다.

### 2.3 그래서 `if`가 아니라 `while`이다

깨어났다는 것은 "누군가 상태를 바꿨다"는 뜻이지 "지금 네 조건이 참이다"라는 뜻이 아니다. 셋이 그 사이를 벌린다.

- **가짜 깨움(spurious wakeup).** 아무도 통지하지 않았는데 `wait`이 반환할 수 있다. 표준이 허용한다.
- **통지 도둑질.** `notify_all`로 셋이 깨어나도 물건은 하나다. 깬 순서대로 락을 잡으니 뒤의 둘은 빈 큐를 만난다.
- **끼어들기.** 통지와 락 획득 사이에 제3의 스레드가 들어와 물건을 가져갈 수 있다.

`while`로 감싸면 셋 다 같은 방식으로 처리된다 — **깨어나서 조건을 다시 보고, 아니면 다시 잔다.** 조건변수의 통지는 "확인해 보라"는 힌트이지 보증이 아니다. `if`로 짜면 그 힌트를 보증으로 믿는 코드가 되고, 빈 큐에서 꺼내는 순간 터진다. §4.2에서 그것을 재현한다.

::: note
[XI-3](#/xi-3) §4.2는 같은 규율의 **다른 실패 모드**를 다룬다. 거기서는 대기에 들어가기도 전에 통지가 지나가 영영 깨어나지 못한다. 조건변수는 신호를 저장하지 않기 때문이다. 이쪽은 반대로 **깨어났는데 조건이 거짓인** 경우다. 두 실패의 해법은 하나다 — 신호가 아니라 **상태**를 본다.
:::

### 2.4 끝내는 법 — 독약

소비자는 `while True`로 돈다. 생산이 끝났다는 것을 어떻게 아는가. 플래그를 두면 소비자가 잠든 사이에 켜질 수 있어 통지를 또 짝지어야 한다. 더 간단한 방법은 **큐에 종료 표식을 넣어 보내는 것**이다.

이것을 **독약(poison pill)**이라 부른다. 데이터와 같은 경로로 흐르므로 순서가 저절로 지켜진다 — 앞의 항목을 전부 처리한 뒤에야 표식에 닿는다.

**소비자가 $n$개면 독약도 $n$개다.** 하나만 넣으면 그것을 받은 소비자 하나만 끝나고 나머지 $n-1$은 영원히 기다린다. 받은 소비자가 표식을 다시 큐에 넣고 나가는 변형도 있지만, 그때는 마지막 하나가 표식을 빼지 못해 큐에 찌꺼기가 남는다. 숫자를 맞추는 쪽이 단순하다.

## 3. 손으로 따라가기

::: trace
용량 2인 유계 큐다. 생산자 P가 값 셋을 연달아 넣고, 소비자 C가 그 사이에 하나를 꺼낸다.

`락` 열은 지금 락을 쥔 쪽이고, `count`는 큐에 든 개수다. 처음에는 아무도 락을 쥐지 않았고 `count = 0`이다.

| 스텝 | 생산자 P | 소비자 C | 락 | count | P의 상태 |
|---|---|---|---|---|---|
| 1 | 락 잡고 넣음, 놓음 | | 없음 | 1 | 실행 중 |
| 2 | 락 잡고 넣음, 놓음 | | 없음 | 2 | 실행 중 |
| 3 | 락 잡음 → `count == 2` | | P | 2 | 실행 중 |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |

세 가지에 답하라.

- [ ] 스텝 4에서 P가 `not_full.wait()`을 부른다. 이때 락은 누구 것이 되는가
- [ ] 만약 `wait`이 락을 놓지 않는다면 스텝 5에서 C는 무엇을 하게 되는가
- [ ] P가 깨어난 뒤 곧바로 넣지 않고 `count`를 다시 보는 이유는 무엇인가
:::

::: answer
| 스텝 | 생산자 P | 소비자 C | 락 | count | P의 상태 |
|---|---|---|---|---|---|
| 1 | 락 잡고 넣음, 놓음 | | 없음 | 1 | 실행 중 |
| 2 | 락 잡고 넣음, 놓음 | | 없음 | 2 | 실행 중 |
| 3 | 락 잡음 → `count == 2` | | P | 2 | 실행 중 |
| 4 | `not_full.wait()` | | **없음** | 2 | **잠듦** |
| 5 | | 락 잡음, 하나 꺼냄 | C | 1 | 잠듦 |
| 6 | | `not_full.notify()`, 락 놓음 | 없음 | 1 | **깨어남(락 없음)** |
| 7 | 락을 다시 잡고 `count` 재확인 → 넣음 | | P | 2 | 실행 중 |

**스텝 4에서 락은 아무도 쥐지 않은 상태가 된다.** `wait`이 잠들면서 락을 놓기 때문이다. 그래서 스텝 5의 C가 락을 잡을 수 있다.

`wait`이 락을 놓지 않는다면 C는 스텝 5에서 락을 기다리며 멈춘다. C가 멈추면 `count`는 영원히 2이고, P는 영원히 잠들어 있다. **둘 다 상대가 움직이기를 기다리는 교착**이고, 이것이 조건변수를 처음 쓸 때 가장 많이 만드는 버그다.

스텝 6과 7 사이가 세 번째 답이다. 통지를 받은 시점과 락을 다시 잡는 시점은 **같지 않다.** 그 사이에 다른 생산자가 끼어들어 자리를 채웠다면 `count`는 다시 2다. P는 자기가 깨어난 이유가 아직 유효한지 알 방법이 없으므로 **직접 확인해야 한다.** 그 확인을 반복문으로 감싸는 것이 §2.3의 `while`이다.
:::

## 4. 구현

### 4.1 유계 큐

락 하나에 조건변수 둘을 붙인다. 생산자 2, 소비자 3(코어 4)이 용량 4짜리 큐를 나눠 쓰고, 끝은 독약으로 맺는다.

::: dual
```python title="유계 큐 — 락 하나, 조건변수 둘, 독약으로 종료"
import threading

CAP, ITEMS, NPROD, NCONS = 4, 1000, 2, 3      # 코어 4


class BoundedQueue:
    """링 버퍼(XI-1) + 락 하나 + 조건변수 둘."""

    def __init__(self, cap):
        self.buf = [None] * cap
        self.cap = cap
        self.head = self.tail = self.count = 0
        self.mu = threading.Lock()
        self.not_full = threading.Condition(self.mu)    # 자리가 났다
        self.not_empty = threading.Condition(self.mu)   # 물건이 들어왔다
        self.waited_full = 0
        self.waited_empty = 0

    def put(self, x):
        with self.mu:
            while self.count == self.cap:      # if 가 아니라 while
                self.waited_full += 1
                self.not_full.wait()           # 락을 놓고 잠든다. 깨면 다시 잡는다
            self.buf[self.head] = x
            self.head = (self.head + 1) % self.cap
            self.count += 1
            self.not_empty.notify()            # 소비자를 하나 깨운다

    def get(self):
        with self.mu:
            while self.count == 0:
                self.waited_empty += 1
                self.not_empty.wait()
            x = self.buf[self.tail]
            self.tail = (self.tail + 1) % self.cap
            self.count -= 1
            self.not_full.notify()             # 생산자를 하나 깨운다
            return x


POISON = -1
q = BoundedQueue(CAP)
got = [0] * NCONS
acc = [0] * NCONS


def producer(k):
    for i in range(k, ITEMS, NPROD):
        q.put(i)


def consumer(k):
    while True:
        x = q.get()
        if x == POISON:
            return
        got[k] += 1
        acc[k] += x


ps = [threading.Thread(target=producer, args=(k,)) for k in range(NPROD)]
cs = [threading.Thread(target=consumer, args=(k,)) for k in range(NCONS)]
for t in ps + cs:
    t.start()
for t in ps:
    t.join()
for _ in range(NCONS):     # 독약은 소비자 수만큼
    q.put(POISON)
for t in cs:
    t.join()

print(f"용량 {CAP} · 항목 {ITEMS} · 생산자 {NPROD} · 소비자 {NCONS} (코어 4)")
print(f"받은 개수 {sum(got)} · 합계 {sum(acc)} · 기대 {ITEMS * (ITEMS - 1) // 2}")
print(f"가득 차서 생산자가 기다린 적: {'있음' if q.waited_full else '없음'}")
print(f"비어서 소비자가 기다린 적: {'있음' if q.waited_empty else '없음'}")
print(f"끝났을 때 점유 {q.count}")
```
```cpp title="유계 큐 — 락 하나, 조건변수 둘, 독약으로 종료"
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int CAP = 4, ITEMS = 1000, NPROD = 2, NCONS = 3;   // 코어 4

// 링 버퍼(XI-1) + 락 하나 + 조건변수 둘.
struct BoundedQueue {
    vector<int> buf;
    int cap, head = 0, tail = 0, count = 0;
    mutex mu;
    condition_variable not_full;    // 자리가 났다
    condition_variable not_empty;   // 물건이 들어왔다
    int waited_full = 0, waited_empty = 0;
    BoundedQueue(int cap) : buf(cap, 0), cap(cap) {}

    void put(int x) {
        unique_lock<mutex> lk(mu);
        while (count == cap) {           // if 가 아니라 while
            waited_full += 1;
            not_full.wait(lk);           // 락을 놓고 잠든다. 깨면 다시 잡는다
        }
        buf[head] = x;
        head = (head + 1) % cap;
        count += 1;
        not_empty.notify_one();          // 소비자를 하나 깨운다
    }

    int get() {
        unique_lock<mutex> lk(mu);
        while (count == 0) {
            waited_empty += 1;
            not_empty.wait(lk);
        }
        int x = buf[tail];
        tail = (tail + 1) % cap;
        count -= 1;
        not_full.notify_one();           // 생산자를 하나 깨운다
        return x;
    }
};

const int POISON = -1;
BoundedQueue q(CAP);
long long got[NCONS] = {0}, acc[NCONS] = {0};

void producer(int k) {
    for (int i = k; i < ITEMS; i += NPROD) q.put(i);
}

void consumer(int k) {
    for (;;) {
        int x = q.get();
        if (x == POISON) return;
        got[k] += 1;
        acc[k] += x;
    }
}

int main() {
    vector<thread> ps, cs;
    for (int k = 0; k < NPROD; k++) ps.emplace_back(producer, k);
    for (int k = 0; k < NCONS; k++) cs.emplace_back(consumer, k);
    for (auto& t : ps) t.join();
    for (int i = 0; i < NCONS; i++) q.put(POISON);   // 독약은 소비자 수만큼
    for (auto& t : cs) t.join();

    long long sg = 0, sa = 0;
    for (int k = 0; k < NCONS; k++) { sg += got[k]; sa += acc[k]; }
    printf("용량 %d · 항목 %d · 생산자 %d · 소비자 %d (코어 4)\n", CAP, ITEMS, NPROD, NCONS);
    printf("받은 개수 %lld · 합계 %lld · 기대 %d\n", sg, sa, ITEMS * (ITEMS - 1) / 2);
    printf("가득 차서 생산자가 기다린 적: %s\n", q.waited_full ? "있음" : "없음");
    printf("비어서 소비자가 기다린 적: %s\n", q.waited_empty ? "있음" : "없음");
    printf("끝났을 때 점유 %d\n", q.count);
    return 0;
}
```
:::

**복잡도:** `put`·`get` 모두 시간 $O(1)$ — 인덱스 갱신 몇 개와 락 왕복 한 번이다. 대기 시간은 복잡도에 안 들어간다. 상대가 언제 움직이는지는 자료구조가 정하는 것이 아니기 때문이다. 공간 $O(\text{cap})$ — 실행 중 할당이 없다.

**상수가 문제다.** 왕복당 실측은 이렇다.

| 왕복 1회 (경합 없음, 코어 4) | Python | C++ |
|---|---|---|
| 락 없는 넣고 빼기 | 64 ns (64~66) | 4.0 ns (3.9~4.0) |
| 락으로 감싼 것 | 240 ns (239~240) | 10.2 ns (10.1~10.2) |
| 락 + `notify_one` (대기자 없음) | — | 13.4 ns (13.3~14.1) |
| `queue.Queue(maxsize=8)` | 1,700 ns (1,697~1,710) | — |

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측, 7회 실행의 중앙값을 3~4회 재실행한 범위. 측정 스크립트는 `tools/bench/bounded_queue_lock_cost.py` 와 `.cpp` 다.)

C++에서 락이 왕복당 6 ns, 통지가 다시 3 ns를 더한다. **대기자가 하나도 없어도 통지에 값이 붙는다** — 그래서 처리량이 중요한 구현은 "대기자가 있을 때만 통지"를 별도 카운터로 판정한다. Python 쪽은 자릿수가 다르다. 락 하나에 176 ns가 붙고, `queue.Queue`는 왕복 1.7 마이크로초로 **초당 60만 건 근처가 상한**이다. 그 이상이 필요하면 큐를 고칠 것이 아니라 항목을 묶어서 넣어야 한다.

```console
용량 4 · 항목 1000 · 생산자 2 · 소비자 3 (코어 4)
받은 개수 1000 · 합계 499500 · 기대 499500
가득 차서 생산자가 기다린 적: 있음
비어서 소비자가 기다린 적: 있음
끝났을 때 점유 0
```

두 언어의 출력이 같다. 용량 4에 항목 1,000개이므로 양쪽 경계를 모두 밟는다 — 생산자도 소비자도 최소 한 번은 잠들었고, 그러고도 1,000개가 정확히 한 번씩 전달됐다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 병렬성 | GIL. CPU 바운드 소비자는 늘려도 안 빨라진다(§4.3) | 코어 수만큼 진짜로 동시에 돈다 |
| 락과 조건변수의 짝 | `Condition(lock)`으로 **묶여 있다.** `with cond:`가 곧 락이다 | `mutex`와 `condition_variable`이 별개. `wait`에 `unique_lock`을 넘겨 매번 짝을 맞춘다 |
| 술어 형태 | `cond.wait_for(술어, timeout=)` | `cv.wait(lk, 술어)` — `while`을 대신 감아 준다 |
| 이미 있는 것 | `queue.Queue(maxsize=n)`이 곧 유계 큐다. 내부도 락 하나 + 조건변수 셋 | 표준에 없다. 직접 짜거나 라이브러리를 쓴다 |
| 왕복 비용 | 락 240 ns, `queue.Queue` 1,700 ns | 락 10.2 ns, 통지까지 13.4 ns |
| 스레드 강제 종료 | 수단이 없다. **그래서 독약이 필수다** | `jthread`(C++20)의 협조적 취소. C++17에서는 역시 독약이나 원자적 플래그 |
| 원소 타입 | 무엇이든 담긴다. 독약은 `None`이나 전용 표식 객체가 자연스럽다 | 타입이 고정이라 표식용 값(`-1`)이나 `optional`이 필요하다 |

### 4.2 `if`로 감싸면 무엇이 깨지는가

먼저 손으로 만들어 본다.

::: trace
소비자 C1·C2가 빈 큐에서 각각 대기 중이다. 생산자 P가 항목 **하나**를 넣고 `notify_all`로 둘 다 깨운다. 두 소비자는 대기를 `if`로 감쌌다 — 즉 깨어나면 조건을 다시 보지 않고 곧바로 꺼낸다.

| 스텝 | 생산자 P | 소비자 C1 | 소비자 C2 | 락 | count |
|---|---|---|---|---|---|
| 1 | | `wait()` — 잠듦 | | 없음 | 0 |
| 2 | | | `wait()` — 잠듦 | 없음 | 0 |
| 3 | 락 잡고 넣음 | | | P | 1 |
| 4 | `notify_all()`, 락 놓음 | 깨어남(락 없음) | 깨어남(락 없음) | 없음 | 1 |
| 5 | | | | | |
| 6 | | | | | |

- [ ] 스텝 5·6에서 C1과 C2가 차례로 락을 잡는다. 각자 `count`는 얼마인가
- [ ] 둘 중 하나는 무엇을 꺼내게 되는가
- [ ] `while`로 감쌌다면 스텝 6이 어떻게 달라지는가
:::

::: answer
| 스텝 | 생산자 P | 소비자 C1 | 소비자 C2 | 락 | count |
|---|---|---|---|---|---|
| 1 | | `wait()` — 잠듦 | | 없음 | 0 |
| 2 | | | `wait()` — 잠듦 | 없음 | 0 |
| 3 | 락 잡고 넣음 | | | P | 1 |
| 4 | `notify_all()`, 락 놓음 | 깨어남(락 없음) | 깨어남(락 없음) | 없음 | 1 |
| 5 | | 락 잡음 → 꺼냄, 락 놓음 | | 없음 | **0** |
| 6 | | | 락 잡음 → **빈 큐에서 꺼냄** | C2 | **-1** |

C1이 먼저 락을 잡아 유일한 항목을 가져간다. C2가 깨어난 이유는 그 사이에 사라졌지만, `if`로 짠 C2는 그 사실을 확인하지 않는다. Python이라면 `IndexError`, C++이라면 빈 컨테이너에서 꺼내는 **미정의 동작**이다. `count`가 음수로 내려가면 그다음부터는 "빈 큐가 가득 차 보이는" 상태가 된다.

`while`이면 스텝 6에서 C2는 `count == 0`을 보고 **다시 잠든다.** 헛걸음 한 번을 하고 끝이다. 그 헛걸음이 `notify_all`의 비용이고, 대기자가 많을 때 `notify_one`을 쓰는 이유다([XI-3](#/xi-3)의 천둥 소리 무리).

**여기서 깨어난 것은 `notify_all` 때문이다. 가짜 깨움도 정확히 같은 모양으로 나타난다** — 아무도 통지하지 않았는데 `wait`이 돌아온다. 그래서 두 문제의 해법이 하나다.
:::

이제 재현한다. 소비자 셋(코어 4)이 100회 반복하며, 빈 큐를 만난 회차가 있었는지를 찍는다.

::: dual
```python title="if 로 감싼 대기와 while 로 감싼 대기"
import threading
import time

ROUNDS, ITEMS, NCONS, GAP = 100, 100, 3, 0.0002    # 소비자 3 / 코어 4


def one_round(recheck):
    box, done, bad = [], [False], [0]
    cv = threading.Condition()

    def producer():
        for i in range(ITEMS):
            time.sleep(GAP)
            with cv:
                box.append(i)
                cv.notify_all()        # 대기자 전원을 깨운다. 일감은 하나뿐이다
        with cv:
            done[0] = True
            cv.notify_all()

    def consumer():
        while True:
            with cv:
                if recheck:
                    while not box and not done[0]:
                        cv.wait()      # 깨어날 때마다 조건을 다시 본다
                else:
                    if not box and not done[0]:
                        cv.wait()      # 깨어났으면 조건이 참이라고 믿는다
                if not box:
                    if done[0]:
                        return
                    bad[0] += 1        # 조건이 거짓인데 여기까지 왔다
                    continue
                box.pop()

    ts = [threading.Thread(target=consumer) for _ in range(NCONS)]
    p = threading.Thread(target=producer)
    for t in ts:
        t.start()
    p.start()
    p.join()
    for t in ts:
        t.join()
    return bad[0]


def survey(recheck, label):
    rounds_bad = sum(1 for _ in range(ROUNDS) if one_round(recheck))
    print(f"{label}: {ROUNDS}회 중 빈 큐를 만난 회차 {'있음' if rounds_bad else '없음'}")


print(f"소비자 {NCONS} / 코어 4 / 항목 {ITEMS}개 / {ROUNDS}회 반복")
survey(False, "if    로 감싼 대기")
survey(True, "while 로 감싼 대기")
```
```cpp title="if 로 감싼 대기와 while 로 감싼 대기"
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int ROUNDS = 100, ITEMS = 100, NCONS = 3;    // 소비자 3 / 코어 4
const auto GAP = chrono::microseconds(200);

int one_round(bool recheck) {
    deque<int> box;
    bool done = false;
    int bad = 0;
    mutex mu;
    condition_variable cv;

    auto producer = [&] {
        for (int i = 0; i < ITEMS; i++) {
            this_thread::sleep_for(GAP);
            { lock_guard<mutex> g(mu); box.push_back(i); }
            cv.notify_all();          // 대기자 전원을 깨운다. 일감은 하나뿐이다
        }
        { lock_guard<mutex> g(mu); done = true; }
        cv.notify_all();
    };

    auto consumer = [&] {
        for (;;) {
            unique_lock<mutex> lk(mu);
            if (recheck) {
                while (box.empty() && !done)
                    cv.wait(lk);      // 깨어날 때마다 조건을 다시 본다
            } else {
                if (box.empty() && !done)
                    cv.wait(lk);      // 깨어났으면 조건이 참이라고 믿는다
            }
            if (box.empty()) {
                if (done) return;
                bad += 1;             // 조건이 거짓인데 여기까지 왔다
                continue;
            }
            box.pop_back();
        }
    };

    vector<thread> ts;
    for (int k = 0; k < NCONS; k++) ts.emplace_back(consumer);
    thread p(producer);
    p.join();
    for (auto& t : ts) t.join();
    return bad;
}

void survey(bool recheck, const char* label) {
    int rounds_bad = 0;
    for (int r = 0; r < ROUNDS; r++) rounds_bad += (one_round(recheck) != 0);
    printf("%s: %d회 중 빈 큐를 만난 회차 %s\n", label, ROUNDS, rounds_bad ? "있음" : "없음");
}

int main() {
    printf("소비자 %d / 코어 4 / 항목 %d개 / %d회 반복\n", NCONS, ITEMS, ROUNDS);
    survey(false, "if    로 감싼 대기");
    survey(true, "while 로 감싼 대기");
    return 0;
}
```
:::

**복잡도:** 항목 하나를 옮기는 데 드는 시간은 여전히 $O(1)$이다. 달라지는 것은 헛걸음의 수다 — 대기자 $k$명에게 `notify_all`을 걸면 $k-1$명이 깨어나 확인하고 다시 잔다. 항목 $n$개에 대해 $O(nk)$번의 문맥 전환이 헛돌고, 그것이 `notify_one`으로 바꿔야 하는 이유다.

```console
소비자 3 / 코어 4 / 항목 100개 / 100회 반복
if    로 감싼 대기: 100회 중 빈 큐를 만난 회차 있음
while 로 감싼 대기: 100회 중 빈 큐를 만난 회차 없음
```

두 언어의 출력이 같다. **`if` 판은 100회 중 100회 터진다.** 항목 200개·200회로 늘려 실제 횟수를 세면 양쪽 다 **200회 전부**에서 실패하고, 한 실행에서 빈 큐를 만난 총 횟수는 Python 7.0만~7.9만, C++ 8.0만 안팎이다(4회 실행. `tools/bench/bounded_queue_if_vs_while.py`와 `.cpp`). 총 횟수는 실행마다 흔들리므로 지면의 출력에는 "있음/없음"만 남긴다 — **재현되는 사실은 "언제나 터진다"이지 특정 숫자가 아니다.**

::: warn
같은 실험에서 생산 간격을 0으로 두면 — 즉 생산자가 쉬지 않고 밀어 넣으면 — **Python의 `if` 판은 200회 중 0회 실패한다**(4회 실행 전부). 큐가 빌 틈이 없기 때문이다. C++은 그래도 200회 중 190회 안팎에서 터진다. 소비자 셋이 진짜로 병렬이라 큐를 즉시 비우기 때문이다.

`if`로 짠 코드는 이렇게 **부하가 낮으면 통과하고 부하가 오르면 터진다.** 단위 시험이 통과했다는 것은 근거가 아니다.
:::

::: pitfall
- **`wait`을 `if`로 감싼다.** 위 실험 그대로다. 술어 형태(`cv.wait(lk, 술어)`, `cond.wait_for(술어)`)를 쓰면 실수할 자리가 없어진다.
- **락 밖에서 상태를 바꾸고 통지한다.** 통지가 상대의 조건 확인과 대기 진입 사이로 들어가면 그 통지는 사라진다([XI-3](#/xi-3) §4.2).
- **조건변수 하나로 두 조건을 겸한다.** "가득"과 "빔"을 한 조건변수로 처리하면 `notify_all`을 쓸 수밖에 없고, 생산자를 깨워야 할 때 소비자를 깨운다. 최악의 경우 깨어난 쪽이 전부 다시 자면서 **교착**이 된다.
- **독약을 하나만 넣는다.** 소비자 $n$명 중 하나만 끝난다. 나머지는 영원히 대기한다.
- **생산자가 끝나기 전에 독약을 넣는다.** 독약도 큐를 지나므로 순서가 지켜진다. 반대로 `join` 전에 넣으면 아직 안 온 데이터 앞에 종료 표식이 끼어 데이터가 버려진다.
- **소비자 스레드를 강제로 죽이려 한다.** Python에는 그 수단이 없고, C++에서 `pthread_cancel`은 락을 쥔 채 죽을 수 있어 더 나쁘다. 끝내는 방법은 **협조적 종료**뿐이다.
:::

### 4.3 소비자를 늘리면 빨라지는가 — GIL이 가르는 갈림길

소비자를 셋으로 늘렸다. 그러면 세 배 빨라지는가. **소비자가 무슨 일을 하느냐에 따라 답이 정반대다.**

::: perf
같은 유계 큐에 작업 48건을 넣고 소비자 스레드를 1 → 2 → 4로 늘렸다(코어 4). 작업은 두 종류다 — 순수 산술 루프(CPU 바운드)와 `sleep`(I/O 바운드).

| 작업 종류 | 소비자 1 | 소비자 2 | 소비자 4 | 소비자 4의 가속 |
|---|---|---|---|---|
| Python · CPU 바운드 | 0.21초 | 0.21초 | 0.22초 | **0.94배 — 오히려 느려진다** |
| Python · I/O 바운드 | 0.97초 | 0.49초 | 0.24초 | **4.0배** |
| Python · CPU 바운드, `multiprocessing` | 0.22초 | 0.12초 | 0.064초 | **3.4배** |
| C++ · CPU 바운드 | 0.24초 | 0.12초 | 0.064초 | **3.7배** |

> (Linux x86-64 / CPython 3.13.12 / g++ 13 `-O2` 실측, 5회 실행의 중앙값을 두 번 재실행. `sys._is_gil_enabled()`가 `True` — 이 빌드는 GIL이 켜져 있다. 측정 스크립트는 `tools/bench/bounded_queue_gil.py` 와 `.cpp` 다.)

**CPython의 GIL은 한 번에 한 스레드만 바이트코드를 실행시킨다.** 그래서 CPU 바운드 소비자는 넷으로 늘려도 총 처리 시간이 그대로이고, 문맥 전환과 GIL 경합이 붙어 오히려 6% 느려졌다.

I/O 바운드는 반대다. `sleep`이나 소켓 대기에 들어가는 순간 GIL이 풀리므로 다른 소비자가 그 자리를 쓴다. 코어 4에서 소비자 4가 정확히 4.0배다 — 코어를 쓴 것이 아니라 **기다리는 시간을 겹친 것**이다.
:::

그래서 Python에서 유계 큐를 쓸 때의 판단은 이렇게 갈린다.

| 소비자가 하는 일 | Python의 답 |
|---|---|
| 네트워크·디스크·`sleep` 대기 | `threading` + 유계 큐. 위 표의 4.0배가 그대로 나온다 |
| 대기가 많고 연결이 수천 개 | `asyncio`. 스레드 하나에 코루틴 수천 개가 붙는다. 큐는 `asyncio.Queue` |
| 순수 계산 | **`multiprocessing`.** 프로세스마다 인터프리터가 따로라 GIL이 갈린다. 대가는 큐를 지나는 데이터가 직렬화된다는 것이다 |

C++에는 이 분기가 없다. 스레드가 곧 코어이므로 CPU 바운드에서 3.7배가 나온다. **같은 자료구조, 같은 코드 구조인데 언어에 따라 "스레드를 늘리는 것"의 의미가 다르다.**

## 5. 어디에 쓰이는가

**로그 수집기가 이 구조의 전형이다.** 애플리케이션이 로그를 유계 큐에 넣고, 전송 스레드가 꺼내 원격으로 보낸다. 수집 서버가 느려지면 큐가 차고, 그때 무엇을 할지가 곧 제품의 성격이다. 로그를 버리면 장애 순간의 기록을 잃고, 막으면 **애플리케이션 자체가 로그 때문에 느려진다.** 이 선택을 미룬 시스템은 장애가 났을 때 둘 다 한다 — 느려지다가 결국 버린다.

**제어 루프와 통신 스레드의 분리가 §1의 상황이다.** 제어 쪽은 절대 막히면 안 되므로 큐가 가득 차면 **막지 않고 버리거나 덮어쓴다.** 유계 큐에 "막기"만 있는 것이 아니라는 점이 여기서 중요하다 — 상류가 실시간 마감을 가진 쪽이면 배압을 걸 대상이 없다. 그때는 XI-1의 덮어쓰기로 돌아간다.

**웹 서버의 요청 큐도 같은 자료구조다.** 수신 스레드가 연결을 큐에 넣고 워커 풀이 꺼낸다([XI-4](#/xi-4)). 큐 길이를 무한으로 두면 과부하일 때 **응답이 오지 않는 요청이 큐에 쌓여** 메모리와 지연이 함께 터진다. 유계로 두면 넘칠 때 즉시 거절할 수 있고, 클라이언트는 빨리 실패해 재시도할 수 있다. **빨리 거절하는 것이 늦게 실패하는 것보다 낫다**는 원칙이 큐 길이 하나로 표현된다.

**그 "막기"가 상류로 퍼지는 것이 배압이다.** 유계 큐는 배압의 최소 단위이고, 그것을 파이프라인 전체로 확장하면 [XI-7 이벤트 루프와 백프레셔](#/xi-7)가 된다.

## 6. 무엇을 고를 것인가

| 상황 | 선택 |
|---|---|
| 소비자가 잠깐씩 없을 때만 논다 | 조건변수. 기본값이다 |
| 대기 시간이 수백 나노초 단위로 짧고 코어가 남는다 | 짧은 회전 뒤 조건변수(하이브리드). 회전만 두지는 않는다 |
| 실시간 마감이 있는 생산자 | 막지 않는다. 덮어쓰기나 버리기([XI-1](#/xi-1)) |
| 생산자 하나·소비자 하나이고 락도 아깝다 | SPSC 락프리 링([XI-3](#/xi-3)). 대신 대기 방법은 직접 정해야 한다 |
| Python에서 소비자가 계산을 한다 | `multiprocessing`. 스레드로는 안 빨라진다 |
| 종료가 필요하다 | 독약. 소비자 수만큼 |

::: interview
**"큐가 비었을 때 소비자는 무엇을 합니까."**
회전하면 코어를 태운다는 것부터 말하고 수치를 붙이면 끝난다 — CPU 점유율 101% 대 5%. 그다음이 조건변수의 세 짝(상태 + 락 + 조건변수)이고, 마지막이 "회전이 정당한 경우는 대기가 문맥 전환 비용보다 짧을 때뿐"이다.

**"왜 `while`로 감쌉니까. `if`면 안 됩니까."**
가짜 깨움만 말하면 절반이다. 실제로 훨씬 자주 일어나는 것은 **통지 도둑질**이다 — `notify_all`로 셋이 깨어나도 항목은 하나다. 그리고 통지 시점과 락 획득 시점이 다르다는 것까지 말하면 완성이다. 위 실험에서 `if` 판은 100회 중 100회 터졌고, 생산 간격을 0으로 두면 Python에서는 0회 터졌다 — **부하가 낮으면 숨는다**는 것이 이 질문의 진짜 요점이다.

**"큐 길이를 무한으로 두면 안 됩니까."**
안 된다. 무한 큐는 배압을 없애는 것이 아니라 **문제를 메모리와 지연으로 바꾸는 것**이다. 소비가 느리면 큐가 자라고 지연이 자란다. 응답 시간이 이미 무의미해진 요청을 계속 붙들고 있게 된다. 유계로 두면 그 순간에 결정을 강제당한다 — 거절할 것인가, 상류를 막을 것인가.
:::

## 연습

::: quiz
설계를 답한다. 각 상황에서 ① 상황 ② 무엇이 경쟁하거나 밀리는가 ③ 어떤 구조이고 대가는 무엇인가를 순서대로 쓴다.

**1. 이미지 처리 파이프라인**
- 상황: 카메라 스레드가 30 fps로 프레임을 만들고, 처리 스레드 넷(코어 4)이 꺼내 처리한다. 한 프레임 처리에 평균 100 ms가 걸린다.
- 밀리는 것: 생산 30 fps, 소비 40 fps(넷이 각 10 fps). 평균으로는 여유가 있으므로 유계 큐가 요동을 흡수한다.
- 구조와 대가: 유계 큐 + 조건변수, 용량은 최악의 지연 시간 × 30. 소비자가 넷이므로 `notify_one`을 쓰고 대기는 `while`로 감싼다. Python이라면 처리가 CPU 바운드이므로 스레드로는 40 fps가 안 나온다 — `multiprocessing`으로 가야 하고, 그 대가로 프레임이 직렬화된다.

**2. 감사 로그**
- 상황: 금융 거래 감사 로그를 파일에 남긴다. 한 줄도 잃으면 안 된다.
- 밀리는 것: 디스크 쓰기가 순간적으로 느려지면 큐가 찬다.
- 구조와 대가: 유계 큐 + 막기. 유실이 허용되지 않으므로 다른 정책은 후보가 아니다. 대가는 거래 처리 자체가 느려지는 것이고, **그 느려짐이 어디까지 전파돼도 되는지를 미리 정해야 한다.** 정하지 않으면 장애 시에 결정이 저절로 내려진다.

**3. 소비자가 죽었다**
- 상황: 소비자 스레드가 예외로 죽었는데 생산자는 계속 넣는다.
- 밀리는 것: 큐가 가득 차고 생산자가 `not_full.wait()`에서 영원히 잠든다. 아무도 통지해 줄 사람이 없다.
- 구조와 대가: 대기에 타임아웃을 두고, 깨어나면 소비자 생존을 확인한다. 또는 소비자가 죽을 때 `done` 플래그를 세우고 `notify_all`을 거는 것을 예외 처리 경로에 넣는다. 대가는 코드가 늘고, 타임아웃 값이 또 하나의 튜닝 손잡이가 된다는 것이다.

**4. 우선순위가 있는 작업**
- 상황: 긴급 명령과 일반 명령이 같은 큐로 들어온다. 긴급이 먼저 처리돼야 한다.
- 밀리는 것: 링 버퍼는 FIFO다. 뒤에 온 긴급 명령이 앞의 일반 명령 뒤에서 기다린다.
- 구조와 대가: 힙([II-8](#/ii-8))을 큐 자리에 놓고 같은 락·조건변수를 쓴다. 대가는 두 가지다 — `put`이 $O(\log n)$이 되고, **일반 명령이 영원히 밀릴 수 있다.** 굶주림을 막으려면 대기 시간을 우선순위에 섞어야 한다([XI-5](#/xi-5)).
:::

## 요약

- 유계 큐는 **링 버퍼([XI-1](#/xi-1)) + 락 하나 + 조건변수 둘**이다. 자료구조는 그대로고, 두 스레드가 공유하는 순간 "기다리는 방법"이 추가된다.
- 바쁜 대기는 아무 일도 안 하면서 코어를 태운다. 실측 CPU 점유율이 **101% 대 5%**이고, Python에서는 벽시계까지 3.4배 나빠진다.
- `wait`은 **락을 놓고 잠들었다가 락을 다시 잡고 돌아온다.** 이것을 모르면 첫 구현이 교착한다.
- 통지는 "확인해 보라"는 힌트다. 가짜 깨움·통지 도둑질·끼어들기 셋 때문에 대기는 **`while`로 감싼다.** `if`로 짠 판은 100회 중 100회 빈 큐를 만났다.
- **부하가 낮으면 그 버그가 숨는다.** 생산 간격을 0으로 두자 Python의 `if` 판은 200회 중 0회 터졌다.
- 종료는 **독약**으로 한다. 소비자가 $n$명이면 독약도 $n$개다. Python에는 스레드를 강제 종료할 수단이 아예 없다.
- **GIL이 갈림길을 만든다.** CPU 바운드 소비자는 넷으로 늘려도 0.94배(느려진다), I/O 바운드는 4.0배, `multiprocessing`은 3.4배다. C++은 같은 실험에서 3.7배다.
- 무한 큐는 배압을 없애지 않는다. 문제를 **메모리와 지연**으로 바꿀 뿐이다.

**다음 절**: [XI-3 락과 락프리](#/xi-3) — 이 절이 당연하게 쓴 락 자체를 연다. 무엇이 원자적인 단위이고, 락을 아예 없앨 수 있는 조건은 무엇인가.
