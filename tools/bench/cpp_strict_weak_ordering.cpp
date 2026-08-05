// 0-8 §strict weak ordering — `<=` 비교자가 std::sort 를 배열 밖으로 내보내는 것을 재현한다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_strict_weak_ordering.cpp -o /tmp/swo
//   /tmp/swo 100        # 원소 100개
//   /tmp/swo 1000
//   g++ -std=c++17 -O2 -D_GLIBCXX_DEBUG tools/bench/cpp_strict_weak_ordering.cpp -o /tmp/swo_dbg
//   /tmp/swo_dbg 100    # 디버그 모드는 비교자 자체를 검사한다
//
// 이것은 이론이 아니라 재현 가능한 크래시다. 다만 UB 라서 "항상 죽는다"도
// 보장이 아니다. 크기와 값 분포에 따라 조용히 지나갈 수도 있다 — 그 점이
// 더 위험하다는 것이 이 실험의 요점이다.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace std;

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 100;

    // 앞뒤로 여유 공간을 두고 가운데만 정렬한다. 배열 밖으로 나가면 이 여유
    // 공간의 값이 바뀌므로, 죽지 않고 지나가도 침범을 검출할 수 있다.
    const int PAD = 16;
    vector<int> buf(n + 2 * PAD, -777);
    for (int i = 0; i < n; ++i) buf[PAD + i] = 42;  // 전부 같은 값

    printf("n=%d, 전부 같은 값 42. 비교자는 `a <= b` (irreflexive 위반)\n", n);
    fflush(stdout);

    sort(buf.begin() + PAD, buf.begin() + PAD + n, [](int a, int b) { return a <= b; });

    int touched = 0;
    for (int i = 0; i < PAD; ++i) {
        if (buf[i] != -777) ++touched;
        if (buf[PAD + n + i] != -777) ++touched;
    }
    printf("살아남았다. 정렬 구간 밖에서 값이 바뀐 칸: %d개\n", touched);
    return 0;
}
