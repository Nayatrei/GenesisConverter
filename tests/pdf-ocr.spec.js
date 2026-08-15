const { test, expect } = require('@playwright/test');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function installOcrHarness(page, language = 'eng') {
    await page.evaluate(async (selectedLanguage) => {
        const shell = document.createElement('section');
        shell.id = 'ocr-test-shell';
        shell.innerHTML = `
            <input id="ocr-test-input" type="file">
            <div id="ocr-test-dropzone" tabindex="0"></div>
            <select id="ocr-test-language">
                <option value="eng">English</option>
                <option value="eng+kor">English + Korean</option>
            </select>
            <button id="ocr-test-start" type="button">Start</button>
            <button id="ocr-test-cancel" type="button" hidden disabled>Cancel</button>
            <p id="ocr-test-status"></p>
            <textarea id="ocr-test-output"></textarea>
            <button id="ocr-test-copy" type="button">Copy</button>
            <button id="ocr-test-download" type="button">Download</button>
        `;
        document.body.appendChild(shell);

        const state = {
            pdf: {
                ocr: {
                    file: null,
                    fileName: '',
                    language: selectedLanguage,
                    text: '',
                    status: 'idle',
                    progress: 0
                }
            }
        };
        const calls = {
            factory: 0,
            recognize: 0,
            terminate: 0,
            language: '',
            workerOptions: null,
            loader: [],
            download: null
        };

        globalThis.__GENESIS_OCR_WORKER_FACTORY__ = async ({
            language,
            logger,
            workerOptions
        }) => {
            calls.factory += 1;
            calls.language = language;
            calls.workerOptions = {
                workerPath: workerOptions.workerPath,
                corePath: workerOptions.corePath,
                langPath: workerOptions.langPath
            };
            logger({ status: 'loading tesseract core', progress: 0.4 });
            return {
                async recognize(source) {
                    calls.recognize += 1;
                    calls.sourceName = source?.name || source?.constructor?.name || '';
                    logger({ status: 'recognizing text', progress: 0.72 });
                    return { data: { text: 'Hello from OCR\n안녕하세요' } };
                },
                async terminate() {
                    calls.terminate += 1;
                }
            };
        };

        const { createPdfOcrController } = await import('/modules/tabs/pdf-ocr.js');
        const controller = createPdfOcrController({
            state,
            elements: {
                pdf: {
                    ocrFileInput: shell.querySelector('#ocr-test-input'),
                    ocrDropzone: shell.querySelector('#ocr-test-dropzone'),
                    ocrLanguage: shell.querySelector('#ocr-test-language'),
                    ocrStartBtn: shell.querySelector('#ocr-test-start'),
                    ocrCancelBtn: shell.querySelector('#ocr-test-cancel'),
                    ocrStatus: shell.querySelector('#ocr-test-status'),
                    ocrOutput: shell.querySelector('#ocr-test-output'),
                    ocrCopyBtn: shell.querySelector('#ocr-test-copy'),
                    ocrDownloadBtn: shell.querySelector('#ocr-test-download')
                }
            },
            showLoader(show, options = {}) {
                calls.loader.push({ show, ...options });
            },
            downloadBlob(blob, filename) {
                calls.download = { blob, filename };
            }
        });
        controller.bindEvents();
        globalThis.__OCR_TEST_HARNESS__ = { state, calls, controller };
    }, language);
}

async function makeNativeTextPdf() {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const pdfPage = document.addPage([420, 300]);
    pdfPage.drawText('Native page text from the PDF', {
        x: 36,
        y: 230,
        size: 22,
        font,
        color: rgb(0.1, 0.12, 0.16)
    });
    return Buffer.from(await document.save());
}

async function makeNativeTextPdfWithTinyLogo() {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const logoPixel = await document.embedPng(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl8sAAAAASUVORK5CYII=',
        'base64'
    ));
    const pdfPage = document.addPage([420, 300]);
    pdfPage.drawImage(logoPixel, {
        x: 28,
        y: 246,
        width: 20,
        height: 20
    });
    pdfPage.drawText('This searchable PDF has native text and one tiny decorative logo.', {
        x: 60,
        y: 250,
        size: 12,
        font,
        color: rgb(0.1, 0.12, 0.16)
    });
    return Buffer.from(await document.save());
}

async function makeImageOnlyPdf() {
    const document = await PDFDocument.create();
    const scannedPixel = await document.embedPng(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl8sAAAAASUVORK5CYII=',
        'base64'
    ));
    const pdfPage = document.addPage([420, 300]);
    pdfPage.drawImage(scannedPixel, {
        x: 36,
        y: 36,
        width: 348,
        height: 228
    });
    return Buffer.from(await document.save());
}

async function makeMixedImageAndFooterPdf() {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const scannedPixel = await document.embedPng(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl8sAAAAASUVORK5CYII=',
        'base64'
    ));
    const pdfPage = document.addPage([420, 300]);
    pdfPage.drawImage(scannedPixel, {
        x: 20,
        y: 34,
        width: 380,
        height: 246
    });
    const longSelectableFooter = [
        'Scanned document footer 2026 contains searchable archive metadata and',
        'processing notes that must never hide the photographed page body from',
        'local optical character recognition during conversion'
    ];
    longSelectableFooter.forEach((line, index) => pdfPage.drawText(line, {
        x: 28,
        y: 20 - (index * 8),
        size: 8,
        font,
        color: rgb(0.2, 0.22, 0.24)
    }));
    return Buffer.from(await document.save());
}

async function makeSearchableScannedPdf() {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const scannedPixel = await document.embedPng(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl8sAAAAASUVORK5CYII=',
        'base64'
    ));
    const pdfPage = document.addPage([420, 300]);
    pdfPage.drawImage(scannedPixel, {
        x: 20,
        y: 10,
        width: 380,
        height: 280
    });
    const searchableTextLayer = [
        'Accurate searchable heading from the existing text layer',
        'First paragraph remains selectable without another OCR pass',
        'Second paragraph contains complete document information',
        'Third paragraph preserves names dates and reference numbers',
        'Fourth paragraph continues across the scanned page body',
        'Fifth paragraph is already readable by assistive technology',
        'Accurate searchable footer from the existing text layer'
    ];
    searchableTextLayer.forEach((line, index) => pdfPage.drawText(line, {
        x: 32,
        y: 264 - (index * 38),
        size: 9,
        font,
        color: rgb(0.1, 0.12, 0.16)
    }));
    return Buffer.from(await document.save());
}

async function makeHeaderFooterOnlyScannedPdf() {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const scannedPixel = await document.embedPng(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl8sAAAAASUVORK5CYII=',
        'base64'
    ));
    const pdfPage = document.addPage([420, 300]);
    pdfPage.drawImage(scannedPixel, {
        x: 20,
        y: 10,
        width: 380,
        height: 280
    });
    const letterheadText = [
        { text: 'Searchable company letterhead and document reference', y: 272 },
        { text: 'Searchable date and recipient metadata in the header', y: 252 },
        { text: 'Searchable confidentiality notice in the page footer', y: 48 },
        { text: 'Searchable archive identifier and footer page number', y: 28 }
    ];
    letterheadText.forEach(({ text, y }) => pdfPage.drawText(text, {
        x: 32,
        y,
        size: 9,
        font,
        color: rgb(0.1, 0.12, 0.16)
    }));
    return Buffer.from(await document.save());
}

test('image OCR uses one injected worker, terminates it, and downloads UTF-8 TXT', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page, 'eng+kor');

    await page.locator('#ocr-test-input').setInputFiles({
        name: 'receipt.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl8sAAAAASUVORK5CYII=',
            'base64'
        )
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => ({
        status: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status,
        terminate: globalThis.__OCR_TEST_HARNESS__.calls.terminate
    }))).toEqual({ status: 'done', terminate: 1 });

    const result = await page.evaluate(() => {
        const { state, calls } = globalThis.__OCR_TEST_HARNESS__;
        return {
            language: calls.language,
            factory: calls.factory,
            recognize: calls.recognize,
            terminate: calls.terminate,
            output: state.pdf.ocr.text,
            progress: state.pdf.ocr.progress,
            workerOptions: calls.workerOptions
        };
    });

    expect(result).toMatchObject({
        language: 'eng+kor',
        factory: 1,
        recognize: 1,
        terminate: 1,
        progress: 100
    });
    expect(result.output).toContain('--- Page 1 ---');
    expect(result.output).toContain('Hello from OCR');
    expect(result.output).toContain('안녕하세요');
    expect(result.workerOptions.workerPath).toMatch(/\/vendor\/tesseract\/worker\.min\.js\?v=r-[a-f0-9]{16}$/);
    expect(result.workerOptions.corePath).toBe(`${new URL(page.url()).origin}/vendor/tesseract/core/`);
    expect(result.workerOptions.langPath).toBe(`${new URL(page.url()).origin}/vendor/tesseract/lang/`);

    await page.locator('#ocr-test-output').fill('Corrected receipt text\n수정된 내용');
    await page.locator('#ocr-test-download').click();
    const download = await page.evaluate(async () => {
        const value = globalThis.__OCR_TEST_HARNESS__.calls.download;
        return {
            filename: value.filename,
            type: value.blob.type,
            text: await value.blob.text()
        };
    });
    expect(download.filename).toBe('receipt.txt');
    expect(download.type).toBe('text/plain;charset=utf-8');
    expect(download.text).toContain('Corrected receipt text');
    expect(download.text).toContain('수정된 내용');
    expect(download.text).not.toContain('Hello from OCR');
});

test('PDF pages with meaningful native text do not start the OCR worker', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page);
    await page.locator('#ocr-test-input').setInputFiles({
        name: 'searchable.pdf',
        mimeType: 'application/pdf',
        buffer: await makeNativeTextPdf()
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => (
        globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status
    ))).toBe('done');

    const result = await page.evaluate(() => {
        const { state, calls } = globalThis.__OCR_TEST_HARNESS__;
        return {
            output: state.pdf.ocr.text,
            factory: calls.factory,
            recognize: calls.recognize,
            terminate: calls.terminate
        };
    });
    expect(result.output).toContain('--- Page 1 ---');
    expect(result.output).toContain('Native page text from the PDF');
    expect(result).toMatchObject({ factory: 0, recognize: 0, terminate: 0 });
});

test('searchable PDF with a tiny decorative raster logo bypasses OCR', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page);
    await page.locator('#ocr-test-input').setInputFiles({
        name: 'searchable-with-logo.pdf',
        mimeType: 'application/pdf',
        buffer: await makeNativeTextPdfWithTinyLogo()
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => (
        globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status
    ))).toBe('done');

    const result = await page.evaluate(() => {
        const { state, calls } = globalThis.__OCR_TEST_HARNESS__;
        return {
            output: state.pdf.ocr.text,
            factory: calls.factory,
            recognize: calls.recognize,
            terminate: calls.terminate
        };
    });
    expect(result.output).toContain('tiny decorative logo');
    expect(result.output).not.toContain('Hello from OCR');
    expect(result).toMatchObject({ factory: 0, recognize: 0, terminate: 0 });
});

test('image-only PDF pages render for OCR and reuse one worker', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page);
    await page.locator('#ocr-test-input').setInputFiles({
        name: 'scanned-pages.pdf',
        mimeType: 'application/pdf',
        buffer: await makeImageOnlyPdf()
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => ({
        status: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status,
        factory: globalThis.__OCR_TEST_HARNESS__.calls.factory,
        recognize: globalThis.__OCR_TEST_HARNESS__.calls.recognize,
        terminate: globalThis.__OCR_TEST_HARNESS__.calls.terminate
    }))).toEqual({ status: 'done', factory: 1, recognize: 1, terminate: 1 });

    await expect(page.locator('#ocr-test-output')).toHaveValue(/Hello from OCR/);
});

test('mixed PDF page OCRs the scanned body and keeps a long native footer', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page);
    await page.locator('#ocr-test-input').setInputFiles({
        name: 'mixed-page.pdf',
        mimeType: 'application/pdf',
        buffer: await makeMixedImageAndFooterPdf()
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => ({
        status: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status,
        factory: globalThis.__OCR_TEST_HARNESS__.calls.factory,
        recognize: globalThis.__OCR_TEST_HARNESS__.calls.recognize,
        terminate: globalThis.__OCR_TEST_HARNESS__.calls.terminate
    }))).toEqual({ status: 'done', factory: 1, recognize: 1, terminate: 1 });

    await expect(page.locator('#ocr-test-output')).toHaveValue(/Hello from OCR/);
    await expect(page.locator('#ocr-test-output')).toHaveValue(/searchable archive metadata/);
    await expect(page.locator('#ocr-test-output')).toHaveValue(/local optical character recognition/);
});

test('full-page scan with a broad existing text layer bypasses duplicate OCR', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page);
    await page.locator('#ocr-test-input').setInputFiles({
        name: 'already-searchable-scan.pdf',
        mimeType: 'application/pdf',
        buffer: await makeSearchableScannedPdf()
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => (
        globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status
    ))).toBe('done');

    const result = await page.evaluate(() => {
        const { state, calls } = globalThis.__OCR_TEST_HARNESS__;
        return {
            output: state.pdf.ocr.text,
            factory: calls.factory,
            recognize: calls.recognize,
            terminate: calls.terminate
        };
    });
    expect(result.output).toContain('Accurate searchable heading');
    expect(result.output).toContain('Accurate searchable footer');
    expect(result.output).not.toContain('Hello from OCR');
    expect(result).toMatchObject({ factory: 0, recognize: 0, terminate: 0 });
});

test('full-page scan with searchable header and footer still OCRs its body', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page);
    await page.locator('#ocr-test-input').setInputFiles({
        name: 'letterheaded-scan.pdf',
        mimeType: 'application/pdf',
        buffer: await makeHeaderFooterOnlyScannedPdf()
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => ({
        status: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status,
        factory: globalThis.__OCR_TEST_HARNESS__.calls.factory,
        recognize: globalThis.__OCR_TEST_HARNESS__.calls.recognize,
        terminate: globalThis.__OCR_TEST_HARNESS__.calls.terminate
    }))).toEqual({ status: 'done', factory: 1, recognize: 1, terminate: 1 });

    await expect(page.locator('#ocr-test-output')).toHaveValue(/Hello from OCR/);
    await expect(page.locator('#ocr-test-output')).toHaveValue(/Searchable company letterhead/);
    await expect(page.locator('#ocr-test-output')).toHaveValue(/Searchable archive identifier/);
});

test('Cancel stops an active OCR job and immediately restores its controls', async ({ page }) => {
    await page.goto('/3d-obj');
    await installOcrHarness(page);
    await page.evaluate(() => {
        const harness = globalThis.__OCR_TEST_HARNESS__;
        globalThis.__GENESIS_OCR_WORKER_FACTORY__ = async ({ logger }) => {
            harness.calls.factory += 1;
            let rejectRecognition;
            return {
                recognize() {
                    harness.calls.recognize += 1;
                    logger({ status: 'recognizing text', progress: 0.25 });
                    return new Promise((resolve, reject) => {
                        harness.pendingRecognition = { resolve, reject };
                        rejectRecognition = reject;
                    });
                },
                async terminate() {
                    harness.calls.terminate += 1;
                    rejectRecognition?.(new Error('Worker terminated by user'));
                }
            };
        };
    });

    await page.locator('#ocr-test-input').setInputFiles({
        name: 'long-scan.pdf',
        mimeType: 'application/pdf',
        buffer: await makeImageOnlyPdf()
    });
    await page.locator('#ocr-test-start').click();

    await expect.poll(() => page.evaluate(() => ({
        status: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status,
        recognize: globalThis.__OCR_TEST_HARNESS__.calls.recognize
    }))).toEqual({ status: 'working', recognize: 1 });
    await expect(page.locator('#ocr-test-start')).toBeHidden();
    await expect(page.locator('#ocr-test-cancel')).toBeVisible();

    await page.locator('#ocr-test-cancel').click();
    await expect.poll(() => page.evaluate(() => ({
        status: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.status,
        isRunning: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.isRunning,
        fileName: globalThis.__OCR_TEST_HARNESS__.state.pdf.ocr.fileName,
        terminate: globalThis.__OCR_TEST_HARNESS__.calls.terminate,
        loaderCalls: globalThis.__OCR_TEST_HARNESS__.calls.loader.length
    }))).toEqual({
        status: 'cancelled',
        isRunning: false,
        fileName: 'long-scan.pdf',
        terminate: 1,
        loaderCalls: 0
    });

    await expect(page.locator('#ocr-test-start')).toBeVisible();
    await expect(page.locator('#ocr-test-start')).toBeEnabled();
    await expect(page.locator('#ocr-test-cancel')).toBeHidden();
    await expect(page.locator('#ocr-test-input')).toBeEnabled();
    await expect(page.locator('#ocr-test-status')).toContainText('Reading stopped');
});
