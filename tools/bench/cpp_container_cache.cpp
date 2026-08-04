// 0-6 §캐시 특성 — 같은 개수를 순회하는데 컨테이너에 따라 시간이 얼마나 갈리는지.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_container_cache.cpp -o /tmp/cc && /tmp/cc 5000000
//
// 네 가지를 잰다.
//   vector       : 연속 메모리. 캐시 라인 하나에 int 16개가 실려 온다
//   deque        : 512바이트 청크의 배열. 준연속
//   list(순차)   : 노드지만 할당 순서 = 연결 순서라 주소가 대체로 오르막
//   list(뒤섞임) : 같은 노드를 무작위 순서로 이어 붙였다. 실제로 오래 산 리스트의 모습
//
// 네 번째가 요점이다. 알고리즘 복잡도는 넷 다 O(n) 이고 명령어 수도 비슷하다.
// 갈리는 것은 메모리 접근 패턴뿐이다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <list>
#include <numeric>
#include <random>
#include <vector>
using namespace std;

template <class F>
double timeit(F f) {
    auto t0 = chrono::steady_clock::now();
    long long s = f();
    auto t1 = chrono::steady_clock::now();
    // 합을 쓰지 않으면 최적화가 순회를 통째로 지운다.
    fprintf(stderr, "(sum=%lld)\n", s);
    return chrono::duration<double>(t1 - t0).count();
}

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 5000000;

    vector<int> vec(n);
    iota(vec.begin(), vec.end(), 1);
    deque<int> dq(vec.begin(), vec.end());
    list<int> lst(vec.begin(), vec.end());

    // 같은 노드를 무작위 순서로 다시 잇는다. 노드 주소는 그대로고 링크만 섞인다.
    list<int> shuffled(vec.begin(), vec.end());
    {
        vector<list<int>::iterator> its;
        its.reserve(n);
        for (auto it = shuffled.begin(); it != shuffled.end(); ++it) its.push_back(it);
        mt19937 rng(42);
        shuffle(its.begin(), its.end(), rng);
        list<int> tmp;
        for (auto it : its) tmp.splice(tmp.end(), shuffled, it);
        shuffled.swap(tmp);
    }

    double t_vec = timeit([&] { long long s = 0; for (int x : vec) s += x; return s; });
    double t_dq  = timeit([&] { long long s = 0; for (int x : dq) s += x; return s; });
    double t_lst = timeit([&] { long long s = 0; for (int x : lst) s += x; return s; });
    double t_shf = timeit([&] { long long s = 0; for (int x : shuffled) s += x; return s; });

    printf("n=%d\n", n);
    printf("vector       %.4f s  (%.2f ns/원소)  기준\n", t_vec, t_vec * 1e9 / n);
    printf("deque        %.4f s  (%.2f ns/원소)  %.1f배\n", t_dq, t_dq * 1e9 / n, t_dq / t_vec);
    printf("list(순차)   %.4f s  (%.2f ns/원소)  %.1f배\n", t_lst, t_lst * 1e9 / n, t_lst / t_vec);
    printf("list(뒤섞임) %.4f s  (%.2f ns/원소)  %.1f배\n", t_shf, t_shf * 1e9 / n, t_shf / t_vec);
    return 0;
}
