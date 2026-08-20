const { test, expect } = require('@playwright/test');

// Every tab shares one <img id="source-image">. These tests pin the boundary:
// an import made on one tab must never rewrite another tab's workspace, and a
// tab that already traced an older source must drop those results before it is
// shown again.

function twoColorSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
  <rect x="0" y="0" width="240" height="140" fill="#f2d500"/>
  <rect x="40" y="36" width="160" height="68" rx="10" fill="#111827"/>
</svg>`.trim();
}

function fourColorSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
  <rect x="0" y="0" width="60" height="140" fill="#111827"/>
  <rect x="60" y="0" width="60" height="140" fill="#2563eb"/>
  <rect x="120" y="0" width="60" height="140" fill="#16a34a"/>
  <rect x="180" y="0" width="60" height="140" fill="#dc2626"/>
</svg>`.trim();
}

function svgFile(name, markup) {
    return { name, mimeType: 'image/svg+xml', buffer: Buffer.from(markup) };
}

// Bambu launch is desktop-only, so pin the platform instead of letting the
// runner's OS decide whether the Open button can ever be enabled.
async function useDesktopBambu(page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            get: () => 'MacIntel'
        });
        window.__GENESIS_BAMBU_PROTOCOL_CALLS__ = [];
        window.__GENESIS_BAMBU_PROTOCOL_HOOK__ = (url) => {
            window.__GENESIS_BAMBU_PROTOCOL_CALLS__.push(url);
            return true;
        };
    });
}

function tab(page, name) {
    return page.locator(`.segmented-control-tab[data-tab="${name}"]`);
}

async function waitForAppReady(page) {
    await page.waitForFunction(() => window.__GENESIS_APP_READY__ === true, null, {
        timeout: 60_000
    });
}

async function importOnActiveTab(page, file) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#status-text')).toHaveText('Preview generated!', {
        timeout: 60_000
    });
}

// Opening the Logo tab only paints the default preset's preview. The trace and
// the 3D model wait for an explicit Update 3D press.
async function renderLogoHtmlPreset(page) {
    await expect(page.locator('#logo-html-status')).toHaveText(/Preview only/, { timeout: 60_000 });
    await page.locator('#logo-html-render-btn').click();
    await expect(page.locator('#logo-html-status')).toHaveText('Ready', { timeout: 60_000 });
    await expect(page.locator('#logo-bambu-open-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#logo-quality-indicator')).not.toHaveText('', { timeout: 60_000 });
}

test('importing on the 3D tab never feeds the Logo tab', async ({ page }) => {
    await useDesktopBambu(page);
    // Open the 3D tab directly so the Logo tab has never been activated and
    // therefore owns nothing of its own yet.
    await page.goto('/3d-obj');
    await waitForAppReady(page);

    const mirror = page.locator('#logo-svg-source-mirror');
    await expect(mirror).toHaveJSProperty('src', '');

    await importOnActiveTab(page, svgFile('two-color.svg', twoColorSvg()));

    const importedSrc = await page.locator('#source-image').getAttribute('src');
    expect(importedSrc).toBeTruthy();

    // The Logo tab is inactive: it must not have mirrored the import, traced it,
    // or enabled its exports off the back of another tab's source.
    await expect(mirror).toHaveJSProperty('src', '');
    await expect(page.locator('#logo-quality-indicator')).toHaveText('');
    await expect(page.locator('#logo-bambu-open-btn')).toBeDisabled();
    expect(await page.evaluate(() => ({
        htmlMode: document.getElementById('logo-html-editor-body')?.dataset.sourceMode,
        logoTraced: Boolean(document.getElementById('logo-svg-preview')?.getAttribute('src'))
    }))).toEqual({ htmlMode: 'html', logoTraced: false });

    // Opening the Logo tab now builds the Logo tab's own HTML source, never the
    // bitmap that was imported on the 3D tab.
    await tab(page, 'logo').click();
    await renderLogoHtmlPreset(page);
    expect(await mirror.getAttribute('src')).not.toBe(importedSrc);
    await expect(page.locator('#logo-html-editor-body')).toHaveAttribute('data-source-mode', 'html');
});

test('Logo HTML mode survives an import made on the 3D tab', async ({ page }) => {
    await useDesktopBambu(page);
    await page.goto('/logo');
    await waitForAppReady(page);
    await renderLogoHtmlPreset(page);

    const mirror = page.locator('#logo-svg-source-mirror');
    const renderedLogoSrc = await mirror.getAttribute('src');
    expect(renderedLogoSrc).toBeTruthy();
    await expect(page.locator('#logo-obj-preview-placeholder')).toBeHidden();

    await tab(page, 'svg').click();
    await importOnActiveTab(page, svgFile('two-color.svg', twoColorSvg()));
    const importedSrc = await page.locator('#source-image').getAttribute('src');

    await tab(page, 'logo').click();

    // HTML mode is still on, the mirror still shows the rendered mark, and the
    // 3D preview still has the logo model behind it.
    await expect(page.locator('#logo-html-editor-body')).toHaveAttribute('data-source-mode', 'html');
    expect(await mirror.getAttribute('src')).toBe(renderedLogoSrc);
    expect(await mirror.getAttribute('src')).not.toBe(importedSrc);
    await expect(page.locator('#logo-obj-preview-placeholder')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#logo-bambu-open-btn')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('#logo-quality-indicator')).not.toHaveText('');
});

test('Logo drops a stale trace when the shared source is replaced elsewhere', async ({ page }) => {
    await useDesktopBambu(page);
    await page.goto('/logo');
    await waitForAppReady(page);
    await renderLogoHtmlPreset(page);

    // Import image A on the Logo tab itself: that switches Logo to image mode
    // and traces A.
    await importOnActiveTab(page, svgFile('image-a.svg', twoColorSvg()));
    await expect(page.locator('#logo-html-editor-body')).toHaveAttribute('data-source-mode', 'image');
    await expect(page.locator('#logo-bambu-open-btn')).toBeEnabled({ timeout: 60_000 });
    const qualityForA = await page.locator('#logo-quality-indicator').textContent();
    expect(qualityForA?.trim()).toBeTruthy();

    // Replace the shared source with image B from the 3D tab.
    await tab(page, 'svg').click();
    await importOnActiveTab(page, svgFile('image-b.svg', fourColorSvg()));

    // Record what the Logo tab does from the moment it is shown. Retracing a
    // small source can finish faster than a round-trip, so sampling after the
    // fact cannot tell "cleared, then retraced" from "never cleared".
    await page.evaluate(() => {
        window.__LOGO_QUALITY_LOG__ = [];
        window.__LOGO_BAMBU_DISABLED_LOG__ = [];
        const quality = document.getElementById('logo-quality-indicator');
        const bambu = document.getElementById('logo-bambu-open-btn');
        new MutationObserver(() => {
            window.__LOGO_QUALITY_LOG__.push(quality.textContent);
        }).observe(quality, { childList: true, characterData: true, subtree: true });
        new MutationObserver(() => {
            window.__LOGO_BAMBU_DISABLED_LOG__.push(bambu.disabled);
        }).observe(bambu, { attributes: true, attributeFilter: ['disabled'] });
    });

    await tab(page, 'logo').click();

    // Activation drops image A's results without tracing anything, so the user
    // asks for image B's trace explicitly.
    await expect(page.locator('#logo-quality-indicator')).toHaveText('');
    await expect(page.locator('#logo-bambu-open-btn')).toBeDisabled();
    await page.locator('#logo-generate-preview-btn').click();

    // The tab then traces image B…
    await expect(page.locator('#logo-bambu-open-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#logo-quality-indicator')).not.toHaveText('', { timeout: 60_000 });
    const qualityForB = await page.locator('#logo-quality-indicator').textContent();
    expect(qualityForB).not.toBe(qualityForA);

    // …and image A's results were dropped on activation rather than lingering
    // until the new trace happened to overwrite them.
    const logs = await page.evaluate(() => ({
        quality: window.__LOGO_QUALITY_LOG__,
        bambuDisabled: window.__LOGO_BAMBU_DISABLED_LOG__
    }));
    expect(logs.quality).toContain('');
    expect(logs.quality.indexOf('')).toBeLessThan(logs.quality.lastIndexOf(qualityForB));
    expect(logs.bambuDisabled).toContain(true);
});

// Switching tabs is navigation, not work. Activation used to run the whole
// quantize/trace pipeline behind the blocking loader, which made the Logo tab
// take seconds to open on any non-trivial source.
test('opening Logo with an unanalyzed source never blocks on the pipeline', async ({ page }) => {
    await useDesktopBambu(page);
    await page.goto('/3d-obj');
    await waitForAppReady(page);

    // A source imported on the 3D tab, then handed to the Logo tab in image
    // mode without ever being analyzed there.
    await importOnActiveTab(page, svgFile('four-color.svg', fourColorSvg()));
    await tab(page, 'logo').click();
    await page.locator('#logo-html-mode-toggle').click();
    await expect(page.locator('#logo-html-editor-body')).toHaveAttribute('data-source-mode', 'image');
    await tab(page, 'svg').click();
    await expect(page.locator('#tab-svg')).toBeVisible();

    // Record every visibility change on the blocking loader from the moment the
    // Logo tab is shown — polling after the fact cannot tell "never shown" from
    // "shown and already dismissed".
    await page.evaluate(() => {
        window.__LOADER_DISPLAY_LOG__ = [];
        const overlay = document.getElementById('loader-overlay');
        new MutationObserver(() => {
            window.__LOADER_DISPLAY_LOG__.push(overlay.style.display);
        }).observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
    });

    const startedAt = Date.now();
    await tab(page, 'logo').click();
    await expect(page.locator('#tab-logo')).toBeVisible();
    await expect(page.locator('#logo-generate-preview-btn')).toBeEnabled();
    const activationMs = Date.now() - startedAt;

    expect(await page.evaluate(() => window.__LOADER_DISPLAY_LOG__)).not.toContain('flex');
    await expect(page.locator('#loader-overlay')).toBeHidden();
    expect(activationMs).toBeLessThan(1500);

    // Nothing was traced, and the source is on screen waiting for the click.
    expect(await page.evaluate(() => ({
        traced: Boolean(document.getElementById('logo-svg-preview')?.getAttribute('src')),
        mirrored: Boolean(document.getElementById('logo-svg-source-mirror')?.getAttribute('src'))
    }))).toEqual({ traced: false, mirrored: true });
    await expect(page.locator('#logo-quality-indicator')).toHaveText('');

    // The explicit control still runs the full pipeline.
    await page.locator('#logo-generate-preview-btn').click();
    await expect(page.locator('#logo-bambu-open-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#logo-quality-indicator')).not.toHaveText('', { timeout: 60_000 });
    expect(await page.evaluate(
        () => Boolean(document.getElementById('logo-svg-preview')?.getAttribute('src'))
    )).toBe(true);
});

test('a failed transfer probe falls back to the 3MF download', async ({ page }) => {
    await useDesktopBambu(page);
    await page.route('**/health', (route) => route.abort('failed'));
    let transferPostCount = 0;
    await page.route('**/api/bambu-transfer?**', (route) => {
        transferPostCount += 1;
        return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Transfer service unavailable.' })
        });
    });

    await page.goto('/3d-obj');
    await importOnActiveTab(page, svgFile('two-color.svg', twoColorSvg()));

    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await Promise.all([
        page.waitForEvent('download'),
        page.locator('#svg-bambu-open-btn').click()
    ]);

    const progress = page.locator('#svg-bambu-progress');
    await expect(progress).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('3MF downloaded');
    await expect(page.locator('#status-text')).toContainText('downloaded to Downloads');
    expect(transferPostCount).toBe(0);
    expect(downloads).toHaveLength(1);
});

test('an AbortError from the transfer probe falls back instead of failing the send', async ({ page }) => {
    await useDesktopBambu(page);
    // Extensions and network handoffs can reject an in-flight fetch with an
    // AbortError the app never asked for. The probe only decides which handoff
    // to use, so that must not abort the whole send.
    await page.addInitScript(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const url = String(input?.href || input?.url || input || '');
            if (url.includes('/health')) {
                const error = new Error('The user aborted a request.');
                error.name = 'AbortError';
                return Promise.reject(error);
            }
            return nativeFetch(input, init);
        };
    });

    await page.goto('/3d-obj');
    await importOnActiveTab(page, svgFile('two-color.svg', twoColorSvg()));

    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await Promise.all([
        page.waitForEvent('download'),
        page.locator('#svg-bambu-open-btn').click()
    ]);

    const progress = page.locator('#svg-bambu-progress');
    await expect(progress).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect(progress.locator('[data-bambu-progress-stage]')).toHaveText('3MF downloaded');
    expect(downloads).toHaveLength(1);
});
