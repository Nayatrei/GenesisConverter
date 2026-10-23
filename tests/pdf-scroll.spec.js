const { test, expect } = require('@playwright/test');

async function pointerInside(page, locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    const top = Math.max(0, box.y);
    const bottom = Math.min(viewport.height, box.y + box.height);
    expect(bottom - top).toBeGreaterThan(20);
    await page.mouse.move(box.x + Math.min(box.width - 16, Math.max(16, box.width / 2)), top + (bottom - top) / 2);
}

async function flushWheelFrames(page) {
    // mouse.wheel dispatch can return before the compositor consumes it. A
    // zero-position assertion alone can otherwise pass before an upward wheel
    // is applied, letting the following downward wheel coalesce with it.
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

for (const viewport of [{ width: 1280, height: 640 }, { width: 1440, height: 900 }]) {
    test(`Desktop PDF ${viewport.width}px keeps its sticky task rail and normal document wheel scrolling`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/pdf');
        await expect(page.locator('[data-pdf-task]')).toHaveCount(5);
        const rail = page.locator('.stage-inspector-rail');
        const railLayout = await rail.evaluate((element) => ({ position: getComputedStyle(element).position, height: element.getBoundingClientRect().height }));
        expect(railLayout.position).toBe('sticky');
        expect(railLayout.height).toBeLessThanOrEqual(viewport.height + 1);
        const sidebar = page.locator('.app-sidebar');
        const beforeNavigation = await sidebar.evaluate((element) => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight }));
        if (beforeNavigation.content > beforeNavigation.height + 1) {
            await pointerInside(page, sidebar);
            await page.mouse.wheel(0, 500);
            const requiredMovement = Math.min(30, (beforeNavigation.content - beforeNavigation.height) / 2);
            await expect.poll(() => sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeNavigation.top + requiredMovement);
        } else {
            // A tall viewport needs no nested scrolling if all tasks fit.
            const lastTask = await page.locator('[data-pdf-task]').last().boundingBox();
            expect(lastTask.y + lastTask.height).toBeLessThanOrEqual(viewport.height);
        }

        await page.locator('#pdf-task-compress-btn').click();
        await page.locator('#pdf-compress-options-summary').click();
        const traps = await page.evaluate(() => [
            '.app-shell', '.app-workspace', '#main-content', '#output-section',
            '#pdf-guided-shell', '#pdf-compress-panel'
        ].map((selector) => {
            const element = document.querySelector(selector);
            return { selector, overflow: getComputedStyle(element).overflowY, top: element.scrollTop };
        }));
        expect(traps.filter(({ overflow }) => overflow === 'hidden' || overflow === 'clip')).toEqual([]);
        expect(traps.filter(({ top }) => top > 1)).toEqual([]);

        // All scrolling proof below uses wheel input, not locator auto-scroll
        // or programmatic scrollTo/scrollIntoView on any document ancestor.
        const panel = page.locator('#pdf-compress-panel');
        await pointerInside(page, panel);
        await page.mouse.wheel(0, -10000);
        await flushWheelFrames(page);
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeLessThan(1);
        await pointerInside(page, panel);
        await page.mouse.wheel(0, 500);
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeGreaterThan(80);
        expect(await panel.evaluate((element) => element.scrollTop)).toBeLessThan(1);

        // The header is outside the form; scrolling there must also reach the
        // shared footer. Wheel upward from that footer returns to the top.
        await pointerInside(page, page.locator('.workspace-topbar'));
        await page.mouse.wheel(0, 10000);
        await expect.poll(() => page.locator('.brand-footer').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top < window.innerHeight && rect.bottom > 0;
        })).toBe(true);
        await pointerInside(page, page.locator('.brand-footer'));
        await page.mouse.wheel(0, -10000);
        await flushWheelFrames(page);
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeLessThan(1);
    });
}

for (const width of [390, 960, 1023]) {
    test(`PDF ${width}px uses normal document wheel scrolling without hidden ancestor traps`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 700 });
        await page.goto('/pdf');
        await expect(page.locator('[data-pdf-task]')).toHaveCount(5);
        await page.locator('#pdf-task-compress-btn').click();
        await page.locator('#pdf-compress-options-summary').click();

        const traps = await page.evaluate(() => [
            '.app-shell', '.app-workspace', '#main-content', '#output-section',
            '#pdf-guided-shell', '#pdf-compress-panel'
        ].map((selector) => {
            const element = document.querySelector(selector);
            return { selector, overflow: getComputedStyle(element).overflowY, top: element.scrollTop };
        }));
        expect(traps.filter(({ overflow }) => overflow === 'hidden' || overflow === 'clip')).toEqual([]);
        expect(traps.filter(({ top }) => top > 1)).toEqual([]);

        // Deliberately do not call scrollIntoView, scrollTo, locator hover, or
        // locator clicks after this point: native wheel input is the proof.
        const viewport = page.viewportSize();
        await page.mouse.move(viewport.width / 2, viewport.height - 140);
        await page.mouse.wheel(0, -10000);
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeLessThan(1);
        await page.mouse.wheel(0, 600);
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeGreaterThan(80);
        const downwardPosition = await page.evaluate(() => document.scrollingElement.scrollTop);
        await page.mouse.wheel(0, -400);
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeLessThan(downwardPosition - 40);
        const hiddenOffsets = await page.evaluate(() => [
            '#main-content', '#output-section', '#pdf-guided-shell', '#pdf-compress-panel'
        ].map((selector) => document.querySelector(selector).scrollTop));
        expect(hiddenOffsets.every((top) => top < 1)).toBe(true);
    });
}
