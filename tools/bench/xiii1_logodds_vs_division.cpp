// 점유 격자 셀 갱신: 확률 나눗셈 형태와 로그 오즈 덧셈 형태의 실제 비용 (C++).
// Python 쪽과 같은 실험. tools/bench/xiii1_logodds_vs_division.py 참고.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -O2 / 4 코어).
// 빌드·실행: g++ -std=c++17 -O2 tools/bench/xiii1_logodds_vs_division.cpp -o /tmp/a && /tmp/a
#include <chrono>
#include <cmath>
#include <cstdio>
using namespace std;
using namespace std::chrono;

const long long N = 5000000;
const double P_HIT = 0.9;  // P(z=hit | occ)

// p_t = P(z|occ) p_{t-1} / [P(z|occ) p_{t-1} + P(z|free)(1-p_{t-1})] 을 그대로 반복.
double division_form(long long n) {
    double p = 0.5;
    double a = P_HIT, b = 1 - P_HIT;
    for (long long i = 0; i < n; i++) {
        double num = a * p;
        double den = num + b * (1 - p);
        p = num / den;
        if (p > 0.999 || p < 0.001) p = 0.5 + 1e-9 * i;  // 최적화로 사라지지 않게 값을 흘린다
    }
    return p;
}

// l_t = l_{t-1} + log(P(z|occ)/P(z|free)) 만 반복. 정규화가 없다.
double addition_form(long long n) {
    double l = 0.0;
    double inc = log(P_HIT / (1 - P_HIT));
    for (long long i = 0; i < n; i++) {
        l = l + inc;
        if (l > 5 || l < -5) l = 0.0 + 1e-9 * i;
    }
    return l;
}

int main() {
    auto t0 = high_resolution_clock::now();
    double r1 = division_form(N);
    auto t1 = high_resolution_clock::now();
    double r2 = addition_form(N);
    auto t2 = high_resolution_clock::now();
    printf("division form : %.4fs (r=%.6f)\n", duration<double>(t1 - t0).count(), r1);
    printf("addition form : %.4fs (r=%.6f)\n", duration<double>(t2 - t1).count(), r2);
    return 0;
}
