/* ═══════════════════════════════════════════════════════════════
   STEP 27 — Test Builder authoring workspace
   Sticky save status + autosave (pending/saved/offline/error),
   outline navigation, labeled fields, native radio correct answer,
   duplicate/delete overflow, drag + keyboard reorder, validation
   with error summary, Excel import modal (template → upload →
   parse/errors → preview → confirm), unsaved navigation guard.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const init = window.__TB_INIT || { isEdit: false, editKey: '', name: '', questions: [] };
  const BC = window.__TB_COPY || {}; // S34m: 3 til copy (serverdan)
  const T = (k, fb) => (BC[k] !== undefined ? BC[k] : fb);
  const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  // Foydalanuvchi talabi (09/2026): har bir YANGI savol uchun default vaqt 20 soniya
  const DEFAULT_QUESTION_TIME = 20;

  // ── State ──
  const state = {
    name: init.name || '',
    questions: (init.questions || []).map(normalize),
    activeId: null,
    dirty: false,
    saveStatus: 'saved', // saved | pending | error | offline
  };

  let idSeq = 1;
  function nextId() { return 'q_' + (idSeq++); }
  function normalize(q, i) {
    return {
      id: nextId(),
      type: q.type || 'single_choice',
      text: q.text || '',
      options: Array.isArray(q.options) ? q.options.filter((o, j) => j < 6).map(String) : [],
      correct: typeof q.correct === 'number' ? q.correct : 0,
      explanation: q.explanation || '',
      tags: Array.isArray(q.tags) ? q.tags.map(String) : [],
      timing: q.timing || 0,
    };
  }

  // ── Autosave (S27.07) ──
  let saveTimer = null;
  const SAVE_DELAY = 900;

  function setStatus(status, txt) {
    state.saveStatus = status;
    const el = $('#tb-status');
    const txtEl = $('#tb-status-txt');
    if (!el || !txtEl) return;
    el.dataset.save = status;
    txtEl.textContent = txt;
  }

  function markDirty() {
    state.dirty = true;
    setStatus('pending', 'Saqlanmoqda...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(scheduleSave, SAVE_DELAY);
  }

  // Eski (kechikkan) response yangi o'zgarishlarni 'saved' deb belgilamasligi uchun
  // har bir save o'z seq raqamini oladi; faqat oxirgi save status'ni yozadi.
  let saveSeq = 0;
  async function scheduleSave() {
    const seq = ++saveSeq;
    const ok = await navigator.onLine;
    if (!ok) { setStatus('offline', T('statusOfflineWait', 'Oflayn — ulanish kutilmoqda')); return; }
    /* S34k FIX: yaroqsiz holatda avtosave 400 'Invalid data' qaytarardi
       (nom bo'sh yoki savollar bo'sh/hammasi bo'sh). Avtosave faqat
       yakka savol holatda ham yuboradi, lekin server-side limit buzilmasa. */
    const _errors = validate();
    const blocking = _errors.filter(e => {
      if (e.qId === null) return true; // nom/kamida 1 savol
      return true;
    });
    if (blocking.length) {
      // Tahrirlash rejimida (editKey bor) saqlab qolish OK (avvaldan saqlangan);
      // yangi testda esa yubormaslik — server 400 bermasligi uchun.
      if (!init.isEdit) {
        // Aniq xabar: birinchi 2 ta yetishmayotgan maydon (test nomi / savol matni / ...)
        const top = blocking.slice(0, 2).map(e => e.msg);
        const more = blocking.length > 2 ? ' …' : '';
        setStatus('error', (top.length ? top.join(' · ') : T('statusMissing', 'To‘ldirilmagan maydonlar bor')) + more);
        renderErrors();
        return;
      }
    }
    try {
      const res = await fetch('/user/api/tests/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN || '',
        },
        body: JSON.stringify({
          name: state.name.trim(),
          questions: serialize(),
          editKey: init.editKey,
        }),
      });
      const data = await res.json();
      if (seq !== saveSeq) return; // yangiroq save bor — bu response eskirgan
      if (data.success) {
        state.dirty = false;
        init.editKey = data.key || init.editKey;
        setStatus('saved', T('statusSaved', 'Saqlandi'));
        const preview = $('#tb-preview-btn');
        if (preview) preview.disabled = false;
      } else {
        setStatus('error', T('statusSaveErr', 'Saqlashda xato'));
        showToast && showToast(T('toastErr', 'Xato: ') + (data.error || ''), 'err');
      }
    } catch (e) {
      if (seq !== saveSeq) return;
      setStatus('offline', T('statusOfflineRetry', 'Oflayn — qayta uriniladi'));
    }
  }

  function serialize() {
    return state.questions.map(q => ({
      type: q.type || 'single_choice',
      text: q.text,
      options: q.options,
      correct: q.correct,
      explanation: q.explanation,
      tags: q.tags,
      timing: q.timing,
    }));
  }

  // ── Manual save (sticky Save btn) ──
  async function manualSave() {
    state.dirty = true;
    setStatus('pending', T('statusSaving', 'Saqlanmoqda...'));
    await scheduleSave();
  }

  // ── Validation (S27.08) ──
  function validate() {
    const errors = [];
    if (!state.name.trim()) errors.push({ qId: null, msg: T('nameRequired', 'Test nomini kiriting — testga nom qoying') });
    if (!state.questions.length) errors.push({ qId: null, msg: T('addQuestion', "Kamida 1 ta savol qo'shing") });
    state.questions.forEach((q, i) => {
      if (!q.text.trim()) errors.push({ qId: q.id, msg: `${T('qText', 'Savol')} ${i + 1}: ${T('qTextReq', 'matn kiritilmagan')}` });
      if (q.type === 'short_answer') {
        if (!(q.options[0] || '').trim()) errors.push({ qId: q.id, msg: `${T('qText', 'Savol')} ${i + 1}: ${T('correct', 'to\u2018g\u2018ri javob')} kiritilmagan` });
        return;
      }
      const filled = q.options.filter(o => o.trim());
      if (filled.length < 2) errors.push({ qId: q.id, msg: `${T('qText', 'Savol')} ${i + 1}: ${T('optionsMin', 'kamida 2 ta variant')}` });
      if (filled.length && q.correct >= q.options.length) {
        errors.push({ qId: q.id, msg: `${T('qText', 'Savol')} ${i + 1}: ${T('correct', 'to\u2018g\u2018ri javob')} xato` });
      }
      const dupIdx = dupIndexes(q.options);
      if (dupIdx.length) {
        const names = dupIdx.map(oi => `\u201C${q.options[oi].trim()}\u201D`).join(', ');
        errors.push({ qId: q.id, msg: `${T('qText', 'Savol')} ${i + 1}: ${T('dupOptions', 'bir xil variantlar mumkin emas: {v}').split('{v}').join(names)}` });
      }
    });
    return errors;
  }

  // Bir xil variant indekslari (bo'sh emas, katta-kichik harf farqisiz)
  function dupIndexes(options) {
    const seen = new Map();
    (options || []).forEach((o, oi) => {
      const v = String(o || '').trim().toLowerCase();
      if (!v) return;
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v).push(oi);
    });
    const out = [];
    for (const idxs of seen.values()) if (idxs.length > 1) out.push(...idxs);
    return out;
  }

  // Aktual (faol) savol variantlari ichida bir xillarni jonli belgilaydi
  function updateDupWarn(q) {
    const warn = $('#tb-dup-warn');
    if (!warn || !q || q.type === 'short_answer') return;
    const idxs = dupIndexes(q.options);
    const txt = $('#tb-dup-warn-txt');
    if (idxs.length) {
      const names = [...new Set(idxs.map(oi => q.options[oi].trim()))].map(n => `\u201C${escHtml(n)}\u201D`).join(', ');
      if (txt) txt.textContent = T('dupOptions', 'bir xil variantlar mumkin emas: {v}').split('{v}').join(names);
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
    $$('[data-opt-card]').forEach(card => {
      const oi = parseInt(card.dataset.optCard, 10);
      card.classList.toggle('is-dup', idxs.includes(oi));
    });
  }

  function renderErrors() {
    const errors = validate();
    const summary = $('#tb-err-summary');
    const list = $('#tb-err-list');
    if (!errors.length) {
      summary && summary.classList.remove('is-open');
      return;
    }
    if (list) {
      list.innerHTML = errors.map(e => `<li>${escHtml(e.msg)}</li>`).join('');
    }
    summary && summary.classList.add('is-open');
    // Outline invalid markers
    $$('.tb-outline-item').forEach(item => {
      const id = item.dataset.qid;
      const hasErr = errors.some(e => e.qId === id);
      item.classList.toggle('is-invalid', hasErr);
    });
  }

  // ── Render editor for active question ──
  function render() {
    renderOutline();
    renderEditor();
    renderErrors();
    renderTopbar();
  }

  function renderTopbar() {
    const nameEl = $('#tb-name');
    if (nameEl && document.activeElement !== nameEl) nameEl.value = state.name;
  }

  function renderOutline() {
    const list = $('#tb-outline-list');
    if (!list) return;
    list.innerHTML = state.questions.map((q, i) => {
      const active = q.id === state.activeId ? ' is-active' : '';
      return `<button type="button" class="tb-outline-item${active}" data-qid="${q.id}" data-outline="${q.id}">
        <span class="tb-outline-num">${i + 1}</span>
        <span class="tb-outline-txt">${escHtml(q.text.trim() || '···')}</span>
      </button>`;
    }).join('');
  }

  function renderEditor() {
    const el = $('#tb-q-editor');
    if (!el) return;
    const q = state.questions.find(x => x.id === state.activeId);
    if (!q) {
      el.innerHTML = `<div class="tb-err-summary is-open" style="border-style:dashed">
        <span class="tb-err-summary-title">!</span>
      </div>`;
      el.innerHTML = `<div class="ws-lib-empty"><div class="ws-lib-empty-title">${T('noQuestion', 'Savol tanlanmagan')}</div>
        <div class="ws-lib-empty-sub">${T('noQuestionSub', "Chapdagi ro'yxatdan savol tanlang yoki yangi qo'shing.")}</div>
        <button type="button" class="btn btn-primary" id="tb-empty-add" style="margin-top:12px">+ ${T('addQuestion', "Savol qo'shish")}</button></div>`;
      const add = $('#tb-empty-add');
      if (add) add.addEventListener('click', addQuestion);
      return;
    }

    const idx = state.questions.indexOf(q);
    const qNum = idx + 1;
    /* S34l KAHOOT: har variant shakl belgisi bilan (uchburchak/romb/doira/kvadrat),
       ranglar BIR XIL (binafsha) — qizil FAQAT xato uchun. Variant karta o'zini
       bosish = to'g'ri javob belgilash (Kahoot mantiqi), alohida radio YO'Q. */
    const SHAPES = ['▲', '◆', '●', '■', '★', '⬢'];
    const optsHtml = q.options.map((opt, oi) => `
      <div class="tb-opt${oi === q.correct ? ' is-correct' : ''}" data-opt-card="${oi}" role="radio" aria-checked="${oi === q.correct}" tabindex="0" title="${T('optCardTitle', "Bosib to'g'ri javob deb belgilang")}">
        <span class="tb-opt-shape" aria-hidden="true">${SHAPES[oi] || '■'}</span>
        <input class="inp" type="text" value="${escAttr(opt)}" placeholder="${OPT_LETTERS[oi]}) ${T('optPh', 'variant matni...')}" data-opt="${oi}" aria-label="${T('optAria', 'Variant')} ${OPT_LETTERS[oi]}">
        <button type="button" class="tb-opt-remove" data-opt-remove="${oi}" aria-label="${T('optRemoveAria', "Variantni o'chirish")}" title="${T('optRemoveAria', "Variantni o'chirish")}">×</button>
      </div>`).join('');

    el.innerHTML = `
      <div class="tb-q-head">
        <span class="tb-q-count">${T('qCount', 'Savol {n} / {m}').split('{n}').join(qNum).split('{m}').join(state.questions.length)}</span>
        <div class="tb-reorder">
          <button type="button" class="tb-move" data-move="up" aria-label="${T('moveUpAria', "Yuqoriga ko'chirish")}" title="${T('moveUpAria', "Yuqoriga ko'chirish")}">↑</button>
          <button type="button" class="tb-move" data-move="down" aria-label="${T('moveDownAria', "Pastga ko'chirish")}" title="${T('moveDownAria', "Pastga ko'chirish")}">↓</button>
        </div>
        <div class="tb-q-overflow-wrap">
          <button type="button" class="tb-q-overflow-btn" aria-haspopup="menu" aria-expanded="false" aria-label="${T('qActionsAria', 'Savol amallari')}" data-q-overflow title="${T('qActionsTitle', 'Amallar')}">⋯</button>
          <div class="tb-q-menu" role="menu" data-q-menu>
            <button type="button" role="menuitem" data-act="duplicate"><span>⎕ ${T('duplicate', 'Nusxalash')}</span></button>
            <button type="button" role="menuitem" data-act="delete" class="tb-q-menu-danger"><span>✕ ${T('del', "O'chirish")}</span></button>
          </div>
        </div>
      </div>

      <div class="tb-field${q.text.trim() ? '' : ' is-error'}">
        <label class="tb-field-label" for="tb-q-text">${T('qText', 'Savol matni')} <span class="tb-req">*</span></label>
        <textarea class="inp" id="tb-q-text" rows="3" placeholder="${T('qTextPh', 'Savol matnini kiriting...')}" data-q-text>${escHtml(q.text)}</textarea>
        <span class="tb-field-err">${T('qTextReq', 'Savol matni kiritilishi shart')}</span>
      </div>

      <div class="tb-field">
        <label class="tb-field-label" for="tb-q-type">${T('qType', 'Savol turi')}</label>
        <select class="inp" id="tb-q-type" data-q-type aria-label="${T('qType', 'Savol turi')}">
          <option value="single_choice"${q.type === 'single_choice' ? ' selected' : ''}>${T('typeSingle', 'Yagona tanlov')}</option>
          <option value="true_false"${q.type === 'true_false' ? ' selected' : ''}>${T('typeTrueFalse', "To'g'ri / Noto'g'ri")}</option>
          <option value="multiple_select"${q.type === 'multiple_select' ? ' selected' : ''}>${T('typeMulti', 'Bir nechta tanlov')}</option>
          <option value="short_answer"${q.type === 'short_answer' ? ' selected' : ''}>${T('typeShort', 'Qisqa javob')}</option>
          <option value="exit_ticket"${q.type === 'exit_ticket' ? ' selected' : ''}>${T('typeExit', 'Exit ticket')}</option>
        </select>
        <span class="tb-hint">${T('qTypeHint', 'Cast sessiyalarida ishlatiladigan savol turi')}</span>
        ${q.type === 'multiple_select' ? '<span class="tb-hint" data-multi-note>' + T('multiNote', "Eslatma: to'g'ri javob hozircha bitta radio orqali belgilanadi") + '</span>' : ''}
      </div>

      <div class="tb-props-grid">
        <div class="tb-field">
          <label class="tb-field-label" for="tb-q-timing">${T('time', 'Vaqt (soniya)')}</label>
          <input class="inp" id="tb-q-timing" type="number" min="0" max="600" value="${q.timing || 0}" data-q-timing aria-label="${T('timeAria', 'Savol vaqti')}">
        </div>
        <div class="tb-field">
          <label class="tb-field-label" for="tb-q-tags">${T('tags', 'Teglar (vergul bilan)')}</label>
          <input class="inp" id="tb-q-tags" type="text" value="${escAttr(q.tags.join(', '))}" data-q-tags placeholder="${T('tagsPh', 'masalan: algebra, kirish')}" aria-label="${T('tagsAria', 'Teglar')}">
        </div>
      </div>

      ${q.type === 'short_answer' ? `
        <div class="tb-field">
          <label class="tb-field-label" for="tb-q-answer">${T('shortLabel', "To'g'ri javob")} <span class="tb-req">*</span></label>
          <input class="inp" id="tb-q-answer" type="text" value="${escAttr(q.options[0] || '')}" data-q-answer placeholder="${T('shortPh', 'Kutilgan javob matni...')}" aria-label="${T('shortLabel', "To'g'ri javob")}">
          <span class="tb-hint">${T('shortHint', "O'quvchi yozadigan qisqa javob")}</span>
        </div>
      ` : `
        <div class="tb-field">
          <label class="tb-field-label">${T('options', 'Variantlar')} <span class="tb-req">*</span> <span class="tb-hint">${T('optionsMin', 'kamida 2 ta')}</span></label>
          <div class="tb-options" data-opts-wrap role="radiogroup" aria-label="Variantlar">
            ${optsHtml}
            ${q.options.length < 6 ? `<button type="button" class="btn btn-quiet" data-add-opt style="width:100%">${T('addOption', '+ Variant qo\'shish')}</button>` : ''}
          </div>
        </div>

        <div class="tb-dup-warn" id="tb-dup-warn" role="alert" hidden><span class="tb-dup-warn-ico">⚠</span><span id="tb-dup-warn-txt"></span></div>
        <div class="tb-field">
          <span class="tb-hint" data-correct-hint>${T('correctHint', "✓ To'g'ri javob: variant kartasini bosib belgilanadi (yashil halqa)")}</span>
        </div>
      `}

      <div class="tb-field">
        <label class="tb-field-label" for="tb-q-exp">${T('explanation', 'Tushuntirish (izoh)')}</label>
        <textarea class="inp" id="tb-q-exp" rows="2" placeholder="${T('explanationPh', 'Javob izohi (ixtiyoriy)')}" data-q-exp>${escHtml(q.explanation)}</textarea>
      </div>
    `;
    wireEditorEvents(q);
  }

  // ── Editor events ──
  function wireEditorEvents(q) {
    const text = $('#tb-q-text');
    if (text) text.addEventListener('input', () => { q.text = text.value; markDirty(); renderOutline(); renderErrors(); });

    // Question type (S27.03)
    const typeSel = $('#tb-q-type');
    if (typeSel) typeSel.addEventListener('change', () => {
      const next = typeSel.value;
      if (next === q.type) return;
      q.type = next;
      if (next === 'true_false' && (q.options.filter(o => o.trim()).length < 2)) {
        q.options = ['To‘g‘ri', 'Noto‘g‘ri'];
        q.correct = 0;
      }
      if (next === 'short_answer') {
        // options[0] = expected answer; correct index moot for short answer
        q.options = [q.options[0] || ''];
        q.correct = 0;
      }
      markDirty();
      render();
    });

    // Short answer value (stored in options[0])
    const answer = $('#tb-q-answer');
    if (answer) answer.addEventListener('input', () => {
      q.options[0] = answer.value;
      markDirty();
    });

    const timing = $('#tb-q-timing');
    if (timing) timing.addEventListener('input', () => { q.timing = Math.max(0, parseInt(timing.value || '0', 10)); markDirty(); });

    const tags = $('#tb-q-tags');
    if (tags) tags.addEventListener('input', () => {
      q.tags = tags.value.split(',').map(t => t.trim()).filter(Boolean);
      markDirty();
    });

    const exp = $('#tb-q-exp');
    if (exp) exp.addEventListener('input', () => { q.explanation = exp.value; markDirty(); });

    $$('[data-opt]', $('.tb-editor')).forEach(inp => {
      inp.addEventListener('input', () => {
        const oi = parseInt(inp.dataset.opt, 10);
        q.options[oi] = inp.value;
        markDirty();
        renderErrors();
        updateDupWarn(q);
      });
    });

    /* S34l KAHOOT: variant KARTASINI bosish = to'g'ri javob belgilash */
    $$('[data-opt-card]', $('.tb-editor')).forEach(cardEl => {
      cardEl.addEventListener('click', (ev) => {
        if (ev.target.closest('input, button')) return; /* input/tugmaga tegsa aralashmaymiz */
        const oi = parseInt(cardEl.dataset.optCard, 10);
        if (q.correct === oi) return;
        q.correct = oi;
        markDirty();
        render();
      });
      cardEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const oi = parseInt(cardEl.dataset.optCard, 10);
          if (q.correct !== oi) { q.correct = oi; markDirty(); render(); }
        }
      });
    });

    const addOpt = $('[data-add-opt]');
    if (addOpt) addOpt.addEventListener('click', () => {
      if (q.options.length >= 6) return;
      q.options.push('');
      markDirty();
      render();
    });

    $$('[data-opt-remove]', $('.tb-editor')).forEach(btn => {
      btn.addEventListener('click', () => {
        const oi = parseInt(btn.dataset.optRemove, 10);
        if (q.options.length <= 2) { showToast && showToast(T('minOptions', 'Kamida 2 ta variant bo‘lishi kerak'), 'err'); return; }
        q.options.splice(oi, 1);
        if (q.correct >= q.options.length) q.correct = 0;
        markDirty();
        render();
      });
    });

    // Native radio correct answer (S27.04)
    $$('[data-correct]', $('.tb-editor')).forEach(radio => {
      radio.addEventListener('change', () => {
        q.correct = parseInt(radio.value, 10);
        markDirty();
        render();
      });
    });

    // Reorder (S27.06)
    $$('[data-move]', $('.tb-editor')).forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.move;
        const idx = state.questions.indexOf(q);
        const target = dir === 'up' ? idx - 1 : idx + 1;
        if (target < 0 || target >= state.questions.length) return;
        [state.questions[idx], state.questions[target]] = [state.questions[target], state.questions[idx]];
        markDirty();
        render();
      });
    });

    // Overflow (S27.05)
    const overflowBtn = $('[data-q-overflow]');
    const menu = $('[data-q-menu]');
    if (overflowBtn && menu) {
      overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.classList.toggle('is-open');
        overflowBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      $$('[role="menuitem"]', menu).forEach(item => {
        item.addEventListener('click', () => {
          menu.classList.remove('is-open');
          const act = item.dataset.act;
          if (act === 'duplicate') duplicateQuestion(q.id);
          if (act === 'delete') deleteQuestion(q.id);
        });
      });
    }
    updateDupWarn(q);
  }

  // ── Question ops ──
  function addQuestion() {
    const q = { id: nextId(), text: '', options: ['', '', '', ''], correct: 0, explanation: '', tags: [], timing: DEFAULT_QUESTION_TIME };
    state.questions.push(q);
    state.activeId = q.id;
    markDirty();
    render();
    focusQuestionText();
    closeOutline();
  }

  function duplicateQuestion(id) {
    const idx = state.questions.findIndex(x => x.id === id);
    if (idx < 0) return;
    const src = state.questions[idx];
    const copy = normalize({ ...src, text: src.text ? src.text + ' (nusxa)' : '' }, idx);
    state.questions.splice(idx + 1, 0, copy);
    state.activeId = copy.id;
    markDirty();
    render();
  }

  function deleteQuestion(id) {
    const idx = state.questions.findIndex(x => x.id === id);
    if (idx < 0) return;
    const q = state.questions[idx];
    const doDelete = async () => {
      state.questions.splice(idx, 1);
      if (state.activeId === id) {
        state.activeId = state.questions[idx] ? state.questions[idx].id : (state.questions[idx - 1] || {}).id || null;
      }
      markDirty();
      render();
    };
    if (window.showConfirm) {
      window.showConfirm('Savolni o‘chirish', '«' + (q.text.trim() || 'Savolsiz') + '» savoli o‘chiriladi.', 'O‘chirish').then(ok => ok && doDelete());
    } else {
      doDelete();
    }
  }

  // ── Focus / helpers ──
  function focusQuestionText() {
    setTimeout(() => { const t = $('#tb-q-text'); t && t.focus(); }, 0);
  }
  function closeOutline() {
    const o = $('#tb-outline');
    if (o) o.classList.remove('is-open');
  }

  // ── Unsaved navigation guard (S27.12) ──
  function guardUnload(e) {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  }
  window.addEventListener('beforeunload', guardUnload);
  /* S34p: sahifa yashirilganda AVTOSAVE YO'Q — foydalanuvchi xohlaganda saqlasin
     ("orqaga bosilsa avto saqlayapti bunday emas") */

  /* ── Orqaga havolasi: dirty bo'lsa SO'RASH — Saqla / Yo'q qilish ── */
  const backLink = $('.tb-back');
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      if (!state.dirty) return; // saqlangan — to'g'ridan-to'g'ri
      e.preventDefault();
      const choice = confirm(
        T('unsavedQ', 'Saqlanmagan o\u2018zgarishlar bor. Saqlaysizmi?\n\nOK = saqla va chiqish\nCancel = saqlamasdan chiqish')
      );
      if (choice) {
        // Saqla va chiqish
        state.dirty = false; // guardUnload yana ishga tushmasin
        setStatus('pending', T('statusSaving', 'Saqlanmoqda...'));
        scheduleSave().then(() => { window.location.href = '/user/panel'; });
      } else {
        // Saqlamasdan chiqish
        state.dirty = false;
        clearTimeout(saveTimer);
        window.location.href = '/user/panel';
      }
    });
  }

  // ── Outline events (delegation) ──
  const outlineList = $('#tb-outline-list');
  if (outlineList) {
    outlineList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-outline]');
      if (!item) return;
      state.activeId = item.dataset.qid;
      render();
      closeOutline();
      focusQuestionText();
    });
  }

  // ── Global buttons ──
  const addBtn = $('#tb-add-question');
  if (addBtn) addBtn.addEventListener('click', addQuestion);
  const addOutline = $('#tb-add-outline');
  if (addOutline) addOutline.addEventListener('click', addQuestion);
  const saveBtn = $('#tb-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', manualSave);
  const previewBtn = $('#tb-preview-btn');
  if (previewBtn) {
    previewBtn.addEventListener('click', async () => {
      if (!state.questions.length) { showToast && showToast(T('noFirstQuestion', "Avval savol qo'shing"), 'err'); return; }
      /* S34o: Ko'rish = YAKKA MASHQ (arena emas). Saqlanmagan bo'lsa avval saqlaymiz. */
      if (state.dirty || !init.editKey) {
        previewBtn.disabled = true;
        await scheduleSave();
        previewBtn.disabled = false;
        if (!init.editKey) { showToast && showToast(T('statusSaveErr', 'Saqlashda xato'), 'err'); return; }
      }
      window.location.href = '/user/practice?source=user&key=' + encodeURIComponent(init.editKey);
    });
  }
  const outlineOpen = $('#tb-outline-open');
  if (outlineOpen) outlineOpen.addEventListener('click', () => $('#tb-outline') && $('#tb-outline').classList.add('is-open'));
  const outlineClose = $('#tb-outline-close');
  if (outlineClose) outlineClose.addEventListener('click', closeOutline);

  // ── Close menus on outside click ──
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-q-overflow]')) {
      $$('.tb-q-menu.is-open').forEach(m => m.classList.remove('is-open'));
      const b = $('[data-q-overflow][aria-expanded="true"]');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  });

  // ── Excel import (09/2026 user qarori: bitta oddiy panel — bosqichlar yo'q) ──
  let importData = null;
  const importModal = $('#tb-import-modal');
  const importBtn = $('#tb-import-btn');
  if (importBtn && importModal) {
    importBtn.addEventListener('click', openImport);
    $('#tb-import-close').addEventListener('click', closeImport);
    $('#tb-import-cancel').addEventListener('click', closeImport);
    importModal.addEventListener('click', (e) => { if (e.target === importModal) closeImport(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !importModal.hidden) { e.preventDefault(); closeImport(); }
    });

    const zone = $('#tb-import-zone');
    const input = $('#tb-import-input');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-drag'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('is-drag'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('is-drag');
      const f = e.dataTransfer.files[0];
      if (f) { input.files = e.dataTransfer.files; parseExcel(f); }
    });
    input.addEventListener('change', () => { const f = input.files[0]; f && parseExcel(f); });

    $('#tb-template-btn').addEventListener('click', downloadTemplate);
    $('#tb-import-confirm').addEventListener('click', confirmImport);
    $('#tb-import-finish').addEventListener('click', closeImport);
  }

  function showImportStage(name) {
    $$('.tb-import-stage').forEach((s) => { s.hidden = s.dataset.importStage !== name; });
    const confirmBtn = $('#tb-import-confirm');
    const finishBtn = $('#tb-import-finish');
    if (confirmBtn) {
      const n = importData && importData.length ? importData.length : 0;
      const lbl = $('#tb-import-confirm-lbl');
      if (lbl) lbl.textContent = n ? T('importAdd', "Qo'shish") + ' (' + n + ')' : T('importAdd', "Qo'shish");
      confirmBtn.hidden = name === 'done';
      confirmBtn.disabled = name !== 'review' || n === 0;
    }
    if (finishBtn) finishBtn.hidden = name !== 'done';
  }
  function clearImportMsgs() {
    ['tb-import-msg', 'tb-import-parse-msg'].forEach((id) => {
      const m = $(id);
      if (m) { m.textContent = ''; m.classList.remove('is-open', 'is-err', 'is-ok'); }
    });
  }
  function openImport() {
    importData = null;
    $('#tb-import-input').value = '';
    const preview = $('#tb-import-preview');
    if (preview) preview.innerHTML = '';
    clearImportMsgs();
    showImportStage('pick');
    importModal.hidden = false;
    const zone = $('#tb-import-zone');
    if (zone) setTimeout(() => zone.focus(), 50);
  }
  function closeImport() {
    importModal.hidden = true;
    importData = null;
  }
  function importMsg(el, txt, type) {
    el.textContent = txt;
    el.classList.add('is-open', type === 'err' ? 'is-err' : 'is-ok');
    el.classList.remove(type === 'err' ? 'is-ok' : 'is-err');
  }

  function parseExcel(file) {
    const msg = $('#tb-import-parse-msg');
    if (typeof XLSX === 'undefined') {
      importMsg(msg, T('impXlsxNo', 'XLSX kutubxonasi yuklanmadi. Internet ulanishini tekshiring.'), 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const parsed = [];
        const rowErrors = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r) continue;
          const text = String(r[0] || '').trim();
          const emptyRow = !text && !String(r[1] || '').trim() && !String(r[2] || '').trim() && !String(r[3] || '').trim() && !String(r[4] || '').trim();
          if (emptyRow) continue; // bo'sh qator — shunchaki o'tkazib yuboriladi
          const opts = [String(r[1] || '').trim(), String(r[2] || '').trim(), String(r[3] || '').trim(), String(r[4] || '').trim()];
          const correctIdx = parseInt(r[5], 10);
          const explanation = String(r[6] || '').trim();
          if (!text) { rowErrors.push({ row: i + 1, msg: T('impRowNoText', 'Savol matni bosh') }); continue; }
          if (opts.filter(Boolean).length < 2) { rowErrors.push({ row: i + 1, msg: T('impRowMinOpt', 'Kamida 2 variant') }); continue; }
          if (isNaN(correctIdx) || correctIdx < 0 || correctIdx > 3) { rowErrors.push({ row: i + 1, msg: T('impRowIdx', "To'g'ri javob 0-3 oralig'ida") }); continue; }
          // bir xil variantlar (import'da ham) — ogohlantirish
          const seen = new Set(); const dups = [];
          opts.forEach((o) => { const k = o.toLowerCase(); if (o && seen.has(k) && !dups.includes(o)) dups.push(o); seen.add(k); });
          if (dups.length) { rowErrors.push({ row: i + 1, msg: T('impRowDup', 'Bir xil variantlar: {v}').split('{v}').join(dups.join(', ')) }); continue; }
          parsed.push({ text, options: opts, correct: correctIdx, explanation });
        }
        importData = parsed;
        renderPreview(parsed, rowErrors);
        const parseMsg = $('#tb-import-parse-msg');
        const pv = $('#tb-import-preview');
        if (pv) pv.scrollTop = 0;
        if (rowErrors.length) importMsg(parseMsg, T('impReadyErr', '{n} ta savol tayyor, {m} ta qator xato').split('{n}').join(parsed.length).split('{m}').join(rowErrors.length), 'err');
        else importMsg(parseMsg, T('impReady', '{n} ta savol tayyor').split('{n}').join(parsed.length), 'ok');
        if (parsed.length || rowErrors.length) showImportStage('review');
        else importMsg($('#tb-import-msg'), T('impNoRows', 'Faylda savol topilmadi'), 'err');
      } catch (err) {
        importMsg(msg, T('impReadFail', "Fayl o'qilmadi: {err}").split('{err}').join(err.message), 'err');
      }
    };
    reader.readAsBinaryString(file);
  }

  function renderPreview(parsed, rowErrors) {
    const wrap = $('#tb-import-preview');
    if (!wrap) return;
    if (!parsed.length && !rowErrors.length) { wrap.innerHTML = '<div class="tb-ip-empty">' + T('impNoRows', 'Faylda savol topilmadi') + '</div>'; return; }
    // Karta ko'rinishi: har savol o'z kartasida; to'g'ri variant yashil halqa, xato qatorlar alohida
    const cards = parsed.map((p, i) => {
      const opts = p.options.map((o, oi) => {
        const cls = oi === p.correct ? ' is-correct' : '';
        const letter = p.correct === oi ? '✓' : OPT_LETTERS[oi];
        return `<li class="tb-ip-opt${cls}"><span class="tb-ip-opt-letter">${letter}</span><span class="tb-ip-opt-txt">${escHtml(o)}</span></li>`;
      }).join('');
      const exp = p.explanation ? `<div class="tb-ip-exp">${T('impExplainTag', 'Izoh')}: ${escHtml(p.explanation)}</div>` : '';
      return `<div class="tb-ip-card">
        <div class="tb-ip-q"><span class="tb-ip-num">${i + 1}</span><span class="tb-ip-q-txt">${escHtml(p.text)}</span></div>
        <ul class="tb-ip-opts">${opts}</ul>${exp}
      </div>`;
    }).join('');
    const errs = rowErrors.length ? `<div class="tb-ip-errors" role="alert"><div class="tb-ip-errors-title">${T('impErrTitle', 'Xato qatorlar')}:</div><ul>${rowErrors.map(e => `<li>${T('impRowLabel', 'Qator {n}').split('{n}').join(e.row)}: ${escHtml(e.msg)}</li>`).join('')}</ul></div>` : '';
    wrap.innerHTML = `<div class="tb-ip-list">${cards}${errs}</div>`;
  }

  function confirmImport() {
    if (!importData || !importData.length) return;
    const firstIdx = state.questions.length;
    importData.forEach(q => state.questions.push(normalize(q)));
    state.activeId = state.questions[state.questions.length - 1].id;
    // Darhol ko'rinadigan natija: ro'yxat + editor yangilanadi, so'ng tez saqlash
    render();
    renderErrors();
    manualSave().catch(() => {});
    if (firstIdx === 0) focusQuestionText();
    $('#tb-import-done-txt').textContent = `${importData.length} ${T('impDoneCount', "ta savol qo'shildi va saqlandi")}`;
    showImportStage('done');
  }

  function downloadTemplate() {
    if (typeof XLSX === 'undefined') { showToast && showToast(T('impXlsxShort', 'XLSX kutubxonasi yuklanmadi'), 'err'); return; }
    const wb = XLSX.utils.book_new();
    const tplHead = T('impSheetHeader', ['Savol', 'Variant A', 'Variant B', 'Variant C', 'Variant D', "To'g'ri javob (0-3)", 'Izoh (ixtiyoriy)']);
    const samples = T('impSamples', [
      ['O\'zbekiston poytaxti qaysi shahar?', 'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 0, 'Geografiya — poytaxtlar'],
      ['2 + 3 × 4 nechaga teng?', '20', '14', '24', '12', 1, 'Amallar tartibi: birinchi ko\'paytirish'],
      ['Quyosh tizimidagi eng katta sayyora qaysi?', 'Saturn', 'Yer', 'Yupiter', 'Mars', 2, 'Yupiter — eng katta gaz giganti'],
      ['9 ning kvadrati nechaga teng?', '18', '81', '27', '90', 1, '9 × 9 = 81'],
      ['Kvadratning barcha tomonlari...', 'har xil', 'teng', 'juft', 'qisqa', 1, 'Kvadrat — hamma tomoni teng'],
    ]);
    const data = [tplHead].concat(samples);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), T('impSheetName', 'Savollar'));
    XLSX.writeFile(wb, 'deborah-template.xlsx');
  }

  // ── Escape helpers ──
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escAttr(s) {
    return escHtml(s);
  }

  // ── Boot ──
  if (init.name) {
    const nameEl = $('#tb-name');
    if (nameEl) nameEl.value = init.name;
  }
  const nameInput = $('#tb-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => { state.name = nameInput.value; markDirty(); });
  }

  if (state.questions.length) {
    state.activeId = state.questions[0].id;
  }

  render();
})();
