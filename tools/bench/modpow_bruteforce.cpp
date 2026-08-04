// I-5 §5 — "완전탐색으로 보이는 수학"의 실측 근거.
//
// A^B mod C 를 B 번의 곱셈으로 곧이곧대로 구했을 때 걸리는 시간을 잰다.
// B 는 백준 1629 곱셈의 상한 2,147,483,647 을 그대로 쓴다.
//
// 컴파일러가 루프를 통째로 지우지 못하도록 결과를 표준 출력으로 흘린다.
// (-O2 에서 결과를 쓰지 않으면 루프 자체가 사라져 0초가 나온다.)
//
//   g++ -std=c++17 -O2 tools/bench/modpow_bruteforce.cpp -o /tmp/modpow && /tmp/modpow

#include <chrono>
#include <cstdint>
#include <iostream>

int main() {
    const int64_t A = 10, C = 1000000007;
    const int64_t B = 2147483647LL;  // 백준 1629 의 지수 상한

    auto t0 = std::chrono::steady_clock::now();
    int64_t acc = 1;
    for (int64_t i = 0; i < B; i++) acc = acc * A % C;
    auto t1 = std::chrono::steady_clock::now();

    double sec = std::chrono::duration<double>(t1 - t0).count();
    std::cout << "brute force  B=" << B << "  result=" << acc << "  " << sec << " s\n";

    // 분할 정복 거듭제곱 — 같은 답을 몇 번의 곱셈으로 내는지 함께 센다.
    t0 = std::chrono::steady_clock::now();
    int64_t base = A % C, e = B, fast = 1, mults = 0;
    while (e > 0) {
        if (e & 1) { fast = fast * base % C; mults++; }
        base = base * base % C; mults++;
        e >>= 1;
    }
    t1 = std::chrono::steady_clock::now();
    sec = std::chrono::duration<double>(t1 - t0).count();
    std::cout << "divide&conq  mults=" << mults << "  result=" << fast << "  " << sec << " s\n";
    return 0;
}
