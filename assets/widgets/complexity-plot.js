/* complexity-plot — N 이 커질 때 복잡도 곡선이 벌어지는 것과 "1초 안에 되는 선"
 *
 * 왜 이 위젯이 필요한가
 *   복잡도를 표로만 보면 O(n^2) 과 O(n log n) 이 "조금 다른 것"으로 읽힌다.
 *   숫자는 외워지지만 감각이 안 붙는다. 실제로는 n = 10^5 에서 전자가 후자의
 *   6천 배다. 이 배수를 눈으로 보게 하는 것이 목적이다.
 *
 * 왜 로그 축인가
 *   선형 축에서는 O(2^n) 이 첫 몇 칸에서 화면 밖으로 나가고 나머지 곡선이
 *   전부 바닥에 붙어 버린다. 로그-로그 축에서는 각 복잡도가 서로 다른
 *   기울기의 직선이 되어 "차수가 다르다"는 것이 곧 "기울기가 다르다"로 보인다.
 *
 * 왜 스텝이 N 인가
 *   런타임의 스텝 재생기를 N 슬라이더로 쓴다. 스텝을 밀면 N 이 커지고,
 *   어느 복잡도가 먼저 1초 선을 넘는지가 순서대로 드러난다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 1초에 처리 가능한 연산 수의 관례적 기준. 0-9 가 이 숫자의 실체와 예외를 다룬다.
  var BUDGET = 1e8;

  var FUNCS = [
    { key: 'log',    label: 'O(log n)',   f: function (n) { return Math.log2(n); } },
    { key: 'n',      label: 'O(n)',       f: function (n) { return n; } },
    { key: 'nlogn',  label: 'O(n log n)', f: function (n) { return n * Math.log2(n); } },
    { key: 'n2',     label: 'O(n²)',      f: function (n) { return n * n; } },
    { key: 'n3',     label: 'O(n³)',      f: function (n) { return n * n * n; } },
    { key: '2n',     label: 'O(2ⁿ)',      f: function (n) { return Math.pow(2, n); } },
    { key: 'fact',   label: 'O(n!)',      f: function (n) { return gammaFactorial(n); } }
  ];

  // n! 은 n=171 부터 double 범위를 넘는다. 로그 축에 찍을 것이므로
  // 스털링 근사로 log 값을 직접 구해 Infinity 를 피한다.
  function gammaFactorial(n) {
    if (n < 2) return 1;
    if (n <= 170) { var r = 1; for (var i = 2; i <= n; i++) r *= i; return r; }
    return Infinity;
  }
  function log10Factorial(n) {
    if (n < 2) return 0;
    if (n <= 170) return Math.log10(gammaFactorial(n));
    // log10(n!) ≈ n log10(n/e) + log10(2πn)/2
    return n * Math.log10(n / Math.E) + 0.5 * Math.log10(2 * Math.PI * n);
  }
  function log10Of(key, n) {
    if (key === 'fact') return log10Factorial(n);
    if (key === '2n') return n * Math.log10(2);
    var v = null;
    for (var i = 0; i < FUNCS.length; i++) if (FUNCS[i].key === key) v = FUNCS[i].f(n);
    return v <= 0 ? 0 : Math.log10(v);
  }

  // N 축 눈금. 코딩테스트 제약조건에 실제로 나오는 값들을 고른다.
  var NS = [10, 15, 20, 25, 30, 50, 100, 200, 500, 1000, 2000, 5000,
            10000, 20000, 50000, 100000, 200000, 500000, 1000000, 5000000, 10000000];

  function fmt(x) {
    if (!isFinite(x)) return '∞';
    if (x < 1000) return String(Math.round(x));
    var e = Math.floor(Math.log10(x));
    if (e < 6) return Math.round(x).toLocaleString('en-US');
    return '10^' + e;
  }
  function fmtLog(l) {
    if (!isFinite(l)) return '∞';
    if (l < 3) return String(Math.round(Math.pow(10, l)));
    // 10^9 미만은 자릿수를 그대로 보인다. 10! 을 "10^7" 로 뭉개면 3,628,800 이라는
    // 실제 크기가 사라지고, 이 위젯이 주려는 감각이 바로 그 크기다.
    if (l < 9) return Math.round(Math.pow(10, l)).toLocaleString('en-US');
    if (l > 300) return '10^' + Math.round(l) + ' (사실상 불가능)';
    // 유효숫자 한 자리를 남긴다. 2.3×10^8 과 9.9×10^8 은 1초 선 앞에서 의미가 다르다.
    var e = Math.floor(l);
    var m = Math.pow(10, l - e);
    return (m < 1.05 ? '10^' + e : m.toFixed(1) + '×10^' + e);
  }

  K.register('complexity-plot', function (host, opts) {
    var o = opts || {};
    var show = Array.isArray(o.show) && o.show.length
      ? FUNCS.filter(function (f) { return o.show.indexOf(f.key) >= 0; })
      : FUNCS;
    if (!show.length) show = FUNCS;

    var ui = K.frame(host, { title: 'N 이 커지면 무엇이 먼저 무너지는가', wide: o.wide !== false });

    // 범례. 색은 토큰에서 꺼내 쓰되 곡선마다 달라야 하므로 색상환을 돌린다.
    var legend = K.el('div', 'wk-legend');
    ui.slot.appendChild(legend);

    var cv = null;
    var idx = 0;

    function colorFor(i, tokens) {
      // 토큰 6개를 순환시킨다. 새 색을 만들지 않기 위한 선택이다.
      var ring = [tokens.wFrontier, tokens.wPath, tokens.boxWarn, tokens.boxDanger,
                  tokens.accent, tokens.wStart, tokens.fgDim];
      return ring[i % ring.length];
    }

    function draw(ctx, size, tokens) {
      var W = size.w, H = size.h;
      var padL = 54, padR = 14, padT = 14, padB = 34;
      var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
      var narrow = W < 520;

      var nMin = Math.log10(NS[0]), nMax = Math.log10(NS[NS.length - 1]);
      var yMax = 20;   // 10^20 위는 어차피 "불가능"이라 잘라도 정보가 안 준다
      var yMin = 0;

      var px = function (n) { return x0 + (Math.log10(n) - nMin) / (nMax - nMin) * (x1 - x0); };
      var py = function (l) { return y1 - (Math.min(l, yMax) - yMin) / (yMax - yMin) * (y1 - y0); };

      // 격자
      ctx.strokeStyle = tokens.border;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      for (var e = 0; e <= yMax; e += 4) {
        var gy = Math.round(py(e)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 축 라벨
      ctx.fillStyle = tokens.fgFaint;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      for (var e2 = 0; e2 <= yMax; e2 += 4) {
        ctx.fillText('10^' + e2, x0 - 6, py(e2) + 3);
      }
      ctx.textAlign = 'center';
      [10, 1000, 100000, 10000000].forEach(function (n) {
        ctx.fillText(fmt(n), px(n), y1 + 14);
      });
      ctx.fillText('N', (x0 + x1) / 2, y1 + 28);

      // 1초 선. 이 위젯의 주인공이다.
      var by = py(Math.log10(BUDGET));
      ctx.strokeStyle = tokens.wPath;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tokens.wPath;
      ctx.textAlign = 'left';
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillText('10^8 — 1초 안에 되는 선', x0 + 4, by - 5);

      // 곡선
      show.forEach(function (fn, i) {
        ctx.strokeStyle = colorFor(i, tokens);
        ctx.lineWidth = 2;
        ctx.beginPath();
        var started = false;
        for (var s = 0; s <= 240; s++) {
          var n = Math.pow(10, nMin + (nMax - nMin) * (s / 240));
          var l = log10Of(fn.key, n);
          if (l > yMax + 2) {
            if (started) { ctx.lineTo(px(n), py(yMax + 2)); }
            break;
          }
          var X = px(n), Y = py(l);
          if (!started) { ctx.moveTo(X, Y); started = true; } else { ctx.lineTo(X, Y); }
        }
        ctx.stroke();
      });

      // 현재 N 의 세로선과 각 곡선과의 교점
      var curN = NS[idx];
      var cx = Math.round(px(curN)) + 0.5;
      ctx.strokeStyle = tokens.fg;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = tokens.fg;
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = cx > (x0 + x1) / 2 ? 'right' : 'left';
      ctx.fillText('N = ' + fmt(curN), cx + (cx > (x0 + x1) / 2 ? -6 : 6), y0 + 11);

      show.forEach(function (fn, i) {
        var l = log10Of(fn.key, curN);
        if (l > yMax + 0.5) return;
        var Y = py(l);
        ctx.fillStyle = colorFor(i, tokens);
        ctx.beginPath(); ctx.arc(cx, Y, 3.5, 0, Math.PI * 2); ctx.fill();
        if (!narrow) {
          // 통과 여부를 점 옆에 글자로도 쓴다. 색만으로는 전달되지 않는다.
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(fn.label + ' ' + (l <= Math.log10(BUDGET) ? '통과' : '초과'),
                       Math.min(cx + 8, x1 - 92), Y + 3);
        }
      });
    }

    cv = K.canvas(ui.stage, {
      height: function (w) { return w < 520 ? 260 : (w < 900 ? 300 : 340); },
      draw: draw
    });

    // 범례는 캔버스가 토큰을 읽은 뒤에 만들어야 색이 맞는다.
    function buildLegend() {
      var t = cv.tokens();
      legend.innerHTML = '';
      show.forEach(function (fn, i) {
        var s = K.el('span');
        var box = K.el('i');
        box.style.background = colorFor(i, t);
        s.appendChild(box);
        s.appendChild(document.createTextNode(fn.label));
        legend.appendChild(s);
      });
    }
    buildLegend();
    K.onThemeChange(buildLegend);

    var p = K.player(ui, {
      total: function () { return NS.length; },
      render: function (i) { idx = i; cv.redraw(); },
      label: function (i) {
        var n = NS[i];
        var pass = [], fail = [];
        show.forEach(function (fn) {
          var l = log10Of(fn.key, n);
          (l <= Math.log10(BUDGET) ? pass : fail).push(fn.label + '=' + fmtLog(l));
        });
        return 'N = ' + fmt(n) + ' · 1초 안: ' + (pass.join(', ') || '없음') +
               (fail.length ? ' · 초과: ' + fail.join(', ') : '');
      },
      speed: 620
    });

    // 기본 위치를 N=10^5 근처로 둔다. 코딩테스트에서 가장 자주 나오는 구간이고,
    // 여기서 O(n^2) 이 막 선을 넘는 장면이 이 위젯의 핵심이다.
    var startAt = NS.indexOf(100000);
    p.goto(o.n && NS.indexOf(o.n) >= 0 ? NS.indexOf(o.n) : (startAt >= 0 ? startAt : 0));
  });
})();
