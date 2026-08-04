/* dp-table.js — DP 표: 점화식이 "어느 칸을 읽는가"를 화살표로 보여준다
 *
 * 왜 화살표가 이 위젯의 본체인가
 *   DP 는 "설명은 이해했는데 코드는 못 짜는" 상태가 가장 안정적으로 재생산되는
 *   주제다. 그 간극의 정체는 점화식을 문장으로는 외웠지만, 한 칸을 채울 때 표의
 *   *어느 칸*을 읽는지를 한 번도 눈으로 본 적이 없다는 데 있다. 그래서 이 위젯은
 *   "채워지는 칸을 반짝이게 하는" 데서 멈추지 않는다. 읽은 칸에서 쓰는 칸으로
 *   화살표를 그린다. 화살표가 장식이 아니라 이 위젯의 존재 이유다.
 *
 * 왜 색만이 아니라 모양으로도 구분하는가 (계약 §5)
 *   채택한 항(실선 화살표 + 실선 테두리)과 비교만 한 항(점선 화살표 + 점선 테두리)을
 *   색이 아니라 선 종류로 갈랐다. 색을 구분하지 못해도 어느 쪽을 골랐는지 읽힌다.
 *   상태 줄은 점화식을 그 스텝의 실제 숫자로 풀어 쓴다 — 그것만 읽어도 위젯이 성립한다.
 *
 * 왜 스텝마다 표 전체를 스냅샷으로 떠 두는가 (계약 §7)
 *   render(i) 는 그리기만 해야 한다. 되감기가 즉시 되어야 하고 같은 i 는 항상 같은
 *   그림이어야 하기 때문이다. 표는 최대 수백 칸이라 스냅샷 비용이 무시할 만하다.
 *
 * 왜 숫자에 배경색 테두리(halo)를 두르는가
 *   긴 화살표는 중간 칸 위를 지나갈 수밖에 없다. 숫자를 배경색으로 한 번 긋고
 *   그 위에 다시 칠하면 화살표가 지나가도 숫자가 먼저 읽힌다.
 *
 * kind 별 점화식 — 본문 ::: dual 코드와 같은 표준형만 쓴다 (계약 §9).
 *   grid     : dp[r][c] = dp[r-1][c] + dp[r][c-1]            (벽이면 0)
 *   knapsack : dp[i][c] = max(dp[i-1][c], dp[i-1][c-w]+v)
 *   lcs      : 같으면 dp[i-1][j-1]+1, 다르면 max(dp[i-1][j], dp[i][j-1])
 *   lis      : dp[i] = 1 + max(dp[j] for j<i if a[j]<a[i])
 *   interval : dp[i][j] = min_k dp[i][k] + dp[k+1][j] + d[i-1]*d[k]*d[j]
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K || !K.register) return;

  var EMPTY = -2147483648;   // Int32Array 에 "아직 안 채움"을 담기 위한 보초값
  var MAX_STEPS = 700;       // opts 가 이상하게 커도 재생이 무한정 길어지지 않게

  // ------------------------------------------------------------- opts 검증
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 절대 믿지 않는다 (계약 §1).

  function num(v, dflt) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return dflt;
  }

  function int(v, lo, hi, dflt) {
    var n = Math.round(num(v, NaN));
    if (!isFinite(n)) return dflt;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function str(v, dflt) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return dflt;
  }

  // ------------------------------------------------------------- 표 빌더
  //
  // 값 배열 하나를 굴리면서 스텝마다 복사본을 떠 둔다. 스텝 객체는
  //   acts    이번에 쓰는 칸
  //   reads   이번에 읽은 칸 [r, c, 채택했는가]
  //   label   상태 줄 문장 (점화식을 숫자로 풀어 쓴 것)
  //   caption 캔버스 좌상단 한 줄 (지금 어느 단계인가)
  //   pathLen 역추적 경로 중 몇 개까지 밝혔는가
  // 를 갖는다.

  function Table(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.vals = new Int32Array(rows * cols);
    for (var i = 0; i < this.vals.length; i++) this.vals[i] = EMPTY;
    this.has = new Uint8Array(rows * cols);
    this.steps = [];
    this.path = [];      // 역추적으로 밝혀진 칸 [r, c]
    this.mark = {};      // "여기서 답의 조각을 채택했다" 표시 (키: r*cols+c)
  }

  Table.prototype.set = function (r, c, v) {
    var k = r * this.cols + c;
    this.vals[k] = v;
    this.has[k] = 1;
  };

  Table.prototype.get = function (r, c) { return this.vals[r * this.cols + c]; };

  Table.prototype.step = function (s) {
    if (this.steps.length >= MAX_STEPS) return;
    s.acts = s.acts || [];
    s.reads = s.reads || [];
    s.label = s.label || '';
    s.caption = s.caption || '';
    s.pathLen = this.path.length;
    s.vals = new Int32Array(this.vals);
    s.has = new Uint8Array(this.has);
    this.steps.push(s);
  };

  // ------------------------------------------------------------- 격자 경로 수
  //
  // 가장 단순한 2차원 DP. 읽는 칸이 위·왼쪽 둘뿐이라 화살표의 의미가 즉시 보인다.

  function buildGrid(o) {
    var rows = int(o.rows, 2, 8, 5);
    var cols = int(o.cols, 2, 10, 6);
    var wall = new Uint8Array(rows * cols);
    var blocked = Array.isArray(o.blocked) ? o.blocked : [[1, 2], [2, 4]];
    for (var b = 0; b < blocked.length && b < 40; b++) {
      var e = blocked[b];
      if (!e) continue;
      var r = Array.isArray(e) ? int(e[0], 0, rows - 1, -1) : int(e.r, 0, rows - 1, -1);
      var c = Array.isArray(e) ? int(e[1], 0, cols - 1, -1) : int(e.c, 0, cols - 1, -1);
      if (r < 0 || c < 0) continue;
      // 시작·도착을 막으면 위젯이 아무것도 보여주지 못한다. 그건 오타로 본다.
      if ((r === 0 && c === 0) || (r === rows - 1 && c === cols - 1)) continue;
      wall[r * cols + c] = 1;
    }

    var t = new Table(rows, cols);
    t.kind = 'grid';
    t.wall = wall;
    t.headW = 34;
    t.corner = 'r\\c';
    t.rowLab = []; t.colLab = [];
    for (var i = 0; i < rows; i++) t.rowLab.push(String(i));
    for (var j = 0; j < cols; j++) t.colLab.push(String(j));
    t.title = '격자 경로 수 — dp[r][c] = dp[r-1][c] + dp[r][c-1]';

    t.set(0, 0, 1);
    t.step({
      acts: [[0, 0]],
      caption: '기저',
      label: '기저: 출발 칸 dp[0][0] = 1. 출발점에 도달하는 방법은 "가만히 있는 것" 하나뿐이다.'
    });

    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols; cc++) {
        if (rr === 0 && cc === 0) continue;
        if (wall[rr * cols + cc]) {
          t.set(rr, cc, 0);
          t.step({
            acts: [[rr, cc]],
            caption: 'r=' + rr,
            label: '(' + rr + ',' + cc + ') 은 벽이다. 지나갈 수 없으니 dp = 0. 읽을 칸이 없다.'
          });
          continue;
        }
        var up = rr > 0 ? t.get(rr - 1, cc) : 0;
        var left = cc > 0 ? t.get(rr, cc - 1) : 0;
        var reads = [];
        var parts = [];
        if (rr > 0) { reads.push([rr - 1, cc, up > 0]); parts.push('dp[' + (rr - 1) + '][' + cc + ']=' + up); }
        if (cc > 0) { reads.push([rr, cc - 1, left > 0]); parts.push('dp[' + rr + '][' + (cc - 1) + ']=' + left); }
        var v = up + left;
        t.set(rr, cc, v);
        t.step({
          acts: [[rr, cc]],
          reads: reads,
          caption: 'r=' + rr,
          label: 'dp[' + rr + '][' + cc + '] = ' + parts.join(' + ') + ' = ' + v +
            (v === 0 ? ' — 여기로 오는 길이 아직 없다.' : ' — 위와 왼쪽에서 오는 경로를 더한다.')
        });
      }
    }

    var ans = t.get(rows - 1, cols - 1);
    t.result = { value: ans, kind: 'grid' };

    if (ans > 0) {
      // 경로 수 DP 는 "정답 경로"가 하나로 정해지지 않는다. 그래서 대표 경로
      // 하나를 거꾸로 따라가며 보여주고, 그것이 여러 경로 중 하나임을 명시한다.
      var pr = rows - 1, pc = cols - 1;
      var chain = [];
      while (true) {
        chain.push([pr, pc]);
        if (pr === 0 && pc === 0) break;
        var u = pr > 0 ? t.get(pr - 1, pc) : 0;
        if (pr > 0 && u > 0) { pr = pr - 1; }
        else { pc = pc - 1; }
      }
      for (var s = 0; s < chain.length; s++) {
        t.path.push(chain[s]);
        t.step({
          caption: '역추적',
          label: s === 0
            ? 'dp[' + (rows - 1) + '][' + (cols - 1) + '] = ' + ans + '. 값이 0 이 아닌 칸을 거꾸로 따라가면 실제 경로 하나가 나온다.'
            : '(' + chain[s][0] + ',' + chain[s][1] + ') 로 되돌아왔다. dp = ' + t.get(chain[s][0], chain[s][1]) + '.'
        });
      }
      t.step({
        caption: '역추적',
        label: '도착 칸까지 가는 방법은 모두 ' + ans + ' 가지다. 방금 칠한 것은 그중 한 경로다 — 경로 수 DP 는 경로를 하나로 정해 주지 않는다.'
      });
    } else {
      t.step({ caption: '결과', label: '도착 칸의 dp 가 0 이다. 벽에 막혀 갈 수 있는 경로가 하나도 없다.' });
    }
    return t;
  }

  // ------------------------------------------------------------- 0/1 배낭
  //
  // dp[i][c] = max(dp[i-1][c], dp[i-1][c-w_i] + v_i)
  // 읽는 칸이 "바로 윗줄의 같은 열"과 "바로 윗줄의 w 칸 왼쪽" 두 군데라는 것이
  // 배낭의 전부다. 그 두 화살표를 보이는 것이 이 kind 의 목적이다.

  function buildKnapsack(o) {
    // 표가 읽히려면 칸이 일정 크기 이상이어야 한다. 그래서 상한을 둔다.
    // 다만 잘라냈다는 사실은 제목에 밝힌다 — 조용히 자르면 위젯이 거짓말을 한다.
    var capWant = int(o.cap, 1, 9999, 8);
    var cap = capWant > 14 ? 14 : capWant;
    var clamped = [];
    if (capWant > cap) clamped.push('용량 ' + capWant + '→' + cap);
    var items = [];
    var src = Array.isArray(o.items) ? o.items : null;
    if (src) {
      for (var i = 0; i < src.length && items.length < 6; i++) {   // 물건 상한 6 — 세로로도 읽혀야 한다
        var it = src[i];
        if (!it || typeof it !== 'object') continue;
        var w = int(it.w, 1, 20, 0);
        var v = int(it.v, 0, 999, 0);
        if (w < 1) continue;
        items.push({ w: w, v: v });
      }
    }
    if (!items.length) items = [{ w: 2, v: 3 }, { w: 3, v: 4 }, { w: 4, v: 5 }, { w: 5, v: 6 }];
    if (src && src.length > items.length) clamped.push('물건 ' + src.length + '→' + items.length);

    var n = items.length;
    var t = new Table(n + 1, cap + 1);
    t.kind = 'knapsack';
    t.headW = 60;
    t.corner = 'i\\c';
    t.rowLab = ['0'];
    t.rowSub = ['없음'];
    for (var a = 0; a < n; a++) {
      t.rowLab.push(String(a + 1));
      t.rowSub.push('w' + items[a].w + ' v' + items[a].v);
    }
    t.colLab = [];
    for (var c0 = 0; c0 <= cap; c0++) t.colLab.push(String(c0));
    t.title = '0/1 배낭 (용량 ' + cap + ') — dp[i][c] = max(dp[i-1][c], dp[i-1][c-w]+v)'
              + (clamped.length ? '  · 표가 읽히도록 줄임: ' + clamped.join(', ') : '');
    t.items = items;

    for (var cz = 0; cz <= cap; cz++) t.set(0, cz, 0);
    var row0 = [];
    for (var cz2 = 0; cz2 <= cap; cz2++) row0.push([0, cz2]);
    t.step({
      acts: row0,
      caption: '기저',
      label: '기저: 물건이 하나도 없으면(i=0) 용량이 얼마든 담을 수 있는 가치는 0 이다. 읽을 칸이 없다.'
    });

    for (var ii = 1; ii <= n; ii++) {
      var w = items[ii - 1].w, v = items[ii - 1].v;
      for (var cc = 0; cc <= cap; cc++) {
        var skip = t.get(ii - 1, cc);
        if (cc < w) {
          t.set(ii, cc, skip);
          t.step({
            acts: [[ii, cc]],
            reads: [[ii - 1, cc, true]],
            caption: '물건 ' + ii + ' (무게 ' + w + ', 가치 ' + v + ')',
            label: 'dp[' + ii + '][' + cc + '] = dp[' + (ii - 1) + '][' + cc + '] = ' + skip +
              ' — 용량 ' + cc + ' 에는 무게 ' + w + ' 짜리 물건 ' + ii + ' 가 아예 안 들어간다. 윗줄을 그대로 베낀다.'
          });
          continue;
        }
        var take = t.get(ii - 1, cc - w) + v;
        var best = take > skip ? take : skip;
        t.set(ii, cc, best);
        t.step({
          acts: [[ii, cc]],
          reads: [[ii - 1, cc, take <= skip], [ii - 1, cc - w, take > skip]],
          caption: '물건 ' + ii + ' (무게 ' + w + ', 가치 ' + v + ')',
          label: 'dp[' + ii + '][' + cc + '] = max(dp[' + (ii - 1) + '][' + cc + ']=' + skip +
            ', dp[' + (ii - 1) + '][' + (cc - w) + ']+' + v + '=' + take + ') = ' + best +
            ' — 물건 ' + ii + ' 을 ' + (take > skip ? '넣는' : '넣지 않는') + ' 쪽이 낫다.'
        });
      }
    }

    var ans = t.get(n, cap);
    // 역추적: 윗줄과 값이 같으면 안 넣은 것, 다르면 넣은 것이다.
    var ci = n, cq = cap, chosen = [], sum = 0;
    t.path.push([n, cap]);
    t.step({
      caption: '역추적',
      label: 'dp[' + n + '][' + cap + '] = ' + ans + '. 여기서 거꾸로 올라가며 어떤 물건을 넣었는지 복원한다.'
    });
    while (ci > 0) {
      var up = t.get(ci - 1, cq);
      if (t.get(ci, cq) === up) {
        t.path.push([ci - 1, cq]);
        t.step({
          caption: '역추적',
          label: 'dp[' + ci + '][' + cq + '] 가 윗칸 dp[' + (ci - 1) + '][' + cq + '] 와 같다 → 물건 ' + ci + ' 는 넣지 않았다. 용량은 그대로 ' + cq + '.'
        });
        ci -= 1;
      } else {
        var iw = items[ci - 1].w, iv = items[ci - 1].v;
        chosen.push(ci); sum += iv;
        t.mark[ci * t.cols + cq] = 1;
        t.path.push([ci - 1, cq - iw]);
        t.step({
          caption: '역추적',
          label: 'dp[' + ci + '][' + cq + '] 가 윗칸 ' + up + ' 보다 크다 → 물건 ' + ci + '(무게 ' + iw + ', 가치 ' + iv + ') 를 넣었다. 용량 ' + (cq - iw) + ' 칸으로 간다.'
        });
        ci -= 1; cq -= iw;
      }
    }
    chosen.reverse();
    t.step({
      caption: '역추적',
      label: '고른 물건: ' + (chosen.length ? chosen.join(', ') + '번' : '없음') +
        '. 가치 합 ' + sum + ' = dp[' + n + '][' + cap + '] = ' + ans + '.'
    });
    t.result = { value: ans, kind: 'knapsack', chosen: chosen, chosenValue: sum };
    return t;
  }

  // ------------------------------------------------------------- LCS
  //
  // 같으면 대각선 하나, 다르면 위·왼쪽 둘. "왜 대각선인가"는 화살표를 봐야 안다.

  function buildLcs(o) {
    var A = str(o.a, 'ACAYKP').replace(/\s+/g, '').slice(0, 8);
    var B = str(o.b, 'CAPCAK').replace(/\s+/g, '').slice(0, 8);
    if (!A) A = 'ACAYKP';
    if (!B) B = 'CAPCAK';
    var n = A.length, m = B.length;

    var t = new Table(n + 1, m + 1);
    t.kind = 'lcs';
    t.headW = 44;
    t.corner = ' ';
    t.rowLab = ['∅']; t.rowSub = ['0'];
    for (var i = 0; i < n; i++) { t.rowLab.push(A.charAt(i)); t.rowSub.push(String(i + 1)); }
    t.colLab = ['∅']; t.colSub = ['0'];
    for (var j = 0; j < m; j++) { t.colLab.push(B.charAt(j)); t.colSub.push(String(j + 1)); }
    t.title = 'LCS — "' + A + '" vs "' + B + '"';

    var base = [];
    for (var c = 0; c <= m; c++) { t.set(0, c, 0); base.push([0, c]); }
    for (var r = 1; r <= n; r++) { t.set(r, 0, 0); base.push([r, 0]); }
    t.step({
      acts: base,
      caption: '기저',
      label: '기저: 한쪽이 빈 문자열이면 공통 부분수열의 길이는 0 이다. 0 행과 0 열을 0 으로 채운다.'
    });

    for (var ri = 1; ri <= n; ri++) {
      for (var cj = 1; cj <= m; cj++) {
        var ca = A.charAt(ri - 1), cb = B.charAt(cj - 1);
        if (ca === cb) {
          var d = t.get(ri - 1, cj - 1) + 1;
          t.set(ri, cj, d);
          t.step({
            acts: [[ri, cj]],
            reads: [[ri - 1, cj - 1, true]],
            caption: '"' + ca + '" 행',
            label: 'dp[' + ri + '][' + cj + ']: a[' + ri + ']=\'' + ca + '\' 와 b[' + cj + ']=\'' + cb +
              '\' 가 같다 → dp[' + (ri - 1) + '][' + (cj - 1) + ']+1 = ' + d + '. 대각선 하나만 읽는다.'
          });
        } else {
          var upv = t.get(ri - 1, cj), lfv = t.get(ri, cj - 1);
          var bv = upv >= lfv ? upv : lfv;
          t.set(ri, cj, bv);
          t.step({
            acts: [[ri, cj]],
            reads: [[ri - 1, cj, upv >= lfv], [ri, cj - 1, lfv > upv]],
            caption: '"' + ca + '" 행',
            label: 'dp[' + ri + '][' + cj + ']: \'' + ca + '\' ≠ \'' + cb + '\' → max(dp[' + (ri - 1) + '][' + cj + ']=' + upv +
              ', dp[' + ri + '][' + (cj - 1) + ']=' + lfv + ') = ' + bv + ' — ' + (upv >= lfv ? '위' : '왼쪽') + '쪽을 가져온다.'
          });
        }
      }
    }

    var ans = t.get(n, m);
    var pi = n, pj = m, out = [];
    t.path.push([n, m]);
    t.step({ caption: '역추적', label: 'dp[' + n + '][' + m + '] = ' + ans + '. 여기서 거꾸로 내려가며 실제 문자열을 복원한다.' });
    while (pi > 0 && pj > 0) {
      if (A.charAt(pi - 1) === B.charAt(pj - 1)) {
        out.push(A.charAt(pi - 1));
        t.mark[pi * t.cols + pj] = 1;
        t.path.push([pi - 1, pj - 1]);
        t.step({
          caption: '역추적',
          label: '\'' + A.charAt(pi - 1) + '\' 가 일치했던 칸이다 → 답에 넣고 대각선으로 간다.'
        });
        pi -= 1; pj -= 1;
      } else if (t.get(pi - 1, pj) >= t.get(pi, pj - 1)) {
        t.path.push([pi - 1, pj]);
        t.step({ caption: '역추적', label: '값이 윗칸에서 왔다 → 위로 올라간다. (a 의 \'' + A.charAt(pi - 1) + '\' 는 쓰지 않았다)' });
        pi -= 1;
      } else {
        t.path.push([pi, pj - 1]);
        t.step({ caption: '역추적', label: '값이 왼쪽 칸에서 왔다 → 왼쪽으로 간다. (b 의 \'' + B.charAt(pj - 1) + '\' 는 쓰지 않았다)' });
        pj -= 1;
      }
    }
    out.reverse();
    var lcsStr = out.join('');
    t.step({ caption: '역추적', label: 'LCS = "' + lcsStr + '" (길이 ' + lcsStr.length + ' = dp[' + n + '][' + m + ']).' });
    t.result = { value: ans, kind: 'lcs', seq: lcsStr };
    return t;
  }

  // ------------------------------------------------------------- LIS (O(n²))
  //
  // 1차원이라 표가 한 줄이다. 위 줄에 입력 수열을 같이 놓지 않으면
  // "a[j] < a[i] 인가"라는 조건을 눈으로 확인할 수 없다. 그래서 두 줄로 그린다.
  // 화살표는 같은 줄 안에서 오가므로 셀 아래쪽 띠에 활 모양으로 건다(숫자를 가리지 않게).

  function buildLis(o) {
    var seq = [];
    var src = Array.isArray(o.seq) ? o.seq : (Array.isArray(o.a) ? o.a : null);
    if (src) {
      for (var i = 0; i < src.length && seq.length < 12; i++) {
        var x = num(src[i], NaN);
        if (!isFinite(x)) continue;
        seq.push(int(x, -999, 999, 0));
      }
    }
    if (seq.length < 2) seq = [10, 20, 10, 30, 20, 50, 40, 60];
    var n = seq.length;

    var t = new Table(2, n);
    t.kind = 'lis';
    t.headW = 48;
    t.corner = 'i';
    t.inputRow = 0;
    t.rowLab = ['a[i]', 'dp[i]'];
    t.colLab = [];
    for (var j = 0; j < n; j++) t.colLab.push(String(j));
    t.title = 'LIS O(n²) — dp[i] = 1 + max(dp[j] : j<i, a[j]<a[i])';
    t.seq = seq;

    var acts0 = [];
    for (var k = 0; k < n; k++) { t.set(0, k, seq[k]); acts0.push([0, k]); }
    t.step({
      acts: acts0,
      caption: '입력',
      label: '수열을 놓는다. dp[i] 는 "i 에서 끝나는 증가 부분수열의 최대 길이"다.'
    });

    var dp = [], prev = [];
    for (var ii = 0; ii < n; ii++) {
      dp[ii] = 1; prev[ii] = -1;
      t.set(1, ii, 1);
      t.step({
        acts: [[1, ii]],
        caption: 'i=' + ii,
        label: 'dp[' + ii + '] = 1 로 시작한다 — 자기 자신 하나짜리 부분수열은 언제나 있다. 읽을 칸이 없다.'
      });
      for (var jj = 0; jj < ii; jj++) {
        if (seq[jj] < seq[ii]) {
          if (dp[jj] + 1 > dp[ii]) {
            dp[ii] = dp[jj] + 1; prev[ii] = jj;
            t.set(1, ii, dp[ii]);
            t.step({
              acts: [[1, ii]],
              reads: [[1, jj, true]],
              caption: 'i=' + ii,
              label: 'a[' + jj + ']=' + seq[jj] + ' < a[' + ii + ']=' + seq[ii] + ' 이고 dp[' + jj + ']+1=' + (dp[jj] + 1) +
                ' 이 더 크다 → dp[' + ii + '] = ' + dp[ii] + '. ' + ii + ' 앞에 ' + jj + ' 를 붙인다.'
            });
          } else {
            t.step({
              acts: [[1, ii]],
              reads: [[1, jj, false]],
              caption: 'i=' + ii,
              label: 'a[' + jj + ']=' + seq[jj] + ' < a[' + ii + ']=' + seq[ii] + ' 지만 dp[' + jj + ']+1=' + (dp[jj] + 1) +
                ' 은 이미 가진 dp[' + ii + ']=' + dp[ii] + ' 보다 크지 않다 → 그대로 둔다.'
            });
          }
        } else {
          t.step({
            acts: [[1, ii]],
            caption: 'i=' + ii,
            label: 'a[' + jj + ']=' + seq[jj] + ' ≥ a[' + ii + ']=' + seq[ii] + ' → 증가가 아니라 이어붙일 수 없다. 읽지 않는다.'
          });
        }
      }
    }

    var best = 0, bi = 0;
    for (var q = 0; q < n; q++) if (dp[q] > best) { best = dp[q]; bi = q; }
    var chain = [];
    var cur = bi;
    while (cur >= 0) { chain.push(cur); cur = prev[cur]; }

    for (var s = 0; s < chain.length; s++) {
      var idxc = chain[s];
      t.mark[1 * t.cols + idxc] = 1;
      t.path.push([1, idxc]);
      t.path.push([0, idxc]);
      t.step({
        caption: '역추적',
        label: s === 0
          ? '가장 긴 길이는 ' + best + ' 이고 i=' + idxc + ' 에서 끝난다. prev 를 따라 거꾸로 간다.'
          : 'dp[' + chain[s - 1] + ']=' + dp[chain[s - 1]] + ' 는 dp[' + idxc + ']=' + dp[idxc] + ' 에서 왔다. a[' + idxc + ']=' + seq[idxc] + ' < a[' + chain[s - 1] + ']=' + seq[chain[s - 1]] + '.'
      });
    }
    var vals = chain.slice().reverse().map(function (z) { return seq[z]; });
    t.step({ caption: '역추적', label: 'LIS = ' + vals.join(' → ') + ' (길이 ' + best + ').' });
    t.result = { value: best, kind: 'lis', seq: vals };
    return t;
  }

  // ------------------------------------------------------------- 구간 DP
  //
  // 행렬 곱셈 순서. 이 kind 의 교훈은 점화식 자체가 아니라 **채우는 순서**다.
  // dp[i][j] 는 같은 행의 왼쪽(dp[i][k])과 같은 열의 아래(dp[k+1][j])를 읽는다.
  // 그래서 행 우선으로 채우면 아직 없는 칸을 읽게 된다 — 길이가 짧은 구간부터
  // 채워야 한다. 캡션에 L 을 크게 띄우고 대각선 띠가 순서대로 차오르게 그린다.

  function buildInterval(o) {
    var dims = [];
    var src = Array.isArray(o.dims) ? o.dims : null;
    if (src) {
      for (var i = 0; i < src.length && dims.length < 7; i++) {
        var d = int(src[i], 1, 999, 0);
        if (d < 1) continue;
        dims.push(d);
      }
    }
    if (dims.length < 3) dims = [5, 10, 3, 12, 5, 50];
    var n = dims.length - 1;   // 행렬 개수

    var t = new Table(n, n);
    t.kind = 'interval';
    t.headW = 40;
    t.corner = 'i\\j';
    t.rowLab = []; t.colLab = [];
    for (var a = 1; a <= n; a++) { t.rowLab.push(String(a)); t.colLab.push(String(a)); }
    t.mask = new Uint8Array(n * n);
    for (var r = 0; r < n; r++) for (var c = r; c < n; c++) t.mask[r * n + c] = 1;
    var mnames = [];
    for (var mi = 1; mi <= n; mi++) mnames.push('A' + mi + '(' + dims[mi - 1] + '×' + dims[mi] + ')');
    t.title = '구간 DP — 행렬 곱셈 순서: ' + mnames.join(' ');
    t.dims = dims;

    // 표 좌표는 0-based(r=i-1, c=j-1), 점화식은 1-based(i, j) 로 쓴다.
    function R(i) { return i - 1; }

    var dp = [], split = [];
    for (var z = 0; z <= n + 1; z++) { dp[z] = []; split[z] = []; }

    var diag = [];
    for (var i1 = 1; i1 <= n; i1++) { dp[i1][i1] = 0; t.set(R(i1), R(i1), 0); diag.push([R(i1), R(i1)]); }
    t.step({
      acts: diag,
      caption: '길이 L = 1',
      label: '기저: 행렬 하나짜리 구간은 곱할 것이 없다. dp[i][i] = 0. 대각선부터 채운다.'
    });

    for (var L = 2; L <= n; L++) {
      for (var i = 1; i + L - 1 <= n; i++) {
        var j = i + L - 1;
        var bestV = Infinity, bestK = i;
        for (var k = i; k < j; k++) {
          var mul = dims[i - 1] * dims[k] * dims[j];
          var tot = dp[i][k] + dp[k + 1][j] + mul;
          var better = tot < bestV;
          if (better) { bestV = tot; bestK = k; }
          t.step({
            acts: [[R(i), R(j)]],
            reads: [[R(i), R(k), better], [R(k + 1), R(j), better]],
            caption: '길이 L = ' + L,
            label: 'dp[' + i + '][' + j + '] 후보 k=' + k + ': dp[' + i + '][' + k + ']=' + dp[i][k] +
              ' + dp[' + (k + 1) + '][' + j + ']=' + dp[k + 1][j] +
              ' + ' + dims[i - 1] + '×' + dims[k] + '×' + dims[j] + '=' + mul + ' → ' + tot +
              (better ? ' — 지금까지 최선.' : ' — 지금 최선 ' + bestV + ' 보다 크다.')
          });
        }
        dp[i][j] = bestV; split[i][j] = bestK;
        t.set(R(i), R(j), bestV);
        t.step({
          acts: [[R(i), R(j)]],
          reads: [[R(i), R(bestK), true], [R(bestK + 1), R(j), true]],
          caption: '길이 L = ' + L,
          label: 'dp[' + i + '][' + j + '] = ' + bestV + ' (k=' + bestK + ' 에서 자른다). 길이 ' + L +
            ' 구간은 길이 ' + (L - 1) + ' 이하 구간만 읽는다 — 그래서 길이 순서로 채워야 한다.'
        });
      }
    }

    var ans = dp[1][n];
    function paren(i, j) {
      if (i === j) return 'A' + i;
      var k = split[i][j];
      return '(' + paren(i, k) + paren(k + 1, j) + ')';
    }

    var order = [];
    (function walk(i, j) {
      order.push([i, j]);
      if (i === j) return;
      var k = split[i][j];
      walk(i, k); walk(k + 1, j);
    })(1, n);

    for (var w = 0; w < order.length; w++) {
      var oi = order[w][0], oj = order[w][1];
      t.path.push([R(oi), R(oj)]);
      if (oi === oj) {
        t.step({ caption: '역추적', label: '구간 [' + oi + ',' + oj + '] 은 행렬 A' + oi + ' 하나다. 더 자를 것이 없다.' });
      } else {
        t.mark[R(oi) * t.cols + R(oj)] = 1;
        t.step({
          caption: '역추적',
          label: '구간 [' + oi + ',' + oj + '] 은 k=' + split[oi][oj] + ' 에서 자른다 → (' + paren(oi, split[oi][oj]) + ')(' + paren(split[oi][oj] + 1, oj) + '), 비용 ' + dp[oi][oj] + '.'
        });
      }
    }
    t.step({ caption: '역추적', label: '최적 괄호: ' + paren(1, n) + ' — 곱셈 ' + ans + ' 번. 순서만 바꿔도 비용이 달라진다.' });
    t.result = { value: ans, kind: 'interval', paren: paren(1, n) };
    return t;
  }

  // ------------------------------------------------------------- 그리기

  function boxEdge(cx, cy, hw, hh, dx, dy) {
    // 중심에서 (dx,dy) 방향으로 나갈 때 사각형 경계와 만나는 점.
    // 화살표를 셀 경계에서 시작·종료시켜 숫자를 덜 가리게 하려고 쓴다.
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 && ay < 1e-6) return { x: cx, y: cy };
    var tx = ax > 1e-6 ? hw / ax : Infinity;
    var ty = ay > 1e-6 ? hh / ay : Infinity;
    var s = Math.min(tx, ty);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function widget(host, opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    var kind = str(o.kind, 'grid').toLowerCase();
    var builders = {
      grid: buildGrid, knapsack: buildKnapsack, lcs: buildLcs,
      lis: buildLis, interval: buildInterval
    };
    if (!builders[kind]) kind = 'grid';
    var model = builders[kind](o);

    // 역추적 칸을 O(1) 로 찾기 위한 역인덱스. render 안에서 배열을 새로 만들지 않는다.
    model.pathIndex = new Int32Array(model.rows * model.cols);
    for (var pz = 0; pz < model.pathIndex.length; pz++) model.pathIndex[pz] = -1;
    for (var pp = 0; pp < model.path.length; pp++) {
      var pk = model.path[pp][0] * model.cols + model.path[pp][1];
      if (model.pathIndex[pk] < 0) model.pathIndex[pk] = pp;
    }

    var ui = K.frame(host, { title: str(o.title, model.title), wide: o.wide === true });

    // 범례: 색을 못 봐도 되게 선 종류 설명을 같이 넣는다.
    var lg = K.el('div', 'wk-legend');
    function legend(colorVar, text) {
      var sp = K.el('span');
      if (colorVar) {
        var sw = K.el('i');
        sw.style.background = 'var(' + colorVar + ')';
        sp.appendChild(sw);
      }
      sp.appendChild(document.createTextNode(text));
      lg.appendChild(sp);
    }
    legend('--w-visited', '채워진 칸');
    legend('--w-frontier', '지금 채우는 칸');
    legend('--w-start', '점화식이 읽는 칸');
    legend('--w-path', '역추적');
    if (model.kind === 'grid') legend('--w-wall', '벽');
    legend(null, '실선 화살표 = 채택 / 점선 = 비교만');
    ui.slot.appendChild(lg);

    var idx = 0;

    // ---- 배치 계산: 폭에 따라 셀 크기를 정하고, 최소 크기 밑으로 내려가면
    //      열을 창(window)으로 잘라 보여준다. 글자를 못 읽을 크기로 그리느니
    //      일부만 보이는 편이 낫다. (계약 §4)
    function layout(W) {
      var narrow = W < 700;
      var padX = 2;
      var capH = 15;
      var headW = Math.round(Math.max(24, model.headW * (narrow ? 0.8 : 1)));
      var headH = model.colSub ? 30 : 22;
      var avail = Math.max(60, W - padX * 2 - headW);
      var nCols = model.cols;
      var minCell = narrow ? 21 : 26;
      var cw = Math.floor(avail / nCols);
      var visCols = nCols;
      if (cw < minCell) {
        visCols = Math.max(3, Math.min(nCols, Math.floor(avail / minCell)));
        cw = Math.floor(avail / visCols);
      }
      if (cw > 56) cw = 56;
      if (cw < 14) cw = 14;
      // 좁은 화면에서는 칸을 정사각형보다 세로로 길게 잡는다. 폭은 화면이 정하지만
      // 세로는 공짜이고, 위아래 이웃 칸을 잇는 화살표가 그릴 자리를 거기서 번다.
      var ch = Math.max(narrow ? 34 : 24, Math.min(cw, 44));
      var tableW = headW + visCols * cw;
      var ox = Math.max(padX, Math.floor((W - tableW) / 2)) + headW;
      var extraBottom = model.kind === 'lis' ? Math.round(ch * 1.05) : 5;
      var oy = capH + headH + 2;
      return {
        narrow: narrow, cw: cw, ch: ch, headW: headW, headH: headH, capH: capH,
        visCols: visCols, ox: ox, oy: oy,
        h: oy + model.rows * ch + extraBottom + 3
      };
    }

    function heightFor(W) { return layout(W).h; }

    // 창의 시작 열. 이번 스텝에 등장하는 칸을 되도록 다 담는다.
    function windowStart(g, st) {
      if (g.visCols >= model.cols) return 0;
      var lo = Infinity, hi = -Infinity, i;
      for (i = 0; i < st.acts.length; i++) { if (st.acts[i][1] < lo) lo = st.acts[i][1]; if (st.acts[i][1] > hi) hi = st.acts[i][1]; }
      for (i = 0; i < st.reads.length; i++) { if (st.reads[i][1] < lo) lo = st.reads[i][1]; if (st.reads[i][1] > hi) hi = st.reads[i][1]; }
      if (st.pathLen > 0) {
        var pc = model.path[st.pathLen - 1][1];
        if (pc < lo) lo = pc;
        if (pc > hi) hi = pc;
      }
      if (!isFinite(lo)) return 0;
      var span = hi - lo + 1;
      var s0;
      if (span <= g.visCols) {
        s0 = lo - Math.floor((g.visCols - span) / 2);
      } else if (st.reads.length && st.acts.length) {
        // 읽는 칸과 쓰는 칸이 한 화면에 다 안 들어가면 **쓰는 칸**을 붙잡는다.
        // 창 밖으로 밀린 읽는 칸은 가장자리에 열 번호 스텁으로 남는다 —
        // 지금 무엇을 채우는지가 사라지는 것이 훨씬 나쁘다.
        s0 = st.acts[st.acts.length - 1][1] - Math.floor(g.visCols / 2);
      } else {
        s0 = lo;
      }
      if (s0 < 0) s0 = 0;
      if (s0 > model.cols - g.visCols) s0 = model.cols - g.visCols;
      return s0;
    }

    function fitFont(ctx, text, maxW, base, weight) {
      var fs = base;
      while (fs > 8) {
        ctx.font = weight + ' ' + fs + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        if (ctx.measureText(text).width <= maxW) return fs;
        fs -= 1;
      }
      ctx.font = weight + ' 8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      return 8;
    }

    function draw(ctx, size, T) {
      var g = layout(size.w);
      if (!model.steps.length) return;
      var st = model.steps[Math.max(0, Math.min(idx, model.steps.length - 1))];
      var c0 = windowStart(g, st);
      var cw = g.cw, ch = g.ch;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      function cx(c) { return g.ox + (c - c0) * cw; }
      function cy(r) { return g.oy + r * ch; }
      function inWin(c) { return c >= c0 && c < c0 + g.visCols; }

      // ---- 캡션: 지금 어느 단계인가 (구간 DP 의 L 이 여기 뜬다)
      if (st.caption) {
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = T.fgFaint;
        ctx.fillText(st.caption, 3, g.capH * 0.5);
        ctx.textAlign = 'center';
      }

      // ---- 셀 배경
      var r, c, k;
      for (r = 0; r < model.rows; r++) {
        for (c = c0; c < c0 + g.visCols && c < model.cols; c++) {
          k = r * model.cols + c;
          if (model.mask && !model.mask[k]) {
            // 존재하지 않는 구간(i > j). 옅게 깔아 "여긴 칸이 아니다"를 보인다.
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = T.bgCode;
            ctx.fillRect(cx(c), cy(r), cw, ch);
            ctx.globalAlpha = 1;
            continue;
          }
          var isWall = model.wall && model.wall[k];
          var isInput = model.inputRow === r;
          var act = false, read = -1, i;
          for (i = 0; i < st.acts.length; i++) if (st.acts[i][0] === r && st.acts[i][1] === c) { act = true; break; }
          for (i = 0; i < st.reads.length; i++) if (st.reads[i][0] === r && st.reads[i][1] === c) { read = st.reads[i][2] ? 2 : 1; break; }
          var pIdx = model.pathIndex[k];
          var onPath = pIdx >= 0 && pIdx < st.pathLen;

          var fill = null, alpha = 1, stroke = T.border, lw = 1, dash = null;
          if (isWall) { fill = T.wWall; alpha = 0.9; }
          else if (isInput) { fill = T.bgElev; alpha = 1; }
          else if (act) { fill = T.wFrontier; alpha = 0.34; stroke = T.wFrontier; lw = 2.4; }
          else if (read === 2) { fill = T.wStart; alpha = 0.24; stroke = T.wStart; lw = 2; }
          else if (read === 1) { fill = T.wStart; alpha = 0.10; stroke = T.wStart; lw = 1.6; dash = [4, 3]; }
          else if (onPath) { fill = T.wPath; alpha = pIdx === st.pathLen - 1 ? 0.5 : 0.3; stroke = T.wPath; lw = pIdx === st.pathLen - 1 ? 2.4 : 1.6; }
          else if (st.has[k]) { fill = T.wVisited; alpha = 0.45; }

          if (fill) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = fill;
            ctx.fillRect(cx(c), cy(r), cw, ch);
            ctx.globalAlpha = 1;
          }
          ctx.setLineDash(dash || []);
          ctx.lineWidth = lw;
          ctx.strokeStyle = stroke;
          ctx.globalAlpha = lw > 1 ? 1 : 0.7;
          ctx.strokeRect(cx(c) + lw / 2, cy(r) + lw / 2, cw - lw, ch - lw);
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        }
      }

      // ---- 머리글
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = T.fgFaint;
      for (c = c0; c < c0 + g.visCols && c < model.cols; c++) {
        var chx = cx(c) + cw / 2;
        if (model.colSub) {
          ctx.fillStyle = T.fg;
          ctx.font = '700 12px system-ui, -apple-system, sans-serif';
          ctx.fillText(model.colLab[c], chx, g.oy - g.headH + 9);
          ctx.fillStyle = T.fgFaint;
          ctx.font = '500 10px system-ui, -apple-system, sans-serif';
          ctx.fillText(model.colSub[c], chx, g.oy - g.headH + 22);
        } else {
          ctx.fillText(model.colLab[c], chx, g.oy - g.headH / 2 - 1);
        }
      }
      for (r = 0; r < model.rows; r++) {
        var hy = cy(r) + ch / 2;
        var hx = g.ox - g.headW / 2;
        ctx.fillStyle = T.fg;
        ctx.font = '700 11px system-ui, -apple-system, sans-serif';
        if (model.rowSub) {
          ctx.fillText(model.rowLab[r], hx, hy - 6);
          ctx.fillStyle = T.fgFaint;
          ctx.font = '500 9px system-ui, -apple-system, sans-serif';
          ctx.fillText(model.rowSub[r], hx, hy + 6);
        } else {
          ctx.fillText(model.rowLab[r], hx, hy);
        }
      }
      // 잘린 방향 표시
      ctx.fillStyle = T.fgFaint;
      ctx.font = '600 11px system-ui, sans-serif';
      // 표를 가운데 정렬하면 잘림 표시가 캔버스 밖으로 나갈 수 있어 안쪽으로 당긴다
      if (c0 > 0) ctx.fillText('◂', Math.max(5, g.ox - 6), g.oy - g.headH / 2 - 1);
      if (c0 + g.visCols < model.cols) ctx.fillText('▸', Math.min(size.w - 5, g.ox + g.visCols * cw + 6), g.oy - g.headH / 2 - 1);
      // 모서리 라벨
      if (model.corner) {
        ctx.fillStyle = T.fgFaint;
        ctx.font = '500 10px system-ui, sans-serif';
        ctx.fillText(model.corner, g.ox - g.headW / 2, g.oy - g.headH / 2 - 1);
      }

      // ---- 화살표: 읽은 칸 → 쓰는 칸. 이 위젯의 본체다.
      if (st.acts.length === 1 && st.reads.length) {
        var tr = st.acts[0][0], tc = st.acts[0][1];
        for (var q = 0; q < st.reads.length; q++) {
          arrow(ctx, T, g, c0, st.reads[q][0], st.reads[q][1], tr, tc, !!st.reads[q][2]);
        }
      }

      // ---- 값: 화살표 위에 배경색 테두리를 두르고 올린다
      for (r = 0; r < model.rows; r++) {
        for (c = c0; c < c0 + g.visCols && c < model.cols; c++) {
          k = r * model.cols + c;
          if (model.mask && !model.mask[k]) continue;
          if (model.wall && model.wall[k]) {
            ctx.font = '700 ' + Math.round(ch * 0.5) + 'px system-ui, sans-serif';
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = T.bg;
            ctx.fillText('×', cx(c) + cw / 2, cy(r) + ch / 2);
            ctx.globalAlpha = 1;
            continue;
          }
          if (!st.has[k]) continue;
          var v = st.vals[k];
          var txt = String(v);
          var isAct = false;
          for (var z = 0; z < st.acts.length; z++) if (st.acts[z][0] === r && st.acts[z][1] === c) { isAct = true; break; }
          var base = Math.max(9, Math.min(15, Math.round(ch * 0.46)));
          fitFont(ctx, txt, cw - 5, base, isAct ? '800' : '600');
          var tx2 = cx(c) + cw / 2, ty2 = cy(r) + ch / 2;
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = T.bg;
          ctx.globalAlpha = 0.88;
          ctx.strokeText(txt, tx2, ty2);
          ctx.globalAlpha = 1;
          ctx.fillStyle = model.inputRow === r ? T.fgDim : T.fg;
          ctx.fillText(txt, tx2, ty2);

          // 답의 조각을 채택한 칸에는 점을 하나 찍는다 (색 없이도 구분되게)
          if (model.mark[k] && model.pathIndex[k] >= 0 && model.pathIndex[k] < st.pathLen) {
            ctx.beginPath();
            ctx.arc(cx(c) + cw - 5, cy(r) + 5, 2.6, 0, Math.PI * 2);
            ctx.fillStyle = T.wPath;
            ctx.fill();
          }
        }
      }
    }

    // 화살표 하나. bow(활 모양)를 주는 이유: 같은 행·열 안에서 먼 칸을 읽는
    // 경우(구간 DP, LIS) 직선으로 그으면 중간 칸의 숫자를 정확히 관통한다.
    function arrow(ctx, T, g, c0, sr, sc, tr, tc, used) {
      var cw = g.cw, ch = g.ch;
      function cxc(c) { return g.ox + (c - c0) * cw + cw / 2; }
      function cyc(r) { return g.oy + r * ch + ch / 2; }
      var clipped = 0;
      var sx = cxc(sc), sy = cyc(sr);
      if (sc < c0) { sx = g.ox - 7; clipped = -1; }
      else if (sc >= c0 + g.visCols) { sx = g.ox + g.visCols * cw + 7; clipped = 1; }
      var tx = cxc(tc), ty = cyc(tr);

      var p1, p2;
      var hw = Math.min(cw * 0.40, 13);
      var hh = Math.min(ch * 0.28, 9);
      if (model.kind === 'lis') {
        // 한 줄짜리 표라 셀 아래 띠에 활을 건다. 숫자를 전혀 건드리지 않는다.
        p1 = { x: sx, y: sy + ch / 2 - 2 };
        p2 = { x: tx, y: ty + ch / 2 - 2 };
      } else {
        // 셀 경계가 아니라 **숫자를 감싸는 상자**를 기준으로 시작·끝을 잡는다.
        // 경계 기준으로 잡으면 이웃한 두 칸은 변을 공유하므로 화살표 길이가 0 이
        // 되어 버린다(대각선 참조가 통째로 사라진다). 숫자만 피하면 화살표는
        // 셀 경계를 가로질러 "이 칸이 저 칸을 읽는다"가 그대로 보인다.
        // 도착 쪽 여유를 출발 쪽보다 좁게 잡는다. 이웃한 두 칸 사이는 남는 거리가
        // 얼마 없어서, 양쪽을 똑같이 띄우면 화살촉만 남고 방향이 안 읽힌다.
        // 도착 숫자는 halo 로 다시 덮어 그리므로 조금 파고들어도 가려지지 않는다.
        var hw = Math.min(cw * 0.40, 13);
        var hh = Math.min(ch * 0.28, 9);
        var dx = tx - sx, dy = ty - sy;
        p1 = clipped ? { x: sx, y: sy } : boxEdge(sx, sy, hw + 1.5, hh + 1.5, dx, dy);
        p2 = boxEdge(tx, ty, hw * 0.75 + 2, hh * 0.75 + 2, -dx, -dy);
      }

      var vx = p2.x - p1.x, vy = p2.y - p1.y;
      var len = Math.sqrt(vx * vx + vy * vy);
      if (len < 0.5) return;
      var bow;
      // 같은 행·열에서 멀리 떨어진 칸을 읽는 경우(구간 DP)는 사이에 낀 칸의 숫자를
      // 정면으로 지나간다. 그때만 활을 크게 휘어 숫자 상자 밖으로 빼낸다.
      // 2차 베지에의 최고점은 제어점 변위의 절반이므로 필요한 여유의 두 배를 준다.
      var sameRow = sr === tr, sameCol = sc === tc;
      var farInLine = (sameRow && len > cw * 1.4) || (sameCol && len > ch * 1.4);
      if (model.kind === 'lis') bow = Math.min(ch * 0.9, 12 + len * 0.10);
      else if (farInLine) bow = 2 * ((sameRow ? hh : hw) + 6);
      else bow = Math.min(ch * 0.42, len * 0.14);
      // 수직(-90도) 회전 벡터. 오른쪽 방향 화살표는 위로, 위쪽 방향은 왼쪽으로 휜다.
      var px = (vy / len) * bow, py = (-vx / len) * bow;
      if (model.kind === 'lis') { px = 0; py = bow; }
      var mx = (p1.x + p2.x) / 2 + px, my = (p1.y + p2.y) / 2 + py;

      ctx.save();
      ctx.strokeStyle = used ? T.wStart : T.fgDim;
      // 비교만 한 항의 화살표는 좁은 폭에서 아주 짧아진다. 너무 흐리면 아예 안 보여서
      // "두 항을 비교했다"는 사실 자체가 사라지므로 농도를 충분히 남긴다.
      ctx.globalAlpha = used ? 0.95 : 0.75;
      ctx.lineWidth = used ? 2 : 1.7;
      ctx.setLineDash(used ? [] : [3.5, 2.5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(mx, my, p2.x, p2.y);
      ctx.stroke();

      // 화살촉: 곡선의 끝 접선(= 제어점 → 끝점) 방향으로 붙인다
      var ax = p2.x - mx, ay = p2.y - my;
      var al = Math.sqrt(ax * ax + ay * ay) || 1;
      ax /= al; ay /= al;
      // 짧은 화살표에 큰 화살촉을 달면 촉만 남아 방향이 안 읽힌다. 길이에 맞춘다.
      var hs = Math.max(4.5, Math.min(used ? 7.5 : 6.5, len * 0.55));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - ax * hs - ay * hs * 0.5, p2.y - ay * hs + ax * hs * 0.5);
      ctx.lineTo(p2.x - ax * hs + ay * hs * 0.5, p2.y - ay * hs - ax * hs * 0.5);
      ctx.closePath();
      ctx.fillStyle = used ? T.wStart : T.fgDim;
      ctx.fill();

      // 창 밖의 칸에서 온 화살표는 어느 열에서 왔는지 글자로 남긴다
      if (clipped) {
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.font = '600 9px system-ui, sans-serif';
        ctx.fillStyle = T.fgFaint;
        ctx.textAlign = clipped < 0 ? 'right' : 'left';
        ctx.fillText('c' + sc, p1.x + (clipped < 0 ? -2 : 2), p1.y);
        ctx.textAlign = 'center';
      }
      ctx.restore();
    }

    var cv = K.canvas(ui.stage, { height: heightFor, draw: draw });

    var pl = K.player(ui, {
      total: function () { return model.steps.length; },
      render: function (i) { idx = i; cv.redraw(); },
      label: function (i) {
        var st = model.steps[Math.max(0, Math.min(i, model.steps.length - 1))];
        return st ? st.label : '';
      },
      speed: 520
    });

    // 검증(계약 §8)에서 최종 값과 역추적 결과를 브루트포스와 대조할 수 있게
    // 모델을 호스트 요소에 매달아 둔다. 전역은 건드리지 않는다.
    host._dpTable = model;

    pl.draw();
  }

  K.register('dp-table', widget);
})();
