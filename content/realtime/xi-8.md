# XI-8 타이머 휠과 지연 큐

::: lead
타임아웃 10만 개를 동시에 걸어 두어야 한다. 그중 대부분은 울리기 전에 취소된다. 무엇으로 관리하는가.
:::

## 1. 문제

[XI-7 이벤트 루프와 백프레셔](#/xi-7)의 루프는 타이머를 최소 힙에 담았다. 타이머가 열 개일 때는 그것으로 끝난다. 이제 개수를 실제 시스템의 규모로 올린다.

연결 10만 개를 받는 게이트웨이 하나가 거는 타임아웃을 세어 보면 이렇다.

- 연결마다 **유휴 타임아웃** 하나. 60초 동안 아무 말이 없으면 끊는다.
- 보낸 요청마다 **응답 타임아웃** 하나. 5초 안에 답이 없으면 실패로 처리한다.
- 재전송이 필요한 프로토콜이면 패킷마다 **재전송 타임아웃** 하나.

동시에 살아 있는 타이머가 수십만 개가 되고, 초당 수만 개가 새로 걸리고 취소된다. 힙에 담으면 각 삽입이 $O(\log n)$이다. $n$이 10만이면 $\log_2 n \approx 17$이니 그 자체로는 감당할 만하다.

문제는 다른 데 있다. **이 타이머들은 대부분 울리지 않는다.**

응답 타임아웃 5초를 걸어 두고 실제로는 3밀리초 만에 답이 온다. 그러면 그 타이머는 취소된다. TCP 재전송 타임아웃도 마찬가지다 — 정상 구간에서 재전송은 거의 일어나지 않고, ACK가 오는 순간 타이머는 사라진다. **정상 동작이란 곧 타이머가 취소되는 것**이고, 그래서 걸린 타이머의 90% 이상이 만료 없이 사라지는 것이 이 부하의 정상 모양이다.

힙에서 임의의 원소를 지우는 것은 그 위치를 알아야 하고, 알아도 $O(\log n)$이다. 그래서 실무의 힙 기반 지연 큐는 대개 **지연 삭제**를 쓴다 — 취소는 "죽었다"고 표시만 하고, 실제 제거는 그 원소가 힙 꼭대기에 올라올 때 한다. 취소 자체는 $O(1)$이 되지만 대가가 따른다. ==죽은 노드가 마감 시각이 올 때까지 힙에 그대로 남는다.== 5초짜리 타임아웃을 3밀리초 만에 취소해도 그 노드는 5초 동안 힙에서 자리를 차지하고, 그 5초 동안 들어오는 모든 삽입의 $\log n$을 키운다.

한 문장으로 줄이면 이렇다. **힙은 "다음에 울릴 것이 무엇인가"를 잘 답하는 구조인데, 우리가 실제로 많이 하는 연산은 "이건 안 울린다"이다.**

## 2. 아이디어 — 시간을 배열의 첨자로 쓴다

정렬을 왜 하는지 되물어야 한다. 힙은 마감 시각을 **비교해서** 순서를 만든다. 그런데 이벤트 루프의 타이머는 이미 시간 단위가 정해져 있다 — 1밀리초든 10밀리초든, **tick 이라는 최소 눈금**이 있다.

눈금이 있으면 비교가 필요 없다. **마감 시각을 배열의 첨자로 바꾸면 된다.**

```text nolines
   cur
    v
  +----+----+----+----+----+----+----+----+
  | 0  | 1  | 2  | 3  | 4  | 5  | 6  | 7  |     <- 슬롯 8개 = 8 tick
  +----+----+----+----+----+----+----+----+
         |         |
         ack       retransmit                   <- 만료 tick 이 곧 슬롯 번호
```

`delay` 뒤에 울릴 타이머는 `(now + delay) % SLOTS` 번 슬롯에 넣는다. 나눗셈 한 번이므로 **삽입이 $O(1)$**이다. tick 마다 커서를 한 칸 옮기고 그 칸의 목록을 통째로 발화시킨다. **tick 도 $O(1)$**이다. 취소는 그 슬롯에서 노드 하나를 떼는 것이라 위치만 알면 **$O(1)$**이다.

세 연산이 전부 상수 시간이다. 시계 문자판을 도는 바늘 모양이라 **타이머 휠**이라 부른다.

공짜일 리 없다. 내주는 것이 셋이다.

**첫째, 정밀도.** 마감이 슬롯 단위로 반올림된다. tick이 10밀리초면 3밀리초짜리 타임아웃은 표현되지 않는다. 그래서 커널은 저해상도 타이머와 고해상도 타이머를 따로 둔다.

**둘째, 메모리.** 슬롯 배열은 타이머가 하나도 없어도 그 크기만큼 상주한다.

**셋째, 사정거리.** 슬롯이 8개면 8 tick 앞까지만 구분된다. `now=0`에서 `delay=10`을 넣으면 슬롯 2번에 들어가는데, 그 슬롯은 tick 2에 발화한다. **10 tick 뒤에 울려야 할 타이머가 2 tick 만에 울린다.** §4.1에서 실제로 그렇게 되는 것을 본다.

셋째가 진짜 문제다. 60초 타임아웃을 1밀리초 tick으로 담으려면 슬롯이 6만 개 필요하고, 24시간짜리 만료를 담으려면 8,600만 개가 필요하다. 배열 하나로는 안 된다.

여기서 시계 문자판의 비유가 답까지 준다. **시계는 초침 하나로 12시간을 재지 않는다. 초침·분침·시침 세 개로 잰다.** 초침이 한 바퀴 돌면 분침이 한 칸 움직인다.

```text nolines
  L2 (한 칸 = 64 tick)   +--+--+--+--+ ... +--+     사정거리 512
  L1 (한 칸 =  8 tick)   +--+--+--+--+ ... +--+     사정거리  64
  L0 (한 칸 =  1 tick)   +--+--+--+--+ ... +--+     사정거리   8
                          ^
                          cur   L0 이 한 바퀴 돌 때마다 L1 한 칸을 아래로 턴다
```

층을 쌓으면 사정거리가 곱셈으로 늘어난다. 슬롯 $S$개짜리 $L$층이면 사정거리 $S^L$이고 메모리는 $S \times L$이다. $S=64$, $L=3$이면 슬롯 192칸으로 262,144 tick을 덮는다.

대신 연산이 하나 늘어난다. 위층에 있는 타이머는 만료 시각이 가까워지면 **아래층으로 내려와야 한다.** 하위 휠이 한 바퀴 돌 때마다 상위 휠의 다음 한 칸을 통째로 꺼내 다시 뿌린다. 이것을 **강등**(cascade)이라 한다. 타이머 하나가 겪는 강등은 최대 $L-1$번이므로, 층 수를 상수로 보면 **타이머당 총비용은 여전히 상수**다. 다만 그것은 **상각**이다 — 강등이 일어나는 그 한 번의 tick은 그 슬롯에 든 개수에 비례해 오래 걸린다. $O(1)$이라고 쓸 때 그 말이 최악 한 번을 뜻하지 않는다는 점을 정확히 알고 있어야 한다.

## 3. 손으로 따라가기

::: trace
슬롯 8칸짜리 2층 휠이다(사정거리 $8^2 = 64$). `now=0`에서 다음을 넣는다.

`ack`(+1) `keepalive`(+3) `flush`(+8) `retransmit`(+10) `session-timeout`(+17) `reconnect`(+40)

층은 남은 거리로 고른다. 8 tick 안이면 L0의 `due % 8`번 칸, 그보다 멀면 L1의 `(due // 8) % 8`번 칸이다. 초기 배치는 이렇다.

| 위치 | 들어 있는 것 |
|---|---|
| L0[1] | ack(due 1) |
| L0[3] | keepalive(due 3) |
| L1[1] | flush(due 8), retransmit(due 10) |
| L1[2] | session-timeout(due 17) |
| L1[5] | reconnect(due 40) |

tick은 ① `now % 8 == 0`이면 L1의 `(now // 8) % 8`번 칸을 통째로 꺼내 다시 배치하고 ② L0의 `now % 8`번 칸을 발화시킨다. 변화가 있는 tick만 적는다.

| tick | 강등된 것 | 발화한 것 |
|---|---|---|
| 1 | 없음 | ack |
| 3 | 없음 | keepalive |
| 8 | L1[1]의 2개 → flush는 L0[0], retransmit은 L0[2] | flush |
| 10 | | |
| 16 | | |
| 17 | | |

8 tick에서 `flush`가 **강등된 바로 그 tick에 발화한다.** 왜 순서를 뒤집으면 안 되는지 생각하면서 채워라.
:::

::: answer
| tick | 강등된 것 | 발화한 것 |
|---|---|---|
| 1 | 없음 | ack |
| 3 | 없음 | keepalive |
| 8 | L1[1]의 2개 → flush는 L0[0], retransmit은 L0[2] | flush |
| 10 | 없음 | retransmit |
| 16 | L1[2]의 1개 → session-timeout은 L0[1] | 없음 |
| 17 | 없음 | session-timeout |

세 가지가 드러난다.

**강등이 발화보다 먼저다.** `flush`의 마감은 8인데 `now=8`이 되기 전까지 L1[1]에 있었다. 이 tick에서 먼저 내려보내지 않고 L0[0]을 발화시키면 `flush`는 영영 울리지 않거나 한 바퀴 늦게 울린다. **순서가 곧 정확성이다.**

**한 칸이 통째로 내려온다.** L1[1]에는 마감이 8인 것과 10인 것이 같이 있었다. 위층의 한 칸은 8 tick 폭이라 그 안의 타이머들을 구분하지 않는다. 내려와서 L0에 다시 꽂힐 때 비로소 8과 10이 갈린다. **위층은 "대략 언제쯤"만 알고, 정확한 시각은 내려온 뒤에 정해진다.**

**같은 tick 안의 순서는 보장되지 않는다.** 강등된 것과 원래 그 칸에 있던 것이 섞인다. 힙은 (마감, 순번)으로 완전한 전순서를 주지만 휠은 tick 단위까지만 같다. 타이머 발화에 순서 의존이 있으면 그것은 타이머가 아니라 [XI-6 상태 기계](#/xi-6)로 표현해야 할 것이다.
:::

## 4. 구현

### 4.1 단순 휠 — 사정거리를 넘으면 조용히 틀린다

먼저 한 층짜리를 짠다. §2가 예고한 버그를 실제로 출력으로 본다.

::: dual
```python title="단순 타이머 휠 — 한 바퀴를 넘는 지연은 조기 발화한다"
SLOTS = 8
slots = [{} for _ in range(SLOTS)]   # 슬롯마다 {번호: (이름, 예정 tick)}
where = {}                           # 번호 → 슬롯. 취소를 O(1) 로 만든다
now = 0
seq = 0
missed = 0


def add(delay, name):
    global seq
    seq += 1
    due = now + delay
    idx = due % SLOTS                # ❌ 한 바퀴를 넘는 지연을 구분하지 못한다
    slots[idx][seq] = (name, due)
    where[seq] = idx
    return seq


def cancel(tid):
    idx = where.pop(tid, None)
    if idx is not None:
        slots[idx].pop(tid, None)


def tick():
    global now, missed
    now += 1
    idx = now % SLOTS
    fired, slots[idx] = slots[idx], {}
    for tid, (name, due) in fired.items():
        where.pop(tid, None)
        mark = "" if due == now else f"  <- 예정 {due}, 어긋남 {due - now}"
        print(f"tick {now}: {name} 발화{mark}")
        if due != now:
            missed += 1


add(1, "ack")
add(3, "keepalive")
add(8, "flush")
add(10, "retransmit")           # 휠 한 바퀴(8)를 넘는 지연
doomed = add(5, "cancelled")
cancel(doomed)                  # 대부분의 타이머는 이렇게 만료 전에 사라진다

for _ in range(10):
    tick()
print("어긋난 타이머:", missed)
```
```cpp title="단순 타이머 휠 — 한 바퀴를 넘는 지연은 조기 발화한다"
#include <iostream>
#include <map>
#include <string>
#include <utility>
#include <vector>
using namespace std;

const int SLOTS = 8;
vector<map<int, pair<string, int>>> slots(SLOTS);  // 슬롯마다 {번호: (이름, 예정 tick)}
map<int, int> where;                               // 번호 → 슬롯. 취소를 O(1) 로 만든다
int now_ = 0, seq = 0, missed = 0;

int add(int delay, const string& name) {
    seq += 1;
    int due = now_ + delay;
    int idx = due % SLOTS;                         // ❌ 한 바퀴를 넘는 지연을 구분하지 못한다
    slots[idx][seq] = {name, due};
    where[seq] = idx;
    return seq;
}

void cancel(int tid) {
    auto it = where.find(tid);
    if (it == where.end()) return;
    slots[it->second].erase(tid);
    where.erase(it);
}

void tick() {
    now_ += 1;
    int idx = now_ % SLOTS;
    auto fired = slots[idx];
    slots[idx].clear();
    for (auto& [tid, v] : fired) {
        where.erase(tid);
        const string& name = v.first;
        int due = v.second;
        string mark = (due == now_) ? "" : "  <- 예정 " + to_string(due) +
                                            ", 어긋남 " + to_string(due - now_);
        cout << "tick " << now_ << ": " << name << " 발화" << mark << "\n";
        if (due != now_) missed += 1;
    }
}

int main() {
    add(1, "ack");
    add(3, "keepalive");
    add(8, "flush");
    add(10, "retransmit");        // 휠 한 바퀴(8)를 넘는 지연
    int doomed = add(5, "cancelled");
    cancel(doomed);               // 대부분의 타이머는 이렇게 만료 전에 사라진다

    for (int i = 0; i < 10; i++) tick();
    cout << "어긋난 타이머: " << missed << "\n";
}
```
:::

```console
tick 1: ack 발화
tick 2: retransmit 발화  <- 예정 10, 어긋남 8
tick 3: keepalive 발화
tick 8: flush 발화
어긋난 타이머: 1
```

**복잡도:** 삽입 시간 $O(1)$ — 나눗셈 한 번으로 슬롯이 정해지고 그 슬롯에 넣는다. 취소 $O(1)$ — 번호로 슬롯을 알고 있어 탐색이 없다. tick $O(k)$ — 그 슬롯에 든 $k$개를 발화시킨다. $k$의 합은 전체 타이머 수이므로 **타이머당 상각 $O(1)$**이다. 공간 $O(\text{SLOTS} + n)$ — 슬롯 배열은 타이머가 없어도 상주한다.

두 번째 줄이 이 코드의 결함이다. **10 tick 뒤에 울려야 할 재전송 타이머가 2 tick 만에 울렸다.** 예외도 로그도 없이 그냥 8 tick 일찍 울린다. `%`가 한 바퀴를 접어 버렸기 때문이다.

::: danger
이 버그는 테스트를 잘 통과한다. 지연이 슬롯 수보다 작은 경우만 시험하면 전부 맞다. 슬롯 8칸에 지연 10을 주는 시험을 따로 짜지 않으면 운영에서 처음 만난다. **재전송 타이머가 일찍 울리면 아직 살아 있는 요청을 다시 보내고, 그것이 [XI-7 §5.2](#/xi-7)의 재시도 폭주로 이어진다.** 자료구조의 사정거리를 넘겼을 때 조용히 틀리는 대신 거부하도록 만드는 것이 최소한의 방어다.
:::

### 4.2 계층 휠 — 층을 쌓아 사정거리를 곱한다

§3에서 손으로 따라간 것을 그대로 짠다.

::: dual
```python title="계층 타이머 휠 — 강등으로 사정거리를 넓힌다"
SLOTS, LEVELS = 8, 2                 # 층마다 8칸. 두 층이면 사정거리는 8^2 = 64 tick
wheels = [[{} for _ in range(SLOTS)] for _ in range(LEVELS)]
now = 0
seq = 0


def place(due, name, tid):
    """마감까지 남은 거리로 층을 고른다. 멀수록 위층, 위층은 한 칸이 굵다."""
    d = due - now
    for L in range(LEVELS):
        if d < SLOTS ** (L + 1):
            idx = (due // SLOTS ** L) % SLOTS
            wheels[L][idx][tid] = (name, due)
            return L, idx
    return None, None                # 사정거리 밖


def add(delay, name):
    global seq
    seq += 1
    L, idx = place(now + delay, name, seq)
    if L is None:
        print(f"거부: {name} — 지연 {delay}, 사정거리 {SLOTS ** LEVELS} 밖")
    return seq


def cascade(L):
    """위층 한 칸을 통째로 꺼내 아래층으로 다시 뿌린다. 이것이 계층 휠의 유일한 추가 비용이다."""
    if L >= LEVELS:
        return
    idx = (now // SLOTS ** L) % SLOTS
    items, wheels[L][idx] = wheels[L][idx], {}
    if items:
        print(f"tick {now}: 강등 L{L}[{idx}] {len(items)}개 → 아래층")
    for tid, (name, due) in items.items():
        place(due, name, tid)
    if idx == 0:                     # 이 층도 한 바퀴 돌았다 → 그 위층을 턴다
        cascade(L + 1)


def tick():
    global now
    now += 1
    if now % SLOTS == 0:             # 최하층이 한 바퀴 돌 때만 위를 본다
        cascade(1)
    idx = now % SLOTS
    fired, wheels[0][idx] = wheels[0][idx], {}
    for tid, (name, due) in fired.items():
        assert due == now            # 이제 어긋나지 않는다
        print(f"tick {now}: {name} 발화")


add(1, "ack")
add(3, "keepalive")
add(8, "flush")
add(10, "retransmit")
add(17, "session-timeout")
add(40, "reconnect")
add(70, "gc")                        # 사정거리 밖

for _ in range(45):
    tick()
```
```cpp title="계층 타이머 휠 — 강등으로 사정거리를 넓힌다"
#include <iostream>
#include <map>
#include <string>
#include <utility>
#include <vector>
using namespace std;

const int SLOTS = 8, LEVELS = 2;   // 층마다 8칸. 두 층이면 사정거리는 8^2 = 64 tick
vector<vector<map<int, pair<string, int>>>> wheels(
    LEVELS, vector<map<int, pair<string, int>>>(SLOTS));
int now_ = 0, seq = 0;

int ipow(int b, int e) { int r = 1; while (e--) r *= b; return r; }

// 마감까지 남은 거리로 층을 고른다. 멀수록 위층, 위층은 한 칸이 굵다.
int place(int due, const string& name, int tid) {
    int d = due - now_;
    for (int L = 0; L < LEVELS; L++) {
        if (d < ipow(SLOTS, L + 1)) {
            int idx = (due / ipow(SLOTS, L)) % SLOTS;
            wheels[L][idx][tid] = {name, due};
            return L;
        }
    }
    return -1;                     // 사정거리 밖
}

int add(int delay, const string& name) {
    seq += 1;
    int L = place(now_ + delay, name, seq);
    if (L < 0)
        cout << "거부: " << name << " — 지연 " << delay << ", 사정거리 "
             << ipow(SLOTS, LEVELS) << " 밖\n";
    return seq;
}

// 위층 한 칸을 통째로 꺼내 아래층으로 다시 뿌린다. 이것이 계층 휠의 유일한 추가 비용이다.
void cascade(int L) {
    if (L >= LEVELS) return;
    int idx = (now_ / ipow(SLOTS, L)) % SLOTS;
    auto items = wheels[L][idx];
    wheels[L][idx].clear();
    if (!items.empty())
        cout << "tick " << now_ << ": 강등 L" << L << "[" << idx << "] " << items.size()
             << "개 → 아래층\n";
    for (auto& [tid, v] : items) place(v.second, v.first, tid);
    if (idx == 0) cascade(L + 1);  // 이 층도 한 바퀴 돌았다 → 그 위층을 턴다
}

void tick() {
    now_ += 1;
    if (now_ % SLOTS == 0) cascade(1);   // 최하층이 한 바퀴 돌 때만 위를 본다
    int idx = now_ % SLOTS;
    auto fired = wheels[0][idx];
    wheels[0][idx].clear();
    for (auto& [tid, v] : fired) {
        (void)tid;
        cout << "tick " << now_ << ": " << v.first << " 발화\n";
    }
}

int main() {
    add(1, "ack");
    add(3, "keepalive");
    add(8, "flush");
    add(10, "retransmit");
    add(17, "session-timeout");
    add(40, "reconnect");
    add(70, "gc");                 // 사정거리 밖
    for (int i = 0; i < 45; i++) tick();
}
```
:::

```console
거부: gc — 지연 70, 사정거리 64 밖
tick 1: ack 발화
tick 3: keepalive 발화
tick 8: 강등 L1[1] 2개 → 아래층
tick 8: flush 발화
tick 10: retransmit 발화
tick 16: 강등 L1[2] 1개 → 아래층
tick 17: session-timeout 발화
tick 40: 강등 L1[5] 1개 → 아래층
tick 40: reconnect 발화
```

**복잡도:** 삽입 $O(L)$ — 층을 고르는 비교가 최대 $L$번이고 $L$은 상수(위 코드는 2, 실무는 4~6). 취소 $O(1)$. tick은 **상각 $O(1)$**이다 — 타이머 하나가 겪는 강등이 최대 $L-1$번이므로 전체 강등 횟수가 $O(nL)$이고 tick 수로 나누면 상수다. 그러나 **최악의 한 tick은 $O(k)$**다($k$는 그때 강등되는 칸의 크기). 실시간 제약이 있는 코드라면 이 최악값을 봐야 한다([XI-5](#/xi-5)의 최악 실행 시간이 그 이야기다). 공간 $O(S \times L + n)$ — 사정거리는 $S^L$로 늘지만 메모리는 $S \times L$로만 는다. **이 비대칭이 계층 구조의 전부다.**

`gc`가 거부된 줄이 §4.1의 조용한 오작동을 대체한 것이다. 사정거리를 넘는 타이머를 어떻게 할지는 설계 선택이고, 흔한 답은 셋이다 — 거부하거나, 최상위 휠의 마지막 칸에 몰아넣고 내려오면 다시 배치하거나, 층을 늘린다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 슬롯 컨테이너 | `dict` — 삽입 순서를 기억하고 임의 키 삭제가 평균 $O(1)$ | `std::map`은 키 순서, 삭제 $O(\log k)$. 진짜 $O(1)$을 쓰려면 `unordered_map`이거나 침습적 이중 연결 리스트 |
| 발화 순서 | `dict` 순회가 삽입 순서라 결정적 | `map`은 키 순서, `unordered_map`은 순서 보장 없음. **같은 tick 안의 순서에 기대면 언어마다 다르게 동작한다** |
| 나눗셈 | `//`는 음수에서 내림. 마감이 음수가 될 수 있으면 갈린다 | `/`는 0 방향 절삭 |
| 슬롯 수 | `%`가 상수 폴딩되지 않는다 | 슬롯 수를 2의 거듭제곱으로 두면 `%`가 `&`로, `/`가 `>>`로 컴파일된다. 커널 구현이 64·256을 쓰는 이유다 |
| 실제 구현 | `asyncio`는 휠이 아니라 `heapq` 힙을 쓴다 | 커널·네트워크 프레임워크는 대부분 휠이다 |

::: pitfall
- **강등을 발화보다 나중에 하면 타이머가 한 바퀴 늦거나 영영 안 울린다.** §3의 `flush`가 그 경계다.
- **`now`가 아니라 `delay`로 슬롯을 계산하면 틀린다.** 슬롯 번호는 절대 시각 `due`에서 나와야 한다. 상대 거리로 계산하면 강등할 때마다 오차가 쌓인다.
- **취소한 타이머의 번호를 재사용하면 다른 타이머가 취소된다.** 번호를 단조 증가시키고 재사용하지 마라.
- **tick을 몰아서 진행시키면(`now += 5`) 중간 슬롯이 통째로 건너뛴다.** 루프가 늦게 깨어난 경우 밀린 tick을 하나씩 돌려야 한다. 이벤트 루프가 `select`에서 예상보다 오래 잤을 때 실제로 일어난다.
- **벽시계(`system_clock`)를 시간 원천으로 쓰면 NTP 보정 한 번에 타이머가 전부 어긋난다.** 단조 시계를 써라.
:::

## 5. 힙과 대조 — 어느 쪽이 언제 이기는가

같은 부하를 두 구조에 그대로 먹인다. 타이머 2만 개, 지연은 1~65,536 tick에 흩어져 있고, **90%가 만료 전에 취소된다.** 결정적 난수(LCG)를 쓰므로 두 구조는 정확히 같은 입력을 본다.

::: dual
```python title="힙 기반 지연 큐 vs 계층 휠 — 연산 횟수와 발화 결과"
N = 20000          # 타이머 수
HORIZON = 65536    # 최대 지연
SLOTS, LEVELS = 64, 3

state = 12345


def rnd():
    global state
    state = (state * 1103515245 + 12345) % (1 << 31)
    return state


# ---- 부하 만들기: 지연은 흩어져 있고, 90%는 만료 전에 취소된다 (TCP 재전송이 이 모양이다)
timers = []
cancel_at = {}
for tid in range(N):
    delay = (rnd() >> 8) % HORIZON + 1
    timers.append(delay)
    if (rnd() >> 8) % 10 != 0:
        cancel_at.setdefault(delay // 2, []).append(tid)


class HeapQueue:
    """힙 기반 지연 큐. 취소는 표시만 하고 실제 제거는 꺼낼 때 한다(지연 삭제)."""

    def __init__(self):
        self.h = []            # (마감, 번호)
        self.dead = set()
        self.moves = 0         # sift 로 원소가 자리를 옮긴 횟수
        self.peak = 0

    def add(self, due, tid):
        self.h.append((due, tid))
        i = len(self.h) - 1
        while i > 0:                                   # sift-up
            p = (i - 1) // 2
            if self.h[p] <= self.h[i]:
                break
            self.h[p], self.h[i] = self.h[i], self.h[p]
            self.moves += 1
            i = p
        self.peak = max(self.peak, len(self.h))

    def cancel(self, tid):
        self.dead.add(tid)                             # O(1). 대신 죽은 노드가 힙에 남는다

    def _pop(self):
        top = self.h[0]
        last = self.h.pop()
        if self.h:
            self.h[0] = last
            i, n = 0, len(self.h)
            while True:                                # sift-down
                c = 2 * i + 1
                if c >= n:
                    break
                if c + 1 < n and self.h[c + 1] < self.h[c]:
                    c += 1
                if self.h[i] <= self.h[c]:
                    break
                self.h[i], self.h[c] = self.h[c], self.h[i]
                self.moves += 1
                i = c
        return top

    def tick(self, now):
        out = []
        while self.h and self.h[0][0] <= now:
            due, tid = self._pop()
            if tid not in self.dead:
                out.append(tid)
        return out


class Wheel:
    """계층 타이머 휠. 삽입·취소는 슬롯 계산 한 번, tick 은 슬롯 한 칸."""

    def __init__(self):
        self.w = [[{} for _ in range(SLOTS)] for _ in range(LEVELS)]
        self.where = {}
        self.moves = 0         # 강등으로 다시 꽂은 횟수
        self.alive = 0
        self.peak = 0

    def _place(self, due, tid, now):
        d = due - now
        for L in range(LEVELS):
            if d < SLOTS ** (L + 1):
                idx = (due // SLOTS ** L) % SLOTS
                self.w[L][idx][tid] = due
                self.where[tid] = (L, idx)
                return
        raise ValueError("사정거리 밖")

    def add(self, due, tid):
        self._place(due, tid, 0)
        self.alive += 1
        self.peak = max(self.peak, self.alive)

    def cancel(self, tid):
        L, idx = self.where.pop(tid)                   # 슬롯을 알고 있으므로 바로 뗀다
        del self.w[L][idx][tid]
        self.alive -= 1

    def _cascade(self, L, now):
        if L >= LEVELS:
            return
        idx = (now // SLOTS ** L) % SLOTS
        items, self.w[L][idx] = self.w[L][idx], {}
        for tid, due in items.items():
            self._place(due, tid, now)
            self.moves += 1
        if idx == 0:
            self._cascade(L + 1, now)

    def tick(self, now):
        if now % SLOTS == 0:
            self._cascade(1, now)
        idx = now % SLOTS
        fired, self.w[0][idx] = self.w[0][idx], {}
        for tid in fired:
            del self.where[tid]
        self.alive -= len(fired)
        return list(fired)


heap, wheel = HeapQueue(), Wheel()
for tid, delay in enumerate(timers):
    heap.add(delay, tid)
    wheel.add(delay, tid)
for tid in cancel_at.get(0, ()):
    heap.cancel(tid)
    wheel.cancel(tid)

same = True
fired_h = fired_w = 0
size_h = size_w = 0
for now in range(1, HORIZON + 1):
    for tid in cancel_at.get(now, ()):
        heap.cancel(tid)
        wheel.cancel(tid)
    a, b = heap.tick(now), wheel.tick(now)
    fired_h += len(a)
    fired_w += len(b)
    if sorted(a) != sorted(b):                         # 자료구조가 달라도 결과는 같아야 한다
        same = False
    if now == 20000:                                   # 중간 시점에 각자 들고 있는 노드 수
        size_h, size_w = len(heap.h), wheel.alive

cancels = sum(len(v) for v in cancel_at.values())
print(f"타이머 {N}개 · 취소 {cancels}개 · tick {HORIZON}회")
print(f"{'structure':<14}{'fired':>7}{'moves':>10}{'nodes@20000':>13}")
print(f"{'heap(lazy)':<14}{fired_h:>7}{heap.moves:>10}{size_h:>13}")
print(f"{'wheel(64x3)':<14}{fired_w:>7}{wheel.moves:>10}{size_w:>13}")
print("발화 결과 일치:", same)
```
```cpp title="힙 기반 지연 큐 vs 계층 휠 — 연산 횟수와 발화 결과"
#include <algorithm>
#include <iomanip>
#include <iostream>
#include <map>
#include <set>
#include <utility>
#include <vector>
using namespace std;

const int N = 20000;          // 타이머 수
const int HORIZON = 65536;    // 최대 지연
const int SLOTS = 64, LEVELS = 3;

unsigned long long state = 12345;
unsigned long long rnd() {
    state = (state * 1103515245ULL + 12345ULL) % (1ULL << 31);
    return state;
}

int ipow(int b, int e) { int r = 1; while (e--) r *= b; return r; }

// 힙 기반 지연 큐. 취소는 표시만 하고 실제 제거는 꺼낼 때 한다(지연 삭제).
struct HeapQueue {
    vector<pair<int, int>> h;   // (마감, 번호)
    set<int> dead;
    long moves = 0;            // sift 로 원소가 자리를 옮긴 횟수

    void add(int due, int tid) {
        h.push_back({due, tid});
        int i = (int)h.size() - 1;
        while (i > 0) {                                // sift-up
            int p = (i - 1) / 2;
            if (!(h[i] < h[p])) break;
            swap(h[p], h[i]);
            moves += 1;
            i = p;
        }
    }

    void cancel(int tid) { dead.insert(tid); }          // O(1). 대신 죽은 노드가 힙에 남는다

    pair<int, int> pop() {
        pair<int, int> top = h[0];
        pair<int, int> last = h.back();
        h.pop_back();
        if (!h.empty()) {
            h[0] = last;
            int i = 0, n = (int)h.size();
            while (true) {                             // sift-down
                int c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && h[c + 1] < h[c]) c += 1;
                if (!(h[c] < h[i])) break;
                swap(h[i], h[c]);
                moves += 1;
                i = c;
            }
        }
        return top;
    }

    vector<int> tick(int now) {
        vector<int> out;
        while (!h.empty() && h[0].first <= now) {
            auto [due, tid] = pop();
            (void)due;
            if (!dead.count(tid)) out.push_back(tid);
        }
        return out;
    }
};

// 계층 타이머 휠. 삽입·취소는 슬롯 계산 한 번, tick 은 슬롯 한 칸.
struct Wheel {
    vector<vector<map<int, int>>> w{LEVELS, vector<map<int, int>>(SLOTS)};
    map<int, pair<int, int>> where;
    long moves = 0;            // 강등으로 다시 꽂은 횟수
    long alive = 0;

    void place(int due, int tid, int now) {
        int d = due - now;
        for (int L = 0; L < LEVELS; L++) {
            if (d < ipow(SLOTS, L + 1)) {
                int idx = (due / ipow(SLOTS, L)) % SLOTS;
                w[L][idx][tid] = due;
                where[tid] = {L, idx};
                return;
            }
        }
    }

    void add(int due, int tid) { place(due, tid, 0); alive += 1; }

    void cancel(int tid) {
        auto [L, idx] = where[tid];                    // 슬롯을 알고 있으므로 바로 뗀다
        w[L][idx].erase(tid);
        where.erase(tid);
        alive -= 1;
    }

    void cascade(int L, int now) {
        if (L >= LEVELS) return;
        int idx = (now / ipow(SLOTS, L)) % SLOTS;
        auto items = w[L][idx];
        w[L][idx].clear();
        for (auto& [tid, due] : items) { place(due, tid, now); moves += 1; }
        if (idx == 0) cascade(L + 1, now);
    }

    vector<int> tick(int now) {
        if (now % SLOTS == 0) cascade(1, now);
        int idx = now % SLOTS;
        auto fired = w[0][idx];
        w[0][idx].clear();
        vector<int> out;
        for (auto& [tid, due] : fired) { (void)due; where.erase(tid); out.push_back(tid); }
        alive -= (long)out.size();
        return out;
    }
};

int main() {
    // ---- 부하 만들기: 지연은 흩어져 있고, 90%는 만료 전에 취소된다 (TCP 재전송이 이 모양이다)
    vector<int> timers(N);
    map<int, vector<int>> cancel_at;
    long cancels = 0;
    for (int tid = 0; tid < N; tid++) {
        int delay = (int)((rnd() >> 8) % HORIZON) + 1;
        timers[tid] = delay;
        if ((rnd() >> 8) % 10 != 0) { cancel_at[delay / 2].push_back(tid); cancels += 1; }
    }

    HeapQueue heap;
    Wheel wheel;
    for (int tid = 0; tid < N; tid++) { heap.add(timers[tid], tid); wheel.add(timers[tid], tid); }
    for (int tid : cancel_at[0]) { heap.cancel(tid); wheel.cancel(tid); }

    bool same = true;
    long fired_h = 0, fired_w = 0, size_h = 0, size_w = 0;
    for (int now = 1; now <= HORIZON; now++) {
        auto it = cancel_at.find(now);
        if (it != cancel_at.end())
            for (int tid : it->second) { heap.cancel(tid); wheel.cancel(tid); }
        vector<int> a = heap.tick(now), b = wheel.tick(now);
        fired_h += (long)a.size();
        fired_w += (long)b.size();
        sort(a.begin(), a.end());
        sort(b.begin(), b.end());
        if (a != b) same = false;                      // 자료구조가 달라도 결과는 같아야 한다
        if (now == 20000) { size_h = (long)heap.h.size(); size_w = wheel.alive; }
    }

    cout << "타이머 " << N << "개 · 취소 " << cancels << "개 · tick " << HORIZON << "회\n";
    cout << left << setw(14) << "structure" << right << setw(7) << "fired" << setw(10) << "moves"
         << setw(13) << "nodes@20000" << "\n";
    cout << left << setw(14) << "heap(lazy)" << right << setw(7) << fired_h << setw(10)
         << heap.moves << setw(13) << size_h << "\n";
    cout << left << setw(14) << "wheel(64x3)" << right << setw(7) << fired_w << setw(10)
         << wheel.moves << setw(13) << size_w << "\n";
    cout << "발화 결과 일치: " << (same ? "True" : "False") << "\n";
}
```
:::

```console
타이머 20000개 · 취소 17996개 · tick 65536회
structure       fired     moves  nodes@20000
heap(lazy)       2004    259348        13976
wheel(64x3)      2004      3849         8371
발화 결과 일치: True
```

**복잡도:** 힙은 삽입마다 sift-up이 $O(\log n)$, 발화·정리마다 sift-down이 $O(\log n)$이라 전체 $O(n \log n)$. 휠은 삽입·취소가 $O(1)$이고 강등이 타이머당 최대 $L-1$번이라 전체 $O(nL)$. **로그가 상수로 바뀐 것이 측정된 259,348 대 3,849(67배)다.**

마지막 줄이 가장 중요하다. **자료구조가 달라도 발화 결과는 모든 tick에서 같다.** 다르면 빠른 쪽은 아무 의미가 없다. 새 자료구조를 넣을 때 먼저 확인할 것은 속도가 아니라 이 등가성이다.

세 번째 열도 봐야 한다. 20,000 tick 시점에 힙은 노드 13,976개를 들고 있는데 그중 5,605개(40%)가 이미 취소된 죽은 노드다. **지연 삭제의 대가가 이 40%다.** 휠은 취소된 즉시 슬롯에서 떼므로 8,371개만 남는다.

::: perf
같은 부하를 타이머 100,000개로 키우고 벽시계 시간을 잰 값이다. 5회 반복, 중앙값(최소~최대). 스크립트는 `tools/bench/timer_wheel_vs_heap.py`와 `.cpp`에 있다. 두 구조의 발화 결과가 모든 tick에서 같은 것을 확인한 뒤 시간을 잰다.

| 부하 | 힙 | 휠 | 배수 |
|---|---|---|---|
| Python `cancel90`(90% 취소) | 340 ms (320~360) | **210 ms** (200~220) | 1.6배 |
| Python `expire`(취소 0) | **250 ms** (210~250) | 300 ms (290~310) | 0.8배 |
| C++ `cancel90` | 41 ms (41~45) | **11 ms** (10~12) | 3.8배 |
| C++ `expire` | 17 ms (16~21) | **9.0 ms** (9~11) | 1.8배 |

타이머 1,000,000개로 올리면 C++ `cancel90`은 힙 860 ms(830~1000) 대 휠 180 ms(160~200)로 4.7배까지 벌어지고, `expire`에서는 210 ms 대 210 ms로 비긴다.

(Linux x86-64 / CPython 3.13 / g++ 13 `-O2` 실측. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다.)
:::

수치가 말하는 것은 하나다. ==휠의 이점은 취소가 많을 때 나온다.== 전부 만료되는 부하에서는 차이가 줄고, Python에서는 오히려 힙이 이긴다 — `heapq`는 C로 구현되어 있고 휠은 파이썬 루프이기 때문이다. **자료구조의 복잡도 차이가 언어의 상수 차이에 먹힐 수 있다는 사실을, 이 표가 그대로 보여준다.**

::: tip
그러므로 선택 기준은 개수가 아니라 **부하의 모양**이다. 타이머가 대부분 만료된다면(작업 스케줄러, 예약 실행) 힙으로 충분하고 정밀도도 얻는다. 타이머가 대부분 취소된다면(네트워크 타임아웃) 휠이다. Python에서는 여기에 하나가 더 붙는다 — 순수 파이썬으로 짠 휠보다 C로 구현된 `heapq`가 나은 구간이 넓다. `asyncio`가 휠을 쓰지 않는 이유가 이것이다.
:::

## 6. 어디에 쓰이는가

**리눅스 커널의 저해상도 타이머가 계층 타이머 휠이다.** 커널은 밀리초 단위 tick마다 커서를 한 칸 옮기고 그 칸의 목록을 발화시킨다. 슬롯 수를 2의 거듭제곱으로 잡아 나눗셈을 시프트로 바꾸는 최적화까지 §4.2에서 본 그대로다. 강등이 최악의 tick을 길게 만드는 문제 때문에, 지금의 커널은 강등을 없애는 대신 먼 미래 타이머의 만료 정밀도를 느슨하게 하는 쪽으로 바뀌었다 — **정밀도와 최악 지연을 맞바꾼 것**이고, §2가 말한 세 가지 대가 중 첫째를 더 내주고 셋째를 산 셈이다. 마이크로초 정밀도가 필요한 고해상도 타이머는 휠이 아니라 레드-블랙 트리에 따로 담는다.

**TCP 재전송 타임아웃이 §5의 `cancel90` 부하 그 자체다.** 세그먼트를 보낼 때마다 타이머를 걸고 ACK가 오면 취소한다. 정상 구간에서는 거의 전부 취소되므로, 이 부하에서 힙의 지연 삭제는 죽은 노드로 힙을 채운다. 커널이 휠을 쓰는 이유가 성능 일반론이 아니라 **이 부하의 모양**이다.

**자바 네트워크 프레임워크의 `HashedWheelTimer`가 한 층짜리 해시 휠이다.** 사정거리를 넘는 지연은 "몇 바퀴 남았는가"를 노드에 적어 두고 커서가 지날 때마다 하나씩 줄인다. 계층을 쌓는 대신 바퀴 수를 세는 방식이고, 강등이 없는 대신 먼 타이머는 커서가 지날 때마다 한 번씩 건드려진다.

**메시지 브로커의 지연 처리에도 같은 구조가 들어간다.** 확인 응답 대기, 재시도 예약처럼 "대부분 취소되는 대량의 타임아웃"이 브로커의 일상이고, 계층 휠 위에 만료 임박한 층만 별도 큐로 감시하는 구성이 널리 쓰인다.

**이 챕터의 원전은 Varghese & Lauck, 1987, *Hashed and Hierarchical Timing Wheels*다.** 정렬된 목록의 $O(n)$, 힙의 $O(\log n)$, 해시 휠의 $O(1)$을 같은 자리에서 비교하고 계층 구조를 제시한 논문이다.

::: interview
**"타임아웃 10만 개를 어떻게 관리하겠는가?"**

1. **먼저 부하의 모양을 되묻는다.** 대부분 만료되는가, 대부분 취소되는가. 이 질문을 안 하고 자료구조부터 고르면 절반은 틀린다.
2. **취소가 지배적이면 타이머 휠.** 삽입·취소·tick이 전부 상수 시간이고, 그 상수는 슬롯 계산 한 번이다.
3. **$O(1)$이 상각이라는 것을 정확히 말한다.** 강등되는 tick은 그 칸의 크기에 비례해 오래 걸린다. 최악 지연이 중요한 시스템이면 이것이 결격 사유가 될 수 있다.
4. **대가 셋을 댄다.** 정밀도(tick 단위 반올림), 메모리(슬롯 배열 상주), 사정거리(층 수로 결정).
5. **힙이 나은 경우를 함께 댄다.** "다음에 울릴 것"을 자주 물어야 하거나, 정밀한 시각이 필요하거나, 타이머가 대부분 만료되는 경우다.
:::

## 연습

::: quiz
**1. 세션 유휴 타임아웃**
- 상황: 동시 접속 50만 개. 연결마다 "30분 동안 아무 요청이 없으면 끊는다"를 건다. 요청이 올 때마다 타임아웃을 30분 뒤로 미룬다.
- 무엇이 병목인가: 만료가 아니라 **갱신**이다. 활동적인 연결은 초당 수십 번 타이머를 옮긴다. 힙이면 옮길 때마다 $O(\log n)$이 두 번(제거+삽입) 든다.
- 어떤 구조이고 대가는 무엇인가: 갱신을 "취소 후 재삽입"으로 보면 휠이 맞고, 대가는 30분을 덮을 사정거리다. 더 나은 답은 자료구조를 바꾸는 것이 아니다 — **모든 타임아웃이 같은 길이이므로 갱신 순서가 곧 만료 순서다.** 접근할 때마다 맨 뒤로 옮기는 연결 리스트 하나면 갱신도 만료 검사도 $O(1)$이 된다. 자료구조를 고르기 전에 타임아웃 길이가 균일한지 먼저 봐야 한다.

**2. 예약 작업 스케줄러**
- 상황: "3시간 뒤 실행", "매일 새벽 4시" 같은 예약을 100만 건 관리한다. 취소는 드물고 거의 전부 실행된다.
- 무엇이 병목인가: 병목이 뚜렷하지 않다. 취소가 없으므로 지연 삭제의 쓰레기가 쌓이지 않고, 초당 삽입도 많지 않다.
- 어떤 구조이고 대가는 무엇인가: 힙으로 충분하다. §5의 `expire` 행이 근거다 — 취소가 없으면 배수가 무너지고, Python에서는 힙이 오히려 빠르다. 게다가 예약 시각은 초 단위 정밀도가 요구되므로 tick 반올림이 손해다. **여기서 휠을 쓰는 것은 근거 없는 최적화다.**

**3. 게임 서버의 버프 만료**
- 상황: 플레이어 1만 명에게 각각 지속시간이 다른 효과가 붙는다. 효과는 15초, 30초, 5분처럼 짧고 종류가 정해져 있으며, 해제로 조기 종료되는 일이 잦다.
- 무엇이 병목인가: 조기 해제가 잦다는 점, 그리고 만료 검사가 게임 루프의 매 프레임에서 일어난다는 점이다. 프레임 하나의 최악 시간이 예산 안에 들어와야 한다.
- 어떤 구조이고 대가는 무엇인가: 프레임 주기를 tick으로 삼는 휠이 맞다. 조기 해제가 $O(1)$이고 프레임마다 슬롯 한 칸만 본다. 대가는 **강등이 일어나는 프레임이 튄다**는 것이고, 지속시간 종류가 적으므로 사정거리를 최장 효과에 맞춰 한 층으로 끝내면 강등 자체를 없앨 수 있다.
:::

## 요약

- 타임아웃의 정상 동작은 **취소**다. 걸린 타이머의 90% 이상이 만료 없이 사라지는 것이 네트워크 부하의 정상 모양이다.
- 힙은 "다음에 울릴 것"을 잘 답하지만 취소가 약하다. 지연 삭제를 쓰면 취소는 $O(1)$이 되는 대신 **죽은 노드가 마감 시각까지 힙에 남는다**(측정된 40%).
- 타이머 휠은 마감 시각을 배열 첨자로 바꾼다. 비교가 사라지므로 삽입·취소·tick이 전부 상수 시간이다.
- 대가는 셋이다. **정밀도**(tick 단위 반올림), **메모리**(슬롯 배열 상주), **사정거리**(슬롯 수까지만 구분). 사정거리를 넘기면 조용히 일찍 발화한다.
- 층을 쌓으면 사정거리는 $S^L$로 늘고 메모리는 $S \times L$로만 는다. 이 비대칭이 계층 휠의 전부다.
- **강등은 발화보다 먼저 해야 한다.** 순서를 뒤집으면 타이머가 한 바퀴 늦거나 영영 울리지 않는다.
- 휠의 $O(1)$은 **상각**이다. 강등이 일어나는 tick은 그 칸의 크기에 비례하고, 최악 지연이 중요한 시스템에서는 이것이 결격 사유가 된다.
- 같은 부하에서 힙의 sift 이동 259,348회가 휠의 강등 3,849회로 줄었고(67배), **두 구조의 발화 결과는 모든 tick에서 같다.** 등가성이 먼저고 속도는 그다음이다.
- 이점은 취소가 많을 때만 나온다. 전부 만료되는 부하에서는 배수가 무너지고, Python에서는 C로 구현된 `heapq`가 순수 파이썬 휠을 이긴다.

**다음 절**: [XI-9 공간 인덱스](#/xi-9) — 시간을 슬롯으로 나눈 것과 같은 발상을 공간에 적용한다. 격자 해싱·KD 트리·옥트리가 "가까운 것만 보기" 위해 무엇을 나누는지 본다.
