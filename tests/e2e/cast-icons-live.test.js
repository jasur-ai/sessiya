/**
 * Deborah — Cast E2E: Emoji→ikonka jonli ko'rik (icon-kit)
 * ----------------------------------------------------------
 * Barcha cast ekranlari (director / participant / quality-lab / results /
 * replay) real brauzerda ochilib: rangli emoji qolmasligi (IconKit.isEmojiFree),
 * ikonka konvertori ishlagani (svg.ik mavjudligi) va sahifa xatosi yo'qligi
 * tekshiriladi. Participant uchun fazalar bo'ylab (question→podium) ham.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import fs from 'fs';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';
import { createSession, generateSessionId, generateJoinCode, upsertRole } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';
import { CAST_LB_VISIBILITY, CAST_LB_FREQUENCY } from '../../utils/cast-constants.js';

let ctx;
const SHOTS = '/home/user/shots';
fs.mkdirSync(SHOTS, { recursive: true });

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); }, 60000);
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

async function mkSession(title = 'Icons E2E') {
  const sessionId = generateSessionId();
  const joinCode = generateJoinCode();
  const qs = ['q_01', 'q_02'];
  await createSession({
    sessionId, joinCode,
    meta: { title, tier: 'S' },
    config: {
      scoring: { scorePolicy: 'accuracy' },
      timer: { mode: 'soft', defaultSeconds: 90 },
      playback: { thinkSeconds: 1, advanceMode: 'host_controlled' },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.TOP_N, finalVisibility: CAST_LB_VISIBILITY.TOP_N,
        topN: 5, frequency: CAST_LB_FREQUENCY.EVERY_QUESTION, anonymizeLowRanks: true, showExactScore: false,
      },
      participation: { paperCardMode: false },
      ai: { cohostMode: 'off', mayExecuteLiveActions: false, teacherApprovalRequired: true },
      postCast: { eventReplay: true },
    },
    state: initialState({ primaryDirectorId: 'user:user', questionIds: qs, questionCount: 2, choreography: null }),
    privateQuestions: qs.map((id) => ({ id, correctOptionIds: ['o_a'], options: ['o_a', 'o_b', 'o_c', 'o_d'].map((x) => ({ id: x })) })),
    publicQuestions: qs.map((id, i) => ({ id, text: `Savol ${i + 1}`, options: ['o_a', 'o_b', 'o_c', 'o_d'].map((x) => ({ id: x, text: x })) })),
  });
  await upsertRole(sessionId, { actorId: 'user:user', role: 'owner', assignedAt: Date.now(), assignedBy: 'user:user' });
  return { sessionId, joinCode };
}

const EMOJI_RX = /[\u{1F000}-\u{1FAFF}\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u2B50\u2705\u274C]/gu;
async function emojiState(page) {
  return page.evaluate((rxSrc) => {
    const ik = window.IconKit;
    const mkRx = () => new RegExp(rxSrc, 'gu');
    const scanReport = () => {
      const rx = mkRx();
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode;
        const pn = n.parentNode;
        if (!pn || /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|CODE|NOSCRIPT|SVG)$/i.test(pn.nodeName)) continue;
        rx.lastIndex = 0;
        const v = n.nodeValue || '';
        let m;
        while ((m = rx.exec(v)) !== null) {
          const chain = [];
          let el = pn;
          for (let k = 0; k < 6 && el; k++, el = el.parentElement) chain.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
          out.push({ ch: m[0], ctx: v.slice(Math.max(0, m.index - 22), m.index + 24), chain });
        }
      }
      return out;
    };
    let leftover = scanReport();
    let afterRescan = null;
    if (ik && leftover.length) {
      ik.scan(document.body);
      afterRescan = scanReport().length;
    }
    // MUHIM: typografik belgilar (✓ ✕ ★ …) qolishi mumkin — ular emoji emas.
    // Qoidabuzarlik: 1F000-1FAFF bloki (rangli emoji) yoki registrdagi belgi.
    const bad = (leftover || []).filter((x) => {
      const ch = x.ch.replace(/\ufe0f$/u, '');
      return /[\u{1F000}-\u{1FAFF}]/u.test(ch) || (ik && ik.mappedGlyph(ch));
    });
    return {
      kit: !!ik,
      emojiFree: ik ? ik.isEmojiFree() : null,
      icons: document.querySelectorAll('svg.ik').length,
      clean: bad.length === 0,
      leftover,
      bad,
      afterRescan,
    };
  }, EMOJI_RX.source);
}


async function waitEmojiFree(page) {
  try {
    await page.waitForFunction(() => {
      const ik = window.IconKit;
      return ik && ik.isEmojiFree();
    }, { timeout: 6000 });
  } catch (_) { /* report below */ }
  const st = await emojiState(page);
  if (!st.clean) console.log('[leftover]', JSON.stringify(st.bad.slice(0, 8)), 'afterRescan=', st.afterRescan);
  return st;
}

describe('T-05 cast-icons: jonli emoji→ikonka ko‘rik', () => {
  it('director/quality-lab/results/replay sahifalari emoji-fri va xatosiz', async () => {
    const { sessionId } = await mkSession('Icons director');
    const pages = {};
    for (const name of ['director', 'quality-lab', 'results', 'replay']) {
      const page = await newPage(ctx);
      const errs = [];
      page.on('pageerror', (e) => errs.push('P:' + e.message.slice(0, 120)));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 120)); });
      await page.goto(`${serverUrl}/cast/${sessionId}/${name}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      pages[name] = { page, errs };
    }
    for (const name of Object.keys(pages)) {
      const { page, errs } = pages[name];
      const st = await waitEmojiFree(page);
      expect(st.kit, name + ' IconKit mavjud').toBe(true);
      expect(st.icons, name + ' ikonkalar konvert qilingan').toBeGreaterThan(0);
      expect(st.clean, name + ' emoji qolmagan').toBe(true);
      expect(errs, name + ' pageerror/console-error yo‘q').toEqual([]);
      await page.screenshot({ path: `${SHOTS}/cast-icons-${name}.png` }).catch(() => {});
      await page.close().catch(() => {});
    }
  }, 90000);

  it('participant: question → javob → podium fazalarida ham emoji qolmaydi', async () => {
    const { sessionId, joinCode } = await mkSession('Icons part');
    const page = await newPage(ctx);
    const errs = [];
    page.on('pageerror', (e) => errs.push('P:' + e.message.slice(0, 120)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 120)); });

    await page.goto(`${serverUrl}/play?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#join-form');
    const optState = await page.evaluate(() => Array.from(document.querySelectorAll('#join-delivery option')).map((o) => ({ v: o.value, text: o.textContent, hasSvg: !!o.querySelector('svg') })));
    optState.forEach((o) => {
      expect(o.hasSvg, 'option ichida svg yo\u2018q').toBe(false);
      expect(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u.test(o.text), 'option emoji-fri').toBe(false);
      expect(o.text.length).toBeGreaterThan(3);
    });
    await page.fill('#join-code', joinCode);
    await page.fill('#join-name', 'BotIcon');
    await page.click('#join-form button[type="submit"], #join-form button');
    await page.waitForTimeout(1800);

    const cookies = await ctx.cookies();
    const sock = io(serverUrl, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } });
    await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('socket timeout')), 8000); });
    const emit = (type, payload = {}) => new Promise((r) => { sock.emit('cast:command', { commandId: `c-${Math.random().toString(36).slice(2, 8)}`, sessionId, type, payload, sentAtClient: Date.now() }, (a) => r(a)); });

    expect((await emit('cast:sessionStart', {})).ok).toBe(true);
    expect((await emit('cast:questionOpen', {})).ok).toBe(true);

    // Q1: preview + variantlar
    await page.waitForSelector('#part-options .cast-option', { timeout: 12000 });
    let st = await waitEmojiFree(page);
    expect(st.icons).toBeGreaterThan(0);
    expect(st.emojiFree).toBe(true);
    await page.screenshot({ path: `${SHOTS}/cast-icons-part-question.png` }).catch(() => {});

    // javob
    await page.click('#part-options .cast-option');
    await page.waitForSelector('#part-submit:not([hidden])', { timeout: 6000 });
    await page.click('#part-submit');
    await page.waitForTimeout(800);

    // yopish → podium (3s)
    expect((await emit('cast:questionClose', {})).ok).toBe(true);
    await page.waitForFunction(() => {
      const el = document.getElementById('part-podium');
      return el && !el.hidden;
    }, { timeout: 9000 });
    st = await waitEmojiFree(page);
    expect(st.clean, 'podium fazasida emoji qolmagan').toBe(true);
    await page.screenshot({ path: `${SHOTS}/cast-icons-part-podium.png` }).catch(() => {});

    // session end
    expect((await emit('cast:sessionEnd', {})).ok).toBe(true);
    await page.waitForFunction(() => {
      const t = document.getElementById('part-reveal-title');
      return t && t.textContent === 'Sessiya tugadi';
    }, { timeout: 8000 });
    st = await waitEmojiFree(page);
    expect(st.clean, 'session end ekranida emoji qolmagan').toBe(true);
    expect(errs).toEqual([]);
    sock.close();
    await page.close().catch(() => {});
  }, 90000);
});
