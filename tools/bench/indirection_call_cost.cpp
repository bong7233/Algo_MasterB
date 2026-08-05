// XII-2 §6 의 수치 근거 — 간접 계층 하나가 호출 비용에 얼마를 더하는가.
//
// 어댑터를 하나 끼우면 호출이 한 번 더 튄다. 그 비용이 실제로 얼마인지 재지 않으면
// "성능 때문에 추상화를 안 한다" 는 주장이 근거 없이 통용된다.
//
// 측정 설계상의 주의:
//   - 가상 호출을 재려면 컴파일러가 탈가상화(devirtualization)하지 못해야 한다.
//     그래서 서로 다른 파생 타입 두 개를 런타임에 섞어 vector 에 담는다.
//   - 결과를 출력해 루프가 통째로 제거되는 것을 막는다.
//
// 빌드: g++ -std=c++17 -O2 indirection_call_cost.cpp -o indirection_call_cost
#include <chrono>
#include <cstdio>
#include <functional>
#include <memory>
#include <random>
#include <vector>
using namespace std;
using namespace std::chrono;

struct Sensor {                       // 상위가 소유하는 인터페이스
    virtual ~Sensor() = default;
    virtual int read() const = 0;
};
struct SensorA : Sensor {
    int v;
    explicit SensorA(int v) : v(v) {}
    int read() const override { return v + 1; }
};
struct SensorB : Sensor {
    int v;
    explicit SensorB(int v) : v(v) {}
    int read() const override { return v + 2; }
};

struct Concrete {                     // 인터페이스 없는 구체 타입 — 인라인 가능
    int v;
    explicit Concrete(int v) : v(v) {}
    int read() const { return v + 1; }
};

static const int N = 50'000'000;

int main() {
    mt19937 rng(12345);

    vector<Concrete> direct;
    direct.reserve(1024);
    for (int i = 0; i < 1024; i++) direct.emplace_back(int(rng() & 0xff));

    vector<unique_ptr<Sensor>> virt;  // 두 타입을 섞어 탈가상화를 막는다
    virt.reserve(1024);
    for (int i = 0; i < 1024; i++) {
        int v = int(rng() & 0xff);
        if (i % 2) virt.emplace_back(make_unique<SensorA>(v));
        else       virt.emplace_back(make_unique<SensorB>(v));
    }

    vector<function<int()>> fns;      // std::function — 타입 소거까지 얹은 경우
    fns.reserve(1024);
    for (int i = 0; i < 1024; i++) {
        int v = int(rng() & 0xff);
        fns.emplace_back([v] { return v + 1; });
    }

    long long acc = 0;

    auto t0 = steady_clock::now();
    for (int i = 0; i < N; i++) acc += direct[i & 1023].read();
    auto t1 = steady_clock::now();
    for (int i = 0; i < N; i++) acc += virt[i & 1023]->read();
    auto t2 = steady_clock::now();
    for (int i = 0; i < N; i++) acc += fns[i & 1023]();
    auto t3 = steady_clock::now();

    double d_direct = duration<double>(t1 - t0).count();
    double d_virt   = duration<double>(t2 - t1).count();
    double d_fn     = duration<double>(t3 - t2).count();

    printf("acc=%lld (루프가 제거되지 않았다는 증거)\n", acc);
    printf("직접 호출     : %.3f s  = %.3f ns/call\n", d_direct, d_direct * 1e9 / N);
    printf("가상 호출     : %.3f s  = %.3f ns/call\n", d_virt,   d_virt   * 1e9 / N);
    printf("std::function : %.3f s  = %.3f ns/call\n", d_fn,     d_fn     * 1e9 / N);
    printf("가상 - 직접   : %.3f ns/call\n", (d_virt - d_direct) * 1e9 / N);
    return 0;
}
