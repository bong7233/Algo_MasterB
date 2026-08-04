// 덱 하나로 힙을 대신한다 (C++) — IV-4 본문 수치.
//
// zero_one_bfs.py 와 같은 격자·같은 알고리즘. 언어를 바꿔도 결론(덱이 힙보다 싸다)이
// 같은지 확인하는 것이 목적이다. Python 쪽은 인터프리터 상수가 두 알고리즘에
// 똑같이 얹히므로 배수가 눌리고, C++ 쪽은 힙 연산의 log 항이 더 선명하게 남는다.
//
// 빌드: g++ -std=c++17 -O2 -o /tmp/zero_one tools/bench/zero_one_bfs.cpp
#include <algorithm>
#include <chrono>
#include <deque>
#include <iostream>
#include <queue>
#include <random>
#include <vector>
using namespace std;
using namespace std::chrono;

const int N = 700;
const double WALL_RATE = 0.60;
const int REPEAT = 3;
const int INF = 1e9;
const int DR[4] = {-1, 1, 0, 0};
const int DC[4] = {0, 0, -1, 1};

vector<vector<int>> make_grid() {
    mt19937 rng(5);
    uniform_real_distribution<double> u(0.0, 1.0);
    vector<vector<int>> g(N, vector<int>(N, 0));
    for (int r = 0; r < N; r++)
        for (int c = 0; c < N; c++) g[r][c] = u(rng) < WALL_RATE ? 1 : 0;
    g[0][0] = g[N - 1][N - 1] = 0;
    return g;
}

vector<vector<int>> dijkstra(const vector<vector<int>> &g, long long &pushes) {
    vector<vector<int>> dist(N, vector<int>(N, INF));
    dist[0][0] = 0;
    priority_queue<tuple<int, int, int>, vector<tuple<int, int, int>>,
                   greater<tuple<int, int, int>>> pq;
    pq.push({0, 0, 0});
    pushes = 1;
    while (!pq.empty()) {
        auto [d, r, c] = pq.top();
        pq.pop();
        if (d > dist[r][c]) continue;
        for (int k = 0; k < 4; k++) {
            int nr = r + DR[k], nc = c + DC[k];
            if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
            int nd = d + g[nr][nc];
            if (nd < dist[nr][nc]) {
                dist[nr][nc] = nd;
                pq.push({nd, nr, nc});
                pushes++;
            }
        }
    }
    return dist;
}

vector<vector<int>> zero_one_bfs(const vector<vector<int>> &g, long long &pushes) {
    vector<vector<int>> dist(N, vector<int>(N, INF));
    dist[0][0] = 0;
    deque<pair<int, int>> dq;
    dq.push_back({0, 0});
    pushes = 1;
    while (!dq.empty()) {
        auto [r, c] = dq.front();
        dq.pop_front();
        for (int k = 0; k < 4; k++) {
            int nr = r + DR[k], nc = c + DC[k];
            if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
            int nd = dist[r][c] + g[nr][nc];
            if (nd < dist[nr][nc]) {
                dist[nr][nc] = nd;
                if (g[nr][nc] == 0) dq.push_front({nr, nc});   // 비용 0 — 지금 층에 남는다
                else dq.push_back({nr, nc});                   // 비용 1 — 다음 층으로 간다
                pushes++;
            }
        }
    }
    return dist;
}

int main() {
    auto g = make_grid();
    long long p1 = 0, p2 = 0;
    vector<double> t1, t2;
    vector<vector<int>> d1, d2;
    for (int i = 0; i < REPEAT; i++) {
        auto a = steady_clock::now();
        d1 = dijkstra(g, p1);
        t1.push_back(duration<double>(steady_clock::now() - a).count());
        a = steady_clock::now();
        d2 = zero_one_bfs(g, p2);
        t2.push_back(duration<double>(steady_clock::now() - a).count());
    }
    sort(t1.begin(), t1.end());
    sort(t2.begin(), t2.end());
    double a = t1[REPEAT / 2], b = t2[REPEAT / 2];

    cout << N << "x" << N << " 격자, 벽 비율 " << (int)(WALL_RATE * 100) << "%\n";
    cout << "다익스트라(힙) " << a * 1000 << " ms  push " << p1 << "\n";
    cout << "0-1 BFS(덱)    " << b * 1000 << " ms  push " << p2 << "\n";
    cout << "  배수: 시간 " << a / b << "\n";
    cout << "  두 거리 배열이 같은가: " << (d1 == d2 ? "True" : "False") << "\n";
    cout << "  최소 비용: " << d1[N - 1][N - 1] << "\n";
    return 0;
}
