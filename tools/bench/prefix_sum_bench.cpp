// VI-4 본문 수치 (C++ 쪽) — 구간 합 질의: 매번 더하기 vs 누적 합.
// 빌드: g++ -std=c++17 -O2 tools/bench/prefix_sum_bench.cpp -o /tmp/psb && /tmp/psb
// 측정 환경은 CLAUDE.md §1-3 고정. 프로그램 안에서 3회 재어 중앙값을 내고,
// 본문 수치는 이 프로그램을 5회 실행한 중앙값이다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;
using namespace std::chrono;

const int N = 100000;
const int Q = 100000;

int main() {
    mt19937 rng(1);
    vector<int> a(N);
    for (int i = 0; i < N; i++) a[i] = rng() % 1001;

    vector<pair<int, int>> qs(Q);
    for (int i = 0; i < Q; i++) {
        int l = rng() % N;
        int r = l + (int)(rng() % (N - l));
        qs[i] = {l, r};
    }

    // 순진한 쪽: 질의마다 구간을 전부 훑는다
    auto naive = [&](int cnt) {
        long long total = 0;
        for (int i = 0; i < cnt; i++) {
            long long s = 0;
            for (int j = qs[i].first; j <= qs[i].second; j++) s += a[j];
            total += s;
        }
        return total;
    };

    // 누적 합: 전처리 O(N) + 질의당 O(1)
    auto fast = [&](int cnt) {
        vector<long long> S(N + 1, 0);
        for (int i = 0; i < N; i++) S[i + 1] = S[i] + a[i];
        long long total = 0;
        for (int i = 0; i < cnt; i++) total += S[qs[i].second + 1] - S[qs[i].first];
        return total;
    };

    auto med = [&](auto f, int cnt) {
        double ts[3];
        long long v = 0;
        for (int k = 0; k < 3; k++) {
            auto t0 = steady_clock::now();
            v = f(cnt);
            ts[k] = duration<double>(steady_clock::now() - t0).count();
        }
        sort(ts, ts + 3);
        return pair<double, long long>(ts[1], v);
    };

    auto rn = med(naive, Q);
    auto rf = med(fast, Q);
    printf("N = %d, Q = %d\n", N, Q);
    printf("순진한 구간 합: %.3f초 (합 %lld)\n", rn.first, rn.second);
    printf("누적 합       : %.5f초 (합 %lld)\n", rf.first, rf.second);
    printf("일치 여부     : %s\n", rn.second == rf.second ? "같음" : "다름");
    return 0;
}
