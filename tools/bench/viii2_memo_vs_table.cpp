// VIII-2 의 C++ 쪽 수치 — 하향식(재귀 메모) vs 상향식(표), 그리고 스택 한도.
//
// 무엇을 재는가
//   1. 재귀 프레임 하나가 실제로 먹는 스택 바이트와, RLIMIT_STACK 으로 역산한 최대 깊이
//   2. 같은 점화식("1로 만들기")을 두 방향으로 풀 때의 시간
//   3. 깊이가 그 한도를 넘으면 무슨 일이 일어나는가
//      -> Python 은 RecursionError 예외로 멈추지만 C++ 은 SIGSEGV 로 죽는다.
//         자식 프로세스로 띄워 종료 신호를 직접 확인한다.
//   4. 브루트포스와의 대조 (M7 부칙 §7)
//
// 측정 환경은 CLAUDE.md §1-3 고정. 빌드·실행:
//   g++ -std=c++17 -O2 -o /tmp/viii2 tools/bench/viii2_memo_vs_table.cpp && /tmp/viii2

#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <vector>
using namespace std;
using Clock = chrono::steady_clock;

static vector<int> memo;

// 하향식 — 필요한 상태만 재귀로 요구하고, 답이 나오면 적어 둔다.
int top_down(int x) {
    if (x == 1) return 0;
    if (memo[x] >= 0) return memo[x];
    int best = top_down(x - 1) + 1;
    if (x % 2 == 0) {
        int c = top_down(x / 2) + 1;
        if (c < best) best = c;
    }
    if (x % 3 == 0) {
        int c = top_down(x / 3) + 1;
        if (c < best) best = c;
    }
    return memo[x] = best;
}

// 상향식 — 작은 것부터 순서대로 전부 채운다.
int bottom_up(int n) {
    vector<int> dp(n + 1, 0);
    for (int x = 2; x <= n; x++) {
        int best = dp[x - 1] + 1;
        if (x % 2 == 0 && dp[x / 2] + 1 < best) best = dp[x / 2] + 1;
        if (x % 3 == 0 && dp[x / 3] + 1 < best) best = dp[x / 3] + 1;
        dp[x] = best;
    }
    return dp[n];
}

// 메모 없는 완전탐색. 작은 n 에서만 돌린다.
int brute(int n) {
    if (n == 1) return 0;
    int best = brute(n - 1) + 1;
    if (n % 2 == 0) { int c = brute(n / 2) + 1; if (c < best) best = c; }
    if (n % 3 == 0) { int c = brute(n / 3) + 1; if (c < best) best = c; }
    return best;
}

// 프레임 하나가 먹는 스택 바이트. 지역 변수의 주소 차이가 곧 프레임 간격이다.
// noinline 이 없으면 -O2 가 재귀를 접어 버려 간격이 0으로 나온다.
static const char* g_base;
static long g_gap;

__attribute__((noinline)) void probe(int depth) {
    volatile char here;
    if (depth == 0) {
        g_base = (const char*)&here;
        probe(1);
    } else {
        g_gap = g_base - (const char*)&here;   // 스택은 아래로 자란다
    }
}

// 자식 프로세스에서 하향식을 돌리고, 정상 종료했는지 신호로 죽었는지 돌려준다.
// 반환: 0 정상, 그 외에는 죽인 신호 번호.
int run_top_down_in_child(int n) {
    fflush(stdout);
    pid_t pid = fork();
    if (pid == 0) {
        memo.assign(n + 1, -1);
        volatile int r = top_down(n);
        (void)r;
        _exit(0);
    }
    int status = 0;
    waitpid(pid, &status, 0);
    if (WIFSIGNALED(status)) return WTERMSIG(status);
    return 0;
}

int main() {
    printf("[1] 재귀 프레임 하나가 먹는 스택과, 거기서 역산한 최대 깊이\n");
    probe(0);
    rlimit rl{};
    getrlimit(RLIMIT_STACK, &rl);
    long long limit = (long long)rl.rlim_cur;
    printf("    프레임 간격      : %ld 바이트\n", g_gap);
    printf("    RLIMIT_STACK     : %lld 바이트 (%.1f MB)\n", limit, limit / 1048576.0);
    if (g_gap > 0 && rl.rlim_cur != RLIM_INFINITY)
        printf("    역산한 최대 깊이 : 약 %lld 프레임\n", limit / g_gap);

    printf("\n[2] 1로 만들기 — 두 방향의 시간 (C++17 -O2)\n");
    for (int n : {50000, 100000}) {
        memo.assign(n + 1, -1);
        auto t0 = Clock::now();
        int a1 = top_down(n);
        double t_td = chrono::duration<double, milli>(Clock::now() - t0).count();

        t0 = Clock::now();
        int a2 = bottom_up(n);
        double t_bu = chrono::duration<double, milli>(Clock::now() - t0).count();

        printf("    n=%8d  답 %2d   하향식 %6.2f ms / 상향식 %6.2f ms  (%.2f배)%s\n",
               n, a1, t_td, t_bu, t_td / t_bu, a1 == a2 ? "" : "  <-- 불일치!");
    }

    printf("\n[3] 깊이가 한도를 넘으면 — Python 은 예외, C++ 은 신호\n");
    for (int n : {100000, 200000, 1000000}) {
        int sig = run_top_down_in_child(n);
        if (sig == 0)
            printf("    n=%8d  하향식 정상 종료 / 상향식 답 %d\n", n, bottom_up(n));
        else
            printf("    n=%8d  하향식 신호 %d 로 죽음(11 = SIGSEGV) / 상향식 답 %d\n",
                   n, sig, bottom_up(n));
    }

    printf("\n[4] 브루트포스 대조 (M7 §7)\n");
    int bad = 0;
    for (int n = 1; n <= 120; n++) {
        memo.assign(n + 1, -1);
        int b = brute(n), t = top_down(n), u = bottom_up(n);
        if (!(b == t && t == u)) {
            bad++;
            printf("    불일치! n=%d brute=%d top=%d bottom=%d\n", n, b, t, u);
        }
    }
    printf("    n=1..120 전부 대조, 불일치 %d건\n", bad);
    return 0;
}
