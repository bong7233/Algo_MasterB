/* skiplist.js — 고속도로와 국도, 위층은 성기고 한 걸음에 멀리 간다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **균형을 계산이 아니라 동전 던지기로 맞춘다.** 회전이 없다 — 삽입은
 *   그 값이 몇 층까지 올라가는지 동전으로 정한 뒤, 그 층까지 포인터
 *   두 개씩만 잇는 것으로 끝난다. 탐색은 맨 위층에서 시작해 다음 노드가
 *   찾는 값보다 크거나 없으면 한 층 내려온다.
 *
 * 왜 탑(세로 막대) 그림인가
 *   각 키가 몇 층까지 올라갔는지가 이 구조 전체다. 층마다 원소가 절반씩
 *   줄어드는 것이 눈으로 보여야 "왜 위층이 고속도로인가"가 손에 잡힌다.
 *   탐색 경로는 위층에서 시작해 계단식으로 내려오는 꺾은선으로 그린다 —
 *   그 모양 자체가 O(log n) 의 근거다.
 *
 * ── opts (챕터가 넘기는 것) ──────────────────────────────────────────────
 *   levels : 최대 층수 (기본 4, 0층 포함)
 *   p      : 문서화용(현재 계산은 xorshift 1비트 = p=0.5 고정)
 *   keys   : 삽입할 키 배열(오름차순 여부 무관, 삽입 순서대로 넣는다)
 *   query  : 탐색할 키
 *   seed   : xorshift32 시드. 본문 dual 코드와 정확히 같은 RNG 로 레벨을
 *            뽑는다 — 그래야 본문이 손추적한 결과와 위젯이 일치한다.
 *   show   : ["towers","searchPath","hopCounter"] 중 원하는 것. 기본 전부
 */
(function () {
  'use strict';
  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  var MASK32 = 0xFFFFFFFF;

  function isArr(v) { return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string'; }
  function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.max(lo, Math.min(hi, n)); }

  // 본문 dual 코드와 동일한 xorshift32 — 재현성을 위한 장치(챕터 §4 주석과 같은 이유).
  function makeXorshift(seed) {
    var state = seed >>> 0;
    return function bit() {
      var x = state;
      x = (x ^ (x << 13)) & MASK32;
      x = (x ^ (x >>> 17)) & MASK32;
      x = (x ^ (x << 5)) & MASK32;
      state = x >>> 0;
      return state & 1;
    };
  }

  function run(maxLevel, keys, query, seed) {
    var bit = makeXorshift(seed >>> 0);
    function randomLevel() {
      var lv = 0;
      while (lv < maxLevel && bit() === 1) lv++;
      return lv;
    }

    // 리스트: levels[l] = 정렬된 키 배열(그 층에 존재하는 키만).
    var levelArr = [];
    for (var i = 0; i <= maxLevel; i++) levelArr.push([]);
    var keyLevel = {};   // key -> 도달 레벨

    var steps = [];
    function snap(kind, note, extra) {
      var s = { kind: kind, levels: levelArr.map(function (a) { return a.slice(); }), note: note };
      if (extra) for (var k in extra) s[k] = extra[k];
      steps.push(s);
    }
    snap('init', '빈 스킵 리스트. 최대 ' + maxLevel + '층(0층 포함), 동전 앞면 확률 1/2.');

    keys.forEach(function (key) {
      var lv = randomLevel();
      keyLevel[key] = lv;
      for (var l = 0; l <= lv; l++) {
        var arr = levelArr[l];
        var pos = 0;
        while (pos < arr.length && arr[pos] < key) pos++;
        arr.splice(pos, 0, key);
      }
      snap('insert', key + ' 삽입 — 동전이 레벨 ' + lv + '까지 올렸다. 0층부터 ' + lv + '층까지 끼워 넣는다.', { key: key, level: lv });
    });

    // 탐색: 맨 위층에서 시작, 오른쪽으로 갈 수 있으면 가고 아니면 한 층 내려온다.
    var path = [];   // [{level, at}] — at 은 그 층에서 멈춘 위치의 키(또는 null=시작)
    var cur = null;
    var found = false;
    for (var l = maxLevel; l >= 0; l--) {
      var arr = levelArr[l];
      var idx = 0;
      // cur 보다 큰 것부터 시작 지점을 잡는다.
      while (idx < arr.length && arr[idx] <= (cur == null ? -Infinity : cur)) idx++;
      while (idx < arr.length && arr[idx] < query) { cur = arr[idx]; path.push({ level: l, at: cur, hop: true }); idx++; }
      path.push({ level: l, at: cur, hop: false, dropDown: l > 0 });
      if (idx < arr.length && arr[idx] === query) { found = true; cur = query; path.push({ level: l, at: query, hop: true, matched: true }); break; }
    }

    snap('search-init', 'query(' + query + ') — 맨 위층(' + maxLevel + '층)에서 시작.', { path: [], query: query });
    var acc = [];
    path.forEach(function (p) {
      acc = acc.concat([p]);
      var msg;
      if (p.matched) msg = query + ' 발견 — ' + p.level + '층에서 일치.';
      else if (p.hop) msg = p.level + '층에서 ' + p.at + '로 이동 (다음이 ' + query + '보다 작거나 같다).';
      else msg = p.level + '층에서 더 못 간다 — 한 층 내려온다.';
      snap('search', msg, { path: acc.slice(), query: query });
    });
    snap('done', 'query(' + query + ') 결과: ' + (found ? '존재함' : '없음') + '. 홉 수 ' + path.filter(function (p) { return p.hop; }).length + '.',
      { path: acc.slice(), query: query, found: found });

    return { steps: steps, keyLevel: keyLevel, found: found, hops: path.filter(function (p) { return p.hop; }).length };
  }

  K.register('skiplist', function (host, opts) {
    var maxLevel = clampInt(opts.levels, 1, 8, 4);
    var keys = isArr(opts.keys) ? opts.keys.map(Number).filter(isFinite).slice(0, 30) : [3, 6, 7, 9, 12];
    var query = isFinite(Number(opts.query)) ? Number(opts.query) : keys[Math.floor(keys.length / 2)];
    var seed = (typeof opts.seed === 'number' && isFinite(opts.seed)) ? (opts.seed >>> 0) : 88172645463325252;
    if (!(typeof opts.seed === 'number')) {
      // 시드가 32비트를 넘는 정수(예: 본문의 88172645463325252)로 넘어오면 하위 32비트만 쓴다.
      seed = Number(BigInt(Math.trunc(opts.seed || 88172645463325252)) & 0xFFFFFFFFn);
    }

    var data = run(maxLevel, keys, query, seed);
    var ui = K.frame(host, { title: '스킵 리스트 — 고속도로와 국도, 위층은 성기고 한 걸음에 멀리 간다' });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['노드', T.wFrontier], ['방금 삽입', T.accent], ['탐색 경로', T.wPath], ['찾음', T.wGoal]];
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
        var cs = [T2.wFrontier, T2.accent, T2.wPath, T2.wGoal];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (n, k) { n.style.background = cs[k]; });
      });
    })();

    var PAD = 12, ROW_H = 30;
    var allKeys = keys.slice().sort(function (a, b) { return a - b; });

    function layout(w) {
      var inner = Math.max(240, w - PAD * 2);
      var cellW = Math.max(30, Math.min(56, inner / Math.max(1, allKeys.length)));
      return { inner: inner, cellW: cellW, x0: PAD, height: PAD + (maxLevel + 1) * ROW_H + 40 + PAD };
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = data.steps[Math.min(i, data.steps.length - 1)];
      var pathSet = {};
      (st.path || []).forEach(function (p) { pathSet[p.level + ':' + p.at] = p.matched ? 'match' : 'path'; });

      ctx.save();
      for (var lv = maxLevel; lv >= 0; lv--) {
        var y = PAD + (maxLevel - lv) * ROW_H + 14;
        ctx.font = '10px ' + MONO; ctx.fillStyle = T.fgFaint;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(lv + '층', l.x0 - 4 + 24, y);

        var arr = st.levels[lv];
        // 가로선(그 층의 연결)
        ctx.strokeStyle = T.border; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(l.x0 + 26, y); ctx.lineTo(l.x0 + 26 + allKeys.length * l.cellW, y); ctx.stroke();

        allKeys.forEach(function (k, ki) {
          if (arr.indexOf(k) < 0) return;
          var x = l.x0 + 26 + ki * l.cellW + l.cellW / 2;
          var isNew = st.kind === 'insert' && st.key === k && lv <= st.level;
          var pk = pathSet[lv + ':' + k];
          var fill = T.wFrontier, r = 5;
          if (isNew) fill = T.accent;
          if (pk === 'path') fill = T.wPath;
          if (pk === 'match') { fill = T.wGoal; r = 7; }
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = fill; ctx.fill();
          if (lv === 0) {
            ctx.font = '10px ' + MONO; ctx.fillStyle = T.fgDim;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(String(k), x, y + 10);
          }
        });
      }
      ctx.restore();

      var yEnd = PAD + (maxLevel + 1) * ROW_H + 14;
      ctx.save();
      ctx.font = '11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = st.kind === 'done' ? (st.found ? T.wPath : T.boxDanger) : T.fgDim;
      var lines = wrapText(ctx, st.note, size.w - PAD * 2);
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
      label: function (i) { return data.steps[Math.min(i, data.steps.length - 1)].note || ''; }
    });
    play.draw();

    host.__widget = {
      keyLevel: function () { return Object.assign({}, data.keyLevel); },
      found: function () { return data.found; },
      hops: function () { return data.hops; },
      steps: function () { return data.steps.length; },
      goto: function (i) { play.goto(i); }
    };
  });
})();
