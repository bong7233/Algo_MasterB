/* union-find.js — 경로 압축이 한 번의 조회로 트리를 납작하게 만든다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **경로 압축은 find 한 번이 지나간 모든 노드를 뿌리에 직접 매단다.**
 *   압축 없는 union-find는 union이 계속되면 사슬처럼 깊어질 수 있지만,
 *   경로 압축이 있으면 그 깊은 사슬을 find 한 번이 통째로 납작하게 편다.
 *
 * 왜 "압축 전/후"를 나란히 보여주는가
 *   압축의 효과는 트리 모양이 바뀌는 것 자체가 아니라 **다음 find부터
 *   전부 O(1)에 가까워진다는 것**이다. 그 전과 후의 트리를 같은 화면에
 *   놓고 비교해야 "왜 아무 조작도 안 했는데 다음 조회가 빨라지는가"가
 *   손에 잡힌다.
 *
 * ── opts (챕터가 넘기는 것. 이 주석이 명세다) ────────────────────────────────
 *   n              : 원소 개수 (기본 8, 라벨은 0..n-1)
 *   ops            : [["union",a,b] | ["find",a], ...]
 *   strategy       : "rank" (기본, union-by-rank) | "size" (union-by-size) | "naive" (기준 없이 항상 a의 뿌리 아래 b를 붙임)
 *   pathCompression: true(기본) | false
 *   show           : ["forest","rankLabels","pathHighlight"] 중 원하는 것. 기본 전부
 */
(function () {
  'use strict';
  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  var MAX_N = 24, MAX_OPS = 40;

  function isArr(v) { return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string'; }
  function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.max(lo, Math.min(hi, n)); }
  function truthy(v, d) { return v === undefined || v === null ? d : !!v; }

  /* 표준 union-find. 압축·전략을 opts 로 갈아 끼운다.
   * find 는 압축 도중 방문한 경로를 스텝에 기록해 위젯이 "이 노드들이
   * 방금 뿌리에 직접 매달렸다"를 보여줄 수 있게 한다. */
  function run(n, ops, strategy, compress) {
    var parent = []; for (var i = 0; i < n; i++) parent.push(i);
    var rank = new Array(n).fill(0);
    var size = new Array(n).fill(1);

    var steps = [];
    function snap(kind, note, extra) {
      var s = { kind: kind, note: note, parent: parent.slice(), rank: rank.slice(), size: size.slice() };
      if (extra) for (var k in extra) s[k] = extra[k];
      steps.push(s);
    }
    snap('init', n + '개 원소, 전부 자기 자신이 뿌리. 전략: ' +
      (strategy === 'naive' ? '기준 없음' : strategy === 'size' ? 'union-by-size' : 'union-by-rank') +
      (compress ? ' + 경로 압축' : ' (경로 압축 없음)') + '.');

    function findPath(x) {
      var path = [];
      while (parent[x] !== x) { path.push(x); x = parent[x]; }
      path.push(x);   // 마지막은 뿌리
      return path;
    }

    function find(x, doCompress) {
      var path = findPath(x);
      var root = path[path.length - 1];
      if (doCompress && path.length > 2) {
        for (var i = 0; i < path.length - 1; i++) parent[path[i]] = root;
      }
      return { root: root, path: path };
    }

    ops.forEach(function (op) {
      if (op[0] === 'find') {
        var x = op[1];
        var beforePath = findPath(x);
        var r = find(x, compress);
        if (compress && beforePath.length > 2) {
          snap('find', 'find(' + x + ') — 뿌리 ' + r.root + '까지 경로 [' + beforePath.join(' → ') + ']를 밟았다. 압축 전.',
            { path: beforePath, root: r.root, phase: 'before' });
          snap('compress', 'find(' + x + ') 압축 — 경로의 모든 노드가 뿌리 ' + r.root + '에 직접 매달린다.',
            { path: beforePath, root: r.root, phase: 'after' });
        } else {
          snap('find', 'find(' + x + ') = ' + r.root + '. 경로 [' + beforePath.join(' → ') + '].',
            { path: beforePath, root: r.root, phase: 'after' });
        }
      } else {
        var a = op[1], b = op[2];
        var ra = find(a, compress).root, rb = find(b, compress).root;
        if (ra === rb) {
          snap('union-noop', 'union(' + a + ', ' + b + ') — 이미 같은 집합(뿌리 ' + ra + '). 아무 일도 안 한다.', { a: a, b: b });
          return;
        }
        var attachFrom, attachTo;
        if (strategy === 'naive') { attachFrom = rb; attachTo = ra; }
        else if (strategy === 'size') {
          if (size[ra] < size[rb]) { attachFrom = ra; attachTo = rb; } else { attachFrom = rb; attachTo = ra; }
        } else {
          if (rank[ra] < rank[rb]) { attachFrom = ra; attachTo = rb; }
          else if (rank[ra] > rank[rb]) { attachFrom = rb; attachTo = ra; }
          else { attachFrom = rb; attachTo = ra; rank[ra] += 1; }
        }
        parent[attachFrom] = attachTo;
        size[attachTo] += size[attachFrom];
        snap('union', 'union(' + a + ', ' + b + ') — 뿌리 ' + attachFrom + '을(를) 뿌리 ' + attachTo + ' 아래로 붙인다' +
          (strategy !== 'naive' ? '(더 ' + (strategy === 'size' ? '작은 트리' : '낮은 랭크') + ' 쪽이 붙는다)' : '') + '.',
          { a: a, b: b, from: attachFrom, to: attachTo });
      }
    });

    return { steps: steps };
  }

  K.register('union-find', function (host, opts) {
    var n = clampInt(opts.n, 2, MAX_N, 8);
    var strategy = ['rank', 'size', 'naive'].indexOf(opts.strategy) >= 0 ? opts.strategy : 'rank';
    var compress = truthy(opts.pathCompression, true);
    var show = isArr(opts.show) ? opts.show.map(String) : ['forest', 'rankLabels', 'pathHighlight'];
    var has = function (x) { return show.indexOf(x) >= 0; };

    var rawOps = isArr(opts.ops) ? opts.ops : [];
    var ops = [];
    for (var i = 0; i < rawOps.length && ops.length < MAX_OPS; i++) {
      var o = rawOps[i];
      if (!isArr(o) || !o.length) continue;
      if (o[0] === 'find' && o.length >= 2) {
        var x = clampInt(o[1], 0, n - 1, 0);
        ops.push(['find', x]);
      } else if (o[0] === 'union' && o.length >= 3) {
        var a = clampInt(o[1], 0, n - 1, 0), b = clampInt(o[2], 0, n - 1, 0);
        ops.push(['union', a, b]);
      }
    }
    if (!ops.length) ops = [['union', 0, 1], ['union', 2, 3], ['union', 1, 2]];

    var data = run(n, ops, strategy, compress);
    var ui = K.frame(host, { title: '유니온 파인드 — 경로 압축이 사슬을 납작하게 편다' });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['뿌리', T.wGoal], ['방금 압축된 경로', T.accent], ['방문 경로', T.wPath]];
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
        var cs = [T2.wGoal, T2.accent, T2.wPath];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (nn, k) { nn.style.background = cs[k]; });
      });
    })();

    var PAD = 12, LEVEL_H = 56, NODE_R = 15;

    // 트리 레이아웃: 뿌리를 기준으로 자식들을 가로로 펼친다.
    function buildForest(parent) {
      var children = {}; for (var i = 0; i < n; i++) children[i] = [];
      var roots = [];
      for (var v = 0; v < n; v++) { if (parent[v] === v) roots.push(v); else children[parent[v]].push(v); }
      return { children: children, roots: roots };
    }
    function subtreeWidth(v, children) {
      if (!children[v].length) return 1;
      return children[v].reduce(function (s, c) { return s + subtreeWidth(c, children); }, 0);
    }
    function depthOf(v, children) {
      if (!children[v].length) return 1;
      return 1 + Math.max.apply(null, children[v].map(function (c) { return depthOf(c, children); }));
    }

    function layout(w) {
      var f = buildForest(data.steps[play ? play.index() : 0].parent);
      var totalW = f.roots.reduce(function (s, r) { return s + subtreeWidth(r, f.children); }, 0);
      var maxDepth = Math.max.apply(null, f.roots.map(function (r) { return depthOf(r, f.children); }).concat([1]));
      var cellW = Math.max(40, Math.min(70, (w - PAD * 2) / Math.max(1, totalW)));
      return { forest: f, totalW: totalW, cellW: cellW, height: PAD + maxDepth * LEVEL_H + 40 + PAD };
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = data.steps[Math.min(i, data.steps.length - 1)];
      var f = buildForest(st.parent);

      var pathSet = {};
      (st.path || []).forEach(function (v) { pathSet[v] = true; });

      var pos = {};
      var x0 = PAD;
      f.roots.forEach(function (r) {
        var w = subtreeWidth(r, f.children) * l.cellW;
        (function place(v, cx, depth) {
          pos[v] = { x: cx, y: PAD + depth * LEVEL_H + 20 };
          var kids = f.children[v];
          if (!kids.length) return;
          var kw = kids.reduce(function (s, c) { return s + subtreeWidth(c, f.children); }, 0) * l.cellW;
          var kx = cx - kw / 2;
          kids.forEach(function (c) {
            var cw = subtreeWidth(c, f.children) * l.cellW;
            place(c, kx + cw / 2, depth + 1);
            kx += cw;
          });
        })(r, x0 + w / 2, 0);
        x0 += w;
      });

      ctx.save();
      // 간선
      for (var v = 0; v < n; v++) {
        if (st.parent[v] === v) continue;
        var p1 = pos[v], p2 = pos[st.parent[v]];
        if (!p1 || !p2) continue;
        var isCompressed = st.kind === 'compress' && pathSet[v] && v !== st.root;
        ctx.strokeStyle = isCompressed ? T.accent : T.border;
        ctx.lineWidth = isCompressed ? 2 : 1.2;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y - NODE_R); ctx.lineTo(p2.x, p2.y + NODE_R); ctx.stroke();
      }
      // 노드
      for (var vv = 0; vv < n; vv++) {
        var p = pos[vv];
        if (!p) continue;
        var isRoot = st.parent[vv] === vv;
        var onPath = pathSet[vv];
        var fill = T.bgElev, stroke = T.border, textCol = T.fg;
        if (isRoot) { fill = T.wGoal; textCol = T.bg; stroke = T.wGoal; }
        if (onPath && st.kind === 'find') { stroke = T.wPath; }
        if (onPath && st.kind === 'compress') { fill = isRoot ? T.wGoal : T.accent; textCol = T.bg; stroke = T.accent; }
        ctx.beginPath(); ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = (onPath || isRoot) ? 2 : 1; ctx.stroke();
        ctx.fillStyle = textCol; ctx.font = '600 12px ' + MONO;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(vv), p.x, p.y);
        if (has('rankLabels') && strategy !== 'naive') {
          var lbl = strategy === 'size' ? 's' + st.size[vv] : 'r' + st.rank[vv];
          ctx.font = '9px ' + MONO; ctx.fillStyle = T.fgFaint;
          ctx.fillText(lbl, p.x, p.y + NODE_R + 10);
        }
      }
      ctx.restore();

      var yEnd = PAD + Math.max.apply(null, Object.keys(pos).map(function (k) { return pos[k].y; }).concat([PAD])) + NODE_R + 24;
      ctx.save();
      ctx.font = '11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = st.kind === 'compress' ? T.accent : T.fgDim;
      var lines = wrapText(ctx, st.note, size.w - PAD * 2);
      lines.forEach(function (t, idx) { ctx.fillText(t, PAD, yEnd + idx * 15); });
      ctx.restore();
    }

    function wrapText(ctx, text, maxW) {
      var words = text.split(' '), lines = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var t = cur ? cur + ' ' + words[i] : words[i];
        if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
      }
      if (cur) lines.push(cur);
      return lines;
    }

    var cv = K.canvas(ui.stage, { height: function (w) { return layout(w).height; }, draw: draw });
    var play = K.player(ui, {
      total: function () { return data.steps.length; },
      render: function () { cv.redraw(); },
      label: function (i) { return data.steps[Math.min(i, data.steps.length - 1)].note || ''; }
    });
    play.draw();

    host.__widget = {
      root: function (x) { var st = data.steps[data.steps.length - 1]; var p = x; while (st.parent[p] !== p) p = st.parent[p]; return p; },
      connected: function (a, b) { var w = this; return w.root(a) === w.root(b); },
      steps: function () { return data.steps.length; },
      goto: function (i) { play.goto(i); },
      finalParent: function () { return data.steps[data.steps.length - 1].parent.slice(); }
    };
  });
})();
