const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const routes = ['/', '/3d-obj', '/logo', '/raster', '/bulk', '/pdf', '/annotate'];

for (const width of [390, 1440]) {
    test(`Stage design is shared by Home and all six tools at ${width}px`, async ({ page }) => {
        for (const route of routes) {
            await page.setViewportSize({ width, height: 1000 });
            await page.goto(route);
            await expect(page.locator('body')).toHaveClass(/immersive-stage/);
            await expect(page.locator('.stage-brand')).toBeVisible();
            await expect(page.locator('h1')).toHaveCount(1);
            if (route !== '/') {
                await expect(page.locator('#loader-overlay')).toBeHidden();
                await expect(page.locator('.segmented-control-tab')).toHaveCount(6);
            }
            const layout = await page.evaluate(() => {
                const sheet = [...document.styleSheets].find(s => s.href?.includes('/stage-theme.css?'));
                const panel = document.querySelector('.app-sidebar');
                const workspace = document.querySelector('.app-workspace');
                return {
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    darkScheme: getComputedStyle(document.documentElement).colorScheme,
                    sheetLoaded: Boolean(sheet?.cssRules.length),
                    inspectorRight: panel && workspace && innerWidth >= 1024
                        ? panel.getBoundingClientRect().left >= workspace.getBoundingClientRect().right : true
                };
            });
            expect(layout.overflow, route).toBe(false);
            expect(layout.darkScheme, route).toBe('dark');
            expect(layout.sheetLoaded, route).toBe(true);
            expect(layout.inspectorRight, route).toBe(true);
            if (route === '/pdf' && width >= 1024) {
                expect(await page.locator('.app-sidebar').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(300);
            }
        }
    });
}

test('export actions move with the viewport without cloning controller nodes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/raster');
    const footer = page.locator('#download-footer');
    await expect(page.locator('#stage-export-host #download-footer')).toHaveCount(1);
    await footer.evaluate(node => node.dataset.qaIdentity = 'same-export-node');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#main-content #download-footer')).toHaveCount(1);
    await expect(footer).toHaveAttribute('data-qa-identity', 'same-export-node');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('#stage-export-host #download-footer')).toHaveCount(1);
    await expect(footer).toHaveAttribute('data-qa-identity', 'same-export-node');
    await expect(page.locator('#save-resized-png-btn')).toHaveCount(1);
    await page.locator('[data-tab="logo"]').click();
    await expect(page.locator('#stage-logo-source-host .logo-source-card')).toHaveCount(1);
    await page.locator('.logo-source-card').evaluate(node => node.dataset.qaIdentity = 'same-source-node');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#tab-logo .logo-source-card')).toHaveAttribute('data-qa-identity', 'same-source-node');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('#stage-logo-source-host .logo-source-card')).toHaveAttribute('data-qa-identity', 'same-source-node');
});

test('Annotate keeps empty states and tool options hidden, then draws and exports PNG', async ({ page }) => {
    await page.goto('/annotate');
    await expect(page.locator('#annotate-content')).toBeHidden();
    await page.locator('#file-input').setInputFiles({
        name: 'stage-qa.svg', mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#637e77"/></svg>')
    });
    await expect(page.locator('#annotate-content')).toBeVisible();
    await expect(page.locator('#annotate-empty-state')).toBeHidden();
    await expect(page.locator('[data-annotate-option="text"]')).toBeHidden();
    await page.locator('[data-annotate-tool="arrow"]').click();
    const canvas = page.locator('#annotate-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const r = await canvas.boundingBox();
    await page.mouse.move(r.x + r.width * .25, r.y + r.height * .4);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * .7, r.y + r.height * .65, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#annotate-undo-btn')).toBeEnabled();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#annotate-save-png-btn').click();
    const download = await downloadEvent;
    const bytes = fs.readFileSync(await download.path());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(320);
    expect(bytes.readUInt32BE(20)).toBe(200);
    await page.locator('#annotate-undo-btn').click();
    await expect(page.locator('#annotate-undo-btn')).toBeDisabled();
    await expect(page.locator('#annotate-redo-btn')).toBeEnabled();
});

test('3D export rail retains readable full-width recommended actions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/3d-obj');
    for (const tab of ['svg', 'logo']) {
        await page.locator(`.segmented-control-tab[data-tab="${tab}"]`).click();
        const layout = await page.locator(`#stage-export-host [data-tab-footer="${tab}"]`).evaluate(footer => {
            const group = footer.querySelector('.export-recommended-group');
            return {
                footerWidth: footer.clientWidth,
                groupWidth: group.clientWidth,
                clippedActions: [...group.querySelectorAll('button')].filter(b => b.scrollWidth > b.clientWidth + 1).length
            };
        });
        expect(layout.groupWidth).toBeGreaterThan(layout.footerWidth * .8);
        expect(layout.clippedActions).toBe(0);
    }
});
