/* cache-policy.js — LRU에게는 "방금 한 번 쓰고 안 쓸 것"과 "곧 또 쓸 것"이 구분되지 않는다
 *
 * 이 위젯이 가르치려는 단 하나:
 *   순환 스캔이 캐시보다 크면 LRU는 핫 키를 방어하지 못한다. 스캔 키를
 *   한 번 쓰는 것도 "방금 사용"으로 잡혀 핫 키보다 우선권을 갖기 때문이다.
 *   LFU는 빈도를 보므로 핫 키가 한 번 벌어진 뒤로는 스캔에 안 밀린다.
 *
 * 왜 낱개 접근이 아니라 사이클 단위로 재생하는가
 *   본문의 트레이스는 부트스트랩 + 20사이클 × (핫 5 + 스캔 40) = 910회
 *   접근이다. 낱개로 스텝을 만들면 900개가 넘어 재생기 자체가 못 쓰게
 *   된다. 사이클 하나(핫 키 전부 + 그 사이클의 스캔 전부)를 한 스텝으로
 *   묶어도 "핫 히트율이 사이클마다 어떻게 벌어지는가"라는 이 위젯의
 *   논지는 그대로 남는다 — 그 벌어짐이 곡선으로 보인다.
 *
 * ── opts (챕터가 넘기는 것) ──────────────────────────────────────────────
 *   policies : ["lru","lfu"] 중 비교할 것들 (기본 둘 다)
 *   capacity : 캐시 용량 (기본 20)
 *   trace    : 이름 붙은 접근 패턴. "hot5-scan40x20" = 핫키 5개, 20사이클,
 *              사이클당 스캔 40개(본문 §4 build_trace 와 동일 규칙)
 *   metric   : "hot-only"(기본, 핫 키 기준 히트율) | "overall"
 */
(function () {
  'use strict';
  var K = window.WidgetKit;
  if (!K) return;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  function isArr(v) { return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string'; }
  function clampInt(v, lo, hi, d) { var n = parseInt(v, 10); if (!isFinite(n)) return d; return Math.max(lo, Math.min(hi, n)); }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function parseTrace(name) {
    // "hot5-scan40x20" -> hot=5, scanLen=40, cycles=20
    var m = /hot(\d+)-scan(\d+)x(\d+)/.exec(String(name || ''));
    if (m) return { hot: +m[1], scanLen: +m[2], cycles: +m[3] };
    return { hot: 5, scanLen: 40, cycles: 20 };
  }

  // ─── 캐시 구현. 정확한 LRU/LFU여야 한다 — 결과를 지어내지 않는다. ─────────

  function LRUCache(cap) {
    this.cap = cap;
    this.order = [];   // 앞이 MRU
    this.set = {};
    this.hits = 0; this.misses = 0;
  }
  LRUCache.prototype.access = function (key) {
    var idx = this.order.indexOf(key);
    if (idx >= 0) {
      this.hits++;
      this.order.splice(idx, 1); this.order.unshift(key);
      return true;
    }
    this.misses++;
    this.order.unshift(key); this.set[key] = true;
    if (this.order.length > this.cap) { var ev = this.order.pop(); delete this.set[ev]; }
    return false;
  };
  LRUCache.prototype.snapshot = function () { return this.order.slice(0, this.cap); };

  function LFUCache(cap) {
    this.cap = cap;
    this.freq = {};    // key -> count
    this.keys = [];    // 존재하는 키(순서 무관, 표시용 삽입 순서 근사 유지)
    this.hits = 0; this.misses = 0;
  }
  LFUCache.prototype.access = function (key) {
    if (key in this.freq) {
      this.hits++;
      this.freq[key]++;
      return true;
    }
    this.misses++;
    if (this.keys.length >= this.cap) {
      // 최저 빈도를 축출. 동률이면 keys 배열의 앞(더 먼저 들어온 것)을 버린다.
      var minKey = null, minF = Infinity;
      for (var i = 0; i < this.keys.length; i++) {
        var f = this.freq[this.keys[i]];
        if (f < minF) { minF = f; minKey = this.keys[i]; }
      }
      delete this.freq[minKey];
      this.keys.splice(this.keys.indexOf(minKey), 1);
    }
    this.keys.push(key);
    this.freq[key] = 1;
    return false;
  };
  LFUCache.prototype.snapshot = function () {
    return this.keys.slice().sort(function (a, b) { return this.freq[b] - this.freq[a]; }.bind(this))
      .map(function (k) { return { key: k, freq: this.freq[k] }; }.bind(this));
  };

  var IMPL = { lru: LRUCache, lfu: LFUCache };
  var LABEL = { lru: 'LRU', lfu: 'LFU' };

  function run(policies, cap, hotKeys, cycles, scanLen) {
    var caches = {};
    policies.forEach(function (p) { caches[p] = new IMPL[p](cap); });
    var hotSet = {};
    hotKeys.forEach(function (h) { hotSet[h] = true; });

    var hotHits = {}, hotTotal = 0;
    policies.forEach(function (p) { hotHits[p] = 0; });

    var steps = [];
    function snap(kind, note, extra) {
      var contents = {};
      policies.forEach(function (p) { contents[p] = caches[p].snapshot(); });
      var hitRate = {};
      policies.forEach(function (p) { hitRate[p] = hotTotal > 0 ? hotHits[p] / hotTotal : 0; });
      var s = { kind: kind, note: note, contents: contents, hotHits: Object.assign({}, hotHits), hotTotal: hotTotal, hitRate: hitRate };
      if (extra) for (var k in extra) s[k] = extra[k];
      steps.push(s);
    }

    snap('init', '용량 ' + cap + '. 핫 키 ' + hotKeys.length + '개, ' + cycles + '사이클, 사이클당 스캔 ' + scanLen + '개.');

    // 부트스트랩: 핫 키를 두 번씩 찍어 빈도 2를 만든다(LFU가 스캔보다 앞서게).
    // 본문 §4 run() 은 부트스트랩 접근도 핫 키 히트율 분모에 포함한다 — 첫 접근은
    // 미스, 두 번째 접근은 히트이므로 히트율 계산을 거기 맞춰야 본문 수치와 일치한다.
    hotKeys.forEach(function (h) {
      policies.forEach(function (p) {
        var h1 = caches[p].access(h);
        if (h1) hotHits[p]++;
        var h2 = caches[p].access(h);
        if (h2) hotHits[p]++;
      });
    });
    hotTotal += 2 * hotKeys.length;
    snap('bootstrap', '부트스트랩 — 핫 키를 두 번씩 찍어 빈도 2를 만든다(LFU 전용 장치, LRU엔 무해).');

    for (var c = 0; c < cycles; c++) {
      hotTotal += hotKeys.length;
      hotKeys.forEach(function (h) {
        policies.forEach(function (p) {
          var wasHit = caches[p].access(h);
          if (wasHit) hotHits[p]++;
        });
      });
      for (var i = 0; i < scanLen; i++) {
        var sk = 'scan' + (c * scanLen + i);
        policies.forEach(function (p) { caches[p].access(sk); });
      }
      snap('cycle', '사이클 ' + (c + 1) + '/' + cycles + ' — 핫 키 ' + hotKeys.length + '개 + 스캔 ' + scanLen + '개.', { cycle: c + 1 });
    }

    var final = {};
    policies.forEach(function (p) {
      final[p] = { hits: caches[p].hits, misses: caches[p].misses, hotHitRate: hotTotal > 0 ? hotHits[p] / hotTotal : 0 };
    });
    snap('done', '완료. ' + policies.map(function (p) { return LABEL[p] + ' 핫 히트율 ' + (final[p].hotHitRate * 100).toFixed(1) + '%'; }).join(', ') + '.');

    return { steps: steps, final: final };
  }

  K.register('cache-policy', function (host, opts) {
    var policies = isArr(opts.policies) ? opts.policies.map(String).filter(function (p) { return IMPL[p]; }) : ['lru', 'lfu'];
    if (!policies.length) policies = ['lru', 'lfu'];
    var cap = clampInt(opts.capacity, 1, 64, 20);
    var tp = parseTrace(opts.trace);
    var hot = clampInt(tp.hot, 1, 12, 5);
    var scanLen = clampInt(tp.scanLen, 1, 80, 40);
    var cycles = clampInt(tp.cycles, 1, 40, 20);
    var hotKeys = []; for (var i = 0; i < hot; i++) hotKeys.push('h' + i);

    var data = run(policies, cap, hotKeys, cycles, scanLen);
    var ui = K.frame(host, { title: 'LRU 대 LFU — 순환 스캔에 섞인 핫 키의 생존율' });

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['핫 키', T.wPath], ['스캔 키', T.fgFaint]];
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
        var cs = [T2.wPath, T2.fgFaint];
        Array.prototype.forEach.call(el.querySelectorAll('i'), function (n, k) { n.style.background = cs[k]; });
      });
    })();

    var PAD = 12, ROW_H = 26;
    var hotSet = {}; hotKeys.forEach(function (h) { hotSet[h] = true; });

    function layout(w) {
      var inner = Math.max(240, w - PAD * 2);
      var panelH = ROW_H + 10;
      return {
        inner: inner, x0: PAD,
        panelsH: policies.length * (panelH + 6),
        chartH: 110,
        height: PAD + policies.length * (panelH + 6) + 10 + 110 + 34 + PAD
      };
    }

    function drawPanel(ctx, T, x, y, w, policy, contents) {
      ctx.save();
      ctx.font = '600 11px ' + FONT; ctx.fillStyle = T.fgDim; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(LABEL[policy], x, y + ROW_H / 2);
      var lx = x + 40;
      var chipW = Math.max(20, Math.min(30, (w - 40) / cap));
      var items = policy === 'lru' ? contents.map(function (k) { return { key: k }; }) : contents;
      for (var i = 0; i < cap; i++) {
        var it = items[i];
        rrect(ctx, lx + i * chipW, y, chipW - 2, ROW_H, 3);
        if (it) {
          ctx.fillStyle = hotSet[it.key] ? T.wPath : T.bgElev;
          ctx.fill();
          ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = hotSet[it.key] ? T.bg : T.fgFaint;
          ctx.font = '9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (chipW >= 20) ctx.fillText(hotSet[it.key] ? it.key : '·', lx + i * chipW + chipW / 2 - 1, y + ROW_H / 2);
        } else {
          ctx.fillStyle = T.bgCode; ctx.fill();
          ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.stroke();
        }
      }
      ctx.restore();
    }

    function drawChart(ctx, T, x, y, w, h, i) {
      ctx.save();
      rrect(ctx, x, y, w, h, 4);
      ctx.fillStyle = T.bgElev; ctx.fill();
      ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.stroke();

      var colors = { lru: T.boxDanger, lfu: T.wPath };
      var pad = 8;
      var plotW = w - pad * 2, plotH = h - pad * 2 - 14;
      // y축: 0~100%
      ctx.strokeStyle = T.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + pad, y + pad); ctx.lineTo(x + pad, y + pad + plotH); ctx.lineTo(x + pad + plotW, y + pad + plotH); ctx.stroke();

      policies.forEach(function (p) {
        ctx.strokeStyle = colors[p] || T.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        var started = false;
        for (var s = 0; s <= i; s++) {
          var st = data.steps[s];
          if (st.hotTotal === 0) continue;
          var px = x + pad + (s / (data.steps.length - 1)) * plotW;
          var py = y + pad + plotH - st.hitRate[p] * plotH;
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });

      ctx.font = '10px ' + MONO; ctx.fillStyle = T.fgFaint; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('핫 키 히트율 (0~100%)', x + pad, y + h - 12);
      ctx.restore();
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = data.steps[Math.min(i, data.steps.length - 1)];
      var y = PAD;
      policies.forEach(function (p) {
        drawPanel(ctx, T, l.x0, y, l.inner, p, st.contents[p]);
        y += ROW_H + 10 + 6;
      });
      y += 6;
      drawChart(ctx, T, l.x0, y, l.inner, l.chartH, i);
      y += l.chartH + 10;

      ctx.save();
      ctx.font = '11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = st.kind === 'done' ? T.wPath : T.fgDim;
      ctx.fillText(st.note, l.x0, y);
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
      finalHitRate: function (p) { return data.final[p] ? data.final[p].hotHitRate : null; },
      final: function () { return JSON.parse(JSON.stringify(data.final)); },
      steps: function () { return data.steps.length; },
      goto: function (i) { play.goto(i); }
    };
  });
})();
