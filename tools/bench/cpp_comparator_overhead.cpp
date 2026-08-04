// 0-8 §비교자 — 람다·함수 포인터·std::function 이 정렬 속도에 얼마나 차이를 만드는가.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_comparator_overhead.cpp -o /tmp/co && /tmp/co 5000000
//
// 셋 다 "같은 비교"를 한다. 다른 것은 컴파일러가 그 비교를 인라인할 수 있느냐다.
//   람다        : 타입마다 고유한 클로저 타입 → sort 템플릿 안으로 인라인된다
//   함수 포인터 : 값이므로 원칙적으로 간접 호출. 다만 최적화가 뚫는 경우가 있다
//   std::function: 타입 소거. 가상 호출 한 겹이 매 비교마다 남는다
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <numeric>
#include <random>
#include <vector>
using namespace std;

bool cmp_fn(int a, int b) { return a < b; }

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 5000000;
    mt19937 rng(42);
    vector<int> base(n);
    iota(base.begin(), base.end(), 0);
    shuffle(base.begin(), base.end(), rng);

    auto run = [&](const char* name, auto&& sorter) {
        vector<int> a = base;
        auto t0 = chrono::steady_clock::now();
        sorter(a);
        auto t1 = chrono::steady_clock::now();
        double sec = chrono::duration<double>(t1 - t0).count();
        printf("%-24s %.4f s  정렬됨=%d\n", name, sec, (int)is_sorted(a.begin(), a.end()));
        return sec;
    };

    double t_def = run("기본 (operator<)", [](vector<int>& a) { sort(a.begin(), a.end()); });
    double t_lam = run("람다", [](vector<int>& a) {
        sort(a.begin(), a.end(), [](int x, int y) { return x < y; });
    });
    double t_ptr = run("함수 포인터", [](vector<int>& a) {
        bool (*p)(int, int) = cmp_fn;
        sort(a.begin(), a.end(), p);
    });
    double t_std = run("std::function", [](vector<int>& a) {
        function<bool(int, int)> f = [](int x, int y) { return x < y; };
        sort(a.begin(), a.end(), f);
    });

    printf("n=%d  람다/기본=%.2f배  함수포인터/기본=%.2f배  std::function/기본=%.2f배\n",
           n, t_lam / t_def, t_ptr / t_def, t_std / t_def);
    return 0;
}
