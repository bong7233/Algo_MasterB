// II-1 §2·§3 — 용량을 "2배로 늘리는가" 와 "상수만큼 늘리는가" 의 차이.
//
//   g++ -std=c++17 -O2 tools/bench/ii1_growth_policy.cpp -o /tmp/gp && /tmp/gp 200000
//
// 두 정책 모두 push 한 번의 "쓰기" 는 1회다. 갈리는 것은 재할당 때 옮기는 원소 수다.
//   2배 정책 : 총 복사량이 1 + 2 + 4 + ... < 2n  -> 원소당 상수. 분할상환 O(1)
//   +상수 정책: 재할당이 n/step 번, 각각 평균 n/2 개 복사 -> 총 O(n^2 / step)
//
// 복사 횟수는 이론값과 정확히 맞아야 한다. 시간보다 이 횟수가 이 벤치의 본체다.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
using namespace std;

// 정책만 다른 최소 동적 배열. 표준 컨테이너를 쓰면 정책을 바꿀 수 없어 직접 짠다.
struct Dyn {
    int* data = nullptr;
    long long size = 0, cap = 0;
    long long copies = 0, reallocs = 0;
    bool doubling;   // true = 2배, false = +step
    long long step;

    Dyn(bool d, long long s) : doubling(d), step(s) {}
    ~Dyn() { delete[] data; }

    void push(int v) {
        if (size == cap) {
            long long ncap = doubling ? (cap ? cap * 2 : 1) : cap + step;
            int* nd = new int[ncap];
            if (data) memcpy(nd, data, sizeof(int) * (size_t)size);
            copies += size;      // 옮긴 원소 수 — 이 합이 정책의 정체다
            reallocs += 1;
            delete[] data;
            data = nd;
            cap = ncap;
        }
        data[size++] = v;
    }
};

static double run(bool doubling, long long step, int n, long long& copies, long long& reallocs) {
    Dyn d(doubling, step);
    auto t0 = chrono::steady_clock::now();
    for (int i = 0; i < n; ++i) d.push(i);
    auto t1 = chrono::steady_clock::now();
    copies = d.copies;
    reallocs = d.reallocs;
    return chrono::duration<double>(t1 - t0).count();
}

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 200000;
    long long c1, r1, c2, r2;
    double t1 = run(true, 0, n, c1, r1);
    double t2 = run(false, 128, n, c2, r2);
    printf("n=%d\n", n);
    printf("2배     재할당 %6lld회  총 복사 %12lld개  %.4f s\n", r1, c1, t1);
    printf("+128    재할당 %6lld회  총 복사 %12lld개  %.4f s  (%.1f배)\n", r2, c2, t2, t2 / t1);
    printf("복사/원소  2배 %.2f개 / +128 %.1f개\n", (double)c1 / n, (double)c2 / n);
    return 0;
}
