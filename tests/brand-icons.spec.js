const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

test('Editor master and resized browser/install icons retain approved identity', () => {
    expect(digest('icon-512.png')).toBe('a9c538a5340261c561e0400e110bb9a3a161c7c8ced966831383d655f5d77b8a');
    for (const [file, size] of [['favicon-16x16.png',16], ['favicon-32x32.png',32],
        ['apple-touch-icon.png',180], ['icon-192.png',192], ['icon-512.png',512],
        ['maskable-icon-192.png',192], ['maskable-icon-512.png',512]]) {
        const png = fs.readFileSync(path.join(root, file));
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([size,size]);
    }
    const ico = fs.readFileSync(path.join(root, 'favicon.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0,1,4]);
});

test('all public entrypoints and callback share versioned favicons and manifest', async ({ request }) => {
    const routes = ['/', '/3d-obj', '/logo', '/raster', '/bulk', '/pdf', '/annotate', '/svg',
        '/guides/', '/guides/image-to-stl.html', '/guides/logo-to-3mf.html', '/auth/callback/'];
    const versions = new Set();
    for (const route of routes) {
        const response = await request.get(route);
        expect(response.ok(), route).toBe(true);
        const html = await response.text();
        for (const file of ['favicon.ico','favicon-16x16.png','favicon-32x32.png','apple-touch-icon.png','manifest.webmanifest']) {
            const match = html.match(new RegExp(`href="/${file.replaceAll('.', '\\.')}\\?v=(brand-[a-f0-9]{16})"`));
            expect(match, `${route}: ${file}`).not.toBeNull();
            versions.add(match[1]);
        }
        if (route !== '/auth/callback/') expect(html).toMatch(/class="stage-brand-mark" src="\/icon-192\.png\?v=brand-[a-f0-9]{16}"/);
    }
    expect(versions.size).toBe(1);
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    for (const icon of manifest.icons) {
        expect(icon.src).toContain(`?v=${[...versions][0]}`);
        expect((await request.get(icon.src)).ok()).toBe(true);
    }
    expect((await request.get('/favicon.ico')).ok()).toBe(true);
});

test('mascot fits desktop/mobile headers without decoration or clipping', async ({ page }) => {
    for (const width of [320,390,1280]) {
        await page.setViewportSize({width,height:900});
        for (const route of ['/', '/pdf', '/guides/']) {
            await page.goto(route);
            const mascot = page.locator('.stage-brand-mark');
            await expect(mascot).toBeVisible();
            await expect.poll(() => mascot.evaluate(img => img.naturalWidth)).toBe(192);
            const actual = await mascot.evaluate(img => {
                const box = img.getBoundingClientRect(), style = getComputedStyle(img);
                return { width:box.width,height:box.height,left:box.left,right:box.right,
                    fit:style.objectFit,shadow:style.boxShadow,border:style.borderWidth,
                    overflow:document.documentElement.scrollWidth > innerWidth };
            });
            expect(actual.width).toBe(actual.height);
            expect(actual.width).toBeGreaterThanOrEqual(36);
            expect(actual.fit).toBe('contain');
            expect(actual.shadow).toBe('none');
            expect(actual.border).toBe('0px');
            expect(actual.left).toBeGreaterThanOrEqual(0);
            expect(actual.right).toBeLessThanOrEqual(width);
            expect(actual.overflow).toBe(false);
        }
    }
});
