#!/usr/bin/env bash
# 0-5 §입출력 벤치 러너. 입력을 만들고 각 모드를 3회씩 돌려 중앙값을 뽑는다.
#
#   bash tools/bench/cpp_io_sync_run.sh 1000000
#
# 왜 3회인가: 1회는 페이지 캐시 워밍업 편차에 그대로 노출된다. 중앙값이면
# 첫 실행의 콜드 캐시가 결과를 지배하지 않는다.
set -eu
N="${1:-1000000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 -c "
import random, sys
n = int(sys.argv[1])
random.seed(42)
out = [str(n)]
out += [str(random.randint(1, 10**9)) for _ in range(n)]
sys.stdout.write('\n'.join(out) + '\n')
" "$N" > "$TMP/in.txt"

g++ -std=c++17 -O2 "$DIR/cpp_io_sync.cpp" -o "$TMP/io_sync"

median() { sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}'; }

for mode in cin_sync cin_nosync scanf; do
  echo -n "C++ $mode: "
  for _ in 1 2 3; do
    "$TMP/io_sync" "$mode" < "$TMP/in.txt" 2>&1 >/dev/null | awk '{print $NF}'
  done | median
done

for mode in input readline bufread; do
  echo -n "Py  $mode: "
  for _ in 1 2 3; do
    python3.13 "$DIR/cpp_io_sync_py.py" "$mode" < "$TMP/in.txt" 2>&1 >/dev/null | awk '{print $NF}'
  done | median
done
