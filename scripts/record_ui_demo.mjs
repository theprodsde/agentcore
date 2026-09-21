#!/usr/bin/env node
// Records a UI demo GIF: dashboard → create task → live pipeline → completed detail → memory
// Usage:  node scripts/record_ui_demo.mjs
// Output: .github/assets/ui-demo.gif

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/karangehlod/.local/lib/node_modules/playwright');
import { execSync, spawnSync } from 'child_process';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE       = 'http://localhost:3000';
const FRAMES_DIR = '/tmp/agentcore-frames';
const OUT_GIF    = '.github/assets/ui-demo.gif';
const VIEWPORT   = { width: 1280, height: 800 };

let frameIdx = 0;
async function shot(page, label) {
  const p = join(FRAMES_DIR, `${String(frameIdx++).padStart(4,'0')}-${label}.png`);
  await page.screenshot({ path: p });
  process.stdout.write(`  [${frameIdx}] ${label}\n`);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(FRAMES_DIR, { recursive: true });
// clear leftover frames
readdirSync(FRAMES_DIR).filter(f=>f.endsWith('.png')).forEach(f=>unlinkSync(join(FRAMES_DIR,f)));

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport: VIEWPORT });
const page    = await ctx.newPage();

// ── 1. Dashboard ──────────────────────────────────────────────────────────────
console.log('\n1. Dashboard');
await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(600);
for (let i = 0; i < 4; i++) { await shot(page, 'dashboard'); await wait(350); }

// ── 2. New Task form ──────────────────────────────────────────────────────────
console.log('2. New Task form');
await page.goto(`${BASE}/tasks/new`, { waitUntil: 'networkidle' });
await wait(400);
for (let i = 0; i < 2; i++) { await shot(page, 'new-task'); await wait(300); }

// ── 3. Type the incident goal ────────────────────────────────────────────────
console.log('3. Typing goal');
const goalInput = page.locator('input[placeholder*="Investigate"]');
const goal = 'payments-service p99 latency at 4s after deploy';
for (const ch of goal) {
  await goalInput.type(ch, { delay: 40 });
  if (frameIdx % 7 === 0) await shot(page, 'typing');
}
await wait(250);
await shot(page, 'goal-typed');
await shot(page, 'goal-typed-2');

// ── 4. Submit ────────────────────────────────────────────────────────────────
console.log('4. Submit');
await page.locator('button[type="submit"]').click();
await wait(400);
for (let i = 0; i < 2; i++) { await shot(page, `submitted-${i}`); await wait(300); }

// ── 5. Pipeline running — capture live checkpoint updates ─────────────────────
console.log('5. Live pipeline');
for (let i = 0; i < 22; i++) {
  await shot(page, `running-${i}`);
  await wait(600);
}

// ── 6. Wait for completion ────────────────────────────────────────────────────
console.log('6. Awaiting completion');
try {
  await page.waitForFunction(() =>
    document.body.innerText.toLowerCase().includes('completed') ||
    document.body.innerText.toLowerCase().includes('synthesizer'),
    { timeout: 30000 }
  );
} catch (_) { /* capture whatever state */ }
await wait(400);
for (let i = 0; i < 5; i++) { await shot(page, `completed-${i}`); await wait(500); }

// ── 7. Memory explorer ────────────────────────────────────────────────────────
console.log('7. Memory explorer');
await page.goto(`${BASE}/memory`, { waitUntil: 'networkidle' });
await wait(600);
for (let i = 0; i < 4; i++) { await shot(page, `memory-${i}`); await wait(400); }

await browser.close();

// ── Render GIF ────────────────────────────────────────────────────────────────
const frames = readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).sort();
console.log(`\nRendering GIF from ${frames.length} frames…`);

execSync(
  `ffmpeg -y -framerate 5 -pattern_type glob -i '${FRAMES_DIR}/*.png' ` +
  `-vf "fps=5,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" ` +
  `${OUT_GIF}`,
  { stdio: 'inherit' }
);

const gifsicle = spawnSync('which', ['gifsicle']).status === 0;
if (gifsicle) {
  execSync(`gifsicle -O3 --lossy=80 --colors 128 -o ${OUT_GIF} ${OUT_GIF}`, { stdio: 'inherit' });
  console.log('gifsicle optimisation applied');
}

frames.forEach(f => unlinkSync(join(FRAMES_DIR, f)));
console.log(`\nDone → ${OUT_GIF}`);
