// II-5 — 슬라이딩 윈도우 최댓값: 창을 매번 훑는 방법과 덱으로 후보만 남기는 방법 (C++ 쪽).
//
// window_max_deque.py 와 1:1 로 대응한다. 같은 n, 같은 k, 같은 난수 규칙.
//
// 보려는 것은 절대 시간이 아니라 k 에 대한 기울기다. 창마다 다시 훑으면
// O(nk) 라 k 가 4배가 되면 시간도 약 4배가 되고, 덱은 O(n) 이라 k 를 키워도
// 시간이 거의 그대로다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/window_max_deque.cpp -o /tmp/wm && /tmp/wm

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <deque>
#include <random>
#include <vector>
using namespace std;
using clk = chrono::steady_clock;

static const int N = 200000;

static vector<int> naive(const vector<int>& a, int k) {
    vector<int> out;
    out.reserve(a.size() - k + 1);
    for (size_t i = 0; i + k <= a.size(); ++i)
        out.push_back(*max_element(a.begin() + i, a.begin() + i + k));
    return out;
}

static vector<int> with_deque(const vector<int>& a, int k) {
    deque<int> dq;
    vector<int> out;
    out.reserve(a.size() - k + 1);
    for (size_t i = 0; i < a.size(); ++i) {
        while (!dq.empty() && a[dq.back()] <= a[i]) dq.pop_back();
        dq.push_back((int)i);
        if (dq.front() <= (int)i - k) dq.pop_front();
        if ((int)i >= k - 1) out.push_back(a[dq.front()]);
    }
    return out;
}

template <typename F>
static double bench(F fn, const vector<int>& a, int k, int repeat = 3) {
    vector<double> ts;
    for (int r = 0; r < repeat; ++r) {
        auto t0 = clk::now();
        auto v = fn(a, k);
        auto t1 = clk::now();
        if (v.empty()) puts("");  // 최적화로 통째로 사라지는 것을 막는다
        ts.push_back(chrono::duration<double>(t1 - t0).count());
    }
    sort(ts.begin(), ts.end());
    return ts[ts.size() / 2];
}

int main() {
    mt19937 rng(20250804);
    vector<int> a(N);
    for (int& x : a) x = (int)(rng() % 1000000000u) + 1;

    printf("n = %d  (g++ 13 -O2)\n", N);
    printf("%8s | %14s | %10s | %8s\n", "k", "창마다 훑기", "덱", "배수");
    puts("------------------------------------------------");
    for (int k : {100, 400, 1600}) {
        double t1 = bench(naive, a, k);
        double t2 = bench(with_deque, a, k);
        printf("%8d | %11.4f초 | %8.4f초 | %6.1f배\n", k, t1, t2, t1 / t2);
    }
    return 0;
}
