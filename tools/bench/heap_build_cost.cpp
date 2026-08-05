// II-8 본문 수치 — 힙이 없을 때의 비용, heapify 의 이득, 그리고 교환 횟수 (C++ 쪽).
//
// 측정 1  스케줄러 루프: 매 스텝 정렬 / 선형 최솟값 스캔 / 힙
// 측정 2  빌드 비용: push n 번 vs heapify 한 번
// 측정 3  교환 횟수: 두 빌드 방식이 실제로 몇 번 교환하는가.
//         시간은 기기와 캐시에 흔들리지만 교환 횟수는 입력이 같으면 결정적이다.
//         O(n) 대 O(n log n) 의 근거를 시간이 아니라 이 수로 보인다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/heap_build_cost.cpp -o /tmp/heap_build_cost
//   /tmp/heap_build_cost

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <queue>
#include <random>
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

// ---------------------------------------------------------------- 측정 1

static long long loop_sort(vector<int> a, const vector<int>& incoming) {
    long long total = 0;
    for (int x : incoming) {
        sort(a.begin(), a.end());
        total += a[0];
        a[0] = x;
    }
    return total;
}

static long long loop_scan(vector<int> a, const vector<int>& incoming) {
    long long total = 0;
    for (int x : incoming) {
        size_t k = 0;
        for (size_t i = 1; i < a.size(); i++)
            if (a[i] < a[k]) k = i;
        total += a[k];
        a[k] = x;
    }
    return total;
}

static long long loop_heap(vector<int> a, const vector<int>& incoming) {
    priority_queue<int, vector<int>, greater<int>> pq(a.begin(), a.end());
    long long total = 0;
    for (int x : incoming) {
        total += pq.top();
        pq.pop();
        pq.push(x);
    }
    return total;
}

// ---------------------------------------------------------------- 측정 2·3
//
// 교환 횟수를 세려면 표준 컨테이너로는 안 된다. 본문 ::: dual 과 같은 알고리즘을
// 여기서 직접 짜고 카운터만 붙인다.

static long long swaps = 0;

static void sift_up(vector<int>& h, int i) {
    while (i > 0) {
        int p = (i - 1) / 2;
        if (h[i] >= h[p]) break;
        swap(h[i], h[p]);
        swaps++;
        i = p;
    }
}

static void sift_down(vector<int>& h, int i, int n) {
    while (true) {
        int l = 2 * i + 1, r = 2 * i + 2, best = i;
        if (l < n && h[l] < h[best]) best = l;
        if (r < n && h[r] < h[best]) best = r;
        if (best == i) break;
        swap(h[i], h[best]);
        swaps++;
        i = best;
    }
}

int main() {
    mt19937 rng(20240817);
    uniform_int_distribution<int> dist(0, 1000000000);

    const int n = 20000;
    vector<int> tasks(n), incoming(n);
    for (int i = 0; i < n; i++) tasks[i] = dist(rng);
    for (int i = 0; i < n; i++) incoming[i] = dist(rng);

    printf("== 측정 1: 스케줄러 루프 (작업 %d개, 꺼내고 넣기 %d회) ==\n", n, n);
    double ts[3], tc[3], th[3];
    long long r1 = 0, r2 = 0, r3 = 0;
    for (int k = 0; k < 3; k++) {
        auto a0 = Clock::now(); r1 = loop_sort(tasks, incoming); auto a1 = Clock::now();
        r2 = loop_scan(tasks, incoming); auto a2 = Clock::now();
        r3 = loop_heap(tasks, incoming); auto a3 = Clock::now();
        ts[k] = sec(a0, a1); tc[k] = sec(a1, a2); th[k] = sec(a2, a3);
    }
    if (!(r1 == r2 && r2 == r3)) { printf("결과 불일치\n"); return 1; }
    double t_sort = median3(ts[0], ts[1], ts[2]);
    double t_scan = median3(tc[0], tc[1], tc[2]);
    double t_heap = median3(th[0], th[1], th[2]);
    printf("  매 스텝 정렬     %8.3f 초   (%6.1f 배)\n", t_sort, t_sort / t_heap);
    printf("  선형 최솟값 스캔 %8.3f 초   (%6.1f 배)\n", t_scan, t_scan / t_heap);
    printf("  힙(priority_queue) %6.3f 초   (   1.0 배)\n", t_heap);

    const int m = 1000000;
    vector<int> data(m);
    for (int i = 0; i < m; i++) data[i] = dist(rng);

    printf("\n== 측정 2: 힙 빌드 (%d개) ==\n", m);
    double tp[3], tf[3];
    for (int k = 0; k < 3; k++) {
        auto b0 = Clock::now();
        vector<int> h1;
        h1.reserve(m);
        for (int x : data) { h1.push_back(x); sift_up(h1, (int)h1.size() - 1); }
        auto b1 = Clock::now();
        vector<int> h2 = data;
        for (int i = m / 2 - 1; i >= 0; i--) sift_down(h2, i, m);
        auto b2 = Clock::now();
        tp[k] = sec(b0, b1); tf[k] = sec(b1, b2);
        if (h1[0] != h2[0]) { printf("루트 불일치\n"); return 1; }
    }
    double t_push = median3(tp[0], tp[1], tp[2]);
    double t_heapify = median3(tf[0], tf[1], tf[2]);
    printf("  push %d회       %8.3f 초   (%6.2f 배)\n", m, t_push, t_push / t_heapify);
    printf("  heapify 한 번    %8.3f 초   (   1.00 배)\n", t_heapify);

    printf("\n== 측정 3: 교환 횟수 (%d개, 같은 입력) ==\n", m);
    swaps = 0;
    {
        vector<int> h;
        h.reserve(m);
        for (int x : data) { h.push_back(x); sift_up(h, (int)h.size() - 1); }
    }
    long long s_push = swaps;
    swaps = 0;
    {
        vector<int> h = data;
        for (int i = m / 2 - 1; i >= 0; i--) sift_down(h, i, m);
    }
    long long s_heapify = swaps;
    printf("  push 반복 : %lld 회  (원소당 %.2f)\n", s_push, (double)s_push / m);
    printf("  heapify   : %lld 회  (원소당 %.2f)\n", s_heapify, (double)s_heapify / m);
    printf("  비율      : %.2f 배\n", (double)s_push / (double)s_heapify);

    // 측정 4: 최악 입력. 최소 힙에 내림차순으로 넣으면 새 원소가 매번 루트까지
    // 올라간다. 무작위 입력에서 push 가 싸 보이는 것은 평균의 이야기이지
    // 복잡도의 이야기가 아니라는 것을 여기서 가른다.
    printf("\n== 측정 4: 최악 입력(내림차순) 교환 횟수 (%d개) ==\n", m);
    vector<int> desc(m);
    for (int i = 0; i < m; i++) desc[i] = m - i;
    swaps = 0;
    {
        vector<int> h;
        h.reserve(m);
        for (int x : desc) { h.push_back(x); sift_up(h, (int)h.size() - 1); }
    }
    long long w_push = swaps;
    swaps = 0;
    {
        vector<int> h = desc;
        for (int i = m / 2 - 1; i >= 0; i--) sift_down(h, i, m);
    }
    long long w_heapify = swaps;
    printf("  push 반복 : %lld 회  (원소당 %.2f)\n", w_push, (double)w_push / m);
    printf("  heapify   : %lld 회  (원소당 %.2f)\n", w_heapify, (double)w_heapify / m);
    printf("  비율      : %.2f 배\n", (double)w_push / (double)w_heapify);
    return 0;
}
