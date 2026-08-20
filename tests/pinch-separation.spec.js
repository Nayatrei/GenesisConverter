const zlib = require('zlib');
const { test, expect } = require('@playwright/test');

// Regression cover for "Could not send (geometry) / 3D print validation failed:
// L1 has 1 non-manifold edge." Two same-colour regions that meet at exactly one
// diagonal pixel corner used to weld into a shared vertical edge and block the
// Bambu handoff. Face-down amplifies it, because the base becomes an inlay plate
// carved by every colour region.

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value;
    }
    return table;
})();

function crc32(buffer) {
    let crc = -1;
    for (let index = 0; index < buffer.length; index++) {
        crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed), 0);
    return Buffer.concat([length, typed, crc]);
}

// 64x64 white canvas with two 20x20 squares at (8,8) and (28,28): pixel (27,27)
// and pixel (28,28) are diagonal neighbours, so the two regions share exactly one
// lattice point and nothing else.
function buildDiagonalContactPng() {
    const size = 64;
    const stride = size * 3 + 1;
    const raw = Buffer.alloc(size * stride);
    let offset = 0;
    for (let y = 0; y < size; y++) {
        raw[offset++] = 0; // filter type: none
        for (let x = 0; x < size; x++) {
            const inFirst = x >= 8 && x < 28 && y >= 8 && y < 28;
            const inSecond = x >= 28 && x < 48 && y >= 28 && y < 48;
            const filled = inFirst || inSecond;
            raw[offset++] = filled ? 0x11 : 0xff;
            raw[offset++] = filled ? 0x18 : 0xff;
            raw[offset++] = filled ? 0x27 : 0xff;
        }
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type: truecolour
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

async function openDiagonalContactModel(page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = () => true;
    });
    // No local transfer service in the test runner: the handoff falls back to a
    // plain .3mf download, which is the step the geometry bug used to kill.
    await page.route('**/health', (route) => route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not found'
    }));
    await page.route('**/api/bambu-transfer?**', (route) => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Transfer service unavailable.' })
    }));

    await page.goto('/3d-obj');
    await page.locator('#file-input').setInputFiles({
        name: 'diagonal-contact.png',
        mimeType: 'image/png',
        buffer: buildDiagonalContactPng()
    });
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', { timeout: 60_000 });
}

async function prepareBambuTransfer(page) {
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        page.locator('#svg-bambu-open-btn').click()
    ]);
    return download;
}

test('diagonal pixel contact still prepares a Bambu transfer', async ({ page }) => {
    await openDiagonalContactModel(page);

    const download = await prepareBambuTransfer(page);
    expect(download.suggestedFilename()).toMatch(/\.3mf$/);
    await expect(page.locator('#status-text')).not.toContainText('non-manifold');
    await expect(page.locator('#status-text')).not.toContainText('validation failed');
});

test('diagonal pixel contact still prepares a Bambu transfer with Face on Bed', async ({ page }) => {
    await openDiagonalContactModel(page);

    await page.locator('#obj-face-down-toggle').click();
    await expect(page.locator('#obj-preview-canvas')).toHaveAttribute(
        'data-ams-print-style',
        'face-down',
        { timeout: 60_000 }
    );

    const download = await prepareBambuTransfer(page);
    expect(download.suggestedFilename()).toMatch(/\.3mf$/);
    await expect(page.locator('#status-text')).not.toContainText('non-manifold');
    await expect(page.locator('#status-text')).not.toContainText('validation failed');
});
