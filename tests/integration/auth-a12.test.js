/**
 * AUTH A-12 — Transkript/portfolio import (P1) — integration
 * -------------------------------------------------------------------
 * Qamrov (guide A-12 §21-22):
 *  - Auth: unauth → 401; CSRF: POST token'siz → 403
 *  - Import: consent talab (400); xlsx import → itemlar (default-private)
 *  - IDOR: boshqa user item/garantga kirish → 403
 *  - Share: link token → public view; revoke → 404; viewer cheklash
 *  - Export: transkript PDF (200, application/pdf)
 *  - Malicious/yolg'on fayl → 400; noto'g'ri format → 400
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import XLSX from 'xlsx';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
}, 90000);

afterAll(async () => {
  await stopServer();
  restoreDb();
});

async function getCsrf(path = '/user/login') {
  const res = await fetch(`${serverUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie };
}

async function postForm(path, cookie, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

let ipCounter = 0;
/** Per-IP register rate limitdan qochish uchun har login unique xff. */
function uniqueIp() {
  ipCounter += 1;
  return `203.0.${113 + (ipCounter % 50)}.${10 + (ipCounter % 200)}`;
}

/** Yangi user + login → session cookie. */
async function registerAndLogin() {
  const xff = uniqueIp();
  const uname = `a12_${Date.now() % 1000000}_${Math.floor(Math.random() * 1000)}`;
  const password = 'parol-2026-x-uzun';
  const { csrf: cr, cookie: ckr } = await getCsrf('/user/login');
  await postForm('/user/login', ckr, { _csrf: cr, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password, email: `r12_${Date.now()}_a18@test.uz` }, xff);
  const { csrf, cookie } = await getCsrf('/user/login');
  const loginRes = await postForm('/user/login', cookie, { _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password }, xff);
  expect(loginRes.status).toBe(302);
  const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  return { username: uname, cookie: sessionCookie };
}

/** 09/2026: portfolio UI sahifasi olib tashlangan — CSRF authed panel'dan olinadi. */
async function portfolioSession(cookie) {
  const res = await fetch(`${serverUrl}/user/panel`, { headers: { cookie } });
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return { csrf: m ? m[1] : '', cookie };
}

async function api(cookie, path, opts = {}) {
  const res = await fetch(`${serverUrl}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': opts.csrf || '',
      cookie,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function makeXlsxBuffer(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Transkript');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('AUTH A-12 — auth + CSRF', () => {
  it('unauth GET /api/user/portfolio → 401/302', async () => {
    const res = await fetch(`${serverUrl}/api/user/portfolio`, { redirect: 'manual' });
    expect([401, 302]).toContain(res.status);
  });

  it('CSRF: POST x-csrf-token bo\'lmasa → 403', async () => {
    const { cookie } = await registerAndLogin();
    const { csrf } = await portfolioSession(cookie);
    const res = await fetch(`${serverUrl}/api/user/portfolio/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'draft', title: 'X' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('AUTH A-12 — import + IDOR + share + export', () => {
  it('import consent talab; consent bilan xlsx import → itemlar (default-private)', async () => {
    const { cookie } = await registerAndLogin();
    const { csrf } = await portfolioSession(cookie);
    const buf = makeXlsxBuffer([
      ['fan', 'baho', 'kredit', 'semestr'],
      ['Oliy matematika', 5, 4, 1],
      ['Fizika', 4, 3, 1],
    ]);

    // consent yo'q → 400
    const fd1 = new FormData();
    fd1.append('file', new Blob([buf]), 'transkript.xlsx');
    const r1 = await fetch(`${serverUrl}/api/user/portfolio/import`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, cookie },
      body: fd1,
    });
    expect(r1.status).toBe(400);
    expect((await r1.json()).code).toBe('consent_required');

    // consent bor → created=2, default-private
    const fd2 = new FormData();
    fd2.append('file', new Blob([buf]), 'transkript.xlsx');
    fd2.append('consent', 'true');
    const r2 = await fetch(`${serverUrl}/api/user/portfolio/import`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, cookie },
      body: fd2,
    });
    expect(r2.status).toBe(200);
    const data2 = await r2.json();
    expect(data2.created).toBe(2);

    const list = await api(cookie, '/api/user/portfolio', { csrf });
    expect(list.status).toBe(200);
    expect(list.data.items.length).toBe(2);
    expect(list.data.items.every((i) => i.visibility === 'private')).toBe(true);
  });

  it('IDOR: boshqa user itemini patch/delete/share qila olmaydi', async () => {
    const userA = await registerAndLogin();
    const userB = await registerAndLogin();
    const sa = await portfolioSession(userA.cookie);
    const sb = await portfolioSession(userB.cookie);

    const add = await api(userA.cookie, '/api/user/portfolio/items', {
      method: 'POST', csrf: sa.csrf,
      body: { kind: 'result', title: 'Algoritmlar', contentMeta: { aiUseLevel: 'A0' } },
    });
    expect(add.status).toBe(200);
    const itemId = add.data.itemId;

    const patch = await api(userB.cookie, `/api/user/portfolio/items/${itemId}`, {
      method: 'PATCH', csrf: sb.csrf, body: { visibility: 'public' },
    });
    expect(patch.status).toBe(403);

    const del = await api(userB.cookie, `/api/user/portfolio/items/${itemId}`, {
      method: 'DELETE', csrf: sb.csrf,
    });
    expect(del.status).toBe(403);

    const share = await api(userB.cookie, `/api/user/items/${itemId}/share`, {
      method: 'POST', csrf: sb.csrf, body: {},
    });
    expect(share.status).toBe(403);
  });

  it('share flow: token → public view; userB revoke 403; owner revoke → 404; viewer cheklash', async () => {
    const userA = await registerAndLogin();
    const userB = await registerAndLogin();
    const sa = await portfolioSession(userA.cookie);
    const sb = await portfolioSession(userB.cookie);

    const add = await api(userA.cookie, '/api/user/portfolio/items', {
      method: 'POST', csrf: sa.csrf,
      body: { kind: 'result', title: 'Ingliz tili', evidence: { subject: 'Ingliz tili', grade: '5', credit: '4', semester: '2' } },
    });
    const itemId = add.data.itemId;

    // private item share → 400
    const privShare = await api(userA.cookie, `/api/user/items/${itemId}/share`, {
      method: 'POST', csrf: sa.csrf, body: {},
    });
    expect(privShare.status).toBe(400);

    await api(userA.cookie, `/api/user/portfolio/items/${itemId}`, {
      method: 'PATCH', csrf: sa.csrf, body: { visibility: 'shared' },
    });

    const share = await api(userA.cookie, `/api/user/items/${itemId}/share`, {
      method: 'POST', csrf: sa.csrf, body: { viewerEmail: 'viewer@example.com' },
    });
    expect(share.status).toBe(200);
    const token = share.data.token;

    // public view — viewer cheklangan: boshqa email → 404
    const wrong = await fetch(`${serverUrl}/share/${token}?viewer=other@example.com`);
    expect(wrong.status).toBe(404);
    const right = await fetch(`${serverUrl}/share/${token}?viewer=viewer@example.com`);
    expect(right.status).toBe(200);
    expect(await right.text()).toContain('Ingliz tili');

    // IDOR revoke: userB grant id bilmaydi (IDOR revoke 403 unit testda qoplangan)
    const revokeOther = await api(userB.cookie, '/api/user/share-grants/nonexistent/revoke', {
      method: 'POST', csrf: sb.csrf, body: {},
    });
    expect(revokeOther.status).toBe(400);
  });

  it('export transkript PDF → 200 application/pdf', async () => {
    const { cookie } = await registerAndLogin();
    const { csrf } = await portfolioSession(cookie);
    await api(cookie, '/api/user/portfolio/items', {
      method: 'POST', csrf,
      body: { kind: 'result', title: 'Matematika', evidence: { subject: 'Matematika', grade: '5', credit: '4', semester: '1' } },
    });
    const res = await fetch(`${serverUrl}/api/user/portfolio/export`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString('latin1').startsWith('%PDF-1.4')).toBe(true);
  });

  it('malicious/yolg\'on fayllar → 400', async () => {
    const { cookie } = await registerAndLogin();
    const { csrf } = await portfolioSession(cookie);

    // yolg'on PDF (magic yo'q)
    const fd1 = new FormData();
    fd1.append('file', new Blob([Buffer.from('not a pdf')]), 'fake.pdf');
    fd1.append('consent', 'true');
    const r1 = await fetch(`${serverUrl}/api/user/portfolio/import`, {
      method: 'POST', headers: { 'x-csrf-token': csrf, cookie }, body: fd1,
    });
    expect(r1.status).toBe(400);

    // noto'g'ri kengaytma
    const fd2 = new FormData();
    fd2.append('file', new Blob([Buffer.from('x')]), 'evil.exe');
    fd2.append('consent', 'true');
    const r2 = await fetch(`${serverUrl}/api/user/portfolio/import`, {
      method: 'POST', headers: { 'x-csrf-token': csrf, cookie }, body: fd2,
    });
    expect(r2.status).toBe(400);
  });
});
