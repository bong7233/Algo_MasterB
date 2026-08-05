# XI-9 공간 인덱스

::: lead
점 10만 개에서 "가장 가까운 것"을 매 프레임 찾아야 할 때, 무엇으로 찾을 것인가.
:::

## 1. 문제

라이다 한 바퀴가 점 10만 개를 뱉는다. 이 점들을 이전 프레임의 점들과 맞춰 보려면 **각 점마다 가장 가까운 점**을 찾아야 한다([XIII-5 ICP](#/xiii-5)가 하는 일이 이것이다). 순진하게 짜면 이렇다.

```text nolines
    for p in current:            <- 10만 번
        for q in previous:       <- 10만 번
            d = dist(p, q)       <- 100억 번
```

$10^{10}$번이다. [0-9 N 범위로 알고리즘 역산하기](#/0-9)의 표를 그대로 적용하면 C++로도 수십 초, Python이면 몇 시간이다. 라이다가 초당 10바퀴를 돈다는 사실 앞에서 이 코드는 존재하지 않는 것과 같다.

같은 모양의 문제가 여기저기 있다.

| 상황 | 매번 묻는 것 |
|---|---|
| 충돌 검사 | 이 물체와 겹칠 수 있는 물체가 있는가 |
| 군집 제어 | 반경 2 m 안의 이웃은 누구인가 |
| 지도 매칭 | 이 좌표에서 가장 가까운 도로는 |
| 배달 배차 | 이 주문에서 가장 가까운 기사 셋은 |

전부 "전체를 훑지 않고 가까운 것만 보고 싶다"이고, 전부 **공간 인덱스**가 답이다. 공간 인덱스는 한 가지 일을 한다. ==좌표를 보고 "여긴 볼 필요 없다"를 즉시 잘라 내는 것.==

## 2. 아이디어

### 2.1 넷 중 무엇인가

공간 인덱스는 하나가 아니라 넷이고, 고르는 기준이 분명하다. **먼저 이 표를 확정하고 들어간다.**

| 데이터가 이렇다 | 고를 것 | 이유 |
|---|---|---|
| 점이 공간에 **고르게** 흩어져 있고 범위가 유계다 | **그리드 해싱** | 셀 번호가 곧 배열 첨자다. 트리도 비교도 없다 |
| 점이 **뭉쳐** 있거나 밀도가 자리마다 다르다 | **KD 트리** | 데이터가 있는 곳에만 분할이 생긴다 |
| 3차원이고 빈 공간이 넓다 | **옥트리** | 빈 팔분면은 자식을 만들지 않는다 |
| 대상이 점이 아니라 **부피를 가진 객체**다 | **R 트리** | 경계 상자를 겹치도록 묶는다 |

넷째 줄이 가장 자주 오해된다. 점의 최근접과 **범위를 가진 객체의 겹침**은 다른 문제다. 로봇의 footprint([X-6 볼록 껍질](#/x-6))나 선반 하나는 점이 아니라 사각형이고, KD 트리에는 그것을 넣을 자리가 없다.

### 2.2 그리드 해싱 — 좌표를 셀 번호로 바꾼다

공간을 한 변 $c$짜리 정사각형으로 자르고, 점 $(x, y)$를 셀 $(\lfloor x/c \rfloor, \lfloor y/c \rfloor)$에 넣는다. 질의점 근처를 볼 때는 그 셀과 이웃 셀만 본다.

```text nolines
    c=25          0    25   50   75  100
              75  +----+----+----+----+     query (63, 40) -> cell (2, 1)
                  |    |    | *  |    |
              50  +----+----+----+----+     ring r=0 : (2,1)
                  |  * | *  |*  Q|  * |     ring r=1 : (1,0)..(3,2) 의 테두리 8칸
              25  +----+----+----+----+     ring r=2 : 그 바깥 테두리 16칸
                  | *  |    |    | *  |
               0  +----+----+----+----+
```

최근접을 정확히 구하려면 링을 하나씩 넓히면서 **"이 링의 어떤 점도 현재 최선보다 가까울 수 없다"**가 성립하는 순간 멈춘다. 링 $r$의 셀은 질의점에서 최소 $(r-1)c$ 떨어져 있으므로, $(r-1)c$가 현재까지의 최선 거리보다 크면 더 볼 필요가 없다. 이 종료 조건을 빼먹고 한 링만 보는 구현이 흔하고, **그러면 셀 경계 바로 너머의 점을 놓친다.**

셀 크기가 이 자료구조의 전부다. 너무 크면 한 셀에 점이 몰려 결국 전수 비교가 되고, 너무 작으면 빈 셀만 잔뜩 훑는다. 점이 고르면 **셀당 한두 개**가 되도록 $c \approx \text{범위} / \sqrt{n}$으로 잡는다.

::: perf
2차원 점 10만 개, 질의 5,000회. 셋 다 같은 답을 내는지 200회 대조해 불일치 0을 확인한 뒤 시간을 쟀다.

| 분포 | 전수 비교 | 그리드(해시맵) | 그리드(평면 배열) | KD 트리 |
|---|---|---|---|---|
| 균일 | 710 ms (692~839) | 8.1 ms (7.7~11.8) | **2.5 ms (1.8~2.7)** | 3.8 ms (3.5~4.2) |
| 뭉침(군집 100개) | 720 ms (687~760) | 18.8 ms (17.6~20.4) | 16.6 ms (16.4~17.5) | **4.8 ms (4.6~5.3)** |

질의 하나당 실제로 계산한 거리의 개수가 원인을 다 말해 준다.

| 분포 | 전수 | 그리드 | KD 트리 |
|---|---|---|---|
| 균일 | 100,000 | 9.6 | 23.1 |
| 뭉침 | 100,000 | **989.4** | 42.7 |

**뭉친 데이터에서 그리드는 무너진다.** 군집 하나가 셀 하나에 통째로 들어가면 그 셀을 여는 순간 1,000개를 다 보게 된다. 셀을 군집 크기(0.5)에 맞추면 질의당 166개로 줄지만, 이번에는 셀이 400만 개가 되어 점 10만 개를 담는 데 16 MB짜리 빈 배열이 필요하다. **밀도가 자리마다 다르면 한 셀 크기로는 답이 없다.**

> (Linux x86-64 / g++ 13 `-O2` 실측, 5회 실행의 중앙값과 범위. 절대값은 기기마다 다르지만 자릿수 차이는 어디서나 같다. 측정 스크립트는 `tools/bench/spatial_index_bench.cpp` 다.)
:::

### 2.3 KD 트리 — 축을 번갈아 가며 자른다

KD 트리는 셀 크기를 정하지 않는다. 대신 **점이 실제로 있는 곳을 반씩 가른다.**

깊이 0에서는 $x$좌표의 중앙값으로 자르고, 깊이 1에서는 $y$좌표로, 깊이 2에서 다시 $x$로 — 축을 번갈아 쓴다. 매번 반으로 가르므로 깊이는 $\log_2 n$이다. 점이 뭉쳐 있어도 상관없다. 뭉친 곳은 잘게, 빈 곳은 성기게 잘린다.

::: widget kdtree-nn {
  "points": [[2,3],[5,4],[9,6],[4,7],[8,1],[7,2],[6,9]],
  "query": [7,7],
  "dim": 2,
  "axisOrder": "round-robin",
  "split": "median",
  "extent": [0, 10, 0, 10],
  "show": ["partition", "tree", "radius", "counters"],
  "counters": ["visited", "pruned", "bruteforce"],
  "steps": "auto",
  "highlightPrune": true,
  "compareBruteforce": true
}
:::

위젯은 왼쪽에 평면, 오른쪽에 트리를 나란히 놓는다. 스텝을 밀면 세 가지가 동시에 움직인다. **평면에서는** 분할선이 하나씩 그어지고, 탐색이 시작되면 질의점을 중심으로 현재 최선 거리를 반지름으로 하는 원이 그려진다. **트리에서는** 지금 방문 중인 노드가 밝아지고, 잘라 낸 가지가 회색으로 죽는다. **카운터는** 방문한 노드 수와 잘라 낸 가지 수를 전수 비교의 $n$과 나란히 센다.

핵심은 원과 분할선의 관계 하나다. **질의점에서 분할선까지의 거리가 현재 최선 거리보다 멀면, 그 선 너머에는 답이 있을 수 없다.** 원이 선에 닿지 않는 그림이 곧 "이 가지는 안 본다"는 증명이다.

그래서 탐색은 이렇게 돈다.

1. 질의점이 속한 쪽으로 먼저 내려간다. 좋은 후보를 빨리 잡아야 원이 작아진다.
2. 올라오면서 반대쪽을 볼지 정한다. $|q_{axis} - p_{axis}|$가 현재 최선 거리보다 크면 **안 본다.**
3. 작으면 반대쪽도 내려간다. 원이 선을 넘었으니 저쪽에 더 가까운 점이 있을 수 있다.

1번을 빼먹고 아무 쪽이나 먼저 내려가면 알고리즘은 여전히 정답을 내지만 원이 늦게 줄어들어 가지치기가 거의 안 먹힌다. **정확성이 아니라 속도가 순서에 달려 있다.**

### 2.4 옥트리와 R 트리

**옥트리**는 3차원의 사분트리다. 정육면체를 여덟 팔분면으로 쪼개고, 점이 임계치를 넘는 칸만 다시 쪼갠다. 그리드와 KD 트리의 중간이다 — 그리드처럼 좌표로 바로 칸을 찾을 수 있고, 트리처럼 빈 곳에는 노드를 만들지 않는다. 포인트클라우드 라이브러리들이 복셀 다운샘플링과 반경 검색에 쓰는 것이 이 구조다.

**R 트리**는 다르다. 점이 아니라 **경계 상자**(bounding box)를 저장한다. 가까운 상자들을 묶어 더 큰 상자를 만들고, 그것을 다시 묶는다. 질의 상자와 겹치지 않는 상자는 그 아래를 통째로 건너뛴다.

```text nolines
    R1 +-------------------+        R1 = R2 + R3 을 감싸는 상자
       | R2 +----+         |
       |    | a  | b       |        query box Q 가 R3 와만 겹치면
       |    +----+         |        R2 아래는 한 번도 열리지 않는다
       |          R3 +---+ |
       |             | c | |
       |             +---+ |
       +-------------------+
```

KD 트리와 R 트리의 차이는 한 줄로 정리된다. **KD 트리는 공간을 겹치지 않게 나누고, R 트리는 객체를 겹칠 수 있게 묶는다.** 부피를 가진 객체는 분할선 위에 걸치므로 "겹치지 않게 나누기"가 불가능하다. 공간 DB의 지리 인덱스가 전부 R 트리 계열인 이유가 이것이다.

### 2.5 차원의 저주 — KD 트리가 죽는 지점

KD 트리의 $O(\log n)$은 **가지치기가 먹힐 때만** 나오는 수치다. 그리고 가지치기는 차원이 오르면 먹히지 않는다.

이유는 계산으로 나온다. 깊이 $d$까지 내려가는 동안 각 축은 $d/K$번만 쓰인다. $K=16$이면 깊이 16을 내려가도 축마다 딱 한 번 잘린 셈이고, 한 번 자른 축의 분할선은 질의점에서 대체로 가깝다. 가깝다는 것은 곧 **원이 선을 넘는다**는 뜻이고, 넘으면 반대쪽도 봐야 한다. 이것이 모든 노드에서 일어나면 트리를 전부 도는 것과 같아진다.

::: perf
점 4,000개, 질의 200회 × 씨앗 5개 = 1,000회. 좌표는 $[0, 1000)$ 균일 난수. **1,000회 전부 전수 비교와 답이 일치**하는 것을 확인한 뒤 방문 노드를 셌다.

| 차원 | 질의당 방문 노드(중앙값) | 전체 4,000 대비 | 10~90% 범위 |
|---|---|---|---|
| 2 | 16 | 0.4% | 12~25 |
| 4 | 48 | 1.2% | 22~102 |
| 8 | 488 | 12.2% | 153~1,286 |
| 16 | 3,992 | **99.8%** | 3,865~4,000 |
| 32 | 4,000 | **100.0%** | 4,000~4,000 |

> (Linux x86-64 / CPython 3.13 실측. 비율은 기계와 무관하게 재현된다. 측정 스크립트는 `tools/bench/kdtree_curse.py` 다.)

**16차원에서 KD 트리는 전수 비교다.** 그것도 트리를 타고 다니느라 재귀 호출과 캐시 미스가 더 붙은 전수 비교다. 순진한 이중 루프보다 느리다.

경계는 대략 이렇게 기억한다. ==$n \gg 2^K$일 때만 KD 트리가 이긴다.== $K=16$이면 $2^{16} = 65{,}536$이니 점이 수십만 개는 되어야 한다. 특징 벡터가 128차원인 이미지 검색에 KD 트리를 쓰지 않는 이유가 이 표에 있다 — 그 영역에서는 **정확한 최근접을 포기하고** 근사 방법(LSH, HNSW 같은 그래프 기반 인덱스)으로 간다. 이 책의 범위는 여기까지다.
:::

## 3. 손으로 따라가기

::: trace
점 7개로 만든 2차원 KD 트리다. 축은 깊이에 따라 $x, y, x, \dots$로 번갈아 쓰고, 각 구간의 **중앙**이 그 구간의 노드다.

```text nolines
    depth 0  axis x : (6,9)
      depth 1  axis y : (5,4)            <- x <= 6 인 쪽
        depth 2  axis x : (2,3)
        depth 2  axis x : (4,7)
      depth 1  axis y : (7,2)            <- x >  6 인 쪽
        depth 2  axis x : (8,1)
        depth 2  axis x : (9,6)
```

질의점은 $q = (7, 7)$이다. 거리는 제곱거리 $d^2$로 비교한다(제곱근은 순서를 바꾸지 않는다).

각 스텝에서 볼 것은 **반대쪽 가지를 보는가 자르는가** 하나다. 판정식은 `diff * diff < best_d`이고, `diff`는 질의점과 노드의 **분할 축 좌표 차이**다.

| 스텝 | 방문 노드 | 축 | $d^2$ | 최선 | diff | diff² | 반대쪽 |
|---|---|---|---|---|---|---|---|
| 1 | (6,9) | x | 5 | (6,9) 5 | 7−6 = 1 | 1 | 1 < 5 → 나중에 본다 |
| 2 | (7,2) | y | 25 | (6,9) 5 | 7−2 = 5 | 25 | 25 ≥ 5 → **자른다** |
| 3 | (9,6) | x | 5 | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |

세 가지를 확인하라.

- [ ] 3번 스텝의 $d^2$는 5로 현재 최선과 **같다.** 최선이 (9,6)으로 바뀌는가
- [ ] 2번에서 잘린 가지에는 어떤 점이 있었는가. 그 점은 실제로 답이 될 수 없었는가
- [ ] 마지막까지 방문한 노드는 몇 개인가. 전수 비교 7개와 비교하면
:::

::: answer
| 스텝 | 방문 노드 | 축 | $d^2$ | 최선 | diff | diff² | 반대쪽 |
|---|---|---|---|---|---|---|---|
| 1 | (6,9) | x | 5 | (6,9) 5 | 7−6 = 1 | 1 | 1 < 5 → 나중에 본다 |
| 2 | (7,2) | y | 25 | (6,9) 5 | 7−2 = 5 | 25 | 25 ≥ 5 → **자른다** |
| 3 | (9,6) | x | 5 | (6,9) 5 | 7−9 = −2 | 4 | 4 < 5 이지만 자식이 없다 |
| 4 | (5,4) | y | 13 | (6,9) 5 | 7−4 = 3 | 9 | 9 ≥ 5 → **자른다** |
| 5 | (4,7) | x | 9 | (6,9) 5 | 7−4 = 3 | 9 | 9 ≥ 5 → 자식이 없다 |

답은 (6,9), $d^2 = 5$. **방문 5개, 잘라 낸 가지 2개, 전수 비교 7개.**

**첫 번째 질문이 이 표의 핵심이다.** (9,6)의 거리는 $(7-9)^2 + (7-6)^2 = 5$로 현재 최선과 정확히 같다. 판정이 `d < best_d`(강한 부등호)이므로 **최선은 바뀌지 않는다.** 등호를 넣어 `d <= best_d`로 쓰면 답이 (9,6)으로 바뀐다. 최근접이 여럿일 때 어느 것을 고를지는 부등호 하나가 정하고, 전수 비교와 대조하는 시험을 짤 때 이 차이가 "틀렸다"로 나온다. **거리를 비교하고 인덱스는 비교하지 마라 — 두 방법의 답이 다른 점일 수 있어도 거리는 같아야 한다.**

두 번째. 2번에서 잘린 가지에는 (8,1)이 있었다. 실제 거리는 $1 + 36 = 37$로 5보다 훨씬 멀다. 자른 판단이 옳았다. 여기서 확인할 것은 **판정이 (8,1)을 보지 않고 내려졌다**는 사실이다. 분할선 $y = 2$까지의 거리 5만으로 "저 아래 전부"를 배제했다.

세 번째. 7개 중 5개를 봤으니 이득이 거의 없다. **점이 7개일 때는 당연하다.** 트리의 이득은 $n$이 커질 때만 나온다 — 점 2,000개에서 같은 코드가 질의당 16개를 본다(§4). 작은 예제에서 이득이 안 보이는 것을 보고 "이 자료구조는 별로다"라고 판단하는 것이 흔한 오독이다.
:::

## 4. 구현

### 4.1 그리드 해싱

셀 → 점 목록을 해시맵으로 들 수도 있지만, 좌표 범위가 유계면 **평면 배열 두 개**로 끝난다. 계수 정렬로 셀별 구간을 만드는 이 배치는 [XI-10 그래프의 메모리 표현](#/xi-10)의 CSR과 정확히 같은 모양이다.

::: dual
```python title="그리드 해싱 — 최근접 탐색"
CELL = 25          # 셀 한 변. 점 밀도에 맞춘다 — 셀당 한두 점이 목표다
W = 1000 // CELL   # 격자 한 변의 셀 수


def lcg(s):
    """두 언어에서 같은 점을 만들기 위한 결정적 난수. 씨앗이 같으면 수열이 같다."""
    return (s * 1103515245 + 12345) % 2147483648


def make_points(n, seed):
    pts, s = [], seed
    for _ in range(n):
        s = lcg(s)
        x = s % 1000
        s = lcg(s)
        y = s % 1000
        pts.append((x, y))
    return pts, s


def build_grid(pts):
    """계수 정렬로 셀별 구간을 만든다. start[c]~start[c+1] 이 셀 c 의 점들이다."""
    start = [0] * (W * W + 1)
    for x, y in pts:
        start[(x // CELL) * W + (y // CELL) + 1] += 1
    for c in range(1, W * W + 1):
        start[c] += start[c - 1]
    item = [0] * len(pts)
    fill = start[:-1]
    for i, (x, y) in enumerate(pts):
        c = (x // CELL) * W + (y // CELL)
        item[fill[c]] = i
        fill[c] += 1
    return start, item


def grid_nearest(pts, start, item, q):
    """링을 하나씩 넓히며 본다. 링의 최소 가능 거리가 현재 최선을 넘으면 멈춘다."""
    qx, qy = q[0] // CELL, q[1] // CELL
    best_d, best_i, examined = 1 << 60, -1, 0
    for r in range(2 * W):
        if best_i >= 0 and (r - 1) * CELL > 0 and ((r - 1) * CELL) ** 2 > best_d:
            break
        for cx in range(max(0, qx - r), min(W - 1, qx + r) + 1):
            for cy in range(max(0, qy - r), min(W - 1, qy + r) + 1):
                if max(abs(cx - qx), abs(cy - qy)) != r:
                    continue                      # 테두리 셀만 본다
                c = cx * W + cy
                for k in range(start[c], start[c + 1]):
                    i = item[k]
                    examined += 1
                    d = (pts[i][0] - q[0]) ** 2 + (pts[i][1] - q[1]) ** 2
                    if d < best_d:
                        best_d, best_i = d, i
    return best_i, best_d, examined


def brute_nearest(pts, q):
    best_d, best_i = 1 << 60, -1
    for i, (x, y) in enumerate(pts):
        d = (x - q[0]) ** 2 + (y - q[1]) ** 2
        if d < best_d:
            best_d, best_i = d, i
    return best_i, best_d


N, QN = 2000, 300
pts, s = make_points(N, 20260805)
start, item = build_grid(pts)

used = sum(1 for c in range(W * W) if start[c + 1] > start[c])
print(f"점 {N}개 · 셀 {CELL} · 격자 {W}x{W} · 점이 있는 셀 {used}개")

mismatch, ex_grid = 0, 0
for _ in range(QN):
    s = lcg(s)
    qx = s % 1000
    s = lcg(s)
    qy = s % 1000
    gi, gd, ex = grid_nearest(pts, start, item, (qx, qy))
    bi, bd = brute_nearest(pts, (qx, qy))
    if gd != bd:                                  # 거리를 비교한다. 인덱스가 아니라
        mismatch += 1
    ex_grid += ex
print(f"전수 비교와 대조: {QN}회 중 불일치 {mismatch}회")
print(f"질의당 거리 계산: 전수 {N} · 그리드 {ex_grid // QN}")
```
```cpp title="그리드 해싱 — 최근접 탐색"
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <vector>
using namespace std;

const int CELL = 25;         // 셀 한 변. 점 밀도에 맞춘다 — 셀당 한두 점이 목표다
const int W = 1000 / CELL;   // 격자 한 변의 셀 수

// 두 언어에서 같은 점을 만들기 위한 결정적 난수. 씨앗이 같으면 수열이 같다.
uint64_t lcg(uint64_t s) { return (s * 1103515245ULL + 12345ULL) % 2147483648ULL; }

vector<pair<int, int>> make_points(int n, uint64_t &s) {
    vector<pair<int, int>> pts;
    for (int i = 0; i < n; i++) {
        s = lcg(s);
        int x = (int)(s % 1000);
        s = lcg(s);
        int y = (int)(s % 1000);
        pts.push_back({x, y});
    }
    return pts;
}

// 계수 정렬로 셀별 구간을 만든다. start[c]~start[c+1] 이 셀 c 의 점들이다.
void build_grid(const vector<pair<int, int>> &pts, vector<int> &start, vector<int> &item) {
    start.assign(W * W + 1, 0);
    for (auto [x, y] : pts) start[(x / CELL) * W + (y / CELL) + 1]++;
    for (int c = 1; c <= W * W; c++) start[c] += start[c - 1];
    item.assign(pts.size(), 0);
    vector<int> fill(start.begin(), start.end() - 1);
    for (int i = 0; i < (int)pts.size(); i++) {
        int c = (pts[i].first / CELL) * W + (pts[i].second / CELL);
        item[fill[c]] = i;
        fill[c]++;
    }
}

// 링을 하나씩 넓히며 본다. 링의 최소 가능 거리가 현재 최선을 넘으면 멈춘다.
void grid_nearest(const vector<pair<int, int>> &pts, const vector<int> &start,
                  const vector<int> &item, pair<int, int> q,
                  long long &best_d, int &best_i, long long &examined) {
    int qx = q.first / CELL, qy = q.second / CELL;
    best_d = 1LL << 60; best_i = -1; examined = 0;
    for (int r = 0; r < 2 * W; r++) {
        if (best_i >= 0 && (long long)(r - 1) * CELL > 0 &&
            (long long)(r - 1) * CELL * (r - 1) * CELL > best_d) break;
        for (int cx = max(0, qx - r); cx <= min(W - 1, qx + r); cx++)
            for (int cy = max(0, qy - r); cy <= min(W - 1, qy + r); cy++) {
                if (max(abs(cx - qx), abs(cy - qy)) != r) continue;   // 테두리 셀만 본다
                int c = cx * W + cy;
                for (int k = start[c]; k < start[c + 1]; k++) {
                    int i = item[k];
                    examined++;
                    long long dx = pts[i].first - q.first, dy = pts[i].second - q.second;
                    long long d = dx * dx + dy * dy;
                    if (d < best_d) { best_d = d; best_i = i; }
                }
            }
    }
}

void brute_nearest(const vector<pair<int, int>> &pts, pair<int, int> q,
                   long long &best_d, int &best_i) {
    best_d = 1LL << 60; best_i = -1;
    for (int i = 0; i < (int)pts.size(); i++) {
        long long dx = pts[i].first - q.first, dy = pts[i].second - q.second;
        long long d = dx * dx + dy * dy;
        if (d < best_d) { best_d = d; best_i = i; }
    }
}

int main() {
    const int N = 2000, QN = 300;
    uint64_t s = 20260805;
    vector<pair<int, int>> pts = make_points(N, s);
    vector<int> start, item;
    build_grid(pts, start, item);

    int used = 0;
    for (int c = 0; c < W * W; c++) if (start[c + 1] > start[c]) used++;
    cout << "점 " << N << "개 · 셀 " << CELL << " · 격자 " << W << "x" << W
         << " · 점이 있는 셀 " << used << "개\n";

    int mismatch = 0; long long ex_grid = 0;
    for (int t = 0; t < QN; t++) {
        s = lcg(s); int qx = (int)(s % 1000);
        s = lcg(s); int qy = (int)(s % 1000);
        long long gd, bd, ex; int gi, bi;
        grid_nearest(pts, start, item, {qx, qy}, gd, gi, ex);
        brute_nearest(pts, {qx, qy}, bd, bi);
        if (gd != bd) mismatch++;                 // 거리를 비교한다. 인덱스가 아니라
        ex_grid += ex;
    }
    cout << "전수 비교와 대조: " << QN << "회 중 불일치 " << mismatch << "회\n";
    cout << "질의당 거리 계산: 전수 " << N << " · 그리드 " << ex_grid / QN << "\n";
    return 0;
}
```
:::

두 언어의 출력은 한 글자도 다르지 않다.

```console
점 2000개 · 셀 25 · 격자 40x40 · 점이 있는 셀 1137개
전수 비교와 대조: 300회 중 불일치 0회
질의당 거리 계산: 전수 2000 · 그리드 11
```

**복잡도:** 구축은 시간 $O(n + C)$ — 점을 두 번 훑고 셀 $C$개의 누적합을 한 번 훑는다. 공간 $O(n + C)$ — `item`이 $n$칸, `start`가 $C+1$칸이다. 질의는 **점이 고르면** 기대 $O(1)$ — 링 몇 개 안의 셀 상수 개, 셀당 점 상수 개다. **최악은 $O(n)$** — 모든 점이 한 셀에 들어가면 그 셀을 여는 순간 전수 비교다. 위 실측에서 셀당 평균은 $2000/1137 = 1.8$개였고 질의당 거리 계산이 11회로 나온 것이 이 기대값의 실체다.

### 4.2 KD 트리

트리 노드를 객체로 만들지 않는다. **인덱스 배열 하나를 재귀적으로 재배치**하면 구간의 중앙이 곧 노드이고 좌우 반쪽이 자식이 된다. 포인터도, 할당도 없다.

::: dual
```python title="KD 트리 — 가지치기 최근접 탐색"
import sys

sys.setrecursionlimit(10000)


def lcg(s):
    """두 언어에서 같은 점을 만들기 위한 결정적 난수. 씨앗이 같으면 수열이 같다."""
    return (s * 1103515245 + 12345) % 2147483648


def make_points(n, K, s):
    pts = []
    for _ in range(n):
        p = []
        for _ in range(K):
            s = lcg(s)
            p.append(s % 1000)
        pts.append(p)
    return pts, s


def dist2(p, q, K):
    return sum((p[k] - q[k]) ** 2 for k in range(K))


class KDTree:
    """트리 노드를 따로 만들지 않는다. 인덱스 배열을 재귀적으로 재배치할 뿐이다.
    구간 [lo, hi) 의 중앙이 그 구간의 노드이고, 좌우 반쪽이 두 자식이다."""

    def __init__(self, pts, K):
        self.pts, self.K = pts, K
        self.idx = list(range(len(pts)))
        self.build(0, len(pts), 0)

    def build(self, lo, hi, depth):
        if hi - lo <= 1:
            return
        axis = depth % self.K
        pts, idx = self.pts, self.idx
        # 좌표가 같을 때는 인덱스로 가른다. 정렬 안정성에 기대지 않기 위해서다
        idx[lo:hi] = sorted(idx[lo:hi], key=lambda i: (pts[i][axis], i))
        mid = (lo + hi) // 2
        self.build(lo, mid, depth + 1)
        self.build(mid + 1, hi, depth + 1)

    def nearest(self, q):
        self.best_d, self.best_i = 1 << 60, -1
        self.visited, self.pruned = 0, 0
        self.go(0, len(self.pts), 0, q)
        return self.best_i

    def go(self, lo, hi, depth, q):
        if hi - lo <= 0:
            return
        mid = (lo + hi) // 2
        p = self.pts[self.idx[mid]]
        self.visited += 1
        d = dist2(p, q, self.K)
        if d < self.best_d:                    # 강한 부등호. 같으면 먼저 본 쪽을 남긴다
            self.best_d, self.best_i = d, self.idx[mid]

        axis = depth % self.K
        diff = q[axis] - p[axis]
        if diff < 0:
            near, far = (lo, mid), (mid + 1, hi)   # 질의점이 있는 쪽부터 내려간다
        else:
            near, far = (mid + 1, hi), (lo, mid)

        self.go(near[0], near[1], depth + 1, q)
        # 가지치기 — 분할 평면까지의 거리가 현재 최선보다 멀면 반대쪽엔 답이 없다
        if diff * diff < self.best_d:
            self.go(far[0], far[1], depth + 1, q)
        elif far[1] - far[0] > 0:
            self.pruned += 1


def brute_nearest(pts, q, K):
    best_d, best_i = 1 << 60, -1
    for i, p in enumerate(pts):
        d = dist2(p, q, K)
        if d < best_d:
            best_d, best_i = d, i
    return best_i, best_d


N, QN, K = 2000, 300, 2
pts, s = make_points(N, K, 20260805)
tree = KDTree(pts, K)
print(f"점 {N}개 · {K}차원 · 좌표 [0,1000)")

mismatch, vis, pr = 0, 0, 0
for _ in range(QN):
    q, s = make_points(1, K, s)
    q = q[0]
    tree.nearest(q)
    _, bd = brute_nearest(pts, q, K)
    if tree.best_d != bd:
        mismatch += 1
    vis += tree.visited
    pr += tree.pruned

print(f"전수 비교와 대조: {QN}회 중 불일치 {mismatch}회")
print(f"질의당 거리 계산: 전수 {N} · KD 트리 {vis // QN}")
print(f"질의당 잘라낸 가지: {pr // QN}")
```
```cpp title="KD 트리 — 가지치기 최근접 탐색"
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <vector>
using namespace std;

// 두 언어에서 같은 점을 만들기 위한 결정적 난수. 씨앗이 같으면 수열이 같다.
uint64_t lcg(uint64_t s) { return (s * 1103515245ULL + 12345ULL) % 2147483648ULL; }

vector<vector<int>> make_points(int n, int K, uint64_t &s) {
    vector<vector<int>> pts;
    for (int i = 0; i < n; i++) {
        vector<int> p;
        for (int k = 0; k < K; k++) { s = lcg(s); p.push_back((int)(s % 1000)); }
        pts.push_back(p);
    }
    return pts;
}

long long dist2(const vector<int> &p, const vector<int> &q, int K) {
    long long d = 0;
    for (int k = 0; k < K; k++) { long long t = p[k] - q[k]; d += t * t; }
    return d;
}

// 트리 노드를 따로 만들지 않는다. 인덱스 배열을 재귀적으로 재배치할 뿐이다.
// 구간 [lo, hi) 의 중앙이 그 구간의 노드이고, 좌우 반쪽이 두 자식이다.
struct KDTree {
    vector<vector<int>> pts;
    int K;
    vector<int> idx;
    long long best_d, visited, pruned;
    int best_i;

    KDTree(vector<vector<int>> pts_, int K_) : pts(pts_), K(K_) {
        idx.resize(pts.size());
        for (int i = 0; i < (int)pts.size(); i++) idx[i] = i;
        build(0, (int)pts.size(), 0);
    }

    void build(int lo, int hi, int depth) {
        if (hi - lo <= 1) return;
        int axis = depth % K;
        // 좌표가 같을 때는 인덱스로 가른다. 정렬 안정성에 기대지 않기 위해서다
        sort(idx.begin() + lo, idx.begin() + hi, [&](int a, int b) {
            if (pts[a][axis] != pts[b][axis]) return pts[a][axis] < pts[b][axis];
            return a < b;
        });
        int mid = (lo + hi) / 2;
        build(lo, mid, depth + 1);
        build(mid + 1, hi, depth + 1);
    }

    int nearest(const vector<int> &q) {
        best_d = 1LL << 60; best_i = -1;
        visited = 0; pruned = 0;
        go(0, (int)pts.size(), 0, q);
        return best_i;
    }

    void go(int lo, int hi, int depth, const vector<int> &q) {
        if (hi - lo <= 0) return;
        int mid = (lo + hi) / 2;
        const vector<int> &p = pts[idx[mid]];
        visited++;
        long long d = dist2(p, q, K);
        if (d < best_d) { best_d = d; best_i = idx[mid]; }  // 강한 부등호

        int axis = depth % K;
        long long diff = q[axis] - p[axis];
        int near[2], far[2];
        if (diff < 0) { near[0] = lo; near[1] = mid; far[0] = mid + 1; far[1] = hi; }
        else          { near[0] = mid + 1; near[1] = hi; far[0] = lo; far[1] = mid; }

        go(near[0], near[1], depth + 1, q);
        // 가지치기 — 분할 평면까지의 거리가 현재 최선보다 멀면 반대쪽엔 답이 없다
        if (diff * diff < best_d) go(far[0], far[1], depth + 1, q);
        else if (far[1] - far[0] > 0) pruned++;
    }
};

void brute_nearest(const vector<vector<int>> &pts, const vector<int> &q, int K,
                   int &best_i, long long &best_d) {
    best_d = 1LL << 60; best_i = -1;
    for (int i = 0; i < (int)pts.size(); i++) {
        long long d = dist2(pts[i], q, K);
        if (d < best_d) { best_d = d; best_i = i; }
    }
}

int main() {
    const int N = 2000, QN = 300, K = 2;
    uint64_t s = 20260805;
    vector<vector<int>> pts = make_points(N, K, s);
    KDTree tree(pts, K);
    printf("점 %d개 · %d차원 · 좌표 [0,1000)\n", N, K);

    int mismatch = 0; long long vis = 0, pr = 0;
    for (int t = 0; t < QN; t++) {
        vector<int> q = make_points(1, K, s)[0];
        tree.nearest(q);
        int bi; long long bd;
        brute_nearest(pts, q, K, bi, bd);
        if (tree.best_d != bd) mismatch++;
        vis += tree.visited;
        pr += tree.pruned;
    }
    printf("전수 비교와 대조: %d회 중 불일치 %d회\n", QN, mismatch);
    printf("질의당 거리 계산: 전수 %d · KD 트리 %lld\n", N, vis / QN);
    printf("질의당 잘라낸 가지: %lld\n", pr / QN);
    return 0;
}
```
:::

```console
점 2000개 · 2차원 · 좌표 [0,1000)
전수 비교와 대조: 300회 중 불일치 0회
질의당 거리 계산: 전수 2000 · KD 트리 16
질의당 잘라낸 가지: 11
```

**300회 전부 전수 비교와 답이 같고, 질의당 2,000개 대신 16개를 본다.** 그리고 가지 11개를 잘랐다 — 이 11이 $O(\log n)$의 정체다.

**복잡도:** 구축은 시간 $O(n \log^2 n)$ — 깊이 $\log n$의 각 레벨에서 구간들을 전부 정렬하므로 레벨당 $O(n \log n)$이다. `nth_element`(C++)나 median-of-medians로 중앙값만 뽑으면 레벨당 $O(n)$이 되어 $O(n \log n)$으로 내려간다. 공간 $O(n)$ — 인덱스 배열 하나가 전부다.

질의는 **2·3차원 균일 분포에서 기대 $O(\log n)$** — 가지치기가 절반 이상을 잘라 내는 경우다. **최악은 $O(n)$**이고, 차원이 오르면 최악이 평균이 된다(§2.5). 상수도 크다 — 노드 하나마다 재귀 호출·축 계산·거리 계산이 붙어 평면 배열 그리드보다 노드당 비용이 비싸다. §2.2의 실측에서 균일 분포일 때 KD 트리(23.1회)가 그리드(9.6회)보다 **더 많이** 거리를 계산한 것이 그 때문이고, 그래서 균일 분포에서는 그리드가 이긴다.

### 4.3 차원을 올려 본다

앞의 `KDTree`를 그대로 두고 차원만 바꾼다. 코드는 한 줄도 고치지 않는다 — `K`가 이미 인자다.

::: dual
```python title="차원의 저주 (조각) — 앞의 KDTree 를 그대로 쓴다"
print()
print("차원  질의당 방문 노드  전체 대비")
for K in (2, 4, 8, 16):
    pts, s = make_points(N, K, 20260805)
    tree = KDTree(pts, K)
    vis = 0
    for _ in range(100):
        q, s = make_points(1, K, s)
        tree.nearest(q[0])
        vis += tree.visited
    per = vis // 100
    pm = per * 1000 // N          # 천분율. 두 언어에서 같은 정수 나눗셈이어야 한다
    print(f"{K:>4} {per:>17} {pm // 10:>7}.{pm % 10}%")
```
```cpp title="차원의 저주 (조각) — 앞의 KDTree 를 그대로 쓴다"
    printf("\n차원  질의당 방문 노드  전체 대비\n");
    for (int K2 : {2, 4, 8, 16}) {
        uint64_t s2 = 20260805;
        vector<vector<int>> pts2 = make_points(N, K2, s2);
        KDTree tree2(pts2, K2);
        long long vis2 = 0;
        for (int t = 0; t < 100; t++) {
            vector<int> q = make_points(1, K2, s2)[0];
            tree2.nearest(q);
            vis2 += tree2.visited;
        }
        long long per = vis2 / 100;
        long long pm = per * 1000 / N;   // 천분율. 두 언어에서 같은 정수 나눗셈이어야 한다
        printf("%4d %17lld %7lld.%lld%%\n", K2, per, pm / 10, pm % 10);
    }
```
:::

```console
차원  질의당 방문 노드  전체 대비
   2                16       0.8%
   4                50       2.5%
   8               543      27.1%
  16              1985      99.2%
```

$n = 2{,}000$에서 잰 값이라 §2.5의 표($n = 4{,}000$)와 중간 차원의 비율이 다르다. **$n$이 커지면 낮은 차원의 비율은 내려가고 높은 차원은 100%에 붙어 있다.** 이것이 "$n \gg 2^K$일 때만 이긴다"의 실측 형태다.

| 언어 차이 | Python | C++ |
|---|---|---|
| 중앙값 뽑기 | `sorted()` 로 구간 전체를 정렬. 부분 정렬 함수가 표준에 없다 | `nth_element` 로 $O(n)$ 선택이 가능하다([0-7](#/0-7)). 구축이 $O(n\log n)$으로 내려간다 |
| 정렬 안정성 | `sorted` 는 안정 정렬 | `std::sort` 는 **불안정**. 좌표가 같을 때 순서가 달라져 트리 모양이 갈린다 → 두 코드 다 키에 인덱스를 넣어 못 박았다 |
| 재귀 깊이 | 기본 1,000. $n$이 $2^{1000}$보다 작으면 트리 깊이로는 안 걸리지만 `setrecursionlimit` 을 걸어 둔다 | 스택 한도까지. 깊이 $\log n$이라 문제되지 않는다 |
| 좌표 타입 | 임의 정밀도 정수. 제곱거리가 넘칠 일이 없다 | `int` 곱셈은 넘친다. 좌표가 $10^5$를 넘으면 `long long` 필수 |
| 점 표현 | `list[list[int]]` — 원소마다 객체 포인터 | `vector<vector<int>>` — 안쪽은 연속. 좌표 개수가 고정이면 `array<int,K>` 가 더 낫다 |

::: pitfall
- **제곱근을 쓴다.** 거리 비교에 `sqrt` 는 필요 없다. 제곱거리끼리 비교하면 순서가 같고, `sqrt` 는 정수를 부동소수로 바꿔 [X-7](#/x-7)의 비교 문제까지 끌고 들어온다.
- **그리드에서 한 링만 보고 끝낸다.** 이웃 셀 8개까지만 보는 구현은 셀 경계 바로 너머의 점을 놓친다. **링의 최소 거리와 현재 최선을 비교하는 종료 조건**이 있어야 정확하다.
- **가까운 쪽을 먼저 내려가지 않는다.** 답은 맞지만 최선이 늦게 좁혀져 가지치기가 안 먹힌다. 정확성이 아니라 속도가 순서에 달려 있다.
- **`d <= best_d` 로 쓴다.** 동점일 때 답이 바뀐다. 전수 비교와 대조하는 시험에서 **거리는 같은데 인덱스가 달라** 실패로 뜬다. 시험은 거리로 비교하라.
- **점이 움직이는데 인덱스를 다시 안 만든다.** KD 트리는 삽입·삭제에 약하다. 매 프레임 전부 움직이는 데이터라면 **매 프레임 새로 만드는 그리드**가 낫다 — 구축이 $O(n)$이라 다시 만드는 편이 싸다.
- **정수 오버플로.** C++에서 좌표가 $10^5$면 제곱거리는 $2 \times 10^{10}$이라 `int` 를 넘는다. 조용히 음수가 되어 "가장 가까운 점"이 반대편에 있는 점으로 나온다.
:::

## 5. 어디에 쓰이는가

**게임 엔진과 물리 엔진의 브로드 페이즈가 그리드 해싱이다.** 충돌 검사를 물체 쌍 전부에 대해 하면 $O(n^2)$이므로, 먼저 공간 인덱스로 "겹칠 수 있는 쌍"만 추리고(브로드 페이즈) 그 쌍에만 정확한 검사를 돌린다(내로 페이즈). 물체 크기가 비슷하면 그리드가, 크기 차이가 크면 경계 상자 계층(R 트리의 이진 버전인 BVH)이 쓰인다. 정확한 겹침 판정은 [X-5 기하](#/x-5)에 있다.

**포인트클라우드 처리의 기본 자료구조가 KD 트리와 옥트리다.** 두 스캔을 정합하는 ICP는 매 반복마다 모든 점의 최근접을 찾으므로([XIII-5](#/xiii-5)), 인덱스 없이는 반복 한 번이 $O(n^2)$이다. 점군 라이브러리들이 최근접 검색기를 KD 트리로, 복셀 다운샘플링을 옥트리로 구현하는 이유다.

**공간 DB의 인덱스가 R 트리다.** "이 사각형 안의 가게를 전부 찾아라", "여기서 반경 1 km 안의 정류장" 같은 질의를 B-Tree로는 풀 수 없다 — B-Tree는 한 축의 순서만 알고 2차원의 근접성은 모른다([XV-2](#/xv-2)). 대안으로 공간을 1차원으로 접는 방법(힐베르트 곡선, 지오해시)도 쓰이는데, 그 접기의 목적 역시 **가까운 것이 가까운 번호를 받게 만들어** B-Tree에 태우는 것이다.

**로봇의 코스트맵도 사실 그리드 해싱이다.** [V-12 지역 경로계획](#/v-12)의 코스트맵은 공간을 고정 크기 셀로 나눈 배열이고, 장애물 점을 셀에 찍어 넣는 연산이 정확히 §4.1의 `build_grid` 다. 인플레이션은 그 격자 위의 다중 시작점 BFS([IV-4](#/iv-4))다.

::: interview
**"10만 개의 좌표에서 가장 가까운 점을 찾는 API를 만든다면 어떤 자료구조를 쓰겠는가."**

답의 뼈대는 되묻는 것에서 시작한다. **되묻지 않고 바로 "KD 트리요"라고 답하는 것이 이 질문에서 가장 흔한 실패다.**

1. **데이터가 정적인가 갱신되는가.** 정적이면 KD 트리를 한 번 만들어 두면 되고, 매 프레임 전부 움직이면 그리드를 매번 새로 만드는 편이 싸다($O(n)$ 구축 대 $O(n\log n)$).
2. **분포가 고른가 뭉치는가.** 고르면 평면 배열 그리드가 가장 빠르고 가장 단순하다. 뭉치면 그리드는 한 셀에 몰려 전수 비교로 퇴화한다.
3. **차원이 몇인가.** 2·3차원이면 무엇이든 되고, 10차원을 넘으면 KD 트리의 가지치기가 죽어 전수 비교와 같아진다. 그 영역에서는 정확한 최근접을 포기하고 근사 검색으로 간다.
4. **점인가 범위인가.** 부피가 있으면 R 트리·BVH 계열이다.

여기에 실측을 하나 붙이면 답이 끝난다. "16차원에서 방문 노드가 전체의 99.8%였다"는 문장은 외운 지식이 아니라 재 본 사람의 문장이다.
:::

## 6. 무엇을 고를 것인가

| 질문 | 예 | 아니오 |
|---|---|---|
| 대상이 점인가 | 아래로 | **R 트리 / BVH** |
| 차원이 3 이하인가 | 아래로 | **근사 검색**(이 책의 범위 밖) |
| 분포가 고르고 범위가 유계인가 | **그리드 해싱** | 아래로 |
| 3차원이고 빈 공간이 넓은가 | **옥트리** | **KD 트리** |
| 매 프레임 전부 움직이는가 | **그리드**(다시 만든다) | 트리를 유지한다 |

## 연습

::: quiz
설계 질문이다. 세 단계로 답하라 — **상황 / 무엇이 병목인가 / 어떤 구조이고 대가는 무엇인가.**

**1. 창고 로봇 200대의 충돌 예측**
- 상황: 200대가 각자 좌표를 20 Hz로 올린다. 매 주기마다 "3 m 안에 다른 로봇이 있는가"를 전부에 대해 답해야 한다.
- 병목: 쌍 검사가 $200 \times 199 / 2 = 19{,}900$회 × 20 Hz = 초당 40만 회. 지금은 돌지만 대수가 1,000대가 되면 25배가 된다.
- 구조: 셀 3 m짜리 그리드. 로봇은 창고 바닥에 고르게 퍼지고 매 주기 전부 움직이므로 **매번 새로 만드는 것이 옳다** — 구축이 $O(n)$이다. 대가는 셀 크기가 질의 반경에 묶인다는 것. 반경이 상황마다 다르면 링 확장이 필요하다.

**2. 지도 앱의 "근처 정류장"**
- 상황: 전국 정류장 10만 개는 거의 안 바뀐다. 사용자 좌표에서 가장 가까운 5개를 답한다.
- 병목: 정류장은 도시에 극단적으로 몰려 있다. 서울 한 셀에 수천 개, 산간 셀은 0개다.
- 구조: KD 트리. 밀도가 자리마다 달라도 분할이 데이터를 따라간다. $k$개를 찾으려면 최선 하나 대신 **크기 $k$짜리 최대 힙**을 들고 다니고, 가지치기 기준을 힙의 최댓값으로 바꾼다([II-8](#/ii-8)). 대가는 갱신이 어렵다는 것 — 정류장이 하나 늘면 다시 만드는 편이 낫다.

**3. 라이다 점군 정합**
- 상황: 프레임마다 점 10만 개. 이전 프레임의 점들과 최근접 쌍을 만들어 자세를 추정한다. 반복 20회.
- 병목: 반복마다 최근접 10만 회 × 20회 = 200만 회. 전수 비교면 $2 \times 10^{11}$이다.
- 구조: 이전 프레임에 대해 KD 트리를 **한 번** 만들고 20회 반복 내내 재사용한다. 구축 비용이 질의 200만 회에 분산된다. 3차원이라 가지치기가 잘 먹는다. 대가는 구축 시간이고, 그것을 줄이려면 점을 먼저 복셀 다운샘플링한다.

**4. 배달 매칭의 "가장 가까운 기사 3명"**
- 상황: 기사 3만 명이 계속 움직이고, 주문은 초당 수백 건 들어온다. 읽기와 쓰기가 둘 다 많다.
- 병목: KD 트리는 삽입·삭제가 약하고, 매 초 다시 만들기에는 기사 위치가 계속 바뀐다.
- 구조: 그리드 해싱 + 셀 단위 갱신. 기사가 움직이면 이전 셀에서 빼고 새 셀에 넣는 $O(1)$ 연산만 한다. 대가는 도심 셀에 기사가 몰려 그 셀이 커지는 것 — 실무에서는 셀 크기를 지역별로 다르게 두거나 지오해시 접두사 길이를 지역별로 바꾼다.
:::

## 요약

- 공간 인덱스가 하는 일은 하나다. **좌표를 보고 "여긴 볼 필요 없다"를 잘라 내는 것.**
- **그리드 해싱**은 셀 번호가 곧 배열 첨자다. 구축 $O(n)$, 점이 고르면 질의 기대 $O(1)$. 한 셀에 몰리면 전수 비교로 퇴화한다.
- **KD 트리**는 축을 번갈아 가며 중앙값으로 자른다. 가지치기 판정은 한 줄이다 — **분할 평면까지의 거리가 현재 최선보다 멀면 그 가지는 안 본다.**
- 균일 분포 10만 점에서 평면 배열 그리드 2.5 ms, KD 트리 3.8 ms, 전수 비교 710 ms. **뭉친 분포에서는 그리드가 16.6 ms로 무너지고 KD 트리가 4.8 ms로 이긴다.**
- **차원의 저주는 실측된다.** 방문 노드 비율이 2차원 0.4%, 8차원 12%, 16차원 **99.8%**다. $n \gg 2^K$가 아니면 KD 트리는 느린 전수 비교다.
- 점이 아니라 부피를 가진 객체면 R 트리·BVH다. **KD 트리는 공간을 겹치지 않게 나누고, R 트리는 객체를 겹칠 수 있게 묶는다.**
- 매 프레임 전부 움직이는 데이터에는 트리를 유지하지 말고 그리드를 다시 만들어라. 구축 $O(n)$이 갱신보다 싸다.

**다음 절**: [XI-10 그래프의 메모리 표현](#/xi-10) — §4.1의 `start`·`item` 두 배열이 그대로 대규모 그래프의 표준 표현이 된다. 인접 리스트가 왜 무너지는지를 캐시로 다시 본다.
