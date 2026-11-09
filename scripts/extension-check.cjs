/* Real MV3 extension in a throwaway profile, with native playable media (no mocked Chrome APIs). */
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pacefit-extension-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: 1000, height: 800 },
      ...(process.env.PACEFIT_CHROME ? { executablePath: process.env.PACEFIT_CHROME } : {}),
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
    });
    context.setDefaultTimeout(10000);
    const session = await context.browser().newBrowserCDPSession();
    const { id } = await session.send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
    const html = fs.readFileSync(path.join(root, 'tests/fixtures/watch.html'), 'utf8');
    const errors = []; let captionRequests = 0;
    await context.route('https://www.youtube.com/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('timedtext')) captionRequests++;
      return route.fulfill({ contentType: 'text/html', body: url.pathname === '/watch' ? html : '<title>Not a video</title>' });
    });
    const popup = await context.newPage(); popup.on('pageerror', e => errors.push(e.message));
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.evaluate(() => chrome.storage.local.set({ pacefitSettings: { mode: 'auto', manualRate: 1.25, targetPace: 300 } }));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('https://www.youtube.com/watch?v=fixture');
    const waitRate = (value, target = page) => target.waitForFunction(rate => Math.abs(document.querySelector('video').playbackRate - rate) < 0.005, value);
    const waitOpacity = (selector, value) => page.waitForFunction(({ selector, value }) => {
      const root = document.getElementById('pacefit-controller')?.shadowRoot;
      return root && getComputedStyle(root.querySelector(selector)).opacity === String(value);
    }, { selector, value });
    const navigate = async value => { await page.evaluate(id => { history.pushState({}, '', `/watch?v=${id}`); document.dispatchEvent(new Event('yt-navigate-finish')); }, value); };
    const preset = value => popup.getByRole('button', { name: `${value}×`, exact: true }).click();
    const setting = async (name, checked) => {
      if (!await popup.locator('#preferences').evaluate(el => el.open)) await popup.locator('#preferences > summary').click();
      await popup.locator(name).setChecked(checked);
      const key = { '#shortcuts': 'shortcuts', '#show-overlay': 'showOverlay', '#remember-rate': 'rememberRate' }[name];
      await popup.waitForFunction(async ({ key, checked }) => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings[key] === checked, { key, checked });
    };
    await waitRate(1.25); await page.waitForSelector('#pacefit-controller', { state: 'attached' });
    await page.mouse.move(1, 1); await waitOpacity('.controls', 0);
    await page.locator('#movie_player').hover({ position: { x: 500, y: 350 } }); await waitOpacity('.controls', 1);
    await page.locator('#pacefit-controller #speed').click();
    await page.mouse.move(1, 1); await waitOpacity('.controls', 0);
    assert.equal(await page.locator('#pacefit-controller #panel').isVisible(), false, 'Leaving the player closes a mouse-opened menu');
    // Keyboard focus remains accessible even when the pointer is outside the player.
    await page.locator('#pacefit-controller #slower').focus(); await page.keyboard.press('Tab');
    await waitOpacity('.controls', 1);
    await page.locator('h1').click(); await waitOpacity('.controls', 0);
    await page.bringToFront(); await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#connection').textContent === '연결됨');
    assert.equal(await popup.locator('#demo-banner').isVisible(), false);
    await preset(1.5); await waitRate(1.5);
    await popup.locator('#rate-up').evaluate(button => { for (let i = 0; i < 10; i++) button.click(); });
    await waitRate(2.5);
    await popup.locator('#toggle-rate').click(); await waitRate(2);
    await popup.locator('#toggle-rate').click(); await waitRate(2.5);
    await popup.locator('#save-favorite').click();
    await popup.waitForFunction(() => document.querySelector('#favorite').textContent.includes('2.5×'));
    await preset(1.5); await waitRate(1.5);

    // In-page controls work without the popup, and do not toggle play/pause.
    const paused = await page.locator('video').evaluate(v => v.paused);
    await page.locator('#movie_player').hover({ position: { x: 500, y: 350 } }); await waitOpacity('.controls', 1);
    await page.locator('#pacefit-controller #faster').click(); await waitRate(1.6);
    await page.locator('#pacefit-controller #slower').click(); await waitRate(1.5);
    assert.equal(await page.locator('video').evaluate(v => v.paused), paused);
    await page.locator('#pacefit-controller #speed').click();
    await page.locator('#pacefit-controller [data-rate="2"]').click(); await waitRate(2);
    await page.locator('#pacefit-controller #slider').focus(); await page.keyboard.press('End'); await waitRate(4);
    assert.equal(await page.locator('#pacefit-controller #faster').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#pacefit-controller #panel').isVisible(), false);
    await page.locator('#pacefit-controller #slower').click(); await waitRate(3.9);

    // Physical keys, two-speed swaps, and repeat behavior.
    await page.locator('h1').click(); await page.keyboard.press('['); await waitRate(3.8);
    await waitOpacity('.feedback', 1); await waitOpacity('.controls', 0);
    assert.equal(await page.locator('#pacefit-controller #feedback').textContent(), 'A · 3.8×');
    assert.equal(await page.locator('#pacefit-controller #feedback').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await page.locator('#movie_player').screenshot({ path: path.join(root, 'docs/shortcut-feedback.png'), animations: 'disabled' });
    await page.waitForTimeout(1000);
    await page.keyboard.press(']'); await waitRate(3.9);
    await page.waitForTimeout(800); await waitOpacity('.feedback', 1);
    assert.equal(await page.locator('#pacefit-controller #feedback').textContent(), 'A · 3.9×', 'A new press updates the badge and restarts its timer');
    await page.waitForFunction(() => !document.getElementById('pacefit-controller').hasAttribute('data-feedback'));
    await waitOpacity('.feedback', 0); await waitOpacity('.controls', 0);
    await popup.locator('#preset-b').click(); await waitRate(2);
    await preset(1); await waitRate(1);
    await popup.locator('#preset-a').click(); await waitRate(3.9);
    await popup.locator('#rate-input').fill('3.9'); await popup.locator('#rate-input').press('Tab'); await waitRate(3.9);
    await page.locator('h1').click();
    await page.keyboard.press('\\'); await waitRate(1);
    await page.keyboard.press('\\'); await waitRate(3.9);
    await page.keyboard.down('\\'); await page.keyboard.down('\\'); await page.keyboard.up('\\'); await waitRate(1);
    for (const selector of ['#search', '#comment', '#editable', '#shadow-editor textarea']) {
      await page.locator(selector).click(); await page.keyboard.type('[]\\'); await waitRate(1);
    }
    await page.locator('h1').click(); await page.keyboard.press(']'); await waitRate(1.1);
    await setting('#shortcuts', false); await page.locator('h1').click(); await page.keyboard.press(']'); await waitRate(1.1);
    await setting('#shortcuts', true);
    await popup.locator('#step').selectOption('0.25');
    await page.waitForFunction(() => document.getElementById('pacefit-controller').shadowRoot.getElementById('faster').title.includes('0.25'));
    await page.locator('h1').click(); await page.keyboard.press(']'); await waitRate(1.35);
    await setting('#show-overlay', false);
    await page.waitForFunction(() => document.getElementById('pacefit-controller').shadowRoot.querySelector('.controls').hidden);
    await page.keyboard.press(']'); await waitRate(1.6);
    await waitOpacity('.feedback', 1);
    await setting('#show-overlay', true);
    await page.waitForFunction(() => !document.getElementById('pacefit-controller').shadowRoot.querySelector('.controls').hidden);

    // Native YouTube-style rate changes, ad boundaries, SPA navigation, and settings.
    await page.locator('video').evaluate(v => { v.playbackRate = 1.75; });
    await popup.waitForFunction(() => document.querySelector('#rate-input').value === '1.75');
    await page.evaluate(() => { document.getElementById('movie_player').classList.add('ad-showing'); document.querySelector('video').playbackRate = 1; });
    await popup.waitForFunction(() => document.querySelector('#connection').textContent === '광고 중');
    await preset(2); await waitRate(1);
    await page.evaluate(() => document.getElementById('movie_player').classList.remove('ad-showing')); await waitRate(2);
    await navigate('next'); await waitRate(2);
    await setting('#remember-rate', false); await navigate('reset'); await waitRate(1);
    await setting('#remember-rate', true); await preset(2); await waitRate(2);
    await navigate('remember'); await waitRate(2);

    // Changing another video's speed must not interrupt the first video.
    const second = await context.newPage();
    await second.goto('https://www.youtube.com/watch?v=second'); await waitRate(2, second);
    await second.locator('#movie_player').hover({ position: { x: 500, y: 350 } });
    await second.locator('#pacefit-controller #speed').click();
    await second.locator('#pacefit-controller [data-rate="1.5"]').click(); await waitRate(1.5, second);
    await page.waitForTimeout(250); await waitRate(2);
    await second.close();

    // Fullscreen retains controls within the player.
    await page.locator('#fullscreen').click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.waitForFunction(() => document.fullscreenElement.contains(document.getElementById('pacefit-controller')));
    await page.locator('#movie_player').hover({ position: { x: 500, y: 350 } }); await waitOpacity('.controls', 1);
    await page.locator('#pacefit-controller #faster').click(); await waitRate(2.25);
    await page.evaluate(() => document.exitFullscreen());

    await page.bringToFront(); await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#rate-input').value === '2.25');
    if (await popup.locator('#preferences').evaluate(el => el.open)) await popup.locator('#preferences > summary').click();
    await popup.waitForFunction(() => document.querySelector('#toast').hidden);
    await popup.locator('h1').click();
    await popup.screenshot({ path: path.join(root, 'docs/extension-popup.png'), animations: 'disabled' });
    assert.ok(await popup.evaluate(() => document.documentElement.scrollHeight <= 600), 'Popup must fit within 600px');
    await page.locator('#movie_player').hover({ position: { x: 500, y: 350 } }); await waitOpacity('.controls', 1);
    await page.locator('#pacefit-controller #speed').click();
    await page.locator('#movie_player').screenshot({ path: path.join(root, 'docs/player-controls.png'), animations: 'disabled' });
    const saved = await popup.evaluate(async () => (await chrome.storage.local.get('pacefitSettings')).pacefitSettings);
    assert.equal(saved.manualRate, 2.25); assert.equal(saved.mode, undefined);
    assert.equal(captionRequests, 0); assert.deepEqual(errors, []);
    console.log('Installed extension checks passed: player hover/leave, keyboard focus, timed speed badge/reset, hidden-overlay feedback, controls/shortcuts, ads, SPA, fullscreen, storage.');
  } finally { await context?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
