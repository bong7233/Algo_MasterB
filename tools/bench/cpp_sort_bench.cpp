// 0-7 §정렬 — sort / stable_sort / partial_sort / nth_element 을 같은 입력에서 잰다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_sort_bench.cpp -o /tmp/sb && /tmp/sb 5000000
//
// 같은 배열의 복사본에 같은 일을 시킨다. 다른 것은 어떤 함수를 부르느냐뿐이다.
// nth_element 가 여기 있는 이유: "K번째만 필요한데 전체를 정렬"하는 코드가 흔하다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <numeric>
#include <random>
#include <vector>
using namespace std;

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 5000000;
    mt19937 rng(42);
    vector<int> base(n);
    iota(base.begin(), base.end(), 0);
    shuffle(base.begin(), base.end(), rng);

    auto run = [&](const char* name, auto&& fn) {
        vector<int> a = base;
        auto t0 = chrono::steady_clock::now();
        fn(a);
        auto t1 = chrono::steady_clock::now();
        double sec = chrono::duration<double>(t1 - t0).count();
        printf("%-28s %.4f s\n", name, sec);
        return sec;
    };

    double t_sort = run("sort", [](vector<int>& a) { sort(a.begin(), a.end()); });
    double t_stable = run("stable_sort", [](vector<int>& a) { stable_sort(a.begin(), a.end()); });
    double t_partial = run("partial_sort (상위 100)", [](vector<int>& a) {
        partial_sort(a.begin(), a.begin() + 100, a.end());
    });
    double t_nth = run("nth_element (중앙값)", [](vector<int>& a) {
        nth_element(a.begin(), a.begin() + a.size() / 2, a.end());
    });

    // 이미 정렬된 입력 / 전부 같은 값 — 순진한 퀵소트가 무너지는 두 입력
    vector<int> sorted_in(n);
    iota(sorted_in.begin(), sorted_in.end(), 0);
    {
        vector<int> a = sorted_in;
        auto t0 = chrono::steady_clock::now();
        sort(a.begin(), a.end());
        printf("%-28s %.4f s\n", "sort (이미 정렬된 입력)",
               chrono::duration<double>(chrono::steady_clock::now() - t0).count());
    }
    {
        vector<int> a(n, 7);
        auto t0 = chrono::steady_clock::now();
        sort(a.begin(), a.end());
        printf("%-28s %.4f s\n", "sort (전부 같은 값)",
               chrono::duration<double>(chrono::steady_clock::now() - t0).count());
    }
    {
        vector<int> a = sorted_in;
        reverse(a.begin(), a.end());
        auto t0 = chrono::steady_clock::now();
        sort(a.begin(), a.end());
        printf("%-28s %.4f s\n", "sort (역순 입력)",
               chrono::duration<double>(chrono::steady_clock::now() - t0).count());
    }

    printf("n=%d  stable/sort=%.2f배  sort/nth_element=%.1f배  sort/partial_sort=%.1f배\n",
           n, t_stable / t_sort, t_sort / t_nth, t_sort / t_partial);
    return 0;
}
