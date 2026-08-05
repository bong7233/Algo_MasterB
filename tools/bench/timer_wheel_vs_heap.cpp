// XI-8 — 힙 기반 지연 큐 vs 계층 타이머 휠. Python 판과 짝이다.
//
// 부하 두 가지: cancel90(90%가 만료 전 취소 — TCP 재전송의 모양) / expire(전부 만료).
// 두 구조가 같은 발화 결과를 내는지 먼저 확인하고 시간을 잰다.
//
// 빌드: g++ -std=c++17 -O2 tools/bench/timer_wheel_vs_heap.cpp -o /tmp/twh
// 실행: /tmp/twh [N] [반복]
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <map>
#include <queue>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using namespace std;
using clk = chrono::steady_clock;

const int HORIZON = 65536;
const int SLOTS = 64, LEVELS = 3;

struct Load {
    vector<int> delays;
    map<int, vector<int>> cancel_at;
    long cancels = 0;
};

Load workload(int n, int ratio) {
    unsigned long long state = 12345;
    auto rnd = [&] { state = (state * 1103515245ULL + 12345ULL) % (1ULL << 31); return state; };
    Load L;
    L.delays.resize(n);
    for (int tid = 0; tid < n; tid++) {
        int d = (int)((rnd() >> 8) % HORIZON) + 1;
        L.delays[tid] = d;
        if (ratio && (int)((rnd() >> 8) % 10) < ratio) { L.cancel_at[d / 2].push_back(tid); L.cancels++; }
    }
    return L;
}

using Fired = map<int, vector<int>>;

Fired run_heap(const Load& L, bool collect) {
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>> h;
    unordered_set<int> dead;
    Fired fired;
    for (int tid = 0; tid < (int)L.delays.size(); tid++) h.push({L.delays[tid], tid});
    auto z = L.cancel_at.find(0);
    if (z != L.cancel_at.end()) for (int tid : z->second) dead.insert(tid);
    for (int now = 1; now <= HORIZON; now++) {
        auto it = L.cancel_at.find(now);
        if (it != L.cancel_at.end()) for (int tid : it->second) dead.insert(tid);
        vector<int> out;
        while (!h.empty() && h.top().first <= now) {
            int tid = h.top().second;
            h.pop();
            if (!dead.count(tid)) out.push_back(tid);
        }
        if (collect && !out.empty()) { sort(out.begin(), out.end()); fired[now] = out; }
    }
    return fired;
}

Fired run_wheel(const Load& L, bool collect) {
    // 슬롯은 vector, 타이머마다 (층, 칸, 칸 안 위치)를 들고 있어 취소를 O(1) 로 뗀다.
    // 뒤 원소를 빈 자리로 옮기고 pop_back — 순서는 무너지지만 발화 tick 은 그대로다.
    vector<vector<vector<int>>> w(LEVELS, vector<vector<int>>(SLOTS));
    int n = (int)L.delays.size();
    vector<int> due_of(n), lv_of(n, -1), idx_of(n, -1), pos_of(n, -1);
    Fired fired;
    int span[LEVELS], step[LEVELS];
    for (int i = 0; i < LEVELS; i++) {
        step[i] = 1;
        for (int k = 0; k < i; k++) step[i] *= SLOTS;
        span[i] = step[i] * SLOTS;
    }
    auto place = [&](int tid, int now) {
        int d = due_of[tid] - now;
        for (int lv = 0; lv < LEVELS; lv++)
            if (d < span[lv]) {
                int idx = (due_of[tid] / step[lv]) % SLOTS;
                lv_of[tid] = lv;
                idx_of[tid] = idx;
                pos_of[tid] = (int)w[lv][idx].size();
                w[lv][idx].push_back(tid);
                return;
            }
    };
    auto cancel = [&](int tid) {
        int lv = lv_of[tid], idx = idx_of[tid], p = pos_of[tid];
        if (lv < 0) return;
        vector<int>& v = w[lv][idx];
        int moved = v.back();
        v[p] = moved;
        pos_of[moved] = p;
        v.pop_back();
        lv_of[tid] = -1;
    };
    for (int tid = 0; tid < n; tid++) { due_of[tid] = L.delays[tid]; place(tid, 0); }
    auto z = L.cancel_at.find(0);
    if (z != L.cancel_at.end()) for (int tid : z->second) cancel(tid);

    function<void(int, int)> cascade = [&](int lv, int now) {
        if (lv >= LEVELS) return;
        int idx = (now / step[lv]) % SLOTS;
        vector<int> items;
        items.swap(w[lv][idx]);
        for (int tid : items) place(tid, now);
        if (idx == 0) cascade(lv + 1, now);
    };

    for (int now = 1; now <= HORIZON; now++) {
        auto it = L.cancel_at.find(now);
        if (it != L.cancel_at.end()) for (int tid : it->second) cancel(tid);
        if (now % SLOTS == 0) cascade(1, now);
        int idx = now % SLOTS;
        vector<int> out;
        out.swap(w[0][idx]);
        for (int tid : out) lv_of[tid] = -1;
        if (collect && !out.empty()) { sort(out.begin(), out.end()); fired[now] = out; }
    }
    return fired;
}

string med_range(vector<double> xs) {
    sort(xs.begin(), xs.end());
    char b[128];
    snprintf(b, sizeof b, "%.0f (%.0f~%.0f)", xs[xs.size() / 2], xs.front(), xs.back());
    return b;
}

int main(int argc, char** argv) {
    int n = argc > 1 ? atoi(argv[1]) : 100000;
    int reps = argc > 2 ? atoi(argv[2]) : 5;
    printf("타이머 %d개 · tick %d회 · %d회 반복 · 중앙값(최소~최대) ms\n", n, HORIZON, reps);

    const char* names[] = {"cancel90", "expire"};
    int ratios[] = {9, 0};
    for (int s = 0; s < 2; s++) {
        Load L = workload(n, ratios[s]);
        if (run_heap(L, true) != run_wheel(L, true)) { printf("발화 불일치!\n"); return 1; }
        vector<double> hs, ws;
        for (int r = 0; r < reps; r++) {
            auto t0 = clk::now();
            run_heap(L, false);
            hs.push_back(chrono::duration<double, milli>(clk::now() - t0).count());
            t0 = clk::now();
            run_wheel(L, false);
            ws.push_back(chrono::duration<double, milli>(clk::now() - t0).count());
        }
        sort(hs.begin(), hs.end());
        sort(ws.begin(), ws.end());
        printf("\n[%s] 취소 %ld개 · 발화 순서 일치 확인\n", names[s], L.cancels);
        printf("  heap (priority_queue): %s\n", med_range(hs).c_str());
        printf("  wheel (64x3)         : %s\n", med_range(ws).c_str());
        printf("  배수                 : %.1fx\n", hs[hs.size() / 2] / ws[ws.size() / 2]);
    }
}
