// 0-12 — 랜덤 스트레스 테스트 하네스 (C++ 쪽).
//
// stress_pair_sum.py 와 네 조각이 1:1 로 대응한다.
//     gen / brute / fast / main(+shrink)
//
// 난수 생성기가 언어마다 다르므로 **처음 걸리는 회차와 그때의 입력은
// 두 언어가 다르다.** 같아야 하는 것은 축소가 끝난 뒤의 결론이다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/stress_pair_sum.cpp -o /tmp/stress
//   /tmp/stress [반복횟수] [fixed]

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <string>
#include <vector>
using namespace std;

struct Case {
    vector<int> a;
    int x;
};

static void print_case(const char* tag, const Case& t) {
    printf("  %s a=[", tag);
    for (size_t i = 0; i < t.a.size(); ++i) printf(i ? ", %d" : "%d", t.a[i]);
    printf("] x=%d\n", t.x);
}

// --- 1. 생성기: 작게, 그리고 값 범위를 좁게 -------------------------------
static Case gen(mt19937& rng) {
    int n = (int)(rng() % 6) + 1;   // 크게 만들면 어디가 문제인지 안 보인다
    int x = (int)(rng() % 7);       // 값 범위를 좁혀야 중복이 생긴다
    vector<int> a(n);
    for (int i = 0; i < n; ++i) a[i] = (int)(rng() % 4);
    sort(a.begin(), a.end());
    return {a, x};
}

// --- 2. 브루트포스: O(n^2). 느려도 된다. 맞기만 하면 된다 -----------------
static long long brute(const Case& t) {
    long long cnt = 0;
    for (size_t i = 0; i < t.a.size(); ++i)
        for (size_t j = i + 1; j < t.a.size(); ++j)
            if (t.a[i] + t.a[j] == t.x) cnt += 1;
    return cnt;
}

// --- 3. 검증 대상: O(n) 투 포인터 ------------------------------------------
static long long fast(const Case& t) {
    int i = 0, j = (int)t.a.size() - 1;
    long long cnt = 0;
    while (i < j) {
        int s = t.a[i] + t.a[j];
        if (s == t.x) {
            cnt += 1;               // ❌ 같은 값이 여럿이면 한 번만 세고 지나간다
            i += 1;
            j -= 1;
        } else if (s < t.x) {
            i += 1;
        } else {
            j -= 1;
        }
    }
    return cnt;
}

// --- 3b. 고친 판: 반례를 보고 나서 짠다 -----------------------------------
static long long fixed_(const Case& t) {
    int i = 0, j = (int)t.a.size() - 1;
    long long cnt = 0;
    while (i < j) {
        int s = t.a[i] + t.a[j];
        if (s < t.x) {
            i += 1;
        } else if (s > t.x) {
            j -= 1;
        } else if (t.a[i] == t.a[j]) {   // 남은 구간이 전부 같은 값이면 조합으로 센다
            long long m = j - i + 1;
            cnt += m * (m - 1) / 2;
            break;
        } else {
            long long ci = 1;
            while (t.a[i + 1] == t.a[i]) { i += 1; ci += 1; }
            long long cj = 1;
            while (t.a[j - 1] == t.a[j]) { j -= 1; cj += 1; }
            cnt += ci * cj;              // 왼쪽 덩어리 x 오른쪽 덩어리
            i += 1;
            j -= 1;
        }
    }
    return cnt;
}

// 검사 대상을 바꿔 끼우는 자리. 하네스 나머지는 손대지 않는다.
static long long (*TARGET)(const Case&) = fast;

// --- 4. 축소: 실패를 유지하면서 입력을 더 못 줄일 때까지 깎는다 -----------
static bool fails(const Case& t) { return brute(t) != TARGET(t); }

static Case shrink(Case t, int& steps) {
    steps = 0;
    bool changed = true;
    while (changed) {
        changed = false;
        for (size_t i = 0; i < t.a.size(); ++i) {   // (a) 원소 하나 지우기
            Case c = t;
            c.a.erase(c.a.begin() + i);
            ++steps;
            if (fails(c)) { t = c; changed = true; break; }
        }
        if (changed) continue;
        for (size_t i = 0; i < t.a.size(); ++i) {   // (b) 원소 하나 줄이기
            if (t.a[i] == 0) continue;
            Case c = t;
            c.a[i] -= 1;
            sort(c.a.begin(), c.a.end());
            ++steps;
            if (fails(c)) { t = c; changed = true; break; }
        }
        if (changed) continue;
        if (t.x > 0) {                              // (c) x 줄이기
            Case c = t;
            c.x -= 1;
            ++steps;
            if (fails(c)) { t = c; changed = true; }
        }
    }
    return t;
}

int main(int argc, char** argv) {
    long long iters = argc > 1 ? atoll(argv[1]) : 100000;
    if (argc > 2 && string(argv[2]) == "fixed") {
        TARGET = fixed_;
        printf("검사 대상: fixed()\n");
    } else {
        printf("검사 대상: fast()\n");
    }
    mt19937 rng(20260804);
    for (long long it = 1; it <= iters; ++it) {
        Case t = gen(rng);
        if (fails(t)) {
            printf("[%lld회차] 불일치 발견\n", it);
            print_case("입력  ", t);
            printf("  brute  %lld\n", brute(t));
            printf("  대상   %lld\n", TARGET(t));
            int steps = 0;
            Case small = shrink(t, steps);
            printf("  -- 축소 %d회 시도 --\n", steps);
            print_case("최소 입력", small);
            printf("  brute  %lld\n", brute(small));
            printf("  대상   %lld\n", TARGET(small));
            return 1;
        }
        if (it % 20000 == 0) printf("  %lld회 통과\n", it);
    }
    printf("%lld회 전부 일치\n", iters);
    return 0;
}
