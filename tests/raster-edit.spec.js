const path = require('node:path');
const { test, expect } = require('@playwright/test');

const IMAGE = path.resolve(__dirname, '..', 'genesis-logo.png');

async function loadRaster(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/raster');
    await expect(page.locator('#main-content')).toBeVisible();
    await page.setInputFiles('#file-input', IMAGE);
    await expect(page.locator('#raster-content')).toBeVisible();
    return errors;
}

test('raster edit hub: transforms, crop, adjustments, webp export', async ({ page }) => {
    const errors = await loadRaster(page);

    const dims = page.locator('#original-dims');
    await expect(dims).not.toHaveText('—');
    const before = (await dims.textContent()).trim();
    const [w, h] = before.split('×').map(Number);
    expect(Number.isFinite(w) && Number.isFinite(h)).toBe(true);

    // Rotate 90° CW swaps the reported dimensions.
    await page.locator('#raster-rotate-cw').click();
    await expect(dims).toHaveText(`${h}×${w}`);
    await page.locator('#raster-rotate-ccw').click();
    await expect(dims).toHaveText(`${w}×${h}`);

    // Flips leave the dimensions alone but must not throw.
    await page.locator('#raster-flip-h').click();
    await page.locator('#raster-flip-v').click();
    await expect(dims).toHaveText(`${w}×${h}`);

    // Crop mode shows the overlay; applying it shrinks the working image.
    await page.locator('#raster-crop-toggle').click();
    await expect(page.locator('#raster-crop-overlay')).toBeVisible();
    await expect(page.locator('#raster-crop-actions')).toBeVisible();

    await expect(page.locator('#raster-crop-readout')).toHaveText(`${w} × ${h}`);

    const seHandle = page.locator('[data-handle="se"]');
    await seHandle.scrollIntoViewIfNeeded();
    await seHandle.hover();
    await page.mouse.down();
    const cropBox = await page.locator('#raster-crop-box').boundingBox();
    await page.mouse.move(cropBox.x + cropBox.width / 2, cropBox.y + cropBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('#raster-crop-readout')).not.toHaveText(`${w} × ${h}`);
    await page.locator('#raster-crop-apply').click();
    await expect(page.locator('#raster-crop-overlay')).toBeHidden();
    const cropped = (await dims.textContent()).trim();
    expect(cropped).not.toBe(before);

    // Preset chip drives the sliders.
    await page.locator('[data-preset="mono"]').click();
    await expect(page.locator('[data-preset="mono"]')).toHaveClass(/active/);
    await expect(page.locator('#raster-adjust-saturation')).toHaveValue('-100');

    // Reset returns every slider to neutral.
    await page.locator('#raster-adjust-reset').click();
    await expect(page.locator('#raster-adjust-saturation')).toHaveValue('0');
    await expect(page.locator('[data-preset="original"]')).toHaveClass(/active/);

    // A manual slider move clears the preset match.
    await page.locator('#raster-adjust-contrast').fill('40');
    await page.locator('#raster-adjust-contrast').dispatchEvent('input');
    await expect(page.locator('[data-preset="original"]')).not.toHaveClass(/active/);

    // Estimates settle to a real byte figure for all four formats.
    for (const id of ['#size-est-jpg', '#size-est-png', '#size-est-webp', '#size-est-tga']) {
        await expect(page.locator(id)).toHaveText(/\d/, { timeout: 20000 });
        await expect(page.locator(id)).not.toHaveText('Estimating...');
    }

    // WEBP download works.
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#save-resized-webp-btn').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/\.webp$/);

    // Revert clears crop and transforms.
    await page.locator('#raster-edit-reset').click();
    await expect(dims).toHaveText(before);

    expect(errors, errors.join('\n')).toEqual([]);
});
