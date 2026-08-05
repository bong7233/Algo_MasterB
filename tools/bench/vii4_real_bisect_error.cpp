// VII-4 본문 수치 — 실수 이분 탐색을 몇 번 돌리면 오차가 얼마가 되는가 (C++ 판).
// vii4_real_bisect_error.py 와 같은 값을 내야 한다. double 연산이 IEEE 754 로
// 같기 때문에 실제로 마지막 자리까지 같다 — 그것을 확인하는 것도 이 스크립트의 몫이다.
//
// 측정 환경은 CLAUDE.md §1-3.
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/vii4_real_bisect_error.cpp -o /tmp/vii4 && /tmp/vii4

#include <cmath>
#include <cstdio>
using namespace std;

const double TARGET = 2.0;

void cbrt_bisect(int iters, double& lo, double& hi) {
    lo = 0.0;
    hi = 2.0;
    for (int i = 0; i < iters; i++) {
        double mid = lo + (hi - lo) / 2;
        if (mid * mid * mid >= TARGET) hi = mid;
        else lo = mid;
    }
}

// 어떤 값 x 에서 double 이 표현할 수 있는 다음 수까지의 간격
double ulp(double x) { return nextafter(x, INFINITY) - x; }

int main() {
    double exact = cbrt(TARGET);
    printf("정확해 cbrt(2) = %.17g\n", exact);
    printf("%4s %12s %12s %12s\n", "k", "폭", "절대오차", "상대오차");
    int ks[] = {10, 20, 30, 40, 50, 60, 70, 80, 100, 200};
    for (int k : ks) {
        double lo, hi;
        cbrt_bisect(k, lo, hi);
        double err = fabs(lo - exact);
        printf("%4d %12.3e %12.3e %12.3e\n", k, hi - lo, err, err / exact);
    }

    double lo = 0.0, hi = 2.0, prev = 2.0;
    int stop = -1;
    for (int k = 1; k <= 500; k++) {
        double mid = lo + (hi - lo) / 2;
        if (mid * mid * mid >= TARGET) hi = mid;
        else lo = mid;
        if (hi - lo == prev) { stop = k; break; }
        prev = hi - lo;
    }
    printf("\n폭이 더 줄지 않게 된 반복 = %d회, 그때의 폭 = %.3e\n", stop, prev);
    printf("1.26 근처의 double 간격(ULP) = %.3e\n", ulp(1.26));

    double xs[] = {1.0, 1e6, 1.4e9, 1e15, 1e18};
    for (double x : xs)
        printf("x = %9.2e 에서 ULP = %.3e  (EPS=1e-9 보다 %s)\n", x, ulp(x),
               ulp(x) > 1e-9 ? "크다 → 절대오차 1e-9 는 불가능" : "작다 → 가능");
    return 0;
}
