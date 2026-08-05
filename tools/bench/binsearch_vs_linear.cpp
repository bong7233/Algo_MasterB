// VII-1·VII-2 본문 수치의 C++ 쪽 — 선형 / 직접 짠 이분 / std::lower_bound.
//
// 빌드·실행:
//   g++ -std=c++17 -O2 tools/bench/binsearch_vs_linear.cpp -o /tmp/bvl && /tmp/bvl
//
// Python 판(binsearch_vs_linear.py)과 같은 N·같은 질의 수를 쓴다. 난수열은
// 언어마다 다르지만 균등 분포이므로 질의 1회당 비용의 자릿수는 비교 가능하다.
// 최적화가 루프를 통째로 지우지 못하도록 결과를 합산해 출력한다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;

static const int N = 100000;
static const int Q_FAST = 100000;
static const int Q_SLOW = 200;

int lower_bound_mine(const vector<int>& a, int x) {
    int lo = 0, hi = (int)a.size();
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (a[mid] >= x)
            hi = mid;
        else
            lo = mid + 1;
    }
    return lo;
}

int lower_bound_linear(const vector<int>& a, int x) {
    for (int i = 0; i < (int)a.size(); i++)
        if (a[i] >= x) return i;
    return (int)a.size();
}

template <class F>
double bench(F fn, const vector<int>& a, const vector<int>& qs) {
    auto t0 = chrono::steady_clock::now();
    long long s = 0;
    for (int x : qs) s += fn(a, x);
    auto t1 = chrono::steady_clock::now();
    if (s == -1) printf("unreachable\n");  // 결과를 쓰게 만들어 루프 제거를 막는다
    return chrono::duration<double>(t1 - t0).count() / qs.size() * 1e6;
}

int main() {
    mt19937 rng(20260805);
    uniform_int_distribution<int> dist(0, 1000000000);
    vector<int> a(N);
    for (int& v : a) v = dist(rng);
    sort(a.begin(), a.end());

    vector<int> qs_fast(Q_FAST);
    for (int& v : qs_fast) v = dist(rng);
    vector<int> qs_slow(qs_fast.begin(), qs_fast.begin() + Q_SLOW);

    double t_lin = 1e18, t_mine = 1e18, t_std = 1e18;
    for (int r = 0; r < 3; r++) {
        t_lin = min(t_lin, bench(lower_bound_linear, a, qs_slow));
        t_mine = min(t_mine, bench(lower_bound_mine, a, qs_fast));
        t_std = min(t_std, bench([](const vector<int>& v, int x) {
                        return (int)(lower_bound(v.begin(), v.end(), x) - v.begin());
                    }, a, qs_fast));
    }

    printf("N = %d  (g++ -O2)\n", N);
    printf("  선형 탐색           질의 %7d회 %9.3f us/질의\n", Q_SLOW, t_lin);
    printf("  직접 짠 이분 탐색   질의 %7d회 %9.3f us/질의\n", Q_FAST, t_mine);
    printf("  std::lower_bound    질의 %7d회 %9.3f us/질의\n", Q_FAST, t_std);
    return 0;
}
