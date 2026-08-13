const fs = require('fs');
const { test, expect } = require('@playwright/test');

function buildTwoLayerSignSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <rect width="320" height="220" fill="#f3f4f6"/>
  <rect x="72" y="48" width="176" height="124" rx="22" fill="#dc2626"/>
</svg>`.trim();
}

async function uploadSign(page) {
    await page.locator('#file-input').setInputFiles({
        name: 'two-layer-sign.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(buildTwoLayerSignSvg())
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await expect(page.locator('#layer-stack-list .layer-stack-item')).toHaveCount(2);
}

async function readPreviewCounts(page) {
    return page.locator('#obj-preview-canvas').evaluate((canvas) => ({
        full: Number(canvas.dataset.fullRenderCount || 0),
        height: Number(canvas.dataset.heightUpdateCount || 0)
    }));
}

async function collectStlDownloads(page) {
    const downloads = [];
    const onDownload = (download) => downloads.push(download);
    page.on('download', onDownload);

    try {
        const button = page.locator('#export-stl-btn');
        await button.evaluate((exportButton) => {
            const advancedGroup = exportButton.closest('details');
            if (advancedGroup) advancedGroup.open = true;
        });
        await button.click();
        await expect(page.locator('#status-text')).toContainText('Exported 2 STL files.', { timeout: 30_000 });
        await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(2);

        return Promise.all(downloads.map(async (download) => {
            const filePath = await download.path();
            return {
                filename: download.suggestedFilename(),
                buffer: fs.readFileSync(filePath)
            };
        }));
    } finally {
        page.off('download', onDownload);
    }
}

function readBinaryStlBounds(buffer) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const triangleCount = view.getUint32(80, true);
    let offset = 84;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        offset += 12;
        for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
            const x = view.getFloat32(offset, true);
            const y = view.getFloat32(offset + 4, true);
            const z = view.getFloat32(offset + 8, true);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
            offset += 12;
        }
        offset += 2;
    }

    return {
        triangleCount,
        minX,
        minY,
        minZ,
        maxX,
        maxY,
        maxZ,
        width: maxX - minX,
        depth: maxY - minY,
        height: maxZ - minZ
    };
}

test('height controls reuse the current topology and commit once', async ({ page }) => {
    await page.goto('/3d-obj');
    await uploadSign(page);

    const before = await readPreviewCounts(page);
    const thickness = page.locator('#obj-thickness');

    await thickness.evaluate((input) => {
        [3.6, 3.2, 2.8, 2.4].forEach((value) => {
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    await expect(page.locator('#obj-thickness-value')).toHaveText('2.4');
    expect(await readPreviewCounts(page)).toEqual(before);

    await thickness.evaluate((input) => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect.poll(async () => (await readPreviewCounts(page)).height).toBe(before.height + 1);
    const after = await readPreviewCounts(page);
    expect(after.full).toBe(before.full);
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-range')).toHaveText('0.0-2.4mm');
    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText('2.4-4.8mm');
    await expect(page.locator('#svg-model-size-readout')).toContainText('× 4.8 mm');

    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    expect((await readPreviewCounts(page)).full).toBe(before.full);
});

test('per-layer height edits invalidate export geometry without rebuilding the preview', async ({ page }) => {
    await page.goto('/3d-obj');
    await uploadSign(page);

    const initialDownloads = await collectStlDownloads(page);
    const initialBounds = initialDownloads.map(({ buffer }) => readBinaryStlBounds(buffer));
    const before = await readPreviewCounts(page);

    const baseHeight = page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-thickness');
    await baseHeight.evaluate((input) => {
        input.value = '2.4';
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#layer-stack-list .layer-stack-item.is-base .layer-stack-range')).toHaveText('0.0-2.4mm');

    const detailHeight = page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-thickness');
    await detailHeight.evaluate((input) => {
        input.value = '1.2';
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#layer-stack-list .layer-stack-item:not(.is-base) .layer-stack-range')).toHaveText('2.4-3.6mm');
    await expect(page.locator('#svg-model-size-readout')).toContainText('× 3.6 mm');
    const afterHeightEdits = await readPreviewCounts(page);
    expect(afterHeightEdits.full).toBe(before.full);
    expect(afterHeightEdits.height).toBe(before.height + 2);

    const updatedDownloads = await collectStlDownloads(page);
    const updatedBounds = updatedDownloads.map(({ buffer }) => readBinaryStlBounds(buffer));
    const initialOverallMaxZ = Math.max(...initialBounds.map((bounds) => bounds.maxZ));
    const updatedOverallMaxZ = Math.max(...updatedBounds.map((bounds) => bounds.maxZ));

    expect(initialOverallMaxZ).toBeCloseTo(8, 1);
    expect(updatedOverallMaxZ).toBeCloseTo(3.6, 1);
    const updatedHeights = updatedBounds.map((bounds) => bounds.height).sort((a, b) => a - b);
    expect(updatedHeights[0]).toBeCloseTo(1.2, 1);
    expect(updatedHeights[1]).toBeCloseTo(2.4, 1);
    expect(updatedBounds.map((bounds) => bounds.triangleCount)).toEqual(
        initialBounds.map((bounds) => bounds.triangleCount)
    );
    expect(updatedBounds.map((bounds) => bounds.width)).toEqual(
        initialBounds.map((bounds) => bounds.width)
    );
    expect(updatedBounds.map((bounds) => bounds.depth)).toEqual(
        initialBounds.map((bounds) => bounds.depth)
    );
});
