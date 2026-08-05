// 링 버퍼에 생산자가 둘이 되는 순간 (C++).
//
// C++ 에는 GIL 이 없다. 두 스레드가 동기화 없이 같은 `head` 를 읽고 쓰는 것은
// 데이터 레이스이고 표준상 미정의 동작이다. 실제로는 두 생산자가 같은 슬롯에
// 쓰고 기록량이 모자란다. 락을 건 판과 나란히 돌려 답이 갈리는 것을 센다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4 코어).
// 빌드·실행: g++ -std=c++17 -O2 -pthread tools/bench/ringbuffer_race.cpp -o /tmp/rr && /tmp/rr

#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

static const int CAP = 1 << 20;
static const int ROUNDS = 100;

struct Ring {
    vector<int> buf;
    int cap, head = 0;
    mutex mu;
    bool locked;
    Ring(int cap, bool locked) : buf(cap, 0), cap(cap), locked(locked) {}

    void push(int x) {
        if (locked) {
            lock_guard<mutex> g(mu);
            int h = head;
            buf[h] = x;
            head = (h + 1) % cap;
        } else {
            int h = head;
            buf[h] = x;
            head = (h + 1) % cap;
        }
    }
};

long long one_round(int per, bool locked, int* head_out) {
    Ring q(CAP, locked);
    auto work = [&] {
        for (int i = 0; i < per; i++) q.push(1);
    };
    thread a(work), b(work);
    a.join();
    b.join();
    long long s = 0;
    for (int v : q.buf) s += v;
    *head_out = q.head;
    return s;
}

void survey(int per, bool locked, const char* label) {
    int bad = 0;
    long long tot = 0;
    int want = per * 2;
    for (int r = 0; r < ROUNDS; r++) {
        int head = 0;
        long long written = one_round(per, locked, &head);
        tot += written;
        if (head != want || written != want) bad++;
    }
    printf("%-30s %3d/%d 회 어긋남   평균 기록량 %8.0f / %d\n",
           label, bad, ROUNDS, (double)tot / ROUNDS, want);
}

int main() {
    printf("코어 4 / 생산자 스레드 2\n");
    survey(20000, false, "락 없는 push, 2만 회");
    survey(20000, true, "락 건 push, 2만 회");
    return 0;
}
