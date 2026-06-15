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

function parsePageToken(token, pageCount) {
    if (token === 'last') return pageCount;
    if (!/^[1-9]\d*$/.test(token)) return null;
    return Number.parseInt(token, 10);
}
