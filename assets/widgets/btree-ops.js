/* btree-ops.js — 뿌리 위에 새 뿌리가 생기는 방식으로 큰다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **B-Tree는 리프가 늘어나는 게 아니라 뿌리 위에 새 뿌리가 생기며 자란다.**
 *   노드가 키 한도를 넘으면 가운데 키가 부모로 올라가고 나머지가 좌우로
 *   갈라진다. 그 갈라짐이 뿌리까지 전파되면 트리 전체의 높이가 하나 는다.
 *
 * 왜 블록 읽기 카운터가 트리 그림보다 중요한가
 *   B-Tree의 존재 이유는 "노드 하나 = 디스크 블록 하나" 다. 예쁜 트리
 *   그림은 이진 탐색 트리와 구별이 안 된다. 방문한 노드마다 카운터가
 *   하나씩 오르는 것을 보여야 "order 를 올리면 왜 접근 횟수가 주는가"가
 *   손에 잡힌다.
 *
 * ── opts (챕터가 넘기는 것) ──────────────────────────────────────────────
 *   order  : 정수 3~8 (기본 4). 노드당 최대 자식 수 = 최대 키 수 + 1
 *   ops    : [["insert",key] | ["search",key], ...]
 *   mode   : "disk-blocks" (기본) — 블록 읽기 누적 카운터를 보인다
 */
(function () {
  'use strict';
  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  var MAX_OPS = 60;

  function isArr(v) { return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string'; }
  function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.max(lo, Math.min(hi, n)); }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ─── B-Tree 본체. 표준 삽입 알고리즘: 리프에 넣고, 넘치면 위로 분할 전파 ──

  function makeNode(leaf) { return { keys: [], children: [], leaf: leaf, id: 0 }; }

  function Tree(order) {
    this.order = order;    // 최대 자식 수
    this.maxKeys = order - 1;
    this.root = makeNode(true);
    this.nextId = 1;
  }

  Tree.prototype.assignId = function (n) { n.id = this.nextId++; };

  // 노드를 반으로 갈라 [왼쪽, 올릴키, 오른쪽]을 돌려준다.
  Tree.prototype.splitChild = function (node) {
    var mid = Math.floor(node.keys.length / 2);
    var up = node.keys[mid];
    var left = makeNode(node.leaf);
    var right = makeNode(node.leaf);
    left.keys = node.keys.slice(0, mid);
    right.keys = node.keys.slice(mid + 1);
    if (!node.leaf) {
      left.children = node.children.slice(0, mid + 1);
      right.children = node.children.slice(mid + 1);
    }
    this.assignId(left); this.assignId(right);
    return { left: left, up: up, right: right };
  };

  /* 삽입. 방문 경로를 스텝으로 기록하고, 분할이 일어난 지점을 표시한다.
   * 재귀 대신 스택으로 짜서 '어느 노드가 갈라졌는지'를 스텝 목록에 명시적으로 남긴다. */
  Tree.prototype.insert = function (key, onVisit, onSplit) {
    var path = [];   // [{node, idx}] — 뿌리부터 리프까지
    var node = this.root;
    while (true) {
      onVisit(node);
      path.push(node);
      if (node.leaf) break;
      var i = 0;
      while (i < node.keys.length && key > node.keys[i]) i++;
      node = node.children[i];
    }
    var leaf = path[path.length - 1];
    var pos = 0;
    while (pos < leaf.keys.length && leaf.keys[pos] < key) pos++;
    leaf.keys.splice(pos, 0, key);

    // 리프에서 위로 올라가며 넘치면 분할한다.
    for (var d = path.length - 1; d >= 0; d--) {
      var cur = path[d];
      if (cur.keys.length <= this.maxKeys) break;
      var sp = this.splitChild(cur);
      onSplit(cur, sp);
      if (d === 0) {
        var newRoot = makeNode(false);
        this.assignId(newRoot);
        newRoot.keys = [sp.up];
        newRoot.children = [sp.left, sp.right];
        this.root = newRoot;
      } else {
        var parent = path[d - 1];
        var ci = parent.children.indexOf(cur);
        parent.children.splice(ci, 1, sp.left, sp.right);
        parent.keys.splice(ci, 0, sp.up);
      }
    }
  };

  Tree.prototype.search = function (key, onVisit) {
    var node = this.root;
    while (node) {
      onVisit(node);
      var i = 0;
      while (i < node.keys.length && key > node.keys[i]) i++;
      if (i < node.keys.length && node.keys[i] === key) return true;
      if (node.leaf) return false;
      node = node.children[i];
    }
    return false;
  };

  // 트리를 순수 데이터(스냅샷)로 복제한다 — 스텝마다 통째로 저장해 되감기를 결정적으로 만든다.
  function snapshotTree(root) {
    return (function walk(n) {
      return { keys: n.keys.slice(), leaf: n.leaf, id: n.id, children: n.children.map(walk) };
    })(root);
  }

  function depth(n) { return n.leaf ? 1 : 1 + Math.max.apply(null, n.children.map(depth)); }

  // ─── 실행 로그 만들기 ────────────────────────────────────────────────────

  function run(order, ops) {
    var tree = new Tree(order);
    var steps = [];
    var blocks = 0;
    var found = null;

    function push(kind, extra) {
      var s = { kind: kind, blocks: blocks, tree: snapshotTree(tree.root), found: found };
      if (extra) for (var k in extra) s[k] = extra[k];
      steps.push(s);
    }

    push('init', { note: '빈 트리. order=' + order + ', 노드당 키 최대 ' + (order - 1) + '개.' });

    ops.forEach(function (op) {
      var kind = op[0], key = op[1];
      found = null;
      if (kind === 'insert') {
        var splitNodes = [];
        tree.insert(key,
          function () { blocks += 1; push('visit', { op: 'insert', key: key, note: key + ' 삽입 — 노드 방문. 블록 읽기 ' + blocks + '.' }); },
          function (orig, sp) { splitNodes.push(sp); push('split', { op: 'insert', key: key, splitAt: orig.id, note: '노드가 넘쳐 갈라진다. 가운데 키 ' + sp.up + '이 부모로 올라간다.' }); }
        );
        push('done', { op: 'insert', key: key, note: key + ' 삽입 완료. 이번 연산의 블록 읽기 ' + blocks + '.' , opDone: true });
      } else {
        var startBlocks = blocks;
        var ok = tree.search(key, function () { blocks += 1; push('visit', { op: 'search', key: key, note: key + ' 탐색 — 노드 방문. 블록 읽기 ' + blocks + '.' }); });
        found = ok;
        push('done', { op: 'search', key: key, note: key + (ok ? ' 발견' : ' 없음') + '. 블록 읽기 ' + (blocks - startBlocks) + '회.', opDone: true, foundKey: ok });
      }
    });

    return { steps: steps, finalBlocks: blocks };
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('btree-ops', function (host, opts) {
    var order = clampInt(opts.order, 3, 8, 4);
    var rawOps = isArr(opts.ops) ? opts.ops : [];
    var ops = [];
    for (var i = 0; i < rawOps.length && ops.length < MAX_OPS; i++) {
      var o = rawOps[i];
      if (!isArr(o) || o.length < 2) continue;
      var kind = (o[0] === 'search') ? 'search' : 'insert';
      var key = parseInt(o[1], 10);
      if (isFinite(key)) ops.push([kind, key]);
    }
    if (!ops.length) ops = [['insert', 10], ['insert', 20], ['insert', 5]];

    var title = 'B-Tree — 뿌리 위에 새 뿌리가 생기는 방식으로 큰다';
    if (isArr(opts.ops) && opts.ops.length > ops.length) title += '  ·  연산이 많아 앞 ' + ops.length + '개만 재생';

    var data = run(order, ops);
    var ui = K.frame(host, { title: title });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['방문', T.wFrontier], ['분할된 노드', T.accent], ['찾음/부재', T.wPath]];
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
        var cs = [T2.wFrontier, T2.accent, T2.wPath];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (n, k) { n.style.background = cs[k]; });
      });
    })();

    var PAD = 12, LEVEL_H = 64, NODE_MIN_W = 34;

    function layoutTree(root) {
      // 리프를 가로로 늘어놓고 내부 노드는 자식 중앙에 둔다(표준 트리 레이아웃).
      var leafX = 0;
      var pos = {};
      (function assign(n) {
        if (n.leaf) { pos[n.id] = leafX; leafX += 1; return; }
        n.children.forEach(assign);
        var xs = n.children.map(function (c) { return pos[c.id]; });
        pos[n.id] = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
      })(root);
      return { pos: pos, leafCount: Math.max(1, leafX) };
    }

    function nodeW(n) { return Math.max(NODE_MIN_W, 22 * n.keys.length + 12); }

    function layout(w) {
      var st = data.steps[play ? play.index() : 0];
      var lt = layoutTree(st.tree);
      var d = depth(st.tree);
      var cellW = Math.max(50, Math.min(90, (w - PAD * 2) / lt.leafCount));
      return {
        w: w, cellW: cellW, height: PAD + d * LEVEL_H + 60 + PAD,
        x0: PAD, treeW: cellW * lt.leafCount
      };
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = data.steps[Math.min(i, data.steps.length - 1)];
      var lt = layoutTree(st.tree);

      // x 오프셋: 트리가 캔버스보다 좁으면 가운데로.
      var offX = l.x0 + Math.max(0, (size.w - PAD * 2 - l.treeW) / 2);

      function nodeCenter(n) { return { x: offX + lt.pos[n.id] * l.cellW + l.cellW / 2, y: PAD + n._level * LEVEL_H + 20 }; }

      // 레벨을 매긴다.
      (function setLevel(n, lev) { n._level = lev; n.children.forEach(function (c) { setLevel(c, lev + 1); }); })(st.tree, 0);

      ctx.save();
      // 간선
      (function edges(n) {
        var c0 = nodeCenter(n);
        n.children.forEach(function (c) {
          var c1 = nodeCenter(c);
          ctx.strokeStyle = T.border; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(c0.x, c0.y + 14); ctx.lineTo(c1.x, c1.y - 14); ctx.stroke();
          edges(c);
        });
      })(st.tree);

      // 노드
      (function nodes(n) {
        var c = nodeCenter(n);
        var w = nodeW(n), h = 28;
        var isVisited = st.op != null && st.kind === 'visit' && st.blocks != null;
        var isThisNode = (st.kind === 'visit' || st.kind === 'split') && n.id === (st.visitedId || st.splitAt);
        var wasSplit = st.kind === 'split' && n.id === st.splitAt;
        var fill = T.bgElev, stroke = T.border;
        if (wasSplit) { fill = T.accent; stroke = T.accent; }
        rrect(ctx, c.x - w / 2, c.y - h / 2, w, h, 5);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = wasSplit ? 2 : 1; ctx.stroke();
        ctx.fillStyle = wasSplit ? T.bg : T.fg;
        ctx.font = '600 12px ' + MONO;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n.keys.join(' | '), c.x, c.y);
        n.children.forEach(nodes);
      })(st.tree);

      // 찾은 키를 하이라이트(탐색 완료 스텝)
      if (st.kind === 'done' && st.op === 'search') {
        ctx.font = '600 11px ' + FONT;
        ctx.fillStyle = st.foundKey ? T.wPath : T.boxDanger;
      }
      ctx.restore();

      // 블록 읽기 카운터
      var y = l.height - PAD - 20;
      ctx.save();
      ctx.font = '11px ' + FONT;
      ctx.fillStyle = T.fgFaint;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('누적 블록 읽기', PAD, y);
      var lw = ctx.measureText('누적 블록 읽기').width;
      ctx.font = '600 15px ' + MONO;
      ctx.fillStyle = T.accent;
      ctx.fillText(String(st.blocks), PAD + lw + 8, y);
      ctx.restore();
    }

    var cv = K.canvas(ui.stage, { height: function (w) { return layout(w).height; }, draw: draw });
    var play = K.player(ui, {
      total: function () { return data.steps.length; },
      render: function () { cv.redraw(); },
      label: function (i) { return data.steps[Math.min(i, data.steps.length - 1)].note || ''; }
    });
    play.draw();

    host.__widget = {
      finalBlocks: function () { return data.finalBlocks; },
      steps: function () { return data.steps.length; },
      goto: function (i) { play.goto(i); },
      rootKeys: function () { return data.steps[data.steps.length - 1].tree.keys.slice(); },
      height: function () { return depth(data.steps[data.steps.length - 1].tree); }
    };
  });
})();
