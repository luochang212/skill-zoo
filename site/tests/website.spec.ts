import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const base = '/skill-zoo/';
const releases = 'https://github.com/luochang212/skill-zoo/releases';

// Keep checks deterministic and offline; no test downloads a real release asset.
test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
  await page.route(`${releases}/download/**`, route => route.fulfill({
    body: 'test asset',
    headers: { 'content-disposition': 'attachment; filename="test-asset"' },
    contentType: 'application/octet-stream',
  }));
});

for (const [route, lang, title] of [[base, 'en', 'Feature System'], [base + 'zh/', 'zh-CN', '功能体系']] as const) {
  test(`${lang} static HTML works without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
    await page.goto(`http://127.0.0.1:4322${route}`);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('footer p')).toHaveText('© 2026 Skill Zoo · MIT License');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('.carousel-card img').first()).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Skill/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://www.luochang.ink${route}`);
    await expect(page.locator('link[hreflang="zh-CN"]')).toHaveAttribute('href', 'https://www.luochang.ink/skill-zoo/zh/');
    await context.close();
  });

  test(`${lang} images, carousel and responsive layout`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(route);
    await expect(page.locator('.carousel-card')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await expect(page.locator('.carousel-card img').first()).toHaveAttribute('src', base + 'screenshots/screenshot-1.webp');
    await page.locator('#carousel-wrapper').hover();
    await page.locator('#carousel-dots button').nth(1).click();
    await expect(page.locator('#carousel-dots button').nth(1)).toHaveClass('active');
    await page.locator('#carousel-dots button').nth(2).click();
    await expect(page.locator('#carousel-dots button').nth(2)).toHaveClass('active');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#nav-toggle').click();
    await expect(page.locator('#nav-drawer')).toBeVisible();
    await page.locator('#nav-toggle').click();
    await expect(page.locator('#nav-drawer')).toBeHidden();
    // The brand's empty hash must not be parsed as an invalid CSS selector.
    await page.locator('.top-nav-brand').click();
    expect(errors).toEqual([]);
    await expect(page.getByText('界面预览 · 示例数据', { exact: true })).toHaveCount(0);
    await expect(page.getByText('npm i -g skill-zoo', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'CLI / Web UI →' })).toHaveCount(0);
  });
}

for (const [from, expected] of [
  ['?lang=zh&ref=existing#report', 'zh/?lang=zh&ref=existing#report'],
  ['zh/?lang=en&ref=existing#report', '?lang=en&ref=existing#report'],
] as const) {
  test(`legacy language URL ${from}`, async ({ page }) => {
    await page.goto(base + from);
    await expect(page).toHaveURL(`http://127.0.0.1:4322${base}${expected}`);
    await expect(page.locator('html')).toHaveAttribute('lang', expected.startsWith('zh') ? 'zh-CN' : 'en');
  });
}

test('root language preference and explicit Chinese route', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lang', 'zh'));
  await page.goto(base);
  await expect(page).toHaveURL(new RegExp('/skill-zoo/zh/$'));
  await page.addInitScript(() => localStorage.setItem('lang', 'en'));
  await page.goto(base + 'zh/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test.describe('Chinese browser', () => {
  test.use({ locale: 'zh-CN' });
  test('root follows browser language even when storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } }));
    await page.goto(base);
    await expect(page).toHaveURL(new RegExp('/skill-zoo/zh/$'));
    await page.goto(base + 'zh/?lang=en#report');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveURL(new RegExp('/skill-zoo/\\?lang=en#report$'));
  });
});

for (const [os, ua, suffix] of [
  ['macos', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3)', 'macOS.dmg'],
  ['windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows.exe'],
  ['linux', 'Mozilla/5.0 (X11; Linux x86_64)', 'Linux-x86_64.AppImage'],
  ['linux-arm', 'Mozilla/5.0 (X11; Linux aarch64)', 'Linux-aarch64.AppImage'],
] as const) {
  test(`nested Chinese route downloads ${os}`, async ({ page, browserName }) => {
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { get: () => ua }), ua);
    const requests: string[] = [];
    await page.route('**/version.json', route => {
      requests.push(new URL(route.request().url()).pathname);
      return route.fulfill({ json: { version: 'v1.2.3' } });
    });
    await page.goto(base + 'zh/');
    const attemptedDownload = page.waitForRequest(request => request.url().startsWith(releases + '/download/'));
    // WebKit sends the request but does not emit a download event for this mocked
    // cross-origin attachment (also reproduced against the pre-migration page).
    const download = browserName === 'chromium' ? page.waitForEvent('download') : null;
    await page.locator('#dl-btn').click();
    const expected = `${releases}/download/v1.2.3/Skill-Zoo-v1.2.3-${suffix}`;
    expect((await attemptedDownload).url()).toBe(expected);
    if (download) expect((await download).url()).toBe(expected);
    await expect(page.locator('#install-modal')).toBeVisible();
    await expect(page.locator('#dl-manual')).toHaveAttribute('href', expected);
    await expect(page.locator('#dl-manual')).toHaveText('点此手动下载');
    await expect(page.locator('#modal-steps')).toContainText(os === 'macos' ? 'macOS 13.3' : os === 'windows' ? '安装程序' : 'AppImage');
    expect(requests).toEqual([base + 'version.json']);
    await page.locator('[data-os="windows"]').click();
    await expect(page.locator('#modal-alt a')).toHaveAttribute('href', `${releases}/download/v1.2.3/Skill-Zoo-v1.2.3-Windows-Portable.zip`);
    await page.locator('[data-os="linux"]').click();
    const links = await page.locator('#modal-alt a').evaluateAll(links => links.map(link => link.getAttribute('href')));
    expect(links).toEqual(['x86_64.AppImage', 'x86_64.deb', 'aarch64.AppImage', 'aarch64.deb'].map(asset => `${releases}/download/v1.2.3/Skill-Zoo-v1.2.3-Linux-${asset}`));
    await page.keyboard.press('Escape');
    await expect(page.locator('#install-modal')).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });
}

for (const failure of ['network', 'empty', 'invalid-json']) {
  test(`unknown version (${failure}) keeps manual release fallback`, async ({ page }) => {
    await page.route('**/version.json', route => failure === 'network' ? route.abort() : route.fulfill({
      body: failure === 'empty' ? '{}' : 'not JSON', contentType: 'application/json',
    }));
    const downloads: string[] = [];
    page.on('download', download => downloads.push(download.url()));
    await page.goto(base + 'zh/');
    await page.locator('#dl-btn').click();
    await expect(page.locator('#install-modal')).toBeVisible();
    await expect(page.locator('#dl-manual')).toHaveAttribute('href', releases);
    await page.locator('[data-os="windows"]').click();
    await expect(page.locator('#modal-alt a')).toHaveAttribute('href', releases);
    expect(downloads).toEqual([]);
  });
}

test('released manifest and sitemap are published under the base', async ({ request }) => {
  const version = await request.get(base + 'version.json');
  expect(version.ok()).toBe(true);
  expect(await version.json()).toEqual(JSON.parse(readFileSync(new URL('../public/version.json', import.meta.url), 'utf8')));
  const sitemap = await request.get(base + 'sitemap-0.xml');
  expect(await sitemap.text()).toContain('https://www.luochang.ink/skill-zoo/zh/');
});

for (const [locale, timezoneId, expected] of [
  ['en-US', 'Asia/Shanghai', 'en'],
  ['zh-CN', 'America/New_York', 'zh-CN'],
] as const) {
  test.describe(`browser ${locale}, timezone ${timezoneId}`, () => {
    test.use({ locale, timezoneId });
    test('automatic language depends on the browser, not timezone', async ({ page }) => {
      await page.goto(base);
      await expect(page.locator('html')).toHaveAttribute('lang', expected);
      await expect(page).toHaveURL('http://127.0.0.1:4322' + base + (expected === 'zh-CN' ? 'zh/' : ''));
    });
  });
}

test.describe('explicit language priority', () => {
  test.use({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  test('saved English overrides automatic browser detection', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lang', 'en'));
    await page.goto(base);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto(base + '?lang=zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
});

test('carousel keeps autoplay, resizing and horizontal swipe behavior', async ({ page }) => {
  await page.clock.install();
  await page.goto(base);
  const dots = page.locator('#carousel-dots button');
  await expect(dots.nth(0)).toHaveClass('active');
  await page.clock.fastForward(8001);
  await expect(dots.nth(1)).toHaveClass('active');
  const width = await page.locator('.carousel-card').first().evaluate(card => card.getBoundingClientRect().width);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.carousel-card').first().evaluate(card => card.getBoundingClientRect().width)).toBeLessThan(width);
  const prevented = await page.locator('#carousel-wrapper').evaluate(wrapper => {
    function touch(type: string, key: string, x: number, y: number) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, key, { value: [{ clientX: x, clientY: y }] });
      wrapper.dispatchEvent(event);
      return event.defaultPrevented;
    }
    touch('touchstart', 'touches', 250, 100);
    const prevented = touch('touchmove', 'touches', 100, 105);
    touch('touchend', 'changedTouches', 100, 105);
    return prevented;
  });
  expect(prevented).toBe(true);
  await expect(dots.nth(2)).toHaveClass('active');
});

test('install modal closes by its close button and backdrop', async ({ page }) => {
  await page.route('**/version.json', route => route.fulfill({ json: {} }));
  await page.goto(base);
  await page.locator('#dl-btn').click();
  await expect(page.locator('#install-modal')).toBeVisible();
  await page.locator('#modal-close').click();
  await expect(page.locator('#install-modal')).toBeHidden();
  await page.locator('#dl-btn').click();
  // Dispatch on the backdrop itself; clicks on its card must not close it.
  await page.locator('.modal-card').click();
  await expect(page.locator('#install-modal')).toBeVisible();
  await page.locator('#install-modal').dispatchEvent('click');
  await expect(page.locator('#install-modal')).toBeHidden();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});
