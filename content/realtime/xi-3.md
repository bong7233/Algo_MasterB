# XI-3 락과 락프리

::: lead
증가를 400만 번 시켰는데 200만이 나온다. 무엇이 깨진 것이고, 그것을 막는 도구들은 각각 무엇을 대가로 받는가.
:::

## 1. 문제

장비 상태를 세는 카운터가 하나 있다. 스레드 넷이 각자 100만 번씩 올린다. 기대값은 400만이다.

코어 4개짜리 기계에서 이 프로그램을 100번 돌리면 **86번은 틀린 답이 나온다.** 최종값의 중앙값은 200만이고, 최악의 회차는 56만이었다. 400만 중 344만이 사라진 것이다.

더 중요한 것은 나머지 14번이다. **그 14번은 정확히 400만이 나왔다.** 코드는 그대로이고 입력도 그대로인데 답이 갈린다.

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 측정 스크립트는 `tools/bench/xi3_lost_update.cpp`.)

==테스트가 통과하는 것은 근거가 아니다. 경쟁 상태는 부하가 낮을 때 숨는다.== 스레드가 둘이고 반복이 100번인 단위 시험은 이 버그를 절대 못 잡는다. 그리고 현장에서는 부하가 높을 때 터진다.

Python 도 안전지대가 아니다. 같은 실험을 CPython 3.13(GIL 켜짐, `sys._is_gil_enabled()` 가 `True`)에서 하면 결과가 두 갈래로 갈린다.

| 판 | 100회 중 유실 | 유실률 중앙값 |
|---|---|---|
| 전역 정수에 `counter += 1` | 0회 | 0% |
| 읽기와 쓰기 사이에 함수 호출이 하나 | **80회** | 13% (범위 0 ~ 73%) |
| 위와 같되 `sys.setswitchinterval(1e-4)` | **100회** | 55% |
| 위와 같되 락을 걸었을 때 | 0회 | 0% |

첫 줄만 보고 "GIL 이 지켜 준다"고 결론 내리는 것이 실무에서 가장 흔한 사고다. 둘째 줄이 같은 프로그램이다. 읽기와 쓰기 사이에 **함수 호출 하나**가 끼었을 뿐인데 100번 중 80번 틀린다. 그리고 실제 코드에서 읽기와 쓰기 사이에는 거의 항상 무언가가 있다 — 계산 함수, 로깅, 검증.

셋째 줄이 이 절의 두 번째 명제다. 스위치가 잦을수록 유실률이 올라간다. 뒤집으면, **스위치가 드문 환경에서는 같은 버그가 조용히 있다가 부하가 오르면 터진다.** 드물게 터지는 것이 자주 터지는 것보다 위험하다. 자주 터지면 개발 중에 잡히기 때문이다.

## 2. 아이디어

### 2.1 한 걸음처럼 보이는 것이 세 걸음이다

`counter += 1` 은 소스에서 한 줄이다. 기계에서는 아니다.

```text nolines
LOAD    counter -> reg      # 읽는다
ADD     reg + 1  -> reg     # 고친다
STORE   reg -> counter      # 쓴다
```

이 셋 사이 어디에서든 다른 스레드가 끼어들 수 있다. 둘 다 0을 읽고, 둘 다 1을 만들고, 둘 다 1을 쓰면 증가는 두 번인데 결과는 1이다. 이것이 **잃어버린 갱신(lost update)** 이다. 읽고-고치고-쓰기(read-modify-write)를 하는 모든 연산이 같은 병을 앓는다. 증가, 최댓값 갱신, "없으면 넣기", 참조 계수, 잔액 이체 전부 해당한다.

Python 에서도 그대로다. 바이트코드를 직접 보면 된다.

```text nolines
LOAD_GLOBAL     counter
LOAD_CONST      1
BINARY_OP       13 (+=)
STORE_GLOBAL    counter
```

네 개의 바이트코드다. GIL 은 **바이트코드 하나**의 실행 중에 다른 스레드가 끼어들지 않는 것만 보장한다. 네 개가 한 덩어리라는 보장은 어디에도 없다.

::: deep
그렇다면 위 표의 첫 줄은 왜 한 번도 안 틀렸을까. CPython 은 스레드 전환 여부를 **모든 바이트코드 경계에서 검사하지 않는다.** 루프의 뒤로 가는 점프와 함수 진입 같은 특정 지점에서만 검사한다. `counter += 1` 네 개는 그 지점 사이에 통째로 들어가므로 실제로는 갈라지지 않는다.

이것은 **보장이 아니라 지금 이 구현의 부작용이다.** 언어 명세는 `+=` 의 원자성을 약속한 적이 없고, 함수 호출 하나만 끼어도(호출 진입이 검사 지점이다) 위 표의 둘째 줄이 된다. 구현 세부에 기대어 락을 생략한 코드는 인터프리터 판올림 한 번에 무너진다.
:::

### 2.2 처방은 셋뿐이다

| 처방 | 무엇을 보장하나 | 대가 |
|---|---|---|
| **상호배제**(뮤텍스) | 임계 구역에 한 번에 하나만 | 대기. 경합하면 줄이 길어지고, 임계 구역이 길면 그만큼 다 같이 선다 |
| **원자적 연산**(atomic) | 읽고-고치고-쓰기가 명령 하나 | 한 변수 단위로만 성립. 두 변수를 함께 바꾸는 것은 못 한다 |
| **소유권 분리** | 애초에 공유하지 않음 | 설계를 바꿔야 한다. 되기만 하면 가장 싸다 |

셋째가 이 절의 뒤쪽 절반이다. 두 스레드가 같은 변수를 쓰기 때문에 문제가 생겼다면, **각 변수의 쓰는 쪽을 하나로 만들면** 문제 자체가 없어진다. SPSC 락프리 큐가 정확히 그 설계다.

```text nolines
  (a) mutual exclusion         (b) atomic op          (c) single writer
      T1 --\                       T1 --\                 T1(w) --> [head]
            [ lock ] -- data             [ lock xadd ]           \
      T2 --/    ^                   T2 --/    ^                   [ ring ]
                |                             |                  /
       one at a time                one instruction        T2(r) --> [tail]
```

(a)는 문 하나를 두고 줄을 세운다. (b)는 문을 없애는 대신 연산 하나만 쪼개지지 않게 만든다. (c)는 줄 설 일 자체를 없앤다 — `head` 는 생산자만 쓰고 `tail` 은 소비자만 쓰므로, 두 값 모두 쓰는 쪽이 하나다.

### 2.3 기다림은 따로 다뤄야 한다

"조건이 만족될 때까지 기다린다"는 상호배제와 다른 문제다. 락은 **지금 당장** 자리를 비켜 달라는 것이고, 대기는 **다른 스레드가 상태를 바꿔 줄 때까지** 있는 것이다.

락만 가지고 기다리면 이렇게 된다.

```text nolines
  while (!ready) { }        # <- spin: burns a core doing nothing
```

이 루프는 코어 하나를 100% 태운다. 코어가 4개인 기계에서 스핀 대기가 둘이면 실제 작업에 남는 코어는 둘이다. **조건변수**는 그 자리에서 스레드를 재우고, 조건이 바뀐 쪽이 깨운다. 잠든 스레드는 코어를 쓰지 않는다.

대신 규율이 하나 붙는다. 조건변수는 **신호를 저장하지 않는다.** 아무도 기다리지 않을 때 온 통지는 그냥 사라진다. 그래서 조건변수는 언제나 "상태 + 락 + 조건변수" 세 짝으로 쓴다. 기다리는 쪽은 신호가 아니라 **상태**를 확인해야 한다. 4.2에서 이것을 어긴 판이 실제로 어떻게 멈추는지 본다.

## 3. 손으로 따라가기

::: trace
스레드 A와 B가 각각 `counter += 1` 을 **한 번씩** 한다. 시작값은 `counter = 0`, 기대값은 2다.
한 번의 증가는 세 걸음이다 — `LOAD`(counter 를 자기 레지스터로), `ADD`(자기 레지스터에서 +1), `STORE`(자기 레지스터를 counter 로).

아래 표를 6스텝까지 이어서 채워 **최종 `counter` 가 1이 되는 순서**를 만들어라. 그리고 세 걸음 전체를 락으로 감쌌다면 왜 그 순서가 불가능한지 한 줄로 답하라.

| 스텝 | 스레드 A | 스레드 B | A의 레지스터 | B의 레지스터 | counter |
|---|---|---|---|---|---|
| 1 | LOAD (0) | | 0 | - | 0 |
| 2 | | LOAD (0) | 0 | 0 | 0 |
| 3 | ADD → 1 | | 1 | 0 | 0 |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
:::

::: answer

| 스텝 | 스레드 A | 스레드 B | A의 레지스터 | B의 레지스터 | counter |
|---|---|---|---|---|---|
| 1 | LOAD (0) | | 0 | - | 0 |
| 2 | | LOAD (0) | 0 | 0 | 0 |
| 3 | ADD → 1 | | 1 | 0 | 0 |
| 4 | | ADD → 1 | 1 | 1 | 0 |
| 5 | STORE 1 | | 1 | 1 | **1** |
| 6 | | STORE 1 | 1 | 1 | **1** |

증가가 두 번 일어났는데 `counter` 는 1이다. B가 스텝 2에서 읽은 0은 스텝 6에서 쓰는 순간 이미 낡은 값이다. **B는 자기가 낡은 값을 들고 있다는 사실을 알 방법이 없다.**

핵심은 스텝 2다. A가 LOAD 와 STORE 사이에 있는 동안 B가 같은 값을 읽었다. 세 걸음을 락으로 감싸면 B의 LOAD 는 A의 STORE 뒤로 밀린다 — **A가 락을 놓기 전까지 B는 스텝 2를 시작하지 못한다.** 그래서 B는 반드시 1을 읽고 2를 쓴다.

같은 이유로 스텝 5와 6의 순서를 바꿔도 결과는 1이다. 어느 쪽이 마지막에 쓰든 둘 다 1을 쓰기 때문이다. 이것이 "마지막 쓰기가 이긴다(last write wins)"의 정체이고, 유실이 **한 번에 하나씩**이 아니라 뭉텅이로 나는 이유이기도 하다. 스레드가 오래 낡은 값을 들고 있으면 그동안의 증가가 통째로 사라진다.
:::

## 4. 구현

### 4.1 뮤텍스 — 세 걸음을 한 덩어리로 묶는다

세 판을 나란히 돌린다. 순수 `+=`, 읽기와 쓰기 사이에 함수 호출이 낀 판, 그리고 락을 건 판이다. 각 판을 20회 반복해 한 번이라도 유실이 나면 "있음"으로 찍는다.

::: dual
```python title="잃어버린 갱신 — 락 없는 판과 락을 건 판"
import threading

N_THREADS, N_EACH, ROUNDS = 4, 50000, 20      # 코어 4개짜리 기계
EXPECT = N_THREADS * N_EACH
counter = 0
lock = threading.Lock()
go = threading.Event()                        # 네 스레드를 같은 순간에 출발시킨다


def add_one(v):
    return v + 1


def bump_bare():
    go.wait()
    global counter
    for _ in range(N_EACH):
        counter += 1                          # LOAD / ADD / STORE 세 걸음


def bump_call():
    go.wait()
    global counter
    for _ in range(N_EACH):
        tmp = counter                         # ❌ 읽기
        counter = add_one(tmp)                # ❌ 함수 호출을 지나 쓰기


def bump_locked():
    go.wait()
    global counter
    for _ in range(N_EACH):
        with lock:                            # ✅ 세 걸음을 한 덩어리로 묶는다
            tmp = counter
            counter = add_one(tmp)


def race(job):
    global counter
    lost = 0
    for _ in range(ROUNDS):
        counter = 0
        go.clear()
        ts = [threading.Thread(target=job) for _ in range(N_THREADS)]
        for t in ts:
            t.start()
        go.set()
        for t in ts:
            t.join()
        if counter != EXPECT:
            lost += 1
    return lost


for label, job in (("순수 +=        ", bump_bare),
                   ("함수 호출 낀 판", bump_call),
                   ("락을 건 판     ", bump_locked)):
    print(f"{label}: {ROUNDS}회 중 유실 {'있음' if race(job) else '없음'}")
```
```cpp title="잃어버린 갱신 — 락 없는 판과 락을 건 판"
#include <atomic>
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int N_THREADS = 4, N_EACH = 500000, ROUNDS = 20;   // 코어 4개짜리 기계
const long long EXPECT = (long long)N_THREADS * N_EACH;
volatile long long counter = 0;    // volatile — 컴파일러가 루프를 접지 못하게 한다
mutex lock_;
atomic<bool> go{false};            // 네 스레드를 같은 순간에 출발시킨다

long long add_one(long long v) {
    return v + 1;
}

void wait_go() {
    while (!go.load()) this_thread::yield();
}

void bump_bare() {
    wait_go();
    for (int i = 0; i < N_EACH; i++)
        counter = counter + 1;                 // 읽기 / 더하기 / 쓰기 세 걸음
}

void bump_call() {
    wait_go();
    for (int i = 0; i < N_EACH; i++) {
        long long tmp = counter;               // ❌ 읽기
        counter = add_one(tmp);                // ❌ 함수 호출을 지나 쓰기
    }
}

void bump_locked() {
    wait_go();
    for (int i = 0; i < N_EACH; i++) {
        lock_guard<mutex> g(lock_);            // ✅ 세 걸음을 한 덩어리로 묶는다
        long long tmp = counter;
        counter = add_one(tmp);
    }
}

int race(void (*job)()) {
    int lost = 0;
    for (int r = 0; r < ROUNDS; r++) {
        counter = 0;
        go.store(false);
        vector<thread> ts;
        for (int k = 0; k < N_THREADS; k++) ts.emplace_back(job);
        go.store(true);
        for (auto& t : ts) t.join();
        if (counter != EXPECT) lost++;
    }
    return lost;
}

int main() {
    printf("순수 +=        : %d회 중 유실 %s\n", ROUNDS, race(bump_bare) ? "있음" : "없음");
    printf("함수 호출 낀 판: %d회 중 유실 %s\n", ROUNDS, race(bump_call) ? "있음" : "없음");
    printf("락을 건 판     : %d회 중 유실 %s\n", ROUNDS, race(bump_locked) ? "있음" : "없음");
    return 0;
}
```
:::

**복잡도:** 시간은 두 판 모두 증가 횟수에 비례해 $O(n)$이다. 갈리는 것은 상수다 — 락을 잡고 놓는 데 경합이 없으면 21 ns, 코어 4개가 같은 락을 두고 다투면 58 ns가 든다(4.3의 표). 즉 **경합 하에서 처리량은 코어 수에 비례해 늘지 않고 락 하나가 상한이 된다.** 공간은 락 하나당 $O(1)$.

두 언어의 출력은 **한 줄만 다르다.**

```console title="Python 출력"
순수 +=        : 20회 중 유실 없음
함수 호출 낀 판: 20회 중 유실 있음
락을 건 판     : 20회 중 유실 없음
```

```console title="C++ 출력"
순수 +=        : 20회 중 유실 있음
함수 호출 낀 판: 20회 중 유실 있음
락을 건 판     : 20회 중 유실 없음
```

| 언어 차이 | Python | C++ |
|---|---|---|
| 순수 `+=` 의 결과 | 유실 없음. 네 바이트코드 사이에 전환 검사 지점이 없어서일 뿐 보장이 아니다 | 유실 있음. 진짜 병렬이라 그대로 겹친다 |
| 병렬성 | GIL — 한 번에 한 스레드만 바이트코드를 실행한다 | 코어 수만큼 진짜로 동시에 돈다 |
| 원자성 | 바이트코드 단위. `x += 1` 은 원자적이 **아니다** | `std::atomic` 을 써야 원자적이다 |
| 락 | `threading.Lock`(재진입 아님), `threading.RLock`(재진입) | `std::mutex`, `std::recursive_mutex` |
| 락 해제 | `with` 블록을 벗어날 때 | `lock_guard` 소멸자에서. 예외로 빠져나가도 풀린다 |
| 반복 횟수 | 5만 | 50만 — 한 걸음이 훨씬 빨라 같은 시간을 만들려면 열 배가 필요하다 |
| 최적화 방해 장치 | 필요 없다 | `volatile` 이 필요했다. 이유는 아래 상자에 |

::: danger
C++ 판의 `volatile` 은 **동기화 도구가 아니다.** 그 자리에 있는 이유는 정반대다 — 그것이 없으면 시연 자체가 사라진다.

`-O2` 로 컴파일하면 평범한 `counter = counter + 1` 백만 번은 이렇게 접힌다.

```text nolines
addq    $1000000, counter(%rip)     # loop of 1,000,000 iterations, folded into one add
```

컴파일러는 **데이터 경쟁이 없다고 가정할 권리**가 있다. 다른 스레드가 이 변수를 만지지 않는다는 전제 아래 루프를 하나의 덧셈으로 접는 것이 정당하다. 그 전제를 깨는 코드는 정의되지 않은 동작(UB)이고, "때때로 틀린 값"이 아니라 "무엇이든 일어날 수 있음"이 된다.

그리고 `volatile` 을 붙이면 접히지는 않지만 **여전히 안전해지지 않는다.** `volatile` 은 매번 실제로 읽고 쓰라는 지시일 뿐, 원자성도 메모리 순서도 주지 않는다. 위 실측이 그 증거다 — `volatile` 판이 100회 중 86회 틀렸다. 스레드 간 공유에 `volatile` 을 쓰는 코드를 보면 그것은 이미 버그다. 필요한 것은 `std::atomic` 이거나 뮤텍스다.
:::

### 4.2 조건변수 — 신호가 아니라 상태를 기다린다

통지가 대기보다 **먼저** 일어나는 순서를 강제로 만든다. 상태를 보지 않고 신호만 기다리는 판과, 상태를 보는 판을 나란히 놓는다.

::: dual
```python title="조건변수 — 술어 없는 대기와 술어 있는 대기"
import threading

cond = threading.Condition()
ready = False                          # 조건변수가 지키는 상태. 반드시 락 아래에서 바꾼다


def producer():
    global ready
    with cond:
        ready = True                   # 소비자가 아직 대기에 들어가기도 전이다
        cond.notify()


def consumer_bare():
    with cond:
        return cond.wait(timeout=0.3)  # ❌ 상태를 보지 않고 신호만 기다린다


def consumer_pred():
    with cond:
        return cond.wait_for(lambda: ready, timeout=0.3)   # ✅ 상태를 본다


producer()                             # 통지가 대기보다 먼저 일어난다
print("술어 없는 대기:", "통과" if consumer_bare() else "신호를 놓쳐 타임아웃")
print("술어 있는 대기:", "통과" if consumer_pred() else "신호를 놓쳐 타임아웃")
```
```cpp title="조건변수 — 술어 없는 대기와 술어 있는 대기"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
using namespace std;

condition_variable cond;
mutex mtx;
bool ready = false;          // 조건변수가 지키는 상태. 반드시 락 아래에서 바꾼다

void producer() {
    {
        lock_guard<mutex> g(mtx);
        ready = true;        // 소비자가 아직 대기에 들어가기도 전이다
    }
    cond.notify_one();
}

bool consumer_bare() {
    unique_lock<mutex> lk(mtx);
    // ❌ 상태를 보지 않고 신호만 기다린다
    return cond.wait_for(lk, chrono::milliseconds(300)) == cv_status::no_timeout;
}

bool consumer_pred() {
    unique_lock<mutex> lk(mtx);
    // ✅ 상태를 본다
    return cond.wait_for(lk, chrono::milliseconds(300), [] { return ready; });
}

int main() {
    producer();              // 통지가 대기보다 먼저 일어난다
    cout << "술어 없는 대기: " << (consumer_bare() ? "통과" : "신호를 놓쳐 타임아웃") << "\n";
    cout << "술어 있는 대기: " << (consumer_pred() ? "통과" : "신호를 놓쳐 타임아웃") << "\n";
    return 0;
}
```
:::

```console
술어 없는 대기: 신호를 놓쳐 타임아웃
술어 있는 대기: 통과
```

**복잡도:** 대기와 통지 모두 $O(1)$이다. 다만 상수의 성격이 다르다 — 통지는 대기자 하나를 깨우는 시스템 호출이고, `notify_all` 은 대기자 $k$ 명을 전부 깨우므로 $O(k)$이며 그중 한 명만 조건을 만족하면 나머지 $k-1$은 깨어나 확인하고 다시 잔다(**천둥 소리 무리, thundering herd**). 공간은 대기 큐에 $O(k)$.

::: pitfall
- **`if` 로 대기를 감싼다.** 깨어났다는 사실이 조건이 참이라는 뜻은 아니다. 가짜 깨어남(spurious wakeup)이 표준상 허용되고, 통지와 락 획득 사이에 제3의 스레드가 조건을 되돌릴 수도 있다. **`while` 로 감싸거나 술어 형태를 써라.** 위 코드의 `wait_for(lk, 시간, 술어)` 와 `wait_for(술어, timeout=)` 이 그 `while` 을 대신 감아 주는 형태다.
- **락 없이 상태를 바꾸고 통지한다.** 통지가 상대의 상태 확인과 대기 진입 사이에 끼면 위 출력의 첫 줄이 된다. 상태 변경은 반드시 락 아래에서.
- **타임아웃 없이 기다린다.** 통지를 놓치면 영원히 멈춘다. 위 예제가 타임아웃을 쓰지 않았다면 출력 없이 교착했을 것이다.
- **`notify_one` 으로 충분한 자리에 `notify_all` 을 쓴다.** 안전한 쪽으로는 맞지만 대기자가 많으면 깨어나기-확인-다시 자기가 대량으로 일어난다. 반대로 대기자마다 기다리는 조건이 다르면 `notify_one` 은 **엉뚱한 한 명을 깨워** 교착을 만든다.
:::

### 4.3 원자적 연산과 CAS — C++ 전용

Python 에는 원자적 정수가 없다. 그래서 이 절은 C++ 만 다룬다. **그 사실 자체가 언어 차이다** — Python 에서 원자성이 필요하면 락을 쓰거나, C 레벨에서 이미 한 덩어리인 연산(`deque.append`, `dict.setdefault`, `itertools.count().__next__`)에 얹는 것뿐이다.

세 판을 비교한다. 원자적 변수를 읽고 쓰기만 한 순진한 판, `fetch_add`, 그리고 CAS 재시도 루프다.

```cpp title="원자적 연산 — 순진한 판, fetch_add, CAS 재시도"
#include <atomic>
#include <cstdio>
#include <thread>
#include <vector>
using namespace std;

const int N_THREADS = 4, N_EACH = 200000, ROUNDS = 20;   // 코어 4
const long long EXPECT = (long long)N_THREADS * N_EACH;
atomic<long long> total{0};

void naive() {
    for (int i = 0; i < N_EACH; i++) {
        long long cur = total.load();
        total.store(cur + 1);            // ❌ 읽기와 쓰기 사이에 남이 끼어든다
    }
}

void by_fetch_add() {
    for (int i = 0; i < N_EACH; i++)
        total.fetch_add(1);              // ✅ 읽기-더하기-쓰기가 명령 하나다
}

void by_cas() {
    for (int i = 0; i < N_EACH; i++) {
        long long cur = total.load();
        // ✅ cur 가 그대로일 때만 쓴다. 아니면 cur 에 최신값이 담겨 돌아오고 다시 시도한다
        while (!total.compare_exchange_weak(cur, cur + 1)) { }
    }
}

int race(void (*job)()) {
    int bad = 0;
    for (int r = 0; r < ROUNDS; r++) {
        total.store(0);
        vector<thread> ts;
        for (int k = 0; k < N_THREADS; k++) ts.emplace_back(job);
        for (auto& t : ts) t.join();
        if (total.load() != EXPECT) bad++;
    }
    return bad;
}

int main() {
    printf("순진한 판  : %d회 중 틀린 답 %s\n", ROUNDS, race(naive) ? "있음" : "없음");
    printf("fetch_add : %d회 중 틀린 답 %s\n", ROUNDS, race(by_fetch_add) ? "있음" : "없음");
    printf("CAS 재시도 : %d회 중 틀린 답 %s\n", ROUNDS, race(by_cas) ? "있음" : "없음");
    return 0;
}
```

```console
순진한 판  : 20회 중 틀린 답 있음
fetch_add : 20회 중 틀린 답 없음
CAS 재시도 : 20회 중 틀린 답 없음
```

첫 줄이 요점이다. **변수를 `atomic` 으로 바꾸는 것만으로는 아무것도 해결되지 않는다.** `load` 도 원자적이고 `store` 도 원자적이지만 둘 사이는 여전히 벌어져 있다. 원자적이어야 하는 것은 **연산 전체**다.

`fetch_add` 는 그 전체를 명령 하나로 만든다. 그러나 더하기가 아닌 갱신 — 최댓값 유지, 상태 전이, 조건부 교체 — 에는 전용 명령이 없다. 그때 쓰는 일반형이 **CAS(compare-and-swap)** 다. "내가 읽은 값이 아직 그대로면 새 값을 넣어라. 아니면 지금 값을 알려 달라"를 한 명령으로 한다. 실패하면 최신값을 받아 다시 계산하고 다시 시도한다.

::: note
`compare_exchange_weak` 은 값이 같은데도 **실패할 수 있다**(가짜 실패). 일부 프로세서에서 그 편이 훨씬 싸기 때문이다. 어차피 루프 안에서 재시도하므로 문제가 되지 않고, 루프가 없는 자리에서만 `compare_exchange_strong` 을 쓴다.

CAS 루프는 **락프리(lock-free)** 다. 어떤 스레드가 중간에 멈춰도 다른 스레드는 계속 전진한다. 락은 그렇지 않다 — 락을 쥔 스레드가 멈추면 전부 선다. 다만 락프리가 **대기 없음(wait-free)** 은 아니다. 경합이 심하면 특정 스레드의 CAS 가 계속 실패해 몇 번이고 다시 돌 수 있다.
:::

**복잡도:** `fetch_add` 는 시간 $O(1)$ — 명령 하나다. CAS 루프는 경합이 없으면 $O(1)$, 경합이 있으면 **기대 재시도 횟수만큼** 늘어난다. 상수는 실측으로만 말할 수 있다.

| 연산 (4코어 실측) | 중앙값 | 범위 |
|---|---|---|
| 평범한 변수에 저장 (경합 없음) | 0.3 ns | 0.3 ~ 0.3 |
| `atomic` relaxed 저장 | 0.3 ns | 0.3 ~ 0.3 |
| `atomic` release 저장 | 0.3 ns | 0.3 ~ 0.4 |
| `atomic` seq_cst 저장 | **5.5 ns** | 5.5 ~ 5.6 |
| 뮤텍스 증가, 1스레드(경합 없음) | 21 ns | 10 ~ 21 |
| 뮤텍스 증가, 4스레드 경합 | **58 ns** | 55 ~ 62 |
| `fetch_add` seq_cst, 4스레드 경합 | 13 ns | 10 ~ 15 |
| `fetch_add` relaxed, 4스레드 경합 | 14 ns | 12 ~ 15 |

> (Linux x86-64 / g++ 13 `-O2` 실측, 7회 실행. 측정 스크립트는 `tools/bench/xi3_atomic_cost.cpp`.)

읽을 것이 셋 있다. 첫째, **경합 없는 락은 싸다.** 21 ns 는 시스템 호출이 아니라 사용자 공간의 원자적 교환 한 번이다. "락은 느리다"는 통념은 경합할 때의 이야기다. 둘째, 경합하면 락이 원자적 연산의 4배가 된다. 셋째, **x86-64 에서 `fetch_add` 는 메모리 순서를 무엇으로 요구하든 값이 같다.** 이유는 다음 절에 있다.

### 4.4 메모리 순서 — 무엇이 재배치될 수 있는가

메모리 순서는 Python 에 노출되지 않는다. 이 절도 C++ 전용이다.

문제는 이것이다. 당신이 쓴 순서대로 다른 코어가 본다는 보장이 없다. 컴파일러는 명령을 옮기고, CPU 는 저장을 버퍼에 담아 두고 뒤의 읽기를 먼저 처리한다. **한 스레드 안에서는 결과가 같아 보이도록 유지되지만, 다른 스레드가 보는 순서는 달라진다.**

고전적인 리트머스 시험이 있다. `x` 와 `y` 는 0에서 시작한다.

```text nolines
  thread 1: x = 1;  a = y;
  thread 2: y = 1;  b = x;
```

종이 위에서 `(a, b) = (0, 0)` 은 불가능해 보인다. 어느 저장이 먼저 일어나든 뒤에 오는 읽기 중 하나는 1을 봐야 한다. 그런데 실제로는 일어난다.

```cpp title="메모리 순서 — 저장 버퍼가 만드는 (0, 0)"
#include <atomic>
#include <cstdio>
#include <thread>
using namespace std;

const int ROUNDS = 1000000;
atomic<int> x{0}, y{0};
atomic<int> turn{-1}, arrived{0};
int a = 0, b = 0;

template <memory_order MO>
void worker(int who) {
    for (int r = 0; r < ROUNDS; r++) {
        while (turn.load() != r) { }        // 두 스레드를 같은 라운드에 묶는다
        if (who == 0) { x.store(1, MO); a = y.load(MO); }
        else          { y.store(1, MO); b = x.load(MO); }
        arrived.fetch_add(1);
    }
}

template <memory_order MO>
int run() {
    turn.store(-1);
    arrived.store(0);
    thread t1(worker<MO>, 0), t2(worker<MO>, 1);
    int weird = 0;
    for (int r = 0; r < ROUNDS; r++) {
        x.store(0); y.store(0); arrived.store(0);
        turn.store(r);
        while (arrived.load() < 2) { }
        if (a == 0 && b == 0) weird++;      // 종이 위에서는 불가능한 결과
    }
    t1.join(); t2.join();
    return weird;
}

int main() {
    printf("relaxed: %d / %d 라운드에서 (0,0)\n", run<memory_order_relaxed>(), ROUNDS);
    printf("seq_cst: %d / %d 라운드에서 (0,0)\n", run<memory_order_seq_cst>(), ROUNDS);
    return 0;
}
```

100만 라운드를 5회 돌린 결과, `relaxed` 는 **중앙값 95%** 의 라운드에서 `(0, 0)` 을 만들었다(범위 45 ~ 98%). `seq_cst` 는 **5회 모두 0회**였다.

> (Linux x86-64 / g++ 13 `-O2` 실측. 측정 스크립트는 `tools/bench/xi3_memory_order.cpp`.)

원인은 저장 버퍼다. x86-64 의 코어는 저장을 곧바로 캐시에 반영하지 않고 자기 버퍼에 담아 둔 뒤, 그와 무관한 읽기를 먼저 처리한다(**StoreLoad 재배치**). 두 스레드 모두 그렇게 하면 서로의 저장을 못 보고 0을 읽는다. `seq_cst` 저장은 여기에 펜스를 넣어 버퍼를 비우게 만든다 — 4.3 표의 `0.3 ns` 대 `5.5 ns` 가 정확히 그 펜스의 값이다.

| 메모리 순서 | 무엇을 막는가 | 언제 쓰는가 |
|---|---|---|
| `relaxed` | 아무것도. 원자성만 준다 | 순서가 무의미한 카운터, 통계 |
| `acquire`(읽기) | 이 읽기 **뒤**의 접근이 앞으로 못 넘어온다 | 플래그를 읽고 나서 데이터를 읽을 때 |
| `release`(쓰기) | 이 쓰기 **앞**의 접근이 뒤로 못 밀린다 | 데이터를 다 쓰고 플래그를 세울 때 |
| `acq_rel` | 위 둘을 한 연산에서 | 읽고-고치고-쓰기 |
| `seq_cst` | 위 전부 + 모든 스레드가 **하나의 전역 순서**에 동의 | 기본값. 확신이 없으면 이것 |

실무에서 쓰는 것은 사실상 **release/acquire 짝** 하나다. 생산자가 데이터를 쓰고 마지막에 플래그를 `release` 로 세우면, 그 플래그를 `acquire` 로 읽은 소비자는 **플래그 앞에 쓰인 모든 것을 본다.** 4.5의 SPSC 큐가 이 짝 하나로 돌아간다.

::: warn
4.3의 표에서 `fetch_add` 의 relaxed 와 seq_cst 가 같았던 이유가 여기 있다. x86-64 는 원래 강한 순서를 지키는 구조라 읽기·쓰기·읽고-고치고-쓰기에 추가 명령이 거의 붙지 않는다. **그래서 x86 에서만 시험한 락프리 코드는 근거가 되지 않는다.** ARM 이나 RISC-V 는 순서가 훨씬 약해서, x86 에서 멀쩡하던 `relaxed` 코드가 거기서 깨진다. 순서를 아낀 대가는 다른 아키텍처에서 청구된다.
:::

### 4.5 SPSC 락프리 큐 — 쓰는 쪽을 하나로 만든다

이제 2.2의 세 번째 처방이다. 생산자 하나와 소비자 하나만 있는 큐라면 **락이 필요 없다.** 이유는 단 하나다.

> **불변식: `head` 는 생산자만 쓴다. `tail` 은 소비자만 쓴다. 상대의 것은 읽기만 한다.**

각 변수의 쓰는 쪽이 하나면 읽고-고치고-쓰기가 겹칠 수 없다. 잃어버린 갱신이 애초에 성립하지 않는다. 남는 문제는 **순서**뿐이다 — 값을 다 쓰기 전에 `head` 가 먼저 보이면 소비자가 쓰레기를 읽는다. 그것을 release/acquire 짝이 막는다.

::: dual
```python title="SPSC 락프리 큐 — 생산자 하나, 소비자 하나"
import threading
import time

CAP = 1024
N = 100000
buf = [0] * CAP
head = 0                    # 생산자만 쓴다
tail = 0                    # 소비자만 쓴다


def push(v):                # 생산자 전용
    global head
    nxt = (head + 1) % CAP
    if nxt == tail:         # 소비자의 tail 을 읽기만 한다
        return False        # 가득 참
    buf[head] = v
    head = nxt              # 값을 쓴 뒤에 head 를 옮긴다. 순서가 불변식이다
    return True


def pop():                  # 소비자 전용
    global tail
    if tail == head:        # 생산자의 head 를 읽기만 한다
        return None         # 비어 있음
    v = buf[tail]
    tail = (tail + 1) % CAP
    return v


def producer():
    for i in range(N):
        while not push(i):
            time.sleep(0)   # 가득 참 — 잠깐 양보한다


total = [0, 0]


def consumer():
    got, s = 0, 0
    while got < N:
        v = pop()
        if v is None:
            time.sleep(0)
            continue
        got += 1
        s += v
    total[0], total[1] = got, s


tp, tc = threading.Thread(target=producer), threading.Thread(target=consumer)
tp.start()
tc.start()
tp.join()
tc.join()
print(f"받은 개수 {total[0]} · 합계 {total[1]}")
```
```cpp title="SPSC 락프리 큐 — 생산자 하나, 소비자 하나"
#include <atomic>
#include <cstdio>
#include <thread>
using namespace std;

const int CAP = 1024;
const int N = 100000;
long long buf[CAP];
atomic<int> head{0};        // 생산자만 쓴다
atomic<int> tail{0};        // 소비자만 쓴다

bool push(long long v) {    // 생산자 전용
    int h = head.load(memory_order_relaxed);
    int nxt = (h + 1) % CAP;
    if (nxt == tail.load(memory_order_acquire))   // 소비자의 tail 을 읽기만 한다
        return false;                             // 가득 참
    buf[h] = v;
    head.store(nxt, memory_order_release);        // 값을 쓴 뒤에 head 를 옮긴다
    return true;
}

bool pop(long long& out) {  // 소비자 전용
    int t = tail.load(memory_order_relaxed);
    if (t == head.load(memory_order_acquire))     // 생산자의 head 를 읽기만 한다
        return false;                             // 비어 있음
    out = buf[t];
    tail.store((t + 1) % CAP, memory_order_release);
    return true;
}

void producer() {
    for (int i = 0; i < N; i++)
        while (!push(i)) this_thread::yield();    // 가득 참 — 잠깐 양보한다
}

long long total[2] = {0, 0};

void consumer() {
    long long got = 0, s = 0, v;
    while (got < N) {
        if (!pop(v)) { this_thread::yield(); continue; }
        got += 1;
        s += v;
    }
    total[0] = got;
    total[1] = s;
}

int main() {
    thread tp(producer), tc(consumer);
    tp.join();
    tc.join();
    printf("받은 개수 %lld · 합계 %lld\n", total[0], total[1]);
    return 0;
}
```
:::

```console
받은 개수 100000 · 합계 4999950000
```

**복잡도:** `push` 와 `pop` 모두 시간 $O(1)$ — 원자적 적재 두 번, 원자적 저장 한 번, 배열 접근 한 번으로 끝난다. 대기도 재시도도 없다. 공간은 용량 고정 $O(\text{CAP})$이고 **실행 중 할당이 전혀 없다** — 이것이 실시간 경로에서 이 구조를 쓰는 진짜 이유다. 처리량은 경합해도 무너지지 않는다. 생산자와 소비자가 서로 다른 캐시 라인을 만지는 한 서로를 기다릴 일이 없기 때문이다.

| 구조 (실측) | 중앙값 | 처리량 |
|---|---|---|
| C++ SPSC 락프리 | 8 ns/개 | 130M개/초 |
| C++ 뮤텍스 + 조건변수 큐 | 147 ns/개 | 6.8M개/초 |
| Python `collections.deque` | 250 ns/개 | 4.0M개/초 |
| Python `queue.Queue` | 2,100 ns/개 | 0.47M개/초 |

> (생산자 1 · 소비자 1 · 코어 4 · 7회 실행. 측정 스크립트는 `tools/bench/xi3_spsc.cpp` 와 `tools/bench/xi3_spsc.py`.)

| 언어 차이 | Python | C++ |
|---|---|---|
| 메모리 순서 | 노출되지 않는다. GIL 이 모든 바이트코드를 하나의 전역 순서에 놓는다 | `memory_order_*` 를 직접 고른다. 여기서는 release/acquire 짝 |
| 인덱스 갱신의 안전성 | `head = nxt` 는 `STORE_GLOBAL` 하나 — 쪼개지지 않는다 | `atomic<int>` 여야 한다. 평범한 `int` 는 UB |
| 이 구조를 직접 짤 이유 | 거의 없다. `deque.append`/`popleft` 가 이미 C 레벨 한 연산이고 8배 빠르다 | 있다. 실시간 경로에서 할당도 대기도 없는 유일한 선택지다 |
| 양보 | `time.sleep(0)` | `this_thread::yield()` |

::: pitfall
- **`head == tail` 하나로 "가득"과 "빔"을 둘 다 표현하려 한다.** 구분이 안 된다. 위 코드는 한 칸을 비워 두는 관용구를 쓴다 — 그래서 용량 1024의 큐에 실제로 들어가는 것은 1023개다. 세는 변수를 따로 두는 방법도 있지만 그 변수는 양쪽이 다 쓰므로 불변식이 깨진다.
- **`head` 와 `tail` 을 같은 캐시 라인에 둔다.** 값은 안 깨지지만 두 코어가 같은 라인을 번갈아 무효화시켜 성능이 무너진다(**거짓 공유, false sharing**). 실제 구현은 둘 사이에 패딩을 넣어 64바이트를 떼어 놓는다.
- **생산자를 둘로 늘린다.** 이 순간 불변식이 깨지고 이 코드는 그냥 틀린 코드가 된다. 두 생산자가 같은 `head` 를 읽고 같은 칸에 쓴다. **SPSC 라는 이름은 제약이지 성능 등급이 아니다.**
- **`% CAP` 를 쓰면서 용량을 2의 거듭제곱이 아닌 값으로 잡는다.** 나눗셈은 비트 마스크보다 훨씬 비싸다. 용량을 2의 거듭제곱으로 잡고 `& (CAP - 1)` 을 쓰면 이 연산이 사라진다.
:::

## 5. 어디에 쓰이는가

**오디오 장치와 애플리케이션 사이는 예외 없이 SPSC 링이다.** 오디오 콜백은 하드웨어 주기에 맞춰 수 밀리초마다 불리고, 그 안에서 뮤텍스를 잡으면 안 된다 — 다른 스레드가 락을 쥔 채 스케줄에서 밀리면 콜백이 마감을 놓치고, 그 결과가 귀에 들리는 잡음이다. 그래서 오디오 API 들은 콜백 안에서 락·할당·시스템 호출을 하지 말라고 명시한다. 콜백은 락프리 링에서 꺼내 쓰기만 한다.

**리눅스 커널의 링 버퍼도 같은 이유로 같은 모양이다.** `dmesg` 가 읽는 커널 로그 버퍼, `ftrace` 의 CPU별 추적 버퍼가 그렇다. 인터럽트 문맥에서는 잠들 수 없으므로 뮤텍스를 쓸 수 없고, CPU마다 자기 버퍼를 두어 쓰는 쪽을 하나로 만든다.

**뮤텍스의 실체는 futex 다.** 리눅스의 `std::mutex` 는 경합이 없으면 사용자 공간에서 원자적 연산 하나로 끝내고, 경합할 때만 커널로 들어가 잠든다. 4.3 표의 21 ns 대 58 ns 가 그 두 세계다. "락은 시스템 호출이라 느리다"가 옛말인 이유이고, 동시에 **경합을 줄이는 것이 락을 없애는 것보다 먼저**인 이유이기도 하다.

**참조 계수는 원자적 연산이 지탱한다.** C++ 의 `shared_ptr`, Python 객체의 참조 계수가 그렇다. Python 이 GIL 을 오래 붙들고 있었던 이유 중 하나가 이것이다 — 모든 객체의 참조 계수를 원자적 연산으로 바꾸면 단일 스레드 성능이 떨어진다. free-threaded 빌드(PEP 703)가 푸는 문제가 정확히 이 지점이다.

## 6. 여기서부터는 이 책의 범위 밖이다

이 절이 다룬 락프리는 **SPSC 까지**다. 생산자나 소비자가 여럿인 락프리 큐(MPMC)부터는 성격이 달라진다. 노드를 언제 해제해도 되는지 알 수 없다는 문제(다른 스레드가 아직 그 포인터를 보고 있을 수 있다)가 생기고, 그것을 푸는 도구가 hazard pointer, epoch 기반 회수, RCU 다. ABA 문제도 여기서 나온다.

**이름만 알고 넘어가라.** 이 구조들은 검증이 극도로 어렵고, 직접 짠 MPMC 락프리 큐가 뮤텍스 큐보다 느리면서 틀리기까지 하는 경우가 흔하다. 필요하면 검증된 라이브러리를 쓰고, 그 전에 **먼저 SPSC 로 쪼갤 수 있는지**를 본다. 생산자가 넷이면 SPSC 큐 넷을 두는 설계가 대개 더 빠르고 훨씬 안전하다.

::: interview
"락 없이 어떻게 했습니까"라는 질문에 "atomic 을 썼습니다"는 절반도 안 되는 답이다. 면접에서 실제로 확인하려는 것은 **무엇이 원자적인 단위인지 알고 있는가**다.

답변 뼈대: ① 원자적이어야 하는 것은 변수가 아니라 연산이다 — `atomic` 변수를 `load` 하고 `store` 하는 사이는 여전히 벌어져 있다. ② 더하기면 `fetch_add`, 임의 갱신이면 CAS 재시도 루프. ③ 순서가 필요하면 release/acquire 짝으로 "데이터를 쓰고 플래그를 세운다 / 플래그를 읽고 데이터를 읽는다". ④ 그리고 락프리가 목적이 아니다 — 경합 없는 뮤텍스는 21 ns 다. 먼저 경합을 줄이고, 그래도 안 되면 소유권을 갈라 SPSC 로 만들고, 그다음이 락프리다.

"GIL 이 있으니 Python 은 스레드 안전한가"도 자주 나온다. 답은 "아니다"이고, 근거는 `x += 1` 이 여러 바이트코드라는 사실이다. 위 실측처럼 읽기와 쓰기 사이에 함수 호출이 하나만 있어도 100회 중 80회 틀린다.
:::

## 연습

::: quiz
코드가 아니라 경계를 답한다. 각 상황에서 **무엇이 경쟁하는가 → 어떤 동기화인가 → 무엇을 대가로 치르는가**를 쓴다.

**1. 통계 카운터.** 요청 처리 스레드 여덟 개가 각자 처리 건수를 센다. 1초에 한 번 관리 스레드가 총합을 읽어 로그에 남긴다. 총합은 정확할 필요가 없고 대략이면 된다.
- 무엇이 경쟁하는가: 여덟 스레드의 읽고-고치고-쓰기가 한 변수에 몰린다.
- 어떤 동기화인가: 스레드마다 자기 카운터를 두고 관리 스레드가 합산한다. 공유 자체를 없애는 것이 첫 선택지다.
- 대가: 총합이 어느 한 시점의 값이 아니다. 여덟 개를 읽는 동안 앞의 것이 이미 변한다. 정확성을 요구하는 자리에는 못 쓴다.

**2. 설정 다시 읽기.** 설정 객체를 여러 워커 스레드가 매 요청마다 읽는다. 관리자가 가끔 통째로 교체한다. 읽기가 쓰기보다 만 배 잦다.
- 무엇이 경쟁하는가: 읽는 중에 내용이 바뀌는 것.
- 어떤 동기화인가: 설정을 **불변 객체**로 만들고 포인터만 원자적으로 갈아 끼운다. 읽는 쪽은 포인터를 한 번 읽어 그것만 본다.
- 대가: 교체 순간에 일부 워커는 옛 설정으로 한 요청을 더 처리한다. 그리고 옛 객체를 언제 해제할지가 남는다 — 아직 그것을 보고 있는 워커가 있을 수 있다.

**3. 센서 스트림.** 드라이버 스레드가 1 kHz 로 표본을 만들고 처리 스레드 하나가 소비한다. 드라이버는 절대 막히면 안 된다.
- 무엇이 경쟁하는가: 버퍼의 쓰기 위치와 읽기 위치.
- 어떤 동기화인가: SPSC 링. 쓰는 쪽이 하나씩이므로 락이 필요 없다.
- 대가: 용량이 고정이라 소비가 밀리면 넘친다. 넘칠 때 **버릴 것인가 덮어쓸 것인가**를 정해야 하고, 그 결정은 도메인이 한다.

**4. 작업 하나를 정확히 한 번만.** 워커 여럿이 같은 작업 목록을 보고 있다. 각 작업은 정확히 한 워커만 처리해야 한다.
- 무엇이 경쟁하는가: "아직 아무도 안 가져갔음"을 확인하는 것과 가져가는 것 사이.
- 어떤 동기화인가: 확인과 표시가 한 연산이어야 한다 — CAS 로 상태를 `대기 → 처리중` 으로 바꾸고, 성공한 워커만 처리한다.
- 대가: 처리 중에 워커가 죽으면 그 작업은 영원히 `처리중` 이다. 타임아웃과 회수 절차가 따라붙는다.

**5. 어디까지가 과한가.** 위 1번의 요구가 "총합이 정확해야 한다"로 바뀌면 무엇을 바꾸겠는가. 그리고 그 변경이 처리량에 얼마를 물릴지 4.3의 표로 어림해 보라.
:::

## 요약

- 읽고-고치고-쓰기는 한 걸음이 아니다. 그 사이에 다른 스레드가 끼면 **잃어버린 갱신**이 난다. 100회 중 86회 틀리고 14회 맞는다.
- **테스트가 통과하는 것은 근거가 아니다.** 경쟁 상태는 부하가 낮을 때 숨고, 드물게 터지는 것이 더 위험하다.
- GIL 은 바이트코드 하나의 원자성만 보장한다. 순수 `x += 1` 이 안 깨지는 것은 지금 인터프리터의 부작용일 뿐이고, 읽기와 쓰기 사이에 **함수 호출 하나**만 끼면 100회 중 80회 틀린다.
- 처방은 셋이다 — 상호배제(대기를 치른다), 원자적 연산(한 변수까지만), 소유권 분리(설계를 바꾼다).
- 조건변수는 신호를 저장하지 않는다. 언제나 **상태 + 락 + 조건변수** 세 짝으로 쓰고, 대기는 `while`(또는 술어 형태)로 감싼다.
- `atomic` 변수를 쓴다고 원자적이 되지 않는다. **원자적이어야 하는 것은 연산 전체다** — 더하기면 `fetch_add`, 임의 갱신이면 CAS 재시도 루프.
- 메모리 순서는 x86-64 에서 대부분 공짜지만 `seq_cst` 저장만 5.5 ns 를 문다. 그리고 **x86 에서 통과한 `relaxed` 코드는 ARM 에서 깨진다.**
- SPSC 락프리 큐의 근거는 성능이 아니라 불변식이다 — `head` 는 생산자만, `tail` 은 소비자만 쓴다. 생산자가 둘이 되는 순간 이 코드는 틀린 코드다.

**다음 절**: [XI-4 스레드 풀과 작업 큐](#/xi-4) — 작업마다 스레드를 만들면 무엇이 지배하는지 재고, 그 비용을 없애는 구조를 짠다.
