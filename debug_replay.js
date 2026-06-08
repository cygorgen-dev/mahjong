// debug_replay.js — general-purpose replay debugger
//
// Usage:
//   node debug_replay.js <file.json>              — trace replay, show final state
//   node debug_replay.js <file.json> --hands      — also dump all player hands/melds at end of replay
//   node debug_replay.js <file.json> --poll 500   — sample game state every N ms (default 500)
//   node debug_replay.js <file.json> --patch-exit — patch _exitReplayMode to log every call
//   node debug_replay.js <file.json> --extra '{"a":"D","s":0,"t":["dragon","white"]}'
//                                                 — append an extra move before running
//
// All flags can be combined.  Examples:
//   node debug_replay.js mj-0006.json --patch-exit --poll 200
//   node debug_replay.js scenario_win_cpu3_rob_kong.json --hands --extra '{"a":"D","s":0,"t":["dragon","white"]}'

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const FILE_URL = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonFile  = args.find(a => !a.startsWith('--'));
const HANDS     = args.includes('--hands');
const PATCH_EXIT = args.includes('--patch-exit');
const pollIdx   = args.indexOf('--poll');
const POLL_MS   = pollIdx >= 0 ? parseInt(args[pollIdx + 1], 10) : 500;
const extraIdx  = args.indexOf('--extra');
const EXTRA_MOVE = extraIdx >= 0 ? JSON.parse(args[extraIdx + 1]) : null;
const TIMEOUT_MS = 20000;

if (!jsonFile) {
  console.error('Usage: node debug_replay.js <file.json> [--hands] [--poll N] [--patch-exit] [--extra JSON]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
if (EXTRA_MOVE) {
  data.moves = [...(data.moves ?? []), EXTRA_MOVE];
  console.log(`[extra] appended move: ${JSON.stringify(EXTRA_MOVE)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.log('[JS ERROR]', e.message));
  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE_URL);
  await page.waitForTimeout(800);

  // Inject scenario via localStorage bridge (avoids serialization size limits)
  await page.evaluate(s => localStorage.setItem('_dbg', s), JSON.stringify(data));

  // Optionally patch _exitReplayMode to log every call
  if (PATCH_EXIT) {
    await page.evaluate(() => {
      const orig = window._exitReplayMode;
      window._exitReplayModeLog = [];
      window._exitReplayMode = function () {
        const q = window._moveQueue;
        const entry = {
          phase:    window.game?.phase,
          queueLen: q === null ? 'null' : q === undefined ? 'undef' : q.length,
          queueHead: q?.[0] ?? null,
          replayMode: window.REPLAY_MODE,
          stack: new Error().stack.split('\n').slice(1, 4).join(' | '),
        };
        window._exitReplayModeLog.push(entry);
        console.warn('[_exitReplayMode]', JSON.stringify(entry));
        return orig?.apply(this, arguments);
      };
    });
    console.log('[patch-exit] _exitReplayMode patched');
  }

  // Load and start replay
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('_dbg'));
    window.AUTO_MODE   = undefined;
    window.REPLAY_MODE = true;
    window._replayData = d;
    window.game.applyReplayContext(d);
    window.game.redeal();
    renderAll();
  });
  await page.waitForTimeout(200);

  const qLen = await page.evaluate(() => window._moveQueue?.length ?? 'null');
  console.log(`[start] queue=${qLen}  file=${jsonFile}\n`);

  // ── Drive replay + poll ───────────────────────────────────────────────────
  const started = Date.now();
  let tick = 0;
  while (true) {
    const phase = await page.evaluate(() => {
      if (window.game?.phase !== 'end') {
        if (window.REPLAY_MODE) _replayStepThenCheck();
      }
      return window.game?.phase;
    });

    if (phase === 'end') break;
    if (Date.now() - started > TIMEOUT_MS) { console.log('\n[TIMEOUT]'); break; }

    // Poll state at configured interval
    if (tick % Math.max(1, Math.round(POLL_MS / 5)) === 0) {
      const s = await page.evaluate(() => ({
        phase:   window.game.phase,
        seat:    window.game.currentSeat,
        replay:  window.REPLAY_MODE,
        q:       window._moveQueue === null ? 'null' : window._moveQueue.length,
        discard: window.game.discard ? window.game.discard.suit + '-' + window.game.discard.value : null,
        pending: window.game.pendingClaims?.length ?? 0,
      }));
      console.log(`${Date.now() - started}ms:`, JSON.stringify(s));
    }

    tick++;
    await page.waitForTimeout(5);
  }

  // ── Final state ───────────────────────────────────────────────────────────
  const result = await page.evaluate(() => ({
    phase:   window.game.phase,
    replay:  window.REPLAY_MODE,
    winner:  window.game.lastResult?.winner ?? -1,
    faan:    window.game.lastResult?.faan   ?? 0,
    label:   window.game.lastResult?.label  ?? '',
  }));

  console.log('\n── Final state ───────────────────────────────────────────────');
  console.log(JSON.stringify(result, null, 2));

  if (result.phase === 'end') {
    const verdict = result.winner >= 0
      ? `seat${result.winner} wins ${result.faan}f — ${result.label}`
      : 'Draw (wall exhausted)';
    console.log('\nResult:', verdict);
  } else {
    console.log('\nResult: game did not reach END (stall or timeout)');
  }

  // ── Hands dump (--hands) ──────────────────────────────────────────────────
  if (HANDS) {
    const hands = await page.evaluate(() =>
      window.game.players.map(p => ({
        seat:  p.seat,
        name:  p.name,
        hand:  p.hand.map(t => t.suit + '-' + t.value),
        melds: p.melds?.map(m => m.type + ': ' + m.tiles.map(t => t.suit + '-' + t.value).join(', ')),
        bonus: p.bonus?.map(t => t.suit + '-' + t.value),
      }))
    );
    console.log('\n── Player hands ──────────────────────────────────────────────');
    for (const p of hands) {
      console.log(`  seat${p.seat} (${p.name}): [${p.hand.join(', ')}]`);
      if (p.melds?.length) console.log(`    melds: ${p.melds.join(' | ')}`);
      if (p.bonus?.length) console.log(`    bonus: ${p.bonus.join(', ')}`);
    }
  }

  // ── Exit log (--patch-exit) ───────────────────────────────────────────────
  if (PATCH_EXIT) {
    const log = await page.evaluate(() => window._exitReplayModeLog ?? []);
    console.log('\n── _exitReplayMode calls ─────────────────────────────────────');
    if (log.length === 0) console.log('  (never called)');
    else log.forEach((e, i) => console.log(`  [${i}]`, JSON.stringify(e)));
  }

  await browser.close();
})();
