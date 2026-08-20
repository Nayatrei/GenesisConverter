const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOOL_ENTRYPOINTS = [
    '3d-obj.html',
    'logo.html',
    'raster.html',
    'annotate.html',
    'bulk.html',
    'pdf.html',
    'svg.html'
];
const RELEASE_VERSION_PATTERN = /^r-[a-f0-9]{16}$/;

function walkJsFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    const results = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) results.push(...walkJsFiles(fullPath));
        else if (/\.(?:js|mjs)$/.test(entry.name) && !/ \d+\.(?:js|mjs)$/.test(entry.name)) results.push(fullPath);
    }
    return results;
}

function readModuleSpecifiers(source) {
    const patterns = [
        /\bfrom\s*['"](\.{1,2}\/[^'"]+\.(?:js|mjs)(?:\?v=[^'"]*)?)['"]/g,
        /^\s*import\s*['"](\.{1,2}\/[^'"]+\.(?:js|mjs)(?:\?v=[^'"]*)?)['"]/gm,
        /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+\.(?:js|mjs)(?:\?v=[^'"]*)?)['"]\s*\)/g,
        /\bnew URL\(\s*['"](\.{1,2}\/[^'"]+\.(?:js|mjs)(?:\?v=[^'"]*)?)['"]\s*,\s*import\.meta\.url\s*\)/g
    ];
    return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

test('tool entrypoints use the stable bootstrap and one release version', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-version.json'), 'utf8'));
    const canonical = fs.readFileSync(path.join(ROOT, TOOL_ENTRYPOINTS[0]), 'utf8');
    expect(manifest.schema).toBe(1);
    expect(manifest.version).toMatch(RELEASE_VERSION_PATTERN);
    expect(canonical).toContain(
        `<script type="module" src="app-bootstrap.js?v=${manifest.version}"></script>`
    );
    expect(canonical).toContain(`href="style.css?v=${manifest.version}"`);
    expect(canonical).not.toMatch(/<script[^>]+src="imagetracer_v1\.2\.6\.js/);
    expect(canonical).not.toMatch(/<script[^>]+src="three-setup\.js/);
    expect(canonical).not.toMatch(/src="converter[^"]+"/);
    for (const filename of TOOL_ENTRYPOINTS.slice(1)) {
        expect(fs.readFileSync(path.join(ROOT, filename), 'utf8')).toBe(canonical);
    }
});

test('every mutable local module edge uses the current release version', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-version.json'), 'utf8'));
    const runtimeFiles = [
        path.join(ROOT, 'converter.js'),
        path.join(ROOT, 'three-setup.js'),
        ...walkJsFiles(path.join(ROOT, 'modules')),
        ...walkJsFiles(path.join(ROOT, 'vendor', 'three'))
    ];
    const failures = [];

    for (const filePath of runtimeFiles) {
        const source = fs.readFileSync(filePath, 'utf8');
        for (const specifier of readModuleSpecifiers(source)) {
            const [target, query = ''] = specifier.split('?');
            const resolvedTarget = path.resolve(path.dirname(filePath), target);
            if (!fs.existsSync(resolvedTarget)) {
                failures.push(`${path.relative(ROOT, filePath)} -> missing ${target}`);
            }
            if (query !== `v=${version}`) {
                failures.push(`${path.relative(ROOT, filePath)} -> ${specifier}`);
            }
        }
    }

    expect(failures, failures.join('\n')).toEqual([]);
});

test('bootstrap and version manifest are served without cache', async ({ request }) => {
    for (const url of ['/app-bootstrap.js', '/app-version.json', '/3d-obj', '/svg']) {
        const response = await request.get(url);
        expect(response.ok()).toBe(true);
        expect(response.headers()['cache-control']).toContain('no-store');
    }
});

test('only the current content release receives immutable caching', async ({ request }) => {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-version.json'), 'utf8'));
    const current = await request.get(`/converter.js?v=${version}`);
    expect(current.ok()).toBe(true);
    expect(current.headers()['cache-control']).toContain('immutable');
    const currentPartial = await request.get(`/modules/tabs/html/tab-svg.html?v=${version}`);
    expect(currentPartial.ok()).toBe(true);
    expect(currentPartial.headers()['cache-control']).toContain('immutable');

    const stale = await request.get('/converter.js?v=r-0000000000000000');
    expect(stale.status()).toBe(409);
    expect(stale.headers()['cache-control']).toContain('no-store');

    const testOnly = await request.get('/converter.js?v=playwright-test');
    expect(testOnly.ok()).toBe(true);
    expect(testOnly.headers()['cache-control']).toContain('no-cache');
});

test('the release manifest matches the normalized runtime content hash', () => {
    const { computeReleaseVersion } = require('../scripts/sync-cache-version.js');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-version.json'), 'utf8'));
    expect(manifest.version).toBe(computeReleaseVersion());
});

test('an import made during version boot is queued and processed after controllers bind', async ({ page }) => {
    await page.route('**/app-version.json?**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await route.continue();
    });
    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'early-import.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">'
            + '<rect width="80" height="80" rx="12" fill="#facc15"/>'
            + '<circle cx="40" cy="40" r="18" fill="#111827"/>'
            + '</svg>'
        )
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 30_000 });
    await expect(page.locator('#obj-preview-placeholder')).toBeHidden();
    await expect(page.locator('#loader-overlay')).toBeHidden();
});
