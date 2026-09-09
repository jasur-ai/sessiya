/**
 * Deborah — Cast Participant Client
 * ---------------------------------
 * Client state enum: WAITING / THINKING / OPEN / SELECTED / SENDING /
 * SAVED / RETRYING / LOCKED / PAUSED / REVEAL / ENDED.
 * UI "Javob saqlandi"ni faqat server ACK yoki answer-status confirmationdan
 * keyin ko'rsatadi.
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const BOOT = window.__BOOT__ || {};

  const STATE = {
    WAITING: 'WAITING',
    THINKING: 'THINKING',
    OPEN: 'OPEN',
    SELECTED: 'SELECTED',
    SENDING: 'SENDING',
    SAVED: 'SAVED',
    RETRYING: 'RETRYING',
    LOCKED: 'LOCKED',
    PAUSED: 'PAUSED',
    REVEAL: 'REVEAL',
    ENDED: 'ENDED',
  };

  let state = STATE.WAITING;
  let sessionId = null;
  let participantId = null;
  let displayAlias = null;
  let currentQuestion = null;
  let selectedIds = new Set();
  let socket = null;
  let client = null;
  let closesAt = null;
  let timerInterval = null;
  let savedTicket = null;
  let a11y = null;
  // C4-04 (item 20): personal accommodation — noTimer/longTimeMs (join ack'dan)
  let accommodation = null;
  // C4-09: shohsupa (auto-podium) — eng so'nggi personal projection + overlay boshqaruvi
  let podiumPersonal = null;
  let podiumHideTimer = null;
  function hidePodium(keepPanel) {
    const ov = $('part-podium');
    if (ov) ov.hidden = true;
    if (podiumHideTimer) { clearTimeout(podiumHideTimer); podiumHideTimer = null; }
    // S32 panel: yangi savol kelganda tozalanadi; session end'da esa yakuniy
    // shaxsiy reyting ko'rinib turishi kerak (keepPanel=true).
    if (!keepPanel) {
      const panel = $('part-leaderboard');
      if (panel) panel.hidden = true;
    }
  }

  // C4-04: accessibility bootstrap (theme/motion/hints/timer policy)
  if (window.CastA11yInit) {
    a11y = window.CastA11yInit({ role: 'participant' });
  }

  // C4-05: i18n — t() translate, fallback chain client'da
  let i18n = null;
  let t = (k, v) => k;
  if (window.CastI18n) {
    window.CastI18n.init({ locale: BOOT.locale || 'uz-Latn' }).then((api) => {
      i18n = api;
      t = api.t;
      // C4-05 (item 14): apostrophe input normalization
      document.querySelectorAll('input, textarea').forEach((el) => {
        el.addEventListener('input', () => {
          const n = window.CastI18n.normalizeApostrophes(el.value);
          if (n !== el.value) el.value = n;
        });
      });
    });
  }
  // C3-11 POE
  let poePhase = null; // null | PREDICTION | OBSERVATION | EXPLANATION | DONE
  let poeExpMode = 'mcq';

  // S31.09: personal preferences — localStorage'da saqlanadi (mute/reduced/highContrast)
  const PREF_KEY = 'cast-participant-prefs-v1';
  let prefs = { reducedMotion: null, highContrast: null, muted: false };
  try {
    prefs = { ...prefs, ...(JSON.parse(localStorage.getItem(PREF_KEY) || '{}')) };
  } catch (e) { /* ignore */ }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }
  function applyPrefs() {
    // a11y tizimi (cast-a11y.js) data-cast-theme="hc_*" orqali high contrast boshqaradi;
    // bu yerda faqat localStorage prefs'ini qo'llaymiz (dead branch yo'q)
    const contrast = prefs.highContrast === true;
    document.body.classList.toggle('part-pref-reduced', prefs.reducedMotion === true || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.body.classList.toggle('part-pref-contrast', contrast);
    if (prefs.muted) document.querySelectorAll('video,audio').forEach((el) => { el.muted = true; });
  }

  function setState(next) {
    state = next;
    renderState();
  }

  function announce(msg, assertive) {
    const el = assertive ? $('alert-live') : $('status-live');
    el.textContent = msg;
  }

  // S31.01: join form ism to'ldirilganda step 2 ga o'tamiz
  const joinNameInput = $('join-name');
  if (joinNameInput) {
    joinNameInput.addEventListener('input', () => {
      setJoinStep(2, false);
    });
  }
  const joinCodeInput = $('join-code');
  if (joinCodeInput) {
    joinCodeInput.addEventListener('input', () => {
      setJoinStep(1, false);
    });
  }

  function show(view) {
    const prevActive = document.activeElement;
    ['part-join', 'part-waiting', 'part-question', 'part-reveal', 'part-poe-obs', 'part-poe-exp', 'part-poe-analysis', 'part-orb'].forEach((id) => {
      $(id).hidden = id !== view;
    });
    // C4-04 (item 24): focus phase o'zgarganda userni kutilmagan joyga ko'chirmaslik —
    // faqat hozirgi focus hidden bo'lib qolsa view ichidagi birinchi interactive'ga o'tkazamiz.
    if (prevActive && prevActive !== document.body && $(view)) {
      const stillVisible = prevActive.offsetParent !== null || prevActive === document.activeElement;
      if (!stillVisible) {
        const first = $(view).querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (first) first.focus({ preventScroll: true });
      }
    }
  }

  const STATE_BANNER = {
    [STATE.SELECTED]: 'Javob tanlandi — yuborishga tayyor',
    [STATE.SENDING]: 'Yuborilmoqda…',
    [STATE.SAVED]: '✓ Javob saqlandi',
    [STATE.RETRYING]: 'Yuborishda xatolik — qayta urinilmoqda',
    [STATE.LOCKED]: 'Javob qabul qilinmaydi',
    [STATE.PAUSED]: 'Pauza — davom eting',
  };

  // S31.05: answer state banner — persistent, visible (toast-only emas)
  function renderState() {
    const status = $('part-status');
    const msg = {
      [STATE.SELECTED]: t('status.waiting'),
      [STATE.SENDING]: t('status.sending'),
      [STATE.SAVED]: t('status.saved'),
      [STATE.RETRYING]: t('status.retrying'),
      [STATE.LOCKED]: t('status.locked'),
      [STATE.PAUSED]: t('status.paused'),
    };
    if (msg[state]) announce(msg[state], state === STATE.LOCKED);
    const banner = $('part-state-banner');
    if (banner) {
      // S31.05: banner i18n (announce bilan bir xil kalitlar)
      const text = msg[state] || STATE_BANNER[state];
      if (text && state !== STATE.OPEN && state !== STATE.WAITING) {
        banner.textContent = state === STATE.SAVED ? '✓ ' + text : text;
        banner.dataset.state = state;
        banner.hidden = false;
      } else {
        banner.hidden = true;
        banner.dataset.state = '';
      }
    }
  }

  function startTimer() {
    stopTimer();
    // C4-04 (item 20): noTimer accommodation — timer ko'rsatilmaydi
    const el = $('part-timer');
    if (accommodation && accommodation.noTimer) {
      if (el) { el.textContent = '—'; el.hidden = true; }
      return;
    }
    if (el) el.hidden = false;
    // C4-04 (item 20): longTimeMs accommodation — qo'shimcha vaqt
    let deadline = closesAt;
    if (accommodation && accommodation.longTimeMs > 0 && deadline) {
      deadline = deadline + accommodation.longTimeMs;
    }
    // C4-04 (item 6/7): timer har second emas — 30/10/5/0 threshold announcement
    if (a11y && a11y.watchTimer) {
      a11y.watchTimer({
        getRemaining: () => (deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null),
        announce: (msg) => announce(msg, false),
      });
    }
    // C5-05 (item 14): second-level timer render (250ms→1000ms) — long-task profili yengillashadi
    const renderTimer = () => {
      if (!deadline) { el.textContent = '—'; return; }
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      el.textContent = t('timer.urgent', { s: remaining });
      el.classList.toggle('urgent', remaining <= 10);
    };
    renderTimer();
    timerInterval = setInterval(renderTimer, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (a11y && a11y.stopTimerWatcher) a11y.stopTimerWatcher();
  }

  // ── Join ──
  $('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('join-code').value.trim();
    const name = $('join-name').value.trim();
    $('join-error').textContent = '';
    if (!code || !name) { $('join-error').textContent = 'Kod va ism kiritilishi shart'; return; }

    // Auto-fill code from URL if empty
    const urlCode = new URLSearchParams(location.search).get('code');
    const joinCode = code || urlCode || '';

    // Init socket lazily on first join
    if (!socket) {
      socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] }); // BUG-230db143 root fix (namespace xatosi)
      client = new CastSocketClient({ socket, onEvent: (ev, data) => handleEvent(ev, data), onError: () => setState(STATE.RETRYING) });
      socket.on('disconnect', () => updateNet('offline', 'Uzildi — qayta ulanmoqda'));
      socket.on('reconnect_attempt', () => updateNet('reconnecting', 'Qayta ulanmoqda…'));
      socket.on('connect_error', () => updateNet('reconnecting', 'Qayta ulanmoqda…'));
      socket.on('connect', () => updateNet('online', 'Ulangan'));
    }

    $('join-btn').disabled = true;
    $('join-btn').textContent = 'Qo‘shilmoqda…';
    try {
      // C4-02 (item 2): delivery type (in_room | remote)
      const joinDelivery = ($('join-delivery') || {}).value || 'in_room';
      // C4-03: paper-card mode'da karta raqami (expected count uchun)
      const cardWrap = $('join-card-wrap');
      const isPaperMode = BOOT && BOOT.config && BOOT.config.participation && BOOT.config.participation.paperCardMode;
      if (cardWrap && isPaperMode) cardWrap.hidden = false;
      const joinCard = (cardWrap && !cardWrap.hidden && $('join-card')) ? $('join-card').value.trim() : null;
      const ack = await client.sendCommand('cast:join', { joinCode, displayName: name, avatarId: null, delivery: joinDelivery, cardId: joinCard }, { ackTimeout: 8000 });
      sessionId = ack.sessionId;
      participantId = ack.participantId;
      displayAlias = ack.displayAlias;
      savedTicket = ack.membershipTicket;
      client.sessionId = sessionId;
      client.actorId = participantId;
      client.setRevision(ack.revision || 1);
      sessionStorage.setItem('castTicket', savedTicket);
      sessionStorage.setItem('castSessionId', sessionId);
      // S31.01: join stepper — 3-qadam (Lobbi) yakunlandi
      setJoinStep(3, true);
      // S31.08/09: player badge + preferences
      updateBadge(ack.displayAlias || name, ack.avatarId);
      applyPrefs();
      updateNet('online', 'Ulangan');
      // C4-02: network profile + low-bandwidth policy (client-mode)
      applyNetworkProfile(ack.delivery, ack.network);
      // C4-04 (item 20): accommodation hook — noTimer/longTimeMs
      accommodation = (ack.config && ack.config.accessibility && ack.config.accessibility.accommodation) || null;
      if (accommodation && accommodation.noTimer) {
        const t = $('part-timer');
        if (t) { t.textContent = '—'; t.hidden = true; }
      }

      $('part-session-title').textContent = ack.title || '';
      // C4-05 (item 9): alias <bdi> bilan isolate — user bidi text UI'ni buzmaydi
      const aliasWrap = $('part-wait-alias');
      if (aliasWrap) {
        aliasWrap.textContent = '';
        aliasWrap.append(document.createTextNode(t('join.waitAlias', { name: '' })));
        if (window.CastI18n && window.CastI18n.bdi) {
          aliasWrap.appendChild(window.CastI18n.bdi(displayAlias));
        } else {
          aliasWrap.appendChild(document.createTextNode(displayAlias));
        }
      }
      // C4-10 rev.4: "Savol taklif qilish" (Forge) ishtirokchilardan butunlay olib tashlandi
      show('part-waiting');
      setState(STATE.WAITING);
      if (ack.state && ack.state.phase === 'QUESTION_OPEN' && ack.question) {
        renderQuestion(ack.question, ack.state.phase);
      } else if (ack.state && ack.state.poe && ack.state.poe.phase) {
        // C3-11: POE flow'ga reconnect — fazaga mos UI tiklanadi
        currentQuestion = ack.question;
        recoverPoe(ack.state);
      } else if (ack.state && ack.state.orb && ack.state.orb.phase === 'COLLECT') {
        // C3-12: ORB'ga reconnect — ochiq javob view'i tiklanadi
        orbPhase = 'COLLECT';
        show('part-orb');
        $('part-orb-q').textContent = ack.state.orb.prompt || 'Fikringizni yozing';
        $('part-orb-text').value = '';
        $('part-orb-text').disabled = false;
        $('part-orb-submit').disabled = false;
        $('part-orb-submit').textContent = 'Yuborish';
        $('part-orb-error').textContent = '';
        $('part-orb-chars').textContent = '0 / 280';
      } else if (ack.state && ack.state.phase !== 'LOBBY_OPEN') {
        show('part-question');
        $('part-q-text').textContent = 'Savol yuborilmoqda…';
      }
      // C3-16: self-paced cursor bo'lsa — UI'ga chiqaramiz
      if (ack.selfPaced) {
        spCursor = ack.selfPaced;
        renderSpProgress();
        if (ack.state && ack.state.selfPaced && ack.state.selfPaced.active && !spSyncInterval) {
          spSyncInterval = setInterval(spSync, 20000);
        }
      }
      // C3-17: power-up inventory (faqat o'ziga)
      if (ack.powerUps) {
        powerUpInv = ack.powerUps;
        renderPowerUps();
      }
      // C4-01: own team (faqat o'z jamoasiga)
      if (ack.team) {
        myTeam = ack.team;
        renderTeamBadge();
      }
    } catch (err) {
      // C4-06 (item 15): block qilingan ism — aniq xabar (remove'dan farqli)
      const code = err?.code || err?.error?.code;
      if (code === 'BLOCKED') {
        $('join-error').textContent = 'Siz bu sessiyaga qayta qo‘shila olmaysiz (bloklangan).';
      } else {
        $('join-error').textContent = err.details?.message || err.message || 'Qo‘shilib bo‘lmadi';
      }
    } finally {
      $('join-btn').disabled = false;
      $('join-btn').textContent = 'Qo‘shilish';
    }
  });

  // ── Question render ──
  function renderQuestion(q, phase, preserveIds = null) {
    currentQuestion = q;
    clearStageCountdown();
    show('part-question');
    selectedIds = new Set(preserveIds || []);
    $('part-q-meta').textContent = phase === 'REVOTE_OPEN' ? 'Qayta ovoz berish' : 'Savol';
    $('part-q-text').textContent = q.text;
    const wrap = $('part-options');
    wrap.innerHTML = '';
    wrap.hidden = false;
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
    q.options.forEach((o, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cast-option';
      btn.dataset.id = o.id;
      const symbols = ['▲', '●', '◆', '★', '✦'];
      // S31.04: shape + letter + text — rangga bog'liq emas
      btn.innerHTML =
        `<span class="cast-opt-letter" aria-hidden="true">${LETTERS[i % 6]}</span>` +
        `<span class="cast-opt-symbol" aria-hidden="true">${symbols[i % 5]}</span>` +
        `<span>${escapeHtml(o.text)}</span>`;
      btn.addEventListener('click', () => toggleSelect(btn));
      wrap.appendChild(btn);
    });
    closesAt = q.closesAt || null;
    startTimer();
    $('part-submit').hidden = true;
    // C3-04: askConfidence bo'lsa confidence prompt ko'rsatiladi (inline)
    confidenceLevel = null;
    document.querySelectorAll('.conf-btn').forEach((b) => b.classList.remove('selected'));
    const confEl = $('part-confidence');
    if (confEl) {
      const shouldAsk = q.askConfidence === true || (BOOT.confidencePolicy && BOOT.confidencePolicy !== 'off');
      confEl.hidden = !shouldAsk;
    }
    setState(STATE.OPEN);
    renderState();
  }

  function toggleSelect(btn) {
    if (state !== STATE.OPEN && state !== STATE.SELECTED) return;
    const id = btn.dataset.id;
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    btn.classList.toggle('selected', selectedIds.has(id));
    setState(selectedIds.size > 0 ? STATE.SELECTED : STATE.OPEN);
    // Single-choice: show submit when one selected; multi-select: always show
    const isMulti = currentQuestion && currentQuestion.type === 'multiple_select';
    $('part-submit').hidden = selectedIds.size === 0;
  }

  // ── C4-08: staging countdown (savol ochilguncha ko'rinadigan 3-2-1) ──
  let stageTimer = null;
  function clearStageCountdown() {
    if (stageTimer) { clearInterval(stageTimer); stageTimer = null; }
    const el = $('part-stage-cd');
    if (el) el.hidden = true;
  }
  function startStageCountdown(sec) {
    clearStageCountdown();
    const el = $('part-stage-cd');
    const num = $('part-stage-num');
    if (!el || !num || !sec) return;
    num.textContent = String(sec);
    el.hidden = false;
    const t0 = Date.now();
    stageTimer = setInterval(() => {
      const left = sec - Math.floor((Date.now() - t0) / 1000);
      if (left <= 0) { num.textContent = '0'; clearStageCountdown(); }
      else num.textContent = String(left);
    }, 250);
  }

  // ── C3-04 Confidence buttons ──
  document.querySelectorAll('.conf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      confidenceLevel = btn.dataset.level;
      document.querySelectorAll('.conf-btn').forEach((b) => b.classList.toggle('selected', b === btn));
      // Confidence tanlangach javobni yuborish imkoni (after_answer prompt)
      const sub = $('part-submit');
      if (sub.hidden && currentQuestion && selectedIds.size > 0) {
        sub.hidden = false;
      }
    });
  });

  // ── Reasoning (C3-07) ──
  const reasoningEl = $('part-reasoning');
  const reasoningText = $('reasoning-text');
  const reasoningChars = $('reasoning-chars');
  const reasoningSubmit = $('reasoning-submit');
  const reasoningSkip = $('reasoning-skip');
  const reasoningError = $('reasoning-error');

  let currentQuestionId = null;

  // Char count
  reasoningText.addEventListener('input', () => {
    const len = reasoningText.value.length;
    reasoningChars.textContent = `${len} / 280`;
    reasoningSubmit.hidden = len === 0;
  });

  // Submit reasoning
  reasoningSubmit.addEventListener('click', async () => {
    const text = reasoningText.value.trim();
    if (!text || !currentQuestionId) return;
    reasoningSubmit.disabled = true;
    reasoningError.textContent = '';
    try {
      const ack = await client.sendCommand('cast:submitReasoning', {
        questionId: currentQuestionId,
        text,
        attemptNo: currentVoteRound || 1,
      });
      if (ack.ok) {
        reasoningText.disabled = true;
        reasoningSubmit.textContent = '✓ Yuborildi';
        reasoningSubmit.disabled = true;
        reasoningSkip.hidden = true;
      } else {
        reasoningError.textContent = ack.error?.message || 'Xatolik';
      }
    } catch (err) {
      reasoningError.textContent = err.message || 'Xatolik';
    } finally {
      reasoningSubmit.disabled = false;
    }
  });

  // Skip reasoning
  reasoningSkip.addEventListener('click', () => {
    reasoningEl.hidden = true;
  });

  // Show reasoning after answer saved
  function showReasoning(qId) {
    currentQuestionId = qId;
    reasoningText.value = '';
    reasoningText.disabled = false;
    reasoningChars.textContent = '0 / 280';
    reasoningSubmit.textContent = 'Izohni yuborish';
    reasoningSubmit.hidden = true;
    reasoningSubmit.disabled = false;
    reasoningSkip.hidden = false;
    reasoningError.textContent = '';
    reasoningEl.hidden = false;
  }

  // ── C3-10 Confusion Signal ──
  let lastSentSignal = null;
  const confusionEl = $('part-confusion');
  const confusionAckEl = $('confusion-ack');

  document.querySelectorAll('.conf-signal-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!client || !sessionId) return;
      const signal = btn.dataset.signal;
      lastSentSignal = signal;
      confusionAckEl.hidden = true;
      try {
        const ack = await client.sendCommand('cast:confusionSignal', { signal }, { ackTimeout: 6000 });
        if (ack.ok && !ack.throttled) {
          btn.classList.add('sent');
          announce('✅ Signal yuborildi');
          setTimeout(() => btn.classList.remove('sent'), 2000);
        }
      } catch (_) { /* signal non-critical */ }
    });
  });

  // ── C3-10 Question Wall ──
  const wallEl = $('part-wall');
  const wallText = $('wall-text');
  const wallSubmit = $('wall-submit');
  const wallError = $('wall-error');
  const wallList = $('wall-list');

  // Show wall only if enabled (server config 'off' bo'lmasa)
  if (wallEl && !(BOOT.moderation && BOOT.moderation.questionWall === 'off')) {
    wallEl.hidden = false;
  }

  wallSubmit.addEventListener('click', async () => {
    const text = wallText.value.trim();
    if (!text || !client || !sessionId) return;
    wallError.textContent = '';
    wallSubmit.disabled = true;
    try {
      const ack = await client.sendCommand('cast:questionWall', { text }, { ackTimeout: 6000 });
      if (ack.ok) {
        wallText.value = '';
        announce('✅ Savol yuborildi — tasdiqlanishi kutilmoqda');
      } else {
        wallError.textContent = ack.error?.message || 'Yuborib bo‘lmadi';
      }
    } catch (err) {
      wallError.textContent = err.message || 'Yuborib bo‘lmadi';
    } finally {
      wallSubmit.disabled = false;
    }
  });
  wallText.addEventListener('keydown', (e) => { if (e.key === 'Enter') wallSubmit.click(); });

  $('part-submit').addEventListener('click', async () => {
    if (selectedIds.size === 0 || !currentQuestion) return;
    setState(STATE.SENDING);
    $('part-submit').disabled = true;
    try {
      const submittedIds = [...selectedIds];
      lastSubmittedIds = submittedIds; // C3-03: showPreviousOnRevote uchun
      let ack;
      // C3-11 POE prediction / mcq-explanation — leaderboard'ga kirmaydi
      if (poePhase === 'PREDICTION') {
        ack = await client.sendCommand('cast:poeSubmitPrediction', {
          selectedOptionIds: submittedIds,
          confidence: confidenceLevel,
        });
        if (ack.ok) {
          setState(STATE.SAVED);
          $('part-submit').disabled = true;
          $('part-options').querySelectorAll('.cast-option').forEach((el) => { el.disabled = true; });
          announce('✅ Bashorat saqlandi');
        }
      } else if (poePhase === 'EXPLANATION' && poeExpMode === 'mcq') {
        ack = await client.sendCommand('cast:poeSubmitExplanation', {
          selectedOptionIds: submittedIds,
          mode: 'mcq',
        });
        if (ack.ok) {
          setState(STATE.SAVED);
          $('part-submit').disabled = true;
          $('part-options').querySelectorAll('.cast-option').forEach((el) => { el.disabled = true; });
          announce('✅ Tushuntirish saqlandi');
        }
      } else if (transferActive) {
        // C3-08: transfer/redemption — leaderboard ta'siri yo'q, alohida yoziladi
        ack = await client.sendCommand('cast:transferSubmit', {
          followUpQuestionId: transferQuestionId || currentQuestion.questionId || currentQuestion.id,
          sourceQuestionId: transferSource,
          flowType: transferFlowType,
          selectedOptionIds: submittedIds,
        });
        if (ack.ok && ack.status === 'ACCEPTED') {
          setState(STATE.SAVED);
          $('part-submit').disabled = true;
          $('part-options').querySelectorAll('.cast-option').forEach((el) => { el.disabled = true; });
          announce('✅ ' + (transferFlowType === 'REDEMPTION' ? 'Redemption' : 'Transfer') + ' saqlandi');
        }
      } else {
        // C4-02 (item 8): network sample — answer bilan ALOHIDA telemetry (wrong answer EMAS)
        const netSample = sampleNetwork();
        ack = await client.sendCommand('cast:answerSubmit', {
          questionId: currentQuestion.questionId || currentQuestion.id,
          selectedOptionIds: submittedIds,
          attemptNo: currentVoteRound || 1,
          confidence: confidenceLevel, // C3-04 (grade'ga ta'sir qilmaydi)
          netLatencyMs: netSample.latencyMs,
          netLossPercent: netSample.lossPercent,
          netSampleCount: netSample.sampleCount,
        });
        if (ack.status === 'ACCEPTED' || ack.status === 'REPLAYED_ACK') {
          setState(STATE.SAVED);
          $('part-submit').disabled = true;
          $('part-options').querySelectorAll('.cast-option').forEach((el) => { el.disabled = true; });
          // C3-07: Reasoning capture (answer saved'dan keyin)
          if (currentQuestion) {
            showReasoning(currentQuestion.questionId || currentQuestion.id);
          }
          // C3-16: self-paced — keyingi savolni serverdan so'raymiz
          if (ack.selfPaced && ack.selfPaced.nextQuestionId) {
            if (ack.selfPaced.finished) {
              spCursor = { ...(spCursor || {}), status: 'finished', progress: 1, answeredCount: spCursor ? spCursor.answeredCount + 1 : 1 };
              renderSpProgress();
              $('part-reveal-emoji').textContent = '🏁';
              $('part-reveal-title').textContent = 'Poyga tugadi!';
              show('part-reveal');
            } else {
              spCursor = { ...(spCursor || {}), currentQuestionId: ack.selfPaced.nextQuestionId, progress: ack.selfPaced.progress, answeredCount: (spCursor ? spCursor.answeredCount : 0) + 1 };
              renderSpProgress();
              await spSync();
            }
          }
        }
      }
    } catch (err) {
      if (err.code === 'ALREADY_ANSWERED') {
        setState(STATE.SAVED);
        $('part-submit').disabled = true;
      } else if (err.code === 'REJECTED_LATE' || err.code === 'REJECTED_QUESTION_CLOSED') {
        setState(STATE.LOCKED);
        $('part-submit').disabled = true;
      } else {
        setState(STATE.RETRYING);
        // Auto retry same commandId
        setTimeout(() => $('part-submit').click(), 1500);
      }
    } finally {
      setTimeout(() => { $('part-submit').disabled = false; }, 300);
    }
  });

  // ── Events ──
  let currentVoteRound = 1; // C3-03: 1 = first, 2 = revote
  let lastSubmittedIds = null; // C3-03: showPreviousOnRevote uchun
  let confidenceLevel = null; // C3-04: low | medium | high
  let transferActive = false; // C3-08: transfer/redemption flow
  let transferSource = null;
  let transferFlowType = 'TRANSFER';
  let transferQuestionId = null;
  // C3-16 Self-Paced Race
  let spCursor = null;      // own cursor (projectCursor shaklida)
  let spRank = null;        // { rank, total } — private
  let spPaused = false;
  let spSyncInterval = null;
  // C3-17 Power-ups
  let powerUpInv = null;    // { enabled, allowed, counts }
  let powerUpPending = false;
  // C4-01 Team Challenge
  let myTeam = null;        // { teamId, teamName, memberCount, isReporter }
  let teamTalkTimer = null;
  // C4-02 Hybrid / low-bandwidth
  let netProfile = null;    // { delivery, fingerprint, lowBandwidth, networkTelemetry }
  let netSamples = [];      // { t, latencyMs } — so'nggi ping'lar
  let netMonitorTimer = null;

  // C4-02: join ack'dan network profile + low-bandwidth mode (item 10/11)
  function applyNetworkProfile(delivery, network) {
    netProfile = {
      delivery: delivery || 'in_room',
      fingerprint: network?.fingerprint || null,
      lowBandwidth: network?.lowBandwidth || null,
      networkTelemetry: network?.networkTelemetry !== false,
    };
    const lbw = netProfile.lowBandwidth || {};
    if (lbw.enabled && lbw.decorativeEventsOff) {
      // Decorative animatsiyalar disable (item 11) — same info, animation'siz
      document.documentElement.classList.add('cast-lbw');
    }
    startNetworkMonitor();
    renderNetworkStatus();
  }

  // C4-02: navigator.onLine + periyodik ping monitoring (item 12/13)
  function startNetworkMonitor() {
    stopNetworkMonitor();
    const update = () => {
      renderNetworkStatus();
      if (navigator.onLine && client && client.socket && client.socket.connected) {
        // Ping latency (lightweight — answer payload'ga qo'shiladi; server telemetry'ni
        // shu orqali yozadi — answer bermagan remote participant ham bucket'lanadi)
        const started = Date.now();
        try {
          const pingSample = sampleNetwork();
          client.socket.emit('cast:ping', {
            netLatencyMs: pingSample.latencyMs,
            netLossPercent: pingSample.lossPercent,
            netSampleCount: pingSample.sampleCount,
          }, () => {
            const latency = Date.now() - started;
            netSamples.push({ t: Date.now(), latencyMs: latency });
            if (netSamples.length > 5) netSamples.shift();
          });
        } catch (_) { /* noop */ }
      }
    };
    update();
    netMonitorTimer = setInterval(update, 15000);
    window.addEventListener('online', renderNetworkStatus);
    window.addEventListener('offline', renderNetworkStatus);
  }

  function stopNetworkMonitor() {
    if (netMonitorTimer) { clearInterval(netMonitorTimer); netMonitorTimer = null; }
  }

  // C4-02: sampleNetwork() — so'nggi 5 ping'dan bucket'ga o'tkaziladigan ma'lumot
  function sampleNetwork() {
    const recent = netSamples.filter((s) => Date.now() - s.t < 45000);
    const sampleCount = recent.length;
    let latencyMs = 0;
    if (sampleCount > 0) {
      latencyMs = Math.round(recent.reduce((a, b) => a + b.latencyMs, 0) / sampleCount);
    }
    let lossPercent = 0;
    if (sampleCount >= 2) {
      // Packet loss proxy: timeout bo'lmagan ack'larning ulushi — client quyida
      // o'lchay olmaydi; server bucket'da 0 bo'lsa faqat latency ishlatiladi.
      lossPercent = 0;
    }
    return { latencyMs, lossPercent, sampleCount };
  }

  // C4-02: network status banner (item 6 — text status)
  function renderNetworkStatus() {
    const el = $('part-net');
    if (!el || !netProfile) return;
    const dot = $('part-net-dot');
    const text = $('part-net-text');
    if (!navigator.onLine) {
      el.hidden = false;
      dot.className = 'part-net-dot part-net-bad';
      text.textContent = 'Oflayn — javoblar saqlanib qayta yuboriladi';
      return;
    }
    const online = client && client.socket && client.socket.connected;
    if (!online) {
      el.hidden = false;
      dot.className = 'part-net-dot part-net-bad';
      text.textContent = 'Server bilan aloqa yo‘qolgan — qayta ulanmoqda…';
      return;
    }
    const lbw = netProfile.lowBandwidth;
    if (lbw && lbw.enabled) {
      el.hidden = false;
      dot.className = 'part-net-dot part-net-low';
      text.textContent = 'Past tezlik rejimi — media kamaytirilgan';
      return;
    }
    el.hidden = true;
  }



  // C4-01: own team badge + talk phase + reporter reminder
  function renderTeamBadge() {
    const el = $('part-team');
    if (!el || !myTeam) { if (el) el.hidden = true; return; }
    el.hidden = false;
    $('part-team-badge').textContent = `👥 ${myTeam.teamName || myTeam.teamId}`;
    $('part-team-meta').textContent = `${myTeam.activeMemberCount ?? myTeam.memberCount} a'zo`;
    const rep = $('part-team-reporter');
    rep.hidden = !myTeam.isReporter;
  }

  function startTeamTalkTimer(data) {
    stopTeamTalkTimer();
    const endsAt = data && data.endsAt ? data.endsAt : Date.now() + ((data && data.seconds) || 60) * 1000;
    const update = () => {
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      const el = $('part-team-talk-timer');
      if (el) el.textContent = `${left}s`;
      if (left <= 0) stopTeamTalkTimer();
    };
    update();
    teamTalkTimer = setInterval(update, 1000);
  }

  function stopTeamTalkTimer() {
    if (teamTalkTimer) { clearInterval(teamTalkTimer); teamTalkTimer = null; }
  }

  // Power-up inventory UI (item 12: reduced-motion'da animation'siz same info)
  function renderPowerUps() {
    const el = $('part-powerups');
    if (!el) return;
    if (!powerUpInv || !powerUpInv.enabled) { el.hidden = true; return; }
    el.hidden = false;
    const row = $('part-powerups-row');
    row.innerHTML = '';
    const labels = {
      hint: '💡 Maslahat',
      extra_time: '⏱ Qo‘shimcha vaqt',
      team_consult: '🤝 Jamoa maslahati',
      private_redemption: '🔁 Qayta urinish',
    };
    const desc = {
      hint: 'To‘g‘ri javobga yaqin maslahat',
      extra_time: 'Shaxsiy vaqtni uzaytiradi',
      team_consult: 'Jamoadoshingizdan so‘rash',
      private_redemption: 'Shaxsiy qayta urinish',
    };
    (powerUpInv.allowed || []).forEach((t) => {
      const count = (powerUpInv.counts && powerUpInv.counts[t]) || 0;
      if (count <= 0) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cast-btn powerup-btn';
      btn.dataset.type = t;
      btn.title = desc[t] || t;
      btn.textContent = `${labels[t] || t} ×${count}`;
      btn.disabled = powerUpPending;
      btn.addEventListener('click', () => activatePowerUp(t, btn));
      row.appendChild(btn);
    });
  }

  async function activatePowerUp(type, btn) {
    if (!client || !sessionId || powerUpPending) return;
    powerUpPending = true;
    if (btn) btn.disabled = true;
    const msg = $('part-powerups-msg');
    try {
      const qid = (currentQuestion && (currentQuestion.questionId || currentQuestion.id)) || null;
      const ack = await client.sendCommand('cast:powerupActivate', { type, questionId: qid }, { ackTimeout: 6000 });
      if (ack.ok) {
        powerUpInv = { ...powerUpInv, counts: ack.inventory && ack.inventory.counts ? ack.inventory.counts : powerUpInv.counts };
        if (ack.activated) {
          msg.textContent = effectMessage(type, ack.effect);
          announce('⚡ ' + effectMessage(type, ack.effect));
        } else if (ack.replay) {
          msg.textContent = 'Bu power-up allaqachon ishlatilgan';
        }
        renderPowerUps();
      } else {
        msg.textContent = ack.error?.message || 'Ishlatib bo‘lmadi';
      }
    } catch (err) {
      msg.textContent = err.message || 'Ishlatib bo‘lmadi';
    } finally {
      powerUpPending = false;
      renderPowerUps();
    }
  }

  function effectMessage(type, effect) {
    if (effect && effect.kind === 'no_personal_timer') {
      return '⏱ Qo‘shimcha vaqt faqat shaxsiy vaqt rejimida ishlaydi';
    }
    const map = {
      hint: '💡 Maslahat ko‘rsatildi',
      extra_time: '⏱ Vaqt uzaytirildi',
      team_consult: '🤝 Jamoa maslahati ishlatildi',
      private_redemption: '🔁 Qayta urinish tayyor',
    };
    return map[type] || 'Power-up ishlatildi';
  }

  function renderSpProgress() {
    const el = $('part-sp');
    if (!el) return;
    if (!spCursor) { el.hidden = true; return; }
    el.hidden = false;
    const pct = Math.round((spCursor.progress || 0) * 100);
    $('part-sp-fill').style.width = pct + '%';
    const done = spCursor.answeredCount || 0;
    $('part-sp-progress').textContent = `${done}/${spCursor.totalQuestions} javob · ${pct}%`;
    const rankEl = $('part-sp-rank');
    if (spRank && spRank.rank) {
      rankEl.textContent = `#${spRank.rank} / ${spRank.total}`;
    } else {
      rankEl.textContent = '';
    }
    const pausedEl = $('part-sp-paused');
    if (pausedEl) pausedEl.hidden = !spPaused;
    // Timer self-paced cursor uchun (per-question expiry)
    if (spCursor.questionExpiresAt) {
      closesAt = spCursor.questionExpiresAt;
      startTimer();
    }
  }

  // Self-paced sync: cursor + rank (reconnect / vaqt tekshiruvi)
  async function spSync() {
    if (!client || !sessionId || !spCursor) return;
    try {
      const ack = await client.sendCommand('cast:spSync', {}, { ackTimeout: 6000 });
      if (ack && ack.ok) {
        if (!ack.active) { spCursor = null; renderSpProgress(); return; }
        spCursor = ack.cursor || spCursor;
        spPaused = !!ack.paused;
        if (ack.rank && ack.rank.rank) spRank = ack.rank;
        if (ack.question && ack.question.questionId !== (currentQuestion && (currentQuestion.questionId || currentQuestion.id))) {
          currentVoteRound = 1;
          renderQuestion(ack.question, 'QUESTION_OPEN');
        }
        renderSpProgress();
      }
    } catch (_) { /* non-critical */ }
  }

  function handleEvent(eventName, data) {
    switch (eventName) {
      case 'cast:questionPreview': {
        hidePodium();
        // C4-08 staging: 3-sekund qoidasi — avval faqat savol + ko'rinadigan countdown,
        // keyin (questionOpened'da) variantlar ochiladi
        const think = Math.max(0, Math.round(Number(data.thinkSeconds) || 0));
        const q = data.question || null;
        if (q && think > 0) {
          currentVoteRound = 1;
          currentQuestion = q;
          selectedIds = new Set();
          stopTimer();
          show('part-question');
          $('part-q-meta').textContent = 'Savol';
          $('part-q-text').textContent = q.text;
          const wrap = $('part-options');
          if (wrap) { wrap.innerHTML = ''; wrap.hidden = true; }
          const sub = $('part-submit'); if (sub) sub.hidden = true;
          const conf = $('part-confidence'); if (conf) conf.hidden = true;
          startStageCountdown(think);
        }
        setState(STATE.THINKING);
        renderState();
        break;
      }
      case 'cast:questionOpened':
        currentVoteRound = 1;
        hidePodium();
        if (data.question) renderQuestion(data.question, 'QUESTION_OPEN');
        break;
      case 'cast:quickPromptLive':
        currentVoteRound = 1;
        hidePodium();
        if (data.question) renderQuestion(data.question, 'QUESTION_OPEN');
        break;
      case 'cast:transferOpened':
        // C3-08: transfer/redemption follow-up savol — normal question flow
        currentVoteRound = 1;
        transferActive = true;
        transferSource = data.sourceQuestionId || null;
        transferFlowType = data.flowType || 'TRANSFER';
        transferQuestionId = data.question?.id || null;
        if (data.question) renderQuestion(data.question, 'QUESTION_OPEN');
        break;
      case 'cast:discussionStarted': {
        currentVoteRound = 1;
        hidePodium();
        stopTimer();
        show('part-question');
        const instr = data.instructions ? `<br>💬 ${escapeHtml(data.instructions)}` : '';
        $('part-q-meta').textContent = 'Muhokama';
        $('part-q-text').innerHTML = `Qo‘shningiz bilan muhokama qiling${instr}`;
        $('part-options').innerHTML = '';
        $('part-submit').hidden = true;
        setState(STATE.THINKING);
        break;
      }
      case 'cast:revoteOpened': {
        currentVoteRound = 2;
        hidePodium();
        // showPreviousOnRevote=true → oldingi tanlovni belgilab ko'rsatish
        if (data.question) renderQuestion(data.question, 'REVOTE_OPEN', data.showPrevious !== false ? lastSubmittedIds : null);
        else {
          show('part-question');
          $('part-q-meta').textContent = 'Qayta ovoz berish';
          setState(STATE.OPEN);
          renderState();
        }
        break;
      }
      case 'cast:questionPaused':
        stopTimer();
        setState(STATE.PAUSED);
        break;
      case 'cast:questionResumed':
        closesAt = data.payload?.closesAt;
        startTimer();
        setState(selectedIds.size > 0 ? STATE.SELECTED : STATE.OPEN);
        break;
      case 'cast:timeAdded':
        closesAt = data.payload?.closesAt;
        startTimer();
        announce(`+${data.payload?.seconds || ''} soniya qo‘shildi`);
        break;
      case 'cast:questionClosed':
      case 'cast:questionLocked':
      case 'cast:revoteClosed':
        stopTimer();
        setState(STATE.LOCKED);
        if (reasoningEl) reasoningEl.hidden = true;
        transferActive = false; // C3-08: transfer flow yakunlandi
        break;
      case 'cast:podiumShow': {
        // C4-09: savol yakunidan 3s o'tib — shaxsiy o'rin overlay.
        // Participant'ga shaxsiy payload keladi (data.personal); public broadcast
        // (personal'siz) participant'da e'tiborsiz qoldiriladi — projector/director uchun.
        if (!data || !data.personal) break;
        hidePodium();
        const ov = $('part-podium');
        if (!ov) break;
        const pers = data.personal || podiumPersonal;
        $('part-podium-num').textContent = pers && typeof pers.rank === 'number' ? String(pers.rank) : '—';
        const word = $('part-podium-word');
        if (word) word.textContent = t('podium.place');
        const mine = $('part-podium-mine');
        if (mine) mine.textContent = pers ? String(displayAlias || t('podium.you')) : '';
        const scoreEl = $('part-podium-score');
        if (pers && typeof pers.score === 'number') {
          scoreEl.hidden = false;
          scoreEl.textContent = t('podium.score', { s: pers.score });
        } else if (scoreEl) scoreEl.hidden = true;
        ov.hidden = false;
        const hold = Math.max(0, Number(data.autoHoldMs) || 0);
        if (hold > 0) {
          podiumHideTimer = setTimeout(() => {
            const e2 = $('part-podium');
            if (e2) e2.hidden = true;
            podiumHideTimer = null;
          }, hold);
        }
        announce(t('podium.title'), false);
        break;
      }
      case 'cast:questionRevealed':
        stopTimer();
        hidePodium();
        show('part-reveal');
        const correct = new Set(data.correctOptionIds || []);
        const wasCorrect = currentQuestion && [...selectedIds].every((id) => correct.has(id)) && selectedIds.size === correct.size;
        // S31.10: semantic green/red + icon + text (giant emoji sole feedback emas)
        const revealBox = $('part-reveal');
        revealBox.classList.remove('part-reveal--correct', 'part-reveal--wrong');
        revealBox.classList.add(wasCorrect ? 'part-reveal--correct' : 'part-reveal--wrong');
        $('part-reveal-emoji').textContent = wasCorrect ? '✅' : '❌';
        $('part-reveal-title').textContent = wasCorrect ? 'To‘g‘ri!' : 'Javob ko‘rsatildi';
        let verdictEl = $('part-reveal-verdict');
        if (!verdictEl) {
          verdictEl = document.createElement('div');
          verdictEl.className = 'part-reveal-verdict';
          verdictEl.id = 'part-reveal-verdict';
          revealBox.insertBefore(verdictEl, revealBox.querySelector('h2'));
        }
        verdictEl.textContent = wasCorrect ? '✓ To‘g‘ri javob' : '✗ Noto‘g‘ri';
        $('part-reveal-explanation').textContent = data.explanation || '';
        $('part-continue').hidden = false;
        setState(STATE.REVEAL);
        break;
      case 'cast:goalProgress': {
        // Aggregate goal — participant'ga ham ko'rsatiladi (shaxsiy ayb emas)
        const el = $('part-goal');
        if (el && data.progress && data.progress.type) {
          el.hidden = false;
          $('part-goal-fill').style.width = Math.min(100, data.progress.percent) + '%';
          $('part-goal-meta').textContent =
            `Sinf: ${data.progress.current} / ${data.progress.target} (${data.progress.percent}%)`;
        }
        break;
      }
      case 'cast:goalComplete': {
        const el = $('part-goal-complete');
        if (el) {
          el.hidden = false;
          el.classList.remove('celebrate');
          void el.offsetWidth;
          el.classList.add('celebrate');
        }
        break;
      }
      case 'cast:personalBest': {
        // Participant-private personal best (opt-in bo'lmasa public yo'q)
        const el = $('part-personal-best');
        if (el && data.available) {
          el.hidden = false;
          $('part-pb-text').textContent =
            `Shaxsiy: ${data.correct}/${data.total} to‘g‘ri (${data.accuracyPercent}%)`;
        }
        break;
      }
      case 'cast:leaderboardUpdated': {
        // STYLE S32: personal projection — participant-private (o'zi + neighbor'lar)
        if (data.mode !== 'personal') break;
        podiumPersonal = data.personal || null;
        const wrap = $('part-leaderboard');
        const body = $('part-leaderboard-body');
        const badge = $('part-leaderboard-badge');
        if (!wrap || !body) break;
        wrap.hidden = false;
        window.CastLeaderboard.renderPersonal(body, data.personal, {
          emptyMessage: 'Hozircha ball yo‘q — keyingi savolda qatnashing',
        });
        if (badge && data.personal && data.totalParticipants > 1) {
          badge.hidden = false;
          const pct = Math.max(1, Math.round(((data.totalParticipants - data.personal.rank + 1) / data.totalParticipants) * 100));
          badge.textContent = `Yuqori ${pct}%`;
        }
        break;
      }
      case 'cast:confusionAggregate': {
        // C3-10: o'z signali acknowledge bo'lsa banner ko'rsatiladi (identity yashirin)
        if (confusionAckEl && lastSentSignal && data.acknowledged && data.acknowledged[lastSentSignal]) {
          confusionAckEl.hidden = false;
          lastSentSignal = null;
        }
        break;
      }
      case 'cast:wallPublic': {
        // C3-10: approved wall — identity yo'q, faqat tasdiqlangan matn
        if (!wallList) break;
        wallList.innerHTML = '';
        if (data.frozen) {
          const p = document.createElement('div');
          p.className = 'part-wall-frozen';
          p.textContent = '🔒 Moderator oflayn — devor vaqtincha to‘xtatildi';
          wallList.appendChild(p);
        }
        (data.items || []).slice(0, 8).forEach((item) => {
          const row = document.createElement('div');
          row.className = 'part-wall-item';
          row.textContent = item.text;
          wallList.appendChild(row);
        });
        break;
      }
      case 'cast:poePredictionOpened': {
        poePhase = 'PREDICTION';
        currentVoteRound = 1;
        if (data.question) renderQuestion(data.question, 'PREDICTION_OPEN');
        $('part-q-meta').textContent = '🔮 Bashorat';
        const confEl = $('part-confidence');
        if (confEl) confEl.hidden = false;
        break;
      }
      case 'cast:poeObservationStarted': {
        poePhase = 'OBSERVATION';
        stopTimer();
        show('part-poe-obs');
        renderPoeMedia(data.media);
        const btn = $('part-poe-ready');
        btn.disabled = false;
        btn.textContent = '✅ Ko‘rdim';
        $('part-poe-obs-status').textContent = '';
        break;
      }
      case 'cast:poeExplanationOpened': {
        poePhase = 'EXPLANATION';
        poeExpMode = data.mode || 'mcq';
        currentVoteRound = 1;
        if (data.mode === 'short_answer') {
          show('part-poe-exp');
          $('part-poe-exp-q').textContent = data.question?.text || 'Nima uchun shunday bo‘ldi?';
          $('part-poe-exp-text').value = '';
          $('part-poe-exp-text').disabled = false;
          $('part-poe-exp-submit').textContent = 'Yuborish';
          $('part-poe-exp-submit').disabled = false;
          $('part-poe-exp-error').textContent = '';
        } else if (data.question) {
          show('part-question');
          renderQuestion(data.question, 'EXPLANATION_OPEN');
          $('part-q-meta').textContent = '💭 Tushuntirish';
        }
        break;
      }
      case 'cast:poeExplanationClosed': {
        stopTimer();
        if (poePhase !== 'DONE') {
          poePhase = 'DONE';
          show('part-waiting');
        }
        break;
      }
      case 'cast:poeAnalysisPublic': {
        renderPoePublic(data);
        break;
      }
      // C3-12 Open-Response Semantic Board
      case 'cast:orbOpened': {
        stopTimer();
        orbPhase = 'COLLECT';
        show('part-orb');
        $('part-orb-q').textContent = data.prompt || 'Fikringizni yozing';
        $('part-orb-text').value = '';
        $('part-orb-text').disabled = false;
        $('part-orb-submit').disabled = false;
        $('part-orb-submit').textContent = 'Yuborish';
        $('part-orb-error').textContent = '';
        $('part-orb-chars').textContent = '0 / 280';
        break;
      }
      case 'cast:orbClosed':
      case 'cast:orbEnded': {
        orbPhase = null;
        show('part-waiting');
        break;
      }
      // C3-17 Power-ups
      case 'cast:powerupGranted': {
        if (data.inventory) {
          powerUpInv = data.inventory;
          renderPowerUps();
          announce('⚡ Power-up qo‘shildi');
        }
        break;
      }
      case 'cast:powerupActivated': {
        if (data.allowed && powerUpInv) {
          powerUpInv = { ...powerUpInv, enabled: true, allowed: data.allowed };
          renderPowerUps();
        }
        break;
      }
      // C4-01 Team Challenge
      case 'cast:teamAssigned': {
        // Rejoin'dan keyin yoki director qayta assign qilganda
        if (data && data.team && myTeam && data.team.teamId) {
          myTeam = { ...myTeam, ...data.team };
          renderTeamBadge();
        }
        break;
      }
      case 'cast:teamTalkStarted': {
        const t = $('part-team-talk');
        if (t) t.hidden = false;
        startTeamTalkTimer(data);
        break;
      }
      case 'cast:teamTalkEnded': {
        const t = $('part-team-talk');
        if (t) t.hidden = true;
        stopTeamTalkTimer();
        break;
      }
      case 'cast:teamReporterRotated': {
        if (myTeam && data && data.teamId === myTeam.teamId) {
          myTeam.isReporter = data.reporterId === myParticipantId;
          renderTeamBadge();
          if (myTeam.isReporter) announce('🎙 Siz jamoa hisobotchisisiz');
        }
        break;
      }
      // C3-16 Self-Paced Race
      case 'cast:spActivated': {
        // Race boshlandi — cursor'ni so'raymiz
        spSync();
        break;
      }
      case 'cast:spCursor': {
        spCursor = data.cursor || spCursor;
        spPaused = false;
        if (data.question) {
          currentVoteRound = 1;
          renderQuestion(data.question, 'QUESTION_OPEN');
        }
        renderSpProgress();
        if (!spSyncInterval) {
          spSyncInterval = setInterval(spSync, 20000); // cursor expiry check
        }
        break;
      }
      case 'cast:spPaused': {
        spPaused = true;
        stopTimer();
        renderSpProgress();
        setState(STATE.PAUSED);
        break;
      }
      case 'cast:spResumed': {
        spPaused = false;
        renderSpProgress();
        setState(selectedIds.size > 0 ? STATE.SELECTED : STATE.OPEN);
        break;
      }
      case 'cast:sessionEnded':
        stopTimer();
        hidePodium(true);
        if (spSyncInterval) { clearInterval(spSyncInterval); spSyncInterval = null; }
        show('part-reveal');
        $('part-reveal-emoji').textContent = '🏁';
        $('part-reveal-title').textContent = 'Sessiya tugadi';
        $('part-reveal-explanation').textContent = 'Rahmat!';
        $('part-continue').hidden = true;
        setState(STATE.ENDED);
        break;
    }
  }

  // ── C3-11 POE ──
  function renderPoeMedia(media) {
    const wrap = $('part-poe-media');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!media) { wrap.textContent = '—'; return; }
    if (media.type === 'image') {
      const img = document.createElement('img');
      img.src = media.url;
      img.alt = media.caption || 'Kuzatuv';
      // C5-05 (item 4): theme thumbnail/media lazy load + (item 18) dimensions → layout shift ↓
      img.loading = 'lazy';
      img.decoding = 'async';
      if (media.width && media.height) {
        img.width = Number(media.width);
        img.height = Number(media.height);
      }
      img.className = 'part-poe-img';
      wrap.appendChild(img);
    } else if (media.type === 'animation' || media.type === 'video') {
      const el = document.createElement(media.type === 'video' ? 'video' : 'img');
      el.src = media.url;
      // C4-04 (item 22): video alt/caption/transcript
      el.alt = media.caption || (media.type === 'video' ? 'Video kuzatuv' : 'Animatsiya');
      if (media.type === 'video') {
        // C5-05 (item 19): autoplay timer startga bog'lanmaydi — muted+playsinline
        // autoplay brauzer tomonidan mustaqil boshqariladi; avval eski videolar to'xtaydi
        el.controls = true; el.muted = true; el.playsInline = true; el.autoplay = true;
        el.preload = 'metadata';
        document.querySelectorAll('video').forEach((v) => { if (v !== el) { try { v.pause(); } catch (_) {} } });
      }
      if (media.width && media.height) {
        el.width = Number(media.width);
        el.height = Number(media.height);
      }
      el.className = 'part-poe-img';
      wrap.appendChild(el);
    } else {
      const box = document.createElement('div');
      box.className = 'part-poe-text';
      box.textContent = media.text || '';
      wrap.appendChild(box);
    }
    if (media.caption) {
      const cap = document.createElement('div');
      cap.className = 'part-poe-caption';
      cap.textContent = media.caption;
      wrap.appendChild(cap);
    }
    // C4-04 (item 22): transcript — audio/video uchun vizual matn (projector audio visual text, item 12)
    if (media.transcript && (media.type === 'audio' || media.type === 'video' || media.type === 'animation')) {
      const tr = document.createElement('details');
      tr.className = 'part-poe-transcript';
      tr.innerHTML = '<summary>Transkript</summary>';
      const body = document.createElement('div');
      body.textContent = media.transcript;
      tr.appendChild(body);
      wrap.appendChild(tr);
    } else if (media.type === 'audio' && !media.transcript) {
      // C4-04 (item 12): audio instruction — visual text fallback
      const vis = document.createElement('div');
      vis.className = 'part-poe-audio-text';
      vis.textContent = media.caption || 'Audio yo‘riqnoma — transkript mavjud emas';
      wrap.appendChild(vis);
    }
  }

  $('part-poe-ready').addEventListener('click', async () => {
    if (!client || !sessionId) return;
    const btn = $('part-poe-ready');
    btn.disabled = true;
    try {
      const ack = await client.sendCommand('cast:poeMediaReady', {}, { ackTimeout: 6000 });
      if (ack.ok) {
        $('part-poe-obs-status').textContent = '✅ Qayd etildi — o‘qituvchi tushuntirishni ochishini kuting';
        btn.textContent = '✅ Tayyor';
      } else {
        $('part-poe-obs-status').textContent = ack.error?.message || '';
        btn.disabled = false;
      }
    } catch (_) { btn.disabled = false; }
  });

  $('part-poe-exp-submit').addEventListener('click', async () => {
    if (!client || !sessionId) return;
    const text = $('part-poe-exp-text').value.trim();
    if (!text) { $('part-poe-exp-error').textContent = 'Matn kiriting'; return; }
    const btn = $('part-poe-exp-submit');
    btn.disabled = true;
    try {
      const ack = await client.sendCommand('cast:poeSubmitExplanation', { text, mode: 'short_answer' }, { ackTimeout: 6000 });
      if (ack.ok) {
        $('part-poe-exp-text').disabled = true;
        btn.textContent = '✓ Yuborildi';
        $('part-poe-exp-error').textContent = '';
      } else {
        $('part-poe-exp-error').textContent = ack.error?.message || 'Xatolik';
        btn.disabled = false;
      }
    } catch (e) {
      $('part-poe-exp-error').textContent = e.message || 'Xatolik';
      btn.disabled = false;
    }
  });

  function renderPoePublic(data) {
    poePhase = 'DONE';
    show('part-poe-analysis');
    const agg = $('part-poe-aggregate');
    const pattern = data.aggregatePattern || {};
    agg.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'part-poe-agg-line';
    line.textContent = `Ishtirokchilar: ${pattern.participants || 0} — o‘zgargan: ${pattern.changed || 0} (${pattern.changeRate || 0}%)`;
    agg.appendChild(line);
    (pattern.topTransitions || []).slice(0, 3).forEach((t) => {
      const row = document.createElement('div');
      row.className = 'part-poe-agg-row';
      row.textContent = `${t.transition} — ${t.count}`;
      agg.appendChild(row);
    });
    const exWrap = $('part-poe-exemplars');
    exWrap.innerHTML = '';
    (data.exemplars || []).slice(0, 3).forEach((ex) => {
      const row = document.createElement('div');
      row.className = 'part-wall-item';
      row.textContent = ex.text;
      exWrap.appendChild(row);
    });
    $('part-poe-continue').hidden = false;
  }

  $('part-poe-continue').addEventListener('click', () => {
    poePhase = null;
    show('part-waiting');
    setState(STATE.WAITING);
  });

  // ── C3-12 ORB submit ──
  let orbPhase = null; // null | COLLECT

  $('part-orb-text').addEventListener('input', () => {
    const len = $('part-orb-text').value.length;
    $('part-orb-chars').textContent = `${len} / 280`;
  });

  $('part-orb-submit').addEventListener('click', async () => {
    if (!client || !sessionId || orbPhase !== 'COLLECT') return;
    const text = $('part-orb-text').value.trim();
    if (!text) { $('part-orb-error').textContent = 'Matn kiriting'; return; }
    const btn = $('part-orb-submit');
    btn.disabled = true;
    try {
      const ack = await client.sendCommand('cast:orbSubmit', { text }, { ackTimeout: 6000 });
      if (ack.ok) {
        $('part-orb-text').disabled = true;
        btn.textContent = '✓ Yuborildi';
        $('part-orb-error').textContent = ack.safeHold ? '⚠ Xabar saqlandi, ammo maxfiy ma’lumot tufayli jamlanmaga kirmaydi' : '';
      } else {
        $('part-orb-error').textContent = ack.error?.message || 'Xatolik';
        btn.disabled = false;
      }
    } catch (e) {
      $('part-orb-error').textContent = e.message || 'Xatolik';
      btn.disabled = false;
    }
  });

  // ── C3-11 POE reconnect recovery (join/rejoin — har fazada) ──
  function recoverPoe(state) {
    const p = state && state.poe;
    if (!p || !p.phase) return false;
    if (p.phase === 'PREDICTION' && currentQuestion) {
      poePhase = 'PREDICTION';
      currentVoteRound = 1;
      renderQuestion(currentQuestion, 'PREDICTION_OPEN');
      $('part-q-meta').textContent = '🔮 Bashorat';
      const confEl = $('part-confidence');
      if (confEl) confEl.hidden = false;
      return true;
    }
    if (p.phase === 'OBSERVATION') {
      poePhase = 'OBSERVATION';
      stopTimer();
      show('part-poe-obs');
      // Media fail bo'lgan bo'lsa — host fallback matnini ko'rsatamiz (live path bilan bir xil)
      renderPoeMedia(p.mediaFailed && p.mediaFallbackText ? { type: 'live_note', text: p.mediaFallbackText } : p.media);
      const btn = $('part-poe-ready');
      btn.disabled = false;
      btn.textContent = '✅ Ko‘rdim';
      $('part-poe-obs-status').textContent = '';
      return true;
    }
    if (p.phase === 'EXPLANATION') {
      poePhase = 'EXPLANATION';
      currentVoteRound = 1;
      const isShort = currentQuestion && currentQuestion.type === 'short_answer';
      poeExpMode = isShort ? 'short_answer' : 'mcq';
      if (isShort) {
        show('part-poe-exp');
        $('part-poe-exp-q').textContent = currentQuestion.text || 'Nima uchun shunday bo‘ldi?';
        $('part-poe-exp-text').value = '';
        $('part-poe-exp-text').disabled = false;
        $('part-poe-exp-submit').textContent = 'Yuborish';
        $('part-poe-exp-submit').disabled = false;
        $('part-poe-exp-error').textContent = '';
      } else if (currentQuestion) {
        show('part-question');
        renderQuestion(currentQuestion, 'EXPLANATION_OPEN');
        $('part-q-meta').textContent = '💭 Tushuntirish';
      } else {
        show('part-waiting');
      }
      return true;
    }
    if (p.phase === 'ANALYSIS' || p.phase === 'DONE') {
      poePhase = 'DONE';
      show('part-waiting');
      return true;
    }
    return false;
  }

  // S31.01: join stepper progress — qadam ko'rsatkichi (is-done / is-current)
  function setJoinStep(step, done) {
    const steps = document.querySelectorAll('.join-step');
    steps.forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle('is-done', done && n <= step);
      el.classList.toggle('is-current', !done && n === step);
    });
  }

  // S31.11: network status — calm persistent text
  function updateNet(state, text) {
    const el = $('part-net');
    if (!el) return;
    el.dataset.net = state;
    const txt = $('part-net-text');
    if (txt) txt.textContent = text || (state === 'online' ? 'Ulangan' : state === 'offline' ? 'Uzildi — qayta ulanmoqda' : state === 'reconnecting' ? 'Qayta ulanmoqda…' : 'Ulanish…');
  }

  // S31.08: player badge
  function updateBadge(name, avatarId) {
    const badge = $('player-badge');
    if (!badge) return;
    if (!name) { badge.hidden = true; return; }
    badge.hidden = false;
    $('player-badge-name').textContent = name;
    const avatars = window.__AVATARS__ || {};
    $('player-badge-avatar').textContent = (avatarId && avatars[avatarId]) || '👤';
  }

  // ── Reconnect / rejoin ──
  function tryRejoin() {
    const ticket = savedTicket || sessionStorage.getItem('castTicket');
    if (!ticket) return;
    if (!socket) {
      socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] }); // BUG-230db143 root fix (namespace xatosi)
      client = new CastSocketClient({ socket, onEvent: (ev, data) => handleEvent(ev, data), onError: () => setState(STATE.RETRYING) });
      socket.on('disconnect', () => updateNet('offline', 'Uzildi — qayta ulanmoqda'));
      socket.on('reconnect_attempt', () => updateNet('reconnecting', 'Qayta ulanmoqda…'));
      socket.on('connect_error', () => updateNet('reconnecting', 'Qayta ulanmoqda…'));
    }
    socket.on('connect', () => {
      updateNet('online', 'Ulangan');
      client.sendCommand('cast:rejoin', { membershipTicket: ticket }).then((ack) => {
        sessionId = ack.sessionId;
        participantId = ack.participantId;
        displayAlias = ack.displayAlias;
        client.sessionId = sessionId;
        client.actorId = participantId;
        if (ack.state && ack.state.phase === 'QUESTION_OPEN' && ack.question) {
          renderQuestion(ack.question, ack.state.phase);
        } else if (ack.state && ack.state.poe && ack.state.poe.phase) {
          // C3-11: POE flow'ga rejoin — faza konteksti tiklanadi
          currentQuestion = ack.question;
          recoverPoe(ack.state);
        } else if (ack.state && ack.state.orb && ack.state.orb.phase === 'COLLECT') {
          // C3-12: ORB'ga rejoin — ochiq javob view'i tiklanadi
          orbPhase = 'COLLECT';
          show('part-orb');
          $('part-orb-q').textContent = ack.state.orb.prompt || 'Fikringizni yozing';
          $('part-orb-text').value = '';
          $('part-orb-text').disabled = false;
          $('part-orb-submit').disabled = false;
          $('part-orb-submit').textContent = 'Yuborish';
          $('part-orb-error').textContent = '';
          $('part-orb-chars').textContent = '0 / 280';
        } else if (ack.state && ack.state.phase === 'REVEAL') {
          show('part-reveal');
          $('part-reveal-title').textContent = 'Javob ko‘rsatildi';
        }
      }).catch(() => {});
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ──
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) $('join-code').value = urlCode;
  if (sessionStorage.getItem('castTicket')) {
    tryRejoin();
  }
})();
