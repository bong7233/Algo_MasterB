// 힙 다익스트라 vs O(V^2) 선형 탐색 다익스트라 — C++ 판 (V-1 §4).
// Python 판(dijkstra_heap_vs_scan.py)에서는 heapq 가 C 구현이고 선형 탐색은
// 파이썬 루프라 밀도와 무관하게 힙이 이긴다. 두 루프가 같은 언어로 도는
// C++ 에서는 밀도에 따라 승패가 실제로 뒤집힌다. 그 지점을 잰다.
// 빌드: g++ -std=c++17 -O2 dijkstra_heap_vs_scan.cpp -o /tmp/dhs
#include <chrono>
#include <cstdio>
#include <queue>
#include <random>
#include <vector>
using namespace std;

const long long INF = (1LL << 60);

vector<vector<pair<int, int>>> gen(int n, long long m, unsigned seed) {
    mt19937 rng(seed);
    vector<vector<pair<int, int>>> adj(n);
    for (int i = 1; i < n; i++) adj[rng() % i].push_back({i, (int)(rng() % 1000 + 1)});
    for (long long k = 0; k < m - (n - 1); k++) {
        int u = rng() % n, v = rng() % n;
        if (u != v) adj[u].push_back({v, (int)(rng() % 1000 + 1)});
    }
    return adj;
}

vector<long long> heapD(int n, const vector<vector<pair<int, int>>>& adj) {
    vector<long long> dist(n, INF);
    priority_queue<pair<long long, int>, vector<pair<long long, int>>, greater<>> pq;
    dist[0] = 0; pq.push({0, 0});
    while (!pq.empty()) {
        auto [d, u] = pq.top(); pq.pop();
        if (d > dist[u]) continue;
        for (auto [v, w] : adj[u]) if (d + w < dist[v]) { dist[v] = d + w; pq.push({dist[v], v}); }
    }
    return dist;
}

vector<long long> scanD(int n, const vector<vector<pair<int, int>>>& adj) {
    vector<long long> dist(n, INF);
    vector<char> done(n, 0);
    dist[0] = 0;
    for (int it = 0; it < n; it++) {
        int u = -1; long long best = INF;
        for (int i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u < 0) break;
        done[u] = 1;
        for (auto [v, w] : adj[u]) if (best + w < dist[v]) dist[v] = best + w;
    }
    return dist;
}

template <class F>
double bench(F f, int n, const vector<vector<pair<int, int>>>& adj, vector<long long>& out) {
    double best = 1e18;
    for (int r = 0; r < 3; r++) {
        auto t0 = chrono::steady_clock::now();
        out = f(n, adj);
        double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - t0).count();
        if (ms < best) best = ms;
    }
    return best;
}

int main() {
    printf("%6s %10s %10s %16s  %s\n", "V", "E", "heap(ms)", "linear scan(ms)", "same");
    long long cases[][2] = {{2000, 4000}, {2000, 40000}, {2000, 400000},
                            {2000, 4000000}, {4000, 8000}, {4000, 16000000}};
    for (auto& c : cases) {
        int n = (int)c[0];
        auto adj = gen(n, c[1], 7);
        long long e = 0; for (auto& a : adj) e += a.size();
        vector<long long> d1, d2;
        double t1 = bench(heapD, n, adj, d1);
        double t2 = bench(scanD, n, adj, d2);
        printf("%6d %10lld %10.1f %16.1f  %s\n", n, e, t1, t2, d1 == d2 ? "yes" : "NO");
    }
    return 0;
}
