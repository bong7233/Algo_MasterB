#!/bin/sh
# 재귀 트리 DP 가 8 MB 스택에서 몇 개의 정점까지 견디는가 — 경계를 이분 탐색으로 찾는다.
#
# 프로그램 안에서는 잴 수 없다. 스택을 넘기면 SIGSEGV 로 죽고 그것은 잡을 수 없기
# 때문이다. 그래서 바깥 셸이 종료 신호를 보고 판정한다.
#
# 실행:
#     sh tools/bench/viii8_stack_probe.sh
set -e
BIN=${BIN:-/tmp/viii8}
g++ -std=c++17 -O2 -o "$BIN" "$(dirname "$0")/viii8_tree_dp_recursion.cpp"
echo "ulimit -s = $(ulimit -s) (KB)"
lo=1000
hi=400000
while [ $((hi - lo)) -gt 100 ]; do
  mid=$(((lo + hi) / 2))
  if "$BIN" "$mid" >/dev/null 2>&1; then lo=$mid; else hi=$mid; fi
done
echo "통과 최대 $lo / 실패 최소 $hi"
