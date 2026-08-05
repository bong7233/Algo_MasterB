// 트리 DP 를 재귀로 짤 때 C++ 스택이 어디서 터지는가 — VIII-8 의 C++ 쪽 측정.
//
// 빌드·실행:
//     g++ -std=c++17 -O2 -o /tmp/viii8 tools/bench/viii8_tree_dp_recursion.cpp
//     ulimit -s          # 8192 (KB) 인지 확인
//     /tmp/viii8 <정점 수>
//
// 인자로 받은 정점 수만큼 경로 모양 트리를 만들고 재귀 트리 DP 를 돌린다.
// 살아남으면 답을 찍고 0 으로, 스택을 넘기면 SIGSEGV 로 죽는다. 예외가 아니라
// 신호라서 프로그램 안에서는 잡을 수 없다 — 그것이 이 측정의 요점이다.
// 경계는 바깥 셸에서 이분 탐색으로 찾는다(viii8_stack_probe.sh 참고).
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace std;

vector<vector<int>> adj;
vector<long long> w;
vector<long long> dp0, dp1;

void go(int v, int parent) {
    dp0[v] = 0;
    dp1[v] = w[v];
    for (int nx : adj[v]) {
        if (nx == parent) continue;
        go(nx, v);
        dp0[v] += max(dp0[nx], dp1[nx]);   // 자식이 끝난 뒤에만 더할 수 있다
        dp1[v] += dp0[nx];
    }
}

int main(int argc, char** argv) {
    int n = argc > 1 ? atoi(argv[1]) : 100000;
    adj.assign(n + 1, {});
    w.assign(n + 1, 0);
    dp0.assign(n + 1, 0);
    dp1.assign(n + 1, 0);
    for (int v = 1; v < n; v++) {
        adj[v].push_back(v + 1);
        adj[v + 1].push_back(v);
    }
    for (int v = 1; v <= n; v++) w[v] = (v * 37) % 100 + 1;
    go(1, 0);
    printf("n=%d ok, ans=%lld\n", n, max(dp0[1], dp1[1]));
    return 0;
}
