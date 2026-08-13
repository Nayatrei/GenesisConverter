const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const canonicalEntrypoint = fs.readFileSync(path.join(root, '3d-obj.html'), 'utf8');
const namedEntrypoints = ['logo.html', 'raster.html', 'bulk.html', 'pdf.html', 'svg.html'];

test('named static entrypoints stay synchronized with the 3D app shell', () => {
    for (const filename of namedEntrypoints) {
        const entrypoint = fs.readFileSync(path.join(root, filename), 'utf8');
        expect(entrypoint, `${filename} drifted from 3d-obj.html`).toBe(canonicalEntrypoint);
    }
});

test('the retired converter entrypoint is not part of the static structure', () => {
    expect(fs.existsSync(path.join(root, 'converter.html'))).toBe(false);
});
