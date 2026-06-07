// scenario_run.js — batch-run replay/scenario JSONs and report PASS/FAIL
//
// Every hand JSON already has a `winner` field (player name) and `players[]` (seat map),
// so the expected outcome is implicit. Scenario JSONs can also carry an explicit
// `expected.winnerSeat` override.
//
// Usage:
//   node scenario_run.js                        (default: mj-*.json + scenario_*.json)
//   node scenario_run.js mj-0004.json mj-0006.json scenario_hijack.json
//   node scenario_run.js --verbose              (show per-file seat + iteration detail)
//   node scenario_run.js --timeout 15           (seconds per scenario, default 10)
//
// Output is written to stdout AND appended to scenario_run_YYYYMMDD.log

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

// ── Incremental log (stdout + file) ──────────────────────────────────────────
function buildLogPath() {
  const d = new Date();
  const tag = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return path.join(__dirname, `scenario_run_${tag}.log`);
}
const _logPath = buildLogPath();
fs.writeFileSync(_logPath, `scenario_run.js started ${new Date().toISOString()}\n`);

function write(line) {
  process.stdout.write(line + '\n');
  fs.appendFileSync(_logPath, line + '\n');
}

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

  // Inject: REPLAY_MODE only — no AUTO_MODE so CPU actions run naturally via
  // setTimeout(fn,0) between replayStep() calls (same as the browser's auto-replay).
  await page.evaluate((d) => {
    window.AUTO_MODE   = undefined;
    window.REPLAY_MODE = true;
    window._replayData = d;
    window.game.applyReplayContext(d);
    window.game.redeal();
    renderAll();
  }, data);

  // Call replayStep() on every tick; it returns early when the game is not paused
  // waiting for input. Yield 5ms each tick so CPU setTimeout(fn,0) callbacks fire
  // between calls — the same mechanism used by _startAutoReplay in the browser.
  const started = Date.now();
  let iters = 0;
  while (true) {
    const phase = await page.evaluate(() => {
      if (window.game?.phase !== 'end') window.game.replayStep();
      return window.game?.phase;
    });

    if (phase === 'end') break;
    if (Date.now() - started > TIMEOUT_MS) return { filename, error: 'timeout' };
    if (++iters > 5000) return { filename, error: 'iter limit' };
    await page.waitForTimeout(5);
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
  page.on('pageerror', e => write(`[JS] ${e.message}`));

  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE_URL);
  await page.waitForTimeout(800);

  const results = [];
  let passed = 0, failed = 0, skipped = 0, errors = 0;

  write(`Files  : ${targets.length}`);
  write(`Log    : ${_logPath}\n`);

  for (const filename of targets) {
    let data;
    try { data = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (e) { write(`  SKIP  ${filename}  (parse error)`); skipped++; continue; }

    const r = await runOne(page, data, filename);
    results.push(r);

    if (r.skip)       { write(`  SKIP  ${filename}  (${r.reason})`);                                                        skipped++; }
    else if (r.error) { write(`  ERR   ${filename}  (${r.error})`);                                                         errors++;  }
    else if (r.pass)  { write(`  PASS  ${filename}  seat${r.actSeat} wins, ${r.faan}f — ${r.label}`);                      passed++;  }
    else              { write(`  FAIL  ${filename}  expected seat${r.expSeat}, got seat${r.actSeat} ${r.faan}f — ${r.label}`); failed++; }
  }

  const total = passed + failed + errors;
  write(`\n${'═'.repeat(56)}`);
  write(`  PASS ${passed}/${total}   FAIL ${failed}   ERR ${errors}   SKIP ${skipped}`);
  write('═'.repeat(56));

  if (VERBOSE) {
    write('');
    for (const r of results) {
      if (r.skip || r.error) continue;
      const mark = r.pass ? '✓' : '✗';
      write(`  ${mark} ${r.filename.padEnd(32)} exp=${r.expSeat} got=${r.actSeat}  iters=${r.iters}`);
    }
  }

  await browser.close();
  process.exit(failed + errors > 0 ? 1 : 0);
})();
