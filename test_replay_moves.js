// test_replay_moves.js — Test the new moves[] based deterministic replay
// Verifies: moves[] and log[] are saved, replay uses _moveQueue, no validation errors.
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  await page.goto(FILE);
  await page.waitForTimeout(800);

  const gs = () => page.evaluate(() => ({
    phase:        window.game?.phase,
    currentSeat:  window.game?.currentSeat,
    claimOptions: !!window.game?.claimOptions,
    moves:        window.game?._captureMoves?.length ?? 0,
    valErr:       window.game?.lastValidationError ?? null,
  }));

  // ── Step 1: play game 1 with human seat driven programmatically ─────────────
  console.log('Step 1: playing game 1 (human seat driven, capturing moves[])...');
  await page.evaluate(() => { window.AUTO_MODE = null; });

  let handDone = false;
  const MAX_ACTIONS = 600;
  let actions = 0;

  while (!handDone && actions < MAX_ACTIONS) {
    await page.waitForFunction(
      () => {
        const g = window.game;
        if (!g) return false;
        if (g.phase === 'end') return true;
        if (g.phase === 'discard' && g.currentSeat === 0) return true;
        if (g.phase === 'claim' && g.claimOptions) return true;
        return false;
      },
      { timeout: 10000 }
    ).catch(() => {});

    const s = await gs();
    if (s.phase === 'end') { handDone = true; break; }

    if (s.phase === 'discard' && s.currentSeat === 0) {
      await page.evaluate(() => {
        const g = window.game;
        const t = g.players[0].hand.find(t => !['flower','season'].includes(t.suit));
        if (t) g.humanDiscard(t.id);
      });
    } else if (s.phase === 'claim' && s.claimOptions) {
      await page.evaluate(() => window.game.humanPass());
    } else {
      await page.waitForTimeout(80);
    }
    actions++;
    await page.waitForTimeout(30);
  }

  if (!handDone) {
    const s = await gs();
    if (s.phase === 'end') handDone = true;
  }
  if (!handDone) {
    console.error('FAIL: game 1 never reached END phase');
    await browser.close(); process.exit(1);
  }
  console.log(`  Game 1 done after ${actions} human actions.`);

  // ── Step 2: verify moves[] and log[] were captured and saved ────────────────
  console.log('Step 2: verifying moves[] and log[] in save...');
  const raw = await page.evaluate(() => localStorage.getItem('mahjongReplay'));
  if (!raw) {
    console.error('FAIL: no mahjongReplay in localStorage');
    await browser.close(); process.exit(1);
  }
  const save1 = JSON.parse(raw);
  const moveCount = save1.moves?.length ?? 0;
  const logCount  = save1.log?.length ?? 0;

  console.log(`  moves[]: ${moveCount} entries`);
  console.log(`  log[]:   ${logCount} lines`);
  console.log(`  winner: ${save1.winner}, faan: ${save1.faan}`);

  if (moveCount === 0) {
    console.error('FAIL: moves[] is empty — _captureMoves not saving');
    await browser.close(); process.exit(1);
  }
  if (logCount === 0) {
    console.error('FAIL: log[] is empty — log not being saved');
    await browser.close(); process.exit(1);
  }

  // Print first few moves for inspection
  console.log('  First 8 moves:', JSON.stringify(save1.moves.slice(0, 8)));
  // Check seat-0 moves are present
  const seat0moves = save1.moves.filter(m => m.s === 0);
  console.log(`  Seat-0 moves: ${seat0moves.length}`);

  // ── Step 3: play an unrelated game 2 in AUTO mode ──────────────────────────
  console.log('Step 3: playing unrelated game 2 in AUTO mode...');
  await page.evaluate(() => {
    window.AUTO_MODE = 'fast';
    window.AUTO_FAST_DELAY = 50;
  });
  await page.evaluate(() => window.game.redeal?.());
  await page.waitForTimeout(300);
  try {
    await page.waitForFunction(() => window.game?.phase === 'end', { timeout: 20000 });
    console.log('  Game 2 complete.');
  } catch { console.log('  Game 2 timed out (ok).'); }
  await page.evaluate(() => { window.AUTO_MODE = null; });

  // ── Step 4: load game 1 replay using moves[] path ──────────────────────────
  console.log('Step 4: loading game 1 replay via moves[] path...');
  await page.evaluate((data) => {
    window._testValErrors = [];
    window.game.lastValidationError = null;
    window.REPLAY_MODE = true;
    window._replayData = data;
    // applyReplayContext sets _moveQueue = data.moves
    window.game.applyReplayContext(data);
    window._tileElCache?.clear();
    window.game.redeal();
  }, save1);
  await page.waitForTimeout(500);

  // Verify _moveQueue was loaded
  const mqLen = await page.evaluate(() => window._moveQueue?.length ?? -1);
  console.log(`  _moveQueue loaded: ${mqLen} entries`);
  if (mqLen <= 0) {
    console.error('FAIL: _moveQueue not loaded after applyReplayContext+redeal');
    await browser.close(); process.exit(1);
  }

  // Install validation-error monitor
  await page.evaluate(() => {
    window._testValErrors = [];
    const orig = window.game.onUpdate.bind(window.game);
    window.game.onUpdate = function(evt, ...a) {
      if (evt === 'validation-error')
        window._testValErrors.push(window.game.lastValidationError ?? evt);
      return orig(evt, ...a);
    };
  });

  // ── Step 5: step through replay ────────────────────────────────────────────
  console.log('Step 5: stepping through moves[] replay...');
  const maxSteps = moveCount * 4 + 200;
  let steps = 0;
  let reachedEnd = false;

  while (steps < maxSteps) {
    const { phase } = await gs();
    if (phase === 'end') { reachedEnd = true; break; }

    await page.evaluate(() => {
      if (window.REPLAY_MODE && window.game?.phase !== 'end')
        window.game.replayStep();
    });
    steps++;
    await page.waitForTimeout(25);
  }

  // ── Step 6: results ────────────────────────────────────────────────────────
  const valErrors = await page.evaluate(() => window._testValErrors ?? []);
  const remaining = await page.evaluate(() => window._moveQueue?.length ?? 0);
  const finalPhase = (await gs()).phase;

  console.log('\n══════════════════════════════════════════════════════════');
  const ok = valErrors.length === 0 && reachedEnd;
  if (ok) {
    console.log(`✅ PASS — moves[] replay reached END in ${steps} steps, 0 validation errors`);
    console.log(`   _moveQueue remaining: ${remaining} (should be 0 or 1 win-move)`);
  } else {
    if (!reachedEnd) console.log(`❌ FAIL — did not reach END (phase: '${finalPhase}', steps: ${steps})`);
    if (valErrors.length > 0) {
      console.log(`❌ FAIL — ${valErrors.length} validation error(s):`);
      valErrors.forEach(e => console.log('   ', e));
    }
  }
  if (jsErrors.length) { console.log('\nJS errors:'); jsErrors.forEach(e => console.log('  ', e)); }
  console.log('══════════════════════════════════════════════════════════');

  await browser.close();
  process.exit(ok ? 0 : 1);
})();
