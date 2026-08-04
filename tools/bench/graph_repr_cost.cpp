// 인접 행렬 vs 인접 리스트의 실제 비용 (C++) — IV-1 본문 수치.
//
// Python 판(graph_repr_cost.py)과 같은 그래프·같은 연산을 잰다.
// 두 언어를 나란히 놓는 이유: 표현 선택의 결론(순회는 리스트, 질의는 행렬)이
// 언어와 무관하다는 것을 보이기 위해서다. 배수만 달라지고 방향은 같다.
//
// 빌드: g++ -std=c++17 -O2 -o /tmp/graph_repr tools/bench/graph_repr_cost.cpp
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <random>
#include <set>
#include <vector>
using namespace std;
using namespace std::chrono;

const int V = 2000;
const int E = 10000;
const int QUERIES = 100000;
const int REPEAT = 3;

template <typename F>
double bench(F f) {
    vector<double> ts;
    for (int i = 0; i < REPEAT; i++) {
        auto t0 = steady_clock::now();
        f();
        ts.push_back(duration<double>(steady_clock::now() - t0).count());
    }
    sort(ts.begin(), ts.end());
    return ts[REPEAT / 2];
}

int main() {
    mt19937 rng(42);
    set<pair<int, int>> es;
    while ((int)es.size() < E) {
        int u = rng() % V, v = rng() % V;
        if (u == v) continue;
        es.insert({min(u, v), max(u, v)});
    }

    vector<vector<uint8_t>> mat(V, vector<uint8_t>(V, 0));
    vector<vector<int>> adj(V);
    for (auto [u, v] : es) {
        mat[u][v] = mat[v][u] = 1;
        adj[u].push_back(v);
        adj[v].push_back(u);
    }

    // 실제 점유 바이트. vector 헤더(24B)까지 세야 "리스트가 작다" 는 주장이 정직해진다.
    size_t mat_bytes = sizeof(mat) + V * sizeof(vector<uint8_t>) + (size_t)V * V;
    size_t adj_bytes = sizeof(adj) + V * sizeof(vector<int>);
    for (int u = 0; u < V; u++) adj_bytes += adj[u].capacity() * sizeof(int);

    long long sink = 0;
    double t_scan_mat = bench([&] {
        long long s = 0;
        for (int u = 0; u < V; u++)
            for (int v = 0; v < V; v++)
                if (mat[u][v]) s += v;
        sink += s;
    });
    double t_scan_adj = bench([&] {
        long long s = 0;
        for (int u = 0; u < V; u++)
            for (int v : adj[u]) s += v;
        sink += s;
    });

    mt19937 qrng(7);
    vector<pair<int, int>> qs(QUERIES);
    for (auto &q : qs) q = {(int)(qrng() % V), (int)(qrng() % V)};

    double t_q_mat = bench([&] {
        int c = 0;
        for (auto [u, v] : qs)
            if (mat[u][v]) c++;
        sink += c;
    });
    double t_q_adj = bench([&] {
        int c = 0;
        for (auto [u, v] : qs)
            if (find(adj[u].begin(), adj[u].end(), v) != adj[u].end()) c++;
        sink += c;
    });

    cout << "V=" << V << " E=" << E << "\n";
    cout << "인접 행렬 메모리 : " << mat_bytes << " B (" << mat_bytes / 1e6 << " MB)\n";
    cout << "인접 리스트 메모리: " << adj_bytes << " B (" << adj_bytes / 1e6 << " MB)\n";
    cout << "  배수: " << (double)mat_bytes / adj_bytes << "\n\n";
    cout << "전체 이웃 순회  행렬: " << t_scan_mat * 1000 << " ms   리스트: "
         << t_scan_adj * 1000 << " ms   (" << t_scan_mat / t_scan_adj << "배)\n";
    cout << "간선 질의 10만  행렬: " << t_q_mat * 1000 << " ms   리스트: "
         << t_q_adj * 1000 << " ms   (" << t_q_adj / t_q_mat << "배)\n";
    if (sink == -1) cout << "";   // 최적화로 루프가 통째로 사라지는 것을 막는다
    return 0;
}
