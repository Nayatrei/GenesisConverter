const { test, expect } = require('@playwright/test');

function buildBackgroundFixture() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <rect width="320" height="220" fill="#f3f4f6"/>
  <rect x="72" y="48" width="176" height="124" rx="22" fill="#dc2626"/>
  <circle cx="160" cy="110" r="34" fill="#111827"/>
</svg>`.trim();
}

async function uploadSource(page, markup) {
    await page.locator('#file-input').setInputFiles({
        name: 'background-layers.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(markup)
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
}

test('background detector requires broad edge contact', async ({ page }) => {
    await page.goto('/converter.html');

    const result = await page.evaluate(async () => {
        const { detectBackgroundLayerIndex } = await import('/modules/shared/trace-utils.js?v=20260726a');
        return {
            detected: detectBackgroundLayerIndex({
                width: 320,
                height: 220,
                layers: [
                    [{ boundingbox: [0, 0, 320, 220] }],
                    [{ boundingbox: [72, 48, 248, 172] }]
                ]
            }),
            rejected: detectBackgroundLayerIndex({
                width: 320,
                height: 220,
                layers: [
                    [{ boundingbox: [12, 12, 308, 208] }],
                    [{ boundingbox: [72, 48, 248, 172] }]
                ]
            })
        };
    });

    expect(result.detected).toBe(0);
    expect(result.rejected).toBe(-1);
});

test('detected background can be hidden and restored from the layer stack', async ({ page }) => {
    await page.goto('/converter.html');
    await uploadSource(page, buildBackgroundFixture());

    const action = page.locator('#background-layer-toggle');
    await expect(action).toBeVisible();
    await expect(action).toHaveText('Hide background');

    const rows = page.locator('#layer-stack-list .layer-stack-item');
    const initialRowCount = await rows.count();
    expect(initialRowCount).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#layer-stack-list .layer-background-badge')).toHaveCount(1);

    const beforePreview = await page.locator('#svg-preview').getAttribute('src');
    await action.click();

    await expect(action).toHaveText('Restore background');
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-hidden')).toHaveCount(1);
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-hidden .layer-stack-range')).toHaveText('Hidden');
    await expect.poll(() => page.locator('#svg-preview').getAttribute('src')).not.toBe(beforePreview);

    await page.locator('#layer-stack-list .layer-stack-item.is-hidden .layer-visibility-toggle').click();
    await expect(action).toHaveText('Hide background');
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-hidden')).toHaveCount(0);
    await expect(rows).toHaveCount(initialRowCount);
});

test('the final visible layer cannot be hidden', async ({ page }) => {
    await page.goto('/converter.html');
    await page.locator('#file-input').setInputFiles({
        name: 'single-layer.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">
  <rect width="240" height="180" fill="#111827"/>
</svg>`.trim())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });

    await expect(page.locator('#layer-stack-list .layer-stack-item')).toHaveCount(1);
    await expect(page.locator('#layer-stack-list .layer-visibility-toggle')).toBeDisabled();
    await expect(page.locator('#background-layer-toggle')).toBeDisabled();
});
