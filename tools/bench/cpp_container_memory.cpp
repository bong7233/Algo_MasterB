// 0-6 §메모리 배치 — 원소 하나당 실제로 몇 바이트를 먹는지 잰다.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_container_memory.cpp -o /tmp/cm
//   for c in vector deque list set unordered_set map unordered_map; do /tmp/cm $c 1000000; done
//
// 왜 컨테이너마다 프로세스를 따로 띄우는가: 한 프로세스에서 여러 개를 만들면
// 해제된 블록을 할당자가 재활용해 증가분이 뒤섞인다. 한 번에 하나만 만들고
// VmHWM(최대 상주 메모리) 증가분을 본다.
#include <cstdio>
#include <cstring>
#include <deque>
#include <fstream>
#include <list>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using namespace std;

long kb(const char* field) {
    ifstream f("/proc/self/status");
    string line;
    while (getline(f, line))
        if (line.compare(0, strlen(field), field) == 0)
            return atol(line.c_str() + strlen(field));
    return -1;
}

int main(int argc, char** argv) {
    const char* which = (argc > 1) ? argv[1] : "vector";
    int n = (argc > 2) ? atoi(argv[2]) : 1000000;
    long before = kb("VmRSS:");

    // 컨테이너를 전역 수명으로 잡아 두어야 측정 시점까지 살아 있다.
    static vector<int> v;
    static deque<int> d;
    static list<int> l;
    static set<int> s;
    static unordered_set<int> us;
    static map<int, int> m;
    static unordered_map<int, int> um;

    for (int i = 0; i < n; ++i) {
        if (!strcmp(which, "vector")) v.push_back(i);
        else if (!strcmp(which, "deque")) d.push_back(i);
        else if (!strcmp(which, "list")) l.push_back(i);
        else if (!strcmp(which, "set")) s.insert(i);
        else if (!strcmp(which, "unordered_set")) us.insert(i);
        else if (!strcmp(which, "map")) m.emplace(i, i);
        else if (!strcmp(which, "unordered_map")) um.emplace(i, i);
    }

    long after = kb("VmRSS:");
    double per = (after - before) * 1024.0 / n;
    printf("%-14s n=%d  RSS 증가 %ld KB  원소당 %.1f 바이트\n", which, n, after - before, per);
    return 0;
}
