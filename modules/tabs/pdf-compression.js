// All processing stays in this browser. Nothing here uploads or overwrites a PDF.
export const PDF_COMPRESSION_MAX_INPUT_BYTES = 100_000_000;
export const PDF_COMPRESSION_MAX_PAGES = 200;
const MAX_OBJECTS = 150_000;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_IMAGE_EDGE = 8192;
const MAX_TOTAL_IMAGE_PIXELS = 160_000_000;
const MAX_RENDER_PIXELS = 12_000_000;
const MAX_TOTAL_RENDER_PIXELS = 160_000_000;
const MAX_OUTPUT_BYTES = 150 * 1024 * 1024;
const PRESETS = Object.freeze({
    high: Object.freeze({ edge: 3200, quality: 0.88, dpi: 180 }),
    balanced: Object.freeze({ edge: 2200, quality: 0.76, dpi: 144 }),
    small: Object.freeze({ edge: 1500, quality: 0.60, dpi: 96 })
});
let pdfLibPromise;
let pdfJsPromise;

async function getPdfLib() {
    pdfLibPromise ||= import('../../vendor/pdf-lib/pdf-lib.esm.min.js?v=r-d45f015f257fd23c');
    return pdfLibPromise;
}

async function getPdfJs() {
    pdfJsPromise ||= import('../../vendor/pdfjs/pdf.min.mjs?v=r-d45f015f257fd23c').then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            '../../vendor/pdfjs/pdf.worker.min.mjs?v=r-d45f015f257fd23c', import.meta.url
        ).href;
        return pdfjs;
    });
    return pdfJsPromise;
}

function checkAbort(signal) {
    if (signal?.aborted) throw new DOMException('PDF compression was cancelled.', 'AbortError');
}

function tick(signal) {
    checkAbort(signal);
    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => checkAbort(signal));
}

function report(callback, progress, message, extra = {}) {
    callback?.({ progress, message, ...extra });
}

function warn(warnings, message) {
    if (!warnings.includes(message)) warnings.push(message);
}

function read(dict, key, lib) {
    return dict.lookup(lib.PDFName.of(key));
}

function number(dict, key, lib, fallback = undefined) {
    const value = read(dict, key, lib);
    return value instanceof lib.PDFNumber ? value.asNumber() : fallback;
}

function name(dict, key, lib) {
    const value = read(dict, key, lib);
    return value instanceof lib.PDFName ? value.toString() : '';
}

function numericArray(value, length, lib) {
    if (!(value instanceof lib.PDFArray) || value.size() !== length) return null;
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const item = value.lookup(index);
        if (!(item instanceof lib.PDFNumber) || !Number.isFinite(item.asNumber())) return null;
        result.push(item.asNumber());
    }
    return result;
}

function assertUnsigned(document, lib) {
    const permissions = read(document.catalog, 'Perms', lib);
    if (permissions instanceof lib.PDFDict && permissions.has(lib.PDFName.of('DocMDP'))) {
        throw new Error('Signed PDFs cannot be compressed here because editing would invalidate the signature. Use an unsigned copy.');
    }
    const objects = document.context.enumerateIndirectObjects();
    if (objects.length > MAX_OBJECTS) throw new Error('This PDF is too complex for safe browser compression.');
    const pending = objects.map(([, object]) => object);
    const visited = new Set();
    const dictionaries = [];
    while (pending.length) {
        const object = pending.pop();
        if (!object || visited.has(object)) continue;
        visited.add(object);
        if (visited.size > MAX_OBJECTS * 4) throw new Error('This PDF is too complex for safe browser compression.');
        if (object instanceof lib.PDFArray) {
            for (let index = 0; index < object.size(); index += 1) {
                const child = object.lookup(index);
                if (child instanceof lib.PDFDict || child instanceof lib.PDFArray || child instanceof lib.PDFStream) pending.push(child);
            }
            continue;
        }
        const dict = object instanceof lib.PDFStream ? object.dict : object;
        if (!(dict instanceof lib.PDFDict)) continue;
        dictionaries.push(dict);
        if (name(dict, 'Type', lib) === '/Sig'
            || name(dict, 'FT', lib) === '/Sig'
            || dict.has(lib.PDFName.of('ByteRange'))) {
            throw new Error('Signed or signature-field PDFs cannot be compressed here. Use an unsigned copy without signature fields.');
        }
        for (const [key] of dict.entries()) {
            const child = dict.lookup(key);
            if (child instanceof lib.PDFDict || child instanceof lib.PDFArray || child instanceof lib.PDFStream) pending.push(child);
        }
    }
    return dictionaries;
}

// An embedded CID CFF font can still require a registered Adobe CID-to-Unicode
// CMap. PDF.js only logs a warning when this asset is missing and may produce a
// seemingly successful blank-glyph render, even with stopAtErrors enabled.
async function requireCidCMaps(dictionaries, lib, signal) {
    const required = new Set();
    for (const dict of dictionaries) {
        if (name(dict, 'Subtype', lib) !== '/Type0' || dict.has(lib.PDFName.of('ToUnicode'))) continue;
        const descendants = read(dict, 'DescendantFonts', lib);
        if (!(descendants instanceof lib.PDFArray)) continue;
        for (let index = 0; index < descendants.size(); index += 1) {
            const descendant = descendants.lookup(index);
            if (!(descendant instanceof lib.PDFDict)) continue;
            const system = read(descendant, 'CIDSystemInfo', lib);
            if (!(system instanceof lib.PDFDict)) continue;
            const registry = read(system, 'Registry', lib)?.decodeText?.();
            const ordering = read(system, 'Ordering', lib)?.decodeText?.();
            if (registry === 'Adobe' && ['CNS1', 'GB1', 'Japan1', 'Korea1'].includes(ordering)) {
                required.add(`Adobe-${ordering}-UCS2`);
            }
        }
    }
    for (const cmap of required) {
        checkAbort(signal);
        try {
            const response = await fetch(new URL(`../../vendor/pdfjs/cmaps/${cmap}.bcmap`, import.meta.url), {
                signal, credentials: 'omit', cache: 'force-cache'
            });
            // Reject SPA error fallbacks as well as ordinary missing files. The
            // packaged maps are small binary files, never HTML error documents.
            const type = response.headers.get('content-type') || '';
            if (!response.ok || /html|xml|json/i.test(type)) {
                await response.body?.cancel();
                throw new Error('Required font CMap is unavailable.');
            }
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Required font CMap has no data.');
            let received = 0;
            let firstByte;
            try {
                for (;;) {
                    checkAbort(signal);
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (firstByte === undefined && value.length) firstByte = value[0];
                    received += value.byteLength;
                    if (received > 512_000) throw new Error('Required font CMap is too large.');
                }
                if (received < 16 || firstByte === 0x3c) throw new Error('Required font CMap is invalid.');
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        } catch (error) {
            checkAbort(signal);
            throw new Error(`Image-only compression stopped because the required ${cmap} font map could not be loaded. No copy was created; keep the original or use Standard compression.`);
        }
    }
}

function validatePages(document) {
    const pages = document.getPages();
    if (!pages.length || pages.length > PDF_COMPRESSION_MAX_PAGES) {
        throw new Error(`Choose a PDF with 1 to ${PDF_COMPRESSION_MAX_PAGES} pages.`);
    }
    for (const page of pages) {
        const { width, height } = page.getSize();
        if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= 14_400)) {
            throw new Error('A page has unsupported dimensions. Browser compression supports pages up to 200 inches.');
        }
    }
    return pages;
}

function createCanvas(width, height) {
    const canvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : globalThis.document?.createElement('canvas');
    if (!canvas) throw new Error('This browser does not provide a canvas for local PDF compression.');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
        canvas.width = canvas.height = 1;
        throw new Error('The browser could not allocate an image canvas. Try a smaller PDF.');
    }
    return { canvas, context };
}

function releaseCanvas(canvas) {
    if (canvas) canvas.width = canvas.height = 1;
}

async function encodeJpeg(canvas, quality, signal) {
    checkAbort(signal);
    const blob = typeof canvas.convertToBlob === 'function'
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
        : await new Promise((resolve, reject) => canvas.toBlob(
            (result) => result ? resolve(result) : reject(new Error('JPEG encoding failed.')),
            'image/jpeg', quality
        ));
    checkAbort(signal);
    if (blob.type !== 'image/jpeg') throw new Error('This browser cannot encode JPEG images.');
    return new Uint8Array(await blob.arrayBuffer());
}

function imageColorSpace(dict, lib) {
    const value = read(dict, 'ColorSpace', lib);
    if (value === lib.PDFName.of('DeviceRGB')) return { components: 3, value, icc: false };
    if (value === lib.PDFName.of('DeviceGray')) return { components: 1, value, icc: false };
    if (value instanceof lib.PDFArray && value.size() === 2
        && value.lookup(0) === lib.PDFName.of('ICCBased')) {
        const profile = value.lookup(1);
        if (profile instanceof lib.PDFStream && number(profile.dict, 'N', lib) === 3) {
            return { components: 3, value, icc: true };
        }
    }
    return null;
}

function imageFilter(dict, lib) {
    let filter = read(dict, 'Filter', lib);
    if (filter instanceof lib.PDFArray && filter.size() === 1) filter = filter.lookup(0);
    return filter instanceof lib.PDFName ? filter.toString() : '';
}

function hasSafePredictor(dict, lib) {
    let parameters = read(dict, 'DecodeParms', lib);
    if (parameters instanceof lib.PDFArray && parameters.size() === 1) parameters = parameters.lookup(0);
    return !parameters || (parameters instanceof lib.PDFDict && number(parameters, 'Predictor', lib, 1) === 1);
}

// Decode only the explicitly supported raw RGB/gray Flate case, and cap decoded
// bytes while reading. An unbounded inflate followed by a length check is unsafe.
async function inflateImage(encoded, expectedBytes, signal) {
    if (typeof DecompressionStream !== 'function') throw new Error('Browser Flate image decoding is unavailable.');
    const reader = new Blob([encoded]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const output = new Uint8Array(expectedBytes);
    let offset = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        for (;;) {
            checkAbort(signal);
            const { value, done } = await reader.read();
            if (done) break;
            if (offset + value.byteLength > expectedBytes) throw new Error('An image expands beyond its declared dimensions.');
            output.set(value, offset);
            offset += value.byteLength;
        }
        checkAbort(signal);
        if (offset !== expectedBytes) throw new Error('An image has incomplete pixel data.');
        return output;
    } finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function recompressImage(stream, width, height, color, filter, preset, signal) {
    let bitmap;
    let source;
    let target;
    try {
        let drawable;
        if (filter === '/FlateDecode') {
            const raw = await inflateImage(stream.getContents(), width * height * color.components, signal);
            source = createCanvas(width, height);
            const rgba = new Uint8ClampedArray(width * height * 4);
            for (let pixel = 0, input = 0, output = 0; pixel < width * height; pixel += 1) {
                const red = raw[input++];
                rgba[output++] = red;
                rgba[output++] = color.components === 3 ? raw[input++] : red;
                rgba[output++] = color.components === 3 ? raw[input++] : red;
                rgba[output++] = 255;
            }
            source.context.putImageData(new ImageData(rgba, width, height), 0, 0);
            drawable = source.canvas;
        } else {
            if (typeof createImageBitmap !== 'function') throw new Error('Browser JPEG decoding is unavailable.');
            bitmap = await createImageBitmap(new Blob([stream.getContents()], { type: 'image/jpeg' }), {
                imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none'
            });
            if (bitmap.width !== width || bitmap.height !== height) throw new Error('JPEG dimensions differ from its PDF image dimensions.');
            drawable = bitmap;
        }
        checkAbort(signal);
        const scale = Math.min(1, preset.edge / Math.max(width, height));
        const outputWidth = Math.max(1, Math.round(width * scale));
        const outputHeight = Math.max(1, Math.round(height * scale));
        target = createCanvas(outputWidth, outputHeight);
        target.context.imageSmoothingEnabled = true;
        target.context.imageSmoothingQuality = 'high';
        target.context.drawImage(drawable, 0, 0, outputWidth, outputHeight);
        return { bytes: await encodeJpeg(target.canvas, preset.quality, signal), width: outputWidth, height: outputHeight };
    } finally {
        bitmap?.close();
        releaseCanvas(source?.canvas);
        releaseCanvas(target?.canvas);
    }
}

async function optimizeImages(document, lib, preset, signal, warnings, onProgress) {
    const candidates = document.context.enumerateIndirectObjects().filter(([, object]) => (
        object instanceof lib.PDFRawStream && name(object.dict, 'Subtype', lib) === '/Image'
    ));
    let optimizedImages = 0;
    let decodedPixels = 0;
    for (let index = 0; index < candidates.length; index += 1) {
        await tick(signal);
        const [ref, stream] = candidates[index];
        const dict = stream.dict;
        const width = number(dict, 'Width', lib);
        const height = number(dict, 'Height', lib);
        const filter = imageFilter(dict, lib);
        const color = imageColorSpace(dict, lib);
        report(onProgress, 0.12 + (index / Math.max(1, candidates.length)) * 0.72,
            `Optimizing image ${index + 1} of ${candidates.length}.`);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
            warn(warnings, 'Images above the safe browser pixel limit were preserved without recompression.');
            continue;
        }
        if (!color || number(dict, 'BitsPerComponent', lib) !== 8
            || ['SMask', 'Mask', 'ImageMask', 'Decode', 'SMaskInData', 'Alternates', 'OPI'].some((key) => dict.has(lib.PDFName.of(key)))
            || !['/DCTDecode', '/FlateDecode'].includes(filter)
            || (filter === '/DCTDecode' && (color.icc || dict.has(lib.PDFName.of('DecodeParms'))))
            || (filter === '/FlateDecode' && !hasSafePredictor(dict, lib))) {
            warn(warnings, 'Masked, unusual-color, or unsupported image encodings were preserved to avoid changing their appearance.');
            continue;
        }
        if (decodedPixels + width * height > MAX_TOTAL_IMAGE_PIXELS) {
            warn(warnings, 'The image processing limit was reached; remaining images were preserved.');
            break;
        }
        decodedPixels += width * height;
        // Small logos and diagrams are not worth a second lossy encoding.
        if (stream.getContentsSize() < 32_768 || Math.max(width, height) < 256) continue;
        try {
            const result = await recompressImage(stream, width, height, color, filter, preset, signal);
            checkAbort(signal);
            if (result.bytes.byteLength + 256 >= stream.getContentsSize() * 0.98) continue;
            const replacement = dict.clone(document.context);
            replacement.set(lib.PDFName.of('Filter'), lib.PDFName.of('DCTDecode'));
            replacement.set(lib.PDFName.of('BitsPerComponent'), lib.PDFNumber.of(8));
            replacement.set(lib.PDFName.of('Width'), lib.PDFNumber.of(result.width));
            replacement.set(lib.PDFName.of('Height'), lib.PDFNumber.of(result.height));
            // Canvas JPEG is RGB. Retain the original RGB ICC profile, rather
            // than relabeling its component samples as uncalibrated DeviceRGB.
            replacement.set(lib.PDFName.of('ColorSpace'), color.icc ? color.value : lib.PDFName.of('DeviceRGB'));
            replacement.delete(lib.PDFName.of('DecodeParms'));
            document.context.assign(ref, lib.PDFRawStream.of(replacement, result.bytes));
            optimizedImages += 1;
        } catch (error) {
            checkAbort(signal);
            warn(warnings, 'Some images could not be safely recompressed and were preserved unchanged.');
        }
    }
    return optimizedImages;
}

function invisibleLink(dict, lib) {
    if (name(dict, 'Subtype', lib) !== '/Link') return false;
    const border = read(dict, 'Border', lib);
    const style = read(dict, 'BS', lib);
    // The PDF default is a visible 1-point border. Do not assume absent border
    // data means invisible, or silently discard a drawn link rectangle.
    if (style instanceof lib.PDFDict) return number(style, 'W', lib, 1) === 0;
    return border instanceof lib.PDFArray && border.size() >= 3
        && border.lookup(2) instanceof lib.PDFNumber && border.lookup(2).asNumber() === 0;
}

function appearancePlan(annotation, page, lib, pageNumber, imageOnly = false) {
    const unsupported = () => new Error(
        imageOnly
            ? `Page ${pageNumber} has an annotation that cannot be painted safely in an image-only copy. Flatten it in a trusted PDF application first.`
            : `Page ${pageNumber} has an annotation that cannot be flattened safely. Choose image-only compression, or flatten it in a trusted PDF application first.`
    );
    if (!(annotation instanceof lib.PDFDict)) throw unsupported();
    const flags = number(annotation, 'F', lib, 0);
    if (flags & (1 | 2 | 32)) return null; // Invisible, Hidden, or NoView.
    if (name(annotation, 'Subtype', lib) === '/Popup') return null;
    if (annotation.has(lib.PDFName.of('OC')) || flags & (8 | 16 | 256)) throw unsupported();
    const appearances = read(annotation, 'AP', lib);
    let appearance = appearances instanceof lib.PDFDict ? read(appearances, 'N', lib) : undefined;
    if (appearance instanceof lib.PDFDict) {
        const state = read(annotation, 'AS', lib);
        appearance = state instanceof lib.PDFName ? appearance.lookup(state) : undefined;
    }
    if (!(appearance instanceof lib.PDFStream)) {
        if (invisibleLink(annotation, lib)) return null;
        throw unsupported();
    }
    if (name(appearance.dict, 'Subtype', lib) !== '/Form') throw unsupported();
    const rect = numericArray(read(annotation, 'Rect', lib), 4, lib);
    const bbox = numericArray(read(appearance.dict, 'BBox', lib), 4, lib);
    const rawMatrix = read(appearance.dict, 'Matrix', lib);
    const matrix = rawMatrix ? numericArray(rawMatrix, 6, lib) : [1, 0, 0, 1, 0, 0];
    if (!rect || !bbox || !matrix || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) throw unsupported();
    const corners = [[bbox[0], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[1]], [bbox[2], bbox[3]]]
        .map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
    const left = Math.min(...corners.map(([x]) => x));
    const bottom = Math.min(...corners.map(([, y]) => y));
    const boxWidth = Math.max(...corners.map(([x]) => x)) - left;
    const boxHeight = Math.max(...corners.map(([, y]) => y)) - bottom;
    const x = Math.min(rect[0], rect[2]);
    const y = Math.min(rect[1], rect[3]);
    const width = Math.abs(rect[2] - rect[0]);
    const height = Math.abs(rect[3] - rect[1]);
    if (!(boxWidth > 0 && boxHeight > 0 && width > 0 && height > 0)) throw unsupported();
    const sx = width / boxWidth;
    const sy = height / boxHeight;
    return { page, appearance, x, y, width, height, transform: [sx, 0, 0, sy, x - sx * left, y - sy * bottom] };
}

function annotationPlans(document, lib, imageOnly = false) {
    const result = [];
    document.getPages().forEach((page, index) => {
        const annotations = read(page.node, 'Annots', lib);
        if (!annotations) return;
        if (!(annotations instanceof lib.PDFArray)) throw new Error(`Page ${index + 1} has an invalid annotation list.`);
        for (let offset = 0; offset < annotations.size(); offset += 1) {
            const plan = appearancePlan(annotations.lookup(offset), page, lib, index + 1, imageOnly);
            if (plan) result.push(plan);
        }
    });
    return result;
}

async function simplifyDocument(document, lib, signal, warnings) {
    const form = read(document.catalog, 'AcroForm', lib);
    if (form instanceof lib.PDFDict && form.has(lib.PDFName.of('XFA'))) {
        throw new Error('Dynamic XFA forms cannot be flattened safely here. Export a standard PDF from the form application first.');
    }
    if (document.catalog.has(lib.PDFName.of('OCProperties'))) {
        throw new Error('This PDF uses optional-content layers. Choose image-only compression to preserve the currently visible layers.');
    }
    // Validate every visible annotation before changing any page. We use the
    // saved appearance, never regenerate Korean fields with a substitute font.
    const plans = annotationPlans(document, lib);
    for (const plan of plans) {
        checkAbort(signal);
        const ref = document.context.register(plan.appearance);
        const key = plan.page.node.newXObject('FlattenedAppearance', ref);
        plan.page.pushOperators(
            lib.pushGraphicsState(), lib.rectangle(plan.x, plan.y, plan.width, plan.height),
            lib.clip(), lib.endPath(), lib.concatTransformationMatrix(...plan.transform),
            lib.drawObject(key), lib.popGraphicsState()
        );
    }
    for (const page of document.getPages()) {
        for (const key of ['Annots', 'AA', 'Metadata', 'PieceInfo', 'AF', 'PresSteps', 'Dur', 'Trans', 'Tabs', 'StructParents', 'SpiderInfo']) {
            page.node.delete(lib.PDFName.of(key));
        }
    }
    for (const [, object] of document.context.enumerateIndirectObjects()) {
        const dict = object instanceof lib.PDFStream ? object.dict : object;
        if (!(dict instanceof lib.PDFDict)) continue;
        if (['/Page', '/Pages', '/XObject', '/Font'].includes(name(dict, 'Type', lib))
            || ['/Image', '/Form'].includes(name(dict, 'Subtype', lib))) {
            for (const key of ['Metadata', 'PieceInfo', 'LastModified']) dict.delete(lib.PDFName.of(key));
        }
    }
    const output = await lib.PDFDocument.create();
    const pages = await output.copyPages(document, document.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    // Output intents are color data, not removable bloat: retaining them avoids
    // changing the interpretation of uncalibrated page colors.
    const outputIntents = document.catalog.get(lib.PDFName.of('OutputIntents'));
    if (outputIntents) {
        output.catalog.set(lib.PDFName.of('OutputIntents'), lib.PDFObjectCopier.for(document.context, output.context).copy(outputIntents));
    }
    warn(warnings, 'View-only copy: form fields, comments, links, bookmarks, attachments, document metadata, and tags are removed. Supported visible appearances are kept as page content.');
    return output;
}

async function rasterizeDocument(bytes, source, dictionaries, lib, suppliedPdfJs, preset, signal, warnings, onProgress) {
    const form = read(source.catalog, 'AcroForm', lib);
    if (form instanceof lib.PDFDict && form.has(lib.PDFName.of('XFA'))) {
        throw new Error('Dynamic XFA forms are not supported. Export a standard PDF from the form application first.');
    }
    // PDF.js canvas paints saved annotation appearances, not arbitrary HTML
    // popup/icon overlays. Never silently claim those overlays were preserved.
    annotationPlans(source, lib, true);
    await requireCidCMaps(dictionaries, lib, signal);
    const pdfjs = suppliedPdfJs || await getPdfJs();
    checkAbort(signal);
    const loadingTask = pdfjs.getDocument({
        data: bytes.slice(), isEvalSupported: false, enableXfa: false,
        cMapUrl: new URL('../../vendor/pdfjs/cmaps/', import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('../../vendor/pdfjs/standard_fonts/', import.meta.url).href,
        useSystemFonts: true, stopAtErrors: true
    });
    let renderedDocument;
    let currentRender;
    const abort = () => {
        currentRender?.cancel();
        void loadingTask.destroy().catch(() => {});
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        renderedDocument = await loadingTask.promise;
        checkAbort(signal);
        if (renderedDocument.numPages !== source.getPageCount()) throw new Error('The PDF page count could not be verified.');
        const plan = [];
        let totalPixels = 0;
        for (let index = 1; index <= renderedDocument.numPages; index += 1) {
            const page = await renderedDocument.getPage(index);
            try {
                const base = page.getViewport({ scale: 1 });
                if (![base.width, base.height].every((value) => Number.isFinite(value) && value > 0 && value <= 14_400)) {
                    throw new Error('A visible page has unsupported dimensions.');
                }
                const scale = Math.min(preset.dpi / 72, MAX_IMAGE_EDGE / Math.max(base.width, base.height),
                    Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height)));
                const width = Math.max(1, Math.floor(base.width * scale));
                const height = Math.max(1, Math.floor(base.height * scale));
                totalPixels += width * height;
                if (totalPixels > MAX_TOTAL_RENDER_PIXELS) throw new Error('The PDF needs too many rendered pixels for safe browser compression. Choose Small or a shorter document.');
                plan.push({ width, height, scale, pageWidth: base.width, pageHeight: base.height });
            } finally {
                page.cleanup();
            }
        }
        const output = await lib.PDFDocument.create();
        let encodedBytes = 0;
        for (let index = 0; index < plan.length; index += 1) {
            await tick(signal);
            const page = await renderedDocument.getPage(index + 1);
            let target;
            try {
                const dimensions = plan[index];
                target = createCanvas(dimensions.width, dimensions.height);
                target.context.fillStyle = '#fff';
                target.context.fillRect(0, 0, dimensions.width, dimensions.height);
                report(onProgress, 0.12 + index / plan.length * 0.75, `Rendering page ${index + 1} of ${plan.length}.`, { page: index + 1, pageCount: plan.length });
                checkAbort(signal);
                currentRender = page.render({
                    canvasContext: target.context, viewport: page.getViewport({ scale: dimensions.scale }),
                    background: 'rgb(255,255,255)', annotationMode: pdfjs.AnnotationMode?.ENABLE ?? 1
                });
                await currentRender.promise;
                currentRender = null;
                checkAbort(signal);
                const jpeg = await encodeJpeg(target.canvas, preset.quality, signal);
                encodedBytes += jpeg.byteLength;
                if (encodedBytes > MAX_OUTPUT_BYTES) throw new Error('The rendered copy exceeds the safe browser output limit. Choose Small.');
                const image = await output.embedJpg(jpeg);
                const resultPage = output.addPage([dimensions.pageWidth, dimensions.pageHeight]);
                resultPage.drawImage(image, { x: 0, y: 0, width: dimensions.pageWidth, height: dimensions.pageHeight });
            } finally {
                currentRender?.cancel();
                currentRender = null;
                releaseCanvas(target?.canvas);
                page.cleanup();
            }
        }
        warn(warnings, 'Image-only copy: text search and selection, links, forms, comments, layers, bookmarks, attachments, and accessibility tags are removed. All page content becomes JPEG images.');
        return output;
    } catch (error) {
        checkAbort(signal);
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        currentRender?.cancel();
        if (renderedDocument) await renderedDocument.destroy();
        else await loadingTask.destroy().catch(() => {});
    }
}

/**
 * Produce a separate PDF copy. `onProgress` receives {progress: 0..1, message}.
 * The caller must compare result bytes with input bytes: compression is never
 * guaranteed, and a larger copy must not be labelled as a successful reduction.
 */
export async function compressPdf({ bytes, mode = 'optimize', preset = 'balanced', signal, onProgress, pdfLib, pdfjs } = {}) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('Choose a non-empty PDF file.');
    if (bytes.byteLength > PDF_COMPRESSION_MAX_INPUT_BYTES) throw new Error('Choose a PDF smaller than 100 MB for browser compression.');
    if (!['optimize', 'simplify', 'rasterize'].includes(mode)) throw new Error('Choose a supported PDF compression mode.');
    if (!Object.hasOwn(PRESETS, preset)) throw new Error('Choose High, Balanced, or Small quality.');
    checkAbort(signal);
    const lib = pdfLib || await getPdfLib();
    report(onProgress, 0.02, 'Reading the PDF locally.');
    let document;
    try {
        document = await lib.PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    } catch (error) {
        checkAbort(signal);
        if (error instanceof lib.EncryptedPDFError || /encrypted/i.test(error?.message || '')) {
            throw new Error('Password-protected or encrypted PDFs cannot be compressed here. Use an unlocked copy.');
        }
        throw new Error('This PDF could not be read safely. Open it in a trusted PDF viewer and export a valid copy first.');
    }
    checkAbort(signal);
    const dictionaries = assertUnsigned(document, lib);
    const pageCount = validatePages(document).length;
    const warnings = [];
    let optimizedImages = 0;
    if (mode === 'rasterize') {
        document = await rasterizeDocument(bytes, document, dictionaries, lib, pdfjs, PRESETS[preset], signal, warnings, onProgress);
    } else {
        if (mode === 'simplify') document = await simplifyDocument(document, lib, signal, warnings);
        optimizedImages = await optimizeImages(document, lib, PRESETS[preset], signal, warnings, onProgress);
    }
    checkAbort(signal);
    report(onProgress, 0.92, 'Building the separate compressed copy.');
    const result = await document.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 30 });
    checkAbort(signal);
    if (result.byteLength > MAX_OUTPUT_BYTES) throw new Error('The compressed copy exceeds the safe browser output limit. Choose Small.');
    if (result.byteLength >= bytes.byteLength) warn(warnings, 'This copy is not smaller than the original. Keep the original, or try a different preset or image-only mode.');
    report(onProgress, 1, 'The separate PDF copy is ready.');
    return { bytes: result, pageCount, optimizedImages, warnings, mode, preset };
}
