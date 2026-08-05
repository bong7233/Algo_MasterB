#include <cstdio>
using namespace std;

int main() {
    const double EPS = 1e-9;
    double lo = 0.0, hi = 1.0e18;   // 답은 sqrt(2e18) ~ 1.414e9 근처다
    double prev = hi - lo;
    int stuck_at = -1;

    for (int k = 1; k <= 300; k++) {  // 원래 조건은 while (hi-lo > EPS) 다. 안 끝나므로 상한을 건다
        double mid = lo + (hi - lo) / 2;
        if (mid * mid >= 2.0e18)
            hi = mid;
        else
            lo = mid;
        double width = hi - lo;
        if (width == prev) {          // 폭이 줄지 않았다 = 측도가 죽었다
            stuck_at = k;
            break;
        }
        prev = width;
    }

    printf("폭이 줄지 않게 된 반복  = %d\n", stuck_at);
    printf("그때의 폭             = %.6e\n", prev);
    printf("EPS                   = %.6e\n", EPS);
    printf("while (hi-lo > EPS) 는 여기서 %s\n", prev > EPS ? "영원히 참" : "거짓이 된다");
    return 0;
}
