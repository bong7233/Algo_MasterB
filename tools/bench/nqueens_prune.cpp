// III-4 — 가지치기가 탐색 트리를 얼마나 줄이는가 (C++ 쪽 실측).
//
// nqueens_prune.py 와 같은 정의를 쓴다. 노드 = place(row) 호출 1회.
// Python 판과 노드 수가 한 자리도 다르면 둘 중 하나가 틀린 것이다 — 대조용이다.
//
// 빌드·실행: g++ -std=c++17 -O2 tools/bench/nqueens_prune.cpp -o /tmp/nq && /tmp/nq [N]
#include <chrono>
#include <cstdlib>
#include <cstdio>
#include <vector>
using namespace std;

enum Prune { NONE, COL, FULL };

struct Search {
    int n;
    Prune prune;
    vector<char> col, diag1, diag2;
    vector<int> pos;
    long long nodes = 0, solutions = 0;

    Search(int n, Prune p)
        : n(n), prune(p), col(n, 0), diag1(2 * n, 0), diag2(2 * n, 0), pos(n, 0) {}

    bool valid_all() const {
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                if (pos[i] == pos[j] || j - i == abs(pos[j] - pos[i])) return false;
        return true;
    }

    void place(int row) {
        nodes++;
        if (row == n) {
            if (prune == FULL || valid_all()) solutions++;
            return;
        }
        for (int c = 0; c < n; c++) {
            if (prune != NONE && col[c]) continue;
            if (prune == FULL && (diag1[row + c] || diag2[row - c + n])) continue;
            col[c] = diag1[row + c] = diag2[row - c + n] = 1;
            pos[row] = c;
            place(row + 1);
            col[c] = diag1[row + c] = diag2[row - c + n] = 0;
        }
    }
};

int main(int argc, char** argv) {
    int n = argc > 1 ? atoi(argv[1]) : 8;
    printf("N = %d\n", n);
    printf("%-6s %8s %14s %10s\n", "전략", "해", "노드", "시간(초)");
    const char* names[] = {"none", "col", "full"};
    for (int k = 0; k < 3; k++) {
        double best[3];
        long long sols = 0, nodes = 0;
        for (int rep = 0; rep < 3; rep++) {   // 3회 실행의 중앙값
            Search s(n, (Prune)k);
            auto t0 = chrono::steady_clock::now();
            s.place(0);
            auto t1 = chrono::steady_clock::now();
            best[rep] = chrono::duration<double>(t1 - t0).count();
            sols = s.solutions;
            nodes = s.nodes;
        }
        double a = best[0], b = best[1], c = best[2];
        double med = a > b ? (b > c ? b : (a > c ? c : a)) : (a > c ? a : (b > c ? c : b));
        printf("%-6s %8lld %14lld %10.4f\n", names[k], sols, nodes, med);
    }
    return 0;
}
