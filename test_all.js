// test_all.js — combined test suite: regression scenarios + all dev-tool demos
const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const path = require('path');

const FILE = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
const results = [];

function pass(name)       { results.push({ name, ok: true });  console.log(`  ✅ ${name}`); }
function fail(name, why)  { results.push({ name, ok: false, why }); console.log(`  ❌ ${name}: ${why}`); }

// ── 1. Regression scenarios (reuse existing runner) ────────────────────────
console.log('\n── Regression Scenarios ──────────────────────────────────────────');
try {
  const out = execSync('node run_regression.js', { cwd: __dirname, timeout: 120000 }).toString();
  const m = out.match(/(\d+)\/(\d+) passed/);
  if (m) {
    const [, ok, total] = m;
    if (ok === total) pass(`Regression scenarios (${ok}/${total})`);
    else              fail(`Regression scenarios`, `only ${ok}/${total} passed`);
    // Pull individual names from the output
    const lines = out.split('\n');
    let inResults = false;
    for (const l of lines) {
      if (l.includes('REGRESSION RESULTS')) { inResults = true; continue; }
      if (!inResults) continue;
      if (l.startsWith('★')) {
        const next = lines[lines.indexOf(l) + 1]?.trim();
        if (next === 'PASS') pass(`  · ${l.trim()}`);
      }
    }
  } else {
    fail('Regression scenarios', 'could not parse output');
  }
} catch (e) {
  fail('Regression scenarios', e.message.slice(0, 80));
}

// ── 2. Demo tests (Playwright) ─────────────────────────────────────────────
console.log('\n── Demo / Dev-Tool Tests ─────────────────────────────────────────');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => console.log('  [JS]', e.message));

  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE);
  await page.waitForTimeout(1500);

  const click  = id  => page.evaluate(id  => document.getElementById(id)?.click(), id);
  const state  = ()  => page.evaluate(() => {
    const g = eval('game');
    return {
      phase:          g.phase,
      dealerSeat:     g.dealerSeat,
      currentSeat:    g.currentSeat,
      handActionCount:g.handActionCount,
      isFirstDealerDraw: g._isFirstDealerDraw,
      lastWinner:     g.lastResult?.winner ?? null,
      lastLabel:      g.lastResult?.label  ?? null,
      lastFaan:       g.lastResult?.faan   ?? null,
      winOpts:        g.claimOptions ? {
        win:           g.claimOptions.win !== false,
        winFaan:       g.claimOptions.win?.faan ?? null,
        winLabel:      g.claimOptions.win?.label ?? null,
        earthly:       !!g.claimOptions._earthlyHand,
        kong:          g.claimOptions.kong !== false,
      } : null,
      robbingKongSeat: g.robbingKongSeat ?? null,
      hand0:           g.players[0].hand.length,
    };
  });

  async function reset() {
    await page.evaluate(() => eval('game').reset());
    await page.waitForTimeout(200);
  }

  // ── Demo Win: cycle through all 4 seats ─────────────────────────────────
  // The button cycles Left(3)→Right(1)→Top(2)→You(0) on each click
  const winSeats = [3, 1, 2, 0];
  const winNames = ['Left (seat 3)', 'Right (seat 1)', 'Top (seat 2)', 'You (seat 0)'];
  for (let i = 0; i < 4; i++) {
    await click('demo-win-btn');
    await page.waitForTimeout(300);
    const s = await state();
    const expected = winSeats[i];
    if (s.lastWinner === expected)
      pass(`Demo Win — ${winNames[i]}`);
    else
      fail(`Demo Win — ${winNames[i]}`, `winner=${s.lastWinner}, expected ${expected}`);
  }

  // ── Demo Heavenly Hand 天胡 ──────────────────────────────────────────────
  await reset();
  await click('demo-heavenly-btn');
  await page.waitForTimeout(400);
  {
    const s = await state();
    if (s.phase === 'claim' && s.winOpts?.win && s.winOpts.winLabel?.includes('Heavenly') && s.hand0 === 14)
      pass('Demo Heavenly Hand 天胡');
    else
      fail('Demo Heavenly Hand 天胡', JSON.stringify({ phase: s.phase, label: s.winOpts?.winLabel, hand0: s.hand0 }));
  }

  // ── Demo Earthly Hand 地胡 ───────────────────────────────────────────────
  await reset();
  await click('demo-earthly-btn');
  await page.waitForTimeout(400);
  {
    const s = await state();
    if (s.phase === 'claim' && s.winOpts?.win && s.winOpts.earthly)
      pass('Demo Earthly Hand 地胡');
    else
      fail('Demo Earthly Hand 地胡', JSON.stringify({ phase: s.phase, win: s.winOpts?.win, earthly: s.winOpts?.earthly }));
  }

  // ── Demo Concealed Kong 暗槓 ─────────────────────────────────────────────
  await reset();
  await click('demo-ckong-btn');
  await page.waitForTimeout(400);
  {
    const s = await state();
    // Hand should have 14 tiles including 4× bamboo-1
    const kongReady = await page.evaluate(() => {
      const h = eval('game').players[0].hand;
      return h.filter(t => t.suit === 'bamboo' && t.value === 1).length;
    });
    if (s.phase === 'discard' && kongReady === 4)
      pass('Demo Concealed Kong 暗槓 (4× bam-1 in hand, phase=discard)');
    else
      fail('Demo Concealed Kong 暗槓', `phase=${s.phase}, bam-1 count=${kongReady}`);
  }

  // ── Demo Last Tile 海底撈月 ──────────────────────────────────────────────
  await reset();
  await click('demo-lasttile-btn');
  // Has a 500ms setTimeout before startTurn — wait for claim phase
  try {
    await page.waitForFunction(() => {
      const g = eval('game');
      return g.phase === 'claim' || g.phase === 'end';
    }, { timeout: 5000 });
    const s = await state();
    if (s.phase === 'claim' && s.winOpts?.win && s.winOpts.winLabel?.includes('Last Tile'))
      pass('Demo Last Tile 海底撈月');
    else
      fail('Demo Last Tile 海底撈月', JSON.stringify({ phase: s.phase, label: s.winOpts?.winLabel }));
  } catch {
    fail('Demo Last Tile 海底撈月', 'timed out waiting for claim phase');
  }

  // ── Demo Rob 搶槓 — 4 variants A/B/C/D ──────────────────────────────────
  const robVariants = [
    { label: 'A — Human robs',  expectHumanWin: true,  expectRobbing: true },
    { label: 'B — AI robs',     expectHumanWin: false, expectRobbing: true },
    { label: 'C — Both can rob',expectHumanWin: true,  expectRobbing: true },
    { label: 'D — Nobody robs', expectHumanWin: false, expectRobbing: true },
  ];
  for (const v of robVariants) {
    await reset();
    await click('demo-rob-btn');
    await page.waitForTimeout(400);
    const s = await state();
    const isRobbing = s.robbingKongSeat !== null;
    const humanCanWin = s.winOpts?.win ?? false;
    if (isRobbing === v.expectRobbing && humanCanWin === v.expectHumanWin)
      pass(`Demo Rob 搶槓 ${v.label}`);
    else
      fail(`Demo Rob 搶槓 ${v.label}`, `robbing=${isRobbing}, humanWin=${humanCanWin}`);
  }

  // ── Test: Rob Win 搶槓胡 (CPU3 robs CPU1's kong) ─────────────────────────
  await reset();
  await click('test-rob-win-btn');
  await page.waitForTimeout(600);
  {
    const s = await state();
    // Should show rob-check claim prompt: robbingKongSeat set, CPU3 pending win
    const pendingRob = await page.evaluate(() => {
      const g = eval('game');
      return g.pendingClaims?.some(c => c.action === 'win' && c.seat === 3) ?? false;
    });
    if (s.robbingKongSeat !== null && pendingRob)
      pass('Test Rob Win 搶槓胡 (CPU3 pending rob)');
    else
      fail('Test Rob Win 搶槓胡', `robbingKongSeat=${s.robbingKongSeat}, pendingRob=${pendingRob}`);
  }

  // ── Test: Kong Completes 槓完 (no rob, game continues) ───────────────────
  await reset();
  await click('test-kong-done-btn');
  await page.waitForTimeout(600);
  {
    // Core check: CPU1's pung of 4-bam was upgraded to a kong
    const cpu1HasKong = await page.evaluate(() => {
      const g = eval('game');
      return g.players[1].melds.some(m =>
        m.type === 'kong' && m.tiles.some(t => t.suit === 'bamboo' && t.value === 4)
      );
    });
    if (cpu1HasKong)
      pass('Test Kong Completes 槓完 (CPU1 pung→kong of 4-bam confirmed)');
    else
      fail('Test Kong Completes 槓完', 'CPU1 does not have kong of 4-bam in melds');
  }

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  const total  = results.length;
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);

  console.log('\n' + '═'.repeat(60));
  console.log(`TOTAL: ${passed}/${total} passed`);
  if (failed.length) {
    console.log('\nFailed:');
    failed.forEach(r => console.log(`  ✗ ${r.name}: ${r.why}`));
  }
  console.log('═'.repeat(60));
  process.exit(failed.length ? 1 : 0);
})();
