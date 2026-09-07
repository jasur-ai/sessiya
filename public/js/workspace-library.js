/* ═══════════════════════════════════════════════════════════════
   STEP 26 — Test library interactions (S26.03-06, 08-12)
   Filter/sort/search (URL state), overflow menu (APG menu pattern),
   object-named delete confirm, visibility toggle, duplicate/export.
   Defer yuklanadi — DOMContentLoaded'da ishga tushadi.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function initLibrary() {
    const list = document.getElementById('lib-list');
    const empty = document.getElementById('lib-empty');
    const none = document.getElementById('lib-none');
    const count = document.getElementById('lib-count');
    const active = document.getElementById('lib-active');
    const search = document.getElementById('lib-search');
    const subject = document.getElementById('lib-subject');
    const typeSel = document.getElementById('lib-type');
    const sort = document.getElementById('lib-sort');
    if (!list) return; // Panel sahifasida emas

    const rows = $$('.ws-lib-row', list);
    const state = loadState();
    let searchTimer = null;

    // ── Panel i18n dynamic fragmentlar (window.__PT/__PF asosi) ──
    const L = (k, fb) => (typeof window.__PT === 'function') ? window.__PT(k, fb) : (fb !== undefined ? fb : '');
    function plurLang() { return (typeof window.__PANEL_LANG !== 'undefined') ? window.__PANEL_LANG : 'uz'; }
    function pluralIdx(n, forms) {
      const lang = plurLang();
      if (lang === 'ru') {
        if (n % 10 === 1 && n % 100 !== 11) return 0;
        if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return 1;
        return forms.length > 2 ? 2 : 1;
      }
      if (lang === 'en') return n === 1 ? 0 : (forms.length > 1 ? 1 : 0);
      return 0;
    }
    function countFmt(k, n, fb) {
      let raw = fb;
      const P = window.__PANEL_COPY || {};
      const d = P[plurLang()];
      if (d && d[k] !== undefined) raw = d[k];
      const forms = String(raw).split('|');
      const tpl = forms.length > 1 ? (forms[pluralIdx(n, forms)] || forms[0]) : forms[0];
      return String(tpl).split('{n}').join('<b>' + n + '</b>');
    }

    // ── Saved filter return (S26.12): URL'da ?lib=… → state'ga yuklash ──
    function loadState() {
      const s = { q: '', subject: '', type: '', sort: 'new' };
      try {
        const params = new URLSearchParams(window.location.search);
        const lib = params.get('lib');
        if (lib) {
          try {
            const parts = JSON.parse(decodeURIComponent(lib));
            if (Array.isArray(parts)) {
              s.q = parts[0] || '';
              s.subject = parts[1] || '';
              s.type = parts[2] || '';
              s.sort = parts[3] || 'new';
            }
          } catch (_) { /* eski | formatiga fallback */
            const parts = lib.split('|');
            s.q = parts[0] || '';
            s.subject = parts[1] || '';
            s.type = parts[2] || '';
            s.sort = parts[3] || 'new';
          }
        }
      } catch (_) { /* ignore */ }
      return s;
    }

    function pushState() {
      try {
        const url = new URL(window.location.href);
        const hasFilter = state.q || state.subject || state.type || state.sort !== 'new';
        if (hasFilter) {
          url.searchParams.set('lib', encodeURIComponent(JSON.stringify([state.q, state.subject, state.type, state.sort])));
        } else {
          url.searchParams.delete('lib');
        }
        window.history.replaceState({}, '', url);
      } catch (_) { /* ignore */ }
    }

    // ── Render ──
    function applyFilters() {
      const q = state.q.toLowerCase().trim();
      const subjectVal = state.subject;
      const typeVal = state.type;

      let visible = rows.filter((row) => {
        const name = (row.dataset.name || '').toLowerCase();
        if (q && !name.includes(q)) return false;
        if (subjectVal && row.dataset.subject !== subjectVal) return false;
        if (typeVal && row.dataset.type !== typeVal) return false;
        return true;
      });

      // Sort
      visible.sort((a, b) => {
        if (state.sort === 'old') return (+a.dataset.created) - (+b.dataset.created);
        if (state.sort === 'name') return (a.dataset.name || '').localeCompare(b.dataset.name || '');
        if (state.sort === 'count') {
          const ca = parseInt(a.dataset.count || '0', 10);
          const cb = parseInt(b.dataset.count || '0', 10);
          return cb - ca;
        }
        return (+b.dataset.created) - (+a.dataset.created); // 'new' default
      });

      visible.forEach((row) => { row.hidden = false; });
      rows.forEach((row) => { if (!visible.includes(row)) row.hidden = true; });

      // States: empty library (no rows at all) / filtered none / normal
      const hasAny = rows.length > 0;
      const hasVisible = visible.length > 0;
      if (empty) empty.hidden = hasAny;
      if (none) none.hidden = !hasAny || hasVisible || !hasFilterActive();
      if (count) {
        const total = hasAny ? rows.length : 0;
        if (hasFilterActive()) {
          const f = L('lib.countF', '<b>{v}</b> / <b>{t}</b> ta test');
          count.innerHTML = f.split('{v}').join('<b>' + visible.length + '</b>').split('{t}').join('<b>' + total + '</b>');
        } else {
          count.innerHTML = countFmt('fl.count', total, '{n} ta test');
        }
      }
      renderChips();
      pushState();
    }

    function hasFilterActive() {
      return !!(state.q || state.subject || state.type || state.sort !== 'new');
    }

    // ── Chips (S26.06) — tilga bog'liq label'lar i18n kalitlari orqali ──
    const CHIP_LABELS = { q: 'fl.search', subject: 'fl.subject', type: 'fl.type', sort: 'fl.sort' };
    function chipLabel(tok) { return L(CHIP_LABELS[tok] || '', tok); }
    function chip(tok, value) {
      const lab = chipLabel(tok);
      const aria = L('fl.removeAria', '{label} filtrini olib tashlash').split('{label}').join(lab);
      return `<span class="ws-lib-chip">${lab}: <strong>${escHtml(value)}</strong> ` +
        `<button type="button" aria-label="${aria}" data-chip-clear="${tok}">${iconSvg('x', 12)}</button></span>`;
    }
    function sortChipValue(v) {
      const map = { old: 'fl.oldest', name: 'fl.byName', count: 'fl.byCount' };
      return L(map[v] || '', v);
    }
    function renderChips() {
      if (!active) return;
      const chips = [];
      if (state.q) chips.push(chip('q', state.q));
      if (state.subject) chips.push(chip('subject', state.subject));
      if (state.type) chips.push(chip('type', state.type === 'variant' ? L('fl.variant', 'Variantli') : L('fl.open', 'Ochiq')));
      if (state.sort !== 'new') chips.push(chip('sort', sortChipValue(state.sort)));
      if (!chips.length) { active.hidden = true; return; }
      active.hidden = false;
      active.innerHTML = chips.join('') +
        '<button type="button" class="ws-lib-clear" id="lib-clear-all">' + L('lib.clearAll', 'Hammasini tozalash') + '</button>';
      const clearAll = $('#lib-clear-all', active);
      if (clearAll) clearAll.addEventListener('click', clearAllFilters);
    }

    function clearAllFilters() {
      state.q = ''; state.subject = ''; state.type = ''; state.sort = 'new';
      if (search) search.value = '';
      if (subject) subject.value = '';
      if (typeSel) typeSel.value = '';
      if (sort) sort.value = 'new';
      applyFilters();
    }

    // ── Events ──
    if (search) {
      search.value = state.q;
      search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { state.q = search.value; applyFilters(); }, 220);
      });
    }
    if (subject) {
      subject.value = state.subject;
      subject.addEventListener('change', () => { state.subject = subject.value; applyFilters(); });
    }
    if (typeSel) {
      typeSel.value = state.type;
      typeSel.addEventListener('change', () => { state.type = typeSel.value; applyFilters(); });
    }
    if (sort) {
      sort.value = state.sort;
      sort.addEventListener('change', () => { state.sort = sort.value; applyFilters(); });
    }
    if (active) {
      active.addEventListener('click', (e) => {
        const clearBtn = e.target.closest('[data-chip-clear]');
        if (clearBtn) {
          const tok = clearBtn.dataset.chipClear;
          if (tok === 'q') { state.q = ''; if (search) search.value = ''; }
          if (tok === 'subject') { state.subject = ''; if (subject) subject.value = ''; }
          if (tok === 'type') { state.type = ''; if (typeSel) typeSel.value = ''; }
          if (tok === 'sort') { state.sort = 'new'; if (sort) sort.value = 'new'; }
          applyFilters();
        }
      });
    }
    const clearNone = document.getElementById('lib-clear-none');
    if (clearNone) clearNone.addEventListener('click', clearAllFilters);

    // ── Overflow menu (S26.03 — APG menu pattern) ──
    let openMenu = null;

    function closeMenu() {
      if (!openMenu) return;
      const wrap = openMenu.closest('.ws-lib-overflow-wrap');
      const btn = wrap && $('.ws-lib-overflow-btn', wrap);
      if (btn) btn.setAttribute('aria-expanded', 'false');
      openMenu.classList.remove('is-open');
      openMenu = null;
    }

    document.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('.ws-lib-overflow-btn');
      if (toggleBtn) {
        e.stopPropagation();
        const wrap = toggleBtn.closest('.ws-lib-overflow-wrap');
        const menu = wrap && $('.ws-lib-menu', wrap);
        if (!menu) return;
        if (openMenu === menu) { closeMenu(); return; }
        closeMenu();
        openMenu = menu;
        openMenu.classList.add('is-open');
        toggleBtn.setAttribute('aria-expanded', 'true');
        return;
      }
      closeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (!openMenu) return;
      if (e.key === 'Escape') { closeMenu(); return; }
      const items = $$('[role="menuitem"]', openMenu);
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0] && items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1] && items[items.length - 1].focus(); }
    });

    // ── Menu actions (S26.03/04/05) ──
    list.addEventListener('click', async (e) => {
      const item = e.target.closest('[role="menuitem"]');
      if (!item) return;
      e.preventDefault();
      closeMenu();
      const act = item.dataset.act;
      const key = item.dataset.key;

      if (act === 'edit') { window.location.href = '/user/create-test?edit=' + key; return; }
      if (act === 'practice') {
        const name = item.dataset.name || '';
        const count = parseInt(item.dataset.count || '0', 10);
        window.openStartModal && window.openStartModal(name, count, '/user/test-arena?source=user&key=' + key);
        return;
      }
      if (act === 'duplicate') { await apiAction('/user/api/tests/duplicate', { key }, L('act.dupOk', 'Nusxa yaratildi'), L('act.dupErr', 'Nusxalashda xato')); return; }
      if (act === 'visibility') { await apiAction('/user/api/tests/toggle-public', { key }, L('act.visOk', 'Holat o\'zgartirildi'), L('act.visErr', 'Holatni o\'zgartirib bo\'lmadi')); return; }
      if (act === 'archive') {
        const isArchived = item.closest('.ws-lib-row')?.dataset.archived === '1';
        await apiAction('/user/api/tests/archive', { key, archived: !isArchived }, isArchived ? L('act.archBackOk', 'Arxivdan qaytarildi') : L('act.archOk', 'Arxivlandi'), L('act.archErr', 'Arxivlashda xato'));
        return;
      }
      if (act === 'export') { window.location.href = '/user/api/tests/export?key=' + encodeURIComponent(key); return; }
      if (act === 'delete') {
        // S26.04: object-named danger confirm (i18n)
        const name = item.dataset.name || 'test';
        const ok = await window.showConfirm && window.showConfirm(
          L('act.delTitle', 'Testni o\'chirish'),
          L('act.delMsg', '«{name}» testi butunlay o\'chiriladi. Bu amalni ortga qaytarib bo\'lmaydi.').split('{name}').join(name),
          L('act.delCta', 'O\'chirish'),
          L('ui.cancel', 'Bekor')
        );
        if (!ok) return;
        const res = await fetch('/user/api/tests/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        const data = await res.json();
        if (data.success) {
          window.showToast && window.showToast(L('act.delOk', 'Test o\'chirildi'), 'ok');
          // BUG-030: sahifa reload'i ("ikki marta bosdim" hissi manbai) o'rniga —
          // qator joyida o'chiriladi, hisoblagich/bo'sh-holat qayta hisoblanadi
          const row = item.closest('.ws-lib-row');
          const idx = rows.indexOf(row);
          if (idx !== -1) rows.splice(idx, 1);
          if (row) row.remove();
          applyFilters();
        } else {
          window.showToast && window.showToast(L('err.prefix', 'Xato: ') + (data.error || ''), 'err');
        }
      }
    });

    async function apiAction(url, body, okMsg, errMsg) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN || '',
          },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) {
          window.showToast && window.showToast(okMsg, 'ok');
          window.location.reload();
        } else {
          window.showToast && window.showToast(L('err.prefix', 'Xato: ') + (data.error ? errMsg + ': ' + data.error : errMsg), 'err');
        }
      } catch (err) {
        window.showToast && window.showToast(L('err.prefix', 'Xato: ') + errMsg + ': ' + err.message, 'err');
      }
    }

    applyFilters();
  }

  // ── Helpers ──
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function iconSvg(name, size) {
    const svg = window.svgIcon;
    if (typeof svg === 'function') return svg(name, size);
    return '';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLibrary);
  } else {
    initLibrary();
  }
})();
