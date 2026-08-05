// 구간 DP(행렬 곱셈 순서)의 실제 비용 — VIII-7 의 C++ 쪽 측정.
//
// 빌드·실행:
//     g++ -std=c++17 -O2 -o /tmp/viii7 tools/bench/viii7_interval_dp.cpp && /tmp/viii7
//
// 파이썬 판(viii7_interval_dp.py)과 같은 n 과 같은 난수 씨앗 규칙을 쓴다.
// 여기서 보려는 것은 절대 시간이 아니라 **같은 O(n^3) 이 언어에 따라 어디서 1 초를
// 넘는가** 다. 알고리즘을 바꾸지 않고 언어만 바꿔 얻는 여유가 얼마인지가 판단 재료다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;

const long long INF = (long long)4e18;

long long chain_dp(const vector<long long>& d) {
    int n = (int)d.size() - 1;
    vector<vector<long long>> dp(n + 2, vector<long long>(n + 2, 0));
    for (int L = 2; L <= n; L++) {
        for (int i = 1; i + L - 1 <= n; i++) {
            int j = i + L - 1;
            long long best = INF;
            for (int k = i; k < j; k++) {
                long long t = dp[i][k] + dp[k + 1][j] + d[i - 1] * d[k] * d[j];
                if (t < best) best = t;
            }
            dp[i][j] = best;
        }
    }
    return dp[1][n];
}

double median3(double a, double b, double c) {
    double v[3] = {a, b, c};
    sort(v, v + 3);
    return v[1];
}

int main() {
    mt19937 rng(20250805);
    printf("[2] 구간 DP — n 을 키우며 시간 (중앙값 3회)\n");
    for (int n : {50, 100, 200, 300, 500, 1000}) {
        vector<long long> d(n + 1);
        for (int i = 0; i <= n; i++) d[i] = (long long)(rng() % 100 + 1);
        double ts[3];
        for (int r = 0; r < 3; r++) {
            auto t0 = chrono::steady_clock::now();
            volatile long long ans = chain_dp(d);
            (void)ans;
            ts[r] = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
        }
        printf("    n=%4d  %.4f s\n", n, median3(ts[0], ts[1], ts[2]));
    }
    vector<long long> d = {10, 100, 5, 50, 20};
    printf("[3] dims={10,100,5,50,20} 길이 순 = %lld\n", chain_dp(d));
    return 0;
}
