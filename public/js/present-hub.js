/* ═══════════════════════════════════════════════════════════════
   Presentations hub — ro'yxat, yaratish (Google Slides/Canva uslubi,
   bo'sh yoki testdan), ochish/taqdim etish, ⋮ menyu (nom/nusxa/arxiv/
   o'chirish). Defer — DOMContentLoaded'da ishga tushadi.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const toast = $('#ps-toast');
  let toastIv = null;
  function say(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastIv);
    toastIv = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function openModal(id) { const m = $('#' + id); if (m) m.hidden = false; }
  function closeModal(id) { const m = $('#' + id); if (m) m.hidden = true; }
  function csrf() {
    const el = document.querySelector('input[name=_csrf]');
    return el ? el.value : '';
  }

  async function api(url, body, method) {
    const res = await fetch(url, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  }

  function loc(href) { window.location.href = href; }

  // ── Create modal ──
  const createOpeners = $$('#prs-create-open, #prs-create-open-2');
  createOpeners.forEach((b) => b.addEventListener('click', () => {
    $('#prs-start-test') && testsDisabled();
    const startTest = $('input[name="prs-start"][value="test"]');
    if (startTest && startTest.disabled) { $('input[name="prs-start"][value="blank"]').checked = true; $('#prs-test-pick').hidden = true; }
    openModal('prs-create');
    setTimeout(() => { const n = $('#prs-name'); if (n) n.focus(); }, 60);
  }));

  // Engine card radio visual
  $$('.ps-engine-card').forEach((card) => {
    card.addEventListener('click', () => {
      $$('.ps-engine-card').forEach((c) => c.classList.remove('on'));
      card.classList.add('on');
      const r = card.querySelector('input');
      if (r) r.checked = true;
    });
  });
  // Start radio → test select
  $$('input[name="prs-start"]').forEach((r) => r.addEventListener('change', () => {
    $('#prs-test-pick').hidden = r.value !== 'test';
  }));
  // Enter in name → create
  const nameInp = $('#prs-name');
  if (nameInp) nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') createGo(); });

  function selectedEngine() {
    const r = document.querySelector('input[name="prs-engine"]:checked');
    return r ? r.value : 'slides';
  }

  async function createGo() {
    const btn = $('#prs-create-go');
    const name = ($('#prs-name').value || '').trim();
    const start = (document.querySelector('input[name="prs-start"]:checked') || { value: 'blank' }).value;
    const engine = selectedEngine();
    btn.disabled = true;
    try {
      const body = { name, engine, start };
      if (start === 'test') {
        const sel = $('#prs-test-key');
        if (!sel || !sel.value) { say('Test tanlang'); btn.disabled = false; return; }
        body.testKey = sel.value;
      }
      const data = await api('/user/api/presentations', body);
      loc('/user/presentations/' + encodeURIComponent(data.key) + '/edit');
    } catch (e) { say(e.message); btn.disabled = false; }
  }
  const goBtn = $('#prs-create-go');
  if (goBtn) goBtn.addEventListener('click', createGo);

  // ── Card click / actions ──
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      $$('.ps-modal-overlay').forEach((m) => { m.hidden = true; });
      return;
    }
    const menuBtn = e.target.closest('[data-act="menu"]');
    if (menuBtn) {
      e.stopPropagation();
      const card = menuBtn.closest('.ps-card');
      const pop = card && card.querySelector('.ps-pop');
      $$('.ps-pop').forEach((p) => { p.hidden = true; });
      if (pop) pop.hidden = !pop.hidden;
      return;
    }
    const actBtn = e.target.closest('.ps-pop button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const card = actBtn.closest('.ps-card');
      const key = card && card.dataset.key;
      const name = card && card.dataset.name;
      const act = actBtn.dataset.act;
      if (!key) return;
      const pop = card.querySelector('.ps-pop');
      if (pop) pop.hidden = true;
      if (act === 'open') { loc('/user/presentations/' + key + '/edit'); return; }
      if (act === 'unarchive') { runAct('archive', key, false); return; }
      if (act === 'archive') { runAct('archive', key, true); return; }
      if (act === 'dup') { runAct('duplicate', key); return; }
      if (act === 'delete') { deleteDeck(key, name); return; }
      if (act === 'rename') { openRename(key, name); return; }
      return;
    }
    const card = e.target.closest('.ps-card');
    if (card && card.dataset.key) {
      const key = card.dataset.key;
      if (key && !card.closest('[data-act]')) loc('/user/presentations/' + key + '/edit');
    }
  });

  // card keyboard enter
  $$('.ps-card').forEach((c) => c.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && c.dataset.key) loc('/user/presentations/' + c.dataset.key + '/edit');
  }));

  async function runAct(act, key, extra) {
    try {
      const data = await api('/user/api/presentations/' + key + '/' + (act === 'unarchive' || act === 'archive' ? 'archive' : act), act === 'archive' || act === 'unarchive' ? { archived: extra } : {});
      if (act === 'duplicate' && data.key) loc('/user/presentations/' + data.key + '/edit');
      else window.location.reload();
    } catch (e) { say(e.message); }
  }

  async function deleteDeck(key, name) {
    const ok = window.confirm('«' + (name || '') + '» — o‘chirishni tasdiqlaysizmi?');
    if (!ok) return;
    try { await api('/user/api/presentations/' + key + '/delete', {}); window.location.reload(); }
    catch (e) { say(e.message); }
  }

  // ── Rename ──
  let renameKey = null;
  function openRename(key, name) {
    renameKey = key;
    const inp = $('#prs-rename-name');
    inp.value = name || '';
    openModal('prs-rename');
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
  }
  $('#prs-rename-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') renameGo(); });
  $('#prs-rename-go').addEventListener('click', renameGo);
  async function renameGo() {
    if (!renameKey) return;
    const name = $('#prs-rename-name').value.trim();
    if (!name) { say('Nom kiriting'); return; }
    try {
      await api('/user/api/presentations/' + renameKey + '/rename', { name });
      window.location.reload();
    } catch (e) { say(e.message); }
  }
})();
