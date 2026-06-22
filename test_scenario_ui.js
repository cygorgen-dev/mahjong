// test_scenario_ui.js — verify scenario.html UI fixes (DOM-driven)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type()==='error') console.error('  [page-err]',m.text()); });

  await page.goto('file:///D:/claude/mahjong/scenario.html');
  await page.waitForSelector('#palette', { timeout: 5000 });
  await page.waitForTimeout(300);

  var pass=0, fail=0;
  function check(label, ok, detail) {
    console.log('  ['+(ok?'PASS':'FAIL')+'] '+label+(detail != null ? '  ('+detail+')' : ''));
    if (ok) pass++; else fail++;
  }

  async function pickTile(suit, value) {
    await page.click('#pb-'+suit+'-'+value);
    await page.waitForTimeout(60);
  }

  // Cancel any active quick mode (click the lit-up button to toggle it off)
  async function cancelQuickMode() {
    var active = await page.$('.qa.active-q');
    if (active) { await active.click(); await page.waitForTimeout(30); }
  }

  // Count only HAND tiles (not meld/bonus tiles) via DOM
  async function handTileCount(seat) {
    return page.evaluate(s => {
      var cards = document.querySelectorAll('.player-card');
      // The hand section is separated from melds by a meld-sep before the "Hand" label.
      // Easiest: count tiles that are NOT in-meld and NOT flower/season (bonus)
      var tiles = cards[s].querySelectorAll('.pc-hand .ht:not(.in-meld):not(.flower):not(.season)');
      return tiles.length;
    }, seat);
  }

  async function getDOM() {
    return page.evaluate(() => {
      var cards = Array.from(document.querySelectorAll('.player-card'));
      return {
        targetSeat: cards.findIndex(c => c.classList.contains('target')),
        insertCursors: document.querySelectorAll('.insert-cursor').length,
        selectBtns: document.querySelectorAll('.player-card:not(.target) .btn-green').length,
        bamboo1Full: document.getElementById('pb-bamboo-1')?.classList.contains('tb-full') ?? null,
        allTileCounts: cards.map(c => c.querySelectorAll('.pc-hand .ht').length),
        meldCounts: cards.map(c => c.querySelectorAll('.pc-hand .meld-label').length),
        bonusCounts: cards.map(c => c.querySelectorAll('.pc-hand .flower, .pc-hand .season').length),
      };
    });
  }

  // ── Issue 1: Auto-activate on card click ─────────────────────────────────
  console.log('\n-- Issue 1: Auto-activate on card click --');

  var d0 = await getDOM();
  check('Starts on seat 0', d0.targetSeat === 0, 'seat='+d0.targetSeat);

  await page.evaluate(() => document.querySelectorAll('.player-card')[2].click());
  await page.waitForTimeout(100);
  var d1 = await getDOM();
  check('Clicking seat-2 card activates seat 2', d1.targetSeat === 2, 'seat='+d1.targetSeat);

  await page.evaluate(() => document.querySelectorAll('.player-card')[3].querySelector('.pc-hand').click());
  await page.waitForTimeout(100);
  var d2 = await getDOM();
  check('Clicking seat-3 hand area activates seat 3', d2.targetSeat === 3, 'seat='+d2.targetSeat);

  check('No explicit Select buttons on inactive cards', d2.selectBtns === 0, 'found '+d2.selectBtns);

  // Back to seat 0
  await page.evaluate(() => document.querySelectorAll('.player-card')[0].click());
  await page.waitForTimeout(60);

  // ── Issue 3: Tile count enforcement ──────────────────────────────────────
  console.log('\n-- Issue 3: Tile count enforcement --');

  for (var i = 0; i < 4; i++) await pickTile('bamboo', 1);
  var hc1 = await handTileCount(0);
  check('Can add 4x bamboo-1', hc1 === 4, 'got '+hc1);

  await pickTile('bamboo', 1);
  var hc2 = await handTileCount(0);
  check('5th bamboo-1 blocked (still 4)', hc2 === 4, 'got '+hc2);

  var d3 = await getDOM();
  check('Bamboo-1 palette tile dimmed (tb-full)', d3.bamboo1Full === true, '');

  // Flower bonus — max 1
  await pickTile('flower', 0);
  var bonusDom = await page.evaluate(() =>
    document.querySelectorAll('.player-card')[0].querySelectorAll('.pc-hand .flower, .pc-hand .season').length
  );
  check('Can add 1 flower (bonus section shows it)', bonusDom >= 1, 'got '+bonusDom);

  // 2nd flower-0 blocked via bonus quickmode
  await page.click('#q-bonus');
  await page.waitForTimeout(30);
  await pickTile('flower', 0);
  var bonusDom2 = await page.evaluate(() =>
    document.querySelectorAll('.player-card')[0].querySelectorAll('.pc-hand .flower, .pc-hand .season').length
  );
  check('2nd flower-0 blocked (still 1 in bonus)', bonusDom2 === bonusDom, 'got '+bonusDom2);
  await cancelQuickMode(); // cancel bonus mode

  // Pung bamboo-2 (0 used → 3 needed → allowed)
  await page.click('#q-pung');
  await page.waitForTimeout(50);
  await pickTile('bamboo', 2);
  var mld1 = await page.evaluate(() =>
    document.querySelectorAll('.player-card.target .meld-label').length
  );
  check('Pung of bamboo-2 added as meld (1 meld-label)', mld1 >= 1, 'labels='+mld1);

  // 2nd pung of bamboo-2 blocked (6 > 4)
  await page.click('#q-pung');
  await page.waitForTimeout(50);
  await pickTile('bamboo', 2);
  var mld2 = await page.evaluate(() =>
    document.querySelectorAll('.player-card.target .meld-label').length
  );
  check('2nd pung of bamboo-2 blocked (same meld count)', mld2 === mld1, 'labels='+mld2);
  await cancelQuickMode(); // ← critical: clear stuck 'pung' mode

  // ── Issue 2: Delete then insert ──────────────────────────────────────────
  console.log('\n-- Issue 2: Delete then insert --');

  // clearPlayer is a function declaration → accessible on window
  await page.evaluate(() => window.clearPlayer(0));
  await page.waitForTimeout(80);
  var dClr = await getDOM();
  check('Seat 0 active after clear', dClr.targetSeat === 0, 'seat='+dClr.targetSeat);
  check('Seat 0 has 0 tiles after clear', dClr.allTileCounts[0] === 0, 'got '+dClr.allTileCounts[0]);

  await pickTile('circle', 1);
  await pickTile('circle', 2);
  await pickTile('circle', 3);
  var hc3 = await handTileCount(0);
  check('Added c1 c2 c3 → 3 hand tiles', hc3 === 3, 'got '+hc3);

  // Click tile[1] (c2) to delete it — these are hand tiles, index matches hand index
  var htTiles = await page.$$('.player-card.target .pc-hand .ht');
  check('3 .ht tiles rendered', htTiles.length === 3, 'got '+htTiles.length);
  if (htTiles.length >= 2) {
    await htTiles[1].click();
    await page.waitForTimeout(100);
  }
  var hc4 = await handTileCount(0);
  var dAfterDel = await getDOM();
  check('Deleted tile → 2 hand tiles remain', hc4 === 2, 'got '+hc4);
  check('Seat 0 still active after delete', dAfterDel.targetSeat === 0, 'seat='+dAfterDel.targetSeat);

  // Add circle-2 back — appends to end
  await pickTile('circle', 2);
  var hc5 = await handTileCount(0);
  check('Re-added c2 appended (3 hand tiles again)', hc5 === 3, 'got '+hc5);

  // ── Ctrl+click insert mode ────────────────────────────────────────────────
  console.log('\n-- Ctrl+click insert mode --');

  // Use direct API call to setInsertBefore (function declaration → window accessible)
  // and also test via keyboard-assisted click
  var hc6 = await handTileCount(0);
  check('3 hand tiles before insert test', hc6 === 3, 'got '+hc6);

  // Test 1: direct API call to setInsertBefore(0, 1)
  await page.evaluate(() => window.setInsertBefore(0, 1));
  await page.waitForTimeout(80);
  var d11 = await getDOM();
  check('setInsertBefore(0,1) → cursor appears', d11.insertCursors === 1, 'got '+d11.insertCursors);

  // Pick circle-5 → inserts before idx 1 → hand = c1 c5 c3 c2
  await pickTile('circle', 5);
  var hc7 = await handTileCount(0);
  var d12 = await getDOM();
  check('Hand grows to 4 after insert', hc7 === 4, 'got '+hc7);
  check('Cursor gone after insert', d12.insertCursors === 0, 'got '+d12.insertCursors);

  // Test 2: ctrl+click via keyboard down/up (more reliable than modifiers option)
  htTiles = await page.$$('.player-card.target .pc-hand .ht');
  check('4 tiles before ctrl+click test', htTiles.length === 4, 'got '+htTiles.length);
  if (htTiles.length >= 2) {
    await page.keyboard.down('Control');
    await htTiles[1].click();
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
  }
  var d13 = await getDOM();
  check('Ctrl+click on tile → insert cursor appears', d13.insertCursors === 1, 'got '+d13.insertCursors);
  check('Hand tile count unchanged after ctrl+click (not deleted)', await handTileCount(0) === 4, 'got '+await handTileCount(0));

  // Esc cancels
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  var dEsc = await getDOM();
  check('Esc cancels insert mode (cursor gone)', dEsc.insertCursors === 0, 'got '+dEsc.insertCursors);
  check('Hand count still 4 after Esc', await handTileCount(0) === 4, '');

  // Switching seat cancels insertBefore
  await page.evaluate(() => window.setInsertBefore(0, 0));
  await page.waitForTimeout(50);
  var dPreSwitch = await getDOM();
  check('insertBefore active before seat switch', dPreSwitch.insertCursors === 1, '');
  await page.evaluate(() => document.querySelectorAll('.player-card')[1].click());
  await page.waitForTimeout(80);
  var dPostSwitch = await getDOM();
  check('Seat switch clears insertBefore', dPostSwitch.insertCursors === 0, 'got '+dPostSwitch.insertCursors);
  check('Seat 1 now active', dPostSwitch.targetSeat === 1, 'seat='+dPostSwitch.targetSeat);

  // Insert at front (idx 0)
  console.log('\n-- Insert at front (idx 0) --');
  await page.evaluate(() => document.querySelectorAll('.player-card')[0].click());
  await page.waitForTimeout(50);
  await page.evaluate(() => window.setInsertBefore(0, 0));
  await page.waitForTimeout(50);
  var dFront = await getDOM();
  check('Cursor at front', dFront.insertCursors === 1, 'got '+dFront.insertCursors);
  await pickTile('bamboo', 9);
  var hcFront = await handTileCount(0);
  var dFrontAfter = await getDOM();
  check('Tile inserted at front → 5 hand tiles', hcFront === 5, 'got '+hcFront);
  check('Cursor gone after front insert', dFrontAfter.insertCursors === 0, '');

  console.log('\n-- '+pass+' passed, '+fail+' failed --');
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
