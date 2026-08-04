// 0-8 §반복자 카테고리 — 같은 std::distance 가 카테고리에 따라 O(1) 이거나 O(n) 이다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_iterator_category.cpp -o /tmp/ic && /tmp/ic 200000 500
//
// std::distance 는 카테고리 태그로 구현을 고른다.
//   random_access_iterator_tag  → last - first  한 번의 뺄셈
//   그 외                        → ++first 를 세면서 걷는다
// 코드 모양은 같고 비용만 다르다. 이 사실이 컴파일 에러로 드러나지 않는 것이 함정이다.
//
// 측정 함수를 noinline 으로 떼어 놓은 이유: 같은 함수 안에서 컨테이너를 만들고
// 바로 재면, 컴파일러가 "방금 n개를 넣었으니 답은 n"이라고 판정해 순회를 통째로
// 지운다. 첫 측정에서 실제로 list 가 0.0000초로 나왔고 어셈블리에는 저장된 크기를
// 그냥 읽는 명령 하나만 남아 있었다.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <iterator>
#include <list>
#include <numeric>
#include <set>
#include <vector>
using namespace std;

__attribute__((noinline, noipa)) long long dist_vec(const vector<int>& c) {
    return distance(c.begin(), c.end());
}
__attribute__((noinline, noipa)) long long dist_list(const list<int>& c) {
    return distance(c.begin(), c.end());
}
__attribute__((noinline, noipa)) long long dist_set(const set<int>& c) {
    return distance(c.begin(), c.end());
}
// 리스트 전체 구간은 libstdc++ 이 특수 처리해 저장된 크기를 읽어 버린다.
// 부분 구간에는 그 지름길이 없다. 카테고리의 진짜 비용은 이쪽에서 보인다.
__attribute__((noinline, noipa)) long long dist_list_partial(list<int>::const_iterator a,
                                                             list<int>::const_iterator b) {
    return distance(a, b);
}

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 200000;
    int q = (argc > 2) ? atoi(argv[2]) : 500;

    vector<int> v(n);
    iota(v.begin(), v.end(), 0);
    list<int> l(v.begin(), v.end());
    set<int> s(v.begin(), v.end());

    auto run = [&](const char* name, auto&& fn) {
        auto t0 = chrono::steady_clock::now();
        long long acc = 0;
        for (int i = 0; i < q; ++i) acc += fn();
        auto t1 = chrono::steady_clock::now();
        double sec = chrono::duration<double>(t1 - t0).count();
        printf("%-34s %.4f s  (%.2f us/회)  acc=%lld\n", name, sec, sec * 1e6 / q, acc);
        return sec;
    };

    printf("vector: random_access,  list/set: bidirectional  (n=%d, %d회 반복)\n", n, q);
    auto mid = l.cbegin();
    advance(mid, n / 2);

    double t_v = run("distance(vector) 전체", [&] { return dist_vec(v); });
    double t_l = run("distance(list) 전체", [&] { return dist_list(l); });
    double t_lp = run("distance(list) 앞 절반", [&] { return dist_list_partial(l.cbegin(), mid); });
    double t_s = run("distance(set) 전체", [&] { return dist_set(s); });
    printf("list전체/vector=%.0f배  list절반/vector=%.0f배  set/vector=%.0f배\n",
           t_l / t_v, t_lp / t_v, t_s / t_v);
    return 0;
}
