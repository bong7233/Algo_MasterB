// VI-6 의 C++ 쪽 수치 — 같은 스위핑을 C++17 -O2 로 돌렸을 때의 시간과 정렬 비중.
//
// Python 판(sweep_scale.py)과 같은 입력 분포·같은 절차를 쓴다. 알고리즘이 같고
// 언어만 다를 때 상수가 얼마나 벌어지는지가 이 파일의 목적이다.
//
// 측정 환경은 CLAUDE.md §1-3 고정. 빌드·실행:
//   g++ -std=c++17 -O2 -o /tmp/sweep tools/bench/sweep_scale.cpp && /tmp/sweep

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>
#include <vector>
using namespace std;
using Clock = chrono::steady_clock;

const long long COORD_MAX = 1000000000LL;

vector<pair<long long, long long>> make_segs(int n, unsigned seed) {
    mt19937 rnd(seed);
    vector<pair<long long, long long>> out;
    out.reserve(n);
    for (int i = 0; i < n; i++) {
        long long s = rnd() % (COORD_MAX - 1000);
        out.push_back({s, s + 1 + rnd() % 100000});
    }
    return out;
}

// (최대 겹침, 합집합 길이). 반열림 [s, e). -1 < +1 이라 같은 좌표에서 끝이 먼저다.
pair<int, long long> sweep(const vector<pair<long long, long long>>& segs, double* sort_ms) {
    vector<pair<long long, int>> ev;
    ev.reserve(segs.size() * 2);
    for (auto [s, e] : segs) {
        ev.push_back({s, 1});
        ev.push_back({e, -1});
    }
    auto t0 = Clock::now();
    sort(ev.begin(), ev.end());
    *sort_ms = chrono::duration<double, milli>(Clock::now() - t0).count();

    int open_cnt = 0, best = 0;
    long long length = 0, prev = 0;
    bool has_prev = false;
    for (auto [x, d] : ev) {
        if (open_cnt > 0 && has_prev) length += x - prev;
        open_cnt += d;
        if (open_cnt > best) best = open_cnt;
        prev = x;
        has_prev = true;
    }
    return {best, length};
}

double median3(double a, double b, double c) {
    double lo = min(a, min(b, c)), hi = max(a, max(b, c));
    return a + b + c - lo - hi;
}

int main() {
    printf("스위핑 (C++17 -O2) — 전체 시간과 그중 정렬 비중\n");
    for (int n : {100000, 1000000}) {
        auto segs = make_segs(n, (unsigned)n);
        double all[3], srt[3];
        int best = 0;
        long long len = 0;
        for (int r = 0; r < 3; r++) {
            auto t0 = Clock::now();
            auto res = sweep(segs, &srt[r]);
            all[r] = chrono::duration<double, milli>(Clock::now() - t0).count();
            best = res.first;
            len = res.second;
        }
        double a = median3(all[0], all[1], all[2]);
        double s = median3(srt[0], srt[1], srt[2]);
        printf("    n=%9d  전체 %7.1f ms / 정렬 %7.1f ms = %2.0f%%   최대 겹침 %d, 합집합 길이 %lld\n",
               n, a, s, s / a * 100.0, best, len);
    }
    return 0;
}
