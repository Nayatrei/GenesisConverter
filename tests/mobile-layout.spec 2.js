const { test, expect } = require('@playwright/test');

const MOBILE_SIZES = [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 900 }
];

async function readLayout(page, footerSelector) {
    return page.evaluate((selector) => {
        const rect = (target) => {
            const element = document.querySelector(target);
            if (!element) return null;
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                bottom: bounds.bottom,
                height: bounds.height,
                left: bounds.left,
                position: style.position,
                right: bounds.right,
                top: bounds.top,
                width: bounds.width
            };
        };

        const toggle = document.querySelector('#mobile-controls-toggle');
        const toggleBounds = toggle?.getBoundingClientRect();
        const toggleHit = toggleBounds
            ? document.elementFromPoint(
                toggleBounds.left + toggleBounds.width / 2,
                toggleBounds.top + toggleBounds.height / 2
            )?.closest('button')?.id
            : null;

        return {
            brand: rect('.brand-footer'),
            clientWidth: document.documentElement.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
            footer: rect(selector),
            main: rect('#main-content'),
            output: rect('#output-section'),
            shell: rect('.app-shell'),
            tabs: rect('.segmented-control'),
            toggle: rect('#mobile-controls-toggle'),
            toggleHit,
            topbar: rect('.workspace-topbar')
        };
    }, footerSelector);
}

async function waitForShell(page) {
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('#output-section')).toBeVisible();
    await expect(page.locator('.brand-footer')).toBeVisible();
}

for (const viewport of MOBILE_SIZES) {
    test(`mobile shell stays in flow at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/3d-obj');
        await waitForShell(page);

        const layout = await readLayout(page, '#svg-export-footer');
        expect(layout.documentWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
        expect(layout.toggleHit).toBe('mobile-controls-toggle');
        expect(layout.tabs.right).toBeLessThanOrEqual(layout.toggle.left - 6);
        expect(layout.topbar.bottom).toBeLessThanOrEqual(layout.main.top + 1);
        expect(layout.output.bottom).toBeLessThanOrEqual(layout.footer.top + 1);
        expect(layout.footer.position).not.toBe('fixed');
        expect(layout.footer.bottom).toBeLessThanOrEqual(layout.brand.top + 1);
        expect(layout.shell.bottom).toBeLessThanOrEqual(layout.brand.top + 1);
    });
}

test('every workflow finishes before the brand footer on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 330, height: 720 });
    await page.goto('/3d-obj');
    await waitForShell(page);

    const workflows = [
        { tab: 'svg', footer: '#svg-export-footer' },
        { tab: 'logo', footer: '#logo-export-footer' },
        { tab: 'raster', footer: '#download-footer' },
        { tab: 'bulk', footer: '#bulk-download-footer' },
        { tab: 'pdf', footer: '#pdf-merge-footer' }
    ];

    for (const workflow of workflows) {
        await page.locator(`.segmented-control-tab[data-tab="${workflow.tab}"]`).click();
        await expect(page.locator(`.segmented-control-tab[data-tab="${workflow.tab}"]`)).toHaveClass(/active/);

        const layout = await readLayout(page, workflow.footer);
        expect(layout.documentWidth, `${workflow.tab} horizontal overflow`).toBeLessThanOrEqual(layout.clientWidth + 1);
        expect(layout.output.bottom, `${workflow.tab} output/footer order`).toBeLessThanOrEqual(layout.footer.top + 1);
        expect(layout.footer.position, `${workflow.tab} footer positioning`).not.toBe('fixed');
        expect(layout.footer.bottom, `${workflow.tab} footer/brand order`).toBeLessThanOrEqual(layout.brand.top + 1);
        expect(layout.shell.bottom, `${workflow.tab} shell/brand order`).toBeLessThanOrEqual(layout.brand.top + 1);
    }
});

test('mobile settings sheet is unobstructed, scroll-locking, and Escape dismissible', async ({ page }) => {
    await page.setViewportSize({ width: 330, height: 720 });
    await page.goto('/3d-obj');
    await waitForShell(page);

    const toggle = page.locator('#mobile-controls-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-label', 'Close settings panel');
    await expect(page.locator('#app-sidebar')).toHaveClass(/mobile-open/);
    await expect(page.locator('body')).toHaveClass(/mobile-controls-open/);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-label', 'Open settings panel');
    await expect(page.locator('#app-sidebar')).not.toHaveClass(/mobile-open/);
    await expect(page.locator('body')).not.toHaveClass(/mobile-controls-open/);
    await expect(toggle).toBeFocused();
});
