// 0-5 §출력 — endl 의 flush 가 실제로 얼마를 먹는지 잰다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_endl_flush.cpp -o /tmp/endl_flush
//   /tmp/endl_flush endl  1000000 > out.txt
//   /tmp/endl_flush nl    1000000 > out.txt
//   /tmp/endl_flush nl_nosync 1000000 > out.txt
//
// 출력 대상을 파일로 두는 것이 중요하다. /dev/null 로 보내면 커널이 쓰기를
// 통째로 버려서 flush 비용이 실제보다 작게 나온다.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
using namespace std;

int main(int argc, char** argv) {
    const char* mode = (argc > 1) ? argv[1] : "endl";
    int n = (argc > 2) ? atoi(argv[2]) : 1000000;

    if (strcmp(mode, "nl_nosync") == 0) {
        ios_base::sync_with_stdio(false);
        cin.tie(nullptr);
    }

    auto t0 = chrono::steady_clock::now();
    if (strcmp(mode, "endl") == 0) {
        for (int i = 0; i < n; ++i) cout << i << endl;
    } else {
        for (int i = 0; i < n; ++i) cout << i << '\n';
    }
    cout.flush();
    auto t1 = chrono::steady_clock::now();

    fprintf(stderr, "%s n=%d %.4f\n", mode, n, chrono::duration<double>(t1 - t0).count());
    return 0;
}
