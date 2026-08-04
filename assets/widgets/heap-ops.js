/* heap-ops.js — 이진 힙의 삽입·삭제·heapify
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **트리는 그림일 뿐이고, 실제 힙은 배열이다.**
 * 트리만 본 독자는 코드를 못 짠다. 코드는 `2*i+1` 을 쓰기 때문이다.
 * 그래서 두 표현을 동시에 띄우고, 같은 노드를 양쪽에서 동시에 강조한다.
 * 상태 줄에는 인덱스 산술을 문장으로 적는다 — 이것이 두 그림을 잇는 다리다.
 *
 * 0-based 인덱싱으로 통일한다. 본문 `::: dual` 코드(Python heapq / C++ vector)와
 * 같은 식이어야 하기 때문이다:  부모 (i-1)/2,  자식 2i+1 / 2i+2.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 트리 깊이가 5레벨(31개)을 넘으면 잎 간격이 글자보다 좁아져 읽을 수 없다.
  // "많이 보여주기"보다 "읽히게 보여주기"가 우선이라 여기서 자른다.
  var MAX_N = 31;
  var MAX_STEPS = 420;   // §7: 스텝 수 상한. 대본이 이상하면 잘라낸다.

  // ---------------------------------------------------------------- opts 검증
  //
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 무엇이 들어와도 던지지 않는다.

  function toInt(v, dflt) {
    var n;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && v.trim() !== '') n = Number(v);
    else return dflt;
    if (!isFinite(n)) return dflt;
    return Math.round(n);
  }

  function clampVal(v) {
    // 칸 안에 들어가야 하므로 표시 가능한 범위로 자른다.
    var n = toInt(v, null);
    if (n === null) return null;
    return Math.max(-99, Math.min(999, n));
  }

  var DEFAULT_VALUES = [9, 4, 7, 1, 8, 2, 6, 3, 5];

  function normValues(raw) {
    if (!raw || typeof raw.length !== 'number' || typeof raw === 'string') return DEFAULT_VALUES.slice();
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_N; i++) {
      var v = clampVal(raw[i]);
      if (v !== null) out.push(v);
    }
    return out.length ? out : DEFAULT_VALUES.slice();
  }

  var OPS = { push: 1, pop: 1, heapify: 1, peek: 1 };

  function normOps(raw) {
    // 허용 형태: [["push",7],["pop"],["heapify"],["heapify",[3,1,2]],"pop"
    if (!raw || typeof raw.length !== 'number' || typeof raw === 'string') return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      var name = null, arg;
      if (typeof e === 'string') { name = e; }
      else if (e && typeof e.length === 'number') { name = e[0]; arg = e[1]; }
      if (typeof name !== 'string') continue;
      name = name.toLowerCase();
      if (!OPS[name]) continue;
      if (name === 'push') out.push({ op: 'push', v: clampVal(arg) });          // null 이면 자동 선택
      else if (name === 'heapify') out.push({ op: 'heapify', arr: (arg && typeof arg.length === 'number' && typeof arg !== 'string') ? normValues(arg) : null });
      else out.push({ op: name });
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- 힙 알고리즘
  //
  // 본문 `::: dual` 에 실릴 코드와 **같은 알고리즘**이어야 한다. 위젯이 거짓말을
  // 하면 독자는 코드와 그림 사이에서 길을 잃는다.

  function prefers(x, y, isMin) {
    // x 가 y 보다 위(부모 쪽)에 있어야 하는가
    return isMin ? x < y : x > y;
  }

  function isHeap(a, n, isMin) {
    for (var i = 1; i < n; i++) {
      var p = (i - 1) >> 1;
      if (prefers(a[i], a[p], isMin)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- 스텝 생성
  //
  // §7: 상태를 미리 전부 계산해 배열에 담는다. render(i) 는 그리기만 한다.
  // 그래야 되감기가 즉시 되고, 같은 i 는 항상 같은 그림이 된다.

  function rel(x, y) { return x < y ? '<' : (x > y ? '>' : '='); }

  function build(values, isMin, ops) {
    var a = values.slice();
    var n = a.length;
    var steps = [];
    var starts = [];        // 각 연산이 시작하는 스텝 번호 (버튼이 그리로 점프한다)
    var opName = '초기';
    var settledLo = MAX_N + 1;   // 이 인덱스부터는 이번 연산에서 확정된 자리
    var out = null;         // pop 으로 꺼낸 값 (표시용)
    var swaps = 0;          // 이번 연산의 교환 횟수
    var truncated = false;

    function begin(name) { starts.push(steps.length); opName = name; }

    function push(o) {
      if (steps.length >= MAX_STEPS) { truncated = true; return false; }
      steps.push({
        arr: a.slice(),
        n: n,
        op: opName,
        i: o.i == null ? -1 : o.i,
        j: o.j == null ? -1 : o.j,
        l: o.l == null ? -1 : o.l,
        r: o.r == null ? -1 : o.r,
        swap: !!o.swap,
        dir: o.dir || '',        // 'up' | 'down' | ''
        settledLo: o.all ? 0 : settledLo,
        allSettled: !!o.all,
        out: out,
        msg: o.msg || ''
      });
      return true;
    }

    // --- 위로 올리기 (삽입) ---
    function siftUp(i) {
      var guard = 0;
      while (i > 0 && guard++ < MAX_N * 2) {
        var p = (i - 1) >> 1;
        var doSwap = prefers(a[i], a[p], isMin);
        var arith = 'i=' + i + ' 의 부모는 (' + i + '-1)/2 = ' + p + '. ';
        if (doSwap) {
          if (!push({
            i: i, j: p, dir: 'up',
            msg: arith + 'heap[' + i + ']=' + a[i] + ' ' + rel(a[i], a[p]) + ' heap[' + p + ']=' + a[p] +
                 ' 이므로 교환한다.'
          })) return i;
          var t = a[i]; a[i] = a[p]; a[p] = t; swaps++;
          if (!push({
            i: p, j: i, swap: true, dir: 'up',
            msg: '교환했다(' + i + ' ↔ ' + p + '). 올라온 값 ' + a[p] + ' 는 이제 i=' + p + ' 에 있다.'
          })) return p;
          i = p;
        } else {
          push({
            i: i, j: p, dir: 'up',
            msg: arith + 'heap[' + i + ']=' + a[i] + ' ' + rel(a[i], a[p]) + ' heap[' + p + ']=' + a[p] +
                 ' 라 ' + (isMin ? '부모가 더 작거나 같다' : '부모가 더 크거나 같다') + '. 힙 성질을 만족하므로 여기서 멈춘다.'
          });
          return i;
        }
      }
      push({ i: 0, dir: 'up', msg: '루트(i=0)에 도달했다. 더 올라갈 부모가 없으므로 끝이다.' });
      return 0;
    }

    // --- 아래로 내리기 (삭제·heapify) ---
    function siftDown(i, stopAt) {
      var guard = 0;
      while (guard++ < MAX_N * 2) {
        var l = 2 * i + 1, r = 2 * i + 2, best = i;
        if (l < stopAt && prefers(a[l], a[best], isMin)) best = l;
        if (r < stopAt && prefers(a[r], a[best], isMin)) best = r;

        if (l >= stopAt) {
          push({
            i: i, dir: 'down',
            msg: 'i=' + i + ' 의 왼쪽 자식은 2·' + i + '+1 = ' + l + ' 인데 힙 크기 ' + stopAt +
                 ' 를 넘는다. 자식이 없는 잎이므로 여기서 멈춘다.'
          });
          return i;
        }

        var kids = 'i=' + i + ' 의 자식은 2·' + i + '+1 = ' + l +
                   (r < stopAt ? ', 2·' + i + '+2 = ' + r : ' (오른쪽 자식 없음)') + '. ';
        var vals = 'heap[' + i + ']=' + a[i] + ', heap[' + l + ']=' + a[l] +
                   (r < stopAt ? ', heap[' + r + ']=' + a[r] : '') + ' → ';
        var word = isMin ? '가장 작은 것' : '가장 큰 것';

        if (best === i) {
          push({
            i: i, l: l, r: (r < stopAt ? r : -1), dir: 'down',
            msg: kids + vals + word + '은 자기 자신이다. 힙 성질을 만족하므로 멈춘다.'
          });
          return i;
        }
        if (!push({
          i: i, l: l, r: (r < stopAt ? r : -1), j: best, dir: 'down',
          msg: kids + vals + word + '은 heap[' + best + ']=' + a[best] + '. heap[' + i + ']=' + a[i] +
               ' 와 교환한다.'
        })) return i;
        var t2 = a[i]; a[i] = a[best]; a[best] = t2; swaps++;
        if (!push({
          i: best, j: i, swap: true, dir: 'down',
          msg: '교환했다(' + i + ' ↔ ' + best + '). 내려간 값 ' + a[best] + ' 를 i=' + best + ' 에서 다시 본다.'
        })) return best;
        i = best;
      }
      return i;
    }

    // --- 연산들 ---

    function opPush(v) {
      begin('push ' + v);
      settledLo = 0;
      out = null;
      swaps = 0;
      if (n >= MAX_N) {
        push({ msg: 'push ' + v + ': 배열이 가득 찼다(최대 ' + MAX_N + '칸). 트리가 읽을 수 없게 커지므로 여기서는 넣지 않는다.' });
        return;
      }
      a[n] = v;
      n += 1;
      push({
        i: n - 1, dir: 'up',
        msg: 'push(' + v + '): 배열의 맨 끝 i=' + (n - 1) + ' 에 붙인다. 트리로는 마지막 레벨의 다음 빈 자리다. 이제 위로 올린다.'
      });
      siftUp(n - 1);
      push({ all: true, msg: 'push(' + v + ') 완료. 교환 ' + swaps + '회. 최악이라도 트리 높이 ⌊log₂' + n + '⌋ = ' + depthOf(n) + ' 번뿐이다 — O(log n).' });
    }

    function opPop() {
      begin('pop');
      settledLo = 0;
      swaps = 0;
      if (n === 0) {
        out = null;
        push({ msg: 'pop: 힙이 비어 있다. 꺼낼 것이 없다.' });
        return;
      }
      out = a[0];
      push({
        i: 0,
        msg: 'pop(): 루트 heap[0]=' + out + ' 가 ' + (isMin ? '최솟값' : '최댓값') + '이다. 이 값을 꺼낸다.'
      });
      var lastIdx = n - 1;
      if (lastIdx === 0) {
        a[0] = null;
        n = 0;
        push({ all: true, msg: '마지막 한 개였다. 힙이 비었다. 꺼낸 값은 ' + out + '.' });
        return;
      }
      a[0] = a[lastIdx];
      a[lastIdx] = null;
      n -= 1;
      push({
        i: 0, dir: 'down',
        msg: '맨 뒤 heap[' + lastIdx + ']=' + a[0] + ' 를 루트로 옮기고 크기를 ' + n +
             ' 로 줄인다. 왜 맨 뒤인가 — 그래야 트리가 완전 이진 트리로 남고 배열에 구멍이 안 생긴다.'
      });
      siftDown(0, n);
      push({ all: true, msg: 'pop() 완료. 꺼낸 값 ' + out + ', 교환 ' + swaps + '회. 내려간 거리는 최대 트리 높이 ' + depthOf(n) + ' — O(log n).' });
    }

    function opHeapify(replace) {
      begin('heapify');
      out = null;
      swaps = 0;
      if (replace) { a = replace.slice(); n = a.length; }
      settledLo = n;   // 아직 아무 자리도 확정되지 않았다
      var start = (n >> 1) - 1;
      if (start < 0) {
        // n ≤ 1 이면 내부 노드가 없어 반복문이 한 번도 돌지 않는다.
        push({ msg: 'heapify: 원소가 ' + n + '개뿐이라 자식을 가진 노드가 없다. 잎만 있는 트리는 그 자체로 힙이다 — 할 일이 없다.' });
      } else {
        push({
          msg: 'heapify: 아래에서 위로 쌓는다. 인덱스 ' + start + ' = ⌊' + n + '/2⌋-1 부터 0 까지 거꾸로 내려가며 sift-down. ' +
               'i ≥ ' + (n >> 1) + ' 인 칸은 전부 잎이라 이미 힙이다 — 그래서 절반은 손도 대지 않는다.'
        });
      }
      for (var k = start; k >= 0; k--) {
        settledLo = k + 1;
        push({
          i: k, dir: 'down',
          msg: 'i=' + k + ' 를 뿌리로 하는 부분 트리 차례다. 자식 쪽(i > ' + k + ')은 이미 힙이므로, ' +
               'heap[' + k + ']=' + a[k] + ' 하나만 제자리로 내려보내면 된다.'
        });
        siftDown(k, n);
      }
      settledLo = 0;
      var nlogn = n > 1 ? Math.round(n * Math.log(n) / Math.LN2) : 0;
      push({
        all: true,
        msg: 'heapify 완료. 교환 ' + swaps + '회. 하나씩 push 했다면 최대 n·log₂n ≈ ' + nlogn +
             '회다. 노드의 절반은 잎이라 내려갈 거리가 0, 그 위 4분의 1은 1 — 이 합이 O(n) 으로 수렴한다.'
      });
    }

    function opPeek() {
      begin('peek');
      settledLo = 0;
      out = null;
      if (n === 0) { push({ msg: 'peek: 힙이 비어 있다.' }); return; }
      push({
        i: 0, all: true,
        msg: 'peek(): 배열의 0번 칸 하나만 읽으면 끝이다. heap[0]=' + a[0] + ' 가 ' +
             (isMin ? '최솟값' : '최댓값') + '. 비교도 이동도 없으니 O(1).'
      });
    }

    // --- 대본 실행 ---

    // 첫 연산이 heapify 가 아닌데 초기 배열이 힙이 아니면, 조용히 heapify 를 앞에 끼운다.
    // 힙이 아닌 배열에 push/pop 을 하는 그림은 독자에게 거짓말이 된다.
    var script = ops.slice();
    var autoHeapify = false;
    if (!isHeap(a, n, isMin) && !(script[0] && script[0].op === 'heapify')) {
      script.unshift({ op: 'heapify', arr: null });
      autoHeapify = true;
    }

    begin('초기');
    push({
      msg: '초기 배열 [' + a.slice(0, n).join(', ') + ']. ' +
           (isHeap(a, n, isMin)
             ? '이미 ' + (isMin ? '최소' : '최대') + ' 힙 성질을 만족한다.'
             : (isMin ? '부모가 자식보다 작다' : '부모가 자식보다 크다') + '는 성질이 아직 깨져 있다' +
               (autoHeapify ? ' — 그래서 heapify 부터 한다.' : '.'))
    });

    for (var s = 0; s < script.length; s++) {
      if (steps.length >= MAX_STEPS) { truncated = true; break; }
      var o = script[s];
      if (o.op === 'push') {
        var v = o.v;
        if (v === null || v === undefined) {
          // 자동 값: 반드시 끝까지 올라가도록 골라 sift-up 을 온전히 보여 준다.
          var ext = a[0];
          for (var q = 1; q < n; q++) { if (prefers(a[q], ext, isMin)) ext = a[q]; }
          v = clampVal(isMin ? (n ? ext - 1 : 5) : (n ? ext + 1 : 5));
        }
        opPush(v);
      } else if (o.op === 'pop') opPop();
      else if (o.op === 'heapify') opHeapify(o.arr);
      else if (o.op === 'peek') opPeek();
    }

    if (truncated) {
      steps.push({
        arr: a.slice(), n: n, op: '중단', i: -1, j: -1, l: -1, r: -1, swap: false, dir: '',
        settledLo: 0, allSettled: true, out: null,
        msg: '스텝이 ' + MAX_STEPS + '개를 넘어 여기서 자른다. ops 대본을 줄여라.'
      });
    }

    // 최대 크기: 트리 배치를 이 값으로 고정한다. 그래야 스텝마다 그림이 튀지 않는다.
    var maxN = 1;
    for (var t = 0; t < steps.length; t++) maxN = Math.max(maxN, steps[t].n);
    return {
      steps: steps, starts: starts, maxN: Math.max(1, Math.min(MAX_N, maxN)),
      final: a.slice(0, n), finalN: n
    };
  }

  function depthOf(n) {
    var d = 0;
    while ((2 << d) - 1 < n) d++;   // (2<<d)-1 == 2^(d+1)-1
    return d;
  }

  // ---------------------------------------------------------------- 배치 계산
  //
  // 왜 "타이디 배치"인가: 레벨마다 2^d 칸을 통째로 잡으면 마지막 레벨이 반만
  // 차 있어도 폭을 다 먹어 좁은 화면에서 글자가 뭉갠다. 잎을 왼쪽부터 차례로
  // 세우고 부모를 자식들의 중점에 두면 실제 노드 수만큼만 폭을 쓴다.
  // 이 방식은 정의상 간선이 서로 교차하지 않는다.
  function tidyCols(n) {
    var col = new Array(n), next = 0;
    (function walk(i) {
      if (i >= n) return;
      var l = 2 * i + 1, r = 2 * i + 2;
      if (l >= n) { col[i] = next++; return; }   // 잎
      walk(l);
      var lx = col[l], rx;
      if (r < n) { walk(r); rx = col[r]; }
      else { rx = next++; }                      // 오른쪽 자리를 비워야 왼쪽 자식이 왼쪽에 보인다
      col[i] = (lx + rx) / 2;
    })(0);
    return { col: col, cols: Math.max(1, next) };
  }

  function layout(w, maxN) {
    var tiny = w < 460, narrow = w < 700;
    var pad = tiny ? 6 : (narrow ? 10 : 16);
    var nodeH = tiny ? 21 : (narrow ? 24 : 28);
    // 간선이 보이는 길이. 여기에 인덱스 산술 라벨(높이 13)이 들어가야 하므로
    // 최소 18은 확보한다. 이 값이 작으면 박스끼리 붙어 트리로 안 보인다.
    var edge = tiny ? 20 : (narrow ? 25 : 32);
    var vgap = nodeH + edge;                        // 레벨 간 세로 간격(박스 위쪽끼리)
    var headH = tiny ? 13 : 15;                     // 구역 제목 한 줄

    var t = tidyCols(maxN);
    var levels = depthOf(maxN) + 1;

    // 인덱스 규칙 패널: 넓으면 트리 오른쪽에, 좁으면 트리 아래 한 줄로.
    var panelW = narrow ? 0 : 148;
    var panelH = narrow ? 0 : 66;
    var ruleLineH = narrow ? 15 : 0;

    var availW = Math.max(80, w - pad * 2);
    var treeAreaW = Math.max(80, availW - (panelW ? panelW + 14 : 0));
    // 노드가 몇 개 없을 때 트리가 화면 끝까지 벌어지면 오히려 읽기 나쁘다. 칸 폭에 상한을 둔다.
    var colW = Math.min(treeAreaW / t.cols, tiny ? 44 : (narrow ? 62 : 92));
    // 칸 폭을 다 채우지 않는다. 박스 사이에 틈이 있어야 이웃 노드와 구분된다.
    var nodeW = Math.max(18, Math.min(colW * (tiny ? 0.82 : 0.88), tiny ? 34 : (narrow ? 40 : 48)));
    var treeW = colW * t.cols;
    var treeX = pad + Math.max(0, (treeAreaW - treeW) / 2);

    var treeTop = pad + headH;
    // 레벨 간격 vgap = 박스 위쪽끼리의 거리. 마지막 레벨의 박스 높이까지 포함한다.
    var treeH = (levels - 1) * vgap + nodeH;
    if (!narrow) treeH = Math.max(treeH, panelH);   // 노드가 적어도 패널이 잘리면 안 된다

    var arrTop = treeTop + treeH + ruleLineH + (tiny ? 12 : 22) + headH;

    // 배열은 "더 중요한 뷰"다. 좁으면 줄바꿈해서라도 칸 크기를 지킨다.
    var minCell = tiny ? 26 : 30;
    var perRow = Math.max(1, Math.min(maxN, Math.floor(availW / minCell)));
    var rows = Math.ceil(maxN / perRow);
    var cellW = Math.min(tiny ? 40 : 48, availW / perRow);
    var cellH = nodeH;
    var rowGap = tiny ? 7 : 9;
    var arrW = cellW * Math.min(maxN, perRow);
    var arrX = pad + Math.max(0, (availW - arrW) / 2);

    // "꺼낸 값" 칩 자리를 항상 비워 둔다. 있을 때만 높이를 바꾸면 pop 스텝에서
    // 캔버스 높이가 튀어 아래 본문이 흔들린다.
    var outH = tiny ? 18 : 21;
    var arrBottom = arrTop + rows * (cellH + rowGap) - rowGap;
    var h = arrBottom + outH + pad;

    return {
      w: w, tiny: tiny, narrow: narrow, pad: pad, headH: headH,
      cols: t.cols, col: t.col, levels: levels,
      colW: colW, nodeW: nodeW, nodeH: nodeH, vgap: vgap, edge: edge,
      treeX: treeX, treeTop: treeTop, treeH: treeH,
      panelW: panelW, panelH: panelH, panelX: pad + treeAreaW + 14, panelY: pad + headH,
      ruleLineY: treeTop + treeH + (tiny ? 4 : 6), ruleLineH: ruleLineH,
      arrTop: arrTop, arrX: arrX, arrW: arrW, arrBottom: arrBottom, outH: outH,
      cellW: cellW, cellH: cellH, perRow: perRow, rows: rows, rowGap: rowGap,
      height: h
    };
  }

  function nodeXY(L, k) {
    var d = depthOf(k + 1);       // k 의 레벨 = ⌊log₂(k+1)⌋
    return {
      x: L.treeX + (L.col[k] + 0.5) * L.colW - L.nodeW / 2,
      y: L.treeTop + d * L.vgap
    };
  }

  function cellXY(L, k) {
    var r = Math.floor(k / L.perRow), c = k % L.perRow;
    return { x: L.arrX + c * L.cellW, y: L.arrTop + r * (L.cellH + L.rowGap) };
  }

  // ---------------------------------------------------------------- 그리기 보조

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  K.register('heap-ops', function (host, opts) {
    opts = opts || {};

    var values = normValues(opts.values);
    var kind = (opts.kind === 'max') ? 'max' : 'min';   // 기본은 최소 힙 — Python heapq 가 최소 힙 고정이라서

    // 기본 대본: heapify 로 힙을 만들고, 끝까지 올라가는 push 하나, 그리고 pop.
    // 이 세 개면 sift-up 과 sift-down 을 모두 한 번씩 본다.
    // push 값 null = "반드시 루트까지 올라가는 값을 알아서 고른다"
    function defaultScript() {
      return [{ op: 'heapify', arr: null }, { op: 'push', v: null }, { op: 'pop' }];
    }

    var script = normOps(opts.ops) || defaultScript();
    var seed = toInt(opts.seed, 20240817) >>> 0;

    // 저자가 준 값 중 몇 개를 버렸는지. 말없이 자르면 저자가 왜 안 나오는지 모른다.
    var dropped = 0;
    if (opts.values && typeof opts.values !== 'string' && typeof opts.values.length === 'number') {
      dropped = Math.max(0, opts.values.length - values.length);
    }

    var model = null;      // {steps, maxN}
    var cur = 0;
    var cache = null;      // 배치 캐시: render 마다 다시 계산하면 재생이 무거워진다

    // 결정적 난수. "랜덤 삽입" 버튼을 눌러도 같은 순서가 나와야 테스트가 재현된다.
    function rnd() {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) / 16777216;
    }

    var ui = K.frame(host, { title: '', wide: false });
    var titleEl = K.el('div', 'wk-title', '');
    ui.head.insertBefore(titleEl, ui.head.firstChild);

    function setTitle() {
      titleEl.textContent = kind === 'min'
        ? '힙 연산 — 최소 힙 (Python heapq 의 기본)'
        : '힙 연산 — 최대 힙 (C++ priority_queue 의 기본)';
    }

    // 새 연산을 대본에 덧붙이고, 그 연산의 첫 스텝으로 데려간다.
    // 전부 다시 계산하는 이유: §7 대로 스텝은 미리 만들어 둬야 되감기가 즉시 된다.
    function rebuild(goIdx) {
      model = build(values, kind === 'min', script);
      if (dropped > 0 && model.steps[0]) {
        model.steps[0].msg += ' (옵션 values 중 ' + dropped + '개는 쓰지 않았다 — 유효한 정수만, 최대 ' + MAX_N + '칸.)';
      }
      cache = null;
      var idx = goIdx == null ? 0 : goIdx;
      if (idx === -1) idx = model.starts.length ? model.starts[model.starts.length - 1] : 0;
      if (idx >= model.steps.length) idx = model.steps.length - 1;
      if (idx < 0) idx = 0;
      cur = idx;
      setTitle();
      if (play) play.goto(idx);
    }

    // ---- 머리말 컨트롤 ----
    K.seg(ui.slot, [{ label: '최소 힙', value: 'min' }, { label: '최대 힙', value: 'max' }], kind, function (v) {
      kind = v;
      // 방향이 바뀌면 지금 배열은 더 이상 힙이 아니다. build() 가 heapify 를 앞에 끼운다.
      rebuild(0);
    });

    function btn(label, aria, fn) {
      var b = K.el('button', 'wk-btn', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      ui.slot.appendChild(b);
      return b;
    }

    btn('+ 삽입', '무작위 값을 push 한다', function () {
      script.push({ op: 'push', v: 1 + Math.floor(rnd() * 99) });
      rebuild(-1);
    });
    btn('pop', '루트를 꺼낸다', function () {
      script.push({ op: 'pop' });
      rebuild(-1);
    });
    btn('heapify', '현재 배열을 다시 힙으로 만든다', function () {
      script.push({ op: 'heapify', arr: null });
      rebuild(-1);
    });
    btn('↺ 대본', '처음 대본으로 되돌린다', function () {
      script = normOps(opts.ops) || defaultScript();
      rebuild(0);
    });

    // ---- 범례 (§5: 색만으로 정보를 주지 않는다. 글자 표식도 같이 쓴다) ----
    var legend = K.el('div', 'wk-legend');
    legend.style.width = '100%';
    legend.innerHTML =
      '<span><i style="background:var(--w-frontier)"></i>비교 중 (? ↑ ↓)</span>' +
      '<span><i style="background:var(--box-warn)"></i>교환 (⇄)</span>' +
      '<span><i style="background:var(--w-visited)"></i>확정 (✓)</span>' +
      '<span><i style="background:var(--w-path)"></i>꺼낸 값</span>' +
      '<span>칸 왼쪽 위 작은 숫자 = 인덱스</span>' +
      '<span>heapq = 최소 힙 고정 · priority_queue = 최대 힙 기본 (반대다)</span>';
    ui.slot.appendChild(legend);

    // 캔버스보다 먼저 모델을 만든다. ResizeObserver 가 캔버스 생성 직후
    // 비동기로 redraw 를 부르는데 그때 model 이 없으면 그리다 던진다.
    rebuild(0);

    // ---- 캔버스 ----
    function L() {
      var w = cv.size.w || 320;
      if (!cache || cache.w !== w || cache.maxN !== model.maxN) {
        cache = layout(w, model.maxN);
        cache.maxN = model.maxN;
      }
      return cache;
    }

    function styleOf(s, k) {
      // 우선순위: 교환 쌍 > 지금 보는 칸 > 비교 상대 > 확정 > 보통
      // mark 는 색 없이도 읽히는 표식이다(§5). 칸 오른쪽 위 구석에 찍는다 —
      // 박스 밖에 그리면 좁은 화면에서 옆 노드를 덮거나 캔버스 밖으로 잘린다.
      if (s.swap && (k === s.i || k === s.j)) return { c: 'boxWarn', a: 0.30, lw: 2.5, mark: '⇄' };
      if (k === s.i) return { c: 'wFrontier', a: 0.30, lw: 2.5, mark: s.dir === 'up' ? '↑' : (s.dir === 'down' ? '↓' : '?') };
      if (k === s.j || k === s.l || k === s.r) return { c: 'wFrontier', a: 0.13, lw: 1.6, mark: '?' };
      if (s.allSettled || k >= s.settledLo) return { c: 'wVisited', a: 0.40, lw: 1.2, mark: '✓' };
      return { c: null, a: 0, lw: 1, mark: '' };
    }

    function box(ctx, T, x, y, w, h, k, val, st, faint) {
      ctx.save();
      // 캔버스는 투명하게 시작한다. 농도(globalAlpha)로 칠하려면 먼저 불투명 바탕을 깔아야 한다.
      ctx.fillStyle = T.bgElev;
      rrect(ctx, x, y, w, h, 5);
      ctx.fill();
      if (st.c) {
        ctx.globalAlpha = st.a;
        ctx.fillStyle = T[st.c];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = st.lw;
      ctx.strokeStyle = st.c ? T[st.c] : T.border;
      if (faint) { ctx.setLineDash([3, 3]); ctx.strokeStyle = T.border; }
      ctx.stroke();
      ctx.setLineDash([]);

      var fs = L().tiny ? 11 : 13;
      // 인덱스: 두 뷰에서 같은 자리(왼쪽 위)에 둔다. 트리 노드와 배열 칸이
      // 같은 것임을 형태로 못 박기 위해서다.
      ctx.fillStyle = T.fgFaint;
      ctx.font = (L().tiny ? 8 : 9) + 'px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(k), x + 3, y + 2);

      if (st.mark) {
        ctx.fillStyle = st.c ? T[st.c] : T.fgFaint;
        ctx.textAlign = 'right';
        ctx.fillText(st.mark, x + w - 3, y + 2);
      }

      ctx.fillStyle = faint ? T.fgFaint : T.fg;
      ctx.font = '700 ' + fs + 'px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(val == null ? '·' : String(val), x + w / 2, y + h - (L().tiny ? 4 : 5));
      ctx.restore();
    }

    function pill(ctx, T, x, y, text, color) {
      ctx.save();
      ctx.font = (L().tiny ? 8.5 : 9.5) + 'px ui-monospace, monospace';
      var tw = ctx.measureText(text).width;
      var w = tw + 8, h = 13;
      ctx.fillStyle = T.bg;
      rrect(ctx, x - w / 2, y - h / 2, w, h, 3);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 0.5);
      ctx.restore();
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) { return layout(w, model ? model.maxN : 9).height; },
      draw: function (ctx, size, T) {
        var s = model.steps[cur];
        if (!s) return;
        var l = L();
        var n = s.n;

        ctx.textBaseline = 'alphabetic';

        // ---- 구역 제목 ----
        ctx.fillStyle = T.fgDim;
        ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('트리로 보면 (머릿속 그림)', l.pad, l.pad + (l.tiny ? 9 : 11));
        ctx.fillText('배열로는 (실제로 저장되는 것)', l.pad, l.arrTop - (l.tiny ? 5 : 6));

        // 힙 크기 표시 — pop 으로 줄어드는 것이 보여야 한다
        ctx.textAlign = 'right';
        ctx.fillStyle = T.fgFaint;
        ctx.font = (l.tiny ? 9 : 10) + 'px ui-monospace, monospace';
        ctx.fillText('n = ' + n, size.w - l.pad, l.arrTop - (l.tiny ? 5 : 6));

        // ---- 간선 ----
        // 라벨은 모아 뒀다가 간선을 다 그린 뒤에 얹는다. 그리는 도중에 얹으면
        // 나중 간선이 라벨 위를 지나가 글자를 그어 버린다.
        var pills = [];
        for (var k = 1; k < l.col.length; k++) {
          var p = (k - 1) >> 1;
          var a = nodeXY(l, p), b = nodeXY(l, k);
          var inHeap = k < n;
          var active = s.swap && ((k === s.i && p === s.j) || (k === s.j && p === s.i));
          var looked = (k === s.l || k === s.r) && p === s.i;
          var upEdge = (s.dir === 'up' && ((k === s.i && p === s.j) || (k === s.j && p === s.i)));
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(a.x + l.nodeW / 2, a.y + l.nodeH);
          ctx.lineTo(b.x + l.nodeW / 2, b.y);
          if (!inHeap) { ctx.strokeStyle = T.border; ctx.globalAlpha = 0.35; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; }
          else if (active) { ctx.strokeStyle = T.boxWarn; ctx.lineWidth = 2.6; }
          else if (looked || upEdge) { ctx.strokeStyle = T.wFrontier; ctx.lineWidth = 2; }
          else { ctx.strokeStyle = T.border; ctx.lineWidth = 1.2; }
          ctx.stroke();
          ctx.restore();

          // 지금 쓰이는 간선에만 인덱스 산술을 붙인다. 전부 붙이면 글자밭이 된다.
          if (inHeap && (looked || active || upEdge)) {
            // 간선 한가운데(= 두 박스 사이 빈 띠)에 얹는다. edge 를 18 이상으로
            // 잡아 뒀으므로 라벨(13px)이 박스를 침범하지 않는다.
            var mx = (a.x + b.x) / 2 + l.nodeW / 2, my = a.y + l.nodeH + l.edge * 0.5;
            var label = (s.dir === 'up') ? '(' + k + '-1)/2' : (k === 2 * p + 1 ? '2·' + p + '+1' : '2·' + p + '+2');
            pills.push([mx, my, label, active ? T.boxWarn : T.wFrontier]);
          }
        }
        for (var pi = 0; pi < pills.length; pi++) {
          pill(ctx, T, pills[pi][0], pills[pi][1], pills[pi][2], pills[pi][3]);
        }

        // ---- 트리 노드 ----
        for (k = 0; k < l.col.length; k++) {
          var q = nodeXY(l, k);
          if (k >= n) {
            // 힙 밖: 빈 자리로 남겨 트리가 줄어든 것을 보여 준다
            ctx.save();
            ctx.globalAlpha = 0.4;
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.strokeStyle = T.border;
            rrect(ctx, q.x, q.y, l.nodeW, l.nodeH, 5);
            ctx.stroke();
            ctx.restore();
            continue;
          }
          box(ctx, T, q.x, q.y, l.nodeW, l.nodeH, k, s.arr[k], styleOf(s, k), false);
        }

        // ---- 인덱스 규칙 ----
        ctx.save();
        ctx.textBaseline = 'alphabetic';
        if (l.panelW) {
          ctx.fillStyle = T.bgElev;
          rrect(ctx, l.panelX, l.panelY, l.panelW, l.panelH, 6);
          ctx.fill();
          ctx.strokeStyle = T.border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = T.fgDim;
          ctx.font = '700 10px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('인덱스 규칙 (0-based)', l.panelX + 9, l.panelY + 16);
          ctx.font = '11px ui-monospace, monospace';
          ctx.fillStyle = T.fg;
          ctx.fillText('부모(i)   = (i-1)/2', l.panelX + 9, l.panelY + 33);
          ctx.fillText('왼자식(i) = 2i+1', l.panelX + 9, l.panelY + 47);
          ctx.fillText('오른자식  = 2i+2', l.panelX + 9, l.panelY + 61);
        } else {
          ctx.fillStyle = T.fgDim;
          ctx.font = (l.tiny ? 9 : 10) + 'px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('부모 (i-1)/2 · 왼자식 2i+1 · 오른자식 2i+2', size.w / 2, l.ruleLineY + 10);
        }
        ctx.restore();

        // ---- 배열 ----
        for (k = 0; k < l.col.length; k++) {
          var c = cellXY(l, k);
          box(ctx, T, c.x, c.y, l.cellW - 3, l.cellH, k, s.arr[k], k < n ? styleOf(s, k) : { c: null, a: 0, lw: 1, mark: '' }, k >= n);
        }

        // ---- 꺼낸 값: 배열 밖으로 빠져나간 원소 ----
        // wPath(금색)는 "확정된 답" 전용 색이다. pop 이 돌려주는 값은 이 힙이
        // 내놓는 답 그 자체이므로 여기서만 쓴다.
        if (s.out != null) {
          ctx.save();
          var txt = '꺼낸 값 ' + s.out;
          ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px system-ui, sans-serif';
          var tw = ctx.measureText(txt).width + 18;
          var cx = size.w / 2, oy = l.arrBottom + 3;
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = T.wPath;
          rrect(ctx, cx - tw / 2, oy, tw, l.outH - 5, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.wPath;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.fillStyle = T.fg;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, cx, oy + (l.outH - 5) / 2 + 0.5);
          ctx.restore();
        }
      }
    });

    var play = K.player(ui, {
      total: function () { return model.steps.length; },
      render: function (i) { cur = i; cv.redraw(); },
      label: function (i) {
        var s = model.steps[i];
        if (!s) return '';
        return '[' + s.op + '] ' + s.msg;
      },
      speed: 620
    });

    setTitle();
    play.goto(0);

    // 테스트·디버깅용 훅. 계약상 전역 오염은 금지라 host 요소에만 붙인다.
    host.__heapOps = {
      steps: function () { return model.steps; },
      kind: function () { return kind; },
      setKind: function (v) { kind = (v === 'max') ? 'max' : 'min'; rebuild(0); },
      run: function (ops) { script = normOps(ops) || defaultScript(); rebuild(0); },
      setValues: function (v) { values = normValues(v); rebuild(0); },
      goto: function (i) { play.goto(i); },
      layout: function () { return L(); },
      nodeXY: function (k) { return nodeXY(L(), k); },
      cellXY: function (k) { return cellXY(L(), k); }
    };
  });
})();
