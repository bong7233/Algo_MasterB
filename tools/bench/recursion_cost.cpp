// III-1 — C++ 쪽 재귀 비용: 스택은 어디서 끝나는가
//
// 기본 스택(ulimit -s, 이 환경에서 8 MB)에서 몇 번째 호출에 스택이 터지는가를 잰다.
// SIGSEGV 를 대체 스택(sigaltstack)에서 받아 깊이를 찍고 정상 종료한다.
// 핸들러가 같은 스택을 쓰면 핸들러 진입 자체가 다시 터져 아무것도 못 찍는다.
//
// 왜 시간 측정이 여기 없는가: -O2 는 단순한 재귀 합을 닫힌 식으로 접어 버려
// "재귀 0.0000초" 같은 무의미한 수를 낸다. 사라진 측정을 숫자로 읽는 것보다
// 아예 재지 않는 편이 낫다. 재귀 대 반복의 시간 비교는 Python 쪽 스크립트에 있다.
//
// 빌드·실행:
//   g++ -std=c++17 -O2 tools/bench/recursion_cost.cpp -o /tmp/rc && ulimit -s && /tmp/rc
#include <csignal>
#include <cstdio>
#include <unistd.h>
using namespace std;

static volatile long long depth = 0;
// glibc 2.34+ 에서 SIGSTKSZ 는 상수가 아니라 sysconf 호출이다. 배열 크기로 못 쓴다.
static char altstack[64 * 1024];

// 컴파일러가 꼬리 호출로 바꾸면 스택이 안 쌓여 측정 자체가 사라진다.
// noinline + 호출 뒤에도 쓰이는 지역 배열로 프레임을 실제로 소비하게 만든다.
__attribute__((noinline)) static void dive() {
    volatile char frame[64];
    frame[0] = (char)depth;
    depth++;
    dive();
    frame[63] = frame[0];
}

static void on_segv(int) {
    char buf[160];
    int n = snprintf(buf, sizeof buf,
                     "스택 오버플로까지 도달한 깊이: %lld (프레임당 약 %lld 바이트)\n",
                     depth, depth ? (8LL * 1024 * 1024) / depth : 0);
    ssize_t ignored = write(1, buf, n);
    (void)ignored;
    _exit(0);
}

int main() {
    stack_t ss;
    ss.ss_sp = altstack;
    ss.ss_size = sizeof altstack;
    ss.ss_flags = 0;
    sigaltstack(&ss, nullptr);
    struct sigaction sa {};
    sa.sa_handler = on_segv;
    sa.sa_flags = SA_ONSTACK;
    sigaction(SIGSEGV, &sa, nullptr);

    dive();
    return 0;
}
