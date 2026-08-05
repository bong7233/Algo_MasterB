"""XV-8 일관성 해싱 — 가상 노드 수에 따른 노드별 부하의 표준편차.

본문(::: dual)은 FNV-1a로 재배치 비율(단순 모듈로 대 일관성 해싱)을 잰다.
이 스크립트는 별도로 **가상 노드 수를 늘릴수록 부하가 고르게 수렴하는지**를 잰다.
FNV-1a는 `"A#0".."A#9"`처럼 끝자리만 다른 짧은 문자열에서 편향이 있어(마지막 바이트
근처의 섞임이 부족하다) 이 추세를 깨끗하게 보이지 못한다. 그래서 여기서는
표준 라이브러리의 MD5로 바꿔 잰다 — 결론(가상 노드가 늘수록 표준편차가 준다)은
해시 함수의 선택과 무관한 일관성 해싱의 성질이고, 관측을 방해하는 것은 약한 해시 쪽이다.
"""

import bisect
import hashlib
import statistics


def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)


class Ring:
    def __init__(self, nodes, vnodes):
        self.vnodes = vnodes
        self.points = []
        for node in nodes:
            for i in range(vnodes):
                bisect.insort(self.points, (h("%s#%d" % (node, i)), node))

    def owner(self, key):
        p = h(key)
        idx = bisect.bisect_left(self.points, (p, ""))
        if idx == len(self.points):
            idx = 0
        return self.points[idx][1]


def main():
    keys = ["session%d" % i for i in range(20000)]
    nodes = ["A", "B", "C", "D"]

    print("가상 노드 수에 따른 노드별 키 개수 표준편차 (물리 노드 4개, 키 %d개)" % len(keys))
    for v in (1, 10, 50, 1000):
        ring = Ring(nodes, vnodes=v)
        counts = {n: 0 for n in nodes}
        for k in keys:
            counts[ring.owner(k)] += 1
        vals = [counts[n] for n in nodes]
        mean = sum(vals) / len(vals)
        sd = statistics.pstdev(vals)
        print("  가상 노드 %4d개  분포 %s  표준편차 %.0f (평균 대비 %.0f%%)"
              % (v, vals, sd, 100 * sd / mean))


if __name__ == "__main__":
    main()
