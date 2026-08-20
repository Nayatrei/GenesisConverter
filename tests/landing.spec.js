const { test, expect } = require('@playwright/test');

test('root shows the bilingual landing page instead of opening a tool', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /필요한 결과부터 시작하세요/ })).toBeVisible();
    await expect(page.getByText('Start with the result you need.')).toBeVisible();
    await expect(page.locator('.tool-card')).toHaveCount(6);
    await expect(page.locator('.tool-card-3d')).toContainText('평면 이미지의 색상 영역을 추적해');
    await expect(page.locator('.tool-card-3d')).toContainText('Trace a flat image into shallow');
});

test('landing cards open their dedicated tool slugs', async ({ page }) => {
    await page.goto('/');

    const cards = [
        ['.tool-card-3d', '/3d-obj', 'svg'],
        ['.tool-card-logo', '/logo', 'logo'],
        ['.tool-card-resize', '/raster', 'raster'],
        ['.tool-card-bulk', '/bulk', 'bulk'],
        ['.tool-card-pdf', '/pdf', 'pdf'],
        ['.tool-card-annotate', '/annotate', 'annotate']
    ];

    for (const [selector, route, tab] of cards) {
        await page.goto('/');
        await page.locator(selector).click();
        await expect(page).toHaveURL(new RegExp(`${route}$`));
        await expect(page.locator(`.segmented-control-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    }
});

test('landing layout has no horizontal overflow on phone and desktop', async ({ page }) => {
    for (const viewport of [{ width: 320, height: 720 }, { width: 1440, height: 1000 }]) {
        await page.setViewportSize(viewport);
        await page.goto('/');
        await expect(page.locator('.tool-card-pdf')).toBeVisible();

        const dimensions = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth
        }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    }
});

test('recent tool link remembers the last tool opened', async ({ page }) => {
    await page.goto('/bulk');
    await page.goto('/');
    await expect(page.locator('#recent-tool-link')).toHaveAttribute('href', '/bulk');
});
