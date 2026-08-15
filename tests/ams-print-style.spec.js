const { test, expect } = require('@playwright/test');

function buildTwoColorSignSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <rect width="320" height="220" rx="24" fill="#f3f4f6"/>
  <path d="M76 72h168v76H76z" fill="#dc2626"/>
</svg>`.trim();
}

function buildThreeColorSignSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <rect width="320" height="220" fill="#f3f4f6"/>
  <rect x="48" y="52" width="96" height="116" fill="#dc2626"/>
  <rect x="176" y="52" width="96" height="116" fill="#2563eb"/>
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

test('Face on Bed reports an incompatible bezel and applies when the conflict is removed', async ({ page }) => {
    await page.goto('/3d-obj');
    await uploadSign(page);

    await page.locator('#obj-bezel').selectOption('low');
    await page.locator('#obj-face-down-toggle').click();

    const toggle = page.locator('#obj-face-down-toggle');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'raised-efficient', { timeout: 30_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveClass(/is-blocked/);
    await expect(toggle.locator('[data-face-down-state]')).toHaveText('Blocked');
    await expect(page.locator('#svg-preflight-status')).toHaveText('Style adjusted');
    await expect(page.locator('#svg-preflight-note')).toContainText('raised bezel');

    await page.locator('#obj-bezel').selectOption('off');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'face-down', { timeout: 30_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).not.toHaveClass(/is-blocked/);
    await expect(toggle.locator('[data-face-down-state]')).toHaveText('Active');
});

test('Face on Bed shortcut makes every color coplanar and restores the prior style', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'three-color-sign.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildThreeColorSignSvg())
    });

    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await expect(page.locator('#layer-stack-list .layer-stack-item')).toHaveCount(3);

    const toggle = page.locator('#obj-face-down-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle.locator('[data-face-down-state]')).toHaveText('Off');

    await page.locator('#obj-ams-print-style').selectOption('full-depth');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'full-depth', { timeout: 30_000 });

    await page.evaluate(() => {
        const button = document.getElementById('obj-face-down-toggle');
        const readState = () => ({
            busy: button?.getAttribute('aria-busy'),
            label: button?.querySelector('[data-face-down-state]')?.textContent
        });
        window.__faceDownLifecycle = [readState()];
        window.__faceDownObserver = new MutationObserver(() => {
            window.__faceDownLifecycle.push(readState());
        });
        window.__faceDownObserver.observe(button, {
            attributes: true,
            childList: true,
            subtree: true
        });
    });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect(toggle.locator('[data-face-down-state]')).toHaveText('Active');
    await expect(page.locator('#obj-ams-print-style')).toHaveValue('face-down');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'face-down', { timeout: 30_000 });
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-preview-face', 'bed');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-render-state', 'ready');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-plan-build-mode', 'retarget');
    const lifecycle = await page.evaluate(() => {
        window.__faceDownObserver?.disconnect();
        return window.__faceDownLifecycle;
    });
    expect(lifecycle).toContainEqual({ busy: 'true', label: 'Building' });
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-range')).toHaveText('0.0-2.4mm');
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText([
        '0.0-0.6mm',
        '0.0-0.6mm'
    ]);
    await expect(page.locator('#svg-model-size-readout')).toContainText('× 2.4 mm');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect(toggle.locator('[data-face-down-state]')).toHaveText('Off');
    await expect(page.locator('#obj-ams-print-style')).toHaveValue('full-depth');
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-ams-print-style', 'full-depth', { timeout: 30_000 });
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText([
        '4.0-8.0mm',
        '4.0-8.0mm'
    ]);
    expect(pageErrors).toEqual([]);
});

test('Logo Face on Bed shares the responsive bed-orientation lifecycle', async ({ page }) => {
    await page.goto('/3d-obj');
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();

    const toggle = page.locator('#logo-obj-face-down-toggle');
    const canvas = page.locator('#logo-obj-preview-canvas');
    await expect(canvas).toHaveAttribute('data-ams-print-style', 'raised-efficient', { timeout: 30_000 });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle.locator('[data-face-down-state]')).toHaveText('Active');
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    await expect(canvas).toHaveAttribute('data-plan-build-mode', 'retarget');
    await expect(canvas).toHaveAttribute('data-preview-face', 'bed');
    await expect(page.locator('#logo-obj-print-orientation-note')).toHaveText(
        'Bed orientation · color face underneath'
    );
});
