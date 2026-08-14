const { test, expect } = require('@playwright/test');

function buildTwoColorSignSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <rect width="320" height="220" rx="24" fill="#f3f4f6"/>
  <path d="M76 72h168v76H76z" fill="#dc2626"/>
</svg>`.trim();
}

async function uploadSign(page) {
    await page.locator('#file-input').setInputFiles({
        name: 'ams-sign.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildTwoColorSignSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await expect(page.locator('#layer-stack-list .layer-stack-item')).toHaveCount(2);
}

test('AMS-first UI defaults to a thin raised color surface', async ({ page }) => {
    await page.goto('/3d-obj');

    await expect(page.locator('.segmented-control-tab[data-tab="svg"] .workspace-tab-title')).toHaveText('Bambu 3D');
    await expect(page.locator('#obj-ams-print-style')).toHaveValue('raised-efficient');
    await expect(page.locator('#obj-base-thickness')).toHaveValue('2.4');
    await expect(page.locator('#obj-thickness')).toHaveValue('0.6');
    await expect(page.locator('#export-3mf-btn')).toContainText('Download AMS-ready 3MF');
    await expect(page.locator('#export-3mf-btn')).toBeDisabled();

    await uploadSign(page);

    await expect(page.locator('#export-3mf-btn')).toBeEnabled();
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'raised-efficient');
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-range')).toHaveText('0.0-2.4mm');
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText('2.4-3.0mm');
    await expect(page.locator('#svg-model-size-readout')).toContainText('× 3.0 mm');
    await expect(page.locator('#svg-preflight-status')).toHaveText('One AMS ready');
    await expect(page.locator('#svg-preflight-layers')).toHaveText('2 filaments');

    await page.locator('#add-merge-rule-btn').evaluate((button) => button.click());
    await expect(page.locator('#layer-stack-list .layer-stack-item')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('#svg-preflight-layers')).toHaveText('1 filament');
});

test('AMS print style presets update both base and color geometry', async ({ page }) => {
    await page.goto('/3d-obj');
    await uploadSign(page);

    await page.locator('#obj-ams-print-style').selectOption('full-depth');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'full-depth', { timeout: 30_000 });
    await expect(page.locator('#obj-base-thickness')).toHaveValue('4');
    await expect(page.locator('#obj-thickness')).toHaveValue('4');
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-range')).toHaveText('0.0-4.0mm');
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText('4.0-8.0mm');
    await expect(page.locator('#svg-preflight-note')).toContainText('more AMS swap layers');

    await page.locator('#obj-ams-print-style').selectOption('raised-efficient');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'raised-efficient', { timeout: 30_000 });
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-range')).toHaveText('0.0-2.4mm');
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText('2.4-3.0mm');
});

test('face-down style keeps its required base enabled', async ({ page }) => {
    await page.goto('/3d-obj');
    await uploadSign(page);

    await page.locator('#obj-ams-print-style').selectOption('face-down');
    await expect(page.locator('#use-base-layer')).toBeChecked();
    await expect(page.locator('#use-base-layer')).toBeDisabled();

    await page.locator('#obj-ams-print-style').selectOption('raised-efficient');
    await expect(page.locator('#use-base-layer')).toBeEnabled();
});
