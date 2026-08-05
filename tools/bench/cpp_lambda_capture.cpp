// 0-8 §람다 캡처 — 참조 캡처가 원본보다 오래 사는 순간 무엇을 읽는지.
//
//   g++ -std=c++17 -O2 tools/bench/cpp_lambda_capture.cpp -o /tmp/lc && /tmp/lc
//   g++ -std=c++17 -O2 -fsanitize=address tools/bench/cpp_lambda_capture.cpp -o /tmp/lc_asan
//   /tmp/lc_asan     # stack-use-after-return 으로 잡힌다
#include <cstdio>
#include <functional>
#include <vector>
using namespace std;

// 값 캡처: 클로저가 threshold 의 복사본을 들고 다닌다. 안전하다.
function<bool(int)> make_pred_by_value() {
    int threshold = 10;
    return [threshold](int x) { return x > threshold; };
}

// 참조 캡처: 클로저가 threshold 의 주소를 들고 다닌다. 함수가 끝나면 그 주소는 죽는다.
function<bool(int)> make_pred_by_ref() {
    int threshold = 10;
    return [&threshold](int x) { return x > threshold; };
}

int main() {
    auto ok = make_pred_by_value();
    printf("값 캡처:  pred(5)=%d pred(50)=%d\n", (int)ok(5), (int)ok(50));

    auto bad = make_pred_by_ref();
    // 죽은 프레임 위에 다른 함수를 한 번 올려 스택을 덮어쓴다.
    volatile int noise[64];
    for (int i = 0; i < 64; ++i) noise[i] = 123456;
    printf("참조 캡처: pred(5)=%d pred(50)=%d  (값은 실행마다 달라질 수 있다)\n",
           (int)bad(5), (int)bad(50));

    // 캡처한 값을 수정하려면 mutable — 값 캡처는 기본이 const 다.
    // 한 printf 안에서 bump() 를 세 번 부르면 안 된다 — C++17 은 함수 인자의
    // 평가 순서를 정하지 않는다. 순서가 보이게 하려면 따로 부른다.
    int count = 0;
    auto bump = [count]() mutable { return ++count; };
    int b1 = bump(), b2 = bump(), b3 = bump();
    printf("mutable 값 캡처: %d %d %d, 바깥 count=%d\n", b1, b2, b3, count);

    int total = 0;
    vector<int> v = {1, 2, 3, 4};
    for (int x : v) {
        auto add = [&total](int y) { total += y; };  // 같은 스코프 안이라 안전
        add(x);
    }
    printf("참조 캡처(같은 스코프): total=%d\n", total);
    return 0;
}
