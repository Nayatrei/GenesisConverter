const { test, expect } = require('@playwright/test');
const pages = require('../seo-pages.json');
const origin = 'https://editor.genesisframeworks.com';

test('all canonical sitemap pages resolve with HTML metadata without JavaScript', async ({ browser, request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()['content-type']).toContain('xml');
    const xml = await sitemap.text();
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    expect(locations).toHaveLength(10);
    expect(new Set(locations).size).toBe(locations.length);
    const context = await browser.newContext({ javaScriptEnabled: false });
    // Static HTML indexing must not depend on third-party font/CDN latency.
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort());
    const page = await context.newPage();
    for (const url of locations) {
        expect(url).toMatch(/^https:\/\/editor\.genesisframeworks\.com\//);
        expect(url).not.toMatch(/auth|api|svg$/);
        const response = await page.goto(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '4173'}${new URL(url).pathname}`, { waitUntil: 'domcontentloaded' });
        expect(response.status(), url).toBe(200);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', url);
        expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();
        expect(await page.title()).toBeTruthy();
        if (url.includes('/guides/')) await expect(page.locator('h1')).toBeVisible();
    }
    await context.close();
});

test('app navigation updates canonical and metadata, including browser back', async ({ page }) => {
    await page.goto('/3d-obj');
    await expect(page).toHaveTitle(pages['3d-obj'].title);
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page).toHaveURL(/\/logo$/);
    await expect(page).toHaveTitle(pages.logo.title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${origin}/logo`);
    await page.goBack();
    await expect(page).toHaveTitle(pages['3d-obj'].title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${origin}/3d-obj`);
});

test('guide CTA opens the intended tool on phone and desktop', async ({ page }) => {
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [guide, slug, tab] of [['image-to-stl', '3d-obj', 'svg'], ['logo-to-3mf', 'logo', 'logo']]) {
            await page.goto(`/guides/${guide}.html`);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.locator('a.cta').first().click();
            await expect(page).toHaveURL(new RegExp(`/${slug}$`));
            await expect(page.locator(`.segmented-control-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
        }
    }
});
