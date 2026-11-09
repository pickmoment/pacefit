/* Real-media regressions for player resets, remembered preference, and adjustable A/B presets. */
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pacefit-retention-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: 1000, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
      ...(process.env.PACEFIT_CHROME ? { executablePath: process.env.PACEFIT_CHROME } : {})
    });
    context.setDefaultTimeout(10000);
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
    const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/watch.html'), 'utf8');
    await context.route(/https:\/\/(?:www\.youtube\.com|video\.test)\//, route => route.fulfill({ contentType: 'text/html', body: fixture }));
    const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    const page = await context.newPage(); await page.goto('https://www.youtube.com/watch?v=first');
    await page.bringToFront(); await popup.reload();
    await popup.waitForFunction(() => document.getElementById('connection').textContent === '연결됨');
    const waitRate = value => page.waitForFunction(rate => document.querySelector('video').playbackRate === rate, value);
    const savedRate = () => popup.evaluate(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings.manualRate);
    const preset = value => popup.getByRole('button', { name: `${value}×`, exact: true }).click();
    const waitFeedback = visible => page.waitForFunction(show => {
      const controller = document.getElementById('pacefit-controller');
      return controller && controller.hasAttribute('data-feedback') === show;
    }, visible);
    await waitFeedback(true);
    assert.equal(await page.locator('#pacefit-controller #feedback').textContent(), 'A · 1×');
    await waitFeedback(false);
    // Resuming the same video must not repeatedly show the opening notification.
    await page.locator('video').evaluate(async video => { video.pause(); await video.play(); });
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#pacefit-controller').evaluate(host => host.hasAttribute('data-feedback')), false);
    const navigate = async value => page.evaluate(id => {
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({}, '', `/watch?v=${id}`); document.dispatchEvent(new Event('yt-navigate-finish'));
      // A real player can reset after the extension has already applied its preference.
      setTimeout(() => { document.querySelector('video').playbackRate = 1; }, 150);
    }, value);
    await preset(2); await waitRate(2);
    await navigate('delayed-reset'); await page.waitForTimeout(650);
    const afterReset = { actual: await page.locator('video').evaluate(v => v.playbackRate), remembered: await savedRate() };
    console.log('Delayed reset:', afterReset);
    assert.equal(afterReset.remembered, 2, 'A player reset must not become a saved user preference');
    assert.equal(afterReset.actual, 2, 'The remembered speed must be restored after initialization');
    await waitFeedback(true);
    assert.equal(await page.locator('#pacefit-controller #feedback').textContent(), 'A · 2×');
    await waitFeedback(false);

    // Native resets before and after metadata/playing events.
    await page.evaluate(() => {
      const video = document.querySelector('video');
      video.dispatchEvent(new Event('emptied')); video.playbackRate = 1;
      video.dispatchEvent(new Event('loadedmetadata')); video.dispatchEvent(new Event('playing'));
      setTimeout(() => { video.playbackRate = 1; }, 200);
    });
    await page.waitForTimeout(650); await waitRate(2); assert.equal(await savedRate(), 2);
    // Adjusting A and B saves each slot, independently of the order of recent speeds.
    await preset(1.5); await waitRate(1.5);
    await popup.locator('#preset-b').click(); await waitRate(2);
    await popup.locator('#rate-input').fill('2.3'); await popup.locator('#rate-input').press('Tab'); await waitRate(2.3);
    await popup.waitForFunction(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings.presetRateB === 2.3);
    await popup.locator('#toggle-rate').click(); await waitRate(1.5);
    await popup.waitForFunction(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings.manualRate === 1.5);
    await navigate('after-popup-toggle'); await page.waitForTimeout(650); await waitRate(1.5);
    await page.locator('h1').click(); await page.keyboard.press('\\'); await waitRate(2.3);
    assert.equal(await page.locator('#pacefit-controller #feedback').textContent(), 'B · 2.3×');
    assert.equal(await page.locator('#pacefit-controller #speed').textContent(), 'B · 2.3×');
    await popup.waitForFunction(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings.activePreset === 'B');
    // Adjust B via keyboard as well, then recall A without replacing either slot with the previous rate.
    await page.keyboard.press(']'); await waitRate(2.4);
    await popup.waitForFunction(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings.presetRateB === 2.4);
    await page.keyboard.press('\\'); await waitRate(1.5);
    await page.keyboard.press('\\'); await waitRate(2.4);
    await popup.waitForFunction(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings.manualRate === 2.4);
    const stored = await popup.evaluate(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings);
    assert.equal(stored.presetRateA, 1.5); assert.equal(stored.presetRateB, 2.4);
    await navigate('after-keyboard-toggle'); await page.waitForTimeout(650); await waitRate(2.4);
    // The in-player A/B buttons use the same saved slots.
    await page.locator('#movie_player').hover({ position: { x: 500, y: 350 } });
    await page.locator('#pacefit-controller #speed').click();
    await page.locator('#pacefit-controller #preset-a').click(); await waitRate(1.5);
    await page.locator('#pacefit-controller #faster').click(); await waitRate(1.6);
    await page.locator('#pacefit-controller #toggle').click(); await waitRate(2.4);
    await page.locator('#pacefit-controller #toggle').click(); await waitRate(1.6);
    await page.mouse.move(1, 1);
    await preset(2); await waitRate(2);

    // Explicit 1x is also remembered as usual.
    await preset(1); await waitRate(1); assert.equal(await savedRate(), 1);
    await navigate('explicit-normal'); await page.waitForTimeout(650); await waitRate(1);
    await preset(2); await waitRate(2);

    // Genuine native UI selections are honored on the current media, without rewriting preference.
    await page.evaluate(() => {
      const button = document.createElement('button'); button.id = 'native-speed'; button.textContent = '1.25×';
      button.setAttribute('aria-label', '재생 속도 1.25배');
      button.onclick = () => { document.querySelector('video').playbackRate = 1.25; };
      document.body.append(button);
    });
    await page.locator('#native-speed').click(); await waitRate(1.25);
    await page.waitForTimeout(350); await waitRate(1.25); assert.equal(await savedRate(), 2);
    await navigate('after-native-choice'); await page.waitForTimeout(650); await waitRate(2);

    // Native normal-speed selection must also remain local and be honored immediately.
    await page.evaluate(() => { const button = document.getElementById('native-speed'); button.textContent = '1x'; button.setAttribute('aria-label', 'Playback speed 1x'); button.onclick = () => { document.querySelector('video').playbackRate = 1; }; });
    await page.locator('#native-speed').click(); await waitRate(1);
    await page.waitForTimeout(1700); await waitRate(1); assert.equal(await savedRate(), 2);
    await navigate('after-native-normal'); await page.waitForTimeout(650); await waitRate(2);

    // Disabling retention must not erase the saved preference.
    await popup.locator('#preferences > summary').click();
    await popup.locator('#remember-rate').uncheck();
    await page.waitForTimeout(200);
    await navigate('retention-off'); await page.waitForTimeout(650); await waitRate(1); assert.equal(await savedRate(), 2);
    await popup.locator('#remember-rate').check();
    await page.waitForTimeout(200);
    await navigate('retention-on'); await page.waitForTimeout(650); await waitRate(2);

    // A full page navigation or new media element also starts from the remembered rate.
    await page.goto('https://video.test/next');
    await waitRate(2); assert.equal(await savedRate(), 2);
    await page.evaluate(() => {
      const old = document.querySelector('video'), next = old.cloneNode(false); old.replaceWith(next);
      next.muted = true; next.play().catch(() => {});
      setTimeout(() => { next.playbackRate = 1; }, 200);
    });
    await page.waitForTimeout(800); await waitRate(2); assert.equal(await savedRate(), 2);
    assert.deepEqual(errors, []);
    console.log('Retention checks passed: delayed resets, lifecycle events, adjustable A/B presets, explicit 1x, native UI, full navigation, media replacement.');
  } finally { await context?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
