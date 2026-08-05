// 인접 리스트(vector<vector<int>>) vs CSR — XI-10 §2·§4 의 수치.
//
// 같은 그래프를 두 표현으로 들고 (1) 만드는 시간 (2) 전체 순회 시간 (3) 상주 메모리를 잰다.
// 시간과 메모리는 서로 다른 실행에서 잰다 — 한 프로세스에서 둘 다 재면 할당자 상태가 섞인다.
//
// 빌드: g++ -std=c++17 -O2 tools/bench/csr_traversal.cpp -o /tmp/csr
// 실행: /tmp/csr time   또는   /tmp/csr mem-adj   또는   /tmp/csr mem-csr

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <unistd.h>
#include <random>
#include <string>
#include <vector>
using namespace std;

const int V = 1000000;
const int E = 10000000;   // 무방향. 인접 자리는 2E = 2천만 개

static long rss_kb() {
    FILE* f = fopen("/proc/self/statm", "r");
    long size = 0, resident = 0;
    if (f) { if (fscanf(f, "%ld %ld", &size, &resident) != 2) resident = 0; fclose(f); }
    return resident * (sysconf(_SC_PAGESIZE) / 1024);
}

static vector<pair<int, int>> make_edges() {
    mt19937 rng(20260805);
    vector<pair<int, int>> es(E);
    for (int i = 0; i < E; i++) {
        int u = (int)(rng() % V), v = (int)(rng() % V);
        es[i] = {u, v};
    }
    return es;
}

static double ms(chrono::steady_clock::time_point a, chrono::steady_clock::time_point b) {
    return chrono::duration<double, milli>(b - a).count();
}

int main(int argc, char** argv) {
    string mode = argc > 1 ? argv[1] : "time";
    long base = rss_kb();
    auto es = make_edges();

    if (mode == "mem-adj") {
        long before = rss_kb();
        vector<vector<int>> adj(V);
        for (auto [u, v] : es) { adj[u].push_back(v); adj[v].push_back(u); }
        printf("인접 리스트 상주 메모리 증가: %ld MB\n", (rss_kb() - before) / 1024);
        printf("  (이론 하한 %ld MB = 안쪽 vector 헤더 24B*V + 원소 4B*2E)\n",
               ((long)V * 24 + (long)2 * E * 4) / 1024 / 1024);
        return 0;
    }
    if (mode == "mem-csr") {
        long before = rss_kb();
        vector<int> start(V + 1, 0), item(2 * E);
        for (auto [u, v] : es) { start[u + 1]++; start[v + 1]++; }
        for (int i = 1; i <= V; i++) start[i] += start[i - 1];
        vector<int> fill(start.begin(), start.end() - 1);
        for (auto [u, v] : es) { item[fill[u]++] = v; item[fill[v]++] = u; }
        printf("CSR 상주 메모리 증가: %ld MB\n", (rss_kb() - before) / 1024);
        printf("  (이론값 %ld MB = start 4B*(V+1) + item 4B*2E, 임시 fill 제외)\n",
               ((long)(V + 1) * 4 + (long)2 * E * 4) / 1024 / 1024);
        return 0;
    }

    printf("정점 %d · 간선 %d(무방향, 인접 자리 %d) · 5회 중앙값과 범위\n", V, E, 2 * E);
    // BFS·DFS 는 정점을 번호 순으로 보지 않는다. 무작위 순서 순회도 함께 잰다.
    vector<int> order(V);
    for (int i = 0; i < V; i++) order[i] = i;
    shuffle(order.begin(), order.end(), mt19937(1234));
    vector<double> ba, bc, ta, tc, ra, rc;
    long long sink = 0;
    for (int rep = 0; rep < 5; rep++) {
        auto t0 = chrono::steady_clock::now();
        vector<vector<int>> adj(V);
        for (auto [u, v] : es) { adj[u].push_back(v); adj[v].push_back(u); }
        auto t1 = chrono::steady_clock::now();

        long long s = 0;
        for (int u = 0; u < V; u++)
            for (int v : adj[u]) s += v;
        auto t2 = chrono::steady_clock::now();
        long long sr = 0;
        for (int i = 0; i < V; i++)
            for (int v : adj[order[i]]) sr += v;
        auto t2r = chrono::steady_clock::now();
        vector<vector<int>>().swap(adj);
        if (sr != s) printf("  !! 순서만 다른데 합이 다르다\n");

        auto t3 = chrono::steady_clock::now();
        vector<int> start(V + 1, 0), item(2 * E);
        for (auto [u, v] : es) { start[u + 1]++; start[v + 1]++; }
        for (int i = 1; i <= V; i++) start[i] += start[i - 1];
        {
            vector<int> fill(start.begin(), start.end() - 1);
            for (auto [u, v] : es) { item[fill[u]++] = v; item[fill[v]++] = u; }
        }
        auto t4 = chrono::steady_clock::now();

        long long s2 = 0;
        for (int u = 0; u < V; u++)
            for (int k = start[u]; k < start[u + 1]; k++) s2 += item[k];
        auto t5 = chrono::steady_clock::now();
        long long s2r = 0;
        for (int i = 0; i < V; i++) {
            int u = order[i];
            for (int k = start[u]; k < start[u + 1]; k++) s2r += item[k];
        }
        auto t5r = chrono::steady_clock::now();
        if (s2r != s2) printf("  !! 순서만 다른데 합이 다르다\n");

        if (s != s2) printf("  !! 두 표현의 합이 다르다: %lld vs %lld\n", s, s2);
        sink += s;
        ba.push_back(ms(t0, t1)); ta.push_back(ms(t1, t2)); ra.push_back(ms(t2, t2r));
        bc.push_back(ms(t3, t4)); tc.push_back(ms(t4, t5)); rc.push_back(ms(t5, t5r));
    }
    auto rep = [](const char* n, vector<double> v) {
        sort(v.begin(), v.end());
        printf("  %-26s %8.0f ms  (%.0f ~ %.0f)\n", n, v[2], v.front(), v.back());
    };
    rep("인접 리스트 구축", ba);
    rep("CSR 구축", bc);
    rep("인접 리스트 순회(번호순)", ta);
    rep("CSR 순회(번호순)", tc);
    rep("인접 리스트 순회(무작위)", ra);
    rep("CSR 순회(무작위)", rc);
    printf("  (합 대조용 %lld, 기준 RSS %ld MB)\n", sink % 7, base / 1024);
    return 0;
}
