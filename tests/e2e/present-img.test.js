/**
 * Deborah — Present E2E: rasm saqlanib boshqa sessiya/qurilmada ko'rinishi (C4-10 rev.2)
 * ------------------------------------------------------------------------------------
 * Deck API orqali dataURL rasm bilan yaratiladi → /view (taqdimot rejimi) va
 * /edit sahifalari yangi context (yangi "qurilma") da ochilib img naturalWidth>0
 * bo'lishi tekshiriladi — bu boshqa qurilmada rasm o'rni bo'sh qolishi
 * regressiyasini ushlaydi. Shuningdek editor canvas'idagi rasm ham yuklanishi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';

let ctx;
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'present-img-shots');
fs.mkdirSync(SHOTS, { recursive: true });

// 1x1 qizil PNG (dataURL) — saqlash chegarasidan kichik
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR4nGPcoqHBQA3ARBVTRg0aNWjUoBFsEADukAEkn/p7jAAAAABJRU5ErkJggg==';

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

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); }, 60000);
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

describe('present rasm: saqlash → yangi qurilmada ko‘rinish', () => {
  it('dataURL rasmli deck — view va editor yangi contextda ham rasm ko‘rinadi', async () => {
    // 1) Deck yaratish — bitta "seeder" sahifa: CSRF shu yerda olinadi, API shu yerda ishlaydi
    const seeder = await newPage(ctx);
    await seeder.goto(`${serverUrl}/user/presentations`, { waitUntil: 'domcontentloaded' });
    const csrf = await seeder.locator('input[name="_csrf"]').first().getAttribute('value');
    expect(csrf, 'csrf token').toBeTruthy();
    const body = {
      name: 'Rasm tekshiruvi',
      engine: 'slides',
      slides: [{
        id: 'sl_a', layout: 'blank',
        bg: { type: 'solid', c1: '#f7eeda' },
        elements: [
          { id: 'el_1', type: 'image', x: 300, y: 140, w: 300, h: 200, src: TINY_PNG },
          { id: 'el_2', type: 'text', x: 60, y: 60, w: 400, h: 60, text: 'Rasmli slayd', fontSize: 30, bold: true, color: '#241a0c' },
        ],
      }],
    };
    const created = await apiVia(seeder, '/user/api/presentations', { method: 'POST', body, csrf });
    expect(created.status, 'create status').toBe(200);
    const deckKey = created.json && (created.json.key || created.json.id);
    expect(deckKey, 'deck key').toBeTruthy();

    // 2) Editor oqimi: slaydlar /save orqali saqlanadi (create faqat bo'sh deck yaratadi)
    const save = await apiVia(seeder, `/user/api/presentations/${deckKey}/save`, {
      method: 'POST', csrf,
      body: { name: 'Rasm tekshiruvi', engine: 'slides', slides: body.slides },
    });
    expect(save.status, 'save status').toBe(200);

    // 3) Qayta o'qish (API) — src saqlanganini tasdiqlash
    const loaded = await apiVia(seeder, `/user/api/presentations/${deckKey}`, { csrf });
    expect(loaded.status).toBe(200);
    await seeder.close().catch(() => {});
    const deckJson = loaded.json && loaded.json.deck;
    const imgEl = deckJson && deckJson.slides && deckJson.slides[0].elements.find((e) => e.type === 'image');
    expect(imgEl && imgEl.src, 'rasm src saqlangan').toMatch(/^data:image\/png;base64/);

    // 4) "Boshqa qurilma" — YANGI context (alohida brauzer profili) (cookie'siz emas, alohida brauzer profili)
    const other = await newContext();
    const page = await newPage(other);
    const errs = [];
    page.on('pageerror', (e) => errs.push('P:' + e.message.slice(0, 120)));
    await loginAsUser(other); // login page context'ga cookie yozadi
    // View (taqdimot rejimi)
    await page.goto(`${serverUrl}/user/presentations/${deckKey}/view`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ps-v-canvas img', { timeout: 8000 });
    const imgInfo = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('.ps-v-canvas img'));
      return { count: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
    });
    expect(imgInfo.count, 'view rasm elementlari').toBeGreaterThan(0);
    expect(imgInfo.ok, 'view rasmlari yuklandi').toBe(imgInfo.count);
    await page.screenshot({ path: `${SHOTS}/view-img.png` }).catch(() => {});

    // Editor ham yangi context'da
    await page.goto(`${serverUrl}/user/presentations/${deckKey}/edit`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ps-el-img', { timeout: 8000 });
    const edOk = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('#ed-canvas .ps-el-img'));
      return { count: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
    });
    expect(edOk.count, 'editor rasm elementlari').toBeGreaterThan(0);
    expect(edOk.ok, 'editor rasmlari yuklandi').toBe(edOk.count);
    await page.screenshot({ path: `${SHOTS}/editor-img.png` }).catch(() => {});
    expect(errs, 'pageerror yo‘q').toEqual([]);
    await page.close().catch(() => {});
    await other.close().catch(() => {});
  }, 90000);
});
