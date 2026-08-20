const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

function getZipEntryNames(buffer) {
    const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const eocd = buffer.lastIndexOf(sig);
    const entryCount = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    const names = [];
    for (let i = 0; i < entryCount; i += 1) {
        const nameLen = buffer.readUInt16LE(offset + 28);
        const extraLen = buffer.readUInt16LE(offset + 30);
        const commentLen = buffer.readUInt16LE(offset + 32);
        names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLen));
        offset += 46 + nameLen + extraLen + commentLen;
    }
    return names;
}

async function openBulk(page) {
    await page.goto('/3d-obj');
    await page.locator('.segmented-control-tab[data-tab="bulk"]').click();
}

test('WEBP export, batch rotate and adjustments reach the ZIP', async ({ page }, testInfo) => {
    const dir = testInfo.outputPath('batch');
    fs.mkdirSync(dir, { recursive: true });
    // 8x4 so a quarter turn is observable in the reported output size.
    fs.writeFileSync(
        `${dir}/wide.svg`,
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#3366cc"/></svg>'
    );

    await openBulk(page);
    await page.locator('#bulk-folder-input').setInputFiles(dir);
    await expect(page.locator('#bulk-preview-count')).toHaveText('1');
    await expect(page.locator('#bulk-selected-output-dims')).toHaveText('8×4px');

    // Preview canvas paints the selected file.
    await expect(page.locator('#bulk-preview-canvas')).toBeVisible();

    // Batch rotate swaps the effective W/H for the resize maths.
    await page.locator('#bulk-rotate-cw').click();
    await expect(page.locator('#bulk-transform-readout')).toHaveText('90°');
    await expect(page.locator('#bulk-selected-output-dims')).toHaveText('4×8px');

    await page.locator('#bulk-flip-h').click();
    await expect(page.locator('#bulk-transform-readout')).toHaveText('90° · Flip H');

    // Preset chips drive the eight shared sliders.
    await page.locator('.bulk-preset-chip[data-bulk-preset="mono"]').click();
    await expect(page.locator('.bulk-preset-chip[data-bulk-preset="mono"]')).toHaveClass(/active/);
    await expect(page.locator('#bulk-adjust-saturation')).toHaveValue('-100');
    await expect(page.locator('#bulk-adjust-grid output[data-bulk-adjust-value="saturation"]')).toHaveText('-100');

    // Slider count comes straight from ADJUSTMENT_RANGES.
    await expect(page.locator('#bulk-adjust-grid .bulk-adjust-slider')).toHaveCount(8);

    // WEBP tab renames the export target.
    await page.locator('.bulk-format-tab[data-format="webp"]').click();
    await expect(page.locator('#bulk-preview-format')).toHaveText('WEBP');
    await expect(page.locator('#bulk-preview-list')).toContainText('wide.webp');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#bulk-download-btn').click();
    const download = await downloadPromise;
    const zip = fs.readFileSync(await download.path());
    expect(getZipEntryNames(zip)).toEqual(['wide.webp']);

    // The bytes really are WEBP: RIFF....WEBP.
    expect(zip.includes(Buffer.from('WEBP'))).toBe(true);
    await expect(page.locator('#status-text')).toContainText('Exported 1 image(s)');
});

test('reset controls return the batch to neutral', async ({ page }, testInfo) => {
    const dir = testInfo.outputPath('reset');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        `${dir}/a.svg`,
        '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6"><rect width="6" height="6" fill="#cc3366"/></svg>'
    );

    await openBulk(page);
    await page.locator('#bulk-folder-input').setInputFiles(dir);
    await expect(page.locator('#bulk-preview-count')).toHaveText('1');

    await page.locator('#bulk-rotate-ccw').click();
    await page.locator('.bulk-preset-chip[data-bulk-preset="warm"]').click();
    await expect(page.locator('#bulk-transform-reset')).toBeEnabled();
    await expect(page.locator('#bulk-adjust-reset')).toBeEnabled();

    await page.locator('#bulk-transform-reset').click();
    await expect(page.locator('#bulk-transform-readout')).toHaveText('No transform');
    await expect(page.locator('#bulk-transform-reset')).toBeDisabled();

    await page.locator('#bulk-adjust-reset').click();
    await expect(page.locator('.bulk-preset-chip[data-bulk-preset="original"]')).toHaveClass(/active/);
    await expect(page.locator('#bulk-adjust-reset')).toBeDisabled();
});

test('HEIC files are accepted by the bulk input', async ({ page }) => {
    await openBulk(page);
    const accept = await page.locator('#bulk-folder-input').getAttribute('accept');
    expect(accept).toContain('.heic');
    expect(accept).toContain('.heif');
});
