/* kdtree-nn.js — 원이 분할선에 닿지 않으면 그 너머는 안 본다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **가지치기의 근거는 기하 하나다 — 질의점에서 분할선까지의 거리가 현재 최선
 *   거리보다 멀면, 그 선 너머에는 더 가까운 점이 있을 수 없다.**
 *   원이 선에 닿지 않는 그림이 곧 "이 가지는 안 본다"는 증명이다.
 *
 * 그래서 이 위젯의 중심은 트리 그림이 아니라 **원과 분할선의 관계**다.
 *   트리를 예쁘게 그리는 것은 쉽지만, 독자가 실제로 못 하는 것은
 *   "왜 저 가지를 안 봐도 되는가"를 말하는 일이다. 원이 선을 넘는 순간과
 *   넘지 않는 순간을 같은 화면에서 보여야 그 판정이 손에 잡힌다.
 *
 * 왜 카운터에 전수 비교를 나란히 두는가
 *   방문 노드 수만 보면 "빠르다"가 느낌으로 남는다. 전수 비교의 n 과 나란히
 *   세어야 이득이 수치가 된다. 그리고 **차원이 오르면 이 비율이 1에 수렴한다** —
 *   그 사실을 같은 카운터로 확인할 수 있어야 차원의 저주가 경고문이 아니라 관측이 된다.
 *
 * 왜 질의점 쪽으로 먼저 내려가는 것을 스텝으로 보이는가
 *   순서를 바꿔도 답은 맞는다. 틀리는 것은 속도다 — 좋은 후보를 늦게 잡으면
 *   원이 늦게 줄어들고 가지치기가 거의 안 먹힌다. **정확성이 아니라 속도가
 *   순서에 달려 있다**는 것이 이 알고리즘에서 가장 자주 오해되는 지점이라
 *   탭으로 뒤집어 볼 수 있게 뒀다.
 *
 * ── opts (챕터가 넘기는 것. 이 주석이 명세다) ────────────────────────────────
 *   points     : [[x,y], ...] 2~64개. 기본 7개 예제
 *   query      : [x,y] 질의점. 기본 [7,7]
 *   extent     : [xmin,xmax,ymin,ymax] 평면 범위. 생략하면 점에서 자동 산출
 *   split      : "median" (기본). 축 중앙값으로 가른다
 *   axisOrder  : "round-robin" (기본) — 깊이마다 x,y 를 번갈아 쓴다
 *   order      : "near-first" (기본) | "far-first" — 어느 쪽으로 먼저 내려갈 것인가.
 *                둘 다 정답을 내지만 가지치기 효율이 갈린다. 탭으로 제공된다
 *   show       : ["partition","tree","radius","counters"] 중 원하는 것. 기본 전부
 *   counters   : ["visited","pruned","bruteforce"] 중 원하는 것. 기본 전부
 *   highlightPrune   : true(기본) — 잘라 낸 가지를 회색으로 죽인다
 *   compareBruteforce: true(기본) — 전수 비교의 답과 대조해 일치를 표시한다
 *   dim        : 2 만 지원한다. 다른 값을 넘기면 2 로 두고 제목에 적는다
 *
 * 넘긴 값이 무엇이든 던지지 않는다(계약 §1). 범위를 벗어나면 잘라 쓰고 제목에 밝힌다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  var MAX_PTS = 64;
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  var DFLT_PTS = [[2, 3], [5, 4], [9, 6], [4, 7], [8, 1], [7, 2], [6, 9]];

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function num(v, d) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function toPoints(v) {
    if (!isArr(v)) return DFLT_PTS.map(function (p) { return p.slice(); });
    var out = [];
    for (var i = 0; i < v.length && out.length < MAX_PTS; i++) {
      var p = v[i];
      if (!isArr(p) || p.length < 2) continue;
      var x = num(p[0], NaN), y = num(p[1], NaN);
      if (isFinite(x) && isFinite(y)) out.push([x, y]);
    }
    return out.length >= 2 ? out : DFLT_PTS.map(function (p) { return p.slice(); });
  }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dist2(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
  }

  // ─── 트리 만들기 ─────────────────────────────────────────────────────────
  //
  // 중앙값으로 가르므로 뭉친 곳은 잘게, 빈 곳은 성기게 잘린다.
  // 셀 크기를 미리 정하는 그리드와 갈리는 지점이 정확히 여기다.

  function build(pts, depth, box) {
    if (!pts.length) return null;
    var axis = depth % 2;
    var sorted = pts.slice().sort(function (a, b) { return a[axis] - b[axis]; });
    var mid = Math.floor(sorted.length / 2);
    var node = {
      point: sorted[mid], axis: axis, depth: depth, box: box,
      left: null, right: null, id: null
    };
    var lo = box.slice(), hi = box.slice();
    if (axis === 0) { lo[1] = sorted[mid][0]; hi[0] = sorted[mid][0]; }
    else { lo[3] = sorted[mid][1]; hi[2] = sorted[mid][1]; }
    node.left = build(sorted.slice(0, mid), depth + 1, lo);
    node.right = build(sorted.slice(mid + 1), depth + 1, hi);
    return node;
  }

  function numberNodes(root) {
    var n = 0;
    (function walk(t) {
      if (!t) return;
      t.id = n++;
      walk(t.left); walk(t.right);
    })(root);
    return n;
  }

  /* 최근접 탐색을 스텝 목록으로 편다.
   * 각 스텝은 그리기에 필요한 것을 전부 담는다 — 그리는 쪽에서 계산하지 않아야
   * 되감기가 결정적이다(런타임 주석). */
  function search(root, q, nearFirst, total) {
    var steps = [];
    var best = null, bestD2 = Infinity;
    var visited = 0, pruned = 0;
    var deadSet = {};        // 잘라 낸 서브트리의 노드 id

    function killSubtree(t) {
      if (!t) return;
      deadSet[t.id] = true;
      killSubtree(t.left); killSubtree(t.right);
    }

    function snap(kind, node, note, extra) {
      var s = {
        kind: kind, nodeId: node ? node.id : null,
        best: best ? best.slice() : null, bestD2: bestD2,
        visited: visited, pruned: pruned,
        dead: Object.keys(deadSet).map(Number),
        note: note
      };
      if (extra) for (var k in extra) s[k] = extra[k];
      steps.push(s);
    }

    function go(t) {
      if (!t) return;
      visited += 1;
      var d2 = dist2(t.point, q);
      var improved = d2 < bestD2;
      if (improved) { best = t.point; bestD2 = d2; }
      snap('visit', t,
        '노드 (' + t.point[0] + ', ' + t.point[1] + ') 방문. 거리 ' + Math.sqrt(d2).toFixed(2) +
        (improved ? ' — 최선이 갱신됐다. 원이 줄었다.' : ' — 최선보다 멀다. 원은 그대로.'),
        { improved: improved, curD2: d2 });

      var delta = q[t.axis] - t.point[t.axis];
      var nearSide = delta < 0 ? t.left : t.right;
      var farSide = delta < 0 ? t.right : t.left;
      var first = nearFirst ? nearSide : farSide;
      var second = nearFirst ? farSide : nearSide;

      go(first);

      // 가지치기 판정 — 이 위젯의 본문이다.
      var planeD2 = delta * delta;
      if (second) {
        if (planeD2 < bestD2) {
          snap('cross', t,
            '분할선까지 ' + Math.abs(delta).toFixed(2) + ' < 최선 ' + Math.sqrt(bestD2).toFixed(2) +
            ' — 원이 선을 넘었다. 반대쪽도 봐야 한다.',
            { axis: t.axis, planeAt: t.point[t.axis] });
          go(second);
        } else {
          var cnt = 0;
          (function count(x) { if (!x) return; cnt++; count(x.left); count(x.right); })(second);
          pruned += cnt;
          killSubtree(second);
          snap('prune', t,
            '분할선까지 ' + Math.abs(delta).toFixed(2) + ' ≥ 최선 ' + Math.sqrt(bestD2).toFixed(2) +
            ' — 원이 선에 닿지 않는다. 저 너머에는 더 가까운 점이 없다. 노드 ' + cnt + '개를 통째로 건너뛴다.',
            { axis: t.axis, planeAt: t.point[t.axis], prunedNow: cnt });
        }
      }
    }

    snap('init', null, '질의점에서 시작한다. 아직 최선이 없어 원은 무한대다.');
    go(root);
    snap('done', null,
      '최근접 (' + best[0] + ', ' + best[1] + '), 거리 ' + Math.sqrt(bestD2).toFixed(2) +
      '. 방문 ' + visited + ' / 전수 비교 ' + total + ', 건너뛴 노드 ' + pruned + '.');
    return { steps: steps, best: best, bestD2: bestD2, visited: visited, pruned: pruned };
  }

  function bruteforce(pts, q) {
    var best = null, bd = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var d = dist2(pts[i], q);
      if (d < bd) { bd = d; best = pts[i]; }
    }
    return { best: best, d2: bd };
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('kdtree-nn', function (host, opts) {
    var pts = toPoints(opts.points);
    var q = isArr(opts.query) && opts.query.length >= 2
      ? [num(opts.query[0], 7), num(opts.query[1], 7)] : [7, 7];

    var ext;
    if (isArr(opts.extent) && opts.extent.length >= 4) {
      ext = [num(opts.extent[0], 0), num(opts.extent[1], 10), num(opts.extent[2], 0), num(opts.extent[3], 10)];
    } else {
      var xs = pts.map(function (p) { return p[0]; }).concat([q[0]]);
      var ys = pts.map(function (p) { return p[1]; }).concat([q[1]]);
      ext = [Math.min.apply(null, xs) - 1, Math.max.apply(null, xs) + 1,
             Math.min.apply(null, ys) - 1, Math.max.apply(null, ys) + 1];
    }
    if (ext[1] <= ext[0]) ext[1] = ext[0] + 1;
    if (ext[3] <= ext[2]) ext[3] = ext[2] + 1;

    var showList = isArr(opts.show) ? opts.show.map(String) : ['partition', 'tree', 'radius', 'counters'];
    var has = function (k) { return showList.indexOf(k) >= 0; };
    var cntList = isArr(opts.counters) ? opts.counters.map(String) : ['visited', 'pruned', 'bruteforce'];
    var hasCnt = function (k) { return cntList.indexOf(k) >= 0; };
    var wantPrune = opts.highlightPrune !== false;
    var wantBrute = opts.compareBruteforce !== false;

    var order = String(opts.order || 'near-first') === 'far-first' ? 'far-first' : 'near-first';

    var root = build(pts, 0, ext.slice());
    var nNodes = numberNodes(root);
    var bf = bruteforce(pts, q);

    var run = null, play = null;
    function rebuild() { run = search(root, q, order === 'near-first', pts.length); }
    rebuild();

    var title = 'KD 트리 최근접 탐색 — 원이 분할선에 닿지 않으면 그 너머는 안 본다';
    var notes = [];
    if (isArr(opts.points) && opts.points.length > pts.length) {
      notes.push('점이 많아 앞 ' + pts.length + '개만 그린다 (넘긴 것은 ' + opts.points.length + '개)');
    }
    if (opts.dim != null && num(opts.dim, 2) !== 2) {
      notes.push('이 위젯은 2차원만 그린다 (넘긴 dim=' + opts.dim + ')');
    }
    if (notes.length) title += '  ·  ' + notes.join(', ');

    var ui = K.frame(host, { title: title });

    // 순서를 바꿔도 답은 맞는다. 갈리는 것은 가지치기 효율이다 —
    // 그 사실이 탭 하나로 확인돼야 "정확성이 아니라 속도가 순서에 달렸다"가 전달된다.
    K.seg(ui.slot, [
      { label: '가까운 쪽 먼저', value: 'near-first' },
      { label: '먼 쪽 먼저', value: 'far-first' }
    ], order, function (v) { order = v; rebuild(); play.goto(0); });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['방문', T.wVisited], ['현재 최선', T.wPath], ['잘라 냄', T.fgFaint], ['질의점', T.wGoal]];
      var el = K.el('div', 'wk-legend');
      items.forEach(function (it) {
        var sp = K.el('span'), ic = K.el('i');
        ic.style.background = it[1];
        sp.appendChild(ic); sp.appendChild(document.createTextNode(it[0]));
        el.appendChild(sp);
      });
      ui.slot.appendChild(el);
      K.onThemeChange(function () {
        var T2 = K.tokens(ui.stage);
        var cs = [T2.wVisited, T2.wPath, T2.fgFaint, T2.wGoal];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (n, k) { n.style.background = cs[k]; });
      });
    })();

    // ── 레이아웃 ───────────────────────────────────────────────────────────

    var PAD = 12;

    function treeDepth(t) { return t ? 1 + Math.max(treeDepth(t.left), treeDepth(t.right)) : 0; }
    var depth = treeDepth(root);

    function layout(w) {
      var inner = Math.max(200, w - PAD * 2);
      // 좁으면 평면 위, 트리 아래로 쌓는다. 나란히 두면 둘 다 못 읽는 폭이 된다.
      var stacked = inner < 620 || !has('tree') || !has('partition');
      var planeW = stacked ? inner : Math.round(inner * 0.52);
      var treeW = stacked ? inner : inner - planeW - 16;
      var planeH = Math.max(180, Math.min(320, planeW));
      var treeH = Math.max(120, depth * 46 + 20);
      return {
        inner: inner, stacked: stacked,
        planeW: planeW, planeH: planeH,
        treeW: treeW, treeH: treeH,
        cntH: has('counters') ? 34 : 0,
        noteH: 34,
        height: PAD + (stacked
          ? (has('partition') ? planeH + 12 : 0) + (has('tree') ? treeH + 12 : 0)
          : Math.max(has('partition') ? planeH : 0, has('tree') ? treeH : 0) + 12)
          + (has('counters') ? 34 : 0) + 34 + PAD
      };
    }

    // ── 그리기 ─────────────────────────────────────────────────────────────

    function drawPlane(ctx, T, l, st, x0, y0) {
      var W = l.planeW, H = l.planeH;
      var sx = function (v) { return x0 + (v - ext[0]) / (ext[1] - ext[0]) * W; };
      var sy = function (v) { return y0 + H - (v - ext[2]) / (ext[3] - ext[2]) * H; };

      ctx.save();
      rrect(ctx, x0, y0, W, H, 4);
      ctx.fillStyle = T.bgElev;
      ctx.fill();
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      rrect(ctx, x0, y0, W, H, 4);
      ctx.clip();

      // 분할선 — 죽은 가지의 선은 흐리게
      (function lines(t) {
        if (!t) return;
        var dead = wantPrune && st.dead.indexOf(t.id) >= 0;
        ctx.strokeStyle = dead ? T.bgCode : T.border;
        ctx.lineWidth = dead ? 1 : 1.5;
        ctx.beginPath();
        if (t.axis === 0) { ctx.moveTo(sx(t.point[0]), sy(t.box[2])); ctx.lineTo(sx(t.point[0]), sy(t.box[3])); }
        else { ctx.moveTo(sx(t.box[0]), sy(t.point[1])); ctx.lineTo(sx(t.box[1]), sy(t.point[1])); }
        ctx.stroke();
        lines(t.left); lines(t.right);
      })(root);

      // 현재 최선 거리를 반지름으로 하는 원 — 이 위젯의 본문
      if (has('radius') && st.best && isFinite(st.bestD2)) {
        var r = Math.sqrt(st.bestD2) / (ext[1] - ext[0]) * W;
        ctx.beginPath();
        ctx.arc(sx(q[0]), sy(q[1]), r, 0, Math.PI * 2);
        ctx.strokeStyle = T.wPath;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = T.wPath;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 판정 중인 분할선을 굵게
      if ((st.kind === 'prune' || st.kind === 'cross') && st.planeAt != null) {
        ctx.strokeStyle = st.kind === 'prune' ? T.boxDanger : T.accent;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (st.axis === 0) { ctx.moveTo(sx(st.planeAt), y0); ctx.lineTo(sx(st.planeAt), y0 + H); }
        else { ctx.moveTo(x0, sy(st.planeAt)); ctx.lineTo(x0 + W, sy(st.planeAt)); }
        ctx.stroke();
      }
      ctx.restore();

      // 점
      (function dots(t) {
        if (!t) return;
        var dead = wantPrune && st.dead.indexOf(t.id) >= 0;
        var isCur = st.nodeId === t.id;
        var isBest = st.best && t.point[0] === st.best[0] && t.point[1] === st.best[1];
        var col = dead ? T.fgFaint : (isBest ? T.wPath : (isCur ? T.accent : T.wVisited));
        ctx.beginPath();
        ctx.arc(sx(t.point[0]), sy(t.point[1]), isCur || isBest ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = dead ? 0.4 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        dots(t.left); dots(t.right);
      })(root);

      // 질의점 — 십자로 그려 점과 구분한다(색만으로 나르지 않는다)
      ctx.strokeStyle = T.wGoal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx(q[0]) - 6, sy(q[1])); ctx.lineTo(sx(q[0]) + 6, sy(q[1]));
      ctx.moveTo(sx(q[0]), sy(q[1]) - 6); ctx.lineTo(sx(q[0]), sy(q[1]) + 6);
      ctx.stroke();
      ctx.restore();
    }

    function drawTree(ctx, T, l, st, x0, y0) {
      var W = l.treeW;
      var levelH = Math.min(46, (l.treeH - 20) / Math.max(1, depth - 1) || 46);

      // 각 노드의 x 는 중위 순회 순번으로 정한다 — 가로로 고르게 퍼진다.
      var order = [], idx = 0;
      (function inorder(t) {
        if (!t) return;
        inorder(t.left);
        order.push(t); t._ix = idx++;
        inorder(t.right);
      })(root);
      var n = Math.max(1, order.length);

      function px(t) { return x0 + 14 + (t._ix + 0.5) / n * (W - 28); }
      function py(t) { return y0 + 14 + t.depth * levelH; }

      ctx.save();
      (function edges(t) {
        if (!t) return;
        [t.left, t.right].forEach(function (c) {
          if (!c) return;
          var dead = wantPrune && st.dead.indexOf(c.id) >= 0;
          ctx.strokeStyle = dead ? T.bgCode : T.border;
          ctx.lineWidth = dead ? 1 : 1.5;
          ctx.beginPath();
          ctx.moveTo(px(t), py(t)); ctx.lineTo(px(c), py(c));
          ctx.stroke();
          edges(c);
        });
      })(root);

      order.forEach(function (t) {
        var dead = wantPrune && st.dead.indexOf(t.id) >= 0;
        var isCur = st.nodeId === t.id;
        var isBest = st.best && t.point[0] === st.best[0] && t.point[1] === st.best[1];
        var col = dead ? T.bgElev : (isBest ? T.wPath : (isCur ? T.accent : T.wVisited));
        ctx.beginPath();
        ctx.arc(px(t), py(t), isCur ? 9 : 7, 0, Math.PI * 2);
        ctx.globalAlpha = dead ? 0.45 : 1;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = dead ? T.border : (isCur ? T.accent : T.border);
        ctx.lineWidth = 1;
        ctx.stroke();
        // 축을 글자로도 적는다 — 색만으로는 x 분할인지 y 분할인지 알 수 없다
        ctx.fillStyle = dead ? T.fgFaint : T.bg;
        ctx.font = '600 9px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.axis === 0 ? 'x' : 'y', px(t), py(t));
      });
      ctx.restore();
    }

    function drawCounters(ctx, T, l, st, y) {
      var items = [];
      if (hasCnt('visited')) items.push(['방문', st.visited, T.fg]);
      if (hasCnt('bruteforce')) items.push(['전수 비교', pts.length, T.fgDim]);
      if (hasCnt('pruned')) items.push(['건너뜀', st.pruned, st.pruned > 0 ? T.wPath : T.fgFaint]);
      ctx.save();
      var x = PAD;
      items.forEach(function (it) {
        ctx.font = '11px ' + FONT;
        ctx.fillStyle = T.fgFaint;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(it[0], x, y + 10);
        var lw = ctx.measureText(it[0]).width;
        ctx.font = '600 14px ' + MONO;
        ctx.fillStyle = it[2];
        ctx.fillText(String(it[1]), x + lw + 6, y + 10);
        x += lw + 6 + ctx.measureText(String(it[1])).width + 20;
      });
      ctx.restore();
      return y + 34;
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = run.steps[Math.min(i, run.steps.length - 1)];
      var y = PAD;

      if (l.stacked) {
        if (has('partition')) { drawPlane(ctx, T, l, st, PAD, y); y += l.planeH + 12; }
        if (has('tree')) { drawTree(ctx, T, l, st, PAD, y); y += l.treeH + 12; }
      } else {
        if (has('partition')) drawPlane(ctx, T, l, st, PAD, y);
        if (has('tree')) drawTree(ctx, T, l, st, PAD + l.planeW + 16, y);
        y += Math.max(l.planeH, l.treeH) + 12;
      }

      if (has('counters')) y = drawCounters(ctx, T, l, st, y);

      ctx.save();
      ctx.font = '600 12px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (st.kind === 'done') {
        // 동점일 때 좌표가 다를 수 있다 — 거리로 대조해야 한다. 좌표로 비교하면
      // 같은 거리의 다른 점을 골랐을 때 맞는 답을 틀렸다고 보고하게 된다.
      var agree = wantBrute && Math.abs(run.bestD2 - bf.d2) < 1e-9;
        ctx.fillStyle = agree || !wantBrute ? T.wPath : T.boxDanger;
        ctx.fillText('최근접 (' + run.best[0] + ', ' + run.best[1] + ')' +
          (wantBrute ? (agree ? '  ·  전수 비교와 일치' : '  ·  전수 비교와 불일치') : '') +
          '  ·  방문 ' + run.visited + ' / ' + pts.length, PAD, y);
      } else if (st.kind === 'prune') {
        ctx.fillStyle = T.wPath;
        ctx.fillText('가지치기 — 원이 선에 닿지 않는다', PAD, y);
      } else if (st.kind === 'cross') {
        ctx.fillStyle = T.accent;
        ctx.fillText('원이 선을 넘었다 — 반대쪽도 봐야 한다', PAD, y);
      } else {
        ctx.fillStyle = T.fgDim;
        ctx.fillText(order === 'near-first'
          ? '질의점 쪽으로 먼저 내려간다 — 좋은 후보를 빨리 잡아야 원이 작아진다'
          : '먼 쪽으로 먼저 내려간다 — 답은 같지만 원이 늦게 줄어 가지치기가 덜 먹힌다', PAD, y);
      }
      ctx.restore();
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) { return layout(w).height; },
      draw: draw
    });

    play = K.player(ui, {
      total: function () { return run.steps.length; },
      render: function () { cv.redraw(); },
      label: function (i) { return run.steps[Math.min(i, run.steps.length - 1)].note; }
    });
    play.draw();

    host.__widget = {
      result: function () {
        return { best: run.best.slice(), dist: Math.sqrt(run.bestD2),
                 visited: run.visited, pruned: run.pruned, total: pts.length };
      },
      bruteforce: function () { return { best: bf.best.slice(), dist: Math.sqrt(bf.d2) }; },
      agrees: function () { return Math.abs(run.bestD2 - bf.d2) < 1e-9; },
      order: function () { return order; },
      setOrder: function (v) {
        order = (v === 'far-first') ? 'far-first' : 'near-first';
        rebuild(); play.goto(0);
      },
      nodes: function () { return nNodes; },
      steps: function () { return run.steps.length; },
      goto: function (i) { play.goto(i); }
    };
  });
})();
