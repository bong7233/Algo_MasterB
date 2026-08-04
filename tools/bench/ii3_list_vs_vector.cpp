// II-3 §5 — 연결 리스트가 이기는 자리와 지는 자리를 한 프로그램에서 잰다.
//
//   g++ -std=c++17 -O2 tools/bench/ii3_list_vs_vector.cpp -o /tmp/lv && /tmp/lv 100000
//
// A. 위치를 이미 손에 들고 있을 때의 삭제 (반복자/인덱스가 주어져 있다)
//      list   : 링크 두 개만 고친다. O(1)
//      vector : 뒤의 원소를 전부 한 칸 당긴다. O(n)
//    -> 리스트가 이긴다. 이것이 배열이 원리적으로 못 하는 유일한 연산이다.
//
// B. 값을 찾아서 삭제할 때 (위치를 모른다)
//      둘 다 탐색이 O(n) 이라 복잡도는 같다.
//      갈리는 것은 탐색 한 번의 상수 — 연속 메모리 vs 포인터 추적.
//    -> 벡터가 이긴다. 그리고 대부분의 문제는 B 다.
//
// 순회 자체의 비용 차이는 0-6 의 tools/bench/cpp_container_cache.cpp 가 이미 쟀다.
// 여기서 재는 것은 "삭제" 라는 같은 작업의 두 가지 조건이다.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <list>
#include <numeric>
#include <random>
#include <vector>
using namespace std;

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 100000;
    int half = n / 2;

    // ---- A. 위치를 알고 있을 때: 한가운데에서 half 번 지운다 ----
    {
        vector<int> v(n);
        iota(v.begin(), v.end(), 0);
        auto t0 = chrono::steady_clock::now();
        for (int i = 0; i < half; ++i) v.erase(v.begin() + (long)v.size() / 2);
        auto t1 = chrono::steady_clock::now();

        list<int> l(n);
        iota(l.begin(), l.end(), 0);
        auto it = l.begin();
        advance(it, n / 2);
        auto t2 = chrono::steady_clock::now();
        for (int i = 0; i < half; ++i) it = l.erase(it);   // 반복자는 다음 노드로 이어진다
        auto t3 = chrono::steady_clock::now();

        double tv = chrono::duration<double>(t1 - t0).count();
        double tl = chrono::duration<double>(t3 - t2).count();
        printf("A. 위치를 아는 삭제 %d회 (남은 원소 %zu/%zu)\n", half, v.size(), l.size());
        printf("   vector  %.4f s\n", tv);
        printf("   list    %.4f s   (%.0f배 빠름)\n", tl, tv / tl);
    }

    // ---- B. 값을 찾아서 지울 때: 무작위 값 ops 개를 찾아 지운다 ----
    {
        int ops = 2000;
        mt19937 rng(42);
        vector<int> targets(ops);
        for (int i = 0; i < ops; ++i) targets[i] = (int)(rng() % (unsigned)n);

        vector<int> v(n);
        iota(v.begin(), v.end(), 0);
        auto t0 = chrono::steady_clock::now();
        for (int x : targets) {
            auto p = find(v.begin(), v.end(), x);
            if (p != v.end()) v.erase(p);
        }
        auto t1 = chrono::steady_clock::now();

        list<int> l(n);
        iota(l.begin(), l.end(), 0);
        auto t2 = chrono::steady_clock::now();
        for (int x : targets) {
            auto p = find(l.begin(), l.end(), x);
            if (p != l.end()) l.erase(p);
        }
        auto t3 = chrono::steady_clock::now();

        double tv = chrono::duration<double>(t1 - t0).count();
        double tl = chrono::duration<double>(t3 - t2).count();
        printf("B. 값을 찾아서 삭제 %d회 (남은 원소 %zu/%zu)\n", ops, v.size(), l.size());
        printf("   vector  %.4f s\n", tv);
        printf("   list    %.4f s   (%.1f배 느림)\n", tl, tl / tv);
    }
    return 0;
}
