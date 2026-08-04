// 상태 스냅샷의 비용 — III-5 §4의 ::: perf 근거 (C++ 쪽).
//
// 측정 대상
//   (a) vector<vector<int>> 통째 복사   — 행마다 힙 할당이 새로 일어난다
//   (b) 평탄한 vector<int> 통째 복사     — memcpy 한 번으로 끝난다
//   (c) 한 칸 바꾸고 되돌리기            — 복사를 안 한다
//
// 빌드/실행: g++ -std=c++17 -O2 tools/bench/sim_snapshot_cost.cpp -o /tmp/snap && /tmp/snap
// 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 / x86-64)

#include <chrono>
#include <cstdio>
#include <vector>
using namespace std;
using namespace std::chrono;

const int N = 50;
const int LOOPS = 2000;

int main() {
    vector<vector<int>> g(N, vector<int>(N));
    vector<int> flat(N * N);
    for (int r = 0; r < N; r++)
        for (int c = 0; c < N; c++) g[r][c] = flat[r * N + c] = (r * N + c) % 7;

    volatile long long sink = 0;

    auto t0 = steady_clock::now();
    for (int i = 0; i < LOOPS; i++) {
        vector<vector<int>> copy2d = g;
        sink += copy2d[7][11];
    }
    auto t1 = steady_clock::now();
    for (int i = 0; i < LOOPS; i++) {
        vector<int> copy1d = flat;
        sink += copy1d[7 * N + 11];
    }
    auto t2 = steady_clock::now();
    for (int i = 0; i < LOOPS; i++) {
        int old = g[7][11];
        g[7][11] = 9;
        sink += g[7][11];
        g[7][11] = old;
    }
    auto t3 = steady_clock::now();

    double a = duration<double>(t1 - t0).count();
    double b = duration<double>(t2 - t1).count();
    double c = duration<double>(t3 - t2).count();
    printf("격자 %dx%d, 각 %d회\n", N, N, LOOPS);
    printf("  vector<vector<int>> 복사 : %.6f초\n", a);
    printf("  평탄한 vector<int> 복사   : %.6f초  (%.0f배 빠름)\n", b, a / b);
    printf("  한 칸 바꾸고 되돌림       : %.6f초  (%.0f배 빠름)\n", c, a / c);
    (void)sink;
    return 0;
}
