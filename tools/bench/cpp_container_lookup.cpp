// 0-6 §조회 — unordered_map 의 O(1) 과 map 의 O(log n) 이 실제로 어떻게 뒤집히는지.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_container_lookup.cpp -o /tmp/cl && /tmp/cl 1000000
//
// 같은 키 집합에 같은 질의를 던진다. 다른 것은 자료구조뿐이다.
//   unordered_map : 버킷 배열 → 노드 체인. 해시 계산 1회 + 포인터 추적
//   map           : 레드-블랙 트리. 비교 log n 회, 매 비교가 다른 캐시 라인
//   정렬 vector   : lower_bound. 비교 log n 회지만 뒤쪽 절반은 같은 캐시 라인에 몰린다
//   직접 인덱스   : 키가 조밀할 때의 배열 첨자. 같은 O(1) 이 얼마나 다른지 보는 기준선
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <random>
#include <unordered_map>
#include <vector>
using namespace std;

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 1000000;

    mt19937 rng(42);
    vector<int> keys(n);
    for (int i = 0; i < n; ++i) keys[i] = i * 2;  // 짝수만 넣는다(절반은 miss 가 되게)
    vector<int> query(n);
    uniform_int_distribution<int> dist(0, 2 * n - 1);
    for (int i = 0; i < n; ++i) query[i] = dist(rng);

    unordered_map<int, int> um;
    um.reserve(n * 2);
    map<int, int> mp;
    vector<pair<int, int>> sv;
    sv.reserve(n);
    for (int i = 0; i < n; ++i) {
        um.emplace(keys[i], i);
        mp.emplace(keys[i], i);
        sv.emplace_back(keys[i], i);
    }
    sort(sv.begin(), sv.end());

    auto run = [&](const char* name, auto&& fn) {
        auto t0 = chrono::steady_clock::now();
        long long hit = 0;
        for (int q : query) hit += fn(q);
        auto t1 = chrono::steady_clock::now();
        double sec = chrono::duration<double>(t1 - t0).count();
        printf("%-22s %.4f s  (%.1f ns/질의)  hit=%lld\n", name, sec, sec * 1e9 / n, hit);
        return sec;
    };

    double t_um = run("unordered_map", [&](int q) { return um.find(q) != um.end() ? 1 : 0; });
    double t_mp = run("map", [&](int q) { return mp.find(q) != mp.end() ? 1 : 0; });
    double t_sv = run("sorted vector", [&](int q) {
        auto it = lower_bound(sv.begin(), sv.end(), make_pair(q, 0));
        return (it != sv.end() && it->first == q) ? 1 : 0;
    });

    vector<int> table(2 * n, -1);
    for (int i = 0; i < n; ++i) table[keys[i]] = i;
    double t_tb = run("직접 인덱스 vector", [&](int q) { return table[q] >= 0 ? 1 : 0; });

    printf("n=%d  map/unordered_map=%.1f배  sorted/unordered_map=%.1f배  "
           "unordered_map/직접인덱스=%.1f배\n",
           n, t_mp / t_um, t_sv / t_um, t_um / t_tb);
    return 0;
}
