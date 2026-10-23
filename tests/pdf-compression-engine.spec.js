const { test, expect } = require('@playwright/test');
const { PDFDocument, PDFName, PDFNumber, degrees } = require('pdf-lib');

async function runCompression(page, bytes, options = {}) {
    return page.evaluate(async ({ bytes, options }) => {
        const { compressPdf } = await import('/modules/tabs/pdf-compression.js');
        const input = Uint8Array.from(bytes);
        const result = await compressPdf({ bytes: input, ...options });
        return { ...result, bytes: Array.from(result.bytes), unchanged: input.every((value, index) => value === bytes[index]) };
    }, { bytes: Array.from(bytes), options });
}

async function rejection(page, bytes, options = {}) {
    return page.evaluate(async ({ bytes, options }) => {
        const { compressPdf } = await import('/modules/tabs/pdf-compression.js');
        try {
            await compressPdf({ bytes: Uint8Array.from(bytes), ...options });
            return 'unexpected success';
        } catch (error) { return error.message; }
    }, { bytes: Array.from(bytes), options });
}

async function buildImagePdf() {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    let seed = 0x12345678;
    const pixels = new Uint8Array(384 * 256 * 3);
    for (let index = 0; index < pixels.length; index += 1) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pixels[index] = seed & 255;
    }
    const image = doc.context.register(doc.context.flateStream(pixels, {
        Type: 'XObject', Subtype: 'Image', Width: 384, Height: 256,
        BitsPerComponent: 8, ColorSpace: 'DeviceRGB'
    }));
    page.node.newXObject('Image', image);
    const { pushGraphicsState, concatTransformationMatrix, drawObject, popGraphicsState } = require('pdf-lib');
    const resources = page.node.Resources().lookup(PDFName.of('XObject'));
    const key = resources.keys()[0];
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(300, 0, 0, 200, 0, 0), drawObject(key), popGraphicsState());
    page.drawText('Selectable original text', { x: 8, y: 8, size: 10 });
    const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [5, 5, 150, 20], Border: [0, 0, 0], A: { S: 'URI', URI: 'https://example.com/' } }));
    page.node.addAnnot(link);
    return doc.save();
}

test.beforeEach(async ({ page }) => { await page.goto('/pdf'); });

test('standard mode safely recompresses RGB Flate pixels while preserving text, links and source bytes', async ({ page }) => {
    const bytes = await buildImagePdf();
    const result = await runCompression(page, bytes);
    expect(result.unchanged).toBe(true);
    expect(result.optimizedImages).toBe(1);
    expect(result.bytes.length).toBeLessThan(bytes.length / 2);
    const doc = await PDFDocument.load(Uint8Array.from(result.bytes));
    const image = doc.context.enumerateIndirectObjects().find(([, object]) => object.dict?.get(PDFName.of('Subtype')) === PDFName.of('Image'))[1];
    expect(image.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(image.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    expect(doc.getPage(0).node.Annots().size()).toBe(1);
});

test('view-only mode paints saved field appearances, preserves page rotation, and removes interaction without regenerating fonts', async ({ page }) => {
    const doc = await PDFDocument.create();
    const sheet = doc.addPage([240, 180]);
    sheet.setRotation(degrees(90));
    sheet.drawText('Original text', { x: 10, y: 150, size: 12 });
    const field = doc.getForm().createTextField('answer');
    field.setText('Existing field value');
    field.addToPage(sheet, { x: 20, y: 30, width: 170, height: 30 });
    doc.setTitle('PRIVATE ORIGINAL METADATA');
    await doc.attach(new Uint8Array([1, 2, 3]), 'attachment.bin');
    const input = await doc.save();
    const result = await runCompression(page, input, { mode: 'simplify' });
    const output = await PDFDocument.load(Uint8Array.from(result.bytes));
    expect(result.pageCount).toBe(1);
    expect(result.warnings.join(' ')).toContain('form fields');
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(output.getPage(0).node.Annots()).toBeUndefined();
    expect(output.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    expect(output.catalog.has(PDFName.of('Names'))).toBe(false);
    expect(output.getTitle()).not.toBe('PRIVATE ORIGINAL METADATA');
    const xObjects = output.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
    expect(xObjects.keys().some((key) => key.toString().includes('FlattenedAppearance'))).toBe(true);
});

test('view-only refuses visible annotations without appearances and optional-content layers rather than dropping them', async ({ page }) => {
    const doc = await PDFDocument.create();
    const sheet = doc.addPage([100, 150]);
    sheet.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 40, 40], Contents: 'Visible note' })));
    expect(await rejection(page, await doc.save(), { mode: 'simplify' })).toContain('cannot be flattened safely');
    sheet.node.delete(PDFName.of('Annots'));
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [] }));
    expect(await rejection(page, await doc.save(), { mode: 'simplify' })).toContain('optional-content layers');
});

test('signature fields nested directly in AcroForm are refused in every mode', async ({ page }) => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [{ FT: 'Sig', T: 'Signature field' }] }));
    const bytes = await doc.save({ updateFieldAppearances: false });
    for (const mode of ['optimize', 'simplify', 'rasterize']) {
        expect(await rejection(page, bytes, { mode })).toContain('signature-field PDFs');
    }
});

test('masked images are not recompressed, and larger saved copies carry an explicit warning', async ({ page }) => {
    const input = await buildImagePdf();
    const doc = await PDFDocument.load(input);
    const image = doc.context.enumerateIndirectObjects().find(([, object]) => object.dict?.get(PDFName.of('Subtype')) === PDFName.of('Image'))[1];
    image.dict.set(PDFName.of('SMaskInData'), PDFNumber.of(1));
    const result = await runCompression(page, await doc.save());
    expect(result.optimizedImages).toBe(0);
    expect(result.warnings.join(' ')).toContain('preserved');
    if (result.bytes.length >= input.length) expect(result.warnings.join(' ')).toContain('not smaller');
});

test('image-only uses the visible crop and orientation and contains no selectable text', async ({ page }) => {
    const doc = await PDFDocument.create();
    const sheet = doc.addPage([240, 180]);
    sheet.setCropBox(10, 20, 200, 140);
    sheet.setRotation(degrees(90));
    sheet.drawText('Render this visible text', { x: 20, y: 80, size: 12 });
    const result = await runCompression(page, await doc.save(), { mode: 'rasterize', preset: 'small' });
    const output = await PDFDocument.load(Uint8Array.from(result.bytes));
    expect(output.getPage(0).getSize()).toEqual({ width: 140, height: 200 });
    expect(output.getPage(0).getRotation().angle).toBe(0);
    expect(result.warnings.join(' ')).toContain('text search and selection');
    const text = await page.evaluate(async (bytes) => {
        const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
        const task = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
        const rendered = await task.promise;
        try { return (await (await rendered.getPage(1)).getTextContent()).items.length; }
        finally { await rendered.destroy(); }
    }, result.bytes);
    expect(text).toBe(0);
});

test('an already-aborted request does not load PDF dependencies or start work', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { compressPdf } = await import('/modules/tabs/pdf-compression.js');
        const controller = new AbortController();
        controller.abort();
        try { await compressPdf({ bytes: new Uint8Array([1]), signal: controller.signal, pdfLib: {} }); }
        catch (error) { return { name: error.name, message: error.message }; }
    });
    expect(result.name).toBe('AbortError');
});

test('Korean CID fonts without ToUnicode require a real packaged CMap and fail before rendering if it is missing', async ({ page }) => {
    const cmap = await page.request.get('/vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap');
    expect(cmap.status()).toBe(200);
    expect(cmap.headers()['content-type']).not.toContain('html');
    const data = await cmap.body();
    expect(data.length).toBeGreaterThan(16);
    expect(data[0]).not.toBe(0x3c);

    const doc = await PDFDocument.create();
    const sheet = doc.addPage([120, 180]);
    const descendant = doc.context.register(doc.context.obj({
        Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'SyntheticKoreanCID',
        CIDSystemInfo: { Registry: require('pdf-lib').PDFString.of('Adobe'), Ordering: require('pdf-lib').PDFString.of('Korea1'), Supplement: 0 }
    }));
    const font = doc.context.register(doc.context.obj({
        Type: 'Font', Subtype: 'Type0', BaseFont: 'SyntheticKoreanCID', Encoding: 'Identity-H', DescendantFonts: [descendant]
    }));
    sheet.node.Resources().set(PDFName.of('Font'), doc.context.obj({ Korean: font }));
    const input = Array.from(await doc.save());
    const invoke = async () => page.evaluate(async (bytes) => {
        const { compressPdf } = await import('/modules/tabs/pdf-compression.js');
        let renderStarted = false;
        try {
            await compressPdf({ bytes: Uint8Array.from(bytes), mode: 'rasterize', pdfjs: {
                getDocument() { renderStarted = true; throw new Error('TEST_RENDER_REACHED'); }
            } });
        } catch (error) { return { message: error.message, renderStarted }; }
    }, input);
    expect(await invoke()).toEqual({ message: 'TEST_RENDER_REACHED', renderStarted: true });
    await page.route('**/vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap', (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<html>Missing map</html>' }));
    const missing = await invoke();
    expect(missing.renderStarted).toBe(false);
    expect(missing.message).toContain('required Adobe-Korea1-UCS2 font map could not be loaded');
    await page.unroute('**/vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap');
});
