/* app.js — 라우팅 · 목차 · 검색 · 진도 · SRS · 언어 토글
 *
 * 이 파일은 통합 지점이다. 렌더링은 markdown.js, 강조는 highlight.js,
 * 시각화는 widgets/*.js 가 맡고, 여기서는 그것들을 화면에 붙이고 상태를 관리한다.
 *
 * 저장은 전부 localStorage 이고 네임스페이스는 'algobook:' 이다.
 * 사생활 보호 모드에서는 setItem 이 예외를 던진다. 그래서 모든 접근을 감싼다 —
 * 저장이 안 되는 것은 불편이지만, 예외로 앱이 죽는 것은 고장이다.
 */
(function () {
  'use strict';

  var BOOK = window.BOOK || { meta: {}, toc: [], docs: {}, classify: [] };
  var MD = window.MD;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var LS = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem('algobook:' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('algobook:' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ }
    }
  };

  // 목차를 평평하게 편 배열. 이전/다음 절 이동과 검색이 이 순서를 쓴다.
  var FLAT = [];
  (function buildFlat() {
    for (var i = 0; i < BOOK.toc.length; i++) {
      var part = BOOK.toc[i];
      for (var j = 0; j < (part.chapters || []).length; j++) {
        var ch = part.chapters[j];
        FLAT.push({ id: ch.id, num: ch.num, title: ch.title, partNum: part.num, partTitle: part.title });
      }
    }
  })();

  var CH = {};
  FLAT.forEach(function (c) { CH[c.id] = c; });

  function hasDoc(id) { return Object.prototype.hasOwnProperty.call(BOOK.docs, id); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------- 테마 · 글자 크기

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    LS.set('theme', t);
  }

  function applyFont(f) {
    document.documentElement.setAttribute('data-font', f);
    LS.set('font', f);
  }

  (function initChrome() {
    // 저장된 값이 없으면 OS 설정을 따른다. 첫 방문자에게 강제로 다크를 씌우지 않는다.
    var saved = LS.get('theme', null);
    if (!saved) {
      var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      saved = prefersLight ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', saved);
    document.documentElement.setAttribute('data-font', LS.get('font', 'm'));
  })();

  // ---------------------------------------------------------------- 언어 토글
  //
  // 'both' 가 기본값인 이유: 이 책의 정체성이 이중 언어 대조다.
  // 한쪽만 보는 것은 선택이지 기본이 아니다.

  var LANGS = ['python', 'cpp', 'both'];

  function currentLang() {
    var v = LS.get('lang', 'both');
    return LANGS.indexOf(v) >= 0 ? v : 'both';
  }

  function applyLang(lang) {
    LS.set('lang', lang);
    $$('#lang-toggle .seg-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-lang') === lang);
      b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
    $$('#doc .dual').forEach(function (dual) { applyLangToDual(dual, lang); });
  }

  function applyLangToDual(dual, lang) {
    var panes = $$('.dual-pane', dual);
    var tabs = $$('.dual-tab', dual);
    var available = panes.map(function (p) { return p.getAttribute('data-dual-lang'); });

    if (lang === 'both') {
      dual.classList.add('is-both');
      panes.forEach(function (p) { p.classList.add('is-active'); });
      return;
    }

    dual.classList.remove('is-both');
    // 요청한 언어가 이 블록에 없으면(한쪽만 실은 블록) 있는 쪽을 보인다.
    var target = available.indexOf(lang) >= 0 ? lang : available[0];
    panes.forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-dual-lang') === target);
    });
    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-dual-lang') === target);
      t.setAttribute('aria-selected', t.getAttribute('data-dual-lang') === target ? 'true' : 'false');
    });
  }

  // 탭을 직접 누르면 그 블록만 바뀐다. 전역 설정까지 바꾸지는 않는다 —
  // 한 곳에서 C++ 을 잠깐 보려던 것이 책 전체 설정을 갈아엎으면 곤란하다.
  function wireDualTabs(root) {
    $$('.dual', root).forEach(function (dual) {
      $$('.dual-tab', dual).forEach(function (tab) {
        tab.addEventListener('click', function () {
          dual.classList.remove('is-both');
          var want = tab.getAttribute('data-dual-lang');
          $$('.dual-pane', dual).forEach(function (p) {
            p.classList.toggle('is-active', p.getAttribute('data-dual-lang') === want);
          });
          $$('.dual-tab', dual).forEach(function (t) {
            t.classList.toggle('is-active', t === tab);
            t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
          });
        });
      });
    });
  }

  // ---------------------------------------------------------------- 진도

  function progress() { return LS.get('progress', {}); }

  function isDone(id) { return !!progress()[id]; }

  function setDone(id, done) {
    var p = progress();
    if (done) { p[id] = Date.now(); } else { delete p[id]; }
    LS.set('progress', p);
    renderProgressLine();
    markTocDone();
  }

  function renderProgressLine() {
    var el = $('#progress-line');
    if (!el) return;
    var total = FLAT.filter(function (c) { return hasDoc(c.id); }).length;
    var done = Object.keys(progress()).length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    el.innerHTML =
      '<div class="progress-bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="progress-text">' + done + ' / ' + total + ' 절 · ' + pct + '%</div>';
  }

  function markTocDone() {
    var p = progress();
    $$('#toc-tree a[data-id]').forEach(function (a) {
      a.classList.toggle('is-done', !!p[a.getAttribute('data-id')]);
    });
  }

  // ---------------------------------------------------------------- SRS (SM-2)
  //
  // 챕터 단위가 아니라 ::: classify 항목 단위로 돌린다.
  // 알고리즘 학습에서 휘발하는 것은 "챕터를 읽었다"가 아니라
  // "이 지문을 보고 유형을 맞출 수 있다" 쪽이기 때문이다.

  var DAY = 86400000;

  function srsAll() { return LS.get('srs', {}); }

  function srsCards() {
    return (BOOK.classify || []).map(function (c) {
      return {
        key: 'classify:' + c.chapter,
        chapter: c.chapter,
        num: c.num,
        title: c.title,
        front: [c.signals, c.constraints].filter(Boolean).join('\n'),
        back: [c.num + ' ' + c.title, c.confusion, c.traps].filter(Boolean).join('\n')
      };
    });
  }

  function srsState(key) {
    var s = srsAll()[key];
    // 처음 보는 카드는 지금 당장 만기다. 안 그러면 새 챕터가 큐에 영원히 안 뜬다.
    return s || { ease: 2.5, interval: 0, due: 0, reps: 0, lapses: 0 };
  }

  function srsDue() {
    var now = Date.now();
    return srsCards().filter(function (c) { return srsState(c.key).due <= now; });
  }

  /* SM-2. grade 는 UI 4단계(0=모름 1=어려움 2=보통 3=쉬움)이고
   * 원 논문의 quality 0~5 로 옮겨서 계산한다. 3 미만이 실패다. */
  function srsGrade(key, grade) {
    var q = [2, 3, 4, 5][grade];
    var s = srsState(key);

    if (q < 3) {
      s.reps = 0;
      s.lapses += 1;
      s.interval = 1;
    } else {
      if (s.reps === 0) { s.interval = 1; }
      else if (s.reps === 1) { s.interval = 6; }
      else { s.interval = Math.round(s.interval * s.ease); }
      s.reps += 1;
      s.ease = s.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      if (s.ease < 1.3) { s.ease = 1.3; }  // 원 논문의 하한. 밑으로 두면 간격이 영영 안 늘어난다.
    }

    s.due = Date.now() + s.interval * DAY;
    var all = srsAll();
    all[key] = s;
    LS.set('srs', all);
    updateReviewBadge();
  }

  function updateReviewBadge() {
    var badge = $('#btn-review .badge');
    if (!badge) return;
    var n = srsDue().length;
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  var reviewQueue = [];
  var reviewIndex = 0;
  var reviewRevealed = false;

  function openReview() {
    reviewQueue = srsDue();
    reviewIndex = 0;
    reviewRevealed = false;
    renderReview();
    openModal('#review-modal');
  }

  function renderReview() {
    var body = $('#review-body');
    if (!body) return;

    if (!reviewQueue.length) {
      body.innerHTML =
        '<div class="review-empty"><h2>오늘 복습할 것이 없다</h2>' +
        '<p>새 챕터를 읽으면 그 챕터의 유형 판별 카드가 큐에 들어온다.</p>' +
        '<button class="btn" type="button" data-review-close>닫기</button></div>';
      return;
    }

    if (reviewIndex >= reviewQueue.length) {
      body.innerHTML =
        '<div class="review-empty"><h2>큐를 비웠다</h2>' +
        '<p>' + reviewQueue.length + '개를 복습했다.</p>' +
        '<button class="btn" type="button" data-review-close>닫기</button></div>';
      return;
    }

    var card = reviewQueue[reviewIndex];
    var html =
      '<div class="review-card">' +
      '<div class="review-count">' + (reviewIndex + 1) + ' / ' + reviewQueue.length + '</div>' +
      '<div class="review-front">' + MD.render(card.front) + '</div>';

    if (reviewRevealed) {
      html +=
        '<div class="review-back">' + MD.render(card.back) + '</div>' +
        '<div class="review-grades">' +
        '<button class="btn grade-0" type="button" data-grade="0">모름</button>' +
        '<button class="btn grade-1" type="button" data-grade="1">어려움</button>' +
        '<button class="btn grade-2" type="button" data-grade="2">보통</button>' +
        '<button class="btn grade-3" type="button" data-grade="3">쉬움</button>' +
        '</div>' +
        '<a class="review-jump" href="#/' + escapeHtml(card.chapter) + '" data-review-close>' +
        escapeHtml(card.num + ' ' + card.title) + ' 로 가기</a>';
    } else {
      html += '<div class="review-grades"><button class="btn" type="button" data-reveal>답 보기</button></div>';
    }

    html += '</div>';
    body.innerHTML = html;
  }

  // ---------------------------------------------------------------- 좌측 목차

  function renderToc() {
    var tree = $('#toc-tree');
    if (!tree) return;
    var html = '';
    BOOK.toc.forEach(function (part) {
      html += '<section class="toc-part" data-part="' + escapeHtml(part.id) + '">';
      html += '<h3 class="toc-part-title"><span class="toc-part-num">' + escapeHtml(part.num) +
              '</span> ' + escapeHtml(part.title) + '</h3>';
      html += '<ul class="toc-list">';
      (part.chapters || []).forEach(function (ch) {
        var empty = hasDoc(ch.id) ? '' : ' is-empty';
        html += '<li><a href="#/' + escapeHtml(ch.id) + '" data-id="' + escapeHtml(ch.id) +
                '" class="toc-link' + empty + '">' +
                '<span class="toc-num">' + escapeHtml(ch.num) + '</span>' +
                '<span class="toc-title">' + escapeHtml(ch.title) + '</span></a></li>';
      });
      html += '</ul></section>';
    });
    tree.innerHTML = html;
    markTocDone();
  }

  function filterToc(q) {
    var needle = q.trim().toLowerCase();
    $$('#toc-tree .toc-part').forEach(function (sec) {
      var any = false;
      $$('li', sec).forEach(function (li) {
        var text = li.textContent.toLowerCase();
        var hit = !needle || text.indexOf(needle) >= 0;
        li.hidden = !hit;
        if (hit) any = true;
      });
      sec.hidden = !any;
    });
  }

  function highlightCurrentToc(id) {
    $$('#toc-tree a[data-id]').forEach(function (a) {
      a.classList.toggle('is-current', a.getAttribute('data-id') === id);
    });
    var cur = $('#toc-tree a.is-current');
    if (cur && cur.scrollIntoView) {
      // 목차가 길다. 현재 절이 화면 밖이면 사용자가 자기 위치를 잃는다.
      var box = cur.getBoundingClientRect();
      var nav = $('#sidebar').getBoundingClientRect();
      if (box.top < nav.top || box.bottom > nav.bottom) {
        cur.scrollIntoView({ block: 'center' });
      }
    }
  }

  // ---------------------------------------------------------------- 인북 목차 + 스크롤 스파이

  function renderInbook(md) {
    var aside = $('#inbook');
    if (!aside) return;
    var hs = (MD.headings ? MD.headings(md) : []) || [];
    if (!hs.length) { aside.innerHTML = ''; return; }
    var html = '<div class="inbook-title">이 절의 내용</div><ul class="inbook-list">';
    hs.forEach(function (h) {
      html += '<li class="lv' + h.level + '"><a href="#' + escapeHtml(h.id) + '" data-anchor="' +
              escapeHtml(h.id) + '">' + escapeHtml(h.text) + '</a></li>';
    });
    aside.innerHTML = html + '</ul>';
  }

  var spyTicking = false;
  function spy() {
    if (spyTicking) return;
    spyTicking = true;
    requestAnimationFrame(function () {
      spyTicking = false;
      var links = $$('#inbook a[data-anchor]');
      if (!links.length) return;
      var best = null;
      var bestTop = -Infinity;
      links.forEach(function (a) {
        var t = document.getElementById(a.getAttribute('data-anchor'));
        if (!t) return;
        var top = t.getBoundingClientRect().top - 90;
        if (top <= 0 && top > bestTop) { bestTop = top; best = a; }
      });
      links.forEach(function (a) { a.classList.toggle('is-current', a === best); });
    });
  }

  // ---------------------------------------------------------------- 위젯 · 복사 버튼

  function mountWidgets(root) {
    $$('.widget[data-widget]', root).forEach(function (el) {
      var type = el.getAttribute('data-widget');
      var opts = {};
      try { opts = JSON.parse(el.getAttribute('data-opts') || '{}'); } catch (e) { opts = {}; }
      var reg = window.Widgets || {};
      if (typeof reg[type] !== 'function') {
        // 아직 구현되지 않은 위젯은 자리를 남기고 넘어간다. 콘텐츠가 위젯보다 먼저 쓰이므로
        // 이 상태는 정상적인 중간 단계다. 크래시로 페이지를 죽이지 않는다.
        el.classList.add('is-placeholder');
        el.innerHTML = '<div class="widget-placeholder">위젯 <code>' + escapeHtml(type) + '</code> — 준비 중</div>';
        return;
      }
      try {
        reg[type](el, opts);
      } catch (err) {
        el.classList.add('is-error');
        el.innerHTML = '<div class="widget-placeholder">위젯 <code>' + escapeHtml(type) + '</code> 오류</div>';
        if (window.console) console.error('widget', type, err);
      }
    });
  }

  function wireCopy(root) {
    $$('.codeblock-copy', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var block = btn.closest('.codeblock');
        var code = block ? block.querySelector('pre.code') : null;
        if (!code) return;
        // 줄 번호는 복사에서 빼야 한다. 붙여넣고 나서 지우게 만들면 안 된다.
        var clone = code.cloneNode(true);
        Array.prototype.slice.call(clone.querySelectorAll('.ln')).forEach(function (n) {
          n.parentNode.removeChild(n);
        });
        var text = clone.textContent;
        var done = function () {
          btn.textContent = '복사됨';
          setTimeout(function () { btn.textContent = '복사'; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
        } else {
          fallbackCopy(text, done);
        }
      });
    });
  }

  function fallbackCopy(text, done) {
    // file:// 이나 구형 환경에서는 clipboard API 가 없다.
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 무시 */ }
    document.body.removeChild(ta);
  }

  function wireAnchors(root) {
    $$('.anchor', root).forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var id = a.getAttribute('href').replace(/^#/, '');
        var url = location.href.split('#')[0] + location.hash.split('#').slice(0, 2).join('#') + '#' + id;
        if (navigator.clipboard) navigator.clipboard.writeText(url);
        var t = document.getElementById(id);
        if (t) t.scrollIntoView();
      });
    });
  }

  // ---------------------------------------------------------------- 라우팅

  function currentRoute() {
    var h = location.hash || '#/';
    var m = h.match(/^#\/([^#]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function render() {
    var id = currentRoute();
    var doc = $('#doc');

    if (!id) { renderHome(); return; }
    if (id === 'glossary') { renderGlossary(); return; }
    if (id === 'problems') { renderProblems(); return; }

    var meta = CH[id];
    if (!meta) {
      doc.innerHTML = '<div class="notice"><h1>없는 절</h1><p><code>' + escapeHtml(id) +
                      '</code> 은 목차에 없다. <a href="#/">표지로</a></p></div>';
      renderPager(null);
      $('#inbook').innerHTML = '';
      return;
    }

    if (!hasDoc(id)) {
      doc.innerHTML = '<div class="notice"><h1>' + escapeHtml(meta.num + ' ' + meta.title) + '</h1>' +
                      '<p>아직 쓰이지 않은 절이다.</p></div>';
      renderPager(meta);
      $('#inbook').innerHTML = '';
      highlightCurrentToc(id);
      return;
    }

    var md = BOOK.docs[id];
    doc.innerHTML = MD.render(md) + doneButtonHtml(id);
    renderInbook(md);
    mountWidgets(doc);
    wireCopy(doc);
    wireAnchors(doc);
    wireDualTabs(doc);
    applyLang(currentLang());
    renderPager(meta);
    highlightCurrentToc(id);
    document.title = meta.num + ' ' + meta.title + ' · Algorithmic';

    var btn = $('#btn-done');
    if (btn) {
      btn.addEventListener('click', function () {
        var now = !isDone(id);
        setDone(id, now);
        btn.classList.toggle('is-done', now);
        btn.textContent = now ? '완료함' : '이 절을 완료로 표시';
      });
    }

    scrollToAnchorOrTop();
    spy();
  }

  function doneButtonHtml(id) {
    var done = isDone(id);
    return '<div class="done-row"><button id="btn-done" class="btn done-btn' +
           (done ? ' is-done' : '') + '" type="button">' +
           (done ? '완료함' : '이 절을 완료로 표시') + '</button></div>';
  }

  function renderHome() {
    var total = FLAT.length;
    var written = FLAT.filter(function (c) { return hasDoc(c.id); }).length;
    var due = srsDue().length;
    var meta = BOOK.meta || {};

    var html = '<div class="home">';
    html += '<h1 class="home-title">' + escapeHtml(meta.title || 'Algorithmic') + '</h1>';
    if (meta.subtitle) html += '<p class="home-sub">' + escapeHtml(meta.subtitle) + '</p>';
    html += '<div class="home-stats">' +
            '<div class="stat"><b>' + written + '</b><span>쓰인 절</span></div>' +
            '<div class="stat"><b>' + total + '</b><span>전체 절</span></div>' +
            '<div class="stat"><b>' + Object.keys(progress()).length + '</b><span>완료</span></div>' +
            '<div class="stat"><b>' + due + '</b><span>복습 대기</span></div></div>';

    if (due > 0) {
      html += '<p class="home-review"><button class="btn" type="button" id="home-review">' +
              '오늘 복습할 ' + due + '개 시작</button></p>';
    }

    html += '<div class="home-parts">';
    BOOK.toc.forEach(function (part) {
      var chs = part.chapters || [];
      var w = chs.filter(function (c) { return hasDoc(c.id); }).length;
      var first = chs.length ? chs[0].id : '';
      html += '<a class="home-part" href="#/' + escapeHtml(first) + '">' +
              '<span class="home-part-num">' + escapeHtml(part.num) + '</span>' +
              '<span class="home-part-title">' + escapeHtml(part.title) + '</span>' +
              (part.desc ? '<span class="home-part-desc">' + escapeHtml(part.desc) + '</span>' : '') +
              '<span class="home-part-count">' + w + ' / ' + chs.length + '</span></a>';
    });
    html += '</div></div>';

    $('#doc').innerHTML = html;
    $('#inbook').innerHTML = '';
    renderPager(null);
    highlightCurrentToc('');
    document.title = (meta.title || 'Algorithmic');

    var hr = $('#home-review');
    if (hr) hr.addEventListener('click', openReview);
    window.scrollTo(0, 0);
  }

  /* 용어 사전 (§8) — 가나다/알파벳 목록, 클릭하면 최초 정의 챕터로 간다.
   *
   * 왜 검색 상자를 페이지 안에 두는가
   *   306개를 눈으로 훑는 것은 사전이 아니라 목록이다. 그리고 독자가 찾는 단서는
   *   한글 이름일 때도 영문 이름일 때도 있어서(`upper_bound` 를 "상계" 로 기억하지 않는다),
   *   별칭까지 같이 걸어야 실제로 찾힌다.
   */
  function renderGlossary() {
    var items = BOOK.glossary || [];
    var doc = $('#doc');

    var html = '<div class="glossary">';
    html += '<h1>용어 사전</h1>';
    html += '<p class="glossary-lead">' + items.length + '개. 각 항목은 그 용어를 <b>처음 정의한 절</b>로 이어진다. ' +
            '본문에서 처음 만났을 때 배우는 것이 기본 경로이고, 여기는 돌아와서 찾는 곳이다.</p>';
    html += '<input id="glossary-filter" type="search" placeholder="용어·영문·별칭으로 거르기" ' +
            'aria-label="용어 거르기" autocomplete="off">';
    html += '<p id="glossary-count" class="glossary-count" role="status" aria-live="polite"></p>';
    html += '<dl id="glossary-list" class="glossary-list">';
    items.forEach(function (it, i) {
      var ch = CH[it.chapter];
      html += '<div class="glossary-item" data-i="' + i + '">';
      html += '<dt><span class="glossary-term">' + escapeHtml(it.term) + '</span>';
      if (it.en) html += ' <span class="glossary-en">' + escapeHtml(it.en) + '</span>';
      if (ch) {
        html += '<a class="glossary-ch" href="#/' + escapeHtml(it.chapter) + '">' +
                escapeHtml(ch.num) + '</a>';
      }
      html += '</dt>';
      html += '<dd>' + MD.inline(it["def"]) + '</dd>';
      html += '</div>';
    });
    html += '</dl></div>';

    doc.innerHTML = html;
    $('#inbook').innerHTML = '';
    renderPager(null);
    highlightCurrentToc('');
    document.title = '용어 사전 · ' + ((BOOK.meta || {}).title || 'Algorithmic');

    var input = $('#glossary-filter');
    var nodes = doc.querySelectorAll('.glossary-item');
    var count = $('#glossary-count');

    function apply() {
      var q = (input.value || '').trim().toLowerCase();
      var shown = 0;
      for (var i = 0; i < nodes.length; i++) {
        var it = items[i];
        var hay = (it.term + ' ' + it.en + ' ' + (it.aliases || []).join(' ')).toLowerCase();
        var hit = !q || hay.indexOf(q) >= 0;
        nodes[i].hidden = !hit;
        if (hit) shown++;
      }
      count.textContent = q ? shown + ' / ' + items.length : '';
    }

    input.addEventListener('input', apply);
    apply();
    window.scrollTo(0, 0);
  }

  /**
   * 문제 색인(§7·§8). `::: quiz` 에서 뽑힌 대표문제를 Part 단위로 묶어 보여준다.
   * `::: classify` 가 지문→알고리즘 방향의 훈련이라면, 이 페이지는 반대 방향
   * (챕터→대표문제)의 색인이다 — 이미 배운 유형의 문제를 찾아 풀 때 쓴다.
   */
  function renderProblems() {
    var items = BOOK.problems || [];
    var doc = $('#doc');

    // Part 등장 순서를 그대로 유지한다(toc.json 순서 = 이 책의 계보 순서).
    var order = [];
    var groups = {};
    items.forEach(function (it) {
      if (!groups[it.partNum]) { groups[it.partNum] = { title: it.partTitle, items: [] }; order.push(it.partNum); }
      groups[it.partNum].items.push(it);
    });

    var html = '<div class="problems">';
    html += '<h1>문제 색인</h1>';
    html += '<p class="problems-lead">' + items.length + '개. 각 챕터의 <b>::: quiz</b>에 실린 대표문제를 ' +
            'Part 순서대로 모았다. 정답 코드는 싣지 않는다(A-10) — 문제를 찾으면 그 챕터로 가서 ' +
            '사고과정을 읽는다.</p>';
    html += '<div class="problems-controls">';
    html += '<input id="problems-filter" type="search" placeholder="제목·번호·챕터로 거르기" ' +
            'aria-label="문제 거르기" autocomplete="off">';
    html += '<select id="problems-tier" aria-label="난도 등급">';
    ['전체', '브론즈', '실버', '골드', '플래티넘'].forEach(function (t) {
      html += '<option value="' + (t === '전체' ? '' : t) + '">' + t + '</option>';
    });
    html += '</select></div>';
    html += '<p id="problems-count" class="problems-count" role="status" aria-live="polite"></p>';
    html += '<div id="problems-list" class="problems-list">';
    order.forEach(function (partNum) {
      var g = groups[partNum];
      html += '<div class="problems-group" data-part="' + escapeHtml(partNum) + '">';
      html += '<div class="problems-group-title">' + escapeHtml(partNum) + ' — ' + escapeHtml(g.title) + '</div>';
      g.items.forEach(function (it, i) {
        html += '<div class="problems-item" data-gi="' + i + '">';
        html += '<span class="problems-id">' + escapeHtml(it.id) + '</span>';
        html += '<span class="problems-title"><a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' +
                escapeHtml(it.title) + '</a></span>';
        html += '<span class="problems-diff">' + escapeHtml(it.diff) + '</span>';
        html += '<a class="problems-ch" href="#/' + escapeHtml(it.chapter) + '">' + escapeHtml(it.num) + '</a>';
        html += '</div>';
      });
      html += '</div>';
    });
    html += '</div></div>';

    doc.innerHTML = html;
    $('#inbook').innerHTML = '';
    renderPager(null);
    highlightCurrentToc('');
    document.title = '문제 색인 · ' + ((BOOK.meta || {}).title || 'Algorithmic');

    var input = $('#problems-filter');
    var tierSel = $('#problems-tier');
    var groupNodes = doc.querySelectorAll('.problems-group');
    var count = $('#problems-count');

    function apply() {
      var q = (input.value || '').trim().toLowerCase();
      var tier = tierSel.value;
      var shown = 0;
      groupNodes.forEach(function (gEl) {
        var partNum = gEl.getAttribute('data-part');
        var list = groups[partNum].items;
        var itemNodes = gEl.querySelectorAll('.problems-item');
        var groupShown = 0;
        itemNodes.forEach(function (node, i) {
          var it = list[i];
          var hay = (it.title + ' ' + it.id + ' ' + it.chTitle + ' ' + it.num).toLowerCase();
          var hit = (!q || hay.indexOf(q) >= 0) && (!tier || it.tier === tier);
          node.hidden = !hit;
          if (hit) { groupShown++; shown++; }
        });
        gEl.hidden = groupShown === 0;
      });
      count.textContent = (q || tier) ? shown + ' / ' + items.length : '';
    }

    input.addEventListener('input', apply);
    tierSel.addEventListener('change', apply);
    apply();
    window.scrollTo(0, 0);
  }

  function neighbors(meta) {
    var i = FLAT.findIndex(function (c) { return c.id === meta.id; });
    return { prev: i > 0 ? FLAT[i - 1] : null, next: i >= 0 && i < FLAT.length - 1 ? FLAT[i + 1] : null };
  }

  function renderPager(meta) {
    var el = $('#pager');
    if (!el) return;
    if (!meta) { el.innerHTML = ''; return; }
    var n = neighbors(meta);
    var html = '';
    if (n.prev) {
      html += '<a class="pager-link prev" href="#/' + escapeHtml(n.prev.id) + '">' +
              '<span class="pager-dir">이전</span><span class="pager-title">' +
              escapeHtml(n.prev.num + ' ' + n.prev.title) + '</span></a>';
    }
    if (n.next) {
      html += '<a class="pager-link next" href="#/' + escapeHtml(n.next.id) + '">' +
              '<span class="pager-dir">다음</span><span class="pager-title">' +
              escapeHtml(n.next.num + ' ' + n.next.title) + '</span></a>';
    }
    el.innerHTML = html;
  }

  function scrollToAnchorOrTop() {
    // '#/id#anchor' 형태. 브라우저는 이 조합을 자기 방식대로 해석하려다 실패하고 맨 위로 되돌린다.
    // 그래서 다음 프레임에 한 번 더 적용한다.
    var parts = (location.hash || '').split('#');
    var anchor = parts.length > 2 ? decodeURIComponent(parts[2]) : '';
    var go = function () {
      if (anchor) {
        var t = document.getElementById(anchor);
        if (t) { window.scrollTo(0, t.getBoundingClientRect().top + window.pageYOffset - 80); return; }
      }
      window.scrollTo(0, 0);
    };
    go();
    requestAnimationFrame(go);
  }

  // ---------------------------------------------------------------- 검색
  //
  // h2 단위로 쪼개 색인한다. 결과가 문서 전체가 아니라 해당 절로 바로 가야
  // 검색이 실제로 쓸모가 있다.

  var INDEX = null;

  function buildIndex() {
    if (INDEX) return INDEX;
    INDEX = [];
    FLAT.forEach(function (ch) {
      if (!hasDoc(ch.id)) return;
      var md = BOOK.docs[ch.id];
      var lines = md.split('\n');
      var cur = { chapter: ch, heading: '', anchor: '', body: [] };
      var inFence = false;
      var slugs = {};

      var push = function () {
        if (cur.body.length || cur.heading) {
          INDEX.push({ chapter: ch, heading: cur.heading, anchor: cur.anchor, text: cur.body.join(' ') });
        }
      };

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
        if (inFence) continue;
        var m = line.match(/^##\s+(.+)$/);
        if (m) {
          push();
          var text = m[1].replace(/[*`=]/g, '').trim();
          var slug = slugify(text, slugs);
          cur = { chapter: ch, heading: text, anchor: slug, body: [] };
        } else {
          var t = line.replace(/^:::.*$/, '').replace(/[#*`>|=-]/g, ' ').trim();
          if (t) cur.body.push(t);
        }
      }
      push();
    });
    return INDEX;
  }

  function slugify(text, seen) {
    var s = String(text).toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^0-9a-z가-힣ㄱ-ㆎ-]/g, '');
    if (!s) s = 'section';
    if (seen) {
      if (seen[s]) { seen[s] += 1; s = s + '-' + seen[s]; } else { seen[s] = 1; }
    }
    return s;
  }

  function search(q) {
    var needle = q.trim().toLowerCase();
    if (needle.length < 1) return [];
    var terms = needle.split(/\s+/);
    var out = [];

    buildIndex().forEach(function (sec) {
      var hay = (sec.chapter.num + ' ' + sec.chapter.title + ' ' + sec.heading + ' ' + sec.text).toLowerCase();
      var score = 0;
      for (var i = 0; i < terms.length; i++) {
        if (hay.indexOf(terms[i]) < 0) return;         // 모든 단어가 있어야 한다
        // 등장 횟수에 상한을 둔다. 안 그러면 긴 절이 무조건 이긴다.
        score += Math.min(countOf(hay, terms[i]), 5);
        if ((sec.chapter.num + ' ' + sec.chapter.title).toLowerCase().indexOf(terms[i]) >= 0) score += 8;
        if (sec.heading.toLowerCase().indexOf(terms[i]) >= 0) score += 4;
      }
      out.push({ sec: sec, score: score });
    });

    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 40);
  }

  function countOf(hay, needle) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  }

  function renderSearch(q) {
    var box = $('#search-results');
    if (!box) return;
    var hits = search(q);
    if (!q.trim()) { box.innerHTML = '<div class="search-empty">본문 전체에서 찾는다.</div>'; return; }
    if (!hits.length) { box.innerHTML = '<div class="search-empty">결과 없음</div>'; return; }

    box.innerHTML = hits.map(function (h, i) {
      var s = h.sec;
      var href = '#/' + s.chapter.id + (s.anchor ? '#' + s.anchor : '');
      return '<a class="search-hit' + (i === 0 ? ' is-active' : '') + '" href="' + escapeHtml(href) + '">' +
             '<span class="search-ch">' + escapeHtml(s.chapter.num + ' ' + s.chapter.title) + '</span>' +
             (s.heading ? '<span class="search-h">' + escapeHtml(s.heading) + '</span>' : '') +
             '<span class="search-snip">' + escapeHtml(snippet(s.text, q)) + '</span></a>';
    }).join('');
  }

  function snippet(text, q) {
    var t = q.trim().split(/\s+/)[0].toLowerCase();
    var i = text.toLowerCase().indexOf(t);
    if (i < 0) return text.slice(0, 110);
    var from = Math.max(0, i - 40);
    return (from > 0 ? '…' : '') + text.slice(from, from + 120) + '…';
  }

  function moveSearchSel(delta) {
    var hits = $$('#search-results .search-hit');
    if (!hits.length) return;
    var cur = hits.findIndex(function (h) { return h.classList.contains('is-active'); });
    var next = Math.max(0, Math.min(hits.length - 1, (cur < 0 ? 0 : cur) + delta));
    hits.forEach(function (h, i) { h.classList.toggle('is-active', i === next); });
    hits[next].scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- 모달 · 드로어

  var lastFocus = null;

  function openModal(sel) {
    lastFocus = document.activeElement;
    var m = $(sel);
    if (!m) return;
    m.hidden = false;
    document.body.classList.add('modal-open');
    var input = m.querySelector('input');
    if (input) { input.value = ''; input.focus(); renderSearch(''); }
    else {
      var b = m.querySelector('button');
      if (b) b.focus();
    }
  }

  function closeModals() {
    $$('.modal').forEach(function (m) { m.hidden = true; });
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // 모달이 열린 동안 탭 이동이 뒤 본문으로 빠져나가면, 화면에는 모달이 떠 있는데
  // 포커스는 안 보이는 곳에 있게 된다. 키보드 사용자에게는 길을 잃는 상황이다.
  function trapTab(e) {
    var modal = $$('.modal').filter(function (m) { return !m.hidden; })[0];
    if (!modal) return;
    var items = $$('a[href], button, input, [tabindex]:not([tabindex="-1"])', modal)
      .filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function setDrawer(open) {
    // 스타일시트가 기다리는 훅은 body.nav-open 이다. 오버레이의 페이드는
    // 거기서 파생되므로 여기서 hidden 을 건드리면 전환이 죽는다.
    document.body.classList.toggle('nav-open', open);
    var b = $('#btn-menu');
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // ---------------------------------------------------------------- 이벤트 배선

  function wireChrome() {
    $('#btn-theme').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    $('#btn-font').addEventListener('click', function () {
      var order = ['s', 'm', 'l'];
      var cur = document.documentElement.getAttribute('data-font') || 'm';
      applyFont(order[(order.indexOf(cur) + 1) % order.length]);
    });

    $('#btn-menu').addEventListener('click', function () {
      setDrawer(!document.body.classList.contains('drawer-open'));
    });

    $('#overlay').addEventListener('click', function () { setDrawer(false); });

    $('#btn-search').addEventListener('click', function () { openModal('#search-modal'); });
    $('#btn-review').addEventListener('click', openReview);

    $('#toc-filter').addEventListener('input', function () { filterToc(this.value); });

    $('#btn-reset').addEventListener('click', function () {
      if (!window.confirm('진도와 복습 기록을 전부 지운다. 되돌릴 수 없다.')) return;
      LS.set('progress', {});
      LS.set('srs', {});
      renderProgressLine();
      markTocDone();
      updateReviewBadge();
      if (!currentRoute()) renderHome();
    });

    $$('#lang-toggle .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { applyLang(b.getAttribute('data-lang')); });
    });

    var si = $('#search-input');
    si.addEventListener('input', function () { renderSearch(this.value); });
    si.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSel(-1); }
      else if (e.key === 'Enter') {
        var a = $('#search-results .search-hit.is-active');
        if (a) { e.preventDefault(); location.hash = a.getAttribute('href'); closeModals(); }
      }
    });

    $('#search-results').addEventListener('click', function (e) {
      if (e.target.closest('.search-hit')) closeModals();
    });

    // 복습 모달은 내용이 매번 다시 그려지므로 위임으로 받는다.
    $('#review-modal').addEventListener('click', function (e) {
      if (e.target.closest('[data-review-close]')) { closeModals(); return; }
      if (e.target.closest('[data-reveal]')) { reviewRevealed = true; renderReview(); return; }
      var g = e.target.closest('[data-grade]');
      if (g) {
        srsGrade(reviewQueue[reviewIndex].key, parseInt(g.getAttribute('data-grade'), 10));
        reviewIndex += 1;
        reviewRevealed = false;
        renderReview();
      }
    });

    $$('.modal').forEach(function (m) {
      m.addEventListener('mousedown', function (e) { if (e.target === m) closeModals(); });
    });

    // 좁은 화면에서는 목차 링크를 누르면 드로어가 닫혀야 한다.
    $('#sidebar').addEventListener('click', function (e) {
      if (e.target.closest('a[data-id]')) setDrawer(false);
    });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      if (e.key === 'Escape') { closeModals(); setDrawer(false); return; }
      if (e.key === 'Tab' && document.body.classList.contains('modal-open')) { trapTab(e); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); openModal('#search-modal'); return;
      }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); openModal('#search-modal'); return; }

      var id = currentRoute();
      if (!id || !CH[id]) return;
      var n = neighbors(CH[id]);
      if (e.key === '[' && n.prev) { location.hash = '#/' + n.prev.id; }
      if (e.key === ']' && n.next) { location.hash = '#/' + n.next.id; }
    });

    window.addEventListener('hashchange', render);
    window.addEventListener('scroll', spy, { passive: true });
  }

  // ---------------------------------------------------------------- 부팅

  function boot() {
    if (!MD || typeof MD.render !== 'function') {
      document.getElementById('doc').innerHTML =
        '<div class="notice"><h1>렌더러를 못 찾았다</h1>' +
        '<p><code>assets/markdown.js</code> 가 읽히지 않았다.</p></div>';
      return;
    }
    if (!BOOK.toc.length) {
      document.getElementById('doc').innerHTML =
        '<div class="notice"><h1>본문이 비어 있다</h1>' +
        '<p><code>python3 build.py</code> 를 실행해 <code>assets/bundle.js</code> 를 만들어라.</p></div>';
      return;
    }
    renderToc();
    renderProgressLine();
    updateReviewBadge();
    wireChrome();
    applyLang(currentLang());
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
