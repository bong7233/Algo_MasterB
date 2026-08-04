// III-5 — 상태를 되돌리는 두 방법의 비용 (C++). snapshot_cost.py 의 대응판.
//
//   copy : vector<vector<int>> 를 통째로 복사해 두고 복사본으로 되돌린다  O(H·W)
//   undo : 바꾼 칸만 (r, c, 이전값) 으로 기록하고 역순으로 되돌린다        O(K)
//
// 빌드·실행: g++ -std=c++17 -O2 tools/bench/snapshot_cost.cpp -o /tmp/sc && /tmp/sc [H W moves]
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <tuple>
#include <vector>
using namespace std;

const int TOUCH = 4;

vector<vector<int>> make_grid(int h, int w) {
    vector<vector<int>> g(h, vector<int>(w));
    for (int r = 0; r < h; r++)
        for (int c = 0; c < w; c++) g[r][c] = (r * w + c) % 10;
    return g;
}

long long by_copy(int h, int w, int moves) {
    auto grid = make_grid(h, w);
    long long acc = 0;
    for (int step = 0; step < moves; step++) {
        auto saved = grid;                       // 전체 복사
        for (int i = 0; i < TOUCH; i++) {
            int r = (step * 7 + i * 13) % h, c = (step * 11 + i * 5) % w;
            grid[r][c] += 1;
            acc += grid[r][c];
        }
        grid = saved;
    }
    return acc;
}

long long by_undo(int h, int w, int moves) {
    auto grid = make_grid(h, w);
    long long acc = 0;
    vector<tuple<int, int, int>> log;
    for (int step = 0; step < moves; step++) {
        log.clear();
        for (int i = 0; i < TOUCH; i++) {
            int r = (step * 7 + i * 13) % h, c = (step * 11 + i * 5) % w;
            log.emplace_back(r, c, grid[r][c]);  // 바꾸기 전 값만 남긴다
            grid[r][c] += 1;
            acc += grid[r][c];
        }
        for (int i = (int)log.size() - 1; i >= 0; i--) {
            auto [r, c, old] = log[i];
            grid[r][c] = old;                    // 역순 복원
        }
    }
    return acc;
}

int main(int argc, char** argv) {
    int h = argc > 1 ? atoi(argv[1]) : 20;
    int w = argc > 2 ? atoi(argv[2]) : 20;
    int moves = argc > 3 ? atoi(argv[3]) : 50000;
    printf("격자 %d×%d = %d칸, 수 %d회, 한 수가 건드리는 칸 %d개\n", h, w, h * w, moves, TOUCH);

    auto t0 = chrono::steady_clock::now();
    long long a = by_copy(h, w, moves);
    auto t1 = chrono::steady_clock::now();
    long long b = by_undo(h, w, moves);
    auto t2 = chrono::steady_clock::now();
    double tc = chrono::duration<double>(t1 - t0).count();
    double tu = chrono::duration<double>(t2 - t1).count();
    printf("  copy %8.4f초   체크섬 %lld\n", tc, a);
    printf("  undo %8.4f초   체크섬 %lld\n", tu, b);
    printf("\n  undo 를 1 로 두면 copy %.0f배\n", tc / tu);
    return 0;
}
