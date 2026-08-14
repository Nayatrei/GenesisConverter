const fs = require('node:fs');
const zlib = require('node:zlib');
const { test, expect } = require('@playwright/test');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function openPdfConverter(page) {
    await page.goto('/pdf');
    await expect(page.getByRole('heading', { name: 'PDF Converter' })).toBeVisible();
    await expect(page.locator('[data-pdf-task]')).toHaveCount(4);
}

async function buildNativeTextPdf(text) {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const pdfPage = document.addPage([420, 300]);
    pdfPage.drawText(text, {
        x: 36,
        y: 220,
        size: 20,
        font,
        color: rgb(0.1, 0.12, 0.16)
    });
    return Buffer.from(await document.save());
}

function buildPng(width, height, rgba) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const row = Buffer.alloc(width * 4);
    for (let offset = 0; offset < row.length; offset += 4) {
        row[offset] = rgba[0];
        row[offset + 1] = rgba[1];
        row[offset + 2] = rgba[2];
        row[offset + 3] = rgba[3];
    }
    const raw = Buffer.concat(Array.from({ length: height }, () => (
        Buffer.concat([Buffer.from([0]), row])
    )));

    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

function pngChunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return chunk;
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

test('PDF Converter exposes four clear tasks and builds a PDF from ordered images', async ({ page }) => {
    await openPdfConverter(page);

    const taskButtons = page.locator('[data-pdf-task]');
    await expect(taskButtons).toHaveText([
        /Combine PDFs/,
        /PDF to Images/,
        /Files to PDF/,
        /Scanned PDF to Text/
    ]);

    await page.locator('[data-pdf-task="pdf-images"]').click();
    await expect(page.locator('#pdf-document-tools-panel')).toBeVisible();
    await expect(page.locator('#pdf-document-tools-panel > .pdf-step-track')).toBeHidden();
    await expect(page.locator('[data-pdf-document-action="pdf-images"]')).toBeVisible();
    await expect(page.locator('#pdf-export-images-btn')).toBeVisible();

    await page.locator('[data-pdf-task="images-pdf"]').click();
    await expect(page.locator('#pdf-images-to-pdf-panel')).toBeVisible();
    await expect(page.locator('#pdf-document-tools-panel')).toBeHidden();

    await page.locator('#pdf-image-file-input').setInputFiles([
        {
            name: 'landscape-red.png',
            mimeType: 'image/png',
            buffer: buildPng(48, 24, [210, 55, 48, 255])
        },
        {
            name: 'portrait-blue.png',
            mimeType: 'image/png',
            buffer: buildPng(24, 48, [48, 92, 210, 255])
        }
    ]);

    await expect(page.locator('#pdf-images-to-pdf-count')).toHaveText('2');
    await expect(page.locator('#pdf-image-file-count')).toHaveText('2');
    await expect(page.locator('#pdf-images-to-pdf-list .pdf-image-page-card')).toHaveCount(2);
    await expect(page.locator('#pdf-images-to-pdf-list .pdf-image-page-actions').first()).toContainText('Move earlier');
    await expect(page.locator('#pdf-images-to-pdf-list .pdf-image-page-actions').first()).toContainText('Move later');
    await expect(page.locator('#pdf-images-to-pdf-list .pdf-image-page-actions').first()).toContainText('Rotate left');
    await expect(page.locator('#pdf-images-to-pdf-list .pdf-image-page-actions').first()).toContainText('Rotate right');
    await expect(page.locator('#pdf-images-to-pdf-list .pdf-image-page-actions').first()).toContainText('Remove');

    const pageCards = page.locator('#pdf-images-to-pdf-list .pdf-image-page-card');
    await expect(pageCards.locator('.pdf-image-page-info strong')).toHaveText([
        'landscape-red.png',
        'portrait-blue.png'
    ]);
    await pageCards.first().getByRole('button', { name: 'Rotate right' }).click();
    await pageCards.first().getByRole('button', { name: 'Move later' }).click();
    await expect(pageCards.locator('.pdf-image-page-info strong')).toHaveText([
        'portrait-blue.png',
        'landscape-red.png'
    ]);

    await page.locator('[data-pdf-page-size="letter"]').click();
    await expect(page.locator('[data-pdf-page-size="letter"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#pdf-images-to-pdf-name').fill('two-images.pdf');
    await expect(page.locator('#pdf-images-to-pdf-export-btn')).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-images-to-pdf-export-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('two-images.pdf');

    const downloadPath = await download.path();
    const outputDocument = await PDFDocument.load(fs.readFileSync(downloadPath));
    expect(outputDocument.getPageCount()).toBe(2);
    expect(outputDocument.getPages().map((pdfPage) => [
        Math.round(pdfPage.getWidth()),
        Math.round(pdfPage.getHeight())
    ])).toEqual([
        [612, 792],
        [612, 792]
    ]);
});

test('PDF Converter keeps one task panel visible without mobile overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPdfConverter(page);

    await page.locator('[data-pdf-task="ocr"]').click();
    await expect(page.locator('#pdf-ocr-panel')).toBeVisible();
    await expect(page.locator('#pdf-document-tools-panel')).toBeHidden();
    await expect(page.locator('#pdf-images-to-pdf-panel')).toBeHidden();

    await page.locator('[data-pdf-task="images-pdf"]').click();
    await expect(page.locator('#pdf-images-to-pdf-panel')).toBeVisible();
    await expect(page.locator('#pdf-document-tools-panel')).toBeHidden();
    await expect(page.locator('#pdf-ocr-panel')).toBeHidden();

    const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test('PDF to Images exports a selected PDF page as a PNG', async ({ page }) => {
    await openPdfConverter(page);
    await page.locator('[data-pdf-task="pdf-images"]').click();
    await page.locator('#pdf-file-input').setInputFiles({
        name: 'one-page-source.pdf',
        mimeType: 'application/pdf',
        buffer: await buildNativeTextPdf('One page becomes one PNG')
    });

    await expect(page.locator('.pdf-file-row[data-status="ready"]')).toHaveCount(1);
    await expect(page.locator('#pdf-page-count')).toHaveText('1');
    await page.locator('#pdf-output-name').fill('page-images.pdf');
    await expect(page.locator('#pdf-export-images-btn')).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-export-images-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('page-images_page_01.png');
    const bytes = fs.readFileSync(await download.path());
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test('native PDF text is extracted without starting OCR and corrected text downloads', async ({ page }) => {
    await page.addInitScript(() => {
        globalThis.__PDF_NATIVE_OCR_FACTORY_CALLS__ = 0;
        globalThis.__GENESIS_OCR_WORKER_FACTORY__ = async () => {
            globalThis.__PDF_NATIVE_OCR_FACTORY_CALLS__ += 1;
            throw new Error('Native PDF text must not start the OCR worker.');
        };
    });
    const externalOcrRequests = [];
    page.on('request', (request) => {
        if (/tesseract|tessdata|projectnaptha|jsdelivr/i.test(request.url())) {
            externalOcrRequests.push(request.url());
        }
    });

    await openPdfConverter(page);
    await page.locator('[data-pdf-task="ocr"]').click();
    await expect(page.locator('#pdf-ocr-panel')).toBeVisible();

    const sourceText = 'Native contract words stay local';
    await page.locator('#pdf-ocr-file-input').setInputFiles({
        name: 'native-contract.pdf',
        mimeType: 'application/pdf',
        buffer: await buildNativeTextPdf(sourceText)
    });
    await expect(page.locator('#pdf-ocr-start-btn')).toBeEnabled();
    await page.locator('#pdf-ocr-start-btn').click();
    await expect(page.locator('#pdf-ocr-output')).toHaveValue(new RegExp(sourceText));

    expect(await page.evaluate(() => globalThis.__PDF_NATIVE_OCR_FACTORY_CALLS__)).toBe(0);
    expect(externalOcrRequests).toEqual([]);

    const correctedText = 'Reviewed native text\nThis correction must be downloaded.';
    await page.locator('#pdf-ocr-output').fill(correctedText);
    await expect(page.locator('#pdf-ocr-download-btn')).toBeEnabled();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-ocr-download-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('native-contract.txt');
    const downloadedText = fs.readFileSync(await download.path(), 'utf8');
    expect(downloadedText).toContain(correctedText);
    expect(downloadedText).not.toContain(sourceText);
});

test('scanned image OCR uses the deterministic worker hook and downloads its text', async ({ page }) => {
    await page.addInitScript(() => {
        globalThis.__PDF_SCANNED_OCR_CALLS__ = {
            factory: 0,
            recognize: 0,
            terminate: 0
        };
        globalThis.__GENESIS_OCR_WORKER_FACTORY__ = async ({ logger }) => {
            globalThis.__PDF_SCANNED_OCR_CALLS__.factory += 1;
            return {
                async recognize() {
                    globalThis.__PDF_SCANNED_OCR_CALLS__.recognize += 1;
                    logger({ status: 'recognizing text', progress: 0.75 });
                    return { data: { text: 'Deterministic scanned invoice text' } };
                },
                async terminate() {
                    globalThis.__PDF_SCANNED_OCR_CALLS__.terminate += 1;
                }
            };
        };
    });

    await openPdfConverter(page);
    await page.locator('[data-pdf-task="ocr"]').click();
    await page.locator('#pdf-ocr-file-input').setInputFiles({
        name: 'scanned-invoice.png',
        mimeType: 'image/png',
        buffer: buildPng(64, 32, [242, 242, 238, 255])
    });
    await page.locator('#pdf-ocr-start-btn').click();
    await expect(page.locator('#pdf-ocr-output')).toHaveValue(/Deterministic scanned invoice text/);
    await expect.poll(() => page.evaluate(() => (
        globalThis.__PDF_SCANNED_OCR_CALLS__
    ))).toEqual({ factory: 1, recognize: 1, terminate: 1 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-ocr-download-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('scanned-invoice.txt');
    expect(fs.readFileSync(await download.path(), 'utf8')).toContain('Deterministic scanned invoice text');
});
