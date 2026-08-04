const fs = require('fs');
const { test, expect } = require('@playwright/test');

function getZipEntryNames(buffer) {
    const endOfCentralDirectorySignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const endOfCentralDirectory = buffer.lastIndexOf(endOfCentralDirectorySignature);
    if (endOfCentralDirectory < 0) throw new Error('ZIP end-of-central-directory record is missing.');

    const entryCount = buffer.readUInt16LE(endOfCentralDirectory + 10);
    let offset = buffer.readUInt32LE(endOfCentralDirectory + 16);
    const names = [];

    for (let index = 0; index < entryCount; index += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error(`ZIP central-directory entry ${index + 1} is invalid.`);
        }

        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        names.push(buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength));
        offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return names;
}

test('Bulk ZIP keeps every file and preserves filenames by default', async ({ page }, testInfo) => {
    const makeSvg = (color) => Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${color}"/></svg>`
    );
    const inputDirectory = testInfo.outputPath('bulk-input');
    fs.mkdirSync(`${inputDirectory}/a`, { recursive: true });
    fs.mkdirSync(`${inputDirectory}/b`, { recursive: true });
    fs.writeFileSync(`${inputDirectory}/a/shared.svg`, makeSvg('#ff0000'));
    fs.writeFileSync(`${inputDirectory}/b/shared.svg`, makeSvg('#00ff00'));
    fs.writeFileSync(`${inputDirectory}/unique.svg`, makeSvg('#0000ff'));

    await page.goto('/converter.html');
    await page.locator('.segmented-control-tab[data-tab="bulk"]').click();

    await expect(page.locator('#bulk-keep-names')).toBeChecked();

    await page.locator('#bulk-folder-input').setInputFiles(inputDirectory);

    await expect(page.locator('#bulk-preview-count')).toHaveText('3');
    await expect(page.locator('#bulk-preview-list .bulk-result-row')).toHaveCount(3);
    await expect(page.locator('#bulk-preview-list')).toContainText('shared.png');
    await expect(page.locator('#bulk-preview-list')).toContainText('shared_2.png');
    await expect(page.locator('#bulk-preview-list')).toContainText('unique.png');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#bulk-download-btn').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const zipEntries = getZipEntryNames(fs.readFileSync(downloadPath));

    expect(zipEntries).toEqual(['shared.png', 'shared_2.png', 'unique.png']);
    await expect(page.locator('#status-text')).toContainText('Exported 3 image(s)');
});

test('single-file Bulk ZIP uses the original filename instead of the folder name', async ({ page }, testInfo) => {
    const inputDirectory = testInfo.outputPath('folder-name-must-not-win');
    fs.mkdirSync(inputDirectory, { recursive: true });
    fs.writeFileSync(
        `${inputDirectory}/original-photo.svg`,
        '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#ff00ff"/></svg>'
    );

    await page.goto('/converter.html');
    await page.locator('.segmented-control-tab[data-tab="bulk"]').click();
    await page.locator('#bulk-folder-input').setInputFiles(inputDirectory);

    await expect(page.locator('#bulk-keep-names')).toBeChecked();
    await expect(page.locator('#bulk-preview-list')).toContainText('original-photo.png');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#bulk-download-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('original-photo.zip');

    const downloadPath = await download.path();
    expect(getZipEntryNames(fs.readFileSync(downloadPath))).toEqual(['original-photo.png']);
});
