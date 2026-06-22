// test_undo_verify.js — verify Undo Last Move (snapshot-based)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('  [page-err]', m.text()); });

  await page.goto('file:///D:/claude/mahjong/index.html');
  await page.waitForFunction(() => window.game && window.game.phase !== undefined, { timeout: 5000 });
  await page.waitForTimeout(300);

  async function waitHumanTurn(timeout) {
    const deadline = Date.now() + (timeout || 10000);
    while (Date.now() < deadline) {
      const st = await page.evaluate(() => ({
        phase: window.game.phase,
        seat: window.game.currentSeat,
        claimOpts: !!window.game.claimOptions,
      }));
      if (st.phase === 'discard' && st.seat === 0) return true;
      if (st.phase === 'claim' && st.claimOpts) {
        await page.evaluate(() => window.game.humanPass());
        await page.waitForTimeout(60);
      } else {
        await page.waitForTimeout(60);
      }
    }
    throw new Error('Timeout waiting for human turn');
  }

  async function getState() {
    return page.evaluate(() => ({
      phase: window.game.phase,
      seat: window.game.currentSeat,
      handLen: window.game.players[0].hand.length,
      hand: window.game.players[0].hand.map(function(t) { return t.suit[0] + String(t.value).slice(0, 4); }),
      snapshots: window.game._undoSnapshots ? window.game._undoSnapshots.length : 0,
      discardPile: window.game.discardPile ? window.game.discardPile.length : 0,
      replayMode: !!window.REPLAY_MODE,
    }));
  }

  async function humanDiscardFirst() {
    await page.evaluate(() => {
      var id = window.game.players[0].hand[0].id;
      window.game.humanDiscard(id);
    });
  }

  var activeDialogHandler = null;
  async function clickUndo() {
    if (activeDialogHandler) {
      page.off('dialog', activeDialogHandler);
      activeDialogHandler = null;
    }
    var alertMsg = null;
    activeDialogHandler = function(d) {
      alertMsg = d.message();
      activeDialogHandler = null;
      d.dismiss();
    };
    page.once('dialog', activeDialogHandler);
    await page.evaluate(() => document.getElementById('undo-last-move-btn').click());
    await page.waitForTimeout(250);
    if (activeDialogHandler) {
      page.off('dialog', activeDialogHandler);
      activeDialogHandler = null;
    }
    return alertMsg;
  }

  var pass = 0, fail = 0;
  function check(label, ok, detail) {
    var sym = ok ? 'PASS' : 'FAIL';
    console.log('  [' + sym + '] ' + label + (detail ? '  (' + detail + ')' : ''));
    if (ok) pass++; else fail++;
  }

  await waitHumanTurn();
  var s0 = await getState();
  console.log('\n[Turn 1] hand: ' + s0.hand.join(' ') + ' | snapshots: ' + s0.snapshots);
  check('Starts with 0 snapshots', s0.snapshots === 0, 'got ' + s0.snapshots);
  check('14 tiles on first turn', s0.handLen === 14, 'got ' + s0.handLen);
  var hand_t1 = s0.hand.slice();

  await humanDiscardFirst();
  await page.waitForTimeout(100);
  var afterD1 = await getState();
  check('Snapshot created after discard 1', afterD1.snapshots === 1, 'got ' + afterD1.snapshots);

  await waitHumanTurn();
  var s1 = await getState();
  console.log('\n[Turn 2] hand: ' + s1.hand.join(' '));
  check('14 tiles on turn 2', s1.handLen === 14, 'got ' + s1.handLen);
  var hand_t2 = s1.hand.slice();

  await humanDiscardFirst();
  await page.waitForTimeout(100);
  var afterD2 = await getState();
  check('Snapshot created after discard 2', afterD2.snapshots === 2, 'got ' + afterD2.snapshots);

  await waitHumanTurn();

  console.log('\n-- Undo 1 (rewind to before discard 2) --');
  var a1 = await clickUndo();
  var u1 = await getState();
  console.log('[After undo 1] phase: ' + u1.phase + ' seat: ' + u1.seat + ' tiles: ' + u1.handLen + ' snapshots: ' + u1.snapshots);
  console.log('  hand: ' + u1.hand.join(' '));
  check('No alert on undo 1', a1 === null, a1 || 'ok');
  check('REPLAY_MODE off', !u1.replayMode);
  check('phase=discard seat=0', u1.phase === 'discard' && u1.seat === 0, 'phase=' + u1.phase + ' seat=' + u1.seat);
  check('14 tiles after undo 1', u1.handLen === 14, 'got ' + u1.handLen);
  check('1 snapshot remaining', u1.snapshots === 1, 'got ' + u1.snapshots);
  var hm1 = hand_t2.length === u1.hand.length && hand_t2.every(function(t) { return u1.hand.indexOf(t) >= 0; });
  check('Hand matches turn-2 snapshot', hm1, hm1 ? 'ok' : 'expected [' + hand_t2.join(' ') + '] got [' + u1.hand.join(' ') + ']');

  console.log('\n-- Undo 2 (rewind to before discard 1) --');
  var a2 = await clickUndo();
  var u2 = await getState();
  console.log('[After undo 2] phase: ' + u2.phase + ' seat: ' + u2.seat + ' tiles: ' + u2.handLen + ' snapshots: ' + u2.snapshots);
  console.log('  hand: ' + u2.hand.join(' '));
  check('No alert on undo 2', a2 === null, a2 || 'ok');
  check('phase=discard seat=0', u2.phase === 'discard' && u2.seat === 0, 'phase=' + u2.phase + ' seat=' + u2.seat);
  check('14 tiles after undo 2', u2.handLen === 14, 'got ' + u2.handLen);
  check('0 snapshots remaining', u2.snapshots === 0, 'got ' + u2.snapshots);
  var hm2 = hand_t1.length === u2.hand.length && hand_t1.every(function(t) { return u2.hand.indexOf(t) >= 0; });
  check('Hand matches turn-1 snapshot', hm2, hm2 ? 'ok' : 'expected [' + hand_t1.join(' ') + '] got [' + u2.hand.join(' ') + ']');

  console.log('\n-- Continue play after undo --');
  await humanDiscardFirst();
  await page.waitForTimeout(100);
  var p1 = await getState();
  check('New snapshot after post-undo discard', p1.snapshots === 1, 'got ' + p1.snapshots);
  await waitHumanTurn();
  var p2 = await getState();
  check('Continues to next turn normally', p2.phase === 'discard' && p2.seat === 0, 'phase=' + p2.phase);
  check('14 tiles on continued turn', p2.handLen === 14, 'got ' + p2.handLen);

  console.log('\n-- Undo to exhaustion --');
  await clickUndo(); // undo the post-undo discard (1 snapshot → 0)
  await page.waitForTimeout(100);
  var alertFired = await clickUndo(); // no snapshots → alert
  check('Alert fires when no snapshots remain', alertFired !== null, alertFired || 'none fired');

  console.log('\n-- ' + pass + ' passed, ' + fail + ' failed --');
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(function(err) { console.error('FATAL:', err); process.exit(1); });
