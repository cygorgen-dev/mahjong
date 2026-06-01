// combo.js — run a player-strategy configuration for N hands and report.
//
// Strategies (level + optional scheme) are assigned to player NAMES, not seats.
// After each full game (four wind rounds) the CPU players rotate seats, but
// each player carries their assigned strategy with them.
//
// Usage (positional — levels by player order: You CPU1 CPU2 CPU3):
//   node combo.js                            (all Expert, 200 hands)
//   node combo.js 3 3 3 3 200               (explicit levels + hands)
//   node combo.js 4 1                        (You=Master, CPU1=Beginner, rest Expert)
//
// Usage (named flags):
//   node combo.js --you 4 --cpus 1 --hands 500
//   node combo.js --cpu1 4 --cpu2 3 --cpu3 1
//
// Scheme flags (replace the level AI for that player):
//   --syou   <scheme-id>    YOU player scheme
//   --scpu1  <scheme-id>    CPU1 player scheme
//   --scpu2  <scheme-id>    CPU2 player scheme
//   --scpu3  <scheme-id>    CPU3 player scheme
//
// Utility:
//   node combo.js --list-schemes             (list scheme IDs read live from game)
//
// Levels: 1=Beginner  2=Inter  3=Expert  4=Master
// Scheme IDs come from js/schemes.js — add schemes there; no changes needed here.

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ── Parse args ────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);

const positional = [];
const flagMap    = {};
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i].startsWith('--')) {
    flagMap[rawArgs[i].slice(2)] = rawArgs[i + 1] ?? true;
    i++;
  } else {
    positional.push(rawArgs[i]);
  }
}

const LIST_SCHEMES = !!flagMap['list-schemes'];

const DEFAULT_LEVEL = 3;
const DEFAULT_HANDS = 200;

const YOU_LEVEL = parseInt(flagMap['you'] ?? positional[0] ?? DEFAULT_LEVEL, 10);
const HANDS     = parseInt(flagMap['hands'] ?? positional[4] ?? DEFAULT_HANDS, 10);

let CPU_LEVELS;
if (flagMap['cpus'] !== undefined) {
  const cpuParts = flagMap['cpus'].split(',').map(s => parseInt(s.trim(), 10));
  CPU_LEVELS = [
    cpuParts[0] ?? DEFAULT_LEVEL,
    cpuParts[1] ?? cpuParts[0] ?? DEFAULT_LEVEL,
    cpuParts[2] ?? cpuParts[0] ?? DEFAULT_LEVEL,
  ];
} else {
  CPU_LEVELS = [
    parseInt(flagMap['cpu1'] ?? positional[1] ?? DEFAULT_LEVEL, 10),
    parseInt(flagMap['cpu2'] ?? positional[2] ?? DEFAULT_LEVEL, 10),
    parseInt(flagMap['cpu3'] ?? positional[3] ?? DEFAULT_LEVEL, 10),
  ];
}

// Schemes keyed by player name — null means use level AI
const SCHEMES_BY_PLAYER = {
  You:  flagMap['syou']  || null,
  CPU1: flagMap['scpu1'] || null,
  CPU2: flagMap['scpu2'] || null,
  CPU3: flagMap['scpu3'] || null,
};

const REPORT_EVERY  = 25;
const LEVEL_LABELS  = ['', 'Beginner', 'Inter', 'Expert', 'Master'];
const PLAYER_NAMES  = ['You', 'CPU1', 'CPU2', 'CPU3'];
const FILE          = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns a short display tag for a player's strategy
function strategyTag(playerName, levelIdx, schemeName) {
  return schemeName || (LEVEL_LABELS[levelIdx] ?? `L${levelIdx}`);
}

function buildLogPath(schemeNames) {
  const parts = PLAYER_NAMES.map((name, i) => {
    const lvl = i === 0 ? YOU_LEVEL : CPU_LEVELS[i - 1];
    const sc  = schemeNames[name];
    const safe = sc ? sc.replace(/[^\w-]/g, '').slice(0, 10) : null;
    return safe ? `${lvl}-${safe}` : String(lvl);
  });
  return path.join(__dirname, `combo_${parts.join('_')}_${HANDS}.log`);
}

let _logPath = null;
function write(line) {
  process.stdout.write(line + '\n');
  if (_logPath) fs.appendFileSync(_logPath, line + '\n');
}

// Aggregate log entries by player NAME (not seat — seats rotate between games)
function report(label, log, startByName) {
  const total = log.length;
  if (!total) return;

  const draws = log.filter(e => e.winnerSeat < 0).length;
  const wins  = total - draws;

  // Collect all player names encountered (may include rotated positions)
  const nameSet = new Set();
  for (const e of log) for (const s of e.scores) nameSet.add(s.name);
  const names = PLAYER_NAMES.filter(n => nameSet.has(n)); // canonical order

  const byName = {};
  names.forEach(n => { byName[n] = { wins: 0, faan: 0 }; });

  for (const e of log) {
    if (e.winnerSeat >= 0 && e.winnerName && byName[e.winnerName] !== undefined) {
      byName[e.winnerName].wins++;
      byName[e.winnerName].faan += e.faan;
    }
  }

  // Final scores by name from last log entry
  const lastEntry  = log[total - 1];
  const endByName  = {};
  for (const s of lastEntry.scores) endByName[s.name] = s.score;

  const totalFaan = log.filter(e => e.winnerSeat >= 0).reduce((s, e) => s + e.faan, 0);
  const avgAll    = wins > 0 ? (totalFaan / wins).toFixed(2) : '—';

  write(`\n${label} — ${total} hands, ${draws} draws (${Math.round(draws / total * 100)}%), avg faan ${avgAll}`);
  write(`  ${'Player'.padEnd(8)} ${'W'.padStart(4)} ${'W%'.padStart(5)} ${'ΔPts'.padStart(7)} ${'AvgF'.padStart(6)}`);
  write(`  ${'--------'.padEnd(8)} ${'----'.padStart(4)} ${'-----'.padStart(5)} ${'------'.padStart(7)} ${'------'.padStart(6)}`);

  for (const name of names) {
    const { wins: w, faan } = byName[name];
    const pct  = Math.round(w / total * 100);
    const avgF = w > 0 ? (faan / w).toFixed(2) : '—';
    const start = startByName?.[name];
    const end   = endByName[name];
    const delta = (start !== undefined && end !== undefined) ? end - start : null;
    const dStr  = delta !== null ? (delta >= 0 ? `+${delta}` : `${delta}`) : '?';
    const bar   = '█'.repeat(Math.round(pct / 2));
    write(`  ${name.padEnd(8)} ${String(w).padStart(4)} ${(pct + '%').padStart(5)} ${dStr.padStart(7)} ${(avgF + 'f').padStart(6)}  ${bar}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error(`[JS] ${e.message}`));

  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE);
  await page.waitForTimeout(800);

  // ── Read schemes live from the game (schemes.js) ──────────────────────────
  const availableSchemes = await page.evaluate(() =>
    typeof SCHEMES !== 'undefined'
      ? SCHEMES.map(s => ({ id: s.id, name: s.name, desc: s.desc }))
      : []
  );

  if (LIST_SCHEMES) {
    console.log('\nAvailable schemes (from js/schemes.js):\n');
    for (const s of availableSchemes) {
      console.log(`  ${s.id.padEnd(20)}  ${s.name}`);
      console.log(`  ${''.padEnd(20)}  ${s.desc}`);
      console.log();
    }
    await browser.close();
    return;
  }

  // ── Validate requested scheme IDs ─────────────────────────────────────────
  const validIds   = new Set(availableSchemes.map(s => s.id));
  // Map player name -> scheme display name (null if no scheme)
  const schemeNames = {};
  for (const [player, id] of Object.entries(SCHEMES_BY_PLAYER)) {
    if (!id) { schemeNames[player] = null; continue; }
    if (!validIds.has(id)) {
      console.error(`\nUnknown scheme id for ${player}: "${id}"`);
      console.error(`Valid ids: ${[...validIds].join(', ')}`);
      console.error(`Run: node combo.js --list-schemes  for details`);
      process.exit(1);
    }
    schemeNames[player] = availableSchemes.find(s => s.id === id).name;
  }

  // ── Build config tag ───────────────────────────────────────────────────────
  const allLevels = [YOU_LEVEL, ...CPU_LEVELS];
  const CONFIG_TAG = PLAYER_NAMES.map((name, i) =>
    `${name}=${strategyTag(name, allLevels[i], schemeNames[name])}`
  ).join('  ');

  _logPath = buildLogPath(schemeNames);
  fs.writeFileSync(_logPath, `combo.js started ${new Date().toISOString()}\n`);
  write(`Config : ${CONFIG_TAG}`);
  write(`Hands  : ${HANDS}`);
  write(`Report every ${REPORT_EVERY} hands\n`);

  // ── Apply levels and schemes to the game UI ────────────────────────────────
  await page.selectOption('#auto-user-level',    String(YOU_LEVEL));
  await page.selectOption('#cpu1-level',         String(CPU_LEVELS[0]));
  await page.selectOption('#cpu2-level',         String(CPU_LEVELS[1]));
  await page.selectOption('#cpu3-level',         String(CPU_LEVELS[2]));
  await page.selectOption('#user-scheme-select', SCHEMES_BY_PLAYER.You  ?? '').catch(() => {});
  await page.selectOption('#cpu1-scheme',        SCHEMES_BY_PLAYER.CPU1 ?? '').catch(() => {});
  await page.selectOption('#cpu2-scheme',        SCHEMES_BY_PLAYER.CPU2 ?? '').catch(() => {});
  await page.selectOption('#cpu3-scheme',        SCHEMES_BY_PLAYER.CPU3 ?? '').catch(() => {});

  // ── Capture start state: scores + initial seat assignments ──────────────────
  const startState = await page.evaluate(() => {
    const players = window.game?.players ?? [];
    const byName = {};
    const seats  = {};   // seat# -> playerName
    for (const p of players) {
      byName[p.name] = p.score;
      seats[p.seat]  = p.name;
    }
    return { byName, seats };
  });
  const startByName = startState.byName;

  write(`Start scores: ${PLAYER_NAMES.map(n => `${n}=${startByName[n] ?? '?'}`).join('  ')}`);
  write(`Start seats:  ${[0,1,2,3].map(s => `Seat${s}=${startState.seats[s] ?? '?'}`).join('  ')}  (seats rotate after each full game)`);

  // ── Sprint ─────────────────────────────────────────────────────────────────
  await page.selectOption('#sprint-display-ms', '500');
  await page.evaluate((n) => {
    window._sprintLog = []; window._sprintDone = 0;
    document.getElementById('sprint-count-input').value = n;
  }, HANDS);
  await page.click('#sprint-fast-btn');
  await page.evaluate(() => { window._sprintDisplayMs = 0; });
  write(`Sprint started at ${new Date().toISOString()}`);

  // ── Poll with progress reports ─────────────────────────────────────────────
  let lastReported = 0;
  const maxSecs    = Math.max(60, HANDS * 1.5);
  const started    = Date.now();

  for (let t = 0; t < maxSecs; t++) {
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => ({
      done: window._sprintDone ?? 0,
      mode: window.AUTO_MODE ?? null,
      log:  window._sprintLog ?? [],
    }));

    if (state.log.length >= lastReported + REPORT_EVERY) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      write(`\n── H${state.log.length}/${HANDS} (${elapsed}s) ──`);
      report('Progress', state.log, startByName);
      lastReported = state.log.length;
    }

    if (state.mode === null) {
      write(`\nSprint complete at ${new Date().toISOString()}`);
      break;
    }
  }

  // ── Final report ───────────────────────────────────────────────────────────
  const final = await page.evaluate(() => window._sprintLog ?? []);
  write('\n' + '═'.repeat(60));
  write('FINAL');
  report(`${CONFIG_TAG} — ${HANDS} hands`, final, startByName);
  write('═'.repeat(60));
  write(`Log: ${_logPath}`);

  await browser.close();
})();
