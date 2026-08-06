/* segment-tree.js — 구간 하나가 O(log n)개의 완결된 조각으로 갈라진다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   임의의 구간 질의는 트리를 전부 훑지 않는다. **그 구간을 정확히 덮는
 *   O(log n)개의 노드로 쪼개고, 그 노드들만 합친다.** 어느 노드가 "완전히
 *   덮여서 더 안 내려가도 되는가"를 판정하는 것이 이 알고리즘의 전부다.
 *
 * 왜 lazy 플래그를 노드 위에 직접 찍는가
 *   구간 갱신을 매번 리프까지 내려가며 적용하면 O(n)이 된다. lazy
 *   propagation은 "이 노드 아래는 전부 갱신됐지만 아직 안 내려보냈다"는
 *   빚을 노드에 남겨 두고 필요할 때만 자식에게 미룬다. 그 빚이 있는
 *   노드를 색으로 표시해야 "왜 다음 질의가 그 빚을 먼저 갚는가"가 보인다.
 *
 * ── opts (챕터가 넘기는 것. 이 주석이 명세다) ────────────────────────────────
 *   array : 초기 배열 (기본 [5,2,8,1,9,3,7,4])
 *   op    : "sum"(기본) | "min" | "max"
 *   ops   : [["query",l,r] | ["update",idx,val] | ["rangeUpdate",l,r,delta], ...]
 *           인덱스는 0-based, r은 포함(inclusive).
 *   lazy  : true(기본) — rangeUpdate 를 lazy propagation 으로 처리
 *   show  : ["tree","decomposition","lazyFlags"] 중 원하는 것. 기본 전부
 */
(function () {
  'use strict';
  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  var MAX_N = 16, MAX_OPS = 30;

  function isArr(v) { return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string'; }
  function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.max(lo, Math.min(hi, n)); }
  function truthy(v, d) { return v === undefined || v === null ? d : !!v; }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  var OPS = {
    sum: { combine: function (a, b) { return a + b; }, identity: 0, applyDelta: function (v, d, len) { return v + d * len; } },
    min: { combine: Math.min, identity: Infinity, applyDelta: function (v, d) { return v + d; } },
    max: { combine: Math.max, identity: -Infinity, applyDelta: function (v, d) { return v + d; } }
  };

  /* 배열 기반 세그먼트 트리. node 1이 뿌리, node*2/node*2+1 이 자식.
   * 각 노드는 [lo,hi] 구간을 덮는다. lazy[node] 는 "아래로 아직 안 내려보낸 델타". */
  function SegTree(arr, opName) {
    this.n = arr.length;
    this.op = OPS[opName];
    var size = 1; while (size < this.n) size *= 2; size *= 4;
    this.tree = new Array(size).fill(this.op.identity);
    this.lazy = new Array(size).fill(0);
    this.lo = new Array(size).fill(0);
    this.hi = new Array(size).fill(0);
    this.build(1, 0, this.n - 1, arr);
  }
  SegTree.prototype.build = function (node, lo, hi, arr) {
    this.lo[node] = lo; this.hi[node] = hi;
    if (lo === hi) { this.tree[node] = arr[lo]; return; }
    var mid = (lo + hi) >> 1;
    this.build(node * 2, lo, mid, arr);
    this.build(node * 2 + 1, mid + 1, hi, arr);
    this.tree[node] = this.op.combine(this.tree[node * 2], this.tree[node * 2 + 1]);
  };
  SegTree.prototype.push = function (node) {
    if (this.lazy[node] === 0) return;
    var self = this;
    [node * 2, node * 2 + 1].forEach(function (c) {
      self.tree[c] = self.op.applyDelta(self.tree[c], self.lazy[node], self.hi[c] - self.lo[c] + 1);
      self.lazy[c] += self.lazy[node];
    });
    this.lazy[node] = 0;
  };

  function buildSnap(steps, tree, kind, note, extra) {
    var s = {
      kind: kind, note: note,
      values: tree.tree.slice(0, tree.n * 4 + 4),
      lazy: tree.lazy.slice(0, tree.n * 4 + 4)
    };
    if (extra) for (var k in extra) s[k] = extra[k];
    steps.push(s);
  }

  function run(arr, opName, ops, useLazy) {
    var tree = new SegTree(arr, opName);
    var steps = [];
    buildSnap(steps, tree, 'init', '배열 [' + arr.join(', ') + ']로 트리를 만든다. 연산: ' + opName + '.');

    function queryVisit(node, l, r, visited) {
      if (tree.hi[node] < l || r < tree.lo[node]) { return tree.op.identity; }
      if (l <= tree.lo[node] && tree.hi[node] <= r) { visited.push({ node: node, full: true }); return tree.tree[node]; }
      if (useLazy) tree.push(node);
      visited.push({ node: node, full: false });
      return tree.op.combine(queryVisit(node * 2, l, r, visited), queryVisit(node * 2 + 1, l, r, visited));
    }

    function pointUpdate(node, idx, val) {
      if (tree.lo[node] === tree.hi[node]) { tree.tree[node] = val; return; }
      if (useLazy) tree.push(node);
      var mid = (tree.lo[node] + tree.hi[node]) >> 1;
      if (idx <= mid) pointUpdate(node * 2, idx, val); else pointUpdate(node * 2 + 1, idx, val);
      tree.tree[node] = tree.op.combine(tree.tree[node * 2], tree.tree[node * 2 + 1]);
    }

    function rangeUpdate(node, l, r, delta, visited) {
      if (tree.hi[node] < l || r < tree.lo[node]) return;
      if (l <= tree.lo[node] && tree.hi[node] <= r) {
        tree.tree[node] = tree.op.applyDelta(tree.tree[node], delta, tree.hi[node] - tree.lo[node] + 1);
        tree.lazy[node] += delta;
        visited.push({ node: node, full: true });
        return;
      }
      tree.push(node);
      visited.push({ node: node, full: false });
      var mid = (tree.lo[node] + tree.hi[node]) >> 1;
      rangeUpdate(node * 2, l, r, delta, visited);
      rangeUpdate(node * 2 + 1, l, r, delta, visited);
      tree.tree[node] = tree.op.combine(tree.tree[node * 2], tree.tree[node * 2 + 1]);
    }

    ops.forEach(function (op) {
      if (op[0] === 'query') {
        var l = op[1], r = op[2], visited = [];
        var result = queryVisit(1, l, r, visited);
        var fullNodes = visited.filter(function (v) { return v.full; });
        buildSnap(steps, tree, 'query',
          'query(' + l + ', ' + r + ') = ' + result + ' — 완전히 덮인 노드 ' + fullNodes.length + '개로 분해됐다: ' +
          fullNodes.map(function (v) { return '[' + tree.lo[v.node] + ',' + tree.hi[v.node] + ']'; }).join(', ') + '.',
          { visited: visited, result: result, l: l, r: r });
      } else if (op[0] === 'update') {
        var idx = op[1], val = op[2];
        pointUpdate(1, idx, val);
        buildSnap(steps, tree, 'update', 'update(' + idx + ', ' + val + ') — 리프까지 내려가 고치고 조상들을 다시 합친다.', { idx: idx, val: val });
      } else if (op[0] === 'rangeUpdate') {
        var rl = op[1], rr = op[2], delta = op[3], vis2 = [];
        rangeUpdate(1, rl, rr, delta, vis2);
        var fulls = vis2.filter(function (v) { return v.full; });
        buildSnap(steps, tree, 'rangeUpdate',
          'rangeUpdate([' + rl + ',' + rr + '], +' + delta + ') — 완전히 덮인 노드 ' + fulls.length +
          '개만 갱신하고 빚을 lazy 에 남긴다. 자식은 아직 안 바뀌었다.',
          { visited: vis2, l: rl, r: rr });
      }
    });

    return { steps: steps, tree: tree };
  }

  K.register('segment-tree', function (host, opts) {
    var arr = isArr(opts.array) ? opts.array.map(Number).filter(isFinite).slice(0, MAX_N) : [5, 2, 8, 1, 9, 3, 7, 4];
    if (!arr.length) arr = [5, 2, 8, 1, 9, 3, 7, 4];
    var opName = OPS[opts.op] ? opts.op : 'sum';
    var useLazy = truthy(opts.lazy, true);
    var show = isArr(opts.show) ? opts.show.map(String) : ['tree', 'decomposition', 'lazyFlags'];
    var has = function (x) { return show.indexOf(x) >= 0; };

    var rawOps = isArr(opts.ops) ? opts.ops : [];
    var ops = [];
    for (var i = 0; i < rawOps.length && ops.length < MAX_OPS; i++) {
      var o = rawOps[i];
      if (!isArr(o) || !o.length) continue;
      if (o[0] === 'query' && o.length >= 3) ops.push(['query', clampInt(o[1], 0, arr.length - 1, 0), clampInt(o[2], 0, arr.length - 1, arr.length - 1)]);
      else if (o[0] === 'update' && o.length >= 3) ops.push(['update', clampInt(o[1], 0, arr.length - 1, 0), Number(o[2]) || 0]);
      else if (o[0] === 'rangeUpdate' && o.length >= 4) ops.push(['rangeUpdate', clampInt(o[1], 0, arr.length - 1, 0), clampInt(o[2], 0, arr.length - 1, arr.length - 1), Number(o[3]) || 0]);
    }
    if (!ops.length) ops = [['query', 1, 5], ['rangeUpdate', 2, 6, 10], ['query', 1, 5]];

    var data = run(arr, opName, ops, useLazy);
    var ui = K.frame(host, { title: '세그먼트 트리 — 구간이 O(log n)개의 완결된 조각으로 갈라진다' });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['완전히 덮임', T.wPath], ['더 내려감', T.wFrontier], ['lazy 빚 있음', T.accent], ['범위 밖', T.bgElev]];
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
        var cs = [T2.wPath, T2.wFrontier, T2.accent, T2.bgElev];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (nn, k) { nn.style.background = cs[k]; });
      });
    })();

    var PAD = 12, NODE_W_MIN = 30, LEVEL_H = 52;
    var depthMax = Math.ceil(Math.log2(Math.max(2, arr.length))) + 1;

    // 트리 노드 나열(뿌리=1) — build 와 같은 순서.
    var nodeList = [];
    (function collect(node, lo, hi, depth) {
      nodeList.push({ node: node, lo: lo, hi: hi, depth: depth });
      if (lo === hi) return;
      var mid = (lo + hi) >> 1;
      collect(node * 2, lo, mid, depth + 1);
      collect(node * 2 + 1, mid + 1, hi, depth + 1);
    })(1, 0, arr.length - 1, 0);

    function layout(w) {
      var leafCount = nodeList.filter(function (nd) { return nd.lo === nd.hi; }).length;
      var cellW = Math.max(NODE_W_MIN, Math.min(60, (w - PAD * 2) / Math.max(1, leafCount)));
      return { cellW: cellW, leafCount: leafCount, height: PAD + depthMax * LEVEL_H + 44 + PAD };
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = data.steps[Math.min(i, data.steps.length - 1)];

      var visitedMap = {};
      (st.visited || []).forEach(function (v) { visitedMap[v.node] = v.full ? 'full' : 'partial'; });

      // 리프의 x 좌표를 기준으로 내부 노드는 자식 중앙에 둔다.
      var leafX = 0;
      var pos = {};
      (function assign(nd) {
        var kids = nodeList.filter(function (o) { return o.lo >= nd.lo && o.hi <= nd.hi && o.depth === nd.depth + 1 && (o.node === nd.node * 2 || o.node === nd.node * 2 + 1); });
        if (nd.lo === nd.hi) { pos[nd.node] = { x: PAD + leafX * l.cellW + l.cellW / 2, y: PAD + nd.depth * LEVEL_H + 16 }; leafX++; return; }
        kids.forEach(assign);
        var xs = kids.map(function (k) { return pos[k.node].x; });
        pos[nd.node] = { x: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, y: PAD + nd.depth * LEVEL_H + 16 };
      })(nodeList[0]);

      ctx.save();
      // 간선
      nodeList.forEach(function (nd) {
        if (nd.lo === nd.hi) return;
        [nd.node * 2, nd.node * 2 + 1].forEach(function (c) {
          if (!pos[c]) return;
          ctx.strokeStyle = T.border; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pos[nd.node].x, pos[nd.node].y + 12); ctx.lineTo(pos[c].x, pos[c].y - 12); ctx.stroke();
        });
      });
      // 노드
      nodeList.forEach(function (nd) {
        var p = pos[nd.node];
        var w = Math.max(28, l.cellW * (nd.hi - nd.lo + 1) * 0.5);
        var vk = visitedMap[nd.node];
        var hasLazy = has('lazyFlags') && st.lazy && st.lazy[nd.node];
        var fill = T.bgElev, stroke = T.border, txt = T.fg;
        if (vk === 'full') { fill = T.wPath; txt = T.bg; stroke = T.wPath; }
        else if (vk === 'partial') { fill = T.wFrontier; stroke = T.wFrontier; }
        if (hasLazy) { stroke = T.accent; }
        rrect(ctx, p.x - w / 2, p.y - 12, w, 24, 4);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = (hasLazy || vk) ? 2 : 1; ctx.stroke();
        ctx.fillStyle = txt; ctx.font = '600 10px ' + MONO;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var val = st.values && st.values[nd.node] != null && isFinite(st.values[nd.node]) ? st.values[nd.node] : '·';
        ctx.fillText('[' + nd.lo + ',' + nd.hi + '] ' + val, p.x, p.y);
        if (hasLazy) {
          ctx.font = '9px ' + MONO; ctx.fillStyle = T.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText('+' + st.lazy[nd.node], p.x, p.y + 14);
        }
      });
      ctx.restore();

      var yEnd = PAD + depthMax * LEVEL_H + 16;
      ctx.save();
      ctx.font = '11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = st.kind === 'query' ? T.wPath : T.fgDim;
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
      lastResult: function () { var s = data.steps[data.steps.length - 1]; return s.result; },
      queryResults: function () { return data.steps.filter(function (s) { return s.kind === 'query'; }).map(function (s) { return s.result; }); },
      steps: function () { return data.steps.length; },
      goto: function (i) { play.goto(i); }
    };
  });
})();
