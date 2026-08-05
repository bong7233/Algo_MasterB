// VIII-5 배낭 — 유사 다항식 비용의 C++ 실측. Python 판은 knapsack_scale.py 다.
//   g++ -std=c++17 -O2 tools/bench/knapsack_scale.cpp -o /tmp/ks && /tmp/ks
#include <bitset>
#include <chrono>
#include <cstdio>
#include <vector>
using namespace std;
using namespace std::chrono;

int main() {
    const int n = 100, W = 100000;
    // Python 판과 같은 수열을 내기 위한 최소 난수기
    long long x = 20260805;
    auto nxt = [&](int mod) { x = (x * 1103515245 + 12345) % (1LL << 31); return (int)(x % mod) + 1; };
    vector<pair<int, int>> items;
    for (int i = 0; i < n; i++) { int w = nxt(1000), v = nxt(1000); items.push_back({w, v}); }

    auto t0 = steady_clock::now();
    vector<int> dp(W + 1, 0);
    for (auto [w, v] : items)
        for (int c = W; c >= w; c--)
            if (dp[c - w] + v > dp[c]) dp[c] = dp[c - w] + v;
    auto t1 = steady_clock::now();
    printf("0/1 배낭  n=%d W=%d (%lld 칸) : %.3f s  (답 %d)\n", n, W, (long long)n * W,
           duration<double>(t1 - t0).count(), dp[W]);

    const int S = 100000;
    vector<int> nums;
    for (int i = 0; i < n; i++) nums.push_back(nxt(1000));

    t0 = steady_clock::now();
    vector<char> can(S + 1, 0);
    can[0] = 1;
    for (int x : nums)
        for (int s = S; s >= x; s--)
            if (can[s - x]) can[s] = 1;
    t1 = steady_clock::now();
    static bitset<S + 1> bits;
    bits[0] = 1;
    for (int x : nums) bits |= bits << x;
    auto t2 = steady_clock::now();
    long cnt = 0;
    for (int s = 0; s <= S; s++) cnt += can[s];
    printf("부분합 불린 DP n=%d S=%d : %.3f s  (도달 가능한 합 %ld개)\n", n, S,
           duration<double>(t1 - t0).count(), cnt);
    printf("부분합 bitset            : %.1f ms  (도달 가능한 합 %zu개)\n",
           duration<double>(t2 - t1).count() * 1000, bits.count());
    printf("두 결과 일치: %s / 배율 %.0f배\n", (size_t)cnt == bits.count() ? "True" : "False",
           duration<double>(t1 - t0).count() / duration<double>(t2 - t1).count());
    return 0;
}
