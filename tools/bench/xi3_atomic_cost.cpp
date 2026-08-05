// 원자적 연산과 메모리 순서의 비용 — XI-3.
//
// 무엇을 재는가
//   (1) 단일 스레드 저장 루프: 평범한 변수 / relaxed / release / seq_cst
//       x86-64 에서 차이가 나는 자리는 seq_cst **저장**이다(펜스가 붙는다).
//   (2) 4스레드 경합: mutex / fetch_add(seq_cst) / fetch_add(relaxed)
//
// 7회 실행해 중앙값과 범위를 낸다.
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4코어)
// 빌드: g++ -std=c++17 -O2 tools/bench/xi3_atomic_cost.cpp -o /tmp/xi3a && /tmp/xi3a

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const long long N = 20000000;      // 단일 스레드 저장 횟수
const int N_THREADS = 4;           // 코어 수와 같게 둔다
const long long N_EACH = 2000000;  // 경합 실험에서 스레드당 증가 횟수
const int REPS = 7;

volatile long long plain_slot = 0;
atomic<long long> slot{0};
atomic<long long> ctr{0};
long long mctr = 0;
mutex mtx;

double secs(const function<void()>& f) {
    auto t0 = chrono::steady_clock::now();
    f();
    return chrono::duration<double>(chrono::steady_clock::now() - t0).count();
}

void report(const char* label, vector<double> ts, long long ops) {
    sort(ts.begin(), ts.end());
    double med = ts[ts.size() / 2];
    printf("%-28s 중앙값 %6.1f ns/op (범위 %5.1f ~ %5.1f)\n",
           label, med / ops * 1e9, ts.front() / ops * 1e9, ts.back() / ops * 1e9);
}

void run_threads(const function<void()>& job) {
    vector<thread> ts;
    for (int k = 0; k < N_THREADS; k++) ts.emplace_back(job);
    for (auto& t : ts) t.join();
}

int main() {
    printf("단일 스레드 저장 %lld회 · 경합 실험 %d스레드(코어 4) × %lld회 · %d회 반복\n\n",
           N, N_THREADS, N_EACH, REPS);

    vector<double> a, b, c, d, e, f, g, h;
    for (int r = 0; r < REPS; r++) {
        h.push_back(secs([] {
            mctr = 0;
            for (long long i = 0; i < N_EACH; i++) { lock_guard<mutex> lg(mtx); mctr++; }
        }));
        a.push_back(secs([] { for (long long i = 0; i < N; i++) plain_slot = i; }));
        b.push_back(secs([] { for (long long i = 0; i < N; i++) slot.store(i, memory_order_relaxed); }));
        c.push_back(secs([] { for (long long i = 0; i < N; i++) slot.store(i, memory_order_release); }));
        d.push_back(secs([] { for (long long i = 0; i < N; i++) slot.store(i, memory_order_seq_cst); }));

        e.push_back(secs([] {
            mctr = 0;
            run_threads([] {
                for (long long i = 0; i < N_EACH; i++) { lock_guard<mutex> lg(mtx); mctr++; }
            });
        }));
        f.push_back(secs([] {
            ctr.store(0);
            run_threads([] {
                for (long long i = 0; i < N_EACH; i++) ctr.fetch_add(1, memory_order_seq_cst);
            });
        }));
        g.push_back(secs([] {
            ctr.store(0);
            run_threads([] {
                for (long long i = 0; i < N_EACH; i++) ctr.fetch_add(1, memory_order_relaxed);
            });
        }));
    }

    puts("-- 단일 스레드 저장 (경합 없음) --");
    report("평범한 변수", a, N);
    report("atomic relaxed", b, N);
    report("atomic release", c, N);
    report("atomic seq_cst", d, N);

    puts("\n-- 증가 연산 --");
    report("mutex 1스레드(경합 없음)", h, N_EACH);
    long long ops = (long long)N_THREADS * N_EACH;
    report("mutex", e, ops);
    report("fetch_add seq_cst", f, ops);
    report("fetch_add relaxed", g, ops);
    return 0;
}
