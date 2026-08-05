// 공간 인덱스 세 판의 최근접 탐색 비용 — XI-9 §2 의 갈림길 표를 뒷받침한다.
//
//   전수 비교 / 그리드 해싱(링 확장) / KD 트리(가지치기)
//   × 균일 분포 / 뭉친 분포(군집 100개)
//
// 셋 다 같은 답을 내는지 먼저 대조하고, 그다음 시간을 잰다.
// 5회 실행의 중앙값과 범위를 찍는다 — 한 번 돌린 값은 근거가 아니다.
//
// 빌드: g++ -std=c++17 -O2 tools/bench/spatial_index_bench.cpp -o /tmp/sib && /tmp/sib

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <random>
#include <unordered_map>
#include <vector>
using namespace std;

const int N = 100000;
const int Q = 5000;
const double EXTENT = 1000.0;

struct Pt { double x, y; };

static double d2(const Pt& a, const Pt& b) {
    double dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
}

// ---------- 전수 비교 ----------
static int brute(const vector<Pt>& pts, const Pt& q) {
    double bd = 1e30; int bi = -1;
    for (int i = 0; i < (int)pts.size(); i++) {
        double d = d2(pts[i], q);
        if (d < bd) { bd = d; bi = i; }
    }
    return bi;
}

// ---------- 그리드 해싱 ----------
struct Grid {
    double cell;
    unordered_map<long long, vector<int>> buckets;
    const vector<Pt>* pts;

    long long key(int cx, int cy) const { return (long long)cx * 1000003LL + cy; }

    void build(const vector<Pt>& p, double c) {
        pts = &p; cell = c; buckets.clear();
        for (int i = 0; i < (int)p.size(); i++)
            buckets[key((int)floor(p[i].x / cell), (int)floor(p[i].y / cell))].push_back(i);
    }

    // 링을 하나씩 넓히며 본다. 링의 최소 가능 거리가 현재 최선을 넘으면 멈춘다.
    int nearest(const Pt& q, long long& examined) const {
        int qx = (int)floor(q.x / cell), qy = (int)floor(q.y / cell);
        double bd = 1e30; int bi = -1;
        for (int r = 0;; r++) {
            if (bi >= 0) {
                double ring_min = (r - 1) * cell;
                if (ring_min > 0 && ring_min * ring_min > bd) break;
            }
            bool any = false;
            for (int cx = qx - r; cx <= qx + r; cx++)
                for (int cy = qy - r; cy <= qy + r; cy++) {
                    if (max(abs(cx - qx), abs(cy - qy)) != r) continue;  // 테두리만
                    auto it = buckets.find(key(cx, cy));
                    if (it == buckets.end()) continue;
                    any = true;
                    for (int i : it->second) {
                        examined++;
                        double d = d2((*pts)[i], q);
                        if (d < bd) { bd = d; bi = i; }
                    }
                }
            (void)any;
            if (r > 2000) break;
        }
        return bi;
    }
};

// ---------- 조밀 그리드 (해시 없이 평면 배열 + 계수 정렬) ----------
// 좌표 범위가 유계이고 균일하면 해시가 필요 없다. 셀 번호가 곧 배열 첨자다.
// 배치는 CSR 과 같다 — start[] 와 이어붙인 item[] 두 배열뿐이다(XI-10).
struct DenseGrid {
    double cell;
    int W = 0;
    vector<int> start, item;
    const vector<Pt>* pts;

    int cid(const Pt& p) const {
        int cx = min(W - 1, max(0, (int)(p.x / cell)));
        int cy = min(W - 1, max(0, (int)(p.y / cell)));
        return cx * W + cy;
    }
    void build(const vector<Pt>& p, double c) {
        pts = &p; cell = c;
        W = (int)(EXTENT / cell) + 1;
        start.assign((size_t)W * W + 1, 0);
        item.resize(p.size());
        for (auto& q : p) start[cid(q) + 1]++;
        for (size_t i = 1; i < start.size(); i++) start[i] += start[i - 1];
        vector<int> fill(start.begin(), start.end() - 1);
        for (int i = 0; i < (int)p.size(); i++) item[fill[cid(p[i])]++] = i;
    }
    int nearest(const Pt& q, long long& examined) const {
        int qx = min(W - 1, max(0, (int)(q.x / cell)));
        int qy = min(W - 1, max(0, (int)(q.y / cell)));
        double bd = 1e30; int bi = -1;
        for (int r = 0; r < 2 * W; r++) {
            if (bi >= 0) {
                double ring_min = (r - 1) * cell;
                if (ring_min > 0 && ring_min * ring_min > bd) break;
            }
            for (int cx = max(0, qx - r); cx <= min(W - 1, qx + r); cx++)
                for (int cy = max(0, qy - r); cy <= min(W - 1, qy + r); cy++) {
                    if (max(abs(cx - qx), abs(cy - qy)) != r) continue;
                    int c = cx * W + cy;
                    for (int k = start[c]; k < start[c + 1]; k++) {
                        examined++;
                        double d = d2((*pts)[item[k]], q);
                        if (d < bd) { bd = d; bi = item[k]; }
                    }
                }
        }
        return bi;
    }
};

// ---------- KD 트리 ----------
struct KDTree {
    vector<int> idx;
    const vector<Pt>* pts;

    double coord(int i, int axis) const { return axis ? (*pts)[i].y : (*pts)[i].x; }

    void build(const vector<Pt>& p) {
        pts = &p;
        idx.resize(p.size());
        for (int i = 0; i < (int)p.size(); i++) idx[i] = i;
        rec(0, (int)p.size(), 0);
    }
    void rec(int lo, int hi, int depth) {
        if (hi - lo <= 1) return;
        int axis = depth & 1, mid = (lo + hi) / 2;
        nth_element(idx.begin() + lo, idx.begin() + mid, idx.begin() + hi,
                    [&](int a, int b) { return coord(a, axis) < coord(b, axis); });
        rec(lo, mid, depth + 1);
        rec(mid + 1, hi, depth + 1);
    }

    int nearest(const Pt& q, long long& examined) const {
        double bd = 1e30; int bi = -1;
        go(0, (int)idx.size(), 0, q, bd, bi, examined);
        return bi;
    }
    void go(int lo, int hi, int depth, const Pt& q, double& bd, int& bi, long long& ex) const {
        if (hi - lo <= 0) return;
        int mid = (lo + hi) / 2, axis = depth & 1;
        ex++;
        double d = d2((*pts)[idx[mid]], q);
        if (d < bd) { bd = d; bi = idx[mid]; }
        double diff = (axis ? q.y : q.x) - coord(idx[mid], axis);
        int nlo = diff < 0 ? lo : mid + 1, nhi = diff < 0 ? mid : hi;
        int flo = diff < 0 ? mid + 1 : lo, fhi = diff < 0 ? hi : mid;
        go(nlo, nhi, depth + 1, q, bd, bi, ex);
        if (diff * diff < bd) go(flo, fhi, depth + 1, q, bd, bi, ex);
    }
};

static double ms_of(chrono::steady_clock::time_point a, chrono::steady_clock::time_point b) {
    return chrono::duration<double, milli>(b - a).count();
}

static void report(const char* name, vector<double> v) {
    sort(v.begin(), v.end());
    printf("  %-22s %8.1f ms   (%.1f ~ %.1f)\n", name, v[v.size() / 2], v.front(), v.back());
}

static void run(const char* label, const vector<Pt>& pts, const vector<Pt>& qs, double cell) {
    printf("[%s] 점 %d개 · 질의 %d회 · 셀 %.2f · 5회 중앙값\n", label, N, Q, cell);

    Grid g; g.build(pts, cell);
    DenseGrid dg; dg.build(pts, cell);
    KDTree t; t.build(pts);

    // 먼저 답이 같은지 대조한다. 다르면 속도는 의미가 없다.
    int mismatch = 0;
    long long ex = 0;
    for (int i = 0; i < 200; i++) {
        int a = brute(pts, qs[i]), b = g.nearest(qs[i], ex), c = t.nearest(qs[i], ex);
        int e = dg.nearest(qs[i], ex);
        if (d2(pts[a], qs[i]) != d2(pts[b], qs[i])) mismatch++;
        if (d2(pts[a], qs[i]) != d2(pts[c], qs[i])) mismatch++;
        if (d2(pts[a], qs[i]) != d2(pts[e], qs[i])) mismatch++;
    }
    printf("  대조 200회 불일치 %d건\n", mismatch);

    vector<double> tb, tg, td, tk;
    long long eg = 0, ek = 0, ed = 0;
    for (int rep = 0; rep < 5; rep++) {
        auto t0 = chrono::steady_clock::now();
        long long s = 0;
        for (int i = 0; i < Q / 20; i++) s += brute(pts, qs[i]);   // 전수는 1/20 만 재고 환산
        auto t1 = chrono::steady_clock::now();
        eg = 0;
        for (int i = 0; i < Q; i++) s += g.nearest(qs[i], eg);
        auto t2 = chrono::steady_clock::now();
        ed = 0;
        for (int i = 0; i < Q; i++) s += dg.nearest(qs[i], ed);
        auto t2b = chrono::steady_clock::now();
        ek = 0;
        for (int i = 0; i < Q; i++) s += t.nearest(qs[i], ek);
        auto t3 = chrono::steady_clock::now();
        if (s == -1) printf("x");
        tb.push_back(ms_of(t0, t1) * 20);
        tg.push_back(ms_of(t1, t2));
        td.push_back(ms_of(t2, t2b));
        tk.push_back(ms_of(t2b, t3));
    }
    report("전수 비교(환산)", tb);
    report("그리드 해싱(unordered_map)", tg);
    report("조밀 그리드(평면 배열)", td);
    report("KD 트리", tk);
    printf("  질의당 거리 계산: 전수 %d · 그리드 %.1f · 조밀 %.1f · KD %.1f\n",
           N, (double)eg / Q, (double)ed / Q, (double)ek / Q);
    printf("  버킷 수: 해시 %zu · 조밀 셀 %d(=%d^2)\n\n", g.buckets.size(), dg.W * dg.W, dg.W);
}

int main() {
    mt19937 rng(20260805);
    uniform_real_distribution<double> U(0, EXTENT);

    vector<Pt> uni(N), clu(N), qs(Q);
    for (int i = 0; i < N; i++) uni[i] = {U(rng), U(rng)};

    // 뭉친 분포: 군집 100개, 표준편차 2. 그리드 한 칸에 수천 개가 몰린다.
    vector<Pt> centers(100);
    for (auto& c : centers) c = {U(rng), U(rng)};
    normal_distribution<double> G(0.0, 0.5);
    for (int i = 0; i < N; i++) {
        const Pt& c = centers[i % centers.size()];
        clu[i] = {c.x + G(rng), c.y + G(rng)};
    }
    for (int i = 0; i < Q; i++) qs[i] = {U(rng), U(rng)};

    double cell = EXTENT / sqrt((double)N);
    run("균일 분포", uni, qs, cell);

    // 뭉친 분포에서는 질의도 군집 근처에서 나와야 현실적이다.
    vector<Pt> qc(Q);
    for (int i = 0; i < Q; i++) {
        const Pt& c = centers[i % centers.size()];
        qc[i] = {c.x + G(rng) * 3, c.y + G(rng) * 3};
    }
    run("뭉친 분포", clu, qc, cell);
    run("뭉친 분포 · 셀을 군집 크기에 맞춤", clu, qc, 0.5);
    return 0;
}
