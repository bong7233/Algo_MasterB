// 밀집 그래프에서 비트 행렬이 인접 리스트를 이기는 지점 — XI-10 §2.4 의 수치.
//
// 같은 계산(모든 정점 쌍의 공통 이웃 수 합)을 두 표현으로 한다.
//   (1) 정렬된 인접 리스트 교집합 — 원소를 하나씩 비교한다
//   (2) 비트 행렬 AND + popcount  — 64개를 한 번에 처리한다
//
// 빌드: g++ -std=c++17 -O2 tools/bench/bitset_matrix.cpp -o /tmp/bm && /tmp/bm

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;

const int N = 1000;
const int WORDS = (N + 63) / 64;

int main() {
    for (int pct : {5, 30}) {
        mt19937 rng(20260805);
        vector<vector<uint64_t>> bits(N, vector<uint64_t>(WORDS, 0));
        vector<vector<int>> adj(N);
        long long E = 0;
        for (int u = 0; u < N; u++)
            for (int v = u + 1; v < N; v++)
                if ((int)(rng() % 100) < pct) {
                    bits[u][v >> 6] |= 1ULL << (v & 63);
                    bits[v][u >> 6] |= 1ULL << (u & 63);
                    adj[u].push_back(v);
                    adj[v].push_back(u);
                    E++;
                }
        for (auto& r : adj) sort(r.begin(), r.end());

        vector<double> tl, tb;
        long long cl = 0, cb = 0;
        for (int rep = 0; rep < 5; rep++) {
            auto t0 = chrono::steady_clock::now();
            cl = 0;
            for (int u = 0; u < N; u++)
                for (int v = u + 1; v < N; v++) {
                    size_t i = 0, j = 0;
                    while (i < adj[u].size() && j < adj[v].size()) {
                        if (adj[u][i] == adj[v][j]) { cl++; i++; j++; }
                        else if (adj[u][i] < adj[v][j]) i++;
                        else j++;
                    }
                }
            auto t1 = chrono::steady_clock::now();
            cb = 0;
            for (int u = 0; u < N; u++)
                for (int v = u + 1; v < N; v++) {
                    int c = 0;
                    for (int w = 0; w < WORDS; w++)
                        c += __builtin_popcountll(bits[u][w] & bits[v][w]);
                    cb += c;
                }
            auto t2 = chrono::steady_clock::now();
            tl.push_back(chrono::duration<double, milli>(t1 - t0).count());
            tb.push_back(chrono::duration<double, milli>(t2 - t1).count());
        }
        sort(tl.begin(), tl.end());
        sort(tb.begin(), tb.end());
        printf("밀도 %2d%% · 간선 %lld · 평균 차수 %lld · 답 일치 %s\n",
               pct, E, 2 * E / N, cl == cb ? "예" : "아니오");
        printf("  인접 리스트 교집합 %8.0f ms  (%.0f ~ %.0f)\n", tl[2], tl.front(), tl.back());
        printf("  비트 행렬 AND      %8.0f ms  (%.0f ~ %.0f)\n", tb[2], tb.front(), tb.back());
        printf("  메모리: 리스트 %lld KB · 비트 행렬 %d KB\n\n",
               (2 * E * 4 + (long long)N * 24) / 1024, N * N / 8 / 1024);
    }
    return 0;
}
