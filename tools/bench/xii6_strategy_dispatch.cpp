// XII-6 §6 — 전략을 무엇으로 넘기느냐가 뜨거운 루프에서 얼마의 비용인가.
//
//   g++ -std=c++17 -O2 tools/bench/xii6_strategy_dispatch.cpp -o /tmp/sd
//   /tmp/sd 200000000 1        # 구현이 하나만 살아 있는 경우
//   /tmp/sd 200000000 2        # 구현이 둘이고 런타임에 갈리는 경우
//
// 셋 다 같은 계산(맨해튼 휴리스틱)을 N번 한다. 다른 것은 그 계산이 호출 지점에서
// 컴파일러에게 보이느냐다.
//   템플릿        : 전략 타입이 컴파일 타임에 확정 → 루프 안으로 인라인된다
//   가상 함수     : vtable 을 거친다. 단 후보 구현이 하나뿐이면 컴파일러가
//                   추측 역가상화(speculative devirtualization)로 되돌리기도 한다
//   std::function : 타입 소거가 한 겹 더 얹힌다
//
// 두 번째 인자(1 또는 2)는 등록된 구현 수를 바꾼다. 실측 결과 둘의 차이는 거의 없다 —
// 전략 포인터가 배열에서 오는 순간 컴파일러는 어차피 호출 대상을 확정하지 못한다.
// 차이를 만드는 것은 구현 수가 아니라 "타입이 컴파일 타임에 확정되는가" 하나다.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <memory>
#include <vector>
using namespace std;

struct Heuristic {
    virtual ~Heuristic() = default;
    virtual long long h(long long x, long long y) const = 0;
};
struct Manhattan : Heuristic {
    long long h(long long x, long long y) const override {
        return (x < 0 ? -x : x) + (y < 0 ? -y : y);
    }
};
// 두 번째 구현. 존재하고 실제로 호출되어야 컴파일러가 하나로 접지 못한다.
struct Chebyshev : Heuristic {
    long long h(long long x, long long y) const override {
        long long ax = (x < 0 ? -x : x), ay = (y < 0 ? -y : y);
        return ax > ay ? ax : ay;
    }
};
struct ManhattanInline {
    long long operator()(long long x, long long y) const {
        return (x < 0 ? -x : x) + (y < 0 ? -y : y);
    }
};

template <class F>
long long loop_tmpl(const vector<int>& xs, const vector<int>& ys, const F& f) {
    long long acc = 0;
    for (size_t i = 0; i < xs.size(); i++) acc += f(xs[i], ys[i]);
    return acc;
}
long long loop_virt(const vector<int>& xs, const vector<int>& ys,
                    const vector<Heuristic*>& fs) {
    long long acc = 0;
    for (size_t i = 0; i < xs.size(); i++) acc += fs[i & 1]->h(xs[i], ys[i]);
    return acc;
}
long long loop_func(const vector<int>& xs, const vector<int>& ys,
                    const vector<function<long long(long long, long long)>>& fs) {
    long long acc = 0;
    for (size_t i = 0; i < xs.size(); i++) acc += fs[i & 1](xs[i], ys[i]);
    return acc;
}

int main(int argc, char** argv) {
    long long n = (argc > 1) ? atoll(argv[1]) : 200000000;
    int kinds = (argc > 2) ? atoi(argv[2]) : 2;   // 1이면 두 슬롯에 같은 구현을 넣는다

    vector<int> xs(n), ys(n);
    for (long long i = 0; i < n; i++) {
        xs[i] = int(i % 1000) - 500;
        ys[i] = int(i % 777) - 388;
    }

    Manhattan m;
    Chebyshev c;
    vector<Heuristic*> fs_v = {&m, kinds == 1 ? (Heuristic*)&m : (Heuristic*)&c};
    vector<function<long long(long long, long long)>> fs_f;
    fs_f.emplace_back(ManhattanInline{});
    if (kinds == 1) fs_f.emplace_back(ManhattanInline{});
    else fs_f.emplace_back([](long long x, long long y) {
        long long ax = (x < 0 ? -x : x), ay = (y < 0 ? -y : y);
        return ax > ay ? ax : ay;
    });

    auto timed = [&](const char* name, auto&& body) {
        auto t0 = chrono::steady_clock::now();
        long long acc = body();
        auto t1 = chrono::steady_clock::now();
        double sec = chrono::duration<double>(t1 - t0).count();
        printf("%-16s %.4f s   acc=%lld\n", name, sec, acc);
        return sec;
    };

    printf("n=%lld  구현 종류=%d\n", n, kinds);
    double t_t = timed("템플릿", [&] { return loop_tmpl(xs, ys, ManhattanInline{}); });
    double t_v = timed("가상 함수", [&] { return loop_virt(xs, ys, fs_v); });
    double t_f = timed("std::function", [&] { return loop_func(xs, ys, fs_f); });

    printf("가상/템플릿=%.2f배  std::function/템플릿=%.2f배\n\n", t_v / t_t, t_f / t_t);
    return 0;
}
