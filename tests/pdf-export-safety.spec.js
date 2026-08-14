const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { PDFDict, PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');

async function openPdfConverter(page) {
    await page.goto('/pdf');
    await expect(page.getByRole('heading', { name: 'PDF Converter' })).toBeVisible();
}

async function buildTwoPagePdf() {
    const document = await PDFDocument.create();
    document.addPage([240, 180]);
    document.addPage([180, 240]);
    return Buffer.from(await document.save());
}

function addExifOrientation(jpegBytes, orientation) {
    const tiff = Buffer.from([
        0x49, 0x49, 0x2a, 0x00,
        0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x12, 0x01,
        0x03, 0x00,
        0x01, 0x00, 0x00, 0x00,
        orientation, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    ]);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
    const app1 = Buffer.alloc(payload.length + 4);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(payload.length + 2, 2);
    payload.copy(app1, 4);
    return Buffer.concat([jpegBytes.subarray(0, 2), app1, jpegBytes.subarray(2)]);
}

function getFirstPageImageInfo(pdfDocument, pageIndex) {
    const resources = pdfDocument.getPages()[pageIndex].node.Resources();
    const xObjects = resources.lookup(PDFName.of('XObject'), PDFDict);
    const image = xObjects.lookup(xObjects.keys()[0], PDFRawStream);
    return {
        width: image.dict.lookup(PDFName.of('Width')).asNumber(),
        height: image.dict.lookup(PDFName.of('Height')).asNumber(),
        filter: image.dict.lookup(PDFName.of('Filter')).toString()
    };
}

test('generic ZIPs use application/zip while the 3MF MIME remains available explicitly', async ({ page }) => {
    await openPdfConverter(page);
    const result = await page.evaluate(async () => {
        const { createZipFile } = await import('/modules/export3d.js');
        const files = { 'page-01.txt': new TextEncoder().encode('page one') };
        const generic = await createZipFile(files);
        const model = await createZipFile(files, { mimeType: 'model/3mf' });
        return {
            genericType: generic.type,
            modelType: model.type,
            signature: Array.from(new Uint8Array(await generic.slice(0, 4).arrayBuffer()))
        };
    });

    expect(result.genericType).toBe('application/zip');
    expect(result.modelType).toBe('model/3mf');
    expect(result.signature).toEqual([0x50, 0x4b, 0x03, 0x04]);
});

test('multi-page PDF image export downloads an application/zip archive', async ({ page }) => {
    await page.addInitScript(() => {
        globalThis.__GENESIS_CREATED_BLOB_TYPES__ = [];
        const createObjectUrl = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
            globalThis.__GENESIS_CREATED_BLOB_TYPES__.push(blob?.type || '');
            return createObjectUrl(blob);
        };
    });
    await openPdfConverter(page);
    await page.locator('[data-pdf-task="pdf-images"]').click();
    await page.locator('#pdf-file-input').setInputFiles({
        name: 'two-pages.pdf',
        mimeType: 'application/pdf',
        buffer: await buildTwoPagePdf()
    });
    await expect(page.locator('.pdf-file-row[data-status="ready"]')).toHaveCount(1);
    await expect(page.locator('#pdf-page-count')).toHaveText('2');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-export-images-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('combined_png_pages.zip');
    const bytes = fs.readFileSync(await download.path());
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const createdTypes = await page.evaluate(() => globalThis.__GENESIS_CREATED_BLOB_TYPES__);
    expect(createdTypes).toContain('application/zip');
    expect(createdTypes).not.toContain('model/3mf');
});

test('PDF page-image planning clamps single canvases and rejects oversized batches before rendering', async ({ page }) => {
    await openPdfConverter(page);
    const result = await page.evaluate(async () => {
        const {
            getPdfImageExportDimensions,
            PDF_IMAGE_EXPORT_MAX_PAGE_PIXELS,
            validatePdfImageExportPlan
        } = await import('/modules/tabs/pdf-utils.js');

        const pagePlan = getPdfImageExportDimensions({
            targetWidth: 8192,
            baseWidth: 1000,
            baseHeight: 1000
        });
        let tgaError = '';
        try {
            validatePdfImageExportPlan({
                pages: [pagePlan, pagePlan, pagePlan],
                format: 'tga'
            });
        } catch (error) {
            tgaError = error.message;
        }
        let aggregateError = '';
        try {
            validatePdfImageExportPlan({
                pages: [pagePlan, pagePlan, pagePlan, pagePlan, pagePlan],
                format: 'jpg'
            });
        } catch (error) {
            aggregateError = error.message;
        }
        return {
            pagePlan,
            maxPagePixels: PDF_IMAGE_EXPORT_MAX_PAGE_PIXELS,
            tgaError,
            aggregateError
        };
    });

    expect(result.pagePlan.width * result.pagePlan.height).toBeLessThanOrEqual(result.maxPagePixels);
    expect(result.pagePlan.width).toBeLessThan(8192);
    expect(result.tgaError).toMatch(/TGA export is estimated .*browser-safe.*Reduce the image width or export fewer pages/i);
    expect(result.aggregateError).toMatch(/render .*megapixels.*browser-safe.*Reduce the image width or export fewer pages/i);
});

test('orientation-6 JPEGs are normalized while orientation-1 JPEGs keep direct embedding', async ({ page }) => {
    await openPdfConverter(page);
    await page.locator('[data-pdf-task="images-pdf"]').click();

    const base64Jpeg = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 20;
        const context = canvas.getContext('2d');
        context.fillStyle = '#e53935';
        context.fillRect(0, 0, 20, 20);
        context.fillStyle = '#1565c0';
        context.fillRect(20, 0, 20, 20);
        return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    });
    const normalJpeg = Buffer.from(base64Jpeg, 'base64');
    const orientedJpeg = addExifOrientation(normalJpeg, 6);

    await page.locator('#pdf-image-file-input').setInputFiles([
        {
            name: 'normal-landscape.jpg',
            mimeType: 'image/jpeg',
            buffer: normalJpeg
        },
        {
            name: 'phone-orientation-6.jpg',
            mimeType: 'image/jpeg',
            buffer: orientedJpeg
        }
    ]);

    const cards = page.locator('#pdf-images-to-pdf-list .pdf-image-page-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.pdf-image-page-info span')).toContainText('40 × 20px');
    await expect(cards.nth(1).locator('.pdf-image-page-info span')).toContainText('20 × 40px');

    await page.locator('#pdf-images-to-pdf-name').fill('jpeg-orientation.pdf');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-images-to-pdf-export-btn').click();
    const download = await downloadPromise;
    const outputDocument = await PDFDocument.load(fs.readFileSync(await download.path()));

    const pageSizes = outputDocument.getPages().map((pdfPage) => [
        Math.round(pdfPage.getWidth()),
        Math.round(pdfPage.getHeight())
    ]);
    expect(pageSizes).toEqual([[30, 15], [15, 30]]);

    const normalImage = getFirstPageImageInfo(outputDocument, 0);
    const orientedImage = getFirstPageImageInfo(outputDocument, 1);
    expect(normalImage).toMatchObject({ width: 40, height: 20, filter: '/DCTDecode' });
    expect(orientedImage.width).toBe(20);
    expect(orientedImage.height).toBe(40);
    expect(orientedImage.filter).not.toBe('/DCTDecode');
});
