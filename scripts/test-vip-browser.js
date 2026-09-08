/**
 * Deborah — VIP Tizimi Brauzer Test Skripti
 *
 * HTTP session (cookie) orqali to'liq VIP funksionallikni test qiladi.
 * Serverni avtomatik import qiladi (PORT env orqali).
 * CSRF tokenni avtomatik extract qiladi.
 *
 * Testlar:
 *   1. Admin login → VIP grant (sardor)
 *   2. VIP user (sardor) login → panel stealth (mock/pre izlari yo'q, 09/2026)
 *   3. Non-VIP user (user) login → Mock/PRE yashirin
 *   4. Non-VIP user → /host?source=mock|pre → 404 (requireVip)
 */

import http from 'http';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set port BEFORE starting the server child process
const PORT = process.env.TEST_PORT || '3457';
process.env.PORT = PORT;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;

// ── Admin kredensiallari ──
// Server .env faylini o'qiydi (dotenv). Test ham xuddi shu .env'dan o'qishi
// kerak, aks holda lokalda kredensiallar mos kelmaydi. CI'da .env yo'q → default.
function readAdminCreds() {
  const envFile = resolve(__dirname, '..', '.env');
  const vars = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !line.trim().startsWith('#')) vars[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return {
    user: vars.ADMIN_USER || process.env.ADMIN_USER || 'admin',
    pass: vars.ADMIN_PASS || process.env.ADMIN_PASS || 'admin',
  };
}
const ADMIN = readAdminCreds();

// ── Cookie jar + CSRF token ──
const jar = {};
let csrfToken = '';

function setCookies(res) {
  const c = res.headers['set-cookie'];
  if (c) {
    c.forEach(h => {
      const m = h.match(/^([^=]+)=([^;]+)/);
      if (m) jar[m[1]] = m[2];
    });
  }
}

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const headers = {
      'Cookie': cookieHeader(),
    };

    let payload = '';
    if (body) {
      const isApi = path.startsWith('/admin/api/') || path.startsWith('/user/api/') || path.startsWith('/api/');
      if (isApi) {
        // API endpoint'lar JSON kutadi
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      } else {
        // Login/forma POST'lari application/x-www-form-urlencoded formatida
        // yuboriladi (server express.urlencoded orqali o'qiydi). JSON emas!
        payload = Object.entries(body).map(([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
        ).join('&');
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    // Add CSRF token for ALL non-GET requests
    // (server CSRF middleware hamma POST/PUT/PATCH/DELETE'ni tekshiradi,
    // API endpoint'lar ham bundan mustasno emas)
    if (csrfToken && method !== 'GET') {
      headers['x-csrf-token'] = csrfToken;
    }

    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers,
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        setCookies(res);
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Extract CSRF token from HTML */
function extractCsrf(body) {
  // 1) Form: <input type="hidden" name="_csrf" value="...">
  const m = body.match(/name="_csrf"[^>]*\svalue="([^"]+)"/) ||
            body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (m) return m[1];
  // 2) JS global: window.__CSRF_TOKEN = '...'  (head.ejs)
  const g = body.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  return g ? g[1] : '';
}

/** Log in as a user — GET login page, extract CSRF, POST with token */
async function loginAs(username, password, admin = false) {
  // Clear jar first
  Object.keys(jar).forEach(k => delete jar[k]);
  csrfToken = '';

  // GET login page → gets session cookie + CSRF token
  const loginPage = admin ? '/admin/login' : '/user/login';
  const page = await request('GET', loginPage);

  // Extract CSRF token from the page
  csrfToken = extractCsrf(page.body);

  if (!csrfToken) {
    console.log(`  ⚠️  CSRF token not found on ${loginPage}`);
    return false;
  }

  // POST login with CSRF token via header
  const r = await request('POST', loginPage, { username, password });
  // 302 = redirect to dashboard/panel → login succeeded
  // 200 = login page re-rendered → login failed (wrong credentials, etc.)
  if (r.status !== 302) {
    // User mavjud bo'lmasa (noto'g'ri parol o'rniga) — avval register qilamiz.
    // Test DB holatidan mustaqil bo'lishi uchun: user yo'q bo'lsa yaratamiz.
    if (!admin && r.status === 200) {
      Object.keys(jar).forEach(k => delete jar[k]);
      csrfToken = '';
      const regPage = await request('GET', loginPage);
      csrfToken = extractCsrf(regPage.body);
      if (!csrfToken) return false;
      const reg = await request('POST', loginPage, { username, password, mode: 'reg', consent: 'on', email: `${username}_${Date.now()}@test.uz` });
      if (reg.status === 302) {
        // Register sessiyani regenerate qildi — yangi token kerak
        const dest = admin ? '/admin/dashboard' : '/user/panel';
        const fresh = await request('GET', dest);
        const freshCsrf = extractCsrf(fresh.body);
        if (freshCsrf) csrfToken = freshCsrf;
        return true;
      }
      return false;
    }
    return false;
  }

  // Login sessiyani regenerate qiladi (yangi CSRF token) — keyingi POST'lar
  // uchun yangi tokenni saqlab olamiz (dashboard/panel sahifasidan).
  const dest = admin ? '/admin/dashboard' : '/user/panel';
  const fresh = await request('GET', dest);
  const freshCsrf = extractCsrf(fresh.body);
  if (freshCsrf) csrfToken = freshCsrf;
  return true;
}

function test(name, fn) {
  return fn().then(ok => {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  }).catch(e => {
    failed++;
    console.log(`  ❌ ${name} — ${e.message}`);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('   🧪 VIP Tizimi — To\'liq Test');
  console.log('══════════════════════════════════════════════\n');

  // ── Server'ni child process sifatida ishga tushirish ──
  // (server.js import orqali listen qilmaydi — isMainModule guard tufayli)
  console.log(`📡 Server http://localhost:${PORT} da ishga tushirilmoqda...`);
  const serverProc = spawn(process.execPath, [resolve(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  // Server tayyor bo'lguncha kutamiz (/health → 200).
  // Startup sekin bo'lishi mumkin (Firebase init + modullar) — 120s.
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    try {
      const r = await request('GET', '/health');
      if (r.status === 200) { ready = true; break; }
    } catch { /* still starting */ }
  }
  if (!ready) {
    console.error('❌ Server start bo\'lmadi (health check muvaffaqiyatsiz)');
    serverProc.kill('SIGKILL');
    process.exit(1);
  }
  console.log('✅ Server tayyor');

  try {
    // ── 1. Admin Login & VIP Grant ──
    console.log('\n┌─ 1. Admin Login & VIP Grant');

    await test(`Admin login — ${ADMIN.user}/${ADMIN.pass}`, async () => {
      return await loginAs(ADMIN.user, ADMIN.pass, true);
    });

    await test('GET /admin/dashboard — 200', async () => {
      const r = await request('GET', '/admin/dashboard');
      return r.status === 200 && r.body.includes('Admin');
    });

    await test('Sidebar VIP tab mavjud', async () => {
      const r = await request('GET', '/admin/dashboard');
      return r.body.includes("switchTab('vip')");
    });

    await test('GET /admin/api/users — JSON', async () => {
      const r = await request('GET', '/admin/api/users');
      return r.json && Array.isArray(r.json.users);
    });

    await test('GET /admin/vip — VIP sahifasi', async () => {
      const r = await request('GET', '/admin/vip');
      return r.status === 200 && r.body.includes('VIP');
    });

    // sardor user'ini yaratamiz (agar mavjud bo'lmasa) — test DB holatidan
    // mustaqil bo'lishi uchun (CI'da toza DB, lokalda eski DB bo'lishi mumkin)
    await test('sardor user yaratish (register)', async () => {
      const r = await request('POST', '/user/login', { username: 'sardor', password: '1234', mode: 'reg', consent: 'on', email: `sardor_${Date.now()}@test.uz` });
      // 302 = yaratildi/login bo'ldi; 200 = nom band (allaqachon bor) — ikkalasi ham OK
      const ok = r.status === 302 || r.status === 200;
      // Register sessiyani regenerate qiladi — yangi CSRF tokenni saqlaymiz
      if (r.status === 302) {
        const fresh = await request('GET', '/user/panel');
        const t = extractCsrf(fresh.body);
        if (t) csrfToken = t;
      }
      return ok;
    });

    // Admin sessiyasiga qaytamiz (register admin cookie'sini buzdi)
    await test('Admin qayta login (grant uchun)', async () => {
      return await loginAs(ADMIN.user, ADMIN.pass, true);
    });

    await test('VIP berish: sardor (parol o\'zgarmaydi)', async () => {
      const r = await request('POST', '/admin/api/vip/grant', { username: 'sardor' });
      // S33.03: plainPassword client'ga qaytmaydi (security) — faqat success
      return r.json && r.json.success === true;
    });

    console.log('└─');

    // ── 2. VIP User (sardor) — original password works! ──
    console.log('\n┌─ 2. VIP User — Sardor (isVip: true, original parol: 1234)');

    await test('Login — sardor/1234 (original parol)', async () => {
      return await loginAs('sardor', '1234', false);
    });

    await test('GET /user/panel — 200', async () => {
      const r = await request('GET', '/user/panel');
      return r.status === 200;
    });

    await test('VIP: panel stealth — mock/PRE bo\'limi ko\'rinmaydi', async () => {
      const r = await request('GET', '/user/panel');
      // 09/2026 VIP stealth (user qarori, routes/user.js): panel'da VIP/mock/pre
      // izlari yo'q — mock/pre faqat direct URL orqali (requireVip) ishlaydi.
      const hasMockText = r.body.includes('Mock Fanlar') || r.body.includes('PRE Test');
      return r.status === 200 && !hasMockText;
    });

    console.log('└─');

    // ── 3. Non-VIP User (user) ──
    console.log('\n┌─ 3. Non-VIP User — user (isVip: false)');

    // user user'ini yaratamiz (agar mavjud bo'lmasa)
    await test('Login — user/user', async () => {
      return await loginAs('user', 'user', false);
    });

    await test('GET /user/panel — 200', async () => {
      const r = await request('GET', '/user/panel');
      return r.status === 200;
    });

    await test('Non-VIP: Mock bo\'limi HTML da YO\'Q', async () => {
      const r = await request('GET', '/user/panel');
      // Non-VIP user: isVip=false → Mock/PRE bloklari render qilinmaydi
      const hasMockText = r.body.includes('Mock Fanlar') || r.body.includes('PRE Test');
      return !hasMockText;
    });

    console.log('└─');

    // ── 4. Non-VIP → Direct URL access to Mock/PRE ──
    console.log('\n┌─ 4. Non-VIP → Direct URL (requireVip 404 test)');

    await test('GET /host?source=mock — 404 (requireVip)', async () => {
      const r = await request('GET', '/host?source=mock&key=fizika_mexanika');
      // Non-VIP user: requireVip middleware 404 qaytaradi
      return r.status === 404;
    });

    await test('GET /host?source=pre — 404 (requireVip)', async () => {
      const r = await request('GET', '/host?source=pre&key=test_pre');
      return r.status === 404;
    });

    await test('GET /host?source=user — ishlaydi (user test)', async () => {
      const r = await request('GET', '/host?source=user&key=ut1');
      // Non-VIP user o'z testiga kira oladi
      return r.status === 200 || r.status === 302;
    });

    console.log('└─\n');

    // ── Results ──
    console.log('══════════════════════════════════════════════');
    console.log(`   📊 Natijalar: ${passed} ✅  |  ${failed} ❌  |  Jami: ${passed + failed}`);
    console.log('══════════════════════════════════════════════\n');

  } finally {
    // Server'ni to'xtatamiz
    if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(e => {
  console.error('❌ Test script xatosi:', e.message);
  process.exit(1);
});
