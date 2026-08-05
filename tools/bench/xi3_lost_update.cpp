// 잃어버린 갱신 재현율 측정 (C++) — XI-3.
//
// 같은 카운터를 세 가지로 올린다. 평범한 int(데이터 경쟁 — 표준상 정의되지 않은 동작),
// std::atomic, 뮤텍스. 100회 반복해 최종값의 중앙값·범위와 유실 발생 횟수를 센다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4코어)
// 빌드: g++ -std=c++17 -O2 tools/bench/xi3_lost_update.cpp -o /tmp/xi3 && /tmp/xi3

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int N_THREADS = 4;          // 코어 수와 같게 둔다
const int N_EACH = 1000000;
const long long EXPECT = (long long)N_THREADS * N_EACH;
const int ROUNDS = 100;

volatile long long raw_counter = 0;   // volatile — 컴파일러가 루프를 접지 못하게 한다
atomic<long long> atomic_counter{0};
long long mutex_counter = 0;
mutex mtx;
atomic<bool> go{false};               // 네 스레드를 같은 순간에 출발시킨다

void wait_go() { while (!go.load(memory_order_acquire)) this_thread::yield(); }

void bump_raw() {
    wait_go();
    for (int i = 0; i < N_EACH; i++) raw_counter = raw_counter + 1;   // 데이터 경쟁
}
void bump_atomic() {
    wait_go();
    for (int i = 0; i < N_EACH; i++) atomic_counter.fetch_add(1, memory_order_relaxed);
}
void bump_mutex() {
    wait_go();
    for (int i = 0; i < N_EACH; i++) {
        lock_guard<mutex> g(mtx);
        mutex_counter += 1;
    }
}

long long one_run(void (*job)(), volatile long long& slot) {
    slot = 0;
    go.store(false);
    vector<thread> ts;
    for (int k = 0; k < N_THREADS; k++) ts.emplace_back(job);
    go.store(true, memory_order_release);
    for (auto& t : ts) t.join();
    return slot;
}

long long one_run_mutex() {
    mutex_counter = 0;
    go.store(false);
    vector<thread> ts;
    for (int k = 0; k < N_THREADS; k++) ts.emplace_back(bump_mutex);
    go.store(true, memory_order_release);
    for (auto& t : ts) t.join();
    return mutex_counter;
}

long long one_run_atomic() {
    atomic_counter.store(0);
    go.store(false);
    vector<thread> ts;
    for (int k = 0; k < N_THREADS; k++) ts.emplace_back(bump_atomic);
    go.store(true, memory_order_release);
    for (auto& t : ts) t.join();
    return atomic_counter.load();
}

void report(const char* label, vector<long long> vals) {
    int bad = 0;
    for (long long v : vals) if (v != EXPECT) bad++;
    sort(vals.begin(), vals.end());
    long long med = vals[vals.size() / 2];
    printf("[%s] %d회 중 유실 %d회\n", label, (int)vals.size(), bad);
    printf("    최종값 중앙값 %lld / 기대 %lld (범위 %lld ~ %lld)\n",
           med, EXPECT, vals.front(), vals.back());
    printf("    유실률 중앙값 %.0f%% (범위 %.0f ~ %.0f%%)\n",
           100.0 * (EXPECT - med) / EXPECT,
           100.0 * (EXPECT - vals.back()) / EXPECT,
           100.0 * (EXPECT - vals.front()) / EXPECT);
}

double bench(void (*runner)()) {
    auto t0 = chrono::steady_clock::now();
    runner();
    return chrono::duration<double>(chrono::steady_clock::now() - t0).count();
}

int main() {
    printf("스레드 %d · 코어 4 · 각 %d회 · %d회 반복\n", N_THREADS, N_EACH, ROUNDS);

    vector<long long> a, b, c;
    for (int r = 0; r < ROUNDS; r++) a.push_back(one_run(bump_raw, raw_counter));
    for (int r = 0; r < ROUNDS; r++) b.push_back(one_run_atomic());
    for (int r = 0; r < ROUNDS; r++) c.push_back(one_run_mutex());

    report("평범한 long long", a);
    report("atomic", b);
    report("mutex", c);
    return 0;
}
