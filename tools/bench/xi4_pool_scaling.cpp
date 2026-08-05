// 스레드 풀의 배수와 중앙 큐의 경합 — XI-4.
//
// (1) CPU 바운드 작업을 1워커 / 4워커로 나눴을 때의 배수 (코어 4)
// (2) 아주 작은 작업 200만 개를 중앙 큐 하나로 돌릴 때와
//     워커마다 덱을 두고 훔치게 할 때의 시간
//
// 5회 실행해 중앙값과 범위를 낸다.
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4코어)
// 빌드: g++ -std=c++17 -O2 -pthread tools/bench/xi4_pool_scaling.cpp -o /tmp/xi4p && /tmp/xi4p

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>
using namespace std;

const int CHUNKS = 8;
const long long CPU_WORK = 200000000;   // 청크 하나의 반복 횟수
const int TINY = 2000000;               // 아주 작은 작업의 개수
const int REPS = 5;

atomic<long long> sink{0};

long long cpu_task(long long n) {
    long long s = 0;
    for (long long i = 0; i < n; i++) s += i * i;
    return s;
}

double secs(void (*f)(int), int arg) {
    auto t0 = chrono::steady_clock::now();
    f(arg);
    return chrono::duration<double>(chrono::steady_clock::now() - t0).count();
}

// --- (1) 중앙 큐 풀로 CPU 바운드 청크 나누기 ---
void cpu_pool(int workers) {
    atomic<int> next{0};
    vector<thread> ws;
    for (int w = 0; w < workers; w++)
        ws.emplace_back([&next] {
            while (true) {
                int i = next.fetch_add(1);
                if (i >= CHUNKS) return;
                sink.fetch_add(cpu_task(CPU_WORK), memory_order_relaxed);
            }
        });
    for (auto& t : ws) t.join();
}

// --- (2-a) 중앙 큐 하나 ---
void central(int workers) {
    queue<int> q;
    for (int i = 0; i < TINY; i++) q.push(i);
    mutex mtx;
    vector<thread> ws;
    for (int w = 0; w < workers; w++)
        ws.emplace_back([&] {
            long long acc = 0;
            while (true) {
                int job;
                {
                    lock_guard<mutex> g(mtx);       // 모든 워커가 이 하나를 두고 다툰다
                    if (q.empty()) break;
                    job = q.front();
                    q.pop();
                }
                acc += job & 7;
            }
            sink.fetch_add(acc, memory_order_relaxed);
        });
    for (auto& t : ws) t.join();
}

// --- (2-b) 워커마다 덱, 비면 남의 앞에서 훔친다 ---
struct Deq {
    deque<int> d;
    mutex mtx;
};

void stealing(int workers) {
    vector<Deq> ds(workers);
    for (int i = 0; i < TINY; i++) ds[i % workers].d.push_back(i);
    vector<thread> ws;
    for (int w = 0; w < workers; w++)
        ws.emplace_back([&, w] {
            long long acc = 0;
            while (true) {
                int job = -1;
                {
                    lock_guard<mutex> g(ds[w].mtx);   // 자기 덱 — 평소엔 아무도 안 다툰다
                    if (!ds[w].d.empty()) {
                        job = ds[w].d.back();         // 뒤에서 꺼낸다
                        ds[w].d.pop_back();
                    }
                }
                if (job < 0) {                        // 비었으면 남의 것을 훔친다
                    for (int k = 1; k < workers && job < 0; k++) {
                        Deq& v = ds[(w + k) % workers];
                        lock_guard<mutex> g(v.mtx);
                        if (!v.d.empty()) {
                            job = v.d.front();        // 앞에서 훔친다 — 주인과 반대쪽
                            v.d.pop_front();
                        }
                    }
                }
                if (job < 0) break;
                acc += job & 7;
            }
            sink.fetch_add(acc, memory_order_relaxed);
        });
    for (auto& t : ws) t.join();
}

void report(const char* label, vector<double> ts, double base = 0) {
    sort(ts.begin(), ts.end());
    double med = ts[ts.size() / 2];
    if (base > 0)
        printf("%s: 중앙값 %.2f초 (범위 %.2f ~ %.2f) · %.2f배\n",
               label, med, ts.front(), ts.back(), base / med);
    else
        printf("%s: 중앙값 %.2f초 (범위 %.2f ~ %.2f)\n", label, med, ts.front(), ts.back());
}

double median_of(vector<double> ts) {
    sort(ts.begin(), ts.end());
    return ts[ts.size() / 2];
}

int main() {
    printf("코어 4 · 청크 %d개 · 작은 작업 %d개 · %d회 반복\n", CHUNKS, TINY, REPS);

    vector<double> a, b, c, d;
    for (int r = 0; r < REPS; r++) {
        a.push_back(secs(cpu_pool, 1));
        b.push_back(secs(cpu_pool, 4));
        c.push_back(secs(central, 4));
        d.push_back(secs(stealing, 4));
    }
    puts("\n-- CPU 바운드 --");
    double base = median_of(a);
    report("워커 1", a);
    report("워커 4", b, base);

    puts("\n-- 아주 작은 작업 200만 개, 워커 4 --");
    report("중앙 큐 하나", c);
    report("워커별 덱 + 훔치기", d, median_of(c));
    return 0;
}
