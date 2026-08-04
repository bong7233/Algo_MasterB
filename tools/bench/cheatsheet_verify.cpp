// 0-13 — 치트시트의 모든 대응을 실제로 돌려 확인한다 (C++ 쪽).
//
// cheatsheet_verify.py 와 **같은 라벨로 같은 값을 출력한다.**
// 두 출력을 diff 했을 때 남는 줄이 곧 "언어가 실제로 갈리는 지점"이고,
// 그 목록이 0-13 의 함정 표가 된다.
//
// 출력 형식은 Python 의 repr 을 흉내 낸다. 컨테이너를 `[1, 2, 3]`,
// 튜플을 `(1, 'a')`, 불리언을 `True/False` 로 찍는 것은 취향이 아니라
// diff 를 성립시키기 위한 조건이다.
//
// 빌드/실행:
//   g++ -std=c++17 -O2 tools/bench/cheatsheet_verify.cpp -o /tmp/cv
//   /tmp/cv > /tmp/cpp.txt && diff /tmp/py.txt /tmp/cpp.txt

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <deque>
#include <iostream>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>
using namespace std;

// --- Python repr 흉내 ------------------------------------------------------
// 라벨 폭은 **코드포인트 수**로 센다. printf 의 %-34s 는 바이트로 세기
// 때문에 한글이 든 라벨에서 Python 과 어긋난다.
static size_t cp_len(const string& s) {
    size_t n = 0;
    for (unsigned char c : s)
        if ((c & 0xC0) != 0x80) ++n;
    return n;
}

static void p(const string& label, const string& value) {
    string pad(cp_len(label) < 34 ? 34 - cp_len(label) : 0, ' ');
    cout << label << pad << "| " << value << "\n";
}
static void p(const string& label, long long v) { p(label, to_string(v)); }
static void p(const string& label, bool v) { p(label, string(v ? "True" : "False")); }

static string q(const string& s) { return "'" + s + "'"; }

template <typename T>
static string join_repr(const vector<T>& v, string (*f)(const T&)) {
    string out = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ", ";
        out += f(v[i]);
    }
    return out + "]";
}
static string r_int(const int& x) { return to_string(x); }
static string r_str(const string& x) { return q(x); }

static string repr(const vector<int>& v) { return join_repr<int>(v, r_int); }
static string repr(const deque<int>& v) {
    return repr(vector<int>(v.begin(), v.end()));
}
static string repr(const vector<string>& v) { return join_repr<string>(v, r_str); }
static string repr(const vector<vector<int>>& g) {
    string out = "[";
    for (size_t i = 0; i < g.size(); ++i) {
        if (i) out += ", ";
        out += repr(g[i]);
    }
    return out + "]";
}
static string repr(int a, int b) { return "(" + to_string(a) + ", " + to_string(b) + ")"; }
static string repr(const vector<pair<string, int>>& v) {
    string out = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ", ";
        out += "(" + q(v[i].first) + ", " + to_string(v[i].second) + ")";
    }
    return out + "]";
}
static string repr(const vector<pair<int, string>>& v) {
    string out = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ", ";
        out += "(" + to_string(v[i].first) + ", " + q(v[i].second) + ")";
    }
    return out + "]";
}
static string repr(const vector<pair<int, int>>& v) {
    string out = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ", ";
        out += "(" + to_string(v[i].first) + ", " + to_string(v[i].second) + ")";
    }
    return out + "]";
}

int main() {
    // --- 동적 배열 --------------------------------------------------------
    vector<int> a = {5, 1, 4, 1, 3};
    p("list literal", repr(a));
    a.push_back(9);
    p("append/push_back", repr(a));
    p("len/size", (long long)a.size());
    p("a[0], a[-1] / a.front(), a.back()", repr(a.front(), a.back()));
    p("slice a[1:4] / 부분 복사", repr(vector<int>(a.begin() + 1, a.begin() + 4)));
    a.pop_back();
    p("pop/pop_back", repr(a));
    {
        vector<int> s = a;
        sort(s.begin(), s.end());
        p("sorted / sort", repr(s));
        sort(s.begin(), s.end(), greater<int>());
        p("reverse sorted", repr(s));
    }
    p("in / find", find(a.begin(), a.end(), 4) != a.end());
    p("index / find 위치", (long long)(find(a.begin(), a.end(), 4) - a.begin()));
    p("count", (long long)count(a.begin(), a.end(), 1));

    // --- 2차원 ------------------------------------------------------------
    vector<vector<int>> g(2, vector<int>(3, 0));
    g[0][1] = 7;
    p("2D init 후 g[0][1]=7", repr(g));

    // --- 덱 ---------------------------------------------------------------
    deque<int> d = {2, 3};
    d.push_front(1);
    d.push_back(4);
    p("deque appendleft/append", repr(d));
    {
        int front = d.front();
        d.pop_front();
        p("popleft/pop_front", (long long)front);
        int back = d.back();
        d.pop_back();
        p("pop/pop_back", (long long)back);
    }

    // --- 해시맵 -----------------------------------------------------------
    {
        unordered_map<string, int> m;
        for (const string& w : vector<string>{"a", "b", "a", "c", "a"}) m[w] += 1;
        vector<pair<string, int>> items(m.begin(), m.end());
        sort(items.begin(), items.end());
        p("dict 카운트", repr(items));
        // operator[] 는 없는 키를 만들어 버린다. count 로 먼저 확인한다.
        p("dict get 기본값", (long long)(m.count("z") ? m["z"] : 0));
        p("in / count(key)", m.count("b") > 0);

        map<string, vector<int>> dd;  // defaultdict(list) 대응
        dd["x"].push_back(1);
        dd["x"].push_back(2);
        p("defaultdict(list)", "{'x': " + repr(dd["x"]) + "}");

        map<char, int> cnt;
        for (char c : string("aabbbcc")) cnt[c] += 1;
        auto best = max_element(cnt.begin(), cnt.end(),
                                [](auto& l, auto& r) { return l.second < r.second; });
        p("Counter most_common(1)",
          "[(" + q(string(1, best->first)) + ", " + to_string(best->second) + ")]");
    }

    // --- 집합 -------------------------------------------------------------
    {
        set<int> s1 = {1, 2, 3}, s2 = {2, 3, 4};
        vector<int> out;
        set_intersection(s1.begin(), s1.end(), s2.begin(), s2.end(), back_inserter(out));
        p("set 교집합", repr(out));
        out.clear();
        set_union(s1.begin(), s1.end(), s2.begin(), s2.end(), back_inserter(out));
        p("set 합집합", repr(out));
        out.clear();
        set_difference(s1.begin(), s1.end(), s2.begin(), s2.end(), back_inserter(out));
        p("set 차집합", repr(out));
    }

    // --- 정렬된 맵 / 이분 탐색 --------------------------------------------
    {
        vector<int> b = {1, 3, 3, 5, 7, 9};
        auto lo = lower_bound(b.begin(), b.end(), 3);
        auto hi = upper_bound(b.begin(), b.end(), 3);
        p("bisect_left / lower_bound", (long long)(lo - b.begin()));
        p("bisect_right / upper_bound", (long long)(hi - b.begin()));
        p("개수 = upper - lower", (long long)(hi - lo));
        p("bisect_left 없는 값", (long long)(lower_bound(b.begin(), b.end(), 4) - b.begin()));
    }

    // --- 힙 ---------------------------------------------------------------
    {
        // priority_queue 의 기본은 **최대** 힙이다. heapq 와 반대다.
        priority_queue<int, vector<int>, greater<int>> h;  // 최소 힙으로 맞춘다
        for (int v : {5, 1, 4}) h.push(v);
        p("heap 기본 방향에서 첫 pop", (long long)h.top());
        priority_queue<int> h2;  // 기본값 = 최대 힙
        for (int v : {5, 1, 4}) h2.push(v);
        p("최대 힙 흉내 첫 pop", (long long)h2.top());
    }

    // --- 정렬 키·비교자 ---------------------------------------------------
    {
        vector<pair<int, string>> ps = {{2, "b"}, {1, "c"}, {2, "a"}, {1, "a"}};
        vector<pair<int, string>> v = ps;
        // stable_sort 여야 Python 의 sorted 와 결과가 같다. sort 는 불안정하다.
        stable_sort(v.begin(), v.end(), [](auto& l, auto& r) { return l.first < r.first; });
        p("key=첫 원소 (안정 정렬)", repr(v));
        v = ps;
        sort(v.begin(), v.end(), [](auto& l, auto& r) {
            if (l.first != r.first) return l.first > r.first;
            return l.second < r.second;
        });
        p("key=(-첫, 둘째)", repr(v));
    }

    // --- 관용구 -----------------------------------------------------------
    {
        vector<int> xs = {10, 20, 30};
        vector<pair<int, int>> en;
        for (size_t i = 0; i < xs.size(); ++i) en.push_back({(int)i, xs[i]});
        p("enumerate", repr(en));
        string cs = "abc";
        vector<pair<int, string>> z;
        for (size_t i = 0; i < xs.size(); ++i) z.push_back({xs[i], string(1, cs[i])});
        p("zip", repr(z));
        p("sum / accumulate", (long long)accumulate(xs.begin(), xs.end(), 0));
        p("max / max_element", (long long)*max_element(xs.begin(), xs.end()));
        p("min / min_element", (long long)*min_element(xs.begin(), xs.end()));
        p("any", any_of(xs.begin(), xs.end(), [](int v) { return v > 25; }));
        p("all", all_of(xs.begin(), xs.end(), [](int v) { return v > 5; }));
        vector<int> ps2(xs.size());
        partial_sum(xs.begin(), xs.end(), ps2.begin());
        p("누적합 / partial_sum", repr(ps2));
        vector<int> rv(xs.rbegin(), xs.rend());
        p("reversed", repr(rv));
        vector<int> sq;
        for (int v : xs) sq.push_back(v * v);
        p("list comprehension / transform", repr(sq));
        vector<int> u = {3, 1, 3, 2};
        sort(u.begin(), u.end());
        u.erase(unique(u.begin(), u.end()), u.end());
        p("중복 제거 후 정렬", repr(u));
    }

    // --- 문자열 -----------------------------------------------------------
    {
        string t = "the quick brown";
        vector<string> parts;
        {
            istringstream iss(t);
            string w;
            while (iss >> w) parts.push_back(w);
        }
        p("split", repr(parts));
        string joined;
        for (size_t i = 0; i < parts.size(); ++i) joined += (i ? "-" : "") + parts[i];
        p("join", joined);
        p("substr", t.substr(4, 5));
        p("find", (long long)t.find("quick"));
        string rev(t.rbegin(), t.rend());
        p("문자열 뒤집기", rev);
        p("정수 -> 문자열", to_string(12345) + "!");
        p("문자열 -> 정수", (long long)stoi("00042") + 1);
        p("문자 코드", (long long)(int)'a');
        p("코드 -> 문자", string(1, (char)98));
    }

    // --- 순열 -------------------------------------------------------------
    {
        vector<int> v = {1, 2, 3};
        int cnt = 1;  // next_permutation 은 현재 순열부터 세지 않는다
        vector<vector<int>> first_two;
        first_two.push_back(v);
        vector<int> w = v;
        while (next_permutation(w.begin(), w.end())) {
            ++cnt;
            if ((int)first_two.size() < 2) first_two.push_back(w);
        }
        p("순열 개수 (3개)", (long long)cnt);
        p("첫 두 순열", repr(first_two));
    }

    // --- 수 ---------------------------------------------------------------
    p("정수 나눗셈 양수 7/2", (long long)(7 / 2));
    p("정수 나눗셈 음수 -7/2", (long long)(-7 / 2));
    p("나머지 음수 -7%2", (long long)(-7 % 2));
    {
        long long base = 2, e = 100, mod = 1000000007, r = 1;
        base %= mod;
        while (e) {
            if (e & 1) r = r * base % mod;
            base = base * base % mod;
            e >>= 1;
        }
        p("거듭제곱 mod", r);
    }
    p("gcd", (long long)__gcd(12, 18));
    p("정수 상한", to_string(9223372036854775807LL));
    {
        // 부호 없는 정수의 넘침은 정의된 동작이다(2^64 로 나눈 나머지).
        // 부호 있는 정수였다면 UB 라 어떤 값이 나오든 근거가 없다.
        unsigned long long x = 1ULL << 63;
        x = x * 2;
        p("2^64 계산", to_string(x));
    }
    p("실수 0.1+0.2 == 0.3", 0.1 + 0.2 == 0.3);
    {
        char buf[64];
        snprintf(buf, sizeof(buf), "%.17f", 0.1 + 0.2);
        p("실수 0.1+0.2", string(buf));
    }
    p("floor / trunc (-3.5)", repr((int)floor(-3.5), (int)trunc(-3.5)));
    return 0;
}
