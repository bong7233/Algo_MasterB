// II-6 — 해시 DoS: 같은 버킷으로 몰리는 키를 골라 넣으면 O(1) 이 O(n) 이 된다.
//
// libstdc++ 의 unordered_map 은 정수 키에 항등 해시(hash<int>(x) == x)를 쓰고
// 버킷 수를 소수로 잡는다. 그래서 버킷 수의 배수만 골라 넣으면 모든 키가
// 같은 버킷의 연결 리스트에 매달린다. 삽입마다 그 리스트를 끝까지 훑으므로
// 전체가 O(n^2) 이다.
//
// 이 스크립트는 공격이 아니라 **가정의 증명**이다. "해시 테이블은 O(1)" 이라는
// 문장에서 빠진 조건이 무엇인지 수로 보인다.
//
// n 을 2배로 늘렸을 때 시간이 4배가 되는지도 같이 찍는다. 배수가 복잡도의 증거다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/hash_adversarial.cpp -o /tmp/ha && /tmp/ha

#include <chrono>
#include <cstdio>
#include <random>
#include <unordered_map>
#include <vector>
using namespace std;
using clk = chrono::steady_clock;

static double insert_all(const vector<size_t>& keys, size_t reserve_n) {
    unordered_map<size_t, int> m;
    m.reserve(reserve_n);
    auto t0 = clk::now();
    for (size_t k : keys) m[k] = 1;
    auto t1 = clk::now();
    if (m.size() == 12345678) puts("");  // 최적화 제거 방지
    return chrono::duration<double>(t1 - t0).count();
}

int main() {
    mt19937_64 rng(20250804);

    printf("unordered_map<size_t,int>, reserve(n) 후 삽입 (g++ 13 -O2)\n");
    printf("%10s | %12s | %14s | %8s\n", "n", "무작위 키", "버킷수의 배수", "배수");
    puts("---------------------------------------------------------");

    double prev_adv = 0;
    for (size_t n : {10000u, 20000u, 40000u}) {
        // 같은 reserve 로 만든 테이블의 버킷 수를 먼저 알아낸다.
        unordered_map<size_t, int> probe;
        probe.reserve(n);
        size_t B = probe.bucket_count();

        vector<size_t> rnd(n), adv(n);
        for (size_t i = 0; i < n; ++i) rnd[i] = rng();
        for (size_t i = 0; i < n; ++i) adv[i] = (i + 1) * B;  // 전부 버킷 0

        double t_rnd = insert_all(rnd, n);
        double t_adv = insert_all(adv, n);
        printf("%10zu | %10.4f초 | %12.4f초 | %6.0f배", n, t_rnd, t_adv, t_adv / t_rnd);
        if (prev_adv > 0) printf("   (직전 대비 %.1f배)", t_adv / prev_adv);
        printf("\n");
        prev_adv = t_adv;
    }
    return 0;
}
