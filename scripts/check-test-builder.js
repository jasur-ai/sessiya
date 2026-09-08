#!/usr/bin/env node
/**
 * STEP 27 — Test Builder professional authoring workspace validator (S27.01-12)
 * Run: node scripts/check-test-builder.js
 */
import { readFileSync, existsSync } from 'fs';

let fails = 0;
const ok = (msg) => console.log('✅ ' + msg);
const bad = (msg) => { console.log('❌ ' + msg); fails++; };

if (!existsSync('views/user/create-test.ejs')) { console.log('❌ views/user/create-test.ejs yo‘q'); process.exit(1); }
const view = readFileSync('views/user/create-test.ejs', 'utf8');
const css = readFileSync('public/design/contexts/test-builder.css', 'utf8');
const js = readFileSync('public/js/test-builder.js', 'utf8');
const routes = readFileSync('routes/user.js', 'utf8');

console.log('STEP 27 — Test Builder');

// ── S27.01: sticky top bar (Back, editable title, save status, Preview, Save) ──
console.log('— S27.01 sticky top bar');
for (const [label, needle] of [
  ['topbar', 'tb-topbar'],
  ['back', 'tb-back'],
  ['editable title', 'tb-name'],
  ['save status', 'tb-status'],
  ['preview', 'tb-preview-btn'],
  ['save', 'tb-save-btn'],
]) {
  if (!view.includes(needle)) bad(`S27.01: ${label} yo‘q (${needle})`);
  else ok(`S27.01: ${label} mavjud`);
}
if (!js.includes("state.saveStatus")) bad('S27.01: save status state yo‘q');
else ok('S27.01: save status state mavjud');

// ── S27.02: outline + editor (desktop 2-column, 720px editor) ──
console.log('— S27.02 outline + editor');
for (const [label, needle] of [['outline', 'tb-outline'], ['editor', 'tb-editor']]) {
  if (!view.includes(needle)) bad(`S27.02: ${label} yo‘q (${needle})`);
  else ok(`S27.02: ${label} mavjud`);
}
if (!css.includes('@media (min-width: 901px)')) bad('S27.02: desktop media query yo‘q');
else ok('S27.02: desktop media query mavjud');

// ── S27.03: labeled fields (type, stem, options, correct, explanation, tags, timing) ──
console.log('— S27.03 labeled fields');
for (const [label, needle] of [
  ['type select', 'tb-q-type'],
  ['stem', 'tb-q-text'],
  ['options', 'tb-opt'],
  ['correct', 'tb-correct'],
  ['explanation', 'tb-q-exp'],
  ['tags', 'tb-q-tags'],
  ['timing', 'tb-q-timing'],
]) {
  if (!js.includes(needle)) bad(`S27.03: ${label} maydoni yo‘q (${needle})`);
  else ok(`S27.03: ${label} mavjud`);
}

// ── S27.04: native radio correct answer ──
console.log('— S27.04 native radio correct');
if (!js.includes('role="radiogroup"')) bad('S27.04: radiogroup yo‘q');
else ok('S27.04: radiogroup mavjud');
if (!js.includes('type="radio"')) bad('S27.04: native radio input yo‘q');
else ok('S27.04: native radio input mavjud');

// ── S27.05: duplicate/delete in overflow + confirm ──
console.log('— S27.05 overflow actions');
if (!js.includes('tb-q-overflow-btn')) bad('S27.05: overflow button yo‘q');
else ok('S27.05: overflow button mavjud');
for (const act of ['duplicate', 'delete']) {
  if (!js.includes(`data-act="${act}"`)) bad(`S27.05: overflow action "${act}" yo‘q`);
  else ok(`S27.05: overflow "${act}" mavjud`);
}
if (!js.includes('showConfirm')) bad('S27.05: delete confirm yo‘q');
else ok('S27.05: delete confirm mavjud');

// ── S27.06: reorder — drag handle + move up/down keyboard buttons ──
console.log('— S27.06 reorder');
for (const dir of ['up', 'down']) {
  if (!js.includes(`data-move="${dir}"`)) bad(`S27.06: move ${dir} yo‘q`);
  else ok(`S27.06: move ${dir} mavjud`);
}
if (!js.includes('tb-move')) bad('S27.06: move button class yo‘q');
else ok('S27.06: move button mavjud');

// ── S27.07: autosave debounce + statuses (pending/saved/offline/error) ──
console.log('— S27.07 autosave statuses');
for (const st of ['saved', 'pending', 'error', 'offline']) {
  if (!js.includes(`'${st}'`)) bad(`S27.07: "${st}" status yo‘q`);
  else ok(`S27.07: "${st}" status mavjud`);
}
if (!js.includes('navigator.onLine')) bad('S27.07: onLine check yo‘q');
else ok('S27.07: onLine check mavjud');

// ── S27.08: field validation + error summary + outline invalid marker ──
console.log('— S27.08 validation');
for (const needle of ['function validate(', 'tb-err-summary', 'is-invalid']) {
  if (!js.includes(needle)) bad(`S27.08: ${needle} yo‘q`);
  else ok(`S27.08: ${needle} mavjud`);
}

// ── S27.09: Excel import modal (template/upload/parse/errors/preview/confirm) ──
console.log('— S27.09 import modal');
for (const [label, needle] of [
  ['modal', 'tb-import-modal'],
  ['single-panel stage', 'data-import-stage'],
  ['template', 'tb-template-btn'],
  ['confirm', 'tb-import-confirm'],
  ['preview', 'tb-import-preview'],
  ['row errors', 'rowErrors'],
  ['cancel btn', 'tb-import-cancel'],
]) {
  if (!view.includes(needle) && !js.includes(needle)) bad(`S27.09: ${label} yo‘q (${needle})`);
  else ok(`S27.09: ${label} mavjud`);
}

// ── S27.10: SVG icons, no emoji buttons ──
console.log('— S27.10 svg icons');
if (!view.includes("icon('") && !js.includes('icon(')) bad('S27.10: icon() sistemasi yo‘q');
else ok('S27.10: icon() SVG sistemasi mavjud');
if (!/[\u{1F300}-\u{1FAFF}]/u.test(view + js)) ok('S27.10: emoji yo‘q');
else bad('S27.10: emoji topildi (SVG ga almashtirilishi kerak)');

// ── S27.11: mobile — outline drawer + safe-area sticky save ──
console.log('— S27.11 mobile');
if (!css.includes('@media (max-width: 640px)')) bad('S27.11: mobile media query yo‘q');
else ok('S27.11: mobile media query mavjud');
if (!css.includes('env(safe-area-inset-bottom')) bad('S27.11: safe-area yo‘q');
else ok('S27.11: safe-area mavjud');
if (!css.includes('.tb-outline.is-open')) bad('S27.11: mobile outline drawer yo‘q');
else ok('S27.11: mobile outline drawer mavjud');

// ── S27.12: unsaved guard + offline recovery ──
console.log('— S27.12 guards');
if (!js.includes('beforeunload')) bad('S27.12: beforeunload guard yo‘q');
else ok('S27.12: beforeunload guard mavjud');
if (!js.includes('guardUnload')) bad('S27.12: guardUnload yo‘q');
else ok('S27.12: guardUnload mavjud');

// ── Save endpoint S27 fields (explanation/tags/timing) ──
console.log('— Save endpoint draft fields');
for (const f of ['explanation', 'tags', 'timing']) {
  if (!routes.includes(f)) bad(`API: save "${f}" field persiste qilinmaydi`);
  else ok(`API: save "${f}" persiste qilinadi`);
}

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 27 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
