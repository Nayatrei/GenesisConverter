const fs = require('fs');
const { test, expect } = require('@playwright/test');

async function waitForApp(page) {
    await page.goto('/3d-obj');
    await page.waitForFunction(() => Boolean(window.THREE && window.SVGLoader && window.ImageTracer));
}

function parseBinaryStl(buffer) {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const view = new DataView(arrayBuffer);
    const triangleCount = view.getUint32(80, true);
    const triangles = [];
    let offset = 84;
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
        offset += 12;
        const triangle = [];
        for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
            triangle.push([
                view.getFloat32(offset, true),
                view.getFloat32(offset + 4, true),
                view.getFloat32(offset + 8, true)
            ]);
            offset += 12;
        }
        triangles.push(triangle);
        offset += 2;
    }
    return triangles;
}

function countOpenBoundaryEdges(triangles) {
    const edgeCounts = new Map();
    const addEdge = (left, right) => {
        const leftKey = left.map((value) => value.toFixed(4)).join(',');
        const rightKey = right.map((value) => value.toFixed(4)).join(',');
        const key = leftKey < rightKey
            ? `${leftKey}|${rightKey}`
            : `${rightKey}|${leftKey}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    };
    triangles.forEach((triangle) => {
        addEdge(triangle[0], triangle[1]);
        addEdge(triangle[1], triangle[2]);
        addEdge(triangle[2], triangle[0]);
    });
    return [...edgeCounts.values()].filter((count) => count === 1).length;
}

test('magnet presets normalize to exact millimetre cavities and balanced placements', async ({ page }) => {
    await waitForApp(page);

    const result = await page.evaluate(async () => {
        const {
            MAGNET_DISC_PRESETS,
            MAGNET_BLOCK_PRESETS,
            normalizeMagnetPocketConfig,
            resolveMagnetPocketPlan
        } = await import('/modules/shared/magnet-pockets.js?v=magnet-tests');

        const maskSpace = {
            width: 800,
            height: 500,
            originX: 0,
            originY: 0,
            pixelsPerUnit: 10,
            pixelsPerMm: 10
        };
        const supportMask = new Uint8Array(maskSpace.width * maskSpace.height);
        supportMask.fill(1);
        const plan = resolveMagnetPocketPlan({
            config: {
                enabled: true,
                shape: 'disc',
                presetId: 'disc-10x3',
                count: 4,
                mode: 'hidden',
                clearanceXY: 0.25,
                clearanceZ: 0.2,
                minWall: 1.2,
                floor: 0.8,
                roof: 0.8
            },
            supportMask,
            maskSpace,
            requestedBaseThickness: 4
        });
        const clampedCustom = normalizeMagnetPocketConfig({
            shape: 'block',
            presetId: 'custom',
            length: 120,
            width: -4,
            height: 0.2
        });

        return {
            discPresetIds: MAGNET_DISC_PRESETS.map((preset) => preset.id),
            blockPresetIds: MAGNET_BLOCK_PRESETS.map((preset) => preset.id),
            valid: plan.valid,
            fittedCount: plan.fittedCount,
            placementCount: plan.placements.length,
            cavityWidths: plan.placements.map((placement) => placement.cavityWidthMm),
            cavityDepths: plan.placements.map((placement) => placement.cavityDepthMm),
            uniqueX: new Set(plan.placements.map((placement) => placement.pixelX)).size,
            uniqueY: new Set(plan.placements.map((placement) => placement.pixelY)).size,
            cavityZStart: plan.cavityZStart,
            cavityZEnd: plan.cavityZEnd,
            pauseZ: plan.pauseZ,
            requiredBaseThickness: plan.requiredBaseThickness,
            effectiveBaseThickness: plan.effectiveBaseThickness,
            autoThickenedBy: plan.autoThickenedBy,
            message: plan.message,
            clampedCustom: {
                length: clampedCustom.length,
                width: clampedCustom.width,
                height: clampedCustom.height
            }
        };
    });

    expect(result.discPresetIds).toEqual([
        'disc-6x2',
        'disc-8x2',
        'disc-8x3',
        'disc-10x2',
        'disc-10x3',
        'disc-12x3',
        'disc-15x3',
        'disc-20x3',
        'disc-20x5'
    ]);
    expect(result.blockPresetIds).toEqual([
        'block-10x5x2',
        'block-15x5x2',
        'block-20x5x2',
        'block-20x10x2',
        'block-25x5x2',
        'block-25x10x3',
        'block-30x10x3',
        'block-40x10x3'
    ]);
    expect(result.valid).toBe(true);
    expect(result.fittedCount).toBe(4);
    expect(result.placementCount).toBe(4);
    expect(result.cavityWidths).toEqual([10.5, 10.5, 10.5, 10.5]);
    expect(result.cavityDepths).toEqual([10.5, 10.5, 10.5, 10.5]);
    expect(result.uniqueX).toBe(2);
    expect(result.uniqueY).toBe(2);
    expect(result.cavityZStart).toBe(0.8);
    expect(result.cavityZEnd).toBe(4);
    expect(result.pauseZ).toBe(4);
    expect(result.requiredBaseThickness).toBe(4.8);
    expect(result.effectiveBaseThickness).toBe(4.8);
    expect(result.autoThickenedBy).toBe(0.8);
    expect(result.message).toContain('Insert 4');
    expect(result.message).toContain('Ø10 × 3 mm');
    expect(result.clampedCustom).toEqual({ length: 100, width: 1, height: 0.5 });
});

test('rectangular pockets auto-rotate, bottom recesses omit pauses, and invalid counts carve nothing', async ({ page }) => {
    await waitForApp(page);

    const result = await page.evaluate(async () => {
        const { resolveMagnetPocketPlan } = await import('/modules/shared/magnet-pockets.js?v=magnet-tests');
        const makeMask = (width, height) => {
            const maskSpace = {
                width,
                height,
                originX: 0,
                originY: 0,
                pixelsPerUnit: 10,
                pixelsPerMm: 10
            };
            const supportMask = new Uint8Array(width * height);
            supportMask.fill(1);
            return { maskSpace, supportMask };
        };

        const narrow = makeMask(200, 500);
        const rotated = resolveMagnetPocketPlan({
            config: {
                enabled: true,
                shape: 'block',
                presetId: 'block-30x10x3',
                count: 1,
                mode: 'bottom',
                clearanceXY: 0.25,
                clearanceZ: 0.2,
                minWall: 1.2,
                roof: 0.8
            },
            ...narrow,
            requestedBaseThickness: 4
        });

        const tooSmall = makeMask(200, 200);
        const invalid = resolveMagnetPocketPlan({
            config: {
                enabled: true,
                shape: 'disc',
                presetId: 'disc-20x5',
                count: 4,
                mode: 'hidden'
            },
            ...tooSmall,
            requestedBaseThickness: 4
        });

        return {
            rotated: {
                valid: rotated.valid,
                orientation: rotated.orientation,
                cavityWidthMm: rotated.placements[0]?.cavityWidthMm,
                cavityDepthMm: rotated.placements[0]?.cavityDepthMm,
                cavityZStart: rotated.cavityZStart,
                cavityZEnd: rotated.cavityZEnd,
                pauseZ: rotated.pauseZ,
                requiredBaseThickness: rotated.requiredBaseThickness
            },
            invalid: {
                valid: invalid.valid,
                fittedCount: invalid.fittedCount,
                placementCount: invalid.placements.length,
                hasCavityMask: invalid.cavityMask instanceof Uint8Array,
                errors: invalid.errors
            }
        };
    });

    expect(result.rotated.valid).toBe(true);
    expect(result.rotated.orientation).toBe(90);
    expect(result.rotated.cavityWidthMm).toBe(10.5);
    expect(result.rotated.cavityDepthMm).toBe(30.5);
    expect(result.rotated.cavityZStart).toBe(0);
    expect(result.rotated.cavityZEnd).toBe(3.2);
    expect(result.rotated.pauseZ).toBeNull();
    expect(result.rotated.requiredBaseThickness).toBe(4);

    expect(result.invalid.valid).toBe(false);
    expect(result.invalid.fittedCount).toBeLessThan(4);
    expect(result.invalid.placementCount).toBe(0);
    expect(result.invalid.hasCavityMask).toBe(false);
    expect(result.invalid.errors[0]).toMatch(/fit/);
});

test('shared controls retain settings between 3D and Logo and enable both support bases', async ({ page }) => {
    await waitForApp(page);

    await expect(page.locator('#obj-magnet-panel')).toBeVisible();
    await expect(page.locator('#obj-magnet-body')).toBeHidden();
    await page.locator('.magnet-pocket-switch').click();
    await expect(page.locator('#obj-magnet-body')).toBeVisible();
    await expect(page.locator('#obj-magnet-custom-fields')).toBeHidden();
    await expect(page.locator('#use-base-layer')).toBeChecked();
    await expect(page.locator('#logo-use-base-layer')).toBeChecked();

    await page.locator('#obj-magnet-shape').selectOption('block');
    await expect(page.locator('#obj-magnet-preset')).toHaveValue('block-20x5x2');
    await expect(page.locator('#obj-magnet-preset option')).toHaveCount(9);

    await page.locator('#obj-magnet-preset').selectOption('custom');
    await expect(page.locator('#obj-magnet-custom-fields')).toBeVisible();
    await page.locator('#obj-magnet-length').fill('27.5');
    await page.locator('#obj-magnet-width').fill('7.5');
    await page.locator('#obj-magnet-height').fill('2.5');
    await page.locator('#obj-magnet-count').evaluate((input) => {
        input.value = '2';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#obj-magnet-count-value')).toHaveText('2');

    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page.locator('#tab-logo')).toBeVisible();
    await expect(page.locator('#obj-magnet-enabled')).toBeChecked();
    await expect(page.locator('#obj-magnet-shape')).toHaveValue('block');
    await expect(page.locator('#obj-magnet-preset')).toHaveValue('custom');
    await expect(page.locator('#obj-magnet-length')).toHaveValue('27.5');
    await expect(page.locator('#obj-magnet-width')).toHaveValue('7.5');
    await expect(page.locator('#obj-magnet-height')).toHaveValue('2.5');
    await expect(page.locator('#obj-magnet-count')).toHaveValue('2');

    await page.locator('[data-magnet-mode="bottom"]').click();
    await expect(page.locator('[data-magnet-mode="bottom"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#obj-magnet-floor-field')).toBeHidden();

    await page.locator('.magnet-pocket-switch').click();
    await expect(page.locator('#use-base-layer')).not.toBeChecked();
    await expect(page.locator('#logo-use-base-layer')).not.toBeChecked();
});

test('Bambu project emits native pause metadata only for hidden insertion events', async ({ page }) => {
    await waitForApp(page);

    const result = await page.evaluate(async () => {
        const { buildBambuProjectFiles } = await import('/modules/bambu-project.js?v=magnet-tests');
        const geometry = new window.THREE.BoxGeometry(20, 20, 4);
        const layer = {
            geometry,
            displayLabel: 'Magnet Base',
            color: { r: 32, g: 48, b: 64 },
            materialIndex: 0
        };
        const withPause = buildBambuProjectFiles({
            layers: [layer],
            baseName: 'magnet_pause',
            pauseEvents: [{
                type: 'pause',
                z: 4,
                message: 'Insert 4 × Ø10×3 mm magnets & resume',
                gcode: 'M400 U1'
            }]
        });
        const withoutPause = buildBambuProjectFiles({
            layers: [layer],
            baseName: 'bottom_recess',
            pauseEvents: []
        });
        geometry.dispose();

        return {
            xml: withPause.files['Metadata/custom_gcode_per_layer.xml'],
            bottomHasMetadata: Object.prototype.hasOwnProperty.call(
                withoutPause.files,
                'Metadata/custom_gcode_per_layer.xml'
            )
        };
    });

    expect(result.xml).toContain('<plate_info id="1"/>');
    expect(result.xml).toContain('top_z="4"');
    expect(result.xml).toContain('type="1"');
    expect(result.xml).toContain('gcode="M400 U1"');
    expect(result.xml).toContain('Insert 4 × Ø10×3 mm magnets &amp; resume');
    expect(result.xml).toContain('<mode value="SingleExtruder"/>');
    expect(result.bottomHasMetadata).toBe(false);
});

test('Logo preview places hidden pockets, auto-thickens the base, and renders X-ray proxies', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page.locator('#tab-logo')).toBeVisible();
    await expect(page.locator('#logo-obj-preview-placeholder')).toBeHidden({ timeout: 30_000 });

    const baselineHeight = Number.parseFloat(
        await page.locator('#logo-model-size-readout').getAttribute('data-print-height')
    );
    await page.locator('.magnet-pocket-switch').click();

    await expect(page.locator('#obj-magnet-panel')).toHaveAttribute('data-state', 'ready', {
        timeout: 30_000
    });
    await expect(page.locator('#obj-magnet-status-text')).toContainText('4 pockets placed');
    await expect(page.locator('#obj-magnet-status-text')).toContainText('auto-thickened by 0.8 mm');
    await expect(page.locator('#obj-magnet-pause')).toContainText('Z 4 mm');
    await expect(page.locator('#logo-export-obj-btn')).toBeEnabled();
    await expect(page.locator('#logo-export-3mf-btn')).toBeEnabled();
    await expect(page.locator('#logo-export-stl-btn')).toBeEnabled();

    const preview = await page.evaluate(() => {
        const canvas = document.getElementById('logo-obj-preview-canvas');
        const height = Number.parseFloat(
            document.getElementById('logo-model-size-readout')?.dataset.printHeight || '0'
        );
        return {
            height,
            canvasWidth: canvas?.width || 0,
            canvasHeight: canvas?.height || 0,
            proxies: Number.parseInt(canvas?.dataset.magnetPocketCount || '0', 10)
        };
    });
    expect(preview.height).toBeCloseTo(baselineHeight + 0.8, 1);
    expect(preview.canvasWidth).toBeGreaterThan(0);
    expect(preview.canvasHeight).toBeGreaterThan(0);
    expect(preview.proxies).toBe(4);

    await page.locator('.magnet-pocket-switch').click();
    await expect.poll(async () => Number.parseFloat(
        await page.locator('#logo-model-size-readout').getAttribute('data-print-height')
    )).toBeCloseTo(baselineHeight, 1);
    await expect(page.locator('#logo-obj-preview-canvas')).toHaveAttribute('data-magnet-pocket-count', '0');
});

test('3D image workflow carves the same shared four-pocket plan', async ({ page }) => {
    await waitForApp(page);
    const sourceSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
            <rect width="240" height="120" rx="20" fill="#111827"/>
            <rect x="80" y="28" width="80" height="64" rx="12" fill="#2563eb"/>
        </svg>
    `;
    await page.locator('#file-input').setInputFiles({
        name: 'magnet-base.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(sourceSvg)
    });
    await expect(page.locator('#obj-preview-placeholder')).toBeHidden({ timeout: 30_000 });
    await page.locator('.magnet-pocket-switch').click();

    await expect(page.locator('#obj-magnet-panel')).toHaveAttribute('data-state', 'ready', {
        timeout: 30_000
    });
    await expect(page.locator('#obj-magnet-status-text')).toContainText('4 pockets placed');
    await expect(page.locator('#export-obj-btn')).toBeEnabled();
    await expect(page.locator('#export-3mf-btn')).toBeEnabled();
    await expect(page.locator('#export-stl-btn')).toBeEnabled();
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute('data-magnet-pocket-count', '4');
});

test('oversized Logo pockets block every 3D export until the configuration fits', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page.locator('#logo-obj-preview-placeholder')).toBeHidden({ timeout: 30_000 });
    await page.locator('.magnet-pocket-switch').click();
    await expect(page.locator('#obj-magnet-panel')).toHaveAttribute('data-state', 'ready', {
        timeout: 30_000
    });

    await page.locator('#obj-magnet-preset').selectOption('disc-20x5');
    await expect(page.locator('#obj-magnet-panel')).toHaveAttribute('data-state', 'error', {
        timeout: 30_000
    });
    await expect(page.locator('#obj-magnet-status-text')).toContainText('of 4 magnet pockets fit');
    await expect(page.locator('#logo-export-obj-btn')).toBeDisabled();
    await expect(page.locator('#logo-export-3mf-btn')).toBeDisabled();
    await expect(page.locator('#logo-export-stl-btn')).toBeDisabled();
    await expect(page.locator('#logo-bambu-open-btn')).toBeDisabled();

    await page.locator('#obj-magnet-count').evaluate((input) => {
        input.value = '2';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#obj-magnet-panel')).toHaveAttribute('data-state', 'ready', {
        timeout: 30_000
    });
    await expect(page.locator('#logo-export-obj-btn')).toBeEnabled();
    await expect(page.locator('#logo-export-3mf-btn')).toBeEnabled();
    await expect(page.locator('#logo-export-stl-btn')).toBeEnabled();
});

test('magnetized Logo STL keeps the carved base closed and preserves insertion elevations', async ({ page }, testInfo) => {
    await waitForApp(page);
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();
    await expect(page.locator('#logo-obj-preview-placeholder')).toBeHidden({ timeout: 30_000 });
    await page.locator('.magnet-pocket-switch').click();
    await expect(page.locator('#obj-magnet-panel')).toHaveAttribute('data-state', 'ready', {
        timeout: 30_000
    });

    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await page.locator('#logo-export-stl-btn').evaluate((button) => {
        const details = button.closest('details');
        if (details) details.open = true;
    });
    await page.locator('#logo-export-stl-btn').click();
    await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(2);
    await expect(page.locator('#status-text')).toContainText('Exported 2 STL files.', {
        timeout: 30_000
    });

    const baseDownload = downloads.find((download) => download.suggestedFilename().includes('_L0_'))
        || downloads[0];
    const targetPath = testInfo.outputPath(baseDownload.suggestedFilename());
    await baseDownload.saveAs(targetPath);
    const triangles = parseBinaryStl(fs.readFileSync(targetPath));
    const zValues = [...new Set(
        triangles.flat().map((vertex) => Number(vertex[2].toFixed(3)))
    )].sort((left, right) => left - right);

    expect(triangles.length).toBeGreaterThan(100);
    expect(countOpenBoundaryEdges(triangles)).toBe(0);
    expect(zValues).toContain(0);
    expect(zValues).toContain(0.8);
    expect(zValues).toContain(4);
    expect(zValues).toContain(4.8);
});
