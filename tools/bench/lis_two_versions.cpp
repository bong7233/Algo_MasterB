// VIII-6 LIS — O(n^2) 판과 O(n log n) 판의 C++ 실측. Python 판은 lis_two_versions.py 다.
//   g++ -std=c++17 -O2 tools/bench/lis_two_versions.cpp -o /tmp/lis && /tmp/lis
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <vector>
using namespace std;
using namespace std::chrono;

vector<int> gen(int n, long long seed = 20260805) {
    vector<int> out;
    long long x = seed;
    for (int i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) % (1LL << 31);
        out.push_back((int)(x % 1000000));
    }
    return out;
}

int lis_n2(const vector<int>& a) {
    int n = a.size();
    vector<int> dp(n, 1);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < i; j++)
            if (a[j] < a[i] && dp[j] + 1 > dp[i]) dp[i] = dp[j] + 1;
    return *max_element(dp.begin(), dp.end());
}

int lis_nlogn(const vector<int>& a) {
    vector<int> tails;
    for (int x : a) {
        auto it = lower_bound(tails.begin(), tails.end(), x);
        if (it == tails.end()) tails.push_back(x);
        else *it = x;
    }
    return tails.size();
}

int main() {
    int n = 5000;
    vector<int> a = gen(n);
    auto t0 = steady_clock::now();
    int r1 = lis_n2(a);
    auto t1 = steady_clock::now();
    int r2 = lis_nlogn(a);
    auto t2 = steady_clock::now();
    printf("n=%d  O(n^2)     : %.3f s  (LIS %d)\n", n, duration<double>(t1 - t0).count(), r1);
    printf("n=%d  O(n log n) : %.1f ms  (LIS %d)\n", n, duration<double>(t2 - t1).count() * 1000, r2);
    printf("두 판의 답이 같은가: %s\n", r1 == r2 ? "True" : "False");

    int big = 1000000;
    a = gen(big);
    t0 = steady_clock::now();
    int r = lis_nlogn(a);
    t1 = steady_clock::now();
    printf("n=%d  O(n log n) : %.2f s  (LIS %d)\n", big, duration<double>(t1 - t0).count(), r);
    return 0;
}
