// 0-6 §이터레이터 무효화 — 재할당을 건너 살아남은 참조가 무엇을 읽는지 본다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_iterator_invalidation.cpp -o /tmp/inval && /tmp/inval
//   g++ -std=c++17 -O2 -fsanitize=address tools/bench/cpp_iterator_invalidation.cpp \
//       -o /tmp/inval_asan && /tmp/inval_asan
//
// 두 번째 명령이 핵심이다. 최적화만 켠 빌드는 조용히 쓰레기를 읽고 끝나서
// "동작하는 것처럼" 보인다. ASan 을 붙이면 heap-use-after-free 로 잡힌다.
#include <cstdio>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(10);
    v.push_back(20);

    int& first = v[0];              // 지금은 유효한 참조
    const int* addr_before = v.data();
    printf("재할당 전: first=%d  data=%p  capacity=%zu\n",
           first, (const void*)addr_before, v.capacity());

    for (int i = 0; i < 100; ++i) v.push_back(i);  // 이 사이에 재할당이 일어난다

    const int* addr_after = v.data();
    printf("재할당 후: data=%p  capacity=%zu  주소 %s\n",
           (const void*)addr_after, v.capacity(),
           addr_before == addr_after ? "그대로" : "바뀜");
    printf("죽은 참조 읽기: first=%d  (v[0] 의 진짜 값은 %d)\n", first, v[0]);
    return 0;
}
