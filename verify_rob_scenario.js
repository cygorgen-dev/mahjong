// Verify LOAD→INJECT→VERIFY flow for last two scenarios
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 7780;

function serveStatic(req, res) {
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html':'text/html','.js':'application/javascript','.css':'text/css',
                    '.json':'application/json','.png':'image/png','.svg':'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

server.listen(PORT, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const gamePage = await context.newPage();
  gamePage.on('console', msg => {
    const t = msg.text();
    if (t.includes('[Scenario]') || t.toLowerCase().includes('error')) console.log('[GAME]', t.slice(0, 300));
  });
  gamePage.on('pageerror', err => console.log('[GAME ERROR]', err.message));
  await gamePage.goto(`${base}/index.html`);
  await gamePage.waitForTimeout(2000);
  console.log('Game page ready.');

  const scenPage = await context.newPage();
  await scenPage.goto(`${base}/scenario.html`);
  await scenPage.waitForTimeout(1500);
  console.log('Scenario page ready.');

  // Count face-up and back tiles on the game board
  async function countGameTiles() {
    return await gamePage.evaluate(() => {
      return {
        visible: document.querySelectorAll('.tile:not(.back)').length,
        back:    document.querySelectorAll('.tile.back').length,
      };
    });
  }

  // Get per-seat tile counts
  async function seatInfo() {
    return await gamePage.evaluate(() => {
      return Array.from(document.querySelectorAll('.seat')).map(s => ({
        seat: s.dataset.seat,
        hand: s.querySelectorAll('.hand .tile').length,
        melds: s.querySelectorAll('.melds .tile').length,
      }));
    });
  }

  // List all built-in preset names
  const presetNames = await scenPage.evaluate(() =>
    Array.from(document.querySelectorAll('#preset-list .preset-item .pi-name')).map(el => el.textContent.trim())
  );
  console.log('\nBuilt-in presets found:', presetNames);

  const targets = ['★ Pass → Right wins (混一色)', '★ Rob Kong Win — CPU3 robs 搶槓胡'];

  for (const name of targets) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SCENARIO: ${name}`);

    // Click the Load button for this specific preset
    const loaded = await scenPage.evaluate(targetName => {
      const items = document.querySelectorAll('#preset-list .preset-item');
      for (const item of items) {
        if (item.querySelector('.pi-name')?.textContent.trim() === targetName) {
          const btn = item.querySelector('button');
          if (btn) { btn.click(); return true; }
        }
      }
      return false;
    }, name);
    console.log(`  LOAD clicked: ${loaded}`);
    await scenPage.waitForTimeout(800);

    // Read loaded state from scenario page status log
    const loadedMsg = await scenPage.evaluate(() => {
      const el = document.getElementById('status-log');
      return el ? el.innerText.split('\n').filter(l => l.trim()).slice(-3).join(' | ') : '(no log)';
    });
    console.log(`  Status after LOAD: ${loadedMsg}`);

    const before = await countGameTiles();
    console.log(`  Tiles before INJECT: face-up=${before.visible} back=${before.back}`);
    await gamePage.screenshot({ path: path.join(ROOT, `vrob_${name.replace(/[^a-z0-9]/gi,'_').slice(0,30)}_before.png`) });

    // Click INJECT
    await scenPage.click('#inject-btn');
    await scenPage.waitForTimeout(1500);

    const after = await countGameTiles();
    const seats = await seatInfo();
    console.log(`  Tiles after INJECT:  face-up=${after.visible} back=${after.back}`);
    console.log('  Seat breakdown:', JSON.stringify(seats));

    const gamePhase = await gamePage.evaluate(() => window.game?.phase ?? 'unknown');
    console.log(`  Game phase: ${gamePhase}`);

    const shotName = `vrob_${name.replace(/[^a-z0-9]/gi,'_').slice(0,30)}_after.png`;
    await gamePage.screenshot({ path: path.join(ROOT, shotName) });
    console.log(`  Screenshot: ${shotName}`);

    // Click VERIFY
    await scenPage.click('#verify-btn');
    await scenPage.waitForTimeout(800);

    const verifyLog = await scenPage.evaluate(() => {
      const el = document.getElementById('status-log');
      return el ? el.innerText.split('\n').filter(l => l.trim()).slice(-5).join('\n') : '(no log)';
    });
    console.log(`  Verify result:\n${verifyLog.split('\n').map(l => '    ' + l).join('\n')}`);

    const shotVerify = `vrob_${name.replace(/[^a-z0-9]/gi,'_').slice(0,30)}_verify.png`;
    await gamePage.screenshot({ path: path.join(ROOT, shotVerify) });
    await scenPage.screenshot({ path: path.join(ROOT, shotVerify.replace('_verify','_scen') ) });
  }

  console.log('\nDone.');
  await browser.close();
  server.close();
  process.exit(0);
});
