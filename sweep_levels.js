// sweep_levels.js — run 12 YOU-vs-CPU level combos, 100 hands each.
// Reports win rate and point delta for every seat so you can spot
// which level setting gives Seat 0 (YOU) the best outcome.
//
// Usage:  node sweep_levels.js
//         node sweep_levels.js 200      (override hands per combo)
//
// Timing: Beginner/Inter ~instant per hand; Expert/Master ~1 s/hand headless.
//         12 combos × 100 Expert hands ≈ 20 min.  Use a smaller count
//         (node sweep_levels.js 50) for a quicker directional read.

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const FILE  = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
const HANDS = parseInt(process.argv[2], 10) || 100;
const LOG   = path.join(__dirname, 'sweep_levels.log');

const LABELS = ['', 'Bgn', 'Int', 'Exp', 'Mst'];

// [youLevel, cpu1, cpu2, cpu3, label]
const COMBOS = [
  [1, 1, 1, 1, 'All Beginner      '],
  [2, 2, 2, 2, 'All Inter         '],
  [3, 3, 3, 3, 'All Expert        '],
  [4, 4, 4, 4, 'All Master        '],
  [1, 3, 3, 3, 'You=Bgn  CPUs=Exp '],
  [2, 3, 3, 3, 'You=Int  CPUs=Exp '],
  [3, 1, 1, 1, 'You=Exp  CPUs=Bgn '],
  [2, 1, 1, 1, 'You=Int  CPUs=Bgn '],
  [1, 4, 4, 4, 'You=Bgn  CPUs=Mst '],
  [3, 4, 4, 4, 'You=Exp  CPUs=Mst '],
  [4, 3, 3, 3, 'You=Mst  CPUs=Exp '],
  [4, 1, 1, 1, 'You=Mst  CPUs=Bgn '],
];

function write(line) {
  process.stdout.write(line + '\n');
  fs.appendFileSync(LOG, line + '\n');
}

async function runCombo(page, youLvl, c1, c2, c3) {
  await page.selectOption('#auto-user-level', String(youLvl));
  await page.selectOption('#cpu1-level', String(c1));
  await page.selectOption('#cpu2-level', String(c2));
  await page.selectOption('#cpu3-level', String(c3));
  for (const id of ['cpu1-scheme','cpu2-scheme','cpu3-scheme','user-scheme-select'])
    await page.selectOption('#' + id, '').catch(() => {});

  await page.evaluate((n) => {
    window._sprintLog = []; window._sprintDone = 0;
    document.getElementById('sprint-count-input').value = n;
  }, HANDS);

  // Select minimum valid display option so _sprintStart reads 500ms,
  // then zero it out immediately so hands 2-N run with no delay.
  await page.selectOption('#sprint-display-ms', '500');
  await page.click('#sprint-fast-btn');
  await page.evaluate(() => { window._sprintDisplayMs = 0; });

  // Poll until AUTO_MODE goes null (sprint done).
  // NOTE: page.waitForFunction timeout is overridden by the 30 s page default —
  // use a manual loop instead (see memory: project_playwright_timing).
  const maxSecs = Math.max(30, HANDS * 1.5); // ~1 s/hand for Expert/Master
  for (let t = 0; t < maxSecs; t++) {
    if (await page.evaluate(() => window.AUTO_MODE === null)) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(150);

  return page.evaluate(() => {
    const log     = window._sprintLog || [];
    const wins    = [0, 0, 0, 0];
    const fBySeat = [0, 0, 0, 0];
    for (const e of log) {
      if (e.winnerSeat >= 0) { wins[e.winnerSeat]++; fBySeat[e.winnerSeat] += e.faan; }
    }
    const startSc = window._sprintStartScores ?? [9999, 9999, 9999, 9999];
    const lastSc  = log.length ? log[log.length - 1].scores : [];
    const deltas  = lastSc.map((s, i) => s.score - startSc[i]);
    const avgF    = wins.map((w, i) => w > 0 ? (fBySeat[i] / w).toFixed(1) : '—');
    return { wins, deltas, avgF, hands: log.length };
  });
}

(async () => {
  fs.writeFileSync(LOG, `sweep_levels.js started ${new Date().toISOString()}\n`);
  write(`Level sweep — ${HANDS} hands per combo`);
  write(`Started: ${new Date().toLocaleTimeString()}`);

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => write(`[JS] ${e.message}`));

  // High start points so no player goes bust during the sweep
  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE);
  await page.waitForTimeout(700);

  const col = (s, n) => String(s).padStart(n);
  const HDR = `${'Config'.padEnd(22)}  ${'You'.padEnd(14)}  ${'CPU1'.padEnd(14)}  ${'CPU2'.padEnd(14)}  CPU3`;
  const SUB = `${''.padEnd(22)}  ${'W%  ΔPts  AvgF'.padEnd(14)}  ${'W%  ΔPts  AvgF'.padEnd(14)}  ${'W%  ΔPts  AvgF'.padEnd(14)}  W%  ΔPts  AvgF`;
  const SEP = '─'.repeat(82);
  write(''); write(SEP); write(HDR); write(SUB); write(SEP);

  for (const [youLvl, c1, c2, c3, label] of COMBOS) {
    const r = await runCombo(page, youLvl, c1, c2, c3);
    const cells = r.wins.map((w, i) => {
      const pct  = r.hands > 0 ? Math.round(w / r.hands * 100) : 0;
      const d    = r.deltas[i] ?? 0;
      const dStr = (d >= 0 ? '+' : '') + d;
      return `${col(pct + '%', 3)} ${col(dStr, 5)} ${col(r.avgF[i] + 'f', 5)}`;
    });
    write(`${label}  ${cells.join('  ')}`);
  }

  write(SEP);
  write(`\nDone: ${new Date().toLocaleTimeString()}`);
  write(`Log: ${LOG}`);
  await browser.close();
})();
