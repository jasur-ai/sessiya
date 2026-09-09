/**
 * Deborah — Cast E2E: oddiy (simple) rejim + QR + Panel/Testlar split (C4-10)
 * ---------------------------------------------------------------------------
 * 1) simple rejim director: ilg'or vositalar CSS bilan yashirin (rail-tools,
 *    Pauza/Muhokama/Qayta ovoz), lekin asosiy lobbi va QR ko'rinadi.
 * 2) QR: join kodi yonida kichik ko'rinadi; bosilganda kattalashgan modal +
 *    to'g'ri /play?code= havolasi; /cast/qr endpointi 200 SVG qaytaradi.
 * 3) /user/panel = umumiy ma'lumot (overview) + buklangan Testlar;
 *    /user/tests = alohida to'liq kutubxona sahifasi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';
import { createSession, generateSessionId, generateJoinCode, upsertRole } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';

let ctx;
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'cast-simple-ui-shots');
fs.mkdirSync(SHOTS, { recursive: true });

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); }, 60000);
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

async function mkSession({ title = 'UI E2E', ui = null } = {}) {
  const sessionId = generateSessionId();
  const joinCode = generateJoinCode();
  const qs = ['q_01', 'q_02'];
  await createSession({
    sessionId, joinCode,
    meta: { title, tier: 'S', ...(ui ? { ui } : {}) },
    config: {
      scoring: { scorePolicy: 'accuracy' },
      timer: { mode: 'soft', defaultSeconds: 90 },
      playback: { thinkSeconds: 1, advanceMode: 'host_controlled' },
      participation: { paperCardMode: false },
      ai: { cohostMode: 'off', mayExecuteLiveActions: false, teacherApprovalRequired: true },
    },
    state: initialState({ primaryDirectorId: 'user:user', questionIds: qs, questionCount: qs.length, choreography: null }),
    privateQuestions: qs.map((id) => ({ id, correctOptionIds: ['o_a'], options: ['o_a', 'o_b', 'o_c', 'o_d'].map((x) => ({ id: x })) })),
    publicQuestions: qs.map((id, i) => ({ id, text: `Savol ${i + 1}`, options: ['o_a', 'o_b', 'o_c', 'o_d'].map((x) => ({ id: x, text: x })) })),
  });
  await upsertRole(sessionId, { actorId: 'user:user', role: 'owner', assignedAt: Date.now(), assignedBy: 'user:user' });
  return { sessionId, joinCode };
}

async function openDirector(sessionId) {
  const page = await newPage(ctx);
  const errs = [];
  page.on('pageerror', (e) => errs.push('P:' + e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 120)); });
  // QR request goto paytida ishga tushadi — oldindan promise olamiz
  const qrRespP = page.waitForResponse((r) => r.url().includes('/cast/qr?d='), { timeout: 10000 }).catch(() => null);
  await page.goto(`${serverUrl}/cast/${sessionId}/director`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const el = document.getElementById('dir-code-big');
    return el && el.textContent && el.textContent !== '—';
  }, null, { timeout: 10000 });
  const qrResp = await qrRespP;
  return { page, errs, qrResp };
}

describe('C4-10 cast director: oddiy rejim + QR', () => {
  it('simple rejim: ilg‘or tugmalar yashirin, QR kichik ko‘rinadi va kattalashadi', async () => {
    const { sessionId, joinCode } = await mkSession({ title: 'Oddiy rejim', ui: 'simple' });
    const { page, errs, qrResp } = await openDirector(sessionId);
    // body.cast-simple
    expect(await page.evaluate(() => document.body.classList.contains('cast-simple')), 'simple klass').toBe(true);
    // C4-10 rev.3: yorliq «Cast qilish» + yangi favicon (logo-icon.svg)
    const startTxt = (await page.locator('#btn-start-session').textContent() || '').replace(/\s+/g, ' ').trim();
    expect(startTxt, 'start tugmasi «Cast qilish»').toContain('Cast qilish');
    const iconHref = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(iconHref, 'favicon yangi logo').toContain('logo-icon.svg');
    const hasOldFav = await page.locator('link[rel="icon"][href*="vintage"], link[rel="icon"][href*="favicon"]').count();
    expect(hasOldFav, 'eski favicon yo\u2018q').toBe(0);
    // Yashirilgan boshqaruv: display:none (CSS) → isVisible false
    for (const sel of ['#btn-pause', '#btn-resume', '#btn-discuss', '#btn-revote', '.rail-tools']) {
      expect(await page.locator(sel).first().isVisible(), `${sel} simple rejimda yashirin`).toBe(false);
    }
    // QR endpoint ishlayapti
    expect(qrResp, 'QR SVG requesti').toBeTruthy();
    if (qrResp) {
      expect(qrResp.status(), 'QR status').toBe(200);
      expect(await qrResp.text(), 'QR SVG tarkibi').toContain('<svg');
    }
    // Kichik QR: wrap ko'rinadi, img src /cast/qr?d= (play?code= havolasi)
    const wrap = page.locator('#dir-qr-wrap');
    expect(await wrap.isVisible(), 'kichik QR ko‘rinadi').toBe(true);
    const qrSrc = await page.locator('#dir-qr').getAttribute('src');
    expect(qrSrc, 'QR src endpoint').toMatch(/^\/cast\/qr\?d=/);
    const link = await page.locator('#dir-join-link').textContent();
    expect(link, 'join link').toBe(`${serverUrl}/play?code=${joinCode}`);
    await page.screenshot({ path: `${SHOTS}/simple-director.png` }).catch(() => {});
    // Modal: kattalashgan QR + havola
    await page.click('#btn-qr-open');
    await page.waitForSelector('#qr-modal:not([hidden])', { timeout: 5000 });
    const bigSrc = await page.locator('#dir-qr-big').getAttribute('src');
    expect(bigSrc, 'katta QR src').toMatch(/^\/cast\/qr\?d=/);
    const modalUrl = await page.locator('#dir-qr-url').textContent();
    expect(modalUrl, 'modal havola').toBe(`${serverUrl}/play?code=${joinCode}`);
    const dims = await page.locator('#dir-qr-big').evaluate((el) => ({ w: el.width, h: el.height }));
    expect(dims.w, 'katta QR kenglik').toBeGreaterThan(200);
    // C4-10 rev.3: katta ekranda ham kod raqami ko'rinadi — yarim-shaffof fon ustida
    const codeTxt = (await page.locator('#dir-qr-code').textContent() || '').trim();
    expect(codeTxt, 'modal katta kod raqami').toBe(joinCode);
    const codeFont = await page.locator('#dir-qr-code').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(codeFont, 'kod shrifti katta').toBeGreaterThanOrEqual(26);
    const modalBg = await page.locator('#qr-modal').evaluate((el) => getComputedStyle(el).backgroundColor);
    const alpha = Number(String(modalBg).match(/[\d.]+\s*\)\s*$/)?.[0].replace(/[^\d.]/g, '') || 0);
    expect(alpha, 'modal foni yarim-shaffof (kod orqada xira ko\u2018rinadi)').toBeGreaterThanOrEqual(0.5);
    await page.screenshot({ path: `${SHOTS}/simple-qr-modal.png` }).catch(() => {});
    expect(errs, 'pageerror/console-error yo‘q').toEqual([]);
    await page.close().catch(() => {});
  }, 60000);

  it('simple oqim: o‘ng boshqaruv yashirin, yagona pill bilan savol yopiladi', async () => {
    const { sessionId } = await mkSession({ title: 'Oddiy oqim', ui: 'simple' });
    const { page, errs } = await openDirector(sessionId);
    // Rail'ning o'zi yashirin (primary + secondary group'lar)
    expect(await page.locator('.rail-primary').first().isVisible(), 'rail-primary yashirin').toBe(false);
    expect(await page.locator('.rail-secondary').first().isVisible(), 'rail-secondary yashirin').toBe(false);
    // Lobbi bosqichida pill ko'rinmaydi
    expect(await page.locator('#btn-close-pill').isVisible(), 'pill lobbida yashirin').toBe(false);
    // Sessiyani boshlash
    await page.click('#btn-start-session');
    await page.waitForFunction(() => {
      const pill = document.getElementById('btn-close-pill');
      return pill && !pill.hidden;
    }, null, { timeout: 12000 });
    const pillLabel = await page.locator('#btn-close-pill [data-close-label]').textContent();
    expect(pillLabel.trim(), 'pill matni').toBe('Savolni yopish');
    // Savol ochilgach timer chipi ko'rinadi (soft 90s)
    const timerBox = page.locator('#dir-timer');
    expect(await timerBox.evaluate((el) => el.classList.contains('has-timer')), 'timer chip has-timer').toBe(true);
    expect(await timerBox.isVisible(), 'timer chip ko‘rinadi').toBe(true);
    await page.screenshot({ path: `${SHOTS}/simple-question-pill.png` }).catch(() => {});
    // Pill orqali savolni yopamiz → pill yana yashirin
    await page.click('#btn-close-pill');
    await page.waitForFunction(() => {
      const pill = document.getElementById('btn-close-pill');
      return pill && pill.hidden;
    }, null, { timeout: 10000 });
    expect(errs, 'pageerror/console-error yo‘q').toEqual([]);
    await page.close().catch(() => {});
  }, 60000);

  it('to‘liq rejim: rail-tools va muhokama tugmasi ko‘rinadi, QR ham bor', async () => {
    const { sessionId } = await mkSession({ title: 'To‘liq rejim' });
    const { page, errs } = await openDirector(sessionId);
    expect(await page.evaluate(() => document.body.classList.contains('cast-simple')), 'full — simple klass yo‘q').toBe(false);
    expect(await page.locator('.rail-tools').first().isVisible(), 'rail-tools to‘liq rejimda ko‘rinadi').toBe(true);
    expect(await page.locator('#btn-discuss').isVisible(), 'Muhokama to‘liq rejimda ko‘rinadi').toBe(true);
    expect(await page.locator('#dir-qr-wrap').isVisible(), 'QR to‘liq rejimda ham bor').toBe(true);
    expect(errs, 'pageerror yo‘q').toEqual([]);
    await page.screenshot({ path: `${SHOTS}/full-director.png` }).catch(() => {});
    await page.close().catch(() => {});
  }, 60000);
});

describe('C4-10 user sahifalari: panel = umumiy, testlar alohida bo‘lim', () => {
  it('/user/panel — overview + buklangan testlar; /user/tests — to‘liq kutubxona', async () => {
    const panel = await newPage(ctx);
    await panel.goto(`${serverUrl}/user/panel`, { waitUntil: 'domcontentloaded' });
    // Overview (umumiy ma'lumot) — asosiy tarkib
    expect(await panel.locator('.ov-sec').count(), 'overview bo‘limi').toBeGreaterThan(0);
    expect(await panel.locator('.ov-card').count(), 'statistika kartalari').toBeGreaterThanOrEqual(4);
    // Testlar kutubxonasi buklangan details ichida (auth DOM'i saqlanadi)
    const fold = panel.locator('details#ws-lib-fold');
    expect(await fold.count(), 'ws-lib-fold mavjud').toBe(1);
    expect(await fold.evaluate((el) => el.open), 'details yopiq (buklangan)').toBe(false);
    // Sidebar: Testlar bo'limiga havola
    expect(await panel.locator('.shell-nav-link[href="/user/tests"]').count(), 'Testlar havolasi sidebar').toBeGreaterThan(0);
    await panel.screenshot({ path: `${SHOTS}/user-panel.png` }).catch(() => {});
    await panel.close().catch(() => {});

    const tests = await newPage(ctx);
    await tests.goto(`${serverUrl}/user/tests`, { waitUntil: 'domcontentloaded' });
    // Alohida sahifa: overview yo'q, kutubxona to'liq va ochiq
    expect(await tests.locator('.ov-sec').count(), 'tests sahifasida overview yo‘q').toBe(0);
    expect(await tests.locator('details#ws-lib-fold').count(), 'tests sahifasida fold yo‘q').toBe(0);
    expect(await tests.locator('#lib-list').isVisible(), 'kutubxona ro‘yxati ko‘rinadi').toBe(true);
    expect(await tests.locator('input#lib-search').isVisible(), 'qidiruv ko‘rinadi').toBe(true);
    // Sidebar: Testlar bo‘limi active
    expect(await tests.locator('.shell-nav-link[href="/user/tests"].active').count(), 'Testlar active').toBeGreaterThan(0);
    await tests.screenshot({ path: `${SHOTS}/user-tests.png` }).catch(() => {});
    await tests.close().catch(() => {});
  }, 60000);
});
