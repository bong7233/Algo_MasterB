// II-2 §4 — 같은 프레임을 세 가지 방법으로 쪼갠다. 복잡도는 셋 다 O(n).
//
//   g++ -std=c++17 -O2 tools/bench/ii2_parse.cpp -o /tmp/pp && /tmp/pp 200000
//
//   stringstream : getline 으로 한 필드씩. 필드마다 string 객체가 새로 만들어진다
//   substr       : find 로 구분자를 찾고 substr 로 잘라낸다. 역시 복사가 필드마다
//   string_view  : 원본을 가리키는 (포인터, 길이) 쌍만 만든다. 복사가 0회
//
// 갈리는 것은 복사 횟수뿐이다. 파서가 느린 이유는 거의 항상 알고리즘이 아니라
// "필드마다 문자열을 새로 만들고 있다" 이다.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>
using namespace std;

int main(int argc, char** argv) {
    int fields = (argc > 1) ? atoi(argv[1]) : 200000;
    string line;
    for (int i = 0; i < fields; ++i) {
        if (i) line += '|';
        line += "field";
        line += to_string(i);
    }

    auto t0 = chrono::steady_clock::now();
    long long n1 = 0;
    {
        istringstream is(line);
        string tok;
        while (getline(is, tok, '|')) n1 += (long long)tok.size();
    }
    auto t1 = chrono::steady_clock::now();

    long long n2 = 0;
    {
        size_t pos = 0;
        while (true) {
            size_t nx = line.find('|', pos);
            string tok = line.substr(pos, nx == string::npos ? string::npos : nx - pos);
            n2 += (long long)tok.size();
            if (nx == string::npos) break;
            pos = nx + 1;
        }
    }
    auto t2 = chrono::steady_clock::now();

    long long n3 = 0;
    {
        string_view sv(line);
        size_t pos = 0;
        while (true) {
            size_t nx = sv.find('|', pos);
            string_view tok = sv.substr(pos, nx == string_view::npos ? string_view::npos : nx - pos);
            n3 += (long long)tok.size();
            if (nx == string_view::npos) break;
            pos = nx + 1;
        }
    }
    auto t3 = chrono::steady_clock::now();

    double a = chrono::duration<double>(t1 - t0).count();
    double b = chrono::duration<double>(t2 - t1).count();
    double c = chrono::duration<double>(t3 - t2).count();
    printf("필드 %d개, 줄 길이 %zu바이트 (합 %lld/%lld/%lld)\n", fields, line.size(), n1, n2, n3);
    printf("stringstream  %.4f s\n", a);
    printf("substr        %.4f s  (%.1f배 빠름)\n", b, a / b);
    printf("string_view   %.4f s  (%.1f배 빠름)\n", c, a / c);
    return 0;
}
