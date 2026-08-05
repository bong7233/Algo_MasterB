// 0-5 §UB — 부호 있는 정수 오버플로가 -O0 과 -O2 에서 다르게 동작함을 보인다.
//
//   g++ -std=c++17 -O0 tools/bench/cpp_signed_overflow_ub.cpp -o /tmp/ub_o0
//   g++ -std=c++17 -O2 tools/bench/cpp_signed_overflow_ub.cpp -o /tmp/ub_o2
//   /tmp/ub_o0 1 ; /tmp/ub_o2 1     (비교식이 최적화로 상수가 되는가)
//   /tmp/ub_o0 2 ; /tmp/ub_o2 2     (루프 종료 조건이 사라지는가 — 무한 루프)
//
// 2번은 -O2 에서 끝나지 않을 수 있다. `timeout 3` 을 붙여 돌려라.
// 표준은 부호 있는 오버플로를 정의하지 않는다. "돌려 보니 -1 이 나오더라"는
// 관찰이지 보장이 아니고, 최적화 수준을 바꾸면 관찰 자체가 바뀐다.
#include <climits>
#include <cstdio>
#include <cstdlib>

// volatile 로 받아 컴파일러가 호출부에서 값을 전파하지 못하게 막는다.
// 그래야 "런타임에 결정되는 값"에 대한 최적화를 관찰할 수 있다.
volatile int sink;

__attribute__((noinline)) bool always_true(int x) {
    return x + 1 > x;  // 오버플로가 없다고 가정하면 항상 참
}

__attribute__((noinline)) int count_up_to(int n) {
    int cnt = 0;
    for (int i = 0; i <= n; ++i) {  // n == INT_MAX 면 i <= n 이 거짓이 될 수 없다
        cnt = cnt + 1;
        if (cnt < 0) break;  // 최적화가 지워 버릴 수 있는 가드
    }
    return cnt;
}

int main(int argc, char** argv) {
    int which = (argc > 1) ? atoi(argv[1]) : 1;

    if (which == 1) {
        int x = INT_MAX;
        sink = x;  // 상수 전파 차단
        printf("x = %d\n", (int)sink);
        printf("x + 1 > x  -> %s\n", always_true((int)sink) ? "true" : "false");
        int y = (int)sink;
        int z = y + 1;  // 여기서 이미 UB
        printf("x + 1      -> %d\n", z);
    } else {
        int n = INT_MAX;
        sink = n;
        printf("count_up_to(INT_MAX) 시작\n");
        fflush(stdout);
        printf("cnt = %d\n", count_up_to((int)sink));
    }
    return 0;
}
