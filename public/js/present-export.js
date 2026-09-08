/* ═══════════════════════════════════════════════════════════════
   Presentations Export (09/2026) — PDF / PPTX / PNG / JPG yuklab olish.
   WYSIWYG: slayd 1280×720 canvas'ga chiziladi (DOM renderer bilan bir xil
   model), so'ng:
     • PNG / JPG  → bitta slayd: to'g'ridan-to'g'ri; bir nechta: ZIP
     • PDF        → JPEG sahifalar server'da pure-JS PDF'ga joylanadi
     • PPTX       → pptxgenjs (server) full-bleed rasmlar — PowerPoint /
                    Google Slides / Canva import'da ochiladi
   Rasm elementlari: data: (upload) yoki /user/api/img?u= (same-origin proksi)
   → canvas taint bo'lmaydi.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const SW = 1280, SH = 720;
  const hex = (v, f) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : f);
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  function font(bold, size) { return (bold ? 800 : 400) + ' ' + size + 'px ' + FONT; }

  // ── Rasmlarni yuklash (barcha slaydlar bo'yicha) ──
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  async function loadDeckImages(deck) {
    const map = new Map();
    const seen = new Set();
    const list = [];
    (deck.slides || []).forEach((s) => (s.elements || []).forEach((e) => {
      if (e.type === 'image' && e.src && !seen.has(e.src)) { seen.add(e.src); list.push(e.src); }
    }));
    await Promise.all(list.map(async (src) => { map.set(src, await loadImage(src)); }));
    return map;
  }

  // ── Matn o'rash (canvas measureText) ──
  function wrapLines(ctx, text, maxW) {
    const out = [];
    for (const raw of String(text).split('\n')) {
      if (!raw) { out.push(''); continue; }
      const words = raw.split(' ');
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; }
        else line = test;
      }
      out.push(line);
    }
    return out;
  }

  function drawImageContain(ctx, img, x, y, w, h) {
    if (!img || !img.width) return;
    const sc = Math.min(w / img.width, h / img.height);
    const dw = img.width * sc, dh = img.height * sc;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function drawImageCover(ctx, img, x, y, w, h) {
    if (!img || !img.width) return;
    const sc = Math.max(w / img.width, h / img.height);
    const dw = img.width * sc, dh = img.height * sc;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function drawSlide(ctx, slide, imgs) {
    const bg = slide.bg || { type: 'solid', c1: '#f7eeda' };
    if (bg.type === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, Math.cos((bg.deg || 135) * Math.PI / 180) * SW, Math.sin((bg.deg || 135) * Math.PI / 180) * SH);
      g.addColorStop(0, hex(bg.c1, '#f6ecd9'));
      g.addColorStop(1, hex(bg.c2, '#c9a565'));
      ctx.fillStyle = g;
    } else ctx.fillStyle = hex(bg.c1, '#f7eeda');
    ctx.fillRect(0, 0, SW, SH);

    (slide.elements || []).forEach((e) => {
      const x = +e.x || 0, y = +e.y || 0, w = +e.w || 100, h = +e.h || 60;
      if (e.type === 'text') {
        if (!e.text) return;
        ctx.save();
        ctx.font = font(e.bold, e.fontSize || 24);
        ctx.fillStyle = hex(e.color, '#241a0c');
        ctx.textBaseline = 'top';
        const align = e.align || 'left';
        ctx.textAlign = align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left');
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        const lh = Math.round((e.fontSize || 24) * 1.22);
        const tx = align === 'center' ? x + w / 2 : (align === 'right' ? x + w : x);
        let ty = y;
        const maxLines = Math.max(1, Math.floor(h / lh));
        const lines = wrapLines(ctx, e.text, w).slice(0, maxLines);
        // vertikal markaz — layout'lar (title) uchun yaxshiroq ko'rinadi
        if ((e.align === 'center' && e.bold) || e.vcenter) ty = y + Math.max(0, (h - lines.length * lh) / 2);
        for (const ln of lines) { ctx.fillText(ln, tx, ty); ty += lh; }
        ctx.restore();
        return;
      }
      if (e.type === 'list') {
        ctx.save();
        ctx.font = font(e.bold, e.fontSize || 22);
        ctx.fillStyle = hex(e.color, '#241a0c');
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        const lh = Math.round((e.fontSize || 22) * 1.28);
        const gap = +e.gap || 12;
        let ty = y;
        (e.items || []).forEach((it) => {
          if (ty > y + h) return;
          const txt = String((it && it.txt) || '');
          if (txt) {
            const lines = wrapLines(ctx, '•  ' + txt, w);
            for (const ln of lines.slice(0, Math.max(1, Math.floor((h - (ty - y)) / lh)))) { ctx.fillText(ln, x, ty); ty += lh; }
          } else ty += lh;
          ty += gap;
        });
        ctx.restore();
        return;
      }
      if (e.type === 'shape') {
        const kind = e.kind || 'rect';
        ctx.save();
        const fill = hex(e.fill, '#c9a565');
        ctx.fillStyle = fill;
        if (kind === 'circle') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (kind === 'triangle') { ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); }
        else if (kind === 'diamond') { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(Math.PI / 4); const d = Math.min(w, h) * 0.72; ctx.fillRect(-d / 2, -d / 2, d, d); }
        else if (kind === 'line') { ctx.fillStyle = fill; ctx.fillRect(x, y + (h - Math.min(14, Math.max(3, e.h || 6))) / 2, w, Math.min(14, Math.max(3, e.h || 6))); }
        else { ctx.fillRect(x, y, w, h); }
        if (e.stroke && e.stroke !== 'transparent' && kind !== 'line') {
          ctx.strokeStyle = hex(e.stroke, '#241a0c');
          ctx.lineWidth = Math.max(1, +e.strokeW || 2);
          if (kind === 'circle') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - ctx.lineWidth / 2, h / 2 - ctx.lineWidth / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
          else if (kind === 'triangle') { ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.stroke(); }
          else if (kind === 'diamond') { ctx.save(); ctx.rotate(0); ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath(); ctx.stroke(); }
          else { ctx.strokeRect(x, y, w, h); }
        }
        ctx.restore();
        return;
      }
      if (e.type === 'image') {
        const img = imgs && imgs.get(e.src);
        if (!img) return;
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        drawImageCover(ctx, img, x, y, w, h);
        ctx.restore();
      }
    });
  }

  function renderCanvas(slide, imgs, type) {
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    drawSlide(ctx, slide, imgs);
    return type === 'png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
  }

  function csrf() {
    const w = window;
    if (w.__PRS && w.__PRS.CSRF) return w.__PRS.CSRF;
    const el = document.querySelector('input[name=_csrf], meta[name=csrf]');
    if (el) return el.value || el.content || '';
    const m = document.cookie.match(/csrfToken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function slug(s) {
    return String(s || 'taqdimot').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'taqdimot';
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  function dataUrlToBytes(dataUrl) {
    const i = dataUrl.indexOf(',');
    const b64 = dataUrl.slice(i + 1);
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    return u;
  }

  // ── ZIP (store, qaramliksiz) — ko'p slaydli PNG/JPG ──
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let off = 0;
    const w16 = (b, p, v) => { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; };
    const w32 = (b, p, v) => { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255; };
    files.forEach((f) => {
      const nameB = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new Uint8Array(30 + nameB.length);
      w32(lh, 0, 0x04034b50); w16(lh, 4, 20); w16(lh, 6, 0);
      w16(lh, 8, 0); w16(lh, 10, 0);
      w32(lh, 12, crc); w32(lh, 16, data.length); w32(lh, 20, data.length);
      w16(lh, 24, nameB.length); w16(lh, 26, 0);
      lh.set(nameB, 30);
      const ch = new Uint8Array(46 + nameB.length);
      w32(ch, 0, 0x02014b50); w16(ch, 4, 20); w16(ch, 6, 20); w16(ch, 8, 0);
      w16(ch, 10, 0); w16(ch, 12, 0); w16(ch, 14, 0);
      w32(ch, 16, crc); w32(ch, 20, data.length); w32(ch, 24, data.length);
      w16(ch, 28, nameB.length); w16(ch, 30, 0); w16(ch, 32, 0); w16(ch, 34, 0);
      w16(ch, 36, 0); w32(ch, 38, 0); w32(ch, 42, off);
      ch.set(nameB, 46);
      chunks.push(lh, data);
      central.push(ch);
      off += lh.length + data.length;
    });
    const cdLen = central.reduce((s, c) => s + c.length, 0);
    const cdOff = off;
    const eocd = new Uint8Array(22);
    w32(eocd, 0, 0x06054b50); w16(eocd, 4, 0); w16(eocd, 6, 0);
    w16(eocd, 8, files.length); w16(eocd, 10, files.length);
    w32(eocd, 12, cdLen); w32(eocd, 16, cdOff); w16(eocd, 20, 0);
    return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
  }

  async function exportImages(deck, type) {
    const imgs = await loadDeckImages(deck);
    const mime = type === 'png' ? 'image/png' : 'image/jpeg';
    const ext = type === 'png' ? 'png' : 'jpg';
    const files = [];
    (deck.slides || []).forEach((s, i) => {
      const data = renderCanvas(s, imgs, type);
      files.push({ name: 'slayd-' + (i + 1) + '.' + ext, data: dataUrlToBytes(data) });
    });
    const base = slug(deck.name);
    if (files.length === 1) download(new Blob([files[0].data], { type: mime }), base + '.' + ext);
    else download(zipStore(files), base + '-rasmlar.zip');
  }

  async function exportDoc(deck, fmt) {
    const imgs = await loadDeckImages(deck);
    const pages = (deck.slides || []).map((s) => renderCanvas(s, imgs, 'jpeg').split(',')[1]);
    const res = await fetch('/user/api/presentations/' + encodeURIComponent(deck.key || '') + '/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
      body: JSON.stringify({ fmt, pages }),
    });
    if (!res.ok) {
      let msg = res.status;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    download(blob, slug(deck.name) + '.' + fmt);
  }

  const RUN = { pdf: exportDoc, pptx: exportDoc, png: exportImages, jpg: exportImages };

  async function run(deck, fmt) {
    const fn = RUN[fmt];
    if (!fn || !deck || !Array.isArray(deck.slides) || !deck.slides.length) return;
    if (fmt === 'pdf' || fmt === 'pptx') await exportDoc(deck, fmt);
    else await exportImages(deck, fmt);
  }

  // ── Menyu (dropdown): deck + yorliqlar ──
  function closeMenu() { const m = document.getElementById('ps-exp-menu'); if (m) m.remove(); }
  function openAt(x, y, deck, L, busyHost) {
    closeMenu();
    const items = [
      ['pdf', L && L.pdf || 'PDF'],
      ['pptx', L && L.pptx || 'PPTX (PowerPoint)'],
      ['png', L && L.png || 'PNG (rasm)'],
      ['jpg', L && L.jpg || 'JPG (rasm)'],
    ];
    const m = document.createElement('div');
    m.id = 'ps-exp-menu';
    m.style.cssText = 'position:fixed;z-index:900;background:#fff;border:1px solid #e5dcc8;border-radius:14px;box-shadow:0 18px 44px rgba(20,13,6,.25);padding:6px;min-width:210px;font-family:system-ui,sans-serif;font-size:.88rem;';
    m.style.left = Math.max(8, Math.min(x, innerWidth - 230)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - 200)) + 'px';
    items.forEach(([f, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '↧ ' + label;
      b.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:none;padding:9px 12px;border-radius:9px;font:inherit;font-weight:700;cursor:pointer;color:#241a0c;';
      b.addEventListener('mouseenter', () => { b.style.background = '#f3ead6'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
      b.addEventListener('click', async () => {
        closeMenu();
        b.disabled = true;
        const old = busyHost ? busyHost.innerHTML : '';
        if (busyHost) busyHost.innerHTML = (L && L.busy || 'Tayyorlanmoqda…');
        try { await run(deck, f); }
        catch (err) { if (global.alert) alert(((L && L.fail) || 'Yuklab olishda xatolik') + ': ' + (err && err.message || err)); }
        finally { if (busyHost) busyHost.innerHTML = old; }
      });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    return m;
  }
  function attachMenu(btn, deck, L) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (document.getElementById('ps-exp-menu')) { closeMenu(); return; }
      const r = btn.getBoundingClientRect();
      const m = openAt(r.left, r.bottom + 6, deck, L, btn);
      setTimeout(() => {
        const onDoc = (e) => { if (!m.contains(e.target) && e.target !== btn) { closeMenu(); document.removeEventListener('pointerdown', onDoc); } };
        document.addEventListener('pointerdown', onDoc);
      }, 0);
    });
    return { close: closeMenu };
  }

  global.PresentExport = { run, attachMenu, openAt, closeMenu, renderCanvas, loadDeckImages, drawSlide, slug, download };
})(window);
