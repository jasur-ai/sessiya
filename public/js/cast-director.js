/**
 * Deborah — Cast Director Client
 * ------------------------------
 * Host barcha primary live commandlarni shu yerdan boshqaradi.
 * Har control sendCommand() wrapper orqali; pending'da spinner + lock.
 */

(function () {
  'use strict';

  const BOOT = window.__BOOT__;
  if (!BOOT || !BOOT.sessionId) return;

  // C4-04: accessibility bootstrap (theme/motion/hints)
  let a11y = null;
  if (window.CastA11yInit) {
    a11y = window.CastA11yInit({ role: 'director' });
  }

  // C4-05: i18n
  let t = (k, v) => k;
  if (window.CastI18n) {
    window.CastI18n.init({ locale: BOOT.locale || 'uz-Latn' }).then((api) => { t = api.t; });
  }

  const socket = io({
    // BUG-230db143 ROOT FIX: io('/socket.io', ...) birinchi arg = NAMESPACE (path emas!)
    // → server 'Invalid namespace' qaytarib socketni yopardi (director host-socket o'lik).
    // To'g'risi: path opts ichida.
    path: BOOT.socketPath || '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  let code = (window.__BOOT__ && window.__BOOT__.joinCode) || '—'; // BUG-230db143b: boot'dan boshlang'ich kod
  // ── C4-10: QR (join link) yangilash + kattalashtirish modal ──
  function refreshJoinQr() {
    const u = (code && code !== '—') ? location.origin + '/play?code=' + encodeURIComponent(code) : '';
    const w = document.getElementById('dir-qr-wrap');
    if (w) w.hidden = !u;
    const src = u ? '/cast/qr?d=' + encodeURIComponent(u) : '';
    const q = document.getElementById('dir-qr');
    const big = document.getElementById('dir-qr-big');
    if (q) q.src = src;
    if (big) big.src = src;
    const urlEl = document.getElementById('dir-qr-url');
    if (urlEl) urlEl.textContent = u;
    const codeEl = document.getElementById('dir-qr-code');
    if (codeEl) codeEl.textContent = (code && code !== '—') ? code : '';
  }
  (function wireQrModal() {
    const openBtn = document.getElementById('btn-qr-open');
    const modal = document.getElementById('qr-modal');
    if (!openBtn || !modal) return;
    openBtn.addEventListener('click', () => { refreshJoinQr(); modal.hidden = false; });
    modal.addEventListener('click', (e) => {
      if (e.target === modal || (e.target.closest && e.target.closest('#btn-qr-close'))) modal.hidden = true;
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) modal.hidden = true; });
  })();

  // BUG-230db143b fix: boot kodini DOM'ga darhol yozamiz (updateControls faqat eventda yozardi)
  (function renderInitCode() {
    if (code && code !== '—') {
      const cv = document.getElementById('dir-code-val');
      const cb = document.getElementById('dir-code-big');
      const jl = document.getElementById('dir-join-link');
      if (cv) cv.textContent = code;
      if (cb) cb.textContent = code;
      if (jl) jl.textContent = location.origin + '/play?code=' + code;
      refreshJoinQr();
    }
  })();
  let phase = 'LOBBY_OPEN';
  let _autoOpenedFirst = false; // 09/2026: boshlashda 1-savol avto-ochilishi (bir marta)
  let timerInterval = null;
  let closesAt = null;
  let revision = BOOT.initialRevision || 1;
  const pending = new Set();

  const client = new CastSocketClient({
    socket,
    sessionId: BOOT.sessionId,
    actorId: BOOT.actor?.id,
    initialRevision: revision,
    onEvent: (eventName, data) => handleEvent(eventName, data),
    onError: (data) => {
      setHealth('offline');
      announce(data.message || 'Xatolik yuz berdi', true);
    },
  });

  // BUG-053: faylda 186 ta jQuery-uzilish $('#id') bor — helper bare id kutardi va
  // null qaytarardi (qp/transfer/goal/POE bloklari butunlay o'lik edi). Tolerant:
  const $ = (sel) => document.getElementById(String(sel).replace(/^#/, ''));

  function announce(msg, assertive) {
    const el = assertive ? $('alert-live') : $('status-live');
    el.textContent = msg;
  }

  // C5-07 (item 10): degraded health indicator — teacherga simple signal
  function setHealth(state) {
    const el = $('dir-health');
    el.className = 'dir-health ' + state;
    el.textContent =
      state === 'online' ? '● Barqaror'
      : state === 'degraded' ? '⚠ Ziqatcha — yuklama past' // aggregate sekinlashdi / P3 tushib ketmoqda
      : state === 'lagging' ? '⚠ Kechikish'
      : '✖ Uzildi';
  }

  // cast:addTime — rail-time-btn (data-sec orqali), spinner intentionally skipped
  const CMD_BTN = {
    'cast:sessionStart': 'btn-start-session',
    'cast:questionPause': 'btn-pause',
    'cast:questionResume': 'btn-resume',
    'cast:questionClose': 'btn-close',
    'cast:questionReveal': 'btn-reveal',
    'cast:questionNext': 'btn-next',
    'cast:startDiscussion': 'btn-discuss',
    'cast:openRevote': 'btn-revote',
  };

  // S29.07: command pending — tugma is-loading spinner + aria-busy
  function setCmdPending(type, on) {
    const btnId = CMD_BTN[type];
    if (!btnId) return;
    const el = $(btnId);
    if (el) {
      el.classList.toggle('is-loading', on);
      el.setAttribute('aria-busy', on ? 'true' : 'false');
      el.disabled = on ? true : el.dataset.phaseDisabled === '1';
    }
  }

  async function send(type, payload, opts) {
    pending.add(type);
    setCmdPending(type, true);
    try {
      const ack = await client.sendCommand(type, payload, opts);
      return ack;
    } finally {
      setCmdPending(type, false);
      pending.delete(type);
    }
  }

  // ── Control state (phase-based enable/disable) ──
  const PHASE_LABELS = {
    LOBBY_OPEN: 'Lobbi',
    THINK_TIME: 'O‘ylash',
    QUESTION_OPEN: 'Savol ochiq',
    QUESTION_LOCKED: 'Savol yopiq',
    REVOTE_OPEN: 'Qayta ovoz',
    DISCUSSION: 'Muhokama',
    REVEAL: 'Javob ochiq',
    LEADERBOARD: 'Reyting',
    ENDED: 'Yakunlangan',
  };
  const PHASE_MODS = { QUESTION_OPEN: 'open', QUESTION_LOCKED: 'locked', REVEAL: 'reveal', DISCUSSION: 'discuss', LEADERBOARD: 'rank', THINK_TIME: 'think', LOBBY_OPEN: 'lobby' };

  // S29.02: phase badge — label + mod class
  function renderPhaseBadge() {
    const badge = $('dir-phase-badge');
    if (!badge) return;
    badge.textContent = PHASE_LABELS[phase] || phase;
    badge.className = 'dir-phase-badge';
    const mod = PHASE_MODS[phase];
    if (mod) badge.classList.add('mod-' + mod);
  }

  function updateControls() {
    const start = $('btn-start-session');
    const pause = $('btn-pause');
    const resume = $('btn-resume');
    const close = $('btn-close');
    const reveal = $('btn-reveal');
    const next = $('btn-next');
    const discuss = $('btn-discuss');
    const revote = $('btn-revote');
    const addTime = document.querySelector('.rail-addtime summary');

    const isPending = (type) => pending.has(type);
    const applyDisabled = (el, dis, type) => {
      if (!el) return;
      // S29.07: in-flight command lock — updateControls pending'ni bosib o'tmaydi
      el.disabled = isPending(type) ? true : dis;
      el.dataset.phaseDisabled = dis ? '1' : '0';
    };

    applyDisabled(start, phase !== 'LOBBY_OPEN', 'cast:sessionStart');
    applyDisabled(pause, phase !== 'QUESTION_OPEN', 'cast:questionPause');
    applyDisabled(resume, !(phase === 'QUESTION_OPEN' && document.body.dataset.paused === '1'), 'cast:questionResume');
    applyDisabled(close, !['QUESTION_OPEN', 'REVOTE_OPEN'].includes(phase), 'cast:questionClose');
    applyDisabled(reveal, !['QUESTION_OPEN', 'QUESTION_LOCKED'].includes(phase), 'cast:questionReveal');
    applyDisabled(next, !['REVEAL', 'LEADERBOARD', 'QUESTION_LOCKED', 'DISCUSSION', 'REVOTE_OPEN'].includes(phase), 'cast:questionNext');
    // C3-03: Muhokama faqat yopilgandan keyin; Revote faqat muhokama/REVEAL'da
    applyDisabled(discuss, !['QUESTION_LOCKED', 'REVEAL'].includes(phase), 'cast:startDiscussion');
    applyDisabled(revote, !['DISCUSSION', 'REVEAL'].includes(phase), 'cast:openRevote');
    // S29.09: Add Time faqat timer yurganda (question open)
    if (addTime) addTime.setAttribute('aria-disabled', ['QUESTION_OPEN', 'REVOTE_OPEN'].includes(phase) ? 'false' : 'true');

    syncClosePill(close);
    renderPhaseBadge();
  }

  // C4-10: oddiy rejimda yagona markaziy pill — savolni yopish (avto oqim
  // uchun kerak bo'lgan yagona boshqaruv; rail'ning o'zi yashirin).
  function syncClosePill(closeBtn) {
    const pill = $('btn-close-pill');
    if (!pill) return;
    const simple = document.body.classList.contains('cast-simple');
    const canClose = closeBtn && !closeBtn.disabled;
    if (!simple || !canClose) { pill.hidden = true; return; }
    pill.hidden = false;
    const label = pill.querySelector('[data-close-label]');
    if (label) {
      label.textContent = phase === 'REVOTE_OPEN' ? 'Ovozni yopish' : 'Savolni yopish';
    }
  }

  // ── Timer (C5-05 item 14: 10fps yoki second-level — 250ms→1000ms, long-task yuk kamayadi) ──
  function startTimerUI() {
    stopTimerUI();
    const render = () => {
      const el = $('dir-timer-val');
      const box = $('dir-timer');
      if (!closesAt) {
        el.textContent = '—';
        if (box) box.classList.remove('has-timer');
        return;
      }
      const remaining = Math.max(0, Math.round((closesAt - Date.now()) / 1000));
      el.textContent = remaining + 's';
      el.classList.toggle('urgent', remaining <= 10);
      if (box) box.classList.add('has-timer');
      if (remaining <= 0) stopTimerUI();
    };
    render();
    timerInterval = setInterval(render, 1000);
  }
  function stopTimerUI() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const box = $('dir-timer');
    if (box) box.classList.remove('has-timer');
  }

  // ── Lobby ──
  async function loadLobbyInfo() {
    try {
      /* BUG-021/052: endpoint endi mavjud — javobni ishlatamiz (avval 404, lobbi
         ma'lumoti hech qachon yangilanmasdi) */
      const res = await fetch(`/api/cast/sessions/${BOOT.sessionId}/meta`, { headers: { 'X-CSRF-Token': window.__CSRF_TOKEN } });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok) {
        const titleEl = document.getElementById('dir-title');
        if (titleEl && data.title) titleEl.textContent = data.title;
        const codeEl = document.getElementById('dir-code-big');
        if (codeEl && data.joinCode) codeEl.textContent = data.joinCode;
      }
    } catch (_) {}
  }

  // ── C4-06: participant boshqaruvi (remove vs block) ──
  // C5-05 (item 15/16): har join'da to'liq DOM rebuild qilinmaydi — incremental
  // append + virtual list (faqat ko'rinadigan qismi render qilinadi).
  const dirParticipants = new Map();
  const DIR_PARTICIPANT_VIRTUAL_LIMIT = 50; // virtual list chegarasi (item 16)
  function participantRowHtml(pid, p) {
    return `
        <span class="dir-participant-name">${escapeHtml(p.displayAlias || pid)}</span>
        <span class="dir-participant-actions">
          <button type="button" class="cast-btn dir-part-act" data-act="remove" data-pid="${pid}">✖ Chiqarish</button>
          <button type="button" class="cast-btn dir-part-act" data-act="block" data-pid="${pid}">🚫 Bloklash</button>
        </span>`;
  }
  // C5-05 review fix: listener faqat berilgan row elementiga birikadi —
  // `attachParticipantActions(wrap)` barcha eski row'larga qayta-qayta
  // listener qo'shib, duplicate send'lar chiqarardi.
  function attachParticipantActions(rowEl) {
    rowEl.querySelectorAll('.dir-part-act').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.pid;
        const act = btn.dataset.act;
        try {
          if (act === 'block') {
            await send('cast:blockParticipant', { participantId: pid });
            announce('Ishtirokchi bloklandi', true);
          } else {
            await send('cast:removeParticipant', { participantId: pid });
            announce('Ishtirokchi chiqarildi');
          }
          dirParticipants.delete(pid);
          renderDirParticipants();
        } catch (e) { announce(e.message || 'Xatolik', true); }
      });
    });
  }
  // C5-05 (item 15/16): to'liq render + virtual list. Limit oshsa faqat
  // birinchi DIR_PARTICIPANT_VIRTUAL_LIMIT qator ko'rsatiladi + count yorlig'i.
  function renderDirParticipants() {
    const wrap = $('dir-participant-items');
    if (!wrap) return;
    wrap.innerHTML = '';
    const entries = [...dirParticipants.entries()];
    // C4-10: Sinfda/Uzoqdan guruhlanishi — faqat ikki guruh ham bo'lsa
    // (yoki faqat uzoqdan bo'lsa) sarlavhalar chiqadi; aks holda oddiy ro'yxat.
    const groups = { in_room: [], remote: [] };
    for (const e of entries) {
      const p = e[1] || {};
      groups[p.delivery === 'remote' ? 'remote' : 'in_room'].push(e);
    }
    const remoteOnly = groups.remote.length > 0 && groups.in_room.length === 0;
    const showHeaders = groups.remote.length > 0 && groups.in_room.length > 0;
    const order = showHeaders || remoteOnly ? ['in_room', 'remote'] : ['in_room'];
    let added = 0;
    for (const key of order) {
      const g = groups[key];
      if (!g.length) continue;
      if (showHeaders) {
        const hd = document.createElement('div');
        hd.className = 'dir-part-group';
        hd.innerHTML = key === 'remote'
          ? `<span class="dir-part-group-dot dir-part-group-dot--remote"></span><span>Uzoqdan (${g.length})</span>`
          : `<span class="dir-part-group-dot dir-part-group-dot--room"></span><span>Sinfda (${g.length})</span>`;
        wrap.appendChild(hd);
      }
      for (const [pid, p] of g) {
        if (added >= DIR_PARTICIPANT_VIRTUAL_LIMIT) break;
        const row = document.createElement('div');
        row.className = 'dir-participant-row';
        row.innerHTML = participantRowHtml(pid, p);
        attachParticipantActions(row);
        wrap.appendChild(row);
        added++;
      }
    }
    updateDirParticipantVirtualCount();
  }
  function updateDirParticipantVirtualCount() {
    const wrap = $('dir-participant-items');
    const total = dirParticipants.size;
    const note = wrap && wrap.querySelector('.dir-participant-more');
    if (total <= DIR_PARTICIPANT_VIRTUAL_LIMIT) {
      if (note) note.remove();
      return;
    }
    if (wrap) {
      if (!note) {
        const row = document.createElement('div');
        row.className = 'dir-participant-more';
        wrap.appendChild(row);
      }
      wrap.querySelector('.dir-participant-more').textContent = `+${total - DIR_PARTICIPANT_VIRTUAL_LIMIT} ta ko‘proq ishtirokchi (ro‘yxat to‘liq emas)`;
    }
  }

  // ── Events ──
  function handleEvent(eventName, data) {
    switch (eventName) {
      case 'cast:sessionCreated':
      case 'cast:participantJoined': {
        const countEl = $('dir-player-count');
        if (data.count !== undefined) countEl.textContent = data.count;
        if (data.joinCode) { code = data.joinCode; $('dir-code-val').textContent = code; $('dir-code-big').textContent = code; $('dir-join-link').textContent = `${location.origin}/play?code=${code}`; refreshJoinQr(); }
        // C4-06: participant tracking
        if (eventName === 'cast:participantJoined' && data.participantId) {
          const wasEmpty = dirParticipants.size === 0;
          dirParticipants.set(data.participantId, { displayAlias: data.displayAlias || 'Ishtirokchi', delivery: data.delivery || 'in_room' });
          // C5-05 (item 15): to'liq rebuild emas — yangi row'ni append qilamiz
          const wrap = $('dir-participant-items');
          const total = dirParticipants.size;
          if (wrap && wasEmpty) {
            renderDirParticipants(); // birinchi participant — to'liq
          } else if (wrap && total <= DIR_PARTICIPANT_VIRTUAL_LIMIT) {
            const row = document.createElement('div');
            row.className = 'dir-participant-row';
            row.innerHTML = participantRowHtml(data.participantId, { displayAlias: data.displayAlias || 'Ishtirokchi', delivery: data.delivery || 'in_room' });
            attachParticipantActions(row);
            wrap.appendChild(row);
          } else if (wrap) {
            // Virtual list limiti oshdi — count yorlig'ini yangilaymiz
            updateDirParticipantVirtualCount();
          }
        }
        break;
      }
      case 'cast:participantLeft': {
        if (data.participantId) {
          dirParticipants.delete(data.participantId);
          renderDirParticipants();
        }
        break;
      }
      case 'cast:joinCodeRotated': {
        if (data.joinCode) {
          code = data.joinCode;
          $('dir-code-val').textContent = code;
          $('dir-code-big').textContent = code;
          $('dir-join-link').textContent = `${location.origin}/play?code=${code}`;
          refreshJoinQr();
          announce('Kod yangilandi: ' + code, true);
        }
        break;
      }
      case 'cast:sessionStarted':
        phase = 'THINK_TIME';
        $('dir-lobby').hidden = true;
        $('dir-question').hidden = false;
        setHealth('online');
        announce('Sessiya boshlandi');
        // 09/2026 (user qarori): "Sessiyani boshlash" bosilishi bilanoq birinchi
        // savol AVTOMATIK ochiladi (reklama/demo'dagi kabi) — alohida bosish shart emas.
        // Server savollar bo'lmasa sessiyani o'zi yakunlaydi.
        if (!_autoOpenedFirst) {
          _autoOpenedFirst = true;
          try { send('cast:questionOpen', {}).catch(() => {}); } catch (_) { /* noop */ }
        }
        break;
      case 'cast:questionPreview': {
        phase = 'THINK_TIME';
        $('dir-q-meta').textContent = `Savol ${(data.questionPosition ?? 0) + 1} / ${data.totalQuestions ?? '?'}`;
        if (data.thinkSeconds) $('dir-q-text').textContent = `Fikrlash vaqti: ${data.thinkSeconds}s`;
        // C3-01: yangi savolga o'tganda eski evidence tozalanadi
        $('dir-evidence').hidden = true;
        $('dir-ev-grid').innerHTML = '';
        $('dir-ev-stats').innerHTML = '';
        $('dir-ev-dist').innerHTML = '';
        setHealth('online');
        break;
      }
      case 'cast:questionOpened': {
        phase = 'QUESTION_OPEN';
        if (data.question) renderQuestion(data.question);
        closesAt = data.question?.closesAt || null;
        startTimerUI();
        setHealth('online');
        break;
      }
      case 'cast:questionPaused':
        document.body.dataset.paused = '1';
        stopTimerUI();
        $('dir-timer-val').textContent = '⏸';
        announce('Savol pauza qilindi');
        break;
      case 'cast:questionResumed':
        document.body.dataset.paused = '0';
        closesAt = data.payload?.closesAt;
        startTimerUI();
        announce('Savol davom ettirildi');
        break;
      case 'cast:timeAdded':
        closesAt = data.payload?.closesAt;
        startTimerUI();
        announce(`+${data.payload?.seconds}s qo‘shildi`);
        break;
      case 'cast:discussionStarted': {
        phase = 'DISCUSSION';
        const instr = data.instructions ? ` — ${data.instructions}` : '';
        announce(`Muhokama boshlandi (${data.seconds}s)${instr}`);
        setHealth('online');
        break;
      }
      case 'cast:revoteOpened': {
        phase = 'REVOTE_OPEN';
        closesAt = data.closesAt;
        startTimerUI();
        announce('Qayta ovoz ochildi');
        setHealth('online');
        break;
      }
      case 'cast:revoteClosed': {
        phase = 'REVEAL';
        stopTimerUI();
        $('dir-timer-val').textContent = '—';
        break;
      }
      case 'cast:voteMatrix': {
        renderVoteMatrix(data);
        break;
      }
      case 'cast:confidenceUpdated': {
        renderConfidenceMatrix(data);
        break;
      }
      case 'cast:reasoningQueue': {
        renderReasoningQueue(data);
        break;
      }
      case 'cast:reasoningModerated': {
        // Update the queue item
        const list = $('dir-reasoning-list');
        const item = list.querySelector(`[data-rsn-id="${escapeHtml(data.reasoningId)}"]`);
        if (item) {
          item.dataset.state = data.moderationState;
          item.querySelector('.rsn-state').textContent = data.moderationState;
        }
        break;
      }
      case 'cast:confusionAggregate': {
        renderConfusionAggregate(data);
        break;
      }
      case 'cast:wallQueue': {
        renderWallQueue(data);
        break;
      }
      // C3-11 POE
      case 'cast:poeLaunched':
      case 'cast:poePredictionOpened': {
        setPoePhaseUi('PREDICTION_OPEN');
        break;
      }
      case 'cast:poeObservationStarted': {
        setPoePhaseUi('OBSERVATION');
        break;
      }
      case 'cast:poeMediaState': {
        renderPoeMediaState(data);
        break;
      }
      case 'cast:poeExplanationOpened': {
        setPoePhaseUi('EXPLANATION_OPEN');
        break;
      }
      case 'cast:poeExplanationClosed': {
        setPoePhaseUi('QUESTION_LOCKED');
        break;
      }
      case 'cast:poeAnalysis': {
        if (data.predictionDistribution) renderPoePredictionDist(data);
        if (data.changeMatrix) renderPoeAnalysis(data);
        break;
      }
      case 'cast:poeExemplarQueue': {
        renderPoeExemplarQueue(data);
        break;
      }
      // C3-12 Open-Response Semantic Board
      case 'cast:orbOpened': {
        $('#dir-orb').hidden = false;
        $('#orb-collect-ctl').hidden = false;
        $('#orb-review-ctl').hidden = true;
        $('#dir-orb-prompt').textContent = data.prompt || '';
        announce('🗂 Semantic Board ochildi — javoblar yig‘ilmoqda');
        break;
      }
      case 'cast:orbClosed': {
        if (data.data) {
          $('#orb-collect-ctl').hidden = true;
          $('#orb-review-ctl').hidden = false;
          renderOrbData(data.data);
        }
        break;
      }
      case 'cast:orbClusterResult': {
        $('#orb-collect-ctl').hidden = true;
        $('#orb-review-ctl').hidden = false;
        renderOrbData(data.data);
        if (data.result) {
          const st = $('#orb-cluster-status');
          const fb = data.result.usedFallback ? ` (fallback — ${data.result.fallbackReason || 'timeout'})` : '';
          st.textContent = `🧮 Provider: ${data.result.provider}${fb} — ${(data.result.clusters || []).length} guruh, ${(data.result.unclustered || []).length} ta bo‘limsiz`;
        }
        break;
      }
      case 'cast:orbManualUpdate': {
        renderOrbData(data.data);
        break;
      }
      case 'cast:orbEnded': {
        $('#dir-orb').hidden = true;
        announce('🗂 Semantic Board yakunlandi');
        break;
      }
      // C3-13 Student Question Forge
      case 'cast:forgeQueue': {
        renderForgeQueue(data.queue || {}, data.meta || {});
        break;
      }
      // C3-14 Session Choreography dashboard
      case 'cast:choreoState': {
        if (window.CastChoreography) CastChoreography.renderDashboard(data);
        break;
      }
      // C3-17 Power-ups
      case 'cast:powerupUsed': {
        const st = $('#pu-status');
        if (st && data) {
          st.textContent = `Ishtirokchilar: ${data.total || 0} · ishlatilgan: ${data.usedCount || 0}`;
        }
        break;
      }
      // C4-01 Team Challenge
      case 'cast:teamRoster': {
        renderTeamRoster(data && data.teams);
        break;
      }
      case 'cast:teamLeaderboard': {
        renderTeamLeaderboard(data);
        break;
      }
      case 'cast:teamTalkStarted': {
        const ts = $('#team-status');
        if (ts) ts.textContent = `🗣 Jamoa muhokamasi boshlandi (${data.seconds || '?'}s)`;
        announce('🗣 Jamoa muhokamasi boshlandi');
        break;
      }
      case 'cast:teamTalkEnded': {
        const ts = $('#team-status');
        if (ts) ts.textContent = 'Muhokama tugadi';
        break;
      }
      // C4-03 Paper-card
      case 'cast:cardProgress': {
        renderCardProgress(data);
        break;
      }
      case 'cast:cardDuplicate': {
        const st = $('#card-status');
        if (st) st.textContent = `⚠️ Takroriy karta: ${data && data.cardId}`;
        break;
      }
      case 'cast:cardUnknown': {
        const st = $('#card-status');
        if (st) st.textContent = `❓ Noma‘lum karta: ${data && data.cardId} — ro‘yxatda yo‘q`;
        break;
      }
      // C3-16 Self-Paced Race
      case 'cast:spActivated': {
        spRaceActive = true;
        renderSpPanel();
        announce('🏁 Self-paced poyga boshlandi');
        break;
      }
      case 'cast:spPaused': {
        spRacePaused = true;
        renderSpPanel();
        announce('⏸ Poyga pauza qilindi');
        break;
      }
      case 'cast:spResumed': {
        spRacePaused = false;
        renderSpPanel();
        announce('▶ Poyga davom ettirildi');
        break;
      }
      case 'cast:spProgress': {
        renderSpProgress(data);
        break;
      }
      case 'cast:questionClosed':
        phase = 'QUESTION_LOCKED';
        stopTimerUI();
        $('dir-timer-val').textContent = '—';
        break;
      case 'cast:questionLocked':
        phase = 'QUESTION_LOCKED';
        stopTimerUI();
        $('dir-timer-val').textContent = '—';
        break;
      case 'cast:questionRevealed': {
        phase = 'REVEAL';
        renderReveal(data);
        break;
      }
      case 'cast:quickPromptLive': {
        phase = 'QUESTION_OPEN';
        if (data.question) renderQuestion(data.question);
        closesAt = data.question?.closesAt || null;
        startTimerUI();
        announce('⚡ Tezkor savol yuborildi');
        break;
      }
      case 'cast:quickPromptResult': {
        // Quick prompt result — director private
        const qpWrap = $('dir-evidence');
        qpWrap.hidden = false;
        const dist = $('dir-ev-dist');
        if (dist && data.distribution) {
          dist.innerHTML = '';
          const total = data.answered || 1;
          // S19.01/04/05/06: stable order, CVD-safe shape, direct label, accessible table
          // charts.js director view'da cast-director.js'dan oldin yuklanadi — CastCharts kafolatlangan
          const opts = Object.entries(data.distribution).map(([optId, count]) => ({ id: optId, label: optId, count }));
          window.CastCharts.distributionBar(dist, { options: opts, total, label: 'Tezkor savol', sampleThreshold: 1 });
        }
        break;
      }
      case 'cast:answerCount': {
        const answered = data.answered ?? 0;
        const total = data.total ?? 0;
        $('dir-evidence').hidden = false;
        renderEvidence({ accepted: answered, eligible: total, active: total });
        break;
      }
      // C5-07 (item 10/12): degradation start/end — teacher health indicator
      case 'cast:degradation': {
        setHealth(data && data.action === 'end' ? 'online' : 'degraded');
        if (data && data.action === 'start' && data.level === 'admission_queue') {
          announce('⚠️ Server yuqori yuklamada — katta lobbi qabuli navbatga qo‘yildi', true);
        }
        break;
      }
      case 'cast:evidenceUpdated': {
        // C3-01: Teacher-private evidence panel
        $('dir-evidence').hidden = false;
        renderEvidence(data);
        break;
      }
      case 'cast:leaderboardUpdated':
        phase = 'LEADERBOARD';
        break;
      case 'cast:sessionEnded':
        phase = 'ENDED';
        stopTimerUI();
        announce('Sessiya tugadi', true);
        $('dir-q-meta').textContent = 'Sessiya tugatildi';
        $('dir-q-text').textContent = 'Barcha ishtirokchilarga yakun yuborildi.';
        updateControls();
        break;
      // C5-11 AI Co-host shadow (recommendation card)
      case 'cast:shadowSuggestion': {
        renderShadowSuggestion(data);
        break;
      }
    }
    if (data && data.revision) revision = Math.max(revision, data.revision);
    updateControls();
  }

  function renderQuestion(q) {
    window.__lastQuestion = q; // reveal/hinge questionId uchun
    window.__curQuestionId__ = q && q.id ? q.id : (q && q.questionId ? q.questionId : null);
    $('dir-q-text').textContent = q.text;
    const wrap = $('dir-q-options');
    wrap.innerHTML = '';
    q.options.forEach((o) => {
      const btn = document.createElement('div');
      btn.className = 'cast-option dir-option';
      btn.textContent = o.text;
      wrap.appendChild(btn);
    });
  }

  function renderReveal(data) {
    const wrap = $('dir-q-options');
    const correct = new Set(data.correctOptionIds || []);
    wrap.querySelectorAll('.dir-option').forEach((el, i) => {
      const q = window.__lastQuestion;
      if (q && q.options[i] && correct.has(q.options[i].id)) {
        el.style.outline = '3px solid var(--cast-green)';
      }
    });
    if (data.explanation) {
      const ex = document.createElement('div');
      ex.className = 'dir-explanation cast-surface';
      ex.textContent = '💡 ' + data.explanation;
      wrap.after(ex);
    }
  }

  function renderEvidence(ev) {
    const grid = $('dir-ev-grid');
    grid.innerHTML = '';
    // S29.04: top metrics bar — 4 ta asosiy ko'rsatkich (dir-metrics)
    const setMetric = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    setMetric('dir-metric-answered', fmt(ev.accepted) + '/' + fmt(ev.eligible));
    setMetric('dir-metric-correct', fmt(ev.correct) + '/' + fmt(ev.accepted));
    const topDist = Array.isArray(ev.distribution) && ev.distribution.length ? ev.distribution.reduce((a, b) => (b.count || 0) > (a.count || 0) ? b : a, ev.distribution[0]) : null;
    setMetric('dir-metric-distractor', topDist ? topDist.optionId + ' · ' + topDist.count : '—');
    setMetric('dir-metric-issue', fmt((ev.technicalFailure || 0) + (ev.disconnected || 0)));
    const cells = [
      ['Javob berdi', fmt(ev.accepted) + ' / ' + fmt(ev.eligible)],
      ['To‘g‘ri', fmt(ev.correct) + ' / ' + fmt(ev.accepted)],
      ['Noto‘g‘ri', fmt(ev.incorrect)],
      ['Javobsiz', fmt(ev.noResponse)],
      ['Kech qo‘shildi', fmt(ev.lateJoin)],
      ['Uzildi', fmt(ev.disconnected)],
      // C4-02 (item 9): technical failure — remote network issue (wrong answer EMAS)
      ['Texnik uzilish', fmt(ev.technicalFailure)],
    ];
    // C4-02 (item 14): in_room / remote coverage alohida
    if (ev.deliverySplit) {
      cells.push(
        ['Sinfda (in-room)', fmt(ev.deliverySplit.inRoom.answered) + '/' + fmt(ev.deliverySplit.inRoom.total) + ' javob'],
        ['Uzoqdan (remote)', fmt(ev.deliverySplit.remote.answered) + '/' + fmt(ev.deliverySplit.remote.total) + ' javob'],
      );
    }
    cells.forEach(([label, val]) => {
      const cell = document.createElement('div');
      cell.className = 'ev-cell';
      cell.innerHTML = `<b>${val}</b><span>${label}</span>`;
      grid.appendChild(cell);
    });

    // Accuracy + response rate (foiz yonida count/denominator)
    const stats = $('dir-ev-stats');
    if (stats) {
      stats.innerHTML = '';
      const chips = [
        `Aniqlik ${ev.accuracyPercent ?? 0}% (${fmt(ev.correct)}/${fmt((ev.correct ?? 0) + (ev.incorrect ?? 0))})`,
        `Ishtirok ${ev.participationPercent ?? 0}% (${fmt(ev.active)}/${fmt(ev.eligible)})`,
        `O‘rtacha vaqt ${ev.responseTime?.avgMs != null ? (ev.responseTime.avgMs / 1000).toFixed(1) + 's' : '—'}`,
      ];
      chips.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'ev-chip';
        chip.textContent = t;
        stats.appendChild(chip);
      });
    }

    // Hinge recommendation card (C3-02)
    renderHinge(ev.hinge);

    // Distractor distribution (optionId -> count + percent)
    const dist = $('dir-ev-dist');
    if (dist && Array.isArray(ev.distribution) && ev.distribution.length) {
      dist.innerHTML = '';
      const total = ev.distribution.reduce((a, b) => a + (b.count || 0), 0) || 1;
      // S19.01/04/05/06/09/10: stable order, CVD-safe, direct labels, accessible table, no-response, sample threshold
      const opts = ev.distribution.map((d) => ({ id: d.optionId, label: d.optionId, count: d.count || 0 }));
      window.CastCharts.distributionBar(dist, {
        options: opts,
        total,
        label: ev.questionText || 'Javoblar taqsimoti',
        sampleThreshold: 3,
        noResponse: ev.noResponse != null ? ev.noResponse : undefined,
      });
    } else if (dist && (ev.accepted ?? 0) > 0) {
      // Jonli answerCount vaqtida distribution hali kelmagan — yolg'on "yo'q" xabarini ko'rsatmaymiz
      dist.innerHTML = '<div class="ev-empty">Javoblar yig‘ilmoqda…</div>';
    } else if (dist) {
      dist.innerHTML = '';
    }
  }

  function renderHinge(hinge) {
    const wrap = $('dir-hinge');
    if (!wrap) return;
    if (!hinge || !hinge.recommendation) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const rec = hinge.recommendation;
    const recLabels = { MOVE_ON: 'Davom etish', DISCUSS: 'Muhokama', RETEACH: 'Qayta o‘rgatish', INSUFFICIENT_EVIDENCE: 'Dalillar yetarli emas' };
    const recColor = rec === 'MOVE_ON' ? 'var(--cast-green)' : rec === 'DISCUSS' ? 'var(--cast-amber, #fbbf24)' : rec === 'RETEACH' ? 'var(--cast-red, #f87171)' : 'var(--cast-muted-text)';

    wrap.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'hinge-head';
    head.innerHTML = `<span class="hinge-rec" style="color:${recColor}">${escapeHtml(recLabels[rec] || rec)}</span><span class="hinge-ver">${escapeHtml(hinge.ruleVersion || '')}</span>`;
    wrap.appendChild(head);

    // Signals
    if (Array.isArray(hinge.signals) && hinge.signals.length) {
      const sigBox = document.createElement('div');
      sigBox.className = 'hinge-signals';
      hinge.signals.forEach((s) => {
        const chip = document.createElement('span');
        chip.className = 'hinge-signal';
        const txt = s.code === 'MIXED_ACCURACY' ? `Aniqlik aralash (${Math.round((s.value ?? 0) * 100)}%)`
          : s.code === 'DOMINANT_DISTRACTOR' ? `Kuchli distraktor ${escapeHtml(s.optionId)} (${s.count})`
          : s.code === 'HIGH_CONFIDENCE_WRONG' ? `Ishonchli xato (${s.count})`
          : s.code === 'TECHNICAL_CAUTION' ? `Texnik uzilishlar (${Math.round((s.value ?? 0) * 100)}%)`
          : s.code === 'LOW_COVERAGE' ? `Qamrov past (${Math.round((s.value ?? 0) * 100)}%)`
          : s.code === 'LOW_SAMPLE' ? `Javoblar kam (${s.value})`
          : s.code;
        chip.textContent = txt;
        sigBox.appendChild(chip);
      });
      wrap.appendChild(sigBox);
    }

    // Misconception card (C3-05) — DOMINANT_DISTRACTOR signal bo'lsa
    const dominantSignal = hinge.signals?.find((s) => s.code === 'DOMINANT_DISTRACTOR');
    if (dominantSignal) {
      renderMisconceptionCard(dominantSignal, wrap);
    }

    // Allowed actions + decision buttons
    if (rec !== 'INSUFFICIENT_EVIDENCE') {
      const actions = document.createElement('div');
      actions.className = 'hinge-actions';
      ['accept', 'dismiss', 'override'].forEach((kind) => {
        const btn = document.createElement('button');
        btn.className = 'hinge-btn hinge-btn-' + kind;
        btn.textContent = kind === 'accept' ? '✓ Qabul' : kind === 'dismiss' ? '✕ Yopish' : '↺ Boshqa';
        btn.addEventListener('click', async () => {
          try {
            await send('cast:hingeDecision', {
              decision: kind,
              overrideTo: kind === 'override' ? 'DISCUSS' : null,
              recommendation: rec,
              ruleVersion: hinge.ruleVersion,
              questionId: window.__lastQuestion?.id || null,
            });
            btn.disabled = true;
            btn.textContent = '✓ Saqlandi';
          } catch (e) { announce(e.message || 'Xatolik', true); }
        });
        actions.appendChild(btn);
      });
      wrap.appendChild(actions);
    }
  }

  function renderConfidenceMatrix(data) {
    const wrap = $('dir-confidence');
    if (!wrap || !data || !data.coverage) { if (wrap) wrap.hidden = true; return; }
    wrap.hidden = false;
    wrap.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'vm-title';
    title.textContent = `🎯 Ishonch matritsasi — ${fmt(data.coverage)}/${fmt(data.coverage + data.missingConfidence)}`;
    wrap.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'vm-grid';
    const cells = [
      ['To‘g‘ri + Ishonchli', data.correctHigh, 'good'],
      ['To‘g‘ri + O‘rtacha/Past', data.correctLowOrMedium, 'ok'],
      ['Xato + Ishonchli', data.wrongHigh, 'bad'],
      ['Xato + O‘rtacha/Past', data.wrongLowOrMedium, 'warn'],
    ];
    cells.forEach(([label, val, cls]) => {
      const cell = document.createElement('div');
      cell.className = 'vm-cell vm-' + cls;
      cell.innerHTML = `<b>${fmt(val)}</b><span>${escapeHtml(label)}</span>`;
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
    if (data.suppressed) {
      const note = document.createElement('div');
      note.className = 'ev-empty';
      note.textContent = `⚠ Kam sonli cohort (cell < ${data.minCellCount}) — ma'lumot maskalangan`;
      wrap.appendChild(note);
    }
  }

  function renderReasoningQueue(data) {
    const wrap = $('dir-reasoning-queue');
    const list = $('dir-reasoning-list');
    if (!wrap || !list || !data.pending || data.pending.length === 0) {
      if (wrap) wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    list.innerHTML = '';
    data.pending.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'rsn-card';
      card.dataset.rsnId = item.reasoningId;
      card.dataset.state = item.moderationState;
      card.innerHTML = `
        <div class="rsn-meta">
          <span class="rsn-author">${escapeHtml(item.participantId || '?')}</span>
          <span class="rsn-chars">${item.charCount || 0} belgi</span>
          <span class="rsn-state rsn-state-${(item.moderationState || 'received').toLowerCase()}">${escapeHtml(item.moderationState || 'RECEIVED')}</span>
        </div>
        <div class="rsn-text">${escapeHtml(item.text || '')}</div>
        <div class="rsn-actions">
          <button type="button" class="hinge-btn hinge-btn-accept rsn-act" data-action="approve">✓ Tasdiqlash</button>
          <button type="button" class="cast-btn rsn-act" data-action="redact">✏ Tahrirlash</button>
          <button type="button" class="hinge-btn hinge-btn-dismiss rsn-act" data-action="reject">✕ Rad etish</button>
          <button type="button" class="cast-btn rsn-act rsn-project" data-action="project">📽 Proyektorga</button>
        </div>
      `;
      // Action buttons
      card.querySelectorAll('.rsn-act').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          let payload = { reasoningId: item.reasoningId, action };
          if (action === 'redact') {
            const newText = prompt('Tahrirlangan matn:', item.text);
            if (newText === null) return;
            payload.redactedText = newText;
          }
          try {
            await send('cast:moderateReasoning', payload);
            card.dataset.state = action === 'approve' ? 'APPROVED' : action === 'redact' ? 'REDACTED' : action === 'reject' ? 'REJECTED' : 'PROJECTED';
            card.querySelector('.rsn-state').textContent = card.dataset.state;
            card.querySelector('.rsn-actions').innerHTML = '<span class="ev-chip">' + card.dataset.state + '</span>';
          } catch (e) { announce(e.message || 'Xatolik', true); }
        });
      });
      list.appendChild(card);
    });
  }

  // C3-10: Confusion aggregate (identity yashirin) + ack
  function renderConfusionAggregate(data) {
    const wrap = $('dir-confusion');
    const chips = $('dir-confusion-chips');
    if (!wrap || !chips) return;
    const counts = data.counts || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) { wrap.hidden = true; return; }
    wrap.hidden = false;
    chips.innerHTML = '';
    const labels = { confused: '🤔 Chalkashdim', too_fast: '⚡ Juda tez', technical_issue: '🔧 Texnik muammo', need_example: '💡 Misol kerak' };
    Object.entries(counts).forEach(([sig, count]) => {
      if (!count) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'confusion-chip' + (data.acknowledged && data.acknowledged[sig] ? ' acked' : '');
      chip.dataset.signal = sig;
      chip.textContent = `${labels[sig] || sig} — ${count}`;
      if (!data.acknowledged || !data.acknowledged[sig]) {
        chip.title = 'Acknowledge qilish';
        chip.addEventListener('click', async () => {
          try {
            await send('cast:signalAck', { signal: sig });
            chip.classList.add('acked');
            chip.textContent = `${labels[sig] || sig} — ${count} ✓`;
          } catch (e) { announce(e.message || 'Xatolik', true); }
        });
      }
      chips.appendChild(chip);
    });
  }

  // C3-10: Question Wall moderation queue (faqat director)
  function renderWallQueue(data) {
    const wrap = $('dir-wall-queue');
    const list = $('dir-wall-list');
    if (!wrap || !list) return;
    if (!data.pending || data.pending.length === 0) { wrap.hidden = true; return; }
    wrap.hidden = false;
    list.innerHTML = '';
    data.pending.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'wall-card' + (item.priority === 'HIGH' ? ' wall-high' : item.priority === 'MEDIUM' ? ' wall-medium' : '');
      card.dataset.wallId = item.contentId;
      card.innerHTML = `
        <div class="wall-meta">
          <span class="wall-priority">${item.priority === 'HIGH' ? '🔴' : item.priority === 'MEDIUM' ? '🟠' : '🟢'} ${escapeHtml(item.priority)}</span>
          <span class="rsn-state rsn-state-received">RECEIVED</span>
        </div>
        <div class="wall-text">${escapeHtml(item.text || '')}</div>
        <div class="wall-flags">${wallFlagChips(item.flags)}</div>
        <div class="wall-actions">
          <button type="button" class="hinge-btn hinge-btn-accept wall-act" data-action="approve">✓ Tasdiqlash</button>
          <button type="button" class="cast-btn wall-act" data-action="redact">✏ Tahrirlash</button>
          <button type="button" class="cast-btn wall-act" data-action="project">📽 Ko‘rsatish</button>
          <button type="button" class="hinge-btn hinge-btn-dismiss wall-act" data-action="hide">🙈 Yashirish</button>
          <button type="button" class="cast-btn wall-act wall-withdraw" data-action="withdraw">↩ Qaytarib olish</button>
        </div>
      `;
      card.querySelectorAll('.wall-act').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          let payload = { contentId: item.contentId, action };
          if (action === 'redact') {
            const newText = prompt('Tahrirlangan matn:', item.text);
            if (newText === null) return;
            payload.redactedText = newText;
          }
          try {
            await send('cast:wallModerate', payload);
            card.dataset.done = '1';
            card.querySelector('.rsn-state').textContent = action.toUpperCase();
            card.querySelector('.wall-actions').innerHTML = '<span class="ev-chip">' + action.toUpperCase() + '</span>';
          } catch (e) { announce(e.message || 'Xatolik', true); }
        });
      });
      list.appendChild(card);
    });
  }

  function wallFlagChips(flags) {
    const map = { email: '📧 email', phone: '📞 tel', url: '🔗 link', profanity: '🚫 so‘z', pii: '🆔 PII' };
    if (!flags) return '';
    return Object.entries(map)
      .filter(([k]) => flags[k])
      .map(([, label]) => `<span class="wall-flag">${label}</span>`)
      .join('');
  }

  function renderMisconceptionCard(signal, parentEl) {
    if (!parentEl) return;
    const box = document.createElement('div');
    box.className = 'misconception-card cast-surface';
    box.innerHTML = `
      <div class="misconception-head">🧠 Noto‘g‘ri tushuncha: <b>${escapeHtml(signal.optionId)}</b> (${fmt(signal.count)})</div>
      <div class="hinge-signals">
        <span class="hinge-signal">Kuchli distraktor — talabalar bu variantni tanlashgan</span>
      </div>
      <div class="misconception-actions">
        <button type="button" class="hinge-btn hinge-btn-accept misconception-confirm">✅ Tasdiqlash</button>
        <button type="button" class="hinge-btn hinge-btn-dismiss misconception-reject">✕ Rad etish</button>
      </div>
    `;
    box.querySelector('.misconception-confirm').addEventListener('click', async () => {
      try {
        await send('cast:misconceptionDecision', {
          optionId: signal.optionId,
          confirmed: true,
          sessionId: window.__BOOT__?.sessionId,
          questionId: window.__lastQuestion?.id || null,
        });
        box.querySelector('.misconception-actions').innerHTML = '<span class="ev-chip">✅ Tasdiqlangan</span>';
      } catch (e) { announce(e.message || 'Xatolik', true); }
    });
    box.querySelector('.misconception-reject').addEventListener('click', async () => {
      try {
        await send('cast:misconceptionDecision', {
          optionId: signal.optionId,
          confirmed: false,
          sessionId: window.__BOOT__?.sessionId,
          questionId: window.__lastQuestion?.id || null,
        });
        box.querySelector('.misconception-actions').innerHTML = '<span class="ev-chip">✕ Rad etilgan</span>';
      } catch (e) { announce(e.message || 'Xatolik', true); }
    });
    parentEl.appendChild(box);
  }

  function renderVoteMatrix(data) {
    const wrap = $('dir-vote-matrix');
    if (!wrap || !data || !data.matrix) return;
    wrap.hidden = false;
    wrap.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'vm-title';
    title.textContent = `🔄 Ovoz o'zgarishi — ${fmt(data.changed)} o'zgardi / ${fmt(data.total)}`;
    wrap.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'vm-grid';
    const cells = [
      ['❌→✅ Noto‘g‘ri→To‘g‘ri', data.matrix.WRONG_TO_CORRECT, 'good'],
      ['✅→❌ To‘g‘ri→Noto‘g‘ri', data.matrix.CORRECT_TO_WRONG, 'bad'],
      ['✅→✅ To‘g‘ri→To‘g‘ri', data.matrix.CORRECT_TO_CORRECT, 'ok'],
      ['❌→❌ Noto‘g‘ri→Noto‘g‘ri', data.matrix.WRONG_TO_WRONG, 'warn'],
      ['🆕 Faqat revote', data.matrix.NEW, 'new'],
      ['— Faqat first', data.matrix.MISSING, 'muted'],
    ];
    cells.forEach(([label, val, cls]) => {
      const cell = document.createElement('div');
      cell.className = 'vm-cell vm-' + cls;
      cell.innerHTML = `<b>${fmt(val)}</b><span>${escapeHtml(label)}</span>`;
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
  }

  function fmt(n) {
    return n === undefined || n === null ? '—' : String(n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Controls ──
  // C4-06 (item 16): kod aylantirish — raid paytida
  $('btn-rotate-code').addEventListener('click', async () => {
    try {
      const ack = await send('cast:rotateJoinCode', {});
      if (ack?.joinCode) {
        code = ack.joinCode;
        $('dir-code-val').textContent = code;
        $('dir-code-big').textContent = code;
        $('dir-join-link').textContent = `${location.origin}/play?code=${code}`;
        refreshJoinQr();
        announce('Kod yangilandi: ' + code, true);
      }
    } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  // S29.02: topbar overflow menu (Natijalar/Replay endi menyuda)
  const overflowBtn = $('btn-overflow');
  const overflowMenu = $('dir-overflow-menu');
  if (overflowBtn && overflowMenu) {
    overflowBtn.addEventListener('click', () => {
      const open = overflowMenu.hidden;
      overflowMenu.hidden = !open;
      overflowBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (overflowMenu.hidden) return;
      if (!overflowMenu.contains(e.target) && !overflowBtn.contains(e.target)) {
        overflowMenu.hidden = true;
        overflowBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overflowMenu.hidden) {
        overflowMenu.hidden = true;
        overflowBtn.setAttribute('aria-expanded', 'false');
        overflowBtn.focus();
      }
    });
  }

  $('btn-start-session').addEventListener('click', async () => {
    try { await send('cast:sessionStart', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  $('btn-pause').addEventListener('click', async () => {
    try { await send('cast:questionPause', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  $('btn-resume').addEventListener('click', async () => {
    try { await send('cast:questionResume', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  // S29.09: Add Time — keyboard-safe guard + avtomatik yopish
  const addTimeWrap = document.querySelector('.rail-addtime');
  if (addTimeWrap) {
    addTimeWrap.addEventListener('toggle', (e) => {
      const summary = addTimeWrap.querySelector('summary');
      if (e.target.open && summary && summary.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        e.target.open = false;
      }
    });
  }
  document.querySelectorAll('.rail-time-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sec = Number(btn.dataset.sec);
      try { await send('cast:addTime', { seconds: sec }); } catch (e) { announce(e.message || 'Xatolik', true); }
      const wrap = btn.closest('.rail-addtime');
      if (wrap) wrap.open = false;
    });
  });

  const closePill = $('btn-close-pill');
  if (closePill) {
    closePill.addEventListener('click', async () => {
      const c = $('btn-close');
      if (c && !c.disabled) c.click();
    });
  }
  $('btn-close').addEventListener('click', async () => {
    try { await send('cast:questionClose', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  $('btn-reveal').addEventListener('click', async () => {
    try { await send('cast:questionReveal', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  $('btn-discuss').addEventListener('click', async () => {
    try { await send('cast:startDiscussion', { seconds: 60 }); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  $('btn-revote').addEventListener('click', async () => {
    try { await send('cast:openRevote', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  $('btn-next').addEventListener('click', async () => {
    try { await send('cast:questionNext', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  // ── Quick Prompt Composer (C3-06) ──
  let qpOptionCount = 2;

  function renderQpOptions() {
    const list = $('#qp-options-list');
    list.innerHTML = '';
    for (let i = 0; i < qpOptionCount; i++) {
      const row = document.createElement('div');
      row.className = 'qp-option-row';
      row.innerHTML = `
        <input class="cast-input qp-opt-input" placeholder="Variant ${String.fromCharCode(65 + i)}" data-idx="${i}">
        <input type="checkbox" class="qp-correct" data-idx="${i}" title="To‘g‘ri javob">
        <button type="button" class="cast-btn qp-opt-del" data-idx="${i}">✕</button>
      `;
      list.appendChild(row);
    }
  }

  function getQpDraft() {
    const type = $('#qp-type').value;
    const text = $('#qp-text').value.trim();
    const seconds = parseInt($('#qp-seconds').value) || 30;

    const options = [];
    const correctOptionIds = [];
    document.querySelectorAll('.qp-option-row').forEach((row) => {
      const input = row.querySelector('.qp-opt-input');
      const cb = row.querySelector('.qp-correct');
      if (input && input.value.trim()) {
        const id = 'o_' + crypto.randomUUID().slice(0, 8);
        options.push({ id, text: input.value.trim() });
        if (cb && cb.checked) correctOptionIds.push(id);
      }
    });

    return {
      type,
      text,
      options,
      correctOptionIds,
      timer: { mode: 'soft', seconds },
    };
  }

  function showQpErrors(errors) {
    const el = $('#qp-errors');
    el.hidden = false;
    el.innerHTML = errors.map((e) => '⚠ ' + escapeHtml(e)).join('<br>');
  }

  function hideQpErrors() {
    $('#qp-errors').hidden = true;
  }

  $('btn-quick-prompt').addEventListener('click', () => {
    qpOptionCount = 2;
    renderQpOptions();
    $('#qp-text').value = '';
    $('#qp-seconds').value = '30';
    $('#qp-type').value = 'single_choice';
    hideQpErrors();
    $('#qp-options-wrap').hidden = false;
    $('#qp-overlay').hidden = false;
  });

  $('#qp-close').addEventListener('click', () => {
    $('#qp-overlay').hidden = true;
  });

  $('#qp-type').addEventListener('change', () => {
    const type = $('#qp-type').value;
    const isScored = ['single_choice', 'true_false', 'multiple_select'].includes(type);
    const isShortAnswer = type === 'short_answer';
    $('#qp-options-wrap').hidden = !isScored && !['exit_ticket', 'confidence', 'rating', 'prediction'].includes(type);
    if (isShortAnswer || ['confidence', 'rating', 'prediction', 'exit_ticket'].includes(type)) {
      qpOptionCount = 0;
      renderQpOptions();
    } else if (!isScored) {
      qpOptionCount = 2;
      renderQpOptions();
    }
  });

  $('#qp-add-opt').addEventListener('click', () => {
    if (qpOptionCount >= 10) return;
    qpOptionCount++;
    renderQpOptions();
  });

  $('#qp-options-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('qp-opt-del')) {
      if (qpOptionCount <= 2) return;
      qpOptionCount--;
      renderQpOptions();
    }
  });

  // AI javobini formaga qo'yish (navbat bilan qayta ishlatiladi)
  function applyQpAiQuestion(q, statusEl, remaining) {
    if (!q) return;
    $('#qp-text').value = q.text;
    const wrap = $('#qp-options-wrap');
    if (wrap && !wrap.hidden && Array.isArray(q.options) && q.options.length >= 2) {
      const list = $('#qp-options-list');
      const freshRows = () => list.querySelectorAll('.qp-option-row');
      let fr = freshRows();
      while (fr.length > q.options.length && fr.length > 1) {
        fr[fr.length - 1].querySelector('.qp-opt-del')?.click();
        fr = freshRows();
      }
      while (freshRows().length < q.options.length) $('#qp-add-opt')?.click();
      fr = freshRows();
      fr.forEach((row, i) => {
        const opt = row.querySelector('.qp-opt-input');
        const cor = row.querySelector('.qp-correct');
        if (opt) opt.value = q.options[i] || '';
        if (cor) cor.checked = i === q.correctIndex;
      });
    }
    const extra = remaining > 0 ? (' Yana ' + remaining + ' ta navbatda — tugmani yana bosing.') : '';
    statusEl.textContent = '✅ AI savol tayyorladi' +
      (q.explanation ? (' — izoh: ' + q.explanation.slice(0, 140)) : '') + '.' + extra;
    statusEl.style.display = 'block';
  }

  // ✨ REAL AI (Gemini): mavzu bo‘yicha savol tuzish — server /api/ai/generate-questions
  (function initQpAi() {
    const btn = $('#qp-ai-go');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const statusEl = $('#qp-ai-status');
      // navbatda tayyor savol bo‘lsa — serverga borilmaydi
      if (Array.isArray(window.__qpAiQueue) && window.__qpAiQueue.length) {
        applyQpAiQuestion(window.__qpAiQueue.shift(), statusEl, window.__qpAiQueue.length);
        return;
      }
      const topic = ($('#qp-ai-topic').value || '').trim();
      const count = Number($('#qp-ai-count').value || '1');
      const type = $('#qp-type').value;
      if (topic.length < 3) {
        statusEl.textContent = '⚠️ Avval mavzu yozing (kamida 3 belgi).';
        statusEl.style.display = 'block';
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ AI yozmoqda…';
      statusEl.style.display = 'block';
      statusEl.textContent = 'Gemini generatsiya qilmoqda (5–15 soniya)…';
      try {
        const res = await fetch('/api/ai/generate-questions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN },
          body: JSON.stringify({ prompt: topic, count, lang: 'uz', difficulty: 'mixed', type: type === 'true_false' ? 'true_false' : 'single_choice' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !Array.isArray(data.questions) || !data.questions.length) {
          statusEl.textContent = '⚠️ AI javob bermadi (' + ((data && data.error) || res.status) + '). O‘zingiz yozing — savol ishlayveradi.';
          return;
        }
        applyQpAiQuestion(data.questions[0], statusEl, data.questions.length - 1);
      } catch (e) {
        statusEl.textContent = '⚠️ Tarmoq xatosi. O‘zingiz yozing — savol ishlayveradi.';
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  })();

  $('#qp-launch').addEventListener('click', async () => {
    hideQpErrors();
    const draft = getQpDraft();
    try {
      const ack = await send('cast:quickPromptLaunch', { draft });
      if (ack.ok) {
        $('#qp-overlay').hidden = true;
        announce('⚡ Tezkor savol yuborildi');
      } else {
        showQpErrors([ack.error?.message || 'Xatolik']);
      }
    } catch (e) {
      showQpErrors([e.message || 'Xatolik']);
    }
  });

  $('#qp-save-lib').addEventListener('click', async () => {
    hideQpErrors();
    const draft = getQpDraft();
    if (!draft.text) {
      showQpErrors(['Savol matnini kiriting']);
      return;
    }
    try {
      const ack = await send('cast:quickPromptSave', { draft });
      if (ack.ok) {
        announce('💾 Kutubxonaga saqlandi');
        $('#qp-overlay').hidden = true;
      } else {
        showQpErrors([ack.error?.message || 'Xatolik']);
      }
    } catch (e) {
      showQpErrors([e.message || 'Xatolik']);
    }
  });

  // ── Quick Prompt result event ──
  // (handled in handleEvent → cast:quickPromptResult)

  // ── Transfer / Redemption Picker (C3-08) ──
  function populateQuestionSelects() {
    const questions = (window.__BOOT__ && window.__BOOT__.questions) || [];
    const source = $('#tr-source');
    const followup = $('#tr-followup');
    source.innerHTML = '';
    followup.innerHTML = '';
    questions.forEach((q) => {
      const opt1 = document.createElement('option');
      opt1.value = q.id;
      opt1.textContent = q.text.slice(0, 60) + (q.text.length > 60 ? '…' : '');
      source.appendChild(opt1);
      const opt2 = document.createElement('option');
      opt2.value = q.id;
      opt2.textContent = q.text.slice(0, 60) + (q.text.length > 60 ? '…' : '');
      followup.appendChild(opt2);
    });
  }

  function showTrErrors(errors) {
    const el = $('#tr-errors');
    el.hidden = false;
    el.innerHTML = errors.map((e) => '⚠ ' + escapeHtml(e)).join('<br>');
  }

  $('btn-transfer').addEventListener('click', () => {
    populateQuestionSelects();
    $('#tr-flow-type').value = 'TRANSFER';
    $('#tr-errors').hidden = true;
    $('#tr-overlay').hidden = false;
  });

  $('#tr-close').addEventListener('click', () => {
    $('#tr-overlay').hidden = true;
  });

  $('#tr-launch').addEventListener('click', async () => {
    $('#tr-errors').hidden = true;
    const sourceQuestionId = $('#tr-source').value;
    const followUpQuestionId = $('#tr-followup').value;
    const type = $('#tr-flow-type').value;
    if (!sourceQuestionId || !followUpQuestionId) {
      showTrErrors(['Manba va follow-up savol tanlang']);
      return;
    }
    if (sourceQuestionId === followUpQuestionId) {
      showTrErrors(['Follow-up savol manba savoldan farqli bo\'lishi kerak']);
      return;
    }
    try {
      const ack = await send('cast:transferLaunch', { sourceQuestionId, followUpQuestionId, type, leaderboardImpact: 'NONE' });
      if (ack.ok) {
        $('#tr-overlay').hidden = true;
        announce('🔁 ' + (type === 'REDEMPTION' ? 'Redemption' : 'Transfer') + ' ishga tushirildi');
      } else {
        showTrErrors([ack.error?.message || 'Xatolik']);
      }
    } catch (e) {
      showTrErrors([e.message || 'Xatolik']);
    }
  });

  // ── Class Goal (C3-09) ──
  $('btn-goal').addEventListener('click', () => {
    $('#goal-type').value = 'accuracy_threshold';
    $('#goal-target').value = '80';
    $('#goal-errors').hidden = true;
    $('#goal-overlay').hidden = false;
  });

  $('#goal-close').addEventListener('click', () => {
    $('#goal-overlay').hidden = true;
  });

  $('#goal-save').addEventListener('click', async () => {
    $('#goal-errors').hidden = true;
    const goal = {
      type: $('#goal-type').value,
      target: parseInt($('#goal-target').value) || 0,
    };
    try {
      const ack = await send('cast:goalConfig', { goal });
      if (ack.ok) {
        $('#goal-overlay').hidden = true;
        announce('🎯 Sinf maqsadi o\'rnatildi');
      } else {
        const el = $('#goal-errors');
        el.hidden = false;
        el.innerHTML = '⚠ ' + escapeHtml(ack.error?.message || 'Xatolik');
      }
    } catch (e) {
      const el = $('#goal-errors');
      el.hidden = false;
      el.innerHTML = '⚠ ' + escapeHtml(e.message || 'Xatolik');
    }
  });

  $('btn-lock-lobby').addEventListener('click', async () => {
    try { await send('cast:lockLobby', { locked: true }); announce('Lobbi qulflandi'); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  // End session — two-step confirmation
  $('btn-end-session').addEventListener('click', () => { $('end-modal').hidden = false; });
  $('btn-end-cancel').addEventListener('click', () => { $('end-modal').hidden = true; });
  $('btn-end-confirm').addEventListener('click', async () => {
    $('end-modal').hidden = true;
    try { await send('cast:sessionEnd', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  // Keyboard shortcuts (disabled while typing)
  const keyMap = {
    // 09/2026: Space maxsus ishlanadi (pastda) — lobby'da boshlash, THINK'da savol ochish
    'p': 'cast:questionPause',
    'r': 'cast:questionResume',
    'c': 'cast:questionClose',
    'v': 'cast:questionReveal',
    'n': 'cast:questionNext',
    'e': 'cast:sessionEnd',
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === ' ') {
      e.preventDefault();
      const startBtn = $('btn-start-session');
      const nextBtn = $('btn-next');
      if (startBtn && !startBtn.disabled) startBtn.click();
      else if (phase === 'THINK_TIME') { try { send('cast:questionOpen', {}).catch(() => {}); } catch (_) {} }
      else if (nextBtn && !nextBtn.disabled) nextBtn.click();
      return;
    }
    const map = keyMap[e.key.toLowerCase()];
    if (!map) return;
    const type = map.split('|').pop();
    const btn = { 'cast:questionPause': 'btn-pause', 'cast:questionResume': 'btn-resume', 'cast:questionClose': 'btn-close', 'cast:questionReveal': 'btn-reveal', 'cast:questionNext': 'btn-next' }[type];
    if (btn && !$(btn).disabled) $(btn).click();
  });

  // ── POE (C3-11) ──
  function populatePoeQuestionSelects() {
    const questions = (window.__BOOT__ && window.__BOOT__.questions) || [];
    ['poe-pred-q', 'poe-exp-q'].forEach((selId) => {
      const sel = $(selId);
      if (!sel) return;
      sel.innerHTML = '';
      questions.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.text.slice(0, 60) + (q.text.length > 60 ? '…' : '');
        sel.appendChild(opt);
      });
    });
  }

  function togglePoeMediaFields(type) {
    const isText = type === 'experiment' || type === 'live_note';
    $('#poe-media-url-wrap').hidden = isText;
    $('#poe-media-text-wrap').hidden = !isText;
  }

  function showPoeErrors(errors) {
    const el = $('#poe-errors');
    el.hidden = false;
    el.innerHTML = errors.map((e) => '⚠ ' + escapeHtml(e)).join('<br>');
  }

  function setPoePhaseUi(phaseName) {
    const panel = $('#dir-poe');
    if (!panel) return;
    panel.hidden = false;
    const inPred = phaseName === 'PREDICTION_OPEN';
    const inObs = phaseName === 'OBSERVATION';
    const inExp = phaseName === 'EXPLANATION_OPEN';
    const locked = phaseName === 'QUESTION_LOCKED';
    $('#btn-poe-close-pred').hidden = !inPred;
    $('#btn-poe-start-exp').hidden = !inObs;
    $('#btn-poe-media-retry').hidden = !inObs;
    $('#btn-poe-media-skip').hidden = !inObs;
    $('#btn-poe-media-fallback').hidden = !inObs;
    $('#btn-poe-close-exp').hidden = !inExp;
    $('#btn-poe-analysis').hidden = !locked;
    $('#dir-poe-obs-ctl').hidden = !(inPred || inObs || inExp || locked);
  }

  function renderPoePredictionDist(data) {
    const wrap = $('#dir-poe-pred-dist');
    if (!wrap) return;
    if (!data.predictionDistribution || !data.predictionDistribution.total) {
      wrap.innerHTML = '<div class="ev-muted">Hali bashoratlar yo‘q</div>';
      return;
    }
    const { dist, total } = data.predictionDistribution;
    const rows = Object.entries(dist).map(([oid, count]) => {
      const pct = Math.round((count / total) * 100);
      const correct = data.correctOptionIds && data.correctOptionIds.includes(oid);
      return `<div class="ev-dist-row">${escapeHtml(oid)}${correct ? ' ✓' : ''} — ${count} (${pct}%)</div>`;
    }).join('');
    wrap.innerHTML = `<div class="ev-title">📊 Bashorat taqsimoti (${total})</div>${rows}`;
  }

  function renderPoeMediaState(data) {
    const el = $('#dir-poe-readiness');
    if (!el) return;
    if (data.type === 'media_readiness') {
      el.textContent = `👀 Media tayyorligi: ${data.readyCount}/${data.required}${data.ready ? ' ✅' : ''}`;
    } else if (data.type === 'explanation_count') {
      el.textContent = `✍ Tushuntirishlar: ${data.explained}`;
    }
  }

  function renderPoeAnalysis(data) {
    const wrap = $('#dir-poe-analysis');
    if (!wrap) return;
    wrap.hidden = false;
    const matrix = data.changeMatrix || {};
    const rowsHtml = (matrix.rows || []).slice(0, 20).map((r) =>
      `<div class="ev-dist-row">${escapeHtml(r.participantId)} — ${escapeHtml(r.predictedOptionId)} → ${escapeHtml(r.explainedOptionId)} ${r.changed ? '🔀' : '='}</div>`
    ).join('');
    $('#dir-poe-change-matrix').innerHTML =
      `<div class="ev-title">🔄 O‘zgarish matritsasi (${matrix.total || 0}, o‘zgargan: ${matrix.changed || 0})</div>${rowsHtml || '<div class="ev-muted">—</div>'}`;
  }

  function renderPoeExemplarQueue(data) {
    const wrap = $('#dir-poe-exemplars');
    if (!wrap) return;
    if (!data.pending || data.pending.length === 0) { wrap.innerHTML = ''; return; }
    const list = data.pending.slice(0, 20).map((item) => `
      <div class="poe-exemplar" data-exm-id="${escapeHtml(item.contentId)}">
        <div class="poe-exemplar-text">${escapeHtml(item.text || '')}</div>
        <div class="wall-actions">
          <button type="button" class="hinge-btn hinge-btn-accept exm-act" data-action="approve">✓</button>
          <button type="button" class="cast-btn exm-act" data-action="redact">✏</button>
          <button type="button" class="cast-btn exm-act" data-action="project">📽</button>
          <button type="button" class="hinge-btn hinge-btn-dismiss exm-act" data-action="hide">🙈</button>
          <button type="button" class="cast-btn exm-act" data-action="withdraw">↩</button>
        </div>
      </div>`).join('');
    wrap.innerHTML = `<div class="ev-title">💡 Exemplarlar (${data.total})</div>${list}`;
    wrap.querySelectorAll('.exm-act').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.poe-exemplar');
        if (!card) return;
        const exemplarId = card.dataset.exmId;
        const action = btn.dataset.action;
        const payload = { flowId: data.flowId, exemplarId, action };
        if (action === 'redact') {
          const newText = prompt('Tahrirlangan matn:');
          if (newText === null) return;
          payload.redactedText = newText;
        }
        try { await send('cast:poeModerateExemplar', payload); } catch (e) { announce(e.message || 'Xatolik', true); }
      });
    });
  }

  $('btn-poe').addEventListener('click', () => {
    populatePoeQuestionSelects();
    $('#poe-media-type').value = 'image';
    togglePoeMediaFields('image');
    $('#poe-errors').hidden = true;
    $('#poe-overlay').hidden = false;
  });
  $('#poe-close').addEventListener('click', () => { $('#poe-overlay').hidden = true; });
  $('#poe-media-type').addEventListener('change', (e) => togglePoeMediaFields(e.target.value));

  $('#poe-launch').addEventListener('click', async () => {
    $('#poe-errors').hidden = true;
    const type = $('#poe-media-type').value;
    const media = { type };
    if (['image', 'animation', 'video'].includes(type)) media.url = $('#poe-media-url').value.trim();
    else media.text = $('#poe-media-text').value.trim();
    const contract = {
      flowId: $('#poe-flow-id').value.trim() || 'poe_' + Date.now().toString(36).slice(-6),
      predictionQuestionId: $('#poe-pred-q').value,
      observationId: $('#poe-obs-id').value.trim() || 'obs_01',
      explanationQuestionId: $('#poe-exp-q').value,
      media,
      timerPolicy: {
        predictionSeconds: parseInt($('#poe-pred-sec').value) || 20,
        explanationSeconds: parseInt($('#poe-exp-sec').value) || 90,
      },
    };
    try {
      const ack = await send('cast:poeLaunch', { contract });
      if (ack.ok) {
        $('#poe-overlay').hidden = true;
        $('#dir-poe').hidden = false;
        announce('🔭 POE boshlandi — bashorat qiling!');
      } else {
        showPoeErrors([ack.error?.message || 'Xatolik']);
      }
    } catch (e) {
      showPoeErrors([e.message || 'Xatolik']);
    }
  });

  $('#btn-poe-close-pred').addEventListener('click', async () => {
    try { await send('cast:poeClosePrediction', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-poe-start-exp').addEventListener('click', async () => {
    try { await send('cast:poeStartExplanation', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-poe-close-exp').addEventListener('click', async () => {
    try { await send('cast:poeCloseExplanation', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-poe-analysis').addEventListener('click', async () => {
    try { await send('cast:poeShowAnalysis', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-poe-media-retry').addEventListener('click', async () => {
    try { await send('cast:poeMediaAction', { action: 'retry' }); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-poe-media-skip').addEventListener('click', async () => {
    try { await send('cast:poeMediaAction', { action: 'skip' }); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-poe-media-fallback').addEventListener('click', async () => {
    const fallbackText = prompt('Fallback matn (media ishlamasa):');
    if (fallbackText === null) return;
    try { await send('cast:poeMediaAction', { action: 'fallback', fallbackText }); } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  // ── C3-12 Open-Response Semantic Board ──
  let orbSelected = new Set(); // merge uchun tanlangan cluster ids

  function orbResponseText(responses, rid) {
    const r = responses[rid];
    return r ? r.text || '' : '';
  }

  async function orbManual(action, payload) {
    try {
      await send('cast:orbManual', { action, ...payload });
    } catch (e) {
      announce(e.message || 'Xatolik', true);
    }
  }

  function renderOrbData(data) {
    if (!data) return;
    $('#orb-cluster-status').textContent = '';
    const clusters = Object.values(data.clusters || {});
    const responses = data.responses || {};
    renderOrbUnclustered(data.unclustered || [], responses);
    renderOrbClusterColumn('orb-suggested', clusters.filter((c) => !c.teacherConfirmed), responses);
    renderOrbClusterColumn('orb-confirmed', clusters.filter((c) => c.teacherConfirmed), responses);
    renderOrbEvents(data.events || []);
    updateMergeButton();
  }

  function renderOrbUnclustered(ids, responses) {
    const wrap = $('#orb-unclustered');
    wrap.innerHTML = '';
    if (!ids.length) { wrap.textContent = '—'; return; }
    ids.forEach((rid) => {
      const row = document.createElement('div');
      row.className = 'orb-item orb-unclustered';
      row.textContent = orbResponseText(responses, rid);
      wrap.appendChild(row);
    });
  }

  function renderOrbClusterColumn(sel, clusters, responses) {
    const wrap = $(sel);
    wrap.innerHTML = '';
    if (!clusters.length) { wrap.textContent = '—'; return; }
    clusters.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'orb-cluster';
      const head = document.createElement('div');
      head.className = 'orb-cluster-head';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'orb-sel';
      cb.dataset.clusterId = c.id;
      cb.checked = orbSelected.has(c.id);
      cb.addEventListener('change', () => {
        if (cb.checked) orbSelected.add(c.id); else orbSelected.delete(c.id);
        updateMergeButton();
      });
      const label = document.createElement('span');
      label.className = 'orb-cluster-label';
      label.textContent = c.label || '(labelsiz)';
      const badge = document.createElement('span');
      badge.className = 'orb-cluster-count';
      badge.textContent = (c.responseIds || []).length;
      head.append(cb, label, badge);
      card.appendChild(head);
      const body = document.createElement('div');
      body.className = 'orb-cluster-body';
      (c.responseIds || []).forEach((rid) => {
        const item = document.createElement('div');
        item.className = 'orb-item';
        item.textContent = orbResponseText(responses, rid);
        body.appendChild(item);
      });
      card.appendChild(body);
      const actions = document.createElement('div');
      actions.className = 'orb-cluster-actions';
      const mkBtn = (txt, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cast-btn orb-mini';
        b.textContent = txt;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };
      mkBtn('✅ Tasdiqlash', () => orbManual('confirm', { clusterId: c.id }));
      mkBtn('✏️ Nomlash', () => {
        const lbl = prompt('Yangi nom:', c.label || '');
        if (lbl !== null && lbl.trim()) orbManual('rename', { clusterId: c.id, label: lbl.trim() });
      });
      mkBtn('✂️ Ajratish', () => {
        const pick = prompt('Ajratiladigan response IDlar (vergul bilan):', (c.responseIds || []).join(', '));
        if (pick === null) return;
        const ids = pick.split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length) orbManual('split', { clusterId: c.id, responseIds: ids });
      });
      mkBtn('↔️ Ko‘chirish', () => {
        const target = prompt('Boshqa cluster ID (yoki bo‘sh — unclustered):');
        if (target === null) return;
        const rid = prompt('Ko‘chiriladigan response ID:');
        if (!rid) return;
        if (target.trim()) {
          orbManual('move', { responseId: rid.trim(), fromClusterId: c.id, toClusterId: target.trim() });
        } else {
          orbManual('split', { clusterId: c.id, responseIds: [rid.trim()] });
        }
      });
      card.appendChild(actions);
      wrap.appendChild(card);
    });
  }

  function renderOrbEvents(events) {
    const wrap = $('#orb-events');
    if (!wrap) return;
    wrap.innerHTML = '';
    const recent = events.slice(-8).reverse();
    if (!recent.length) { wrap.textContent = '—'; return; }
    recent.forEach((ev) => {
      const row = document.createElement('div');
      row.className = 'orb-event';
      row.textContent = `#${ev.seq} ${ev.action}`;
      wrap.appendChild(row);
    });
  }

  function updateMergeButton() {
    $('#btn-orb-merge').disabled = orbSelected.size < 2;
  }

  $('btn-orb').addEventListener('click', () => {
    $('#orb-errors').hidden = true;
    $('#orb-overlay').hidden = false;
  });
  $('#orb-close').addEventListener('click', () => { $('#orb-overlay').hidden = true; });
  $('#orb-launch').addEventListener('click', async () => {
    $('#orb-errors').hidden = true;
    const prompt = $('#orb-prompt').value.trim();
    const seconds = parseInt($('#orb-seconds').value) || 60;
    if (!prompt) { $('#orb-errors').textContent = 'Savol matni kerak'; $('#orb-errors').hidden = false; return; }
    try {
      const ack = await send('cast:orbLaunch', { prompt, seconds });
      if (ack.ok) {
        $('#orb-overlay').hidden = true;
        $('#orb-prompt').value = '';
      } else {
        $('#orb-errors').textContent = ack.error?.message || 'Xatolik';
        $('#orb-errors').hidden = false;
      }
    } catch (e) {
      $('#orb-errors').textContent = e.message || 'Xatolik';
      $('#orb-errors').hidden = false;
    }
  });
  $('#btn-orb-close').addEventListener('click', async () => {
    try { await send('cast:orbClose', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-orb-cluster').addEventListener('click', async () => {
    try { await send('cast:orbRunCluster', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-orb-end').addEventListener('click', async () => {
    try { await send('cast:orbEnd', {}); } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  $('#btn-orb-merge').addEventListener('click', async () => {
    if (orbSelected.size < 2) return;
    const label = $('#orb-merge-label').value.trim();
    try {
      await send('cast:orbManual', { action: 'merge', clusterIds: [...orbSelected], label: label || undefined });
      orbSelected.clear();
      updateMergeButton();
      $('#orb-merge-label').value = '';
    } catch (e) { announce(e.message || 'Xatolik', true); }
  });

  // ── C3-13 Forge: queue render + actions ──
  const FORGE_TYPE_LABEL = {
    single_choice: 'Bir javobli',
    true_false: 'To‘g‘ri/Noto‘g‘ri',
    multiple_select: 'Ko‘p javobli',
    short_answer: 'Qisqa javob',
  };
  const FORGE_STATUS_LABEL = { REVIEW_READY: '🟡 Ko‘rib chiqish', APPROVED: '✅ Tasdiqlangan', REJECTED: '❌ Qaytarilgan' };
  let forgeExpanded = {}; // draftId → true (preview/edit ochiq)

  function forgeFlagsBadge(rec) {
    const parts = [];
    if (rec.flags?.email) parts.push('📧 email');
    if (rec.flags?.phone) parts.push('📱 telefon');
    if (rec.flags?.profanity) parts.push('⚠ so‘z');
    if (rec.flags?.url) parts.push('🔗 url');
    if (rec.flags?.pii) parts.push('🆔 PII');
    return parts.length ? parts.join(' ') : '';
  }

  function renderForgeQueue(queue, meta) {
    const wrap = $('#forge-queue');
    if (!wrap) return;
    const entries = Object.entries(queue || {});
    $('#forge-meta').textContent = meta
      ? `Jami: ${meta.total || 0} · Ko‘rib chiqish: ${meta.reviewReady || 0} · Tasdiqlangan: ${meta.approved || 0} · Qaytarilgan: ${meta.rejected || 0} · Ishga tushirilgan: ${meta.launched || 0}`
      : '';
    wrap.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'forge-empty';
      empty.textContent = 'Hozircha savol takliflari yo‘q. Talabalar ✏️ tugmasi orqali yuboradi.';
      wrap.appendChild(empty);
      return;
    }
    for (const [draftId, rec] of entries) {
      const card = document.createElement('div');
      card.className = 'forge-card forge-status-' + (rec.status || 'REVIEW_READY').toLowerCase();

      const head = document.createElement('div');
      head.className = 'forge-card-head';
      const typeBadge = document.createElement('span');
      typeBadge.className = 'forge-badge';
      typeBadge.textContent = FORGE_TYPE_LABEL[rec.questionType] || rec.questionType;
      head.appendChild(typeBadge);
      const statusBadge = document.createElement('span');
      statusBadge.className = 'forge-badge';
      statusBadge.textContent = FORGE_STATUS_LABEL[rec.status] || rec.status;
      head.appendChild(statusBadge);
      const flags = forgeFlagsBadge(rec);
      if (flags) {
        const flagBadge = document.createElement('span');
        flagBadge.className = 'forge-badge forge-badge-warn';
        flagBadge.textContent = flags;
        flagBadge.title = 'Moderatsiya flagi — oldin tekshiring';
        head.appendChild(flagBadge);
      }
      card.appendChild(head);

      const stem = document.createElement('div');
      stem.className = 'forge-stem';
      stem.textContent = rec.stem || '—';
      card.appendChild(stem);

      const metaRow = document.createElement('div');
      metaRow.className = 'forge-meta';
      metaRow.textContent = `👤 ${rec.authorLabel || 'anonim'} · ${new Date(rec.submittedAt || Date.now()).toLocaleTimeString('uz-Latn', { hour: '2-digit', minute: '2-digit' })}` + (rec.duplicateOf ? ' · 🔁 takroriy' : '');
      card.appendChild(metaRow);

      // Details area (preview/edit)
      const detail = document.createElement('div');
      detail.className = 'forge-detail';
      detail.hidden = !forgeExpanded[draftId];
      card.appendChild(detail);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'forge-actions';
      const mkBtn = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = 'cast-btn ' + (cls || '');
        b.textContent = label;
        b.addEventListener('click', () => fn(rec));
        actions.appendChild(b);
      };
      mkBtn('👁 Ko‘rish', 'cast-btn-sm', (r) => forgeToggleDetail(draftId, r, detail));
      if (rec.status === 'REVIEW_READY') {
        mkBtn('✏️ Tahrir', 'cast-btn-sm', (r) => forgeToggleEdit(draftId, r, detail));
        mkBtn('✅ Tasdiqlash', 'cast-btn-sm cast-btn-primary', async (r) => {
          try { await send('cast:forgeReview', { draftId, action: 'approve' }); }
          catch (e) { announce(e.message || 'Xatolik', true); }
        });
        mkBtn('❌ Qaytarish', 'cast-btn-sm', async (r) => forgeReject(draftId));
      }
      if (rec.status === 'APPROVED') {
        mkBtn('🚀 Launch now', 'cast-btn-sm cast-btn-primary', async (r) => {
          try { await send('cast:forgeLaunch', { draftId, timerSeconds: 30 }); announce('✏️ Savol ishga tushirildi', false); }
          catch (e) { announce(e.message || 'Xatolik', true); }
        });
        mkBtn('💾 Libraryga saqlash', 'cast-btn-sm', (r) => forgeSaveToLibrary(draftId));
      }
      card.appendChild(actions);
      wrap.appendChild(card);
    }
  }

  function forgeToggleDetail(draftId, rec, detail) {
    forgeExpanded[draftId] = !forgeExpanded[draftId];
    detail.hidden = !forgeExpanded[draftId];
    if (!detail.hidden) {
      detail.innerHTML = '';
      const shown = rec.editedVersion || rec;
      const body = document.createElement('div');
      body.className = 'forge-preview';
      const lines = [
        ['Tur', FORGE_TYPE_LABEL[shown.questionType] || shown.questionType],
        ['Savol', shown.stem],
        ['Variantlar', (shown.options || []).map((o) => o.text).join(' | ') || '—'],
        ['To‘g‘ri javob', Array.isArray(shown.proposedAnswer) ? shown.proposedAnswer.join(', ') : String(shown.proposedAnswer || '—')],
        ['Izoh', shown.explanation || '—'],
        ['Manba', shown.source || '—'],
      ];
      for (const [k, v] of lines) {
        const row = document.createElement('div');
        row.className = 'forge-preview-row';
        const key = document.createElement('span'); key.className = 'forge-preview-key'; key.textContent = k + ': ';
        const val = document.createElement('span'); val.textContent = v;
        row.appendChild(key); row.appendChild(val);
        body.appendChild(row);
      }
      if (rec.editedVersion) {
        const note = document.createElement('div');
        note.className = 'forge-edited-note';
        note.textContent = '✏️ O‘qituvchi tahriri mavjud — original draft alohida saqlangan (audit).';
        body.appendChild(note);
      }
      detail.appendChild(body);
    }
  }

  function forgeToggleEdit(draftId, rec, detail) {
    forgeExpanded[draftId] = !forgeExpanded[draftId];
    detail.hidden = !forgeExpanded[draftId];
    if (detail.hidden) return;
    const base = rec.editedVersion || rec;
    detail.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'forge-edit-form';
    const stem = document.createElement('textarea');
    stem.className = 'cast-input'; stem.maxLength = 500; stem.rows = 2;
    stem.value = base.stem || ''; stem.placeholder = 'Savol matni';
    const opts = document.createElement('textarea');
    opts.className = 'cast-input'; opts.rows = 3; opts.maxLength = 600;
    opts.value = (base.options || []).map((o) => o.text).join('\n'); opts.placeholder = 'Variantlar (har bir qatorga bittadan)';
    const answer = document.createElement('input');
    answer.className = 'cast-input';
    answer.value = Array.isArray(base.proposedAnswer) ? base.proposedAnswer.map((id) => id.replace(/^o_/, '')).join(', ') : String(base.proposedAnswer || '');
    answer.placeholder = 'To‘g‘ri javob (masalan: 1 yoki 1,2 — yoki qisqa javob matni)';
    const expl = document.createElement('textarea');
    expl.className = 'cast-input'; expl.rows = 2; expl.maxLength = 500;
    expl.value = base.explanation || ''; expl.placeholder = 'Izoh';
    const src = document.createElement('input');
    src.className = 'cast-input'; src.maxLength = 200;
    src.value = base.source || ''; src.placeholder = 'Manba';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'cast-btn cast-btn-primary cast-btn-sm';
    saveBtn.textContent = '💾 Tahrirni saqlash';
    saveBtn.addEventListener('click', async () => {
      const type = base.questionType;
      const optionTexts = opts.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const edits = {
        questionType: type,
        stem: stem.value,
        options: optionTexts.map((t) => ({ text: t })),
        proposedAnswer: type === 'short_answer' ? answer.value.trim() : answer.value.split(',').map((s) => 'o_' + s.trim().replace(/^o_/, '')).filter(Boolean),
        explanation: expl.value,
        source: src.value,
      };
      try {
        const ack = await send('cast:forgeReview', { draftId, action: 'edit', edits });
        if (!ack.ok) { announce(ack.error?.message || 'Xatolik', true); return; }
        announce('✏️ Tahrir saqlandi', false);
      } catch (e) { announce(e.message || 'Xatolik', true); }
    });
    [stem, opts, answer, expl, src, saveBtn].forEach((el) => form.appendChild(el));
    detail.appendChild(form);
  }

  function forgeReject(draftId) {
    const reason = window.prompt('Qaytarish sababi (o‘quvchiga ko‘rsatiladi — ixtiyoriy):');
    if (reason === null) return;
    send('cast:forgeReview', { draftId, action: 'reject', rejectReason: reason || '' })
      .then((ack) => { if (!ack.ok) announce(ack.error?.message || 'Xatolik', true); })
      .catch((e) => announce(e.message || 'Xatolik', true));
  }

  async function forgeSaveToLibrary(draftId) {
    try {
      const res = await fetch('/api/cast/forge/library-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN },
        body: JSON.stringify({ sessionId: BOOT.sessionId, draftId }),
      });
      const data = await res.json();
      if (data.ok) announce('💾 Libraryga saqlandi: ' + data.itemId, false);
      else announce(data.error?.message || 'Saqlab bo‘lmadi', true);
    } catch (e) {
      announce(e.message || 'Xatolik', true);
    }
  }

  $('btn-forge').addEventListener('click', () => {
    const panel = $('#dir-forge');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      send('cast:getSnapshot', {}).catch(() => {});
      // queue server'dan keladi: directorJoin emit + forgeQueue event
    }
  });

  // ── C3-17 Power-ups wiring ──
  const puBtn = $('#btn-powerups');
  if (puBtn && BOOT.config && BOOT.config.powerUps) {
    puBtn.hidden = false;
  }
  if (puBtn) {
    puBtn.addEventListener('click', () => {
      const panel = $('#dir-powerups');
      panel.hidden = !panel.hidden;
      // Current config'dan allowed types belgilash
      const cur = (BOOT.config && BOOT.config.powerUps) || {};
      document.querySelectorAll('.pu-allowed').forEach((cb) => {
        cb.checked = (cur.allowedTypes || []).includes(cb.value);
      });
    });
  }
  const puSave = $('#btn-pu-save');
  if (puSave) {
    puSave.addEventListener('click', async () => {
      const allowed = Array.from(document.querySelectorAll('.pu-allowed')).filter((cb) => cb.checked).map((cb) => cb.value);
      try {
        const ack = await send('cast:powerupConfig', { allowed });
        if (ack.ok) {
          announce('⚡ Power-up sozlamalari saqlandi');
          const panel = $('#dir-powerups');
          if (panel) panel.hidden = true;
        } else {
          announce(ack.error?.message || 'Saqlanmadi', true);
        }
      } catch (e) {
        announce(e.message || 'Saqlanmadi', true);
      }
    });
  }

  // ── C3-16 Self-Paced Race wiring ──
  let spRaceActive = false;
  let spRacePaused = false;
  let spRaceData = null;

  function renderSpPanel() {
    const panel = $('#dir-sp');
    if (!panel) return;
    const btnStart = $('#btn-sp-start');
    const btnPause = $('#btn-sp-pause');
    const btnResume = $('#btn-sp-resume');
    if (btnStart) btnStart.hidden = spRaceActive;
    if (btnPause) btnPause.hidden = !(spRaceActive && !spRacePaused);
    if (btnResume) btnResume.hidden = !(spRaceActive && spRacePaused);
    const status = $('#sp-status');
    if (status) status.textContent = spRacePaused ? '⏸ Pauza qilingan' : spRaceActive ? '🏁 Poyga davom etmoqda' : 'Poyga hali boshlanmagan';
    renderSpProgress(spRaceData);
  }

  function renderSpProgress(data) {
    if (!data) return;
    spRaceData = data;
    const dist = data.distribution || {};
    $('#sp-active').textContent = fmt(dist.active);
    $('#sp-finished').textContent = fmt(dist.finished);
    $('#sp-pending').textContent = fmt(dist.pending);
    const partEl = $('#sp-participation');
    if (partEl) partEl.textContent = data.fairness ? Math.round((data.fairness.participationRate || 0) * 100) + '%' : '—';
    const spreadEl = $('#sp-spread');
    if (spreadEl) spreadEl.textContent = data.fairness ? Math.round((data.fairness.spreadScore || 0) * 100) + '%' : '—';
    const fEl = $('#sp-fairness');
    if (fEl) {
      fEl.textContent = data.fairness && data.fairness.ok ? '✅ Yaxshi' : '⚠ E\u02bbtibor';
      fEl.className = 'chor-cell-val ' + (data.fairness && data.fairness.ok ? 'chor-ok' : 'chor-err');
    }
    const issues = $('#sp-health-issues');
    if (issues) {
      issues.textContent = (data.fairness && data.fairness.issues) ? data.fairness.issues.join(' · ') : '';
    }
    // Distribution histogram (faqat count'lar — identity yo'q)
    const hist = $('#sp-dist');
    if (hist) {
      hist.innerHTML = '';
      const entries = Object.entries(dist.histogram || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
      const max = Math.max(1, ...entries.map(([, c]) => c));
      entries.forEach(([pos, count]) => {
        const row = document.createElement('div');
        row.className = 'sp-dist-row';
        const label = document.createElement('span');
        label.className = 'sp-dist-label';
        label.textContent = '#' + (Number(pos) + 1);
        const track = document.createElement('div');
        track.className = 'sp-dist-track';
        const fill = document.createElement('div');
        fill.className = 'sp-dist-fill';
        fill.style.width = Math.max(4, Math.round((count / max) * 100)) + '%';
        track.appendChild(fill);
        const num = document.createElement('span');
        num.className = 'sp-dist-num';
        num.textContent = count;
        row.append(label, track, num);
        hist.appendChild(row);
      });
    }
  }

  const spBtn = $('#btn-sp');
  if (spBtn) {
    spBtn.addEventListener('click', () => {
      const panel = $('#dir-sp');
      panel.hidden = !panel.hidden;
      renderSpPanel();
      // Director join'da SP progress so'raymiz (server SP_PROGRESS emit qiladi)
      send('cast:getSnapshot', {}).then(() => {}).catch(() => {});
    });
  }
  const spStartBtn = $('#btn-sp-start');
  if (spStartBtn) spStartBtn.addEventListener('click', async () => {
    try {
      const ack = await send('cast:spOpen', {});
      if (ack && ack.ok) {
        spRaceActive = true;
        spRacePaused = false;
        renderSpPanel();
        announce('🏁 Poyga boshlandi');
      }
    } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  const spPauseBtn = $('#btn-sp-pause');
  if (spPauseBtn) spPauseBtn.addEventListener('click', async () => {
    try {
      const ack = await send('cast:spPause', {});
      if (ack && ack.ok) {
        spRacePaused = true;
        renderSpPanel();
        announce('⏸ Poyga pauza qilindi');
      }
    } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  const spResumeBtn = $('#btn-sp-resume');
  if (spResumeBtn) spResumeBtn.addEventListener('click', async () => {
    try {
      const ack = await send('cast:spResume', {});
      if (ack && ack.ok) {
        spRacePaused = false;
        renderSpPanel();
        announce('▶ Poyga davom ettirildi');
      }
    } catch (e) { announce(e.message || 'Xatolik', true); }
  });
  // Self-paced rejimni bilish: director-join snapshot'da SP active bo'lsa
  // (server SP_PROGRESS event'i bilan yangilanadi)
  const isSpConfig = BOOT.config && (BOOT.config.pace === 'self_paced' || (BOOT.config.selfPaced && BOOT.config.selfPaced.enabled));
  if (isSpConfig && spBtn) {
    spBtn.hidden = false;
    // Review fix #4: self-paced rejimda normal savol oqimi tugmalari yashiriladi
    // (server ham question:open/close/reveal/next'ni bloklaydi)
    ['btn-pause', 'btn-close', 'btn-reveal', 'btn-next', 'btn-discuss', 'btn-revote'].forEach((id) => {
      const b = $(id);
      if (b) b.hidden = true;
    });
  }

  // ── C4-01 Team Challenge wiring ──
  const teamsBtn = $('#btn-teams');
  if (teamsBtn && BOOT.config && BOOT.config.teams && BOOT.config.teams.enabled) {
    teamsBtn.hidden = false;
  }
  if (teamsBtn) {
    teamsBtn.addEventListener('click', () => {
      const panel = $('#dir-teams');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        send('cast:getSnapshot', {}).then(() => {}).catch(() => {});
      }
    });
  }
  const teamAssignBtn = $('#btn-team-assign');
  if (teamAssignBtn) {
    teamAssignBtn.addEventListener('click', async () => {
      try {
        const ack = await send('cast:teamAssign', { mode: 'random' });
        if (ack && ack.ok) { announce('🎲 Jamoalar taqsimlandi'); }
        else announce(ack?.error?.message || 'Taqsimlanmadi', true);
      } catch (e) { announce(e.message || 'Xatolik', true); }
    });
  }
  const teamTalkBtn = $('#btn-team-talk');
  if (teamTalkBtn) {
    teamTalkBtn.addEventListener('click', async () => {
      const secs = Number(($('#team-talk-secs') || {}).value || 60);
      try {
        const ack = await send('cast:teamTalkStart', { seconds: secs });
        if (ack && ack.ok) { announce(`🗣 Jamoa muhokamasi (${ack.seconds}s)`); }
        else announce(ack?.error?.message || 'Boshlanmadi', true);
      } catch (e) { announce(e.message || 'Xatolik', true); }
    });
  }
  // Render helpers
  function renderTeamRoster(teams) {
    const box = $('#team-roster');
    if (!box) return;
    box.innerHTML = '';
    if (!Array.isArray(teams) || teams.length === 0) {
      box.innerHTML = '<div class="orb-status">Hali jamoalar yo‘q</div>';
      return;
    }
    teams.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'sp-dist-row';
      row.innerHTML = `<span class="sp-dist-label">${escapeHtml(t.name || t.teamId)}</span>` +
        `<span class="sp-dist-num">${t.memberCount || 0} a'zo</span>`;
      row.title = (t.memberAliases || []).join(', ');
      box.appendChild(row);
    });
  }
  function renderTeamLeaderboard(data) {
    const box = $('#team-lb');
    if (!box) return;
    box.innerHTML = '';
    const entries = (data && data.entries) || [];
    if (entries.length === 0) {
      box.innerHTML = '<div class="orb-status">Hali reyting yo‘q</div>';
      return;
    }
    entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'sp-dist-row';
      row.innerHTML = `<span class="sp-dist-label">#${e.rank}</span>` +
        `<span style="flex:1">${escapeHtml(e.name || e.teamId)}</span>` +
        `<span class="sp-dist-num">${e.scoreDisplay || 0}</span>`;
      box.appendChild(row);
    });
  }

  // ── C4-03 Paper-card wiring ──
  const cardsBtn = $('#btn-cards');
  const isPaperMode = BOOT.config && BOOT.config.participation && BOOT.config.participation.paperCardMode;
  if (cardsBtn && isPaperMode) cardsBtn.hidden = false;
  if (cardsBtn) {
    cardsBtn.addEventListener('click', () => {
      const panel = $('#dir-cards');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        send('cast:getSnapshot', {}).then(() => {}).catch(() => {});
        // Progress'ni so'raymiz — qayta skan serverda CARD_PROGRESS emit qiladi;
        // yangi skan bo'lmasa director join snapshot yetarli.
      }
    });
  }
  let cardScanner = null;
  const btnCardScan = $('#btn-card-scan');
  if (btnCardScan) {
    btnCardScan.addEventListener('click', async () => {
      try {
        if (!cardScanner) {
          cardScanner = window.CastCardScanner && CastCardScanner.create({
            $,
            send,
            onScan: (ack) => {
              const st = $('#card-status');
              if (st) st.textContent = `✅ ${ack.cardId} → ${ack.optionId}`;
            },
          });
        }
        await cardScanner.open();
      } catch (err) {
        const st = $('#card-status');
        if (st) st.textContent = '📷 Kamera ruxsati yo‘q — qo‘lda variant tanlang';
        announce('Kamera ochilmadi — manual tuzatishdan foydalaning', true);
      }
    });
  }
  const btnCardCorrect = $('#btn-card-correct');
  if (btnCardCorrect) {
    btnCardCorrect.addEventListener('click', () => {
      const box = $('#card-correct-box');
      box.hidden = !box.hidden;
    });
  }
  const btnCardCorrectSave = $('#btn-card-correct-save');
  if (btnCardCorrectSave) {
    btnCardCorrectSave.addEventListener('click', async () => {
      const cardId = $('#card-correct-id').value.trim();
      const optLetter = $('#card-correct-opt').value.trim().toUpperCase();
      const reason = $('#card-correct-reason').value.trim();
      const qid = currentQuestionId();
      // optionId — joriy savolning haqiqiy variant ID'si (letter emas)
      const optionId = resolveCurrentOptionId(optLetter);
      if (!cardId || !optionId || !qid) {
        announce('Karta, variant (A–D) va savol kerak', true);
        return;
      }
      try {
        const ack = await send('cast:cardCorrect', { cardId, optionId, reason, questionId: qid });
        if (ack && ack.ok) {
          announce(`✏️ ${cardId} tuzatildi (audit qilindi)`);
          $('#card-correct-box').hidden = true;
        } else {
          announce(ack?.error?.message || 'Tuzatilmadi', true);
        }
      } catch (e) { announce(e.message || 'Xatolik', true); }
    });
  }
  function currentQuestionId() {
    const q = $('#dir-q-text');
    return window.__curQuestionId__ || null;
  }
  // Option ID'ni joriy savolning haqiqiy variantlaridan resolve qiladi
  // (letter → option index → real option.id) — hardcoded o1..o4 emas.
  function resolveCurrentOptionId(letter) {
    const q = window.__lastQuestion;
    if (!q || !Array.isArray(q.options)) return null;
    const idx = { A: 0, B: 1, C: 2, D: 3 }[letter];
    const opt = q.options[idx];
    return opt ? (opt.id || null) : null;
  }
  function renderCardProgress(data) {
    const box = $('#card-progress');
    if (!box) return;
    box.innerHTML = '';
    if (!data) return;
    const rows = [
      ['Kutilgan', data.expected ?? 0],
      ['Skanerlangan', data.scanned ?? 0],
      ['Belgilangan (glare)', data.flagged ?? 0],
      ['Noma‘lum', data.unknown ?? 0],
      ['Takroriy', data.duplicate ?? 0],
      ['Yetishmayapti', data.missing ?? 0],
    ];
    rows.forEach(([label, val]) => {
      const row = document.createElement('div');
      row.className = 'sp-dist-row';
      row.innerHTML = `<span class="sp-dist-label">${label}</span><span class="sp-dist-num">${val}</span>`;
      box.appendChild(row);
    });
  }

  // ── C3-14 Choreography wiring ──
  if (window.CastChoreography) {
    CastChoreography.setContext({ $, send, announce, BOOT });
    CastChoreography.init();
  }
  $('btn-choreo').addEventListener('click', () => {
    const panel = $('#dir-choreo');
    panel.hidden = !panel.hidden;
    if (!panel.hidden && window.CastChoreography) {
      CastChoreography.open();
      // Dashboard — state.choreography'dan to'ldiramiz
      send('cast:getSnapshot', {}).then((res) => {
        if (res.state?.choreography && window.CastChoreography) {
          const chor = res.state.choreography;
          const cur = chor.blocks[chor.currentIndex] || null;
          const next = chor.overrideNext ? chor.blocks.find((b) => b.id === chor.overrideNext) : (chor.blocks[chor.nextIndex] || null);
          const elapsedMs = chor.blockStartedAt ? Math.max(0, Date.now() - chor.blockStartedAt) : 0;
          CastChoreography.renderDashboard({
            current: cur ? { id: cur.id, type: cur.type, config: cur.config } : null,
            next: next ? { id: next.id, type: next.type } : null,
            currentIndex: chor.currentIndex,
            totalBlocks: chor.blocks.length,
            overrideNext: chor.overrideNext,
            elapsedMs,
            remainingMs: cur?.config?.seconds ? Math.max(0, Number(cur.config.seconds) * 1000 - elapsedMs) : null,
            coverage: Math.min(1, (chor.currentIndex + 1) / chor.blocks.length),
            health: { ok: true, issues: [] },
            finished: chor.currentIndex >= chor.blocks.length,
            _at: Date.now(),
          });
        }
      }).catch(() => {});
    }
  });

  // Init
  socket.on('connect', () => {
    setHealth('online');
    // Join director private room (teacher evidence channel)
    client.sendCommand('cast:directorJoin', {}).then((ack) => {
      // BUG-230db143d fix: ochilishda mavjud ishtirokchilar (refresh holati)
      if (ack && Array.isArray(ack.participants) && ack.participants.length) {
        ack.participants.forEach((p) => dirParticipants.set(p.participantId, { displayAlias: p.displayAlias || 'Ishtirokchi', delivery: p.delivery || 'in_room' }));
        const cnt = $('dir-player-count');
        if (cnt) cnt.textContent = String(dirParticipants.size);
        renderDirParticipants();
      }
    }).catch(() => {});
    // Request snapshot to sync
    client.sendCommand('cast:getSnapshot', {}).then((res) => {
      if (res.state) {
        phase = res.state.phase || phase;
        revision = res.revision;
      }
      updateControls();
    }).catch(() => {});
  });

  window.__lastQuestion = null;
  updateControls();

  // ── C5-11 AI Co-host shadow card (recommendation only — live action YO'Q) ──
  let shadowSuggestion = null;
  const shadowCard = $('dir-shadow');
  function renderShadowSuggestion(ev) {
    if (!shadowCard) return;
    if (!ev || !ev.suggestion) { shadowCard.hidden = true; return; }
    shadowSuggestion = ev.suggestion;
    shadowCard.hidden = false;
    const meta = $('dir-shadow-meta');
    if (meta) {
      meta.textContent = `${ev.provider === 'heuristic' ? '🧠 rule-engine' : '🤖 LLM'} · ${ev.latencyMs ?? '—'}ms · cost ${ev.costUs ?? 0}µ$`;
    }
    const body = $('dir-shadow-body');
    if (body) {
      const conf = Math.round((ev.suggestion.confidence ?? 0.5) * 100);
      const act = ev.suggestion.action ? `<div class="shadow-action-tag">Taklif: <b>${escapeHtml(ev.suggestion.action)}</b></div>` : '';
      body.innerHTML = `<div class="shadow-msg">${escapeHtml(ev.suggestion.message)}</div>
        <div class="shadow-conf">Ishonch: ${conf}%</div>${act}`;
    }
    const ok = $('dir-shadow-accept');
    const no = $('dir-shadow-dismiss');
    if (ok) ok.hidden = false;
    if (no) no.hidden = false;
  }
  const shadowRunBtn = $('dir-shadow-run');
  if (shadowRunBtn) {
    shadowRunBtn.addEventListener('click', () => {
      client.sendCommand('cast:shadowRun', {}).catch(() => {});
    });
  }
  const shadowOkBtn = $('dir-shadow-accept');
  if (shadowOkBtn) {
    shadowOkBtn.addEventListener('click', () => {
      if (shadowSuggestion) client.sendCommand('cast:shadowDecide', { decision: 'accepted', suggestionId: shadowSuggestion.id }).then(() => { shadowCard.hidden = true; }).catch(() => {});
    });
  }
  const shadowNoBtn = $('dir-shadow-dismiss');
  if (shadowNoBtn) {
    shadowNoBtn.addEventListener('click', () => {
      if (shadowSuggestion) client.sendCommand('cast:shadowDecide', { decision: 'dismissed', suggestionId: shadowSuggestion.id }).then(() => { shadowCard.hidden = true; }).catch(() => {});
    });
  }


  // ── C4-04 (item 23): discoverable keyboard shortcuts (optional, input'da ishlamaydi) ──
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    const key = e.key.toLowerCase();
    if (key === 'p') {
      const p = $('btn-pause');
      const r = $('btn-resume');
      if (p && !p.disabled && !p.hidden) { p.click(); e.preventDefault(); }
      else if (r && !r.disabled && !r.hidden) { r.click(); e.preventDefault(); }
    } else if (key === 'l') {
      const c = $('btn-close');
      if (c && !c.disabled && !c.hidden) { c.click(); e.preventDefault(); }
    } else if (key === 'n') {
      const v = $('btn-reveal');
      const nx = $('btn-next');
      if (v && !v.disabled && !v.hidden) { v.click(); e.preventDefault(); }
      else if (nx && !nx.disabled && !nx.hidden) { nx.click(); e.preventDefault(); }
    } else if (e.key === 'ArrowRight') {
      const nx = $('btn-next');
      if (nx && !nx.disabled && !nx.hidden) { nx.click(); e.preventDefault(); }
    }
  });
})();
