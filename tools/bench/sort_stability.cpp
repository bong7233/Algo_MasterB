// 0-13 — 정렬 안정성이 언제 실제로 갈리는가 (C++ 쪽).
//
// sort_stability.py 와 1:1 로 대응한다. 같은 판정을 std::sort 와
// std::stable_sort 양쪽에 대해 돌린다.
//
// 핵심은 "작은 n 에서는 std::sort 도 안정적으로 보인다"는 것이다. introsort 가
// 짧은 구간을 삽입 정렬로 마무리하기 때문이고, 삽입 정렬은 안정적이다.
// 로컬에서 예제 입력만 돌려 보고 통과한 코드가 채점기에서 깨지는 경로가 이것이다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/sort_stability.cpp -o /tmp/ss && /tmp/ss

#include <algorithm>
#include <cstdio>
#include <utility>
#include <vector>
using namespace std;

// (키, 원래 순서) 쌍을 키로만 정렬한 뒤 원래 순서가 보존됐는지 본다.
template <typename Sorter>
static bool is_stable(int n, Sorter srt) {
    vector<pair<int, int>> pairs;
    for (int i = 0; i < n; ++i) pairs.push_back({i % 2, i});
    srt(pairs);
    int last = -1;
    for (auto& pr : pairs) {
        if (pr.first == 0) {
            if (pr.second < last) return false;
            last = pr.second;
        }
    }
    return true;
}

int main() {
    // 비교자는 const 참조를 받아야 한다. stable_sort 는 내부에서 const 원소와
    // 비교하는 경로가 있어, 비-const 참조 비교자는 컴파일조차 되지 않는다.
    auto by_key = [](const pair<int, int>& l, const pair<int, int>& r) { return l.first < r.first; };
    printf("C++ std::sort\n");
    for (int n : {4, 8, 16, 32, 40, 64, 1000}) {
        bool ok = is_stable(n, [&](vector<pair<int, int>>& v) {
            sort(v.begin(), v.end(), by_key);
        });
        printf("  n=%5d: 안정 = %s\n", n, ok ? "True" : "False");
    }
    printf("C++ std::stable_sort\n");
    for (int n : {4, 8, 16, 32, 40, 64, 1000}) {
        bool ok = is_stable(n, [&](vector<pair<int, int>>& v) {
            stable_sort(v.begin(), v.end(), by_key);
        });
        printf("  n=%5d: 안정 = %s\n", n, ok ? "True" : "False");
    }
    return 0;
}
