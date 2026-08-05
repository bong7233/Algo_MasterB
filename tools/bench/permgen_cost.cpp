// III-2 — 순열 생성 비용 (C++). permgen_cost.py 의 대응판.
//
//   lib  : std::next_permutation 로 사전순으로 훑기
//   swap : 자리 교환 재귀
//
// 같은 n! 개를 만들고 첫 원소를 더한다. 체크섬이 두 방법에서 같아야 같은 것을 만든 것이다.
//
// 빌드·실행: g++ -std=c++17 -O2 tools/bench/permgen_cost.cpp -o /tmp/pg && /tmp/pg [n]
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <numeric>
#include <vector>
using namespace std;

static long long total = 0;

void go(vector<int>& a, int k) {
    int n = (int)a.size();
    if (k == n) { total += a[0]; return; }
    for (int i = k; i < n; i++) {
        swap(a[k], a[i]);
        go(a, k + 1);
        swap(a[k], a[i]);
    }
}

double timeit_lib(int n, long long& checksum) {
    vector<int> a(n);
    iota(a.begin(), a.end(), 1);
    long long s = 0;
    auto t0 = chrono::steady_clock::now();
    do { s += a[0]; } while (next_permutation(a.begin(), a.end()));
    auto t1 = chrono::steady_clock::now();
    checksum = s;
    return chrono::duration<double>(t1 - t0).count();
}

double timeit_swap(int n, long long& checksum) {
    vector<int> a(n);
    iota(a.begin(), a.end(), 1);
    total = 0;
    auto t0 = chrono::steady_clock::now();
    go(a, 0);
    auto t1 = chrono::steady_clock::now();
    checksum = total;
    return chrono::duration<double>(t1 - t0).count();
}

int main(int argc, char** argv) {
    int n = argc > 1 ? atoi(argv[1]) : 9;
    long long c1 = 0, c2 = 0;
    printf("n = %d\n", n);
    // 인자 평가 순서는 미지정이다. c1 을 인자 안에서 읽으면 갱신 전 값이 찍힐 수 있다.
    double t1 = timeit_lib(n, c1);
    printf("lib   %8.4f초   체크섬 %lld\n", t1, c1);
    double t2 = timeit_swap(n, c2);
    printf("swap  %8.4f초   체크섬 %lld\n", t2, c2);
    printf("\nn 하나 늘 때 걸리는 시간 (next_permutation 기준)\n");
    for (int k = 8; k <= 12; k++) {
        long long c = 0;
        double dt = timeit_lib(k, c);
        printf("  n = %2d  %8.4f초\n", k, dt);
    }
    return 0;
}
