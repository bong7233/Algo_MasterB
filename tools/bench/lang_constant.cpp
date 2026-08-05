// 0-10 — Python 과 C++ 의 상수 배수 (C++ 쪽).
//
// lang_constant.py 와 워크로드가 1:1 로 대응한다.
//   1. 입출력  2. 재귀  3. 문자열 누적
//
// 입출력은 반드시 **별도 프로세스**에서 잰다. 한 프로세스 안에서
// `cin.rdbuf()` 를 파일 버퍼로 바꿔치기하면 sync_with_stdio 가 손대는
// 대상(C 표준 stdin 과의 동기화 계층)을 아예 비켜 가서, 껐는데도 차이가
// 없다는 잘못된 결론이 나온다. 그래서 argv 로 모드를 받아 자기 자신을
// 리다이렉션과 함께 다시 실행한다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/lang_constant.cpp -o /tmp/lang_constant
//   /tmp/lang_constant

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <initializer_list>
#include <iostream>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>
using namespace std;

static const int REPS = 3;
static const int N_INPUT = 1000000;
static const char* DATA = "/tmp/algobook_lang_constant_input.txt";
static long long g_sink = 0;

static double median3(double a, double b, double c) {
    double v[3] = {a, b, c};
    sort(v, v + 3);
    return v[1];
}

static void make_input() {
    struct stat st;
    if (stat(DATA, &st) == 0 && st.st_size > 0) return;
    FILE* f = fopen(DATA, "w");
    fprintf(f, "%d\n", N_INPUT);
    for (long long i = 0; i < N_INPUT; ++i)
        fprintf(f, "%lld\n", (i * 2654435761LL) % 1000000007LL);
    fclose(f);
}

// --- 자식 프로세스로 도는 워크로드 -----------------------------------------

static int child(const char* mode) {
    if (!strcmp(mode, "cin_sync")) {
        // 기본값 그대로. cin 이 매 연산마다 C 의 stdin 과 상태를 맞춘다.
        int n;
        cin >> n;
        long long s = 0, x;
        for (int i = 0; i < n; ++i) { cin >> x; s += x; }
        fprintf(stderr, "%lld\n", s);
    } else if (!strcmp(mode, "cin_fast")) {
        ios_base::sync_with_stdio(false);
        cin.tie(nullptr);
        int n;
        cin >> n;
        long long s = 0, x;
        for (int i = 0; i < n; ++i) { cin >> x; s += x; }
        fprintf(stderr, "%lld\n", s);
    } else if (!strcmp(mode, "scanf")) {
        int n;
        if (scanf("%d", &n) != 1) return 1;
        long long s = 0, x;
        for (int i = 0; i < n; ++i) { if (scanf("%lld", &x) != 1) return 1; s += x; }
        fprintf(stderr, "%lld\n", s);
    } else if (!strcmp(mode, "print_endl")) {
        for (int i = 0; i < N_INPUT; ++i) cout << i << endl;  // 줄마다 flush
    } else if (!strcmp(mode, "print_nl")) {
        ios_base::sync_with_stdio(false);
        for (int i = 0; i < N_INPUT; ++i) cout << i << "\n";
    } else if (!strcmp(mode, "printf")) {
        for (int i = 0; i < N_INPUT; ++i) printf("%d\n", i);
    } else {
        return 1;
    }
    return 0;
}

static string self_path() {
    char buf[4096];
    ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
    buf[n > 0 ? n : 0] = '\0';
    return string(buf);
}

static double run_child(const string& exe, const char* mode, bool with_stdin) {
    string cmd = exe + " " + mode;
    cmd += with_stdin ? string(" < ") + DATA : string("");
    cmd += " > /dev/null 2> /dev/null";
    double t[REPS];
    for (int r = 0; r < REPS; ++r) {
        auto t0 = chrono::steady_clock::now();
        if (system(cmd.c_str()) != 0) fprintf(stderr, "child failed: %s\n", mode);
        auto t1 = chrono::steady_clock::now();
        t[r] = chrono::duration<double>(t1 - t0).count();
    }
    return median3(t[0], t[1], t[2]);
}

// --- 재귀 ------------------------------------------------------------------
// noinline 이 없으면 -O2 가 fib 을 호출 지점에 펼쳐 "재귀 호출 비용"이 사라진다.
__attribute__((noinline)) static long long fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}

static long long fib_iter(int n) {
    long long a = 0, b = 1;
    for (int i = 0; i < n; ++i) { long long t = a + b; a = b; b = t; }
    return a;
}

__attribute__((noinline)) static int depth_fn(int n) {
    if (n == 0) return 0;
    return 1 + depth_fn(n - 1);
}

// --- 문자열 ----------------------------------------------------------------
static size_t str_concat(int n) {
    string s;
    for (int i = 0; i < n; ++i) s += 'x';
    return s.size();
}

static size_t str_reserve(int n) {
    string s;
    s.reserve(n);
    for (int i = 0; i < n; ++i) s += 'x';
    return s.size();
}

template <typename F>
static double timeit(F f) {
    double t[REPS];
    for (int r = 0; r < REPS; ++r) {
        auto t0 = chrono::steady_clock::now();
        f();
        auto t1 = chrono::steady_clock::now();
        t[r] = chrono::duration<double>(t1 - t0).count();
    }
    return median3(t[0], t[1], t[2]);
}

int main(int argc, char** argv) {
    if (argc > 1) return child(argv[1]);

    make_input();
    string exe = self_path();
    printf("입력 파일: %s (정수 %d개)\n", DATA, N_INPUT);
    printf("입출력은 별도 프로세스에서 측정 (프로세스 기동 시간 포함)\n");

    printf("\n=== 입력 읽기 (정수 100만 개) ===\n");
    double slowest = run_child(exe, "cin_sync", true);
    printf("  %-32s %7.3fs   가장 느린 방법 대비 x%5.1f\n", "cin (sync_with_stdio 기본)", slowest, 1.0);
    for (const char* m : {"cin_fast", "scanf"}) {
        double t = run_child(exe, m, true);
        const char* label = !strcmp(m, "cin_fast") ? "cin (sync 끄고 tie(nullptr))" : "scanf";
        printf("  %-32s %7.3fs   가장 느린 방법 대비 x%5.1f\n", label, t, slowest / t);
    }

    printf("\n=== 출력 쓰기 (정수 100만 줄) ===\n");
    double w1 = run_child(exe, "print_endl", false);
    printf("  %-32s %7.3fs   가장 느린 방법 대비 x%5.1f\n", "cout << endl (줄마다 flush)", w1, 1.0);
    for (const char* m : {"print_nl", "printf"}) {
        double t = run_child(exe, m, false);
        const char* label = !strcmp(m, "print_nl") ? "cout << '\\n' (sync 끔)" : "printf";
        printf("  %-32s %7.3fs   가장 느린 방법 대비 x%5.1f\n", label, t, w1 / t);
    }

    printf("\n=== 재귀 ===\n");
    double rec = timeit([] { g_sink += fib(30); });
    printf("  fib(30) 재귀       %8.4fs   (논리 호출 2,692,537회)\n", rec);
    double it = timeit([] { g_sink += fib_iter(30); });
    printf("  fib(30) 반복       %8.4fus  (같은 답, 호출 0회)\n", it * 1e6);

    printf("\n  재귀 깊이: 기본 스택(ulimit -s 8MB)에서\n");
    for (int d : {10000, 100000, 200000}) {
        g_sink += depth_fn(d);
        printf("    깊이 %7d: 통과\n", d);
    }

    printf("\n=== 문자열 누적 (100만 문자) ===\n");
    double c = timeit([] { g_sink += (long long)str_concat(1000000); });
    double j = timeit([] { g_sink += (long long)str_reserve(1000000); });
    printf("  s += 'x'            %7.4fs\n", c);
    printf("  reserve 후 s += 'x' %7.4fs   x%.1f\n", j, c / j);

    if (g_sink == 12345678987654321LL) printf("unreachable\n");
    return 0;
}
