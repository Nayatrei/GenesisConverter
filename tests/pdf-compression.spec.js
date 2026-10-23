const { test, expect } = require('@playwright/test');
const { PDFDocument, StandardFonts } = require('pdf-lib');

async function installHarness(page, behavior = 'larger', fallbackDownload = false) {
    await page.evaluate(async ({ behavior, fallbackDownload }) => {
        document.getElementById('compression-test-shell')?.remove();
        const shell = document.createElement('section');
        shell.id = 'compression-test-shell';
        shell.innerHTML = `
            <input id="c-file" type="file"><button id="c-drop">Choose PDF</button>
            <span id="c-name"></span><span id="c-source"></span>
            <select id="c-mode"><option value="optimize">Standard</option><option value="simplify">View-only</option><option value="rasterize">Image-only</option></select>
            <select id="c-preset"><option value="high">High</option><option value="balanced">Balanced</option><option value="small">Small</option></select>
            <p id="c-loss"></p>
            <button id="c-start">Start</button><button id="c-cancel">Cancel</button><button id="c-clear">Clear</button>
            <p id="c-status"></p><progress id="c-progress" max="100"></progress>
            <div id="c-result"><span id="c-before"></span><span id="c-size"></span><span id="c-reduction"></span><span id="c-pages"></span><p id="c-notice"></p><ul id="c-warnings"></ul></div>
            <button id="c-download">Copy</button><button id="c-original">Original</button>`;
        document.body.append(shell);
        const names = {
            compressPanel: shell, compressFileInput: '#c-file', compressDropzone: '#c-drop', compressFilename: '#c-name',
            compressSourceSize: '#c-source', compressMode: '#c-mode', compressPreset: '#c-preset', compressLossNotice: '#c-loss',
            compressStartBtn: '#c-start',
            compressCancelBtn: '#c-cancel', compressClearBtn: '#c-clear', compressStatus: '#c-status', compressProgress: '#c-progress',
            compressResult: '#c-result', compressBeforeSize: '#c-before', compressResultSize: '#c-size', compressReduction: '#c-reduction', compressPageCount: '#c-pages',
            compressResultNotice: '#c-notice', compressWarnings: '#c-warnings', compressDownloadBtn: '#c-download', compressOriginalBtn: '#c-original'
        };
        const pdf = Object.fromEntries(Object.entries(names).map(([key, value]) => [key, typeof value === 'string' ? shell.querySelector(value) : value]));
        const calls = [];
        const downloads = [];
        const state = { pdf: {} };
        const { createPdfCompressionController } = await import('/modules/tabs/pdf-compress-ui.js');
        const controller = createPdfCompressionController({ state, elements: { pdf },
            ...(fallbackDownload ? {} : { downloadBlob: (blob, name) => downloads.push({ blob, name }) }),
            compress: async (options) => {
                calls.push(options);
                options.onProgress({ progress: 0.5, message: 'Halfway through PDF' });
                if (behavior === 'deferred') return new Promise((resolve, reject) => { options.resolve = resolve; options.reject = reject; });
                if (behavior === 'signed') throw new Error('Digitally signed PDFs cannot be compressed. Your original is unchanged.');
                return { bytes: new Uint8Array(200), pageCount: 2, warnings: ['<img src=x onerror="window.__bad=true">'] };
            }
        });
        controller.bindEvents();
        window.__compression = { controller, state, calls, downloads };
        controller.setFiles([new File([new Uint8Array(100)], '한글 newsletter.pdf', { type: 'application/pdf' })]);
    }, { behavior, fallbackDownload });
}

test('Reduce Size balances upload/download cards and enables direct download after automatic flattened measurement', async ({ page }) => {
    const source = await PDFDocument.create();
    source.addPage([240, 180]).drawText('Automatic flattened measurement', { x: 10, y: 100, size: 12 });
    const bytes = Buffer.from(await source.save());
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/pdf');
    await expect(page.locator('[data-pdf-task]').first()).toHaveAttribute('data-pdf-task', 'compress');
    await expect(page.locator('#pdf-task-compress-btn .pdf-task-copy strong')).toHaveText('Reduce Size');
    await expect(page.locator('#pdf-task-compress-btn .pdf-task-copy small')).toHaveText('Make your PDF smaller for sharing.');
    await expect(page.locator('#pdf-task-compress-btn')).toHaveAttribute('aria-label', 'Reduce Size. Make your PDF smaller for sharing.');
    await page.locator('#pdf-task-compress-btn').click();
    await expect(page.locator('#pdf-compress-panel')).toBeVisible();
    await expect(page.locator('#pdf-merge-footer')).toBeHidden();
    await expect(page.locator('#pdf-compress-mode option')).toHaveCount(3);
    await expect(page.locator('#pdf-compress-mode')).toHaveValue('simplify');
    await expect(page.locator('#pdf-compress-panel input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('.pdf-compress-download-card > svg')).toHaveCount(0);
    await expect(page.locator('#pdf-compress-download-btn > svg')).toHaveAttribute('width', '22');
    await expect(page.locator('#pdf-compress-download-btn > svg')).toHaveAttribute('height', '22');
    await expect(page.locator('#pdf-compress-download-btn')).toBeVisible();
    await expect(page.locator('#pdf-compress-download-btn')).toBeDisabled();
    await expect(page.locator('#pdf-compress-loss-notice')).toBeVisible();
    await expect(page.locator('#pdf-compress-loss-notice')).toContainText('flattened');
    expect(await page.locator('#pdf-compress-loss-notice').evaluate((element) => element.closest('details') === null)).toBe(true);
    expect(await page.locator('.pdf-compress-size-comparison').evaluate((element) => Boolean(
        element.compareDocumentPosition(document.querySelector('.pdf-compress-options')) & Node.DOCUMENT_POSITION_FOLLOWING
    ))).toBe(true);
    await expect(page.locator('#pdf-compress-start-btn')).toBeDisabled();
    await page.locator('#pdf-compress-file-input').setInputFiles({ name: 'example.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(page.locator('#pdf-compress-before-size')).toHaveText(bytes.length < 1000 ? `${bytes.length} B` : `${(bytes.length / 1000).toFixed(2)} KB`);
    await expect(page.locator('#pdf-compress-result')).toBeVisible();
    await expect(page.locator('#pdf-compress-result-size')).toHaveAttribute('title', /bytes \(decimal units\)/);
    expect(await page.locator('.pdf-compress-size-comparison').evaluate((element) => {
        const comparison = element.getBoundingClientRect();
        const panel = element.closest('#pdf-compress-panel').getBoundingClientRect();
        return comparison.top >= panel.top && comparison.bottom <= Math.min(panel.bottom, innerHeight);
    })).toBe(true);
    await expect(page.locator('#pdf-compress-start-btn')).toBeEnabled();
    await expect(page.locator('#pdf-compress-download-btn')).toBeEnabled();
    const layout = await page.evaluate(() => {
        const source = document.querySelector('.pdf-compress-source').getBoundingClientRect();
        const output = document.querySelector('.pdf-compress-output').getBoundingClientRect();
        const button = document.querySelector('#pdf-compress-download-btn').getBoundingClientRect();
        const notice = document.querySelector('#pdf-compress-result-notice').getBoundingClientRect();
        return { sourceWidth: source.width, outputWidth: output.width, sourceTop: source.top, outputTop: output.top,
            sourceHeight: source.height, outputHeight: output.height, buttonWidth: button.width, buttonHeight: button.height,
            buttonBottom: button.bottom, noticeTop: notice.top };
    });
    expect(Math.abs(layout.sourceWidth - layout.outputWidth)).toBeLessThan(2);
    expect(Math.abs(layout.sourceTop - layout.outputTop)).toBeLessThan(2);
    expect(Math.abs(layout.sourceHeight - layout.outputHeight)).toBeLessThan(2);
    expect(layout.buttonWidth).toBeGreaterThan(layout.outputWidth * 0.7);
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(64);
    expect(layout.buttonBottom).toBeLessThanOrEqual(layout.noticeTop);
    await page.locator('#pdf-compress-options-summary').click();
    await page.locator('#pdf-compress-mode').selectOption('optimize');
    await expect(page.locator('#pdf-compress-result-size')).toHaveAttribute('title', /bytes \(decimal units\)/);
    await page.locator('#pdf-compress-mode').selectOption('rasterize');
    await expect(page.locator('#pdf-compress-loss-notice')).toContainText('Text search, text selection, links');
    await expect(page.locator('#pdf-compress-download-btn')).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#pdf-compress-panel')).toBeVisible();
    expect(await page.locator('#pdf-compress-panel').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('Measured larger results are honest, inert warnings and downloads retain original bytes', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page);
    await expect(page.locator('#c-result')).toBeVisible();
    await expect(page.locator('#c-reduction')).toHaveText('100.0% larger — no size saving');
    await expect(page.locator('#c-notice')).toContainText('not smaller');
    await expect(page.locator('#c-warnings')).toContainText('<img src=x');
    await expect(page.locator('#c-warnings img')).toHaveCount(0);
    await expect(page.locator('#c-download')).toBeEnabled();
    await page.locator('#c-download').click();
    await page.locator('#c-original').click();
    expect(await page.evaluate(async () => ({
        downloads: await Promise.all(window.__compression.downloads.map(async ({ blob, name }) => ({ name, size: blob.size, firstByte: new Uint8Array(await blob.arrayBuffer())[0] }))),
        mode: window.__compression.calls[0].mode, preset: window.__compression.calls[0].preset
    }))).toEqual({ downloads: [
        { name: '한글 newsletter-simplify-balanced.pdf', size: 200, firstByte: 0 },
        { name: '한글 newsletter.pdf', size: 100, firstByte: 0 }
    ], mode: 'simplify', preset: 'balanced' });
    await page.locator('#c-preset').selectOption('small');
    await expect.poll(() => page.evaluate(() => window.__compression.calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__compression.calls[1].preset)).toBe('small');
    await expect(page.locator('#c-size')).toHaveText('200 B');
});

test('Replacement aborts old work, rejects stale results and never runs two PDF engines concurrently', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page, 'deferred');
    await expect(page.locator('#c-status')).toHaveText('Halfway through PDF');
    await expect(page.locator('#c-before')).toHaveText('100 B');
    await expect(page.locator('#c-size')).toHaveText('Calculating…');
    await expect(page.locator('#c-download')).toBeDisabled();
    await page.locator('#c-download').dispatchEvent('click');
    expect(await page.evaluate(() => window.__compression.downloads.length)).toBe(0);
    await page.evaluate(() => {
        window.__compression.controller.setFiles([new File([new Uint8Array(300)], 'replacement.pdf', { type: 'application/pdf' })]);
        window.__compression.controller.start();
    });
    await expect(page.locator('#c-start')).toBeDisabled();
    expect(await page.evaluate(() => ({ count: window.__compression.calls.length, aborted: window.__compression.calls[0].signal.aborted }))).toEqual({ count: 1, aborted: true });
    await page.locator('#c-preset').selectOption('small');
    await page.locator('#c-preset').selectOption('high');
    await page.evaluate(() => window.__compression.calls[0].resolve({ bytes: new Uint8Array(5), pageCount: 1, warnings: [] }));
    await expect.poll(() => page.evaluate(() => window.__compression.calls.length)).toBe(2);
    await expect(page.locator('#c-size')).toHaveText('Calculating…');
    await expect(page.locator('#c-before')).toHaveText('300 B');
    expect(await page.evaluate(() => window.__compression.calls[1].preset)).toBe('high');
    await expect(page.locator('#c-name')).toHaveText('replacement.pdf');
    await page.locator('#c-cancel').click();
    expect(await page.evaluate(() => window.__compression.calls[1].signal.aborted)).toBe(true);
    await page.evaluate(() => window.__compression.calls[1].resolve({ bytes: new Uint8Array(5), pageCount: 1, warnings: [] }));
    await expect(page.locator('#c-size')).toHaveText('Not calculated');
    await expect(page.locator('#c-start')).toBeEnabled();
    expect(await page.evaluate(() => window.__compression.calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__compression.state.pdf.compression.result)).toBeNull();
});

test('Explicit image-only selection auto-calculates without a checkbox and Cancel still stops processing', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page, 'deferred');
    await expect.poll(() => page.evaluate(() => window.__compression.calls.length)).toBe(1);
    await page.locator('#c-mode').selectOption('rasterize');
    expect(await page.evaluate(() => window.__compression.calls[0].signal.aborted)).toBe(true);
    await page.evaluate(() => window.__compression.calls[0].resolve({ bytes: new Uint8Array(5), pageCount: 1, warnings: [] }));
    await expect.poll(() => page.evaluate(() => window.__compression.calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__compression.calls[1].mode)).toBe('rasterize');
    await expect(page.locator('#c-loss')).toContainText('Every page becomes a JPEG image');
    await expect(page.locator('#c-size')).toHaveText('Calculating…');
    await expect(page.locator('#c-download')).toBeDisabled();
    await page.locator('#c-cancel').click();
    expect(await page.evaluate(() => window.__compression.calls[1].signal.aborted)).toBe(true);
    await page.evaluate(() => window.__compression.calls[1].resolve({ bytes: new Uint8Array(5), pageCount: 1, warnings: [] }));
    await expect(page.locator('#c-size')).toHaveText('Not calculated');
    await expect(page.locator('#c-download')).toBeDisabled();
    await expect(page.locator('#c-original')).toBeEnabled();
    expect(await page.evaluate(() => window.__compression.calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__compression.state.pdf.compression.result)).toBeNull();
});

test('Cancel stops the queued replacement while an aborted predecessor is still settling', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page, 'deferred');
    await expect.poll(() => page.evaluate(() => window.__compression.calls.length)).toBe(1);
    await page.evaluate(() => window.__compression.controller.setFiles([
        new File([new Uint8Array(300)], 'queued-replacement.pdf', { type: 'application/pdf' })
    ]));
    expect(await page.evaluate(() => window.__compression.calls[0].signal.aborted)).toBe(true);
    await expect(page.locator('#c-size')).toHaveText('Calculating…');
    await expect(page.locator('#c-cancel')).toBeEnabled();
    await page.locator('#c-cancel').click();
    await page.evaluate(() => window.__compression.calls[0].resolve({ bytes: new Uint8Array(5), pageCount: 1, warnings: [] }));
    await expect(page.locator('#c-start')).toBeEnabled();
    await expect(page.locator('#c-size')).toHaveText('Not calculated');
    await expect(page.locator('#c-before')).toHaveText('300 B');
    await expect(page.locator('#c-download')).toBeDisabled();
    expect(await page.evaluate(() => window.__compression.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__compression.state.pdf.compression.result)).toBeNull();
});

test('Signed PDF errors leave the original downloadable and invalid replacements clear all output', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page, 'signed');
    await expect(page.locator('#c-status')).toContainText('Digitally signed PDFs cannot be compressed');
    await expect(page.locator('#c-size')).toHaveText('Unavailable');
    expect(await page.evaluate(() => window.__compression.calls.length)).toBe(1);
    await expect(page.locator('#c-original')).toBeEnabled();
    await expect(page.locator('#c-download')).toBeDisabled();
    await page.evaluate(() => window.__compression.controller.setFiles([new File(['bad'], 'not-a-pdf.txt', { type: 'text/plain' })]));
    await expect(page.locator('#c-status')).toHaveText('Choose one PDF file at a time.');
    await expect(page.locator('#c-start')).toBeDisabled();
    await expect(page.locator('#c-original')).toBeDisabled();
});

test('Disposal aborts pending work, releases files and revokes owned download URLs', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page, 'larger', true);
    await page.evaluate(() => {
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        window.__urls = { created: [], revoked: [] };
        URL.createObjectURL = (blob) => { const url = create(blob); window.__urls.created.push(url); return url; };
        URL.revokeObjectURL = (url) => { window.__urls.revoked.push(url); revoke(url); };
    });
    await expect(page.locator('#c-size')).toHaveText('200 B');
    const download = page.waitForEvent('download');
    await page.locator('#c-download').click();
    await download;
    await page.evaluate(() => window.__compression.controller.dispose());
    expect(await page.evaluate(() => ({ sameUrls: window.__urls.created.length === 1 && window.__urls.revoked.includes(window.__urls.created[0]), file: window.__compression.state.pdf.compression.file, result: window.__compression.state.pdf.compression.result }))).toEqual({ sameUrls: true, file: null, result: null });
    await installHarness(page, 'deferred');
    await expect.poll(() => page.evaluate(() => window.__compression.calls.length)).toBe(1);
    await page.evaluate(() => window.__compression.controller.dispose());
    expect(await page.evaluate(() => window.__compression.calls[0].signal.aborted)).toBe(true);
    await page.evaluate(() => window.__compression.calls[0].resolve({ bytes: new Uint8Array(3), pageCount: 1, warnings: [] }));
    expect(await page.evaluate(() => window.__compression.state.pdf.compression.result)).toBeNull();
});

test('Mobile Reduce Size click reveals the chooser below the sticky header and keeps copy/download clickable', async ({ page }) => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    source.addPage([420, 300]).drawText('A smaller copy keeps this page.', { x: 30, y: 230, size: 18, font });
    const pdfBytes = Buffer.from(await source.save());
    await page.goto('/pdf');
    await page.locator('#pdf-task-compress-btn').click();
    await expect(page.locator('[data-pdf-task].active')).toHaveCount(1);
    await expect(page.locator('[data-pdf-task][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#pdf-task-compress-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#pdf-task-combine-btn')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#pdf-compress-file-input').setInputFiles({ name: 'mobile.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
    const expectedSize = pdfBytes.length < 1000 ? `${pdfBytes.length} B` : `${(pdfBytes.length / 1000).toFixed(2)} KB`;
    await expect(page.locator('#pdf-compress-source-size')).toHaveText(expectedSize);
    await expect(page.locator('#pdf-compress-source-size')).toHaveAttribute('title', `${pdfBytes.length.toLocaleString('en-US')} bytes (decimal units)`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.app-sidebar')).toBeHidden();
    await page.locator('#pdf-task-combine-btn').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#pdf-task-compress-btn').click();
    await expect(page.locator('#pdf-compress-dropzone')).toBeFocused();
    const position = await page.evaluate(() => {
        const header = document.querySelector('.workspace-topbar').getBoundingClientRect();
        const panel = document.querySelector('#pdf-compress-panel').getBoundingClientRect();
        const chooser = document.querySelector('#pdf-compress-dropzone').getBoundingClientRect();
        return { headerBottom: header.bottom, panelTop: panel.top, chooserTop: chooser.top, chooserBottom: chooser.bottom, viewportHeight: window.innerHeight };
    });
    expect(position.panelTop).toBeGreaterThanOrEqual(position.headerBottom + 8);
    expect(position.panelTop).toBeLessThan(position.headerBottom + 32);
    expect(position.chooserTop).toBeGreaterThan(position.headerBottom);
    expect(position.chooserBottom).toBeLessThanOrEqual(position.viewportHeight);
    await expect(page.locator('[data-pdf-task].active')).toHaveCount(1);
    await expect(page.locator('#pdf-compress-result')).toBeVisible();
    await expect(page.locator('#pdf-compress-result-size')).toHaveAttribute('title', /bytes \(decimal units\)/);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-compress-download-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('mobile-simplify-balanced.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
