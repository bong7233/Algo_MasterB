/* tree-traversal.js — 전위 · 중위 · 후위 · 레벨 순회와 호출 스택
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **네 순회는 다른 알고리즘이 아니다. 같은 재귀에서 "자기를 출력하는 줄"이
 *   어디에 놓였느냐의 차이일 뿐이다.**
 * 그 차이는 트리 그림만으로는 절대 보이지 않는다. 보이는 곳은 호출 스택이다.
 * 그래서 트리와 스택을 나란히 놓고 같은 노드를 양쪽에서 동시에 강조한다.
 * 프레임 안의 [1] [2] [3] 표식은 본문 II-10 §2 의 세 시점 표기와 같은 것이다.
 *
 *   visit(u):
 *       [1] 여기 → 전위      (들어가면서)
 *       visit(u.left)
 *       [2] 여기 → 중위      (왼쪽을 끝내고)
 *       visit(u.right)
 *       [3] 여기 → 후위      (자식을 다 끝내고)
 *
 * 레벨 순회만 계보가 다르다. 스택이 아니라 큐를 쓴다 — 그래서 이 순회에서는
 * 같은 자리에 스택 대신 **큐**를 그리고 이름표도 바꿔 단다. 자료구조 하나를
 * 바꾼 것이 깊이 우선을 너비 우선로 바꾼다는 사실이 이 위젯의 두 번째 교훈이다.
 *
 * 왜 출력열을 트리 아래에 따로 쌓는가: 순회의 결과물은 "노드에 칠해진 색"이
 * 아니라 **순서를 가진 수열**이다. 수열이 한 칸씩 자라나는 것을 봐야
 * "중위는 정렬이 나온다"(II-9) 같은 문장이 눈으로 확인된다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 노드가 이보다 많아지면 잎 간격이 글자보다 좁아져 읽을 수 없다.
  // "많이 보여주기"보다 "읽히게 보여주기"가 우선이라 여기서 자른다.
  var MAX_N = 31;
  var MAX_STEPS = 400;   // 계약 §7: 스텝 수 상한

  // ---------------------------------------------------------------- opts 검증
  //
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 무엇이 들어와도 던지지 않는다.

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function toNum(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return null;
  }

  // 노드 표시 라벨. 숫자든 짧은 문자열이든 받되 칸에 들어갈 길이로 자른다.
  function toLabel(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? String(v) : null;
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      return s.length > 4 ? s.slice(0, 4) : s;
    }
    return null;
  }

  var ORDER_ALIAS = {
    pre: 'pre', preorder: 'pre', 'pre-order': 'pre', 전위: 'pre',
    'in': 'in', inorder: 'in', 'in-order': 'in', 중위: 'in',
    post: 'post', postorder: 'post', 'post-order': 'post', 후위: 'post',
    level: 'level', levelorder: 'level', 'level-order': 'level', bfs: 'level', 레벨: 'level'
  };

  var ORDER_LABEL = { pre: '전위', 'in': '중위', post: '후위', level: '레벨' };
  var ORDER_FULL = {
    pre: '전위 (뿌리 → 왼쪽 → 오른쪽)',
    'in': '중위 (왼쪽 → 뿌리 → 오른쪽)',
    post: '후위 (왼쪽 → 오른쪽 → 뿌리)',
    level: '레벨 (깊이 순 — 큐를 쓴다)'
  };

  function normOrder(v) {
    if (typeof v !== 'string') return null;
    return ORDER_ALIAS[v.trim().toLowerCase()] || null;
  }

  // ---------------------------------------------------------------- 트리 만들기
  //
  // 세 가지 입력을 받는다. 본문 저자가 상황에 따라 편한 형태를 쓰기 때문이다.
  //   tree: [50,30,70,...]      레벨 순서 배열 (힙 위젯과 같은 규칙: 자식 2i+1, 2i+2)
  //   tree: {v:50,l:{...},r:{}} 중첩 객체
  //   edges: [[1,2],[1,3]] + root   간선 목록 (IV-8 처럼 그래프로 주어진 트리)
  //   values: [...] + bst:true      삽입으로 BST 를 만든다

  function newNode(id, label) {
    return { id: id, label: label, left: -1, right: -1, kids: [], parent: -1, depth: 0 };
  }

  function fromArray(arr) {
    if (!isArr(arr) || arr.length === 0) return null;
    var rootLabel = toLabel(arr[0]);
    if (rootLabel === null) return null;
    var ns = [newNode(0, rootLabel)];
    var slot = {};            // 배열 인덱스 → 노드 id
    slot[0] = 0;
    var q = [0];
    while (q.length) {
      var ai = q.shift();
      var node = ns[slot[ai]];
      var pair = [2 * ai + 1, 2 * ai + 2];
      for (var s = 0; s < 2; s++) {
        var ci = pair[s];
        if (ci >= arr.length || ns.length >= MAX_N) continue;
        var lb = toLabel(arr[ci]);
        if (lb === null) continue;              // 빈 자리 = 자식 없음
        var child = newNode(ns.length, lb);
        child.parent = node.id;
        child.depth = node.depth + 1;
        ns.push(child);
        slot[ci] = child.id;
        if (s === 0) node.left = child.id; else node.right = child.id;
        node.kids.push(child.id);
        q.push(ci);
      }
    }
    return ns;
  }

  function fromNested(obj) {
    if (!obj || typeof obj !== 'object' || isArr(obj)) return null;
    var ns = [];
    function walk(o, parent, depth) {
      if (!o || typeof o !== 'object' || ns.length >= MAX_N) return -1;
      var lb = toLabel(o.v !== undefined ? o.v : (o.value !== undefined ? o.value : o.key));
      if (lb === null) return -1;
      var n = newNode(ns.length, lb);
      n.parent = parent;
      n.depth = depth;
      ns.push(n);
      var l = walk(o.l !== undefined ? o.l : o.left, n.id, depth + 1);
      var r = walk(o.r !== undefined ? o.r : o.right, n.id, depth + 1);
      n.left = l; n.right = r;
      if (l >= 0) n.kids.push(l);
      if (r >= 0) n.kids.push(r);
      return n.id;
    }
    var root = walk(obj, -1, 0);
    return root === 0 ? ns : null;
  }

  function fromEdges(edges, rootOpt) {
    if (!isArr(edges) || edges.length === 0) return null;
    var adj = {};             // 라벨 → 이웃 라벨 배열
    var seen = [];
    function touch(k) {
      if (!adj[k]) { adj[k] = []; seen.push(k); }
    }
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (!isArr(e) || e.length < 2) continue;
      var a = toLabel(e[0]), b = toLabel(e[1]);
      if (a === null || b === null || a === b) continue;
      touch(a); touch(b);
      if (adj[a].indexOf(b) < 0) adj[a].push(b);
      if (adj[b].indexOf(a) < 0) adj[b].push(a);
    }
    if (!seen.length) return null;

    var rootLabel = toLabel(rootOpt);
    if (rootLabel === null || !adj[rootLabel]) rootLabel = seen[0];

    // 자식 순서를 정렬해 고정한다. 스텝이 매번 같아야 되감기와 테스트가 재현된다.
    var numeric = seen.every(function (k) { return toNum(k) !== null; });
    function sortKids(list) {
      var out = list.slice();
      out.sort(function (x, y) {
        return numeric ? (toNum(x) - toNum(y)) : (x < y ? -1 : (x > y ? 1 : 0));
      });
      return out;
    }

    var ns = [newNode(0, rootLabel)];
    var idOf = {};
    idOf[rootLabel] = 0;
    var q = [rootLabel];
    var visited = {};
    visited[rootLabel] = true;
    while (q.length) {
      var cur = q.shift();
      var node = ns[idOf[cur]];
      var nb = sortKids(adj[cur]);
      for (var j = 0; j < nb.length; j++) {
        var c = nb[j];
        if (visited[c] || ns.length >= MAX_N) continue;   // 부모로 되돌아가는 간선은 여기서 걸린다
        visited[c] = true;
        var child = newNode(ns.length, c);
        child.parent = node.id;
        child.depth = node.depth + 1;
        ns.push(child);
        idOf[c] = child.id;
        node.kids.push(child.id);
        q.push(c);
      }
    }
    return ns;
  }

  function fromBST(values) {
    if (!isArr(values)) return null;
    var ns = [];
    for (var i = 0; i < values.length && ns.length < MAX_N; i++) {
      var v = toNum(values[i]);
      if (v === null) continue;
      var lb = toLabel(v);
      if (ns.length === 0) { ns.push(newNode(0, lb)); continue; }
      // 삽입: 작으면 왼쪽, 크면 오른쪽. 같은 값은 버린다(중복은 BST 의 정렬 증명을 흐린다).
      var cur = 0, guard = 0;
      while (guard++ < MAX_N * 2) {
        var node = ns[cur];
        var nv = toNum(node.label);
        if (v === nv) { cur = -1; break; }
        var goLeft = v < nv;
        var next = goLeft ? node.left : node.right;
        if (next < 0) {
          var child = newNode(ns.length, lb);
          child.parent = node.id;
          child.depth = node.depth + 1;
          ns.push(child);
          if (goLeft) node.left = child.id; else node.right = child.id;
          node.kids = [];
          if (node.left >= 0) node.kids.push(node.left);
          if (node.right >= 0) node.kids.push(node.right);
          cur = -1;
          break;
        }
        cur = next;
      }
    }
    return ns.length ? ns : null;
  }

  var DEFAULT_TREE = [50, 30, 70, 20, 40, 60, 80];

  function buildModel(opts) {
    var ns = null;
    if (opts.bst === true && isArr(opts.values)) ns = fromBST(opts.values);
    if (!ns && isArr(opts.tree)) ns = fromArray(opts.tree);
    if (!ns && opts.tree && typeof opts.tree === 'object') ns = fromNested(opts.tree);
    if (!ns && isArr(opts.edges)) ns = fromEdges(opts.edges, opts.root);
    if (!ns && isArr(opts.values)) ns = fromBST(opts.values);
    if (!ns) ns = fromArray(DEFAULT_TREE);

    // 이진 트리인가 — 자식이 셋 이상인 노드가 하나라도 있으면 중위는 정의되지 않는다.
    // (II-10 §2.1: "가운데"가 어디인지 정할 수 없기 때문이다.)
    var binary = true, height = 0, i;
    for (i = 0; i < ns.length; i++) {
      if (ns[i].kids.length > 2) binary = false;
      if (ns[i].depth > height) height = ns[i].depth;
    }

    // 순회가 볼 슬롯을 확정한다. 이진이면 [왼쪽, 오른쪽] 두 칸(-1 = 없음)이고,
    // 그렇지 않으면 자식 목록 그대로다.
    for (i = 0; i < ns.length; i++) {
      var n = ns[i];
      if (binary) {
        if (n.left < 0 && n.right < 0 && n.kids.length) {
          // 간선 목록으로 만든 트리는 좌우 구분이 없다. 정렬된 자식 순서를 좌우로 삼는다.
          n.left = n.kids.length > 0 ? n.kids[0] : -1;
          n.right = n.kids.length > 1 ? n.kids[1] : -1;
        }
        n.slots = [n.left, n.right];
      } else {
        n.slots = n.kids.slice();
      }
    }

    // 중위 순회가 실제로 정렬을 내는가 — 저자가 shape:"bst" 라고 적었더라도
    // 값으로 직접 확인한다. 위젯이 거짓말을 하면 안 된다(계약 §9).
    var seq = [];
    (function inorder(u) {
      if (u < 0) return;
      inorder(ns[u].left);
      seq.push(ns[u].label);
      inorder(ns[u].right);
    })(0);
    var sorted = binary && seq.length === ns.length;
    for (i = 1; sorted && i < seq.length; i++) {
      var a = toNum(seq[i - 1]), b = toNum(seq[i]);
      if (a === null || b === null || !(a < b)) sorted = false;
    }

    return { nodes: ns, root: 0, binary: binary, height: height, sortedInorder: sorted };
  }

  // ---------------------------------------------------------------- 순회 스텝
  //
  // 계약 §7: 상태를 미리 전부 계산해 배열에 담는다. render(i) 는 그리기만 한다.
  // 그래야 되감기가 즉시 되고, 같은 i 는 항상 같은 그림이 된다.
  //
  // 알고리즘은 본문 II-10 §4 의 `::: dual` 코드와 같다. 다른 것은 재귀를
  // 명시적 프레임으로 펼쳐 스택을 그릴 수 있게 한 것뿐이다.

  function buildSteps(model, order, accumulate) {
    var ns = model.nodes;
    var N = ns.length;
    var steps = [];
    var out = [];                       // 출력된 노드 id (순서 그대로)
    var stack = [];                     // 재귀 프레임 {u, st}
    var vals = new Array(N);            // 노드에 붙는 누적값 (깊이 또는 서브트리 크기)
    var size = new Array(N);
    var truncated = false;
    for (var z = 0; z < N; z++) { vals[z] = null; size[z] = 0; }

    // 어떤 값을 노드에 붙일 것인가.
    //   깊이는 **내려가는 길**에 확정되고(전위·레벨), 서브트리 크기는 **올라오는 길**에만
    //   확정된다(후위). IV-8 이 "한 번의 DFS 가 양방향 정보를 다 나른다"고 말하는 그 두 값이다.
    //   중위에는 둘 다 걸리지 않으므로 아무것도 붙이지 않는다 — 정렬 출력에서 눈을 뺏기지 않게.
    var showDepth = (accumulate === 'depth') || (accumulate === 'size' && (order === 'pre' || order === 'level'));
    var showSize = (accumulate === 'size' && order === 'post');

    function lab(id) { return id >= 0 ? ns[id].label : '없음'; }

    // 조사 맞추기. 숫자 라벨은 읽는 소리의 받침에 따라 을/를이 갈린다
    // (50 → 오십'을', 40 → 사십'를'... 이 아니라 사십'을'? 아니다 — 4는 '사'라
    //  받침이 없어 40 은 '사십'으로 읽히므로 받침 ㅂ이 아니라 ㅂ... 여기서는
    //  마지막 자릿수의 소리를 기준으로 삼는다: 0 영·1 일·3 삼·6 육·7 칠·8 팔은 받침 있음).
    // 위젯이 읽어 주는 문장이라 조사가 틀리면 그대로 눈에 띈다.
    function hasJong(s) {
      var ch = s.charAt(s.length - 1);
      if (ch >= '0' && ch <= '9') return '013678'.indexOf(ch) >= 0;
      var code = s.charCodeAt(s.length - 1);
      if (code >= 0xAC00 && code <= 0xD7A3) return ((code - 0xAC00) % 28) !== 0;
      return false;
    }
    function ul(id) { return lab(id) + (hasJong(lab(id)) ? ' 을' : ' 를'); }
    function eun(id) { return lab(id) + (hasJong(lab(id)) ? ' 은' : ' 는'); }
    function ro(id) {
      var s = lab(id);
      var ch = s.charAt(s.length - 1);
      var rieul;
      if (ch >= '0' && ch <= '9') rieul = '178'.indexOf(ch) >= 0;   // 일·칠·팔은 ㄹ 받침
      else {
        var code = s.charCodeAt(s.length - 1);
        rieul = (code >= 0xAC00 && code <= 0xD7A3) && ((code - 0xAC00) % 28) === 8;
      }
      return s + (hasJong(s) && !rieul ? ' 으로' : ' 로');
    }
    function seqText(k) {
      // 출력열이 길어지면 상태 줄이 넘친다. 뒤쪽 몇 개만 보인다.
      var arr = out.map(lab);
      if (arr.length <= k) return arr.join(' ');
      return '… ' + arr.slice(arr.length - k).join(' ');
    }

    function snap(o) {
      if (steps.length >= MAX_STEPS) { truncated = true; return false; }
      var fr = [];
      for (var i = 0; i < stack.length; i++) fr.push({ u: stack[i].u, st: stack[i].st });
      steps.push({
        kind: o.kind,
        u: o.u == null ? -1 : o.u,
        visit: !!o.visit,
        stack: fr,
        pop: o.pop || null,               // 지금 빠져나가는 프레임 (점선으로 그린다)
        queue: o.queue ? o.queue.slice() : null,
        out: out.slice(),
        vals: vals.slice(),
        edge: o.edge || null,
        msg: o.msg || ''
      });
      return true;
    }

    function depthNote(u) {
      return showDepth ? ' 깊이 ' + ns[u].depth + '.' : '';
    }

    // ---- 깊이 우선 (전위 · 중위 · 후위) ----
    function dfs(u) {
      var node = ns[u];
      var parent = node.parent;
      stack.push({ u: u, st: 0 });

      if (showDepth) vals[u] = node.depth;   // 깊이는 내려가는 길에 확정된다

      var visitNow = (order === 'pre');
      if (visitNow) out.push(u);

      var msg;
      if (visitNow) {
        msg = lab(u) + ' 에 들어간다. 전위는 [1] 자리 — 들어가는 순간 출력한다. ' +
              '부모까지의 결과는 이미 확정되어 있다.' + depthNote(u) +
              ' → 출력 ' + seqText(8);
      } else {
        var firstChild = node.slots.length ? node.slots[0] : -1;
        var next;
        if (firstChild >= 0) {
          next = (model.binary ? '왼쪽 자식 ' : '첫 자식 ') + ro(firstChild) + ' 내려간다.';
        } else if (node.kids.length) {
          // 왼쪽만 비어 있는 경우다. "자식이 없다"고 쓰면 그림과 어긋난다.
          next = order === 'in'
            ? '왼쪽 자식이 없다. 왼쪽 서브트리가 비었으니 곧장 [2] 자리로 간다.'
            : '왼쪽 자식이 없어 오른쪽 자식 ' + ro(node.kids[0]) + ' 바로 넘어간다.';
        } else {
          next = '잎이라 내려갈 자식이 없어 바로 되돌아갈 준비를 한다.';
        }
        msg = ul(u) + ' 호출한다. 프레임을 쌓는다. ' + next +
              ' 아직 출력하지 않는다 — ' + (order === 'in' ? '중위는 [2]' : '후위는 [3]') + ' 자리에서 찍는다.' +
              ' 스택 깊이 ' + stack.length + '.';
      }
      if (!snap({ kind: 'enter', u: u, visit: visitNow, edge: parent >= 0 ? { a: parent, b: u, dir: 'down' } : null, msg: msg })) return;

      var slots = node.slots;
      for (var s = 0; s < slots.length; s++) {
        var c = slots[s];
        if (c >= 0) {
          dfs(c);
          if (truncated) return;
        }
        stack[stack.length - 1].st = s + 1;

        // 중위: 왼쪽 슬롯을 끝낸 [2] 자리가 출력 시점이다.
        if (order === 'in' && s === 0) {
          out.push(u);
          var m2 = c >= 0
            ? lab(u) + ' 의 왼쪽 서브트리를 다 돌았다. 중위 순회는 여기서 ' + ul(u) + ' 출력한다.'
            : eun(u) + ' 왼쪽 자식이 없다. 왼쪽 서브트리가 비었으니 [2] 자리에 곧바로 도달해 ' + ul(u) + ' 출력한다.';
          if (model.sortedInorder) m2 += ' 지금까지 오름차순이다.';
          if (!snap({ kind: 'mid', u: u, visit: true, msg: m2 + ' → 출력 ' + seqText(8) })) return;
        }
      }

      // ---- 나가는 길: 자식의 결과가 전부 모인 유일한 시점 ----
      var sum = 0, parts = [];
      for (var t = 0; t < node.kids.length; t++) { sum += size[node.kids[t]]; parts.push(String(size[node.kids[t]])); }
      size[u] = 1 + sum;
      if (showSize) vals[u] = size[u];

      var visitOut = (order === 'post');
      if (visitOut) out.push(u);
      var frame = stack.pop();

      var m3;
      if (visitOut) {
        m3 = lab(u) + ' 의 자식을 모두 끝냈다. 후위는 [3] 자리 — 여기서 ' + ul(u) + ' 출력한다.';
        if (showSize) {
          m3 += parts.length
            ? ' 자식의 값이 다 모였으므로 size(' + lab(u) + ') = 1 + ' + parts.join(' + ') + ' = ' + size[u] + '.'
            : ' 잎이라 더할 자식이 없다. size(' + lab(u) + ') = 1.';
        }
        m3 += ' → 출력 ' + seqText(8);
      } else {
        m3 = lab(u) + ' 의 프레임을 팝한다. ' +
             (parent >= 0
               ? '부모 ' + ro(parent) + ' 돌아가 ' + (order === 'in' ? '오른쪽' : '다음') + ' 차례를 이어간다.'
               : '루트까지 돌아왔다. 스택이 비면 순회가 끝난다.');
      }
      snap({ kind: 'exit', u: u, visit: visitOut, pop: frame, edge: parent >= 0 ? { a: parent, b: u, dir: 'up' } : null, msg: m3 });
    }

    // ---- 너비 우선 (레벨) ----
    function bfs() {
      var q = [model.root];
      snap({
        kind: 'init', u: -1, queue: q,
        msg: '큐에 루트 ' + ul(model.root) + ' 넣는다. 코드는 전위의 명시적 스택 버전과 같고 ' +
             '자료구조만 스택 → 큐로 바뀌었다. 이 한 글자가 깊이 우선을 너비 우선으로 바꾼다.'
      });
      var guard = 0;
      while (q.length && guard++ < MAX_N + 2) {
        var u = q.shift();
        if (showDepth) vals[u] = ns[u].depth;
        out.push(u);
        var kids = ns[u].kids;
        for (var i = 0; i < kids.length; i++) q.push(kids[i]);
        var kidText = '';
        if (kids.length) {
          // 목록 뒤의 조사도 마지막 항목의 받침을 따른다.
          kidText = '자식 ' + kids.slice(0, -1).map(lab).concat([ul(kids[kids.length - 1])]).join(', ') +
                    ' 큐 뒤에 넣는다.';
        } else {
          kidText = '잎이라 넣을 자식이 없다.';
        }
        var msg = '큐 앞에서 ' + ul(u) + ' 꺼내 출력한다. ' + kidText +
                  ' 큐: [' + q.map(lab).join(', ') + ']. 레벨 ' + ns[u].depth + '.' +
                  // 같은 설명을 매 스텝 반복하면 상태 줄이 소음이 된다. 처음 한 번만.
                  (out.length === 1 ? ' 가중치가 전부 1일 때 이 레벨 번호가 곧 최단 거리다.' : '');
        if (!snap({ kind: 'deq', u: u, visit: true, queue: q, edge: ns[u].parent >= 0 ? { a: ns[u].parent, b: u, dir: 'down' } : null, msg: msg })) return;
      }
    }

    if (order === 'level') bfs();
    else dfs(model.root);

    // 마지막 스텝: 수열 전체가 답이다. 여기서만 금색(wPath)을 쓴다.
    if (!truncated) {
      var full = out.map(lab).join(' ');
      var tail = '';
      if (order === 'in' && model.sortedInorder) {
        tail = ' 오름차순으로 정렬되어 나왔다 — BST 의 불변식이 곧 "중위 순서 = 정렬 순서"라는 문장이다.';
      } else if (order === 'post' && accumulate === 'size') {
        tail = ' 루트의 size = ' + size[model.root] + ' 이고 이것이 전체 노드 수다. 한 번의 순회로 모든 서브트리 크기가 채워졌다.';
      } else if (order === 'level') {
        tail = ' 이 순서가 곧 BFS 순서다.';
      } else if (order === 'pre') {
        tail = ' 뿌리가 맨 앞이고, 서브트리 하나를 완전히 끝낸 뒤 다음 서브트리로 넘어갔다.';
      }
      snap({
        kind: 'done', u: -1, queue: order === 'level' ? [] : null,
        msg: ORDER_LABEL[order] + ' 순회 완료. 결과: ' + full + '.' + tail
      });
    } else {
      steps.push({
        kind: 'done', u: -1, visit: false, stack: [], pop: null, queue: null,
        out: out.slice(), vals: vals.slice(), edge: null,
        msg: '스텝이 ' + MAX_STEPS + '개를 넘어 여기서 자른다. 트리가 너무 크다.'
      });
    }

    return { steps: steps, out: out.slice(), sizes: size.slice() };
  }

  // ---------------------------------------------------------------- 배치
  //
  // 왜 "타이디 배치"인가 (heap-ops 와 같은 방식): 레벨마다 2^d 칸을 통째로 잡으면
  // 마지막 레벨이 반만 차 있어도 폭을 다 먹어 좁은 화면에서 글자가 뭉갠다.
  // 잎을 왼쪽부터 차례로 세우고 부모를 자식들의 중점에 두면 실제 노드 수만큼만
  // 폭을 쓴다. 이 방식은 정의상 간선이 서로 교차하지 않는다.
  //
  // 자식이 하나뿐인 이진 노드는 **빈 칸을 예약**한다. 그래야 왼쪽 자식이 왼쪽에,
  // 오른쪽 자식이 오른쪽에 보인다 — 중위 순회를 설명하는 위젯에서 좌우가
  // 뒤집혀 보이면 그림이 거짓말을 한다.
  function tidyCols(model) {
    var ns = model.nodes;
    var col = new Array(ns.length);
    var next = 0;
    (function walk(u) {
      var n = ns[u];
      var slots = n.slots;
      var real = 0, i;
      for (i = 0; i < slots.length; i++) if (slots[i] >= 0) real++;
      if (!real) { col[u] = next++; return; }
      var first = null, last = null;
      for (i = 0; i < slots.length; i++) {
        var c = slots[i];
        var cx;
        if (c >= 0) { walk(c); cx = col[c]; }
        else if (model.binary) { cx = next++; }     // 빈 슬롯도 자리를 차지한다
        else continue;
        if (first === null) first = cx;
        last = cx;
      }
      col[u] = (first + last) / 2;
    })(model.root);
    return { col: col, cols: Math.max(1, next) };
  }

  function layout(w, model, order, showStack, outCount, maxFrames) {
    var tiny = w < 520, narrow = w < 790;
    var pad = tiny ? 6 : (narrow ? 10 : 16);
    var headH = tiny ? 13 : 15;
    var nodeH = tiny ? 22 : (narrow ? 26 : 30);
    // 간선이 보이는 길이. 자식 위 16px 은 누적값 필의 자리이고, 그 위에 방향 라벨(13)이
    // 한 줄 더 들어가야 한다. 그래서 좁지 않은 폭에서는 32 이상을 확보한다.
    var edge = tiny ? 24 : (narrow ? 32 : 36);
    var vgap = nodeH + edge;

    var t = tidyCols(model);
    var levels = model.height + 1;

    var isLevel = (order === 'level');
    // 스택 패널을 옆에 둘 것인가. 좁으면 트리 아래 가로 띠로 눕힌다.
    // 큐(레벨 순회)는 본래 가로로 읽는 것이라 폭과 무관하게 항상 아래에 눕힌다.
    // 700px 은 본문 칼럼(약 750px)이 들어오는 선이다. 데스크톱에서 챕터를 열면
    // 스택이 세로로 서고, 폰에서는 가로로 눕는다.
    var sideStack = showStack && !isLevel && w >= 700;
    var panelW = sideStack ? (w >= 900 ? 192 : 164) : 0;

    var availW = Math.max(80, w - pad * 2);
    var treeAreaW = Math.max(80, availW - (panelW ? panelW + 14 : 0));
    var colW = Math.min(treeAreaW / t.cols, tiny ? 48 : (narrow ? 72 : 102));
    var nodeW = Math.max(20, Math.min(colW * (tiny ? 0.84 : 0.8), tiny ? 40 : (narrow ? 48 : 56)));
    var treeW = colW * t.cols;
    var treeX = pad + Math.max(0, (treeAreaW - treeW) / 2);

    var treeTop = pad + headH + (tiny ? 12 : 14);   // 루트 위 누적값 필 자리
    var treeH = (levels - 1) * vgap + nodeH;

    var frameH = tiny ? 20 : 24;
    var panelY = pad + headH;
    var panelH = sideStack ? (maxFrames * (frameH + 4) + 14) : 0;
    if (sideStack) treeH = Math.max(treeH, panelH - (treeTop - panelY));

    var y = treeTop + treeH + (tiny ? 12 : 18);

    // 아래 가로 띠: 스택(눕힌 것) 또는 큐
    var stripTop = 0, stripH = 0;
    if (showStack && !sideStack) {
      stripTop = y + headH;
      stripH = frameH;
      y = stripTop + stripH + (tiny ? 10 : 16);
    }

    // 출력열: 칸 크기를 지키고 줄바꿈한다. 순서를 읽는 것이 목적이라 칸이 작아지면 안 된다.
    var maxLen = 1;
    for (var i = 0; i < model.nodes.length; i++) maxLen = Math.max(maxLen, model.nodes[i].label.length);
    var chipH = tiny ? 20 : 24;
    var chipW = Math.max(tiny ? 24 : 28, 12 + maxLen * (tiny ? 7 : 8.5));
    var perRow = Math.max(1, Math.floor(availW / (chipW + 4)));
    var rows = Math.max(1, Math.ceil(Math.max(1, outCount) / perRow));
    var outTop = y + headH;
    var outBottom = outTop + rows * (chipH + 5) - 5;

    var h = outBottom + pad;
    if (sideStack) h = Math.max(h, panelY + panelH + pad);

    return {
      w: w, tiny: tiny, narrow: narrow, pad: pad, headH: headH,
      cols: t.cols, col: t.col, levels: levels,
      colW: colW, nodeW: nodeW, nodeH: nodeH, vgap: vgap, edge: edge,
      treeX: treeX, treeTop: treeTop, treeH: treeH,
      sideStack: sideStack, panelW: panelW, panelX: pad + treeAreaW + 14, panelY: panelY, panelH: panelH,
      maxFrames: maxFrames,
      frameH: frameH, stripTop: stripTop, stripH: stripH,
      outTop: outTop, outBottom: outBottom, chipW: chipW, chipH: chipH, perRow: perRow, rows: rows,
      height: h
    };
  }

  function nodeXY(L, model, id) {
    return {
      x: L.treeX + (L.col[id] + 0.5) * L.colW - L.nodeW / 2,
      y: L.treeTop + model.nodes[id].depth * L.vgap
    };
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

  // 간선 위의 화살촉. 좁은 화면에서 글자 라벨 대신 방향만 전한다.
  function arrow(ctx, ax, ay, bx, by, up, color) {
    var t = up ? 0.42 : 0.5;
    var cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
    var dx = bx - ax, dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = (dx / len) * (up ? -1 : 1), uy = (dy / len) * (up ? -1 : 1);
    var s = 5.5;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + ux * s, cy + uy * s);
    ctx.lineTo(cx - ux * s - uy * s * 0.7, cy - uy * s + ux * s * 0.7);
    ctx.lineTo(cx - ux * s + uy * s * 0.7, cy - uy * s - ux * s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  K.register('tree-traversal', function (host, opts) {
    opts = opts || {};
    if (typeof opts !== 'object') opts = {};

    var model = buildModel(opts);

    // accumulate: 후위에서는 서브트리 크기, 내려가는 순회에서는 깊이를 노드에 붙인다.
    // IV-8 이 요구하는 "한 번의 DFS 가 양방향 정보를 다 나른다"가 이 표시의 정체다.
    var accumulate = 'size';
    if (opts.accumulate === false || opts.accumulate === 'none') accumulate = 'none';
    else if (opts.accumulate === 'depth') accumulate = 'depth';
    else if (typeof opts.accumulate === 'string' && opts.accumulate !== 'size') accumulate = 'size';

    var showStack = (opts.showStack === false) ? false : true;

    // 제공할 순회 목록. 이진이 아니면 중위는 정의되지 않으므로 뺀다(II-10 §2.1).
    var avail = [];
    if (isArr(opts.orders)) {
      for (var i = 0; i < opts.orders.length; i++) {
        var o = normOrder(opts.orders[i]);
        if (o && avail.indexOf(o) < 0) avail.push(o);
      }
    }
    if (!avail.length) avail = ['pre', 'in', 'post', 'level'];
    if (!model.binary) avail = avail.filter(function (x) { return x !== 'in'; });
    if (!avail.length) avail = ['pre'];

    var order = normOrder(opts.order);
    if (!order || avail.indexOf(order) < 0) order = avail[0];

    // highlight:"sorted-output" — 출력열을 "정렬 결과"로 강조한다(II-9).
    var sortedHint = (opts.highlight === 'sorted-output') && model.sortedInorder;

    var run = null;      // {steps, out, sizes}
    var cur = 0;
    var cache = null;

    var ui = K.frame(host, { title: '', wide: false });
    var titleEl = K.el('div', 'wk-title', '');
    ui.head.insertBefore(titleEl, ui.head.firstChild);

    function stackTitle() {
      return order === 'level' ? '큐 (앞 → 뒤)' : '호출 스택 (아래 → 위)';
    }

    function setTitle() {
      titleEl.textContent = '트리 순회 — ' + ORDER_FULL[order];
    }

    function rebuild(keepIndex) {
      run = buildSteps(model, order, accumulate);
      cache = null;
      setTitle();
      var idx = keepIndex ? Math.min(cur, run.steps.length - 1) : 0;
      cur = idx < 0 ? 0 : idx;
      if (play) play.goto(cur);
    }

    // ---- 머리말 컨트롤 ----
    var segEl = null;
    if (avail.length > 1) {
      segEl = K.seg(ui.slot, avail.map(function (v) { return { label: ORDER_LABEL[v], value: v }; }), order, function (v) {
        order = v;
        rebuild(false);
      });
    }

    // 버튼이 아닌 경로(테스트 훅)로 순회를 바꿔도 눌린 칸이 따라가야 한다.
    function syncSeg() {
      if (!segEl) return;
      Array.prototype.forEach.call(segEl.children, function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-val') === order);
      });
    }

    // ---- 범례 (§5: 색만으로 정보를 주지 않는다. 글자 표식도 같이 쓴다) ----
    var legend = K.el('div', 'wk-legend');
    legend.style.width = '100%';
    legend.innerHTML =
      '<span><i style="background:var(--w-frontier)"></i>지금 보는 노드</span>' +
      '<span><i style="background:var(--accent-dim)"></i>스택에 올라 있음 ([1][2][3] = 코드 위치)</span>' +
      '<span><i style="background:var(--w-visited)"></i>출력됨 (왼쪽 위 숫자 = 몇 번째)</span>' +
      '<span><i style="background:var(--w-path)"></i>방금 출력</span>' +
      (accumulate === 'none' ? '' : '<span>노드 위 필: 내려가며 깊이 d, 올라오며 크기 sz</span>');
    ui.slot.appendChild(legend);

    // 캔버스보다 먼저 스텝을 만든다. ResizeObserver 가 캔버스 생성 직후 비동기로
    // redraw 를 부르는데 그때 run 이 없으면 그리다 던진다.
    var play = null;
    rebuild(false);

    function L() {
      var w = cv.size.w || 320;
      var maxFrames = model.height + 2;      // 프레임 최대 개수 = 높이 + 1, 팝 표시 한 칸
      if (!cache || cache.w !== w || cache.key !== order) {
        cache = layout(w, model, order, showStack, model.nodes.length, maxFrames);
        cache.key = order;
      }
      return cache;
    }

    // 노드 상태 → 색·표식. 우선순위: 방금 출력 > 지금 보는 것 > 스택 > 출력됨 > 보통
    function styleOf(s, id) {
      var onStack = -1;
      for (var i = 0; i < s.stack.length; i++) if (s.stack[i].u === id) onStack = s.stack[i].st;
      var isCur = (s.u === id);
      var rank = s.out.indexOf(id);
      var justOut = s.visit && isCur;

      var st = { c: null, a: 0, lw: 1.2, mark: '', rank: rank >= 0 ? rank + 1 : 0 };
      if (justOut) { st.c = 'wPath'; st.a = 0.34; st.lw = 2.6; }
      else if (isCur) { st.c = 'wFrontier'; st.a = 0.26; st.lw = 2.6; }
      else if (onStack >= 0) { st.c = 'wFrontier'; st.a = 0.10; st.lw = 1.8; }
      else if (rank >= 0) { st.c = 'wVisited'; st.a = 0.36; st.lw = 1.2; }

      if (onStack >= 0 && model.binary) st.mark = '[' + (onStack + 1) + ']';
      else if (onStack >= 0) st.mark = '·' + onStack;
      return st;
    }

    function pill(ctx, T, cx, cy, text, color, l) {
      ctx.save();
      ctx.font = (l.tiny ? 8.5 : 9.5) + 'px ui-monospace, monospace';
      var tw = ctx.measureText(text).width;
      var w = tw + 9, h = 13;
      // 불투명 바탕: 간선 위에 얹혀도 글자가 선에 그어지지 않는다.
      ctx.fillStyle = T.bg;
      rrect(ctx, cx - w / 2, cy - h / 2, w, h, 3);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, cy + 0.5);
      ctx.restore();
    }

    function box(ctx, T, x, y, w, h, text, st, l, dashed) {
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
      if (dashed) { ctx.setLineDash([3, 3]); ctx.strokeStyle = T.fgFaint; }
      ctx.stroke();
      ctx.setLineDash([]);

      var corner = l.tiny ? 8 : 9;
      ctx.font = corner + 'px ui-monospace, monospace';
      ctx.textBaseline = 'top';
      if (st.rank) {
        // 출력 순번을 노드에 직접 찍는다. 수열과 트리를 잇는 다리다.
        // '#' 를 붙이는 이유: 숫자만 찍으면 노드 값과 헷갈린다.
        ctx.fillStyle = T.fgFaint;
        ctx.textAlign = 'left';
        ctx.fillText('#' + st.rank, x + 3, y + 2);
      }
      if (st.mark) {
        ctx.fillStyle = st.c ? T[st.c] : T.fgFaint;
        ctx.textAlign = 'right';
        ctx.fillText(st.mark, x + w - 3, y + 2);
      }

      ctx.fillStyle = T.fg;
      ctx.font = '700 ' + (l.tiny ? 11 : 13) + 'px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x + w / 2, y + h - (l.tiny ? 4 : 6));
      ctx.restore();
    }

    function sectionTitle(ctx, T, l, text, x, y, align) {
      ctx.fillStyle = T.fgDim;
      ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px system-ui, sans-serif';
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x, y);
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) {
        return layout(w, model, order, showStack, model.nodes.length, model.height + 2).height;
      },
      draw: function (ctx, size, T) {
        var s = run.steps[cur];
        if (!s) return;
        var l = L();
        var ns = model.nodes;
        var i;

        ctx.textBaseline = 'alphabetic';
        sectionTitle(ctx, T, l, '트리', l.pad, l.pad + (l.tiny ? 9 : 11));
        // 좁은 화면에서는 순회 이름을 캔버스에 다시 적지 않는다. 머리말 제목에 이미 있고,
        // 루트 위 누적값 필과 자리를 다투기 때문이다.
        if (!l.narrow) sectionTitle(ctx, T, l, ORDER_FULL[order], size.w - l.pad, l.pad + (l.tiny ? 9 : 11), 'right');

        // ---- 간선 ----
        // 지금 타고 내려가거나 올라오는 간선만 강조한다. 전부 칠하면 어디가
        // 현재 경로인지 사라진다.
        for (i = 0; i < ns.length; i++) {
          var p = ns[i].parent;
          if (p < 0) continue;
          var a = nodeXY(l, model, p), b = nodeXY(l, model, i);
          var active = s.edge && ((s.edge.a === p && s.edge.b === i));
          // 스택에 부모와 자식이 함께 올라 있으면 그 간선이 곧 현재 재귀 경로다.
          var onPath = false;
          for (var q = 1; q < s.stack.length; q++) {
            if (s.stack[q].u === i && s.stack[q - 1].u === p) onPath = true;
          }
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(a.x + l.nodeW / 2, a.y + l.nodeH);
          ctx.lineTo(b.x + l.nodeW / 2, b.y);
          if (active) { ctx.strokeStyle = s.edge.dir === 'up' ? T.wVisited : T.wFrontier; ctx.lineWidth = 2.6; }
          else if (onPath) { ctx.strokeStyle = T.wFrontier; ctx.lineWidth = 1.9; ctx.globalAlpha = 0.6; }
          else { ctx.strokeStyle = T.border; ctx.lineWidth = 1.2; }
          ctx.stroke();
          ctx.restore();

          // 방금 지나간 간선에만 방향 표식을 붙인다.
          if (active) {
            var ax = a.x + l.nodeW / 2, ay = a.y + l.nodeH;
            var bx = b.x + l.nodeW / 2, by = b.y;
            var col = s.edge.dir === 'up' ? T.wVisited : T.wFrontier;
            if (l.edge >= 30) {
              // 자식 위 16px 은 누적값 필의 자리다. 그 위쪽 띠의 한가운데에 놓아
              // 두 라벨이 절대 겹치지 않게 한다.
              var py = (ay + (by - 16)) / 2;
              var tt = (by - ay) === 0 ? 0.3 : (py - ay) / (by - ay);
              pill(ctx, T, ax + (bx - ax) * tt, py,
                   order === 'level' ? '↓ 꺼냄' : (s.edge.dir === 'up' ? '↑ 복귀' : '↓ 호출'), col, l);
            } else {
              // 좁은 화면에서는 필 두 개가 들어갈 띠가 없다. 화살촉으로 방향만 준다.
              arrow(ctx, ax, ay, bx, by, s.edge.dir === 'up', col);
            }
          }
        }

        // ---- 노드 ----
        for (i = 0; i < ns.length; i++) {
          var xy = nodeXY(l, model, i);
          box(ctx, T, xy.x, xy.y, l.nodeW, l.nodeH, ns[i].label, styleOf(s, i), l, false);
        }
        // 누적값 필은 노드를 다 그린 뒤 얹는다. 박스 위 빈 띠에 놓아 간선과 겹쳐도
        // 불투명 바탕이 가려 준다.
        if (accumulate !== 'none') {
          for (i = 0; i < ns.length; i++) {
            if (s.vals[i] == null) continue;
            var v = nodeXY(l, model, i);
            var isSize = (order === 'post' && accumulate === 'size');
            pill(ctx, T, v.x + l.nodeW / 2, v.y - (l.tiny ? 8 : 9),
                 (isSize ? 'sz ' : 'd ') + s.vals[i],
                 isSize ? T.wVisited : T.fgFaint, l);
          }
        }

        // ---- 스택 / 큐 ----
        if (showStack) {
          var frames = s.stack;
          var isLevel = (order === 'level');
          if (l.sideStack) {
            // 세로 패널: 아래가 바닥(루트), 위가 top. 스택은 쌓이는 것이라 위로 자란다.
            ctx.save();
            ctx.fillStyle = T.bgCode;
            rrect(ctx, l.panelX, l.panelY, l.panelW, l.panelH, 6);
            ctx.fill();
            ctx.strokeStyle = T.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
            sectionTitle(ctx, T, l, stackTitle(), l.panelX + 9, l.panelY - 4);

            var baseY = l.panelY + l.panelH - 7 - l.frameH;
            // 빈 칸을 점선으로 남긴다. 패널 높이가 곧 "스택이 최대 트리 높이 + 1
            // 프레임까지 자란다"는 사실이고, 빈 칸이 그 여유를 보여 준다.
            ctx.save();
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = T.border;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1;
            for (i = frames.length + (s.pop ? 1 : 0); i < l.maxFrames; i++) {
              rrect(ctx, l.panelX + 8, baseY - i * (l.frameH + 4), l.panelW - 16, l.frameH, 4);
              ctx.stroke();
            }
            ctx.restore();
            for (i = 0; i < frames.length; i++) {
              var fy = baseY - i * (l.frameH + 4);
              var top = (i === frames.length - 1);
              drawFrame(ctx, T, l, l.panelX + 8, fy, l.panelW - 16, frames[i], top, false);
            }
            if (s.pop) {
              drawFrame(ctx, T, l, l.panelX + 8, baseY - frames.length * (l.frameH + 4),
                        l.panelW - 16, s.pop, false, true);
            }
            if (!frames.length && !s.pop) {
              ctx.fillStyle = T.fgFaint;
              ctx.font = (l.tiny ? 9 : 10) + 'px system-ui, sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('비어 있음', l.panelX + l.panelW / 2, l.panelY + l.panelH / 2);
            }
          } else {
            // 가로 띠: 왼쪽이 바닥(또는 큐의 앞), 오른쪽이 top(또는 큐의 뒤).
            sectionTitle(ctx, T, l, isLevel ? '큐 (왼쪽이 앞 — 여기서 꺼낸다)' : '호출 스택 (오른쪽이 top)',
                         l.pad, l.stripTop - 4);
            var items = isLevel ? (s.queue || []).map(function (u) { return { u: u, st: -1 }; }) : frames;
            var fw = Math.max(l.tiny ? 34 : 42, Math.min(l.tiny ? 52 : 74, (l.w - l.pad * 2) / Math.max(4, items.length + (s.pop ? 1 : 0))));
            var fx = l.pad;
            for (i = 0; i < items.length; i++) {
              if (fx + fw > l.w - l.pad) break;
              drawFrame(ctx, T, l, fx, l.stripTop, fw - 4, items[i], !isLevel && i === items.length - 1, false);
              fx += fw;
            }
            if (!isLevel && s.pop && fx + fw <= l.w - l.pad) {
              drawFrame(ctx, T, l, fx, l.stripTop, fw - 4, s.pop, false, true);
            }
            if (!items.length && !s.pop) {
              ctx.fillStyle = T.fgFaint;
              ctx.font = (l.tiny ? 9 : 10) + 'px system-ui, sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText('비어 있음', l.pad + 2, l.stripTop + l.stripH / 2);
            }
          }
        }
        if (l.sideStack && order === 'level') {
          // 도달할 수 없는 조합이지만, 배치가 바뀌어도 큐 이름표가 사라지지 않게 남긴다.
          sectionTitle(ctx, T, l, '큐', l.panelX + 9, l.panelY - 4);
        }

        // ---- 출력열 ----
        var cap = '출력 (' + ORDER_LABEL[order] + ' 순서)';
        if (sortedHint && order === 'in') cap += ' — 오름차순으로 나온다';
        sectionTitle(ctx, T, l, cap, l.pad, l.outTop - 4);
        var done = (s.kind === 'done');
        for (i = 0; i < model.nodes.length; i++) {
          var r = Math.floor(i / l.perRow), c = i % l.perRow;
          var cx0 = l.pad + c * (l.chipW + 4);
          var cy0 = l.outTop + r * (l.chipH + 5);
          var filled = i < s.out.length;
          var stc = { c: null, a: 0, lw: 1, mark: '', rank: 0 };
          if (filled) {
            var last = (i === s.out.length - 1);
            stc.c = done ? 'wPath' : (last ? 'wPath' : 'wVisited');
            stc.a = done ? 0.28 : (last ? 0.34 : 0.3);
            stc.lw = last ? 2.2 : 1.2;
          }
          ctx.save();
          if (!filled) ctx.globalAlpha = 0.45;
          box(ctx, T, cx0, cy0, l.chipW, l.chipH,
              filled ? model.nodes[s.out[i]].label : '·', stc, l, !filled);
          ctx.restore();
        }
      }
    });

    function drawFrame(ctx, T, l, x, y, w, f, isTop, dashed) {
      var st = {
        c: dashed ? null : (isTop ? 'wFrontier' : 'accentDim'),
        a: dashed ? 0 : (isTop ? 0.26 : 0.12),
        lw: isTop ? 2.2 : 1.2,
        mark: '',
        rank: 0
      };
      // accent-dim 은 토큰 표에 있는 값이다. 없으면 frontier 로 떨어뜨린다.
      if (st.c === 'accentDim' && !T.accentDim) st.c = 'wFrontier';
      var text = model.nodes[f.u].label;
      if (f.st >= 0 && model.binary) text += ' [' + (f.st + 1) + ']';
      else if (f.st > 0) text += ' ·' + f.st;
      ctx.save();
      ctx.fillStyle = T.bgElev;
      rrect(ctx, x, y, w, l.frameH, 4);
      ctx.fill();
      if (st.c) {
        ctx.globalAlpha = st.a;
        ctx.fillStyle = T[st.c];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = st.lw;
      ctx.strokeStyle = dashed ? T.fgFaint : (st.c ? T[st.c] : T.border);
      if (dashed) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = dashed ? T.fgFaint : T.fg;
      ctx.font = (l.tiny ? 10 : 11.5) + 'px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dashed ? text + ' ↑' : text, x + w / 2, y + l.frameH / 2 + 0.5);
      ctx.restore();
    }

    play = K.player(ui, {
      total: function () { return run.steps.length; },
      render: function (i) { cur = i; cv.redraw(); },
      label: function (i) {
        var s = run.steps[i];
        if (!s) return '';
        return '[' + ORDER_LABEL[order] + '] ' + s.msg;
      },
      speed: 640
    });

    setTitle();
    play.goto(0);

    // 테스트·디버깅용 훅. 계약상 전역 오염은 금지라 host 요소에만 붙인다.
    host.__treeTraversal = {
      order: function () { return order; },
      orders: function () { return avail.slice(); },
      setOrder: function (v) {
        var o = normOrder(v);
        if (!o || avail.indexOf(o) < 0) return false;
        order = o;
        rebuild(false);
        syncSeg();
        return true;
      },
      steps: function () { return run.steps; },
      output: function () { return run.out.map(function (u) { return model.nodes[u].label; }); },
      sizes: function () { return run.sizes.slice(); },
      nodes: function () { return model.nodes; },
      model: function () { return model; },
      maxStackDepth: function () {
        var m = 0;
        for (var i = 0; i < run.steps.length; i++) m = Math.max(m, run.steps[i].stack.length);
        return m;
      },
      goto: function (i) { play.goto(i); },
      layout: function () { return L(); }
    };
  });
})();
