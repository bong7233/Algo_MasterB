/* lsm-compaction.js — 다시 읽고 다시 쓰기가 쓰기 증폭의 실체다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **LSM은 제자리 갱신을 하지 않는다.** 같은 키를 다시 쓰면 새 조각에
 *   새 값이 들어갈 뿐이고, 옛 값은 나중에 컴팩션이 조각들을 다시 읽어
 *   합칠 때에야 버려진다. 그 "다시 읽고 다시 쓰기"가 쓰기 증폭이다.
 *
 * 왜 증폭 카운터가 조각 그림보다 중요한가
 *   조각이 합쳐지는 애니메이션은 예쁘지만, 이 구조의 대가는 숫자로만
 *   보인다 — 논리 쓰기 수 대비 디스크에 실제로 쓰인 항목 수. 그 비율이
 *   1보다 커지는 순간(컴팩션이 옛 값을 다시 쓰는 순간)이 이 위젯의 핵심이다.
 *
 * ── opts (챕터가 넘기는 것) ──────────────────────────────────────────────
 *   memtableCap    : 정수 (기본 2) — memtable 이 몇 개 키를 담으면 플러시하는가
 *   l0Threshold    : 정수 (기본 2) — L0 조각이 몇 개 쌓이면 컴팩션하는가
 *   ops            : [["put",key,value], ...]
 *   showAmplification : true(기본) — 쓰기 증폭 배율을 하단에 표시
 */
(function () {
  'use strict';
  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  var MAX_OPS = 40;

  function isArr(v) { return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string'; }
  function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.max(lo, Math.min(hi, n)); }
  function truthy(v, d) { return v === undefined || v === null ? d : !!v; }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* memtable → L0 조각 여러 개 → 컴팩션으로 L1 하나. 최신 값이 이긴다.
   * 논리 쓰기 수와 디스크에 실제로 쓰인 항목 수를 둘 다 센다 — 그 비가 쓰기 증폭이다. */
  function run(memCap, l0Threshold, ops) {
    var memtable = [];             // [{k,v}], 삽입 순서 유지, 같은 키는 갱신
    var l0 = [];                   // [{id, entries:[{k,v}]}]
    var l1 = null;                 // {id, entries:[{k,v}]} | null
    var nextId = 1;
    var logicalWrites = 0;
    var diskWrites = 0;

    var steps = [];
    function memPut(k, v) {
      var found = false;
      for (var i = 0; i < memtable.length; i++) if (memtable[i].k === k) { memtable[i].v = v; found = true; break; }
      if (!found) memtable.push({ k: k, v: v });
    }
    function sortedEntries(arr) { return arr.slice().sort(function (a, b) { return a.k - b.k; }); }

    function snapshot(kind, note, extra) {
      var s = {
        kind: kind, note: note,
        memtable: memtable.map(function (e) { return { k: e.k, v: e.v }; }),
        l0: l0.map(function (t) { return { id: t.id, entries: t.entries.map(function (e) { return { k: e.k, v: e.v }; }) }; }),
        l1: l1 ? { id: l1.id, entries: l1.entries.map(function (e) { return { k: e.k, v: e.v }; }) } : null,
        logicalWrites: logicalWrites, diskWrites: diskWrites
      };
      if (extra) for (var k in extra) s[k] = extra[k];
      steps.push(s);
    }

    snapshot('init', '빈 상태. memtableCap=' + memCap + ', l0Threshold=' + l0Threshold + '.');

    ops.forEach(function (op) {
      var k = op[1], v = op[2];
      logicalWrites += 1;
      memPut(k, v);
      snapshot('put', 'put(' + k + ', ' + v + ') — memtable 에 반영. memtable ' + memtable.length + '/' + memCap + '.');

      if (memtable.length >= memCap) {
        var entries = sortedEntries(memtable);
        var t = { id: nextId++, entries: entries };
        l0.push(t);
        diskWrites += entries.length;
        memtable = [];
        snapshot('flush', 'memtable 가 가득 차 T' + t.id + '로 플러시 — 정렬해 디스크에 순차로 통째 쓴다. 디스크 쓰기 누적 ' + diskWrites + '.', { flushedId: t.id });

        if (l0.length >= l0Threshold) {
          // 컴팩션: L0 조각 전부(+기존 L1)를 다시 읽어 병합, 같은 키는 더 나중(더 오른쪽) 조각이 이긴다.
          var merging = l0.slice();
          var mergedFrom = merging.map(function (t2) { return t2.id; });
          if (l1) { merging = [l1].concat(merging); mergedFrom = [l1.id].concat(mergedFrom); }
          var byKey = {};
          var order = [];
          merging.forEach(function (t2) {
            t2.entries.forEach(function (e) {
              if (!(e.k in byKey)) order.push(e.k);
              byKey[e.k] = e.v;    // 나중 조각이 이긴다(더 최신)
            });
          });
          var mergedEntries = sortedEntries(order.map(function (k2) { return { k: k2, v: byKey[k2] }; }));
          var readCount = merging.reduce(function (s, t2) { return s + t2.entries.length; }, 0);
          diskWrites += mergedEntries.length;   // 컴팩션이 다시 쓴 만큼도 디스크 쓰기다 — 이것이 증폭의 실체
          var droppedCount = readCount - mergedEntries.length;
          l0 = [];
          l1 = { id: nextId++, entries: mergedEntries };
          snapshot('compact',
            '컴팩션 — T' + mergedFrom.join(', T') + '을 다시 읽어(' + readCount + '항목) 병합, ' +
            droppedCount + '개의 옛 값을 버리고 L1=' + mergedEntries.length + '항목으로 다시 쓴다. 디스크 쓰기 누적 ' + diskWrites + '.',
            { compactedFrom: mergedFrom, mergedInto: l1.id });
        }
      }
    });

    snapshot('done', '연산 ' + ops.length + '개 완료. 논리 쓰기 ' + logicalWrites + ' 대 디스크 쓰기 ' + diskWrites + '.');
    return { steps: steps, logicalWrites: logicalWrites, diskWrites: diskWrites };
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('lsm-compaction', function (host, opts) {
    var memCap = clampInt(opts.memtableCap, 1, 8, 2);
    var l0Threshold = clampInt(opts.l0Threshold, 1, 8, 2);
    var wantAmp = truthy(opts.showAmplification, true);

    var rawOps = isArr(opts.ops) ? opts.ops : [];
    var ops = [];
    for (var i = 0; i < rawOps.length && ops.length < MAX_OPS; i++) {
      var o = rawOps[i];
      if (!isArr(o) || o.length < 3) continue;
      var k = parseInt(o[1], 10);
      if (isFinite(k)) ops.push(['put', k, String(o[2])]);
    }
    if (!ops.length) ops = [['put', 1, 'a'], ['put', 2, 'b']];

    var title = 'LSM Tree — 다시 읽고 다시 쓰기가 쓰기 증폭의 실체다';
    if (isArr(opts.ops) && opts.ops.length > ops.length) title += '  ·  연산이 많아 앞 ' + ops.length + '개만 재생';

    var data = run(memCap, l0Threshold, ops);
    var ui = K.frame(host, { title: title });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['memtable', T.wStart], ['L0 조각', T.wFrontier], ['L1(컴팩션됨)', T.accent], ['컴팩션 중', T.boxDanger]];
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
        var cs = [T2.wStart, T2.wFrontier, T2.accent, T2.boxDanger];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (n, k2) { n.style.background = cs[k2]; });
      });
    })();

    var PAD = 12, ROW_H = 30;

    function tableBox(ctx, T, x, y, w, entries, opts2) {
      var h = ROW_H;
      rrect(ctx, x, y, w, h, 4);
      ctx.fillStyle = opts2.fill; ctx.fill();
      ctx.strokeStyle = opts2.stroke || T.border; ctx.lineWidth = opts2.thick ? 2 : 1; ctx.stroke();
      ctx.fillStyle = opts2.text || T.fg;
      ctx.font = (opts2.thick ? '600 ' : '') + '11px ' + MONO;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var label = opts2.label ? opts2.label + ': ' : '';
      var body = entries.map(function (e) { return e.k + '=' + e.v; }).join(', ');
      ctx.fillText(label + '[' + body + ']', x + w / 2, y + h / 2);
    }

    function layout(w) {
      var inner = Math.max(240, w - PAD * 2);
      return { inner: inner, x0: PAD, rowW: inner, height: PAD + ROW_H * 4 + 20 + (wantAmp ? 40 : 0) + PAD };
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = data.steps[Math.min(i, data.steps.length - 1)];
      var y = PAD;

      // memtable
      tableBox(ctx, T, l.x0, y, l.rowW, st.memtable, {
        fill: T.bgElev, stroke: T.wStart, label: 'memtable',
        thick: st.kind === 'put'
      });
      y += ROW_H + 8;

      // L0
      if (st.l0.length) {
        var eachW = Math.min(180, (l.rowW - 8 * (st.l0.length - 1)) / st.l0.length);
        var x = l.x0;
        st.l0.forEach(function (t) {
          var isCompacting = st.kind === 'compact' && st.compactedFrom && st.compactedFrom.indexOf(t.id) >= 0;
          var justFlushed = st.kind === 'flush' && st.flushedId === t.id;
          tableBox(ctx, T, x, y, eachW, t.entries, {
            fill: T.bgElev, stroke: isCompacting ? T.boxDanger : T.wFrontier,
            label: 'T' + t.id, thick: isCompacting || justFlushed
          });
          x += eachW + 8;
        });
      } else {
        ctx.font = '11px ' + FONT; ctx.fillStyle = T.fgFaint; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('L0 비어 있음', l.x0 + 4, y + ROW_H / 2);
      }
      y += ROW_H + 8;

      // L1
      if (st.l1) {
        var isBeingWritten = st.kind === 'compact' && st.mergedInto === st.l1.id;
        tableBox(ctx, T, l.x0, y, l.rowW, st.l1.entries, {
          fill: isBeingWritten ? T.accent : T.bgElev, stroke: T.accent,
          text: isBeingWritten ? T.bg : T.fg, label: 'L1', thick: true
        });
      } else {
        ctx.font = '11px ' + FONT; ctx.fillStyle = T.fgFaint; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('L1 비어 있음', l.x0 + 4, y + ROW_H / 2);
      }
      y += ROW_H + 16;

      if (wantAmp) {
        var amp = st.diskWrites > 0 && st.logicalWrites > 0 ? (st.diskWrites / st.logicalWrites) : 1;
        ctx.save();
        ctx.font = '11px ' + FONT; ctx.fillStyle = T.fgFaint; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        var items = [
          ['논리 쓰기', st.logicalWrites, T.fg],
          ['디스크 쓰기', st.diskWrites, T.fg],
          ['증폭', amp.toFixed(2) + '×', amp > 1 ? T.boxDanger : T.fgFaint]
        ];
        var x2 = l.x0;
        items.forEach(function (it) {
          ctx.font = '11px ' + FONT; ctx.fillStyle = T.fgFaint;
          ctx.fillText(it[0], x2, y);
          var lw = ctx.measureText(it[0]).width;
          ctx.font = '600 14px ' + MONO; ctx.fillStyle = it[2];
          ctx.fillText(String(it[1]), x2 + lw + 6, y);
          x2 += lw + 6 + ctx.measureText(String(it[1])).width + 24;
        });
        ctx.restore();
      }
    }

    var cv = K.canvas(ui.stage, { height: function (w) { return layout(w).height; }, draw: draw });
    var play = K.player(ui, {
      total: function () { return data.steps.length; },
      render: function () { cv.redraw(); },
      label: function (i) { return data.steps[Math.min(i, data.steps.length - 1)].note || ''; }
    });
    play.draw();

    host.__widget = {
      logicalWrites: function () { return data.logicalWrites; },
      diskWrites: function () { return data.diskWrites; },
      amplification: function () { return data.diskWrites / data.logicalWrites; },
      steps: function () { return data.steps.length; },
      goto: function (i) { play.goto(i); },
      finalL1: function () { var s = data.steps[data.steps.length - 1]; return s.l1 ? s.l1.entries.map(function (e) { return [e.k, e.v]; }) : []; }
    };
  });
})();
