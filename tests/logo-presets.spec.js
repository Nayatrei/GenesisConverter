const { test, expect } = require('@playwright/test');

test('logo preset registry exposes ten unique, print-safe numeric starters', async ({ page }) => {
    await page.goto('/converter.html');

    const result = await page.evaluate(async () => {
        const {
            LOGO_PRESETS,
            assessLogoPresetFit,
            buildLogoPresetMarkup
        } = await import('/modules/tabs/logo/logo-presets.js?v=test-registry');

        return LOGO_PRESETS.map((preset) => {
            const assessment = assessLogoPresetFit(preset.id, preset.defaults);
            const markup = buildLogoPresetMarkup(preset.id, preset.defaults);
            return {
                id: preset.id,
                name: preset.name,
                ok: assessment.ok,
                errors: assessment.errors,
                warnings: assessment.warnings,
                width: assessment.values.width,
                height: assessment.values.height,
                radius: assessment.values.radius,
                markup
            };
        });
    });

    expect(result).toHaveLength(10);
    expect(new Set(result.map((preset) => preset.id)).size).toBe(10);
    expect(new Set(result.map((preset) => preset.name)).size).toBe(10);

    result.forEach((preset) => {
        expect(preset.ok, `${preset.name}: ${preset.errors.join(' ')}`).toBe(true);
        expect(preset.warnings).toEqual([]);
        expect(preset.width).toBeGreaterThanOrEqual(120);
        expect(preset.height).toBeGreaterThanOrEqual(70);
        expect(preset.radius).toBeLessThanOrEqual(Math.min(preset.width, preset.height) / 2);
        expect(preset.markup).toContain(`width:${preset.width.toFixed(1)}px`);
        expect(preset.markup).toContain(`height:${preset.height.toFixed(1)}px`);
        expect(preset.markup).not.toMatch(/<script|on\w+=|javascript:/i);
    });
});

test('numeric controls report overflow before rendering an unreadable logo', async ({ page }) => {
    await page.goto('/converter.html');
    await page.locator('.segmented-control-tab[data-tab="logo"]').click();

    await page.locator('[data-logo-preset="address-plate"]').click();
    await expect(page.locator('#logo-builder-fit-status')).toHaveClass(/is-ready/);

    await page.locator('#logo-builder-text').fill('204204204204');
    await page.locator('#logo-builder-font-size').fill('112');

    await expect(page.locator('#logo-builder-fit-status')).toHaveClass(/is-review/);
    await expect(page.locator('#logo-builder-fit-status strong')).toHaveText('Adjust');
    await expect(page.locator('#logo-builder-fit-status span')).toContainText('wider than');
});
