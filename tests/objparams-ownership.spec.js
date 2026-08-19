const { test, expect } = require('@playwright/test');

// The 3D sidebar (#obj-scale, #obj-decimate, #obj-ams-print-style, …) is ONE
// set of DOM nodes handed to both the 3D (SVG) and the Logo tab controllers,
// but each tab owns its own objParams. These tests pin that contract:
//   - a shared control only ever writes the ACTIVE tab's objParams;
//   - the shared DOM is repainted from the active tab's objParams on activation;
//   - an AMS print style picked on one tab never re-thicknesses the other.

function twoColorSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
  <rect x="0" y="0" width="240" height="140" fill="#f2d500"/>
  <rect x="40" y="36" width="160" height="68" rx="10" fill="#111827"/>
</svg>`.trim();
}

function svgFile(name, markup) {
    return { name, mimeType: 'image/svg+xml', buffer: Buffer.from(markup) };
}

function tab(page, name) {
    return page.locator(`.segmented-control-tab[data-tab="${name}"]`);
}

async function waitForAppReady(page) {
    await page.waitForFunction(() => window.__GENESIS_APP_READY__ === true, null, {
        timeout: 60_000
    });
}

// The default Logo preset renders and traces itself as soon as the tab opens.
async function waitForLogoHtmlPreset(page) {
    await expect(page.locator('#logo-html-status')).toHaveText('Ready', { timeout: 60_000 });
    await expect(page.locator('#logo-quality-indicator')).not.toHaveText('', { timeout: 60_000 });
}

function setRangeValue(locator, value) {
    return locator.evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

// converter.js exposes the live state tree; ownership is only observable there.
function readObjParams(page) {
    return page.evaluate(() => {
        const state = window.__GENESIS_APP_STATE__;
        return {
            svg: { ...state.objParams },
            logo: { ...state.logo.objParams },
            svgLayerThickness: { ...state.layerThicknessById },
            logoLayerThickness: { ...state.logo.layerThicknessById },
            aliased: state.objParams === state.logo.objParams,
            magnetAliased: state.objParams.magnetPocket === state.logo.objParams.magnetPocket
        };
    });
}

test('the two tabs never share one objParams object', async ({ page }) => {
    await page.goto('/3d-obj');
    await waitForAppReady(page);

    const params = await readObjParams(page);
    expect(params.aliased).toBe(false);
    // magnetPocket used to be one object referenced by both trees.
    expect(params.magnetAliased).toBe(false);
});

test('a shared 3D control only writes the active tab objParams', async ({ page }) => {
    await page.goto('/logo');
    await waitForAppReady(page);
    await waitForLogoHtmlPreset(page);

    const before = await readObjParams(page);
    expect(before.svg.decimate).toBe(0);
    expect(before.logo.decimate).toBe(0);

    await setRangeValue(page.locator('#obj-decimate'), 40);
    await expect(page.locator('#obj-decimate-value')).toHaveText('40');

    const afterDecimate = await readObjParams(page);
    expect(afterDecimate.logo.decimate).toBe(40);
    // The 3D tab is inactive and must not have been touched.
    expect(afterDecimate.svg.decimate).toBe(0);

    await page.locator('#obj-bed').selectOption('a1');
    await page.locator('#obj-bezel').selectOption('low');

    const afterSelects = await readObjParams(page);
    expect(afterSelects.logo.bedKey).toBe('a1');
    expect(afterSelects.logo.bezelPreset).toBe('low');
    expect(afterSelects.svg.bedKey).toBe('x1');
    expect(afterSelects.svg.bezelPreset).toBe('off');
});

test('the shared 3D controls repaint from the tab being activated', async ({ page }) => {
    await page.goto('/3d-obj');
    await waitForAppReady(page);
    await page.locator('#file-input').setInputFiles(svgFile('two-color.svg', twoColorSvg()));
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 60_000 });

    await setRangeValue(page.locator('#obj-decimate'), 55);
    await expect(page.locator('#obj-decimate-value')).toHaveText('55');
    await page.locator('#obj-bezel').selectOption('high');

    // Switching to Logo must show the LOGO tab's values, not the ones just set
    // on the 3D tab.
    await tab(page, 'logo').click();
    await waitForLogoHtmlPreset(page);
    await expect(page.locator('#obj-decimate')).toHaveValue('0');
    await expect(page.locator('#obj-decimate-value')).toHaveText('0');
    await expect(page.locator('#obj-bezel')).toHaveValue('off');

    // Editing on Logo, then returning, must restore the 3D tab's own values.
    await setRangeValue(page.locator('#obj-decimate'), 20);
    await expect(page.locator('#obj-decimate-value')).toHaveText('20');

    await tab(page, 'svg').click();
    await expect(page.locator('#obj-decimate')).toHaveValue('55');
    await expect(page.locator('#obj-decimate-value')).toHaveText('55');
    await expect(page.locator('#obj-bezel')).toHaveValue('high');

    await tab(page, 'logo').click();
    await expect(page.locator('#obj-decimate')).toHaveValue('20');
    await expect(page.locator('#obj-bezel')).toHaveValue('off');

    const params = await readObjParams(page);
    expect(params.svg.decimate).toBe(55);
    expect(params.svg.bezelPreset).toBe('high');
    expect(params.logo.decimate).toBe(20);
    expect(params.logo.bezelPreset).toBe('off');
});

test('an AMS print style picked on Logo leaves the 3D tab style untouched', async ({ page }) => {
    await page.goto('/3d-obj');
    await waitForAppReady(page);
    await page.locator('#file-input').setInputFiles(svgFile('two-color.svg', twoColorSvg()));
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 60_000 });
    await expect(page.locator('#obj-ams-print-style')).toHaveValue('raised-efficient');

    // Give the 3D tab a per-layer thickness override so the cross-write that
    // used to blank layerThicknessById on both tabs would be caught.
    await page.evaluate(() => {
        window.__GENESIS_APP_STATE__.layerThicknessById = { 0: 1.8 };
    });

    await tab(page, 'logo').click();
    await waitForLogoHtmlPreset(page);

    await page.locator('#obj-ams-print-style').selectOption('full-depth');
    await expect(page.locator('#logo-obj-preview-canvas')).toHaveAttribute(
        'data-ams-print-style',
        'full-depth',
        { timeout: 60_000 }
    );

    const params = await readObjParams(page);
    expect(params.logo.amsPrintStyle).toBe('full-depth');
    expect(params.logo.baseThickness).toBe(4);
    expect(params.logo.thickness).toBe(4);

    expect(params.svg.amsPrintStyle).toBe('raised-efficient');
    expect(params.svg.baseThickness).toBe(2.4);
    expect(params.svg.thickness).toBe(0.6);
    expect(params.svgLayerThickness).toEqual({ 0: 1.8 });

    // Returning to the 3D tab restores its own style on the shared controls.
    await tab(page, 'svg').click();
    await expect(page.locator('#obj-ams-print-style')).toHaveValue('raised-efficient');
    await expect(page.locator('#obj-base-thickness')).toHaveValue('2.4');
    await expect(page.locator('#obj-thickness')).toHaveValue('0.6');
});
