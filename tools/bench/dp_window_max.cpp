// VIII-10 의 수치 — 창 최댓값을 다시 훑는 DP 대 단조 덱 DP (g++ 13, -O2).
//
//   g++ -std=c++17 -O2 -o /tmp/dpwm tools/bench/dp_window_max.cpp && /tmp/dpwm
//
// 점화식은 본문과 같다.  dp[i] = a[i] + max(dp[j]) for j in [i-k, i-1]
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <deque>
#include <random>
#include <vector>
using namespace std;

long long naive(const vector<int>& a, int k) {
    int n = (int)a.size();
    vector<long long> dp(n);
    dp[0] = a[0];
    for (int i = 1; i < n; i++) {
        long long best = dp[i - 1];
        int lo = max(0, i - k);
        for (int j = lo; j < i; j++) best = max(best, dp[j]);
        dp[i] = a[i] + best;
    }
    return dp[n - 1];
}

long long fast_dq(const vector<int>& a, int k) {
    int n = (int)a.size();
    vector<long long> dp(n);
    dp[0] = a[0];
    deque<int> dq;
    for (int i = 1; i < n; i++) {
        while (!dq.empty() && dp[dq.back()] <= dp[i - 1]) dq.pop_back();
        dq.push_back(i - 1);
        while (dq.front() < i - k) dq.pop_front();
        dp[i] = a[i] + dp[dq.front()];
    }
    return dp[n - 1];
}

template <class F>
double timed(F f, const vector<int>& a, int k, int reps, long long& out) {
    vector<double> ts;
    for (int r = 0; r < reps; r++) {
        auto t0 = chrono::steady_clock::now();
        out = f(a, k);
        ts.push_back(chrono::duration<double>(chrono::steady_clock::now() - t0).count());
    }
    sort(ts.begin(), ts.end());
    return ts[ts.size() / 2];
}

int main() {
    mt19937 rng(11);
    uniform_int_distribution<int> small(-9, 9);

    // 정확성 — 작은 입력에서 두 구현을 대조
    for (int t = 0; t < 2000; t++) {
        int n = 2 + (int)(rng() % 8), k = 1 + (int)(rng() % 4);
        vector<int> a(n);
        for (int& x : a) x = small(rng);
        if (naive(a, k) != fast_dq(a, k)) { printf("불일치\n"); return 1; }
    }
    printf("accuracy: naive == fast on 2000 random cases\n\n");

    uniform_int_distribution<int> big(-1000, 1000);
    printf("        n |      k | naive(sec) | fast(sec) | ratio | same\n");
    printf("----------|--------|------------|-----------|-------|-----\n");
    for (auto [n, k] : vector<pair<int, int>>{{200000, 2000}, {500000, 2000}, {1000000, 2000}}) {
        vector<int> a(n);
        for (int& x : a) x = big(rng);
        long long v1 = 0, v2 = 0;
        double t1 = timed(naive, a, k, 1, v1);
        double t2 = timed(fast_dq, a, k, 3, v2);
        printf("%9d | %6d | %10.3f | %9.4f | %5.0f | %s\n", n, k, t1, t2, t1 / t2,
               v1 == v2 ? "yes" : "NO");
    }
    return 0;
}
