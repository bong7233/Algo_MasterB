// VIII-9 의 수치 — 순열 완전탐색 대 비트마스크 DP (g++ 13, -O2).
//
//   g++ -std=c++17 -O2 -o /tmp/tsp tools/bench/tsp_bitmask.cpp && /tmp/tsp
//
// Python 판(tsp_bitmask.py)과 같은 비용 행렬 생성 규칙을 쓰지 않는다 —
// 언어별 난수 생성기가 다르므로 같은 시드로도 같은 행렬이 안 나온다.
// 이 파일이 재는 것은 시간이고, 정확성 대조는 두 방법이 같은 행렬에서
// 같은 답을 내는지로 파일 안에서 자체 확인한다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <numeric>
#include <random>
#include <sys/resource.h>
#include <vector>
using namespace std;

static const int INF = 1e9;

vector<vector<int>> make_cost(int n, unsigned seed = 7) {
    mt19937 rng(seed);
    uniform_int_distribution<int> d(1, 100);
    vector<vector<int>> c(n, vector<int>(n, 0));
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            if (i != j) c[i][j] = d(rng);
    return c;
}

int brute(const vector<vector<int>>& cost) {
    int n = (int)cost.size();
    vector<int> perm(n - 1);
    iota(perm.begin(), perm.end(), 1);
    int best = INF;
    do {
        int prev = 0, s = 0;
        for (int x : perm) { s += cost[prev][x]; prev = x; }
        s += cost[prev][0];
        best = min(best, s);
    } while (next_permutation(perm.begin(), perm.end()));
    return best;
}

int bitmask(const vector<vector<int>>& cost) {
    int n = (int)cost.size(), full = (1 << n) - 1;
    vector<vector<int>> dp(1 << n, vector<int>(n, INF));
    dp[1][0] = 0;
    for (int mask = 0; mask <= full; mask++)
        for (int i = 0; i < n; i++) {
            if (dp[mask][i] == INF) continue;
            for (int j = 0; j < n; j++) {
                if (mask >> j & 1) continue;
                int v = dp[mask][i] + cost[i][j];
                if (v < dp[mask | (1 << j)][j]) dp[mask | (1 << j)][j] = v;
            }
        }
    int best = INF;
    for (int i = 1; i < n; i++) best = min(best, dp[full][i] + cost[i][0]);
    return best;
}

template <class F>
double timed(F f, const vector<vector<int>>& c, int reps, int& out) {
    vector<double> ts;
    for (int r = 0; r < reps; r++) {
        auto t0 = chrono::steady_clock::now();
        out = f(c);
        ts.push_back(chrono::duration<double>(chrono::steady_clock::now() - t0).count());
    }
    sort(ts.begin(), ts.end());
    return ts[ts.size() / 2];
}

int main() {
    printf(" n | brute(sec)  | bitmask(sec)| same\n");
    printf("---|-------------|-------------|-----\n");
    for (int n : {11, 12, 13, 14}) {
        auto c = make_cost(n);
        int b = 0, d = 0;
        double tb = timed(brute, c, 3, b);
        double td = timed(bitmask, c, 3, d);
        printf("%2d | %11.4f | %11.4f | %s (%d)\n", n, tb, td, b == d ? "yes" : "NO", b);
    }
    printf("\n");
    printf("  n | states (2^n x n) | table (MB) | peak RSS (MB) | bitmask(sec)\n");
    printf("----|------------------|------------|---------------|-------------\n");
    for (int n : {16, 18, 20, 22, 24}) {
        auto c = make_cost(n);
        int d = 0;
        double td = timed(bitmask, c, 1, d);
        double states = (double)(1LL << n) * n;
        rusage ru;
        getrusage(RUSAGE_SELF, &ru);
        printf("%3d | %16.0f | %10.1f | %13.1f | %12.3f\n", n, states,
               states * sizeof(int) / 1048576.0, ru.ru_maxrss / 1024.0, td);
    }
    return 0;
}
