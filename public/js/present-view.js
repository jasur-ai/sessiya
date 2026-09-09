/* Presentations — to'liq ekran taqdimot rejimi (viewer).
   Esc/←/→/Space/Home/End; letterbox; dots; auto-hide bar. */
(function () {
  'use strict';
  const SW = 1280, SH = 720;
  const deck = window.__PRS.deck || { slides: [], name: '' };
  const COPY = window.__PRS.COPY || {};
  const T = (k, fb) => (COPY[k] !== undefined ? COPY[k] : (fb !== undefined ? fb : k));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hex = (v, f) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : f);
  // masofaviy URL → same-origin proksi (CSP + export taint)
  const dispSrc = (s) => { if (!s) return ''; return /^https?:/i.test(s) ? '/user/api/img?u=' + encodeURIComponent(s) : s; };

  const slides = deck.slides || [];
  let cur = 0;

  const frame = document.getElementById('ps-v-frame');
  const canvas = document.getElementById('ps-v-canvas');
  const dotsEl = document.getElementById('ps-v-dots');
  const countEl = document.getElementById('ps-v-count');
  const nameEl = document.getElementById('ps-v-name');
  nameEl.textContent = deck.name || '';

  function thumbMini(slide) {
    return (slide.elements || []).map((e) => {
      const st = 'position:absolute;left:' + e.x + 'px;top:' + e.y + 'px;width:' + e.w + 'px;height:' + e.h + 'px;';
      if (e.type === 'text') return '<div style="' + st + 'font-size:' + (e.fontSize || 20) + 'px;font-weight:' + (e.bold ? 800 : 400) + ';color:' + hex(e.color, '#241a0c') + ';text-align:' + (e.align || 'left') + ';' + (e.font === 'display' ? "font-family:Georgia,'Times New Roman',serif;" : '') + 'white-space:pre-wrap;overflow:hidden;line-height:1.25">' + esc(e.text || '') + '</div>';
      if (e.type === 'list') return '<div style="' + st + 'font-size:' + (e.fontSize || 18) + 'px;color:' + hex(e.color, '#241a0c') + ';overflow:hidden">' + (e.items || []).map((it) => '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">• ' + esc((it && it.txt) || '') + '</div>').join('') + '</div>';
      if (e.type === 'shape') {
        const k = e.kind || 'rect';
        const sc = k === 'circle' ? 'border-radius:50%' : k === 'rounded' ? 'border-radius:26%' : k === 'triangle' ? 'clip-path:polygon(50% 0,100% 100%,0 100%)' : k === 'diamond' ? 'border-radius:6px;transform:scale(.8) rotate(45deg)' : k === 'star' ? 'clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)' : k === 'arrow' ? 'clip-path:polygon(0 20%,75% 20%,75% 0,100% 50%,75% 100%,75% 80%,0 80%)' : '';
        return '<div style="' + st + ';' + (sc || 'border-radius:4px') + ';background:' + hex(e.fill, '#c9a565') + '"></div>';
      }
      if (e.type === 'image') return '<div style="' + st + 'background:#efe2c4"></div>';
      return '';
    }).join('');
  }

  function bgStyle(bg) {
    if (bg && bg.type === 'gradient') return 'background:linear-gradient(' + (bg.deg || 135) + 'deg,' + hex(bg.c1, '#f6ecd9') + ',' + hex(bg.c2, '#c9a565') + ')';
    return 'background:' + hex(bg && bg.c1, '#f7eeda');
  }

  function slideContent(slide) {
    return (slide.elements || []).map((e) => {
      const st = 'position:absolute;left:' + e.x + 'px;top:' + e.y + 'px;width:' + e.w + 'px;height:' + e.h + 'px;';
      if (e.type === 'text') {
        return '<div style="' + st + 'font-size:' + (e.fontSize || 24) + 'px;font-weight:' + (e.bold ? 800 : 400) + ';font-style:' + (e.italic ? 'italic' : 'normal') + ';color:' + hex(e.color, '#241a0c') + ';text-align:' + (e.align || 'left') + ';' + (e.font === 'display' ? "font-family:Georgia,'Times New Roman',serif;" : '') + 'white-space:pre-wrap;word-break:break-word;line-height:1.25">' + esc(e.text) + '</div>';
      }
      if (e.type === 'list') {
        return '<div style="' + st + 'font-size:' + (e.fontSize || 22) + 'px;color:' + hex(e.color, '#241a0c') + ';display:flex;flex-direction:column;gap:' + (e.gap || 12) + 'px">' + (e.items || []).map((it) => '<div style="display:flex;gap:12px"><span style="flex:0 0 9px;height:9px;border-radius:50%;background:currentColor;margin-top:.58em;opacity:.8"></span><span>' + esc((it && it.txt) || '') + '</span></div>').join('') + '</div>';
      }
      if (e.type === 'shape') {
        const k = e.kind || 'rect';
        if (k === 'line') return '<div style="' + st + 'height:' + Math.max(4, e.h || 8) + 'px;border-radius:999px;background:' + hex(e.fill, '#8a5a1e') + '"></div>';
        const shape = k === 'circle' ? 'border-radius:50%' : (k === 'rounded' ? 'border-radius:26%' : (k === 'triangle' ? 'clip-path:polygon(50% 0,100% 100%,0 100%)' : (k === 'diamond' ? 'border-radius:6px;transform:scale(.8) rotate(45deg)' : (k === 'star' ? 'clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)' : (k === 'arrow' ? 'clip-path:polygon(0 20%,75% 20%,75% 0,100% 50%,75% 100%,75% 80%,0 80%)' : 'border-radius:4px')))));
        return '<div style="' + st + shape + ';background:' + hex(e.fill, '#c9a565') + '"></div>';
      }
      if (e.type === 'image' && e.src) return '<img style="' + st + 'object-fit:contain" src="' + esc(dispSrc(e.src)) + '" alt="">';
      return '';
    }).join('');
  }

  function layout() {
    const availW = window.innerWidth;
    const availH = window.innerHeight;
    const s = Math.min(availW / SW, availH / SH);
    frame.style.width = Math.round(SW * s) + 'px';
    frame.style.height = Math.round(SH * s) + 'px';
    canvas.style.transform = 'scale(' + s + ')';
    canvas.style.transformOrigin = '0 0';
  }

  function renderDots() {
    dotsEl.innerHTML = slides.map((_, i) => '<span class="ps-v-dot' + (i === cur ? ' on' : '') + '"></span>').join('');
    countEl.textContent = T('of', '{n} / {m}').split('{n}').join(cur + 1).split('{m}').join(slides.length);
  }

  function show(i) {
    if (i < 0 || i >= slides.length) return;
    cur = i;
    const slide = slides[cur];
    canvas.innerHTML = '<div style="position:absolute;inset:0;' + bgStyle(slide && slide.bg) + '">' + slideContent(slide || { elements: [] }) + '</div>';
    renderDots();
  }

  function next() { show(Math.min(cur + 1, slides.length - 1)); }
  function prev() { show(Math.max(cur - 1, 0)); }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'ArrowLeft' && e.altKey) { exit(); return; }
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
  });

  function exit() {
    const back = document.referrer;
    if (back && back.indexOf(location.origin) === 0) { location.href = back; return; }
    location.href = '/user/presentations';
  }
  document.getElementById('ps-v-exit').addEventListener('click', exit);

  // click: o'ng yarmi next, chap yarmi prev
  document.addEventListener('click', (e) => {
    if (e.target.closest('#ps-v-exit')) return;
    if (e.clientX > window.innerWidth / 2) next(); else prev();
  });

  window.addEventListener('resize', layout);
  layout();
  if (slides.length === 0) { canvas.innerHTML = '<div style="position:absolute;inset:0;background:#241a0c;color:#f6ecd9;display:flex;align-items:center;justify-content:center;font-family:sans-serif">—</div>'; }
  show(0);

  // yuklab olish (PDF/PPTX/PNG/JPG)
  const expBtn = document.getElementById('ps-v-export');
  if (expBtn && window.PresentExport) {
    window.PresentExport.attachMenu(expBtn, deck, {
      pdf: T('exportPdf', 'PDF'), pptx: T('exportPptx', 'PPTX — PowerPoint'), png: T('exportPng', 'PNG — rasm'), jpg: T('exportJpg', 'JPG — rasm'),
      busy: T('exportBusy', 'Tayyorlanmoqda…'), fail: T('exportFail', 'Yuklab olishda xatolik'),
    });
  }
})();
