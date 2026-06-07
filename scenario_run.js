// scenario_run.js — batch-run replay/scenario JSONs and report PASS/FAIL
//
// Every hand JSON already has a `winner` field (player name) and `players[]` (seat map),
// so the expected outcome is implicit. Scenario JSONs can also carry an explicit
// `expected.winnerSeat` override.
//
// Usage:
//   node scenario_run.js                        (default: mj-*.json + scenario_*.json)
//   node scenario_run.js mj-0004.json mj-0006.json scenario_hijack.json
//   node scenario_run.js --verbose              (show detail per run)
//   node scenario_run.js --timeout 15           (seconds per scenario, default 10)

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ── Args ──────────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const flags   = {};
const argFiles = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i].startsWith('--')) { flags[rawArgs[i].slice(2)] = rawArgs[i+1] ?? true; i++; }
  else argFiles.push(rawArgs[i]);
}
const VERBOSE    = !!flags.verbose;
const TIMEOUT_MS = (parseInt(flags.timeout, 10) || 10) * 1000;
const FILE_URL   = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');

// ── File discovery ────────────────────────────────────────────────────────────
function defaultFiles() {
  return fs.readdirSync('.')
    .filter(f => (f.startsWith('mj-') || f.startsWith('scenario_')) && f.endsWith('.json'))
    .sort();
}
const targets = argFiles.length ? argFiles : defaultFiles();

// ── Derive expected winner seat from JSON ─────────────────────────────────────
// Precedence: explicit expected.winnerSeat > winner name field
function expectedSeat(data) {
  if (data.expected?.winnerSeat != null) return data.expected.winnerSeat;
  if (data.winner == null) return null;          // no expectation recorded
  if (data.winner === -1)  return -1;            // draw
  const p = data.players?.find(p => p.name === data.winner);
  return p?.seat ?? null;
}

// ── Run one file ──────────────────────────────────────────────────────────────
async function runOne(page, data, filename) {
  const expSeat = expectedSeat(data);
  if (expSeat === null) return { filename, skip: true, reason: 'no expected winner in JSON' };

  const hasMoves = data.moves?.length || data.log?.length;
  if (!hasMoves) return { filename, skip: true, reason: 'no moves or log to replay' };

  // Inject scenario: sprint mode so CPU actions run synchronously,
  // REPLAY_MODE so the move queue drives every seat deterministically.
  await page.evaluate((d) => {
    window.AUTO_MODE   = 'sprint';
    window.REPLAY_MODE = true;
    window._replayData = d;
    window.game.applyReplayContext(d);
    window.game.redeal();
    renderAll();
  }, data);

  // Drive to completion.
  // With AUTO_MODE='sprint', all CPU actions run synchronously via _scheduleOrStep.
  // The only pause points are CLAIM phases after seat-0 discards — those wait for
  // replayStep(). We call replayStep() for every 'claim' phase and yield 1ms between
  // iterations so pending setTimeout(fn,0) callbacks (bonus/draw steps) can fire.
  const started = Date.now();
  let iters = 0;
  while (true) {
    const { phase, seat } = await page.evaluate(() => ({
      phase: window.game?.phase,
      seat:  window.game?.currentSeat,
    }));

    if (phase === 'end') break;
    if (Date.now() - started > TIMEOUT_MS) return { filename, error: 'timeout' };
    if (++iters > 2000) return { filename, error: 'iter limit' };

    if (phase === 'claim' || (phase === 'discard' && seat === 0)) {
      await page.evaluate(() => { window.game.replayStep(); renderAll(); });
    }
    await page.waitForTimeout(1);
  }

  const result = await page.evaluate(() => ({
    winner: window.game.lastResult?.winner ?? -1,
    faan:   window.game.lastResult?.faan   ?? 0,
    label:  window.game.lastResult?.label  ?? '',
  }));

  const pass = result.winner === expSeat;
  return { filename, pass, expSeat, actSeat: result.winner, faan: result.faan, label: result.label, iters };
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error(`[JS] ${e.message}`));

  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE_URL);
  await page.waitForTimeout(800);

  const results = [];
  let passed = 0, failed = 0, skipped = 0, errors = 0;

  console.log(`\nRunning ${targets.length} file(s)...\n`);

  for (const filename of targets) {
    let data;
    try { data = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (e) { console.log(`  SKIP  ${filename}  (parse error)`); skipped++; continue; }

    const r = await runOne(page, data, filename);
    results.push(r);

    if (r.skip)       { console.log(`  SKIP  ${filename}  (${r.reason})`);                                           skipped++; }
    else if (r.error) { console.log(`  ERR   ${filename}  (${r.error})`);                                            errors++;  }
    else if (r.pass)  { console.log(`  PASS  ${filename}  seat${r.actSeat} wins, ${r.faan}f — ${r.label}`);         passed++;  }
    else              { console.log(`  FAIL  ${filename}  expected seat${r.expSeat}, got seat${r.actSeat} ${r.faan}f — ${r.label}`); failed++; }
  }

  const total = passed + failed + errors;
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  PASS ${passed}/${total}   FAIL ${failed}   ERR ${errors}   SKIP ${skipped}`);
  console.log('═'.repeat(56));

  if (VERBOSE) {
    console.log();
    for (const r of results) {
      if (r.skip || r.error) continue;
      const mark = r.pass ? '✓' : '✗';
      console.log(`  ${mark} ${r.filename.padEnd(32)} exp=${r.expSeat} got=${r.actSeat}  iters=${r.iters}`);
    }
  }

  await browser.close();
  process.exit(failed + errors > 0 ? 1 : 0);
})();
