// test_moves_from_log.js — verify movesFromLog() against saved moves[]
// Parses the log[] to reconstruct moves[], then replays using the derived queue

const NUM_ZH   = ['','一','二','三','四','五','六','七','八','九'];
const SUIT_ZH  = { bamboo:'竹', circle:'餅', char:'萬' };
const WIND_ZH  = ['東','南','西','北'];
const WINDS    = ['East','South','West','North'];
const DRAGON_ZH = { red:'中', green:'發', white:'白' };
const FLOWER_ZH = ['梅','蘭','菊','竹'];
const SEASON_ZH = ['春','夏','秋','冬'];

// Build reverse map once
const ZH_TO_TILE = {};
for (const [suit, zh] of Object.entries(SUIT_ZH)) {
  for (let v = 1; v <= 9; v++) ZH_TO_TILE[NUM_ZH[v] + zh] = [suit, v];
}
WINDS.forEach((w, i) => ZH_TO_TILE[WIND_ZH[i]] = ['wind', w]);
for (const [val, zh] of Object.entries(DRAGON_ZH)) ZH_TO_TILE[zh] = ['dragon', val];
FLOWER_ZH.forEach((zh, i) => { if (!ZH_TO_TILE[zh]) ZH_TO_TILE[zh] = ['flower', i]; });
SEASON_ZH.forEach((zh, i) => ZH_TO_TILE[zh] = ['season', i]);

function parseTileZh(str) {
  return ZH_TO_TILE[str.trim()] ?? null;
}

function movesFromLog(log) {
  const moves = [];
  let lastEvt = null; // { type, seat, tile }

  for (const line of log) {
    let m;

    // Seat X discards TILE
    m = line.match(/^Seat (\d) discards (.+)$/);
    if (m) {
      const s = parseInt(m[1]);
      const t = parseTileZh(m[2]);
      if (t) { moves.push({ a: 'D', s, t }); lastEvt = { type: 'discard', seat: s, tile: t }; }
      continue;
    }

    m = line.match(/^Seat (\d) draws /);
    if (m) { lastEvt = { type: 'draw', seat: parseInt(m[1]) }; continue; }

    m = line.match(/^Seat (\d) bonus replacement:/);
    if (m) { lastEvt = { type: 'bonus', seat: parseInt(m[1]) }; continue; }

    m = line.match(/^Seat (\d) kong replacement:/);
    if (m) { lastEvt = { type: 'kong-replace', seat: parseInt(m[1]) }; continue; }

    // Seat X Pung 碰 TILE
    m = line.match(/^Seat (\d) Pung 碰 (.+)$/);
    if (m) {
      const t = parseTileZh(m[2]);
      if (t) moves.push({ a: 'P', s: parseInt(m[1]), t });
      continue;
    }

    // Seat X Chow 上 TILE [H1 H2]
    m = line.match(/^Seat (\d) Chow 上 (.+?) \[(.+)\]$/);
    if (m) {
      const t = parseTileZh(m[2]);
      const h = m[3].split(' ').map(parseTileZh).filter(Boolean);
      if (t) moves.push({ a: 'C', s: parseInt(m[1]), t, h });
      continue;
    }

    // Seat X declares Kong 槓 TILE — can be robbed!  (self-kong, robbable)
    m = line.match(/^Seat (\d) declares Kong 槓 (.+?) — can be robbed!$/);
    if (m) {
      const s = parseInt(m[1]), t = parseTileZh(m[2]);
      if (t) { moves.push({ a: 'KS', s, t }); lastEvt = { type: 'kong-declare', seat: s, tile: t }; }
      continue;
    }

    // Seat X Concealed Kong 暗槓 TILE  (self-kong, concealed hand)
    m = line.match(/^Seat (\d) Concealed Kong 暗槓 (.+)$/);
    if (m) { const t = parseTileZh(m[2]); if (t) moves.push({ a: 'KS', s: parseInt(m[1]), t }); continue; }

    // Seat X Kong 槓 TILE  (KO = claimed from discard; KS = self-kong pung upgrade, no robbers)
    m = line.match(/^Seat (\d) Kong 槓 (.+?)(\s+\(.*\))?$/);
    if (m) {
      const s = parseInt(m[1]), t = parseTileZh(m[2].trim());
      if (t) {
        const isKO = lastEvt?.type === 'discard' && lastEvt.seat !== s;
        moves.push({ a: isKO ? 'KO' : 'KS', s, t });
      }
      continue;
    }

    // 🏆 Seat X WINS!
    m = line.match(/^🏆 Seat (\d) WINS!/);
    if (m) {
      const s = parseInt(m[1]);
      if (lastEvt?.type === 'discard' && lastEvt.seat !== s)
        moves.push({ a: 'W', s, t: lastEvt.tile });
      else if (lastEvt?.type === 'kong-declare' && lastEvt.seat !== s)
        moves.push({ a: 'W', s, t: lastEvt.tile });
      else
        moves.push({ a: 'W', s });
      continue;
    }
  }

  return moves;
}

// ── Test against testhandExhausted.json ──────────────────────────────────────
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const FILE = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');

// Also try against any mj-*.json files in the directory
const testFiles = ['testhandExhausted.json', 'testhand.json',
  ...fs.readdirSync('.').filter(f => f.match(/^mj-\d+\.json$/))
].filter(f => fs.existsSync(f));

console.log('Files to test:', testFiles);

(async () => {
  const browser = await chromium.launch({ headless: true });

  let allPassed = true;

  for (const filename of testFiles) {
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!data.wall || !data.dice) { console.log(`  ${filename}: no wall/dice, skip`); continue; }
    if (!data.moves?.length && !data.log?.length) { console.log(`  ${filename}: no moves or log (pre-log save), skip`); continue; }

    const logChronological = data.log ? [...data.log] : [];
    // log is stored chronological already (reversed in _saveReplay)
    const derived = movesFromLog(logChronological);

    console.log(`\n── ${filename} ──`);
    console.log(`  saved moves: ${data.moves?.length ?? 'none'}`);
    console.log(`  derived moves: ${derived.length}`);
    console.log(`  winner: ${data.winner}  faan: ${data.faan}`);

    // Compare derived vs saved if both exist
    if (data.moves?.length && derived.length) {
      let mismatches = 0;
      const maxCmp = Math.min(data.moves.length, derived.length);
      for (let i = 0; i < maxCmp; i++) {
        const s = JSON.stringify(data.moves[i]);
        const d2 = JSON.stringify(derived[i]);
        if (s !== d2) {
          console.log(`  mismatch[${i}]: saved=${s}  derived=${d2}`);
          if (++mismatches >= 5) { console.log('  (stopped at 5)'); break; }
        }
      }
      if (mismatches === 0) console.log(`  ✓ derived matches saved moves`);
    }

    // Now replay using derived moves
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => console.log('  [js error]', e.message));
    await page.goto(FILE);
    await page.waitForTimeout(600);

    const replayOk = await page.evaluate(({ dataStr, derivedMoves }) => {
      const data = JSON.parse(dataStr);
      data.moves = derivedMoves; // inject derived moves
      window.REPLAY_MODE = true;
      window._replayData = data;
      window.game.applyReplayContext(data);
      window.game.redeal();
      return true;
    }, { dataStr: JSON.stringify(data), derivedMoves: derived });

    await page.waitForTimeout(400);

    let steps = 0, reached = false;
    const maxSteps = derived.length * 5 + 300;
    while (steps < maxSteps) {
      const ph = await page.evaluate(() => window.game?.phase);
      if (ph === 'end') { reached = true; break; }
      await page.evaluate(() => {
        if (window.REPLAY_MODE && window.game?.phase !== 'end') window.game.replayStep();
      });
      steps++;
      await page.waitForTimeout(25);
    }

    const result = await page.evaluate(() => ({
      phase: window.game?.phase,
      mqLen: window._moveQueue?.length ?? 0,
    }));

    const ok = reached && result.phase === 'end';
    console.log(`  replay: reachedEnd=${reached}  steps=${steps}  phase=${result.phase}`);
    console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}`);
    if (!ok) allPassed = false;

    await page.close();
  }

  console.log('\n══════════════════════════════════════');
  console.log(allPassed ? '✅ ALL PASS' : '❌ SOME FAILED');
  console.log('══════════════════════════════════════');

  await browser.close();
  process.exit(allPassed ? 0 : 1);
})();
