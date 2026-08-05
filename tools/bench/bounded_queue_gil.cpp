// 소비자를 늘리면 빨라지는가 — GIL 이 없는 쪽 (C++).
//
// bounded_queue_gil.py 와 같은 실험이다. 같은 작업량(SPIN 60,000 회 산술)을
// 같은 건수(48)만큼 유계 큐에 넣고 소비자 스레드를 1 → 2 → 4 로 늘린다.
// Python 은 CPU 바운드에서 가속이 없고, 여기서는 코어 수까지 붙는다.
// 두 결과의 차이가 곧 "언어 차이" 표의 첫 줄이다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4 코어).
// 빌드·실행: g++ -std=c++17 -O2 -pthread tools/bench/bounded_queue_gil.cpp -o /tmp/bg && /tmp/bg

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;
using namespace std::chrono;

static const int TASKS = 48;
static const int SPIN = 4000000;
static const int REPEAT = 5;

volatile long long sink = 0;

// 의존 사슬을 만들어 벡터화·상수 접기를 막는다. 그러지 않으면 -O2 가
// 루프를 통째로 없애서 잴 것이 남지 않는다.
long long cpu_work() {
    long long s = 1;
    for (int i = 0; i < SPIN; i++) s = s * 6364136223846793005LL + 1442695040888963407LL;
    return s;
}

double run(int nthreads) {
    deque<int> q;
    mutex mu;
    condition_variable cv;
    for (int i = 0; i < TASKS; i++) q.push_back(i);
    for (int i = 0; i < nthreads; i++) q.push_back(-1);   // 독약 — 소비자 수만큼

    auto t0 = steady_clock::now();
    vector<thread> ts;
    for (int i = 0; i < nthreads; i++) {
        ts.emplace_back([&] {
            for (;;) {
                int item;
                {
                    unique_lock<mutex> lk(mu);
                    cv.wait(lk, [&] { return !q.empty(); });
                    item = q.front();
                    q.pop_front();
                }
                if (item < 0) return;
                sink = cpu_work();
            }
        });
    }
    cv.notify_all();
    for (auto& t : ts) t.join();
    return duration<double>(steady_clock::now() - t0).count();
}

int main() {
    printf("코어 4 / 작업 %d건, %d회 실행\n", TASKS, REPEAT);
    double base = 0;
    for (int n : {1, 2, 4}) {
        vector<double> v;
        for (int r = 0; r < REPEAT; r++) v.push_back(run(n));
        sort(v.begin(), v.end());
        double med = v[REPEAT / 2];
        if (!base) base = med;
        printf("CPU 바운드(스레드) 스레드 %d: 중앙값 %6.3f초 (%.3f~%.3f)  가속 %.2f배\n",
               n, med, v.front(), v.back(), base / med);
    }
    return 0;
}
