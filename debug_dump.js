// debug_dump.js — extract the last Dump State snapshot from localStorage → debug.json
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();
  const filePath = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
  await page.goto(filePath);
  await page.waitForTimeout(600);

  const raw = await page.evaluate(() => localStorage.getItem('mahjongDebugDump'));
  if (!raw) {
    console.log('No debug dump found — click 🐛 Dump State in the game first.');
    await browser.close(); process.exit(1);
  }

  fs.writeFileSync('debug.json', raw, 'utf8');
  const data = JSON.parse(raw);
  console.log(`Saved: ${data.savedAt}  version: ${data.version}`);
  console.log(`Phase: ${data.phase}  seat: ${data.currentSeat}  wall left: ${data.wallRemaining}`);
  data.players.forEach(p => {
    console.log(`  ${p.name} (seat ${p.seat}): hand=${p.handCount} melds=${p.meldCount} score=${p.score}`);
  });
  console.log(`\nFull dump written to debug.json`);

  await browser.close();
  process.exit(0);
})();
