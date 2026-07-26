const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.goto('/converter.html');
    await expect.poll(
        () => page.evaluate(() => Boolean(window.THREE)),
        { timeout: 30_000 }
    ).toBe(true);
});

test('print validation accepts a closed model and rejects open mesh geometry', async ({ page }) => {
    const results = await page.evaluate(async () => {
        const { validateGeometryBundleForPrint } = await import('/modules/shared/print-validation.js?v=test');
        const closedGeometry = new window.THREE.BoxGeometry(20, 20, 4);
        closedGeometry.translate(0, 0, 2);
        const openGeometry = new window.THREE.PlaneGeometry(20, 20);

        const createBundle = (geometry) => ({
            layers: new Map([['layer', {
                displayLabel: 'Validation layer',
                geometry
            }]])
        });
        const closed = validateGeometryBundleForPrint(createBundle(closedGeometry), {
            bedKey: 'x1',
            margin: 5
        });
        const open = validateGeometryBundleForPrint(createBundle(openGeometry), {
            bedKey: 'x1',
            margin: 5
        });

        closedGeometry.dispose();
        openGeometry.dispose();
        return {
            closed: { ok: closed.ok, errors: closed.errors },
            open: { ok: open.ok, errors: open.errors }
        };
    });

    expect(results.closed).toEqual({ ok: true, errors: [] });
    expect(results.open.ok).toBe(false);
    expect(results.open.errors.join(' ')).toContain('open mesh edge');
});

test('print validation rejects models taller than the selected printer', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { validateGeometryBundleForPrint } = await import('/modules/shared/print-validation.js?v=test-height');
        const geometry = new window.THREE.BoxGeometry(20, 20, 200);
        geometry.translate(0, 0, 100);
        const validation = validateGeometryBundleForPrint({
            layers: new Map([['layer', {
                displayLabel: 'Tall model',
                geometry
            }]])
        }, {
            bedKey: 'a1mini',
            margin: 5
        });
        geometry.dispose();
        return {
            ok: validation.ok,
            errors: validation.errors
        };
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('exceeds the Bambu A1 mini height');
});
