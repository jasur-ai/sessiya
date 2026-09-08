/**
 * Deborah — Cast E2E: Staging (C4-08) 3-sekund qoidasi
 * -----------------------------------------------------
 * Savol ochilishida (think/preview): avval faqat savol matni + ko'rinadigan
 * countdown chip ko'rsatiladi; variantlar faqat questionOpened'dan keyin
 * ochiladi (server thinkSeconds). CLASSIC_LIVE preset'ida thinkSeconds=3.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';
import { createSession, generateSessionId, generateJoinCode, upsertRole } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';

let ctx;

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); });
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

describe('T-03 cast-staging: 3s rule', () => {
  it('preview: faqat savol + countdown chip; opened: variantlar ochiladi', async () => {
    const sessionId = generateSessionId();
    const joinCode = generateJoinCode();
    const qid = 'q_01';
    await createSession({
      sessionId, joinCode,
      meta: { title: 'Stage E2E', tier: 'S' },
      config: {
        scoring: { scorePolicy: 'accuracy' },
        timer: { mode: 'soft', defaultSeconds: 30 },
        playback: { thinkSeconds: 3 },
        participation: { paperCardMode: false },
        ai: { cohostMode: 'off', mayExecuteLiveActions: false, teacherApprovalRequired: true },
      },
      state: initialState({ primaryDirectorId: 'user:user', questionIds: [qid], questionCount: 1, choreography: null }),
      privateQuestions: [{ id: qid, correctOptionIds: ['o_a'], options: ['o_a', 'o_b', 'o_c', 'o_d'].map((id) => ({ id })) }],
      publicQuestions: [{ id: qid, text: 'Staging test savol', options: [
        { id: 'o_a', text: 'Variant A' }, { id: 'o_b', text: 'Variant B' },
        { id: 'o_c', text: 'Variant C' }, { id: 'o_d', text: 'Variant D' },
      ] }],
    });
    await upsertRole(sessionId, { actorId: 'user:user', role: 'owner', assignedAt: Date.now(), assignedBy: 'user:user' });

    const page = await newPage(ctx);
    await page.goto(`${serverUrl}/play?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#join-form');
    await page.fill('#join-code', joinCode);
    await page.fill('#join-name', 'Bot');
    await page.click('#join-form button[type="submit"], #join-form button');
    await page.waitForTimeout(2000);

    const cookies = await ctx.cookies();
    const sock = io(serverUrl, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } });
    await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('socket timeout')), 8000); });
    const emit = (type, payload = {}) => new Promise((r) => { sock.emit('cast:command', { commandId: `c-${Math.random().toString(36).slice(2, 8)}`, sessionId, type, payload, sentAtClient: Date.now() }, (a) => r(a)); });
    expect((await emit('cast:sessionStart', {})).ok).toBe(true);
    expect((await emit('cast:questionOpen', {})).ok).toBe(true);

    // Staging: savol matni ko'rinadi, variantlar yo'q, countdown chip yoniq
    await page.waitForFunction(() => {
      const el = document.getElementById('part-stage-cd');
      const qEl = document.getElementById('part-question');
      return qEl && !qEl.hidden && el && !el.hidden && /^[123]$/.test((document.getElementById('part-stage-num') || {}).textContent || '');
    }, { timeout: 7000 });
    const during = await page.evaluate(() => ({
      qText: document.getElementById('part-q-text')?.textContent,
      num: document.getElementById('part-stage-num')?.textContent,
      chipHidden: document.getElementById('part-stage-cd')?.hidden,
      optBtns: document.querySelectorAll('#part-options .cast-option').length,
    }));
    expect(during.qText).toContain('Staging test savol');
    expect(during.num).toBeTruthy();
    expect(during.chipHidden).toBe(false);
    expect(during.optBtns).toBe(0);

    // 3s o'tgach: chip yashirin, variantlar ochilgan
    await page.waitForFunction(() => {
      const chip = document.getElementById('part-stage-cd');
      return chip && chip.hidden === true && document.querySelectorAll('#part-options .cast-option').length === 4;
    }, { timeout: 9000 });
    const after = await page.evaluate(() => ({
      chipHidden: document.getElementById('part-stage-cd')?.hidden,
      optBtns: document.querySelectorAll('#part-options .cast-option').length,
    }));
    expect(after.chipHidden).toBe(true);
    expect(after.optBtns).toBe(4);
    sock.disconnect();
    await page.close();
  }, 60000);
});
