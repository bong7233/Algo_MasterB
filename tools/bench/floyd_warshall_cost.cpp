// 플로이드-워셜의 V^3 — C++ 판 (V-3 §4). Python 판은 floyd_warshall_cost.py.
// 같은 세 줄이 언어에 따라 어디까지 n 을 허용하는지 본다.
// 빌드: g++ -std=c++17 -O2 floyd_warshall_cost.cpp -o /tmp/fwc
#include <chrono>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;

const int INF = 1e9;

int main() {
    printf("%5s %14s %14s\n", "n", "n^3", "C++ (ms)");
    for (int n : {100, 200, 400, 800}) {
        mt19937 rng(5);
        vector<vector<int>> d(n, vector<int>(n, INF));
        for (int i = 0; i < n; i++) d[i][i] = 0;
        for (int t = 0; t < n * 8; t++) {
            int u = rng() % n, v = rng() % n;
            if (u != v) d[u][v] = min(d[u][v], (int)(rng() % 1000 + 1));
        }
        auto t0 = chrono::steady_clock::now();
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                int aik = d[i][k];
                if (aik == INF) continue;
                for (int j = 0; j < n; j++)
                    if (aik + d[k][j] < d[i][j]) d[i][j] = aik + d[k][j];
            }
        double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - t0).count();
        printf("%5d %14lld %14.0f\n", n, (long long)n * n * n, ms);
    }
    return 0;
}
