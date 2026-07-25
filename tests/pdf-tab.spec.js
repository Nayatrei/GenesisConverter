const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function buildPdfBuffer(label, pageSizes) {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    pageSizes.forEach(([width, height], index) => {
        const page = pdfDoc.addPage([width, height]);
        page.drawText(`${label} page ${index + 1}`, {
            x: 24,
            y: height - 44,
            size: 16,
            font,
            color: rgb(0.1, 0.12, 0.16)
        });
    });

    return Buffer.from(await pdfDoc.save());
}

async function addPdfFiles(page, files) {
    await page.locator('#pdf-file-input').setInputFiles(files);
    await expect.poll(async () => page.locator('.pdf-file-row[data-status="ready"]').count(), {
        timeout: 30_000
    }).toBe(files.length);
}

function rowFor(page, filename) {
    return page.locator('.pdf-file-row').filter({ hasText: filename });
}

test('PDF range parser handles supported syntax and validation', async ({ page }) => {
    await page.goto('/converter.html');

    const result = await page.evaluate(async () => {
        const { parsePdfPageRange } = await import('/modules/tabs/pdf-utils.js');
        const read = (input, pageCount = 5) => parsePdfPageRange(input, pageCount);
        return {
            all: read('all').indices,
            mixed: read('1-3,5,last').indices,
            spaced: read(' 2 , last ').indices,
            duplicates: read('1,1,2,2').indices,
            empty: read('').ok,
            zero: read('0').ok,
            outOfRange: read('6').ok,
            reversed: read('3-1').ok,
            emptySegment: read('1,,2').ok,
            invalidToken: read('foo').ok,
            allMixed: read('all,2').ok
        };
    });

    expect(result).toMatchObject({
        all: [0, 1, 2, 3, 4],
        mixed: [0, 1, 2, 4],
        spaced: [1, 4],
        duplicates: [0, 1],
        empty: false,
        zero: false,
        outOfRange: false,
        reversed: false,
        emptySegment: false,
        invalidToken: false,
        allMixed: false
    });
});

test('PDF tab is registered as fifth tab and hides image import sidebar', async ({ page }) => {
    await page.goto('/converter.html');

    await expect(page.locator('.segmented-control-tab .workspace-tab-title')).toHaveText([
        '3D OBJ',
        'Logo',
        'Raster',
        'Bulk',
        'PDF',
    ]);
    await page.locator('.segmented-control-tab[data-tab="pdf"]').click();

    await expect(page.locator('#tab-pdf')).toBeVisible();
    await expect(page.locator('#sidebar-import-section')).toBeHidden();
    await expect(page.locator('#sidebar-adjust-section')).toBeHidden();
    await expect(page.locator('#original-image-panel')).toBeHidden();
    await expect(page.locator('#pdf-merge-btn')).toBeDisabled();
});

test('PDF tab adds files, validates ranges, reorders, and downloads merged output', async ({ page }) => {
    const alphaPdf = await buildPdfBuffer('alpha', [[210, 211], [220, 221]]);
    const betaPdf = await buildPdfBuffer('beta', [[310, 311], [320, 321], [330, 331]]);

    await page.goto('/converter.html');
    await page.locator('.segmented-control-tab[data-tab="pdf"]').click();
    await addPdfFiles(page, [
        {
            name: 'alpha.pdf',
            mimeType: 'application/pdf',
            buffer: alphaPdf
        },
        {
            name: 'beta.pdf',
            mimeType: 'application/pdf',
            buffer: betaPdf
        }
    ]);

    await expect(page.locator('#pdf-file-count')).toHaveText('2');
    await expect(page.locator('#pdf-page-count')).toHaveText('5');
    await expect(page.locator('#pdf-merge-btn')).toBeEnabled();

    await rowFor(page, 'alpha.pdf').locator('.pdf-range-input').fill('9');
    await expect(rowFor(page, 'alpha.pdf').locator('.pdf-row-error')).toContainText('between 1 and 2');
    await expect(page.locator('#pdf-merge-btn')).toBeDisabled();

    await rowFor(page, 'alpha.pdf').locator('.pdf-range-input').fill('2,1');
    await expect(rowFor(page, 'alpha.pdf').locator('.pdf-row-error')).toBeHidden();
    await expect(page.locator('#pdf-merge-btn')).toBeEnabled();

    await rowFor(page, 'beta.pdf').locator('.pdf-range-input').fill('1,3');
    await expect(page.locator('#pdf-page-count')).toHaveText('4');

    await rowFor(page, 'beta.pdf').locator('[data-action="move-up"]').click();
    await page.locator('#pdf-output-name').fill('combined-check.pdf');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-merge-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('combined-check.pdf');

    const downloadPath = await download.path();
    const mergedDoc = await PDFDocument.load(fs.readFileSync(downloadPath));
    const pageSizes = mergedDoc.getPages().map((pdfPage) => [
        Math.round(pdfPage.getWidth()),
        Math.round(pdfPage.getHeight())
    ]);

    expect(mergedDoc.getPageCount()).toBe(4);
    expect(pageSizes).toEqual([
        [310, 311],
        [330, 331],
        [220, 221],
        [210, 211]
    ]);
});
