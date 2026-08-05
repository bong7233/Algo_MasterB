# XII-13 동시성 패턴

::: lead
스레드가 둘이 되는 순간 생겨나고, 스레드가 하나면 존재하지도 않는 문제들. 그리고 그 문제를 규율이 아니라 구조로 없애는 방법.
:::

## 1. 문제

주행 상태를 들고 있는 객체가 하나 있다. 통신 스레드가 받은 값을 넣고, 제어 스레드가 읽고, 로그 스레드가 훑는다. 세 스레드가 같은 자료를 만지므로 락이 하나 붙는다.

처음에는 이렇게 시작한다. 자료 옆에 뮤텍스를 두고, 문서에 한 줄을 적는다. *"이 객체를 만지기 전에 `mtx` 를 잠글 것."* 규칙은 명확하고, 처음 석 달 동안은 잘 지켜진다.

문제는 호출부가 여덟 곳이 되고 그중 한 곳이 급하게 추가될 때다. 락을 잊은 그 한 줄은 문법 오류가 아니다. 컴파일도 되고, 단위 시험도 통과하고, 코드 리뷰도 통과한다. 혼자 돌리면 아무 일도 일어나지 않는다. **부하가 걸린 현장에서 하루에 한 번, 카운터가 조용히 몇 개씩 줄어든다.**

여기서 흔한 처방은 "주의하라"다. 그것은 처방이 아니다. ==지켜야만 하는 규칙인데 지키지 않아도 아무 신호가 없다면, 그 규칙은 언젠가 반드시 깨진다.== 사람이 게을러서가 아니라 호출부가 여덟 곳이라서 깨진다.

락을 제대로 걸어도 두 번째 문제가 남는다. 그 객체 뒤에 실제 장비가 붙어 있고 명령 하나에 5밀리초가 걸린다면, 락을 잡은 스레드는 5밀리초 동안 락을 들고 있다. 제어 주기가 10밀리초인데 명령 세 개를 보내야 하면 그 주기는 이미 끝났다. **정확성은 지켰지만 마감을 놓쳤다.**

세 번째 문제는 규모에서 온다. 연결 하나에 스레드 하나를 붙이는 구조는 연결이 수십 개일 때 잘 돈다. 수천 개가 되면 스레드 수천 개가 되고, 대부분은 아무 일도 안 하면서 스택 8MB씩을 차지한 채 문맥 전환 비용만 만든다.

네 번째 문제는 이 셋이 한 시스템 안에서 동시에 나타난다는 것이다. 어떤 코드는 막혀도 된다. 디스크에 쓰고, 데이터베이스에 질의하고, 무거운 계산을 한다. 어떤 코드는 절대 막히면 안 된다. 이벤트를 받아 넘기고, 제어 주기를 지킨다. **두 세계를 같은 스레드에 두면 막혀도 되는 쪽이 막히면 안 되는 쪽을 끌고 들어간다.**

::: note
이 챕터는 도구가 아니라 배치를 다룬다. 뮤텍스·조건변수·원자적 연산이 무엇이고 메모리 순서가 어떻게 도는지는 [XI-3 락과 락프리](#/xi-3)에, 유계 큐의 동작은 [XI-2 생산자-소비자와 유계 큐](#/xi-2)에, 스레드 풀은 [XI-4 스레드 풀과 작업 큐](#/xi-4)에 있다. 여기서는 **그 부품들을 어떤 모양으로 놓아야 위의 네 가지가 구조적으로 안 생기는가**만 본다.
:::

## 2. 무엇이 달라져야 하는가

네 문제는 서로 다르지만 가르는 방식은 같다. 변하지 않는 요구를 먼저 고정하고, 그 요구를 **누가 책임지는가**를 옮긴다.

**첫째, 상호배제의 책임을 호출자에게서 자료로 옮긴다.**

변하지 않는 것은 "공유 자료는 한 번에 한 스레드만 만진다"이다. 변하는 것은 그 규칙을 지키는 주체다. 호출자가 지키면 규칙은 문서에 살고, 자료가 지키면 규칙은 코드에 산다. 자료를 감추고 잠그는 메서드만 밖으로 내면 **락을 잊을 수 있는 경로 자체가 없어진다.** 규율을 요구하는 설계와 실수를 불가능하게 만드는 설계의 차이다.

**둘째, 호출자의 시간과 객체의 시간을 끊는다.**

변하지 않는 것은 "장비는 한 번에 하나의 명령만 받는다"이다. 변하는 것은 그 직렬화를 어디서 하느냐다. 락으로 하면 호출자가 그 자리에 서서 기다린다. 요청을 **큐에 실어 두고 돌아오면** 직렬화는 큐가 하고 호출자는 자기 주기를 계속 돈다. 호출은 즉시 반환되고 결과는 나중에 회수한다. 그러면 그 객체 안에는 스레드가 하나뿐이므로 **객체 내부에는 동시성이 아예 없다.** 락이 사라지는 것이 아니라 필요가 사라진다.

**셋째, 기다리는 주체의 수를 핸들 수에서 1로 줄인다.**

변하지 않는 것은 "여러 입력원 중 아무 데서나 데이터가 온다"이다. 변하는 것은 누가 기다리느냐다. 핸들마다 스레드를 세워 각자 기다리면 스레드 수가 핸들 수를 따라간다. **한 곳에서 전부를 한꺼번에 기다렸다가 준비된 것만 골라 담당자에게 넘기면** 스레드는 하나로 충분하다. 기다림을 한곳에 모으는 것이 요점이다.

**넷째, 막혀도 되는 코드와 막히면 안 되는 코드 사이에 큐를 놓는다.**

두 종류의 코드는 요구가 정반대이므로 화해시킬 수 없다. 화해 대신 **분리**한다. 막히면 안 되는 쪽은 받아서 큐에 넣고 즉시 다음을 받는다. 막혀도 되는 쪽은 큐에서 꺼내 마음껏 막힌다. 큐가 두 세계의 유일한 접점이고, 그 큐의 길이가 곧 시스템이 감당 중인 밀린 일의 양이다.

```text nolines
  (1) lock lives with the data            (2) call becomes a message
      ┌──────────────┐                        caller ──▶ [ queue ] ──▶ own thread
      │ mutex + data │  <- one door only                                 └─ no concurrency inside
      └──────────────┘

  (3) one waiter, many handles            (4) a queue between two worlds
      h1 h2 h3 ──▶ ┌──────┐                    non-blocking layer
                   │ loop │ ──▶ handlers           │  [ queue ]
                   └──────┘                        ▼
                                              blocking layer
```

네 그림은 독립이 아니다. (2)는 (1)을 필요 없게 만들고, (4)는 (3) 위에 얹히며, (2)와 (4)는 같은 부품(큐)을 다른 크기에서 쓴다. 하나씩 돌려 보면 관계가 보인다.

## 3. 구현

### 3.1 락을 자료 안으로 넣는다

여덟 개의 호출부 중 하나만 규약을 잊게 하고, 같은 일을 캡슐화한 판과 나란히 돌린다. 읽기와 쓰기 사이에 2밀리초의 틈을 명시적으로 넣었다 — 실제 코드에서는 명령 몇 개에 불과한 그 틈이 여기서는 눈에 보이게 벌어진다.

::: dual
```python title="상호배제의 책임을 옮긴다 — 규약 방식과 캡슐화 방식"
import threading
import time

N_THREADS, N_EACH = 8, 3
EXPECT = N_THREADS * N_EACH


# 나쁜 판 — 락이 자료 밖에 있고, 잠그는 것은 호출자가 지켜야 할 규약이다
class RawCounter:
    def __init__(self):
        self.total = 0
        self.mtx = threading.Lock()


def add_with_lock(c, v):
    with c.mtx:                       # ✅ 규약을 지킨 호출부
        tmp = c.total
        time.sleep(0.002)             # 읽기와 쓰기 사이의 틈. 실제 코드에서는 명령 몇 개다
        c.total = tmp + v


def add_forgot_lock(c, v):
    tmp = c.total                     # ❌ 규약을 잊은 호출부. 컴파일도 리뷰도 통과한다
    time.sleep(0.002)
    c.total = tmp + v


# 좋은 판 — 락이 자료와 한 껍질 안에 있다. 밖에서 total 을 만질 경로가 없다
class SafeCounter:
    def __init__(self):
        self._total = 0
        self._mtx = threading.Lock()

    def add(self, v):
        with self._mtx:
            tmp = self._total
            time.sleep(0.002)
            self._total = tmp + v

    def get(self):
        with self._mtx:
            return self._total


raw = RawCounter()
safe = SafeCounter()


def raw_job(k):
    for _ in range(N_EACH):
        if k == 0:
            add_forgot_lock(raw, 1)   # 여덟 곳 중 한 곳만 규약을 잊었다
        else:
            add_with_lock(raw, 1)


def safe_job(k):
    for _ in range(N_EACH):
        safe.add(1)


def run_all(job):
    ts = [threading.Thread(target=job, args=(k,)) for k in range(N_THREADS)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()


run_all(raw_job)
run_all(safe_job)
print("규약 방식:", "정확" if raw.total == EXPECT else "갱신 손실")
print("캡슐화 방식:", "정확" if safe.get() == EXPECT else "갱신 손실")
```
```cpp title="상호배제의 책임을 옮긴다 — 규약 방식과 캡슐화 방식"
#include <chrono>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int N_THREADS = 8, N_EACH = 3;
const int EXPECT = N_THREADS * N_EACH;


// 나쁜 판 — 락이 자료 밖에 있고, 잠그는 것은 호출자가 지켜야 할 규약이다
struct RawCounter {
    int total = 0;
    mutex mtx;
};

void sleep_gap() { this_thread::sleep_for(chrono::milliseconds(2)); }

void add_with_lock(RawCounter& c, int v) {
    lock_guard<mutex> g(c.mtx);       // ✅ 규약을 지킨 호출부
    int tmp = c.total;
    sleep_gap();                      // 읽기와 쓰기 사이의 틈. 실제 코드에서는 명령 몇 개다
    c.total = tmp + v;
}

void add_forgot_lock(RawCounter& c, int v) {
    int tmp = c.total;                // ❌ 규약을 잊은 호출부. 컴파일도 리뷰도 통과한다
    sleep_gap();
    c.total = tmp + v;
}


// 좋은 판 — 락이 자료와 한 껍질 안에 있다. 밖에서 total 을 만질 경로가 없다
class SafeCounter {
public:
    void add(int v) {
        lock_guard<mutex> g(_mtx);
        int tmp = _total;
        sleep_gap();
        _total = tmp + v;
    }

    int get() {
        lock_guard<mutex> g(_mtx);
        return _total;
    }

private:
    int _total = 0;
    mutex _mtx;
};


RawCounter raw;
SafeCounter safe;

void raw_job(int k) {
    for (int i = 0; i < N_EACH; i++) {
        if (k == 0) add_forgot_lock(raw, 1);   // 여덟 곳 중 한 곳만 규약을 잊었다
        else        add_with_lock(raw, 1);
    }
}

void safe_job(int k) {
    (void)k;
    for (int i = 0; i < N_EACH; i++) safe.add(1);
}

void run_all(void (*job)(int)) {
    vector<thread> ts;
    for (int k = 0; k < N_THREADS; k++) ts.emplace_back(job, k);
    for (auto& t : ts) t.join();
}

int main() {
    run_all(raw_job);
    run_all(safe_job);
    cout << "규약 방식: " << (raw.total == EXPECT ? "정확" : "갱신 손실") << "\n";
    cout << "캡슐화 방식: " << (safe.get() == EXPECT ? "정확" : "갱신 손실") << "\n";
    return 0;
}
```
:::

두 판 모두 같은 출력을 낸다.

```console
규약 방식: 갱신 손실
캡슐화 방식: 정확
```

**복잡도:** 잠금 자체는 시간 $O(1)$ — 경합이 없으면 원자적 교환 명령 한 번이다. 하지만 상수가 지배한다. 경합이 생기면 대기 시간은 **임계 구역의 길이 × 대기자 수**로 늘어난다. 위 코드에서 임계 구역이 2밀리초이고 대기자가 일곱이면 마지막 스레드는 14밀리초를 선다. 공간은 락 하나당 $O(1)$이고, 자료마다 락을 달면 객체 수만큼 늘어난다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 접근 차단 | `_total` 은 관례일 뿐이다. 밖에서 `c._total` 로 그냥 만져진다 | `private` 이 컴파일 오류를 낸다. 규약이 컴파일러의 일이 된다 |
| 락 해제 | `with` 블록을 벗어날 때 | `lock_guard` 소멸자에서. 예외로 빠져나가도 풀린다 |
| 이 예제에서 손실이 나는 이유 | GIL 이 있어도 `sleep` 에서 다른 스레드로 넘어간다 | 진짜 병렬이라 그대로 겹친다 |
| 표준 도구 | `threading.Lock`, `queue.Queue` | `std::mutex`, `std::lock_guard`, `std::scoped_lock` |

::: danger
Python 의 GIL 이 있으니 락이 필요 없다는 말은 틀렸다. GIL 은 **바이트코드 하나**의 원자성만 보장한다. `self.total += 1` 은 읽기·더하기·쓰기 세 단계이고 그 사이에서 스레드가 바뀔 수 있다. 위 예제가 `sleep` 으로 벌려 놓은 틈은 인위적인 것이 아니라 **원래 있는 틈을 보이게 만든 것**이다.
:::

### 3.2 호출을 메시지로 바꾼다

락을 제대로 걸어도 남는 문제로 간다. 장비 조작에 5밀리초가 걸리고 제어 주기는 10밀리초다. 명령 세 개를 직접 부르면 15밀리초, 마감 위반이다.

::: dual
```python title="호출자의 시간과 객체의 시간을 끊는다 — 직접 호출과 큐"
import queue
import threading
import time
from concurrent.futures import Future

DEADLINE = 0.010          # 제어 주기 한 바퀴에 허용된 시간


class Device:             # 실제 장비. 한 번에 하나의 명령만 받을 수 있다
    def __init__(self):
        self.pos = 0

    def move(self, d):
        time.sleep(0.005)     # 장비가 실제로 움직이는 시간
        self.pos += d
        return self.pos


# 나쁜 판 — 호출자가 장비 위에서 직접 기다린다
def direct_cycle(dev, moves):
    t0 = time.perf_counter()
    out = [dev.move(d) for d in moves]
    return time.perf_counter() - t0, out


# 좋은 판 — 호출을 메시지로 바꿔 큐에 싣고, 장비는 자기 스레드에서만 만진다
class DeviceProxy:
    def __init__(self):
        self._dev = Device()
        self._q = queue.Queue()
        self._th = threading.Thread(target=self._loop)
        self._th.start()

    def _loop(self):
        while True:
            item = self._q.get()
            if item is None:
                break
            fut, d = item
            fut.set_result(self._dev.move(d))   # 이 안에는 스레드가 하나뿐이다

    def move(self, d):
        fut = Future()
        self._q.put((fut, d))
        return fut            # 즉시 반환한다. 장비가 다 움직일 때까지 기다리지 않는다

    def close(self):
        self._q.put(None)
        self._th.join()


def queued_cycle(proxy, moves):
    t0 = time.perf_counter()
    futs = [proxy.move(d) for d in moves]
    return time.perf_counter() - t0, futs


moves = [10, -3, 5]

took, out = direct_cycle(Device(), moves)
print("직접 호출:", "마감 준수" if took < DEADLINE else "마감 위반", "| 결과", out)

proxy = DeviceProxy()
took, futs = queued_cycle(proxy, moves)
print("큐 방식  :", "마감 준수" if took < DEADLINE else "마감 위반", "| 결과", "아직 없음")
print("나중에 회수한 결과:", [f.result() for f in futs])
proxy.close()
```
```cpp title="호출자의 시간과 객체의 시간을 끊는다 — 직접 호출과 큐"
#include <chrono>
#include <condition_variable>
#include <future>
#include <iostream>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <utility>
#include <vector>
using namespace std;

const double DEADLINE = 0.010;   // 제어 주기 한 바퀴에 허용된 시간


class Device {                   // 실제 장비. 한 번에 하나의 명령만 받을 수 있다
public:
    int pos = 0;
    int move(int d) {
        this_thread::sleep_for(chrono::milliseconds(5));   // 장비가 실제로 움직이는 시간
        pos += d;
        return pos;
    }
};

double now() {
    return chrono::duration<double>(chrono::steady_clock::now().time_since_epoch()).count();
}

string join(const vector<int>& v) {
    string s = "[";
    for (size_t i = 0; i < v.size(); i++) s += (i ? ", " : "") + to_string(v[i]);
    return s + "]";
}


// 나쁜 판 — 호출자가 장비 위에서 직접 기다린다
pair<double, vector<int>> direct_cycle(Device& dev, const vector<int>& moves) {
    double t0 = now();
    vector<int> out;
    for (int d : moves) out.push_back(dev.move(d));
    return {now() - t0, out};
}


// 좋은 판 — 호출을 메시지로 바꿔 큐에 싣고, 장비는 자기 스레드에서만 만진다
class DeviceProxy {
public:
    DeviceProxy() : _th([this] { _loop(); }) {}

    future<int> move(int d) {
        auto pr = make_shared<promise<int>>();
        auto fut = pr->get_future();
        {
            lock_guard<mutex> g(_mtx);
            _q.push({pr, d});
        }
        _cv.notify_one();
        return fut;           // 즉시 반환한다. 장비가 다 움직일 때까지 기다리지 않는다
    }

    void close() {
        {
            lock_guard<mutex> g(_mtx);
            _done = true;
        }
        _cv.notify_one();
        _th.join();
    }

private:
    void _loop() {
        while (true) {
            unique_lock<mutex> lk(_mtx);
            _cv.wait(lk, [this] { return _done || !_q.empty(); });
            if (_q.empty()) break;
            auto item = _q.front();
            _q.pop();
            lk.unlock();
            item.first->set_value(_dev.move(item.second));  // 이 안에는 스레드가 하나뿐이다
        }
    }

    Device _dev;
    queue<pair<shared_ptr<promise<int>>, int>> _q;
    mutex _mtx;
    condition_variable _cv;
    bool _done = false;
    thread _th;
};

pair<double, vector<future<int>>> queued_cycle(DeviceProxy& proxy, const vector<int>& moves) {
    double t0 = now();
    vector<future<int>> futs;
    for (int d : moves) futs.push_back(proxy.move(d));
    return {now() - t0, std::move(futs)};
}


int main() {
    vector<int> moves = {10, -3, 5};

    Device dev;
    auto [took, out] = direct_cycle(dev, moves);
    cout << "직접 호출: " << (took < DEADLINE ? "마감 준수" : "마감 위반")
         << " | 결과 " << join(out) << "\n";

    DeviceProxy proxy;
    auto [took2, futs] = queued_cycle(proxy, moves);
    cout << "큐 방식  : " << (took2 < DEADLINE ? "마감 준수" : "마감 위반")
         << " | 결과 " << "아직 없음" << "\n";
    vector<int> later;
    for (auto& f : futs) later.push_back(f.get());
    cout << "나중에 회수한 결과: " << join(later) << "\n";
    proxy.close();
    return 0;
}
```
:::

```console
직접 호출: 마감 위반 | 결과 [10, 7, 12]
큐 방식  : 마감 준수 | 결과 아직 없음
나중에 회수한 결과: [10, 7, 12]
```

**복잡도:** 호출자가 무는 비용은 시간 $O(1)$ — 요청 하나를 큐에 넣는 것이 전부다. 전체 처리량은 달라지지 않는다. 명령 세 개는 여전히 15밀리초가 걸리고, 그 15밀리초를 **호출자 대신 전담 스레드가 문다.** 공간은 큐 길이에 비례한 $O(n)$이고, 이 $n$ 이 곧 위험이다 — 넣는 속도가 처리 속도보다 빠르면 큐는 무한히 자란다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 큐 | `queue.Queue` 가 락과 조건변수를 내장한다 | `std::queue` + `mutex` + `condition_variable` 을 직접 조립한다 |
| 결과 회수 | `concurrent.futures.Future` | `std::promise` / `std::future` |
| 종료 신호 | 큐에 `None` 을 넣는 관용구 | 플래그 + `notify_one`. `jthread`(C++20)의 `stop_token` 이 이 자리를 대신한다 |
| 소유권 | 참조 계수가 알아서 처리한다 | `promise` 를 `shared_ptr` 로 감싸야 큐에 복사되어 들어간다 |

::: warn
`fut.result()` 를 요청 직후에 부르면 이 구조는 직접 호출과 정확히 같아진다. 큐가 주는 이득은 **요청과 회수 사이에 다른 일을 하는 동안**에만 생긴다. 요청하자마자 결과를 기다리는 코드는 큐를 하나 더 얹은 동기 호출일 뿐이고, 그 큐만큼 더 느리다.
:::

### 3.3 기다림을 한곳에 모으고, 두 세계를 큐로 가른다

핸들 세 개가 있다. `netA`, `netB` 는 느린 이벤트를 물고 있고, `sensor` 에 급한 이벤트가 하나 붙어 있다. 세 가지 배치가 이 급한 이벤트를 언제 집어 드는지 센다. 비용 단위는 빠른 이벤트 1, 느린 이벤트 5다.

::: dual
```python title="다중화와 계층 분리 — 전담·인라인·워커 큐"
import queue
import threading

FAST, SLOW = 1, 5
ORDER = ["netA", "netB", "sensor"]


def make_sources():
    return {
        "netA": ["slow", "slow", "fast"],
        "netB": ["slow", "fast", "fast"],
        "sensor": ["urgent"],       # 급한 이벤트가 마지막 핸들에 붙어 있다
    }


def cost(kind):
    return SLOW if kind == "slow" else FAST


# 나쁜 판 1 — 핸들 하나를 끝까지 처리하고 다음 핸들로 간다
def dedicated(src):
    spent, urgent_at = 0, -1
    for h in ORDER:
        for kind in src[h]:
            if kind == "urgent":
                urgent_at = spent
            spent += cost(kind)
    return urgent_at


# 나쁜 판 2 — 한 루프가 모든 핸들을 돌지만, 느린 일을 루프 안에서 직접 한다
def loop_inline(src):
    spent, urgent_at = 0, -1
    idx = {h: 0 for h in ORDER}
    while any(idx[h] < len(src[h]) for h in ORDER):
        for h in ORDER:                      # 준비된 핸들을 한 바퀴 훑는다
            i = idx[h]
            if i >= len(src[h]):
                continue
            kind = src[h][i]
            idx[h] = i + 1
            if kind == "urgent":
                urgent_at = spent
            spent += cost(kind)
    return urgent_at


# 좋은 판 — 루프는 다중화만 하고, 느린 일은 큐 너머 워커 스레드가 한다
def loop_worker(src, q):
    spent, urgent_at = 0, -1
    idx = {h: 0 for h in ORDER}
    while any(idx[h] < len(src[h]) for h in ORDER):
        for h in ORDER:
            i = idx[h]
            if i >= len(src[h]):
                continue
            kind = src[h][i]
            idx[h] = i + 1
            if kind == "urgent":
                urgent_at = spent
            if kind == "slow":
                q.put(f"{h}#{i}")            # 큐에 넣는 비용만 문다
                spent += FAST
            else:
                spent += FAST
    return urgent_at


def worker_loop(q, done):
    while True:
        item = q.get()
        if item is None:
            break
        done.append(item)                    # 이 계층은 막혀도 된다. 루프가 아니니까


print("전담 방식      : 긴급 이벤트를 비용", dedicated(make_sources()), "에서 집는다")
print("한 루프(인라인) : 긴급 이벤트를 비용", loop_inline(make_sources()), "에서 집는다")

q, done = queue.Queue(), []
th = threading.Thread(target=worker_loop, args=(q, done))
th.start()
print("한 루프+워커 큐 : 긴급 이벤트를 비용", loop_worker(make_sources(), q), "에서 집는다")
q.put(None)
th.join()
print("워커가 끝낸 느린 작업:", " ".join(done))
```
```cpp title="다중화와 계층 분리 — 전담·인라인·워커 큐"
#include <condition_variable>
#include <iostream>
#include <map>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <vector>
using namespace std;

const int FAST = 1, SLOW = 5;
const vector<string> ORDER = {"netA", "netB", "sensor"};

using Sources = map<string, vector<string>>;

Sources make_sources() {
    return {
        {"netA", {"slow", "slow", "fast"}},
        {"netB", {"slow", "fast", "fast"}},
        {"sensor", {"urgent"}},      // 급한 이벤트가 마지막 핸들에 붙어 있다
    };
}

int cost(const string& kind) { return kind == "slow" ? SLOW : FAST; }


// 나쁜 판 1 — 핸들 하나를 끝까지 처리하고 다음 핸들로 간다
int dedicated(Sources src) {
    int spent = 0, urgent_at = -1;
    for (const string& h : ORDER)
        for (const string& kind : src[h]) {
            if (kind == "urgent") urgent_at = spent;
            spent += cost(kind);
        }
    return urgent_at;
}

// 나쁜 판 2 — 한 루프가 모든 핸들을 돌지만, 느린 일을 루프 안에서 직접 한다
int loop_inline(Sources src) {
    int spent = 0, urgent_at = -1;
    map<string, int> idx;
    auto pending = [&] {
        for (const string& h : ORDER)
            if (idx[h] < (int)src[h].size()) return true;
        return false;
    };
    while (pending()) {
        for (const string& h : ORDER) {      // 준비된 핸들을 한 바퀴 훑는다
            int i = idx[h];
            if (i >= (int)src[h].size()) continue;
            string kind = src[h][i];
            idx[h] = i + 1;
            if (kind == "urgent") urgent_at = spent;
            spent += cost(kind);
        }
    }
    return urgent_at;
}

// 좋은 판 — 루프는 다중화만 하고, 느린 일은 큐 너머 워커 스레드가 한다
struct Chan {
    queue<string> q;
    mutex mtx;
    condition_variable cv;
    bool closed = false;
};

int loop_worker(Sources src, Chan& ch) {
    int spent = 0, urgent_at = -1;
    map<string, int> idx;
    auto pending = [&] {
        for (const string& h : ORDER)
            if (idx[h] < (int)src[h].size()) return true;
        return false;
    };
    while (pending()) {
        for (const string& h : ORDER) {
            int i = idx[h];
            if (i >= (int)src[h].size()) continue;
            string kind = src[h][i];
            idx[h] = i + 1;
            if (kind == "urgent") urgent_at = spent;
            if (kind == "slow") {
                {
                    lock_guard<mutex> g(ch.mtx);
                    ch.q.push(h + "#" + to_string(i));   // 큐에 넣는 비용만 문다
                }
                ch.cv.notify_one();
                spent += FAST;
            } else {
                spent += FAST;
            }
        }
    }
    return urgent_at;
}

void worker_loop(Chan& ch, vector<string>& done) {
    while (true) {
        unique_lock<mutex> lk(ch.mtx);
        ch.cv.wait(lk, [&] { return ch.closed || !ch.q.empty(); });
        if (ch.q.empty()) break;
        string item = ch.q.front();
        ch.q.pop();
        lk.unlock();
        done.push_back(item);        // 이 계층은 막혀도 된다. 루프가 아니니까
    }
}


int main() {
    cout << "전담 방식      : 긴급 이벤트를 비용 " << dedicated(make_sources()) << " 에서 집는다\n";
    cout << "한 루프(인라인) : 긴급 이벤트를 비용 " << loop_inline(make_sources()) << " 에서 집는다\n";

    Chan ch;
    vector<string> done;
    thread th(worker_loop, ref(ch), ref(done));
    cout << "한 루프+워커 큐 : 긴급 이벤트를 비용 " << loop_worker(make_sources(), ch) << " 에서 집는다\n";
    {
        lock_guard<mutex> g(ch.mtx);
        ch.closed = true;
    }
    ch.cv.notify_one();
    th.join();
    cout << "워커가 끝낸 느린 작업:";
    for (const string& s : done) cout << " " << s;
    cout << "\n";
    return 0;
}
```
:::

```console
전담 방식      : 긴급 이벤트를 비용 18 에서 집는다
한 루프(인라인) : 긴급 이벤트를 비용 10 에서 집는다
한 루프+워커 큐 : 긴급 이벤트를 비용 2 에서 집는다
워커가 끝낸 느린 작업: netA#0 netB#0 netA#1
```

::: hist
다중화기가 $O(H)$에서 $O(k)$로 간 것이 2000년대 초 서버 성능 논쟁의 실체다. 옛 `select` 는 감시할 핸들 전체를 매 호출마다 커널에 넘기고 커널이 전부를 훑었다. 핸들이 1만 개면 준비된 것이 하나뿐이어도 1만 개를 본다. `epoll` 은 감시 목록을 커널에 한 번 등록해 두고 **준비된 것만** 돌려준다. 등록 비용을 한 번 치르고 반복 비용을 없앤 것이고, 자료구조 관점에서는 매번 선형 탐색하던 것을 상주 인덱스로 바꾼 것이다. 구조는 그대로이고 다중화기 하나만 바뀌었다는 점이 중요하다 — **이 배치는 다중화기를 갈아 끼울 수 있게 만들어 둔 자리다.**
:::

**복잡도:** 다중화 자체는 준비된 핸들 하나당 $O(1)$ 디스패치다. 위 코드는 매 바퀴 모든 핸들을 훑으므로 $O(H)$이고, 실제 시스템의 `epoll` / `kqueue` 는 **준비된 것만** 돌려주어 $O(k)$가 된다($k$ = 준비된 핸들 수). 이 차이가 옛 `select` 와 `epoll` 을 가른 지점이다. 긴급 이벤트의 대기 시간은 **앞에서 인라인으로 처리한 일의 총 비용**이므로, 느린 일을 큐로 밀어내면 18에서 2로 줄어든다. 공간은 핸들 표 $O(H)$ + 큐 $O(n)$.

| 언어 차이 | Python | C++ |
|---|---|---|
| 실제 다중화기 | `selectors` 모듈. `asyncio` 의 이벤트 루프가 이 위에 있다 | 표준에 없다. `epoll`/`kqueue`/IOCP 를 직접 부르거나 라이브러리를 쓴다 |
| 핸들러 등록 | 함수를 그냥 딕셔너리에 넣는다 | `std::function` 을 담거나 순수 가상 클래스를 상속시킨다 |
| 워커가 막힐 때 | GIL 을 놓는 I/O 라면 다른 스레드가 돈다. CPU 작업이면 안 돈다 | 진짜로 병렬이다 |

::: pitfall
- **핸들러 안에서 오래 걸리는 일을 한다.** 루프 하나가 전부를 담당하므로 핸들러 하나가 100밀리초를 쓰면 그 시간 동안 시스템 전체가 멈춘다. 위 출력의 `10` 이 그 값이다.
- **큐에 상한이 없다.** 넣는 쪽이 빠르면 메모리가 끝없이 자란다. 유계 큐와 역압은 [XI-7 이벤트 루프와 백프레셔](#/xi-7)에.
- **루프 스레드에서 공유 자료를 직접 만진다.** 계층을 갈라 놓고 자료는 공유하면 분리한 의미가 없다. 넘길 것은 자료의 참조가 아니라 **값 또는 소유권**이다.
- **결과의 순서를 가정한다.** 워커가 여럿이면 완료 순서는 요청 순서와 다르다. 순서가 필요하면 순번을 함께 실어야 한다.
:::

## 4. 이제 이름을 붙인다

네 가지 배치에는 모두 이름이 있다.

**Monitor.** 자료와 그 자료를 지키는 락을 한 객체 안에 묶고, 밖으로는 잠그는 메서드만 낸다. 참여자는 감춰진 상태, 락, 그리고 공개 메서드뿐이다. 의도는 하나다 — **락을 잊을 수 있는 경로를 없앤다.** 대기가 필요하면 조건변수를 같은 껍질 안에 둔다. Hoare 와 Brinch Hansen 이 1970년대 초에 정리했고, Java 의 `synchronized`, C# 의 `lock` 은 이 패턴을 언어 문법으로 굳힌 것이다.

**Active Object.** 메서드 호출을 요청 객체로 바꿔 큐에 싣고, 그 객체의 전용 스레드가 큐에서 하나씩 꺼내 실행한다. 참여자는 프록시(호출자가 보는 얼굴), 요청 큐, 스케줄러(꺼내는 규칙), 서번트(실제 일을 하는 객체), 그리고 결과를 나중에 받을 퓨처다. 의도는 **호출자의 실행 흐름과 객체의 실행 흐름을 끊는 것**이고, 부수 효과로 서번트 안에는 동시성이 사라진다. Actor 모델과 뿌리가 같다.

**Reactor.** 여러 핸들을 한 곳에서 기다렸다가, 준비된 것만 골라 미리 등록된 핸들러에게 넘긴다. 참여자는 핸들, 동기적 이벤트 다중화기, 디스패처, 그리고 구체 핸들러다. 의도는 **기다림을 한곳에 모아 스레드 수를 입력원 수에서 떼어 내는 것**이다. `epoll` 을 쓰는 모든 서버가 이 모양이고, 3.3의 `hist` 상자에서 다중화기가 `select` 에서 `epoll` 로 바뀌어도 구조가 그대로였던 이유가 이것이다 — 이 패턴은 다중화기를 갈아 끼울 수 있게 이름 붙인 자리다.

**Half-Sync/Half-Async.** 시스템을 두 계층으로 가르고 사이에 큐를 둔다. 비동기 계층은 절대 막히지 않고 받아서 큐에 넣는 일만 한다. 동기 계층은 큐에서 꺼내 마음껏 막힌다. 참여자는 두 계층과 그 사이의 큐 하나다. 의도는 **"막히면 안 되는 코드"와 "짜기 쉬운 코드"를 둘 다 갖는 것**이다. 비동기 코드는 성능이 좋고 짜기 어렵다. 동기 코드는 반대다. 이 패턴은 둘 중 하나를 고르지 않고 경계를 긋는다.

네 이름의 관계는 이렇다. **Active Object 는 Half-Sync/Half-Async 를 객체 하나 크기로 줄인 것**이고, 앞의 3.3 예제에서 리액터 루프가 비동기 계층, 워커 스레드가 동기 계층이다. Monitor 는 공유를 전제하고 나머지 셋은 **공유 대신 전달**을 택한다. 그 선택이 "메모리를 공유해서 통신하지 말고, 통신해서 메모리를 공유하라"는 격언의 실체다.

::: deep
네 이름은 한 곳에서 함께 정리됐다. Schmidt, Stal, Rohnert & Buschmann, 2000, *Pattern-Oriented Software Architecture, Volume 2: Patterns for Concurrent and Networked Objects* 가 그 카탈로그이고, Reactor·Proactor·Active Object·Monitor Object·Half-Sync/Half-Async 가 모두 여기 있다. 순서가 우연이 아니다 — 앞의 둘은 **이벤트를 어떻게 받는가**, 뒤의 셋은 **받은 일을 어느 스레드에서 하는가**를 다룬다.

모니터에 딸린 조건변수에는 이 책 전체에서 가장 자주 틀리는 관용구가 하나 있다. 대기는 반드시 **`if` 가 아니라 `while` 로** 감싼다.

깨어났다는 사실이 조건이 참이라는 뜻은 아니기 때문이다. 이유는 둘이다. 하나는 가짜 깨어남(spurious wakeup) — 아무도 깨우지 않았는데 깨어나는 것이 표준상 허용된다. 다른 하나가 더 중요하다. 깨우는 쪽이 신호를 보낸 뒤 대기하던 쪽이 실제로 락을 잡기까지 사이에 **제3의 스레드가 끼어들어 조건을 다시 거짓으로 만들 수 있다.** `if` 로 짜면 그 스레드는 조건이 거짓인 채로 임계 구역에 들어간다. 위 코드의 `cv.wait(lk, 술어)` 형태는 표준이 이 `while` 을 대신 감아 주는 것이라 안전하다. Python 의 `Condition.wait_for` 도 같다.
:::

## 5. 어디에 박혀 있는가

**Monitor 는 언어 문법이 되었다.** Java 의 `synchronized` 메서드는 객체 자신을 락으로 쓰는 모니터이고, Python 의 `queue.Queue` 는 안에 락과 조건변수를 감춘 모니터다. `Queue.put` 을 부르기 전에 무엇을 잠글지 생각할 필요가 없다는 사실이 이 패턴이 성공했다는 증거다.

**Redis 는 Reactor 하나로 돌아간다.** 단일 스레드가 이벤트 루프를 돌며 소켓 수만 개를 다중화한다. 명령 하나하나가 짧게 끝나기 때문에 락이 아예 필요 없고, 그래서 빠르다. 반대로 **명령 하나가 오래 걸리면 서버 전체가 멈춘다** — 큰 키에 대한 `KEYS` 명령이 위험한 이유가 이것이지 문법 때문이 아니다. nginx, Node.js, Python 의 `asyncio` 도 같은 구조 위에 있다.

**웹 서버와 스레드 풀의 조합이 Half-Sync/Half-Async 다.** 수락 루프가 연결을 받아 큐에 넣고 워커 풀이 꺼내 처리한다. 요청 처리 코드는 데이터베이스 질의에서 막혀도 되고, 그 사이 수락 루프는 계속 연결을 받는다. 로깅 라이브러리의 비동기 appender도 같다 — 로그 호출은 큐에 넣고 즉시 돌아오며, 디스크 쓰기는 별도 스레드가 한다. 이 구조 덕에 애플리케이션 스레드가 디스크 지연에 물리지 않는다.

**GUI 툴킷의 "UI 스레드에서만 화면을 만져라"는 규칙이 Active Object 다.** 다른 스레드가 화면을 바꾸려면 요청을 UI 스레드의 큐에 넣어야 하고, 화면 객체는 자기 스레드에서만 만져지므로 락이 없다. 제어 소프트웨어에서 장비 드라이버를 감싸는 프록시도 같은 이유로 같은 모양이다 — 장비는 명령을 겹쳐 받지 못하고, 상위 로직은 장비를 기다릴 시간이 없다.

## 6. 언제 쓰지 말아야 하는가

**스레드가 하나면 넷 다 비용이다.** 이 패턴들은 동시성이 존재할 때만 값을 한다. 단일 스레드 프로그램에 큐와 퓨처를 넣으면 간접 계층과 지연만 늘어난다.

**Monitor 는 여러 객체에 걸친 원자성을 못 준다.** 계좌 A 에서 B 로 옮기는 연산은 두 모니터를 걸쳐 있고, 각 모니터가 자기 안에서만 원자적이면 중간 상태가 밖에서 보인다. 두 락을 동시에 잡으러 가는 순간 **교착의 위험이 생기고**, 그것은 모니터가 풀어 주는 문제가 아니다. 잠금 순서를 전역으로 고정하거나 연산 자체를 한 소유자에게 몰아야 한다. 그리고 **락을 잡은 채 콜백을 부르지 마라.** 그 콜백이 같은 객체로 되돌아오면 재진입이고, 다른 락을 잡으면 교착이다.

**Active Object 는 큐 하나를 병목으로 만든다.** 서번트가 하나이므로 처리량은 그 스레드 하나가 상한이다. 요청이 그보다 빨리 들어오면 지연은 큐 길이에 비례해 늘고, 상한 없는 큐라면 메모리가 터질 때까지 자란다. 게다가 **디버깅에서 호출 스택이 끊긴다.** 예외가 나면 스택 추적에 그 일을 요청한 곳이 없다. 요청에 식별자를 실어 두지 않으면 원인을 못 찾는다.

**Reactor 는 핸들러의 협조에 전적으로 기댄다.** 핸들러 하나가 오래 걸리면 전부가 멈추고, 그것을 강제할 수단이 언어에는 없다. CPU 를 오래 쓰는 작업이 섞이는 시스템에는 맞지 않는다. 콜백으로 흐름이 조각나 "그다음에 무슨 일이 일어나는가"를 코드에서 따라 읽기 어려워지는 것도 실제 비용이다.

**Half-Sync/Half-Async 는 지연의 하한을 만든다.** 큐를 거치는 만큼 최선의 경우가 느려진다. 왕복 지연이 최우선이고 부하가 낮은 시스템이라면 계층을 나누지 않는 쪽이 빠르다.

::: interview
"이 공유 자료에 락을 어떻게 걸겠습니까"라는 질문에 락의 종류를 나열하는 답은 절반이다. 남은 절반은 **"락을 안 걸어도 되게 만들 수 있습니까"**다.

답변 뼈대: ① 이 자료를 정말 여러 스레드가 만져야 하는가, 아니면 소유자를 하나로 정하고 나머지는 메시지를 보내면 되는가. ② 공유가 불가피하면 락을 자료와 함께 캡슐화해 접근 경로를 하나로 만든다. ③ 임계 구역 안에서 I/O 나 콜백을 부르지 않는다. ④ 여러 객체에 걸친 원자성이 필요하면 잠금 순서를 전역으로 고정한다.

"성능을 위해 락을 없앴습니다"에는 반드시 "무엇으로 정확성을 보장했습니까"가 따라온다. 원자적 연산과 메모리 순서는 [XI-3 락과 락프리](#/xi-3)에 있다.
:::

## 연습

::: quiz
설계 질문이다. 코드가 아니라 경계를 답한다.

**1. 로그 수집기.** 초당 5만 줄의 로그를 받아 디스크에 쓴다. 디스크가 가끔 200밀리초 동안 멈춘다. 애플리케이션 스레드는 로그 호출에서 절대 막히면 안 된다.
- 상황: 쓰기 지연이 호출자에게 그대로 전파된다.
- 무엇이 변하고 무엇이 고정인가: 로그를 남긴다는 요구는 고정이다. 변하는 것은 **누가 디스크를 기다리는가**다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 큐로 두 계층을 가른다. 대가는 **손실 가능성**이다 — 큐가 차면 버릴지 막을지를 정해야 하고, 프로세스가 죽으면 큐에 남은 줄은 사라진다.

**2. 장비 드라이버 프록시.** 한 장비에 상위 모듈 다섯이 명령을 보낸다. 장비는 명령을 겹쳐 받으면 오작동한다.
- 상황: 다섯 모듈이 각자 락을 잡고 장비를 만진다.
- 무엇이 변하고 무엇이 고정인가: 명령의 직렬화는 고정이다. 변하는 것은 그 직렬화를 **락으로 할지 큐로 할지**다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 요청을 큐에 싣는다. 대가는 우선순위 문제다 — 긴급 정지 명령이 큐 뒤에 서면 안 되므로 큐를 우선순위 큐로 바꿔야 하고, 그 순간 기아를 걱정해야 한다.

**3. 채팅 서버.** 동시 접속 3만. 각 연결은 대부분의 시간 동안 조용하다.
- 상황: 연결마다 스레드를 세우면 스레드가 3만 개다.
- 무엇이 변하고 무엇이 고정인가: 모든 연결에서 언제든 데이터가 온다는 사실은 고정이다. 변하는 것은 **기다리는 주체의 수**다.
- 어떤 패턴이고 무엇을 대가로 치르는가: 한 루프가 다중화한다. 대가는 핸들러가 짧아야 한다는 제약이고, 메시지 저장 같은 느린 일은 다시 큐 너머로 밀어야 한다.

**4. 어디까지가 과한가.** 위 세 시스템 중 하나를 골라, 요구가 "동시 접속 30, 로그 초당 100줄"로 줄었다고 하자. 어떤 구조를 걷어내고 무엇으로 대신하겠는가. 걷어냈을 때 되찾는 것은 무엇인가.
:::

## 요약

- 동시성 패턴은 알고리즘이 아니라 **책임의 배치**다. 같은 뮤텍스와 큐를 어디에 두느냐만 다르다.
- **Monitor** — 락을 자료와 한 껍질에 넣어 잊을 수 있는 경로를 없앤다. 규율을 요구하는 대신 실수를 불가능하게 만든다.
- **Active Object** — 호출을 큐 위의 메시지로 바꾼다. 호출자는 객체의 시간에 묶이지 않고, 객체 안에는 동시성이 아예 없어진다.
- **Reactor** — 여러 핸들을 한 곳에서 기다렸다 준비된 것만 디스패치한다. 스레드 수를 입력원 수에서 떼어 낸다.
- **Half-Sync/Half-Async** — 막히면 안 되는 계층과 막혀도 되는 계층을 큐로 가른다. Active Object 는 이것의 객체 크기 판이다.
- 뒤의 셋은 **공유 대신 전달**을 택한 것이고, 그래서 락이 사라지는 것이 아니라 필요가 사라진다.
- 대가는 공통이다. 큐가 늘면 지연의 하한이 생기고, 호출 스택이 끊기며, 상한 없는 큐는 메모리를 먹는다. **스레드가 하나면 넷 다 비용일 뿐이다.**

**다음 절**: [XII-14 아키텍처 패턴](#/xii-14) — 같은 가르기를 클래스가 아니라 모듈 단위에서 한다.
