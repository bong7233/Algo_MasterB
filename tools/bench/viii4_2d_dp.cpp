// VIII-4 의 수치와 정확성 검증 (C++ 판) — 2차원 DP.
//
// 파이썬 판(viii4_2d_dp.py)과 같은 것을 재서 언어 상수 차이를 본다.
//   1. 격자 경로 수: 완전열거 vs DP
//   2. 편집 거리: 전체 표 vs 두 줄 롤링 (시간, 그리고 표가 차지하는 바이트)
//   3. 메모 없는 재귀가 언제 죽는가
//   4. 무작위 대조 — DP vs 완전탐색, 복원한 연산 열이 실제로 A 를 B 로 만드는가
//
// 시간은 3회 재고 중앙값을 쓴다. 측정 환경은 CLAUDE.md §1-3 고정.
//   g++ -std=c++17 -O2 -o /tmp/viii4 tools/bench/viii4_2d_dp.cpp && /tmp/viii4

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <functional>
#include <random>
#include <set>
#include <string>
#include <vector>
using namespace std;
using Clock = chrono::steady_clock;

static double median3(double a, double b, double c) {
    double v[3] = {a, b, c};
    sort(v, v + 3);
    return v[1];
}

// ----------------------------------------------------------- 격자 경로 수

long long grid_paths_dp(int rows, int cols, const set<pair<int, int>>& wall) {
    vector<vector<long long>> dp(rows, vector<long long>(cols, 0));
    dp[0][0] = wall.count({0, 0}) ? 0 : 1;
    for (int r = 0; r < rows; r++)
        for (int c = 0; c < cols; c++) {
            if (r == 0 && c == 0) continue;
            if (wall.count({r, c})) continue;
            long long up = r > 0 ? dp[r - 1][c] : 0;
            long long left = c > 0 ? dp[r][c - 1] : 0;
            dp[r][c] = up + left;
        }
    return dp[rows - 1][cols - 1];
}

long long grid_paths_enumerate(int rows, int cols, const set<pair<int, int>>& wall) {
    function<long long(int, int)> go = [&](int r, int c) -> long long {
        if (r >= rows || c >= cols || wall.count({r, c})) return 0;
        if (r == rows - 1 && c == cols - 1) return 1;
        return go(r + 1, c) + go(r, c + 1);
    };
    if (wall.count({0, 0})) return 0;
    return go(0, 0);
}

// ------------------------------------------------------------- 편집 거리

int edit_dp(const string& a, const string& b, vector<vector<int>>* out) {
    int n = a.size(), m = b.size();
    vector<vector<int>> dp(n + 1, vector<int>(m + 1, 0));
    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;
    for (int i = 1; i <= n; i++)
        for (int j = 1; j <= m; j++) {
            if (a[i - 1] == b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
            else dp[i][j] = 1 + min({dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]});
        }
    int ans = dp[n][m];
    if (out) *out = move(dp);
    return ans;
}

int edit_rolling(const string& a, const string& b) {
    int n = a.size(), m = b.size();
    vector<int> prev(m + 1), cur(m + 1);
    for (int j = 0; j <= m; j++) prev[j] = j;
    for (int i = 1; i <= n; i++) {
        cur[0] = i;
        for (int j = 1; j <= m; j++) {
            if (a[i - 1] == b[j - 1]) cur[j] = prev[j - 1];
            else cur[j] = 1 + min({prev[j], cur[j - 1], prev[j - 1]});
        }
        swap(prev, cur);
    }
    return prev[m];
}

int edit_brute(const string& a, const string& b) {
    function<int(int, int)> go = [&](int i, int j) -> int {
        if (i == 0) return j;
        if (j == 0) return i;
        if (a[i - 1] == b[j - 1]) return go(i - 1, j - 1);
        return 1 + min({go(i - 1, j), go(i, j - 1), go(i - 1, j - 1)});
    };
    return go(a.size(), b.size());
}

// 복원: (연산 종류, A 기준 위치, 인자) 를 순서대로 담는다.
struct Op { char kind; int pos; char ch; };

vector<Op> edit_ops(const string& a, const string& b, const vector<vector<int>>& dp) {
    int i = a.size(), j = b.size();
    vector<Op> ops;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] == b[j - 1] && dp[i][j] == dp[i - 1][j - 1]) { i--; j--; continue; }
        if (i > 0 && j > 0 && dp[i][j] == dp[i - 1][j - 1] + 1) { ops.push_back({'R', i, b[j - 1]}); i--; j--; }
        else if (j > 0 && dp[i][j] == dp[i][j - 1] + 1) { ops.push_back({'I', i + 1, b[j - 1]}); j--; }
        else { ops.push_back({'D', i, a[i - 1]}); i--; }
    }
    reverse(ops.begin(), ops.end());
    return ops;
}

string apply_ops(const string& a, const vector<Op>& ops) {
    string s = a;
    for (int k = (int)ops.size() - 1; k >= 0; k--) {
        const Op& o = ops[k];
        if (o.kind == 'R') s[o.pos - 1] = o.ch;
        else if (o.kind == 'D') s.erase(s.begin() + (o.pos - 1));
        else s.insert(s.begin() + (o.pos - 1), o.ch);
    }
    return s;
}

int main() {
    mt19937 rng(4242);

    printf("[1] 격자 경로 수 — DP vs 경로 완전열거 (벽 없음, 정사각 격자)\n");
    for (int k : {10, 12, 14, 16}) {
        set<pair<int, int>> none;
        double td[3];
        long long ans = 0;
        for (int r = 0; r < 3; r++) {
            auto t0 = Clock::now();
            ans = grid_paths_dp(k, k, none);
            td[r] = chrono::duration<double>(Clock::now() - t0).count();
        }
        auto t0 = Clock::now();
        long long en = grid_paths_enumerate(k, k, none);
        double te = chrono::duration<double>(Clock::now() - t0).count();
        double dp = median3(td[0], td[1], td[2]);
        printf("    %2d×%-2d  경로 %12lld개  일치 %s  완전열거 %9.1f ms  DP %7.3f ms  (%.0f배)\n",
               k, k, ans, ans == en ? "O" : "X", te * 1000, dp * 1000, te / dp);
    }
    {
        set<pair<int, int>> wall = {{1, 2}, {2, 4}};
        printf("    본문 예제 5×6, 벽 (1,2)(2,4): DP=%lld 열거=%lld / 벽 없는 5×6: %lld\n",
               grid_paths_dp(5, 6, wall), grid_paths_enumerate(5, 6, wall),
               grid_paths_dp(5, 6, {}));
    }

    printf("\n[2] 편집 거리 — 전체 표 vs 두 줄 롤링 (2000×2000 = 400만 칸)\n");
    {
        int n = 2000;
        string a, b;
        uniform_int_distribution<int> dc(0, 7);
        for (int i = 0; i < n; i++) a += (char)('a' + dc(rng));
        for (int i = 0; i < n; i++) b += (char)('a' + dc(rng));
        double tf[3], tr[3];
        int df = 0, dr = 0;
        for (int r = 0; r < 3; r++) {
            auto t0 = Clock::now();
            df = edit_dp(a, b, nullptr);
            tf[r] = chrono::duration<double>(Clock::now() - t0).count();
            t0 = Clock::now();
            dr = edit_rolling(a, b);
            tr[r] = chrono::duration<double>(Clock::now() - t0).count();
        }
        printf("    거리 %d (두 판 일치 %s)\n", df, df == dr ? "O" : "X");
        printf("    전체 표 %9.1f ms  표가 차지하는 바이트 %8.2f MB\n",
               median3(tf[0], tf[1], tf[2]) * 1000,
               (double)(n + 1) * (n + 1) * sizeof(int) / 1024 / 1024);
        printf("    두 줄   %9.1f ms  두 줄이 차지하는 바이트 %8.4f MB\n",
               median3(tr[0], tr[1], tr[2]) * 1000,
               (double)2 * (n + 1) * sizeof(int) / 1024 / 1024);
    }

    printf("\n[3] 완전탐색 재귀가 언제 죽는가 (겹치는 글자가 없는 두 문자열)\n");
    for (int k : {6, 8, 10, 12, 13}) {
        string a(k, 'a'), b(k, 'b');
        auto t0 = Clock::now();
        edit_brute(a, b);
        double el = chrono::duration<double>(Clock::now() - t0).count();
        printf("    길이 %3d : %9.1f ms   (표는 %5d칸뿐이다)\n", k, el * 1000, (k + 1) * (k + 1));
    }

    printf("\n[4] 무작위 대조 (M7 부칙 §7)\n");
    {
        int bad = 0, badres = 0, trials = 400;
        uniform_int_distribution<int> dl(0, 7), da(0, 3);
        for (int t = 0; t < trials; t++) {
            string a, b;
            int la = dl(rng), lb = dl(rng);
            for (int i = 0; i < la; i++) a += (char)('a' + da(rng));
            for (int i = 0; i < lb; i++) b += (char)('a' + da(rng));
            vector<vector<int>> dp;
            int d = edit_dp(a, b, &dp);
            if (d != edit_brute(a, b) || d != edit_rolling(a, b)) bad++;
            vector<Op> ops = edit_ops(a, b, dp);
            if ((int)ops.size() != d || apply_ops(a, ops) != b) badres++;
        }
        printf("    편집 거리 %d회 대조(값·롤링), 불일치 %d건\n", trials, bad);
        printf("    복원한 연산 열 %d회 검증(길이·적용 결과), 불일치 %d건\n", trials, badres);

        int badg = 0;
        uniform_int_distribution<int> dr(1, 6);
        for (int t = 0; t < 300; t++) {
            int rows = dr(rng), cols = dr(rng);
            set<pair<int, int>> wall;
            uniform_int_distribution<int> dw(0, 4);
            int nw = dw(rng);
            for (int i = 0; i < nw; i++) {
                int r = rng() % rows, c = rng() % cols;
                if ((r == 0 && c == 0) || (r == rows - 1 && c == cols - 1)) continue;
                wall.insert({r, c});
            }
            if (grid_paths_dp(rows, cols, wall) != grid_paths_enumerate(rows, cols, wall)) badg++;
        }
        printf("    격자 경로 300회 대조, 불일치 %d건\n", badg);
    }
    return 0;
}
