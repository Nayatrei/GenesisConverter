const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const QA_DIR = path.join(process.cwd(), 'test-results', 'manual-logo');
const PRESETS = [
    { id: 'capsule-wordmark', name: 'Capsule Wordmark' },
    { id: 'studio-sign', name: 'Studio Sign' },
    { id: 'round-seal', name: 'Round Seal' },
    { id: 'monogram-coin', name: 'Monogram Coin' },
    { id: 'address-plate', name: 'Address Plate' },
    { id: 'maker-stamp', name: 'Maker Stamp' },
    { id: 'key-tag', name: 'Key Tag' },
    { id: 'ticket-label', name: 'Ticket Label' },
    { id: 'split-label', name: 'Split Label' },
    { id: 'stacked-block', name: 'Stacked Block' }
];

function buildStripedSvg() {
    const colors = ['#111827', '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed'];
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120">
  ${colors.map((color, index) => `<rect x="${index * 60}" y="0" width="60" height="120" fill="${color}"/>`).join('\n  ')}
</svg>`.trim();
}

function outputPath(name) {
    fs.mkdirSync(QA_DIR, { recursive: true });
    return path.join(QA_DIR, name);
}

async function setRangeValue(locator, value) {
    await locator.evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

async function expectRenderedImage(locator) {
    await expect.poll(async () => locator.evaluate((img) => {
        if (!(img instanceof HTMLImageElement)) return false;
        const styles = window.getComputedStyle(img);
        return Boolean(img.src && img.naturalWidth > 0 && img.naturalHeight > 0 && styles.display !== 'none');
    }), {
        timeout: 30_000
    }).toBe(true);
}

async function openLogoTab(page) {
    await page.goto('/3d-obj');
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page.locator('#tab-logo')).toBeVisible();
    await expect(page.locator('#logo-sidebar-controls')).toBeVisible();
    await expect(page.locator('#svg-sidebar-controls')).toBeHidden();
}

async function renderPreset(page, preset) {
    const button = page.locator(`#logo-preset-gallery [data-logo-preset="${preset.id}"]`);
    await button.click();
    await expect(button).toHaveClass(/active/);
    await expect(button).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#logo-builder-active-name')).toHaveText(preset.name);
    await expect(page.locator('#logo-builder-fit-status')).toHaveClass(/is-ready/);
    await expect(page.locator('#logo-builder-fit-status strong')).toHaveText('Ready');
    await expect(page.locator('#logo-original-resolution')).toHaveText(/^\d+×\d+ px$/, { timeout: 30_000 });
    await expect(page.locator('#logo-html-status')).toHaveText('Ready', { timeout: 30_000 });
    await expectRenderedImage(page.locator('#logo-svg-source-mirror'));
    await expectRenderedImage(page.locator('#logo-svg-preview'));
    await expect(page.locator('#logo-export-obj-btn')).toBeEnabled();
    await expect(page.locator('#logo-export-3mf-btn')).toBeEnabled();
    await expect(page.locator('#logo-bambu-open-btn')).toBeEnabled();
    await expect(page.locator('#logo-export-stl-btn')).toBeEnabled();
    await expect(page.locator('#logo-obj-preview-placeholder')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#tab-logo #logo-obj-scale')).toHaveCount(0);
    await expect(page.locator('#tab-logo #logo-obj-thickness')).toHaveCount(0);
    await expect(page.locator('#tab-logo #logo-obj-margin')).toHaveCount(0);
    await expect(page.locator('#tab-logo #logo-obj-bed')).toHaveCount(0);
    await expect(page.locator('#logo-model-size-readout')).toHaveText(/^\d+\.\d × \d+\.\d × \d+\.\d mm$/);
    await expect(page.locator('#logo-model-size-readout')).toHaveAttribute('data-bed-fit', 'fits');
}

test('logo sidebar controls stay isolated from SVG controls', async ({ page }) => {
    await openLogoTab(page);

    await expect(page.locator('#logo-bambu-open-btn')).toBeEnabled({ timeout: 30_000 });

    await expect(page.locator('#sidebar-adjust-section #obj-scale')).toBeVisible();
    await expect(page.locator('#sidebar-adjust-section #obj-thickness')).toBeVisible();
    await expect(page.locator('#sidebar-adjust-section #obj-bed')).toBeVisible();
    await expect(page.locator('#sidebar-adjust-section #obj-margin')).toBeVisible();
    await expect(page.locator('#sidebar-adjust-section #obj-bezel')).toBeVisible();
    await expect(page.locator('#logo-html-color-summary')).toBeVisible();
    await expect(page.locator('#logo-image-color-controls')).toBeHidden();

    await page.locator('#file-input').setInputFiles({
        name: 'stripes.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildStripedSvg())
    });

    await expect(page.locator('#logo-image-color-controls')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#logo-output-colors')).toBeVisible();
    await expectRenderedImage(page.locator('#logo-svg-preview'));

    await setRangeValue(page.locator('#logo-output-colors'), 6);
    await expect(page.locator('#logo-output-colors-value')).toHaveText('6');

    await page.locator('.segmented-control-tab[data-tab="svg"]').click();
    await expect(page.locator('#tab-svg')).toBeVisible();
    await expect(page.locator('#svg-sidebar-controls')).toBeVisible();
    await expect(page.locator('#logo-sidebar-controls')).toBeHidden();
    await expect(page.locator('#sidebar-adjust-section #obj-scale')).toBeVisible();
    await expect(page.locator('#output-colors')).toBeVisible();

    await setRangeValue(page.locator('#output-colors'), 3);
    await expect(page.locator('#output-colors-value')).toHaveText('3');

    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page.locator('#logo-sidebar-controls')).toBeVisible();
    await expect(page.locator('#logo-output-colors')).toHaveValue('6');
    await expect(page.locator('#sidebar-adjust-section #obj-scale')).toBeVisible();

    await page.locator('.segmented-control-tab[data-tab="svg"]').click();
    await expect(page.locator('#output-colors')).toHaveValue('3');
});

test('quick logo builder updates the HTML source and completes 3D preflight', async ({ page }) => {
    await openLogoTab(page);

    await expect(page.locator('#logo-simple-builder')).toBeVisible();
    await expect(page.locator('#logo-advanced-editor')).not.toHaveAttribute('open', '');

    const previousSource = await page.locator('#logo-html-source-img').getAttribute('src');
    await page.locator('[data-logo-preset="studio-sign"]').click();
    await page.locator('#logo-builder-text').fill('GENESIS');
    await page.locator('#logo-builder-secondary').fill('MAKER STUDIO');
    await page.locator('#logo-builder-font-size').fill('40');
    await page.locator('#logo-builder-width').fill('460');

    await expect.poll(
        () => page.locator('#logo-html-source-img').getAttribute('src'),
        { timeout: 30_000 }
    ).not.toBe(previousSource);
    await expect(page.locator('#logo-html-input')).toHaveValue(/GENESIS/);
    await expect(page.locator('#logo-html-input')).toHaveValue(/width:460\.0px/);
    await expect(page.locator('#logo-builder-fit-status')).toHaveClass(/is-ready/);
    await expect(page.locator('#logo-html-status')).toHaveText('Ready', { timeout: 30_000 });
    await expect(page.locator('#logo-preflight-status')).toContainText(/Ready|Check|Auto-fit/);
    await expect(page.locator('#logo-maker-workflow')).toHaveAttribute('data-stage', 'export');
});

test('all ten printable logo presets render cleanly in the logo workflow', async ({ page }) => {
    test.setTimeout(180_000);
    await openLogoTab(page);
    await expect(page.locator('#logo-preset-gallery .logo-preset-card')).toHaveCount(10);

    for (const preset of PRESETS) {
        await renderPreset(page, preset);
        await expect(page.locator('#tab-logo .svg-compare-grid')).toBeVisible();
        await expect(page.locator('#tab-logo .svg-3d-grid')).toBeVisible();
        await expect(page.locator('#logo-use-base-layer')).toBeChecked();
        await expect(page.locator('#obj-structure-warning')).toBeHidden();
        await expect(page.locator('#logo-html-color-summary')).toBeVisible();
        await expect(page.locator('#logo-image-color-controls')).toBeHidden();

        await page.locator('#tab-logo .svg-compare-grid').screenshot({
            path: outputPath(`logo-${preset.id}-compare.png`)
        });
        await page.locator('#tab-logo .svg-3d-grid').screenshot({
            path: outputPath(`logo-${preset.id}-3d.png`)
        });
    }
});

test('all ten logo presets pass strict validation and export Bambu 3MF packages', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await openLogoTab(page);

    for (const preset of PRESETS) {
        await renderPreset(page, preset);
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#logo-export-3mf-btn').click();
        const download = await downloadPromise;
        await expect(page.locator('#status-text')).toHaveText(
            'Bambu Studio project downloaded. Open the .3mf in Bambu Studio.',
            { timeout: 30_000 }
        );

        const targetPath = testInfo.outputPath(`${preset.id}.3mf`);
        await download.saveAs(targetPath);
        const header = fs.readFileSync(targetPath).subarray(0, 4);
        expect(header).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        expect(fs.statSync(targetPath).size).toBeGreaterThan(10_000);
    }
});
