/* bloom-filter.js — "없다"는 항상 옳다, "있다"는 틀릴 수 있다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   블룸 필터의 오류는 **한 방향으로만** 난다. 조회한 k개 칸 중 하나라도
 *   꺼져 있으면 그 원소는 확실히 넣은 적이 없다. k개가 전부 켜져 있어도
 *   넣었다는 보장은 없다 — 다른 원소들이 우연히 그 칸들을 채웠을 수 있다.
 *
 * 왜 비트 배열 그림과 거짓양성 표시를 같이 두는가
 *   "비트가 켜진다"는 삽입 애니메이션만으로는 비대칭이 안 보인다. 조회
 *   결과가 "확실히 없음"인지 "아마 있음(틀릴 수 있음)"인지 다른 색으로
 *   갈라야, 왜 삭제를 지원할 수 없는지(비트 하나가 여러 원소를 겸업한다)
 *   가 화면에서 바로 보인다.
 *
 * ── opts (챕터가 넘기는 것) ──────────────────────────────────────────────
 *   m       : 비트 배열 크기 (기본 40)
 *   k       : 해시 함수 개수 (기본 3)
 *   items   : 삽입할 원소들 (문자열 배열)
 *   query   : 조회할 원소 (문자열)
 *   mode    : "insert-then-query" (기본) — items 를 전부 넣은 뒤 query 를 조회
 *   show    : ["bits","hashPositions","falsePositive"] 중 원하는 것. 기본 전부
 */
(function () {
  'use strict';
  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  function isArr(v) { return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string'; }
  function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.max(lo, Math.min(hi, n)); }

  // FNV-1a 64비트 — 챕터 본문의 dual 코드와 같은 해시. 솔트 "i#item" 으로 k개의 독립된 칸을 만든다.
  // JS Number 는 64비트 정수를 정확히 표현 못 하므로 BigInt 를 쓴다.
  var FNV_PRIME = 0x100000001b3n;
  var FNV_OFFSET = 0xcbf29ce484222325n;
  var MASK64 = 0xFFFFFFFFFFFFFFFFn;
  function fnv1a64(s) {
    var h = FNV_OFFSET;
    for (var i = 0; i < s.length; i++) {
      h ^= BigInt(s.charCodeAt(i) & 0xff);
      h = (h * FNV_PRIME) & MASK64;
    }
    return h;
  }
  function positions(item, m, k) {
    var out = [];
    for (var i = 0; i < k; i++) out.push(Number(fnv1a64(i + '#' + item) % BigInt(m)));
    return out;
  }

  function run(m, k, items, query) {
    var bits = new Array(m).fill(0);
    var steps = [];

    function snap(kind, note, extra) {
      var s = { kind: kind, bits: bits.slice(), note: note };
      if (extra) for (var kk in extra) s[kk] = extra[kk];
      steps.push(s);
    }
    snap('init', '비트 배열 m=' + m + '칸, 전부 0. k=' + k + '개의 해시로 원소마다 ' + k + '칸을 켠다.');

    items.forEach(function (it) {
      var pos = positions(it, m, k);
      var newlySet = [];
      pos.forEach(function (p) { if (!bits[p]) newlySet.push(p); bits[p] = 1; });
      snap('insert', 'insert("' + it + '") — 칸 [' + pos.join(', ') + ']을 켠다' +
        (newlySet.length < pos.length ? ' (이미 켜진 칸과 겹침: ' + (pos.length - newlySet.length) + '개)' : '') + '.',
        { item: it, pos: pos });
    });

    var qPos = positions(query, m, k);
    var allSet = qPos.every(function (p) { return bits[p] === 1; });
    var actuallyInserted = items.indexOf(query) >= 0;
    var isFalsePositive = allSet && !actuallyInserted;
    snap('query',
      'query("' + query + '") — 칸 [' + qPos.join(', ') + '] 확인. ' +
      (allSet
        ? (isFalsePositive
          ? '전부 켜져 있다 — 하지만 넣은 적이 없다. **거짓양성.**'
          : '전부 켜져 있다 — "아마 있음" (실제로 넣었다).')
        : '하나 이상 꺼져 있다 — "확실히 없음".'),
      { pos: qPos, allSet: allSet, actuallyInserted: actuallyInserted, isFalsePositive: isFalsePositive });

    return { steps: steps, isFalsePositive: isFalsePositive, allSet: allSet, actuallyInserted: actuallyInserted };
  }

  K.register('bloom-filter', function (host, opts) {
    var m = clampInt(opts.m, 8, 200, 40);
    var k = clampInt(opts.k, 1, 8, 3);
    var items = isArr(opts.items) ? opts.items.slice(0, 12).map(String) : ['cat', 'dog', 'bird'];
    var query = (typeof opts.query === 'string') ? opts.query : 'rat';
    var show = isArr(opts.show) ? opts.show.map(String) : ['bits', 'hashPositions', 'falsePositive'];
    var has = function (x) { return show.indexOf(x) >= 0; };

    var data = run(m, k, items, query);
    var ui = K.frame(host, { title: '블룸 필터 — "없다"는 항상 옳다, "있다"는 틀릴 수 있다' });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items2 = [['꺼짐(0)', T.bgElev], ['켜짐(1)', T.wFrontier], ['이번 스텝이 켠 칸', T.accent], ['거짓양성', T.boxDanger]];
      var el = K.el('div', 'wk-legend');
      items2.forEach(function (it) {
        var sp = K.el('span'), ic = K.el('i');
        ic.style.background = it[1];
        sp.appendChild(ic); sp.appendChild(document.createTextNode(it[0]));
        el.appendChild(sp);
      });
      ui.slot.appendChild(el);
      K.onThemeChange(function () {
        var T2 = K.tokens(ui.stage);
        var cs = [T2.bgElev, T2.wFrontier, T2.accent, T2.boxDanger];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (n, kk) { n.style.background = cs[kk]; });
      });
    })();

    var PAD = 12;

    function layout(w) {
      var inner = Math.max(240, w - PAD * 2);
      var perRow = Math.max(8, Math.floor(inner / 22));
      var rows = Math.ceil(m / perRow);
      var cell = Math.min(28, Math.floor(inner / perRow));
      return { inner: inner, perRow: perRow, rows: rows, cell: cell, x0: PAD, height: PAD + rows * (cell + 4) + 50 + PAD };
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = data.steps[Math.min(i, data.steps.length - 1)];
      var curPos = st.pos || [];
      var isFP = st.kind === 'query' && st.isFalsePositive;

      ctx.save();
      for (var b = 0; b < m; b++) {
        var row = Math.floor(b / l.perRow), col = b % l.perRow;
        var x = l.x0 + col * (l.cell + 2), y = PAD + row * (l.cell + 4);
        var isTouched = curPos.indexOf(b) >= 0;
        var fill = st.bits[b] ? T.wFrontier : T.bgElev;
        var stroke = T.border, thick = false;
        if (isTouched) {
          thick = true;
          if (st.kind === 'query') { stroke = isFP ? T.boxDanger : (st.allSet ? T.wPath : T.boxDanger); fill = isFP ? T.boxDanger : fill; }
          else { stroke = T.accent; fill = T.accent; }
        }
        ctx.fillStyle = fill; ctx.fillRect(x, y, l.cell - 2, l.cell - 2);
        ctx.strokeStyle = stroke; ctx.lineWidth = thick ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, l.cell - 3, l.cell - 3);
        if (l.cell >= 16) {
          ctx.fillStyle = st.bits[b] ? T.bg : T.fgFaint;
          ctx.font = '9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(b), x + l.cell / 2 - 1, y + l.cell / 2 - 1);
        }
      }
      var yEnd = PAD + l.rows * (l.cell + 4) + 8;
      ctx.restore();

      ctx.save();
      ctx.font = '600 12px ' + FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      if (st.kind === 'query') {
        ctx.fillStyle = isFP ? T.boxDanger : (st.allSet ? T.wPath : T.fg);
      } else {
        ctx.fillStyle = T.fgDim;
      }
      var lines = wrapText(ctx, st.note.replace(/\*\*/g, ''), size.w - PAD * 2);
      lines.forEach(function (t, idx) { ctx.fillText(t, l.x0, yEnd + idx * 15); });
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
      label: function (i) { return data.steps[Math.min(i, data.steps.length - 1)].note.replace(/\*\*/g, '') || ''; }
    });
    play.draw();

    host.__widget = {
      isFalsePositive: function () { return data.isFalsePositive; },
      allSet: function () { return data.allSet; },
      steps: function () { return data.steps.length; },
      goto: function (i) { play.goto(i); },
      positions: function (item) { return positions(item, m, k); }
    };
  });
})();
