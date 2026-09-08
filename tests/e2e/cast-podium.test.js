/**
 * Deborah — Cast E2E: Avto-shohsupa / podium (C4-09)
 * ----------------------------------------------------
 * Savol yopilgach 3s o'tib LEADERBOARD proyeksiyalari + podium overlay:
 *  - participant: shaxsiy o'rin (#part-podium) ko'rinadi va keyingi savol
 *    preview'ida yopiladi;
 *  - HOST_CONTROLLED: direktor questionNext bosmaguncha podium turadi;
 *  - FULLY_AUTO: podium 5s ushlab turiladi, so'ng next (q2 preview)
 *    avtomatik chiqadi; oxirgi savoldan keyin session o'zi yakunlanadi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';
import { createSession, generateSessionId, generateJoinCode, upsertRole } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';
import { CAST_LB_VISIBILITY, CAST_LB_FREQUENCY, CAST_ADVANCE_MODE } from '../../utils/cast-constants.js';

let ctx;

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); });
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

const mkSession = async ({ advanceMode, title = 'Podium E2E' }) => {
  const sessionId = generateSessionId();
  const joinCode = generateJoinCode();
  const mk = (n, text) => ({
    id: n,
    text,
    options: ['o_a', 'o_b', 'o_c', 'o_d'].map((id) => ({ id })),
  });
  await createSession({
    sessionId, joinCode,
    meta: { title, tier: 'S' },
    config: {
      scoring: { scorePolicy: 'accuracy' },
      timer: { mode: 'soft', defaultSeconds: 90 },
      playback: { thinkSeconds: 1, advanceMode },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.TOP_N,
        finalVisibility: CAST_LB_VISIBILITY.TOP_N,
        topN: 5,
        frequency: CAST_LB_FREQUENCY.EVERY_QUESTION,
        anonymizeLowRanks: true,
        showExactScore: false,
      },
      participation: { paperCardMode: false },
      ai: { cohostMode: 'off', mayExecuteLiveActions: false, teacherApprovalRequired: true },
    },
    state: initialState({ primaryDirectorId: 'user:user', questionIds: ['q_01', 'q_02'], questionCount: 2, choreography: null }),
    privateQuestions: [mk('q_01'), mk('q_02')].map((q) => ({ id: q.id, correctOptionIds: ['o_a'], options: q.options })),
    publicQuestions: [
      { id: 'q_01', text: 'Birinchi savol', options: ['o_a', 'o_b', 'o_c', 'o_d'].map((id) => ({ id, text: id })) },
      { id: 'q_02', text: 'Ikkinchi savol', options: ['o_a', 'o_b', 'o_c', 'o_d'].map((id) => ({ id, text: id })) },
    ],
  });
  await upsertRole(sessionId, { actorId: 'user:user', role: 'owner', assignedAt: Date.now(), assignedBy: 'user:user' });
  return { sessionId, joinCode };
};

async function joinPage(name, joinCode) {
  const page = await newPage(ctx);
  await page.goto(`${serverUrl}/play?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#join-form');
  await page.fill('#join-code', joinCode);
  await page.fill('#join-name', name);
  await page.click('#join-form button[type="submit"], #join-form button');
  await page.waitForTimeout(2000);
  return page;
}

async function directorSocket() {
  const cookies = await ctx.cookies();
  const sock = io(serverUrl, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } });
  await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('socket timeout')), 8000); });
  const emit = (type, payload = {}) => new Promise((r) => { sock.emit('cast:command', { commandId: `c-${Math.random().toString(36).slice(2, 8)}`, sessionId: sock.sessionId, type, payload, sentAtClient: Date.now() }, (a) => r(a)); });
  sock.emitRaw = emit;
  return sock;
}

async function openAndAnswer(page, sock) {
  expect((await sock.emitRaw('cast:sessionStart', {})).ok).toBe(true);
  expect((await sock.emitRaw('cast:questionOpen', {})).ok).toBe(true);
  await page.waitForSelector('#part-options .cast-option', { timeout: 12000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('#part-options .cast-option');
    return btn && getComputedStyle(btn).display !== 'none';
  }, { timeout: 12000 });
  await page.click('#part-options .cast-option');
  await page.waitForSelector('#part-submit:not([hidden])', { timeout: 6000 });
  await page.click('#part-submit');
  await page.waitForTimeout(700);
}

const podiumNum = (page) => page.evaluate(() => {
  const el = document.getElementById('part-podium');
  return { hidden: el ? el.hidden : null, num: document.getElementById('part-podium-num')?.textContent || null };
});

describe('T-04 cast-podium: 3s → shohsupa → next (C4-09)', () => {
  it('HOST_CONTROLLED: savol yopilishi → 3s → podium; next da yopiladi', async () => {
    const { sessionId, joinCode } = await mkSession({ advanceMode: CAST_ADVANCE_MODE.HOST_CONTROLLED });
    const a = await joinPage('BotA', joinCode);
    const b = await joinPage('BotB', joinCode);
    const sock = await directorSocket();
    sock.sessionId = sessionId;

    await openAndAnswer(a, sock);
    // ikkinchi ishtirokchi ham javob beradi (boshqa variant)
    await b.waitForSelector('#part-options .cast-option', { timeout: 12000 });
    await b.waitForFunction(() => {
      const btn = document.querySelector('#part-options .cast-option');
      return btn && getComputedStyle(btn).display !== 'none';
    }, { timeout: 12000 });
    await b.click('#part-options .cast-option:nth-child(2)');
    await b.waitForSelector('#part-submit:not([hidden])', { timeout: 6000 });
    await b.click('#part-submit');
    await b.waitForTimeout(700);

    const t0 = Date.now();
    expect((await sock.emitRaw('cast:questionClose', {})).ok).toBe(true);

    // 3s ichida overlay chiqmaydi, so'ng podium ko'rinadi
    try {
      await a.waitForFunction(() => {
        const el = document.getElementById('part-podium');
        return el && !el.hidden;
      }, { timeout: 9000 });
    } catch (err) {
      const dbg = await a.evaluate(() => (window.__podLog || []).slice(-10));
      console.log('[E2E podlog-onfail]', JSON.stringify(dbg));
      throw err;
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(2800);
    const pa = await podiumNum(a);
    const pb = await podiumNum(b);
    expect(pa.hidden).toBe(false);
    expect(pb.hidden).toBe(false);
    expect(String(pa.num)).toMatch(/^[12]$/);
    expect(String(pb.num)).toMatch(/^[12]$/);
    const scoreShown = await a.evaluate(() => !document.getElementById('part-podium-score').hidden);
    expect(scoreShown).toBe(true);

    // Direktor next → q2 preview; podium yopiladi
    expect((await sock.emitRaw('cast:questionNext', {})).ok).toBe(true);
    await a.waitForFunction(() => document.getElementById('part-q-text')?.textContent === 'Ikkinchi savol', { timeout: 8000 });
    const afterNext = await podiumNum(a);
    expect(afterNext.hidden).toBe(true);
    sock.close();
    await a.close().catch(() => {});
    await b.close().catch(() => {});
  }, 60000);

  it('FULLY_AUTO: podium 5s → avto next; oxirgi savolda avto session end', async () => {
    const { sessionId, joinCode } = await mkSession({ advanceMode: CAST_ADVANCE_MODE.FULLY_AUTO });
    const a = await joinPage('BotAuto', joinCode);
    const sock = await directorSocket();
    sock.sessionId = sessionId;

    // Q1: ochish, javob, yopish → podium (3s) → avto next (q2 preview, direktor harakatsiz)
    await openAndAnswer(a, sock);
    const t0 = Date.now();
    expect((await sock.emitRaw('cast:questionClose', {})).ok).toBe(true);
    await a.waitForFunction(() => {
      const el = document.getElementById('part-podium');
      return el && !el.hidden;
    }, { timeout: 9000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2800);

    // Avto-next hech qanday direktor buyrug'isiz: q2 faqat ~3s+5s ushlab turishdan
    // keyin chiqadi (erta chiqsa hold ishlamagan bo'ladi)
    await a.waitForFunction(() => document.getElementById('part-q-text')?.textContent === 'Ikkinchi savol', { timeout: 20000 });
    const autoAdvanceMs = Date.now() - t0;
    expect(autoAdvanceMs).toBeGreaterThanOrEqual(7500);
    const autoHide = await podiumNum(a);
    expect(autoHide.hidden).toBe(true);

    // Q2: javob + yopish → oxirgi podium → avto session end (direktor aralashmasdan)
    await a.waitForFunction(() => {
      const btn = document.querySelector('#part-options .cast-option');
      return btn && getComputedStyle(btn).display !== 'none';
    }, { timeout: 12000 });
    await a.click('#part-options .cast-option:nth-child(3)');
    await a.waitForSelector('#part-submit:not([hidden])', { timeout: 6000 });
    await a.click('#part-submit');
    await a.waitForTimeout(700);
    expect((await sock.emitRaw('cast:questionClose', {})).ok).toBe(true);
    await a.waitForFunction(() => {
      const el = document.getElementById('part-podium');
      return el && !el.hidden;
    }, { timeout: 9000 });
    await a.waitForFunction(() => {
      const t = document.getElementById('part-reveal-title');
      return t && t.textContent === 'Sessiya tugadi';
    }, { timeout: 15000 });
    sock.close();
    await a.close().catch(() => {});
  }, 90000);
});
