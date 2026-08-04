// 0-9 — 두 배 실험(doubling test): 코드를 읽지 않고 복잡도를 알아내는 절차.
//
// doubling_test.py 와 1:1 로 대응한다. 워크로드도 판정 기준도 같다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/doubling_test.cpp -o /tmp/doubling && /tmp/doubling

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <vector>
using namespace std;

static const int REPS = 3;
static long long g_sink = 0;

static double median3(double a, double b, double c) {
    double v[3] = {a, b, c};
    sort(v, v + 3);
    return v[1];
}

// 뒤에 붙인다. 재할당이 상환되어 한 번이 O(1).
static long long build_append(int n) {
    vector<int> a;
    for (int i = 0; i < n; ++i) a.push_back(i);
    return (long long)a.size();
}

// 앞에 붙인다. 뒤 원소를 통째로 밀어야 해서 한 번이 O(n).
static long long build_insert_front(int n) {
    vector<int> a;
    for (int i = 0; i < n; ++i) a.insert(a.begin(), i);
    return (long long)a.size();
}

static long long sort_build(int n) {
    vector<int> a(n);
    for (int i = 0; i < n; ++i) a[i] = (int)(((long long)i * 2654435761LL) % n);
    sort(a.begin(), a.end());
    return a[0];
}

template <typename F>
static void run(const char* name, F fn, vector<int> sizes) {
    printf("\n--- %s ---\n", name);
    printf("%9s %10s %12s %11s  판정\n", "n", "T(n) 초", "T(n)/T(n/2)", "log2(배수)");
    double prev = -1;
    for (int n : sizes) {
        double t[REPS];
        for (int r = 0; r < REPS; ++r) {
            auto t0 = chrono::steady_clock::now();
            g_sink += fn(n);
            auto t1 = chrono::steady_clock::now();
            t[r] = chrono::duration<double>(t1 - t0).count();
        }
        double el = median3(t[0], t[1], t[2]);
        if (prev < 0) {
            printf("%9d %10.4f %12s %11s  (기준)\n", n, el, "—", "—");
        } else {
            double r = el / prev;
            double k = log2(r);
            const char* verdict = k < 1.3 ? "O(n)" : (k < 2.6 ? "O(n^2)" : "O(n^3) 이상");
            printf("%9d %10.4f %12.2f %11.2f  %s\n", n, el, r, k, verdict);
        }
        prev = el;
    }
}

int main() {
    printf("=== 두 배 실험 (g++ 13 -O2) ===\n");
    run("push_back — 뒤에 붙이기", build_append, {500000, 1000000, 2000000, 4000000});
    run("insert(begin) — 앞에 붙이기", build_insert_front, {25000, 50000, 100000, 200000});
    run("sort — n log n", sort_build, {500000, 1000000, 2000000, 4000000});
    if (g_sink == 12345678987654321LL) printf("unreachable\n");
    return 0;
}
