// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Practice round through the visible setup buttons and keeps orbiting the camera with real
// mouse drags on the canvas (and asking for hints), so the room, items, motes, flame, pendulum and the
// post chain render continuously from changing viewpoints. A new round starts if one ends.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const active = (page) => page.evaluate(() => {
  const b = document.getElementById('btn-pause');
  return !!(b && !b.hidden && document.getElementById('overlay-root').hidden);
});

export async function setPreset(page, preset) {
  await page.waitForSelector('#overlay-root button[data-act="practice"]', { timeout: 20000 });
  await page.locator('#btn-settings').click();
  await page.waitForSelector('#overlay-root #gfx-section #set-quality');
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.locator('#overlay-root button[data-act="done"]').click();
  await page.waitForSelector('#overlay-root button[data-act="practice"]');
}

async function startRound(page) {
  if (await page.locator('#overlay-root button[data-act="menu"]').count()) {
    await page.locator('#overlay-root button[data-act="menu"]').first().click();
    if (await page.locator('#overlay-root button[data-act="menu"]').count()) await page.locator('#overlay-root button[data-act="menu"]').first().click();
  }
  await page.locator('#overlay-root button[data-act="practice"]').click();
  await page.locator('#overlay-root button[data-act="go"]').click();
  await page.locator('#overlay-root button[data-act="go"]').click();
  await page.waitForFunction(() => {
    const b = document.getElementById('btn-pause');
    return b && !b.hidden && document.getElementById('overlay-root').hidden;
  }, null, { timeout: 15000 });
}

async function orbit(page, n) {
  const box = await page.locator('#overlay-root').evaluate(() => {
    const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const dir = n % 2 ? 1 : -1;
  const x0 = box.x + box.w * 0.5, y0 = box.y + box.h * 0.45;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + dir * i * box.w * 0.012, y0 + Math.sin(i / 3) * 6);
  await page.mouse.up();
}

export async function start(page) {
  await startRound(page);
  let open = true, n = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        if (!(await active(page))) await startRound(page);
        await orbit(page, n++);
        if (n % 6 === 0 && await page.locator('#btn-hint').isVisible()) await page.locator('#btn-hint').click({ timeout: 2000 });
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(150).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
