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
            <p id="c-loss"></p><label id="c-ack-row"><input id="c-ack" type="checkbox">Acknowledge</label>
            <button id="c-start">Start</button><button id="c-cancel">Cancel</button><button id="c-clear">Clear</button>
            <p id="c-status"></p><progress id="c-progress" max="100"></progress>
            <div id="c-result"><span id="c-size"></span><span id="c-reduction"></span><span id="c-pages"></span><p id="c-notice"></p><ul id="c-warnings"></ul></div>
            <button id="c-download">Copy</button><button id="c-original">Original</button>`;
        document.body.append(shell);
        const names = {
            compressPanel: shell, compressFileInput: '#c-file', compressDropzone: '#c-drop', compressFilename: '#c-name',
            compressSourceSize: '#c-source', compressMode: '#c-mode', compressPreset: '#c-preset', compressLossNotice: '#c-loss',
            compressAcknowledgeRow: '#c-ack-row', compressAcknowledge: '#c-ack', compressStartBtn: '#c-start',
            compressCancelBtn: '#c-cancel', compressClearBtn: '#c-clear', compressStatus: '#c-status', compressProgress: '#c-progress',
            compressResult: '#c-result', compressResultSize: '#c-size', compressReduction: '#c-reduction', compressPageCount: '#c-pages',
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

test('Reduce Size is the first public task, responsive, and requires loss acknowledgement only for destructive modes', async ({ page }) => {
    await page.goto('/pdf');
    await expect(page.locator('[data-pdf-task]').first()).toHaveAttribute('data-pdf-task', 'compress');
    await expect(page.locator('#pdf-task-compress-btn .pdf-task-copy strong')).toHaveText('Reduce Size');
    await expect(page.locator('#pdf-task-compress-btn .pdf-task-copy small')).toHaveText('Make your PDF smaller for sharing.');
    await expect(page.locator('#pdf-task-compress-btn')).toHaveAttribute('aria-label', 'Reduce Size. Make your PDF smaller for sharing.');
    await page.locator('#pdf-task-compress-btn').click();
    await expect(page.locator('#pdf-compress-panel')).toBeVisible();
    await expect(page.locator('#pdf-merge-footer')).toBeHidden();
    await expect(page.locator('#pdf-compress-mode option')).toHaveCount(3);
    await expect(page.locator('#pdf-compress-start-btn')).toBeDisabled();
    await page.locator('#pdf-compress-file-input').setInputFiles({ name: 'example.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-example') });
    await expect(page.locator('#pdf-compress-start-btn')).toBeEnabled();
    await expect(page.locator('#pdf-compress-acknowledge-row')).toBeHidden();
    await page.locator('#pdf-compress-options-summary').click();
    await page.locator('#pdf-compress-mode').selectOption('simplify');
    await expect(page.locator('#pdf-compress-loss-notice')).toContainText('flattened');
    await expect(page.locator('#pdf-compress-start-btn')).toBeDisabled();
    await page.locator('#pdf-compress-acknowledge').check();
    await expect(page.locator('#pdf-compress-start-btn')).toBeEnabled();
    await page.locator('#pdf-compress-mode').selectOption('rasterize');
    await expect(page.locator('#pdf-compress-acknowledge')).not.toBeChecked();
    await expect(page.locator('#pdf-compress-loss-notice')).toContainText('Text search, text selection, links');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#pdf-compress-panel')).toBeVisible();
    expect(await page.locator('#pdf-compress-panel').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('Measured larger results are honest, inert warnings and downloads retain original bytes', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page);
    await page.locator('#c-start').click();
    await expect(page.locator('#c-result')).toBeVisible();
    await expect(page.locator('#c-reduction')).toHaveText('100.0% larger — no size saving');
    await expect(page.locator('#c-notice')).toContainText('not smaller');
    await expect(page.locator('#c-warnings')).toContainText('<img src=x');
    await expect(page.locator('#c-warnings img')).toHaveCount(0);
    await page.locator('#c-download').click();
    await page.locator('#c-original').click();
    expect(await page.evaluate(async () => ({
        downloads: await Promise.all(window.__compression.downloads.map(async ({ blob, name }) => ({ name, size: blob.size, firstByte: new Uint8Array(await blob.arrayBuffer())[0] }))),
        mode: window.__compression.calls[0].mode, preset: window.__compression.calls[0].preset
    }))).toEqual({ downloads: [
        { name: '한글 newsletter-optimize-balanced.pdf', size: 200, firstByte: 0 },
        { name: '한글 newsletter.pdf', size: 100, firstByte: 0 }
    ], mode: 'optimize', preset: 'balanced' });
    await page.locator('#c-preset').selectOption('small');
    await expect(page.locator('#c-result')).toBeHidden();
    await expect(page.locator('#c-download')).toBeDisabled();
});

test('Replacement aborts old work, rejects stale results and never runs two PDF engines concurrently', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page, 'deferred');
    await page.locator('#c-start').click();
    await expect(page.locator('#c-status')).toHaveText('Halfway through PDF');
    await page.evaluate(() => {
        window.__compression.controller.setFiles([new File([new Uint8Array(300)], 'replacement.pdf', { type: 'application/pdf' })]);
        window.__compression.controller.start();
    });
    await expect(page.locator('#c-start')).toBeDisabled();
    expect(await page.evaluate(() => ({ count: window.__compression.calls.length, aborted: window.__compression.calls[0].signal.aborted }))).toEqual({ count: 1, aborted: true });
    await page.evaluate(() => window.__compression.calls[0].resolve({ bytes: new Uint8Array(5), pageCount: 1, warnings: [] }));
    await expect(page.locator('#c-result')).toBeHidden();
    await expect(page.locator('#c-start')).toBeEnabled();
    await expect(page.locator('#c-name')).toHaveText('replacement.pdf');
    await page.locator('#c-start').click();
    await page.locator('#c-cancel').click();
    expect(await page.evaluate(() => window.__compression.calls[1].signal.aborted)).toBe(true);
    await page.evaluate(() => window.__compression.calls[1].resolve({ bytes: new Uint8Array(5), pageCount: 1, warnings: [] }));
    await expect(page.locator('#c-result')).toBeHidden();
    await expect(page.locator('#c-start')).toBeEnabled();
});

test('Signed PDF errors leave the original downloadable and invalid replacements clear all output', async ({ page }) => {
    await page.goto('/pdf');
    await installHarness(page, 'signed');
    await page.locator('#c-start').click();
    await expect(page.locator('#c-status')).toContainText('Digitally signed PDFs cannot be compressed');
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
    await page.locator('#c-start').click();
    await expect(page.locator('#c-result')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.locator('#c-download').click();
    await download;
    await page.evaluate(() => window.__compression.controller.dispose());
    expect(await page.evaluate(() => ({ sameUrls: window.__urls.created.length === 1 && window.__urls.revoked.includes(window.__urls.created[0]), file: window.__compression.state.pdf.compression.file, result: window.__compression.state.pdf.compression.result }))).toEqual({ sameUrls: true, file: null, result: null });
    await installHarness(page, 'deferred');
    await page.evaluate(() => { window.__compression.controller.start(); });
    await expect.poll(() => page.evaluate(() => window.__compression.calls.length)).toBe(1);
    await page.evaluate(() => window.__compression.controller.dispose());
    expect(await page.evaluate(() => window.__compression.calls[0].signal.aborted)).toBe(true);
    await page.evaluate(() => window.__compression.calls[0].resolve({ bytes: new Uint8Array(3), pageCount: 1, warnings: [] }));
    expect(await page.evaluate(() => window.__compression.state.pdf.compression.result)).toBeNull();
});

test('Mobile resize leaves Create copy and result download clickable with one active task and decimal sizes', async ({ page }) => {
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
    await expect(page.locator('[data-pdf-task].active')).toHaveCount(1);
    await page.locator('#pdf-compress-start-btn').click();
    await expect(page.locator('#pdf-compress-result')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pdf-compress-download-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('mobile-optimize-balanced.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
