// 0-5 §입출력 — cin 동기화 해제와 scanf 의 실제 차이를 잰다.
//
// 왜 프로그램 안에서 재는가: 외부 `time` 은 프로세스 기동 비용(약 1~2ms)을
// 함께 재서 0.02초짜리 차이를 흐린다. 여기서는 main 진입 직후부터 마지막
// 정수를 읽은 시점까지만 잰다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_io_sync.cpp -o /tmp/io_sync
//   /tmp/io_sync cin_sync   < input.txt
//   /tmp/io_sync cin_nosync < input.txt
//   /tmp/io_sync scanf      < input.txt
//
// 입력 형식: 첫 줄 n, 다음 n 개의 정수(공백/개행 구분).
#include <chrono>
#include <cstdio>
#include <cstring>
#include <iostream>
using namespace std;

int main(int argc, char** argv) {
    const char* mode = (argc > 1) ? argv[1] : "cin_sync";
    auto t0 = chrono::steady_clock::now();

    long long sum = 0;
    int n = 0;

    if (strcmp(mode, "scanf") == 0) {
        if (scanf("%d", &n) != 1) return 1;
        for (int i = 0; i < n; ++i) {
            int x;
            if (scanf("%d", &x) != 1) return 1;
            sum += x;
        }
    } else {
        if (strcmp(mode, "cin_nosync") == 0) {
            ios_base::sync_with_stdio(false);
            cin.tie(nullptr);
        }
        cin >> n;
        for (int i = 0; i < n; ++i) {
            int x;
            cin >> x;
            sum += x;
        }
    }

    auto t1 = chrono::steady_clock::now();
    double sec = chrono::duration<double>(t1 - t0).count();
    // 결과는 표준 에러로. 표준 출력을 쓰면 측정 대상 스트림을 건드린다.
    fprintf(stderr, "%s n=%d sum=%lld %.4f\n", mode, n, sum, sec);
    return 0;
}
