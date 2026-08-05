// VIII-3 의 수치와 정확성 검증 (C++ 판) — 1차원 DP.
//
// 파이썬 판(viii3_1d_dp.py)과 같은 것을 재서 언어 상수 차이를 본다.
//   1. 최대 부분합: O(n^2) 완전탐색 vs 카데인
//   2. 타일링: 배열판 vs 롤링판 (시간, 그리고 배열이 실제로 차지하는 바이트)
//   3. 메모 없는 재귀의 호출 수
//   4. 무작위 대조 — 카데인 vs 완전탐색
//
// 시간은 3회 재고 중앙값을 쓴다. 측정 환경은 CLAUDE.md §1-3 고정.
//   g++ -std=c++17 -O2 -o /tmp/viii3 tools/bench/viii3_1d_dp.cpp && /tmp/viii3

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;
using Clock = chrono::steady_clock;

const int MOD = 10007;

static double median3(double a, double b, double c) {
    double v[3] = {a, b, c};
    sort(v, v + 3);
    return v[1];
}

// --------------------------------------------------------------- 타일링

int tiling_array(int n) {
    vector<int> dp(n + 1, 0);
    dp[0] = 1;
    dp[1] = 1;
    for (int i = 2; i <= n; i++) dp[i] = (dp[i - 1] + dp[i - 2]) % MOD;
    return dp[n];
}

int tiling_rolling(int n) {
    int prev2 = 1, prev1 = 1;
    for (int i = 2; i <= n; i++) {
        int cur = (prev1 + prev2) % MOD;
        prev2 = prev1;
        prev1 = cur;
    }
    return prev1;
}

long long naive_calls = 0;
long long tiling_naive(int n) {
    naive_calls += 1;
    if (n <= 1) return 1;
    return tiling_naive(n - 1) + tiling_naive(n - 2);
}

// ------------------------------------------------------------ 최대 부분합

long long kadane(const vector<int>& a, int& bs, int& be) {
    long long best = a[0], cur = a[0];
    int cs = 0;
    bs = be = 0;
    for (size_t i = 1; i < a.size(); i++) {
        if (cur + a[i] < a[i]) { cur = a[i]; cs = (int)i; }
        else cur = cur + a[i];
        if (cur > best) { best = cur; bs = cs; be = (int)i; }
    }
    return best;
}

long long max_subarray_brute(const vector<int>& a) {
    long long best = a[0];
    for (size_t i = 0; i < a.size(); i++) {
        long long s = 0;
        for (size_t j = i; j < a.size(); j++) {
            s += a[j];
            if (s > best) best = s;
        }
    }
    return best;
}

long long wrong_prefix_state(const vector<int>& a) {
    long long dp = a[0];
    for (size_t i = 1; i < a.size(); i++)
        dp = max(dp, max(dp + a[i], (long long)a[i]));
    return dp;
}

int main() {
    mt19937 rng(77);

    printf("[1] 최대 부분합 — O(n^2) 완전탐색 vs 카데인 (중앙값 3회)\n");
    for (int size : {1000, 5000, 20000}) {
        vector<int> a(size);
        uniform_int_distribution<int> d(-1000, 1000);
        for (int& x : a) x = d(rng);

        double tb[3], tk[3];
        long long b1 = 0, b2 = 0;
        int s, e;
        for (int r = 0; r < 3; r++) {
            auto t0 = Clock::now();
            b1 = max_subarray_brute(a);
            tb[r] = chrono::duration<double>(Clock::now() - t0).count();
            t0 = Clock::now();
            b2 = kadane(a, s, e);
            tk[r] = chrono::duration<double>(Clock::now() - t0).count();
        }
        double bf = median3(tb[0], tb[1], tb[2]), kd = median3(tk[0], tk[1], tk[2]);
        printf("    n=%6d  답 %7lld  일치 %s  완전탐색 %9.1f ms  카데인 %7.3f ms  (%.0f배)\n",
               size, b1, b1 == b2 ? "O" : "X", bf * 1000, kd * 1000, bf / kd);
    }

    printf("\n[2] 타일링 — 배열판 vs 롤링판 (n=2,000,000, mod %d)\n", MOD);
    {
        int n = 2000000;
        double ta[3], tr[3];
        int va = 0, vr = 0;
        for (int r = 0; r < 3; r++) {
            auto t0 = Clock::now();
            va = tiling_array(n);
            ta[r] = chrono::duration<double>(Clock::now() - t0).count();
            t0 = Clock::now();
            vr = tiling_rolling(n);
            tr[r] = chrono::duration<double>(Clock::now() - t0).count();
        }
        printf("    답 %d (두 판 일치 %s)\n", va, va == vr ? "O" : "X");
        printf("    배열판 %8.1f ms  배열이 차지하는 바이트 %10.1f KB\n",
               median3(ta[0], ta[1], ta[2]) * 1000, (double)(n + 1) * sizeof(int) / 1024);
        printf("    롤링판 %8.1f ms  변수 두 개            %10.1f KB\n",
               median3(tr[0], tr[1], tr[2]) * 1000, (double)(2 * sizeof(int)) / 1024);
    }

    printf("\n[3] 메모 없는 재귀 — 같은 부분문제를 몇 번이나 다시 푸는가\n");
    for (int k : {10, 20, 30, 35}) {
        naive_calls = 0;
        auto t0 = Clock::now();
        long long v = tiling_naive(k);
        double el = chrono::duration<double>(Clock::now() - t0).count();
        printf("    n=%3d  답 %10lld  호출 %12lld회  %9.1f ms\n", k, v, naive_calls, el * 1000);
    }

    printf("\n[4] 잘못된 상태 — 'i 까지의 최대 부분합'\n");
    {
        vector<int> ex = {3, -2, 4, -7, 5, 2, -1, 3};
        int s, e;
        long long kb = kadane(ex, s, e);
        printf("    카데인 = %lld (구간 a[%d..%d])  완전탐색 = %lld  잘못된 상태 = %lld\n",
               kb, s, e, max_subarray_brute(ex), wrong_prefix_state(ex));
    }

    printf("\n[5] 무작위 대조 (M7 부칙 §7)\n");
    {
        int bad = 0, badseg = 0, badwrong = 0, trials = 3000;
        uniform_int_distribution<int> dk(1, 12), dv(-9, 9);
        for (int t = 0; t < trials; t++) {
            int k = dk(rng);
            vector<int> a(k);
            for (int& x : a) x = dv(rng);
            int s, e;
            long long kb = kadane(a, s, e), bf = max_subarray_brute(a);
            if (kb != bf) { bad++; }
            long long seg = 0;
            for (int i = s; i <= e; i++) seg += a[i];
            if (seg != kb) badseg++;
            if (wrong_prefix_state(a) != bf) badwrong++;
        }
        printf("    카데인 값   %d회 대조, 불일치 %d건\n", trials, bad);
        printf("    카데인 구간 %d회 검증, 불일치 %d건\n", trials, badseg);
        printf("    잘못된 상태가 틀린 횟수: %d회 (%.1f%%)\n", badwrong, 100.0 * badwrong / trials);

        int badtile = 0;
        for (int k = 1; k <= 24; k++) {
            naive_calls = 0;
            if (tiling_array(k) != (int)(tiling_naive(k) % MOD)) badtile++;
            if (tiling_rolling(k) != (int)(tiling_naive(k) % MOD)) badtile++;
        }
        printf("    타일링 n=1..24 완전열거와 대조, 불일치 %d건\n", badtile);
    }
    return 0;
}
