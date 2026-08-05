"""V-13 본문 수치 — 구성 공간을 격자로 나눴을 때의 칸 수와 메모리.

자유도 d, 관절당 눈금 k 이면 칸 수는 k^d 다. 본문 §1 의 표가 여기서 나온다.
칸마다 1비트(자유/점유)만 써도 메모리가 얼마인지까지 같이 낸다.

실행: python3 tools/bench/v13_cspace_size.py
"""


def human_bytes(n):
    for unit in ("B", "KB", "MB", "GB", "TB", "PB", "EB"):
        if n < 1024 or unit == "EB":
            return f"{n:,.1f} {unit}"
        n /= 1024


def main():
    print(f"{'DOF':>4} {'눈금/관절':>10} {'각도 해상도':>12} {'칸 수':>28} {'1비트 저장':>14}")
    for d in (2, 3, 6, 7):
        for k in (10, 36, 360):
            cells = k ** d
            print(
                f"{d:>4} {k:>10} {360 / k:>10.1f}도 {cells:>28,} "
                f"{human_bytes(cells / 8):>14}"
            )
    print()
    # 검사 하나에 드는 시간을 곱하면 "격자를 채우는 데 걸리는 시간" 이 나온다.
    # ns 는 tools/bench/v13_collision_cost.cpp 의 실측값이다.
    for ns in (33.9,):
        for d, k in ((6, 36), (6, 360)):
            cells = k ** d
            sec = cells * ns * 1e-9
            print(
                f"{d} DOF · 눈금 {k}: 칸 {cells:,} × {ns} ns = "
                f"{sec:,.0f}초 = {sec / 86400:,.1f}일"
            )


if __name__ == "__main__":
    main()
