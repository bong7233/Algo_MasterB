// VI-3 본문 수치 — 투 포인터 O(n) 과 이중 루프 O(n^2) 의 실측 비교 (C++ 판).
//
// 측정 환경은 CLAUDE.md §1-3 에 고정되어 있다.
//     Ubuntu 24.04 LTS (x86-64) / g++ 13.3.0 -std=c++17 -O2
//
// Python 판(two_pointer_vs_quadratic.py)과 같은 n·같은 배열을 쓴다. LCG 가
// 같으므로 두 언어가 정확히 같은 입력을 재고, 그래야 언어 간 비교가 성립한다.
//
//     g++ -std=c++17 -O2 -o /tmp/tpq tools/bench/two_pointer_vs_quadratic.cpp && /tmp/tpq

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <vector>
using namespace std;

const unsigned long long SEED = 12345;

vector<int> make_array(int n) {   // 양수만 만든다 — 투 포인터의 단조성 전제가 그것이다
    unsigned long long seed = SEED;
    vector<int> out;
    out.reserve(n);
    for (int i = 0; i < n; i++) {
        seed = (seed * 1103515245ULL + 12345ULL) % 2147483648ULL;
        out.push_back(1 + (int)(seed % 100));
    }
    return out;
}

int min_window(const vector<int>& a, long long target) {
    int n = (int)a.size();
    int lo = 0, best = n + 1;
    long long total = 0;
    for (int hi = 0; hi < n; hi++) {
        total += a[hi];
        while (total >= target) {
            if (hi - lo + 1 < best) best = hi - lo + 1;
            total -= a[lo];
            lo += 1;
        }
    }
    return best == n + 1 ? 0 : best;
}

int brute_min_window(const vector<int>& a, long long target) {
    int n = (int)a.size();
    int best = n + 1;
    for (int lo = 0; lo < n; lo++) {
        long long total = 0;
        for (int hi = lo; hi < n; hi++) {
            total += a[hi];
            if (total >= target && hi - lo + 1 < best) best = hi - lo + 1;
        }
    }
    return best == n + 1 ? 0 : best;
}

template <class F>
pair<int, double> bench(F fn, const vector<int>& a, long long target, int reps) {
    vector<double> times;
    int ans = 0;
    for (int r = 0; r < reps; r++) {
        auto t0 = chrono::steady_clock::now();
        ans = fn(a, target);
        auto t1 = chrono::steady_clock::now();
        times.push_back(chrono::duration<double>(t1 - t0).count());
    }
    sort(times.begin(), times.end());
    return {ans, times[times.size() / 2]};   // 중앙값
}

int main() {
    int n = 5000;
    vector<int> a = make_array(n);
    long long target = 20000;

    auto [ans1, t1] = bench(min_window, a, target, 3);
    auto [ans2, t2] = bench(brute_min_window, a, target, 3);
    printf("n = %d, target = %lld\n", n, target);
    printf("  two-pointer O(n)    : answer = %d, %.6f s\n", ans1, t1);
    printf("  double loop O(n^2)  : answer = %d, %.6f s\n", ans2, t2);
    printf("  ratio               : %.1f x\n", t2 / t1);

    int big = 1000000;
    vector<int> b = make_array(big);
    auto [ans3, t3] = bench(min_window, b, 4000000LL, 3);
    printf("n = %d\n", big);
    printf("  two-pointer O(n)    : answer = %d, %.6f s\n", ans3, t3);
    return 0;
}
