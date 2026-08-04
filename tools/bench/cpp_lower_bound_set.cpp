// 0-7 §lower_bound — std::lower_bound 를 set 에 쓰면 O(log n) 이 아니다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_lower_bound_set.cpp -o /tmp/lbs && /tmp/lbs 200000
//
// std::lower_bound 는 반복자만 요구한다. 랜덤 접근이면 중간으로 점프하지만,
// set 의 양방향 반복자에서는 advance 가 한 칸씩 걷는다. 비교는 log n 회여도
// 이동이 O(n) 이라 전체가 O(n) 이 된다. 인터페이스는 같고 비용만 다르다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <set>
#include <vector>
using namespace std;

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 200000;
    int q = 2000;  // 질의 수를 작게 잡는다. 느린 쪽이 O(n·q) 라서
    set<int> s;
    for (int i = 0; i < n; ++i) s.insert(i * 2);
    vector<int> query(q);
    mt19937 rng(42);
    uniform_int_distribution<int> dist(0, 2 * n - 1);
    for (int& x : query) x = dist(rng);

    auto run = [&](const char* name, auto&& fn) {
        auto t0 = chrono::steady_clock::now();
        long long acc = 0;
        for (int x : query) acc += fn(x);
        auto t1 = chrono::steady_clock::now();
        double sec = chrono::duration<double>(t1 - t0).count();
        printf("%-26s %.4f s  (%.1f us/질의)  acc=%lld\n", name, sec, sec * 1e6 / q, acc);
        return sec;
    };

    double t_free = run("std::lower_bound(set)", [&](int x) {
        auto it = lower_bound(s.begin(), s.end(), x);
        return it == s.end() ? 0 : *it;
    });
    double t_mem = run("set::lower_bound", [&](int x) {
        auto it = s.lower_bound(x);
        return it == s.end() ? 0 : *it;
    });
    printf("n=%d q=%d  자유 함수가 멤버 함수의 %.0f배\n", n, q, t_free / t_mem);
    return 0;
}
