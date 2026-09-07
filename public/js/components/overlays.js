/**
 * S15 — Overlays: Dialog, Popover, Tooltip, Toast.
 * showToast/showConfirm — eski main.js API bilan to'liq mos (8 view ishlatadi),
 * lekin endi reusable semantic component'lar asosida, inline CSS YO'Q.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__deborahOverlays) return;
  window.__deborahOverlays = true;

  const SVG = {
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    alert: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };
  const TOAST_ICONS = { success: 'check', info: 'info', warning: 'warn', error: 'alert' };
  // eski type'lar → yangi variantlar
  const TOAST_MAP = { ok: 'success', err: 'error' };

  /* ─────────────────────────── Toast ─────────────────────────── */

  function ensureRegion() {
    let region = document.querySelector('.toast-region');
    if (!region) {
      region = document.createElement('div');
      region.className = 'toast-region';
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'false');
      document.body.appendChild(region);
    }
    // S15.10: max 3 — eng eskisini o'chiramiz
    while (region.children.length >= 3) {
      const oldest = region.firstElementChild;
      if (oldest) oldest.remove();
    }
    return region;
  }

  function showToast(message, type, duration) {
    if (typeof type === 'number' && duration === undefined) { duration = type; type = 'ok'; }
    // S15.09: bare showToast(msg) default 'success' (eski 'ok' bilan mos)
    const variant = TOAST_MAP[type] || type || 'success';
    const safeTypes = ['success', 'info', 'warning', 'error'];
    const v = safeTypes.includes(variant) ? variant : 'info';
    const ms = typeof duration === 'number' ? duration : 2000;

    const region = ensureRegion();
    const toast = document.createElement('div');
    toast.className = 'toast toast--' + v + ' is-in';
    toast.setAttribute('role', 'status');
    // S15.09: critical error — live-region assertive (faqat toast emas)
    if (v === 'error') {
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'assertive');
    }
    toast.innerHTML =
      '<span class="toast__icon" aria-hidden="true">' + (SVG[TOAST_ICONS[v]] || SVG.info) + '</span>' +
      '<span class="toast__msg"></span>' +
      '<button type="button" class="toast__close" aria-label="Yopish">' + SVG.x + '</button>';
    toast.querySelector('.toast__msg').textContent = String(message);
    region.appendChild(toast);

    const close = () => {
      toast.classList.remove('is-in');
      toast.classList.add('is-out');
      setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector('.toast__close').addEventListener('click', close);
    if (ms > 0) setTimeout(close, ms);
    return toast;
  }

  /* ─────────────────────── Confirm dialog ─────────────────────── */

  // S15.02/04: confirm — sm variant, focus danger action'ga AUTO tushmaydi
  function showConfirm(title, sub, okText) {
    return new Promise(function (resolve) {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialog dialog--sm dialog--danger';
      dlg.setAttribute('aria-labelledby', 'dlg-c-title');
      dlg.innerHTML =
        '<div class="dialog__header">' +
        '  <h3 class="dialog__title" id="dlg-c-title"></h3>' +
        '  <button type="button" class="dialog__close" data-close aria-label="Yopish">' + SVG.x + '</button>' +
        '</div>' +
        '<div class="dialog__body"><p class="dlg-confirm-sub" style="margin:0;color:var(--deborah-semantic-color-text-secondary,#5b6472);font-size:.875rem;line-height:1.6"></p></div>' +
        '<div class="dialog__footer">' +
        '  <button type="button" class="btn btn-quiet" data-no>Bekor</button>' +
        '  <button type="button" class="btn btn-danger" data-yes></button>' +
        '</div>';
      dlg.querySelector('[data-no]').textContent = 'Bekor';
      dlg.querySelector('[data-yes]').textContent = okText || 'Ha';
      dlg.querySelector('#dlg-c-title').textContent = title || '';
      dlg.querySelector('.dlg-confirm-sub').textContent = sub || '';
      document.body.appendChild(dlg);

      const done = (val) => {
        // S15.06: exit motion 150ms, keyin close + trigger focus restore
        dlg.classList.add('is-closing');
        const prev = dlg.__trigger;
        setTimeout(() => {
          dlg.close();
          dlg.remove();
          // S15.05: trigger focus restore — dialog to'liq yopilgandan KEYIN
          if (prev && prev.focus) prev.focus();
        }, 150);
        resolve(val);
      };
      dlg.__trigger = document.activeElement;

      dlg.querySelector('[data-no]').addEventListener('click', () => done(false));
      dlg.querySelector('[data-yes]').addEventListener('click', () => done(true));
      dlg.querySelector('[data-close]').addEventListener('click', () => done(false));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) done(false); // S15.05: overlay click
      });
      // S15.04: initial focus — xavfsiz: cancel button, danger actionga emas
      focusTrap(dlg);
      dlg.showModal();
      dlg.querySelector('[data-no]').focus();
    });
  }

  /* ─────────────────────────── Dialog ─────────────────────────── */

  // Generic dialog: markaziy boshqaruvchi. Markup'da <dialog class="dialog">
  // element mavjud bo'ladi; showDialog(markup, {onOpen, onClose, focus}) ishlaydi.
  function openDialog(dlg, opts) {
    opts = opts || {};
    if (!dlg || typeof dlg.showModal !== 'function') return;
    dlg.__trigger = document.activeElement;
    if (opts.focus) dlg.__initialFocus = opts.focus;
    focusTrap(dlg);
    if (opts.onClose) dlg.addEventListener('close', () => opts.onClose(dlg), { once: true });
    dlg.showModal();
    const target = dlg.__initialFocus ? dlg.querySelector(dlg.__initialFocus) : null;
    (target || dlg.querySelector('[autofocus]') || dlg.querySelector('input, select, textarea') || dlg.querySelector('[data-default-focus]') || dlg).focus();
    if (opts.onOpen) opts.onOpen(dlg);
  }

  function closeDialog(dlg) {
    if (!dlg || !dlg.open) return;
    dlg.classList.add('is-closing');
    const prev = dlg.__trigger;
    setTimeout(() => {
      dlg.close();
      dlg.classList.remove('is-closing');
      if (prev && prev.focus) prev.focus();
    }, 150);
  }

  /* ───────────────────────── Focus trap ───────────────────────── */

  function focusTrap(dlg) {
    const trapKey = (e) => {
      if (e.key !== 'Tab' || !dlg.open) return;
      const f = dlg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    dlg.addEventListener('keydown', trapKey);
  }

  /* ─────────────────────────── Popover ─────────────────────────── */

  function initPopover(trigger) {
    const target = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!target) return;
    const show = (ev) => {
      if (ev) ev.preventDefault();
      target.classList.add('is-in');
      trigger.setAttribute('aria-expanded', 'true');
      // roving tabindex: birinchi item fokus
      const items = target.querySelectorAll('.popover__item');
      if (items.length) {
        items[0].setAttribute('tabindex', '0');
        for (let i = 1; i < items.length; i++) items[i].setAttribute('tabindex', '-1');
      }
    };
    const hide = (restoreFocus) => {
      target.classList.remove('is-in');
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus !== false && trigger.focus) trigger.focus();
    };
    trigger.addEventListener('click', (e) => {
      if (target.classList.contains('is-in')) { hide(true); return; }
      show(e);
    });
    // Outside click
    document.addEventListener('click', (e) => {
      if (!target.classList.contains('is-in')) return;
      if (!target.contains(e.target) && !trigger.contains(e.target)) hide(false);
    });
    // Escape
    target.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); hide(true); }
      // Arrow nav — roving tabindex
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(target.querySelectorAll('.popover__item:not([aria-disabled="true"])'));
        const idx = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next] && items[next].focus();
      }
      if (e.key === 'Home') { e.preventDefault(); const it = target.querySelector('.popover__item'); it && it.focus(); }
      if (e.key === 'End') { e.preventDefault(); const its = target.querySelectorAll('.popover__item'); its.length && its[its.length - 1].focus(); }
    });
  }

  /* ─────────────────────────── Tooltip ─────────────────────────── */

  function initTooltip(trigger) {
    const tipId = trigger.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    if (!tip) return;
    let timer = null;
    const show = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        tip.classList.add('is-in');
      }, 150);
    };
    const hide = () => {
      clearTimeout(timer);
      tip.classList.remove('is-in');
    };
    ['mouseenter', 'focus'].forEach((ev) => trigger.addEventListener(ev, show));
    ['mouseleave', 'blur'].forEach((ev) => trigger.addEventListener(ev, hide));
  }

  /* ──────────────────────── Public API ──────────────────────── */

  window.showToast = showToast;
  window.showConfirm = showConfirm;
  window.openDialog = openDialog;
  window.closeDialog = closeDialog;
  window.DeborahOverlays = { showToast, showConfirm, openDialog, closeDialog, initPopover, initTooltip };

  // Avtomatik init: [data-popover] triggerlar va [data-tooltip] triggerlar
  function scan() {
    document.querySelectorAll('[data-popover]').forEach((t) => {
      if (!t.dataset.__popoverBound) { t.dataset.__popoverBound = '1'; initPopover(t); }
    });
    document.querySelectorAll('[data-tooltip]').forEach((t) => {
      if (!t.dataset.__tooltipBound) { t.dataset.__tooltipBound = '1'; initTooltip(t); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  if (window.MutationObserver) {
    const mo = new MutationObserver(scan);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
