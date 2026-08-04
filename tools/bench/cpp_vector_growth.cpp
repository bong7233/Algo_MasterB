// 0-6 §vector — 재할당이 실제로 언제 일어나는지, 증가 배수가 얼마인지 찍는다.
// 표준은 배수를 정하지 않는다. libstdc++ 이 2배를 쓴다는 것은 관찰이지 보장이 아니다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_vector_growth.cpp -o /tmp/vec_growth && /tmp/vec_growth
#include <cstdio>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    size_t cap = v.capacity();
    printf("push 0회: size=0 capacity=%zu\n", cap);

    const int* base = nullptr;
    int reallocs = 0;
    for (int i = 0; i < 1000; ++i) {
        v.push_back(i);
        if (v.capacity() != cap) {
            printf("push %4d회: size=%4zu capacity=%4zu  (재할당 %d번째, 주소 %s)\n",
                   i + 1, v.size(), v.capacity(), ++reallocs,
                   (base && base != v.data()) ? "바뀜" : "최초");
            cap = v.capacity();
            base = v.data();
        }
    }
    printf("원소 1000개를 넣는 동안 재할당 %d번, 최종 capacity=%zu\n", reallocs, v.capacity());

    // reserve 를 먼저 하면 재할당이 0번이다.
    vector<int> w;
    w.reserve(1000);
    const int* wbase = w.data();
    int wrealloc = 0;
    for (int i = 0; i < 1000; ++i) {
        w.push_back(i);
        if (w.data() != wbase) { ++wrealloc; wbase = w.data(); }
    }
    printf("reserve(1000) 후 1000개: 재할당 %d번, capacity=%zu\n", wrealloc, w.capacity());
    return 0;
}
