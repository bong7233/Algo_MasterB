// II-7 — 두 번 정렬해서 다중 키를 만드는 관용구가 std::sort 에서 언제 깨지는가.
//
// 관용구: 약한 기준으로 먼저 정렬하고 강한 기준으로 나중에 정렬한다.
// 이것은 나중 정렬이 **안정** 일 때만 성립한다. std::sort 는 안정이 아니다.
//
// 이 스크립트가 답하는 질문은 하나다. "그럼 언제 실제로 깨지는가."
// n 을 키우며 최초로 깨지는 지점을 찾는다. 16 이하에서 안 깨지는 이유는
// introsort 가 짧은 구간을 삽입 정렬로만 마무리하기 때문이고, 그래서
// 로컬 예제로는 절대 재현되지 않는다.
//
// sort_multikey.py 와 1:1 로 대응한다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/sort_multikey.cpp -o /tmp/mk && /tmp/mk

#include <algorithm>
#include <cstdio>
#include <vector>
using namespace std;

struct Row {
    int score;   // 강한 기준: 내림차순
    int tick;    // 약한 기준: 오름차순 (제출 시각)
};

// 점수 두 종류만 두면 동점 구간이 길어져 안정성 차이가 드러난다.
static vector<Row> make(int n) {
    vector<Row> v;
    for (int i = 0; i < n; ++i) v.push_back({(i % 2) ? 90 : 100, i});
    return v;
}

// 두 번 정렬 관용구. 나중 정렬이 안정이어야만 맞는다.
template <typename Sorter>
static vector<Row> two_pass(vector<Row> v, Sorter srt) {
    srt(v, [](const Row& a, const Row& b) { return a.tick < b.tick; });
    srt(v, [](const Row& a, const Row& b) { return a.score > b.score; });
    return v;
}

static bool ok(const vector<Row>& v) {
    for (size_t i = 1; i < v.size(); ++i)
        if (v[i - 1].score == v[i].score && v[i - 1].tick > v[i].tick) return false;
    return true;
}

int main() {
    auto unstable = [](vector<Row>& v, auto cmp) { sort(v.begin(), v.end(), cmp); };
    auto stable = [](vector<Row>& v, auto cmp) { stable_sort(v.begin(), v.end(), cmp); };

    int first_break = -1;
    for (int n = 2; n <= 200; ++n) {
        if (!ok(two_pass(make(n), unstable))) { first_break = n; break; }
    }
    printf("std::sort 로 두 번 정렬해서 처음 깨지는 n = %d\n", first_break);

    for (int n = 2; n <= 200; ++n)
        if (!ok(two_pass(make(n), stable))) { printf("stable_sort 가 n=%d 에서 깨졌다\n", n); return 1; }
    printf("stable_sort 는 n <= 200 전 구간에서 안 깨진다\n\n");

    int n = first_break;
    printf("n = %d 의 결과 (점수:시각), 점수 100 구간만\n", n);
    for (const char* which : {"sort", "stable_sort"}) {
        vector<Row> v = (which[0] == 's' && which[1] == 'o')
                            ? two_pass(make(n), unstable)
                            : two_pass(make(n), stable);
        printf("%-12s :", which);
        for (const Row& r : v)
            if (r.score == 100) printf(" %d", r.tick);
        printf("\n");
    }
    return 0;
}
