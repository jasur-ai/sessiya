/* ═══════════════════════════════════════════════════════════════
   Presentations Editor (09/2026) — Google Slides uslubi + Canva uslubi
   Bitta model: {layout, bg, elements[]}; ikkala muhit bir xil saqlanadi.
   Canva uslubi: erkin shakllar/gradientlar; Slides uslubi: joylashuvlar.
   ── Feature set ──
   • slayd qo'shish (layout)/nusxalash/joyini o'zgartirish/o'chirish
   • elementlar: matn, sarlavha, ro'yxat, shakl (rect/circle/triangle/
     diamond/line), rasm (URL) — qo'shish, tanlash, sudrab ko'chirish,
     o'lcham (burchak tutqichi), nudge (←↑↓→), Delete, Esc
   • fon: solid palitra (ikkala), gradient (Canva)
   • avtosaqlash (debounce) + holat chizig'i
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SW = 1280, SH = 720;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const COPY = window.__PRS.COPY || {};
  const T = (k, fb) => (COPY[k] !== undefined ? COPY[k] : (fb !== undefined ? fb : k));
  const deck = window.__PRS.deck;
  const CSRF = window.__PRS.CSRF || '';

  const state = {
    deck,
    cur: 0,
    sel: null,          // { kind:'el'|'bg', id? }
    scale: 1,
    dirty: false,
    saving: false,
    drag: null,
  };

  const elId = () => 'el' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const slideId = () => 'sl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hex = (v, f) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : f);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // ko'rsatish manzili: masofaviy URL → same-origin proksi (CSP + export taint)
  const dispSrc = (s) => { if (!s) return ''; return /^https?:/i.test(s) ? '/user/api/img?u=' + encodeURIComponent(s) : s; };
  // tahrir uchun saqlanadigan "asl" manzil (proksi'dan URL'ni qaytarish)
  const rawSrc = (s) => { if (!s) return ''; if (s.indexOf('/user/api/img?u=') === 0) { try { return decodeURIComponent(s.slice('/user/api/img?u='.length)); } catch (_) { return s; } } return s; };

  function curSlide() { return state.deck.slides[state.cur] || null; }

  // ── Copy helpers ──
  function slideCountLabel(n) {
    const raw = T('slideCountF', '');
    if (raw) { const forms = raw.split('|'); return forms[0].split('{n}').join(n); }
    return T('slideCount', '{n} ta slayd').split('{n}').join(n);
  }

  // ── Fonts & default content ──
  // 09/2026 (user qarori): fon/ranglar endi faqat jigarrang emas — to'liq
  // spektr (qizil/yashil/ko'k/sariq/binafsha/…)+ oq/qora/kulrang + custom.
  const PALETTE_BG = ['#f7eeda', '#efe2c4', '#f6ecd9', '#e6d5ae', '#ffffff', '#241a0c', '#3a2c1a', '#5b4317', '#8a5a1e', '#a37f3a', '#c9a565', '#d9b465',
    '#e53935', '#d32f2f', '#ef9a9a', '#f44336',
    '#43a047', '#66bb6a', '#2e7d32', '#a5d6a7', '#4caf50',
    '#1e88e5', '#42a5f5', '#1565c0', '#90caf9', '#2196f3',
    '#fdd835', '#fbc02d', '#fff176', '#ffeb3b',
    '#8e24aa', '#ab47bc', '#ba68c8', '#9c27b0',
    '#00acc1', '#26c6da', '#4dd0e1', '#009688',
    '#fb8c00', '#ff7043', '#ffccbc', '#ff9800',
    '#ec407a', '#f06292', '#f48fb1', '#e91e63',
    '#607d8b', '#37474f', '#616161', '#9e9e9e', '#212121'];
  const PALETTE_TXT = ['#241a0c', '#ffffff', '#f6ecd9', '#3a2c1a', '#5b4317', '#8a5a1e', '#a37f3a', '#c9a565', '#000000', '#37474f', '#1565c0', '#2e7d32', '#c62828', '#e53935', '#8e24aa', '#6d4c41'];
  const PALETTE_FILL = ['#c9a565', '#d9b465', '#a37f3a', '#8a5a1e', '#5b4317', '#3a2c1a', '#241a0c', '#efe2c4', '#f6ecd9', '#ffffff', '#e6d5ae', '#c89f5b',
    '#e53935', '#f44336', '#43a047', '#4caf50', '#1e88e5', '#2196f3', '#fdd835', '#ffeb3b', '#8e24aa', '#9c27b0', '#00acc1', '#009688', '#fb8c00', '#ff9800', '#ec407a', '#e91e63', '#607d8b', '#37474f', '#616161', '#000000'];
  const GRADS = [['#f6ecd9', '#e6d5ae'], ['#efe2c4', '#c9a565'], ['#c9a565', '#f6ecd9'], ['#241a0c', '#5b4317'], ['#5b4317', '#a37f3a'], ['#8a5a1e', '#3a2c1a'], ['#3a2c1a', '#0f0a04'], ['#e6d5ae', '#ffffff'],
    ['#e53935', '#ff8a80'], ['#43a047', '#a5d6a7'], ['#1e88e5', '#90caf9'], ['#fdd835', '#fff9c4'], ['#8e24aa', '#e1bee7'], ['#00acc1', '#b2ebf2'], ['#fb8c00', '#ffccbc'], ['#ec407a', '#f8bbd0'],
    ['#212121', '#616161'], ['#ffffff', '#e0e0e0'], ['#1565c0', '#0d47a1'], ['#2e7d32', '#1b5e20']];

  // custom rang input (ixtiyoriy rang — type=color) uchun qator
  function customColorRow(current, key, title) {
    const val = hex(current, '#241a0c');
    return '<label class="ps-r-row ps-cpick-row"><span class="ps-r-label-inline">' + esc(title || '') + '</span>'
      + '<input type="color" class="ps-cpick" data-ck="' + key + '" value="' + val + '" aria-label="' + esc(title || 'Rang') + '"></label>';
  }

  function slideBgStyle(bg) {
    if (!bg) return 'background:' + PALETTE_BG[0];
    if (bg.type === 'gradient') return 'background:linear-gradient(' + (bg.deg || 135) + 'deg,' + hex(bg.c1, '#f6ecd9') + ',' + hex(bg.c2, '#c9a565') + ')';
    return 'background:' + hex(bg.c1, '#f7eeda');
  }
  function bgModelOf(bg) {
    if (bg && bg.type === 'gradient') return { type: 'gradient', c1: hex(bg.c1, '#f6ecd9'), c2: hex(bg.c2, '#c9a565'), deg: bg.deg || 135 };
    return { type: 'solid', c1: hex(bg && bg.c1, '#f7eeda') };
  }

  function defaultText(opts) {
    const o = opts || {};
    return {
      id: elId(), type: 'text', x: o.x || 360, y: o.y || 280, w: o.w || 560, h: o.h || 90,
      text: o.text || '', fontSize: o.fontSize || 26, bold: !!o.bold, italic: false,
      color: '#241a0c', align: o.align || 'left', font: o.font || 'body',
    };
  }
  function addEl(type, slide) {
    const isCanvas = state.deck.engine === 'canvas';
    if (type === 'text') return defaultText(isCanvas ? { x: 360, y: 250, w: 560, h: 90, fontSize: 26 } : { x: 380, y: 290, w: 520, h: 70, fontSize: 24 });
    if (type === 'title') return defaultText({ x: 200, y: 200, w: 880, h: 130, fontSize: 52, bold: true, align: 'center', font: 'display' });
    if (type === 'list') {
      return { id: elId(), type: 'list', x: 400, y: 250, w: 500, h: 200, items: [{ txt: '' }, { txt: '' }], fontSize: 24, bold: false, color: '#241a0c', gap: 14 };
    }
    if (type === 'image') {
      return { id: elId(), type: 'image', x: 400, y: 200, w: 480, h: 300, src: '' };
    }
    if (type === 'shape') {
      const shapes = [
        { kind: 'rect', x: 480, y: 260, w: 320, h: 200 },
        { kind: 'circle', x: 540, y: 280, w: 200, h: 200 },
        { kind: 'triangle', x: 560, y: 300, w: 180, h: 160 },
        { kind: 'diamond', x: 570, y: 310, w: 150, h: 150 },
        { kind: 'line', x: 340, y: 355, w: 600, h: 10 },
      ][Math.floor(Math.random() * 5)] || { kind: 'rect', x: 480, y: 260, w: 320, h: 200 };
      return { id: elId(), type: 'shape', x: shapes.x, y: shapes.y, w: shapes.w, h: shapes.h, kind: shapes.kind, fill: PALETTE_FILL[Math.floor(Math.random() * 4)], stroke: 'transparent', strokeW: 0 };
    }
    return defaultText();
  }

  function pushEl(el, slide) {
    slide.elements = slide.elements || [];
    slide.elements.push(el);
    state.sel = { kind: 'el', id: el.id };
    renderCanvas(); renderThumbs(); renderInspector(); markDirty();
  }

  // ── Rasm yuklash (fayl → dataURL, avto-downscale) — "Canva'da qanday bo'lsa" ──
  function downscaleFile(file) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onerror = () => resolve('');
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => resolve('');
        img.onload = () => {
          const MAXD = 1600;
          let w = img.width, h = img.height;
          if (w > MAXD || h > MAXD) { const sc = Math.min(MAXD / w, MAXD / h); w = Math.round(w * sc); h = Math.round(h * sc); }
          try {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // alpha fonda jpeg qoraymasin
            ctx.drawImage(img, 0, 0, w, h);
            const isPng = /png/i.test(file.type) && file.size <= 700 * 1024;
            let out = c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.86);
            if (out.length > 2200000) out = c.toDataURL('image/jpeg', 0.72); // juda katta → siqish
            resolve(out);
          } catch (_) { resolve(''); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  let pendingFileTarget = null; // attachFileInput uchun element
  function attachFileInput(el) {
    pendingFileTarget = el;
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*';
    fi.style.display = 'none';
    document.body.appendChild(fi);
    fi.addEventListener('change', async () => {
      const f = fi.files && fi.files[0];
      fi.remove();
      if (!f) { pendingFileTarget = null; return; }
      const elNow = pendingFileTarget || (curSlide().elements || []).find((e) => state.sel && e.id === state.sel.id);
      pendingFileTarget = null;
      const src = await downscaleFile(f);
      if (!src) { alert(T('imgFail', 'Rasm o‘qilmadi')); return; }
      if (!elNow) return;
      elNow.src = src;
      if (state.sel && state.sel.kind === 'el' && state.sel.id === elNow.id) renderInspector();
      renderCanvas(); renderThumbs(); markDirty();
    });
    fi.click();
  }

  function insertImageFlow() {
    pendingFileTarget = null;
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*';
    fi.style.display = 'none';
    document.body.appendChild(fi);
    fi.addEventListener('change', async () => {
      const f = fi.files && fi.files[0];
      fi.remove();
      const slide = curSlide();
      if (!slide) return;
      const el = { id: elId(), type: 'image', x: 320, y: 160, w: 640, h: 400, src: '' };
      if (f) {
        const src = await downscaleFile(f);
        if (src) el.src = src;
      }
      pushEl(el, slide);
      if (state.sel && state.sel.kind === 'el') renderInspector();
    });
    fi.click();
  }

  // ── Matnni slayd ustida (inline) tahrirlash ──
  function startInlineEdit(elId2) {
    commitInlineEdit(false, true); // avvalgi tahrirni yopish
    const slide = curSlide();
    const el = slide && slide.elements.find((e) => e.id === elId2);
    const node = el && canvas.querySelector('.ps-el[data-id="' + el.id + '"]');
    if (!el || !node || el.type !== 'text') return;
    state.sel = { kind: 'el', id: el.id };
    renderCanvas(); // tanlash ko'rsatilsin
    const ta = document.createElement('textarea');
    ta.className = 'ps-inline-ed';
    ta.value = el.text || '';
    ta.spellcheck = false;
    ta.style.cssText = 'position:absolute;left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px;'
      + 'font-size:' + (el.fontSize || 24) + 'px;font-weight:' + (el.bold ? 800 : 400) + ';font-style:' + (el.italic ? 'italic' : 'normal') + ';'
      + 'color:' + hex(el.color, '#241a0c') + ';text-align:' + (el.align || 'left') + ';line-height:1.22;'
      + 'background:rgba(255,255,255,.88);border:2px dashed #d9b465;border-radius:6px;padding:6px 8px;margin:0;'
      + 'resize:none;overflow:auto;white-space:pre-wrap;z-index:40;font-family:inherit;outline:none;box-sizing:border-box;';
    const host = canvas.querySelector('.ps-canvas-inner');
    if (!host) return;
    host.appendChild(ta);
    state.editEl = el; state.editTa = ta;
    ta.focus();
    const len = ta.value.length; ta.setSelectionRange(len, len);
    ta.addEventListener('input', () => {
      el.text = ta.value;
      markDirty();
      // DOM'ga jonli yozamiz — commit vaqtida render o'tkazilmasa ham slaydda ko'rinadi
      const tNode = canvas.querySelector('.ps-el[data-id="' + el.id + '"] .ps-el-text');
      if (tNode) {
        tNode.textContent = el.text;
        tNode.classList.toggle('empty', !el.text);
      }
    });
    ta.addEventListener('keydown', (e2) => {
      e2.stopPropagation();
      if (e2.key === 'Escape') { const old = el.text; commitInlineEdit(true); el.text = old; renderCanvas(); renderThumbs(); markDirty(); }
      else if (e2.key === 'Enter' && !e2.shiftKey) { e2.preventDefault(); ta.blur(); }
    });
    ta.addEventListener('blur', () => { const changed = ta.value !== el.text; commitInlineEdit(false); if (changed) { renderCanvas(); renderThumbs(); markDirty(); } });
  }
  function commitInlineEdit(revert, skipRender) {
    const ta = state.editTa;
    if (!ta) return;
    if (!revert && state.editEl) state.editEl.text = ta.value;
    ta.remove();
    state.editTa = null; state.editEl = null;
    if (!skipRender) { renderCanvas(); }
  }

  function slideHTML(slide) {
    const els = (slide.elements || []).map((e) => {
      const l = Math.round(e.x) + 'px', t = Math.round(e.y) + 'px', w = Math.round(e.w) + 'px', h = Math.round(e.h) + 'px';
      if (e.type === 'text') {
        const style = 'left:' + l + ';top:' + t + ';width:' + w + ';height:' + h + ';font-size:' + (e.fontSize || 24) + 'px;font-weight:' + (e.bold ? 800 : 400) + ';font-style:' + (e.italic ? 'italic' : 'normal') + ';color:' + hex(e.color, '#241a0c') + ';text-align:' + (e.align || 'left') + ';';
        const ph = e.text ? '' : (e.font === 'display' ? T('dfltTitle', 'Sarlavha qo\u2018shing') : T('dfltBody', 'Matn qo\u2018shing…'));
        const vert = e.align === 'center' && e.bold ? 'display:flex;align-items:center;justify-content:center;' : '';
        return '<div class="ps-el" data-id="' + e.id + '" data-i data-el="' + e.id + '" style="' + style + '"><div class="ps-el-text' + (e.text ? '' : ' empty') + '" data-ph="' + esc(ph) + '" style="white-space:pre-wrap;line-height:1.22;width:100%;height:100%;' + (e.align === 'center' ? 'text-align:center;' : '') + vert + '">' + esc(e.text) + '</div><span class="ps-handle" data-resize="' + e.id + '"></span></div>';
      }
      if (e.type === 'list') {
        const style = 'left:' + l + ';top:' + t + ';width:' + w + ';height:' + h + ';font-size:' + (e.fontSize || 22) + 'px;font-weight:' + (e.bold ? 700 : 400) + ';color:' + hex(e.color, '#241a0c') + ';gap:' + (e.gap || 12) + 'px;';
        const rows = (e.items || []).map((it) => '<div class="li">' + (esc(it && it.txt) || '&nbsp;') + '</div>').join('');
        return '<div class="ps-el" data-id="' + e.id + '" data-i style="' + style + '"><div class="ps-el-list">' + rows + '</div><span class="ps-handle" data-resize="' + e.id + '"></span></div>';
      }
      if (e.type === 'shape') {
        const style = 'left:' + l + ';top:' + t + ';width:' + w + ';height:' + h + ';';
        const kind = e.kind || 'rect';
        let inner = '<div class="ps-el-shape ' + kind + '" style="background:' + hex(e.fill, '#c9a565') + ';' + (e.stroke && e.stroke !== 'transparent' ? 'border:' + (e.strokeW || 2) + 'px solid ' + hex(e.stroke, '#241a0c') : '') + '"></div>';
        if (kind === 'line') inner = '<div class="ps-el-shape line" style="height:' + Math.max(4, e.h || 8) + 'px;width:100%;background:' + hex(e.fill, '#8a5a1e') + ';border-radius:999px"></div>';
        return '<div class="ps-el" data-id="' + e.id + '" data-i style="' + style + '">' + inner + '<span class="ps-handle" data-resize="' + e.id + '"></span></div>';
      }
      if (e.type === 'image') {
        const style = 'left:' + l + ';top:' + t + ';width:' + w + ';height:' + h + ';';
        const img = e.src ? '<img class="ps-el-img" src="' + esc(dispSrc(e.src)) + '" alt="" loading="lazy">' : '<div class="ps-el-img-wrap ps-el-text empty" data-ph="' + T('imgPh', 'Rasm — yuklang yoki URL') + '"></div>';
        return '<div class="ps-el" data-id="' + e.id + '" data-i style="' + style + '">' + img + '<span class="ps-handle" data-resize="' + e.id + '"></span></div>';
      }
      return '';
    }).join('');
    return '<div class="ps-canvas-inner" style="position:absolute;inset:0;' + slideBgStyle(slide && slide.bg) + '">' + els + '</div>';
  }

  // ── Layout & render ──
  const center = $('#ed-center');
  const frame = $('#ed-frame');
  const canvas = $('#ed-canvas');
  const thumbs = $('#ed-thumbs');

  function computeScale() {
    const pad = 60;
    const availW = Math.max(240, center.clientWidth - pad);
    const availH = Math.max(200, center.clientHeight - pad * 1.4);
    return Math.min(availW / SW, availH / SH, 1.4);
  }
  function layoutStage() {
    const s = computeScale();
    state.scale = s;
    frame.style.width = Math.round(SW * s) + 'px';
    frame.style.height = Math.round(SH * s) + 'px';
    canvas.style.transform = 'scale(' + s + ')';
    canvas.style.transformOrigin = '0 0';
  }

  function renderCanvas() {
    const sl = curSlide();
    canvas.innerHTML = sl ? slideHTML(sl) : '';
    if (sl && !sl.elements.length) {
      const hint = document.createElement('div');
      hint.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:rgba(36,26,12,.4);font-weight:700;font-size:20px;letter-spacing:.02em';
      hint.textContent = '+ ' + T('insText', 'Matn') + ' · ' + T('insShape', 'Shakl') + ' — o\u2018ng panelda qo\u2018shing';
      canvas.appendChild(hint);
    }
    if (sl && state.sel && state.sel.kind === 'el') {
      const node = canvas.querySelector('.ps-el[data-id="' + state.sel.id + '"]');
      if (node) node.classList.add('sel');
    }
    if (!sl) return;
    const tEl = $('.ps-thumb.on');
    if (tEl) renderThumbInto(tEl, sl, true);
  }

  function renderThumbInto(thumbEl, slide, isActive) {
    const w = 150, h = Math.round((w * 9) / 16);
    thumbEl.innerHTML = '<div class="ps-thumb-num"></div><div class="ps-thumb-frame" style="width:' + w + 'px;height:' + h + 'px"><div style="position:absolute;left:0;top:0;width:' + SW + 'px;height:' + SH + 'px;transform:scale(' + (w / SW) + ');transform-origin:0 0;' + slideBgStyle(slide.bg) + ';pointer-events:none;overflow:hidden">' + thumbElements(slide) + '</div></div>';
    const n = thumbEl.querySelector('.ps-thumb-num');
    if (n) n.textContent = thumbEl.dataset.num || '';
  }

  function thumbElements(slide) {
    return (slide.elements || []).map((e) => {
      const style = 'position:absolute;left:' + e.x + 'px;top:' + e.y + 'px;width:' + e.w + 'px;height:' + e.h + 'px;';
      if (e.type === 'text') {
        return '<div style="' + style + ';font-size:' + (e.fontSize || 20) + 'px;font-weight:' + (e.bold ? 800 : 400) + ';color:' + hex(e.color, '#241a0c') + ';text-align:' + (e.align || 'left') + ';white-space:pre-wrap;overflow:hidden;line-height:1.25">' + esc(e.text || '') + '</div>';
      }
      if (e.type === 'list') {
        return '<div style="' + style + ';font-size:' + (e.fontSize || 18) + 'px;color:' + hex(e.color, '#241a0c') + ';overflow:hidden">' + (e.items || []).map((it) => '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">• ' + esc((it && it.txt) || '') + '</div>').join('') + '</div>';
      }
      if (e.type === 'shape') {
        const k = e.kind || 'rect';
        if (k === 'circle') return '<div style="' + style + ';border-radius:50%;background:' + hex(e.fill, '#c9a565') + '"></div>';
        if (k === 'triangle') return '<div style="' + style + ';background:' + hex(e.fill, '#c9a565') + ';clip-path:polygon(50% 0,100% 100%,0 100%)"></div>';
        if (k === 'line') return '<div style="' + style + ';background:' + hex(e.fill, '#8a5a1e') + ';border-radius:99px"></div>';
        if (k === 'diamond') return '<div style="' + style + ';background:' + hex(e.fill, '#c9a565') + ';border-radius:6px;transform:scale(.8) rotate(45deg)"></div>';
        return '<div style="' + style + ';border-radius:4px;background:' + hex(e.fill, '#c9a565') + '"></div>';
      }
      if (e.type === 'image' && e.src) return '<div style="' + style + ';background:#efe2c4"></div>';
      return '';
    }).join('');
  }

  function renderThumbs() {
    thumbs.innerHTML = '';
    state.deck.slides.forEach((sl, i) => {
      const tEl = document.createElement('div');
      tEl.className = 'ps-thumb' + (i === state.cur ? ' on' : '');
      tEl.dataset.i = i;
      tEl.dataset.num = String(i + 1);
      tEl.setAttribute('role', 'option');
      tEl.setAttribute('aria-selected', i === state.cur ? 'true' : 'false');
      renderThumbInto(tEl, sl);
      thumbs.appendChild(tEl);
    });
    if (state.deck.slides[state.cur]) {
      const curEl = thumbs.querySelector('.ps-thumb.on');
      if (curEl) curEl.scrollIntoView({ block: 'nearest' });
    }
    updateSlideNav();
  }

  function updateSlideNav() {
    const n = state.deck.slides.length;
    const on = (id, dis) => { const b = $(id); if (b) b.disabled = dis; };
    on('#ed-slide-up', state.cur <= 0);
    on('#ed-slide-down', state.cur >= n - 1);
    on('#ed-slide-dup', n >= 60);
    on('#ed-slide-del', n <= 1);
  }

  // ── Head bar ──
  const nameInp = $('#ed-name');
  nameInp.value = state.deck.name || '';
  $('#ed-engine').textContent = state.deck.engine === 'canvas' ? 'Canva' : 'Slides';
  const present = $('#ed-present');
  present.href = '/user/presentations/' + (state.deck.key || '') + '/view';
  const exportBtn = $('#ed-export');
  if (exportBtn && window.PresentExport) {
    window.PresentExport.attachMenu(exportBtn, state.deck, {
      pdf: T('exportPdf', 'PDF'), pptx: T('exportPptx', 'PPTX — PowerPoint'), png: T('exportPng', 'PNG — rasm'), jpg: T('exportJpg', 'JPG — rasm'),
      busy: T('exportBusy', 'Tayyorlanmoqda…'), fail: T('exportFail', 'Yuklab olishda xatolik'),
    });
    exportBtn.classList.add('has-export');
  }

  // ── Status/autosave ──
  const status = $('#ed-status');
  let saveTimer = null;
  function markDirty() {
    state.dirty = true;
    status.textContent = T('saving', 'Saqlanmoqda…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!state.dirty) return;
    state.dirty = false;
    state.saving = true;
    try {
      const res = await fetch('/user/api/presentations/' + (state.deck.key || '') + '/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
        body: JSON.stringify({ name: state.deck.name, engine: state.deck.engine, slides: state.deck.slides }),
      });
      if (!res.ok) throw new Error(res.status);
      status.textContent = T('saveOk', 'Saqlangan') + ' ✓';
      status.classList.add('ok');
    } catch (_) {
      status.textContent = T('saveFail', 'Saqlab bo‘lmadi');
      status.classList.remove('ok');
      state.dirty = true;
    } finally { state.saving = false; }
  }
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty && !state.saving) { saveNow(); e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { if (state.dirty) saveNow(); });

  // ── Selection & Inspector ──
  function selectEl(id) {
    state.sel = id ? { kind: 'el', id } : { kind: 'bg' };
    renderCanvas();
    renderInspector();
  }
  function selectBg() { state.sel = { kind: 'bg' }; renderCanvas(); renderInspector(); }

  function inspectorTitle(t) {
    return '<div class="ps-r-title">' + esc(t) + '</div>';
  }
  function swatchRow(items, current, key, type) {
    const itemsHtml = items.map((it) => {
      const val = type === 'grad' ? JSON.stringify(it) : it;
      const on = type === 'grad' ? (current && current.type === 'gradient' && current.c1 === it[0] && current.c2 === it[1])
        : current === it;
      return '<button type="button" class="ps-swatch' + (on ? ' on' : '') + (type === 'grad' ? ' ps-grad' : '') + '" style="' + (type === 'grad' ? '--sw1:' + it[0] + ';--sw2:' + it[1] : 'background:' + it) + '" data-key="' + key + '" data-val="' + esc(val) + '" aria-label="Rang"></button>';
    }).join('');
    return '<div class="ps-r-sw">' + itemsHtml + '</div>';
  }

  function renderInspector() {
    const box = $('#ed-inspector');
    const slide = curSlide();
    const selEl = state.sel && state.sel.kind === 'el' ? (slide.elements || []).find((e) => e.id === state.sel.id) : null;
    if (!box || !slide) return;
    let h = '';

    // 1) Qo'shish
    h += '<div class="ps-r-sec">' + inspectorTitle(T('addLbl', 'Qo‘shish'));
    let ins = '<button type="button" class="ps-r-ins" data-ins="title">' + esc(T('insTitle', 'Sarlavha')) + '</button>'
      + '<button type="button" class="ps-r-ins" data-ins="text">' + esc(T('insText', 'Matn')) + '</button>'
      + '<button type="button" class="ps-r-ins" data-ins="list">' + esc(T('insList', 'Ro‘yxat')) + '</button>'
      + '<button type="button" class="ps-r-ins" data-ins="image">' + esc(T('insImg', 'Rasm')) + '</button>'
      + '<button type="button" class="ps-r-ins" data-ins="shape" data-kind="rect">▭</button>'
      + '<button type="button" class="ps-r-ins" data-ins="shape" data-kind="circle">●</button>'
      + '<button type="button" class="ps-r-ins" data-ins="shape" data-kind="triangle">△</button>'
      + '<button type="button" class="ps-r-ins" data-ins="shape" data-kind="diamond">◇</button>'
      + '<button type="button" class="ps-r-ins wide" data-ins="shape" data-kind="line">— ' + esc(T('insLine', 'Chiziq')) + '</button>';
    h += '<div class="ps-r-ins-grid">' + ins + '</div></div>';

    // 2) Element xossalari
    if (selEl) {
      h += '<div class="ps-r-sec">' + inspectorTitle(T('colorLbl', 'Rang'));
      if (selEl.type === 'text' || selEl.type === 'list') {
        if (selEl.type === 'text') {
          h += '<label class="ps-r-label">' + esc(T('textPh', 'Matn')) + '</label>';
          h += '<div class="ps-r-hint" style="margin:-2px 0 6px;font-size:.72rem">' + esc(T('editInlineHint', 'Slaydda ikki marta bosing — joyida yozing')) + '</div>';
          h += '<div class="ps-r-row">'
            + '<select class="ps-r-select" data-p="fontSize" style="flex:1">' + [16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 88].map((f) => '<option value="' + f + '"' + (selEl.fontSize === f ? ' selected' : '') + '>' + f + '</option>').join('') + '</select>'
            + '<button type="button" class="ps-r-btn' + (selEl.bold ? ' on' : '') + '" data-toggle="bold"><b>B</b></button>'
            + '<button type="button" class="ps-r-btn' + (selEl.italic ? ' on' : '') + '" data-toggle="italic"><i>I</i></button>'
            + '</div>';
          h += '<div class="ps-r-row">'
            + '<button type="button" class="ps-r-btn' + (selEl.align === 'left' ? ' on' : '') + '" data-align="left">⬅</button>'
            + '<button type="button" class="ps-r-btn' + (selEl.align === 'center' ? ' on' : '') + '" data-align="center">⬌</button>'
            + '<button type="button" class="ps-r-btn' + (selEl.align === 'right' ? ' on' : '') + '" data-align="right">➡</button>'
            + '</div>';
        } else {
          h += '<div id="list-ed"></div>';
          h += '<button type="button" class="ps-r-btn big" data-listadd="1">' + esc(T('listAdd', '+ Qator qo‘shish')) + '</button>';
          h += '<div class="ps-r-row">'
            + '<select class="ps-r-select" data-p="fontSize" style="flex:1">' + [14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48].map((f) => '<option value="' + f + '"' + (selEl.fontSize === f ? ' selected' : '') + '>' + f + '</option>').join('') + '</select>'
            + '<button type="button" class="ps-r-btn' + (selEl.bold ? ' on' : '') + '" data-toggle="bold"><b>B</b></button>'
            + '</div>';
        }
        h += '<label class="ps-r-label">' + esc(T('colorLbl', 'Rang')) + '</label>';
        h += swatchRow(PALETTE_TXT, selEl.color, 'color', 'hex');
        h += customColorRow(selEl.color, 'color', T('customColor', 'Ixtiyoriy rang'));
      } else if (selEl.type === 'shape') {
        h += '<label class="ps-r-label">' + esc(T('fillLbl', 'To‘ldirish')) + '</label>';
        h += swatchRow(PALETTE_FILL, selEl.fill, 'fill', 'hex');
        h += customColorRow(selEl.fill, 'fill', T('customColor', 'Ixtiyoriy rang'));
        if (selEl.kind === 'line') {
          h += '<label class="ps-r-label">' + esc(T('sizeLbl', 'O‘lcham')) + '</label>';
          h += '<input class="ps-r-input" type="number" min="4" max="60" value="' + Math.max(4, selEl.h || 8) + '" data-p="thick" style="width:100px">';
        }
      } else if (selEl.type === 'image') {
        const isData = selEl.src && selEl.src.indexOf('data:') === 0;
        h += '<div class="ps-r-row" style="margin-bottom:6px">'
          + '<button type="button" class="ps-tab' + (isData ? ' on' : '') + '" data-tab="up">' + esc(T('imgUp', 'Yuklash')) + '</button>'
          + '<button type="button" class="ps-tab' + (isData ? '' : ' on') + '" data-tab="url">' + esc(T('imgUrlTab', 'URL')) + '</button>'
          + '</div>';
        h += '<div data-pane="url"' + (isData ? ' hidden' : '') + '>'
          + '<input class="ps-r-input" type="url" value="' + esc(rawSrc(selEl.src || '')) + '" data-p="src" placeholder="https://…">'
          + '<div class="ps-r-hint" style="margin-top:5px">' + esc(T('imgUrlPh', 'Tashqi rasm manzili')) + '</div></div>';
        h += '<div data-pane="up"' + (isData ? '' : ' hidden') + '>'
          + '<button type="button" class="ps-r-btn big" data-upfile="1">' + esc(T('imgUpBtn', 'Rasm faylini tanlang…')) + '</button>'
          + '<div class="ps-r-hint" style="margin-top:5px">' + esc(T('imgUpPh', 'PNG/JPG/WebP — avtomatik kichraytiriladi')) + '</div></div>';
        if (isData) { h += '<div class="ps-up-thumb"><img src="' + esc(selEl.src) + '" alt=""></div>'; }
      }
      h += '<div style="height:10px"></div><button type="button" class="ps-r-btn big ps-r-danger" data-del-el="1">✕ ' + esc(T('delEl', 'Elementni o‘chirish')) + '</button>';
      h += '</div>';
    } else {
      h += '<div class="ps-r-sec"><div class="ps-r-hint">' + esc(T('selHint', 'Element tanlang yoki slayd fonini sozlang')) + '</div></div>';
    }

    // 3) Slayd foni — ixtiyoriy rang + gradient (ikkala uslubda ham)
    h += '<div class="ps-r-sec">' + inspectorTitle(T('bgLbl', 'Fon') + ' — ' + T('slide', 'Slayd') + ' ' + (state.cur + 1));
    const bg = bgModelOf(slide.bg);
    const isGrad = bg.type === 'gradient';
    h += '<div class="ps-r-row" style="margin-bottom:6px">'
      + '<button type="button" class="ps-tab' + (!isGrad ? ' on' : '') + '" data-bgm="solid">' + esc(T('bgSolid', 'Bir rang')) + '</button>'
      + '<button type="button" class="ps-tab' + (isGrad ? ' on' : '') + '" data-bgm="grad">' + esc(T('bgGrad', 'Gradient')) + '</button>'
      + '</div>';
    if (!isGrad) {
      h += '<label class="ps-r-label">' + esc(T('colorLbl', 'Rang')) + '</label>';
      h += swatchRow(PALETTE_BG, bg.c1, 'bgc', 'hex');
      h += customColorRow(bg.c1, 'bgc', T('customColor', 'Ixtiyoriy rang'));
    } else {
      h += '<label class="ps-r-label">' + esc(T('gradPair', 'Tayyor gradientlar')) + '</label>';
      h += swatchRow(GRADS, bg, 'bgg', 'grad');
      h += '<label class="ps-r-label">' + esc(T('gradCustom', 'O‘z gradientingiz')) + '</label>';
      h += '<div class="ps-r-row"><span class="ps-r-label-inline">1</span><input type="color" class="ps-cpick" data-ck="bgc1" value="' + hex(bg.c1, '#f6ecd9') + '" aria-label="Gradient 1"><span class="ps-r-label-inline">2</span><input type="color" class="ps-cpick" data-ck="bgc2" value="' + hex(bg.c2, '#c9a565') + '" aria-label="Gradient 2"></div>';
      h += '<div class="ps-r-row"><span class="ps-r-label-inline">' + esc(T('gradDeg', 'Burchak')) + '</span><select class="ps-r-select" data-p="bgdeg" style="flex:1">' + [0, 45, 90, 135, 180, 225, 270, 315].map((d) => '<option value="' + d + '"' + ((bg.deg || 135) === d ? ' selected' : '') + '>' + d + '°</option>').join('') + '</select></div>';
    }
    h += '</div>';

    box.innerHTML = h;
    bindInspector(box);
  }

  function bindInspector(box) {
    const slide = curSlide();
    const selEl = slide && state.sel && state.sel.kind === 'el' ? slide.elements.find((e) => e.id === state.sel.id) : null;
    if (!slide) return;

    // insert
    box.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.ins === 'image') { insertImageFlow(); return; }
      const slide2 = curSlide();
      const kind = b.dataset.kind;
      let el;
      if (b.dataset.ins === 'shape' && kind) {
        const rnd = { x: 480, y: 260, w: 320, h: 200, kind };
        if (kind === 'circle') { rnd.w = 220; rnd.h = 220; rnd.x = 530; }
        if (kind === 'triangle') { rnd.w = 200; rnd.h = 180; rnd.x = 540; rnd.y = 280; }
        if (kind === 'diamond') { rnd.w = 170; rnd.h = 170; rnd.x = 555; rnd.y = 285; }
        if (kind === 'line') { rnd.w = 640; rnd.h = 10; rnd.x = 320; rnd.y = 355; }
        el = { id: elId(), type: 'shape', x: rnd.x, y: rnd.y, w: rnd.w, h: rnd.h, kind, fill: PALETTE_FILL[Math.floor(Math.random() * 3)], stroke: 'transparent', strokeW: 0 };
      } else {
        el = addEl(b.dataset.ins, slide2);
      }
      slide2.elements = slide2.elements || [];
      slide2.elements.push(el);
      state.sel = { kind: 'el', id: el.id };
      renderCanvas();
      renderThumbs();
      renderInspector();
      // Matn — darhol slayd ustida tahrirga o'tiladi (yangi UX)
      if (el.type === 'text') startInlineEdit(el.id);
      markDirty();
    }));

    // text / list / image props
    const pInput = (ev) => {
      if (!selEl) return;
      const inp = ev.target;
      const key = inp.dataset.p;
      if (key === 'text') { selEl.text = inp.value; }
      else if (key === 'fontSize') { selEl.fontSize = +inp.value; }
      else if (key === 'src') { selEl.src = inp.value.trim(); }
      else if (key === 'thick') { selEl.h = Math.max(4, Math.min(200, +inp.value || 8)); }
      else if (key === 'bgdeg') { if (slide.bg && slide.bg.type === 'gradient') slide.bg.deg = +inp.value; }
      renderCanvas();
      renderThumbs();
      markDirty();
    };
    box.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('input', pInput));

    // swatches
    box.querySelectorAll('.ps-swatch').forEach((sw) => sw.addEventListener('click', () => {
      const key = sw.dataset.key;
      const val = sw.dataset.val;
      if (key === 'bgc') {
        slide.bg = { type: 'solid', c1: val };
        selectBg();
      } else if (key === 'bgg') {
        let g = null;
        try { g = JSON.parse(val); } catch (_) {}
        if (g) { const cur = bgModelOf(slide.bg); slide.bg = { type: 'gradient', c1: g[0], c2: g[1], deg: cur.type === 'gradient' ? (cur.deg || 135) : 135 }; }
        selectBg();
      } else if (key === 'color') { if (selEl) { selEl.color = val; renderCanvas(); renderThumbs(); renderInspector(); markDirty(); } }
      else if (key === 'fill') { if (selEl) { selEl.fill = val; renderCanvas(); renderThumbs(); renderInspector(); markDirty(); } }
    }));

    // custom color input (type=color) — bg / matn / to'ldirish / gradient uchlar
    box.querySelectorAll('.ps-cpick').forEach((cp) => cp.addEventListener('input', (e) => {
      const key = cp.dataset.ck;
      const val = cp.value;
      if (key === 'bgc') { slide.bg = { type: 'solid', c1: val }; state.sel = { kind: 'bg' }; renderCanvas(); renderThumbs(); markDirty(); }
      else if (key === 'bgc1') { const cur = bgModelOf(slide.bg); slide.bg = { type: 'gradient', c1: val, c2: cur.c2, deg: cur.deg || 135 }; state.sel = { kind: 'bg' }; renderCanvas(); renderThumbs(); markDirty(); }
      else if (key === 'bgc2') { const cur = bgModelOf(slide.bg); slide.bg = { type: 'gradient', c1: cur.c1, c2: val, deg: cur.deg || 135 }; state.sel = { kind: 'bg' }; renderCanvas(); renderThumbs(); markDirty(); }
      else if (key === 'color' && selEl) { selEl.color = val; renderCanvas(); renderThumbs(); markDirty(); }
      else if (key === 'fill' && selEl) { selEl.fill = val; renderCanvas(); renderThumbs(); markDirty(); }
    }));

    // fon turi: bir rang / gradient
    box.querySelectorAll('[data-bgm]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.bgm === 'grad') { const cur = bgModelOf(slide.bg); slide.bg = cur.type === 'gradient' ? cur : { type: 'gradient', c1: hex(cur.c1, '#f6ecd9'), c2: hex(cur.c1 === '#f6ecd9' ? '#e6d5ae' : '#c9a565', '#c9a565'), deg: 135 }; }
      else { const cur = bgModelOf(slide.bg); slide.bg = { type: 'solid', c1: cur.type === 'gradient' ? cur.c1 : cur.c1 }; }
      selectBg();
    }));

    // rasm paneli: URL / Yuklash yorliqlari
    box.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      const tab = b.dataset.tab;
      box.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      const pane = box.querySelector('[data-pane="' + tab + '"]');
      if (pane) { box.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = true; }); pane.hidden = false; }
    }));
    const upBtn = box.querySelector('[data-upfile]');
    if (upBtn) upBtn.addEventListener('click', () => { attachFileInput(selEl); });

    // bold/italic/align toggles
    box.querySelectorAll('[data-toggle="bold"]').forEach((b) => b.addEventListener('click', () => {
      if (!selEl) return; selEl.bold = !selEl.bold; renderCanvas(); renderThumbs(); renderInspector(); markDirty();
    }));
    box.querySelectorAll('[data-toggle="italic"]').forEach((b) => b.addEventListener('click', () => {
      if (!selEl) return; selEl.italic = !selEl.italic; renderCanvas(); renderThumbs(); renderInspector(); markDirty();
    }));
    box.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => {
      if (!selEl) return; selEl.align = b.dataset.align; renderCanvas(); renderThumbs(); renderInspector(); markDirty();
    }));

    // list editor
    if (selEl && selEl.type === 'list') {
      const wrap = box.querySelector('#list-ed');
      if (wrap) {
        wrap.innerHTML = selEl.items.map((it, i) => {
          return '<div class="ps-item-input"><input class="ps-r-input" data-li="' + i + '" value="' + esc(it.txt) + '" placeholder="' + esc(T('listPh', 'Yozuv…')) + '"><button type="button" class="ps-item-x" data-li-x="' + i + '">✕</button></div>';
        }).join('');
        wrap.querySelectorAll('[data-li]').forEach((inp) => inp.addEventListener('input', (e) => {
          selEl.items[+e.target.dataset.li].txt = e.target.value;
          renderCanvas(); renderThumbs(); markDirty();
        }));
        wrap.querySelectorAll('[data-li-x]').forEach((b) => b.addEventListener('click', (e) => {
          selEl.items.splice(+e.target.dataset.liX, 1);
          renderCanvas(); renderThumbs(); renderInspector(); markDirty();
        }));
      }
      const addBtn = box.querySelector('[data-listadd]');
      if (addBtn) addBtn.addEventListener('click', () => {
        selEl.items.push({ txt: '' });
        renderInspector();
        const inputs = box.querySelectorAll('[data-li]');
        const last = inputs[inputs.length - 1];
        if (last) last.focus();
        markDirty();
      });
    }

    // delete el
    const delBtn = box.querySelector('[data-del-el]');
    if (delBtn) delBtn.addEventListener('click', () => {
      if (!selEl) return;
      slide.elements = slide.elements.filter((e) => e.id !== selEl.id);
      state.sel = { kind: 'bg' };
      renderCanvas(); renderThumbs(); renderInspector(); markDirty();
    });
  }

  // ── Canvas pointer (select / move / resize) ──
  function logicalFromEvent(ev) {
    const r = frame.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / state.scale, y: (ev.clientY - r.top) / state.scale };
  }

  // Pointer-logika: bosish = tanlash, 4px dan ortiq harakat = drag.
  // Muhim: pointerdown'da preventDefault YO'Q va renderCanvas (DOM qayta qurish) YO'Q —
  // aks holda Chromium click/dblclick eventlarini bostirib (preventDefault)
  // yoki ikkinchi click nishonini yo'q qilib (renderCanvas) yubormaydi,
  // natijada slaydda ikki marta bosib inline-tahrir ochish ishlamay qolardi.
  canvas.addEventListener('pointerdown', (e) => {
    if (state.editTa) commitInlineEdit(false, true); // inline tahrirni yopib, modelga yozamiz (DOM live-sync qilingan)
    const slide = curSlide();
    if (!slide) return;
    if (e.button !== 0) return; // faqat chap tugma
    const resizeHandle = e.target.closest('[data-resize]');
    const elNode = e.target.closest('.ps-el');
    // eski tanlov klassini tozalash (DOM buzilmasdan)
    const clearSel = () => { canvas.querySelectorAll('.ps-el.sel').forEach((n) => n.classList.remove('sel')); };
    if (elNode) {
      const el = slide.elements.find((x) => x.id === elNode.dataset.id);
      if (!el) return;
      state.sel = { kind: 'el', id: el.id };
      state.pend = null;
      clearSel();
      elNode.classList.add('sel');
      renderInspector();
      const p0 = logicalFromEvent(e);
      state.pend = {
        mode: resizeHandle ? 'resize' : 'move', el,
        sx: e.clientX, sy: e.clientY,
        startX: p0.x, startY: p0.y, ox: el.x, oy: el.y, ow: el.w, oh: el.h,
      };
      return; // preventDefault yo'q — click/dblclick kechiktirilmaydi
    }
    state.pend = null;
    // Bo'sh joy — fon tanlanadi
    selectBg();
  });

  window.addEventListener('pointermove', (e) => {
    if (!state.drag && state.pend) {
      // hali drag emas — kichik harakatda (ikki marta bosish) tahrir buzilmasin
      if (Math.hypot(e.clientX - state.pend.sx, e.clientY - state.pend.sy) < 4) return;
      state.drag = state.pend;
      state.pend = null;
      e.preventDefault();
    }
    const d = state.drag;
    if (!d) return;
    const p = logicalFromEvent(e);
    const el = d.el;
    if (d.mode === 'move') {
      el.x = clamp(Math.round(d.ox + (p.x - d.startX)), -400, SW + 300);
      el.y = clamp(Math.round(d.oy + (p.y - d.startY)), -400, SH + 300);
    } else {
      const nw = clamp(Math.round(d.ow + (p.x - d.startX)), 12, 2600);
      const nh = clamp(Math.round(d.oh + (p.y - d.startY)), 6, 1600);
      el.w = nw; el.h = nh;
    }
    // live update — topilgan node'ni to'g'rilaymiz
    const node = canvas.querySelector('.ps-el[data-id="' + el.id + '"]');
    if (node) { node.style.left = Math.round(el.x) + 'px'; node.style.top = Math.round(el.y) + 'px'; node.style.width = Math.round(el.w) + 'px'; node.style.height = Math.round(el.h) + 'px'; }
  });

  window.addEventListener('pointerup', () => {
    state.pend = null;
    if (!state.drag) return;
    state.drag = null;
    renderThumbs();
    markDirty();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const slide = curSlide();
    if (!slide) return;
    const el = state.sel && state.sel.kind === 'el' ? slide.elements.find((x) => x.id === state.sel.id) : null;
    if (e.key === 'Escape') {
      if (state.sel) { state.sel = null; renderCanvas(); renderInspector(); }
      return;
    }
    if (el && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      slide.elements = slide.elements.filter((x) => x.id !== el.id);
      state.sel = { kind: 'bg' };
      renderCanvas(); renderThumbs(); renderInspector(); markDirty();
      return;
    }
    if (el) {
      const step = e.shiftKey ? 12 : 2;
      if (e.key === 'ArrowLeft') { el.x -= step; }
      else if (e.key === 'ArrowRight') { el.x += step; }
      else if (e.key === 'ArrowUp') { el.y -= step; }
      else if (e.key === 'ArrowDown') { el.y += step; }
      else return;
      e.preventDefault();
      renderCanvas(); renderThumbs(); markDirty();
    }
  });

  // ── Slides management ──
  function addSlide(layout) {
    const slide = {
      id: slideId(),
      layout: layout || 'blank',
      bg: state.deck.engine === 'canvas' ? { type: 'gradient', c1: '#f6ecd9', c2: '#e6d5ae', deg: 135 } : { type: 'solid', c1: '#f7eeda' },
      elements: [],
    };
    if (layout === 'title') {
      slide.elements.push({ id: elId(), type: 'text', x: 120, y: 240, w: 1040, h: 150, text: '', fontSize: 60, bold: true, color: '#241a0c', align: 'center', font: 'display' });
    } else if (layout === 'titlebody') {
      slide.elements.push({ id: elId(), type: 'text', x: 120, y: 80, w: 1040, h: 130, text: '', fontSize: 52, bold: true, color: '#241a0c', align: 'center', font: 'display' });
      slide.elements.push({ id: elId(), type: 'text', x: 180, y: 280, w: 920, h: 330, text: '', fontSize: 26, bold: false, color: '#3a2c1a', align: 'left', font: 'body' });
    }
    state.deck.slides.push(slide);
    state.cur = state.deck.slides.length - 1;
    state.sel = layout && state.sel ? state.sel : { kind: 'bg' };
    afterSlideChange();
  }

  function afterSlideChange() {
    renderThumbs(); renderCanvas(); renderInspector(); markDirty();
  }

  function selectSlide(i) {
    if (i < 0 || i >= state.deck.slides.length) return;
    state.cur = i;
    state.sel = { kind: 'bg' };
    renderThumbs(); renderCanvas(); renderInspector();
  }

  // events
  $('#ed-add-slide').addEventListener('click', () => {
    // universal: ikkala uslubda ham layout tanlovi ochiladi
    $('#ed-layouts').hidden = !$('#ed-layouts').hidden;
  });
  $('#ed-layouts').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-layout]');
    if (!chip) return;
    $('#ed-layouts').hidden = true;
    addSlide(chip.dataset.layout);
  });
  thumbs.addEventListener('click', (e) => {
    const t = e.target.closest('.ps-thumb');
    if (t && t.dataset.i !== undefined) selectSlide(+t.dataset.i);
  });
  $('#ed-slide-dup').addEventListener('click', () => {
    const src = curSlide();
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = slideId();
    copy.elements = (copy.elements || []).map((el) => ({ ...el, id: elId() }));
    state.deck.slides.splice(state.cur + 1, 0, copy);
    state.cur = Math.min(state.cur + 1, state.deck.slides.length - 1);
    state.sel = { kind: 'bg' };
    afterSlideChange();
  });
  $('#ed-slide-del').addEventListener('click', () => {
    if (state.deck.slides.length <= 1) return;
    state.deck.slides.splice(state.cur, 1);
    state.cur = Math.min(state.cur, state.deck.slides.length - 1);
    state.sel = { kind: 'bg' };
    afterSlideChange();
  });
  $('#ed-slide-up').addEventListener('click', () => {
    if (state.cur <= 0) return;
    const [s] = state.deck.slides.splice(state.cur, 1);
    state.deck.slides.splice(state.cur - 1, 0, s);
    state.cur -= 1;
    afterSlideChange();
  });
  $('#ed-slide-down').addEventListener('click', () => {
    if (state.cur >= state.deck.slides.length - 1) return;
    const [s] = state.deck.slides.splice(state.cur, 1);
    state.deck.slides.splice(state.cur + 1, 0, s);
    state.cur += 1;
    afterSlideChange();
  });

  // name change → save
  nameInp.addEventListener('input', () => {
    state.deck.name = nameInp.value;
    document.title = (state.deck.name || 'Taqdimot') + ' — Deborah';
    markDirty();
  });
  // Slayd ustida ikki marta bosish → matn joyida tahrirlanadi
  canvas.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.ps-el');
    if (!node) return;
    const slide = curSlide();
    if (!slide) return;
    const el = slide.elements.find((x) => x.id === node.dataset.id);
    if (!el || el.type !== 'text') return;
    startInlineEdit(el.id);
  });

  // resize
  window.addEventListener('resize', () => { layoutStage(); });
  // Enter to rename commit & blur
  nameInp.addEventListener('blur', () => { saveNow(); });

  // init
  layoutStage();
  renderThumbs();
  renderCanvas();
  renderInspector();
  present.setAttribute('target', '_blank');
  present.setAttribute('rel', 'noopener');
  status.textContent = T('saveOk', 'Saqlangan') + ' ✓';
  status.classList.add('ok');
})();
