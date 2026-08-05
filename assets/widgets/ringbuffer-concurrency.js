/* ringbuffer-concurrency.js — 오버런이 일어나는 그 한 스텝
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **링 버퍼가 터지는 것은 버퍼가 작아서가 아니라 생산과 소비의 속도가 다르기
 *   때문이고, 그 차이는 버퍼 크기를 키워도 사라지지 않는다.**
 *   생산이 소비보다 빠르면 점유는 단조 증가하고, 용량이 얼마든 언젠가 찬다.
 *   버퍼는 **순간적인 요동을 흡수할 뿐 평균 속도 차이를 흡수하지 못한다.**
 *
 * 그래서 이 위젯의 중심은 링 그림이 아니라 **점유 막대와 유실 카운터**다.
 *   칸이 색칠되는 애니메이션은 예쁘지만, 독자가 실제로 놓치는 것은 거기가 아니다.
 *   "버퍼를 8에서 64로 키우면 되지 않나"에 답하지 못하면 이 자료구조는
 *   외운 관용구로 남는다. 용량을 바꿔 보면 유실이 **늦게 시작될 뿐 멈추지 않는다**.
 *   그 사실이 카운터에 숫자로 찍혀야 한다.
 *
 * 왜 정수비로 인터리빙을 고정하는가
 *   진짜 스레드로 돌리면 실행마다 결과가 달라 되감기가 불가능하다(런타임 주석 참조).
 *   생산 p회마다 소비 c회라는 **결정적 일정**으로 바꾸면 같은 스텝에서 같은 그림이
 *   나오고, 그러면서도 "속도가 다르면 무슨 일이 나는가"라는 논지는 그대로 남는다.
 *   실제 스레드의 무작위성은 본문의 실측이 담당하고, 위젯은 인과를 담당한다.
 *
 * 왜 정책을 셋 두는가
 *   가득 찼을 때 무엇을 할지가 곧 시스템의 성격이다. 덮어쓰면 오래된 것이 죽고
 *   (오디오·센서), 버리면 새것이 죽고(로그), 막으면 생산자가 느려진다(배압).
 *   같은 화면에서 셋을 갈아 끼워야 "정책은 고르는 것이지 옳은 것이 있는 게 아니다"가 전달된다.
 *
 * ── opts (챕터가 넘기는 것. 이 주석이 명세다) ────────────────────────────────
 *   capacity   : 정수 4~16 (기본 8). 링의 칸 수
 *   produce    : 정수 1~6 (기본 3). 한 주기에 생산하는 횟수
 *   consume    : 정수 1~6 (기본 1). 한 주기에 소비하는 횟수
 *   steps      : 정수 (기본 36, 상한 200). 전체 연산 수
 *   policy     : "overwrite" | "drop" | "block" (기본 "overwrite")
 *   modes      : 위 정책 중 탭으로 보여 줄 것들. 생략하면 셋 다
 *   show       : { occupancy, counters, timeline, ambiguity }  전부 기본 true
 *                ambiguity=true 면 head==tail 이 가득/빈 양쪽에서 일어나는 순간을 표시한다
 *   controls   : { step, rewind, editCapacity, editRates }  전부 기본 true
 *
 * 넘긴 값이 무엇이든 던지지 않는다(계약 §1). 범위를 벗어나면 잘라서 쓰고,
 * 자른 사실은 제목에 적는다 — 조용히 자르면 독자는 화면이 자기가 넘긴 것이라 믿는다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  var MAX_STEPS = 200;   // 계약 §7
  var CAP_MIN = 4, CAP_MAX = 16;
  var RATE_MIN = 1, RATE_MAX = 6;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  var POLICIES = {
    overwrite: {
      label: '덮어쓰기',
      short: '가득 차면 가장 오래된 것을 덮는다',
      note: '오래된 것이 죽는다. 최신값만 의미 있는 곳 — 오디오 출력, 센서 최신 자세.',
      lostWord: '덮임'
    },
    drop: {
      label: '버리기',
      short: '가득 차면 새 데이터를 버린다',
      note: '새것이 죽는다. 이미 받은 것을 지키는 편이 나은 곳 — 로그 수집, 계측.',
      lostWord: '버림'
    },
    block: {
      label: '막기(배압)',
      short: '가득 차면 생산자가 기다린다',
      note: '아무것도 안 죽지만 생산자가 느려진다. 그 느려짐이 상류로 전파되는 것이 배압이다.',
      lostWord: '대기'
    }
  };

  var POLICY_ALIAS = {
    overwrite: 'overwrite', overwrote: 'overwrite', 덮어쓰기: 'overwrite', latest: 'overwrite',
    drop: 'drop', discard: 'drop', 버리기: 'drop', reject: 'drop',
    block: 'block', backpressure: 'block', 막기: 'block', wait: 'block'
  };

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function clampInt(v, lo, hi, dflt) {
    var n = (typeof v === 'number') ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function truthy(v, dflt) { return v === undefined || v === null ? dflt : !!v; }

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

  function wrap(ctx, text, maxW) {
    var words = String(text).split(' ');
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ─── 계산 ────────────────────────────────────────────────────────────────
  //
  // 상태를 전부 미리 만든다. 되감기가 결정적이어야 하므로 그리는 쪽에서
  // 계산하는 일이 없어야 한다.

  /* 생산 p회 · 소비 c회를 번갈아 내는 결정적 일정.
   * 진짜 스레드의 무작위 인터리빙은 본문 실측의 몫이고, 여기서는 인과만 남긴다. */
  function schedule(p, c, n) {
    var out = [];
    while (out.length < n) {
      for (var a = 0; a < p && out.length < n; a++) out.push('P');
      for (var b = 0; b < c && out.length < n; b++) out.push('C');
    }
    return out;
  }

  function simulate(cap, p, c, n, policy) {
    var ops = schedule(p, c, n);
    var slots = new Array(cap);          // null = 쓰인 적 없음
    var head = 0, tail = 0, occ = 0;
    var produced = 0, consumed = 0, lost = 0, starved = 0, blocked = 0;
    var seq = 0;

    var states = [{
      slots: slots.slice(), head: head, tail: tail, occ: occ,
      produced: 0, consumed: 0, lost: 0, starved: 0, blocked: 0,
      op: null, note: '초기 상태. 비었고 head 와 tail 이 같다.',
      hit: null, kind: 'init', rows: 0
    }];
    var rows = [];

    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var kind, note, hit = null;

      if (op === 'P') {
        if (occ === cap) {
          if (policy === 'overwrite') {
            // 가장 오래된 미읽음이 덮인다. tail 이 밀려나는 것이 곧 유실이다.
            seq += 1;
            hit = head;
            slots[head] = seq;
            head = (head + 1) % cap;
            tail = (tail + 1) % cap;
            produced += 1; lost += 1;
            kind = 'overrun';
            note = '가득 찬 상태에서 생산 — 가장 오래된 미읽음이 덮였다. 유실 ' + lost + '.';
          } else if (policy === 'drop') {
            produced += 1; lost += 1;
            kind = 'overrun';
            note = '가득 차서 새 데이터를 버렸다. 유실 ' + lost + '.';
          } else {
            blocked += 1;
            kind = 'blocked';
            note = '가득 차서 생산자가 기다린다. 대기 ' + blocked + '회 — 이 지연이 상류로 전파된다.';
          }
        } else {
          seq += 1;
          hit = head;
          slots[head] = seq;
          head = (head + 1) % cap;
          occ += 1; produced += 1;
          kind = 'produce';
          note = '슬롯 ' + hit + ' 에 ' + seq + ' 을 썼다. 점유 ' + occ + '/' + cap + '.';
        }
      } else {
        if (occ === 0) {
          starved += 1;
          kind = 'underrun';
          note = '빈 버퍼에서 소비 — 읽을 것이 없다. 굶음 ' + starved + '회.';
        } else {
          hit = tail;
          var got = slots[tail];
          slots[tail] = null;
          tail = (tail + 1) % cap;
          occ -= 1; consumed += 1;
          kind = 'consume';
          note = '슬롯 ' + hit + ' 에서 ' + got + ' 을 읽었다. 점유 ' + occ + '/' + cap + '.';
        }
      }

      rows.push({
        step: rows.length + 1, op: op === 'P' ? '생산' : '소비',
        head: head, tail: tail, occ: occ, kind: kind
      });

      states.push({
        slots: slots.slice(), head: head, tail: tail, occ: occ,
        produced: produced, consumed: consumed, lost: lost,
        starved: starved, blocked: blocked,
        op: op, note: note, hit: hit, kind: kind, rows: rows.length
      });
    }

    return {
      states: states, rows: rows, cap: cap,
      produced: produced, consumed: consumed, lost: lost,
      starved: starved, blocked: blocked, policy: policy
    };
  }

  // ─── 위젯 ────────────────────────────────────────────────────────────────

  K.register('ringbuffer-concurrency', function (host, opts) {
    var rawCap = opts.capacity, rawP = opts.produce, rawC = opts.consume;
    var cap = clampInt(rawCap, CAP_MIN, CAP_MAX, 8);
    var pRate = clampInt(rawP, RATE_MIN, RATE_MAX, 3);
    var cRate = clampInt(rawC, RATE_MIN, RATE_MAX, 1);
    var steps = clampInt(opts.steps, 4, MAX_STEPS, 36);

    var show = opts.show || {};
    var controls = opts.controls || {};
    var wantOcc = truthy(show.occupancy, true);
    var wantCounters = truthy(show.counters, true);
    var wantTimeline = truthy(show.timeline, true);
    var wantAmbiguity = truthy(show.ambiguity, true);

    var policy = POLICY_ALIAS[String(opts.policy || 'overwrite').toLowerCase()] || 'overwrite';
    var modes = [];
    if (isArr(opts.modes)) {
      for (var i = 0; i < opts.modes.length; i++) {
        var m = POLICY_ALIAS[String(opts.modes[i]).toLowerCase()];
        if (m && modes.indexOf(m) < 0) modes.push(m);
      }
    }
    if (!modes.length) modes = ['overwrite', 'drop', 'block'];
    if (modes.indexOf(policy) < 0) policy = modes[0];

    var run = null, play = null;
    function rebuild() { run = simulate(cap, pRate, cRate, steps, policy); }
    rebuild();

    var title = '링 버퍼 — 생산 ' + pRate + ' : 소비 ' + cRate + ' 일 때 무엇이 일어나는가';
    // 잘라 놓고 말하지 않으면 위젯이 거짓말을 한다.
    var clampNote = [];
    if (rawCap != null && clampInt(rawCap, -1e9, 1e9, cap) !== cap) clampNote.push('용량 ' + rawCap + '→' + cap);
    if (rawP != null && clampInt(rawP, -1e9, 1e9, pRate) !== pRate) clampNote.push('생산 ' + rawP + '→' + pRate);
    if (rawC != null && clampInt(rawC, -1e9, 1e9, cRate) !== cRate) clampNote.push('소비 ' + rawC + '→' + cRate);
    if (clampNote.length) title += '  ·  범위 밖이라 조정: ' + clampNote.join(', ');

    var ui = K.frame(host, { title: title });

    var modeSeg = null;
    if (modes.length > 1) {
      modeSeg = K.seg(ui.slot, modes.map(function (id) {
        return { label: POLICIES[id].label, value: id };
      }), policy, function (v) { policy = v; rebuild(); play.goto(0); });
    }

    function numField(label, get, set, lo, hi) {
      var w = K.el('label', 'wk-field');
      w.appendChild(K.el('span', null, label));
      var inp = K.el('input', 'wk-num');
      inp.type = 'number';
      inp.min = String(lo); inp.max = String(hi);
      inp.value = String(get());
      inp.setAttribute('aria-label', label);
      inp.addEventListener('change', function () {
        set(clampInt(inp.value, lo, hi, get()));
        inp.value = String(get());
        rebuild();
        play.goto(0);
      });
      w.appendChild(inp);
      ui.slot.appendChild(w);
    }

    // 용량을 키워도 유실이 멈추지 않는 것을 독자가 직접 확인해야 한다.
    // 이 위젯의 논지가 그 조작에 걸려 있으므로 편집을 기본으로 켠다.
    if (truthy(controls.editCapacity, true)) {
      numField('용량', function () { return cap; }, function (v) { cap = v; }, CAP_MIN, CAP_MAX);
    }
    if (truthy(controls.editRates, true)) {
      numField('생산', function () { return pRate; }, function (v) { pRate = v; }, RATE_MIN, RATE_MAX);
      numField('소비', function () { return cRate; }, function (v) { cRate = v; }, RATE_MIN, RATE_MAX);
    }

    (function legend() {
      var T = K.tokens(ui.stage);
      var items = [['미읽음', T.wFrontier], ['방금 쓴 칸', T.accent], ['유실·굶음', T.boxDanger], ['빈 칸', T.bgElev]];
      var wrapEl = K.el('div', 'wk-legend');
      items.forEach(function (it) {
        var sp = K.el('span'); var ic = K.el('i');
        ic.style.background = it[1];
        sp.appendChild(ic); sp.appendChild(document.createTextNode(it[0]));
        wrapEl.appendChild(sp);
      });
      ui.slot.appendChild(wrapEl);
      K.onThemeChange(function () {
        var T2 = K.tokens(ui.stage);
        var cs = [T2.wFrontier, T2.accent, T2.boxDanger, T2.bgElev];
        Array.prototype.forEach.call(wrapEl.querySelectorAll('i'), function (n, k) { n.style.background = cs[k]; });
      });
    })();

    // ── 레이아웃 ───────────────────────────────────────────────────────────

    var PAD = 12, ROW_H = 21, TABLE_MAX = 560;

    var measCv = null;
    function measHead(inner) {
      if (!measCv) measCv = document.createElement('canvas').getContext('2d');
      measCv.font = '12px ' + FONT;
      var P = POLICIES[policy];
      var h = wrap(measCv, '정책: ' + P.short + ' — ' + P.note, inner).length * 15;
      h += wrap(measCv, verdict(), inner).length * 15;
      return h + 10;
    }

    function layout(w) {
      var inner = Math.max(200, w - PAD * 2);
      var cw = Math.max(22, Math.min(46, Math.floor(inner / cap)));
      var rowsN = Math.min(run.rows.length, 12);   // 표는 최근 12줄만. 그 이상은 스크롤 없는 캔버스에서 안 읽힌다
      return {
        w: w, inner: inner, cw: cw, x0: PAD,
        tableW: Math.max(280, Math.min(TABLE_MAX, inner)),
        headH: measHead(inner),
        ringH: 16 + cw + 30 + (wantAmbiguity ? 17 : 0),
        occH: wantOcc ? 40 : 0,
        cntH: wantCounters ? 34 : 0,
        tableH: wantTimeline ? (rowsN + 1) * ROW_H + 22 : 0,
        rowsN: rowsN,
        height: 0
      };
    }
    function height(w) {
      var l = layout(w);
      return PAD + l.headH + l.ringH + l.occH + l.cntH + l.tableH + PAD;
    }

    function verdict() {
      var r = run;
      if (pRate > cRate) {
        return '생산이 소비보다 빠르다 — 점유는 단조 증가하고, 용량이 얼마든 언젠가 찬다. ' +
               '버퍼는 순간적인 요동을 흡수할 뿐 평균 속도 차이를 흡수하지 못한다.';
      }
      if (pRate < cRate) {
        return '소비가 생산보다 빠르다 — 버퍼는 자주 비고 소비자가 굶는다. 유실은 없지만 소비자가 놀고 있다.';
      }
      return '속도가 같다 — 점유가 안정된다. 실제 시스템에서 이 균형은 오래가지 않는다.';
    }

    // ── 그리기 ─────────────────────────────────────────────────────────────

    function drawRing(ctx, T, l, st, y) {
      ctx.save();
      ctx.font = '10px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = T.fgFaint;
      for (var i = 0; i < cap; i++) ctx.fillText(String(i), l.x0 + i * l.cw + l.cw / 2, y);
      ctx.restore();
      y += 16;

      for (var j = 0; j < cap; j++) {
        // 미읽음 구간은 tail 에서 head 로 링을 돌며 occ 칸이다.
        var unread = false;
        if (st.occ > 0) {
          var d = (j - st.tail + cap) % cap;
          unread = d < st.occ;
        }
        var isHit = st.hit === j;
        var bad = isHit && (st.kind === 'overrun' || st.kind === 'underrun');

        var fill = T.bgElev, txt = T.fgFaint, alpha = 1, thick = false, stroke = T.border;
        if (unread) { fill = T.wFrontier; txt = T.fg; alpha = 0.32; }
        if (isHit && st.kind === 'produce') { fill = T.accent; txt = T.bg; alpha = 1; thick = true; stroke = T.accent; }
        if (isHit && st.kind === 'consume') { fill = T.wPath; txt = T.bg; alpha = 1; thick = true; stroke = T.wPath; }
        if (bad) { fill = T.boxDanger; txt = T.fg; alpha = 1; thick = true; stroke = T.boxDanger; }

        var x = l.x0 + j * l.cw;
        ctx.save();
        rrect(ctx, x + 1, y + 1, l.cw - 2, l.cw - 2, 4);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = thick ? 2 : 1;
        ctx.strokeStyle = stroke;
        ctx.stroke();
        var v = st.slots[j];
        ctx.fillStyle = txt;
        ctx.font = (thick ? '600 ' : '') + Math.max(10, Math.floor(l.cw * 0.34)) + 'px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v == null ? '·' : String(v), x + l.cw / 2, y + l.cw / 2);
        ctx.restore();
      }
      y += l.cw;

      // head·tail 표식. **둘이 겹치는 순간이 이 자료구조의 함정이고, 그 순간이
      // 정확히 두 이름이 화면에서 겹치는 순간이다.** 가로로 비켜 놓는 것으로는
      // 부족해서(이름이 길다) 항상 두 줄로 나눠 찍는다. 겹칠 때만 두 줄로 바꾸면
      // 그 스텝에서 캔버스 높이가 변해 재생 중에 화면이 튄다.
      var same = st.head === st.tail;
      ctx.save();
      ctx.font = '600 10px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      [[st.head, 'head(w)', T.wStart, 0], [st.tail, 'tail(r)', T.wGoal, 13]].forEach(function (mk) {
        var mx = l.x0 + mk[0] * l.cw + l.cw / 2;
        ctx.fillStyle = mk[2];
        ctx.beginPath();
        ctx.moveTo(mx, y + 1 + mk[3]); ctx.lineTo(mx - 4, y + 6 + mk[3]); ctx.lineTo(mx + 4, y + 6 + mk[3]);
        ctx.closePath(); ctx.fill();
        ctx.fillText(mk[1], mx, y + 7 + mk[3]);
      });
      ctx.restore();
      y += 30;

      if (wantAmbiguity) {
        // 자리를 늘 비워 둔다. 겹치는 스텝에서만 줄을 넣으면 높이가 변해 화면이 튄다.
        ctx.save();
        ctx.font = '600 11px ' + FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        if (same) {
          ctx.fillStyle = T.boxDanger;
          ctx.fillText('head == tail — ' + (st.occ === 0 ? '비었다' : '가득 찼다') +
                       '. 두 상태가 같은 모양이라 이 둘만으로는 구분할 수 없다.', l.x0, y);
        }
        ctx.restore();
        y += 17;
      }
      return y;
    }

    function drawOccupancy(ctx, T, l, st, y) {
      var barW = Math.min(l.inner, 320);
      var h = 12;
      ctx.save();
      rrect(ctx, l.x0, y, barW, h, 3);
      ctx.fillStyle = T.bgElev;
      ctx.fill();
      var frac = cap ? st.occ / cap : 0;
      if (frac > 0) {
        rrect(ctx, l.x0, y, Math.max(3, barW * frac), h, 3);
        ctx.fillStyle = st.occ === cap ? T.boxDanger : T.wFrontier;
        ctx.fill();
      }
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      rrect(ctx, l.x0, y, barW, h, 3);
      ctx.stroke();
      ctx.fillStyle = T.fgDim;
      ctx.font = '11px ' + MONO;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('점유 ' + st.occ + ' / ' + cap, l.x0 + barW + 10, y + h / 2);
      ctx.restore();
      return y + 40;
    }

    function drawCounters(ctx, T, l, st, y) {
      var P = POLICIES[policy];
      var badN = policy === 'block' ? st.blocked : st.lost;
      var items = [
        ['생산', st.produced, T.fg],
        ['소비', st.consumed, T.fg],
        [P.lostWord, badN, badN > 0 ? T.boxDanger : T.fgFaint],
        ['굶음', st.starved, st.starved > 0 ? T.boxDanger : T.fgFaint]
      ];
      ctx.save();
      ctx.textBaseline = 'middle';
      var x = l.x0;
      for (var i = 0; i < items.length; i++) {
        ctx.font = '11px ' + FONT;
        ctx.fillStyle = T.fgFaint;
        ctx.textAlign = 'left';
        ctx.fillText(items[i][0], x, y + 8);
        var lw = ctx.measureText(items[i][0]).width;
        ctx.font = '600 14px ' + MONO;
        ctx.fillStyle = items[i][2];
        ctx.fillText(String(items[i][1]), x + lw + 6, y + 8);
        x += lw + 6 + ctx.measureText(String(items[i][1])).width + 22;
      }
      ctx.restore();
      return y + 34;
    }

    function drawTimeline(ctx, T, l, st, y) {
      var cols = ['step', '동작', 'head', 'tail', '점유', '결과'];
      var avail = l.tableW;
      var wgt = [0.8, 1, 0.9, 0.9, 0.9, 1.6];
      var tot = wgt.reduce(function (a, b) { return a + b; }, 0);
      var cw = wgt.map(function (v) { return v / tot * avail; });

      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.font = '600 11px ' + MONO;
      ctx.fillStyle = T.fgDim;
      var x = l.x0;
      for (var h = 0; h < cols.length; h++) {
        ctx.textAlign = h === 0 ? 'left' : 'center';
        ctx.fillText(cols[h], h === 0 ? x + 2 : x + cw[h] / 2, y + ROW_H / 2);
        x += cw[h];
      }
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l.x0, y + ROW_H - 1);
      ctx.lineTo(l.x0 + avail, y + ROW_H - 1);
      ctx.stroke();
      y += ROW_H;

      // 최근 것만 보인다. 지나간 스텝을 다 쌓으면 캔버스가 끝없이 길어진다.
      var end = st.rows;
      var start = Math.max(0, end - l.rowsN);
      for (var k = start; k < start + l.rowsN; k++) {
        var row = run.rows[k];
        var on = k < end;
        var isCur = k === end - 1;
        if (isCur && on) {
          ctx.fillStyle = T.bgElev;
          rrect(ctx, l.x0 - 2, y + 1, avail + 4, ROW_H - 2, 3);
          ctx.fill();
          ctx.fillStyle = T.accent;
          ctx.fillRect(l.x0 - 2, y + 2, 2, ROW_H - 4);
        }
        x = l.x0;
        var vals = on
          ? [row.step, row.op, row.head, row.tail, row.occ,
             row.kind === 'overrun' ? POLICIES[policy].lostWord
               : row.kind === 'underrun' ? '굶음'
               : row.kind === 'blocked' ? '대기' : 'OK']
          : ['·', '·', '·', '·', '·', '·'];
        for (var q = 0; q < cols.length; q++) {
          var danger = on && q === 5 && vals[5] !== 'OK';
          ctx.fillStyle = !on ? T.fgFaint : (danger ? T.boxDanger : (q === 4 ? T.accent : T.fg));
          ctx.font = (danger ? '600 ' : '') + '11px ' + MONO;
          ctx.textAlign = q === 0 ? 'left' : 'center';
          ctx.fillText(String(vals[q]), q === 0 ? x + 2 : x + cw[q] / 2, y + ROW_H / 2);
          x += cw[q];
        }
        y += ROW_H;
      }
      ctx.restore();
      return y + 22;
    }

    function draw(ctx, size, T) {
      var l = layout(size.w);
      var i = play ? play.index() : 0;
      var st = run.states[Math.min(i, run.states.length - 1)];
      var y = PAD;

      ctx.save();
      ctx.font = '12px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      var P = POLICIES[policy];
      var head = wrap(ctx, '정책: ' + P.short + ' — ' + P.note, l.inner);
      head.forEach(function (t, k) { ctx.fillStyle = T.fg; ctx.fillText(t, l.x0, y + k * 15); });
      y += head.length * 15;
      var vd = wrap(ctx, verdict(), l.inner);
      vd.forEach(function (t, k) {
        ctx.fillStyle = pRate > cRate ? T.boxDanger : T.fgDim;
        ctx.fillText(t, l.x0, y + k * 15);
      });
      y += vd.length * 15 + 10;
      ctx.restore();

      y = drawRing(ctx, T, l, st, y);
      if (wantOcc) y = drawOccupancy(ctx, T, l, st, y);
      if (wantCounters) y = drawCounters(ctx, T, l, st, y);
      if (wantTimeline) y = drawTimeline(ctx, T, l, st, y);
    }

    var cv = K.canvas(ui.stage, { height: height, draw: draw });

    function label(i) {
      var st = run.states[Math.min(i, run.states.length - 1)];
      var s = st.note;
      if (i >= run.states.length - 1) {
        var badN = policy === 'block' ? run.blocked : run.lost;
        s += '  끝. 생산 ' + run.produced + ', 소비 ' + run.consumed + ', ' +
             POLICIES[policy].lostWord + ' ' + badN + ', 굶음 ' + run.starved + '.';
        if (badN > 0) s += ' 용량을 키워 보라 — 유실이 늦게 시작될 뿐 멈추지 않는다.';
      }
      return s;
    }

    play = K.player(ui, {
      total: function () { return run.states.length; },
      render: function () { cv.redraw(); },
      label: label
    });
    play.draw();

    // 본문의 표·수치와 위젯이 어긋나면 여기서 잡는다.
    host.__widget = {
      config: function () { return { cap: cap, produce: pRate, consume: cRate, policy: policy, steps: steps }; },
      totals: function () {
        return { produced: run.produced, consumed: run.consumed, lost: run.lost,
                 starved: run.starved, blocked: run.blocked };
      },
      rows: function () { return run.rows.slice(); },
      steps: function () { return run.states.length; },
      setPolicy: function (v) {
        var id = POLICY_ALIAS[String(v).toLowerCase()];
        if (!id) return;
        policy = id;
        if (modeSeg) {
          Array.prototype.forEach.call(modeSeg.children, function (c) {
            c.classList.toggle('is-active', c.getAttribute('data-val') === id);
          });
        }
        rebuild(); play.goto(0);
      },
      setCapacity: function (v) { cap = clampInt(v, CAP_MIN, CAP_MAX, cap); rebuild(); play.goto(0); },
      goto: function (i) { play.goto(i); },
      index: function () { return play.index(); }
    };
  });
})();
