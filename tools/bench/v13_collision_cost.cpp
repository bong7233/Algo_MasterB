// V-13 본문 수치 — 충돌 검사 하나에 드는 시간.
// 구성 공간을 격자로 열거하려면 칸마다 이 검사를 한 번씩 해야 한다.
// 여기서 나온 ns/검사 를 칸 수에 곱한 것이 본문의 "격자를 채우는 시간" 이다.
//
// 빌드·실행: g++ -std=c++17 -O2 tools/bench/v13_collision_cost.cpp -o /tmp/v13cc && /tmp/v13cc
#include <chrono>
#include <cmath>
#include <cstdio>
#include <vector>
using namespace std;

int main() {
    const int N = 50000000;
    double obs[4][3] = {{30, 30, 14}, {60, 55, 16}, {35, 75, 12}, {78, 25, 11}};
    volatile int sink = 0;
    auto t0 = chrono::steady_clock::now();
    for (int i = 0; i < N; i++) {
        double x = (i % 1000) * 0.1, y = (i % 997) * 0.1;
        bool ok = true;
        for (auto& o : obs)
            if (hypot(x - o[0], y - o[1]) <= o[2]) { ok = false; break; }
        sink += ok;
    }
    auto t1 = chrono::steady_clock::now();
    double sec = chrono::duration<double>(t1 - t0).count();
    printf("검사 %d회 %.3f초 → %.2f ns/검사 (sink=%d)\n", N, sec, sec / N * 1e9, (int)sink);
    return 0;
}
