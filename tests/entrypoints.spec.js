const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const canonicalEntrypoint = fs.readFileSync(path.join(root, '3d-obj.html'), 'utf8');
const namedEntrypoints = ['logo.html', 'raster.html', 'annotate.html', 'bulk.html', 'pdf.html', 'svg.html'];

test('named static entrypoints stay synchronized with the 3D app shell', () => {
    for (const filename of namedEntrypoints) {
        const entrypoint = fs.readFileSync(path.join(root, filename), 'utf8');
        expect(entrypoint, `${filename} drifted from 3d-obj.html`).toBe(canonicalEntrypoint);
    }
});

test('the retired converter entrypoint is not part of the static structure', () => {
    expect(fs.existsSync(path.join(root, 'converter.html'))).toBe(false);
});

test('eager shared-module imports are versioned so stale browser modules cannot stop the app', async ({ page }) => {
    let staleUtilityRequests = 0;
    let staleExporterRequests = 0;
    const pageErrors = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route(/\/modules\/tabs\/pdf-utils\.js$/, async (route) => {
        staleUtilityRequests += 1;
        await route.fulfill({
            contentType: 'application/javascript',
            body: 'export function formatPdfBytes() { return "stale"; }'
        });
    });
    await page.route(/\/modules\/export3d\.js$/, async (route) => {
        staleExporterRequests += 1;
        await route.fulfill({
            contentType: 'application/javascript',
            body: 'export function createZipFile() { throw new Error("stale"); }'
        });
    });

    await page.goto('/3d-obj');

    await expect(page.locator('#import-btn')).toBeEnabled();
    await expect(page.locator('#svg-bambu-open-btn')).toBeAttached();
    expect(staleUtilityRequests).toBe(0);
    expect(staleExporterRequests).toBe(0);
    expect(pageErrors).toEqual([]);
});
