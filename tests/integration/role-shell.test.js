/**
 * Deborah — Role-Aware Shell (integration/contract, Prompt 68)
 *
 * HTTP integration against the real Express app:
 *   - Kritik bug regression: views/partials/sidebar.ejs mavjud bo'lmagani
 *     uchun 7 ta admin view (sources, presentation, intervention,
 *     resource-reco, ai-grading, ai-mlops, question-gen) render'da qulardi.
 *     Endi sidebar partial mavjud → ular 200 qaytaradi.
 *   - Role workspace route'lar: /teacher, /proctor, /marker, /board, /student
 *     — admin bypass, stealth 404 (rolsiz), unauthenticated redirect.
 *   - Sidebar HTML: skip-link, aria-label, role nav.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;
let agent;
let csrfToken;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  app = result.app;
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));

  const supertest = (await import('supertest')).default;
  agent = supertest.agent(app);

  // Admin login (CSRF + session agent)
  const page = await agent.get('/admin/login');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  await agent.post('/admin/login').type('form').send({
    username: CONFIG.ADMIN_USER,
    password: CONFIG.ADMIN_PASS,
    _csrf: m ? m[1] : '',
  });
  const dash = await agent.get('/admin/dashboard');
  const t = dash.text.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  csrfToken = t ? t[1] : '';
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  restoreDb();
});

// ═══════════════════════════════════════════════════════════════════
// KRITIK BUG REGRESSION — 7 ta buzilgan admin view
// (views/partials/sidebar.ejs yo'q edi → EJS include xatosi)
// ═══════════════════════════════════════════════════════════════════

describe('sidebar partial — 7 broken admin views now render (regression fix)', () => {
  const PAGES = [
    ['/admin/sources', 'Source Packs'],
    ['/admin/presentations', 'Presentation'],
    ['/admin/interventions', 'Intervention'],
    ['/admin/resource-reco', 'Resource'],
    ['/admin/ai-grading', 'AI Grading'],
    ['/admin/ai-mlops', 'AI MLOps'],
    ['/admin/ai-question-gen', 'Question Gen'],
  ];

  for (const [path, label] of PAGES) {
    it(`GET ${path} → 200 (sidebar partial mavjud)`, async () => {
      const res = await agent.get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain('shell-sidebar');
      expect(res.text).toContain('skip-link');
    });
  }

  it('renders the shared role shell with skip-link and nav', async () => {
    const res = await agent.get('/admin/sources');
    expect(res.text).toContain('href="#main-content" class="skip-link"');
    expect(res.text).toContain('role="navigation"');
    expect(res.text).toContain('aria-label="Asosiy navigatsiya"');
    expect(res.text).toContain('shell-nav-link');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ROLE WORKSPACE ROUTES
// ═══════════════════════════════════════════════════════════════════

describe('role workspace routes — access control', () => {
  it('admin can open every role workspace (superuser bypass)', async () => {
    for (const path of ['/teacher', '/student', '/proctor', '/marker', '/board']) {
      const res = await agent.get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain('shell-sidebar');
      expect(res.text).toContain('skip-link');
    }
  });

  it('unauthenticated user is redirected to /user/login', async () => {
    const anon = (await import('supertest')).default(app);
    for (const path of ['/teacher', '/proctor', '/marker', '/board']) {
      const res = await anon.get(path);
      expect([302, 401]).toContain(res.status);
    }
  });

  it('renders teacher workspace with role tabs', async () => {
    const res = await agent.get('/teacher');
    expect(res.text).toContain('O\'qituvchi ish maydoni');
    expect(res.text).toContain('role-tabs');
    expect(res.text).toContain("Umumiy ko'rinish"); // BUG-034: EN tab olib tashlandi
  });

  it('renders student dashboard without calendar/assignments tabs', async () => {
    const res = await agent.get('/student');
    expect(res.text).toContain('Talaba ish maydoni');
    expect(res.text).toContain('role-card'); // quick-card dashboard
    // Kalendar butunlay olib tashlandi (nav + tab + placeholder)
    expect(res.text).not.toContain('Kalendar');
    expect(res.text).not.toContain('tab=assignments');
  });

  it('does not leak secret DTOs (password hash / tokens) into role pages', async () => {
    for (const path of ['/teacher', '/proctor', '/marker', '/board', '/student']) {
      const res = await agent.get(path);
      expect(res.status).toBe(200);
      // No password hashes or plaintext secrets rendered
      expect(res.text).not.toMatch(/\$argon2/i);
      expect(res.text).not.toMatch(/SESSION_SECRET|ADMIN_PASS/i);
    }
  });
});
