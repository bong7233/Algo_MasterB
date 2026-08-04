// II-9 본문 수치 — 정렬 상태를 유지하며 삽입할 때의 비용, 그리고 BST 편향의 대가.
//
// 측정 1  삽입 n 번 + "x 이상인 가장 작은 키" 질의 n 번
//           (a) 정렬 vector  : 질의는 이분 탐색이지만 삽입이 memmove
//           (b) std::set     : 레드-블랙 트리. 둘 다 O(log n)
// 측정 2  균형 없는 BST 의 편향: 같은 개수를 무작위 순서로 넣을 때와
//         오름차순으로 넣을 때의 비교 횟수·시간
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/ordered_insert_cost.cpp -o /tmp/ordered_insert_cost
//   /tmp/ordered_insert_cost

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <numeric>
#include <random>
#include <set>
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

// 균형을 잡지 않는 이진 탐색 트리. 배열에 노드를 담아 할당 비용을 줄인다 —
// 편향의 대가를 재는 것이 목적이므로 할당기 잡음을 빼고 본다.
struct BST {
    vector<int> key, left, right;
    long long comparisons = 0;

    explicit BST(int cap) { key.reserve(cap); left.reserve(cap); right.reserve(cap); }

    void insert(int v) {
        if (key.empty()) { key.push_back(v); left.push_back(-1); right.push_back(-1); return; }
        int cur = 0;
        while (true) {
            comparisons++;
            if (v < key[cur]) {
                if (left[cur] == -1) { left[cur] = (int)key.size(); break; }
                cur = left[cur];
            } else {
                if (right[cur] == -1) { right[cur] = (int)key.size(); break; }
                cur = right[cur];
            }
        }
        key.push_back(v); left.push_back(-1); right.push_back(-1);
    }
};

int main() {
    mt19937 rng(20240817);

    const int n = 200000;
    vector<int> ins(n), qry(n);
    uniform_int_distribution<int> dist(0, 1000000000);
    for (int i = 0; i < n; i++) ins[i] = dist(rng);
    for (int i = 0; i < n; i++) qry[i] = dist(rng);

    printf("== 측정 1: 삽입 %d회 + \"x 이상인 가장 작은 키\" 질의 %d회 ==\n", n, n);
    double tv[3], tsv[3];
    long long sum_v = 0, sum_s = 0;
    for (int k = 0; k < 3; k++) {
        auto a0 = Clock::now();
        {
            vector<int> a;
            a.reserve(n);
            sum_v = 0;
            for (int i = 0; i < n; i++) {
                auto it = lower_bound(a.begin(), a.end(), ins[i]);
                a.insert(it, ins[i]);                       // 뒤쪽 전부를 밀어낸다
                auto q = lower_bound(a.begin(), a.end(), qry[i]);
                if (q != a.end()) sum_v += *q;
            }
        }
        auto a1 = Clock::now();
        {
            set<int> s;
            sum_s = 0;
            for (int i = 0; i < n; i++) {
                s.insert(ins[i]);
                auto q = s.lower_bound(qry[i]);             // 멤버 함수라야 O(log n)
                if (q != s.end()) sum_s += *q;
            }
        }
        auto a2 = Clock::now();
        tv[k] = sec(a0, a1);
        tsv[k] = sec(a1, a2);
    }
    if (sum_v != sum_s) { printf("결과 불일치\n"); return 1; }
    double t_vec = median3(tv[0], tv[1], tv[2]);
    double t_set = median3(tsv[0], tsv[1], tsv[2]);
    printf("  정렬 vector : %7.3f 초  (%.2f 배)\n", t_vec, t_vec / t_set);
    printf("  std::set    : %7.3f 초  (1.00 배)\n", t_set);

    printf("\n== 측정 2: 균형 없는 BST 삽입 %d개 ==\n", n);
    vector<int> shuffled(n);
    iota(shuffled.begin(), shuffled.end(), 1);
    vector<int> sorted_in = shuffled;
    shuffle(shuffled.begin(), shuffled.end(), rng);

    double tr[3], to[3];
    long long c_rand = 0, c_sorted = 0;
    for (int k = 0; k < 3; k++) {
        auto b0 = Clock::now();
        BST t1(n);
        for (int v : shuffled) t1.insert(v);
        auto b1 = Clock::now();
        BST t2(n);
        for (int v : sorted_in) t2.insert(v);
        auto b2 = Clock::now();
        tr[k] = sec(b0, b1);
        to[k] = sec(b1, b2);
        c_rand = t1.comparisons;
        c_sorted = t2.comparisons;
    }
    double t_rand = median3(tr[0], tr[1], tr[2]);
    double t_sorted = median3(to[0], to[1], to[2]);
    printf("  무작위 순서 : %8.4f 초, 비교 %lld 회 (삽입당 %.1f)\n",
           t_rand, c_rand, (double)c_rand / n);
    printf("  오름차순    : %8.4f 초, 비교 %lld 회 (삽입당 %.1f)\n",
           t_sorted, c_sorted, (double)c_sorted / n);
    printf("  비율        : 시간 %.1f 배, 비교 %.1f 배\n",
           t_sorted / t_rand, (double)c_sorted / (double)c_rand);

    // 같은 오름차순 입력을 std::set 에 넣으면 어떻게 되는가.
    double ts2[3];
    for (int k = 0; k < 3; k++) {
        auto c0 = Clock::now();
        set<int> s(sorted_in.begin(), sorted_in.end());
        auto c1 = Clock::now();
        ts2[k] = sec(c0, c1);
        if (s.size() != (size_t)n) return 1;
    }
    printf("  std::set 에 같은 오름차순 입력: %8.4f 초 (균형 트리라 높이가 안 자란다)\n",
           median3(ts2[0], ts2[1], ts2[2]));
    return 0;
}
