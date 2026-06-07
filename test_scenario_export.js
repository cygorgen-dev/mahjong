// test_scenario_export.js — verify scenario.html "Export Hand JSON" output
// Tests three paths: claim-phase discard win, self-drawn phase, discard phase no-tile.

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const FILE_URL = 'file:///' + path.resolve('scenario.html').replace(/\\/g, '/');
const TMP = path.join(__dirname, '_export_test_tmp.json');

// ── helpers ───────────────────────────────────────────────────────────────────
function check(label, cond, detail='') {
  if (!cond) throw new Error(`${label}${detail ? ': ' + detail : ''}`);
}

function tileKey(t) { return `${t.suit}|${t.value}`; }

function validateWall(wall) {
  check('wall length', wall.length === 144, `got ${wall.length}`);
  const counts = {};
  const max = { bamboo:4, circle:4, char:4, wind:4, dragon:4, flower:1, season:1 };
  for (const t of wall) {
    check('tile has suit+value', t && t.suit && t.value != null);
    const k = tileKey(t);
    counts[k] = (counts[k] || 0) + 1;
    check(`tile count ≤ max for ${k}`, counts[k] <= (max[t.suit] || 4), `got ${counts[k]}`);
  }
}

// ── run one export test ───────────────────────────────────────────────────────
async function runTest(page, label, setup, validate) {
  // Reset scenario.html state
  await page.evaluate(() => {
    [0,1,2,3].forEach(s => {
      players[s].hand=[];  players[s].melds=[];
      players[s].bonus=[]; players[s].drawnIdx=null;
    });
    discardTile = null;
    quickMode   = null;
    renderHands();
    renderDiscardPreview();
  });

  await page.evaluate(setup);

  let json;
  try {
    const dl = page.waitForEvent('download');
    await page.evaluate(() => exportHandJSON());
    const d = await dl;
    await d.saveAs(TMP);
    json = JSON.parse(fs.readFileSync(TMP, 'utf8'));
  } finally {
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
  }

  const errs = [];
  try { validate(json); }
  catch(e) { errs.push(e.message); }

  if (errs.length === 0) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    errs.forEach(e => console.log(`         ✗ ${e}`));
  }
  return errs.length === 0;
}

// ── test cases ────────────────────────────────────────────────────────────────
const TESTS = [

  {
    label: 'claim phase — CPU3 discards 中, CPU1 wins',
    setup: () => {
      // Seat 0: 13 scattered tiles (cannot win on 中)
      const S=SUIT;
      players[0].hand = [S.K,S.K,S.B,S.B,S.C,S.C,S.W,S.W,S.D].map((s,i)=>
        mk(s,[1,3,2,4,3,5,'North','South','green'][i]));
      // Seat 1: All-Pungs tenpai waiting for 中
      players[1].hand = [
        mk(S.K,1),mk(S.K,1),mk(S.K,1),
        mk(S.K,4),mk(S.K,4),mk(S.K,4),
        mk(S.K,7),mk(S.K,7),mk(S.K,7),
        mk(S.C,1),mk(S.C,1),mk(S.C,1),
        mk(S.D,'red'),
      ];
      // Seat 3 "discards" 中
      players[3].hand = [
        mk(S.B,1),mk(S.B,2),mk(S.B,3),mk(S.B,4),mk(S.B,5),mk(S.B,6),
        mk(S.B,7),mk(S.B,8),mk(S.B,9),mk(S.W,'East'),mk(S.W,'South'),mk(S.W,'West'),mk(S.W,'North'),
      ];
      discardTile = {...mk(S.D,'red'), _discardSeat:3};
      document.getElementById('inject-phase').value  = 'claim';
      document.getElementById('discard-from').value  = '3';
      document.getElementById('dealer-seat').value   = '0';
      document.getElementById('round-wind').value    = 'East';
      document.getElementById('exp-pass-winner').value = '1';
      document.getElementById('preset-name').value   = 'test-claim';
      renderDiscardPreview();
    },
    validate(j) {
      check('format',           j.format === 'mahjong-replay');
      check('scenario flag',    j.scenario === true);
      check('dealerSeat',       j.dealerSeat === 0);
      check('roundWind',        j.roundWind  === 'East');
      check('wall exists',      Array.isArray(j.wall));
      validateWall(j.wall);
      check('moves length',     j.moves?.length === 2, `got ${j.moves?.length}`);
      check('move[0] is D',     j.moves[0].a === 'D');
      check('move[0] seat',     j.moves[0].s === 0, `got ${j.moves[0].s}`);  // dealerSeat discards
      check('move[0] tile 中',  j.moves[0].t[0]==='dragon' && j.moves[0].t[1]==='red');
      check('move[1] is W',     j.moves[1].a === 'W');
      check('move[1] seat=1',   j.moves[1].s === 1);
      check('move[1] tile 中',  j.moves[1].t[0]==='dragon' && j.moves[1].t[1]==='red');
      check('expected.winnerSeat=1', j.expected?.winnerSeat === 1);
      // Seat 1 tiles should appear in wall at seat-1 deal positions
      const redCount = j.wall.filter(t => t.suit==='dragon' && t.value==='red').length;
      check('four 中 in wall',  redCount === 4, `got ${redCount}`);
    },
  },

  {
    label: 'self-drawn phase — seat 0 wins (Heavenly Hand style)',
    setup: () => {
      const S=SUIT;
      // Seat 0: complete 14-tile bamboo hand
      players[0].hand = [
        mk(S.B,1),mk(S.B,1),mk(S.B,1),
        mk(S.B,2),mk(S.B,3),mk(S.B,4),
        mk(S.B,5),mk(S.B,6),mk(S.B,7),
        mk(S.B,8),mk(S.B,9),
        mk(S.W,'East'),mk(S.W,'East'),mk(S.W,'East'),
      ];
      discardTile = null;
      document.getElementById('inject-phase').value  = 'self-drawn';
      document.getElementById('dealer-seat').value   = '0';
      document.getElementById('round-wind').value    = 'East';
      document.getElementById('exp-pass-winner').value = '0';
      document.getElementById('preset-name').value   = 'test-selfdrawn';
      renderDiscardPreview();
    },
    validate(j) {
      check('format',           j.format === 'mahjong-replay');
      check('wall exists',      Array.isArray(j.wall));
      validateWall(j.wall);
      check('moves length 1',   j.moves?.length === 1, `got ${j.moves?.length}`);
      check('move[0] is W',     j.moves[0].a === 'W');
      check('move[0] seat=0',   j.moves[0].s === 0);
      check('no tile in W',     j.moves[0].t == null);
      check('expected.winnerSeat=0', j.expected?.winnerSeat === 0);
      // Seat 0 dealer has 14 deal slots — all 14 hand tiles land in wall.
      // Full set has 4 copies of each numbered tile; 3 placed + 1 filler = 4 in wall.
      const bamboo1 = j.wall.filter(t => t.suit==='bamboo' && t.value===1).length;
      check('four 竹1 in wall (3 placed + 1 filler)', bamboo1 === 4, `got ${bamboo1}`);
    },
  },

  {
    label: 'discard phase, no discard tile — treated as self-draw win',
    setup: () => {
      const S=SUIT;
      players[0].hand = [
        mk(S.C,1),mk(S.C,2),mk(S.C,3),
        mk(S.C,4),mk(S.C,5),mk(S.C,6),
        mk(S.C,7),mk(S.C,8),mk(S.C,9),
        mk(S.W,'East'),mk(S.W,'East'),mk(S.W,'East'),
        mk(S.D,'red'),mk(S.D,'red'),
      ];
      discardTile = null;
      document.getElementById('inject-phase').value  = 'discard';
      document.getElementById('dealer-seat').value   = '0';
      document.getElementById('exp-pass-winner').value = '0';
      document.getElementById('preset-name').value   = 'test-discard-selfdraw';
      renderDiscardPreview();
    },
    validate(j) {
      check('wall exists',      Array.isArray(j.wall));
      validateWall(j.wall);
      check('moves length 1',   j.moves?.length === 1, `got ${j.moves?.length}`);
      check('move is W',        j.moves[0].a === 'W');
      check('move seat=0',      j.moves[0].s === 0);
      check('no tile in W',     j.moves[0].t == null);
    },
  },

  {
    label: 'no expected winner — moves[] absent',
    setup: () => {
      const S=SUIT;
      players[0].hand = [mk(S.K,1),mk(S.K,2),mk(S.K,3)];
      discardTile = null;
      document.getElementById('inject-phase').value  = 'discard';
      document.getElementById('dealer-seat').value   = '0';
      document.getElementById('exp-pass-winner').value = '-1';
      document.getElementById('preset-name').value   = 'test-no-winner';
      renderDiscardPreview();
    },
    validate(j) {
      check('wall exists',      Array.isArray(j.wall));
      validateWall(j.wall);
      check('no moves',         !j.moves || j.moves.length === 0,
            `got ${j.moves?.length} moves`);
      check('no expected',      j.expected == null);
    },
  },

];

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false });  // headed so download works
  const context = await browser.newContext({ acceptDownloads: true });
  const page    = await context.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => console.error('[JS]', e.message));
  await page.goto(FILE_URL);
  await page.waitForTimeout(600);

  let passed = 0, failed = 0;
  console.log(`\nRunning ${TESTS.length} export tests...\n`);

  for (const t of TESTS) {
    const ok = await runTest(page, t.label, t.setup, t.validate);
    ok ? passed++ : failed++;
  }

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  PASS ${passed}/${TESTS.length}   FAIL ${failed}`);
  console.log('═'.repeat(56));

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
