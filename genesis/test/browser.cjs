// End-to-end browser test of the built game (dist/index.html) in headless Chromium.
// Usage: NODE_PATH=<dir containing playwright> node test/browser.cjs [outDirForScreenshots]
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const out = process.argv[2] || path.join(__dirname, '..', 'dist');
  const file = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
  const browser = await chromium.launch();
  let failed = 0;
  const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => { const m = e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' '); errs.push(m); console.log('  [page error] ' + m); });
  await page.goto(file);
  await page.waitForFunction('window.genesis && window.genesis.sim', null, { timeout: 60000 });
  check('game boots and generates a world', await page.evaluate(() => genesis.sim.people.size > 100 && genesis.sim.settlements.size > 3));

  // --- time controls ---
  await page.click('#sp0');
  const t0 = await page.evaluate(() => genesis.sim.tick);
  await page.waitForTimeout(500);
  check('pause stops time', (await page.evaluate(() => genesis.sim.tick)) === t0);
  await page.click('#sp4');
  await page.waitForFunction('genesis.sim.tick > 150 * 48', null, { timeout: 300000 });
  const fast = await page.evaluate(() => ({ tps: genesis.tps, pop: genesis.sim.people.size }));
  check('max speed runs the world forward', true, `${Math.round(fast.tps)} ticks/s at ${fast.pop} people`);
  await page.click('#sp2');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '/shot-world.png' });

  // --- frame rate, zoomed out and zoomed in on the busiest town ---
  const fps = async () => page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t > 1500) res(Math.round(n / 1.5)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  const fpsOut = await fps();
  const town = await page.evaluate(() => { let b = null; for (const s of genesis.sim.settlements.values()) if (!b || s.people.length > b.people.length) b = s; genesis.ui.select({ kind: 'settlement', id: b.id, tile: -1 }, true); genesis.renderer.centerOn(b.x, b.y, 4); return { name: b.name, pop: b.people.length, x: b.x, y: b.y }; });
  await page.waitForTimeout(1200);
  const fpsIn = await fps();
  check('renders smoothly', fpsOut >= 20 && fpsIn >= 20, `${fpsOut} fps whole world, ${fpsIn} fps inside ${town.name} (${town.pop} people)`);
  await page.screenshot({ path: out + '/shot-town.png' });

  // --- inspecting: town panel, then a person from it ---
  check('town inspector shows its market', (await page.textContent('#insp-body')).includes('Market'));
  const walkers = await page.evaluate(() => genesis.renderer.walkers.length);
  check('individual people are drawn when zoomed in', walkers > 5, `${walkers} visible`);
  await page.evaluate(() => { const w = genesis.renderer.walkers[0]; genesis.ui.select({ kind: 'person', id: w.id, tile: -1 }); });
  const personTxt = await page.textContent('#insp-body');
  check('person inspector shows a life story', personTxt.includes('Life so far') && personTxt.includes('Temperament'));
  await page.screenshot({ path: out + '/shot-person.png' });
  await page.click('#act-genius');
  check('blessing a person is recorded in history', await page.evaluate(() => genesis.sim.history.some((e) => e.kind === 'miracle')));

  // --- clicking the map picks things ---
  await page.evaluate(() => genesis.ui.select(null));
  const c = await page.evaluate(([x, y]) => genesis.renderer.tileToScreen(x + 0.5, y + 0.5), [town.x, town.y]);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + c.x, box.y + c.y);
  check('clicking a town on the map selects it', (await page.evaluate(() => genesis.ui.sel && genesis.ui.sel.kind)) !== null, await page.evaluate(() => genesis.ui.sel && genesis.ui.sel.kind));

  // --- god powers through the real toolbar ---
  await page.evaluate(() => genesis.renderer.fit());
  await page.waitForTimeout(600);
  // a patch of open sea whose spot on screen is clear of the panels
  const sea = await page.evaluate(() => { const w = genesis.sim.world; for (let i = 0; i < w.n; i += 7) { const x = i % w.w, y = (i / w.w) | 0; if (w.water[i] === 0 || w.elev[i] > 0.34 || w.elev[i] < 0.26) continue; const p = genesis.renderer.tileToScreen(x + 0.5, y + 0.5); if (p.x > 300 && p.x < window.innerWidth - 420 && p.y > 160 && p.y < window.innerHeight - 220) return { i, x, y }; } return null; });
  await page.click('#cat-land');
  await page.click('#tool-raise');
  const sp = await page.evaluate(([x, y]) => genesis.renderer.tileToScreen(x + 0.5, y + 0.5), [sea.x, sea.y]);
  await page.mouse.move(box.x + sp.x, box.y + sp.y);
  await page.mouse.down();
  await page.waitForTimeout(2600);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('Raise tool lifts seabed into land', await page.evaluate((i) => genesis.sim.world.water[i] === 0, sea.i));
  await page.click('#cat-doom');
  await page.click('#tool-meteor');
  const hist0 = await page.evaluate(() => genesis.sim.history.length);
  await page.mouse.click(box.x + sp.x + 60, box.y + sp.y + 10);
  await page.waitForTimeout(300);
  check('Meteor tool strikes', await page.evaluate((h) => genesis.sim.history.length > h && genesis.sim.history.some((e) => e.kind === 'meteor'), hist0));
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + '/shot-meteor.png' });
  await page.keyboard.press('Escape');

  // --- windows ---
  for (const [btn, needle] of [['#btn-chronicle', 'events on record'], ['#btn-nations', 'Nation'], ['#btn-life', 'Create a species'], ['#btn-stats', 'People in the world'], ['#btn-help', 'Getting around']]) {
    await page.click(btn);
    await page.waitForTimeout(250);
    check(`window ${btn} opens`, (await page.textContent('#win-body')).includes(needle));
    if (btn === '#btn-chronicle') await page.screenshot({ path: out + '/shot-chronicle.png' });
    if (btn === '#btn-nations') await page.screenshot({ path: out + '/shot-nations.png' });
  }
  // technology tree via a nation
  await page.evaluate(() => { let b = null; for (const c of genesis.sim.civs.values()) if (c.alive && (!b || c.pop > b.pop)) b = c; genesis.ui.select({ kind: 'civ', id: b.id, tile: -1 }); });
  await page.click('#act-tech');
  await page.waitForTimeout(250);
  check('technology tree opens', (await page.textContent('#win-body')).includes('Agriculture'));
  await page.screenshot({ path: out + '/shot-tech.png' });
  const before = await page.evaluate(() => { const c = genesis.sim.civs.get(genesis.ui.techCiv); return c.tech.filter((t) => t === 1).length; });
  await page.click('.tech:not(.known)');
  const after = await page.evaluate(() => { const c = genesis.sim.civs.get(genesis.ui.techCiv); return c.tech.filter((t) => t === 1).length; });
  check('granting a technology from the tree works', after === before + 1, `${before} → ${after}`);

  // --- map modes ---
  await page.keyboard.press('Escape');
  await page.selectOption('#mapmode', 'political');
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + '/shot-political.png' });
  await page.selectOption('#mapmode', 'normal');

  // --- save, change the world, load: the saved state comes back ---
  await page.click('#btn-world');
  await page.click('#wtab-save');
  await page.waitForSelector('#save-slot1');
  await page.evaluate(() => genesis.setSpeed(0)); // freeze, so the snapshot and the save are the same instant
  const snap = await page.evaluate(() => ({ tick: genesis.sim.tick, pop: genesis.sim.people.size, hist: genesis.sim.history.length }));
  await page.click('#save-slot1');
  await page.waitForFunction(() => document.querySelector('#load-slot1') !== null, null, { timeout: 30000 });
  await page.evaluate(() => { genesis.setSpeed(4); });
  await page.waitForFunction((t) => genesis.sim.tick > t + 200, snap.tick, { timeout: 120000 });
  await page.evaluate(() => genesis.setSpeed(0));
  await page.click('#load-slot1');
  await page.waitForFunction((t) => genesis.sim.tick === t, snap.tick, { timeout: 30000 });
  const back = await page.evaluate(() => ({ tick: genesis.sim.tick, pop: genesis.sim.people.size, hist: genesis.sim.history.length }));
  check('save then load restores the saved moment', back.tick === snap.tick && back.pop === snap.pop && back.hist === snap.hist, JSON.stringify(back));

  // --- new world from the form ---
  await page.click('#btn-world');
  await page.click('#wtab-new');
  await page.fill('#nw-seed', '4242');
  await page.selectOption('#nw-size', '160x100');
  await page.click('#nw-make');
  await page.waitForFunction(() => genesis.sim.world.seed === 4242, null, { timeout: 60000 });
  check('a new world can be created from the form', await page.evaluate(() => genesis.sim.world.w === 160 && genesis.sim.tick < 100));
  check('no script errors on desktop', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();

  // --- phone ---
  const phone = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const perrs = [];
  phone.on('pageerror', (e) => perrs.push(e.message));
  await phone.goto(file);
  await phone.waitForFunction('window.genesis && window.genesis.sim', null, { timeout: 60000 });
  await phone.evaluate(() => genesis.setSpeed(4));
  await phone.waitForFunction('genesis.sim.tick > 60 * 48', null, { timeout: 200000 });
  await phone.evaluate(() => genesis.setSpeed(2));
  await phone.waitForTimeout(1200);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('phone layout does not scroll sideways', !overflow);
  await phone.screenshot({ path: out + '/shot-phone.png' });
  await phone.evaluate(() => { let b = null; for (const s of genesis.sim.settlements.values()) if (!b || s.people.length > b.people.length) b = s; genesis.ui.select({ kind: 'settlement', id: b.id, tile: -1 }, true); });
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: out + '/shot-phone-town.png' });
  check('no script errors on phone', perrs.length === 0, perrs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(failed === 0 ? '\nAll browser checks passed.' : `\n${failed} browser check(s) FAILED.`);
  process.exitCode = failed ? 1 : 0;
})();
