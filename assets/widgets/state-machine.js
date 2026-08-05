/* state-machine.js — 상태 기계: 상태 그래프 + 전이 격자
 *
 * 이 위젯이 가르치려는 단 하나:
 *   **그래프는 "어디로 갈 수 있는가"를 보이고, 격자는 "어디로 갈 수 없는가"를 보인다.**
 * 둘을 나란히 놓는 이유가 그것이다. 그래프만 보면 빈칸이 보이지 않는다. XII-8 §1 의
 * 버그(`can_edit` 하나를 놓쳐 paused × edit 이 열려 버린 것)는 격자에서만 눈에 띈다.
 * 그래서 격자는 장식이 아니라 이 위젯의 절반이다.
 *
 * 왜 거부된 이벤트를 건너뛰지 않고 그리는가
 *   거부는 오류가 아니라 이 기계의 정상 동작이다. 조회에 실패하면 아무것도 바꾸지
 *   않고 넘어간다 — 상태도, 진입 동작도, 타이머도. 그 "아무 일도 일어나지 않음"을
 *   스텝으로 보여 주지 않으면 독자는 거부를 예외 처리로 오해한다. 격자의 빈칸에
 *   × 를 찍는 것이 곧 "여기 규칙이 없어서 막혔다"는 문장이다.
 *
 * 왜 타이머를 상태에서 계산하는가
 *   opts 에 타이머 필드는 없다. 있어서도 안 된다 — 본문 §3 의 요점이 ==타이머를
 *   만지는 코드가 진입 동작 한 곳뿐==이라는 것이고, 그렇다면 타이머는 이력이 아니라
 *   **현재 상태의 함수**다. 그래서 진입 동작 문자열("타이머 시작" / "타이머 정지")에서
 *   플래그 이름을 뽑아 내고, 값은 매 스텝 현재 상태에서 다시 계산한다. 이력으로
 *   누적하면 상태와 어긋나는 조합을 위젯이 스스로 만들어 낼 수 있는데, 그것이 바로
 *   본문이 경고하는 사고다.
 *
 * kind 에 대하여
 *   지금은 `kind:"fsm"`(평면 상태 기계)만 그린다. XI-6 이 계층적 상태 기계와
 *   Behavior Tree 에 같은 위젯 타입을 쓰므로, 모델은 상태·전이·이벤트만으로 서술되고
 *   렌더러(그래프 배치·격자)는 그 모델만 읽도록 분리해 두었다. 새 kind 는 모델에
 *   부모/자식 관계를 얹고 배치 함수를 하나 더 붙이는 일이 된다. 모르는 kind 가 오면
 *   던지지 않고 평면 FSM 으로 그린 뒤 그 사실을 캔버스에 적는다.
 */
(function () {
  'use strict';

  var K = window.WidgetKit;
  if (!K) return;

  // 상한. "많이 보여주기"보다 "읽히게 보여주기"가 먼저다(계약 §4).
  var MAX_STATES = 12;
  var MAX_EVENTS = 12;
  var MAX_SCRIPT = 40;      // 계약 §7: 스텝 수 상한 (스텝은 최대 이것 + 1)
  var MAX_LABEL = 14;

  var MONO = 'ui-monospace, monospace';
  var SANS = 'system-ui, sans-serif';

  // ---------------------------------------------------------------- opts 검증
  //
  // opts 는 본문 저자가 손으로 쓴 JSON 이다. 무엇이 들어와도 던지지 않는다(계약 §1).

  function isArr(v) {
    return !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'string';
  }

  function str(v) {
    if (typeof v === 'string') { var s = v.trim(); return s || null; }
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return null;
  }

  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // 글자 폭 추정. 배치 계산은 ctx 없이도 돌아야 캐시가 폭에만 의존한다.
  // 한글은 고정폭에서 두 칸을 차지한다(§4-9 의 그 사실이 캔버스에서도 같다).
  function estW(s, fs) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += (s.charCodeAt(i) > 0x2E80) ? fs : fs * 0.6;
    }
    return w;
  }

  // ---------------------------------------------------------------- 조사
  //
  // 상태 이름이 영문이라 받침 판정이 눈에 보이지 않는다. 읽는 소리를 기준으로 한다.
  //   running → 러닝(ㅇ 받침) → "running 으로"
  //   done    → 던(ㄴ 받침)   → "done 으로"      (끝의 e 는 묵음이라 n 을 본다)
  //   paused  → 포즈드         → "paused 로"
  // 상태 줄은 스크린리더가 읽는 문장이다. 조사가 틀리면 그대로 귀에 걸린다.

  function tailSound(s) {
    if (!s) return { jong: false, rieul: false };
    var last = s.charAt(s.length - 1);
    if (last >= '0' && last <= '9') {
      return { jong: '013678'.indexOf(last) >= 0, rieul: '178'.indexOf(last) >= 0 };
    }
    var code = s.charCodeAt(s.length - 1);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      var j = (code - 0xAC00) % 28;
      return { jong: j !== 0, rieul: j === 8 };
    }
    var t = s.toLowerCase();
    var c = t.charAt(t.length - 1);
    // 묵음 e: 앞이 자음이면 그 자음이 실제 끝소리다 (done → n, idle → l).
    if (c === 'e' && t.length >= 2 && 'aeiouy'.indexOf(t.charAt(t.length - 2)) < 0) {
      c = t.charAt(t.length - 2);
      t = t.slice(0, -1);
    }
    if (c === 'l') return { jong: true, rieul: true };
    if (c === 'm' || c === 'n') return { jong: true, rieul: false };
    if (c === 'g' && t.charAt(t.length - 2) === 'n') return { jong: true, rieul: false };
    // 나머지 자음은 '으'가 붙어 소리 나므로 받침이 없다 (paused → 포즈드).
    return { jong: false, rieul: false };
  }

  function eul(s) { return s + (tailSound(s).jong ? '을' : '를'); }
  function eun(s) { return s + (tailSound(s).jong ? '은' : '는'); }
  function ga(s) { return s + (tailSound(s).jong ? '이' : '가'); }
  function ro(s) {
    var t = tailSound(s);
    return s + (t.jong && !t.rieul ? '으로' : '로');
  }

  // ---------------------------------------------------------------- 기본 기계
  //
  // opts 가 비어 있을 때 쓰는 기계. XII-8 의 작업 오더를 그대로 쓴다 — 이 위젯이
  // 설명하는 대상이 그것이고, 빈 opts 로도 챕터와 같은 그림이 나오는 편이 낫다.

  var DEFAULT_MACHINE = {
    title: '작업 오더',
    states: [
      { id: 'created', label: 'created', initial: true },
      { id: 'assigned', label: 'assigned', note: '로봇 배차' },
      { id: 'running', label: 'running', note: '타이머 시작' },
      { id: 'paused', label: 'paused', note: '타이머 정지' },
      { id: 'done', label: 'done', terminal: true, note: '정산' },
      { id: 'canceled', label: 'canceled', terminal: true, note: '정산' }
    ],
    events: ['assign', 'start', 'pause', 'resume', 'finish', 'cancel', 'edit'],
    transitions: [
      { from: 'created', on: 'assign', to: 'assigned' },
      { from: 'created', on: 'cancel', to: 'canceled' },
      { from: 'created', on: 'edit', to: 'created' },
      { from: 'assigned', on: 'start', to: 'running' },
      { from: 'assigned', on: 'cancel', to: 'canceled' },
      { from: 'assigned', on: 'edit', to: 'assigned' },
      { from: 'running', on: 'pause', to: 'paused' },
      { from: 'running', on: 'finish', to: 'done' },
      { from: 'running', on: 'cancel', to: 'canceled' },
      { from: 'paused', on: 'resume', to: 'running' },
      { from: 'paused', on: 'cancel', to: 'canceled' }
    ],
    script: ['assign', 'start', 'pause', 'finish', 'resume', 'finish', 'cancel']
  };

  // "타이머 시작" 류의 진입 동작에서 플래그 이름을 뽑는다.
  var ON_RE = /^(.+?)\s*(시작|가동|켜기|start|on)$/i;

  function normStates(raw) {
    if (!isArr(raw)) return null;
    var out = [], seen = {};
    for (var i = 0; i < raw.length && out.length < MAX_STATES; i++) {
      var it = raw[i], id = null, label = null, note = null, ini = false, term = false;
      if (typeof it === 'string' || typeof it === 'number') {
        id = str(it);
      } else if (it && typeof it === 'object' && !isArr(it)) {
        id = str(it.id) || str(it.name) || str(it.label);
        label = str(it.label);
        note = str(it.note) || str(it.entry) || str(it.onEnter);
        ini = it.initial === true;
        term = it.terminal === true || it.final === true;
      }
      if (!id || seen[id]) continue;      // 중복 id 는 격자 행이 겹쳐 버린다
      seen[id] = true;
      out.push({
        id: id,
        label: clip(label || id, MAX_LABEL),
        note: note ? clip(note, 16) : null,
        initial: ini, terminal: term,
        out: [], layer: 0, row: 0
      });
    }
    return out.length ? out : null;
  }

  function normEvents(raw) {
    var out = [], seen = {};
    if (isArr(raw)) {
      for (var i = 0; i < raw.length && out.length < MAX_EVENTS; i++) {
        var e = str(raw[i]);
        if (!e || seen[e]) continue;
        seen[e] = true;
        out.push(clip(e, MAX_LABEL));
      }
    }
    return { list: out, seen: seen };
  }

  function buildModel(opts) {
    var states = normStates(opts.states);
    var src = opts;
    var usedDefault = false;

    // 상태 목록이 통째로 망가졌으면 기계 전체를 기본값으로 바꾼다.
    // 남의 전이 표를 남의 상태 목록에 붙이면 그림이 거짓말을 한다.
    if (!states) {
      src = DEFAULT_MACHINE;
      states = normStates(DEFAULT_MACHINE.states);
      usedDefault = true;
    }

    var idx = {};
    for (var i = 0; i < states.length; i++) idx[states[i].id] = i;

    var ev = normEvents(src.events);
    var events = ev.list, evSeen = ev.seen;

    // 전이. 알 수 없는 상태를 가리키는 줄은 **버린다.** 자동으로 상태를 만들어 주면
    // 오타가 조용히 새 상태가 되어 격자가 늘어난다 — 오히려 발견이 늦어진다.
    var trans = [], dropped = 0, tseen = {};
    var rawT = isArr(src.transitions) ? src.transitions : [];
    for (i = 0; i < rawT.length; i++) {
      var t = rawT[i], f = null, on = null, to = null;
      if (isArr(t) && t.length >= 3) { f = str(t[0]); on = str(t[1]); to = str(t[2]); }
      else if (t && typeof t === 'object') {
        f = str(t.from) || str(t.f);
        on = str(t.on) || str(t.event) || str(t.e);
        to = str(t.to) || str(t.t);
      }
      if (!f || !on || !to || idx[f] === undefined || idx[to] === undefined) { dropped++; continue; }
      on = clip(on, MAX_LABEL);
      var key = f + ' ' + on;
      if (tseen[key]) { dropped++; continue; }   // (상태, 이벤트) 는 결정적이어야 한다
      tseen[key] = true;
      if (!evSeen[on]) {
        // events 에 없는 이벤트도 격자에 열이 있어야 한다. 열이 없으면 그 전이는
        // 그래프에만 있고 격자에는 없는 것이 되어 둘이 어긋난다.
        if (events.length >= MAX_EVENTS) { dropped++; tseen[key] = false; continue; }
        evSeen[on] = true;
        events.push(on);
      }
      trans.push({ from: idx[f], on: on, to: idx[to] });
    }
    if (!events.length) events = ['(이벤트 없음)'];

    var eidx = {};
    for (i = 0; i < events.length; i++) eidx[events[i]] = i;

    // 격자: matrix[s][e] = 도착 상태 인덱스, 없으면 -1. 채워진 칸 수는 정의상
    // 유효 전이 수와 같다 — 이 등식이 깨지면 위젯이 본문과 다른 말을 하는 것이다.
    var matrix = [], filled = 0;
    for (i = 0; i < states.length; i++) {
      var row = [];
      for (var j = 0; j < events.length; j++) row.push(-1);
      matrix.push(row);
    }
    for (i = 0; i < trans.length; i++) {
      matrix[trans[i].from][eidx[trans[i].on]] = trans[i].to;
      states[trans[i].from].out.push(i);
      filled++;
    }

    // 시작 상태 / 종료 상태
    var initial = 0;
    for (i = 0; i < states.length; i++) if (states[i].initial) { initial = i; break; }
    for (i = 0; i < states.length; i++) {
      if (!states[i].out.length) states[i].terminal = true;   // 나가는 간선이 0개면 종료다
    }

    // 진입 동작에서 플래그(타이머)를 뽑는다. 값은 상태의 함수다 — §3 참조.
    var flagName = null, flagOn = [];
    for (i = 0; i < states.length; i++) flagOn.push(false);
    for (i = 0; i < states.length; i++) {
      var m = states[i].note && ON_RE.exec(states[i].note);
      if (m && m[1]) { flagName = m[1].trim(); break; }
    }
    if (flagName) {
      var low = flagName.toLowerCase();
      for (i = 0; i < states.length; i++) {
        var mm = states[i].note && ON_RE.exec(states[i].note);
        flagOn[i] = !!(mm && mm[1] && mm[1].trim().toLowerCase() === low);
      }
    }

    // 스크립트. 격자에 열이 없는 이벤트는 보여 줄 자리가 없으므로 뺀다.
    var script = [];
    var rawS = isArr(src.script) ? src.script : (isArr(opts.script) ? opts.script : []);
    for (i = 0; i < rawS.length && script.length < MAX_SCRIPT; i++) {
      var s = str(rawS[i]);
      if (s && eidx[clip(s, MAX_LABEL)] !== undefined) script.push(clip(s, MAX_LABEL));
    }
    if (!script.length) script = autoScript(states, trans, events, initial);

    var model = {
      states: states, events: events, trans: trans, matrix: matrix,
      eidx: eidx, initial: initial, filled: filled, dropped: dropped,
      script: script, flagName: flagName, flagOn: flagOn,
      usedDefault: usedDefault
    };
    layerize(model);
    return model;
  }

  // 스크립트가 없으면 걸어 본다. 각 상태에서 아직 쓰지 않은 전이를 먼저 고른다 —
  // 그래야 짧은 스크립트로 기계의 많은 부분을 지난다.
  function autoScript(states, trans, events, initial) {
    var out = [], cur = initial, used = {}, guard = 0;
    while (guard++ < 12) {
      var pick = -1, fallback = -1, i;
      for (i = 0; i < trans.length; i++) {
        if (trans[i].from !== cur) continue;
        if (fallback < 0) fallback = i;
        if (!used[i]) { pick = i; break; }
      }
      if (pick < 0) pick = fallback;
      if (pick < 0) break;
      used[pick] = true;
      out.push(trans[pick].on);
      cur = trans[pick].to;
    }
    return out;
  }

  // 층 나누기: 시작 상태에서의 BFS 깊이를 층으로 삼되, **종료 상태는 마지막 층으로
  // 몰아 둔다.** canceled 처럼 어디서든 도달하는 흡수 상태를 BFS 깊이대로 앞쪽에
  // 두면 뒤쪽 상태에서 오는 간선이 전부 거꾸로 흘러 그림이 엉킨다.
  function layerize(model) {
    var ns = model.states, n = ns.length;
    var depth = new Array(n), i;
    for (i = 0; i < n; i++) depth[i] = -1;
    depth[model.initial] = 0;
    var q = [model.initial];
    while (q.length) {
      var u = q.shift();
      for (i = 0; i < model.trans.length; i++) {
        var t = model.trans[i];
        if (t.from !== u || t.to === u) continue;
        if (depth[t.to] < 0) { depth[t.to] = depth[u] + 1; q.push(t.to); }
      }
    }
    var maxOpen = 0;
    for (i = 0; i < n; i++) if (!ns[i].terminal && depth[i] > maxOpen) maxOpen = depth[i];
    for (i = 0; i < n; i++) {
      if (depth[i] < 0) depth[i] = 0;                 // 도달 불가 상태는 첫 층에 둔다
      ns[i].layer = ns[i].terminal ? maxOpen + 1 : depth[i];
    }
    var count = {};
    var maxLayer = 0;
    for (i = 0; i < n; i++) {
      var L = ns[i].layer;
      ns[i].row = count[L] = (count[L] === undefined ? 0 : count[L] + 1);
      if (L > maxLayer) maxLayer = L;
    }
    model.layers = maxLayer + 1;
    model.rowsIn = [];
    for (i = 0; i <= maxLayer; i++) model.rowsIn.push(count[i] === undefined ? 0 : count[i] + 1);
    model.maxRows = 1;
    for (i = 0; i < model.rowsIn.length; i++) model.maxRows = Math.max(model.maxRows, model.rowsIn[i]);
  }

  // ---------------------------------------------------------------- 스텝
  //
  // 계약 §7: 상태를 미리 전부 계산한다. render(i) 는 그리기만 한다.
  // 알고리즘은 본문 §4.2 의 `::: dual` 과 같다 — 조회 한 번, 실패하면 아무것도 안 한다.

  function cp(o) {
    var out = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  function openEvents(model, si) {
    var out = [];
    for (var j = 0; j < model.events.length; j++) if (model.matrix[si][j] >= 0) out.push(model.events[j]);
    return out;
  }

  function flagText(model, si) {
    if (!model.flagName) return '';
    return model.flagName + ' ' + (model.flagOn[si] ? '켜짐' : '꺼짐');
  }

  function openText(model, si) {
    var op = openEvents(model, si);
    var nm = model.states[si].label;
    if (!op.length) return nm + ' 행은 전부 비어 있다 — 나가는 간선이 0개인 종료 상태다.';
    return nm + ' 행에서 열린 칸은 ' + op.join(', ') + ' ' + op.length + '개다.';
  }

  function buildSteps(model, showRejected) {
    var steps = [];
    var cur = model.initial;
    var used = {}, rej = {}, seen = {};
    // 스크립트 칸마다 수락/거부를 따로 남긴다. showRejected:false 면 거부가 스텝으로
    // 남지 않는데, 그때도 테이프가 ✓ 를 찍으면 위젯이 거짓말을 하게 된다.
    var outcomes = [];
    seen[cur] = true;

    function snap(o) {
      o.used = cp(used);
      o.rej = cp(rej);
      o.seen = cp(seen);
      o.flag = model.flagName ? model.flagOn[o.state] : false;
      steps.push(o);
    }

    var s0 = model.states[model.initial];
    snap({
      kind: 'init', state: model.initial, from: model.initial, to: model.initial,
      ei: -1, ev: null, note: null, k: -1,
      msg: '시작 상태 ' + ga(s0.label) + ' 놓여 있다. 아직 이벤트를 받지 않았다. ' +
           openText(model, model.initial) +
           (model.flagName ? ' ' + flagText(model, model.initial) + '.' : '')
    });

    for (var k = 0; k < model.script.length; k++) {
      var evName = model.script[k];
      var ei = model.eidx[evName];
      var to = model.matrix[cur][ei];
      var key = cur + ':' + ei;
      var head = '스텝 ' + k + ' · ' + evName + ' — (' + model.states[cur].label + ', ' + evName + ') ';

      if (to < 0) {
        // ---- 거부: 아무것도 바꾸지 않는다 ----
        outcomes[k] = 'rej';
        if (!showRejected) continue;      // showRejected:false 면 스텝 자체를 만들지 않는다
        rej[key] = (rej[key] || 0) + 1;
        snap({
          kind: 'reject', state: cur, from: cur, to: cur, ei: ei, ev: evName, note: null, k: k,
          msg: head + '조회 실패. 격자에서 그 칸이 비어 있다. 거부는 오류가 아니라 이 기계의 정상 동작이라 ' +
               '상태도' + (model.flagName ? ' ' + model.flagName + '도' : '') + ' 진입 동작도 그대로다 — ' +
               model.states[cur].label + (model.flagName ? ' / ' + flagText(model, cur) : '') + '. ' +
               openText(model, cur)
        });
        continue;
      }

      // ---- 수락 ----
      outcomes[k] = 'ok';
      used[key] = (used[key] || 0) + 1;
      var self = (to === cur);
      var note = self ? null : model.states[to].note;   // 같은 상태로 돌아오면 진입 동작은 돌지 않는다
      var from = cur;
      cur = to;
      seen[cur] = true;
      var msg = head + '조회 성공 → ';
      if (self) {
        msg += '같은 상태 ' + model.states[to].label + ' 다. 상태가 바뀌지 않았으므로 진입 동작은 실행되지 않는다. ';
      } else {
        msg += ro(model.states[to].label) + ' 간다. 진입 동작 ' + (note ? '‘' + note + '’.' : '없음.') + ' ';
      }
      if (model.flagName) msg += flagText(model, cur) + '. ';
      msg += openText(model, cur);
      snap({
        kind: 'move', state: cur, from: from, to: to, ei: ei, ev: evName, note: note, k: k,
        self: self, msg: msg
      });
    }

    // 마지막 한 줄: 격자의 빈칸이 곧 규칙이라는 문장을 여기서 한 번 더 못박는다.
    var total = model.states.length * model.events.length;
    steps.push({
      kind: 'done', state: cur, from: cur, to: cur, ei: -1, ev: null, note: null, k: model.script.length,
      used: cp(used), rej: cp(rej), seen: cp(seen),
      flag: model.flagName ? model.flagOn[cur] : false,
      msg: '스크립트 종료. 최종 상태 ' + model.states[cur].label +
           (model.flagName ? ' / ' + flagText(model, cur) : '') + '. ' +
           '격자 ' + total + '칸 중 ' + model.filled + '칸이 열려 있고 나머지 ' + (total - model.filled) +
           '칸은 누가 닫은 것이 아니라 결정하지 않아서 닫힌 것이다.'
    });

    model.outcomes = outcomes;
    return steps;
  }

  // ---------------------------------------------------------------- 기하 보조

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

  function inRect(px, py, r, pad) {
    return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }

  function overlap(a, b, pad) {
    return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
             a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
  }

  function quadPts(ax, ay, cx, cy, bx, by, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      pts.push(u * u * ax + 2 * u * t * cx + t * t * bx);
      pts.push(u * u * ay + 2 * u * t * cy + t * t * by);
    }
    return pts;
  }

  // 양 끝을 노드 상자 밖으로 물린다. 화살촉이 상자 안에 파묻히면 방향이 안 보인다.
  function trimPts(pts, ra, rb) {
    var i, s = 0, e = (pts.length / 2) - 1;
    for (i = 0; i < pts.length / 2; i++) {
      if (!inRect(pts[i * 2], pts[i * 2 + 1], ra, 3)) { s = i; break; }
    }
    for (i = (pts.length / 2) - 1; i >= 0; i--) {
      if (!inRect(pts[i * 2], pts[i * 2 + 1], rb, 3)) { e = i; break; }
    }
    if (e <= s) { s = 0; e = (pts.length / 2) - 1; }
    return pts.slice(s * 2, (e + 1) * 2);
  }

  function ptAt(pts, f) {
    var n = pts.length / 2;
    var i = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
    return { x: pts[i * 2], y: pts[i * 2 + 1] };
  }

  // ---------------------------------------------------------------- 그래프 배치
  //
  // 왜 층 배치 + 휘어진 간선인가
  //   상태 기계는 "시작에서 종료로 흐르는" 그림이라 층으로 세우면 읽는 방향이 생긴다.
  //   문제는 canceled 처럼 멀리서 오는 간선이다. 직선으로 그으면 중간 상태의 이름표를
  //   그어 버린다. 그래서 간선마다 **직선부터 시도해 보고, 다른 노드를 지나가면 활을
  //   키운다.** 통과하는 순간의 활 크기가 그 간선의 곡률이다. 라벨(이벤트 이름)도
  //   같은 방식으로 자리를 찾는다 — 겹치지 않는 t 를 고른다.
  //
  //   왕복 간선(running↔paused)은 활을 0 으로 두면 정확히 겹친다. 그런데 활의 기준
  //   방향을 (진행 방향의 수직)으로 잡으면 방향이 뒤집힐 때 수직 벡터도 뒤집혀
  //   저절로 반대쪽으로 휜다. 그래서 왕복 쌍은 후보에서 0 만 빼면 된다.

  function buildGraph(model, vertical, nodeW, nodeH, gapMain, gapCross, fs, noteFs) {
    var ns = model.states, n = ns.length, i;
    var nodes = [];
    var rowsIn = model.rowsIn;
    var maxRows = model.maxRows;
    var noteH = 0;
    for (i = 0; i < n; i++) if (ns[i].note) noteH = noteFs + 4;

    var cross = nodeH + noteH + gapCross;             // 층 안에서 이웃 사이 간격(가로 배치)
    var crossV = nodeW + gapCross;                    // 세로 배치일 때
    for (i = 0; i < n; i++) {
      var L = ns[i].layer, r = ns[i].row, cnt = rowsIn[L];
      var x, y;
      if (vertical) {
        var spanW = cnt * nodeW + (cnt - 1) * gapCross;
        var fullW = maxRows * nodeW + (maxRows - 1) * gapCross;
        x = (fullW - spanW) / 2 + r * crossV;
        y = L * (nodeH + noteH + gapMain);
      } else {
        var spanH = cnt * (nodeH + noteH) + (cnt - 1) * gapCross;
        var fullH = maxRows * (nodeH + noteH) + (maxRows - 1) * gapCross;
        x = L * (nodeW + gapMain);
        y = (fullH - spanH) / 2 + r * cross;
      }
      nodes.push({ x: x, y: y, w: nodeW, h: nodeH, i: i });
    }

    // 충돌 판정용 상자에는 노트 글자까지 넣는다. 간선이 노트를 그으면 안 된다.
    var hits = [];
    for (i = 0; i < n; i++) {
      var lw = ns[i].note ? Math.max(nodeW, estW(ns[i].note, noteFs) + 6) : nodeW;
      hits.push({
        x: nodes[i].x - (lw - nodeW) / 2, y: nodes[i].y,
        w: lw, h: nodeH + (ns[i].note ? noteH : 0)
      });
    }

    // (from,to) 가 같은 전이는 한 간선으로 묶는다. 라벨만 늘어난다.
    var groups = {}, order = [];
    for (i = 0; i < model.trans.length; i++) {
      var t = model.trans[i];
      var key = t.from + '>' + t.to;
      if (!groups[key]) { groups[key] = { from: t.from, to: t.to, evs: [], key: key }; order.push(key); }
      groups[key].evs.push(t.on);
    }

    var pairSet = {};
    for (i = 0; i < order.length; i++) pairSet[order[i]] = true;

    var edges = [], labels = [];
    for (i = 0; i < order.length; i++) {
      var g = groups[order[i]];
      var a = nodes[g.from], b = nodes[g.to];
      var text = g.evs.join(', ');
      var lwid = estW(text, fs) + 10, lhei = fs + 6;

      if (g.from === g.to) {
        // 자기 자신으로 가는 간선. 가로 배치에서는 위쪽, 세로 배치에서는 오른쪽에 고리를 건다.
        var pts = selfLoop(a, vertical);
        var lp = vertical
          ? { x: a.x + a.w + 26 - lwid / 2, y: a.y + a.h / 2 - lhei / 2 }
          : { x: a.x + a.w / 2 - lwid / 2, y: a.y - 30 - lhei / 2 };
        edges.push({ key: g.key, from: g.from, to: g.to, evs: g.evs, pts: pts, self: true });
        labels.push({ x: lp.x, y: lp.y, w: lwid, h: lhei, text: text, key: g.key });
        continue;
      }

      var ax = a.x + a.w / 2, ay = a.y + a.h / 2;
      var bx = b.x + b.w / 2, by = b.y + b.h / 2;
      var dx = bx - ax, dy = by - ay;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var px = dy / len, py = -dx / len;              // 진행 방향의 수직 (오른쪽으로 갈 땐 위)
      var twoWay = !!pairSet[g.to + '>' + g.from];

      var cands = twoWay ? [40, 68, 104, 150, 200] : [0, 44, -44, 78, -78, 120, -120, 170, -170, 230];
      var best = null;
      for (var c = 0; c < cands.length; c++) {
        var bow = cands[c];
        var samples = quadPts(ax, ay, (ax + bx) / 2 + px * bow, (ay + by) / 2 + py * bow, bx, by, 40);
        if (clearOf(samples, hits, g.from, g.to)) { best = samples; break; }
        if (!best) best = samples;                     // 하나도 안 되면 첫 후보라도 쓴다
        if (c === cands.length - 1) best = samples;    // 마지막이면 가장 크게 휜 것
      }
      var trimmed = trimPts(best, hits[g.from], hits[g.to]);
      edges.push({ key: g.key, from: g.from, to: g.to, evs: g.evs, pts: trimmed, self: false });

      // 라벨 자리: 겹치지 않는 t 를 찾는다.
      var tries = [0.5, 0.4, 0.6, 0.3, 0.7, 0.24, 0.76];
      var placed = null;
      for (var q = 0; q < tries.length; q++) {
        var p = ptAt(trimmed, tries[q]);
        var rct = { x: p.x - lwid / 2, y: p.y - lhei / 2, w: lwid, h: lhei };
        var ok = true, z;
        for (z = 0; z < hits.length && ok; z++) if (overlap(rct, hits[z], 1)) ok = false;
        for (z = 0; z < labels.length && ok; z++) if (overlap(rct, labels[z], 1)) ok = false;
        if (ok) { placed = rct; break; }
        if (!placed) placed = rct;
      }
      placed.text = text;
      placed.key = g.key;
      labels.push(placed);
    }

    // 전체를 감싸는 상자를 재서 원점으로 옮긴다. 활이 밖으로 나간 만큼 패널이 커진다.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(x, y) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    for (i = 0; i < hits.length; i++) {
      grow(hits[i].x, hits[i].y);
      grow(hits[i].x + hits[i].w, hits[i].y + hits[i].h);
    }
    for (i = 0; i < edges.length; i++) {
      for (var j = 0; j < edges[i].pts.length; j += 2) grow(edges[i].pts[j], edges[i].pts[j + 1]);
    }
    for (i = 0; i < labels.length; i++) {
      grow(labels[i].x, labels[i].y);
      grow(labels[i].x + labels[i].w, labels[i].y + labels[i].h);
    }
    // 시작 표식(▶)이 들어갈 자리
    if (vertical) minY -= 14; else minX -= 14;
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }

    for (i = 0; i < nodes.length; i++) { nodes[i].x -= minX; nodes[i].y -= minY; }
    for (i = 0; i < hits.length; i++) { hits[i].x -= minX; hits[i].y -= minY; }
    for (i = 0; i < labels.length; i++) { labels[i].x -= minX; labels[i].y -= minY; }
    for (i = 0; i < edges.length; i++) {
      for (var m = 0; m < edges[i].pts.length; m += 2) {
        edges[i].pts[m] -= minX; edges[i].pts[m + 1] -= minY;
      }
    }

    return {
      nodes: nodes, hits: hits, edges: edges, labels: labels,
      w: maxX - minX, h: maxY - minY, vertical: vertical, fs: fs, noteFs: noteFs, noteH: noteH
    };
  }

  function selfLoop(a, vertical) {
    var pts = [];
    var i, t, u;
    var p0, p1, p2, p3;
    if (vertical) {
      p0 = { x: a.x + a.w, y: a.y + a.h * 0.3 };
      p1 = { x: a.x + a.w + 40, y: a.y - 6 };
      p2 = { x: a.x + a.w + 40, y: a.y + a.h + 6 };
      p3 = { x: a.x + a.w, y: a.y + a.h * 0.7 };
    } else {
      p0 = { x: a.x + a.w * 0.3, y: a.y };
      p1 = { x: a.x - 6, y: a.y - 40 };
      p2 = { x: a.x + a.w + 6, y: a.y - 40 };
      p3 = { x: a.x + a.w * 0.7, y: a.y };
    }
    for (i = 0; i <= 24; i++) {
      t = i / 24; u = 1 - t;
      pts.push(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x);
      pts.push(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y);
    }
    return pts;
  }

  function clearOf(pts, hits, skipA, skipB) {
    for (var i = 2; i < pts.length - 2; i += 2) {
      for (var j = 0; j < hits.length; j++) {
        if (j === skipA || j === skipB) continue;
        if (inRect(pts[i], pts[i + 1], hits[j], 4)) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- 전체 배치
  //
  // 계약 §4. 왜 700px 아래에서 세로로 쌓는가: 그래프와 격자를 나란히 두면 둘 다
  // 폭이 절반이 되고, 격자의 칸이 30px 아래로 내려가는 순간 이벤트 이름을 못 읽는다.
  // 격자는 **읽는 표**라서 작아지면 정보가 통째로 사라진다. grid-search 가 폰에서
  // 4분할을 포기하고 한 판을 크게 그리는 것과 같은 판단이다 — 나란히 두는 이득보다
  // 읽히는 것이 먼저다.

  // 기준은 뷰포트가 아니라 **stage 의 폭**이다. 본문 칼럼이 --measure 로 좁혀져 있어
  // 1200px 화면에서도 위젯이 쓰는 폭은 670px 남짓이다(wide 로 벌려도 1400px 위에서나
  // 940px 이 된다). 뷰포트로 문턱을 잡으면 데스크톱에서도 영원히 세로로 쌓인다.
  var SIDE_MIN = 620;      // 이 아래로는 무조건 세로 스택
  var GRAPH_MIN = 250;     // 나란히 둘 때 그래프가 최소한 가져야 하는 폭
  var MIN_SIDE_CELL = 38;  // 나란히 두느라 이보다 좁아지면 이벤트 이름을 못 읽는다
  var VERT_W = 430;        // 그래프 자체를 세로 흐름으로 뒤집는 폭

  function computeLayout(w, model, view, showRejected) {
    var tiny = w < 520, narrow = w < 620;
    var pad = tiny ? 8 : (narrow ? 12 : 16);
    var gap = tiny ? 12 : 18;
    var headH = tiny ? 14 : 16;

    var showM = model.showMatrix && view !== 'graph';
    var showG = view !== 'matrix' || !showM;

    var avail = Math.max(120, w - pad * 2);
    var E = model.events.length, S = model.states.length;

    // ---- 격자 치수 ----
    var mfs = tiny ? 8.5 : (narrow ? 9.5 : 10.5);
    var labelW = 0, i;
    for (i = 0; i < S; i++) labelW = Math.max(labelW, estW(model.states[i].label, mfs));
    labelW = Math.ceil(labelW) + 12;
    var evW = 0;
    for (i = 0; i < E; i++) evW = Math.max(evW, estW(model.events[i], mfs));
    var cellW = Math.ceil(Math.max(tiny ? 30 : 34, evW + 8));
    var cellH = tiny ? 20 : 24;
    var mHeadH = tiny ? 17 : 20;
    var matW = labelW + E * cellW;
    var matH = mHeadH + S * cellH + (tiny ? 16 : 19);   // 마지막 줄은 칸 수 캡션

    // ---- 나란히 둘 수 있는가 ----
    var side = showG && showM && w >= SIDE_MIN;
    var graphAvail = avail;
    if (side) {
      if (matW > avail - GRAPH_MIN - gap) {
        // 칸을 줄여서라도 나란히 둘 수 있으면 둔다. 최소 칸 폭 아래로는 안 간다.
        var need = avail - GRAPH_MIN - gap - labelW;
        var shrunk = Math.floor(need / E);
        if (shrunk >= MIN_SIDE_CELL) { cellW = shrunk; matW = labelW + E * cellW; }
        else side = false;   // 읽히는 것이 나란히 두는 것보다 먼저다(grid-search 와 같은 판단)
      }
      if (side) graphAvail = avail - matW - gap;
    }

    // ---- 그래프 치수 ----
    var g = null;
    if (showG) {
      var vertical = graphAvail < VERT_W;
      var gfs = tiny ? 9 : (narrow ? 10 : 11);
      var noteFs = tiny ? 8 : 8.8;
      var maxLabel = 0;
      for (i = 0; i < S; i++) maxLabel = Math.max(maxLabel, estW(model.states[i].label, gfs));
      var nodeW = Math.max(48, Math.ceil(maxLabel) + 16);
      var nodeH = tiny ? 23 : 27;
      var gapMain = tiny ? 30 : 40;
      var gapCross = tiny ? 20 : 26;

      // 가로 배치가 폭을 넘으면 층 간격부터 줄이고, 그래도 안 되면 세로로 뒤집는다.
      if (!vertical) {
        var natural = model.layers * nodeW + (model.layers - 1) * gapMain + 20;
        if (natural > graphAvail) {
          var slack = model.layers > 1 ? (natural - graphAvail) / (model.layers - 1) : 0;
          gapMain = Math.max(tiny ? 18 : 22, gapMain - slack);
          natural = model.layers * nodeW + (model.layers - 1) * gapMain + 20;
          if (natural > graphAvail) vertical = true;
        }
      }
      g = buildGraph(model, vertical, nodeW, nodeH, gapMain, gapCross, gfs, noteFs);
      // 그래도 넘치면 폭에 맞춰 통째로 축소한다. .wk-stage 는 overflow-x 가 되지만
      // 캔버스를 stage 보다 넓게 잡을 이유는 없다.
      g.scale = g.w > graphAvail ? Math.max(0.55, graphAvail / g.w) : 1;
    }

    // ---- 세로 위치 ----
    var y = pad;
    var gy = 0, my = 0, gw = 0, gh = 0;
    if (showG) {
      gw = g.w * g.scale;
      gh = g.h * g.scale;
    }
    var gx = pad, mx = pad, gtY = 0, mtY = 0;

    if (side) {
      // 세로 흐름 그래프는 격자보다 훨씬 길다. 짧은 쪽을 가운데로 올려야 두 패널이
      // 한 덩어리로 읽힌다 — 위만 맞추면 오른쪽이 허공에 떠 보인다.
      var band = Math.max(gh, matH);
      gtY = mtY = y + headH - 5;      // 제목은 두 패널 위에 나란히 — 높이가 어긋나면 안 읽힌다
      gy = y + headH + (band - gh) / 2;
      my = y + headH + (band - matH) / 2;
      gx = pad + Math.max(0, (graphAvail - gw) / 2);
      mx = pad + graphAvail + gap;
      y = y + headH + band + (tiny ? 12 : 16);
    } else {
      if (showG) {
        gtY = y + headH - 5;
        gy = y + headH;
        gx = pad + Math.max(0, (avail - gw) / 2);
        y = gy + gh + (tiny ? 12 : 16);
      }
      if (showM) {
        mtY = y + headH - 5;
        my = y + headH;
        mx = pad + Math.max(0, (avail - matW) / 2);
        y = my + matH + (tiny ? 12 : 16);
      }
    }

    // ---- 스크립트 테이프 ----
    var tfs = tiny ? 9 : 10;
    var chips = [], rows = 1;
    var cx = pad, cy = y + headH;
    var chipH = tiny ? 19 : 22;
    for (i = 0; i < model.script.length; i++) {
      var cw = Math.ceil(estW(model.script[i], tfs)) + (tiny ? 14 : 18);
      if (cx + cw > pad + avail && cx > pad) { cx = pad; cy += chipH + 5; rows++; }
      chips.push({ x: cx, y: cy, w: cw, h: chipH, text: model.script[i], k: i });
      cx += cw + 5;
    }
    y = cy + chipH + (tiny ? 10 : 13);

    // ---- 현재 상태 줄 ----
    var stripY = y;
    var stripH = tiny ? 20 : 23;
    y = stripY + stripH + pad;

    return {
      w: w, tiny: tiny, narrow: narrow, pad: pad, headH: headH, side: side,
      showG: showG, showM: showM, view: view, showRejected: showRejected,
      graph: g, gx: gx, gy: gy, gw: gw, gh: gh, gtY: gtY, mtY: mtY,
      mx: mx, my: my, matW: matW, matH: matH,
      labelW: labelW, cellW: cellW, cellH: cellH, mHeadH: mHeadH, mfs: mfs,
      chips: chips, tapeRows: rows, chipH: chipH, tfs: tfs,
      stripY: stripY, stripH: stripH,
      height: Math.max(120, y)
    };
  }

  // ---------------------------------------------------------------- 위젯

  K.register('state-machine', function (host, opts) {
    if (!opts || typeof opts !== 'object' || isArr(opts)) opts = {};

    var model = buildModel(opts);
    model.showMatrix = (opts.showMatrix === false) ? false : true;
    var showRejected = (opts.showRejected === false) ? false : true;

    // kind: 지금은 평면 FSM 만 그린다. 모르는 값이 와도 던지지 않고 그 사실을 적는다.
    var kind = str(opts.kind) || 'fsm';
    var kindNote = (kind.toLowerCase() === 'fsm') ? null
      : 'kind="' + clip(kind, 10) + '" 는 아직 평면 상태 기계로 그린다 (계층·행동 트리는 XI-6)';

    var title = str(opts.title);

    var steps = buildSteps(model, showRejected);
    var cur = 0;
    var view = model.showMatrix ? 'both' : 'graph';
    var cache = null;

    // wide: 그래프와 격자를 나란히 두려면 폭이 필요하다. ≥1400px 화면에서 본문 폭을
    // 조금 넘어 벌어진다(§8). 좁은 화면에서는 아무 효과가 없다.
    var ui = K.frame(host, { title: '', wide: true });
    var titleEl = K.el('div', 'wk-title', '상태 기계' + (title ? ' — ' + title : ''));
    ui.head.insertBefore(titleEl, ui.head.firstChild);

    // ---- 머리말 세그 ----
    // 폰에서 격자만 크게 보고 싶을 때가 있다. 나란히 두는 것을 포기하는 대신
    // 무엇을 볼지는 독자가 고른다.
    var segEl = null;
    if (model.showMatrix) {
      segEl = K.seg(ui.slot, [
        { label: '둘 다', value: 'both' },
        { label: '그래프', value: 'graph' },
        { label: '격자', value: 'matrix' }
      ], view, function (v) {
        view = v;
        cache = null;
        cv.redraw();
      });
    }

    // ---- 범례 (계약 §5: 색만으로 정보를 주지 않는다) ----
    var legend = K.el('div', 'wk-legend');
    legend.style.width = '100%';
    legend.innerHTML =
      '<span><i style="background:var(--w-frontier)"></i>현재 상태</span>' +
      '<span><i style="background:var(--w-path)"></i>방금 지난 전이</span>' +
      (showRejected ? '<span><i style="background:var(--box-danger)"></i>거부 — 격자의 빈칸(×)</span>' : '') +
      (model.showMatrix ? '<span>격자: <b>O</b> 전이 있음 · <b>·</b> 없음 (빈칸이 곧 규칙이다)</span>' : '') +
      (model.flagName ? '<span>' + model.flagName + '은 상태의 함수다 — 진입 동작 한 곳에서만 바뀐다</span>' : '');
    ui.slot.appendChild(legend);

    function L() {
      var w = cv.size.w || 320;
      if (!cache || cache.w !== w || cache.view !== view) {
        cache = computeLayout(w, model, view, showRejected);
      }
      return cache;
    }

    // ---- 그리기 보조 ----

    function section(ctx, T, l, text, x, y) {
      ctx.fillStyle = T.fgDim;
      ctx.font = '700 ' + (l.tiny ? 9.5 : 11) + 'px ' + SANS;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x, y);
    }

    function pill(ctx, T, r, text, fs, color, bold) {
      ctx.save();
      ctx.fillStyle = T.bg;
      rrect(ctx, r.x, r.y, r.w, r.h, 3);
      ctx.fill();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = bold ? 1.6 : 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = (bold ? '700 ' : '') + fs + 'px ' + MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      ctx.restore();
    }

    function polyline(ctx, pts, color, lw, alpha, dash) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
      ctx.restore();
    }

    function arrowHead(ctx, pts, color, s) {
      var n = pts.length;
      if (n < 4) return;
      var bx = pts[n - 2], by = pts[n - 1];
      var ax = pts[n - 4], ay = pts[n - 3];
      var dx = bx - ax, dy = by - ay;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - ux * s - uy * s * 0.55, by - uy * s + ux * s * 0.55);
      ctx.lineTo(bx - ux * s + uy * s * 0.55, by - uy * s - ux * s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ---- 그래프 ----
    function drawGraph(ctx, T, l, s) {
      var g = l.graph;
      if (!g) return;
      ctx.save();
      ctx.translate(l.gx, l.gy);
      ctx.scale(g.scale, g.scale);

      var i, e;
      var takenKey = (s.kind === 'move') ? (s.from + '>' + s.to) : null;

      // 1) 보통 간선 → 2) 방금 지난 간선 순으로 그린다. 강조가 뒤에 와야 위에 남는다.
      for (var pass = 0; pass < 2; pass++) {
        for (i = 0; i < g.edges.length; i++) {
          e = g.edges[i];
          var hot = (e.key === takenKey);
          if ((pass === 0) === hot) continue;
          var col = hot ? T.wPath : T.border;
          polyline(ctx, e.pts, col, hot ? 2.6 : 1.2, hot ? 1 : 0.85, null);
          arrowHead(ctx, e.pts, hot ? T.wPath : T.fgFaint, hot ? 7 : 5.5);
        }
      }

      // 노드
      for (i = 0; i < g.nodes.length; i++) {
        var nd = g.nodes[i];
        var st = model.states[i];
        var isCur = (s.state === i);
        var wasHere = !!s.seen[i];
        var rejectHere = (s.kind === 'reject' && isCur);

        ctx.save();
        ctx.fillStyle = T.bgElev;
        rrect(ctx, nd.x, nd.y, nd.w, nd.h, 6);
        ctx.fill();
        if (isCur) {
          ctx.globalAlpha = 0.26;
          ctx.fillStyle = rejectHere ? T.boxDanger : T.wFrontier;
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (wasHere) {
          ctx.globalAlpha = 0.34;
          ctx.fillStyle = T.wVisited;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = isCur ? 2.6 : 1.2;
        ctx.strokeStyle = isCur ? (rejectHere ? T.boxDanger : T.wFrontier) : T.border;
        ctx.stroke();
        // 종료 상태는 이중 테두리. 색이 아니라 모양으로 구분한다(계약 §5).
        if (st.terminal) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = isCur ? (rejectHere ? T.boxDanger : T.wFrontier) : T.fgFaint;
          rrect(ctx, nd.x + 3, nd.y + 3, nd.w - 6, nd.h - 6, 4);
          ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = T.fg;
        ctx.font = '700 ' + g.fs + 'px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.label, nd.x + nd.w / 2, nd.y + nd.h / 2 + 0.5);

        // 진입 동작. 방금 실행된 것만 금색으로 켠다 — 나머지는 항상 보이되 조용히.
        if (st.note) {
          var justRan = (s.kind === 'move' && s.to === i && !s.self && s.note);
          ctx.fillStyle = justRan ? T.wPath : T.fgFaint;
          ctx.font = (justRan ? '700 ' : '') + g.noteFs + 'px ' + SANS;
          ctx.textBaseline = 'top';
          ctx.fillText(st.note, nd.x + nd.w / 2, nd.y + nd.h + 3);
        }

        // 시작 표식
        if (i === model.initial) {
          ctx.fillStyle = T.fgDim;
          ctx.font = '700 ' + (g.fs - 1) + 'px ' + SANS;
          ctx.textBaseline = 'middle';
          if (g.vertical) {
            ctx.textAlign = 'center';
            ctx.fillText('▼', nd.x + nd.w / 2, nd.y - 7);
          } else {
            ctx.textAlign = 'right';
            ctx.fillText('▶', nd.x - 3, nd.y + nd.h / 2);
          }
        }
      }

      // 간선 라벨(이벤트 이름). 노드 위에 얹어야 선에 가려지지 않는다.
      for (i = 0; i < g.labels.length; i++) {
        var lb = g.labels[i];
        var hot2 = (lb.key === takenKey);
        pill(ctx, T, lb, lb.text, g.fs - 1.5, hot2 ? T.wPath : T.fgDim, hot2);
      }
      ctx.restore();
    }

    // ---- 격자 ----
    function drawMatrix(ctx, T, l, s) {
      var S = model.states.length, E = model.events.length;
      var x0 = l.mx, y0 = l.my;
      var i, j;

      // 현재 행·열 띠. 격자에서 "지금 어느 줄을 보는가"가 먼저 읽혀야 한다.
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = T.wFrontier;
      ctx.fillRect(x0, y0 + l.mHeadH + s.state * l.cellH, l.labelW + E * l.cellW, l.cellH);
      if (s.ei >= 0) ctx.fillRect(x0 + l.labelW + s.ei * l.cellW, y0, l.cellW, l.mHeadH + S * l.cellH);
      ctx.restore();

      // 헤더
      ctx.font = l.mfs + 'px ' + MONO;
      ctx.textBaseline = 'middle';
      for (j = 0; j < E; j++) {
        ctx.fillStyle = (j === s.ei) ? T.fg : T.fgDim;
        ctx.textAlign = 'center';
        ctx.fillText(model.events[j], x0 + l.labelW + (j + 0.5) * l.cellW, y0 + l.mHeadH / 2);
      }
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + l.mHeadH - 0.5);
      ctx.lineTo(x0 + l.labelW + E * l.cellW, y0 + l.mHeadH - 0.5);
      ctx.moveTo(x0 + l.labelW - 0.5, y0);
      ctx.lineTo(x0 + l.labelW - 0.5, y0 + l.mHeadH + S * l.cellH);
      ctx.stroke();

      for (i = 0; i < S; i++) {
        var ry = y0 + l.mHeadH + i * l.cellH;
        ctx.fillStyle = (i === s.state) ? T.fg : T.fgDim;
        ctx.font = ((i === s.state) ? '700 ' : '') + l.mfs + 'px ' + MONO;
        ctx.textAlign = 'left';
        ctx.fillText(model.states[i].label, x0 + 4, ry + l.cellH / 2);

        for (j = 0; j < E; j++) {
          var cxx = x0 + l.labelW + j * l.cellW;
          var open = model.matrix[i][j] >= 0;
          var key = i + ':' + j;
          var wasUsed = !!s.used[key], wasRej = !!s.rej[key];
          var isNow = (s.state === i && s.ei === j && (s.kind === 'move' || s.kind === 'reject'));

          // 열린 칸은 옅은 채움 + 글자 O. 색을 못 보는 독자에게도 O/· 로 구분된다.
          if (open) {
            ctx.save();
            ctx.globalAlpha = isNow ? 0.34 : (wasUsed ? 0.22 : 0.12);
            ctx.fillStyle = isNow ? T.wPath : (wasUsed ? T.wVisited : T.wFrontier);
            rrect(ctx, cxx + 2, ry + 2, l.cellW - 4, l.cellH - 4, 3);
            ctx.fill();
            ctx.restore();
          }
          if (isNow) {
            ctx.save();
            ctx.lineWidth = 2;
            ctx.strokeStyle = open ? T.wPath : T.boxDanger;
            rrect(ctx, cxx + 1.5, ry + 1.5, l.cellW - 3, l.cellH - 3, 3);
            ctx.stroke();
            ctx.restore();
          }

          var glyph = open ? 'O' : '·';
          var col = T.fgFaint;
          if (open) col = isNow ? T.wPath : (wasUsed ? T.fg : T.fgDim);
          if (!open && (wasRej || (isNow && !open))) { glyph = '×'; col = T.boxDanger; }
          ctx.fillStyle = col;
          ctx.font = ((isNow || (open && wasUsed)) ? '700 ' : '') + (l.mfs + 1) + 'px ' + MONO;
          ctx.textAlign = 'center';
          ctx.globalAlpha = (!open && wasRej && !isNow) ? 0.6 : 1;
          ctx.fillText(glyph, cxx + l.cellW / 2, ry + l.cellH / 2);
          ctx.globalAlpha = 1;
        }
      }

      // 격자선
      ctx.save();
      ctx.strokeStyle = T.border;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 0; i <= S; i++) {
        var gy2 = y0 + l.mHeadH + i * l.cellH + 0.5;
        ctx.moveTo(x0 + l.labelW, gy2);
        ctx.lineTo(x0 + l.labelW + E * l.cellW, gy2);
      }
      for (j = 0; j <= E; j++) {
        var gx2 = x0 + l.labelW + j * l.cellW + 0.5;
        ctx.moveTo(gx2, y0 + l.mHeadH);
        ctx.lineTo(gx2, y0 + l.mHeadH + S * l.cellH);
      }
      ctx.stroke();
      ctx.restore();

      // 칸 수 캡션 — 본문 §4.2 의 "42칸 중 11칸" 문장이 여기서 그대로 나온다.
      var total = S * E;
      ctx.fillStyle = T.fgFaint;
      ctx.font = (l.tiny ? 9 : 10) + 'px ' + SANS;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('열린 칸 ' + model.filled + ' · 빈칸 ' + (total - model.filled) + ' / 전체 ' + total,
                   x0, y0 + l.mHeadH + S * l.cellH + 4);
    }

    // ---- 스크립트 테이프 + 현재 줄 ----
    function drawTape(ctx, T, l, s) {
      var i;
      for (i = 0; i < l.chips.length; i++) {
        var c = l.chips[i];
        var state;   // 'past-ok' | 'past-rej' | 'now' | 'now-rej' | 'future'
        if (s.k > c.k) state = pastKind(c.k);
        else if (s.k === c.k) state = (s.kind === 'reject') ? 'now-rej' : 'now';
        else state = 'future';

        var col = T.fgFaint, alpha = 0.1, bold = false, mark = '';
        if (state === 'now') { col = T.wPath; alpha = 0.3; bold = true; mark = ' ✓'; }
        else if (state === 'now-rej') { col = T.boxDanger; alpha = 0.3; bold = true; mark = ' ×'; }
        else if (state === 'past-ok') { col = T.wVisited; alpha = 0.34; mark = ' ✓'; }
        else if (state === 'past-rej') { col = T.boxDanger; alpha = 0.18; mark = ' ×'; }

        ctx.save();
        ctx.fillStyle = T.bgElev;
        rrect(ctx, c.x, c.y, c.w, c.h, 4);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = bold ? 2 : 1;
        ctx.strokeStyle = (state === 'future') ? T.border : col;
        if (state === 'future') ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = (state === 'future') ? T.fgFaint : T.fg;
        ctx.font = (bold ? '700 ' : '') + l.tfs + 'px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.text, c.x + c.w / 2, c.y + c.h / 2 + 0.5);
        ctx.restore();

        if (mark) {
          ctx.fillStyle = col;
          ctx.font = '700 ' + (l.tfs - 1) + 'px ' + SANS;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText(mark.trim(), c.x + c.w - 2, c.y + 1);
        }
      }

      // 현재 줄: 상태 · 진입 동작 · 플래그
      var x = l.pad, y = l.stripY, h = l.stripH;
      var fs = l.tiny ? 9.5 : 10.5;
      ctx.font = fs + 'px ' + SANS;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = T.fgDim;
      ctx.fillText('현재', x, y + h / 2);
      x += estW('현재', fs) + 7;

      var st = model.states[s.state];
      var w1 = estW(st.label, fs) + 14;
      pill(ctx, T, { x: x, y: y, w: w1, h: h }, st.label,
           fs, s.kind === 'reject' ? T.boxDanger : T.wFrontier, true);
      x += w1 + 6;

      var noteTxt = '진입 동작 ' + (s.kind === 'move' && s.note ? s.note : '—');
      var w2 = estW(noteTxt, fs) + 14;
      var noteCol = (s.kind === 'move' && s.note) ? T.wPath : T.fgFaint;
      pill(ctx, T, { x: x, y: y, w: w2, h: h }, noteTxt, fs, noteCol, false);
      x += w2 + 6;

      if (model.flagName) {
        var ft = flagText(model, s.state);
        var w3 = estW(ft, fs) + 14;
        pill(ctx, T, { x: x, y: y, w: w3, h: h }, ft, fs, s.flag ? T.wPath : T.fgFaint, s.flag);
        x += w3 + 6;
      }
    }

    function pastKind(k) {
      return model.outcomes[k] === 'rej' ? 'past-rej' : 'past-ok';
    }

    var cv = K.canvas(ui.stage, {
      height: function (w) { return computeLayout(w, model, view, showRejected).height; },
      draw: function (ctx, size, T) {
        var s = steps[cur];
        if (!s) return;
        var l = L();

        ctx.textBaseline = 'alphabetic';
        if (l.showG) {
          section(ctx, T, l, '상태 그래프 — 어디로 갈 수 있는가', l.gx, l.gtY);
        }
        if (l.showM) {
          section(ctx, T, l, (l.tiny || l.side) ? '전이 격자 — 어디로 갈 수 없는가'
                                                : '전이 격자 (상태 × 이벤트) — 어디로 갈 수 없는가', l.mx, l.mtY);
        }
        if (l.showG) drawGraph(ctx, T, l, s);
        if (l.showM) drawMatrix(ctx, T, l, s);

        section(ctx, T, l, '스크립트', l.pad, (l.chips.length ? l.chips[0].y : l.stripY) - 5);
        drawTape(ctx, T, l, s);

        if (kindNote) {
          ctx.fillStyle = T.fgFaint;
          ctx.font = (l.tiny ? 8.5 : 9.5) + 'px ' + SANS;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(kindNote, size.w - l.pad, l.height - 2);
        }
        if (model.dropped) {
          ctx.fillStyle = T.boxWarn;
          ctx.font = (l.tiny ? 8.5 : 9.5) + 'px ' + SANS;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText('알 수 없는 상태·중복을 가리키는 전이 ' + model.dropped + '개를 버렸다',
                       size.w - l.pad, l.height - (kindNote ? 13 : 2));
        }
      }
    });

    var play = K.player(ui, {
      total: function () { return steps.length; },
      render: function (i) { cur = i; cv.redraw(); },
      label: function (i) { return steps[i] ? steps[i].msg : ''; },
      speed: 760
    });

    play.goto(0);

    // 테스트·디버깅 훅. 전역 오염은 금지라 host 요소에만 붙인다(계약 §1).
    host.__stateMachine = {
      kind: function () { return kind; },
      model: function () { return model; },
      states: function () { return model.states.map(function (s) { return s.id; }); },
      events: function () { return model.events.slice(); },
      transitions: function () { return model.trans.slice(); },
      matrix: function () { return model.matrix.map(function (r) { return r.slice(); }); },
      filled: function () { return model.filled; },
      steps: function () { return steps; },
      // 본문 §3 의 손추적 표와 같은 모양으로 낸다. 이것이 위젯이 챕터와
      // 같은 말을 하는지 확인하는 유일한 방법이다(계약 §9).
      trace: function () {
        var out = [];
        for (var i = 1; i < steps.length; i++) {
          var s = steps[i];
          if (s.kind !== 'move' && s.kind !== 'reject') continue;
          out.push({
            step: s.k,
            event: s.ev,
            from: model.states[s.from].id,
            found: s.kind === 'move',
            to: model.states[s.state].id,
            note: (s.kind === 'move' && s.note) ? s.note : '—',
            flag: s.flag ? '켜짐' : '꺼짐'
          });
        }
        return out;
      },
      view: function () { return view; },
      setView: function (v) {
        if (['both', 'graph', 'matrix'].indexOf(v) < 0) return false;
        view = v;
        cache = null;
        if (segEl) {
          Array.prototype.forEach.call(segEl.children, function (c) {
            c.classList.toggle('is-active', c.getAttribute('data-val') === view);
          });
        }
        cv.redraw();
        return true;
      },
      layout: function () { return L(); },
      goto: function (i) { play.goto(i); }
    };
  });
})();
