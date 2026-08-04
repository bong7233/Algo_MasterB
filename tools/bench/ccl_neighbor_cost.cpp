/* 4-이웃과 8-이웃 라벨링의 실제 비용 차이 — C++ 쪽 (IV-5).
 *
 * 측정 환경은 CLAUDE.md §1-3 고정: Ubuntu 24.04 / g++ 13.3.0 / -std=c++17 -O2.
 * 파이썬판(ccl_neighbor_cost.py)과 같은 격자·같은 알고리즘이다.
 *
 * 빌드·실행:
 *   g++ -std=c++17 -O2 tools/bench/ccl_neighbor_cost.cpp -o /tmp/cclbench && /tmp/cclbench
 */
#include <chrono>
#include <cstdio>
#include <queue>
#include <vector>
using namespace std;

const vector<pair<int, int>> D4 = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
const vector<pair<int, int>> D8 = {{-1, 0}, {1, 0},  {0, -1}, {0, 1},
                                   {-1, -1}, {-1, 1}, {1, -1}, {1, 1}};

const int H = 1200, W = 1200;

int label(const vector<vector<int>>& grid, const vector<pair<int, int>>& delta, size_t& peak) {
    int h = (int)grid.size(), w = (int)grid[0].size();
    vector<vector<int>> lab(h, vector<int>(w, 0));
    int count = 0;
    peak = 0;
    for (int sr = 0; sr < h; sr++)
        for (int sc = 0; sc < w; sc++) {
            if (grid[sr][sc] == 0 || lab[sr][sc] != 0) continue;
            count += 1;
            lab[sr][sc] = count;
            queue<pair<int, int>> q;
            q.push({sr, sc});
            while (!q.empty()) {
                if (q.size() > peak) peak = q.size();
                auto [r, c] = q.front();
                q.pop();
                for (auto [dr, dc] : delta) {
                    int nr = r + dr, nc = c + dc;
                    if (0 <= nr && nr < h && 0 <= nc && nc < w)
                        if (grid[nr][nc] == 1 && lab[nr][nc] == 0) {
                            lab[nr][nc] = count;
                            q.push({nr, nc});
                        }
                }
            }
        }
    return count;
}

int main() {
    vector<vector<int>> grid(H, vector<int>(W, 1));
    printf("%dx%d 격자 = %d 칸, 전부 1 (연결 요소 1개)\n", H, W, H * W);
    const char* names[2] = {"4-이웃", "8-이웃"};
    const vector<pair<int, int>>* ds[2] = {&D4, &D8};
    for (int k = 0; k < 2; k++) {
        double best = 1e9;
        int count = 0;
        size_t peak = 0;
        for (int rep = 0; rep < 3; rep++) {
            auto t0 = chrono::steady_clock::now();
            count = label(grid, *ds[k], peak);
            double dt = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
            if (dt < best) best = dt;
        }
        printf("  %s: %.3f초  덩어리 %d개  큐 최대 길이 %zu\n", names[k], best, count, peak);
    }
    return 0;
}
