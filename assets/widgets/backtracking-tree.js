/* backtracking-tree.js — 재귀 호출 트리가 뻗고, 가지치기로 잘려 나간다
 *
 * 이 위젯이 증명하려는 명제는 하나다: **백트래킹의 이득은 "더 좋은 답"이 아니라
 * "같은 답을 훨씬 적게 펼쳐서" 다.** 그래서 화면의 주인공은 트리 그림이 아니라
 * 그 위에 붙은 두 개의 카운터다 — 가지치기 ON 과 OFF 의 방문 노드 수.
 * 4-퀸에서 341 이 17 로 줄고, 8-퀸에서 1,900만이 2,057 로 줄어든다.
 * 그 숫자가 III-4 의 논지 전부이고, 산문으로는 이 대비가 만들어지지 않는다.
 *
 * 왜 잘린 가지 아래에 "유령 삼각형"을 그리는가
 *   가지치기를 색칠로만 표시하면 화면에서 사라진 것은 아무것도 없다 —
 *   원래 거기 매달려 있었을 부분트리를 독자가 상상해야 한다. 상상을 시키면
 *   위젯이 하는 일이 없다. 잘린 노드마다 점선 삼각형과 "×16" 같은 잎 개수를
 *   남겨서, **버린 것의 크기**를 눈에 보이게 한다. III-4 가 "잘려 나간 자리에
 *   원래 무엇이 매달려 있었는지"를 요구하는 지점이다.
 *
 * 왜 스텝 = 노드 방문 1회 인가
 *   그렇게 두면 스텝 인덱스가 곧 "지금까지 만든 노드 수"가 되어 카운터와
 *   재생 위치가 같은 수를 가리킨다. 되돌아 나오는 것(undo)은 스텝을 소비하지
 *   않는다 — 화면에서 새로 생기는 것이 없기 때문이다. 대신 지금 노드에서
 *   뿌리까지의 경로를 액센트로 칠해 **재귀 스택**을 항상 보이게 한다.
 *
 * 왜 색·모양을 둘 다 쓰는가
 *   방문=원, 가지치기=×가 그어진 사각형, 해=금색 마름모. 색을 구분하지 못해도
 *   모양으로 갈린다(계약 §5). 트리가 300 노드를 넘어가면 글자가 죽으므로
 *   모양이 유일한 단서가 되는 구간이 실제로 생긴다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  /* 그리는 노드 수 상한. 폭이 좁을수록 잎 간격이 무너지므로 단계로 낮춘다.
   * 상한을 넘으면 **DFS 앞부분만** 남는다 — 실제 탐색이 방문하는 순서 그대로라
   * 재생 서사가 깨지지 않는다. 잘라냈다는 사실은 제목에 적는다(계약 §7,
   * dp-table 이 이미 밟은 선례). 조용히 자르면 위젯이 거짓말을 한다. */
  var TIERS = [[900, 400], [560, 360], [0, 180]];

  // 전수 열거를 실제로 돌려 볼 상한. 8-퀸의 가지치기 없는 트리는 1,900만 노드라
  // 브라우저에서 돌릴 수 없다. 그 위는 닫힌 식으로 계산하고 "계산값"이라고 밝힌다.
  var ENUM_BUDGET = 1200000;

  var MAX_TREE_H = 430;
  /* 현재 상태 패널(퀸 판 등). 트리에서 폭을 떼어 오는 값비싼 장치라
   * ① 폭이 700 이상이고 ② 잎이 200개 이하일 때만 켠다. 잎이 그보다 많으면
   * 노드가 이미 점 크기라 트리에 폭을 다 주는 편이 낫다. */
  var SIDE_MIN = 700;
  var SIDE_MAX_LEAVES = 200;
  var COMPACT = 620;         // 이 폭 아래에서는 카운터를 한 줄짜리로 접는다

  // ─── 잡동사니 ────────────────────────────────────────────────────────────

  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(v, list, dflt) {
    for (var i = 0; i < list.length; i++) if (v === list[i]) return v;
    return dflt;
  }

  function comma(n) {
    if (!isFinite(n)) return '?';
    var s = String(Math.round(n)), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0 && s.charAt(i - 1) !== '-') out = ',' + out;
    }
    return out;
  }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  // 등비수열 합 1 + B + B^2 + ... + B^D. 가지치기 없는 트리의 노드 수다.
  function geom(B, D) {
    var s = 0, p = 1;
    for (var d = 0; d <= D; d++) { s += p; p *= B; }
    return s;
  }

  // ─── 문제 정의 ───────────────────────────────────────────────────────────
  //
  // spec 은 "선택 트리" 하나를 기술한다. 탐색 드라이버(search)는 문제를 모른다.
  //   D          깊이 (선택을 몇 번 하면 잎인가)
  //   B          분기 수 (후보 개수). 가지치기 없는 트리의 크기를 여기서 역산한다
  //   reject(d,c)  가지치기 근거 문자열 또는 null. **필요조건만 검사한다** —
  //                여기서 자른 가지 아래에 해가 있으면 위젯이 답을 잃는다
  //   accept()     잎에서의 최종 판정. reject 와 독립적으로 전체를 다시 검사한다.
  //                그래야 가지치기를 꺼도 같은 해집합이 나오는 것이 **검증**된다
  //
  // 본문 ::: dual 의 코드와 같은 알고리즘이어야 한다(계약 §9). 특히 퀸의
  // 충돌 검사는 "열 같음 + 행차 == 열차" 두 줄 그대로다.

  function nqueensSpec(n) {
    var col = new Int32Array(n);
    return {
      key: 'nqueens', D: n, B: n, n: n,
      levelLabel: function (d) { return d === 0 ? '빈 판' : '행 ' + (d - 1); },
      rootText: '·',
      rootSay: '빈 판에서 시작한다. 행 0 부터 열을 하나씩 시도한다. 한 행에 퀸은 정확히 하나다.',
      nodeText: function (d, c) { return String(c); },
      candidates: function () {
        var a = [];
        for (var c = 0; c < n; c++) a.push(c);
        return a;
      },
      // 이미 놓인 퀸 중 첫 번째 충돌을 돌려준다. 어느 퀸과 왜 부딪히는지까지
      // 남겨야 상태 줄이 "열 3 이 이미 쓰였다" 처럼 근거를 말할 수 있다.
      reject: function (d, c) {
        for (var i = 0; i < d; i++) {
          if (col[i] === c) return { why: '열 ' + c + ' 이 이미 쓰였다', row: i };
          if (Math.abs(col[i] - c) === d - i) {
            return { why: '(행 ' + i + ', 열 ' + col[i] + ') 과 대각선으로 마주 본다', row: i };
          }
        }
        return null;
      },
      apply: function (d, c) { col[d] = c; },
      undo: function () { },
      accept: function () {
        for (var r = 1; r < n; r++) {
          for (var i = 0; i < r; i++) {
            if (col[i] === col[r] || Math.abs(col[i] - col[r]) === r - i) return false;
          }
        }
        return true;
      },
      solKey: function () {
        var a = [];
        for (var i = 0; i < n; i++) a.push(col[i]);
        return a.join('-');
      },
      sayOk: function (d, c) {
        return '(행 ' + d + ', 열 ' + c + ') 배치. 충돌 없다.' +
               (d + 1 < n ? ' 행 ' + (d + 1) + ' 로 내려간다.' : '');
      },
      sayCut: function (d, c, r) {
        return '(행 ' + d + ', 열 ' + c + ') 배치 시도 → ' + r.why + '. 가지치기.';
      },
      sayFail: function (d, c) {
        // 가지치기를 끈 경우에만 온다: 잎까지 다 가서야 틀린 것을 안다.
        var r = null;
        for (var rr = 1; rr < n && !r; rr++) {
          for (var i = 0; i < rr; i++) {
            if (col[i] === col[rr]) { r = '(행 ' + i + ', 열 ' + col[i] + ') 과 같은 열'; break; }
            if (Math.abs(col[i] - col[rr]) === rr - i) {
              r = '(행 ' + i + ', 열 ' + col[i] + ') 과 대각선'; break;
            }
          }
        }
        return '(행 ' + d + ', 열 ' + c + ') 배치. 판이 다 찼다 — 검사하니 ' +
               (r || '충돌') + ' 이다. 버린다.';
      },
      state: function () { return col; }
    };
  }

  function subsetSpec(items, target) {
    var n = items.length, pick = new Int32Array(n), sum = 0;
    return {
      key: 'subset', D: n, B: 2, items: items, target: target,
      levelLabel: function (d) { return d === 0 ? '시작' : '물건 ' + (d - 1); },
      rootText: '0',
      rootSay: '빈 부분집합에서 시작한다. 합 0. 물건마다 넣을지 말지를 고른다. 목표는 ' + target + '.',
      nodeText: function (d, c) { return c ? '+' + items[d] : '−'; },
      candidates: function () { return [1, 0]; },   // 넣는 쪽을 먼저 — 초과가 빨리 드러난다
      reject: function (d, c) {
        if (!c) return null;                        // 건너뛰는 선택은 합을 늘리지 않는다
        if (sum + items[d] > target) {
          return { why: '합 ' + (sum + items[d]) + ' 이 목표 ' + target + ' 을 넘는다', row: d };
        }
        return null;
      },
      apply: function (d, c) { pick[d] = c; if (c) sum += items[d]; },
      undo: function (d, c) { if (c) sum -= items[d]; pick[d] = 0; },
      accept: function () {
        var s = 0;
        for (var i = 0; i < n; i++) if (pick[i]) s += items[i];
        return s === target;
      },
      solKey: function () {
        var a = [];
        for (var i = 0; i < n; i++) if (pick[i]) a.push(items[i]);
        return '{' + a.join(',') + '}';
      },
      sayOk: function (d, c) {
        var s = c ? ('물건 ' + d + '(무게 ' + items[d] + ') 을 넣는다 → 합 ' + (sum + items[d]))
                  : ('물건 ' + d + '(무게 ' + items[d] + ') 을 건너뛴다 → 합 ' + sum);
        return s + '. 목표 ' + target + ' 이하다.' + (d + 1 < n ? ' 물건 ' + (d + 1) + ' 로 넘어간다.' : '');
      },
      sayCut: function (d, c, r) {
        return '물건 ' + d + '(무게 ' + items[d] + ') 을 넣어 보면 → ' + r.why + '. 가지치기.';
      },
      sayFail: function (d, c) {
        var s = 0;
        for (var i = 0; i < n; i++) if (pick[i]) s += items[i];
        return '물건 ' + d + ' 까지 다 골랐다. 합 ' + s + ' ≠ 목표 ' + target + '. 버린다.';
      },
      state: function () { return pick; },
      sumNow: function () { return sum; }
    };
  }

  function permutationSpec(n) {
    var a = new Int32Array(n), used = new Int32Array(n), at = new Int32Array(n);
    return {
      key: 'permutation', D: n, B: n, n: n,
      levelLabel: function (d) { return d === 0 ? '시작' : '자리 ' + (d - 1); },
      rootText: '·',
      rootSay: '빈 수열에서 시작한다. 자리 0 부터 값 0..' + (n - 1) + ' 를 하나씩 시도한다.',
      nodeText: function (d, c) { return String(c); },
      candidates: function () {
        var l = [];
        for (var c = 0; c < n; c++) l.push(c);
        return l;
      },
      reject: function (d, c) {
        if (used[c]) return { why: '값 ' + c + ' 는 자리 ' + at[c] + ' 에서 이미 썼다', row: at[c] };
        return null;
      },
      apply: function (d, c) { a[d] = c; used[c] = 1; at[c] = d; },
      undo: function (d, c) { used[c] = 0; },
      accept: function () {
        var seen = {};
        for (var i = 0; i < n; i++) {
          if (seen[a[i]]) return false;
          seen[a[i]] = 1;
        }
        return true;
      },
      solKey: function () {
        var o = [];
        for (var i = 0; i < n; i++) o.push(a[i]);
        return o.join('-');
      },
      sayOk: function (d, c) {
        return '자리 ' + d + ' 에 값 ' + c + '. 아직 안 쓴 값이다.' +
               (d + 1 < n ? ' 자리 ' + (d + 1) + ' 로 넘어간다.' : '');
      },
      sayCut: function (d, c, r) {
        return '자리 ' + d + ' 에 값 ' + c + ' 시도 → ' + r.why + '. 가지치기.';
      },
      sayFail: function (d, c) {
        return '자리 ' + d + ' 까지 다 채웠다 — 값이 겹친다. 순열이 아니다. 버린다.';
      },
      state: function () { return a; }
    };
  }

  // ─── 탐색 드라이버 ───────────────────────────────────────────────────────

  /* 노드 하나 = 상태 하나. 루트는 "아무것도 고르지 않은 상태"다.
   *   kind 'ok'   들어가서 더 펼친 노드 (= 방문)
   *        'cut'  가지치기로 잘린 노드. 만들기는 하되 펼치지 않는다
   *        'sol'  잎 + 해
   *        'fail' 잎인데 틀림 (가지치기를 껐을 때만 나온다)
   *        'base' 하노이의 기저 호출
   *
   * 방문 수의 정의: **cut 이 아닌 노드의 수**(루트 포함). 4-퀸 가지치기 ON 이
   * 17, OFF 가 341 이 되는 그 정의이고 III-4 본문의 숫자와 같다.
   *
   * enumerate=false 면 drawCap 에서 재귀를 통째로 멈춘다. 8-퀸의 가지치기 없는
   * 트리(1,900만 노드)를 브라우저가 다 돌 수 없기 때문이다. 그때 총계는
   * 닫힌 식으로 채우고 화면에 "계산값"이라고 밝힌다.
   */
  function search(spec, prune, drawCap, enumerate) {
    var D = spec.D;
    var nodes = [], solKeys = [];
    var visited = 0, pruned = 0, truncated = false, stopped = false;

    function add(parent, depth, kind, text, say, cv, wrow, skip) {
      if (nodes.length >= drawCap) { truncated = true; return -1; }
      var nd = {
        p: parent, d: depth, kind: kind, txt: text, say: say,
        cv: cv, wrow: (wrow == null ? -1 : wrow), skip: skip || 0,
        kids: [], slot: 0, x: 0, y: 0
      };
      nodes.push(nd);
      if (parent >= 0) nodes[parent].kids.push(nodes.length - 1);
      return nodes.length - 1;
    }

    function leavesUnder(depth) { return Math.pow(spec.B, D - depth); }

    function rec(id, d) {
      if (stopped) return;
      if (d === D) {
        var ok = spec.accept();
        if (ok) {
          solKeys.push(spec.solKey());
          if (id >= 0) { nodes[id].kind = 'sol'; nodes[id].say += ' 해 ' + solKeys[solKeys.length - 1] + ' 를 찾았다.'; }
        } else if (id >= 0) {
          nodes[id].kind = 'fail';
        }
        return;
      }
      var cands = spec.candidates(d);
      for (var i = 0; i < cands.length; i++) {
        if (stopped) return;
        var c = cands[i];
        var r = prune ? spec.reject(d, c) : null;
        if (r) {
          pruned++;
          add(id, d + 1, 'cut',
              spec.nodeText(d, c),
              spec.sayCut(d, c, r) + ' 이 아래 ' + comma(leavesUnder(d + 1)) + '개 잎을 통째로 버린다.',
              c, r.row, leavesUnder(d + 1));
          if (!enumerate && truncated) { stopped = true; return; }
          continue;
        }
        visited++;
        var say = (d + 1 === D) ? null : spec.sayOk(d, c);
        var nid = add(id, d + 1, 'ok', spec.nodeText(d, c), say, c, -1, 0);
        if (!enumerate && truncated) { stopped = true; return; }
        spec.apply(d, c);
        // 잎의 문장은 상태를 적용한 뒤에 만들어야 "무엇과 충돌했는지"를 말할 수 있다.
        if (nid >= 0 && d + 1 === D) {
          nodes[nid].say = spec.accept() ? spec.sayOk(d, c) : spec.sayFail(d, c);
        }
        rec(nid, d + 1);
        spec.undo(d, c);
      }
    }

    visited++;
    var root = add(-1, 0, 'ok', spec.rootText, spec.rootSay, -1, -1, 0);
    rec(root, 0);

    return {
      nodes: nodes, solKeys: solKeys,
      visited: visited, pruned: pruned, sols: solKeys.length,
      truncated: truncated, exact: !stopped
    };
  }

  // ─── 하노이 호출 트리 ────────────────────────────────────────────────────
  //
  // 하노이는 "탐색"이 아니라 **호출 트리**다. 자를 가지가 없다 — 모든 호출이
  // 실제로 필요한 일을 한다. III-1 이 이 위젯에 요구하는 것은 가지치기가 아니라
  // "한 노드에서 보이는 것은 자기 자신과 자식 둘뿐" 이라는 그림이다.

  function hanoiModel(n, drawCap) {
    var nodes = [], calls = 0, bases = 0, moves = 0, truncated = false;
    var PEG = ['A', 'B', 'C'];

    function add(parent, depth, kind, text, say, cv) {
      if (nodes.length >= drawCap) { truncated = true; return -1; }
      nodes.push({
        p: parent, d: depth, kind: kind, txt: text, say: say, cv: cv,
        wrow: -1, skip: 0, kids: [], slot: 0, x: 0, y: 0
      });
      if (parent >= 0) nodes[parent].kids.push(nodes.length - 1);
      return nodes.length - 1;
    }

    function rec(parent, depth, k, from, to, via) {
      var tag = 'h' + k;
      var arrow = PEG[from] + '→' + PEG[to];
      calls++;
      if (k === 0) {
        bases++;
        var bid = add(parent, depth, 'base', '0',
          'hanoi(0, ' + arrow + ') — 기저 조건. 원반이 없으니 아무 일도 하지 않고 그대로 돌아간다. ' +
          '여기가 재귀가 멈추는 자리다.', k);
        return bid;
      }
      moves++;
      var id = add(parent, depth, 'ok', tag,
        'hanoi(' + k + ', ' + arrow + ') 호출. 맨 아래 원반 ' + k + ' 를 ' + PEG[to] + ' 로 보내려면 ' +
        '위 ' + (k - 1) + '개가 먼저 ' + PEG[via] + ' 로 비켜나야 한다 — 그것이 왼쪽 자식이다. ' +
        '비켜났다고 믿고 원반 ' + k + ' 를 옮긴 뒤, 오른쪽 자식이 그 ' + (k - 1) + '개를 ' + PEG[to] + ' 로 옮긴다.', k);
      rec(id, depth + 1, k - 1, from, via, to);
      rec(id, depth + 1, k - 1, via, to, from);
      return id;
    }

    rec(-1, 0, n, 0, 2, 1);
    return {
      nodes: nodes, solKeys: [], visited: calls, pruned: 0, sols: bases,
      moves: moves, truncated: truncated, exact: true
    };
  }

  // ─── 배치 ────────────────────────────────────────────────────────────────

  /* 잎을 균등 간격으로 늘어놓고 부모를 **자기 부분트리의 잎 구간 한가운데**에 둔다.
   * 자식들의 평균이 아니라 잎 구간의 중앙인 이유: 자식마다 부분트리 크기가
   * 다르면 평균은 큰 쪽으로 끌려가서 트리가 통째로 기울어 보인다. 잎 구간의
   * 중앙을 쓰면 층마다 좌우 대칭이 살아나 "같은 규칙이 반복된다"가 눈에 들어온다.
   * 가지치기된 노드도 잎으로 자리를 차지한다 — 자리를 안 주면 잘린 가지가
   * 화면에서 사라져 버려서, 정작 이 위젯이 보여야 할 "버린 것"이 안 보인다. */
  function assignSlots(nodes) {
    if (!nodes.length) return 0;
    var slot = 0;
    // 재귀 대신 후위 순회를 스택으로 돈다. 노드가 400개까지 가는데
    // 호출 스택 한도에 기대고 싶지 않다.
    var stack = [[0, 0]];
    while (stack.length) {
      var top = stack[stack.length - 1];
      var nd = nodes[top[0]];
      if (top[1] === 0) nd.lo = slot;            // 부분트리가 차지하기 시작하는 잎 자리
      if (top[1] < nd.kids.length) {
        top[1] += 1;
        stack.push([nd.kids[top[1] - 1], 0]);
      } else {
        if (!nd.kids.length) slot += 1;
        nd.hi = slot;
        nd.slot = (nd.lo + nd.hi) / 2;
        stack.pop();
      }
    }
    return slot;
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('backtracking-tree', function (host, opts) {
    if (!opts || typeof opts !== 'object') opts = {};

    // ---- opts 검증. 본문 저자가 손으로 쓴 JSON 이라 신뢰하지 않는다(계약 §1) ----
    var problem = oneOf(opts.problem, ['nqueens', 'subset', 'permutation', 'hanoi'], 'nqueens');
    var prunable = problem !== 'hanoi';
    var prune = prunable ? (opts.prune !== false) : false;

    var n;
    if (problem === 'nqueens') n = clampInt(opts.n, 4, 8, 5);
    else if (problem === 'permutation') n = clampInt(opts.n, 2, 6, 4);
    else n = clampInt(opts.n, 1, 6, 3);            // hanoi

    var items = [];
    if (isArr(opts.items)) {
      for (var ii = 0; ii < opts.items.length && items.length < 8; ii++) {
        var w = clampInt(opts.items[ii], 1, 99, 0);
        if (w > 0) items.push(w);
      }
    }
    if (items.length < 2) items = [3, 34, 4, 12, 5, 2];
    var target = clampInt(opts.target, 1, 999, 9);

    var caption = (typeof opts.caption === 'string' && opts.caption.length)
      ? opts.caption.slice(0, 120) : '';

    function makeSpec() {
      if (problem === 'subset') return subsetSpec(items, target);
      if (problem === 'permutation') return permutationSpec(n);
      return nqueensSpec(n);
    }

    var B = problem === 'subset' ? 2 : n;
    var D = problem === 'subset' ? items.length : n;

    // ---- 모델 ----
    var cap = 400;
    var model = null;
    var layout = null;
    var cur = 0;
    var player = null;

    /* 한 번의 rebuild 가 두 번 탐색한다: 지금 모드(그리기 + 세기)와 반대 모드(세기만).
     * 두 수를 나란히 놓는 것이 이 위젯의 결론이므로, 반대편 숫자는 항상 있어야 한다. */
    function rebuild() {
      var m;
      if (problem === 'hanoi') {
        m = hanoiModel(n, cap);
        m.other = null;
        m.same = null;
      } else {
        var spec = makeSpec();
        var estCur = prune ? 0 : geom(B, D);
        m = search(spec, prune, cap, !(estCur > ENUM_BUDGET));
        if (!m.exact) {
          // 전수 열거를 포기했다. 노드 수는 닫힌 식으로 정확히 계산되고,
          // 해의 개수는 반대편(가지치기 ON) 이 알려 준다.
          m.visited = geom(B, D);
          m.pruned = 0;
        }
        var spec2 = makeSpec();
        var estOther = prune ? geom(B, D) : 0;
        var o = search(spec2, !prune, 0, !(estOther > ENUM_BUDGET));
        if (!o.exact) { o.visited = geom(B, D); o.pruned = 0; }
        m.other = o;

        // 가지치기는 비용을 바꾸지 exact 답을 바꾸지 않는다 — 그 명제를 위젯이 직접 검사한다.
        if (m.exact && o.exact) {
          m.same = m.solKeys.join('|') === o.solKeys.join('|');
          m.solList = m.solKeys;
        } else {
          m.same = null;
          m.solList = m.exact ? m.solKeys : o.solKeys;
          if (!m.exact) m.sols = o.sols;
          if (!o.exact) o.sols = m.sols;
        }
      }
      m.leaves = assignSlots(m.nodes);
      m.maxDepth = 0;
      // 누적 카운터. render 에서 매번 세면 재생이 느려진다(계약 §7).
      var nn = m.nodes.length;
      m.cVis = new Int32Array(nn + 1);
      m.cCut = new Int32Array(nn + 1);
      m.cSol = new Int32Array(nn + 1);
      for (var i = 0; i < nn; i++) {
        var nd = m.nodes[i];
        if (nd.d > m.maxDepth) m.maxDepth = nd.d;
        m.cVis[i + 1] = m.cVis[i] + (nd.kind === 'cut' ? 0 : 1);
        m.cCut[i + 1] = m.cCut[i] + (nd.kind === 'cut' ? 1 : 0);
        m.cSol[i + 1] = m.cSol[i] + (nd.kind === 'sol' ? 1 : 0);
      }
      m.total = m.visited + m.pruned;
      model = m;
      layout = null;
    }
    rebuild();

    // ---- 껍데기 ----
    var defTitle = {
      nqueens: n + '-퀸 탐색 트리',
      subset: '부분집합 합 = ' + target + ' 탐색 트리',
      permutation: n + '개 순열 생성 트리',
      hanoi: 'hanoi(' + n + ') 호출 트리'
    }[problem];

    var ui = K.frame(host, { title: caption || defTitle, wide: true });
    var titleEl = ui.head.querySelector('.wk-title');
    var baseTitle = caption || defTitle;

    function syncTitle() {
      if (!titleEl) return;
      var s = baseTitle;
      if (model.truncated) {
        s += '  · 앞 ' + comma(model.nodes.length) + '개 노드까지만 그린다 (전체 ' +
             comma(model.total) + '개)';
      }
      if (titleEl.textContent !== s) titleEl.textContent = s;
    }

    if (prunable) {
      K.seg(ui.slot, [
        { label: '가지치기 ON', value: 'on' },
        { label: 'OFF', value: 'off' }
      ], prune ? 'on' : 'off', function (v) {
        prune = (v === 'on');
        rebuild();
        // 모드를 바꾸면 트리 모양 자체가 달라진다. 처음부터 다시 보는 것이 맞다.
        player.stop();
        player.goto(0);
        syncTitle();
      });
    } else {
      var note = K.el('span', null, '가지치기 없음 — 모든 호출이 필요한 일을 한다');
      note.style.fontSize = '.74rem';
      note.style.color = 'var(--fg-faint)';
      ui.slot.appendChild(note);
    }

    var legend = K.el('div', 'wk-legend');
    var LEG = problem === 'hanoi'
      ? [['--w-visited', '호출 (원)'], ['--w-path', '기저 조건 h0 (마름모) — 여기서 멈춘다'],
         ['--accent', '지금 호출 + 그 위 호출들 = 재귀 스택']]
      : [['--w-visited', '방문 (원)'], ['--box-danger', '가지치기 (× 사각형) — 펼치지 않는다'],
         ['--w-wall', '잎까지 가서 실패 (흐린 사각형)'], ['--w-path', '해 (마름모)'],
         ['--accent', '지금 노드 + 뿌리까지의 경로 = 재귀 스택']];
    LEG.forEach(function (p) {
      var s = K.el('span'), i = K.el('i');
      i.style.background = 'var(' + p[0] + ')';
      s.appendChild(i);
      s.appendChild(document.createTextNode(p[1]));
      legend.appendChild(s);
    });
    if (prunable) {
      legend.appendChild(K.el('span', null, '· 점선 삼각형 = 잘려서 펼치지 않은 부분트리 (안의 수는 그 아래 잎 개수)'));
    }
    ui.root.insertBefore(legend, ui.ctl);

    // ---- 배치 계산 ----
    function capFor(w) {
      for (var i = 0; i < TIERS.length; i++) if (w >= TIERS[i][0]) return TIERS[i][1];
      return TIERS[TIERS.length - 1][1];
    }

    function computeLayout(w) {
      var compact = w < COMPACT;
      var side = (w >= SIDE_MIN && model.leaves <= SIDE_MAX_LEAVES) ? (w >= 860 ? 180 : 150) : 0;
      var gut = (w >= 520) ? 46 : 14;              // 깊이 라벨 자리
      // 카운터 패널 + 논지 두 줄. 논지가 잘리면 이 위젯의 결론이 사라진다.
      var headerH = compact ? (26 * 2 + 4 + 44) : (62 + 44);
      var levels = model.maxDepth + 1;
      var levelH = Math.floor(MAX_TREE_H / Math.max(1, levels));
      if (levelH > 58) levelH = 58;
      if (levelH < 22) levelH = 22;
      var treeTop = headerH + 10;
      var treeW = Math.max(60, w - gut - 8 - (side ? side + 12 : 0));
      var slotW = treeW / Math.max(1, model.leaves);
      var r = Math.min(levelH * 0.30, slotW * 0.42, 13);
      if (r < 1.2) r = 1.2;
      var treeH = (levels - 1) * levelH + r * 2 + 26;
      return {
        w: w, compact: compact, side: side, gut: gut,
        headerH: headerH, levelH: levelH, treeTop: treeTop, treeW: treeW,
        slotW: slotW, r: r, levels: levels,
        height: Math.min(700, treeTop + treeH + 6)
      };
    }

    function layoutFor(w) {
      if (!layout || layout.w !== w) {
        layout = computeLayout(w);
        // 노드 좌표는 배치가 바뀔 때만 다시 잡는다. render 안에서 만들지 않는다.
        for (var i = 0; i < model.nodes.length; i++) {
          var nd = model.nodes[i];
          nd.x = layout.gut + (nd.slot / Math.max(1, model.leaves)) * layout.treeW;
          nd.y = layout.treeTop + 12 + nd.d * layout.levelH;
        }
      }
      return layout;
    }

    // ---- 그리기 보조 ----
    function text(ctx, s, x, y, font, color, align) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.fillText(s, x, y);
      ctx.textAlign = 'left';
    }

    /* 논지 한 줄이 좁은 폭에서 캔버스 밖으로 새어 나가면 결론이 잘린다.
     * 어절 단위로 접어서 최대 두 줄까지 쓰고, 그래도 넘치면 말줄임한다. */
    function wrapLines(ctx, s, maxW, maxLines) {
      var words = s.split(' '), lines = [], line = '', i = 0;
      for (; i < words.length; i++) {
        var t = line ? line + ' ' + words[i] : words[i];
        if (line && ctx.measureText(t).width > maxW) {
          lines.push(line);
          line = words[i];
          if (lines.length >= maxLines - 1) { i++; break; }
        } else line = t;
      }
      // 남은 어절이 있으면 마지막 줄에 몰아넣고 폭에 맞춰 자른다.
      var rest = line;
      if (i < words.length) rest = line + ' ' + words.slice(i).join(' ');
      var cut = false;
      while (rest.length > 1 && ctx.measureText(rest + (cut ? '…' : '')).width > maxW) {
        rest = rest.slice(0, -1);
        cut = true;
      }
      lines.push(cut ? rest + '…' : rest);
      return lines;
    }

    /* 카운터 패널. grid-search 가 패널마다 "확장 칸 수"를 크게 띄우는 것과 같은 장치다 —
     * 이 위젯의 결론도 그림이 아니라 숫자이기 때문이다. */
    function statPanel(ctx, T, x, y, w, h, title, stats, active, compact) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = active ? T.accent : T.border;
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      if (compact) {
        text(ctx, title, x + 8, y + h / 2 + 4, '700 11px ' + FONT, active ? T.accent : T.fgDim);
        var tx = x + 8 + ctx.measureText(title).width + 10;
        for (var i = 0; i < stats.length; i++) {
          var s = stats[i][1] + ' ' + stats[i][0];
          text(ctx, s, tx, y + h / 2 + 4, (i === 0 ? '700 ' : '') + '11px ' + FONT,
               i === 0 ? T.fg : T.fgDim);
          tx += ctx.measureText(s).width + 10;
        }
        return;
      }

      text(ctx, title, x + 9, y + 16, '700 11px ' + FONT, active ? T.accent : T.fgDim);
      if (active) text(ctx, '← 지금 보는 트리', x + w - 9, y + 16, '10px ' + FONT, T.fgFaint, 'right');
      var colW = (w - 18) / stats.length;
      for (var k = 0; k < stats.length; k++) {
        var cx = x + 9 + colW * k;
        text(ctx, stats[k][1], cx, y + 44, '700 19px ' + FONT, k === 0 ? T.fg : T.fgDim);
        text(ctx, stats[k][0], cx, y + 57, '10px ' + FONT, T.fgFaint);
      }
    }

    function drawHeader(ctx, T, L) {
      var w = L.w, pad = 8;
      var vis = model.cVis[Math.min(cur, model.nodes.length)];
      var cut = model.cCut[Math.min(cur, model.nodes.length)];
      var sol = model.cSol[Math.min(cur, model.nodes.length)];
      var done = cur >= model.nodes.length && !model.truncated;

      if (problem === 'hanoi') {
        var hw = Math.min(360, w - pad * 2);
        statPanel(ctx, T, pad, 6, hw, 62, '호출 트리 (가지치기 없음)', [
          ['호출', comma(vis)], ['기저 h0', comma(sol)], ['옮긴 원반', comma(model.moves)]
        ], true, L.compact);
        thesis(ctx, T, L, '호출 ' + comma(model.visited) + '개 = 2^' + (n + 1) + ' − 1. ' +
               '원반이 하나 늘 때마다 호출이 두 배가 된다 — 원반 20개면 100만 번이다. ' +
               '자를 가지는 없다. 모든 호출이 필요한 일을 한다.', false);
        return;
      }

      var me = { v: model.visited, c: model.pruned, s: model.sols };
      var ot = { v: model.other.visited, c: model.other.pruned, s: model.other.sols };
      var on = prune ? me : ot, off = prune ? ot : me;

      var pw, ph = L.compact ? 26 : 62, gapY = L.compact ? 4 : 0;
      var x2, y2;
      if (L.compact) {
        pw = w - pad * 2;
        x2 = pad; y2 = 6 + ph + gapY;
      } else {
        pw = Math.min(300, Math.floor((w - pad * 2 - 12 - (L.side ? L.side + 12 : 0)) / 2));
        if (pw < 150) pw = Math.floor((w - pad * 2 - 12) / 2);
        x2 = pad + pw + 12; y2 = 6;
      }

      // 지금 보는 쪽만 "지금까지" 값을 키우고, 반대쪽은 최종값을 보여 준다.
      // 두 수를 같은 눈금에 두면 재생 도중에도 격차가 계속 읽힌다.
      var onStats = prune
        ? [['방문', comma(vis) + (done ? '' : ' / ' + comma(on.v))], ['잘림', comma(cut)], ['해', comma(sol)]]
        : [['방문', comma(on.v)], ['잘림', comma(on.c)], ['해', comma(on.s)]];
      var offStats = !prune
        ? [['방문', comma(vis) + (done ? '' : ' / ' + comma(off.v))], ['잘림', comma(cut)], ['해', comma(sol)]]
        : [['방문', comma(off.v)], ['잘림', comma(off.c)], ['해', comma(off.s)]];

      statPanel(ctx, T, pad, 6, pw, ph, '가지치기 ON', onStats, prune, L.compact);
      statPanel(ctx, T, x2, y2, pw, ph, '가지치기 OFF (전수 조사)', offStats, !prune, L.compact);

      // 논지 한 줄. 이 위젯이 존재하는 이유가 이 문장이다.
      var ratio = on.v > 0 ? (off.v / on.v) : 0;
      var msg = '가지치기가 방문 노드를 ' + comma(off.v) + ' → ' + comma(on.v) + ' 로 줄인다 (' +
                (ratio >= 100 ? comma(Math.round(ratio)) : (Math.round(ratio * 10) / 10)) + '배).';
      var warn = false;
      if (model.same === true) msg += ' 두 쪽이 찾은 해는 ' + comma(on.s) + '개로 같다 — 답은 그대로다.';
      else if (model.same === false) { msg += ' 해집합이 다르다 — 가지치기가 답을 잃었다.'; warn = true; }
      else msg += ' 해 ' + comma(on.s) + '개. OFF 쪽 노드 수는 전수 열거 대신 계산값이다.';
      thesis(ctx, T, L, msg, warn);
    }

    function thesis(ctx, T, L, msg, warn) {
      var font = (warn ? '700 ' : '') + '11px ' + FONT;
      ctx.font = font;
      var lines = wrapLines(ctx, msg, L.w - 16, 2);
      for (var i = 0; i < lines.length; i++) {
        text(ctx, lines[i], 8, L.headerH - 21 + i * 14, font, warn ? T.boxWarn : T.fgDim);
      }
    }

    // 지금 노드에서 뿌리까지 (재귀 스택)
    var stackMark = [];
    function markStack(idx) {
      stackMark.length = 0;
      var guard = 64, i = idx;
      while (i >= 0 && guard-- > 0) { stackMark.push(i); i = model.nodes[i].p; }
    }

    function drawTree(ctx, T, L) {
      var nodes = model.nodes;
      var shown = Math.min(cur, nodes.length - 1);
      if (cur >= nodes.length) shown = nodes.length - 1;
      var active = cur < nodes.length ? cur : -1;
      markStack(active);
      var onStack = {};
      for (var s = 0; s < stackMark.length; s++) onStack[stackMark[s]] = 1;

      var bottomY = L.treeTop + 12 + (L.levels - 1) * L.levelH;

      // 깊이 라벨
      if (L.gut > 20) {
        for (var d = 0; d < L.levels; d++) {
          var lab = (problem === 'hanoi')
            ? (d === 0 ? '호출' : '깊이 ' + d)
            : (problem === 'nqueens' ? (d === 0 ? '빈 판' : '행 ' + (d - 1))
              : problem === 'subset' ? (d === 0 ? '시작' : '물건 ' + (d - 1))
              : (d === 0 ? '시작' : '자리 ' + (d - 1)));
          ctx.globalAlpha = 0.75;
          text(ctx, lab, 4, L.treeTop + 16 + d * L.levelH, '10px ' + FONT, T.fgFaint);
          ctx.globalAlpha = 1;
        }
      }

      // ① 간선
      ctx.lineWidth = 1;
      for (var i = 1; i <= shown; i++) {
        var nd = nodes[i];
        if (nd.p < 0 || nd.p > shown) continue;
        var pa = nodes[nd.p];
        var stacked = onStack[i] && onStack[nd.p];
        ctx.globalAlpha = nd.kind === 'cut' ? 0.55 : (stacked ? 1 : 0.5);
        ctx.strokeStyle = stacked ? T.accent : (nd.kind === 'cut' ? T.boxDanger : T.border);
        ctx.lineWidth = stacked ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y + L.r);
        ctx.lineTo(nd.x, nd.y - L.r);
        ctx.stroke();

        /* 잘린 가지는 간선 위에 이발소 표시(빗금 두 줄)를 얹는다.
         * 노드 안에 × 를 그리면 "몇 번 후보였는지" 숫자와 겹쳐 둘 다 죽는다.
         * 자르는 행위는 간선에서 일어나므로 표시도 간선에 두는 것이 맞다. */
        if (nd.kind === 'cut' && L.r >= 4) {
          var mx = (pa.x + nd.x) / 2, my = (pa.y + nd.y) / 2;
          var vx = nd.x - pa.x, vy = nd.y - pa.y;
          var len = Math.sqrt(vx * vx + vy * vy) || 1;
          var ux = vx / len, uy = vy / len;
          var px = -uy, py = ux;                    // 간선에 수직인 방향
          var sl = Math.min(5, L.r * 0.9);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = T.boxDanger;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          // 빗금 하나면 충분하다. 두 줄로 그으면 형제 간선이 여럿 잘릴 때
          // 화면이 붉은 낙서가 되어 정작 노드가 안 보인다.
          ctx.moveTo(mx - px * sl - ux * sl * 0.5, my - py * sl - uy * sl * 0.5);
          ctx.lineTo(mx + px * sl + ux * sl * 0.5, my + py * sl + uy * sl * 0.5);
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1;

      // ② 유령 삼각형 — 잘려서 펼치지 않은 부분트리
      var labelRight = -1e9;   // 잎 개수 라벨이 서로 겹치면 둘 다 못 읽는다
      if (L.r >= 2) {
        for (var g = 0; g <= shown; g++) {
          var cn = nodes[g];
          if (cn.kind !== 'cut' || cn.skip < 2 || cn.d >= L.levels - 1) continue;
          var half = Math.min(L.slotW * 1.7, (L.levels - 1 - cn.d) * L.levelH * 0.34);
          if (half < 2) continue;
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = T.fgFaint;
          ctx.beginPath();
          ctx.moveTo(cn.x, cn.y + L.r);
          ctx.lineTo(cn.x - half, bottomY + 4);
          ctx.lineTo(cn.x + half, bottomY + 4);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.42;
          ctx.strokeStyle = T.fgFaint;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          if (half >= 11) {
            var lab2 = '×' + comma(cn.skip);
            ctx.font = '9px ' + FONT;
            var lw = ctx.measureText(lab2).width;
            if (cn.x - lw / 2 > labelRight + 4) {
              ctx.globalAlpha = 0.85;
              text(ctx, lab2, cn.x, bottomY + 1, '9px ' + FONT, T.fgFaint, 'center');
              labelRight = cn.x + lw / 2;
            }
          }
        }
      }
      ctx.globalAlpha = 1;

      // ③ 노드
      for (var k = 0; k <= shown; k++) drawNode(ctx, T, L, nodes[k], k === active, !!onStack[k]);

      // 잘려서 못 그린 부분을 밑줄로 알린다. 제목에도 적지만, 그림 안에서도
      // "여기서 끊겼다"가 보여야 트리 모양을 오해하지 않는다.
      if (model.truncated && cur >= nodes.length - 1) {
        ctx.globalAlpha = 0.9;
        text(ctx, '⋯ 여기까지만 그렸다. 전체 ' + comma(model.total) + '개 노드 중 ' +
                  comma(nodes.length) + '개.',
             L.gut, bottomY + 20, '10px ' + FONT, T.fgFaint);
        ctx.globalAlpha = 1;
      }
    }

    function drawNode(ctx, T, L, nd, isCur, stacked) {
      var r = L.r, x = nd.x, y = nd.y;
      ctx.globalAlpha = 1;

      if (nd.kind === 'cut') {
        // 잘린 노드: 사각형(원과 모양으로 갈린다, 계약 §5). × 는 간선 위에 있다.
        ctx.fillStyle = T.boxDanger;
        ctx.globalAlpha = 0.92;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        if (r < 4) {
          // 너무 작아 간선 표시가 안 보이는 크기에서는 노드에 직접 × 를 긋는다.
          ctx.strokeStyle = T.bg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
          ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
          ctx.stroke();
        }
      } else if (nd.kind === 'fail') {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = T.wWall;
        ctx.fillRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
        ctx.globalAlpha = 1;
      } else if (nd.kind === 'sol' || nd.kind === 'base') {
        // 마름모 = 확정. 금색은 "확정" 전용이라 여기서만 쓴다.
        ctx.fillStyle = T.wPath;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y);
        ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = T.wVisited;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.border;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.2832);
        ctx.stroke();
      }

      if (stacked || isCur) {
        ctx.strokeStyle = T.accent;
        ctx.lineWidth = isCur ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + (isCur ? 3.5 : 2), 0, 6.2832);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // 글자는 자리가 있을 때만. 뭉개진 글자는 없는 것만 못하다.
      if (r >= 7 && nd.txt) {
        var fs = Math.min(Math.round(r * 1.15), 13);
        var col = (nd.kind === 'sol' || nd.kind === 'base') ? T.bg
                : (nd.kind === 'cut' ? T.bg : T.fg);
        ctx.font = '700 ' + fs + 'px ' + FONT;
        if (ctx.measureText(nd.txt).width <= r * 2.1) {
          text(ctx, nd.txt, x, y + fs * 0.36, '700 ' + fs + 'px ' + FONT, col, 'center');
        }
      }
    }

    // ---- 현재 상태 패널 ----
    //
    // 트리만 있으면 "이 노드가 무슨 상태인가"를 독자가 머리로 복원해야 한다.
    // 퀸은 판을, 부분집합은 고른 물건과 합을, 순열은 자리를 그대로 보여 준다.

    function pathOf(idx) {
      var p = [], guard = 64, i = idx;
      while (i > 0 && guard-- > 0) { p.push(model.nodes[i]); i = model.nodes[i].p; }
      p.reverse();
      return p;
    }

    function drawSide(ctx, T, L) {
      var x = L.w - L.side - 4, y = L.treeTop, w = L.side, h = L.height - L.treeTop - 8;
      ctx.globalAlpha = 1;
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = T.border;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      var idx = cur < model.nodes.length ? cur : model.nodes.length - 1;
      var nd = model.nodes[idx];
      var path = pathOf(idx);
      text(ctx, cur < model.nodes.length ? '지금 상태' : '탐색 종료', x + 8, y + 16,
           '700 11px ' + FONT, T.fgDim);

      if (problem === 'nqueens') drawBoard(ctx, T, x, y, w, nd, path);
      else if (problem === 'subset') drawItems(ctx, T, x, y, w, nd, path);
      else if (problem === 'permutation') drawSlots(ctx, T, x, y, w, nd, path);
      else drawCalls(ctx, T, x, y, w, nd, path);
    }

    function drawBoard(ctx, T, x, y, w, nd, path) {
      var cell = Math.min(20, Math.floor((w - 24) / n));
      var bx = x + Math.floor((w - cell * n) / 2), by = y + 26;
      var cols = [], cutRow = -1, cutCol = -1;
      for (var i = 0; i < path.length; i++) {
        if (path[i].kind === 'cut') { cutRow = path[i].d - 1; cutCol = path[i].cv; }
        else cols.push(path[i].cv);
      }
      // 탐색이 끝난 뒤에는 첫 번째 해를 보여 준다 — 결국 무엇을 찾았는지가 남아야 한다.
      var showSol = (cur >= model.nodes.length && model.solList && model.solList.length);
      if (showSol) {
        cols = model.solList[0].split('-');
        for (var q = 0; q < cols.length; q++) cols[q] = parseInt(cols[q], 10);
        cutRow = -1;
      }

      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          ctx.fillStyle = ((r + c) % 2) ? T.bgCode : T.bg;
          ctx.fillRect(bx + c * cell, by + r * cell, cell, cell);
        }
      }
      // 놓인 퀸
      for (var rr = 0; rr < cols.length && rr < n; rr++) {
        var qx = bx + cols[rr] * cell, qy = by + rr * cell;
        ctx.fillStyle = showSol ? T.wPath : T.wVisited;
        ctx.fillRect(qx + 1, qy + 1, cell - 2, cell - 2);
        if (cell >= 12) {
          text(ctx, 'Q', qx + cell / 2, qy + cell * 0.72, '700 ' + Math.round(cell * 0.62) + 'px ' + FONT, T.bg, 'center');
        }
      }
      // 시도했다가 잘린 칸 + 부딪힌 퀸
      if (cutRow >= 0) {
        ctx.fillStyle = T.boxDanger;
        ctx.fillRect(bx + cutCol * cell + 1, by + cutRow * cell + 1, cell - 2, cell - 2);
        if (cell >= 12) {
          text(ctx, '×', bx + cutCol * cell + cell / 2, by + cutRow * cell + cell * 0.74,
               '700 ' + Math.round(cell * 0.7) + 'px ' + FONT, T.bg, 'center');
        }
        if (nd.wrow >= 0 && nd.wrow < cols.length) {
          ctx.strokeStyle = T.boxWarn;
          ctx.lineWidth = 2;
          ctx.strokeRect(bx + cols[nd.wrow] * cell + 1, by + nd.wrow * cell + 1, cell - 2, cell - 2);
          ctx.lineWidth = 1;
        }
      }
      ctx.strokeStyle = T.border;
      ctx.strokeRect(bx + 0.5, by + 0.5, cell * n - 1, cell * n - 1);

      var ty = by + cell * n + 16;
      text(ctx, showSol ? ('해 ' + model.solList[0]) : ('놓은 퀸 ' + cols.length + '개'),
           x + 8, ty, '11px ' + FONT, showSol ? T.wPath : T.fgDim);
      if (cutRow >= 0) {
        text(ctx, '× 행 ' + cutRow + ' 열 ' + cutCol + ' 은 못 놓는다', x + 8, ty + 15, '11px ' + FONT, T.boxDanger);
      }
    }

    function drawItems(ctx, T, x, y, w, nd, path) {
      var sum = 0, ty = y + 30;
      for (var i = 0; i < items.length; i++) {
        var st = 0;   // 0 미정 1 넣음 2 건너뜀 3 잘림
        if (i < path.length) {
          var p = path[i];
          st = (p.kind === 'cut') ? 3 : (p.cv ? 1 : 2);
          if (p.cv && p.kind !== 'cut') sum += items[i];
        }
        var bx = x + 10, bw = w - 20, bh = 15;
        ctx.fillStyle = st === 1 ? T.wVisited : (st === 3 ? T.boxDanger : T.bg);
        ctx.globalAlpha = st === 2 ? 0.35 : 1;
        ctx.fillRect(bx, ty - 11, bw, bh);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.border;
        ctx.strokeRect(bx + 0.5, ty - 10.5, bw - 1, bh - 1);
        text(ctx, '물건 ' + i + ' · 무게 ' + items[i], bx + 5, ty,
             '10px ' + FONT, (st === 1 || st === 3) ? T.bg : T.fgDim);
        text(ctx, st === 1 ? '넣음' : (st === 2 ? '건너뜀' : (st === 3 ? '초과 ×' : '—')),
             bx + bw - 5, ty, '10px ' + FONT, (st === 1 || st === 3) ? T.bg : T.fgFaint, 'right');
        ty += bh + 3;
      }
      text(ctx, '합 ' + sum + ' / 목표 ' + target, x + 10, ty + 12, '700 12px ' + FONT,
           sum === target ? T.wPath : T.fgDim);
      // 목표 대비 막대. 넘치면 붉게 — 가지치기의 근거가 그림으로도 읽힌다.
      var bw2 = w - 20, ratio = Math.min(1, sum / target);
      ctx.fillStyle = T.bgCode;
      ctx.fillRect(x + 10, ty + 18, bw2, 6);
      ctx.fillStyle = sum > target ? T.boxDanger : (sum === target ? T.wPath : T.wVisited);
      ctx.fillRect(x + 10, ty + 18, Math.max(1, bw2 * ratio), 6);
    }

    function drawSlots(ctx, T, x, y, w, nd, path) {
      var cell = Math.min(26, Math.floor((w - 24) / n));
      var bx = x + 10, by = y + 34;
      for (var i = 0; i < n; i++) {
        var v = null, cut = false;
        if (i < path.length) { v = path[i].cv; cut = path[i].kind === 'cut'; }
        ctx.fillStyle = v == null ? T.bg : (cut ? T.boxDanger : T.wVisited);
        ctx.fillRect(bx + i * cell, by, cell - 2, cell - 2);
        ctx.strokeStyle = T.border;
        ctx.strokeRect(bx + i * cell + 0.5, by + 0.5, cell - 3, cell - 3);
        if (v != null) {
          text(ctx, String(v), bx + i * cell + (cell - 2) / 2, by + cell * 0.68,
               '700 ' + Math.round(cell * 0.5) + 'px ' + FONT, T.bg, 'center');
        }
        text(ctx, String(i), bx + i * cell + (cell - 2) / 2, by + cell + 12,
             '9px ' + FONT, T.fgFaint, 'center');
      }
      text(ctx, '자리 ↑ / 값 ↓', x + 10, by + cell + 30, '10px ' + FONT, T.fgFaint);
    }

    function drawCalls(ctx, T, x, y, w, nd, path) {
      var ty = y + 32;
      text(ctx, 'hanoi(' + n + ', A→C)', x + 10, ty, '11px ' + FONT, T.fgDim);
      for (var i = 0; i < path.length && i < 8; i++) {
        ty += 16;
        var p = path[i];
        text(ctx, '└ ' + (p.kind === 'base' ? 'hanoi(0)' : 'hanoi(' + p.cv + ')'),
             x + 10 + (i + 1) * 8, ty, '11px ' + FONT,
             p.kind === 'base' ? T.wPath : (i === path.length - 1 ? T.accent : T.fgFaint));
      }
      ty += 24;
      text(ctx, '지금 스택 깊이 ' + path.length, x + 10, ty, '11px ' + FONT, T.fgDim);
      text(ctx, '한 노드에서 보이는 것은', x + 10, ty + 18, '10px ' + FONT, T.fgFaint);
      text(ctx, '자기 자신과 자식 둘뿐이다.', x + 10, ty + 31, '10px ' + FONT, T.fgFaint);
    }

    // ---- 캔버스 ----
    function draw(ctx, size, T) {
      var L = layoutFor(size.w);
      ctx.textBaseline = 'alphabetic';
      drawHeader(ctx, T, L);
      drawTree(ctx, T, L);
      if (L.side) drawSide(ctx, T, L);
      ctx.globalAlpha = 1;
    }

    var canvas = K.canvas(ui.stage, {
      height: function (w) { return layoutFor(w).height; },
      draw: draw
    });

    // ---- 상태 줄 ----
    function solText() {
      var list = model.solList || [];
      if (!list.length) return '해가 없다.';
      var head = list.slice(0, 10).join(', ');
      return '해 ' + comma(model.sols) + '개: ' + head + (list.length > 10 ? ' 외 ' + (list.length - 10) + '개' : '') + '.';
    }

    function label(i) {
      var nodes = model.nodes;
      if (i < nodes.length) {
        var nd = nodes[i];
        var vis = model.cVis[i + 1], cutn = model.cCut[i + 1], sol = model.cSol[i + 1];
        var s = nd.say || '';
        if (problem === 'hanoi') {
          return s + '  ▸ 지금까지 호출 ' + comma(vis) + '개, 기저 ' + comma(sol) + '개.';
        }
        return s + '  ▸ 지금까지 방문 ' + comma(vis) + '개, 잘림 ' + comma(cutn) +
               '개, 해 ' + comma(sol) + '개. (가지치기 ' + (prune ? 'ON' : 'OFF') + ')';
      }
      // 마지막 스텝 — 결론. 두 모드의 총계를 한 문장에 나란히 둔다.
      if (problem === 'hanoi') {
        return '탐색 종료. hanoi(' + n + ') 는 호출 ' + comma(model.visited) + '개, 그중 기저 h0 가 ' +
               comma(model.sols) + '개, 실제로 옮긴 원반이 ' + comma(model.moves) + '개다. ' +
               '호출 수는 2^' + (n + 1) + ' − 1 이고 원반이 하나 늘 때마다 두 배가 된다.';
      }
      var me = { v: model.visited, c: model.pruned, s: model.sols };
      var ot = { v: model.other.visited, c: model.other.pruned, s: model.other.sols };
      var on = prune ? me : ot, off = prune ? ot : me;
      var ratio = on.v > 0 ? Math.round((off.v / on.v) * 10) / 10 : 0;
      var s2 = '탐색 종료. 가지치기 ON — 방문 ' + comma(on.v) + '개, 잘림 ' + comma(on.c) +
               '개, 해 ' + comma(on.s) + '개. 가지치기 OFF — 방문 ' + comma(off.v) +
               '개, 잘림 ' + comma(off.c) + '개, 해 ' + comma(off.s) + '개. ' +
               'ON 이 ' + (ratio >= 100 ? comma(Math.round(ratio)) : ratio) + '배 적게 펼친다. ';
      if (model.same === true) s2 += '두 쪽이 찾은 해는 같다. ';
      else if (model.same === false) s2 += '해집합이 다르다 — 가지치기가 답을 잃었다. ';
      else s2 += 'OFF 쪽은 전수 열거 대신 계산값이다. ';
      s2 += solText();
      if (model.truncated) {
        s2 += ' (그림은 앞 ' + comma(model.nodes.length) + '개 노드까지만이다.)';
      }
      return s2;
    }

    // ---- 재생기 ----
    player = K.player(ui, {
      total: function () { return model.nodes.length + 1; },
      render: function (i) { cur = i; canvas.redraw(); },
      label: label
    });

    /* 폭이 바뀌면 그릴 수 있는 노드 수 자체가 달라진다(TIERS). 캔버스의
     * ResizeObserver 는 다시 그리기만 하므로, 모델을 다시 만들 관측자를 따로 둔다.
     * 같은 폭에서는 절대 다시 만들지 않는다 — 되감기가 흔들리면 안 된다(계약 §7). */
    function syncCap() {
      var w = ui.stage.clientWidth || 320;
      var want = capFor(w);
      if (want === cap) return;
      cap = want;
      rebuild();
      syncTitle();
      player.goto(Math.min(cur, model.nodes.length));
    }

    if (typeof ResizeObserver === 'function') {
      var pending = false;
      new ResizeObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; syncCap(); });
      }).observe(ui.stage);
    } else {
      window.addEventListener('resize', syncCap);
    }

    syncCap();
    syncTitle();
    player.goto(0);
  });
})();
