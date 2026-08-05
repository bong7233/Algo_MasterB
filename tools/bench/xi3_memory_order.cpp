// 메모리 순서가 실제로 무엇을 허용하는가 — XI-3.
//
// 저장 버퍼 리트머스(store buffering):
//     스레드 1: x = 1;  a = y;
//     스레드 2: y = 1;  b = x;
// 순차적 일관성 아래에서는 (a, b) = (0, 0) 이 불가능하다. 어느 저장이 먼저든
// 뒤에 오는 적재 중 하나는 1을 봐야 하기 때문이다. 그런데 x86-64 는 저장을
// 버퍼에 담아 두고 뒤의 적재를 먼저 처리한다(StoreLoad 재배치). relaxed 는
// 그것을 막지 않고, seq_cst 는 막는다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4코어)
// 빌드: g++ -std=c++17 -O2 -pthread tools/bench/xi3_memory_order.cpp -o /tmp/xi3m && /tmp/xi3m

#include <atomic>
#include <cstdio>
#include <thread>
using namespace std;

const int ROUNDS = 1000000;
const int REPS = 5;

atomic<int> x{0}, y{0};
atomic<int> turn{-1};        // 라운드 번호 — 두 스레드를 같은 라운드에 묶는다
atomic<int> arrived{0};
int a = 0, b = 0;

template <memory_order MO>
void worker(int who) {
    for (int r = 0; r < ROUNDS; r++) {
        while (turn.load() != r) { }
        if (who == 0) {
            x.store(1, MO);
            a = y.load(MO);
        } else {
            y.store(1, MO);
            b = x.load(MO);
        }
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
        x.store(0);
        y.store(0);
        arrived.store(0);
        turn.store(r);
        while (arrived.load() < 2) { }
        if (a == 0 && b == 0) weird++;
    }
    t1.join();
    t2.join();
    return weird;
}

int main() {
    printf("라운드 %d · 반복 %d회 · 코어 4\n", ROUNDS, REPS);
    for (int i = 0; i < REPS; i++) {
        int rl = run<memory_order_relaxed>();
        int sc = run<memory_order_seq_cst>();
        printf("  relaxed (0,0) %6d회 (%.3f%%) · seq_cst (0,0) %d회\n",
               rl, 100.0 * rl / ROUNDS, sc);
    }
    return 0;
}
