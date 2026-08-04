// 0-7 §unique — unique 는 지우지 않는다. 무엇을 남기는지 눈으로 본다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_unique_erase.cpp -o /tmp/ue && /tmp/ue
#include <algorithm>
#include <cstdio>
#include <vector>
using namespace std;

void dump(const char* tag, const vector<int>& v) {
    printf("%-22s size=%zu  [", tag, v.size());
    for (size_t i = 0; i < v.size(); ++i) printf("%s%d", i ? ", " : "", v[i]);
    printf("]\n");
}

int main() {
    vector<int> a = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5};
    dump("원본", a);

    sort(a.begin(), a.end());
    dump("정렬 후", a);

    vector<int> b = a;
    auto it = unique(b.begin(), b.end());
    printf("unique 반환 위치: 앞에서 %td번째\n", it - b.begin());
    dump("unique 만 호출", b);          // 뒤쪽에 쓰레기가 남아 있다

    vector<int> c = a;
    c.erase(unique(c.begin(), c.end()), c.end());
    dump("unique + erase", c);

    // 정렬하지 않고 unique 를 부르면 인접 중복만 지운다 — 흔한 오해
    vector<int> d = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5};
    d.erase(unique(d.begin(), d.end()), d.end());
    dump("정렬 없이 unique+erase", d);
    return 0;
}
