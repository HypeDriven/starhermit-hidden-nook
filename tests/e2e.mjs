/**
 * Hidden Nook — automated QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → practice setup (easy, fixed seed) → round setup → countdown →
 *   active play → pause/resume → settings open/close → hint/undo/reset-view →
 *   find every requested object → results breakdown → progression → title.
 *
 * Finds are performed through the visible UI: taps on the WebGL canvas at the
 * item's projected screen position (primary input) with the keyboard fallback
 * (Arrow keys cycle focus, Enter selects) when a tap misses. Game state is read
 * only for synchronization/positioning (DOM HUD + window.__hnRenderer), never
 * mutated. The right-rail "Scene objects" DOM list is hidden on portrait
 * mobile, so canvas/keyboard input is used uniformly on both viewports.
 *
 * Two passes: desktop 1280x800, then a fresh context at 390x844 (hasTouch).
 * Page errors and non-benign console errors fail the run.
 *
 * Note: the game is fully playable offline solo (practice/journey/learn); the
 * StarHermit backend (server.js) only adds daily/leaderboard/cloud-save and is
 * not used here — this test embeds its own static file server.
 *
 * Run: npm run test:e2e
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/hidden-nook-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader console noise (from tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ts': 'application/typescript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const full = path.normalize(path.join(ROOT, rel));
      if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const overlayHeading = (page) => page.locator('#overlay-root:not([hidden]) h2').first();
const foundCount = (page) => page.locator('#hud-progress').textContent()
  .then((t) => Number((t || '').split('/')[0].trim()) || 0);

async function waitActive(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('btn-pause');
    return b && !b.hidden && document.getElementById('overlay-root').hidden;
  }, null, { timeout: 15000 });
}

// Read current-wave requested-but-unfound chips and the name→index map from the DOM.
function readTargets(page) {
  return page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('#request-strip li'))
      .map((li) => li.getAttribute('aria-label') || '');
    const pending = chips.filter((l) => l.endsWith('not found')).map((l) => l.replace(/, not found$/, ''));
    const map = {};
    for (const b of document.querySelectorAll('#sr-target-list button')) {
      const label = (b.getAttribute('aria-label') || '').replace(/, found$/, '');
      map[label] = Number(b.dataset.index);
    }
    const overlay = document.getElementById('overlay-root');
    return { pending, map, overlayOpen: !overlay.hidden, heading: overlay.querySelector('h2')?.textContent || '' };
  });
}

// Project an item's world position to client pixel coords (state read only).
function itemScreenPoint(page, index) {
  return page.evaluate((idx) => {
    const r = window.__hnRenderer;
    const v = r && r.itemViews.get(idx);
    if (!v) return null;
    const p = v.group.position.clone();
    p.y += 0.3; // aim at the mesh body, not the ground anchor
    p.project(r.camera);
    if (p.z > 1) return null; // behind camera
    const rect = r.canvas.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - (p.y + 1) / 2)) * rect.height };
  }, index);
}

// Keyboard fallback: cycle focus with Arrow keys until the target item is
// focused, then select it with Enter — all real key presses.
async function findViaKeyboard(page, index) {
  for (let k = 0; k < 24; k++) {
    const focus = await page.evaluate(() => window.__hnRenderer.focusIndex);
    if (focus === index) break;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
  }
  const focus = await page.evaluate(() => window.__hnRenderer.focusIndex);
  if (focus !== index) throw new Error(`keyboard focus never reached item ${index} (stuck at ${focus})`);
  await page.keyboard.press('Enter');
}

async function playRound(page, vp) {
  const deadline = Date.now() + 60000;
  let canvasTaps = 0;
  let keyboardFinds = 0;
  while (Date.now() < deadline) {
    const t = await readTargets(page);
    if (t.overlayOpen && /Nook cleared|Time ran out|Out of taps|Round over/.test(t.heading)) break;
    if (!t.pending.length) { await page.waitForTimeout(200); continue; }
    const name = t.pending[0];
    const idx = t.map[name];
    if (idx == null) throw new Error(`no scene object matches request chip "${name}"`);
    const before = await foundCount(page);
    let done = false;
    const pt = await itemScreenPoint(page, idx);
    if (pt) {
      await page.mouse.click(pt.x, pt.y); // real canvas tap (tap = quick pointerdown/up, no drag)
      await page.waitForTimeout(300);
      done = (await foundCount(page)) > before;
      if (done) canvasTaps++;
    }
    if (!done) {
      await findViaKeyboard(page, idx);
      await page.waitForTimeout(250);
      done = (await foundCount(page)) > before;
      if (!done) throw new Error(`could not find "${name}" via canvas tap or keyboard`);
      keyboardFinds++;
    }
  }
  console.log(`  found via canvas tap: ${canvasTaps}, via keyboard: ${keyboardFinds}`);
  await overlayHeading(page).waitFor({ timeout: 15000 });
}

async function runPass(browser, vpName, contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (browserNoise.test(m.text())) return;
    // Platform.syncTime() probes /api/v1/* on boot and falls back to offline
    // mode by design; the static test server has no API, so the browser logs
    // the probe's 404 as a resource error. Benign.
    if ((m.location()?.url || '').includes('/api/')) return;
    errors.push(`console: ${m.text()} (${m.location()?.url || 'no-url'})`);
  });
  page.on('response', (r) => { if (r.status() >= 400) console.log(`  http ${r.status()} ${r.url()}`); });
  const step = async (name, fn) => { await fn(); console.log(`ok - [${vpName}] ${name}`); };

  try {
    await step('load → title screen visible', async () => {
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
      await overlayHeading(page).waitFor({ timeout: 15000 });
      const heading = await overlayHeading(page).textContent();
      if (!/Hidden Nook/.test(heading)) throw new Error(`unexpected overlay heading: ${heading}`);
      await page.screenshot({ path: SHOT('title', vpName) });
    });

    await step('practice setup (easy, fixed seed)', async () => {
      await page.locator('#overlay-root button[data-act="practice"]').click();
      await page.waitForSelector('#overlay-root #pf-diff');
      await page.selectOption('#pf-diff', 'easy');
      await page.locator('#pf-seed').fill('424242');
      await page.screenshot({ path: SHOT('practice-setup', vpName) });
      await page.locator('#overlay-root button[data-act="go"]').click();
    });

    await step('round setup → begin → countdown → active', async () => {
      await page.waitForSelector('#overlay-root button[data-act="go"]');
      await page.screenshot({ path: SHOT('round-setup', vpName) });
      await page.locator('#overlay-root button[data-act="go"]').click();
      await waitActive(page);
      const total = await page.locator('#request-strip li').count();
      if (total < 1) throw new Error('request strip is empty after round start');
      await page.screenshot({ path: SHOT('active', vpName) });
    });

    await step('pause → resume', async () => {
      await page.keyboard.press('Escape');
      await page.waitForSelector('#overlay-root:not([hidden])');
      if (!/Paused/.test(await overlayHeading(page).textContent())) throw new Error('pause overlay missing');
      await page.screenshot({ path: SHOT('paused', vpName) });
      await page.locator('#overlay-root button[data-act="resume"]').click();
      await waitActive(page);
    });

    // Settings opened from the PAUSE menu must return to the pause menu via
    // Done (regression coverage: Done used to call Game.pause(), which
    // early-returned while already paused and dead-ended on the settings panel).
    await step('settings from pause menu → Done returns to pause → resume', async () => {
      await page.keyboard.press('Escape');
      await page.waitForSelector('#overlay-root:not([hidden])');
      await page.locator('#overlay-root button[data-act="settings"]').click();
      await page.waitForSelector('#overlay-root #set-quality');
      await page.selectOption('#set-quality', 'low'); // exercise a real settings change
      await page.screenshot({ path: SHOT('settings', vpName) });
      await page.locator('#overlay-root button[data-act="done"]').click();
      await page.waitForSelector('#overlay-root button[data-act="resume"]');
      if (!/Paused/.test(await overlayHeading(page).textContent())) {
        throw new Error('settings Done did not return to the pause menu');
      }
      await page.locator('#overlay-root button[data-act="resume"]').click();
      await waitActive(page);
    });

    await step('hint + reset view controls work', async () => {
      const hintBtn = (await page.locator('#btn-hint').isVisible()) ? '#btn-hint' : '#tray-hint';
      await page.locator(hintBtn).click();
      await page.waitForTimeout(250);
      const camBtn = (await page.locator('#btn-cam').isVisible()) ? '#btn-cam' : '#tray-cam';
      await page.locator(camBtn).click();
    });

    await step('undo restores a found object (practice allows undo)', async () => {
      await playOneFind(page);
      const afterFind = await foundCount(page);
      if (afterFind !== 1) throw new Error(`expected 1 found, got ${afterFind}`);
      // On portrait mobile the action row is hidden by responsive design;
      // undo is then available via the documented "U" key (see Help screen).
      if (await page.locator('#btn-undo').isVisible()) await page.locator('#btn-undo').click();
      else await page.keyboard.press('u');
      await page.waitForTimeout(300);
      const afterUndo = await foundCount(page);
      if (afterUndo !== 0) throw new Error(`undo did not restore (found=${afterUndo})`);
      await page.screenshot({ path: SHOT('undo', vpName) });
    });

    await step('play to completion through canvas taps + keyboard', async () => {
      await playRound(page, vpName);
      await page.screenshot({ path: SHOT('cleared', vpName) });
    });

    await step('results screen with score breakdown', async () => {
      const heading = await overlayHeading(page).textContent();
      if (!/Nook cleared!/.test(heading)) throw new Error(`unexpected results heading: ${heading}`);
      const rows = await page.locator('#overlay-root .hn-score-table tr').count();
      if (rows < 6) throw new Error(`expected score breakdown rows, got ${rows}`);
      const total = await page.locator('#overlay-root .hn-score-table .total td:last-child').textContent();
      console.log(`  results: ${heading.trim()} total=${total.trim()}`);
      await page.screenshot({ path: SHOT('results', vpName) });
    });

    await step('menu → progression → back to title', async () => {
      await page.locator('#overlay-root button[data-act="menu"]').click();
      await page.waitForSelector('#overlay-root:not([hidden])');
      if (!/Progress/.test(await overlayHeading(page).textContent())) throw new Error('progression overlay missing');
      await page.screenshot({ path: SHOT('progression', vpName) });
      await page.locator('#overlay-root button[data-act="menu"]').click();
      await page.waitForSelector('#overlay-root button[data-act="practice"]');
      if (!/Hidden Nook/.test(await overlayHeading(page).textContent())) throw new Error('did not return to title');
      await page.screenshot({ path: SHOT('back-to-title', vpName) });
    });
  } finally {
    await context.close();
  }

  if (errors.length) {
    throw new Error(`[${vpName}] page errors:\n` + errors.join('\n'));
  }
}

// One find via canvas tap (keyboard fallback) for the undo exercise.
async function playOneFind(page) {
  const t = await readTargets(page);
  const name = t.pending[0];
  const idx = t.map[name];
  const pt = await itemScreenPoint(page, idx);
  if (pt) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300);
  }
  if ((await foundCount(page)) === 0) {
    await findViaKeyboard(page, idx);
    await page.waitForTimeout(300);
  }
}

const server = await serve();
const PORT = server.address().port;
let browser = null;
let failed = false;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } });
  await runPass(browser, 'mobile', {
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
} catch (e) {
  failed = true;
  console.error('E2E FAIL:', e && e.message || e);
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed) process.exit(1);
console.log('\nE2E PASS — hidden-nook playable end-to-end on desktop and mobile, no page errors');
