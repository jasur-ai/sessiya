/**
 * Deborah — Cast Setup Studio (STEP 28)
 * -------------------------------------
 * Professional mode → lobby setup dialog.
 * - Native radio mode cards (no color-only state)
 * - Essentials + Advanced accordion (pace, timer, think, scoring, leaderboard, join)
 * - Persistent preset summary + customized badge + Reset
 * - Preflight blocker/warning/info summaries before sticky footer
 * - Governance-locked field markers (hidden emas)
 * - Dirty state, Escape confirm, focus trap + restore, initial focus
 * - Submit: request-id dedup + pending button (label saqlanadi)
 */

(function (global) {
  'use strict';

  const MODE_CARDS = [
    { id: 'responsive_accuracy', icon: 'target', name: 'Responsive Accuracy', desc: 'Tavsiya etilgan — fikrlash, javob, tahlil', rec: true },
    { id: 'classic_live', icon: 'zap', name: 'Classic Live', desc: 'Tezkor, ball + tezlik rejimi' },
    { id: 'team_challenge', icon: 'users', name: 'Team Challenge', desc: 'Jamoalar bo‘lib bahs' },
    { id: 'formative_check', icon: 'checkCircle', name: 'Formative Check', desc: 'Ball yo‘q — tushunishni tekshirish' },
  ];

  // Qaysi maydon qaysi lock path bilan bog'lanadi (S28.08)
  const FIELD_LOCK_PATHS = {
    'cs-pace-chips': 'pace',
    'cs-think-chips': 'playback.thinkSeconds',
    'cs-timer-chips': 'timer.defaultSeconds',
    'cs-timer-mode': 'timer.mode',
    'cs-scoring': 'scoring.mode',
    'cs-lb-chips': 'leaderboard.visibility',
    'cs-join-chips': 'join.allowLateJoin',
    'cs-partial-chips': 'scoring.partialCredit',
    'cs-sfx-chips': 'presentation.soundEffects',
    'cs-motion-chips': 'presentation.motion',
    // 09/2026 simple mode (jonli viktorina uslubi — VIP bo'lmagan userlar)
    'cs-s-timer-chips': 'timer.defaultSeconds',
    'cs-s-auto-chips': 'timer.mode',
    'cs-s-lb-chips': 'leaderboard.visibility',
    'cs-s-sfx-chips': 'presentation.soundEffects',
    'cs-s-theme-chips': 'presentation.themeId',
    'cs-s-music-chips': 'presentation.lobbyMusic',
  };

  let studioState = {
    open: false,
    reference: null, // {source, key, chunk}
    preflight: null,
    draftConfig: { presetId: 'responsive_accuracy', overrides: {} },
    loading: false,
    error: null,
    submitting: false,
    requestId: null,
    abort: null,
    customized: false,
    focusedBeforeOpen: null,
    // 09/2026 (user qarori): VIP bo'lmaganlar uchun soddalashgan
    // Jonli-viktorina-uslub sozlamalar ko'rinishi (to'liq sozlamalar faqat VIP)
    simple: false,
    simpleFallbackUsed: false,
  };

  function el(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escAttr(s) {
    return escHtml(s).replace(/'/g, '&#39;');
  }
  function icon(name, size) {
    return typeof global.svgIcon === 'function' ? global.svgIcon(name, size || 15) : '';
  }

  // ── Open / close (S28.09: initial focus + focus restore) ──
  function openStudio(reference) {
    studioState.reference = reference;
    studioState.error = null;
    studioState.preflight = null;
    studioState.customized = false;
    studioState.requestId = crypto.randomUUID();
    studioState.focusedBeforeOpen = document.activeElement;
    studioState.simpleFallbackUsed = false;

    const overlay = el('cast-studio-overlay');
    if (!overlay) return;
    // 09/2026: data-studio-simple=true → jonli viktorina uslubi (Classic Live) minimal
    studioState.simple = overlay.dataset.studioSimple === 'true';
    studioState.draftConfig = studioState.simple
      ? { presetId: 'classic_live', overrides: { playback: { advanceMode: 'fully_auto', thinkSeconds: 3 } } }
      : { presetId: 'responsive_accuracy', overrides: {} };

    overlay.classList.add('open');
    overlay.classList.remove('is-dirty');
    studioState.open = true;

    renderLoading();
    runPreflight();
    // S28.09: initial focus — close tugmasiga (mode cards preflight'dan keyin chiqadi)
    requestAnimationFrame(() => {
      const closeBtn = el('cast-studio-close');
      if (closeBtn) closeBtn.focus();
    });
  }

  function closeStudio() {
    if (studioState.abort) studioState.abort.abort();
    const overlay = el('cast-studio-overlay');
    if (overlay) overlay.classList.remove('open');
    overlay && overlay.classList.remove('is-dirty');
    studioState.open = false;
    // S28.09: focus restore
    if (studioState.focusedBeforeOpen && typeof studioState.focusedBeforeOpen.focus === 'function') {
      try { studioState.focusedBeforeOpen.focus(); } catch (_) {}
    }
    studioState.focusedBeforeOpen = null;
  }

  function requestClose() {
    // S28.09: dirty bo'lsa Escape confirmation
    if (studioState.customized) {
      if (global.showConfirm) {
        global.showConfirm(
          'O‘zgarishlardan voz kechish?',
          'Kiritilgan sozlamalar saqlanmaydi. Yopilsinmi?',
          'Yopish'
        ).then((ok) => ok && closeStudio());
      } else if (global.confirm) {
        if (global.confirm('O‘zgarishlardan voz kechish? Sozlamalar saqlanmaydi.')) closeStudio();
      } else {
        closeStudio();
      }
      return;
    }
    closeStudio();
  }

  // ── Preflight ──
  function runPreflight() {
    const src = studioState.reference;
    if (!src) return;
    const payload = {
      source: { type: src.source, key: src.key, chunk: src.chunk || null },
      draftConfig: studioState.draftConfig,
    };
    if (studioState.abort) studioState.abort.abort();
    studioState.abort = new AbortController();
    studioState.loading = true;
    studioState.error = null;
    renderBody();

    global.castFetch('/api/cast/preflight', {
      method: 'POST',
      signal: studioState.abort.signal,
      body: JSON.stringify(payload),
    })
      .then((data) => {
        studioState.loading = false;
        studioState.preflight = data;
        // Capability-driven fallback: teams qo'llab-quvvatlanmasa
        if (data.capabilities && !data.capabilities.supportsTeams && studioState.draftConfig.presetId === 'team_challenge') {
          studioState.draftConfig = { presetId: 'responsive_accuracy', overrides: {} };
          studioState.customized = false;
        }
        renderBody();
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        studioState.loading = false;
        studioState.error = err.message;
        renderBody();
      });
  }

  // ── Render ──
  function renderLoading() {
    const body = el('cast-studio-body');
    if (body) {
      body.innerHTML = '<div class="cast-studio-loading"><span class="spinner"></span><div>Test tahlil qilinmoqda…</div></div>';
    }
  }

  function renderBody() {
    const body = el('cast-studio-body');
    if (!body) return;

    if (studioState.loading) { renderLoading(); return; }
    if (studioState.error) {
      body.innerHTML = `<div class="cast-studio-error">${icon('alertTriangle', 18)} ${escHtml(studioState.error)}<br><button type="button" class="btn btn-quiet" data-cs-retry style="margin-top:12px">${icon('refresh', 14)} Qayta urinish</button></div>`;
      const retry = body.querySelector('[data-cs-retry]');
      if (retry) retry.addEventListener('click', runPreflight);
      renderFooter();
      return;
    }
    if (!studioState.preflight) { renderLoading(); return; }

    const pf = studioState.preflight;
    const hasBlockers = (pf.blockers || []).length > 0;
    const presetId = studioState.draftConfig.presetId;
    const preset = (pf.presets || []).find((p) => p.id === presetId) || { id: presetId, version: 'v1' };

    // ── S28.02/03: native radio mode cards ──
    const modeCards = MODE_CARDS.map((m) => {
      const selected = presetId === m.id;
      return `
      <label class="cast-mode-card${selected ? ' selected' : ''}">
        <input type="radio" name="cs-mode" value="${m.id}" ${selected ? 'checked' : ''} data-mode="${m.id}" aria-label="${escAttr(m.name)}">
        <span class="mc-name">${icon(m.icon, 16)} ${escHtml(m.name)}${m.rec ? '<span class="mc-rec">Tavsiya</span>' : ''}</span>
        <span class="mc-desc">${escHtml(m.desc)}</span>
      </label>`;
    }).join('');

    // ── S28.08: governance banner + per-field locks ──
    const gov = pf.institutionPolicy;
    const lockedPathSet = new Set(Object.keys((gov && gov.lockedFields) || {}));
    const lockedPaths = (k) => lockedPathSet.has(k) || lockedPathSet.has(FIELD_LOCK_PATHS[k]);
    const lockMark = (k) => (lockedPaths(k) ? `<span class="cs-locked" title="Rektorat siyosati bilan qulflangan">${icon('lock', 11)} qulflangan</span>` : '');

    const govBanner = gov ? `
      <div class="cs-gov-banner" role="note">
        ${icon('shieldCheck', 16)}
        <div>
          <strong>Institution governance — ${escHtml(gov.policyId)} v${escHtml(gov.version)}</strong>
          <p>${(gov.approvedPresets || []).length ? 'Ruxsat etilgan rejimlar: ' + escHtml(gov.approvedPresets.join(', ')) + '. ' : ''}Qulflangan sozlamalarni o‘zgartirib bo‘lmaydi (server majbur qiladi).</p>
        </div>
      </div>` : '';

    // ── S28.05: preset summary + customized badge + Reset ──
    const summary = `
      <div class="cast-summary">
        <span class="cast-summary-label">Tanlangan rejim:</span>
        <span class="cast-summary-name">${icon('checkCircle', 14)} ${escHtml(preset.id.replace(/_/g, ' '))}</span>
        ${studioState.customized ? '<span class="cs-customized">' + icon('sparkles', 11) + ' sozlangan</span>' : ''}
        <button type="button" class="cs-reset" data-cs-reset ${studioState.customized ? '' : 'hidden'} aria-label="Rejim sozlamalarini tiklash">${icon('refresh', 12)} Reset</button>
      </div>`;

    // ── S28.04: Essentials ──
    const cur = (path, fallback) => {
      const over = studioState.draftConfig.overrides;
      const parts = path.split('.');
      let node = over[parts[0]];
      if (node === undefined || node === null) return fallback;
      return parts.length > 1 ? (node[parts[1]] ?? fallback) : node;
    };

    const essentials = `
      <div class="cast-studio-section">
        <div class="cast-modes-label">Asosiy sozlamalar</div>
        <div class="cast-row" style="margin-top:10px">
          <div class="cs-field">
            <label>Temp ${lockMark('cs-pace-chips')}</label>
            <div class="cast-chips" id="cs-pace-chips"></div>
          </div>
          <div class="cs-field">
            <label>Fikrlash vaqti ${lockMark('cs-think-chips')}</label>
            <div class="cast-chips" id="cs-think-chips"></div>
          </div>
        </div>
        <div class="cast-row">
          <div class="cs-field">
            <label>Savol vaqti ${lockMark('cs-timer-chips')}</label>
            <div class="cast-chips" id="cs-timer-chips"></div>
          </div>
          <div class="cs-field">
            <label>Timer rejimi ${lockMark('cs-timer-mode')}</label>
            <div class="cast-chips" id="cs-timer-mode"></div>
          </div>
        </div>
        <div class="cast-row">
          <div class="cs-field">
            <label>Ball rejimi ${lockMark('cs-scoring')}</label>
            <div class="cast-chips" id="cs-scoring"></div>
          </div>
          <div class="cs-field">
            <label>Leaderboard ${lockMark('cs-lb-chips')}</label>
            <div class="cast-chips" id="cs-lb-chips"></div>
          </div>
        </div>
        <div class="cs-field">
          <label>Kech qo‘shilish ${lockMark('cs-join-chips')}</label>
          <div class="cast-chips" id="cs-join-chips"></div>
        </div>
      </div>

      <div class="cs-advanced" aria-expanded="false" data-cs-advanced>
        <button type="button" class="cs-advanced-toggle" data-cs-advanced-toggle aria-expanded="false">
          ${icon('chevronDown', 14)} Ilg‘or sozlamalar
        </button>
        <div class="cs-advanced-panel">
          <div class="cast-row">
            <div class="cs-field">
              <label>Qisman ball</label>
              <div class="cast-chips" id="cs-partial-chips"></div>
            </div>
            <div class="cs-field">
              <label>Ovoz effektlari</label>
              <div class="cast-chips" id="cs-sfx-chips"></div>
            </div>
          </div>
          <div class="cs-field">
            <label>Harakat animatsiyasi</label>
            <div class="cast-chips" id="cs-motion-chips"></div>
          </div>
        </div>
      </div>`;

    // ── S28.06/07: preflight summaries (danger/warning/info) ──
    const summaries = [];
    (pf.blockers || []).forEach((b) => {
      summaries.push(`<div class="cs-summary-item cs-summary-item--danger" role="alert">
        ${icon('alertTriangle', 15)} <div><div class="cs-title">${escHtml(b.code ? b.code.replace(/_/g, ' ') : 'Blocker')}</div>
        ${escHtml(b.message)}</div></div>`);
    });
    (pf.warnings || []).slice(0, 3).forEach((w) => {
      summaries.push(`<div class="cs-summary-item cs-summary-item--warning">${icon('info', 15)}
        <div>${escHtml(w.message)}</div></div>`);
    });
    if (pf.duration && pf.duration.label) {
      summaries.push(`<div class="cs-summary-item cs-summary-item--info">${icon('clock', 15)}
        <div><div class="cs-title">Kutilgan davomiylik</div>${escHtml(pf.duration.label)}</div></div>`);
    }
    summaries.push(`<div class="cs-summary-item cs-summary-item--info">${icon('shieldCheck', 15)}
      <div><div class="cs-title">Maxfiylik</div>Qo‘shilish faqat join kod orqali — ro‘yxatdan o‘tish shart emas. Javoblar serverda himoyalangan, o‘quvchilar bir-birining javobini ko‘rmaydi.</div></div>`);
    summaries.push(`<div class="cs-summary-item cs-summary-item--info">${icon('eye', 15)}
      <div><div class="cs-title">Qulaylik (a11y)</div>Klaviatura bilan to‘liq boshqarish va yuqori kontrast rejim qo‘llab-quvvatlanadi.</div></div>`);

    const preflightHtml = `
      <div class="cs-preflight">
        ${summaries.join('')}
      </div>`;

    // ── 09/2026 SIMPLE MODE (jonli viktorina uslubi — VIP bo'lmagan userlar):
    // mode cards + pace/think/timer-mode/scoring/join/advanced sozlamalar
    // KO'RSATILMAYDI. Faqat: savol vaqti, avto-yopish, jadval, ovoz,
    // orqa fon, fon musiqasi. VIP uchun yuqoridagi to'liq sirt qoladi.
    if (studioState.simple) {
      const govNote = (gov && gov.lockedFields && Object.keys(gov.lockedFields).length)
        ? govBanner
        : '';
      const simpleSummaries = summaries.filter((s) => /--danger|--warning|Kutilgan davomiylik/.test(s));
      body.innerHTML = `
        <div class="cs-s-hero">
          <span class="cs-s-preset">${icon('zap', 15)} Classic Live</span>
          <span class="cs-s-tag">Jonli viktorina uslubi — tez va to‘g‘ri javob ko‘proq ball keltiradi</span>
        </div>

        ${govNote}
        ${summary}

        <div class="cast-studio-section">
          <div class="cast-modes-label">Xona sozlamalari</div>
          <div class="cast-row">
            <div class="cs-field">
              <label>Savol vaqti ${lockMark('cs-s-timer-chips')}</label>
              <div class="cast-chips" id="cs-s-timer-chips"></div>
            </div>
            <div class="cs-field">
              <label>Avtomatik o‘tkazish ${lockMark('cs-s-auto-chips')}</label>
              <div class="cast-chips" id="cs-s-auto-chips"></div>
              <span class="cs-s-hint">Yoniq — to‘liq avto: savol (20s/…), vaqt tugasa shohsupa 5s va keyingi savol o‘zi ochiladi. O‘chiq — siz boshqarasiz.</span>
            </div>
          </div>
          <div class="cast-row">
            <div class="cs-field">
              <label>O‘yin jadvali ${lockMark('cs-s-lb-chips')}</label>
              <div class="cast-chips" id="cs-s-lb-chips"></div>
            </div>
            <div class="cs-field">
              <label>Ovoz effektlari ${lockMark('cs-s-sfx-chips')}</label>
              <div class="cast-chips" id="cs-s-sfx-chips"></div>
            </div>
          </div>
          <div class="cast-row">
            <div class="cs-field">
              <label>Orqa fon (tema) ${lockMark('cs-s-theme-chips')}</label>
              <div class="cast-chips" id="cs-s-theme-chips"></div>
              <span class="cs-s-hint">Qorong‘i yoki yoruq sahna uslubi.</span>
            </div>
            <div class="cs-field">
              <label>Fon musiqasi ${lockMark('cs-s-music-chips')}</label>
              <div class="cast-chips" id="cs-s-music-chips"></div>
              <span class="cs-s-hint">Lobbi va savol paytidagi musiqa hajmi.</span>
            </div>
          </div>
        </div>

        <div class="cs-preflight">
          ${simpleSummaries.join('')}
        </div>`;
    } else {
      body.innerHTML = `
        <div class="cast-modes-label">Rejim tanlang</div>
        <div class="cast-modes" role="radiogroup" aria-label="Cast rejimi">${modeCards}</div>

        ${govBanner}
        ${summary}
        ${essentials}
        ${preflightHtml}
      `;
    }

    wireBody(pf, hasBlockers, cur);
    renderFooter();
  }

  function wireBody(pf, hasBlockers, cur) {
    const body = el('cast-studio-body');
    if (!body) return;

    // Mode radio cards (native radio → change event)
    body.querySelectorAll('input[name="cs-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        selectMode(radio.value);
      });
    });

    // Reset (S28.05)
    const reset = body.querySelector('[data-cs-reset]');
    if (reset) reset.addEventListener('click', () => {
      studioState.draftConfig = { presetId: studioState.draftConfig.presetId, overrides: {} };
      studioState.customized = false;
      runPreflight();
    });

    // Advanced accordion (S28.04)
    const adv = body.querySelector('[data-cs-advanced]');
    const advToggle = body.querySelector('[data-cs-advanced-toggle]');
    if (adv && advToggle) {
      advToggle.addEventListener('click', () => {
        const open = adv.getAttribute('aria-expanded') === 'true';
        adv.setAttribute('aria-expanded', open ? 'false' : 'true');
        advToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    }

    // 09/2026 simple mode (jonli viktorina uslubi) — faqat minimal chips
    if (studioState.simple) {
      wireSimpleChips(pf, cur);
      return;
    }

    // Chips
    renderChips('cs-pace-chips',
      [['instructor', 'O‘qituvchi boshqaradi'], ['self_paced', 'O‘z tezligida'], ['student', 'Talaba o‘zi']],
      cur('pace', 'instructor'), (v) => setPace(v), pf);
    renderChips('cs-think-chips', [0, 3, 5, 10], cur('playback.thinkSeconds', 5), (v) => setOverride('playback', { thinkSeconds: v }), pf);
    renderChips('cs-timer-chips', [10, 15, 20, 30, 45, 60], cur('timer.defaultSeconds', 30), (v) => setOverride('timer', { defaultSeconds: v }), pf);
    renderChips('cs-timer-mode', [['soft', 'Yumshoq'], ['strict', 'Qattiq'], ['off', 'O‘chiq']], cur('timer.mode', 'soft'), (v) => setOverride('timer', { mode: v }), pf);
    renderChips('cs-scoring', [['accuracy', 'Aniqlik'], ['balanced', 'Balans'], ['speed', 'Tezlik'], ['no_points', 'Ballsiz']], cur('scoring.mode', 'accuracy'), (v) => setOverride('scoring', { mode: v }), pf);
    renderChips('cs-lb-chips', [['off_during_learning', 'Dars paytida yashirin'], ['personal_only', 'Faqat o‘zi'], ['top_n', 'Top-5']], cur('leaderboard.visibility', 'off_during_learning'), (v) => setOverride('leaderboard', { visibility: v }), pf);
    renderChips('cs-join-chips', [['true', 'Ruxsat berilgan'], ['false', 'Taqiqlangan']], String(cur('join.allowLateJoin', true)), (v) => setOverride('join', { allowLateJoin: v === 'true' }), pf);
    // Advanced
    renderChips('cs-partial-chips', [['true', 'Yoqilgan'], ['false', 'O‘chiq']], String(cur('scoring.partialCredit', false)), (v) => setOverride('scoring', { partialCredit: v === 'true' }), pf);
    renderChips('cs-sfx-chips', [['off', 'O‘chiq'], ['low', 'Past'], ['on', 'Yoniq']], cur('presentation.soundEffects', 'low'), (v) => setOverride('presentation', { soundEffects: v }), pf);
    renderChips('cs-motion-chips', [['full', 'To‘liq'], ['reduced', 'Qisqartirilgan'], ['none', 'Yo‘q']], cur('presentation.motion', 'reduced'), (v) => setOverride('presentation', { motion: v }), pf);
  }

  // ── 09/2026 Simple mode chips (Classic Live — VIP bo'lmagan userlar) ──
  function wireSimpleChips(pf, cur) {
    const m = (path, fb) => cur(path, fb);
    const timerMode = String(m('timer.mode', 'strict'));
    const timerSec = timerMode === 'off' ? '0' : String(m('timer.defaultSeconds', 20));
    renderChips('cs-s-timer-chips',
      [['10', '10s'], ['15', '15s'], ['20', '20s'], ['30', '30s'], ['45', '45s'], ['60', '60s'], ['0', 'Vaqtsiz']],
      timerSec, (v) => {
        if (v === '0') { setOverride('timer', { mode: 'off' }); setOverride('playback', { advanceMode: 'host_controlled' }); return; }
        const mode = m('timer.mode', 'strict') === 'off' ? 'strict' : m('timer.mode', 'strict');
        const adv = m('playback.advanceMode', 'fully_auto') === 'fully_auto' ? 'fully_auto' : 'host_controlled';
        setOverride('timer', { mode, defaultSeconds: Number(v) });
        if (adv === 'fully_auto') setOverride('playback', { advanceMode: 'fully_auto', thinkSeconds: 3 });
      }, pf);
    renderChips('cs-s-auto-chips',
      [['strict', 'Yoniq'], ['soft', 'O‘chiq']],
      timerMode === 'off' ? 'soft' : timerMode,
      (v) => {
        // C4-10 (user qarori): klassik avto-zanjir — savol yopilgach shohsupa
        // (5s) ko'rinadi va keyingi savol O'ZI ochiladi (direktor bosmaydi).
        if (v === 'strict') {
          setOverride('timer', { mode: 'strict', defaultSeconds: Number(m('timer.defaultSeconds', 20)) || 20 });
          setOverride('playback', { advanceMode: 'fully_auto', thinkSeconds: 3 });
        } else {
          setOverride('timer', { mode: 'soft' });
          setOverride('playback', { advanceMode: 'host_controlled' });
        }
      }, pf);
    const lbVis = m('leaderboard.visibility', 'top_n');
    const lbFreq = m('leaderboard.frequency', 'every_question');
    const lbSel = lbVis === 'top_n' ? 'top_every' : (lbFreq === 'end_only' ? 'end' : 'off');
    renderChips('cs-s-lb-chips',
      [['top_every', 'Har savoldan keyin'], ['end', 'Faqat yakunda'], ['off', 'Yashirin']],
      lbSel, (v) => {
        if (v === 'top_every') setOverride('leaderboard', { visibility: 'top_n', finalVisibility: 'top_n', frequency: 'every_question' });
        else if (v === 'end') setOverride('leaderboard', { visibility: 'off_during_learning', finalVisibility: 'top_n', frequency: 'end_only' });
        else setOverride('leaderboard', { visibility: 'off_during_learning', finalVisibility: 'off_during_learning', frequency: 'never' });
      }, pf);
    renderChips('cs-s-sfx-chips',
      [['off', 'O‘chiq'], ['low', 'Past'], ['on', 'Yoniq']],
      m('presentation.soundEffects', 'low'), (v) => setOverride('presentation', { soundEffects: v }), pf);
    renderChips('cs-s-theme-chips',
      [['focus_dark', 'Qorong‘i'], ['focus_light', 'Yoruq']],
      m('presentation.themeId', 'focus_dark'), (v) => setOverride('presentation', { themeId: v }), pf);
    renderChips('cs-s-music-chips',
      [['off', 'O‘chiq'], ['low', 'Past'], ['on', 'Yoniq']],
      m('presentation.lobbyMusic', 'off'), (v) => setOverride('presentation', { lobbyMusic: v }), pf);
  }

  function renderChips(containerId, options, selected, onPick, pf) {
    const c = el(containerId);
    if (!c) return;
    const gov = pf && pf.institutionPolicy;
    const lockedSet = new Set(Object.keys((gov && gov.lockedFields) || {}));
    const fieldPath = FIELD_LOCK_PATHS[containerId];
    const isLocked = fieldPath && lockedSet.has(fieldPath);
    c.innerHTML = options.map((opt) => {
      const [value, label] = Array.isArray(opt) ? opt : [opt, String(opt)];
      const lockedCls = isLocked ? ' cs-locked-chip' : '';
      return `<button type="button" class="cast-chip${value === selected ? ' selected' : ''}${lockedCls}" data-val="${escAttr(String(value))}" ${isLocked ? 'disabled tabindex="-1" aria-disabled="true"' : ''} data-cs-chip>${escHtml(label)}</button>`;
    }).join('');
    c.querySelectorAll('[data-cs-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const raw = btn.dataset.val;
        const num = Number(raw);
        onPick(Number.isFinite(num) && String(num) === raw ? num : raw);
      });
    });
  }

  function markCustomized() {
    studioState.customized = true;
    const overlay = el('cast-studio-overlay');
    if (overlay) overlay.classList.add('is-dirty');
  }

  function setPace(value) {
    // pace — top-level enum override (ob'ekt emas)
    studioState.draftConfig.overrides.pace = value;
    markCustomized();
    runPreflight();
  }

  function setOverride(section, partial) {
    // S28.08: governance-locked field — client override bloklanadi (server ham rad qiladi)
    const gov = studioState.preflight && studioState.preflight.institutionPolicy;
    if (gov) {
      const lockMap = gov.lockedFields || {};
      const touched = Object.keys(partial);
      let blocked = false;
      for (const key of touched) {
        const path = section + '.' + key;
        if (Object.prototype.hasOwnProperty.call(lockMap, path)) { delete partial[key]; blocked = true; }
      }
      if (blocked && Object.keys(partial).length === 0) return;
    }
    studioState.draftConfig.overrides[section] = Object.assign({}, studioState.draftConfig.overrides[section] || {}, partial);
    markCustomized();
    runPreflight();
  }

  function selectMode(id) {
    studioState.draftConfig = { presetId: id, overrides: {} };
    studioState.customized = false;
    const overlay = el('cast-studio-overlay');
    if (overlay) overlay.classList.remove('is-dirty');
    runPreflight();
  }

  // ── Submit (S28.10: one request id, pending label saqlanadi) ──
  async function submit() {
    if (studioState.submitting) return;
    const ref = studioState.reference;
    if (!ref) return;
    studioState.submitting = true;
    const launchBtn = el('cast-studio-launch');
    if (launchBtn) {
      launchBtn.disabled = true;
      launchBtn.setAttribute('aria-busy', 'true');
      launchBtn.innerHTML = '<span class="cs-launch-spinner"></span><span data-cs-launch-label>Lobbi ochish</span>';
    }

    try {
      const data = await global.castFetch('/api/cast/sessions', {
        method: 'POST',
        body: JSON.stringify({
          requestId: studioState.requestId,
          preflightId: studioState.preflight && studioState.preflight.preflightId,
          source: { type: ref.source, key: ref.key, chunk: ref.chunk || null },
          presetId: studioState.draftConfig.presetId,
          overrides: studioState.draftConfig.overrides,
        }),
      });
      window.location.assign(data.directorUrl);
    } catch (err) {
      // 09/2026 simple mode: Classic Live institut siyosatida ruxsat
      // etilmasa — avtomatik tavsiya etilgan rejimga o'tib qayta urinamiz
      if (studioState.simple && !studioState.simpleFallbackUsed && studioState.draftConfig.presetId === 'classic_live'
          && /PRESET_NOT_APPROVED|not approved|ruxsat etilmagan/i.test(String((err && err.message) || ''))) {
        studioState.simpleFallbackUsed = true;
        studioState.draftConfig = {
          presetId: 'responsive_accuracy',
          overrides: {
            timer: { mode: 'strict', defaultSeconds: 20 },
            playback: { advanceMode: 'fully_auto', thinkSeconds: 3 },
            presentation: { soundEffects: 'low' },
          },
        };
        studioState.customized = false;
        runPreflight();
        submit();
        return;
      }
      studioState.submitting = false;
      if (launchBtn) {
        launchBtn.disabled = (studioState.preflight && (studioState.preflight.blockers || []).length > 0);
        launchBtn.removeAttribute('aria-busy');
        launchBtn.innerHTML = '<span data-cs-launch-label>Lobbi ochish</span>';
      }
      const body = el('cast-studio-body');
      if (body) {
        const e = document.createElement('div');
        e.className = 'cs-summary-item cs-summary-item--danger';
        e.setAttribute('role', 'alert');
        e.style.marginTop = '8px';
        e.innerHTML = icon('alertTriangle', 15) + '<div>' + escHtml(err.message || 'Xatolik yuz berdi') + '</div>';
        body.appendChild(e);
      }
      const status = el('cast-studio-footer-status');
      if (status) status.textContent = 'Saqlash amalga oshmadi';
    }
  }

  // ── Footer status (S28.05/09) ──
  function renderFooter() {
    const status = el('cast-studio-footer-status');
    if (!status) return;
    const hasBlockers = studioState.preflight && (studioState.preflight.blockers || []).length > 0;
    if (studioState.submitting) {
      status.textContent = 'Lobbi ochilmoqda…';
    } else if (hasBlockers) {
      status.innerHTML = '<span class="cs-dirty-dot"></span>Blokerdan oldin ishga tushirib bo‘lmaydi';
    } else if (studioState.customized) {
      status.innerHTML = '<span class="cs-dirty-dot"></span>O‘zgartirishlar kiritilgan';
    } else if (studioState.simple) {
      status.textContent = 'Classic Live — standart sozlamalar (20 soniya)';
    } else {
      status.textContent = 'Safe default: Responsive Accuracy';
    }
    const launchBtn = el('cast-studio-launch');
    if (launchBtn) {
      const hasBlocker = studioState.preflight ? hasBlockers : true;
      launchBtn.disabled = hasBlocker || studioState.submitting;
      if (!studioState.submitting && !launchBtn.querySelector('[data-cs-launch-label]')) {
        launchBtn.innerHTML = '<span data-cs-launch-label>Lobbi ochish</span>';
      }
    }
  }

  // ── Focus trap (S28.09) ──
  function focusTrap(e) {
    if (e.key !== 'Tab') return;
    const overlay = el('cast-studio-overlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  // Public API
  global.CastStudio = {
    open: openStudio,
    close: closeStudio,
    requestClose,
    retry: runPreflight,
    selectMode,
    submit,
  };

  // Wire static controls
  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = el('cast-studio-close');
    if (closeBtn) closeBtn.addEventListener('click', requestClose);
    const launchBtn = el('cast-studio-launch');
    if (launchBtn) launchBtn.addEventListener('click', submit);
    const cancelBtn = el('cast-studio-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', requestClose);
    const overlay = el('cast-studio-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) requestClose();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('open')) {
          e.preventDefault();
          requestClose();
        }
      });
      document.addEventListener('keydown', focusTrap);
    }
  });
})(window);
