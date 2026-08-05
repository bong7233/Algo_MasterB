# XI-7 이벤트 루프와 백프레셔

::: lead
연결 1만 개를 스레드 1만 개로 받을 수 없다면 무엇으로 받는가. 그리고 들어오는 속도가 처리하는 속도를 넘는 순간 무엇을 버릴 것인가.
:::

## 1. 문제

메시지 게이트웨이 하나가 장비 1만 대의 연결을 받는다. 각 연결은 대부분 조용하고, 초당 한 번 짧은 상태 보고를 올린다. 가장 단순한 구조는 [XI-2 생산자-소비자와 유계 큐](#/xi-2)에서 본 그대로다 — 연결 하나에 스레드 하나를 붙이고 그 스레드는 `recv`에서 잠들어 있는다. 코드가 짧고 읽기 쉽다. 연결마다 상태가 그 스레드의 지역 변수로 자연스럽게 남는다.

이 구조가 1만 개에서 무엇을 요구하는지 재 보면 답이 나온다.

::: perf
스레드 1,000개를 띄우고 `/proc/self/status`의 증가분을 잰 값이다. 각 측정은 fork 한 자식 프로세스에서 5회 반복했고 중앙값과 범위를 함께 적는다. 스크립트는 `tools/bench/thread_vs_eventloop_memory.py`와 `.cpp`에 있다.

| 항목 | Python 스레드 1,000 | C++ `std::thread` 1,000 |
|---|---|---|
| VmSize(가상 주소 공간) 증가 | **+10.0 GiB** | **+8.0 GiB** |
| VmRSS(실제 상주) 증가 | +17 MiB | +7.8 MiB |
| 생성 시간 | 300 ms (250~350) | 140 ms (68~230) |

같은 스크립트로 Python 스레드 10,000개까지 밀면 VmSize **+82 GiB**, VmRSS +160 MiB, 생성에만 2.8초(2.2~4.7)가 든다.

fd 9,000개를 이벤트 루프에 등록했을 때는 이렇다. VmSize **+3.3 MiB**, VmRSS +4.0 MiB, 등록 110 ms, 등록된 fd가 전부 놀고 있을 때 `select` 한 번이 **0.94 µs**(0.83~0.99).

(Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다.)
:::

숫자 두 개가 갈린다는 점이 중요하다. **가상 주소 공간은 스레드마다 스택 한 장(이 기계의 `ulimit -s`는 8 MiB)을 통째로 예약해 폭발하고, 실제로 만져진 페이지는 스레드당 17 KiB뿐이다.** 그래서 "스레드 1만 개면 메모리가 터진다"는 흔한 설명은 절반만 맞다. 64비트에서 82 GiB의 주소 공간은 대개 버틴다.

터지는 것은 다른 셋이다.

- **생성 비용.** 1만 개를 띄우는 데만 2.8초다. 연결이 붙고 끊기는 시스템에서 이 값은 연결마다 반복된다.
- **디스패치 비용.** 스레드 사이로 일감을 하나 넘기고 되받는 데 이 기계에서 7~34 µs가 든다(중앙값 14 µs, 편차가 큰 것이 정상이다 — 스케줄러가 개입하기 때문이다). 같은 스레드 안에서 함수를 부르는 데는 0.12 µs다. **두 자릿수 차이다.**
- **한도.** 스택은 매핑 하나를 차지하고 `vm.max_map_count`는 이 기계에서 65,530이다. 스레드 수는 메모리가 아니라 이 한도에 먼저 걸린다.

여기에 Python은 하나를 더 얹는다. GIL이 켜져 있으면(이 컨테이너의 `sys._is_gil_enabled()`는 `True`다) 스레드 1만 개가 있어도 파이썬 바이트코드를 도는 것은 언제나 하나다. **1만 개의 스레드는 1만 개의 병렬성이 아니라 1만 개의 스택이다.**

## 2. 아이디어 — 준비된 것만 처리한다

연결 1만 개 중 이번 순간에 실제로 읽을 것이 있는 연결은 몇 개인가. 초당 한 번 보고하는 장비 1만 대라면, 1밀리초 안에는 평균 열 개다. 나머지 9,990개는 아무 일도 하지 않으면서 스택 8 MiB와 스케줄러 항목 하나를 차지하고 있다.

그렇다면 질문을 뒤집는다. **"각 연결이 자기 차례를 기다리게 하지 말고, 커널에게 준비된 것만 물어보면 되지 않는가."**

운영체제가 정확히 그 질문에 답하는 호출을 제공한다.

📖 `selectors.DefaultSelector()` — 이 플랫폼에서 가장 좋은 준비 상태 통지 방식을 고른다. Linux면 `epoll`이다.
`sel.register(fd, EVENT_READ, data)`로 관심을 등록하고 `sel.select(timeout)`으로 **준비된 것만** 돌려받는다.
쓰는 곳: 이 챕터의 이벤트 루프, 타임아웃 관리(XI-8).
C++ 대응: `poll(fds, n, timeout_ms)` — 관심 목록을 매번 통째로 넘긴다. `epoll_create1`/`epoll_ctl`/`epoll_wait`는 목록을 커널에 두고 준비된 것만 받는다.

`select`와 `poll`은 등록된 fd 전부를 매번 훑어 $O(n)$이고, `epoll`은 관심 목록을 커널이 들고 있어 준비된 개수에만 비례한다. 위 실측에서 fd 9,000개가 전부 유휴일 때 `select` 한 번이 0.94 µs로 끝난 것이 그 결과다 — 9,000개를 훑었다면 이 값이 나올 수 없다.

준비된 것만 처리하기로 하면 **연결마다 스레드를 둘 이유가 사라진다.** 대신 대가를 하나 치른다. 스레드가 들고 있던 "이 연결이 어디까지 진행했는가"를 이제 코드가 직접 들고 있어야 한다. 스레드의 스택이 곧 상태였는데, 그 스택이 없어졌기 때문이다.

```text nolines
  A)  conn0 --> [thread] --> stack 8 MiB   <- 진행 상태가 스택에 있다
      conn1 --> [thread] --> stack 8 MiB
      conn2 --> [thread] --> stack 8 MiB

  B)  conn0 --+
      conn1 --+--> [ epoll ] --> [ ready queue ] --> loop   <- 진행 상태는 객체에 있다
      conn2 --+
```

**이벤트 루프는 스레드 1만 개를 상태 기계 1만 개로 바꾼다.** 각 연결은 "헤더를 읽는 중 / 본문을 읽는 중 / 응답을 쓰는 중" 같은 상태를 가진 객체가 되고, 루프는 준비된 객체의 콜백만 부른다. 상태 기계를 다루는 법은 [XI-6 상태 기계](#/xi-6)에 있다. 여기서 필요한 것은 그 상태 기계들을 **한 스레드가 차례로 돌린다**는 사실 하나다.

한 스레드라는 점이 세 가지를 결정한다.

- **락이 필요 없다.** 콜백은 서로 겹쳐 돌지 않는다. [XI-3 락과 락프리](#/xi-3)의 문제 대부분이 이 모델에서는 성립하지 않는다.
- **콜백 하나가 오래 걸리면 전부 멈춘다.** 300밀리초짜리 동기 호출 하나가 나머지 9,999개의 응답을 300밀리초 밀어낸다. 이것이 이 모델의 유일하고 치명적인 규칙이다.
- **Python에서 GIL이 문제가 되지 않는다.** 애초에 스레드가 하나뿐이므로 뺏길 것이 없다. Python의 답이 `threading`이 아니라 이벤트 루프인 이유가 이것이다.

루프가 실제로 관리하는 것은 셋뿐이다. **준비된 fd**(커널이 알려준다), **만료된 타이머**(마감 순으로 정렬된 최소 힙), **실행 대기 콜백**(덱). 널리 쓰이는 비동기 프레임워크의 이벤트 루프가 정확히 이 세 자료구조로 되어 있다 — CPython의 `asyncio` 루프는 예약된 타이머를 `heapq` 최소 힙(`_scheduled`)에, 즉시 실행할 콜백을 `deque`(`_ready`)에 담고, 한 회전마다 만료된 타이머를 힙에서 덱으로 옮긴 뒤 덱을 비운다. [II-8 힙과 우선순위 큐](#/ii-8)가 여기에 박혀 있다.

## 3. 손으로 따라가기

::: trace
입력: `conn0`·`conn1`·`conn2`에 각각 3·2·1바이트를 쓰고 곧바로 쓰기 쪽을 닫는다. 타이머는 `heartbeat`(+30 ms), `retry`(+10 ms) **순서로** 넣는다.

루프 한 회전은 셋이다. ① 만료된 타이머를 힙에서 꺼내 덱에 넣는다 ② 할 일이 있으면 `timeout=0`, 없으면 다음 타이머까지를 `timeout`으로 주고 `select`한다 ③ **이번 회전에 덱에 들어온 것만** 실행한다.

| 회전 | 만료 타이머 | select 결과 | 준비 덱 | 실행 |
|---|---|---|---|---|
| 1 | 없음 | conn0,1,2 | [fd0,fd1,fd2] | 3·2·1바이트 읽음 |
| 2 | 없음 | conn0,1,2 | [fd0,fd1,fd2] | EOF 셋, 등록 해제 |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |

3회전 이후에는 등록된 fd가 하나도 없다. 그때 `select`에 무엇을 `timeout`으로 주는지, 그리고 왜 회전이 여섯 번 도는지를 채워라.
:::

::: answer
| 회전 | 만료 타이머 | select 결과 | 준비 덱 | 실행 |
|---|---|---|---|---|
| 1 | 없음 | conn0,1,2 | [fd0,fd1,fd2] | 3·2·1바이트 읽음 |
| 2 | 없음 | conn0,1,2 | [fd0,fd1,fd2] | EOF 셋, 등록 해제 |
| 3 | 없음 | 없음(10 ms 잠) | [] | 없음 |
| 4 | retry | 없음(timeout=0) | [timer retry] | retry 발화 |
| 5 | 없음 | 없음(20 ms 잠) | [] | 없음 |
| 6 | heartbeat | 없음(timeout=0) | [timer heartbeat] | heartbeat 발화 |

세 가지가 드러난다.

**첫째, 자는 회전이 따로 있다.** 3·5회전은 아무것도 실행하지 않는다. 이 회전의 `timeout`이 "다음 타이머까지 남은 시간"이고, 그래서 **타이머는 별도의 스레드가 아니라 `select`의 `timeout` 인자로 구현된다.** 할 일이 없을 때 루프는 CPU를 쓰지 않는다.

**둘째, 등록 순서가 아니라 마감 순서로 발화한다.** `heartbeat`를 먼저 넣었는데 `retry`가 먼저 울린다. 힙이 그 일을 한다.

**셋째, 실행은 이번 회전에 들어온 것까지다.** 콜백이 실행 중에 새 콜백을 덱에 넣어도 그것은 다음 회전 몫이다. 이 경계가 없으면 콜백이 콜백을 낳는 동안 fd 처리가 영영 밀린다 — 기아(starvation)다.
:::

## 4. 구현 — 200줄 안쪽의 이벤트 루프

라이브러리를 부르지 않고 짠다. 소켓은 `socketpair`로 자족적으로 만들어 외부 연결 없이 돌아가게 했다.

::: dual
```python title="최소 이벤트 루프 — 준비된 fd + 타이머 힙 + 콜백 덱"
import heapq
import selectors
import socket
import time
from collections import deque

sel = selectors.DefaultSelector()
ready = deque()   # 이번 회전에 실행할 콜백. asyncio 의 _ready 가 이 자리다
timers = []       # (마감, 순번, 이름) 최소 힙. asyncio 의 _scheduled 가 이 자리다
seq = 0
conns = {}
log = []


def now_ms():
    return time.monotonic() * 1000


def add_timer(delay_ms, name):
    global seq
    seq += 1
    heapq.heappush(timers, (now_ms() + delay_ms, seq, name))


def on_readable(fd):
    name, sock, total = conns[fd]
    data = sock.recv(64)
    if data:                                  # 읽을 만큼만 읽고 즉시 돌아온다
        conns[fd][2] = total + len(data)
        log.append(f"[fd] {name} {len(data)}바이트")
    else:                                     # EOF — 상태 기계 하나가 끝났다
        sel.unregister(sock)
        sock.close()
        log.append(f"[fd] {name} EOF 누적 {conns[fd][2]}바이트")


def loop_once():
    # 1) 만료된 타이머를 힙에서 꺼내 준비 덱으로 옮긴다
    while timers and timers[0][0] <= now_ms():
        _, _, name = heapq.heappop(timers)
        ready.append(("timer", name))
    # 2) 할 일이 있으면 자지 않고, 없으면 다음 타이머까지만 잔다
    if ready:
        timeout = 0
    elif timers:
        timeout = max(0.0, timers[0][0] - now_ms()) / 1000
    else:
        timeout = None
    for key, _ in sorted(sel.select(timeout), key=lambda kv: kv[0].data):
        ready.append(("fd", key.data))
    # 3) 이번 회전에 들어온 것만 실행한다. 실행 중 새로 들어온 것은 다음 회전
    for _ in range(len(ready)):
        kind, arg = ready.popleft()
        if kind == "fd":
            on_readable(arg)
        else:
            log.append(f"[timer] {arg}")


for i, payload in enumerate([b"AAA", b"BB", b"C"]):
    srv, cli = socket.socketpair()
    cli.sendall(payload)
    cli.close()                     # 보내고 끊는다. 데이터와 EOF 가 차례로 온다
    srv.setblocking(False)
    conns[srv.fileno()] = [f"conn{i}", srv, 0]
    sel.register(srv, selectors.EVENT_READ, srv.fileno())

add_timer(30, "heartbeat")          # 늦게 만료될 것을 먼저 넣는다
add_timer(10, "retry")

while sel.get_map() or timers:
    loop_once()

print("\n".join(log))
print("처리한 이벤트:", len(log))
```
```cpp title="최소 이벤트 루프 — 준비된 fd + 타이머 힙 + 콜백 덱"
#include <sys/socket.h>
#include <unistd.h>
#include <poll.h>

#include <algorithm>
#include <chrono>
#include <deque>
#include <iostream>
#include <map>
#include <queue>
#include <string>
#include <tuple>
#include <vector>
using namespace std;

struct Conn { string name; int fd; int total; };

static map<int, Conn> conns;                  // 등록된 fd → 상태 기계 하나
static deque<pair<string, string>> ready;     // 이번 회전에 실행할 콜백
static priority_queue<tuple<double, int, string>,
                      vector<tuple<double, int, string>>,
                      greater<>> timers;      // (마감, 순번, 이름) 최소 힙
static int seq = 0;
static vector<string> log_;

static double now_ms() {
    using namespace chrono;
    return duration<double, milli>(steady_clock::now().time_since_epoch()).count();
}

static void add_timer(double delay_ms, const string& name) {
    seq += 1;
    timers.emplace(now_ms() + delay_ms, seq, name);
}

static void on_readable(int fd) {
    Conn& c = conns[fd];
    char buf[64];
    ssize_t n = recv(fd, buf, sizeof buf, 0);
    if (n > 0) {                              // 읽을 만큼만 읽고 즉시 돌아온다
        c.total += (int)n;
        log_.push_back("[fd] " + c.name + " " + to_string(n) + "바이트");
    } else {                                  // EOF — 상태 기계 하나가 끝났다
        log_.push_back("[fd] " + c.name + " EOF 누적 " + to_string(c.total) + "바이트");
        close(fd);
        conns.erase(fd);
    }
}

static void loop_once() {
    // 1) 만료된 타이머를 힙에서 꺼내 준비 덱으로 옮긴다
    while (!timers.empty() && get<0>(timers.top()) <= now_ms()) {
        ready.emplace_back("timer", get<2>(timers.top()));
        timers.pop();
    }
    // 2) 할 일이 있으면 자지 않고, 없으면 다음 타이머까지만 잔다
    int timeout;
    if (!ready.empty()) timeout = 0;
    else if (!timers.empty()) timeout = (int)max(0.0, get<0>(timers.top()) - now_ms());
    else timeout = -1;

    vector<pollfd> pfds;
    for (auto& [fd, c] : conns) pfds.push_back({fd, POLLIN, 0});
    poll(pfds.data(), pfds.size(), timeout);
    for (auto& p : pfds)                       // pollfd 배열은 fd 오름차순이다
        if (p.revents) ready.emplace_back("fd", to_string(p.fd));
    // 3) 이번 회전에 들어온 것만 실행한다. 실행 중 새로 들어온 것은 다음 회전
    for (size_t k = ready.size(); k > 0; k--) {
        auto [kind, arg] = ready.front();
        ready.pop_front();
        if (kind == "fd") on_readable(stoi(arg));
        else log_.push_back("[timer] " + arg);
    }
}

int main() {
    const char* payloads[] = {"AAA", "BB", "C"};
    for (int i = 0; i < 3; i++) {
        int sv[2];
        socketpair(AF_UNIX, SOCK_STREAM, 0, sv);
        send(sv[1], payloads[i], string(payloads[i]).size(), 0);
        close(sv[1]);                          // 보내고 끊는다. 데이터와 EOF 가 차례로 온다
        conns[sv[0]] = Conn{"conn" + to_string(i), sv[0], 0};
    }
    add_timer(30, "heartbeat");                // 늦게 만료될 것을 먼저 넣는다
    add_timer(10, "retry");

    while (!conns.empty() || !timers.empty()) loop_once();

    for (auto& s : log_) cout << s << "\n";
    cout << "처리한 이벤트: " << log_.size() << "\n";
}
```
:::

```console
[fd] conn0 3바이트
[fd] conn1 2바이트
[fd] conn2 1바이트
[fd] conn0 EOF 누적 3바이트
[fd] conn1 EOF 누적 2바이트
[fd] conn2 EOF 누적 1바이트
[timer] retry
[timer] heartbeat
처리한 이벤트: 8
```

**복잡도:** 한 회전의 시간은 $O(\log T + R + C)$ — 만료된 타이머를 꺼낼 때마다 힙에서 $O(\log T)$($T$는 예약된 타이머 수), `epoll`이 돌려주는 준비된 fd $R$개를 덱에 넣는 데 $O(R)$, 덱에 든 콜백 $C$개를 부르는 데 $O(C)$. **등록된 연결 수 $N$은 어디에도 들어가지 않는다** — 그것이 `epoll`을 쓰는 이유 전부다. `poll`과 `select`는 여기에 $O(N)$이 붙는다. 공간은 $O(N + T)$ — 연결마다 상태 객체 하나, 타이머마다 힙 원소 하나.

상수 쪽도 말해 둔다. 콜백 하나를 부르는 비용은 함수 호출 한 번(0.12 µs)이고, 같은 일을 스레드에 넘기면 7~34 µs다. **이벤트 루프가 빠른 이유는 알고리즘이 아니라 이 상수다.**

| 언어 차이 | Python | C++ |
|---|---|---|
| 준비 상태 통지 | `selectors.DefaultSelector` — Linux면 `epoll`을 자동 선택 | `poll`은 목록을 매번 넘겨 $O(N)$. `epoll_ctl`/`epoll_wait`를 직접 써야 $O(R)$ |
| 타이머 힙 | `heapq` — 최소 힙 고정. 튜플이 사전식으로 비교된다 | `priority_queue`는 **최대 힙이 기본**. `greater<>`를 넘겨야 최소 힙이 된다 |
| 콜백 덱 | `collections.deque` — 양끝 $O(1)$ | `std::deque` — 같은 성질. 블록 배열이라 중간 삽입은 느리다 |
| 비블로킹 설정 | `sock.setblocking(False)` | `fcntl(fd, F_SETFL, O_NONBLOCK)` |
| 병렬성 | GIL이 있어도 **문제가 없다.** 루프가 한 스레드이므로 뺏길 GIL이 없다 | 진짜 병렬. 대신 루프를 코어 수만큼 띄우면 연결 분배와 공유 상태를 직접 정해야 한다 |
| 시간 원천 | `time.monotonic()` — 시스템 시계 변경에 영향받지 않는다 | `steady_clock`. `system_clock`은 뒤로 갈 수 있어 타이머에 쓰면 안 된다 |

::: pitfall
- **`recv`를 준비될 때까지 반복해서 부르면 루프가 멈춘다.** 비블로킹으로 설정하지 않은 fd를 등록하면 `select`가 준비를 알렸는데도 `recv`가 잠들 수 있다(패킷이 체크섬 오류로 버려지는 등). 등록하는 fd는 예외 없이 비블로킹으로 만든다.
- **한 콜백에서 그 fd의 데이터를 다 읽으려고 while 루프를 돌리면** 그 연결 하나가 루프를 독점한다. 한 번에 읽는 양을 정해 두고 돌아와라.
- **`select`가 `timeout=None`인 채로 등록된 fd도 타이머도 없으면 영원히 잔다.** 위 코드의 종료 조건이 `sel.get_map() or timers`인 이유다.
- **콜백 안에서 예외가 나가면 루프가 죽는다.** 스레드 모델에서는 스레드 하나가 죽지만 여기서는 전부다. 콜백 호출은 예외를 잡아 격리해야 한다([XII-7](#/xii-7)의 격리 규율이 그대로 적용된다).
:::

## 5. 백프레셔 — 들어오는 속도가 처리 속도를 넘을 때

이벤트 루프는 "준비된 것을 빨리 처리하는" 문제를 푼다. 그것이 풀리면 곧바로 다음 문제가 온다. **아무리 빨라도 들어오는 속도가 처리 속도를 넘는 구간은 반드시 생긴다.** 그때 큐가 사이에 있고, 큐의 정책이 시스템의 성격을 결정한다.

### 5.1 네 가지 정책

폭주 구간에서 소비 능력의 2.5배가 들어오고(100 tick), 그 뒤 소비 능력 아래로 내려가(300 tick) 결국 전부 처리될 수 있는 부하를 만든다. 소비자는 1 tick에 2건, 유계 큐의 용량은 8이다. 30 tick을 넘겨 처리한 것은 이미 늦은 것으로 센다.

- **`unbounded`** — 큐에 한도가 없다. 무엇도 거절하지 않는다.
- **`block`** — 가득 차면 생산자가 멈춘다. 못 받은 것은 상류에 그대로 남아 다음 tick에 다시 시도된다. TCP 수신 창이 닫히는 것이 이 모양이다.
- **`drop`** — 가득 차면 새로 온 것을 버린다. 상류는 방해받지 않는다.
- **`reject+retry`** — 가득 차면 즉시 오류로 거절한다. 거절당한 쪽이 다음 tick에 다시 보낸다.

::: dual
```python title="백프레셔 정책 네 가지 — 같은 부하, 다른 결과"
from collections import deque

CAP = 8         # 유계 큐 용량
RATE_OUT = 2    # 소비자가 한 tick 에 처리하는 건수
TIMEOUT = 30    # 이 나이를 넘겨 처리하면 이미 늦은 것 — 헛일이다
TICKS = 600


def arrivals(tick):
    if tick < 100:
        return 5        # 폭주 구간: 소비 능력의 2.5배가 들어온다
    if tick < 400:
        return 1        # 회복 구간: 소비 능력 아래로 내려간다
    return 0


def simulate(policy):
    q = deque()          # 큐에 든 항목의 도착 tick
    backlog = deque()    # 수용되지 못해 상류에 남은 항목
    sent = accepted = lost = done = stale = 0
    stalled = 0
    max_q = max_lat = lat_sum = 0

    for tick in range(TICKS):
        for _ in range(RATE_OUT):                  # 1) 소비
            if not q:
                break
            born = q.popleft()
            done += 1
            lat = tick - born
            lat_sum += lat
            max_lat = max(max_lat, lat)
            if lat > TIMEOUT:
                stale += 1                         # 이미 늦은 뒤에 처리했다

        fresh = [tick] * arrivals(tick)            # 2) 생산
        pending = list(backlog) + fresh
        backlog.clear()
        # 거부는 즉시 오류로 돌아오므로 상류가 매 tick 다시 보낸다. 그것이 곧 부하다
        sent += len(pending) if policy == "reject+retry" else len(fresh)

        placed = 0
        for born in pending:
            if policy != "unbounded" and len(q) >= CAP:
                break
            q.append(born)
            accepted += 1
            placed += 1
        rest = pending[placed:]
        if rest:
            stalled += 1
            if policy == "drop":
                lost += len(rest)                  # 새로 온 것을 버린다
            else:
                backlog.extend(rest)               # 상류로 밀려난다
        max_q = max(max_q, len(q))

    return dict(policy=policy, sent=sent, accepted=accepted, lost=lost, done=done,
                stale=stale, max_q=max_q, max_lat=max_lat,
                avg_lat=lat_sum // max(1, done), stalled=stalled)


print(f"{'policy':<13}{'sent':>7}{'accept':>7}{'lost':>6}{'done':>6}"
      f"{'stale':>6}{'maxq':>6}{'maxlat':>7}{'avglat':>7}")
for p in ("unbounded", "block", "drop", "reject+retry"):
    r = simulate(p)
    print(f"{r['policy']:<13}{r['sent']:>7}{r['accepted']:>7}{r['lost']:>6}{r['done']:>6}"
          f"{r['stale']:>6}{r['max_q']:>6}{r['max_lat']:>7}{r['avg_lat']:>7}")
```
```cpp title="백프레셔 정책 네 가지 — 같은 부하, 다른 결과"
#include <deque>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>
using namespace std;

const int CAP = 8;        // 유계 큐 용량
const int RATE_OUT = 2;   // 소비자가 한 tick 에 처리하는 건수
const int TIMEOUT = 30;   // 이 나이를 넘겨 처리하면 이미 늦은 것 — 헛일이다
const int TICKS = 600;

int arrivals(int tick) {
    if (tick < 100) return 5;   // 폭주 구간: 소비 능력의 2.5배가 들어온다
    if (tick < 400) return 1;   // 회복 구간: 소비 능력 아래로 내려간다
    return 0;
}

struct Result {
    string policy;
    long sent = 0, accepted = 0, lost = 0, done = 0, stale = 0;
    long stalled = 0, max_q = 0, max_lat = 0, avg_lat = 0;
};

Result simulate(const string& policy) {
    deque<int> q;         // 큐에 든 항목의 도착 tick
    deque<int> backlog;   // 수용되지 못해 상류에 남은 항목
    Result r;
    r.policy = policy;
    long lat_sum = 0;

    for (int tick = 0; tick < TICKS; tick++) {
        for (int k = 0; k < RATE_OUT; k++) {           // 1) 소비
            if (q.empty()) break;
            int born = q.front();
            q.pop_front();
            r.done += 1;
            long lat = tick - born;
            lat_sum += lat;
            r.max_lat = max(r.max_lat, lat);
            if (lat > TIMEOUT) r.stale += 1;           // 이미 늦은 뒤에 처리했다
        }

        vector<int> fresh(arrivals(tick), tick);       // 2) 생산
        vector<int> pending(backlog.begin(), backlog.end());
        pending.insert(pending.end(), fresh.begin(), fresh.end());
        backlog.clear();
        // 거부는 즉시 오류로 돌아오므로 상류가 매 tick 다시 보낸다. 그것이 곧 부하다
        r.sent += (policy == "reject+retry") ? (long)pending.size() : (long)fresh.size();

        size_t placed = 0;
        for (int born : pending) {
            if (policy != "unbounded" && (int)q.size() >= CAP) break;
            q.push_back(born);
            r.accepted += 1;
            placed += 1;
        }
        if (placed < pending.size()) {
            r.stalled += 1;
            if (policy == "drop") {
                r.lost += (long)(pending.size() - placed);   // 새로 온 것을 버린다
            } else {
                backlog.insert(backlog.end(), pending.begin() + placed, pending.end());
            }
        }
        r.max_q = max(r.max_q, (long)q.size());
    }
    r.avg_lat = lat_sum / max(1L, r.done);
    return r;
}

int main() {
    cout << left << setw(13) << "policy" << right << setw(7) << "sent" << setw(7) << "accept"
         << setw(6) << "lost" << setw(6) << "done" << setw(6) << "stale" << setw(6) << "maxq"
         << setw(7) << "maxlat" << setw(7) << "avglat" << "\n";
    for (string p : {"unbounded", "block", "drop", "reject+retry"}) {
        Result r = simulate(p);
        cout << left << setw(13) << r.policy << right << setw(7) << r.sent << setw(7) << r.accepted
             << setw(6) << r.lost << setw(6) << r.done << setw(6) << r.stale << setw(6) << r.max_q
             << setw(7) << r.max_lat << setw(7) << r.avg_lat << "\n";
    }
}
```
:::

```console
policy          sent accept  lost  done stale  maxq maxlat avglat
unbounded        800    800     0   800   643   302    151     76
block            800    800     0   800   643     8    151     76
drop             800    506   294   506     0     8      4      2
reject+retry   58424    800     0   800   643     8    151     76
```

**복잡도:** 시뮬레이션 전체가 시간 $O(\text{tick} + \text{항목 수})$ — 항목 하나는 큐에 최대 한 번 들어가고 한 번 나온다. 공간은 정책이 결정한다. `unbounded`는 $O(\text{누적 도착} - \text{누적 처리})$로 **상한이 없고**, 나머지 셋은 $O(\text{CAP})$로 상수다. 이 한 줄이 유계 큐를 쓰는 이유 전부다.

네 줄이 각각 다른 시스템의 성격이다.

**`unbounded`는 아무것도 버리지 않는다. 대신 최대 지연이 151 tick이고, 처리한 800건 중 643건(80%)이 이미 늦은 뒤에 처리됐다.** 이 시스템은 장애 중에 "에러율 0%"를 보고한다. 지표만 보면 건강하고, 사용자는 전부 타임아웃을 본다.

**`block`은 `unbounded`와 지연·헛일이 완전히 같다.** 유일한 차이는 `maxq`가 302에서 8로 줄었다는 것이다. **블로킹은 지연을 없애지 않는다. 메모리를 상류로 옮기고, 상류가 그 느려짐을 알아채게 만들 뿐이다.** 그 "알아챔"이 값을 한다 — TCP라면 수신 창이 닫혀 송신자가 실제로 느려지고, 압력이 네트워크를 타고 근원까지 전파된다. 우리 프로세스는 OOM으로 죽지 않는다.

**`drop`만 지연을 잡는다.** 최대 지연 4 tick, 늦은 처리 0건. 대신 294건(37%)을 버렸다. 이 선택이 옳은 자리가 분명히 있다 — 센서 값, 화면 갱신, 지표 표본처럼 **최신 값이 옛 값을 무의미하게 만드는 데이터**다. 옛 프레임을 늦게 그리느니 버리는 것이 맞다.

**`reject+retry`는 결과가 `block`과 같은데 전송이 58,424회다.** 800건을 넣으려고 73배의 요청이 오갔다. 거절은 유실을 없애는 것이 아니라 **유실을 상류의 재시도로 바꾸고, 재시도는 그 자체가 부하다.** 거절을 정책으로 쓰려면 재시도 간격을 지수적으로 늘리고 무작위 지연을 섞는 규칙이 반드시 따라와야 한다. 그쪽 이야기는 [XV-10 레이트 리미팅](#/xv-10)에 있다.

### 5.2 무한 큐는 장애를 미루기만 한다

`unbounded`가 800건을 다 처리했으니 결국 괜찮은 것 아닌가. 아니다. 위 표에는 클라이언트가 빠져 있다. **응답이 30 tick 안에 안 오면 클라이언트는 같은 요청을 다시 보낸다.** 그 한 줄을 넣으면 결과가 뒤집힌다.

::: dual
```python title="무한 큐 + 타임아웃 재시도 — 부하가 사라진 뒤에도 큐가 자란다"
from collections import deque

RATE_OUT = 2
TIMEOUT = 30     # 클라이언트가 이만큼 기다리면 포기하고 다시 보낸다
TICKS = 600


def arrivals(tick):
    return 5 if tick < 100 else (1 if tick < 400 else 0)


def simulate(retry):
    q = deque()                 # (클라이언트 번호, 이 요청이 큐에 들어온 tick)
    served = set()
    last_sent = {}              # 클라이언트별 마지막 전송 tick
    next_id = 0
    done = dup = 0
    snap = {}

    for tick in range(TICKS):
        for _ in range(RATE_OUT):
            if not q:
                break
            cid, _born = q.popleft()
            done += 1
            if cid in served:
                dup += 1        # 이미 처리한 요청을 또 처리했다. 순수한 낭비다
            served.add(cid)

        for _ in range(arrivals(tick)):
            q.append((next_id, tick))
            last_sent[next_id] = tick
            next_id += 1

        if retry:               # 타임아웃 난 클라이언트가 같은 요청을 다시 보낸다
            for cid, sent in list(last_sent.items()):
                if cid not in served and tick - sent >= TIMEOUT:
                    q.append((cid, tick))
                    last_sent[cid] = tick

        if tick + 1 in (100, 200, 400, 600):
            snap[tick + 1] = len(q)

    pending = sum(1 for cid in last_sent if cid not in served)
    return snap, done, dup, len(q), pending


a_snap, a_done, a_dup, a_left, a_pend = simulate(False)
b_snap, b_done, b_dup, b_left, b_pend = simulate(True)

print(f"{'tick':>6}{'q(no-retry)':>13}{'q(retry)':>10}")
for t in (100, 200, 400, 600):
    print(f"{t:>6}{a_snap[t]:>13}{b_snap[t]:>10}")
print(f"no-retry: done={a_done} dup={a_dup} left={a_left} unserved={a_pend}")
print(f"retry   : done={b_done} dup={b_dup} left={b_left} unserved={b_pend}")
```
```cpp title="무한 큐 + 타임아웃 재시도 — 부하가 사라진 뒤에도 큐가 자란다"
#include <deque>
#include <iomanip>
#include <iostream>
#include <map>
#include <set>
#include <utility>
using namespace std;

const int RATE_OUT = 2;
const int TIMEOUT = 30;   // 클라이언트가 이만큼 기다리면 포기하고 다시 보낸다
const int TICKS = 600;

int arrivals(int tick) { return tick < 100 ? 5 : (tick < 400 ? 1 : 0); }

struct Out { map<int, int> snap; long done = 0, dup = 0, left = 0, pending = 0; };

Out simulate(bool retry) {
    deque<pair<int, int>> q;   // (클라이언트 번호, 이 요청이 큐에 들어온 tick)
    set<int> served;
    map<int, int> last_sent;   // 클라이언트별 마지막 전송 tick
    int next_id = 0;
    Out o;

    for (int tick = 0; tick < TICKS; tick++) {
        for (int k = 0; k < RATE_OUT; k++) {
            if (q.empty()) break;
            int cid = q.front().first;
            q.pop_front();
            o.done += 1;
            if (served.count(cid)) o.dup += 1;   // 이미 처리한 요청을 또 처리했다
            served.insert(cid);
        }

        for (int k = 0; k < arrivals(tick); k++) {
            q.emplace_back(next_id, tick);
            last_sent[next_id] = tick;
            next_id += 1;
        }

        if (retry) {   // 타임아웃 난 클라이언트가 같은 요청을 다시 보낸다
            for (auto& [cid, sent] : last_sent)
                if (!served.count(cid) && tick - sent >= TIMEOUT) {
                    q.emplace_back(cid, tick);
                    sent = tick;
                }
        }

        int t1 = tick + 1;
        if (t1 == 100 || t1 == 200 || t1 == 400 || t1 == 600) o.snap[t1] = (int)q.size();
    }
    o.left = (long)q.size();
    for (auto& [cid, sent] : last_sent)
        if (!served.count(cid)) o.pending += 1;
    return o;
}

int main() {
    Out a = simulate(false), b = simulate(true);
    cout << right << setw(6) << "tick" << setw(13) << "q(no-retry)" << setw(10) << "q(retry)" << "\n";
    for (int t : {100, 200, 400, 600})
        cout << setw(6) << t << setw(13) << a.snap[t] << setw(10) << b.snap[t] << "\n";
    cout << "no-retry: done=" << a.done << " dup=" << a.dup << " left=" << a.left
         << " unserved=" << a.pending << "\n";
    cout << "retry   : done=" << b.done << " dup=" << b.dup << " left=" << b.left
         << " unserved=" << b.pending << "\n";
}
```
:::

```console
  tick  q(no-retry)  q(retry)
   100          302       556
   200          202      1352
   400            2      2890
   600            0      4328
no-retry: done=800 dup=0 left=0 unserved=0
retry   : done=1198 dup=652 left=4328 unserved=254
```

**복잡도:** 재시도 스캔이 tick마다 미해결 클라이언트를 훑으므로 시간 $O(\text{tick} \times \text{미해결 수})$ — 실제 시스템에서는 이 스캔이 타이머로 대체된다([XI-8](#/xi-8)). 공간은 $O(\text{큐 길이})$이고, 그 큐 길이가 **수렴하지 않는 것**이 이 실험의 결과다.

400 tick에서 도착이 완전히 멈춘다. 재시도가 없으면 큐는 그때 2로 줄고 600 tick에 0이 된다. **재시도가 있으면 도착이 멈춘 뒤에도 2,890에서 4,328로 계속 자란다.** 처리한 1,198건 중 652건(54%)이 이미 처리한 요청을 또 처리한 것이고, 254명은 끝까지 응답을 못 받았다.

이것이 무한 큐의 정체다. ==무한 큐는 과부하를 흡수하는 것이 아니라 과부하를 **지연으로 바꾸어** 미룬다.== 지연이 클라이언트 타임아웃을 넘는 순간, 큐에 든 일은 아무도 기다리지 않는 일이 되고 재시도가 그 위에 쌓인다. 부하의 근원이 사라져도 시스템은 스스로 만든 부하로 계속 무너진다.

::: danger
**메모리가 남아 있다는 것은 큐를 무한으로 둘 이유가 되지 않는다.** 유계 큐의 목적은 메모리 절약이 아니라 **지연에 상한을 두는 것**이다. 큐 용량을 정할 때의 질문은 "메모리가 얼마나 되는가"가 아니라 "이 큐에서 얼마나 기다린 항목까지 의미가 있는가"다. 용량 = 허용 지연 × 소비 속도. 위 실험에서 허용 지연 30 tick에 소비 2/tick이면 용량 60이 상한이고, 그보다 큰 큐는 헛일을 담는 창고다.
:::

## 6. 어디에 쓰이는가

**단일 스레드 이벤트 루프로 동시 연결을 처리하는 서버가 이 구조 그대로다.** 하나의 프로세스가 `epoll`로 수만 연결을 받고, 코어 수만큼 프로세스를 띄워 병렬성을 얻는다. 스레드가 아니라 프로세스인 것이 핵심이다 — 루프 안에서는 락이 없다.

**CPython의 `asyncio` 이벤트 루프가 §4의 구조다.** 예약된 타이머는 `heapq` 최소 힙에, 즉시 실행할 콜백은 `deque`에 있고, 한 회전은 "만료 타이머를 덱으로 → `select` → 덱 비우기" 세 단계다. 코루틴은 이 위에 얹힌 문법이고, 그 밑에는 이 루프가 있다. `await`가 하는 일은 결국 "이 상태 기계를 여기서 멈추고 준비되면 덱에 다시 넣어라"다.

**TCP의 흐름 제어가 `block` 정책의 원형이다.** 수신 버퍼가 차면 수신자가 광고하는 창 크기가 0이 되고 송신자는 보낼 수 없다. 애플리케이션이 아무 코드도 쓰지 않았는데 배압이 근원까지 전파된다. `block`이 지연을 상류로 옮긴다는 §5.1의 관찰이 프로토콜 수준에서 그대로 일어난다.

**로그 수집 파이프라인이 `drop`을 고르는 자리다.** 수집기가 밀릴 때 애플리케이션을 멈추는 것은 대개 오답이다 — 로그 때문에 서비스가 죽는다. 그래서 유계 버퍼 + 버림 + "버린 개수" 지표가 표준 구성이다. 버린 개수를 지표로 내보내지 않으면 조용히 사라지고, 그것이 가장 나쁜 형태다.

**메시지 브로커의 소비자 지연(lag) 지표가 §5.2의 큐 길이다.** 브로커는 큐를 디스크에 두어 사실상 무한에 가깝게 만들 수 있고, 그래서 정확히 §5.2의 함정에 빠진다. 유실은 0인데 처리되는 메시지가 전부 오래된 것이다. **감시해야 할 것은 큐 길이가 아니라 큐에 든 항목의 나이다.**

**발행-구독 구조의 비동기 통지가 이 챕터로 이어진다.** [XII-7 Observer / Publish-Subscribe](#/xii-7)는 통지를 큐에 넣어 생산자의 스레드를 풀어 주는 것이 처방이라고 했다. 그 큐가 무한이면 §5.2가 일어난다. 패턴이 답한 것은 결합의 방향이고, 그 큐의 정책은 이 챕터가 답한다.

::: interview
**"이벤트 루프가 스레드보다 빠른 이유는 무엇인가?"**

*"컨텍스트 스위치를 안 해서"* 는 절반이다. 뼈대는 이렇게 세운다.

1. **빠른 것이 아니라 싼 것이다.** 연결마다 스택 8 MiB와 스케줄러 항목을 두지 않는다. 디스패치가 컨텍스트 스위치(수십 µs)에서 함수 호출(0.1 µs 미만)로 바뀐다.
2. **대신 프로그래밍 모델을 내놓는다.** 스택에 있던 진행 상태를 객체로 직접 관리해야 한다.
3. **CPU 바운드 작업에는 이점이 없다.** 한 콜백이 오래 걸리면 전부 멈춘다. 그런 작업은 스레드 풀([XI-4](#/xi-4))이나 별도 프로세스로 밀어낸다.
4. **연결 수가 수백이면 스레드가 더 낫다.** 코드가 단순하고 그 규모에서는 스택도 스위치도 문제가 아니다.

**"백프레셔를 어떻게 구현했는가?"** 는 정책을 묻는 질문이다. "유계 큐를 썼다"까지는 절반이고, **가득 찼을 때 무엇을 하는지**와 **그 선택으로 무엇을 잃는지**를 말해야 답이 된다. 버림을 골랐다면 유실률을 지표로 내보내는지까지가 한 세트다.
:::

## 연습

::: quiz
**1. 텔레메트리 수집기**
- 상황: 장비 5,000대가 100 ms마다 상태를 올린다. 수집기는 이것을 시계열 저장소에 넣는다. 저장소가 30초쯤 느려지는 일이 하루 몇 번 있다.
- 무엇이 병목인가: 저장소 쓰기다. 그동안 도착은 초당 5만 건으로 유지된다. 무한 큐를 두면 30초에 150만 건이 쌓이고, 그것을 다 쓰고 나면 이미 30초 전의 값이다.
- 어떤 구조이고 대가는 무엇인가: 장비별 최신 값만 남기는 유계 버퍼 + 버림. 상태 값은 최신이 옛것을 무의미하게 만들므로 옛 값을 버리는 것이 의미를 잃지 않는다. 대가는 그 30초 구간의 이력이 성기게 남는다는 것이고, 그것은 저장소가 밀렸다는 사실 자체로 설명된다. 버린 개수를 반드시 지표로 낸다.

**2. 주문 접수 API**
- 상황: 초당 2,000건을 처리할 수 있는 API에 판촉으로 초당 6,000건이 들어온다.
- 무엇이 병목인가: 처리 능력이다. 여기서 버리면 주문이 사라지고, 무한 큐를 두면 §5.2가 그대로 일어난다 — 응답이 늦어 클라이언트가 재시도하고 부하가 늘어난다.
- 어떤 구조이고 대가는 무엇인가: 유계 큐 + 즉시 거절(429) + 재시도 지시. 거절은 유실이 아니라 **책임을 상류로 넘기는 것**이므로, 재시도 간격을 지수적으로 늘리고 무작위 지연을 섞는 규칙이 반드시 함께 가야 한다. 그것이 없으면 `reject+retry` 행의 73배 전송이 재현된다.

**3. 실시간 제어 루프와 통신 스레드**
- 상황: 20 ms마다 도는 제어 루프가 상태를 기록하고, 별도 경로가 그것을 원격으로 보낸다. 네트워크가 끊기면 전송이 밀린다.
- 무엇이 병목인가: 네트워크다. 여기서 제어 루프를 블로킹시키면 20 ms 주기가 깨지고, 그것은 로그 유실보다 훨씬 큰 사고다.
- 어떤 구조이고 대가는 무엇인가: 제어 루프와 전송 사이에 유계 큐를 두고 **절대로 블로킹하지 않는다.** 가득 차면 버린다. 대가는 끊긴 구간의 원격 기록이 비는 것이고, 그 사실 자체를 카운터로 남긴다. 이 판단의 근거는 [XI-5 실시간 스케줄링 개념](#/xi-5)의 마감 시간이다 — 마감이 있는 쪽은 절대 기다리지 않는다.
:::

## 요약

- 연결마다 스레드를 두면 스레드당 가상 주소 공간 8~10 MiB를 예약한다(1,000개에 +8.0~10.0 GiB). 실제 상주는 스레드당 17 KiB뿐이라 **메모리보다 생성 비용·디스패치 비용·매핑 한도가 먼저 무너진다.**
- 이벤트 루프는 커널에게 준비된 fd만 물어 한 스레드로 처리한다. 디스패치가 컨텍스트 스위치(수십 µs)에서 함수 호출(0.12 µs)로 바뀐다.
- 루프가 관리하는 것은 셋뿐이다. **준비된 fd·타이머 최소 힙·콜백 덱.** `asyncio`의 이벤트 루프도 이 셋이다.
- 스레드의 스택이 들고 있던 진행 상태를 객체가 들어야 한다. 연결 1만 개는 상태 기계 1만 개가 된다.
- 한 콜백이 오래 걸리면 전부 멈춘다. 이 모델의 유일하고 치명적인 규칙이다.
- 백프레셔 정책은 넷이고, 같은 부하에서 **무한 큐와 블로킹은 지연·헛일이 완전히 같다.** 블로킹이 하는 일은 메모리를 상류로 옮기고 상류가 느려짐을 알아채게 하는 것이다.
- 버림만이 지연을 잡는다(최대 지연 151 tick → 4 tick, 대신 37% 유실). 최신 값이 옛 값을 무의미하게 만드는 데이터에서만 옳다.
- 거절은 유실을 상류의 재시도로 바꾼다. 재시도 규칙이 없으면 전송이 73배로 는다.
- **무한 큐는 장애를 흡수하지 않고 미룬다.** 타임아웃 재시도가 붙으면 도착이 멈춘 뒤에도 큐가 자란다(400 tick에 2,890 → 600 tick에 4,328, 처리의 54%가 중복).
- 감시할 것은 큐 길이가 아니라 **큐에 든 항목의 나이**다. 용량은 허용 지연 × 소비 속도로 정한다.

**다음 절**: [XI-8 타이머 휠과 지연 큐](#/xi-8) — 이 루프의 타이머 힙이 10만 개가 되면 무엇이 무너지는가. 삽입 $O(\log n)$을 $O(1)$로 바꾸는 대신 무엇을 내주는지 실행해서 본다.
