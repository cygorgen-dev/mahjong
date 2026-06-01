// combo.js — run a player-strategy configuration for N hands and report.
//
// Strategies (level + optional scheme) are assigned to player NAMES, not seats.
// After each full game (four wind rounds) the CPU players rotate seats, but
// each player carries their assigned strategy with them.
//
// Usage (positional — levels/schemes by player order: You CPU1 CPU2 CPU3):
//   node combo.js                            (all Expert, 200 hands)
//   node combo.js 3 3 3 3 200               (explicit levels + hands)
//   node combo.js 4 1                        (You=Master, CPU1=Beginner, rest Expert)
//   node combo.js 10 10 10 10 200            (scheme #10 for all four, 200 hands)
//   node combo.js 1 5 6 7 30                 (You=Beginner, CPU1=scheme#5, CPU2=scheme#6, CPU3=scheme#7, 30 hands)
//   node combo.js 3 3 3 3 50 verbose         (add hand-by-hand log after final report)
//
// Usage (named flags):
//   node combo.js --you 4 --cpus 1 --hands 500
//   node combo.js --cpu1 4 --cpu2 3 --cpu3 1
//
// Scheme flags (replace the level AI for that player):
//   --syou   <scheme-id>    YOU player scheme (by id string)
//   --scpu1  <scheme-id>    CPU1 player scheme
//   --scpu2  <scheme-id>    CPU2 player scheme
//   --scpu3  <scheme-id>    CPU3 player scheme
//
// Utility:
//   node combo.js list                       (list scheme numbers + IDs from game)
//   node combo.js --list-schemes             (same)
//
// Levels: 1=Beginner  2=Inter  3=Expert  4=Master
// Schemes: numbered starting at 5 (run 'node combo.js list' to see the full list)
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
  } else if (rawArgs[i].startsWith('-') && rawArgs[i].length > 1 && isNaN(rawArgs[i])) {
    flagMap[rawArgs[i].slice(1)] = rawArgs[i + 1] ?? true;
    i++;
  } else {
    positional.push(rawArgs[i]);
  }
}

// 'list' as first positional is an alias for --list-schemes
const LIST_SCHEMES = !!flagMap['list-schemes'] || positional[0] === 'list';
const effPos = positional[0] === 'list' ? positional.slice(1) : positional;

const DEFAULT_LEVEL = 3;
const DEFAULT_HANDS = 200;

// Parse a single player value: 1-4 → AI level, >=5 → scheme number (base level=Expert)
function parsePlayerVal(val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1) return { level: DEFAULT_LEVEL, schemeNum: null };
  if (n <= 4)             return { level: n,             schemeNum: null };
  return                         { level: DEFAULT_LEVEL, schemeNum: n   };
}

const YOU_PARSED = parsePlayerVal(flagMap['you'] ?? effPos[0]);
const HANDS      = parseInt(flagMap['hands'] ?? effPos[4] ?? DEFAULT_HANDS, 10);
const VERBOSE    = !!flagMap['verbose'] || effPos[5] === 'verbose';

let CPU_PARSED;
if (flagMap['cpus'] !== undefined) {
  const cpuParts = flagMap['cpus'].split(',');
  CPU_PARSED = [
    parsePlayerVal(cpuParts[0]),
    parsePlayerVal(cpuParts[1] ?? cpuParts[0]),
    parsePlayerVal(cpuParts[2] ?? cpuParts[0]),
  ];
} else {
  CPU_PARSED = [
    parsePlayerVal(flagMap['cpu1'] ?? effPos[1]),
    parsePlayerVal(flagMap['cpu2'] ?? effPos[2]),
    parsePlayerVal(flagMap['cpu3'] ?? effPos[3]),
  ];
}

const YOU_LEVEL  = YOU_PARSED.level;
const CPU_LEVELS = CPU_PARSED.map(p => p.level);

// Scheme numbers (>=5) from positionals — resolved to IDs after browser loads schemes
const SCHEME_NUMS = {
  You:  YOU_PARSED.schemeNum,
  CPU1: CPU_PARSED[0].schemeNum,
  CPU2: CPU_PARSED[1].schemeNum,
  CPU3: CPU_PARSED[2].schemeNum,
};

// Explicit scheme IDs from --syou / --scpu1 / --scpu2 / --scpu3 flags
const FLAG_SCHEME_IDS = {
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

function strategyTag(playerName, levelIdx, schemeName) {
  return schemeName || (LEVEL_LABELS[levelIdx] ?? `L${levelIdx}`);
}

function buildLogPath() {
  const parts = [
    YOU_PARSED.schemeNum ?? YOU_PARSED.level,
    ...CPU_PARSED.map(p => p.schemeNum ?? p.level),
  ];
  return path.join(__dirname, `combo_${parts.join('_')}_${HANDS}.log`);
}

let _logPath = null;
function write(line) {
  process.stdout.write(line + '\n');
  if (_logPath) fs.appendFileSync(_logPath, line + '\n');
}

function report(label, log, startByName) {
  const total = log.length;
  if (!total) return;

  const draws = log.filter(e => e.winnerSeat < 0).length;
  const wins  = total - draws;

  const nameSet = new Set();
  for (const e of log) for (const s of e.scores) nameSet.add(s.name);
  const names = PLAYER_NAMES.filter(n => nameSet.has(n));

  const byName = {};
  names.forEach(n => { byName[n] = { wins: 0, faan: 0 }; });

  for (const e of log) {
    if (e.winnerSeat >= 0 && e.winnerName && byName[e.winnerName] !== undefined) {
      byName[e.winnerName].wins++;
      byName[e.winnerName].faan += e.faan;
    }
  }

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

function printVerboseLog(log) {
  write('\n── Hand-by-hand log ──');
  write(`  ${'H'.padEnd(5)} ${'Winner'.padEnd(8)} ${'F'.padStart(2)}  ${'Scoring label'}`);
  write(`  ${'─'.repeat(5)} ${'─'.repeat(8)} ${'─'.repeat(2)}  ${'─'.repeat(34)}  ${'─'.repeat(32)}`);
  let prevByName = null;
  for (const e of log) {
    const hNum  = String(e.hand).padStart(3, '0');
    const who   = e.draw ? 'Draw' : (e.winnerName ?? '?');
    const fStr  = e.draw ? ' —' : String(e.faan).padStart(2);
    const lbl   = e.draw ? '' : (e.label ?? '');
    const currByName = {};
    for (const s of e.scores) currByName[s.name] = s.score;
    const deltas = e.scores.map(s => {
      const d = prevByName ? s.score - (prevByName[s.name] ?? s.score) : 0;
      return `${s.name}${d >= 0 ? '+' : ''}${d}`;
    }).join('  ');
    prevByName = currByName;
    write(`  H${hNum} ${who.padEnd(8)} ${fStr}  ${lbl.padEnd(34)}  ${deltas}`);
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
    console.log('\nAvailable schemes (use the # as a positional argument):\n');
    console.log(`  ${'#'.padEnd(4)} ${'ID'.padEnd(24)} Name`);
    console.log(`  ${'─'.repeat(4)} ${'─'.repeat(24)} ${'─'.repeat(30)}`);
    availableSchemes.forEach((s, i) => {
      const num = i + 5;
      console.log(`  ${String(num).padEnd(4)} ${s.id.padEnd(24)} ${s.name}`);
      console.log(`  ${''.padEnd(4)} ${''.padEnd(24)} ${s.desc}`);
      console.log();
    });
    console.log(`  Levels 1–4: Beginner / Inter / Expert / Master`);
    await browser.close();
    return;
  }

  // ── Resolve scheme numbers (>=5) to scheme IDs ────────────────────────────
  // Flag-based --syou/--scpu1 etc. take priority over positional scheme numbers.
  const SCHEMES_BY_PLAYER = {};
  for (const player of PLAYER_NAMES) {
    if (FLAG_SCHEME_IDS[player]) {
      SCHEMES_BY_PLAYER[player] = FLAG_SCHEME_IDS[player];
    } else if (SCHEME_NUMS[player] != null) {
      const idx = SCHEME_NUMS[player] - 5;
      if (idx < 0 || idx >= availableSchemes.length) {
        const maxNum = availableSchemes.length + 4;
        console.error(`\nScheme number ${SCHEME_NUMS[player]} for ${player} is out of range (valid: 5–${maxNum})`);
        console.error(`Run: node combo.js list  for the full numbered list`);
        process.exit(1);
      }
      SCHEMES_BY_PLAYER[player] = availableSchemes[idx].id;
    } else {
      SCHEMES_BY_PLAYER[player] = null;
    }
  }

  // ── Validate resolved scheme IDs ──────────────────────────────────────────
  const validIds    = new Set(availableSchemes.map(s => s.id));
  const schemeNames = {};
  for (const [player, id] of Object.entries(SCHEMES_BY_PLAYER)) {
    if (!id) { schemeNames[player] = null; continue; }
    if (!validIds.has(id)) {
      console.error(`\nUnknown scheme id for ${player}: "${id}"`);
      console.error(`Valid ids: ${[...validIds].join(', ')}`);
      console.error(`Run: node combo.js list  for details`);
      process.exit(1);
    }
    schemeNames[player] = availableSchemes.find(s => s.id === id).name;
  }

  // ── Build config tag ───────────────────────────────────────────────────────
  const allLevels = [YOU_LEVEL, ...CPU_LEVELS];
  const CONFIG_TAG = PLAYER_NAMES.map((name, i) =>
    `${name}=${strategyTag(name, allLevels[i], schemeNames[name])}`
  ).join('  ');

  _logPath = buildLogPath();
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
    const seats  = {};
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

  if (VERBOSE) printVerboseLog(final);

  await browser.close();
})();
