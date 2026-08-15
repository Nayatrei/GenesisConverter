const { test, expect } = require('@playwright/test');

function setRangeValue(locator, value) {
    return locator.evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

function buildOversizedSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <rect x="0" y="0" width="1600" height="900" rx="120" ry="120" fill="#111827"/>
  <rect x="120" y="120" width="1360" height="660" rx="96" ry="96" fill="#ef4444"/>
</svg>`.trim();
}

test('Bambu bed presets include X1, A1, and H2D with the expected footprint sizes', async ({ page }) => {
    await page.goto('/3d-obj');

    const presets = await page.evaluate(async () => {
        const { BED_PRESETS } = await import('/modules/config.js');
        return BED_PRESETS;
    });

    expect(presets.x1).toMatchObject({ width: 256, depth: 256, height: 256, label: 'Bambu X1/X1C' });
    expect(presets.a1).toMatchObject({ width: 256, depth: 256, height: 256, label: 'Bambu A1' });
    expect(presets.h2d).toMatchObject({ width: 325, depth: 320, height: 325, label: 'Bambu H2D (single nozzle)' });

    await expect(page.locator('#obj-bed')).toContainText('Bambu X1/X1C (256×256)');
    await expect(page.locator('#obj-bed')).toContainText('Bambu A1 (256×256)');
    await expect(page.locator('#obj-bed')).toContainText('Bambu H2D (325×320, single nozzle)');
    await expect(page.locator('#obj-preview-bed')).toContainText('X1 · 256×256');
    await expect(page.locator('#obj-preview-bed')).toContainText('A1 · 256×256');
    await expect(page.locator('#obj-preview-bed')).toContainText('H2D · 325×320');
});

test('oversized 3D models auto-fit to the selected Bambu printer bed', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/3d-obj');

    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildOversizedSvg())}`;
    await page.locator('#url-input').fill(svgDataUrl);
    await page.locator('#load-url-btn').click();

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 90_000 });
    await expect(page.locator('#obj-preview-placeholder')).toBeHidden({ timeout: 60_000 });

    await page.locator('#obj-bed').selectOption('a1');
    await expect(page.locator('#obj-size-readout')).toContainText('Bambu A1', { timeout: 60_000 });
    await setRangeValue(page.locator('#obj-scale'), 200);
    await expect(page.locator('#obj-size-readout')).toContainText('auto-fit to Bambu A1', { timeout: 60_000 });
    await expect.poll(
        async () => Number.parseFloat(await page.locator('#obj-scale-value').textContent()),
        { timeout: 60_000 }
    ).toBeLessThan(200);

    const a1Scale = Number.parseFloat(await page.locator('#obj-scale-value').textContent());
    const a1Footprint = {
        width: Number.parseFloat(await page.locator('#obj-size-readout').getAttribute('data-print-width')),
        depth: Number.parseFloat(await page.locator('#obj-size-readout').getAttribute('data-print-depth'))
    };

    expect(a1Scale).toBeLessThan(200);
    expect(a1Footprint.width).toBeLessThanOrEqual(246.0);
    expect(a1Footprint.depth).toBeLessThanOrEqual(246.0);

    await page.locator('#obj-bed').selectOption('h2d');
    await expect(page.locator('#obj-size-readout')).toContainText('Bambu H2D', { timeout: 60_000 });
    await setRangeValue(page.locator('#obj-scale'), 200);
    await expect(page.locator('#obj-size-readout')).toContainText('auto-fit to Bambu H2D', { timeout: 60_000 });
    await expect.poll(
        async () => Number.parseFloat(await page.locator('#obj-scale-value').textContent()),
        { timeout: 60_000 }
    ).toBeLessThan(200);

    const h2dScale = Number.parseFloat(await page.locator('#obj-scale-value').textContent());
    const h2dFootprint = {
        width: Number.parseFloat(await page.locator('#obj-size-readout').getAttribute('data-print-width')),
        depth: Number.parseFloat(await page.locator('#obj-size-readout').getAttribute('data-print-depth'))
    };

    expect(h2dScale).toBeGreaterThan(a1Scale);
    expect(h2dFootprint.width).toBeLessThanOrEqual(315.0);
    expect(h2dFootprint.depth).toBeLessThanOrEqual(310.0);
});

test('auto-fit commits the finished preview snapshot before Bambu preparation', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = async () => true;
    });

    let uploadCount = 0;
    await page.route('**/api/bambu-transfer?**', async (route) => {
        uploadCount += 1;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                url: 'http://127.0.0.1:4173/api/bambu-transfer/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/auto-fit-snapshot.3mf',
                expiresAt: new Date(Date.now() + 600_000).toISOString()
            })
        });
    });

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'auto-fit-snapshot.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildOversizedSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 90_000 });

    const canvas = page.locator('#obj-preview-canvas');
    const priorRenderCount = Number(await canvas.getAttribute('data-full-render-count') || 0);
    await setRangeValue(page.locator('#obj-scale'), 200);
    await expect.poll(async () => Number(
        await canvas.getAttribute('data-full-render-count') || 0
    ), { timeout: 60_000 }).toBeGreaterThan(priorRenderCount);
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    await expect(page.locator('#obj-size-readout')).toContainText('auto-fit to Bambu X1/X1C');
    expect(Number(await page.locator('#obj-scale').inputValue())).toBeLessThan(200);

    await page.locator('#svg-bambu-open-btn').click();
    await expect(page.locator('#svg-bambu-progress')).toHaveAttribute('data-state', 'ready', {
        timeout: 30_000
    });
    await expect(page.locator('#status-text')).not.toContainText('preview is not ready');
    expect(uploadCount).toBe(1);
});
