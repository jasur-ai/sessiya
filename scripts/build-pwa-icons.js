#!/usr/bin/env node
/**
 * Build PWA Icons — Generates pwa-icon-{180,192,512}.png from logo-icon.svg
 * Uses sharp for SVG rasterization
 * 
 * Usage:  npm run build:pwa
 * Output: public/images/pwa-icon-{180,192,512}.png
 */

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SVG_PATH = join(ROOT, 'public', 'images', 'logo-icon.svg');
const SIZES = [180, 192, 512];

async function build() {
  console.log('🔨 Building PWA Icons...\n');

  const svgBuffer = await readFile(SVG_PATH);
  console.log(`  Source:  logo-icon.svg (${(svgBuffer.length / 1024).toFixed(1)} KB)`);

  // S34.10: maskable safe area — mark 80% ichida, safe zone'da hech narsa kesilmaydi.
  // Oltin DEBORAH mark variant (logo-icon.svg, 2026-09 qarori).
  // Background: final Ink #241A0C (maskable circle markazida 80% maydon).
  const MASKABLE_PAD = 0.10; // 10% padding har tomonda → mark 80% ichida

  for (const size of SIZES) {
    const target = Math.round(size * (1 - MASKABLE_PAD * 2));
    const pngBuffer = await sharp(svgBuffer)
      .resize(target, target, {
        fit: 'contain',
        kernel: 'lanczos3',
        background: { r: 36, g: 26, b: 12, alpha: 1 }, // Ink #241A0C
      })
      .extend({
        top: Math.round(size * MASKABLE_PAD),
        bottom: Math.round(size * MASKABLE_PAD),
        left: Math.round(size * MASKABLE_PAD),
        right: Math.round(size * MASKABLE_PAD),
        background: { r: 36, g: 26, b: 12, alpha: 1 }, // Ink #241A0C (issiq to'q jigarrang) safe zone
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const outPath = join(ROOT, 'public', 'images', `pwa-icon-${size}.png`);
    await writeFile(outPath, pngBuffer);
    console.log(`  pwa-icon-${size}.png — ${(pngBuffer.length / 1024).toFixed(1)} KB`);
  }

  console.log(`\n  ✅ PWA icons built (maskable-safe, Ink #241A0C bg)`);
}

build().catch(err => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
