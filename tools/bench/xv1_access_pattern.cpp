// XV-1 — 순차 접근 대 무작위 접근. CLAUDE.md §1-3 환경에서 실행한다.
// g++ -std=c++17 -O2 tools/bench/xv1_access_pattern.cpp -o /tmp/xv1_access && /tmp/xv1_access
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <numeric>
#include <random>
#include <vector>
using namespace std;
using namespace std::chrono;

const long long N = 20000000; // int64 배열, 약 160MB
const int REPEAT = 2;

int main() {
    vector<long long> a(N);
    iota(a.begin(), a.end(), 0);
    vector<long long> idx(N);
    iota(idx.begin(), idx.end(), 0);
    mt19937 rng(0);
    shuffle(idx.begin(), idx.end(), rng);

    for (int r = 0; r < REPEAT; r++) {
        auto t0 = high_resolution_clock::now();
        long long s = 0;
        for (long long i = 0; i < N; i++) s += a[i];
        auto t1 = high_resolution_clock::now();
        double sec = duration<double>(t1 - t0).count();
        printf("순차 접근: %.3f 초 (합 %lld)\n", sec, s);
    }

    for (int r = 0; r < REPEAT; r++) {
        auto t0 = high_resolution_clock::now();
        long long s = 0;
        for (long long k = 0; k < N; k++) s += a[idx[k]];
        auto t1 = high_resolution_clock::now();
        double sec = duration<double>(t1 - t0).count();
        printf("무작위 접근: %.3f 초 (합 %lld)\n", sec, s);
    }
    return 0;
}
