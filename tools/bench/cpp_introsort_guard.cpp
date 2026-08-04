// 0-7 §introsort — 깊이 가드가 없는 퀵소트가 무엇에 무너지는지, std::sort 는 왜 안 무너지는지.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_introsort_guard.cpp -o /tmp/ig
//   /tmp/ig count            # 이미 정렬된 입력에서 비교 횟수가 어떻게 자라는가
//   /tmp/ig crash 100000     # 깊이 가드 없는 퀵소트를 정렬된 입력에 먹인다
//   /tmp/ig std              # 같은 입력을 std::sort 로
//
// crash 모드는 스택을 다 쓰고 죽을 수 있다. 죽는 것이 이 실험의 결과다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <numeric>
#include <vector>
using namespace std;

long long cmp_naive = 0, cmp_std = 0;
int max_depth = 0;

// 교과서 퀵소트: 피벗은 마지막 원소, 가드 없음.
void naive_qsort(vector<int>& a, int lo, int hi, int depth) {
    if (depth > max_depth) max_depth = depth;
    if (lo >= hi) return;
    int pivot = a[hi], i = lo;
    for (int j = lo; j < hi; ++j) {
        ++cmp_naive;
        if (a[j] < pivot) swap(a[i++], a[j]);
    }
    swap(a[i], a[hi]);
    naive_qsort(a, lo, i - 1, depth + 1);
    naive_qsort(a, i + 1, hi, depth + 1);
}

int main(int argc, char** argv) {
    const char* mode = (argc > 1) ? argv[1] : "count";

    if (!strcmp(mode, "count")) {
        printf("%8s %16s %16s %10s\n", "n", "순진한 퀵소트", "std::sort", "최대 깊이");
        for (int n : {1000, 2000, 4000, 8000}) {
            vector<int> a(n);
            iota(a.begin(), a.end(), 0);  // 이미 정렬된 입력
            cmp_naive = 0;
            max_depth = 0;
            naive_qsort(a, 0, n - 1, 1);
            long long naive = cmp_naive;
            int depth = max_depth;

            vector<int> b(n);
            iota(b.begin(), b.end(), 0);
            cmp_std = 0;
            sort(b.begin(), b.end(), [](int x, int y) { ++cmp_std; return x < y; });
            printf("%8d %16lld %16lld %10d\n", n, naive, cmp_std, depth);
        }
    } else if (!strcmp(mode, "std")) {
        // 같은 입력을 std::sort 에 먹여 시간을 잰다(§1 표의 오른쪽 열).
        for (int n : {100000, 200000}) {
            vector<int> a(n);
            iota(a.begin(), a.end(), 0);
            auto t0 = chrono::steady_clock::now();
            sort(a.begin(), a.end());
            double sec = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
            printf("std::sort 정렬된 입력 n=%d: %.4f s\n", n, sec);
        }
    } else {
        int n = (argc > 2) ? atoi(argv[2]) : 100000;
        vector<int> a(n);
        iota(a.begin(), a.end(), 0);
        printf("순진한 퀵소트에 정렬된 입력 n=%d 을 먹인다\n", n);
        fflush(stdout);
        naive_qsort(a, 0, n - 1, 1);
        printf("살아남았다. 비교 %lld회, 최대 깊이 %d\n", cmp_naive, max_depth);
    }
    return 0;
}
