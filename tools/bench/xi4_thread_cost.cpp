// 스레드 생성 비용 대 풀에 작업 하나 맡기는 비용 (C++) — XI-4.
//
// 7회 실행해 중앙값과 범위를 낸다.
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4코어)
// 빌드: g++ -std=c++17 -O2 -pthread tools/bench/xi4_thread_cost.cpp -o /tmp/xi4t && /tmp/xi4t

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>
using namespace std;

const int N = 20000;
const int REPS = 7;
const int WORKERS = 4;   // 코어 수와 같게 둔다

atomic<long long> sink{0};

double per_thread() {
    auto t0 = chrono::steady_clock::now();
    for (int i = 0; i < N; i++) {
        thread t([] { sink.fetch_add(1, memory_order_relaxed); });
        t.join();
    }
    return chrono::duration<double>(chrono::steady_clock::now() - t0).count();
}

struct Pool {
    vector<thread> ws;
    queue<function<void()>> q;
    mutex mtx;
    condition_variable cv;
    bool stop = false;

    explicit Pool(int n) {
        for (int i = 0; i < n; i++) ws.emplace_back([this] { loop(); });
    }
    void loop() {
        while (true) {
            function<void()> job;
            {
                unique_lock<mutex> lk(mtx);
                cv.wait(lk, [this] { return stop || !q.empty(); });
                if (q.empty()) return;
                job = std::move(q.front());
                q.pop();
            }
            job();
        }
    }
    void submit(function<void()> f) {
        {
            lock_guard<mutex> g(mtx);
            q.push(std::move(f));
        }
        cv.notify_one();
    }
    ~Pool() {
        {
            lock_guard<mutex> g(mtx);
            stop = true;
        }
        cv.notify_all();
        for (auto& w : ws) w.join();
    }
};

double per_task(Pool& p) {
    atomic<int> done{0};
    auto t0 = chrono::steady_clock::now();
    for (int i = 0; i < N; i++)
        p.submit([&done] { done.fetch_add(1, memory_order_relaxed); });
    while (done.load(memory_order_relaxed) < N) this_thread::yield();
    return chrono::duration<double>(chrono::steady_clock::now() - t0).count();
}

void report(const char* label, vector<double> ts) {
    sort(ts.begin(), ts.end());
    printf("%s: 중앙값 %.1f µs/개 (범위 %.1f ~ %.1f)\n", label,
           ts[ts.size() / 2] / N * 1e6, ts.front() / N * 1e6, ts.back() / N * 1e6);
}

int main() {
    printf("코어 4 · %d개 · %d회 반복\n", N, REPS);
    vector<double> a, b;
    for (int r = 0; r < REPS; r++) a.push_back(per_thread());
    {
        Pool p(WORKERS);
        for (int r = 0; r < REPS; r++) b.push_back(per_task(p));
    }
    report("스레드 생성+종료", a);
    report("풀에 작업 제출  ", b);
    return 0;
}
