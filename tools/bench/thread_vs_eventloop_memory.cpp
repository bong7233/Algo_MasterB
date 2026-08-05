// XI-7 — 같은 측정의 C++ 판. Python 판(thread_vs_eventloop_memory.py)과 짝이다.
//
// 재는 것: std::thread N개의 VmSize/VmRSS 증가, 생성 시간,
//          두 스레드 사이 조건변수 왕복(컨텍스트 스위치 2회)의 비용,
//          같은 스레드 안 함수 호출의 비용.
//
// 빌드: g++ -std=c++17 -O2 -pthread tools/bench/thread_vs_eventloop_memory.cpp -o /tmp/twm
// 실행: /tmp/twm [N] [반복]
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
using namespace std;
using clk = chrono::steady_clock;

static long status_kb(const string& key) {
    ifstream f("/proc/self/status");
    string line;
    while (getline(f, line))
        if (line.rfind(key, 0) == 0) return atol(line.c_str() + key.size());
    return -1;
}

static string med_range(vector<double> xs, int p) {
    sort(xs.begin(), xs.end());
    char buf[160];
    snprintf(buf, sizeof buf, "%.*f (%.*f~%.*f)", p, xs[xs.size() / 2], p, xs.front(), p, xs.back());
    return buf;
}

int main(int argc, char** argv) {
    int n = argc > 1 ? atoi(argv[1]) : 1000;
    int reps = argc > 2 ? atoi(argv[2]) : 5;
    printf("std::thread %d개 · %d회 반복 · 중앙값(최소~최대)\n\n", n, reps);

    vector<double> vsz, rss, spawn;
    for (int r = 0; r < reps; r++) {
        atomic<bool> stop{false};
        long b_vsz = status_kb("VmSize:"), b_rss = status_kb("VmRSS:");
        auto t0 = clk::now();
        vector<thread> ts;
        ts.reserve(n);
        for (int i = 0; i < n; i++)
            ts.emplace_back([&stop] {
                while (!stop.load(memory_order_relaxed)) this_thread::sleep_for(chrono::milliseconds(1));
            });
        spawn.push_back(chrono::duration<double, milli>(clk::now() - t0).count());
        vsz.push_back((status_kb("VmSize:") - b_vsz) / 1024.0);
        rss.push_back((status_kb("VmRSS:") - b_rss) / 1024.0);
        stop.store(true);
        for (auto& t : ts) t.join();
    }
    printf("[thread-per-connection]\n");
    printf("  VmSize 증가 : %s MiB\n", med_range(vsz, 1).c_str());
    printf("  VmRSS  증가 : %s MiB\n", med_range(rss, 1).c_str());
    printf("  생성 시간   : %s ms\n", med_range(spawn, 1).c_str());

    vector<double> sw, call;
    for (int r = 0; r < reps; r++) {
        const int rounds = 20000;
        mutex m;
        condition_variable cv;
        int turn = 0;
        thread pong([&] {
            for (int i = 0; i < rounds; i++) {
                unique_lock<mutex> lk(m);
                cv.wait(lk, [&] { return turn == 1; });
                turn = 0;
                cv.notify_one();
            }
        });
        auto t0 = clk::now();
        for (int i = 0; i < rounds; i++) {
            unique_lock<mutex> lk(m);
            turn = 1;
            cv.notify_one();
            cv.wait(lk, [&] { return turn == 0; });
        }
        double dt = chrono::duration<double, micro>(clk::now() - t0).count();
        pong.join();
        sw.push_back(dt / (rounds * 2));

        volatile long state = 0;
        const int calls = 2000000;
        t0 = clk::now();
        for (int i = 0; i < calls; i++) state = state + 1;
        call.push_back(chrono::duration<double, micro>(clk::now() - t0).count() / calls);
    }
    printf("\n[디스패치 한 번의 비용]\n");
    printf("  스레드 컨텍스트 스위치: %s us\n", med_range(sw, 2).c_str());
    printf("  같은 스레드 안 호출    : %s us\n", med_range(call, 4).c_str());
}
