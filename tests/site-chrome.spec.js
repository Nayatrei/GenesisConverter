const { test, expect } = require('@playwright/test');

const pages = ['/', '/3d-obj', '/logo', '/raster', '/bulk', '/pdf', '/annotate',
    '/guides/', '/guides/image-to-stl.html', '/guides/logo-to-3mf.html'];
const expectedNav = [
    ['Home', '/'], ['Bambu 3D', '/3d-obj'], ['Logo', '/logo'], ['Raster', '/raster'],
    ['Bulk', '/bulk'], ['PDF', '/pdf'], ['Annotate', '/annotate'], ['Guides', '/guides/']
];

test('Home, tools and guides share static navigation and company details without JS', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
        for (const route of pages) {
            await page.goto(route);
            const nav = await page.locator('.stage-header nav a').evaluateAll(nodes =>
                nodes.map(node => [node.textContent.trim(), node.getAttribute('href')]));
            expect(nav, route).toEqual(expectedNav);
            await expect(page.locator('.brand-footer')).toHaveCount(1);
            await expect(page.locator('.brand-footer')).toContainText('Genesis Frameworks');
            await expect(page.locator('.brand-footer')).toContainText('All rights reserved.');
            await expect(page.locator('.brand-footer a[href="mailto:jong@genesisframeworks.com"]')).toHaveCount(1);
            await expect(page.locator('.brand-footer a[href="https://www.linkedin.com/in/jonglee77/"]')).toHaveCount(1);
            for (const link of await page.locator('.brand-footer a[href^="https:"]').all()) {
                await expect(link).toHaveAttribute('target', '_blank');
                await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
            }
        }
    } finally {
        await context.close();
    }
});

test('real navigation links preserve in-app tool state and browser history', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stage-header [data-tab="raster"]').click();
    await expect(page).toHaveURL(/\/raster$/);
    await expect(page.locator('.stage-header [aria-current="page"]')).toHaveText('Raster');
    await page.locator('.app-shell').evaluate(node => node.dataset.qaNavigation = 'preserved');
    await page.locator('.stage-header [data-tab="pdf"]').click();
    await expect(page).toHaveURL(/\/pdf$/);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-qa-navigation', 'preserved');
    await expect(page.locator('.stage-header [aria-current="page"]')).toHaveText('PDF');
    await page.goBack();
    await expect(page.locator('.stage-header [aria-current="page"]')).toHaveText('Raster');
    await page.locator('.stage-header [data-nav-id="home"]').click();
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page.locator('.stage-header [aria-current="page"]')).toHaveText('Home');
    await expect(page.locator('[data-footer-year]')).toHaveText(String(new Date().getFullYear()));
});

test('shared header fits desktop and scrolls its navigation on mobile without page overflow', async ({ page }) => {
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ['/', '/pdf', '/guides/']) {
            await page.goto(route);
            await expect(page.locator('.stage-header')).toBeVisible();
            await expect(page.locator('.genesis-id-connect')).toBeVisible();
            const layout = await page.locator('.stage-header').evaluate(header => ({
                overflow: document.documentElement.scrollWidth > innerWidth,
                headerWidth: header.getBoundingClientRect().width,
                navWidth: header.querySelector('nav').getBoundingClientRect().width,
                actionRight: header.querySelector('.stage-header-actions').getBoundingClientRect().right,
                links: [...header.querySelectorAll('nav a')].map(link => ({
                    height: link.getBoundingClientRect().height,
                    flexBasis: getComputedStyle(link).flexBasis,
                    radius: getComputedStyle(link).borderRadius
                }))
            }));
            expect(layout.overflow, `${route} at ${width}`).toBe(false);
            expect(layout.navWidth, `${route} at ${width}`).toBeGreaterThan(100);
            expect(layout.actionRight, `${route} at ${width}`).toBeLessThanOrEqual(width);
            for (const link of layout.links) {
                expect(link.height, `${route} at ${width}`).toBeLessThanOrEqual(42);
                expect(link.flexBasis).toBe('auto');
                expect(link.radius).toBe('8px');
            }
        }
    }
});

test('footer follows the company manual: 64px logo, 3 columns, mobile stacking', async ({ page }) => {
    for (const width of [320, 767, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('/');
        const layout = await page.locator('.brand-footer').evaluate(footer => ({
            columns: getComputedStyle(footer.querySelector('.brand-footer-grid')).gridTemplateColumns.split(' ').length,
            logoWidth: footer.querySelector('img').getBoundingClientRect().width,
            logoHeight: footer.querySelector('img').getBoundingClientRect().height,
            imageLoaded: footer.querySelector('img').naturalWidth > 0,
            overflow: document.documentElement.scrollWidth > innerWidth
        }));
        expect(layout.columns).toBe(width < 768 ? 1 : 3);
        expect(layout.logoWidth).toBe(64);
        expect(layout.logoHeight).toBe(64);
        expect(layout.imageLoaded).toBe(true);
        expect(layout.overflow).toBe(false);
    }
});
