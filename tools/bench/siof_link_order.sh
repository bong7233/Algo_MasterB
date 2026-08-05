#!/bin/sh
# XII-12 §3.3 — 번역 단위 사이의 정적 초기화 순서는 정해져 있지 않다.
#
# 같은 소스 세 개를 링크 순서만 바꿔 두 번 빌드한다. g++ 는 대체로 링크 순서대로
# 동적 초기화를 돌리므로, banner.cpp 가 먼저 초기화되면 site_name 은 아직
# 만들어지지 않은 상태에서 읽힌다. 정적 저장 기간 객체는 0으로 채워져 있으므로
# 빈 문자열처럼 보이고, 프로그램은 죽지 않는다.
#
# 측정 환경: CLAUDE.md §1-3 (Ubuntu 24.04 x86-64 / g++ 13.3.0 / -std=c++17 -O2)
# 실행: sh tools/bench/siof_link_order.sh

set -e
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

cat > "$dir/site.cpp" <<'EOF'
#include <string>
std::string site_name = "warehouse-A";
EOF

cat > "$dir/banner.cpp" <<'EOF'
#include <string>
extern std::string site_name;
std::string banner = "hello " + site_name;   // 다른 번역 단위의 전역을 읽는다
EOF

cat > "$dir/main.cpp" <<'EOF'
#include <iostream>
#include <string>
extern std::string banner;
int main() { std::cout << "[" << banner << "]\n"; }
EOF

g++ -std=c++17 -O2 "$dir/site.cpp" "$dir/banner.cpp" "$dir/main.cpp" -o "$dir/p1"
printf 'site.cpp 를 먼저 링크: '
"$dir/p1"

g++ -std=c++17 -O2 "$dir/banner.cpp" "$dir/site.cpp" "$dir/main.cpp" -o "$dir/p2"
printf 'banner.cpp 를 먼저 링크: '
"$dir/p2"
