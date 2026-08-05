// 락 한 번의 값 (C++).
//
// bounded_queue_lock_cost.py 와 같은 실험. 경합이 없을 때 `std::mutex` 는
// 커널에 들어가지 않고 사용자 공간의 원자 연산으로 끝난다. 그 값이 얼마인지,
// 그리고 조건변수 통지를 매번 거는 것이 얼마나 더 드는지를 함께 잰다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4 코어).
// 빌드·실행: g++ -std=c++17 -O2 -pthread tools/bench/bounded_queue_lock_cost.cpp -o /tmp/lc && /tmp/lc

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <vector>
using namespace std;
using namespace std::chrono;

static const int N = 10'000'000;
static const int REPEAT = 7;

volatile int sink = 0;

template <class F>
double med_of(F f) {
    vector<double> v;
    for (int r = 0; r < REPEAT; r++) {
        auto t0 = steady_clock::now();
        f();
        v.push_back(duration<double>(steady_clock::now() - t0).count());
    }
    sort(v.begin(), v.end());
    printf("  범위 %.3f~%.3f초\n", v.front(), v.back());
    return v[REPEAT / 2];
}

int main() {
    printf("%d회 왕복, %d회 실행, 경합 없음(단일 스레드), 코어 4\n", N, REPEAT);

    deque<int> d;
    mutex mu;
    condition_variable cv;

    double a = med_of([&] {
        for (int i = 0; i < N; i++) { d.push_back(1); d.pop_back(); }
        sink = (int)d.size();
    });
    printf("락 없는 push/pop     중앙값 %.3f초  왕복당 %.1f ns\n", a, a / N * 1e9);

    double b = med_of([&] {
        for (int i = 0; i < N; i++) {
            lock_guard<mutex> g(mu);
            d.push_back(1); d.pop_back();
        }
        sink = (int)d.size();
    });
    printf("mutex 로 감싼 것      중앙값 %.3f초  왕복당 %.1f ns\n", b, b / N * 1e9);

    double c = med_of([&] {
        for (int i = 0; i < N; i++) {
            { lock_guard<mutex> g(mu); d.push_back(1); }
            cv.notify_one();
            { lock_guard<mutex> g(mu); d.pop_back(); }
            cv.notify_one();
        }
        sink = (int)d.size();
    });
    printf("mutex + 매번 통지     중앙값 %.3f초  왕복당 %.1f ns\n", c, c / N * 1e9);
    return 0;
}
