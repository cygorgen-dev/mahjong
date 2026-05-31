const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const FILE = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => console.log('[JS]', e.message));
  await page.addInitScript(() => localStorage.setItem('startPoints', '9999'));
  await page.goto(FILE);
  await page.waitForTimeout(1500);

  // Trigger via the hidden button (same as dropdown does)
  await page.evaluate(() => document.getElementById('run-all-tests-btn').click());

  // Wait for results
  await page.waitForFunction(() => window._testResults?.done === true, { timeout: 20000 });

  const results = await page.evaluate(() => window._testResults);
  console.log(`\n${results.passed}/${results.total} passed`);
  results.details.forEach(r =>
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : ': ' + r.why}`)
  );

  await browser.close();
  process.exit(results.failed > 0 ? 1 : 0);
})();
