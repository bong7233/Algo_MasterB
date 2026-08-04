// I-2 — 정수 1천만 개를 담는 C++ 컨테이너의 실제 메모리 사용량.
//
// memory_int_array.py 의 C++ 대응이다. 같은 N, 같은 측정 방식(ru_maxrss)을
// 쓴다. 케이스를 한 프로세스에서 연달아 재면 ru_maxrss 가 최대값만 남기므로
// 인자로 케이스 하나를 골라 한 번에 하나씩 잰다.
//
//   g++ -std=c++17 -O2 tools/bench/memory_int_array.cpp -o /tmp/mem
//   for c in base int ll bool; do /tmp/mem $c; done

#include <iostream>
#include <string>
#include <vector>
#include <sys/resource.h>
using namespace std;

const size_t N = 10000000;

double peak_mb() {
    rusage ru{};
    getrusage(RUSAGE_SELF, &ru);
    return ru.ru_maxrss / 1024.0;  // 리눅스의 ru_maxrss 는 KB 단위
}

int main(int argc, char** argv) {
    string kind = argc > 1 ? argv[1] : "int";
    // 값을 쓰지 않으면 커널이 물리 페이지를 배정하지 않아 rss 에 잡히지 않는다.
    // 그래서 전부 한 번씩 건드린다.
    if (kind == "int") {
        vector<int> a(N);
        for (size_t i = 0; i < N; i++) a[i] = (int)i;
        cout << "vector<int>       ";
    } else if (kind == "ll") {
        vector<long long> a(N);
        for (size_t i = 0; i < N; i++) a[i] = (long long)i;
        cout << "vector<long long> ";
    } else if (kind == "bool") {
        vector<bool> a(N);
        for (size_t i = 0; i < N; i++) a[i] = (i & 1);
        cout << "vector<bool>      ";
    } else {
        cout << "baseline          ";
    }
    double mb = peak_mb();
    cout << mb << " MB, 원소당 " << mb * 1024 * 1024 / N << " B\n";
    return 0;
}
