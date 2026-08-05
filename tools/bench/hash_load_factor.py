#!/usr/bin/env python3
"""II-6 — 적재율이 탐사 횟수를 어떻게 지배하는가.

선형 탐사 해시 테이블을 직접 만들어, 적재율 α 를 바꿔 가며 조회 하나에
평균 몇 칸을 보는지 센다. 이론값과 나란히 찍는 것이 목적이다.

    성공 조회 평균 탐사 ≈ (1 + 1/(1-α)) / 2
    실패 조회 평균 탐사 ≈ (1 + 1/(1-α)^2) / 2

두 식 모두 해시가 고르게 흩어진다는 가정 위에 있다. 그래서 키는 난수로 만든다.
가정이 깨지면 어떻게 되는지는 hash_adversarial.cpp 가 잰다.

사용법:
    python3.13 tools/bench/hash_load_factor.py
"""
from __future__ import annotations

import random

CAP = 1 << 16   # 65,536 슬롯. 2의 거듭제곱이라 % 대신 & 로 나머지를 낸다.
MASK = CAP - 1


class LinearProbe:
    """리해싱 없이 고정 용량으로 두는 선형 탐사 테이블. 적재율을 직접 조종하려면
    자동으로 커지면 안 된다."""

    def __init__(self, cap: int) -> None:
        self.slots: list[tuple[int, int] | None] = [None] * cap
        self.mask = cap - 1

    def insert(self, key: int, val: int) -> int:
        i = (key * 2654435761) & self.mask   # Knuth 승산 해시. 하위 비트까지 섞는다
        probes = 1
        while self.slots[i] is not None and self.slots[i][0] != key:
            i = (i + 1) & self.mask
            probes += 1
        self.slots[i] = (key, val)
        return probes

    def find(self, key: int) -> int:
        """탐사 칸 수를 돌려준다. 값이 아니라 비용을 재는 것이 목적이다."""
        i = (key * 2654435761) & self.mask
        probes = 1
        while self.slots[i] is not None and self.slots[i][0] != key:
            i = (i + 1) & self.mask
            probes += 1
        return probes


def main() -> None:
    random.seed(20250804)
    print(f"슬롯 {CAP:,}개, 선형 탐사, 키는 난수 (Python 3.13)")
    print(f"{'적재율':>6} | {'성공 실측':>10} {'이론':>8} | {'실패 실측':>10} {'이론':>8}")
    print("-" * 52)

    for alpha in (0.25, 0.50, 0.75, 0.90, 0.95, 0.99):
        n = int(CAP * alpha)
        keys = random.sample(range(1, 10**9), n)
        t = LinearProbe(CAP)
        for k in keys:
            t.insert(k, 0)

        hit = sum(t.find(k) for k in keys) / n
        misses = [random.randrange(10**9, 2 * 10**9) for _ in range(20000)]
        miss = sum(t.find(k) for k in misses) / len(misses)

        th_hit = (1 + 1 / (1 - alpha)) / 2
        th_miss = (1 + 1 / (1 - alpha) ** 2) / 2
        print(f"{alpha:>6.2f} | {hit:>10.2f} {th_hit:>8.2f} | {miss:>10.2f} {th_miss:>8.2f}")


if __name__ == "__main__":
    main()
