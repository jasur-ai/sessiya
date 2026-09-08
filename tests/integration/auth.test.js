/**
 * Deborah — Login/Register/Forgot testlari (plan_login §4)
 * ----------------------------------------------------------
 * 4 til rendering, Google OIDC, show/hide parol, kuch indikatori,
 * login/register flow (CSRF bilan), forgot flow (enumeration-safe).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { AUTH_COPY, AUTH_LANGS, resolveAuthLang } from '../../data/auth-i18n.js';
import { fb } from '../../firebase/admin.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
});

afterAll(async () => {
  await stopServer();
  restoreDb();
});

/** CSRF token + cookie'ni olish (sessiya bilan bog'langan). */
async function getCsrf(path = '/user/login') {
  const res = await fetch(`${serverUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie, html, res };
}

/**
 * CSRF'li POST — cookie + body bilan.
 * AUTH A-03: xff berilsa X-Forwarded-For header yuboriladi (trust proxy 1) —
 * register limit (5/15min per IP) bucket'larini describe guruhlari orasida
 * izolyatsiya qilish uchun (har guruh o'z XFF IP'sini ishlatadi).
 */
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

describe('Auth — copy bank (data/auth-i18n.js)', () => {
  it('4 til mavjud va login/register/forgot/errors stringlari bor', () => {
    expect(AUTH_LANGS).toHaveLength(4);
    for (const lang of AUTH_LANGS) {
      const c = AUTH_COPY[lang];
      expect(c.meta.title).toBeTruthy();
      expect(c.login.google).toBeTruthy();
      expect(c.login.forgot).toBeTruthy();
      expect(c.register.passwordStrength.length).toBe(5);
      expect(c.errors.passwordMin).toBeTruthy();
      expect(c.forgot.btn).toBeTruthy();
      expect(c.forgot.sent).toBeTruthy();
    }
  });

  it('resolveAuthLang — noma\'lum til default uz', () => {
    expect(resolveAuthLang('en')).toBe('en');
    expect(resolveAuthLang('fr')).toBe('uz');
    expect(resolveAuthLang(undefined)).toBe('uz');
  });

  it('copy da XSS xavfli kalitlar yo\'q', () => {
    for (const lang of AUTH_LANGS) {
      const raw = JSON.stringify(AUTH_COPY[lang]);
      expect(raw).not.toContain('javascript:');
      expect(raw).not.toContain('<script');
    }
  });
});

describe('Auth — login sahifasi (4 til)', () => {
  it('GET /user/login — forma, lang switcher, forgot link, CSRF bor', async () => {
    const { html, csrf } = await getCsrf();
    expect(csrf).toBeTruthy();
    expect(html).toContain('name="password"');
    expect(html).toContain('id="form-login"');
    expect(html).toContain('id="form-reg"');
    expect(html).toContain('href="/user/forgot?lang=uz"');
    expect(html).toContain('data-pw-toggle="login-password"');
    // Lang switcher barcha tillar
    for (const l of AUTH_LANGS) {
      expect(html).toContain(`href="?lang=${l}"`);
    }
  });

  it('GET /user/login?lang=en, ru, uz-cyrl — tegishli tilda', async () => {
    const en = await (await fetch(`${serverUrl}/user/login?lang=en`)).text();
    expect(en).toContain('Sign in to Deborah');
    const ru = await (await fetch(`${serverUrl}/user/login?lang=ru`)).text();
    expect(ru).toContain('Вход в платформу');
    const cyrl = await (await fetch(`${serverUrl}/user/login?lang=uz-cyrl`)).text();
    expect(cyrl).toContain('Платформага кириш');
  });

  it('Google OIDC tugmasi server-side check bilan chiqadi (display:none yo\'q)', async () => {
    const { html } = await getCsrf();
    // OIDC yoqilgan bo'lsa tugma server-side render (class + /auth/google link),
    // o'chirilgan bo'lsa umuman yo'q. Ikkala holat ham valid — lekin
    // display:none bilan yashirilgan tugma bo'lmasligi shart.
    const hasBtn = html.includes('/auth/google') && html.includes('btn-google');
    const hasNoBtn = !html.includes('/auth/google');
    expect(hasBtn || hasNoBtn).toBe(true);
    if (hasBtn) {
      // Tugma server-side render — CSS class emas, haqiqiy <a> elementi
      expect(html).toMatch(/<a href="\/auth\/google" class="btn-google"/);
    }
  });

  it('auth.js asset mavjud (200)', async () => {
    const js = await fetch(`${serverUrl}/js/auth.js`);
    expect(js.status).toBe(200);
  });
});

describe('Auth — login/register flow (CSRF)', () => {
  it('Noto\'g\'ri login — xato xabar qaytadi va inputlar qizil bo\'ladi (sahifa 200)', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: 'bunday_user_yoq_123', password: 'xato-parol-1',
    });
    const html = await res.text();
    expect(html).toContain('Bu foydalanuvchi topilmadi');
    // Input error class server-side render qilinadi (auth.js JS bilan)
    expect(html).toContain('id="auth-alert"');
  });

  it('CSRF token bo\'lmasa — 403', async () => {
    const res = await postForm('/user/login', '', {
      lang: 'uz', mode: 'login', username: 'test', password: 'test-parol-123',
    });
    expect(res.status).toBe(403);
  });

  it('Register — qisqa parol rad etiladi (min 8, foydalanuvchi qarori 2026-08-26)', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on',
      email: `r13_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      username: `rs_${Date.now() % 100000}`, password: 'abc1',
    });
    const html = await res.text();
    expect(html).toContain("Parol kamida 8 ta belgi");
  });

  it('Register — harfsiz/raqamsiz parol rad etiladi (harf+raqam shart)', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on',
      email: `r14_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      username: `rh_${Date.now() % 100000}`, password: 'faqatharflarqoldi',
    });
    const html = await res.text();
    expect(html).toContain('bitta harf va bitta raqam');
  });

  it('Register — to\'liq login (harf+raqam, 8+)', async () => {
    const uname = `reg_ok_${Date.now() % 100000}`;
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on',
      email: `r14_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      username: uname, password: 'sirli-parol-2026',
    }, '203.0.113.21'); // XFF: describe guruhi uchun alohida IP (register limit)
    expect(res.status).toBe(302);
  });

  it('Login — mavjud user bilan (seed) — 302 redirect', async () => {
    // Seed DB'da 'user' bor (test muhitida). Parol to'g'ri ekanini testda
    // tekshira olmaymiz — shuning uchun bevosita register qilamiz, keyin login.
    const uname = `reg_flow_${Date.now() % 100000}`;
    const pw = 'sirli-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf();
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r15_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.21'); // XFF: 'Register — to'liq login' bilan bir guruh
    // Yangi sessiya bilan login
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/user/panel');
  });
});

describe('Auth — STYLE STEP 25 (teacher workspace panel)', () => {
  // Bir marta register+login — barcha testlar shu sessiya bilan panel'ga kiradi.
  // (Login'da session regenerate → yangi cookie'ni olish shart; login POST'larini
  //  bitta describe'ga jamlab login rate-limiter limitini ham ehtiyot qilamiz.)
  let panelCookie;

  beforeAll(async () => {
    const uname = `ws_${Date.now() % 1000000}`;
    const pw = 'sirli-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf();
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r16_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.22'); // XFF: S25 guruhi uchun alohida IP
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    });
    const setCookie = res.headers.get('set-cookie') || '';
    panelCookie = setCookie.split(';')[0] || cookie;
    expect(panelCookie).toMatch(/connect\.sid=/);
  });

  async function fetchPanel() {
    const panel = await fetch(`${serverUrl}/user/panel`, {
      headers: { cookie: panelCookie },
    });
    return { html: await panel.text(), status: panel.status };
  }

  it('S25.01/05 — panel STEP 17 shell + workspace css yuklanadi', async () => {
    const { html, status } = await fetchPanel();
    expect(status).toBe(200);
    expect(html).toContain('shell-sidebar');
    expect(html).toContain('/design/contexts/workspace.css');
    expect(html).toContain('id="main-content"');
  });

  it("S25.02 — header: til+tema; Quick Prompt/Profilim/topbar'dagi 'Yangi test' olib tashlangan (09/2026 qaror)", async () => {
    const { html } = await fetchPanel();
    // Topbar'da faqat til guruhi + tema tugmasi; ikkinchi 'Yangi test', Quick Prompt, Profilim yo'q
    expect(html).toContain('id="panelThemeBtn"');
    expect(html).toContain('data-plang="uz"');
    expect(html).not.toContain('ws_quick_prompt');
    expect(html).not.toContain('ws_profile');
    expect(html).not.toContain('data-analytics="ws_new_test"');
    // (Eslatma: 'Quick Prompt' matni window.__PANEL_COPY i18n JSON'ida saqlanadi —
    // strukturaviy tekshiruv data-analytics attributlari orqali)
    expect(html).not.toContain('data-ws-quick-link');
    // Topbar (ws-actions) ichida /user/create-test havolasi YO'Q
    expect(html).not.toMatch(/class="ws-actions"[\s\S]{0,800}?href="\/user\/create-test"/);
  });

  it('S25.03/05 — first-use action, characters olib tashlandi', async () => {
    const { html } = await fetchPanel();
    expect(html).toContain('Birinchi testingizni yarating');
    expect(html).not.toContain('chars-panel');
    expect(html).not.toContain('selectChar');
  });

  it('S25.04 — demo metrikalar olib tashlangan (kutubxona modeli)', async () => {
    const { html } = await fetchPanel();
    // 09/2026 qaror: metrics/VIP/upgrade demolari end-user'dan olib tashlandi
    expect(html).not.toContain('ws-metrics');
    expect(html).not.toContain('ws-upgrade');
    expect(html).toContain('ws-lib-list');
    expect(html).toContain('ws-search');
  });

  it('S25.10 — logout shell-account, topbar emas', async () => {
    const { html } = await fetchPanel();
    // Logout faqat shell-account menu ichida (primary actions emas)
    expect(html).toContain('shell-account-menu-item--logout');
    expect(html).not.toMatch(/class="[^"]*nav-btn[^"]*danger/);
  });
});

describe('Auth — forgot flow (enumeration-safe)', () => {
  it('GET /user/forgot — sahifa 200, 4 til, CSRF bor', async () => {
    const { html, csrf } = await getCsrf('/user/forgot');
    expect(csrf).toBeTruthy();
    expect(html).toContain('Parolni tiklash');
    expect(html).toContain('name="username"');
    const en = await (await fetch(`${serverUrl}/user/forgot?lang=en`)).text();
    expect(en).toContain('Reset password');
  });

  it('POST /user/forgot — mavjud user uchun token yaratiladi, bir xil javob', async () => {
    const { csrf, cookie } = await getCsrf('/user/forgot');
    const res = await postForm('/user/forgot', cookie, {
      _csrf: csrf, lang: 'uz', username: 'bunday_user_yoq_123',
    });
    const html = await res.text();
    // Enumeration-safe: user yo'q bo'lsa ham "yuborildi" javobi
    expect(html).toContain('tiklash havolasi yuborildi');
    expect(html).toContain('msg ok');
  });

  it('POST /user/forgot — bo\'sh username — xato xabar', async () => {
    const { csrf, cookie } = await getCsrf('/user/forgot');
    const res = await postForm('/user/forgot', cookie, {
      _csrf: csrf, lang: 'uz', username: '',
    });
    const html = await res.text();
    expect(html).toContain('Ism va parolni kiriting');
  });
});

describe('Auth — reset flow (plan_login §5)', () => {
  it('GET /user/reset?token=bogus — invalid holat (havola yaroqsiz)', async () => {
    const res = await fetch(`${serverUrl}/user/reset?token=bogus_token_123`, { redirect: 'manual' });
    const html = await res.text();
    expect(html).toContain('Havola yaroqsiz yoki eskirgan');
    expect(html).toContain('Yangi havola oling');
    // Valid formasi ko'rsatilmasligi kerak
    expect(html).not.toContain('id="form-reset"');
  });

  it('GET /user/reset?lang=en — expired holat ingliz tilida', async () => {
    const res = await fetch(`${serverUrl}/user/reset?lang=en&token=x`, { redirect: 'manual' });
    const html = await res.text();
    expect(html).toContain('Link invalid or expired');
  });

  it('To\'liq reset flow: token → GET verify → POST complete → yangi parol bilan login', async () => {
    // User yaratamiz
    const uname = `rste2e_${Date.now() % 1000000}`;
    const oldPw = 'eski-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf('/user/login');
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: oldPw,
      email: `r17_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.23'); // XFF: reset flow guruhi uchun alohida IP
    // AUTH A-20: reset faqat email_verified=true userlar uchun
    await fb.set(`users/${uname}/email_verified`, true);

    // Token'ni forgot bilan bir xil logikada yaratamiz (hash'lab saqlanadi)
    const token = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await fb.set(`resetTokens/${tokenHash}`, {
      safeKey: uname,
      expiresAt: Date.now() + 15 * 60 * 1000,
      createdAt: Date.now(),
    });

    // Ekran 2: GET verify — yangi parol formasi ko'rinadi
    const verifyRes = await fetch(`${serverUrl}/user/reset?token=${token}`, { redirect: 'manual' });
    const verifyHtml = await verifyRes.text();
    expect(verifyHtml).toContain('id="form-reset"');
    expect(verifyHtml).toContain(`value="${token}"`);

    // POST complete — yangi parol (Ekran 3: success ekrani ko'rsatiladi)
    const { csrf, cookie } = await getCsrf(`/user/reset?token=${token}`);
    const postRes = await postForm('/user/reset', cookie, {
      _csrf: csrf, lang: 'uz', token, password: 'yangi-parol-2026',
    });
    expect(postRes.status).toBe(200);
    const successHtml = await postRes.text();
    expect(successHtml).toContain('Parol yangilandi');
    expect(successHtml).toContain('user/panel');

    // Token iste'mol qilingan (bitta foydalanish)
    const snap = await fb.get(`resetTokens/${tokenHash}`);
    expect(snap.exists()).toBe(false);

    // Yangi parol bilan login muvaffaqiyatli
    const { csrf: csrf2, cookie: cookie2 } = await getCsrf('/user/login');
    const loginRes = await postForm('/user/login', cookie2, {
      _csrf: csrf2, lang: 'uz', mode: 'login', username: uname, password: 'yangi-parol-2026',
    });
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.get('location')).toBe('/user/panel');

    // Eski parol endi ishlamaydi (EJS apostrofni &#39; qilib escape qiladi)
    const { csrf: csrf3, cookie: cookie3 } = await getCsrf('/user/login');
    const oldLogin = await postForm('/user/login', cookie3, {
      _csrf: csrf3, lang: 'uz', mode: 'login', username: uname, password: oldPw,
    });
    const oldHtml = await oldLogin.text();
    expect(oldHtml).toContain('Parol noto'); // &#39; escape bilan chiqadi
    expect(oldLogin.status).toBe(200); // redirect emas — xato qaytgan
  });

  it('POST /user/reset — token yo\'q bo\'lsa invalid holat', async () => {
    // Invalid reset sahifasida forma yo'q — CSRF'ni login sahifasidan olamiz
    // (CSRF token sessiyaga bog'liq, cookie bilan birga keladi).
    const { csrf, cookie } = await getCsrf('/user/login');
    const res = await postForm('/user/reset', cookie, {
      _csrf: csrf, lang: 'uz', token: 'bogus', password: 'yangi-parol-2026',
    });
    const html = await res.text();
    expect(html).toContain('Havola yaroqsiz yoki eskirgan');
  });

  it('POST /user/forgot — mavjud user uchun reset token DB\'da saqlanadi (hash)', async () => {
    // Birinchi register qilamiz (user mavjud bo'lishi uchun)
    const uname = `forgot_${Date.now() % 100000}`;
    const pw = 'sirli-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf('/user/login');
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r18_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.23'); // XFF: reset flow guruhi (3-register < 5 limit)
    // AUTH A-20: reset token faqat email_verified=true userlar uchun —
    // register'da email_verified=false bo'ladi, shuning uchun verified qilamiz.
    await fb.set(`users/${uname}/email_verified`, true);
    // Forgot so'rovi
    const { csrf, cookie } = await getCsrf('/user/forgot');
    const res = await postForm('/user/forgot', cookie, {
      _csrf: csrf, lang: 'uz', username: uname,
    });
    expect(res.status).toBe(200);
    // Token hash'lab saqlanadi: resetTokens/{tokenHash} → { safeKey }
    const all = await fb.get('resetTokens');
    const entries = all.exists() ? Object.entries(all.val() || {}) : [];
    const mine = entries.find(([, v]) => v && v.safeKey === uname);
    expect(mine).toBeTruthy();
    const [key, t] = mine;
    expect(key).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash (token emas)
    expect(t.safeKey).toBe(uname);
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    // Plaintext token saqlanmasligi shart (faqat safeKey + expiry)
    expect(Object.keys(t).sort()).toEqual(['createdAt', 'expiresAt', 'safeKey']);
  });

  it('Reset\'dan keyin eski sessiya revoke — panelga qaytib kira olmaydi (plan §5)', async () => {
    // User + eski sessiya (login)
    const uname = `revoke_${Date.now() % 1000000}`;
    const oldPw = 'eski-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf('/user/login');
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: oldPw,
      email: `r19_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.23'); // XFF: reset flow guruhi
    const { csrf: csrfL, cookie: cookiePre } = await getCsrf('/user/login');
    const loginRes = await postForm('/user/login', cookiePre, {
      _csrf: csrfL, lang: 'uz', mode: 'login', username: uname, password: oldPw,
    });
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.get('location')).toBe('/user/panel');
    // Login'da session regenerate → YANGI sessiya cookie (eski cookie endi ishlamaydi)
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const cookieL = setCookie.split(';')[0];
    expect(cookieL).toMatch(/connect\.sid=/);

    // Parolni reset qilamiz (token + POST)
    const token = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await fb.set(`resetTokens/${tokenHash}`, {
      safeKey: uname,
      expiresAt: Date.now() + 15 * 60 * 1000,
      createdAt: Date.now(),
    });
    const { csrf: csrf2, cookie: cookie2 } = await getCsrf(`/user/reset?token=${token}`);
    await postForm('/user/reset', cookie2, {
      _csrf: csrf2, lang: 'uz', token, password: 'yangi-parol-2026',
    });

    // Eski sessiya (cookieL) endi panelga kira olmaydi — 302 → login yoki
    // 401 JSON (req.accepts('json') `*/*` ni qabul qilganida 401 qaytadi).
    const panelRes = await fetch(`${serverUrl}/user/panel`, {
      headers: { cookie: cookieL },
      redirect: 'manual',
    });
    expect([302, 401]).toContain(panelRes.status);
    if (panelRes.status === 302) {
      // BUG-041 fix: redirect returnUrl bilan (login'dan keyin panelga qaytadi)
      expect(panelRes.headers.get('location').startsWith('/user/login')).toBe(true);
    } else {
      const body = await panelRes.json();
      // AUTH B-25: revoke server-side store destroy — sessiya topilmasa
      // 401 unauthorized; stale tekshiruv branch'ida esa 'Session yakunlandi'.
      expect(body.error).toMatch(/Session yakunlandi|Avtorizatsiya talab qilinadi/);
    }
  });

  it('reset.js asset mavjud (200)', async () => {
    const js = await fetch(`${serverUrl}/js/reset.js`);
    expect(js.status).toBe(200);
  });
});

describe('Auth — STYLE STEP 24 (redesign)', () => {
  it('S24.01 — login sahifasi split shell + product proof (440px form)', async () => {
    const html = await (await fetch(`${serverUrl}/user/login`)).text();
    expect(html).toContain('auth-shell');
    expect(html).toContain('auth-proof');
    expect(html).toContain('/design/contexts/auth.css');
  });

  it('S24.02 — proper tab semantics (tablist/tab/aria-selected)', async () => {
    const html = await (await fetch(`${serverUrl}/user/login`)).text();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="form-login"');
    expect(html).toContain('role="tabpanel"');
  });

  it('S24.08 — admin link low-emphasis footer utility', async () => {
    const html = await (await fetch(`${serverUrl}/user/login`)).text();
    expect(html).toContain('footer-link--admin');
    expect(html).toContain('href="/admin/login"');
  });

  it('S24.09 — theme-floating circle olib tashlandi, auth.css yuklanadi', async () => {
    const loginHtml = await (await fetch(`${serverUrl}/user/login`)).text();
    const adminHtml = await (await fetch(`${serverUrl}/admin/login`)).text();
    const forgotHtml = await (await fetch(`${serverUrl}/user/forgot`)).text();
    expect(loginHtml).not.toContain('theme-floating');
    expect(adminHtml).not.toContain('theme-floating');
    expect(forgotHtml).not.toContain('theme-floating');
    const css = await fetch(`${serverUrl}/design/contexts/auth.css`);
    expect(css.status).toBe(200);
  });

  it('S24.12 — admin login distinct flag, no floating circle', async () => {
    const html = await (await fetch(`${serverUrl}/admin/login`)).text();
    expect(html).toContain('auth-admin-flag');
    expect(html).toContain('data-pw-toggle="admin-password"');
    expect(html).toContain('data-theme-state-btn="system"'); // theme-control rendered
    expect(html).not.toContain('theme-floating');
  });
});

describe('Auth — STYLE STEP 26 (test library)', () => {
  // Bir marta register+login — barcha testlar shu sessiya bilan panel'ga kiradi.
  let panelCookie;

  beforeAll(async () => {
    const uname = `lib_${Date.now() % 1000000}`;
    const pw = 'sirli-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf();
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r20_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.24'); // XFF: S26 guruhi uchun alohida IP
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    });
    const setCookie = res.headers.get('set-cookie') || '';
    panelCookie = setCookie.split(';')[0] || cookie;
    expect(panelCookie).toMatch(/connect\.sid=/);

    // Row/overflow HTML faqat testlar bor bo'lganda render bo'ladi —
    // bitta test yaratamiz (S26.01/03 struktura tekshiruvlari uchun).
    const ct = await fetch(`${serverUrl}/user/create-test`, {
      headers: { cookie: panelCookie },
    });
    const ctHtml = await ct.text();
    const csrfTok = (ctHtml.match(/__CSRF_TOKEN\s*=\s*['"]([^'"]+)['"]/) || ctHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const saveRes = await fetch(`${serverUrl}/user/api/tests/save`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: panelCookie,
        'X-CSRF-Token': csrfTok || '',
      },
      body: JSON.stringify({
        name: 'Kutubxona testi',
        count: 2,
        questions: [
          { text: 'Savol 1', options: ['A', 'B', 'C', 'D'], correct: 0 },
          { text: 'Savol 2', options: ['A', 'B'], correct: 1 },
        ],
      }),
    });
    expect(saveRes.status).toBe(200);
  });

  async function fetchPanel() {
    const panel = await fetch(`${serverUrl}/user/panel`, {
      headers: { cookie: panelCookie },
    });
    return { html: await panel.text(), status: panel.status };
  }

  it('S26.01/02 — library list + row fields (title/count/visibility/cast)', async () => {
    const { html, status } = await fetchPanel();
    expect(status).toBe(200);
    expect(html).toContain('ws-lib-list');
    expect(html).toContain('ws-lib-name');
    expect(html).toContain('ws-vis');
    expect(html).toContain('data-source="user"');
    expect(html).toContain('/js/workspace-library.js');
  });

  it('S26.03/04 — overflow menu + danger delete, no adjacent one-click delete', async () => {
    const { html } = await fetchPanel();
    expect(html).toContain('ws-lib-overflow-btn');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('ws-lib-menu-danger');
    // 09/2026 qaror: menyu tozalandi — Sinov/Yakka mashq dublikatlari yo'q;
    // Eksport (JSON) oddiy user'da ko'rinmaydi (faqat VIP/rahbariyat).
    for (const act of ['edit', 'duplicate', 'visibility', 'archive', 'delete']) {
      expect(html).toContain(`data-act="${act}"`);
    }
    expect(html).not.toContain('data-act="practice"');
    expect(html).not.toContain('data-act="export"');
    expect(html).not.toMatch(/role="menuitem"[^>]*href="\/user\/practice/);
    expect(html).not.toContain('act-del');
  });

  it('S26.06 — filter toolbar (search/subject/type/sort)', async () => {
    const { html } = await fetchPanel();
    expect(html).toContain('id="lib-search"');
    expect(html).toContain('id="lib-subject"');
    expect(html).toContain('id="lib-type"');
    expect(html).toContain('id="lib-sort"');
    expect(html).toContain('ws-lib-active');
  });

  it("S26.07/08 — VIP/upgrade end-user'da ko'rinmaydi (kutubxona oddiy model)", async () => {
    const { html } = await fetchPanel();
    // 09/2026 qaror: VIP end-user ko'rinmaydi; upgrade/taxonomy demolari yo'q
    expect(html).not.toContain('ws-upgrade');
    expect(html).not.toContain('VIP imkoniyati');
    expect(html).not.toContain("Tayyor to'plamlar");
    expect(html).not.toContain('Mock Testlar');
  });

  it('S26.10 — empty / filtered-none states present', async () => {
    const { html } = await fetchPanel();
    expect(html).toContain('id="lib-empty"');
    expect(html).toContain('id="lib-none"');
  });

  it('S26 API — duplicate/archive/export endpoints registered (404 emas, auth talab)', async () => {
    // Auth'siz — 401/403, yo'qolgan route emas (404) bo'lmasligi kerak.
    // Router /user mount'da — haqiqiy yo'l /user/api/tests/*.
    const dup = await fetch(`${serverUrl}/user/api/tests/duplicate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const arc = await fetch(`${serverUrl}/user/api/tests/archive`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const exp = await fetch(`${serverUrl}/user/api/tests/export?key=x`);
    expect([401, 403, 500]).toContain(dup.status);
    expect([401, 403, 500]).toContain(arc.status);
    expect([401, 403, 500]).toContain(exp.status);
  });
});

/** 09/2026 export gating testi uchun: username bo'yicha isVip flag o'zgartirish. */
async function setUserVipFlag(username, val) {
  const users = await fb.get('users');
  if (!users.exists()) throw new Error('users topilmadi');
  for (const [k, u] of Object.entries(users.val())) {
    if (u && u.username === username) {
      await fb.set(`users/${k}/isVip`, val === true);
      return;
    }
  }
  throw new Error(`user topilmadi: ${username}`);
}

describe('S27 — Test Builder professional authoring workspace', () => {
  let builderCookie = '';
  let savedKey = '';
  let builderUname = '';

  beforeAll(async () => {
    const uname = `bld_${Date.now() % 1000000}`;
    builderUname = uname;
    const pw = 'sirli-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf();
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r21_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.25'); // XFF: S27 guruhi uchun alohida IP
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    });
    builderCookie = (res.headers.get('set-cookie') || '').split(';')[0] || cookie;
    expect(builderCookie).toMatch(/connect\.sid=/);
  });

  async function csrfToken() {
    const ct = await fetch(`${serverUrl}/user/create-test`, { headers: { cookie: builderCookie } });
    const html = await ct.text();
    return (html.match(/__CSRF_TOKEN\s*=\s*['"]([^'"]+)['"]/) || html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  }

  it('S27.01/02/09 — builder view renders sticky bar, outline, editor, import modal', async () => {
    const res = await fetch(`${serverUrl}/user/create-test`, { headers: { cookie: builderCookie } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('tb-topbar');
    expect(html).toContain('tb-outline');
    expect(html).toContain('tb-editor');
    expect(html).toContain('tb-import-modal');
    expect(html).toContain('/js/test-builder.js');
  });

  it('S27.03/04 — save persists type/explanation/tags/timing; short_answer supported', async () => {
    const csrfTok = await csrfToken();
    const saveRes = await fetch(`${serverUrl}/user/api/tests/save`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: builderCookie,
        'X-CSRF-Token': csrfTok || '',
      },
      body: JSON.stringify({
        name: 'Builder testi',
        count: 2,
        questions: [
          {
            type: 'true_false', text: 'Yer quyosh atrofida aylanadimi?',
            options: ["To'g'ri", "Noto'g'ri"], correct: 0,
            explanation: 'Astronomik fakt', tags: ['fan', 'astronomiya'], timing: 30,
          },
          {
            type: 'short_answer', text: 'Eng katta okean?',
            options: ['Tinch'], correct: 0,
            explanation: 'Tinch okeani', tags: ['geografiya'], timing: 45,
          },
        ],
      }),
    });
    expect(saveRes.status).toBe(200);
    const data = await saveRes.json();
    savedKey = data.key;
    expect(savedKey).toBeTruthy();

    // 09/2026 qaror: export oddiy (non-VIP) user uchun 403; VIP/rahbariyat 200.
    const exp403 = await fetch(`${serverUrl}/user/api/tests/export?key=${savedKey}`, {
      headers: { cookie: builderCookie },
    });
    expect(exp403.status).toBe(403);

    await setUserVipFlag(builderUname, true);
    const exp = await fetch(`${serverUrl}/user/api/tests/export?key=${savedKey}`, {
      headers: { cookie: builderCookie },
    });
    await setUserVipFlag(builderUname, false);
    expect(exp.status).toBe(200);
    const exported = await exp.json();
    const test = exported.test;
    expect(test.name).toBe('Builder testi');
    expect(test.questions[0].type).toBe('true_false');
    expect(test.questions[0].explanation).toBe('Astronomik fakt');
    expect(test.questions[0].tags).toContain('astronomiya');
    expect(test.questions[0].timing).toBe(30);
    expect(test.questions[1].type).toBe('short_answer');
    expect(test.questions[1].options).toEqual(['Tinch']);
  });

  it('S27.01 — edit mode loads saved test (editKey prefilled)', async () => {
    expect(savedKey).toBeTruthy();
    const res = await fetch(`${serverUrl}/user/create-test?edit=${savedKey}`, {
      headers: { cookie: builderCookie },
    });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('tb-topbar');
    expect(html).toContain('Builder testi');
  });

  it('S27 — unauth: /user/create-test auth talab qiladi (401 yoki redirect)', async () => {
    // BUG-041 fix: sahifa uchun brauzer/json2 o'rniga 302 login redirect (manual —
    // fetch default redirect'ni kuzatib 200 olib qoladi)
    const res = await fetch(`${serverUrl}/user/create-test`, { redirect: 'manual' });
    expect([301, 302, 303, 401]).toContain(res.status);
  });

  it('S27.12 — unsaved guard, offline recovery va keyboard reorder JS markerlari', async () => {
    const js = await (await fetch(`${serverUrl}/js/test-builder.js`)).text();
    expect(js).toContain('beforeunload');
    expect(js).toContain('guardUnload');
    expect(js).toContain('navigator.onLine');
    expect(js).toContain('data-move="up"');
    expect(js).toContain('data-move="down"');
    // S34l: native radio YO'Q — variant kartalari role="radio" (Kahoot modeli)
    expect(js).toContain('role="radiogroup"');
    expect(js).toContain('role="radio"');
    expect(js).toContain('aria-checked=');
  });
});

describe('S28 — Cast Setup Studio', () => {
  let studioCookie = '';
  let testKey = '';

  beforeAll(async () => {
    const uname = `cs_${Date.now() % 1000000}`;
    const pw = 'sirli-parol-2026';
    const { csrf: csrfR, cookie: cookieR } = await getCsrf();
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r22_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, '203.0.113.26'); // XFF: S28 guruhi uchun alohida IP
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    });
    studioCookie = (res.headers.get('set-cookie') || '').split(';')[0] || cookie;
    expect(studioCookie).toMatch(/connect\.sid=/);

    // Studio uchun test yaratamiz (preflight source:user uchun)
    const ct = await fetch(`${serverUrl}/user/create-test`, { headers: { cookie: studioCookie } });
    const ctHtml = await ct.text();
    const csrfTok = (ctHtml.match(/__CSRF_TOKEN\s*=\s*['"]([^'"]+)['"]/) || ctHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const saveRes = await fetch(`${serverUrl}/user/api/tests/save`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: studioCookie,
        'X-CSRF-Token': csrfTok || '',
      },
      body: JSON.stringify({
        name: 'Studio testi',
        count: 2,
        questions: [
          { type: 'single_choice', text: 'Savol 1', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: '', tags: [], timing: 20 },
          { type: 'single_choice', text: 'Savol 2', options: ['A', 'B'], correct: 1, explanation: '', tags: [], timing: 20 },
        ],
      }),
    });
    expect(saveRes.status).toBe(200);
    testKey = (await saveRes.json()).key;
  });

  it('S28.01/02/11 — panel external partial + css/js, inline CSS olib tashlangan', async () => {
    const res = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: studioCookie } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('cast-studio-overlay');
    expect(html).toContain('aria-labelledby="cast-studio-title"');
    expect(html).toContain('/css/cast-studio.css');
    expect(html).toContain('/js/cast-studio.js');
    // Inline cast-studio CSS qoldig'i yo'q
    expect(html).not.toContain('.cast-studio-overlay{position:fixed');
  });

  it('S28.02/09/10 — studio JS: radio semantics, focus trap, dirty, request-id', async () => {
    const js = await (await fetch(`${serverUrl}/js/cast-studio.js`)).text();
    expect(js).toContain('name="cs-mode"');
    expect(js).toContain('type="radio"');
    expect(js).toContain('role="radiogroup"');
    expect(js).toContain('focusTrap');
    expect(js).toContain('focusedBeforeOpen');
    expect(js).toContain('is-dirty');
    expect(js).toContain('requestClose');
    expect(js).toContain('requestId');
    expect(js).toContain('aria-busy');
    expect(js).toContain('data-cs-launch-label');
  });

  it('S28.05/06 — summary + privacy/a11y/duration summarylari JS da', async () => {
    const js = await (await fetch(`${serverUrl}/js/cast-studio.js`)).text();
    expect(js).toContain('cast-summary');
    expect(js).toContain('cs-customized');
    expect(js).toContain('cs-reset');
    expect(js).toContain('Maxfiylik');
    expect(js).toContain('Qulaylik (a11y)');
    expect(js).toContain('Kutilgan davomiylik');
    expect(js).toContain('cs-summary-item--danger');
    expect(js).toContain('cs-summary-item--warning');
  });

  it('S28.12 — preflight default mode qaytaradi (source:user, safe metadata)', async () => {
    const ct = await fetch(`${serverUrl}/user/create-test`, { headers: { cookie: studioCookie } });
    const ctHtml = await ct.text();
    const csrfTok = (ctHtml.match(/__CSRF_TOKEN\s*=\s*['"]([^'"]+)['"]/) || ctHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await fetch(`${serverUrl}/api/cast/preflight`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: studioCookie,
        'X-CSRF-Token': csrfTok || '',
      },
      body: JSON.stringify({
        source: { type: 'user', key: testKey },
        draftConfig: { presetId: 'responsive_accuracy', overrides: {} },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.preflightId).toBeTruthy();
    expect(Array.isArray(data.blockers)).toBe(true);
    expect(data.test.questionCount).toBe(2);
    expect(data.capabilities).toHaveProperty('supportsTeams');
  });

  it('S28.12 — invalid source preflight 400 (invalid config)', async () => {
    const ct = await fetch(`${serverUrl}/user/create-test`, { headers: { cookie: studioCookie } });
    const ctHtml = await ct.text();
    const csrfTok = (ctHtml.match(/__CSRF_TOKEN\s*=\s*['"]([^'"]+)['"]/) || ctHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await fetch(`${serverUrl}/api/cast/preflight`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: studioCookie,
        'X-CSRF-Token': csrfTok || '',
      },
      body: JSON.stringify({ source: { type: 'user', key: 'nonexistent-key-xyz' }, draftConfig: {} }),
    });
    expect([400, 404]).toContain(res.status);
  });
});

describe('S29 — Cast Director private cockpit', () => {
  it('S29.01/03 — 7/5 grid: dir-main + dir-pane evidence', async () => {
    const fs = await import('node:fs');
    const dirHtml = fs.readFileSync('views/cast/director.ejs', 'utf8');
    expect(dirHtml).toContain('class="dir-layout"');
    expect(dirHtml).toContain('class="dir-main');
    expect(dirHtml).toContain('class="dir-pane');
    expect(dirHtml).toContain('class="dir-rail');
    // director static JS mavjud
    const js = await (await fetch(`${serverUrl}/js/cast-director.js`)).text();
    expect(js.length).toBeGreaterThan(1000);
  });

  it('S29.02 — phase badge, status chips, overflow menu markup', async () => {
    const fs = await import('node:fs');
    const dirHtml = fs.readFileSync('views/cast/director.ejs', 'utf8');
    expect(dirHtml).toContain('id="dir-phase-badge"');
    expect(dirHtml).toContain('id="dir-projector-status"');
    expect(dirHtml).toContain('id="dir-role-chip"');
    expect(dirHtml).toContain('id="btn-overflow"');
    expect(dirHtml).toContain('id="dir-overflow-menu"');
  });

  it('S29.04 — metrics bar elementlari', async () => {
    const fs = await import('node:fs');
    const dirHtml = fs.readFileSync('views/cast/director.ejs', 'utf8');
    expect(dirHtml).toContain('id="dir-metrics"');
    expect(dirHtml).toContain('id="dir-metric-answered"');
    expect(dirHtml).toContain('id="dir-metric-correct"');
    expect(dirHtml).toContain('id="dir-metric-distractor"');
    expect(dirHtml).toContain('id="dir-metric-issue"');
  });

  it('S29.05/09 — rail primary + Add Time menu', async () => {
    const fs = await import('node:fs');
    const dirHtml = fs.readFileSync('views/cast/director.ejs', 'utf8');
    expect(dirHtml).toContain('rail-group rail-primary');
    expect(dirHtml).toContain('data-addtime');
    expect(dirHtml).toContain('data-sec="5"');
    expect(dirHtml).toContain('data-sec="30"');
  });

  it('S29.07/11 — director JS: pending spinner, phase badge, metrics update, overflow', async () => {
    const js = await (await fetch(`${serverUrl}/js/cast-director.js`)).text();
    expect(js).toContain('setCmdPending');
    expect(js).toContain('is-loading');
    expect(js).toContain('renderPhaseBadge');
    expect(js).toContain('PHASE_LABELS');
    expect(js).toContain('dir-metric-answered');
    expect(js).toContain('dir-metric-distractor');
    expect(js).toContain('overflowBtn');
    expect(js).toContain('cast:addTime');
  });

  it('S29.10 — cast css da glow/shimmer/trophy/rainbow yo\'q', async () => {
    const fs = await import('node:fs');
    const tokens = fs.readFileSync('public/css/cast-tokens.css', 'utf8');
    const dirCss = fs.readFileSync('public/css/cast-director.css', 'utf8');
    const banned = /glow|shimmer|trophy|rainbow/;
    expect(banned.test(tokens)).toBe(false);
    expect(banned.test(dirCss)).toBe(false);
  });
});

describe('S30 — Projector classroom display', () => {
  it('S30.01/04 — projector-only DOM, font floor tokenlar', async () => {
    const fs = await import('node:fs');
    const ejs = fs.readFileSync('views/cast/projector.ejs', 'utf8');
    // Private DOM yo'q (comment'lar strip)
    const body = ejs.replace(/<!--[\s\S]*?-->/g, '').replace(/<%[\s\S]*?%>/g, '');
    expect(body).not.toMatch(/dir-|roster|coHost|host-control/);
    const pcss = fs.readFileSync('public/design/contexts/projector.css', 'utf8');
    expect(pcss).toMatch(/--proj-qsize: clamp\(40px/);
    expect(pcss).toMatch(/--proj-osize: clamp\(28px/);
    expect(pcss).toMatch(/--proj-csize: clamp\(72px/);
  });

  it('S30.02/03 — QR + kod chip markup', async () => {
    const fs = await import('node:fs');
    const ejs = fs.readFileSync('views/cast/projector.ejs', 'utf8');
    expect(ejs).toContain('id="proj-qr"');
    expect(ejs).toContain('id="proj-code-chip"');
    const js = await (await fetch(`${serverUrl}/js/cast-projector.js`)).text();
    expect(js).toContain('/cast/qr?d=');
    expect(js).toContain('showCodeChip');
  });

  it('S30.05/06 — solid options + timer num/label/ring, pulse yo\'q', async () => {
    const fs = await import('node:fs');
    const pcss = fs.readFileSync('public/design/contexts/projector.css', 'utf8');
    const body = pcss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/shimmer|sweep/);
    expect(body).not.toMatch(/animation: pulse|pulse 1s infinite/);
    const ejs = fs.readFileSync('views/cast/projector.ejs', 'utf8');
    expect(ejs).toContain('proj-timer-num');
    expect(ejs).toContain('proj-timer-label');
    expect(ejs).toContain('proj-timer-ring');
  });

  it('S30.07 — public distribution max 5, reveal keyin', async () => {
    const fs = await import('node:fs');
    const js = await (await fetch(`${serverUrl}/js/cast-projector.js`)).text();
    expect(js).toContain('renderDistribution');
    expect(js).toContain('slice(0, 5)');
    const handler = fs.readFileSync('socket/cast-handler.js', 'utf8');
    expect(handler).toContain('reveal.distribution');
  });

  it('S30.08/09/11 — profillar + safe area + reduced motion', async () => {
    const fs = await import('node:fs');
    const pcss = fs.readFileSync('public/design/contexts/projector.css', 'utf8');
    expect(pcss).toContain('classroom_dark');
    expect(pcss).toContain('classroom_light');
    expect(pcss).toContain('high_contrast');
    expect(pcss).toMatch(/--proj-safe-x: max\(4vw/);
    expect(pcss).toMatch(/max-aspect-ratio: 4\/3/);
    expect(pcss).toContain('prefers-reduced-motion: reduce');
  });

  it('S30.02 — QR SVG endpoint ishlaydi', async () => {
    const res = await fetch(`${serverUrl}/cast/qr?d=${encodeURIComponent('https://example.com/play?code=TEST1')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toContain('svg');
    const svg = await res.text();
    expect(svg).toContain('<svg');
  });
});

describe('S31 — Participant join va answer experience', () => {
  it('S31.01/02/08 — join stepper, monospace code, badge, safe-area', async () => {
    const fs = await import('node:fs');
    const ejs = fs.readFileSync('views/cast/participant.ejs', 'utf8');
    expect(ejs).toContain('join-steps');
    expect(ejs).toContain('inputmode="text"');
    expect(ejs).toContain('autocapitalize="characters"');
    expect(ejs).toContain('player-badge');
    expect(ejs).toContain('part-net');
    const css = fs.readFileSync('public/css/cast-participant.css', 'utf8');
    expect(css).toContain('JetBrains Mono');
    expect(css).toContain('safe-area-inset-top');
    expect(css).toContain('safe-area-inset-bottom');
  });

  it('S31.04/05/06 — option letter, state banner, ACK-based SAVED', async () => {
    const fs = await import('node:fs');
    const js = await (await fetch(`${serverUrl}/js/cast-participant.js`)).text();
    expect(js).toContain('cast-opt-letter');
    expect(js).toContain('part-state-banner');
    expect(js).toContain('setState(STATE.SAVED)');
    expect(js).toContain('ack.ok');
    expect(js).toContain('showPreviousOnRevote');
    const css = fs.readFileSync('public/css/cast-participant.css', 'utf8');
    expect(css).toContain("[data-state='SAVED']");
    expect(css).toContain("[data-state='RETRYING']");
    expect(css).toContain('min-height: 48px');
  });

  it('S31.07/09/10/11 — no shimmer, prefs storage, semantic reveal, net status', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('public/css/cast-participant.css', 'utf8');
    const cssBody = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssBody).not.toMatch(/shimmer|sweep|bounce|glow/);
    const js = await (await fetch(`${serverUrl}/js/cast-participant.js`)).text();
    expect(js).toContain('cast-participant-prefs-v1');
    expect(js).toContain('part-reveal--correct');
    expect(js).toContain('part-reveal-verdict');
    expect(js).toContain('updateNet');
    const ejs = fs.readFileSync('views/cast/participant.ejs', 'utf8');
    expect(ejs).toContain('part-state-banner');
  });
});

describe('S32 — Leaderboard, celebration va mature gamification', () => {
  it('S32.01/02/03 — modes, max 5 TopN, neutral rows, no flames/crowns/podium', async () => {
    const fs = await import('node:fs');
    const constants = fs.readFileSync('utils/cast-constants.js', 'utf8');
    expect(constants).toContain("LEADERBOARD_SHOW: 'leaderboard:show'");
    expect(constants).toContain('OFF_DURING_LEARNING');
    expect(constants).toContain('PERSONAL_ONLY');
    expect(constants).toContain('FULL_PRIVATE_HOST');
    const sock = fs.readFileSync('socket/cast-handler.js', 'utf8');
    expect(sock).toContain('handleLeaderboardShow');
    expect(sock).toContain('Math.min(lb.topN || 5, 5)');
    expect(sock).toContain("mode: 'public_top_n'");
    expect(sock).toContain("mode: 'personal'");
    const css = fs.readFileSync('public/design/contexts/leaderboard.css', 'utf8');
    const cssBody = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssBody).not.toMatch(/👑|🔥|🏆|podium/);
    expect(css).toContain('.lb-row');
  });

  it('S32.04/07/08 — CVD medal tones, 40ms stagger, ties/no-score states', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('public/design/contexts/leaderboard.css', 'utf8');
    expect(css).toContain('lb-medal--gold');
    expect(css).toContain('lb-medal--silver');
    expect(css).toContain('lb-medal--bronze');
    expect(css).toContain('--lb-stagger');
    expect(css).toContain('prefers-reduced-motion');
    const js = await (await fetch(`${serverUrl}/js/cast-leaderboard.js`)).text();
    expect(js).toContain('MEDAL_LABEL');
    expect(js).toContain('renderRows');
    expect(js).toContain('renderPersonal');
    expect(js).toContain('renderTeam');
    expect(js).toContain('lb-row--noshow');
    expect(js).toContain('index * 40');
    expect(js).toContain('total 200ms');
  });

  it('S32.05/06/09/10/11 — personal private, team scope, celebration budget, views', async () => {
    const fs = await import('node:fs');
    const js = await (await fetch(`${serverUrl}/js/cast-leaderboard.js`)).text();
    expect(js).toContain('budget');
    expect(js).toContain('budget <= 0');
    expect(js).toContain('complete');
    expect(js).toContain('prefers-reduced-motion');
    expect(js).toContain('setTimeout(() => el.remove(), 900)');
    const projEjs = fs.readFileSync('views/cast/projector.ejs', 'utf8');
    expect(projEjs).toContain('proj-leaderboard');
    expect(projEjs).toContain('cast-leaderboard.js');
    const partEjs = fs.readFileSync('views/cast/participant.ejs', 'utf8');
    expect(partEjs).toContain('part-leaderboard');
    expect(partEjs).toContain('cast-leaderboard.js');
    const projJs = await (await fetch(`${serverUrl}/js/cast-projector.js`)).text();
    expect(projJs).toContain("case 'cast:leaderboardUpdated'");
    expect(projJs).toContain('hiddenCount');
    const partJs = await (await fetch(`${serverUrl}/js/cast-participant.js`)).text();
    expect(partJs).toContain("case 'cast:leaderboardUpdated'");
    expect(partJs).toContain('part-leaderboard-badge');
    expect(partJs).toContain('Yuqori');
    const sock = fs.readFileSync('socket/cast-handler.js', 'utf8');
    expect(sock).toContain('emitTeamLeaderboard');
    expect(sock).toContain('trackedSocketsFor(entry.participantId)');
  });
});

describe('S33 — Admin dashboard redesign va security-sensitive UI cleanup', () => {
  let adminCookie;

  beforeAll(async () => {
    // Vitest env: ADMIN_USER=testadmin / ADMIN_PASS=testpass (vitest.config.js)
    const { ADMIN_USER, ADMIN_PASS } = await import('../../utils/constants.js');
    const { csrf, cookie } = await getCsrf('/admin/login');
    const res = await postForm('/admin/login', cookie, {
      _csrf: csrf, username: ADMIN_USER, password: ADMIN_PASS,
    });
    const setCookie = res.headers.get('set-cookie') || '';
    adminCookie = setCookie.split(';')[0] || cookie;
  });

  it('S33.03/06 — password UI dan butunlay chiqdi, inline styles kamaydi', async () => {
    const fs = await import('node:fs');
    const html = await (await fetch(`${serverUrl}/admin/dashboard`, {
      headers: { cookie: adminCookie },
    })).text();
    // S33.03: hash/plain password hech qayerda ko'rinmaydi
    expect(html).not.toContain('Parol (hash)');
    expect(html).not.toContain('plainPassword');
    expect(html).not.toContain('Parol:');
    const ejs = fs.readFileSync('views/admin/dashboard.ejs', 'utf8');
    expect(ejs).not.toContain('u.password');
    expect(ejs).not.toContain('data.plainPassword');
    // S33.06: inline styles keskin kamaygan (134 -> <100)
    const inlineCount = (ejs.match(/style="/g) || []).length;
    expect(inlineCount).toBeLessThan(100);
  });

  it('S33.01/02 — 64px topbar, 220px sidebar, max 1440, mobile drawer', async () => {
    const fs = await import('node:fs');
    const html = await (await fetch(`${serverUrl}/admin/dashboard`, {
      headers: { cookie: adminCookie },
    })).text();
    expect(html).toContain('admin-nav-hamburger');
    expect(html).toContain('admin-drawer-overlay');
    expect(html).toContain('toggleAdminDrawer');
    const css = fs.readFileSync('public/css/admin.css', 'utf8');
    expect(css).toContain('height: 64px');
    expect(css).toContain('width: 220px');
    expect(css).toContain('max-width: 1440px');
    expect(css).toContain('admin-nav-hamburger');
    expect(css).toContain('translateX(-104%)');
  });

  it('S33.07/08/09/10 — actionable stats, status colors, VIP picker/confirm, keyboard dropzone', async () => {
    const fs = await import('node:fs');
    const ejs = fs.readFileSync('views/admin/dashboard.ejs', 'utf8');
    expect(ejs).toContain('data-go='); // S33.07 actionable stats
    expect(ejs).toContain('vip-user-list'); // S33.09 datalist picker
    expect(ejs).toContain('grant-vip-btn'); // S33.09 pending state button
    expect(ejs).toContain("btn.setAttribute('aria-busy'"); // pending
    expect(ejs).toContain("e.key === 'Enter'"); // S33.10 keyboard dropzone
    const css = fs.readFileSync('public/css/admin.css', 'utf8');
    expect(css).toContain('.admin-status--info'); // S33.08 signal cyan
    expect(css).toContain('.admin-status--warn'); // S33.08 warning amber
    expect(css).toContain('.admin-status--danger'); // S33.08 danger
  });

  it('S33.05 — VIP table dt/density format; vip view da ham password yo q', async () => {
    const html = await (await fetch(`${serverUrl}/admin/vip`, {
      headers: { cookie: adminCookie },
    })).text();
    expect(html).toContain('class="dt"');
    expect(html).toContain('dt-row');
    expect(html).not.toContain('plainPassword');
    expect(html).not.toContain('Parol:');
  });
});

describe('S34 — Error pages, offline va PWA', () => {
  it('S34.01 — 404 sahifasi state-specific render bo\'ladi', async () => {
    const res = await fetch(`${serverUrl}/bu-sahifa-yoq-404`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('404');
    expect(html).toContain('evidence-mark');
    expect(html).toContain('Bosh sahifa');
  });

  it('S34.02/03 — noma\'lum sahifa error page bilan qaytadi', async () => {
    const res = await fetch(`${serverUrl}/nonexistent-page-for-500`);
    expect([404, 500]).toContain(res.status);
    const html = await res.text();
    expect(html).toContain('error');
  });

  it('S34.06 — Offline sahifasi cached actions bilan render bo\'ladi', async () => {
    const res = await fetch(`${serverUrl}/offline`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('offline');
    expect(html).toContain('Qayta urinish');
    expect(html).toContain('Admin');
  });

  it('S34.09 — Manifest Ink/Paper tokenlarini ishlatadi', () => {
    const fs = require('fs');
    const path = require('path');
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/manifest.json'), 'utf8'));
    expect(m.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(m.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(m.icons.length).toBeGreaterThanOrEqual(3);
  });
});

