// III-6 — 불변식 검사 비용 (C++). invariant_cost.py 의 대응판.
//
// -DNDEBUG 를 주면 assert 가 전처리 단계에서 사라진다. 같은 소스를 두 번 컴파일해 비교한다.
//
//   g++ -std=c++17 -O2          tools/bench/invariant_cost.cpp -o /tmp/inv_on
//   g++ -std=c++17 -O2 -DNDEBUG tools/bench/invariant_cost.cpp -o /tmp/inv_off
//   /tmp/inv_on && /tmp/inv_off
#include <cassert>
#include <chrono>
#include <cstdio>
using namespace std;

const int H = 50, W = 50;
const long long STEPS = 100000000;   // 파이썬 판보다 100배. C++ 는 이 정도 돌려야 시간이 보인다
const int DR[4] = {-1, 0, 1, 0};
const int DC[4] = {0, 1, 0, -1};

int main() {
    int r = 0, c = 0, alive = 7;
    auto t0 = chrono::steady_clock::now();
    for (long long step = 0; step < STEPS; step++) {
        int d = (int)(step & 3);
        int nr = r + DR[d], nc = c + DC[d];
        if (0 <= nr && nr < H && 0 <= nc && nc < W) { r = nr; c = nc; }
        assert(0 <= r && r < H && 0 <= c && c < W);
        assert(alive == 7);
    }
    auto t1 = chrono::steady_clock::now();
#ifdef NDEBUG
    const char* mode = "assert 끔 (-DNDEBUG)";
#else
    const char* mode = "assert 켬";
#endif
    printf("%-22s %8.4f초   (체크섬 %d)\n", mode,
           chrono::duration<double>(t1 - t0).count(), r * W + c);
    return 0;
}
