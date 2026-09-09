/**
 * Deborah — Present E2E C4-10 rev.3: drag-tartib, rasm ramkasi, orqa fon rasmi
 * -----------------------------------------------------------------------------
 * 1) Slaydlar drag&drop bilan qayta tartiblanadi → autosave → API tartib saqlangan.
 * 2) Rasm elementiga ramka (rang + qalinlik) → canvas'da ko'rinadi + saqlanadi.
 * 3) Tanlangan rasm slayd orqa foniga qo'yiladi (to-bg) va fayl yuklab ham
 *    orqa fon qilish (filechooser) — ikkala yo'l ham autosaqlanadi.
 * 4) View'da F (fullscreen) xatosiz, Esc bilan chiqish /user/presentations'ga.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';

let ctx;
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'rev3-present-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR4nGPcoqHBQA3ARBVTRg0aNWjUoBFsEADukAEkn/p7jAAAAABJRU5ErkJggg==';
const TINY_PNG = 'data:image/png;base64,' + TINY_PNG_B64;

async function apiVia(page, route, { method = 'GET', body, csrf } = {}) {
  return page.evaluate(async ({ route, method, body, csrf }) => {
    const res = await fetch(route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch (_) { json = txt; }
    return { status: res.status, json };
  }, { route, method, body, csrf });
}

async function createDeck(page, csrf, name, slides) {
  const created = await apiVia(page, '/user/api/presentations', { method: 'POST', csrf, body: { name, engine: 'slides', slides } });
  const key = created.status === 200 && created.json && (created.json.key || created.json.id);
  if (!key) throw new Error('deck yaratilmadi: ' + created.status);
  const save = await apiVia(page, `/user/api/presentations/${key}/save`, { method: 'POST', csrf, body: { name, engine: 'slides', slides } });
  if (save.status !== 200) throw new Error('deck saqlanmadi: ' + save.status);
  return key;
}
async function getDeck(page, csrf, key) {
  const r = await apiVia(page, `/user/api/presentations/${key}`, { csrf });
  return r.status === 200 && r.json ? r.json.deck : null;
}
const waitSaved = (page) => page.waitForFunction(() => {
  const s = document.querySelector('#ed-status');
  return s && /Saqlangan/.test(s.textContent || '');
}, null, { timeout: 12000 });

function slide(id, text) {
  return {
    id, layout: 'blank', bg: { type: 'solid', c1: '#f7eeda' },
    elements: [{ id: 'e_' + id, type: 'text', x: 60, y: 120, w: 600, h: 70, text, fontSize: 34, bold: true, color: '#241a0c' }],
  };
}

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); }, 60000);
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

describe('rev.3 present editor: tartib, ramka, orqa fon', () => {
  it('drag reorder + rasm ramkasi + orqa fon rasmi (to-bg va fayl) autosaqlanadi; view Esc/F ishlaydi', async () => {
    const seeder = await newPage(ctx);
    await seeder.goto(`${serverUrl}/user/presentations`, { waitUntil: 'domcontentloaded' });
    const csrf = await seeder.locator('input[name="_csrf"]').first().getAttribute('value');
    expect(csrf, 'csrf').toBeTruthy();

    // ── 1) Drag reorder ──
    const d1 = await createDeck(seeder, csrf, 'Tartib tekshiruvi', [
      slide('sl_a', 'Birinchi slayd'), slide('sl_b', 'Ikkinchi slayd'), slide('sl_c', 'Uchinchi slayd'),
    ]);
    const page = await newPage(ctx);
    const errs = [];
    page.on('pageerror', (e) => errs.push('P:' + e.message.slice(0, 140)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 140)); });
    await page.goto(`${serverUrl}/user/presentations/${d1}/edit`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ed-thumbs .ps-thumb');
    expect(await page.$$eval('#ed-thumbs .ps-thumb', (els) => els.map((e) => e.dataset.num)), 'boshlang‘ich tartib').toEqual(['1', '2', '3']);
    // 1 → 3 (dragstart/drop delegatsiyasi orqali). Eslatma: dataset.num =
    // pozitsiya+1, shaxs EMAS — tartib API'dan tekshiriladi (autosave'dan keyin).
    await page.evaluate(() => {
      const th = Array.from(document.querySelectorAll('#ed-thumbs .ps-thumb'));
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(th[0], 'dragstart'); fire(th[2], 'dragover'); fire(th[2], 'drop'); fire(th[0], 'dragend');
    });
    await waitSaved(page);
    const afterDrag = await getDeck(seeder, csrf, d1);
    expect(afterDrag.slides.map((s) => s.id), 'drag tartib API saqlangan').toEqual(['sl_b', 'sl_c', 'sl_a']);
    await page.screenshot({ path: `${SHOTS}/rev3-drag.png` }).catch(() => {});

    // ── 2) Rasm ramkasi + orqa fon ──
    const d2 = await createDeck(seeder, csrf, 'Ramka va fon', [{
      id: 'sl_x', layout: 'blank', bg: { type: 'solid', c1: '#f2e3c2' },
      elements: [
        { id: 'im_1', type: 'image', x: 220, y: 150, w: 320, h: 210, src: TINY_PNG },
        { id: 'tx_1', type: 'text', x: 60, y: 60, w: 600, h: 50, text: 'Rasm + ramka', fontSize: 28, bold: true, color: '#241a0c' },
      ],
    }]);
    await page.goto(`${serverUrl}/user/presentations/${d2}/edit`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ed-canvas .ps-el-img');
    // Bosish .ps-el wrapper'iga boradi (img ustini parent qoplaydi)
    await page.click('#ed-canvas .ps-el[data-id="im_1"]');
    await page.waitForSelector('#ed-inspector [data-to-bg]');
    // ramka rangi
    await page.click('#ed-inspector .ps-swatch[data-key="stroke"][data-val="#a37f3a"]');
    await page.waitForSelector('#ed-inspector input[aria-label="Ramka qalinligi"]');
    // ramka qalinligi 8
    await page.fill('#ed-inspector input[aria-label="Ramka qalinligi"]', '8');
    await waitSaved(page);
    const borderTop = await page.$eval('#ed-canvas .ps-el-img', (el) => getComputedStyle(el).borderTopWidth).catch(() => '0px');
    expect(borderTop, 'canvas ramka ko‘rinadi').toBe('8px');
    const d2f = await getDeck(seeder, csrf, d2);
    const imEl = d2f.slides[0].elements.find((e) => e.type === 'image');
    expect(imEl.stroke, 'ramka rangi saqlandi').toBe('#a37f3a');
    expect(imEl.strokeW, 'ramka qalinligi saqlandi').toBe(8);
    await page.screenshot({ path: `${SHOTS}/rev3-frame.png` }).catch(() => {});

    // rasmni orqa fonga qo‘yish (to-bg)
    await page.click('#ed-inspector [data-to-bg]');
    await page.waitForSelector('#ed-inspector [data-bgimg-clear]');
    await waitSaved(page);
    const d2bg = await getDeck(seeder, csrf, d2);
    expect(d2bg.slides[0].bg.type, 'bg — image turi').toBe('image');
    expect(String(d2bg.slides[0].bg.src || '').slice(0, 22), 'bg rasm saqlandi').toBe('data:image/png;base64,');
    // Canvas (asosiy) va thumb'da rasmli fon stilini tekshiramiz
    const bgVisual = await page.evaluate(() => {
      const out = [];
      const root = document.querySelector('#ed-canvas');
      if (root && root.firstElementChild) out.push('canvas:' + (root.firstElementChild.getAttribute('style') || ''));
      const th = document.querySelector('#ed-thumbs .ps-thumb.on');
      if (th) out.push('thumb:' + Array.from(th.querySelectorAll('div')).map((d) => d.getAttribute('style') || '').join(' | '));
      return out.join('\n');
    });
    expect(bgVisual, 'canvas/thumb orqa fon rasmi').toContain('data:image/png');
    await page.screenshot({ path: `${SHOTS}/rev3-tobg.png` }).catch(() => {});

    // fayl yuklash orqali orqa fon (filechooser → downscale → bg)
    await page.click('#ed-inspector [data-bgimg-clear]');
    await page.waitForSelector('#ed-inspector [data-bgimg]');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#ed-inspector [data-bgimg]'),
    ]);
    await chooser.setFiles({ name: 'fon.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') });
    await page.waitForSelector('#ed-inspector [data-bgimg-clear]');
    await waitSaved(page);
    const d2up = await getDeck(seeder, csrf, d2);
    expect(d2up.slides[0].bg.type, 'upload bg — image turi').toBe('image');
    expect(String(d2up.slides[0].bg.src || '').slice(0, 22), 'upload bg rasm').toBe('data:image/png;base64,');

    // ── 3) View: F xatosiz, Esc chiqish ──
    await page.goto(`${serverUrl}/user/presentations/${d2}/view`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ps-v-canvas img', { timeout: 8000 });
    await page.keyboard.press('F'); // fullscreen (headless'da mumkin bo'lsa) — xato bo'lmasligi kerak
    await page.keyboard.press('Escape'); // fullscreen bo'lsa — undan chiqadi
    await page.keyboard.press('Escape'); // bo'lmasa/chiqqach — view'dan chiqadi
    // Esc view'dan chiqaradi: referrer (oldingi sahifa) yoki /user/presentations —
    // asosiysi endi /view'da turmaymiz
    await page.waitForFunction(() => !location.pathname.endsWith('/view'), null, { timeout: 9000 });
    expect(errs, 'pageerror/console-error yo‘q').toEqual([]);
    await page.close().catch(() => {});
    await seeder.close().catch(() => {});
  }, 150000);
});
