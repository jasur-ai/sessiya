/**
 * Cast E2E helper (T-03)
 * ----------------------
 * createApp() + Playwright chromium. Teacher login + session create +
 * join fixture'lari. Har spec'da ishlatiladi.
 */

import { chromium } from 'playwright';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createSession, upsertRole, generateSessionId, generateJoinCode } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';

let httpServer;
let serverUrl;
let browser;

// ── Server + browser bootstrap ──
export async function startE2E() {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      serverUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
  return { serverUrl };
}

export async function stopE2E() {
  if (browser) { await browser.close(); browser = null; }
  if (httpServer && httpServer.listening) {
    await new Promise((resolve) => httpServer.close(() => resolve()));
  }
  restoreDb();
}

// Lazy browser — faqat birinchi newContext() chaqirilganda ochiladi.
// Socket-only spec'lar (answer/director/recovery/moderation) browser
// ochmaydi — vaqt va resurs tejaydi.
export async function newContext() {
  if (!browser) {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  }
  return browser.newContext();
}

export async function newPage(context) {
  return context.newPage();
}

// ── Teacher login (session cookie'ni context'ga saqlaydi) ──
// `/user/login` route'i — `req.session.user` saqlaydi (director auth uchun kerak).
// Muvaffaqiyatli login `/user/panel`'ga redirect qiladi — shuni assert qiladi.
export async function loginAsUser(context, { username = 'user', password = 'user' } = {}) {
  const page = await newPage(context);
  await page.goto(`${serverUrl}/user/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  // mode input hidden — default 'login', fill qilinmaydi
  await page.click('button[type="submit"]');
  await page.waitForURL('**/user/panel', { timeout: 10000 });
  await page.close();
}

// ── Cast session yaratish (to'g'ridan-to'g'ri store orqali — preflight bypass) ──
export async function seedCastSession({ title = 'E2E Cast', owner = 'user:user', questionCount = 1, ai = null } = {}) {
  const sessionId = generateSessionId();
  const joinCode = generateJoinCode();

  const publicQuestions = [];
  const privateQuestions = [];
  for (let i = 0; i < questionCount; i++) {
    const qid = `q_${String(i + 1).padStart(2, '0')}`;
    publicQuestions.push({
      id: qid,
      text: `Test savol ${i + 1}`,
      options: [
        { id: 'o_a', text: 'Variant A' },
        { id: 'o_b', text: 'Variant B' },
        { id: 'o_c', text: 'Variant C' },
        { id: 'o_d', text: 'Variant D' },
      ],
    });
    privateQuestions.push({
      id: qid,
      correctOptionIds: ['o_a'],
      options: ['o_a', 'o_b', 'o_c', 'o_d'].map((id) => ({ id })), // answer validation authoritative set
    });
  }

  await createSession({
    sessionId,
    joinCode,
    meta: { title, tier: 'S' },
    config: {
      scoring: { scorePolicy: 'accuracy' },
      timer: { mode: 'soft', defaultSeconds: 30 },
      playback: { thinkSeconds: 0 },
      participation: { paperCardMode: false },
      ai: ai || { cohostMode: 'off', mayExecuteLiveActions: false, teacherApprovalRequired: true },
    },
    state: initialState({
      primaryDirectorId: owner,
      questionIds: publicQuestions.map((q) => q.id),
      questionCount: publicQuestions.length,
      choreography: null,
    }),
    privateQuestions,
    publicQuestions,
  });

  // Director role — owner
  await upsertRole(sessionId, {
    actorId: owner,
    role: 'owner',
    assignedAt: Date.now(),
    assignedBy: owner,
  });

  return { sessionId, joinCode, publicQuestions };
}

export { serverUrl };
