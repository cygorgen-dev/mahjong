// combo.js — run a single level configuration for N hands and report.
// Like calibrate_combo.js but accepts optional positional parameters.
//
// Usage (positional):
//   node combo.js                          (all Expert, 200 hands)
//   node combo.js 3 3 3 3 200             (seat0 seat1 seat2 seat3 hands)
//   node combo.js 4 1                     (You=Master, CPU1=Beginner, rest=Expert)
//   node combo.js 3 1 2 3 500
//
// Usage (named flags — still supported):
//   node combo.js --hands 500
//   node combo.js --you 4 --cpus 1
//   node combo.js --you 3 --cpus 1,2,3
//   node combo.js --you 2 --cpus 3 --hands 300
//
// Levels: 1=Beginner  2=Inter  3=Expert  4=Master
// Reports every 25 hands with cumulative totals.

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ── Parse args ────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);

// Separate named flags (--foo val) from positional args
const positional = [];
const flagMap    = {};
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i].startsWith('--')) {
    flagMap[rawArgs[i].slice(2)] = rawArgs[i + 1];
    i++;
  } else {
    positional.push(rawArgs[i]);
  }
}

const DEFAULT_LEVEL = 3;
const DEFAULT_HANDS = 200;

// Named flags take precedence over positional; positional fills gaps; defaults fill the rest.
const YOU_LEVEL = parseInt(flagMap['you'] ?? positional[0] ?? DEFAULT_LEVEL, 10);
const HANDS     = parseInt(flagMap['hands'] ?? positional[4] ?? DEFAULT_HANDS, 10);

let CPU_LEVELS;
if (flagMap['cpus'] !== undefined) {
  // --cpus accepts a single value (applied to all CPUs) or comma-separated
  const cpuParts = flagMap['cpus'].split(',').map(s => parseInt(s.trim(), 10));
  CPU_LEVELS = [
    cpuParts[0] ?? DEFAULT_LEVEL,
    cpuParts[1] ?? cpuParts[0] ?? DEFAULT_LEVEL,
    cpuParts[2] ?? cpuParts[0] ?? DEFAULT_LEVEL,
  ];
} else {
  CPU_LEVELS = [
    parseInt(positional[1] ?? DEFAULT_LEVEL, 10),
    parseInt(positional[2] ?? DEFAULT_LEVEL, 10),
    parseInt(positional[3] ?? DEFAULT_LEVEL, 10),
  ];
}

const REPORT_EVERY = 25;

const LABELS = ['', 'Beginner', 'Inter', 'Expert', 'Master'];
const FILE   = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
const LOG    = path.join(__dirname, `combo_${YOU_LEVEL}${CPU_LEVELS[0]}${CPU_LEVELS[1]}${CPU_LEVELS[2]}${HANDS}.log`);

const CONFIG_TAG = `You=${LABELS[YOU_LEVEL]}  CPU1=${LABELS[CPU_LEVELS[0]]}  CPU2=${LABELS[CPU_LEVELS[1]]}  CPU3=${LABELS[CPU_LEVELS[2]]}`;

function write(line) {
  process.stdout.write(line + '\n');
  fs.appendFileSync(LOG, line + '\n');
}

function report(label, log, startScores) {
  const total = log.length;
  if (!total) return;
  const draws   = log.filter(e => e.winnerSeat < 0).length;
  const wins    = total - draws;
  const bySeat  = [0, 0, 0, 0];
  const fBySeat = [0, 0, 0, 0];
  for (const e of log) {
    if (e.winnerSeat >= 0) { bySeat[e.winnerSeat]++; fBySeat[e.winnerSeat] += e.faan; }
  }
  const names  = log[0]?.scores?.map(s => s.name) ?? ['You','CPU1','CPU2','CPU3'];
  const lastSc = log[total - 1]?.scores ?? [];
  const avgAll = wins > 0
    ? (log.filter(e => e.winnerSeat >= 0).reduce((s, e) => s + e.faan, 0) / wins).toFixed(2)
    : '—';
  write(`\n${label} — ${total} hands, ${draws} draws (${Math.round(draws/total*100)}%), avg faan ${avgAll}`);
  write(`  ${'Player'.padEnd(6)} ${'Seat'.padStart(4)} ${'W'.padStart(4)} ${'W%'.padStart(5)} ${'ΔPts'.padStart(7)} ${'AvgF'.padStart(6)}`);
  write(`  ${'------'.padEnd(6)} ${'----'.padStart(4)} ${'----'.padStart(4)} ${'-----'.padStart(5)} ${'------'.padStart(7)} ${'------'.padStart(6)}`);
  for (let i = 0; i < 4; i++) {
    const w    = bySeat[i];
    const pct  = Math.round(w / total * 100);
    const avgF = w > 0 ? (fBySeat[i] / w).toFixed(2) : '—';
    const delta = startScores && lastSc[i] ? lastSc[i].score - startScores[i] : '?';
    const dStr  = typeof delta === 'number' ? (delta >= 0 ? `+${delta}` : `${delta}`) : '?';
    const bar   = '█'.repeat(Math.round(pct / 2));
    write(`  ${names[i].padEnd(6)} ${String(i).padStart(4)} ${String(w).padStart(4)} ${(pct + '%').padStart(5)} ${dStr.padStart(7)} ${(avgF + 'f').padStart(6)}  ${bar}`);
  }
}

(async () => {
  fs.writeFileSync(LOG, `combo.js started ${new Date().toISOString()}\n  Args: ${YOU_LEVEL} ${CPU_LEVELS.join(' ')} ${HANDS}\n`);
  write(`Config : ${CONFIG_TAG}`);
  write(`Hands  : ${HANDS}`);
  write(`Report every ${REPORT_EVERY} hands\n`);

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => write(`[JS] ${e.message}`));

  // High start points so nobody busts mid-run
  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE);
  await page.waitForTimeout(800);

  // Set levels
  await page.selectOption('#auto-user-level', String(YOU_LEVEL));
  await page.selectOption('#cpu1-level',      String(CPU_LEVELS[0]));
  await page.selectOption('#cpu2-level',      String(CPU_LEVELS[1]));
  await page.selectOption('#cpu3-level',      String(CPU_LEVELS[2]));
  for (const id of ['cpu1-scheme','cpu2-scheme','cpu3-scheme','user-scheme-select'])
    await page.selectOption('#' + id, '').catch(() => {});

  const startScores = await page.evaluate(() =>
    window.game?.players?.map(p => p.score) ?? [9999, 9999, 9999, 9999]
  );
  write(`Start scores: ${startScores.join(', ')}`);

  // Set up sprint
  await page.selectOption('#sprint-display-ms', '500');
  await page.evaluate((n) => {
    window._sprintLog = []; window._sprintDone = 0;
    document.getElementById('sprint-count-input').value = n;
  }, HANDS);
  await page.click('#sprint-fast-btn');
  await page.evaluate(() => { window._sprintDisplayMs = 0; });
  write(`Sprint started at ${new Date().toISOString()}`);

  // Poll with progress reports
  let lastReported = 0;
  const maxSecs    = Math.max(60, HANDS * 1.5);
  const started    = Date.now();

  for (let t = 0; t < maxSecs; t++) {
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => ({
      done:  window._sprintDone ?? 0,
      mode:  window.AUTO_MODE ?? null,
      log:   window._sprintLog ?? [],
    }));

    if (state.log.length >= lastReported + REPORT_EVERY) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      write(`\n── H${state.log.length}/${HANDS} (${elapsed}s) ──`);
      report(`Progress`, state.log, startScores);
      lastReported = state.log.length;
    }

    if (state.mode === null) {
      write(`\nSprint complete at ${new Date().toISOString()}`);
      break;
    }
  }

  // Final report
  const final = await page.evaluate(() => window._sprintLog ?? []);
  write('\n' + '═'.repeat(60));
  write('FINAL');
  report(`${CONFIG_TAG} — ${HANDS} hands`, final, startScores);
  write('═'.repeat(60));
  write(`Log: ${LOG}`);

  await browser.close();
})();
