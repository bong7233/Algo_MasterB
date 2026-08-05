// 조건변수 대기를 `if` 로 감쌌을 때 실제로 무엇이 깨지는가 (C++).
//
// bounded_queue_if_vs_while.py 와 같은 실험이다. 소비자가 셋(코어 4)이고
// 생산자가 `notify_all` 로 전원을 깨우면, 깨어난 소비자가 락을 다시 잡는 사이에
// 다른 소비자가 먼저 가져간다. `if` 로 감싼 쪽은 그 사실을 확인하지 않고
// 빈 큐를 만난다 — **통지 도둑질**이다.
//
// 본문의 ::: dual 은 "있음/없음" 만 찍는다(실행마다 흔들리는 값을 지면에 박지 않기
// 위해서다). 이 스크립트는 그 뒤에 있는 재현율을 센다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4 코어).
// 빌드·실행: g++ -std=c++17 -O2 -pthread tools/bench/bounded_queue_if_vs_while.cpp -o /tmp/iw && /tmp/iw

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

static const int ROUNDS = 200, ITEMS = 200, NCONS = 3;   // 소비자 3 / 코어 4

struct Round { int bad, got; };

Round one_round(bool recheck, int gap_us) {
    deque<int> box;
    bool done = false;
    int bad = 0, got = 0;
    mutex mu;
    condition_variable cv;

    auto producer = [&] {
        for (int i = 0; i < ITEMS; i++) {
            if (gap_us) this_thread::sleep_for(chrono::microseconds(gap_us));
            { lock_guard<mutex> g(mu); box.push_back(i); }
            cv.notify_all();
        }
        { lock_guard<mutex> g(mu); done = true; }
        cv.notify_all();
    };

    auto consumer = [&] {
        for (;;) {
            unique_lock<mutex> lk(mu);
            if (recheck) {
                while (box.empty() && !done) cv.wait(lk);
            } else {
                if (box.empty() && !done) cv.wait(lk);
            }
            if (box.empty()) {
                if (done) return;
                bad += 1;            // 빈 큐를 만났다 — 통지를 도둑맞았다
                continue;
            }
            box.pop_back();
            got += 1;
        }
    };

    vector<thread> ts;
    for (int k = 0; k < NCONS; k++) ts.emplace_back(consumer);
    thread p(producer);
    p.join();
    for (auto& t : ts) t.join();
    return {bad, got};
}

void survey(bool recheck, int gap_us, const char* label) {
    int rounds_bad = 0;
    long long total_bad = 0;
    for (int r = 0; r < ROUNDS; r++) {
        Round x = one_round(recheck, gap_us);
        if (x.got != ITEMS) { printf("항목 수가 어긋났다: %d\n", x.got); return; }
        total_bad += x.bad;
        rounds_bad += (x.bad != 0);
    }
    printf("%-36s %3d/%d 회 실패   빈 큐 조우 총 %lld회\n",
           label, rounds_bad, ROUNDS, total_bad);
}

int main() {
    printf("소비자 %d / 코어 4 / 항목 %d개 / %d회 반복\n", NCONS, ITEMS, ROUNDS);
    survey(false, 200, "if   판, 생산 간격 0.2ms");
    survey(true, 200, "while 판, 생산 간격 0.2ms");
    survey(false, 0, "if   판, 생산 간격 0 (큐가 안 빈다)");
    return 0;
}
