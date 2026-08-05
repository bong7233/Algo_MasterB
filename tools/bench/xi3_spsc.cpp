// SPSC 락프리 큐 대 뮤텍스 큐 처리량 — XI-3.
//
// 생산자 1 · 소비자 1 (코어 4). 같은 개수를 밀어 넣고 빼는 데 걸리는 시간을 잰다.
// 7회 실행해 중앙값과 범위를 낸다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4코어)
// 빌드: g++ -std=c++17 -O2 tools/bench/xi3_spsc.cpp -o /tmp/xi3s && /tmp/xi3s

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>
using namespace std;

const long long N = 5000000;
const size_t CAP = 1024;
const int REPS = 7;

struct Spsc {
    int buf[CAP];
    atomic<size_t> head{0};   // 생산자만 쓴다
    atomic<size_t> tail{0};   // 소비자만 쓴다

    bool push(int v) {
        size_t h = head.load(memory_order_relaxed);
        size_t nxt = (h + 1) % CAP;
        if (nxt == tail.load(memory_order_acquire)) return false;   // 가득
        buf[h] = v;
        head.store(nxt, memory_order_release);   // 값 기록이 먼저 보이도록
        return true;
    }
    bool pop(int& out) {
        size_t t = tail.load(memory_order_relaxed);
        if (t == head.load(memory_order_acquire)) return false;     // 비었음
        out = buf[t];
        tail.store((t + 1) % CAP, memory_order_release);
        return true;
    }
};

struct MutexQ {
    queue<int> q;
    mutex mtx;
    condition_variable cv_full, cv_empty;

    void push(int v) {
        unique_lock<mutex> lk(mtx);
        cv_full.wait(lk, [&] { return q.size() < CAP; });
        q.push(v);
        lk.unlock();
        cv_empty.notify_one();
    }
    int pop() {
        unique_lock<mutex> lk(mtx);
        cv_empty.wait(lk, [&] { return !q.empty(); });
        int v = q.front();
        q.pop();
        lk.unlock();
        cv_full.notify_one();
        return v;
    }
};

double secs_spsc() {
    Spsc q;
    long long sum = 0;
    auto t0 = chrono::steady_clock::now();
    thread prod([&] {
        for (long long i = 0; i < N; i++)
            while (!q.push(1)) this_thread::yield();
    });
    thread cons([&] {
        int v;
        for (long long i = 0; i < N; i++) {
            while (!q.pop(v)) this_thread::yield();
            sum += v;
        }
    });
    prod.join();
    cons.join();
    double d = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
    if (sum != N) printf("!! spsc 합 불일치 %lld\n", sum);
    return d;
}

double secs_mutex() {
    MutexQ q;
    long long sum = 0;
    auto t0 = chrono::steady_clock::now();
    thread prod([&] { for (long long i = 0; i < N; i++) q.push(1); });
    thread cons([&] { for (long long i = 0; i < N; i++) sum += q.pop(); });
    prod.join();
    cons.join();
    double d = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
    if (sum != N) printf("!! mutex 합 불일치 %lld\n", sum);
    return d;
}

void report(const char* label, vector<double> ts) {
    sort(ts.begin(), ts.end());
    double med = ts[ts.size() / 2];
    printf("%s: 중앙값 %.2f초 (범위 %.2f ~ %.2f) · %.0f ns/개 · %.1fM개/초\n",
           label, med, ts.front(), ts.back(), med / N * 1e9, N / med / 1e6);
}

int main() {
    printf("생산자 1 · 소비자 1 · 코어 4 · %lld개 · 용량 %zu · %d회 반복\n", N, CAP, REPS);
    vector<double> a, b;
    for (int r = 0; r < REPS; r++) {
        a.push_back(secs_spsc());
        b.push_back(secs_mutex());
    }
    report("SPSC 락프리", a);
    report("뮤텍스+조건변수", b);
    return 0;
}
