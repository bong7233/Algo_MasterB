# XI-4 스레드 풀과 작업 큐

::: lead
작업 하나마다 스레드 하나를 만들면 일보다 스레드 만드는 값이 더 든다. 미리 만들어 두고 일만 실어 나르는 구조, 그리고 그 구조에서 실제로 결정되는 것들.
:::

## 1. 문제

요청이 들어올 때마다 스레드를 하나 만들어 처리하고 끝나면 버린다. 코드는 세 줄이고 논리는 명확하다. 문제는 값이다.

코어 4개짜리 기계에서 아무 일도 하지 않는 스레드를 2만 번 만들고 join 하면 이렇다.

| 방식 (2만 회, 코어 4) | 중앙값 | 범위 |
|---|---|---|
| Python `threading.Thread` 생성 + 종료 | **143 µs/개** | 137 ~ 153 |
| Python 풀에 작업 제출 | 11 µs/개 | 10 ~ 14 |
| C++ `std::thread` 생성 + 종료 | **64 µs/개** | 61 ~ 69 |
| C++ 풀에 작업 제출 | 0.6 µs/개 | 0.2 ~ 4.3 |

> (Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측, 7회 실행. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 측정 스크립트는 `tools/bench/xi4_thread_cost.py` 와 `tools/bench/xi4_thread_cost.cpp`.)

2만 건이면 Python 은 2.9초, C++ 은 1.3초가 **일과 무관한 관리비**로 나간다. 작업 하나가 밀리초 단위라면 관리비가 일보다 크다. 풀에 맡기면 같은 2만 건의 관리비가 0.22초와 0.012초로 줄어든다. Python 13배, C++ 100배 차이다.

값보다 더 위험한 것은 **개수가 제어되지 않는다**는 사실이다. 동시 요청이 1만 건이면 스레드가 1만 개다. 리눅스에서 스레드 하나의 기본 스택 예약은 보통 8 MB이고(실제로 만지는 만큼만 물리 메모리를 쓰지만 주소 공간은 그만큼 잡힌다), 스케줄러는 1만 개를 코어 4개에 번갈아 올리느라 문맥 전환에 시간을 쓴다. **부하가 오를수록 처리량이 떨어지는 구간**이 생긴다. 부하가 오르면 처리량이 유지되다가 결국 포화되는 것이 정상이고, 오히려 줄어드는 것은 붕괴다.

스레드 풀이 푸는 것은 이 둘이다. **생성 비용을 한 번만 치르고, 동시에 도는 스레드 수에 상한을 둔다.**

## 2. 아이디어

### 2.1 풀은 워커와 큐, 둘뿐이다

```text nolines
   submit --> [ bounded queue ]  --> worker 0 --\
                    ^                 worker 1 --+--> results
                    |                 worker 2 --/
              back-pressure           worker 3
              when full
```

워커는 프로그램이 시작할 때 만들어져 끝날 때까지 산다. 하는 일은 하나다 — 큐에서 작업을 꺼내 실행하고 다시 꺼낸다. 제출하는 쪽은 큐에 넣기만 한다. 이 구조에서 **스레드 수와 작업 수가 분리된다.** 작업이 100만 개여도 스레드는 넷이다.

### 2.2 큐가 심장이다

풀의 성격은 워커가 아니라 큐가 정한다. [XI-2 생산자-소비자와 유계 큐](#/xi-2)의 유계 큐가 그대로 여기에 들어온다.

큐에 상한을 두지 않으면 제출은 절대 막히지 않는다. 좋아 보이지만 그것은 **배압을 없앤 것이 아니라 메모리로 옮긴 것**이다. 처리 속도보다 제출 속도가 빠른 구간이 몇 분만 이어져도 큐 길이가 백만 단위가 되고, 그때 시스템은 두 가지를 동시에 잃는다 — 메모리와, **응답 지연**. 큐에 백만 개가 밀려 있으면 방금 넣은 작업의 완료까지 걸리는 시간은 백만 개를 처리하는 시간이다. 죽지 않았을 뿐 이미 못 쓰는 상태다.

그래서 큐에는 상한이 있어야 하고, 상한이 있으면 **가득 찼을 때 무엇을 할지**를 반드시 정해야 한다.

### 2.3 가득 찼을 때의 정책이 곧 시스템의 성격이다

| 정책 | 무슨 일이 일어나는가 | 어디에 맞는가 |
|---|---|---|
| **막기** | 제출자가 자리가 날 때까지 선다 | 하나도 잃으면 안 되는 작업. 대신 배압이 호출자까지 전파된다 |
| **새것 버리기** | 방금 온 것을 버린다 | 최신값이 곧 다음에 또 오는 것 — 센서 표본, 화면 갱신 |
| **오래된 것 버리기** | 큐 앞을 버리고 새것을 넣는다 | 최신 상태가 중요한 것. 낡은 명령은 의미가 없다 |
| **거부** | 실패를 호출자에게 알린다 | 호출자가 재시도·대체 경로를 아는 경우. HTTP 503이 이것이다 |
| **호출자 실행** | 제출자가 그 자리에서 직접 처리한다 | 제출 속도를 자연스럽게 늦추는 자동 조절 장치 |

**버리는 것이 항상 나쁜 것은 아니다.** 1 kHz 로 오는 센서 표본을 다 처리하지 못한다면, 밀린 표본을 붙들고 있다가 늦게 처리하는 것보다 버리고 최신 것을 보는 편이 옳다. 반대로 결제 요청이라면 버리는 순간 사고다. **이 선택은 자료구조가 아니라 도메인이 한다.** 4.2에서 다섯 정책이 같은 입력에 어떻게 다른 답을 내는지 본다.

### 2.4 큐 하나가 병목이 된다

중앙 큐 하나에 워커 넷이 붙으면 모든 워커가 **같은 락을 두고 다툰다.** 작업 하나가 충분히 크면 문제가 안 된다. 작업이 작을수록 락을 잡는 빈도가 올라가고, 어느 지점부터는 일하는 시간보다 줄 서는 시간이 길어진다.

해법은 큐를 쪼개는 것이다. 워커마다 자기 덱을 두고, 자기 덱이 비었을 때만 남의 덱에서 훔쳐 온다.

```text nolines
   worker 0: [ a b c ] <- own push/pop here (back)
                ^
                |  steal from the front
   worker 1: [ ] --+
```

방향이 핵심이다. **자기 것은 뒤에서 꺼내고, 훔치는 것은 앞에서 가져간다.** 두 가지 이유가 있다.

첫째, 부딪히지 않는다. 주인과 도둑이 덱의 반대쪽 끝을 만지므로, 덱에 항목이 둘 이상이면 둘은 서로를 기다릴 일이 없다. 4.1의 중앙 큐가 하나의 문을 두고 넷이 다투는 것과 대비된다.

둘째, 캐시와 작업 크기다. 자기가 방금 넣은 항목은 캐시에 남아 있고, 재귀적으로 일을 쪼개는 작업이라면 **뒤쪽이 잘게 쪼개진 작은 조각, 앞쪽이 아직 안 쪼개진 큰 덩어리**다. 도둑이 앞에서 가져가면 한 번 훔칠 때 큰 덩어리를 가져가므로 훔치는 횟수 자체가 줄어든다.

### 2.5 풀의 크기

워커 수를 정하는 기준은 작업의 성격이다.

- **CPU 바운드**면 코어 수가 상한이다. 그 이상은 문맥 전환만 늘린다.
- **I/O 바운드**면 코어 수보다 많아야 한다. 워커 대부분이 응답을 기다리며 잠들어 있기 때문이다.
- **섞여 있으면 풀을 나눈다.** 하나의 풀에 두 성격을 넣으면 느린 쪽이 빠른 쪽의 자리를 다 차지한다.

Python 에는 여기에 하나가 더 붙는다. **CPU 바운드 작업은 스레드를 늘려도 빨라지지 않는다.** 그 수치는 §5에 있다.

## 3. 손으로 따라가기

::: trace
워커 0의 덱에 작업 여섯 개가 들어 있고 워커 1의 덱은 비어 있다. 덱은 왼쪽이 앞, 오른쪽이 뒤다.

규칙은 둘이다 — **자기 덱은 뒤에서 꺼낸다. 자기 덱이 비었으면 남의 덱 앞에서 훔친다.**

여섯 개가 모두 처리될 때까지 표를 채워라. 그리고 두 질문에 답하라. ① 두 워커가 **같은 작업**을 집을 수 있는 스텝이 있는가. ② 있다면 덱에 항목이 몇 개일 때인가.

| 스텝 | 워커 0 | 워커 1 | 덱0 (앞 → 뒤) | 덱1 |
|---|---|---|---|---|
| 0 | | | 0 1 2 3 4 5 | (빔) |
| 1 | 자기 뒤에서 5 | | 0 1 2 3 4 | (빔) |
| 2 | | 덱0 앞에서 0 훔침 | 1 2 3 4 | (빔) |
| 3 | 자기 뒤에서 4 | | 1 2 3 | (빔) |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
:::

::: answer

| 스텝 | 워커 0 | 워커 1 | 덱0 (앞 → 뒤) | 덱1 |
|---|---|---|---|---|
| 0 | | | 0 1 2 3 4 5 | (빔) |
| 1 | 자기 뒤에서 5 | | 0 1 2 3 4 | (빔) |
| 2 | | 덱0 앞에서 0 훔침 | 1 2 3 4 | (빔) |
| 3 | 자기 뒤에서 4 | | 1 2 3 | (빔) |
| 4 | | 덱0 앞에서 1 훔침 | 2 3 | (빔) |
| 5 | 자기 뒤에서 3 | | 2 | (빔) |
| 6 | 자기 뒤에서 **2** | 덱0 앞에서 **2** 훔침 | (빔) | (빔) |

① 있다. ② **덱에 항목이 하나 남았을 때다.** 그 하나는 앞이자 뒤이므로, 주인이 뒤에서 꺼내려는 것과 도둑이 앞에서 훔치려는 것이 같은 항목이 된다.

항목이 둘 이상이면 두 워커는 서로 다른 끝을 만지므로 동기화 없이도 부딪히지 않는다. **경계는 마지막 하나에서만 생긴다.** 그래서 실제 워크 스틸링 덱의 구현은 이 한 지점을 원자적 연산으로 처리한다 — 주인도 도둑도 마지막 항목을 가져갈 때만 CAS 로 인덱스를 다투고, 진 쪽은 빈손으로 돌아간다. 4.3의 구현은 덱마다 락을 하나씩 둬서 같은 문제를 더 단순하게 푼다.

이 표에서 하나 더 읽을 것이 있다. 워커 1이 훔친 것은 `0`과 `1`, 즉 **가장 오래 전에 넣은 것들**이다. 훔치기가 앞에서 일어나기 때문에 작업의 처리 순서는 FIFO 도 LIFO 도 아니다. **워크 스틸링 풀에서 제출 순서가 처리 순서가 아니라는 것은 버그가 아니라 설계다.**
:::

## 4. 구현

### 4.1 최소 스레드 풀

워커 넷, 유계 큐, 그리고 종료. 종료는 **독약(poison pill)** 으로 한다 — 워커 수만큼 "이제 그만"을 큐에 넣으면 각 워커가 하나씩 먹고 빠져나간다.

::: dual
```python title="최소 스레드 풀 — 유계 큐와 독약 종료"
import queue
import threading

N_WORKERS, N_TASKS = 4, 200          # 코어 4
tasks = queue.Queue(maxsize=16)      # 유계 큐 — 이 16이 배압의 크기다
results = [0] * N_TASKS
POISON = None                        # 독약 — 워커에게 "이제 그만" 이라고 말하는 항목


def worker():
    while True:
        job = tasks.get()
        if job is POISON:            # 독약을 먹은 워커는 빠져나간다
            tasks.task_done()
            return
        i, n = job
        results[i] = n * n
        tasks.task_done()


ws = [threading.Thread(target=worker) for _ in range(N_WORKERS)]
for w in ws:
    w.start()

for i in range(N_TASKS):
    tasks.put((i, i))                # 큐가 가득이면 여기서 막힌다 = 배압

for _ in ws:
    tasks.put(POISON)                # 워커 수만큼 넣어야 전부 빠져나간다
for w in ws:
    w.join()

print(f"작업 {N_TASKS}개 · 워커 {N_WORKERS} · 결과 합 {sum(results)}")
```
```cpp title="최소 스레드 풀 — 유계 큐와 독약 종료"
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <queue>
#include <thread>
#include <utility>
#include <vector>
using namespace std;

const int N_WORKERS = 4, N_TASKS = 200;   // 코어 4
const size_t CAP = 16;                    // 유계 큐 — 이 16이 배압의 크기다
queue<pair<int, int>> tasks;
mutex mtx;
condition_variable not_full, not_empty;
vector<long long> results(N_TASKS, 0);
const pair<int, int> POISON = {-1, -1};   // 독약 — 워커에게 "이제 그만" 이라고 말하는 항목

void put(pair<int, int> job) {
    unique_lock<mutex> lk(mtx);
    not_full.wait(lk, [] { return tasks.size() < CAP; });   // 가득이면 여기서 막힌다 = 배압
    tasks.push(job);
    lk.unlock();
    not_empty.notify_one();
}

pair<int, int> get() {
    unique_lock<mutex> lk(mtx);
    not_empty.wait(lk, [] { return !tasks.empty(); });
    pair<int, int> job = tasks.front();
    tasks.pop();
    lk.unlock();
    not_full.notify_one();
    return job;
}

void worker() {
    while (true) {
        pair<int, int> job = get();
        if (job == POISON) return;        // 독약을 먹은 워커는 빠져나간다
        results[job.first] = (long long)job.second * job.second;
    }
}

int main() {
    vector<thread> ws;
    for (int k = 0; k < N_WORKERS; k++) ws.emplace_back(worker);

    for (int i = 0; i < N_TASKS; i++) put({i, i});
    for (int k = 0; k < N_WORKERS; k++) put(POISON);   // 워커 수만큼 넣어야 전부 빠져나간다
    for (auto& w : ws) w.join();

    long long s = 0;
    for (long long v : results) s += v;
    printf("작업 %d개 · 워커 %d · 결과 합 %lld\n", N_TASKS, N_WORKERS, s);
    return 0;
}
```
:::

```console
작업 200개 · 워커 4 · 결과 합 2646700
```

**복잡도:** 작업 하나당 큐 연산이 넣기 한 번, 꺼내기 한 번으로 시간 $O(1)$이다. 상수는 4.1의 제출 비용 — Python 11 µs, C++ 0.6 µs. 전체는 작업 $n$개에 대해 $O(n / p)$로 줄어들지만 그것은 **작업이 서로 독립이고 $p$개의 코어가 실제로 동시에 돌 때만**이고, 경합 하에서는 큐 락 하나가 처리량의 상한이 된다(4.3). 공간은 큐 상한 $O(\text{CAP})$ + 워커 $p$개의 스택.

| 언어 차이 | Python | C++ |
|---|---|---|
| 유계 큐 | `queue.Queue(maxsize=)` 가 락·조건변수를 내장한다 | `std::queue` + `mutex` + `condition_variable` 둘을 직접 조립한다 |
| 조건변수 개수 | 감춰져 있다 | `not_full`, `not_empty` 둘이 필요하다. 하나로 하면 엉뚱한 쪽을 깨운다 |
| 표준 풀 | `concurrent.futures.ThreadPoolExecutor` | 표준에 없다. 직접 짜거나 라이브러리 |
| 스레드 강제 종료 | 없다. 협조적 종료뿐이다 | 없다. `pthread_cancel` 은 C++ 객체 소멸과 어울리지 않아 사실상 못 쓴다 |
| 협조적 취소 | `threading.Event` 를 워커가 확인 | C++20 `std::jthread` + `stop_token`. C++17 이면 `atomic<bool>` 플래그를 직접 |

::: pitfall
- **독약을 하나만 넣는다.** 워커 하나만 빠져나가고 나머지 셋은 영원히 `get()` 에서 기다린다. 워커 수만큼 넣거나, 종료 플래그를 세우고 `notify_all` 로 전부 깨워야 한다.
- **워커가 죽은 채로 풀이 살아 있다.** 작업이 예외를 던지면 워커 루프가 통째로 끝난다. 워커가 하나씩 조용히 사라지다가 마지막 하나가 죽으면 제출은 성공하는데 아무것도 처리되지 않는다. **작업 실행은 반드시 예외 처리로 감싸고, 예외는 삼키지 말고 결과로 돌려준다.**
- **풀 안의 작업이 같은 풀의 결과를 기다린다.** 워커 넷이 전부 자식 작업의 완료를 기다리면 그 자식들을 실행할 워커가 없다. 큐에는 일이 있는데 아무도 못 꺼내는 **교착**이다. 부모-자식 작업이 있는 구조에서는 풀을 나누거나, 기다리는 대신 워커가 큐를 대신 처리하게 만들어야 한다.
- **종료 시 `join` 을 빼먹는다.** 워커가 결과를 다 쓰기 전에 주 스레드가 결과를 읽는다. 위 코드의 `join` 이 "워커의 모든 쓰기가 이 지점 앞에 일어났다"를 보장하는 지점이다.
:::

### 4.2 큐가 가득 찼을 때 — 다섯 정책이 내는 다섯 개의 답

정책의 차이를 보려면 타이밍을 고정해야 한다. 여기서는 스레드를 쓰지 않고 **제출과 소비의 순서를 대본으로 고정해서** 돌린다. 용량 2, 제출 8건, 워커는 세 건마다 하나씩 꺼낸다.

::: dual
```python title="큐 포화 정책 — 같은 입력, 다섯 개의 답"
CAP, N = 2, 8            # 큐 용량 2, 제출 8건. 워커는 세 건마다 하나씩 꺼낸다


def simulate(policy):
    q, done = [], []
    lost = rejected = stalled = 0
    for i in range(N):
        if len(q) < CAP:
            q.append(i)
        elif policy == "막기":
            stalled += 1
            done.append(q.pop(0))    # 자리가 날 때까지 제출자가 선다
            q.append(i)
        elif policy == "새것 버리기":
            lost += 1
        elif policy == "오래된 것 버리기":
            lost += 1
            q.pop(0)
            q.append(i)
        elif policy == "거부":
            rejected += 1            # 호출자에게 실패를 알린다
        elif policy == "호출자 실행":
            stalled += 1
            done.append(i)           # 제출자가 그 자리에서 직접 처리한다
        if i % 3 == 2:               # 워커가 하나 꺼내 처리한다
            if q:
                done.append(q.pop(0))
    while q:
        done.append(q.pop(0))
    return done, lost, rejected, stalled


for policy in ("막기", "새것 버리기", "오래된 것 버리기", "거부", "호출자 실행"):
    done, lost, rejected, stalled = simulate(policy)
    order = " ".join(str(x) for x in done)
    print(f"{policy}: 처리 {len(done)}건 [{order}] · 잃음 {lost} · 거부 {rejected} · 제출자 멈춤 {stalled}")
```
```cpp title="큐 포화 정책 — 같은 입력, 다섯 개의 답"
#include <deque>
#include <iostream>
#include <string>
#include <vector>
using namespace std;

const int CAP = 2, N = 8;   // 큐 용량 2, 제출 8건. 워커는 세 건마다 하나씩 꺼낸다

struct Result {
    vector<int> done;
    int lost = 0, rejected = 0, stalled = 0;
};

Result simulate(const string& policy) {
    deque<int> q;
    Result r;
    for (int i = 0; i < N; i++) {
        if ((int)q.size() < CAP) {
            q.push_back(i);
        } else if (policy == "막기") {
            r.stalled++;
            r.done.push_back(q.front());   // 자리가 날 때까지 제출자가 선다
            q.pop_front();
            q.push_back(i);
        } else if (policy == "새것 버리기") {
            r.lost++;
        } else if (policy == "오래된 것 버리기") {
            r.lost++;
            q.pop_front();
            q.push_back(i);
        } else if (policy == "거부") {
            r.rejected++;                  // 호출자에게 실패를 알린다
        } else if (policy == "호출자 실행") {
            r.stalled++;
            r.done.push_back(i);           // 제출자가 그 자리에서 직접 처리한다
        }
        if (i % 3 == 2) {                  // 워커가 하나 꺼내 처리한다
            if (!q.empty()) {
                r.done.push_back(q.front());
                q.pop_front();
            }
        }
    }
    while (!q.empty()) {
        r.done.push_back(q.front());
        q.pop_front();
    }
    return r;
}

int main() {
    for (const string& policy : {"막기", "새것 버리기", "오래된 것 버리기", "거부", "호출자 실행"}) {
        Result r = simulate(policy);
        string order;
        for (size_t i = 0; i < r.done.size(); i++)
            order += (i ? " " : "") + to_string(r.done[i]);
        cout << policy << ": 처리 " << r.done.size() << "건 [" << order << "] · 잃음 "
             << r.lost << " · 거부 " << r.rejected << " · 제출자 멈춤 " << r.stalled << "\n";
    }
    return 0;
}
```
:::

```console
막기: 처리 8건 [0 1 2 3 4 5 6 7] · 잃음 0 · 거부 0 · 제출자 멈춤 4
새것 버리기: 처리 4건 [0 1 3 6] · 잃음 4 · 거부 0 · 제출자 멈춤 0
오래된 것 버리기: 처리 4건 [1 4 6 7] · 잃음 4 · 거부 0 · 제출자 멈춤 0
거부: 처리 4건 [0 1 3 6] · 잃음 0 · 거부 4 · 제출자 멈춤 0
호출자 실행: 처리 8건 [2 0 4 5 1 7 3 6] · 잃음 0 · 거부 0 · 제출자 멈춤 4
```

**복잡도:** 정책 판정은 제출 한 건당 $O(1)$이다. 갈리는 것은 복잡도가 아니라 **보장**이다 — 위 다섯 줄이 같은 입력에 대해 처리 건수 8, 4, 4, 4, 8과 서로 다른 처리 순서를 냈다. 공간은 모두 $O(\text{CAP})$이고, 상한을 없앤 판만 $O(n)$으로 자란다.

네 줄이 특히 읽을 만하다.

- **막기**만 여덟 건을 순서대로 처리했다. 대신 제출자가 네 번 섰다. 그 네 번이 호출자에게 전파되는 배압이다.
- **새것 버리기**와 **거부**의 처리 결과는 같다(`0 1 3 6`). 차이는 오직 **호출자가 아는가**다. 버리기는 조용히 사라지고, 거부는 호출자가 재시도하거나 다른 경로를 택할 기회를 준다. 관측 가능성 면에서 거부가 거의 항상 낫다.
- **오래된 것 버리기**는 `1 4 6 7` — 뒤쪽 값이 살아남았다. 최신 상태가 중요한 자리의 정답이다.
- **호출자 실행**은 순서가 `2 0 4 5 1 7 3 6` 으로 뒤집혔다. 제출자가 중간에 직접 처리하기 때문이다. 하나도 안 잃지만 **순서 보장이 사라지고**, 제출자가 그동안 다른 일을 못 한다. 제출 속도를 자동으로 늦추는 장치이면서 동시에 제출자의 지연을 예측 불가능하게 만든다.

### 4.3 워크 스틸링

작업 2만 건을 **전부 워커 0의 덱에만** 넣고 넷을 동시에 출발시킨다. 나머지 셋은 훔치지 않으면 아무 일도 못 한다.

::: dual
```python title="워크 스틸링 — 자기 것은 뒤에서, 남의 것은 앞에서"
import threading
from collections import deque

N_WORKERS, N_TASKS = 4, 20000         # 코어 4
decks = [deque() for _ in range(N_WORKERS)]
locks = [threading.Lock() for _ in range(N_WORKERS)]
decks[0].extend(range(N_TASKS))       # 일부러 한 워커에게 전부 몰아 둔다
go = threading.Event()
processed = [0] * N_WORKERS
stolen = [0] * N_WORKERS
acc = [0] * N_WORKERS


def take_own(w):                      # 자기 덱은 뒤에서 꺼낸다 — 방금 넣은 것이 캐시에 남아 있다
    with locks[w]:
        return decks[w].pop() if decks[w] else None


def steal(w):                         # 남의 덱은 앞에서 훔친다 — 주인과 반대쪽이라 덜 부딪힌다
    for k in range(1, N_WORKERS):
        v = (w + k) % N_WORKERS
        with locks[v]:
            if decks[v]:
                return decks[v].popleft()
    return None


def worker(w):
    go.wait()
    while True:
        job = take_own(w)
        if job is None:
            job = steal(w)
            if job is None:
                return                # 내 덱도 비고 훔칠 것도 없다
            stolen[w] += 1
        processed[w] += 1
        acc[w] += job % 7


ws = [threading.Thread(target=worker, args=(w,)) for w in range(N_WORKERS)]
for w in ws:
    w.start()
go.set()
for w in ws:
    w.join()

print(f"처리 {sum(processed)}건 · 합계 {sum(acc)} · 유실 {N_TASKS - sum(processed)}건")
```
```cpp title="워크 스틸링 — 자기 것은 뒤에서, 남의 것은 앞에서"
#include <atomic>
#include <cstdio>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int N_WORKERS = 4, N_TASKS = 20000;   // 코어 4
struct Deck {
    deque<int> d;
    mutex mtx;
};
vector<Deck> decks(N_WORKERS);
atomic<bool> go{false};
vector<int> processed(N_WORKERS, 0);
vector<int> stolen(N_WORKERS, 0);
vector<long long> acc(N_WORKERS, 0);

int take_own(int w) {          // 자기 덱은 뒤에서 꺼낸다 — 방금 넣은 것이 캐시에 남아 있다
    lock_guard<mutex> g(decks[w].mtx);
    if (decks[w].d.empty()) return -1;
    int job = decks[w].d.back();
    decks[w].d.pop_back();
    return job;
}

int steal(int w) {             // 남의 덱은 앞에서 훔친다 — 주인과 반대쪽이라 덜 부딪힌다
    for (int k = 1; k < N_WORKERS; k++) {
        Deck& v = decks[(w + k) % N_WORKERS];
        lock_guard<mutex> g(v.mtx);
        if (!v.d.empty()) {
            int job = v.d.front();
            v.d.pop_front();
            return job;
        }
    }
    return -1;
}

void worker(int w) {
    while (!go.load()) this_thread::yield();
    while (true) {
        int job = take_own(w);
        if (job < 0) {
            job = steal(w);
            if (job < 0) return;   // 내 덱도 비고 훔칠 것도 없다
            stolen[w] += 1;
        }
        processed[w] += 1;
        acc[w] += job % 7;
    }
}

int main() {
    for (int i = 0; i < N_TASKS; i++) decks[0].d.push_back(i);   // 일부러 한 워커에게 전부 몰아 둔다
    vector<thread> ws;
    for (int w = 0; w < N_WORKERS; w++) ws.emplace_back(worker, w);
    go.store(true);
    for (auto& t : ws) t.join();

    int done = 0;
    long long s = 0;
    for (int w = 0; w < N_WORKERS; w++) { done += processed[w]; s += acc[w]; }
    printf("처리 %d건 · 합계 %lld · 유실 %d건\n", done, s, N_TASKS - done);
    return 0;
}
```
:::

```console
처리 20000건 · 합계 59997 · 유실 0건
```

**복잡도:** 작업 하나를 꺼내는 것은 $O(1)$이고, 훔치기는 최악에 다른 덱 $p-1$개를 훑으므로 $O(p)$다. 훔치기는 자기 덱이 빌 때만 일어나므로 총 훔침 횟수는 작업 수가 아니라 **불균형의 정도**에 비례한다. 공간은 $O(n + p)$.

처리량 차이는 실측으로만 말할 수 있다.

| 실험 (작업 200만 건, 워커 4, 코어 4) | 중앙값 | 범위 |
|---|---|---|
| 중앙 큐 하나 | 0.10초 | 0.08 ~ 0.12 |
| 워커별 덱 + 훔치기 | **0.04초** | 0.03 ~ 0.04 |

> (Linux x86-64 / g++ 13 `-O2` 실측, 5회 실행. 큐를 채우는 시간을 포함한 값이다. 측정 스크립트는 `tools/bench/xi4_pool_scaling.cpp`.)

2.4배다. 작업 하나가 무거우면 이 차이는 묻힌다 — **워크 스틸링이 값을 하는 것은 작업이 작고 많을 때**다.

::: warn
훔치기는 부하를 **완전히 균등하게** 만들지 않는다. 위 실험에서 워커별 처리 건수를 세면 최다 워커의 몫이 다음과 같다.

| 언어 (작업 2만 건 전부를 워커 0에 몰아 둠, 10회 실행) | 최다 워커 몫 중앙값 | 범위 |
|---|---|---|
| C++ | 47% | 33 ~ 72% |
| Python | **76%** | 34 ~ 100% |

이상적인 분배는 25%다. C++ 은 열 회 모두 넷이 나눠 가졌지만 처음부터 덱을 쥔 워커 0이 유리하다 — 그는 훔치지 않고 자기 것을 꺼내기만 하면 되기 때문이다. Python 은 10회 중 2회가 **워커 0 혼자 2만 건을 전부 처리**했다. GIL 때문에 나머지 셋이 실행 기회를 거의 못 받는다. 같은 코드가 두 언어에서 다른 그림을 만든다. (측정 스크립트는 `tools/bench/xi4_work_stealing.py` 와 `tools/bench/xi4_work_stealing.cpp`.)
:::

| 언어 차이 | Python | C++ |
|---|---|---|
| 양끝 자료구조 | `collections.deque` — `pop()`/`popleft()` 둘 다 $O(1)$ | `std::deque` — `pop_back()`/`pop_front()` 둘 다 $O(1)$ |
| 실제 병렬 실행 | 되지 않는다. 위 표의 76%가 그 결과다 | 된다 |
| 이 구조를 쓸 이유 | CPU 바운드에는 없다. I/O 바운드거나 `multiprocessing` 일 때 | 있다. 작고 많은 작업에서 2.4배 |
| 실전 구현 | 표준에 없다 | 표준에 없다. 마지막 한 항목을 CAS 로 다투는 Chase-Lev 덱이 정석 |

## 5. GIL 이 만드는 갈림길

같은 작업량을 여덟 청크로 쪼개 1스레드 / 4스레드 / 4프로세스로 돌렸다. 코어는 4개다.

| 작업 성격 | 방식 | 중앙값 | 1스레드 대비 |
|---|---|---|---|
| CPU 바운드 (정수 루프) | Python 스레드 1 | 1.8초 | — |
| | Python 스레드 4 | 2.0초 | **0.93배 (더 느리다)** |
| | Python 프로세스 4 | 0.60초 | 3.1배 |
| | C++ 워커 1 | 0.75초 | — |
| | C++ 워커 4 | 0.26초 | 2.9배 |
| I/O 바운드 (`sleep`) | Python 스레드 1 | 0.40초 | — |
| | Python 스레드 4 | 0.10초 | 4.0배 |
| | Python 스레드 8 | 0.05초 | 7.7배 |

> (Linux x86-64 / CPython 3.13(GIL 켜짐) / g++ 13 `-O2` 실측, 5회 실행. 측정 스크립트는 `tools/bench/xi4_gil_scaling.py` 와 `tools/bench/xi4_pool_scaling.cpp`.)

세 줄이 결론이다.

**CPU 바운드에서 Python 스레드 풀은 0.93배다.** 빨라지지 않는 정도가 아니라 조금 느려진다. 스레드가 GIL 을 주고받는 비용만 추가되기 때문이다. 워커를 8, 16으로 늘려도 이 벽은 그대로다.

**I/O 바운드에서는 스레드가 정확히 값을 한다.** 4스레드에 4.0배, 8스레드에 7.7배다. 코어가 4개인데 8스레드가 7.7배인 이유는 CPU 를 쓰는 것이 아니라 기다리는 것이기 때문이다 — 대기 중에는 GIL 이 풀린다. **I/O 바운드 풀의 크기는 코어 수가 아니라 동시에 기다릴 수 있는 개수로 정한다.**

**그러므로 Python 에서 갈림길은 세 갈래다.**

| 상황 | 답 | 이유 |
|---|---|---|
| I/O 바운드, 동시성 수백까지 | `ThreadPoolExecutor` | GIL 이 대기 중에 풀린다. 코드가 동기 그대로다 |
| I/O 바운드, 동시성 수천 이상 | `asyncio` | 스레드 하나에 수천 개의 대기를 얹는다. 스레드 스택 비용이 사라진다 |
| CPU 바운드 | `ProcessPoolExecutor` | 프로세스마다 인터프리터가 따로라 GIL 이 따로다. 위 표의 3.1배 |

`ProcessPoolExecutor` 의 대가는 명확하다. 인자와 결과가 **직렬화되어 프로세스 사이를 오간다.** 작업 하나가 큰 배열을 주고받으면 그 전송 비용이 이득을 먹는다. 그래서 프로세스 풀은 "인자는 작고 계산은 무거운" 작업에 맞는다.

::: note
CPython 3.13에는 GIL 을 끈 free-threaded 빌드(PEP 703)가 있다. 다만 **기본 빌드는 GIL 이 켜져 있다.** 이 절의 모든 수치는 `sys._is_gil_enabled()` 가 `True` 인 환경에서 잰 것이다. 자기 환경이 어느 쪽인지는 그 한 줄로 확인하고 시작하라 — 확인 없이 "3.13부터는 GIL 이 없다"고 가정하면 위 표의 첫 줄에서 정확히 무너진다.
:::

## 6. 어디에 쓰이는가

**웹 서버의 워커 풀이 가장 흔한 얼굴이다.** 수락 루프가 연결을 받아 큐에 넣고 고정된 워커들이 꺼내 처리한다. 워커 수가 곧 동시 처리 수의 상한이고, 큐가 가득 찼을 때 반환하는 것이 503이다. 4.2의 "거부" 정책이 그대로 HTTP 상태 코드가 된 것이다.

**JVM 의 `ForkJoinPool`, 인텔 TBB, Rust 의 Rayon 이 전부 워크 스틸링이다.** 공통점은 작업을 재귀적으로 쪼갠다는 것이다 — 배열을 반으로 가르고 또 반으로 가르면 작은 작업이 폭발적으로 늘어난다. 그 상황이 중앙 큐가 가장 못 버티는 상황이고, 워크 스틸링이 정확히 그 자리에 있다.

**이미지·포인트클라우드 처리 파이프라인이 같은 구조다.** 프레임 하나를 타일로 쪼개 풀에 던지고, 워커가 코어 수만큼 병렬로 처리한다. 여기서 풀 크기를 코어 수로 고정하는 이유는 성능이 아니라 **예측 가능성**이다 — 같은 기계에서 도는 제어 루프가 코어를 빼앗기면 주기를 놓친다.

**데이터베이스 커넥션 풀도 같은 자료구조다.** 다른 것은 큐에 담기는 것이 작업이 아니라 자원이라는 점뿐이고, 나머지는 똑같다. 상한이 있고, 가득 찼을 때의 정책이 있고, 대기 시간이 곧 배압이다.

::: interview
"스레드 풀 크기를 어떻게 정하시겠습니까"는 숫자를 묻는 질문이 아니라 **작업의 성격을 구분할 줄 아는지**를 묻는 질문이다.

답변 뼈대: ① 작업이 CPU 바운드인지 I/O 바운드인지 먼저 가른다. CPU 바운드면 코어 수가 상한이고 그 이상은 문맥 전환만 는다. I/O 바운드면 대기 시간과 처리 시간의 비로 어림한다. ② 두 성격이 섞여 있으면 풀을 나눈다. 하나의 풀에 넣으면 느린 쪽이 자리를 다 차지한다. ③ 크기보다 먼저 정해야 하는 것은 **큐의 상한과 가득 찼을 때의 정책**이다. 상한이 없으면 크기를 아무리 잘 정해도 지연이 무한히 자란다. ④ Python 이면 CPU 바운드에서 스레드가 답이 아니라는 것까지 말한다.

"풀에서 교착이 날 수 있습니까"도 자주 따라온다. 있다 — 풀 안의 작업이 같은 풀에 제출한 작업의 결과를 기다리면, 워커가 전부 대기에 들어가고 그 자식들을 실행할 워커가 없다.
:::

## 연습

::: quiz
코드가 아니라 경계를 답한다. 각 상황에서 **무엇이 경쟁하는가 → 어떤 구조인가 → 무엇을 대가로 치르는가**를 쓴다.

**1. 로그 수집 에이전트.** 애플리케이션이 초당 5만 줄을 남긴다. 디스크가 가끔 200 ms 멈춘다. 로그 호출은 절대 막히면 안 되고, 몇 줄쯤 잃어도 된다.
- 무엇이 경쟁하는가: 애플리케이션 스레드와 디스크 쓰기 스레드가 같은 버퍼를 만진다.
- 어떤 구조인가: 유계 큐 + 쓰기 워커 하나. 가득 차면 **새것 버리기**이고, 버린 줄 수를 카운터로 남긴다.
- 대가: 버린 줄은 돌아오지 않는다. 그리고 "몇 줄 잃어도 된다"는 판단은 도메인이 하는 것이지 자료구조가 하는 것이 아니다.

**2. 썸네일 생성 서비스.** 요청마다 이미지 한 장을 리사이즈한다. 요청은 초당 수백 건, 한 건에 CPU 30 ms. 코어는 4개다.
- 무엇이 경쟁하는가: 요청 수가 코어 수를 크게 넘는다.
- 어떤 구조인가: 워커 4개 고정 풀 + 유계 큐 + **거부**. 큐 상한은 허용 지연을 처리 시간으로 나눠 정한다.
- 대가: 거부당한 요청의 처리를 호출자가 책임진다. 상한을 키우면 거부는 줄지만 대기 시간이 그만큼 늘어난다 — **거부를 지연으로 바꾸는 것일 뿐 없애는 것이 아니다.**

**3. 병렬 정렬.** 배열을 재귀적으로 반씩 갈라 정렬한다. 깊이가 깊어질수록 작업이 잘아진다.
- 무엇이 경쟁하는가: 작은 작업이 폭발적으로 늘어 중앙 큐의 락이 병목이 된다.
- 어떤 구조인가: 워커별 덱 + 훔치기. 자기 것은 뒤에서, 남의 것은 앞에서.
- 대가: 처리 순서 보장이 사라지고, 마지막 한 항목의 경계 처리가 필요하다. 그리고 조각이 충분히 작아지면 **쪼개기를 멈추고 순차 정렬로 내려가야 한다** — 안 그러면 관리비가 일보다 커진다.

**4. 크롤러.** URL 수천 개를 가져온다. 한 건에 네트워크 대기 200 ms, CPU 는 거의 안 쓴다. Python 이다.
- 무엇이 경쟁하는가: 거의 없다. 대부분의 시간이 대기다.
- 어떤 구조인가: 동시성이 수백까지면 `ThreadPoolExecutor`, 수천 이상이면 `asyncio`. 어느 쪽이든 **동시 요청 수에 상한**을 둔다.
- 대가: 상한을 없애면 상대 서버를 때리고 자기 파일 디스크립터를 소진한다. 여기서 풀 크기는 성능 조절기가 아니라 **예의이자 안전장치**다.

**5. 어디까지가 과한가.** 2번의 요구가 "초당 5건, 지연은 아무래도 좋다"로 줄었다. 풀과 큐를 걷어내면 무엇을 되찾고 무엇을 잃는가.
:::

## 요약

- 작업마다 스레드를 만들면 생성·종료가 지배한다 — 코어 4에서 Python 143 µs, C++ 64 µs. 풀에 제출하면 11 µs와 0.6 µs다.
- 풀이 푸는 것은 비용만이 아니다. **동시에 도는 스레드 수에 상한이 생긴다.** 상한 없는 스레드는 부하가 오를수록 처리량이 떨어지는 구간을 만든다.
- **큐가 풀의 심장이다.** 상한 없는 큐는 배압을 없앤 것이 아니라 메모리와 지연으로 옮긴 것이다.
- 가득 찼을 때의 정책 — 막기·새것 버리기·오래된 것 버리기·거부·호출자 실행 — 이 같은 입력에 다섯 개의 다른 답을 낸다. 버리기와 거부는 결과가 같고 **호출자가 아는가**만 다르다.
- 중앙 큐 하나는 작업이 작고 많을 때 락 병목이 된다. 워커별 덱 + 훔치기가 실측 2.4배. **자기 것은 뒤에서, 남의 것은 앞에서** 꺼내는 것이 규칙이고, 항목이 하나 남았을 때만 경계가 생긴다.
- Python 은 CPU 바운드에서 4스레드가 **0.93배**다. I/O 바운드에서는 4스레드 4.0배, 8스레드 7.7배다. 그래서 갈림길은 `ThreadPoolExecutor` / `asyncio` / `ProcessPoolExecutor` 셋이다.
- 종료는 설계의 일부다. 독약은 워커 수만큼 넣어야 하고, 작업의 예외는 워커를 조용히 죽인다. 그리고 **풀 안의 작업이 같은 풀을 기다리면 교착이다.**

**다음 절**: [XI-5 실시간 스케줄링 개념](#/xi-5) — 풀이 일을 나누는 것과 달리, 마감이 있는 일을 언제 실행할지 정하는 문제로 간다.
