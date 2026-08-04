// 0-9 — "1초에 몇 연산인가"의 실측 (C++ 쪽).
//
// ops_budget.py 와 워크로드가 1:1 로 대응한다. 루프 몸통은 같은 일을 하고,
// 다른 것은 언어뿐이다.
//
// 누산값을 전부 마지막에 출력에 쓴다. 안 그러면 -O2 가 루프를 통째로 지운다.
// `volatile` 을 쓰지 않는 이유: volatile 은 실제 코테 코드에 없는 메모리
// 접근 제약을 넣어 측정 대상을 바꿔 버린다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/ops_budget.cpp -o /tmp/ops_budget && /tmp/ops_budget

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <random>
#include <unordered_map>
#include <vector>
using namespace std;

static const int REPS = 3;
static long long g_sink = 0;

static double median3(double a, double b, double c) {
    double v[3] = {a, b, c};
    sort(v, v + 3);
    return v[1];
}

template <typename F>
static double bench(F f) {
    double t[REPS];
    for (int r = 0; r < REPS; ++r) {
        auto t0 = chrono::steady_clock::now();
        g_sink += f();
        auto t1 = chrono::steady_clock::now();
        t[r] = chrono::duration<double>(t1 - t0).count();
    }
    return median3(t[0], t[1], t[2]);
}

static void report(const char* name, long long n, double el) {
    printf("%-30s %12lld %8.3f %9.2f %16.0f\n", name, n, el, el / n * 1e9, n / el);
}

// 함수 호출 비용을 재려면 인라인을 막아야 한다. 인라인되면 호출이 0회다.
__attribute__((noinline)) static long long leaf(long long x) { return x + 1; }

int main() {
    const long long N = 10000000;

    printf("=== 알고리즘 안쪽 루프 한 바퀴의 비용 (g++ 13 -O2) ===\n");
    printf("%-30s %12s %8s %9s %16s\n", "워크로드", "n", "초", "ns/op", "ops/s");

    vector<long long> a(N);
    for (long long i = 0; i < N; ++i) a[i] = i;

    {  // 연속 접근
        double el = bench([&] {
            long long s = 0;
            for (size_t i = 0; i < a.size(); ++i) s += a[i];
            return s;
        });
        report("연속 접근 s += a[i]", N, el);
    }
    {  // 무작위 접근
        mt19937 rng(1);
        vector<int> idx(N);
        for (long long i = 0; i < N; ++i) idx[i] = (int)(rng() % (unsigned)N);
        double el = bench([&] {
            long long s = 0;
            for (size_t i = 0; i < idx.size(); ++i) s += a[idx[i]];
            return s;
        });
        report("무작위 접근 s += a[idx[i]]", N, el);
    }
    {  // 해시맵 조회
        const long long nd = 2000000;
        unordered_map<int, int> d;
        d.reserve(1 << 21);
        for (int i = 0; i < (1 << 20); ++i) d[i] = i;
        mt19937 rng(2);
        vector<int> keys(nd);
        for (long long i = 0; i < nd; ++i) keys[i] = (int)(rng() % (1u << 20));
        double el = bench([&] {
            long long s = 0;
            for (size_t i = 0; i < keys.size(); ++i) s += d[keys[i]];
            return s;
        });
        report("해시맵 조회 d[k]", nd, el);
    }
    {  // DP 갱신
        const long long ndp = 5000000;
        vector<int> dp(10001, 0);
        int w = 7, v = 13, cap = 10000;
        double el = bench([&] {
            long long cnt = 0;
            while (cnt < ndp) {
                for (int j = cap; j >= w; --j) {
                    int cand = dp[j - w] + v;
                    if (cand > dp[j]) dp[j] = cand;
                    ++cnt;
                    if (cnt >= ndp) break;
                }
            }
            return (long long)dp[cap];
        });
        report("DP 갱신 dp[j]=max(...)", ndp, el);
    }
    {  // 함수 호출
        const long long nf = 5000000;
        double el = bench([&] {
            long long s = 0;
            for (long long i = 0; i < nf; ++i) s = leaf(s);
            return s;
        });
        report("함수 호출 f(x)", nf, el);
    }

    printf("\n=== 정렬: n log n 한 단위의 비용 ===\n");
    for (long long n : {100000LL, 1000000LL, 5000000LL}) {
        mt19937 rng(1);
        vector<int> base(n);
        for (long long i = 0; i < n; ++i) base[i] = (int)(rng() >> 2);
        double t[REPS];
        for (int r = 0; r < REPS; ++r) {
            vector<int> arr = base;
            auto t0 = chrono::steady_clock::now();
            sort(arr.begin(), arr.end());
            auto t1 = chrono::steady_clock::now();
            t[r] = chrono::duration<double>(t1 - t0).count();
            g_sink += arr[0];
        }
        double el = median3(t[0], t[1], t[2]);
        double units = (double)n * log2((double)n);
        printf("  n=%9lld  sort=%7.3fs  n·log2 n=%13.0f  %15.0f 단위/s\n", n, el, units, units / el);
    }

    // --- 컴파일러가 루프를 지우는 현상 ------------------------------------
    // 이 절이 있는 이유: "s += i 를 10^8 번 돌려 보니 0.00초였다"는 측정이
    // 잘못된 결론으로 이어지는 것을 막기 위해서다.
    printf("\n=== -O2 가 지워 버리는 루프 ===\n");
    {
        long long s = 0;
        auto t0 = chrono::steady_clock::now();
        for (long long i = 0; i < 1000000000LL; ++i) s += i;
        auto t1 = chrono::steady_clock::now();
        g_sink += s;
        printf("  s += i 를 10^9 회: %.6fs  (닫힌 형태로 접혀 루프가 없어졌다)\n",
               chrono::duration<double>(t1 - t0).count());
    }

    if (g_sink == 12345678987654321LL) printf("unreachable\n");
    return 0;
}
