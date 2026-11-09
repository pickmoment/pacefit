/* Optional popup/browser QA. Requires Playwright and local Chrome/Chromium. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PACEFIT_CHROME ? { executablePath: process.env.PACEFIT_CHROME } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 850 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'extension/popup.html')).href);
    await page.getByRole('button', { name: '1.5×', exact: true }).click();
    await page.locator('#rate-up').evaluate(button => { for (let i = 0; i < 10; i++) button.click(); });
    assert.equal(await page.locator('#rate-input').inputValue(), '2.50');
    assert.equal(await page.locator('#preset-a').textContent(), 'A · 2.5×');
    await page.locator('#toggle-rate').click();
    assert.equal(await page.locator('#rate-input').inputValue(), '2.00');
    assert.equal(await page.locator('#preset-b').getAttribute('aria-pressed'), 'true');
    await page.locator('#rate-input').fill('2.3'); await page.locator('#rate-input').press('Tab');
    assert.equal(await page.locator('#preset-b').textContent(), 'B · 2.3×');
    assert.equal(await page.locator('#preset-a').textContent(), 'A · 2.5×');
    await page.locator('#toggle-rate').click();
    assert.equal(await page.locator('#rate-input').inputValue(), '2.50');
    await page.locator('#preset-b').click();
    assert.equal(await page.locator('#rate-input').inputValue(), '2.30');
    await page.locator('#preset-a').click();
    await page.locator('#save-favorite').click();
    await page.getByRole('button', { name: '1×', exact: true }).click();
    await page.locator('#favorite').click();
    assert.equal(await page.locator('#rate-input').inputValue(), '2.50');
    await page.locator('#rate-input').fill('8'); await page.locator('#rate-input').press('Tab');
    assert.equal(await page.locator('#rate-input').inputValue(), '4.00');
    assert.equal(await page.locator('#rate-up').isDisabled(), true);
    await page.locator('#rate-input').fill(''); await page.locator('#rate-input').press('Tab');
    assert.equal(await page.locator('#rate-input').inputValue(), '4.00');
    await page.locator('#preferences > summary').click(); await page.locator('#step').selectOption('0.25');
    await page.locator('#shortcuts').uncheck();
    assert.equal(await page.locator('#keyboard-guide').isVisible(), false);
    await page.locator('#shortcuts').check(); await page.locator('#preferences > summary').click();
    await page.getByRole('button', { name: '1.5×', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#toast').hidden);
    await page.locator('h1').click();
    await page.screenshot({ path: path.join(root, 'docs/preview.png'), fullPage: true, animations: 'disabled' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('Popup browser checks passed: rapid actions, return speed, favorites, input bounds, settings, keyboard guide, layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
