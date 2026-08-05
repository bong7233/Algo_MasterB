"""V-12 §3 손추적 표 — 이산 제어에서의 정지 거리.

연속 근사 v^2/(2a) 와 제어 주기 단위로 감속하는 실제 값이 얼마나 어긋나는지까지 낸다.
그 차이는 "한 주기 동안 속도가 안 바뀐다" 는 사실에서만 온다.

실행: python3 tools/bench/v12_braking.py
"""

V0 = 0.60      # 초기 속도 (m/s)
A = 0.5        # 감속 한계 (m/s^2)
DT = 0.1       # 제어 주기 (s)
GAP = 0.50     # 장애물까지의 거리 (m)


def table(v0=V0, a=A, dt=DT, gap=GAP):
    rows = []
    v, travelled = v0, 0.0
    cycle = 0
    while v > 1e-9:
        step = v * dt
        travelled += step
        rows.append((cycle, v, step, gap - travelled))
        v = max(0.0, v - a * dt)
        cycle += 1
    return rows, travelled, cycle


def main():
    rows, travelled, cycles = table()
    print(f"{'주기':>4} {'속도':>7} {'이동':>7} {'남은 거리':>10}")
    for c, v, step, rest in rows:
        print(f"{c:>4} {v:>7.2f} {step:>7.3f} {rest:>10.3f}")
    print(f"{cycles:>4} {0.0:>7.2f} {'—':>7} {GAP - travelled:>10.3f}")
    print()
    print(f"이산 제어 정지 거리 = {travelled:.3f} m ({cycles}주기, {cycles * DT:.1f}초)")
    print(f"연속 근사 v^2/(2a)  = {V0 * V0 / (2 * A):.3f} m")
    print(f"차이               = {travelled - V0 * V0 / (2 * A):.3f} m")
    print(f"0.35 m 에서 발견했다면 남는 거리 = {0.35 - travelled:.3f} m (음수면 충돌)")


if __name__ == "__main__":
    main()
