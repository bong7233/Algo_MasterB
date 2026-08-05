// 워크 스틸링에서 일이 실제로 어떻게 나뉘는가 (C++) — XI-4.
//
// tools/bench/xi4_work_stealing.py 와 같은 실험. 작업 2만 건을 워커 0의 덱에만
// 몰아 두고 워커 4개(코어 4)를 동시에 출발시킨다.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4코어)
// 빌드: g++ -std=c++17 -O2 -pthread tools/bench/xi4_work_stealing.cpp -o /tmp/xi4w && /tmp/xi4w

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
using namespace std;

const int N_WORKERS = 4, N_TASKS = 20000;
const int RUNS = 10;

struct Deck {
    deque<int> d;
    mutex mtx;
};

vector<int> one_run() {
    vector<Deck> decks(N_WORKERS);
    for (int i = 0; i < N_TASKS; i++) decks[0].d.push_back(i);
    atomic<bool> go{false};
    vector<int> processed(N_WORKERS, 0);

    vector<thread> ws;
    for (int w = 0; w < N_WORKERS; w++)
        ws.emplace_back([&, w] {
            while (!go.load()) this_thread::yield();
            while (true) {
                int job = -1;
                {
                    lock_guard<mutex> g(decks[w].mtx);
                    if (!decks[w].d.empty()) {
                        job = decks[w].d.back();
                        decks[w].d.pop_back();
                    }
                }
                if (job < 0) {
                    for (int k = 1; k < N_WORKERS && job < 0; k++) {
                        Deck& v = decks[(w + k) % N_WORKERS];
                        lock_guard<mutex> g(v.mtx);
                        if (!v.d.empty()) {
                            job = v.d.front();
                            v.d.pop_front();
                        }
                    }
                }
                if (job < 0) return;
                processed[w]++;
            }
        });
    go.store(true);
    for (auto& t : ws) t.join();
    return processed;
}

int main() {
    printf("워커 %d · 코어 4 · 작업 %d건 · %d회 실행\n", N_WORKERS, N_TASKS, RUNS);
    vector<double> shares;
    for (int r = 0; r < RUNS; r++) {
        vector<int> p = one_run();
        int sum = 0, mx = 0;
        for (int v : p) { sum += v; mx = max(mx, v); }
        double share = 100.0 * mx / N_TASKS;
        shares.push_back(share);
        printf("  %2d회차 워커별 [%d, %d, %d, %d] · 합 %d · 최다 워커 몫 %.0f%%\n",
               r + 1, p[0], p[1], p[2], p[3], sum, share);
    }
    sort(shares.begin(), shares.end());
    printf("최다 워커 몫 중앙값 %.0f%% (범위 %.0f ~ %.0f%%) · 이상적 분배는 25%%\n",
           shares[shares.size() / 2], shares.front(), shares.back());
    return 0;
}
