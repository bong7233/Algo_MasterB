// II-4 §4 — 같은 일을 재귀로 하는 것과 명시적 스택으로 하는 것의 비용 차이.
//
//   g++ -std=c++17 -O2 tools/bench/ii4_recursion_cost.cpp -o /tmp/rc && /tmp/rc 2000
//
// 대상은 "왼쪽으로만 뻗은 이진 트리" 다. 깊이가 그대로 재귀 깊이가 되고,
// 노드마다 하는 일은 값 하나를 더하는 것뿐이라 순수한 호출 비용이 드러난다.
// depth * rounds 가 총 방문 수이고 두 방식이 같다.
//
// 재귀는 호출마다 스택 프레임(반환 주소·저장 레지스터·지역 변수)을 쌓는다.
// 명시적 스택은 정수 하나를 vector 에 밀어 넣는다. 후자가 싼 것은 당연하지만,
// 요점은 배수가 아니라 "재귀 깊이는 시스템 스택 한도에 묶여 있다" 는 쪽이다.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace std;

struct Node {
    int val;
    Node* left;
    Node* right;
};

static long long sum_rec(Node* p) {
    if (!p) return 0;
    return p->val + sum_rec(p->left) + sum_rec(p->right);
}

static long long sum_iter(Node* root) {
    long long s = 0;
    vector<Node*> st;
    st.push_back(root);
    while (!st.empty()) {
        Node* p = st.back();
        st.pop_back();
        if (!p) continue;
        s += p->val;
        st.push_back(p->right);
        st.push_back(p->left);
    }
    return s;
}

int main(int argc, char** argv) {
    int depth = (argc > 1) ? atoi(argv[1]) : 2000;
    int rounds = 20000000 / depth;   // 총 방문 수를 깊이와 무관하게 고정한다

    vector<Node> pool((size_t)depth);
    for (int i = 0; i < depth; ++i) {
        pool[i].val = 1;
        pool[i].left = (i + 1 < depth) ? &pool[i + 1] : nullptr;
        pool[i].right = nullptr;
    }
    Node* root = &pool[0];

    auto t0 = chrono::steady_clock::now();
    long long a = 0;
    for (int r = 0; r < rounds; ++r) a += sum_rec(root);
    auto t1 = chrono::steady_clock::now();
    long long b = 0;
    for (int r = 0; r < rounds; ++r) b += sum_iter(root);
    auto t2 = chrono::steady_clock::now();

    double tr = chrono::duration<double>(t1 - t0).count();
    double ti = chrono::duration<double>(t2 - t1).count();
    printf("깊이 %d, %d회 반복 (총 방문 %lld회, 합 %lld/%lld)\n",
           depth, rounds, (long long)depth * rounds, a, b);
    printf("재귀        %.4f s\n", tr);
    printf("명시적 스택 %.4f s  (%.2f배)\n", ti, ti / tr);
    return 0;
}
