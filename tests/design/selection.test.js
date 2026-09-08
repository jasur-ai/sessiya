// ── STYLE STEP 14 — Radio/checkbox/switch/selectable-card/tabs/accordion ──
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const root = process.cwd();
const rd = (p) => readFileSync(join(root, p), 'utf8');

const selCss = rd('public/design/components/selection.css');
const tabsCss = rd('public/design/components/tabs.css');
const accCss = rd('public/design/components/accordion.css');
const tabsJs = rd('public/js/components/tabs.js');
const accJs = rd('public/js/components/accordion.js');
const head = rd('views/partials/head.ejs');
const panel = rd('views/user/panel.ejs');
const landingHow = rd('views/partials/landing-how.ejs');
const landingJs = rd('public/js/landing.js');
const dev = rd('views/dev/components.ejs');
const bodyCss = selCss.replace(/\/\*[\s\S]*?\*\//g, '');

describe('S14.01-03: selection anatomy + selected state', () => {
  it('radio/checkbox hidden native input + custom marker', () => {
    expect(bodyCss).toMatch(/\.choice__input/);
    expect(bodyCss).toMatch(/appearance:\s*none|position:\s*absolute/);
    expect(bodyCss).toMatch(/\.choice__mark/);
  });

  it('2px cobalt selected border (no scale animation)', () => {
    expect(bodyCss).toMatch(/border:\s*2px solid var\(--deborah-semantic-color-action-primary\)|border-color:\s*var\(--deborah-semantic-color-action-primary\)/);
    expect(bodyCss).not.toMatch(/transform:\s*scale|scale\s*:\s*[0-9]/);
  });

  it('selected uses :checked state, not aria-checked hack', () => {
    expect(bodyCss).toMatch(/:checked/);
  });
});

describe('S14.04-05: disabled + forced-colors', () => {
  it('disabled has inline explanation (not opacity-only)', () => {
    expect(bodyCss).toMatch(/aria-describedby|\.choice__disabled-note/);
    expect(bodyCss).not.toMatch(/\[disabled\]\s*\{\s*opacity/);
  });

  it('forced-colors system color support', () => {
    expect(bodyCss).toMatch(/@media \(forced-colors: active\)/);
    expect(bodyCss).toMatch(/system-color|Canvas|Highlight/);
  });
});

describe('S14.06: switch pending status', () => {
  it('has is-pending state with non-destructive appearance', () => {
    expect(bodyCss).toMatch(/\.switch\.is-pending/);
  });

  it('has JS driver for pending/rollback UX', () => {
    const switchJs = rd('public/js/components/switch.js');
    expect(switchJs).toMatch(/is-pending/);
    expect(switchJs).toMatch(/data-pending-switch/);
    expect(switchJs).toMatch(/disabled = true/);
  });

  it('head.ejs wires switch.js', () => {
    expect(head).toContain('components/switch.js');
  });
});

describe('S14.07-08: tabs pattern', () => {
  it('tablist/tab/tabpanel roles + aria-selected in tabs.css', () => {
    expect(tabsCss).toMatch(/\.tablist/);
    expect(tabsCss).toMatch(/\.tabpanel/);
    expect(tabsCss).toMatch(/aria-selected/);
  });

  it('JS: arrow-nav, Home/End, click handler, no auto-rotate', () => {
    expect(tabsJs).toMatch(/ArrowLeft|ArrowRight/);
    expect(tabsJs).toMatch(/Home|End/);
    expect(tabsJs).toMatch(/addEventListener\('click'/);
    expect(tabsJs).not.toMatch(/setInterval|autoRotate|auto-rotate/);
  });

  it('focus/selection separated: roving tabindex in JS', () => {
    expect(tabsJs).toMatch(/tabindex/);
  });
});

describe('S14.09-10: accordion pattern', () => {
  it('JS uses aria-expanded + aria-controls, button not div', () => {
    expect(accJs).toMatch(/aria-expanded/);
    expect(accJs).toMatch(/aria-controls/);
    expect(accJs).toMatch(/button/i);
  });

  it('no div[onclick] accordion remains in any view', () => {
    const views = ['views/user/panel.ejs', 'views/partials/landing-how.ejs', 'views/dev/components.ejs'];
    for (const v of views) {
      const c = rd(v);
      expect(c).not.toMatch(/<div[^>]*onclick=[^>]*acc/i);
    }
  });

  it('grid-rows motion 180-220ms + reduced-motion instant', () => {
    expect(accCss).toMatch(/grid-template-rows/);
    expect(accCss).toMatch(/200ms|180ms/);
    expect(accCss).toMatch(/prefers-reduced-motion/);
  });
});

describe('S14.11: selectable card', () => {
  it('full-card label + marker + no nested interactive', () => {
    expect(bodyCss).toMatch(/\.select-card/);
    const cardBlocks = dev.match(/<label class="select-card">[\s\S]*?<\/label>/g) || [];
    expect(cardBlocks.length).toBeGreaterThan(0);
    for (const b of cardBlocks) expect(b).not.toMatch(/<a\b|<button\b/);
  });
});

describe('S14.12: integration + migrations', () => {
  it('head.ejs imports all selection/tabs/accordion assets', () => {
    for (const c of ['selection.css', 'tabs.css', 'accordion.css', 'components/tabs.js', 'components/accordion.js']) {
      expect(head).toContain(c);
    }
  });

  it('panel.ejs accordions use button + aria-expanded', () => {
    // S26.09: Mock/PRE accordionlar olib tashlandi — section modelga o'tildi
    // (hierarxiya accordion talab qilmaydi). Open/close holati yo'q.
    expect(panel).not.toMatch(/toggleAcc\(/);
    expect(panel).not.toMatch(/acc-header/);
    // 09/2026: metrics/VIP/upgrade demolari olib tashlandi — kutubxona modeli
    // Natija: qidiruv + testlar kutubxonasi sectionlari
    expect(panel).toMatch(/ws-search/);
    expect(panel).toMatch(/ws-lib-list/);
  });

  it('landing-how tabs wired to tabs.js (tablist/tabpanel ids)', () => {
    expect(landingHow).toMatch(/role="tablist"/);
    expect(landingHow).toMatch(/role="tabpanel"/);
    expect(landingHow).toMatch(/aria-controls/);
  });

  it('landing.js no longer double-handles tabs', () => {
    expect(landingJs).not.toMatch(/querySelectorAll\('\[data-how-tab\]'\)/);
  });

  it('dev preview renders all new components', () => {
    expect(dev).toMatch(/select-card/);
    expect(dev).toMatch(/role="tablist"/);
    expect(dev).toMatch(/accordion/);
    expect(dev).toMatch(/switch/);
  });
});
