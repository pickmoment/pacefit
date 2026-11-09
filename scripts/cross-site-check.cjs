/* Generic HTML5 media, cross-origin frames, and site exclusions in a real MV3 installation. */
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pacefit-sites-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: 1000, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
      ...(process.env.PACEFIT_CHROME ? { executablePath: process.env.PACEFIT_CHROME } : {})
    });
    context.setDefaultTimeout(12000);
    const session = await context.browser().newBrowserCDPSession();
    const { id } = await session.send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
    const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/watch.html'), 'utf8').replaceAll('movie_player', 'generic-player');
    await context.route(/https?:\/\/.*\.test\//, route => {
      const url = new URL(route.request().url());
      const html = url.pathname === '/embedded' ? '<!doctype html><title>Embedded video test</title><h1>임베드 영상 테스트</h1><iframe src="https://embed.test/player" style="width:960px;height:680px;border:0"></iframe><input aria-label="검색">' : url.hostname === 'audio.test' ? fixture.replaceAll('video', 'audio') : fixture;
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const popup = await context.newPage(); await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const openPopup = async (page, host) => {
      await page.bringToFront(); await popup.reload();
      await popup.waitForFunction(host => document.getElementById('site-host').textContent === host, host);
    };
    const preset = value => popup.getByRole('button', { name: `${value}×`, exact: true }).click();
    const waitRate = (target, value, selector = 'video') => target.waitForFunction(({ value, selector }) => Math.abs(document.querySelector(selector)?.playbackRate - value) < 0.005, { value, selector });
    const exclusions = async () => { if (!await popup.locator('#exceptions').evaluate(el => el.open)) await popup.locator('#exceptions > summary').click(); };
    const addRule = async domain => { await exclusions(); await popup.locator('#excluded-domain').fill(domain); await popup.locator('#exception-form button').click(); };
    const removeRule = async domain => { await exclusions(); await popup.getByRole('button', { name: `${domain} 예외 해제`, exact: true }).click(); };

    const page = await context.newPage(); await page.goto('https://video.test/watch');
    await openPopup(page, 'video.test');
    await popup.waitForFunction(() => document.getElementById('connection').textContent === '연결됨');
    await preset(1.5); await waitRate(page, 1.5);
    await page.locator('#generic-player').hover({ position: { x: 500, y: 300 } });
    await page.locator('#pacefit-controller #faster').click(); await waitRate(page, 1.6);
    const origin = await page.locator('video').evaluate(v => v.getBoundingClientRect().top);
    const overlay = await page.locator('#pacefit-controller').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(overlay - origin - 14) < 1, 'Overlay must follow generic media with 14px padding');
    // A hidden paused preview must not steal commands from a newly playing video.
    await page.evaluate(() => {
      const first = document.querySelector('video'); first.id = 'original-media'; first.pause(); first.style.display = 'none';
      const second = first.cloneNode(false); second.id = 'secondary-media'; second.style.cssText = 'position:relative;width:640px;height:360px';
      document.getElementById('generic-player').append(second); second.muted = true; second.play();
    });
    await preset(2); await waitRate(page, 2, '#secondary-media'); await waitRate(page, 1.6, '#original-media');
    await page.evaluate(() => { document.getElementById('secondary-media').remove(); const first = document.getElementById('original-media'); first.style.display = ''; first.play(); });
    await preset(1.5); await waitRate(page, 1.5);
    await popup.locator('#site-enabled').uncheck(); await waitRate(page, 1);
    await page.waitForFunction(() => !document.getElementById('pacefit-controller'));
    assert.equal(await popup.locator('#rate-up').isDisabled(), true);
    await page.locator('h1').click(); await page.keyboard.press(']'); await waitRate(page, 1);
    await popup.locator('#site-enabled').check(); await waitRate(page, 1.5);
    await page.waitForSelector('#pacefit-controller', { state: 'attached' });
    await addRule('https://other.test/watch');
    const other = await context.newPage(); await other.goto('https://other.test/watch');
    await openPopup(other, 'other.test'); await waitRate(other, 1);
    await popup.waitForFunction(() => document.getElementById('connection').textContent === '예외 적용');
    const child = await context.newPage(); await child.goto('https://news.other.test/watch');
    await openPopup(child, 'news.other.test'); await waitRate(child, 1);
    assert.equal(await popup.locator('#site-enabled').isChecked(), false);
    await removeRule('other.test'); await waitRate(child, 1.5); await waitRate(other, 1.5);

    // Cross-origin embed: popup and parent-page shortcuts target only the child frame.
    const portal = await context.newPage(); await portal.goto('https://portal.test/embedded');
    const embed = portal.frames().find(frame => frame.url().startsWith('https://embed.test/'));
    assert.ok(embed);
    await openPopup(portal, 'portal.test'); await popup.waitForFunction(() => document.getElementById('connection').textContent === '연결됨');
    await preset(2); await waitRate(embed, 2); await waitRate(page, 1.5);
    await portal.locator('h1').click(); await portal.keyboard.press(']'); await waitRate(embed, 2.1);
    await embed.waitForFunction(() => document.getElementById('pacefit-controller').hasAttribute('data-feedback'));
    await popup.locator('#site-enabled').uncheck(); await waitRate(embed, 1);
    await popup.locator('#site-enabled').check(); await waitRate(embed, 2.1);
    await addRule('embed.test'); await waitRate(embed, 1);
    await popup.waitForFunction(() => document.getElementById('status').textContent.includes('임베드 사이트'));
    await removeRule('embed.test'); await waitRate(embed, 2.1);

    // Audio-only pages use the same controls.
    const audio = await context.newPage(); await audio.goto('http://audio.test/watch');
    await openPopup(audio, 'audio.test'); await popup.waitForFunction(() => document.getElementById('status').textContent.includes('오디오'));
    await audio.locator('h1').click(); await audio.locator('audio').evaluate(media => media.play());
    await preset(1.75); await waitRate(audio, 1.75, 'audio');
    await audio.locator('h1').click(); await audio.keyboard.press(']'); await waitRate(audio, 1.85, 'audio');

    // Dynamically inserted media inside an open Shadow DOM is discovered.
    await page.evaluate(() => {
      const old = document.querySelector('video'), media = old.cloneNode(false); old.pause();
      const host = document.createElement('div'); host.id = 'custom-player';
      host.attachShadow({ mode: 'open' }).append(media); document.body.append(host); old.remove();
      media.style.cssText = 'display:block;position:relative;width:640px;height:360px'; media.muted = true; media.play();
    });
    await openPopup(page, 'video.test'); await popup.waitForFunction(() => document.getElementById('connection').textContent === '연결됨');
    await preset(2.5);
    await page.waitForFunction(() => document.getElementById('custom-player').shadowRoot.querySelector('video').playbackRate === 2.5);
    // Excluding an unrelated site never changes a currently playing video's speed.
    await waitRate(embed, 2.1); await waitRate(audio, 1.85, 'audio');
    assert.deepEqual(errors, []);
    console.log('Cross-site checks passed: generic video, HTTP audio, cross-origin iframe routing/shortcuts, site disable/restore, subdomains, exception add/remove, dynamic open Shadow DOM, tab isolation.');
  } finally { await context?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
