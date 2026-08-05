"""XV-10 -- 고정 윈도우 카운터의 경계 폭주 vs 토큰 버킷 vs 슬라이딩 윈도우 카운터.

세 방식에 같은 요청 패턴(초당 한도 10, 경계에서 몰아서 20건)을 흘려
각 방식이 실제로 몇 건을 통과시키는지 센다. 결정적 시뮬레이션이라 무작위성이 없다.

python3.13 tools/bench/xv10_burst.py
"""

LIMIT = 10  # 초당 허용 한도
WINDOW = 1.0


def fixed_window_burst():
    """0.91~0.99초에 10건, 1.01~1.09초에 10건 -- 두 고정 윈도우에 걸쳐 있다."""
    times = [0.91 + i * 0.01 for i in range(9)] + [0.99]
    times += [1.01 + i * 0.01 for i in range(9)] + [1.09]
    counts = {}
    allowed = 0
    for t in times:
        w = int(t // WINDOW)
        counts[w] = counts.get(w, 0) + 1
        if counts[w] <= LIMIT:
            allowed += 1
    # 0.02초 폭에 실제로 몇 건이 몰렸는지
    tight = sum(1 for t in times if 0.99 <= t <= 1.01)
    return allowed, tight, times


def sliding_window_counter():
    """직전 윈도우 카운트에 가중치를 줘서 경계 폭주를 근사적으로 누른다.
    가중치 = 현재 시각이 현재 윈도우에서 지난 비율의 보수."""
    times = [0.91 + i * 0.01 for i in range(9)] + [0.99]
    times += [1.01 + i * 0.01 for i in range(9)] + [1.09]
    prev_count = 0
    cur_window = 0
    cur_count = 0
    allowed = 0
    for t in times:
        w = int(t // WINDOW)
        if w != cur_window:
            prev_count = cur_count if w == cur_window + 1 else 0
            cur_window = w
            cur_count = 0
        frac_into_cur = (t - w * WINDOW) / WINDOW
        weighted = prev_count * (1 - frac_into_cur) + cur_count
        if weighted < LIMIT:
            cur_count += 1
            allowed += 1
    return allowed


def token_bucket_burst():
    """용량 10, 초당 10개 보충. 버킷이 가득 찬 채로 시작한다.
    같은 20건(0.91~1.09초, 0.01초 간격)을 흘린다."""
    times = [0.91 + i * 0.01 for i in range(9)] + [0.99]
    times += [1.01 + i * 0.01 for i in range(9)] + [1.09]
    capacity = float(LIMIT)
    rate = float(LIMIT)  # per second
    tokens = capacity
    last = times[0]
    allowed = 0
    for t in times:
        tokens = min(capacity, tokens + (t - last) * rate)
        last = t
        if tokens >= 1.0:
            tokens -= 1.0
            allowed += 1
    return allowed


if __name__ == "__main__":
    fw_allowed, tight, times = fixed_window_burst()
    sw_allowed = sliding_window_counter()
    tb_allowed = token_bucket_burst()
    print(f"입력: {len(times)}건, 그중 0.02초 폭(경계 양옆)에 {tight}건")
    print(f"고정 윈도우 카운터 통과: {fw_allowed} / {len(times)} (한도 {LIMIT}/초 x 2윈도우)")
    print(f"슬라이딩 윈도우 카운터 통과: {sw_allowed} / {len(times)}")
    print(f"토큰 버킷(용량 {LIMIT}, 가득 찬 채 시작) 통과: {tb_allowed} / {len(times)}")
