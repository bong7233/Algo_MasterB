// 0-5 §입출력 — cin.tie(nullptr) 가 무엇을 아끼는지, 그리고 무엇을 깨뜨리는지.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_io_tie.cpp -o /tmp/io_tie
//   /tmp/io_tie tie   < in.txt > /dev/null
//   /tmp/io_tie notie < in.txt > /dev/null
//   /tmp/io_tie mix                       # 동기화 해제 뒤 printf 와 cout 을 섞는다
//
// tie 모드는 읽기와 쓰기를 번갈아 한다. cin 이 cout 에 묶여 있으면 매 읽기 전에
// cout 이 flush 된다. 읽기만 하는 프로그램에서는 차이가 안 난다 — 그래서
// "tie(nullptr) 가 빠르다"는 말은 입출력을 번갈아 할 때만 참이다.
#include <chrono>
#include <cstdio>
#include <cstring>
#include <iostream>
using namespace std;

int main(int argc, char** argv) {
    const char* mode = (argc > 1) ? argv[1] : "tie";

    if (strcmp(mode, "mix") == 0) {
        ios_base::sync_with_stdio(false);
        printf("printf: 1\n");
        cout << "cout: 2\n";
        printf("printf: 3\n");
        cout << "cout: 4\n";
        return 0;  // 순서가 소스 순서와 같은지 보라
    }

    ios_base::sync_with_stdio(false);
    if (strcmp(mode, "notie") == 0) cin.tie(nullptr);

    auto t0 = chrono::steady_clock::now();
    int n;
    cin >> n;
    long long sum = 0;
    for (int i = 0; i < n; ++i) {
        int x;
        cin >> x;          // 읽고
        cout << x << '\n';  // 바로 쓴다 — tie 가 걸려 있으면 여기서 매번 flush 된다
        sum += x;
    }
    cout.flush();
    auto t1 = chrono::steady_clock::now();
    fprintf(stderr, "%s n=%d sum=%lld %.4f\n", mode, n, sum,
            chrono::duration<double>(t1 - t0).count());
    return 0;
}
