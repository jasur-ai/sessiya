// ─────────────────────────────────────────────────────────────
// Brand Asset tests — STYLE STEP 05 (S05.01–S05.12)
// Evidence Mark variants, wordmark lockups, Signal Rail,
// Response Mosaic, alt policy, blind-recognition prototype.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND = join(ROOT, 'public', 'images', 'brand');

const svg = (f) => readFileSync(join(BRAND, f), 'utf8');

describe('STYLE STEP 05 — Brand assets', () => {
  describe('S05.01-02 — Evidence Mark structure', () => {
    it('mark 4 rect (rail + 3 tick) va 2 circle (node + detail) dan iborat', () => {
      const s = svg('evidence-mark.svg');
      expect((s.match(/<rect /g) || []).length).toBe(4);
      expect((s.match(/<circle /g) || []).length).toBe(2);
    });

    it('cobalt variant #1746D1 ishlatadi (final S06.01), gradient yo\'q', () => {
      const s = svg('evidence-mark.svg');
      expect(s).toContain('#1746D1');
      expect(s).not.toMatch(/Gradient/);
      expect(s).not.toMatch(/filter=/);
    });

    it('barcha 4 variant mavjud (cobalt/mono/inverse/high-contrast)', () => {
      for (const f of ['evidence-mark.svg', 'evidence-mark-monochrome.svg', 'evidence-mark-inverse.svg', 'evidence-mark-high-contrast.svg']) {
        expect(existsSync(join(BRAND, f)), f).toBe(true);
      }
    });

    it('monochrome hammasi currentColor', () => {
      const s = svg('evidence-mark-monochrome.svg');
      expect((s.match(/currentColor/g) || []).length).toBeGreaterThanOrEqual(5);
    });

    it('high-contrast alpha >= 0.85 va faqat qora', () => {
      const s = svg('evidence-mark-high-contrast.svg');
      const alphas = [...s.matchAll(/opacity="([0-9.]+)"/g)].map((m) => parseFloat(m[1]));
      expect(alphas.every((a) => a >= 0.85)).toBe(true);
      expect(s).not.toMatch(/#1746D1|#38BDF8|#FFFFFF/);
    });
  });

  describe('S05.03-04 — Wordmark lockups', () => {
    it('horizontal va compact lockup mavjud, Deborah text bilan', () => {
      for (const f of ['wordmark-horizontal.svg', 'wordmark-compact.svg']) {
        const s = svg(f);
        expect(s).toContain('Deborah');
        expect(s).toMatch(/Righteous/);
        expect(s).not.toMatch(/filter=/);
      }
    });
  });

  describe('S05.05-06 — Brand CSS components', () => {
    let css;
    beforeAll(() => {
      css = readFileSync(join(ROOT, 'public', 'design', 'brand.css'), 'utf8');
    });

    it('Signal Rail 4 state (current/live/attention/error)', () => {
      for (const c of ['sr-rail--current', 'sr-rail--live', 'sr-rail--attention', 'sr-rail--error']) {
        expect(css).toContain(c);
      }
      expect(css).toMatch(/width:\s*3px/);
    });

    it('Response Mosaic 5x5 grid + cell state\'lar', () => {
      expect(css).toMatch(/grid-template-columns:\s*repeat\(5,\s*1fr\)/);
      for (const c of ['rm-cell--correct', 'rm-cell--incorrect', 'rm-cell--pending', 'rm-cell--live']) {
        expect(css).toContain(c);
      }
    });

    it('reduced-motion block mavjud (WCAG 2.3.3)', () => {
      expect(css).toMatch(/prefers-reduced-motion: reduce/);
    });
  });

  describe('S05.09-11 — Policy + alt', () => {
    it('logo-icon.svg — oltin DEBORAH favicon (2026-09 qarori: legacy cobalt o\'rniga)', () => {
      const s = readFileSync(join(ROOT, 'public', 'images', 'logo-icon.svg'), 'utf8');
      // Eski ko'k evidence-mark chiqarildi — endi oltin/jigarrang brending
      expect(s).not.toContain('#1746D1');
      expect(s).toMatch(/#E3C98F/); // oltin harf gradienti
      expect(s).toMatch(/#8A6228|#5E4317/); // to'q jigarrang asos
      expect(s).toContain('Deborah');
    });

    it('barcha logo img alt="Deborah" (hech qanday alt="E")', () => {
      const host = readFileSync(join(ROOT, 'views', 'game', 'host.ejs'), 'utf8');
      expect(host).toMatch(/logo-vintage\.png" alt="Deborah"/);
      expect(host).not.toMatch(/alt="E"/);
    });
  });

  describe('S05.12 — Blind-recognition prototype', () => {
    it('gallery.html mavjud, mark/rail/mosaic panellari bor', () => {
      const g = readFileSync(join(ROOT, 'public', 'brand', 'gallery.html'), 'utf8');
      expect(g).toContain('evidence-mark.svg');
      expect(g).toContain('sr-rail');
      expect(g).toContain('rm-mosaic');
      expect(g).toContain('Blind Recognition');
    });
  });

  describe('S05.01 — Validator', () => {
    it('validate-brand-assets.js exit 0', () => {
      const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'validate-brand-assets.js')], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(out).toContain('valid');
    });
  });
});
