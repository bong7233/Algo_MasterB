// II-10 본문 수치 — 재귀 순회와 명시적 스택 순회의 실제 차이 (C++ 쪽).
//
// 측정 1  균형 이진 트리(노드 100만, 깊이 20) 후위 순회: 재귀 vs 명시적 스택
// 측정 2  사슬 트리(깊이 10만) 후위 순회: 재귀가 실제로 견디는가
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/traversal_recursion_cost.cpp -o /tmp/trc
//   /tmp/trc

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <utility>
#include <vector>
using namespace std;

using Clock = chrono::steady_clock;

static double sec(Clock::time_point a, Clock::time_point b) {
    return chrono::duration<double>(b - a).count();
}

static double median3(double a, double b, double c) {
    double v[3] = {a, b, c};
    sort(v, v + 3);
    return v[1];
}

static vector<int> L, R;

static long long post_recursive(int u) {
    if (u == -1) return 0;
    return post_recursive(L[u]) + post_recursive(R[u]) + 1;   // 자식이 먼저
}

static long long post_iterative(int root) {
    long long size = 0;
    vector<pair<int, bool>> st;
    st.push_back({root, false});
    while (!st.empty()) {
        auto [u, expanded] = st.back();
        st.pop_back();
        if (u == -1) continue;
        if (expanded) {
            size++;
        } else {
            st.push_back({u, true});
            st.push_back({R[u], false});
            st.push_back({L[u], false});
        }
    }
    return size;
}

int main() {
    const int n = 1000000;
    L.assign(n, -1); R.assign(n, -1);
    for (int i = 0; i < n; i++) {
        if (2 * i + 1 < n) L[i] = 2 * i + 1;
        if (2 * i + 2 < n) R[i] = 2 * i + 2;
    }

    printf("== 측정 1: 균형 트리 %d노드 후위 순회 ==\n", n);
    double tr[3], ti[3];
    long long r1 = 0, r2 = 0;
    for (int k = 0; k < 3; k++) {
        auto a0 = Clock::now(); r1 = post_recursive(0); auto a1 = Clock::now();
        r2 = post_iterative(0); auto a2 = Clock::now();
        tr[k] = sec(a0, a1); ti[k] = sec(a1, a2);
    }
    if (r1 != n || r2 != n) { printf("결과 불일치\n"); return 1; }
    double t_rec = median3(tr[0], tr[1], tr[2]);
    double t_it = median3(ti[0], ti[1], ti[2]);
    printf("  재귀        : %7.4f 초  (1.00 배)\n", t_rec);
    printf("  명시적 스택 : %7.4f 초  (%.2f 배)\n", t_it, t_it / t_rec);

    const int m = 100000;
    L.assign(m, -1); R.assign(m, -1);
    for (int i = 0; i + 1 < m; i++) R[i] = i + 1;
    printf("\n== 측정 2: 사슬 트리 %d노드(깊이 %d) 후위 순회 ==\n", m, m);
    double cr[3], ci[3];
    for (int k = 0; k < 3; k++) {
        auto b0 = Clock::now(); r1 = post_recursive(0); auto b1 = Clock::now();
        r2 = post_iterative(0); auto b2 = Clock::now();
        cr[k] = sec(b0, b1); ci[k] = sec(b1, b2);
    }
    if (r1 != m || r2 != m) { printf("결과 불일치\n"); return 1; }
    printf("  재귀        : %7.4f 초 (깊이 %d 를 견뎠다)\n",
           median3(cr[0], cr[1], cr[2]), m);
    printf("  명시적 스택 : %7.4f 초\n", median3(ci[0], ci[1], ci[2]));
    return 0;
}
