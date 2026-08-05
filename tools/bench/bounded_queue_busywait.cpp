// 바쁜 대기와 조건변수의 CPU 비용 (C++).
//
// Python 판(bounded_queue_busywait.py)과 같은 실험이다. 다른 것은 GIL 이 없다는 점
// 하나이고, 그 하나가 결과의 성격을 바꾼다 — C++ 의 회전 소비자는 남의 코어를
// 뺏지 않으므로 벽시계는 그대로이고 CPU 만 탄다. Python 은 벽시계까지 나빠진다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4 코어).
// 빌드·실행: g++ -std=c++17 -O2 -pthread tools/bench/bounded_queue_busywait.cpp -o /tmp/bw && /tmp/bw

#include <sys/resource.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;
using namespace std::chrono;

static const int ITEMS = 200;
static const int GAP_MS = 2;
static const int REPEAT = 5;

double cpu_seconds() {
    rusage ru{};
    getrusage(RUSAGE_SELF, &ru);
    return ru.ru_utime.tv_sec + ru.ru_utime.tv_usec / 1e6 +
           ru.ru_stime.tv_sec + ru.ru_stime.tv_usec / 1e6;
}

struct Result { double wall, cpu; };

Result run_busy() {
    deque<int> box;
    mutex mu;
    atomic<bool> done{false};
    int got = 0;

    auto t0 = steady_clock::now();
    double c0 = cpu_seconds();
    thread p([&] {
        for (int i = 0; i < ITEMS; i++) {
            this_thread::sleep_for(milliseconds(GAP_MS));
            lock_guard<mutex> g(mu);
            box.push_back(i);
        }
        done = true;
    });
    thread c([&] {
        for (;;) {
            {
                lock_guard<mutex> g(mu);
                if (!box.empty()) { box.pop_front(); got++; continue; }
            }
            if (done && box.empty()) return;
            // 아무 일도 안 하지만 루프는 전속력으로 돈다
        }
    });
    p.join(); c.join();
    return {duration<double>(steady_clock::now() - t0).count(), cpu_seconds() - c0};
}

Result run_cv() {
    deque<int> box;
    mutex mu;
    condition_variable cv;
    bool done = false;
    int got = 0;

    auto t0 = steady_clock::now();
    double c0 = cpu_seconds();
    thread p([&] {
        for (int i = 0; i < ITEMS; i++) {
            this_thread::sleep_for(milliseconds(GAP_MS));
            { lock_guard<mutex> g(mu); box.push_back(i); }
            cv.notify_one();
        }
        { lock_guard<mutex> g(mu); done = true; }
        cv.notify_all();
    });
    thread c([&] {
        for (;;) {
            unique_lock<mutex> lk(mu);
            cv.wait(lk, [&] { return !box.empty() || done; });   // 락을 놓고 잠든다
            if (!box.empty()) { box.pop_front(); got++; continue; }
            return;
        }
    });
    p.join(); c.join();
    return {duration<double>(steady_clock::now() - t0).count(), cpu_seconds() - c0};
}

void survey(Result (*fn)(), const char* name) {
    vector<double> w, c;
    for (int i = 0; i < REPEAT; i++) { Result r = fn(); w.push_back(r.wall); c.push_back(r.cpu); }
    sort(w.begin(), w.end()); sort(c.begin(), c.end());
    printf("%-12s 벽시계 중앙값 %.3f초 (%.3f~%.3f)   CPU 중앙값 %.3f초 (%.3f~%.3f)   점유율 %.0f%%\n",
           name, w[REPEAT / 2], w.front(), w.back(),
           c[REPEAT / 2], c.front(), c.back(), c[REPEAT / 2] / w[REPEAT / 2] * 100);
}

int main() {
    printf("항목 %d개, 생산 간격 %dms, %d회 실행, 코어 4\n", ITEMS, GAP_MS, REPEAT);
    survey(run_busy, "바쁜 대기");
    survey(run_cv, "조건변수");
    return 0;
}
