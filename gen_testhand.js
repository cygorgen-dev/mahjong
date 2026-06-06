// gen_testhand.js — generate testhand.json for browser replay testing
// Plays hands until we get one where a human player wins (more interesting to replay).
// Falls back to any completed hand if no human win after 10 tries.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const FILE = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(FILE);
  await page.waitForTimeout(800);

  let bestSave = null;

  for (let attempt = 0; attempt < 15; attempt++) {
    await page.evaluate(() => { window.AUTO_MODE = null; });
    if (attempt > 0) await page.evaluate(() => window.game.redeal?.());
    await page.waitForTimeout(300);

    let done = false, acts = 0;
    while (!done && acts < 700) {
      await page.waitForFunction(() => {
        const g = window.game;
        if (!g) return false;
        if (g.phase === 'end') return true;
        if (g.phase === 'discard' && g.currentSeat === 0) return true;
        if (g.phase === 'claim' && g.claimOptions) return true;
        return false;
      }, { timeout: 10000 }).catch(() => {});

      const s = await page.evaluate(() => ({
        phase: window.game?.phase,
        cs: window.game?.currentSeat,
        co: window.game?.claimOptions ? {
          win: !!window.game.claimOptions.win,
          pung: !!window.game.claimOptions.pung,
          chow: !!window.game.claimOptions.chow,
        } : null,
      }));

      if (s.phase === 'end') { done = true; break; }

      if (s.phase === 'discard' && s.cs === 0) {
        await page.evaluate(() => {
          const g = window.game;
          const hand = g.players[0].hand.filter(t => !['flower','season'].includes(t.suit));
          if (hand.length) g.humanDiscard(hand[hand.length - 1].id);
        });
      } else if (s.phase === 'claim' && s.co) {
        await page.evaluate(() => {
          const g = window.game;
          const co = g.claimOptions;
          if (co.win)  { g.humanClaim('win', null); return; }
          if (co.pung) { g.humanClaim('pung', null); return; }
          if (co.chow) {
            const tile = g.discard;
            const hand = g.players[0].hand;
            for (let a = 0; a < hand.length; a++) {
              for (let b = a+1; b < hand.length; b++) {
                const three = [tile, hand[a], hand[b]];
                const vals = three.filter(t => t.suit === tile.suit).map(t => t.value).sort((x,y)=>x-y);
                if (vals.length===3 && vals[2]-vals[0]===2 && vals[1]-vals[0]===1) {
                  g.humanClaim('chow', [hand[a], hand[b]]);
                  return;
                }
              }
            }
          }
          g.humanPass();
        });
      } else {
        await page.waitForTimeout(80);
      }
      acts++;
      await page.waitForTimeout(25);
    }

    const raw = await page.evaluate(() => localStorage.getItem('mahjongReplay'));
    if (!raw) continue;
    const save = JSON.parse(raw);

    if (!save.moves?.length) {
      console.log(`  attempt ${attempt+1}: no moves[] (old save?), skipping`);
      continue;
    }

    const humanWon = save.winner === 'You';
    const hasWinMove = save.moves.some(m => m.a === 'W');
    console.log(`  attempt ${attempt+1}: winner=${save.winner} faan=${save.faan} moves=${save.moves.length} hasWinMove=${hasWinMove}`);

    if (!bestSave || humanWon) {
      bestSave = save;
      if (humanWon && hasWinMove) break; // ideal hand found
    }
  }

  if (!bestSave) {
    console.error('FAIL: could not generate any valid save');
    await browser.close(); process.exit(1);
  }

  fs.writeFileSync('testhand.json', JSON.stringify(bestSave, null, 2));
  console.log(`\nWrote testhand.json`);
  console.log(`  winner=${bestSave.winner}  faan=${bestSave.faan}  moves=${bestSave.moves.length}  log lines=${bestSave.log?.length}`);
  console.log(`\nTo load in browser console:`);
  console.log(`  fetch('./testhand.json').then(r=>r.text()).then(t=>{localStorage.setItem('mahjongReplay',t);console.log('✓ loaded — click Replay now')})`);

  await browser.close();
})();
