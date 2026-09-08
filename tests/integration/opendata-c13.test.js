/**
 * AUTH C-13 — Ochiq ma'lumotlar (OTM stats) + diplom.edu.uz tekshiruv (P3)
 * ----------------------------------------------------------------------
 *  1. GET /api/opendata/stats — public stats (manba + litsenziya; PII yo'q)
 *  2. GET /api/user/portfolio/diploma-check — auth talab; 302 → diplom.edu.uz;
 *     server fetch qilmaydi (SSRF yo'q); audit diploma:check yoziladi
 *  3. Auth talab: login'siz diploma-check → 401
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let httpServer;
let serverUrl;
let app;

const UNIQ = Date.now() % 1000000;

/** CSRF + session cookie olish (login/register sahifasidan). */
async function getCsrf() {
  const res = await fetch(`${serverUrl}/user/login`);
  const html = await res.text();
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN\s*=\s*"([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie };
}

/** POST form helper. */
async function postForm(path, cookie, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      'x-forwarded-for': xff,
    },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });
}

/** Yangi user yaratish + login → session cookie. */
async function registerAndLogin() {
  const xff = `10.${UNIQ % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const uname = `c13_${UNIQ}_${Math.floor(Math.random() * 1000)}`;
  const password = 'parol-2026-x-uzun';
  const { csrf: cr, cookie: ckr } = await getCsrf('/user/login');
  await postForm('/user/login', ckr, { _csrf: cr, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password, email: `c13_${UNIQ}_${Math.floor(Math.random() * 1000)}@test.uz` }, xff);
  const { csrf, cookie } = await getCsrf('/user/login');
  const loginRes = await postForm('/user/login', cookie, { _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password }, xff);
  expect(loginRes.status).toBe(302);
  const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  return { username: uname, cookie: sessionCookie };
}

beforeAll(async () => {
  ({ app, httpServer } = await createApp());
  await new Promise((r) => httpServer.listen(0, r));
  serverUrl = `http://localhost:${httpServer.address().port}`;
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH C-13 — opendata stats (haqiqiy raqamlar, PII yo\'q)', () => {
  it('GET /api/opendata/stats — public 200, manba + litsenziya + asOf; PII kalitlari yo\'q', async () => {
    const res = await fetch(`${serverUrl}/api/opendata/stats`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.enabled).toBe(true);
    expect(j.stats.universities).toBeGreaterThan(0);
    // manba + litsenziya ko'rsatilishi shart (§09)
    expect(j.source).toBeTruthy();
    expect(j.license).toBeTruthy();
    // PII yo'q (§17): hech qanday shaxsiy maydon
    const body = JSON.stringify(j);
    expect(body).not.toMatch(/(jshshir|pin|passport|phone|email|telegram_id)/i);
  });
});

describe('AUTH C-13 — diplom.edu.uz tekshiruv (P3, client-side)', () => {
  it('auth talab: login\'siz diploma-check → 401', async () => {
    const res = await fetch(`${serverUrl}/api/user/portfolio/diploma-check`, { redirect: 'manual' });
    expect(res.status).toBe(401);
  });

  it('login bilan diploma-check → 302 → diplom.edu.uz (server fetch qilmaydi)', async () => {
    const { cookie } = await registerAndLogin();
    const res = await fetch(`${serverUrl}/api/user/portfolio/diploma-check`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') || '';
    expect(loc).toBe('https://diplom.edu.uz');
  });

  it('09/2026: portfolio UI sahifasi olib tashlangan — /user/portfolio 404 (API saqlanadi)', async () => {
    const { cookie } = await registerAndLogin();
    const res = await fetch(`${serverUrl}/user/portfolio`, { headers: { cookie } });
    expect(res.status).toBe(404);
    // API (diploma-check) ishlashda davom etadi
    const apiRes = await fetch(`${serverUrl}/api/user/portfolio/diploma-check`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(apiRes.status).toBe(302);
  });
});
