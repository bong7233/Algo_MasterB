// 링 버퍼 인덱스 접기: `% cap` 과 `& (cap-1)` 의 실제 차이 (C++).
//
// 컴파일러가 상수 나눗셈을 곱셈+시프트로 바꾸므로 `cap` 이 컴파일 시점 상수면
// 차이가 거의 사라진다. 실제 링 버퍼의 용량은 런타임 값인 경우가 많다.
// 그래서 두 경우를 나눠 잰다 — 상수 cap 과 런타임 cap.
//
// 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 / g++ 13.3.0 -std=c++17 -O2 / 4 코어).
// 빌드·실행: g++ -std=c++17 -O2 tools/bench/ringbuffer_mod_vs_mask.cpp -o /tmp/mm && /tmp/mm

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <vector>
using namespace std;
using namespace std::chrono;

static const int N = 200'000'000;
static const int REPEAT = 7;

// volatile 로 결과를 흘려 보내 최적화로 루프가 통째로 사라지는 것을 막는다.
volatile int sink = 0;

template <class F>
double timeit(F f) {
    auto t0 = steady_clock::now();
    f();
    return duration<double>(steady_clock::now() - t0).count();
}

double med(vector<double> v) {
    sort(v.begin(), v.end());
    return v[v.size() / 2];
}

int main() {
    // 런타임 값. 컴파일러가 상수로 접어 넣지 못하도록 volatile 을 거친다.
    volatile int vcap = 1024;
    int cap = vcap;
    int mask = cap - 1;

    vector<double> tm, tk, tc;
    for (int r = 0; r < REPEAT; r++) {
        tm.push_back(timeit([&] {
            int i = 0;
            for (int k = 0; k < N; k++) i = (i + 1) % cap;   // 런타임 cap
            sink = i;
        }));
        tk.push_back(timeit([&] {
            int i = 0;
            for (int k = 0; k < N; k++) i = (i + 1) & mask;  // 런타임 mask
            sink = i;
        }));
        tc.push_back(timeit([&] {
            int i = 0;
            for (int k = 0; k < N; k++) i = (i + 1) % 1024;  // 컴파일 시점 상수
            sink = i;
        }));
    }

    auto show = [](const char* name, vector<double>& v) {
        double lo = *min_element(v.begin(), v.end());
        double hi = *max_element(v.begin(), v.end());
        printf("%-18s 중앙값 %.3f초  범위 %.3f~%.3f  (%d회, %d회 실행)\n",
               name, med(v), lo, hi, N, REPEAT);
        printf("%-18s 연산당 %.2f ns\n", "", med(v) / N * 1e9);
    };
    show("% cap (런타임)", tm);
    show("& mask (런타임)", tk);
    show("% 1024 (상수)", tc);
    return 0;
}
