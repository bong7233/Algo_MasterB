// II-1 §5 — 같은 원소를 같은 횟수만큼 더하는데 순서만 바꾼다.
//
//   g++ -std=c++17 -O2 tools/bench/ii1_row_major.cpp -o /tmp/rm && /tmp/rm 4000
//
// 행 우선(row-major) 순회는 메모리를 앞에서 뒤로 훑는다. 캐시 라인 하나(64바이트)에
// int 16개가 실려 오므로 16번에 한 번만 메모리를 기다린다.
// 열 우선(column-major) 순회는 매번 한 행(= n*4 바이트)을 건너뛴다. 캐시 라인이
// 재사용되지 않고 TLB 도 매번 다른 페이지를 짚는다.
//
// 복잡도는 둘 다 O(n^2) 이고 명령어 수도 같다. 갈리는 것은 접근 순서뿐이다.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace std;

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 4000;
    // 2차원처럼 쓰지만 실제로는 1차원 연속 메모리다. a[r][c] = flat[r * n + c].
    vector<int> flat((size_t)n * n, 1);

    auto t0 = chrono::steady_clock::now();
    long long s1 = 0;
    for (int r = 0; r < n; ++r)
        for (int c = 0; c < n; ++c) s1 += flat[(size_t)r * n + c];
    auto t1 = chrono::steady_clock::now();

    long long s2 = 0;
    for (int c = 0; c < n; ++c)
        for (int r = 0; r < n; ++r) s2 += flat[(size_t)r * n + c];
    auto t2 = chrono::steady_clock::now();

    double row = chrono::duration<double>(t1 - t0).count();
    double col = chrono::duration<double>(t2 - t1).count();
    printf("n=%d (원소 %lld개, 합 %lld/%lld)\n", n, (long long)n * n, s1, s2);
    printf("행 우선  %.4f s\n", row);
    printf("열 우선  %.4f s  (%.1f배)\n", col, col / row);
    return 0;
}
