"""인접 리스트(list of list) vs CSR(array.array) — XI-10 §2·§4 의 Python 쪽 수치.

시간과 메모리를 **다른 실행**에서 잰다. 한 프로세스에서 둘 다 재면 GC 와 할당자
상태가 섞이고, 계측을 켠 채로 잰 시간은 몇십 배까지 부푼다.

사용법:
    python3.13 tools/bench/csr_traversal.py time
    python3.13 tools/bench/csr_traversal.py mem-adj
    python3.13 tools/bench/csr_traversal.py mem-csr
    python3.13 tools/bench/csr_traversal.py sizeof
"""

import array
import random
import statistics
import sys
import time

V = 200000
E = 2000000  # 무방향. 인접 자리는 2E = 400만 개


def rss_mb():
    with open("/proc/self/statm") as f:
        resident = int(f.read().split()[1])
    return resident * 4096 / 1024 / 1024


def make_edges():
    rng = random.Random(20260805)
    return [(rng.randrange(V), rng.randrange(V)) for _ in range(E)]


def build_adj(es):
    adj = [[] for _ in range(V)]
    for u, v in es:
        adj[u].append(v)
        adj[v].append(u)
    return adj


def build_csr(es):
    start = array.array("i", bytes(4 * (V + 1)))
    for u, v in es:
        start[u + 1] += 1
        start[v + 1] += 1
    for i in range(1, V + 1):
        start[i] += start[i - 1]
    item = array.array("i", bytes(4 * 2 * E))
    fill = array.array("i", start[:V])
    for u, v in es:
        item[fill[u]] = v
        fill[u] += 1
        item[fill[v]] = u
        fill[v] += 1
    return start, item


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "time"
    es = make_edges()

    if mode == "sizeof":
        # 리스트 한 칸은 객체 포인터 8바이트다. 그 포인터가 가리키는 int 객체가 또 있다.
        adj = build_adj(es)
        slots = sum(len(row) for row in adj)
        outer = sys.getsizeof(adj)
        inner = sum(sys.getsizeof(row) for row in adj)
        start, item = build_csr(es)
        print(f"인접 자리 {slots:,}개")
        print(f"  list of list : 바깥 {outer / 1e6:.1f} MB + 안쪽 {inner / 1e6:.1f} MB"
              f" = {(outer + inner) / 1e6:.1f} MB (int 객체 본체는 여기 안 들어 있다)")
        print(f"  int 객체 하나 {sys.getsizeof(V - 1)} 바이트 × 서로 다른 값 최대 {V:,}개")
        print(f"  array.array  : start {sys.getsizeof(start) / 1e6:.1f} MB"
              f" + item {sys.getsizeof(item) / 1e6:.1f} MB"
              f" = {(sys.getsizeof(start) + sys.getsizeof(item)) / 1e6:.1f} MB")
        return
    if mode == "mem-adj":
        before = rss_mb()
        adj = build_adj(es)
        print(f"인접 리스트 상주 메모리 증가: {rss_mb() - before:.0f} MB"
              f" (인접 자리 {sum(len(r) for r in adj):,}개)")
        return
    if mode == "mem-csr":
        before = rss_mb()
        start, item = build_csr(es)
        print(f"CSR 상주 메모리 증가: {rss_mb() - before:.0f} MB"
              f" (item {len(item):,}칸)")
        return

    print(f"정점 {V:,} · 간선 {E:,}(무방향, 인접 자리 {2 * E:,}) · 5회 중앙값과 범위")
    res = {k: [] for k in ("adj_build", "csr_build", "adj_walk", "csr_walk")}
    for _ in range(5):
        t0 = time.perf_counter()
        adj = build_adj(es)
        t1 = time.perf_counter()
        s = 0
        for row in adj:
            s += sum(row)
        t2 = time.perf_counter()
        del adj

        t3 = time.perf_counter()
        start, item = build_csr(es)
        t4 = time.perf_counter()
        s2 = 0
        for u in range(V):
            s2 += sum(item[start[u]:start[u + 1]])
        t5 = time.perf_counter()
        assert s == s2, (s, s2)
        del start, item

        res["adj_build"].append((t1 - t0) * 1000)
        res["adj_walk"].append((t2 - t1) * 1000)
        res["csr_build"].append((t4 - t3) * 1000)
        res["csr_walk"].append((t5 - t4) * 1000)

    for k, label in (
        ("adj_build", "인접 리스트 구축"),
        ("csr_build", "CSR 구축"),
        ("adj_walk", "인접 리스트 순회"),
        ("csr_walk", "CSR 순회"),
    ):
        v = sorted(res[k])
        print(f"  {label:<20} {statistics.median(v):8.0f} ms  ({v[0]:.0f} ~ {v[-1]:.0f})")


if __name__ == "__main__":
    main()
