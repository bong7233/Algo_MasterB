/* 경로 모양 트리에서 C++ 재귀 DFS 가 스택을 언제 넘기는가 (IV-8).
 *
 * 측정 환경은 CLAUDE.md §1-3 고정: Ubuntu 24.04 / g++ 13.3.0 / -std=c++17 -O2.
 *
 * Python 과 달리 C++ 의 재귀 깊이는 프로그램이 정할 수 있는 값이 아니라
 * **OS 의 스택 한계**다. 넘기면 예외가 아니라 SIGSEGV 로 죽는다 —
 * 잡을 수도, 되돌릴 수도 없다. 그래서 이 스크립트는 깊이를 인자로 받아
 * 부모 셸이 종료 신호를 관찰하는 형태로 만들었다.
 *
 * 빌드·실행:
 *   g++ -std=c++17 -O2 tools/bench/tree_dfs_recursion_depth.cpp -o /tmp/treedfs
 *   ulimit -s            # 스택 한계(KB)를 먼저 확인한다
 *   for n in 100000 200000 500000 1000000; do /tmp/treedfs $n; echo "rc=$?"; done
 */
#include <cstdlib>
#include <iostream>
#include <vector>
using namespace std;

vector<vector<int>> adj;
vector<int> sz;

// -O2 가 꼬리 재귀로 접어 버리면 깊이 측정이 무의미해진다. 자식 크기를 부모에
// 더하는 후위 작업이 호출 뒤에 남아 있어 실제로 프레임이 쌓인다.
void go(int v, int parent) {
    sz[v] = 1;
    for (int nx : adj[v]) {
        if (nx == parent) continue;
        go(nx, v);
        sz[v] += sz[nx];
    }
}

int main(int argc, char** argv) {
    int n = (argc > 1) ? atoi(argv[1]) : 100000;
    adj.assign(n + 1, {});
    sz.assign(n + 1, 0);
    for (int v = 1; v < n; v++) {
        adj[v].push_back(v + 1);
        adj[v + 1].push_back(v);
    }
    go(1, 0);
    cout << "survived n=" << n << " size[1]=" << sz[1] << "\n";
    return 0;
}
