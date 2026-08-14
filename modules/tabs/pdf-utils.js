export const PDF_IMAGE_EXPORT_MAX_EDGE = 8192;
export const PDF_IMAGE_EXPORT_MAX_PAGE_PIXELS = 32_000_000;
export const PDF_IMAGE_EXPORT_MAX_TOTAL_PIXELS = 128_000_000;
export const PDF_IMAGE_EXPORT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export function parsePdfPageRange(rawInput, pageCount) {
    if (!Number.isInteger(pageCount) || pageCount < 1) {
        return {
            ok: false,
            indices: [],
            error: 'PDF page count is not available yet.'
        };
    }

    const input = String(rawInput || '').trim().toLowerCase();
    if (!input) {
        return {
            ok: false,
            indices: [],
            error: 'Enter a page range.'
        };
    }

    if (input === 'all') {
        return {
            ok: true,
            indices: Array.from({ length: pageCount }, (_, index) => index),
            error: ''
        };
    }

    if (input.includes('all')) {
        return {
            ok: false,
            indices: [],
            error: 'Use "all" by itself, or enter page numbers.'
        };
    }

    const indices = [];
    const seen = new Set();
    const parts = input.split(',');

    for (const rawPart of parts) {
        const part = rawPart.trim();
        if (!part) {
            return {
                ok: false,
                indices: [],
                error: 'Remove empty range entries.'
            };
        }

        const rangeParts = part.split('-').map((value) => value.trim());
        if (rangeParts.length > 2 || rangeParts.some((value) => !value)) {
            return {
                ok: false,
                indices: [],
                error: `Invalid range "${part}".`
            };
        }

        const startPage = parsePageToken(rangeParts[0], pageCount);
        const endPage = rangeParts.length === 2
            ? parsePageToken(rangeParts[1], pageCount)
            : startPage;

        if (startPage === null || endPage === null) {
            return {
                ok: false,
                indices: [],
                error: `Invalid page "${part}".`
            };
        }

        if (startPage < 1 || endPage < 1 || startPage > pageCount || endPage > pageCount) {
            return {
                ok: false,
                indices: [],
                error: `Page range must stay between 1 and ${pageCount}.`
            };
        }

        if (startPage > endPage) {
            return {
                ok: false,
                indices: [],
                error: `Range "${part}" starts after it ends.`
            };
        }

        for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
            const index = pageNumber - 1;
            if (!seen.has(index)) {
                seen.add(index);
                indices.push(index);
            }
        }
    }

    if (!indices.length) {
        return {
            ok: false,
            indices: [],
            error: 'Select at least one page.'
        };
    }

    return {
        ok: true,
        indices,
        error: ''
    };
}

export function formatPdfBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function sanitizePdfFilename(rawName) {
    const fallback = 'merged.pdf';
    const cleaned = String(rawName || '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/\s+/g, ' ');

    if (!cleaned) return fallback;
    return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

export function getPdfImageExportDimensions({
    targetWidth,
    baseWidth,
    baseHeight,
    maxEdge = PDF_IMAGE_EXPORT_MAX_EDGE,
    maxPixels = PDF_IMAGE_EXPORT_MAX_PAGE_PIXELS
}) {
    const safeBaseWidth = Number(baseWidth);
    const safeBaseHeight = Number(baseHeight);
    const safeTargetWidth = Number(targetWidth);
    if (
        !Number.isFinite(safeBaseWidth)
        || !Number.isFinite(safeBaseHeight)
        || safeBaseWidth <= 0
        || safeBaseHeight <= 0
        || !Number.isFinite(safeTargetWidth)
        || safeTargetWidth <= 0
    ) {
        throw new Error('PDF page dimensions are unavailable for image export.');
    }

    let scale = safeTargetWidth / safeBaseWidth;
    scale = Math.min(
        scale,
        maxEdge / Math.max(safeBaseWidth, safeBaseHeight),
        Math.sqrt(maxPixels / (safeBaseWidth * safeBaseHeight))
    );
    scale = Math.max(scale, 1 / Math.max(safeBaseWidth, safeBaseHeight));

    let width = Math.max(1, Math.floor(safeBaseWidth * scale));
    let height = Math.max(1, Math.floor(safeBaseHeight * scale));
    if (width * height > maxPixels) {
        const correction = Math.sqrt(maxPixels / (width * height));
        scale *= correction;
        width = Math.max(1, Math.floor(safeBaseWidth * scale));
        height = Math.max(1, Math.floor(safeBaseHeight * scale));
    }

    return { width, height, scale };
}

export function validatePdfImageExportPlan({
    pages,
    format,
    maxPagePixels = PDF_IMAGE_EXPORT_MAX_PAGE_PIXELS,
    maxTotalPixels = PDF_IMAGE_EXPORT_MAX_TOTAL_PIXELS,
    maxTotalBytes = PDF_IMAGE_EXPORT_MAX_TOTAL_BYTES
}) {
    if (!Array.isArray(pages) || !pages.length) {
        throw new Error('No PDF pages are available for image export.');
    }

    const normalizedFormat = String(format || '').toLowerCase();
    let totalPixels = 0;
    let estimatedBytes = 0;
    pages.forEach((page, index) => {
        const width = Math.max(0, Math.floor(Number(page?.width) || 0));
        const height = Math.max(0, Math.floor(Number(page?.height) || 0));
        const pixels = width * height;
        if (!pixels) {
            throw new Error(`Page ${index + 1} has invalid dimensions for image export.`);
        }
        if (pixels > maxPagePixels) {
            throw new Error(
                `Page ${index + 1} would exceed the browser-safe ${formatMegapixels(maxPagePixels)} megapixel limit. Reduce the image width.`
            );
        }
        totalPixels += pixels;
        estimatedBytes += estimatePdfImageBytes(pixels, normalizedFormat);
    });

    if (totalPixels > maxTotalPixels) {
        throw new Error(
            `This export would render ${formatMegapixels(totalPixels)} megapixels across ${pages.length} pages, above the browser-safe ${formatMegapixels(maxTotalPixels)} MP limit. Reduce the image width or export fewer pages.`
        );
    }
    if (estimatedBytes > maxTotalBytes) {
        const label = normalizedFormat ? normalizedFormat.toUpperCase() : 'image';
        throw new Error(
            `This ${label} export is estimated at ${formatPdfBytes(estimatedBytes)}, above the browser-safe ${formatPdfBytes(maxTotalBytes)} limit. Reduce the image width or export fewer pages.`
        );
    }

    return { totalPixels, estimatedBytes };
}

function estimatePdfImageBytes(pixels, format) {
    if (format === 'jpg' || format === 'jpeg') return Math.max(1, Math.round(pixels * 3 * 0.16));
    if (format === 'png') return Math.max(1, Math.round(pixels * 3 * 0.45));
    if (format === 'tga') return Math.max(1, Math.round(pixels * 3) + 18);
    return Math.max(1, Math.round(pixels * 3));
}

function formatMegapixels(pixels) {
    const value = pixels / 1_000_000;
    return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function parsePageToken(token, pageCount) {
    if (token === 'last') return pageCount;
    if (!/^[1-9]\d*$/.test(token)) return null;
    return Number.parseInt(token, 10);
}
