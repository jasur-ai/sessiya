# Deborah — Raqamlashtirilgan nazorat va imtihon platformasi

**Jonli sayt:** <https://deborah-ncj.onrender.com>
**Stack:** Node.js 20 (ESM), Express, Socket.io, Firebase (Realtime DB + Auth admin), EJS, Playwright + Vitest (492 test fayl, CI'da majburiy).

Deborah — o'zbek tilidagi ta'lim platformasi: jonli dars o'yinlari (jonli viktorina uslubi), test va amaliyotlar, imtihonlarni to'liq boshqarish, AI yordamchi va tahlillar.

---

## 1. Kirish (test uchun)

| Kim | Qanday | Manzil |
|---|---|---|
| **Administrator** | login: `edikit_admin` · parol: `admin0408` | `/admin/login` |
| **O'qituvchi / talaba** | Google akkaunt bilan (real Google OIDC) | bosh sahifa → "Google bilan kirish" |
| **O'qituvchi / talaba** | Email/username + parol, ro'yxatdan o'tish | bosh sahifa → ro'yxat |
| Talaba (kod bilan) | O'yin kodini kiritish | `/play` (kod so'raladi) |

- Google login: **real OAuth 2.0 + PKCE** (`/auth/google` → Google → `/auth/google/callback`). Yangi Google user uchun rol tanlash oynasi (`/user/google-setup`).
- Email bilan kirishda: MFA (TOTP), Passkey (WebAuthn), parol tiklash — hammasi real ishlaydi.
- Rollar: `student`, `teacher` (admin tasdiqlaydi), `admin`, `proctor`, `marker`, `board`.
- ⚠️ `ADMIN_USER`/`ADMIN_PASS` ataylab shu yozuvda — repo **private**. Public qilsangiz, darhol o'zgartiring!

## 2. Foydalanuvchi oqimlari (real sahifalar)

### Talaba/o'qituvchi (`/user/...`)
- `panel` — shaxsiy panel (topshiriqlar, natijalar, bildirishnomalar)
- `create-test` — test yaratish ( savollar, variantlar)
- `test-arena` — o'z-o'zini sinash maydoni
- `assignments`, `portfolio` (ommaviy sahifasi `portfolio-share` bilan), `settings`, `notifications`
- ⚠️ Prefikssiz sahifalar: `/sessions` (qurilmalar/sessiyalar), `/onboarding` — eski
  `/user/`-prefikslangan shakllari (sessions, onboarding, mfa-setup) 404 beradi
- Xavfsizlik: `/user/security-profile` (parol, MFA yoqish, Passkey, sessiyalar), `/user/email-change`,
  `reset`/`forgot`. `/user/mfa/setup` — faqat majburiy enroll o'tish sahifasi (pendingMfaSetup
  holatida; oddiy holatda panelga redirect)

### Jonli dars — Cast
- **Kirish nuqtalari:** teacher panel → **Cast Studio** (test yaratilgach "Start") — sessiya
  API orqali yaratiladi; talaba `/play?code=XXXXXX` (6 belgili harf/raqam kod) orqali qo'shiladi
- `/cast/:sessionId/director` — o'qituvchi pulti: savollar jonli yuborish, reyting, **⚡ Tezkor savol**
  - **✨ "AI yozib beradi"** — REAL Gemini generatsiyasi: mavzu yoziladi (masalan "Kapital iqtisodiyoti"), 1–3 ta tanlanadi → 5–15 soniyada savol + 4 variant + to'g'ri javob + izoh formaga qo'yiladi
- `/cast/:sessionId/projector` — proyektor ekrani, `/cast/:sessionId/results` — yakuniy natijalar,
  `/cast/:sessionId/quality-lab`, `/cast/qr` — QR kod. (`/cast/director` yoki `/cast/participant`
  deb to'g'ridan-to'g'ri yo'l YO'Q — sessiya ID talab)

## 3. AI (Gemini) — real generatsiya

| Endpoint | Nima | Himoya |
|---|---|---|
| `GET /api/ai/status` | `{enabled, model}` | ommaviy |
| `POST /api/ai/generate-questions` | real savollar (matn, variantlar, to'g'ri javob, izoh) | login + CSRF + 12/daq, 300/kun limit |

- Model: `GEMINI_MODEL` env (hozir `gemini-3.6-flash`), kalit: `GEMINI_API_KEY` (hech qayerda logga chiqmaydi).
- Klient: `src/modules/ai/gemini-client.js` (timeout, retry, xavfsiz JSON ajratish).
- UI'da: **Director → ⚡ Tezkor savol → ✨ AI yozib beradi**.
- Qo'shimcha AI modullari (admin panel): `ai-question-gen` (blueprint/job pipeline), `ai-grading` (shadow mode), `ai-checkpoint`, `ai-mlops` (evaluatsiya/rollback), `claude` adapter.

## 4. Integratsiyalar (holat: 2026-08-27)

| Integratsiya | Holat | Qayerda |
|---|---|---|
| **Google OIDC (login)** | ✅ LIVE | bosh sahifa, `/auth/google` |
| **Gemini AI** | ✅ LIVE | Director ✨, `/api/ai/*` |
| **Canva Connect (OAuth)** | ✅ kod tayyor — konsol URI kutilmoqda | admin panel → Canva (`/admin/canva`), callback `/api/admin/canva/callback` |
| **Google Slides (OAuth)** | ✅ kod tayyor — konsol URI kutilmoqda | admin panel → Google Slides, callback `/api/admin/google-slides/callback` |
| **Email (SMTP/Postmark/SES)** | ✅ sozlangan (Gmail SMTP) + avtomatik fallback zanjiri | har qanday xat (verify/reset/welcome) |
| **Telegram (OTP login + bot)** | ✅ kod va testlar tayyor | `telegram-auth`, `telegram-bot` (env kutiladi) |
| **Gamma** | ❌ Gamma'da **ochiq (public) API yo'q** — soxta funksiya qilmaymiz | — |
| **OneID / HEMIS** | 🗑 2026-08-27'da UI'dan butunlay olib tashlandi (client yo'q, aloqa yo'q) | — |

**Canva API imkoniyatlari:** status, OAuth link/callback, dizaynlar ro'yxati, import/export (`/api/admin/canva/*`, `requireAdmin`).
**Slides API:** status, link, callback (`/api/admin/google-slides/*`, `requireAdmin`).

## 5. Admin panel (45+ sahifa, `/admin/...`)

**Asosiy:** `dashboard` (Excel import: fan/subtest + pre-check, statistika), `users`, `teachers` (arizalar, approve/reject), `vip`, `audit`, `email-cost`, `mfa`.

**Imtihon boshqaruvi:** `roster` (guruh ro'yxati staging), `scheduler` (imtihon jadvali yechimchi), `seating` (o'rindiq/bilet/check-in), `paper` (QR, packet, chain-of-custody), `scan` (OMR/OCR), `marking` (belgilash kalibrovkasi), `grading` (deterministik baho qoidalari), `board` (ratifikatsiya, ledger), `consideration` (appeal/resit), `command-center` (insidentlar), `reliability`, `security-guard`, `interventions` (aralashuvlar).

**Kontent:** `ai-question-gen` (AI savol generatori), `quiz-deck`, `deck-export`, `presentations`, `sources` (RAG), `resource-reco`.
⚠️ FAQAT API (alohida admin sahifasi YO'Q): `item-bank` (`/api/item-banks*`), `rubric` (`/api/rubrics*`),
`assessment` (`/api/assessment*`), `competency` (`/api/competency*`).
- `resource-reco` (maqola/tavsiya) — faqat admin konsol: tashqi provider API kalitlari
  (env) sozlanmaguncha "not configured" — end-user UI qilmaymiz (bo'sh qobiq = yolg'on feature).
  Kalitlar ulanganda teacher/student panelga chiqarish alohida qaror (BUG-026).

**Integratsiya/observability:** `canva`, `google-slides`, `provider`, `api-contracts`, `observability`, `data-governance`, `institutional`, `program-quality`, `acceptance`, `accessibility`, `multilingual`, `ai-checkpoint`, `ai-grading`, `ai-mlops`, `claude`, `camera-review`, `safe-submit`.

## 6. Asosiy API oilalari

- **Auth:** `/auth/google*`, `/api/auth/*`, `/api/mfa/*`, `/api/passkey/*`, `/api/reset/*`, `/auth/telegram/*`
- **Cast (REST + Socket.io):** `/api/cast/*`, socket: `cast:join`, `cast:answer`, `cast:quickPromptLaunch`, ...
- **AI:** `/api/ai/status`, `/api/ai/generate-questions`
- **Imtihon:** `/api/attempt/*` (lease + server taymeri), `/api/response/*` (ACK + autosave), `/api/submit/*` (muhr + imzolangan receipt), `/api/proctor/*`
- **Admin integratsiya:** `/api/admin/canva/*`, `/api/admin/google-slides/*`
- **PWA/offline:** service worker, IndexedDB journal (`/api/offline/*`), Web Push (`/api/push/*`)
  ⚠️ Push faqat `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env sozlanganda ishlaydi — aks holda
  `push_disabled` (notifications sozlamalarida kanal avtomatik o'chirilgan ko'rinadi)
- **Ochiq ma'lumotlar:** `/api/opendata/*` (statik snapshot — `isLive:false`); Legal: `/privacy`, `/terms`, `/cookies`

To'liq ro'yxat: `routes/` katalogida 80+ fayl — har birining sarlavhasida izoh.

## 7. Xavfsizlik

- Session: `regenerate` (fixation oldini olish), idle-timeout, role-version invalidatsiya, device fingerprint/risk tier
- CSRF token (hamma POST/PUT/PATCH/DELETE), rate limiting, audit log (`audit` admin sahifasi)
- OAuth: PKCE + state, exact redirect-uri tekshiruvi, callback abuse monitoring
- Parollar: argon2id (memory-hard); passkey WebAuthn; email verify + double opt-in email change
- Kirish huquqi: `requireAuth` / `requireAdmin` middleware'lari, rol allowlistlari

## 8. Sifat nazorati (CI)

GitHub Actions'da `npm run design:check:full`:

1. `tokens` — design tokenlar konsistensiyasi
2. `contrast` — 40/40 WCAG kontrast juftligi
3. `lint` — design lint · 4. `perf-budget` — byudjet + route-split · 5. `legacy-usage` — regress yo'q
6. `ejs-compile` — 112 view kompilyatsiya · 7. `axe` — WCAG 2.2 AA (12 test)
8. `visual` — Playwright baseline (5 viewport × 3 mavzu, deterministik)

Vitest: **492 test fayl** — birlik/integratsiya/e2e/xavfsizlik (CSRF, XSS scan, escalation, stuffing).

## 9. Ishga tushirish (lokal)

```bash
npm ci
npm run dev            # yoki: node server.js
```

Muhim env (`.env`): `SESSION_SECRET`, `ADMIN_USER`, `ADMIN_PASS`, `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_DATABASE_URL`, `BASE_URL`.
Ixtiyoriy: `GEMINI_API_KEY`+`GEMINI_MODEL` (AI), `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` (OIDC), `CANVA_CLIENT_ID/SECRET`, `SMTP_*`/`POSTMARK_SERVER_TOKEN` (email), `EMAIL_PROVIDER=smtp|postmark|ses|mock`, `DATABASE_URL` (PostgreSQL, quyida).

### 9.1 PostgreSQL (ixtiyoriy — AI-modul sahifalari uchun)

Admin panelning ayrim modul sahifalari (academic, accessibility, ai-grading /
ai-mlops / ai-question-gen, api-contracts va h.k.) ma'lumotlarni PostgreSQL'da
saqlaydi. `DATABASE_URL` sozlanmasa bu sahifalar cheklangan rejimda ishlaydi
(yozishlar `PostgreSQL required` xatosini qaytaradi), ilovaning qolgan qismi
to'liq ishlaydi.

Ulash (bitta daqiqada, free tier bilan ham):

```bash
# 1) DB — Neon (neon.tech, free) yoki Supabase'dan connection string oling,
#    yoki lokal:
sudo apt install postgresql && sudo -u postgres createdb deborah

# 2) .env ga yozing:
#    DATABASE_URL=postgres://deborah:parol@127.0.0.1:5432/deborah

# 3) Migratsiyalar (55 ta — jadvallar, RBAC, RLS):
npm run db:migrate

# Tekshirish:
npm run db:status
```

Shundan keyin admin paneldagi shu modul sahifalari to'liq ma'lumot
yuklaydi.

## 10. Manzillar (konsollar uchun)

| Konsol | Qiymat |
|---|---|
| Google OAuth redirect | `https://deborah-ncj.onrender.com/auth/google/callback` |
| Google Slides redirect | `https://deborah-ncj.onrender.com/api/admin/google-slides/callback` |
| Canva redirect | `https://deborah-ncj.onrender.com/api/admin/canva/callback` |
| Authorized domain | `deborah-ncj.onrender.com` |

---

*Oxirgi yangilanish: 2026-08-27 · Google OIDC LIVE ✅ · Gemini AI LIVE ✅ · OneID/HEMIS olib tashlandi 🗑*
