// VII-3 본문 수치 — 답을 선형으로 훑는 것과 이분 탐색하는 것의 차이 (C++ 판).
// Python 판(vii3_parametric_vs_linear.py)과 같은 입력·같은 판정 함수를 쓴다.
// 입력은 난수가 아니라 결정적 수열이라 두 언어의 답이 정확히 같아야 한다.
//
// 측정 환경은 CLAUDE.md §1-3.
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/vii3_parametric_vs_linear.cpp -o /tmp/vii3 && /tmp/vii3

#include <chrono>
#include <cstdio>
#include <algorithm>
#include <vector>
using namespace std;
using namespace std::chrono;

const int K = 100;
const int HI = 50000;
const int N = 137;
const int REPEAT = 5;

vector<int> a;
long long calls = 0;

// 길이 x 로 자르면 N 개 이상 나오는가. x 가 커질수록 참에서 거짓으로 한 번 뒤집힌다.
bool feasible(int x) {
    calls++;
    long long total = 0;
    for (int v : a) total += v / x;
    return total >= N;
}

int solve_linear() {
    int best = 0;
    for (int x = 1; x < HI; x++) {
        if (feasible(x)) best = x;
        else break;
    }
    return best;
}

int solve_binary() {
    int lo = 1, hi = HI;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (!feasible(mid)) hi = mid;
        else lo = mid + 1;
    }
    return lo - 1;
}

template <class F>
pair<int, double> timed(F fn) {
    vector<double> ts;
    int ans = 0;
    for (int i = 0; i < REPEAT; i++) {
        auto t0 = steady_clock::now();
        ans = fn();
        auto t1 = steady_clock::now();
        ts.push_back(duration<double>(t1 - t0).count());
    }
    sort(ts.begin(), ts.end());
    return {ans, ts[ts.size() / 2]};
}

int main() {
    // 난수 대신 결정적 수열을 쓴다. 두 언어의 난수 생성기가 달라도 입력이 같아야
    // 표의 두 열을 나란히 놓을 수 있다.
    a.resize(K);
    for (int i = 0; i < K; i++) a[i] = (i * 7919 + 13) % (HI - 1) + 1;

    calls = 0;
    auto lin = timed(solve_linear);
    long long calls_lin = calls / REPEAT;

    calls = 0;
    auto bin = timed(solve_binary);
    long long calls_bin = calls / REPEAT;

    printf("K = %d  HI = %d  N = %d\n", K, HI, N);
    printf("선형  답=%d  판정 호출=%7lld  %9.3f ms\n", lin.first, calls_lin, lin.second * 1e3);
    printf("이분  답=%d  판정 호출=%7lld  %9.3f us\n", bin.first, calls_bin, bin.second * 1e6);
    printf("두 답이 같은가: %s\n", lin.first == bin.first ? "true" : "false");
    printf("판정 호출 비 = %.1f배, 시간 비 = %.1f배\n",
           (double)calls_lin / calls_bin, lin.second / bin.second);
    return 0;
}
