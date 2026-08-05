// shared_ptr 순환이 실제로 메모리를 새게 하는가 — XI-11 §1·§4 의 수치.
//
// 노드 쌍을 20만 개 만들고 전부 놓아 버린 뒤 상주 메모리를 본다.
//   (1) 양쪽 다 shared_ptr  → 참조 계수가 0이 되지 않는다. 소멸자가 안 불린다.
//   (2) 한쪽을 weak_ptr     → 계수가 0이 되고 전부 회수된다.
//   (3) 인덱스(arena)       → 애초에 포인터가 없다.
//
// 빌드: g++ -std=c++17 -O2 tools/bench/cycle_leak.cpp -o /tmp/leak && /tmp/leak

#include <cstdio>
#include <memory>
#include <unistd.h>
#include <vector>
using namespace std;

const int PAIRS = 200000;

static long rss_kb() {
    FILE* f = fopen("/proc/self/statm", "r");
    long size = 0, resident = 0;
    if (f) { if (fscanf(f, "%ld %ld", &size, &resident) != 2) resident = 0; fclose(f); }
    return resident * (sysconf(_SC_PAGESIZE) / 1024);
}

static int alive = 0;

struct StrongNode {
    int id;
    char payload[256];              // 누수를 눈에 보이게 만드는 덩치
    shared_ptr<StrongNode> peer;    // 상대를 강하게 잡는다
    StrongNode(int i) : id(i) { alive++; payload[0] = 0; }
    ~StrongNode() { alive--; }
};

struct WeakNode {
    int id;
    char payload[256];
    weak_ptr<WeakNode> peer;        // 상대를 약하게 본다 — 소유하지 않는다
    WeakNode(int i) : id(i) { alive++; payload[0] = 0; }
    ~WeakNode() { alive--; }
};

int main() {
    long base = rss_kb();

    {
        for (int i = 0; i < PAIRS; i++) {
            auto a = make_shared<StrongNode>(2 * i);
            auto b = make_shared<StrongNode>(2 * i + 1);
            a->peer = b;
            b->peer = a;
        }   // a 와 b 가 범위를 벗어난다. 계수는 1로 남는다 — 서로가 서로를 잡고 있다
    }
    long after_strong = rss_kb();
    printf("shared_ptr 순환 %d쌍\n", PAIRS);
    printf("  살아 있는 노드 %d개 (0이어야 정상)\n", alive);
    printf("  RSS 증가 %ld MB\n", (after_strong - base) / 1024);

    alive = 0;
    long base2 = rss_kb();
    {
        for (int i = 0; i < PAIRS; i++) {
            auto a = make_shared<WeakNode>(2 * i);
            auto b = make_shared<WeakNode>(2 * i + 1);
            a->peer = b;
            b->peer = a;
        }
    }
    printf("weak_ptr 로 한쪽을 끊은 판 %d쌍\n", PAIRS);
    printf("  살아 있는 노드 %d개\n", alive);
    printf("  RSS 증가 %ld MB\n", (rss_kb() - base2) / 1024);

    long base3 = rss_kb();
    {
        struct ArenaNode { int id; char payload[256]; int peer; };
        vector<ArenaNode> arena;
        arena.reserve(2 * PAIRS);
        for (int i = 0; i < PAIRS; i++) {
            arena.push_back({2 * i, {0}, 2 * i + 1});
            arena.push_back({2 * i + 1, {0}, 2 * i});
        }
    }
    printf("인덱스(arena) 판 %d쌍\n", PAIRS);
    printf("  RSS 증가 %ld MB (vector 하나가 사라지면 전부 사라진다)\n",
           (rss_kb() - base3) / 1024);
    return 0;
}
