// II-7 — 비교하지 않는 정렬은 실제로 얼마나 빠른가 (C++ 쪽).
//
// 계수 정렬과 기수 정렬은 원소를 서로 비교하지 않는다. 그래서 비교 정렬의
// 하한 Ω(n log n) 이 적용되지 않는다. 하한을 깬 것이 아니라 하한이 걸리는
// 게임을 하지 않는 것이다.
//
// 대신 조건이 붙는다. 계수 정렬은 값의 범위 K 만큼의 배열이 필요하고,
// 기수 정렬은 자릿수만큼 훑기를 반복한다. 그 조건을 값으로 확인한다.
//
// counting_radix_bench.py 와 같은 실험을 한다(n 은 언어별로 다르다).
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/counting_radix_bench.cpp -o /tmp/cr && /tmp/cr

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;
using clk = chrono::steady_clock;

static const size_t N = 2000000;

static vector<int> counting_sort(const vector<int>& a, int K) {
    vector<int> cnt(K + 1, 0);
    for (int x : a) cnt[x]++;
    for (int v = 1; v <= K; ++v) cnt[v] += cnt[v - 1];   // 누적합 = 각 값의 끝 위치
    vector<int> out(a.size());
    for (size_t i = a.size(); i-- > 0;)                  // 뒤에서부터 = 안정성
        out[--cnt[a[i]]] = a[i];
    return out;
}

// LSD 기수 정렬, 8비트씩 네 번. 각 자리마다 계수 정렬을 돌린다.
static vector<int> radix_sort(vector<int> a) {
    vector<int> buf(a.size());
    for (int shift = 0; shift < 32; shift += 8) {
        size_t cnt[256] = {0};
        for (int x : a) cnt[(unsigned(x) >> shift) & 255]++;
        for (int v = 1; v < 256; ++v) cnt[v] += cnt[v - 1];
        for (size_t i = a.size(); i-- > 0;)
            buf[--cnt[(unsigned(a[i]) >> shift) & 255]] = a[i];
        a.swap(buf);
    }
    return a;
}

template <typename F>
static double bench(F fn, int repeat = 3) {
    vector<double> ts;
    for (int r = 0; r < repeat; ++r) {
        auto t0 = clk::now();
        auto v = fn();
        auto t1 = clk::now();
        if (v.size() == 12345678) puts("");
        ts.push_back(chrono::duration<double>(t1 - t0).count());
    }
    sort(ts.begin(), ts.end());
    return ts[ts.size() / 2];
}

int main() {
    mt19937 rng(20250804);

    // 1) 값 범위가 좁을 때 — 계수 정렬이 성립하는 조건
    {
        const int K = 10000;
        vector<int> a(N);
        for (int& x : a) x = (int)(rng() % K) + 1;

        double t_sort = bench([&] { vector<int> v = a; sort(v.begin(), v.end()); return v; });
        double t_cnt = bench([&] { return counting_sort(a, K); });

        vector<int> s = a; sort(s.begin(), s.end());
        printf("검산: 계수 정렬 결과가 std::sort 와 같은가 = %s\n\n",
               counting_sort(a, K) == s ? "예" : "아니오");

        printf("n = %zu, 값 범위 K = %d  (g++ 13 -O2)\n", N, K);
        printf("  std::sort     : %.4f초\n", t_sort);
        printf("  계수 정렬     : %.4f초  (%.1f배 빠름)\n\n", t_cnt, t_sort / t_cnt);
    }

    // 2) 값 범위가 32비트 전체일 때 — 계수 정렬은 불가능하고 기수 정렬만 남는다
    {
        vector<int> a(N);
        for (int& x : a) x = (int)(rng() & 0x7fffffff);

        double t_sort = bench([&] { vector<int> v = a; sort(v.begin(), v.end()); return v; });
        double t_rdx = bench([&] { return radix_sort(a); });

        vector<int> s = a; sort(s.begin(), s.end());
        printf("검산: 기수 정렬 결과가 std::sort 와 같은가 = %s\n\n",
               radix_sort(a) == s ? "예" : "아니오");

        printf("n = %zu, 값 범위 = 2^31  (g++ 13 -O2)\n", N);
        printf("  std::sort     : %.4f초\n", t_sort);
        printf("  기수 정렬     : %.4f초  (%.1f배 빠름)\n", t_rdx, t_sort / t_rdx);
        printf("  계수 정렬     : 불가능 — 카운트 배열만 %zu MB\n",
               (size_t)2147483648u * sizeof(int) / (1024 * 1024));
    }
    return 0;
}
