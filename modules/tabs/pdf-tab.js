import {
    formatPdfBytes,
    parsePdfPageRange,
    sanitizePdfFilename
} from './pdf-utils.js';

let pdfLibPromise = null;
let pdfJsPromise = null;

// How many page thumbnails to rasterize per file. Pages beyond this stay
// controllable via the range box; rendering hundreds of pages would be slow.
const MAX_THUMBS = 60;
// Render width (px) of each thumbnail before it's stored as a data URL.
const THUMB_WIDTH = 104;

async function getPDFDocument() {
    if (!pdfLibPromise) {
        pdfLibPromise = import('../../vendor/pdf-lib/pdf-lib.esm.min.js')
            .then((module) => module.PDFDocument);
    }
    return pdfLibPromise;
}

async function getPdfJs() {
    if (!pdfJsPromise) {
        pdfJsPromise = import('../../vendor/pdfjs/pdf.min.mjs').then((pdfjs) => {
            pdfjs.GlobalWorkerOptions.workerSrc =
                new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
            return pdfjs;
        });
    }
    return pdfJsPromise;
}

export function createPdfTabController({
    state,
    elements,
    showLoader,
    downloadBlob
}) {
    let nextId = 1;

    function getReadyItems() {
        return state.pdf.files.filter((item) => item.status === 'ready');
    }

    function getValidMergeItems() {
        return state.pdf.files.filter((item) => (
            item.status === 'ready'
            && !item.error
            && Array.isArray(item.selectedIndices)
            && item.selectedIndices.length > 0
        ));
    }

    function setStatus(message, tone = 'muted') {
        if (elements.pdf.status) {
            elements.pdf.status.textContent = message;
            elements.pdf.status.dataset.tone = tone;
        }
        if (elements.pdf.footerStatus) {
            elements.pdf.footerStatus.textContent = message;
            elements.pdf.footerStatus.dataset.tone = tone;
        }
    }

    function renderSummary() {
        const totalFiles = state.pdf.files.length;
        const readyFiles = getReadyItems().length;
        const validItems = getValidMergeItems();
        const totalPages = validItems.reduce((sum, item) => sum + item.selectedIndices.length, 0);
        const hasErrors = state.pdf.files.some((item) => item.status === 'error' || item.error);
        const isBusy = state.pdf.files.some((item) => item.status === 'loading') || state.pdf.isMerging;
        const canMerge = totalFiles > 0 && readyFiles === totalFiles && !hasErrors && totalPages > 0 && !isBusy;

        if (elements.pdf.fileCount) {
            elements.pdf.fileCount.textContent = String(totalFiles);
        }
        if (elements.pdf.pageCount) {
            elements.pdf.pageCount.textContent = String(totalPages);
        }
        if (elements.pdf.errorCount) {
            const errorCount = state.pdf.files.filter((item) => item.status === 'error' || item.error).length;
            elements.pdf.errorCount.textContent = String(errorCount);
        }
        if (elements.pdf.mergeBtn) {
            elements.pdf.mergeBtn.disabled = !canMerge;
        }

        if (!totalFiles) {
            setStatus('Add PDF files to build a merge queue.');
        } else if (isBusy && !state.pdf.isMerging) {
            setStatus(`Reading ${readyFiles}/${totalFiles} PDFs...`);
        } else if (hasErrors) {
            setStatus('Fix the highlighted PDF rows before merging.', 'error');
        } else if (totalPages > 0) {
            setStatus(`${totalPages} selected page${totalPages === 1 ? '' : 's'} ready to merge.`, 'ready');
        } else {
            setStatus('Select at least one page to merge.', 'error');
        }
    }

    function renderFileList() {
        const list = elements.pdf.fileList;
        if (!list) return;

        list.innerHTML = '';
        elements.pdf.emptyState?.classList.toggle('hidden', state.pdf.files.length > 0);

        state.pdf.files.forEach((item, index) => {
            list.appendChild(createFileRow(item, index));
        });

        renderSummary();
        renderPreview();
    }

    // Column 2: each source file in merge order as a grid of clickable page
    // thumbnails. Built from the same state.pdf.files the sidebar queue uses —
    // no extra source of truth. DOM-built (no innerHTML) because file names are
    // user-controlled. Thumbnails come from item.thumbs (rendered by pdf.js);
    // until they arrive, cells show a numbered loading placeholder.
    function renderPreview() {
        const list = elements.pdf.previewList;
        if (!list) return;

        const hasFiles = state.pdf.files.length > 0;
        elements.pdf.previewEmpty?.classList.toggle('hidden', hasFiles);
        list.classList.toggle('hidden', !hasFiles);
        list.textContent = '';
        if (!hasFiles) return;

        let order = 0;
        state.pdf.files.forEach((item) => {
            const isReady = item.status === 'ready' && !item.error;
            const isContributing = isReady && item.selectedIndices.length > 0;

            const card = document.createElement('article');
            card.className = 'pdf-preview-card';
            card.dataset.status = item.error ? 'error' : item.status;

            const top = document.createElement('div');
            top.className = 'pdf-preview-card-top';

            const orderEl = document.createElement('span');
            orderEl.className = 'pdf-preview-order';
            orderEl.textContent = isContributing ? String(++order) : '·';
            top.appendChild(orderEl);

            const info = document.createElement('div');
            info.className = 'pdf-preview-card-info';

            const nameEl = document.createElement('span');
            nameEl.className = 'pdf-preview-card-name';
            nameEl.textContent = item.name;
            nameEl.title = item.name;
            info.appendChild(nameEl);

            const metaEl = document.createElement('span');
            metaEl.className = 'pdf-preview-card-meta';
            metaEl.textContent = item.status === 'loading'
                ? 'Reading…'
                : item.error
                    ? item.error
                    : `${item.selectedIndices.length} of ${item.pageCount} page${item.pageCount === 1 ? '' : 's'} selected`;
            info.appendChild(metaEl);

            top.appendChild(info);
            card.appendChild(top);

            if (isReady && item.pageCount > 0) {
                card.appendChild(buildThumbGrid(item));
            }

            list.appendChild(card);
        });
    }

    function buildThumbGrid(item) {
        const selected = new Set(item.selectedIndices);
        const thumbCount = Math.min(item.pageCount, MAX_THUMBS);

        const grid = document.createElement('div');
        grid.className = 'pdf-thumb-grid';

        for (let pageIndex = 0; pageIndex < thumbCount; pageIndex += 1) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'pdf-thumb';
            cell.dataset.id = item.id;
            cell.dataset.page = String(pageIndex);
            const included = selected.has(pageIndex);
            cell.classList.toggle('is-included', included);
            cell.setAttribute('aria-pressed', String(included));
            cell.setAttribute('aria-label', `Page ${pageIndex + 1}${included ? ' (included)' : ''}`);

            const frame = document.createElement('span');
            frame.className = 'pdf-thumb-frame';
            const dataUrl = item.thumbs && item.thumbs[pageIndex];
            if (dataUrl) {
                const img = document.createElement('img');
                img.className = 'pdf-thumb-img';
                img.alt = '';
                img.loading = 'lazy';
                img.src = dataUrl;
                frame.appendChild(img);
            } else {
                frame.classList.add('is-loading');
            }
            cell.appendChild(frame);

            const num = document.createElement('span');
            num.className = 'pdf-thumb-num';
            num.textContent = String(pageIndex + 1);
            cell.appendChild(num);

            const check = document.createElement('span');
            check.className = 'pdf-thumb-check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '✓';
            cell.appendChild(check);

            grid.appendChild(cell);
        }

        if (item.pageCount > MAX_THUMBS) {
            const more = document.createElement('div');
            more.className = 'pdf-thumb-overflow';
            more.textContent = `+${item.pageCount - MAX_THUMBS} more pages — use the range box to include them.`;
            grid.appendChild(more);
        }

        return grid;
    }

    // Rasterize each page to a small data URL via pdf.js, caching on item.thumbs.
    // Non-blocking: pages are patched into existing cells as they finish so the
    // merge stays usable while previews stream in.
    async function renderThumbnails(item) {
        if (item.thumbStatus === 'rendering' || item.thumbStatus === 'done') return;
        item.thumbStatus = 'rendering';

        let doc = null;
        try {
            const pdfjs = await getPdfJs();
            doc = await pdfjs.getDocument({
                data: item.bytes.slice(),
                isEvalSupported: false,
                disableAutoFetch: true,
                disableStream: true
            }).promise;

            const count = Math.min(doc.numPages, MAX_THUMBS);
            if (!Array.isArray(item.thumbs)) {
                item.thumbs = new Array(item.pageCount).fill(null);
            }

            for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
                if (!state.pdf.files.includes(item)) break; // file was removed

                const page = await doc.getPage(pageNumber);
                const base = page.getViewport({ scale: 1 });
                const scale = THUMB_WIDTH / base.width;
                const viewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.ceil(viewport.width));
                canvas.height = Math.max(1, Math.ceil(viewport.height));
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
                item.thumbs[pageNumber - 1] = canvas.toDataURL('image/png');
                page.cleanup();
                patchThumbCell(item, pageNumber - 1);
            }

            item.thumbStatus = 'done';
        } catch (error) {
            console.error('PDF thumbnail render error:', error);
            item.thumbStatus = 'error';
        } finally {
            if (doc) {
                try { await doc.destroy(); } catch { /* ignore */ }
            }
        }
    }

    // Swap a finished thumbnail into its existing cell without rebuilding the grid.
    function patchThumbCell(item, pageIndex) {
        const dataUrl = item.thumbs && item.thumbs[pageIndex];
        if (!dataUrl) return;
        const cell = elements.pdf.previewList?.querySelector(
            `.pdf-thumb[data-id="${item.id}"][data-page="${pageIndex}"]`
        );
        const frame = cell?.querySelector('.pdf-thumb-frame');
        if (!frame || frame.querySelector('img')) return;
        frame.classList.remove('is-loading');
        const img = document.createElement('img');
        img.className = 'pdf-thumb-img';
        img.alt = '';
        img.src = dataUrl;
        frame.appendChild(img);
    }

    // Click a thumbnail -> toggle that page in/out, then re-derive the range text
    // so the sidebar range box stays the single canonical expression of selection.
    function togglePageSelection(item, pageIndex) {
        if (item.status !== 'ready') return;
        const selected = new Set(item.selectedIndices);
        if (selected.has(pageIndex)) {
            selected.delete(pageIndex);
        } else {
            selected.add(pageIndex);
        }
        item.selectedIndices = [...selected].sort((a, b) => a - b);
        item.rangeText = indicesToRangeText(item.selectedIndices, item.pageCount);
        item.error = '';

        const row = elements.pdf.fileList?.querySelector(`.pdf-file-row[data-id="${item.id}"]`);
        if (row) {
            const input = row.querySelector('.pdf-range-input');
            if (input) input.value = item.rangeText;
            updateRowRangeState(row, item);
        } else {
            renderSummary();
            renderPreview();
        }
    }

    function createFileRow(item, index) {
        const row = document.createElement('article');
        row.className = 'pdf-file-row';
        row.dataset.id = item.id;
        row.dataset.status = item.status;

        const rangeDisabled = item.status !== 'ready';
        const pageLabel = item.status === 'ready'
            ? `${item.pageCount} page${item.pageCount === 1 ? '' : 's'}`
            : item.status === 'loading'
                ? 'Reading...'
                : 'Unreadable';
        const selectedLabel = item.status === 'ready' && !item.error
            ? `${item.selectedIndices.length} selected`
            : item.error || pageLabel;

        row.innerHTML = `
            <div class="pdf-row-index">${index + 1}</div>
            <div class="pdf-row-main">
                <div class="pdf-row-title">
                    <span class="pdf-row-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                    <span class="pdf-row-pill">${escapeHtml(pageLabel)}</span>
                </div>
                <div class="pdf-row-meta">
                    <span>${escapeHtml(formatPdfBytes(item.size))}</span>
                    <span>${escapeHtml(selectedLabel)}</span>
                </div>
                <label class="pdf-range-field">
                    <span>Pages</span>
                    <input type="text" class="pdf-range-input" value="${escapeHtml(item.rangeText)}" ${rangeDisabled ? 'disabled' : ''} aria-label="Page range for ${escapeHtml(item.name)}">
                </label>
                <div class="pdf-row-error ${item.error ? '' : 'hidden'}">${escapeHtml(item.error)}</div>
            </div>
            <div class="pdf-row-actions" aria-label="PDF row actions">
                <button type="button" class="pdf-icon-btn" data-action="move-up" title="Move up" ${index === 0 ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
                </button>
                <button type="button" class="pdf-icon-btn" data-action="move-down" title="Move down" ${index === state.pdf.files.length - 1 ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
                </button>
                <button type="button" class="pdf-icon-btn pdf-icon-btn-danger" data-action="remove" title="Remove PDF">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>
                </button>
            </div>
        `;

        return row;
    }

    function updateItemRange(item) {
        if (item.status !== 'ready') return;
        const parsed = parsePdfPageRange(item.rangeText, item.pageCount);
        item.selectedIndices = parsed.indices;
        item.error = parsed.ok ? '' : parsed.error;
    }

    function updateRowRangeState(row, item) {
        const selectedLabel = item.error
            ? item.error
            : `${item.selectedIndices.length} selected`;
        const metaItems = row.querySelectorAll('.pdf-row-meta span');
        const errorEl = row.querySelector('.pdf-row-error');

        if (metaItems[1]) {
            metaItems[1].textContent = selectedLabel;
        }
        if (errorEl) {
            errorEl.textContent = item.error;
            errorEl.classList.toggle('hidden', !item.error);
        }
        row.dataset.status = item.error ? 'error' : item.status;
        renderSummary();
        renderPreview();
    }

    async function addPdfFiles(fileList) {
        const files = Array.from(fileList || []).filter(isPdfFile);
        if (!files.length) {
            setStatus('Choose one or more PDF files.', 'error');
            return;
        }

        const createdItems = files.map((file) => {
            const item = {
                id: `pdf-${Date.now()}-${nextId++}`,
                file,
                name: file.name || 'document.pdf',
                size: file.size || 0,
                bytes: null,
                pageCount: 0,
                rangeText: 'all',
                selectedIndices: [],
                status: 'loading',
                error: '',
                thumbs: null,
                thumbStatus: 'idle'
            };
            state.pdf.files.push(item);
            return item;
        });

        renderFileList();
        await Promise.all(createdItems.map(loadPdfItem));
        renderFileList();
    }

    async function loadPdfItem(item) {
        try {
            const PDFDocument = await getPDFDocument();
            const buffer = await item.file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const pdfDoc = await PDFDocument.load(bytes);
            const pageCount = pdfDoc.getPageCount();

            item.bytes = bytes;
            item.pageCount = pageCount;
            item.status = 'ready';
            item.error = '';
            updateItemRange(item);
            // Fire-and-forget: stream page thumbnails in without blocking merge.
            renderThumbnails(item);
        } catch (error) {
            console.error('PDF read error:', error);
            item.bytes = null;
            item.pageCount = 0;
            item.selectedIndices = [];
            item.status = 'error';
            item.error = 'Could not read this PDF. It may be encrypted or damaged.';
        }
    }

    async function mergePdfs() {
        const items = getValidMergeItems();
        if (!items.length || elements.pdf.mergeBtn?.disabled) return;

        state.pdf.isMerging = true;
        let finalStatus = null;
        renderSummary();
        showLoader(true, {
            title: 'Merging PDFs...',
            subtitle: 'Preparing output document',
            progress: 0.05
        });

        try {
            const PDFDocument = await getPDFDocument();
            const mergedDoc = await PDFDocument.create();
            const totalGroups = items.length;

            for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                showLoader(true, {
                    title: 'Merging PDFs...',
                    subtitle: `${item.name} (${item.selectedIndices.length} pages)`,
                    progress: 0.08 + (index / Math.max(totalGroups, 1)) * 0.82
                });

                const sourceDoc = await PDFDocument.load(item.bytes);
                const copiedPages = await mergedDoc.copyPages(sourceDoc, item.selectedIndices);
                copiedPages.forEach((page) => mergedDoc.addPage(page));
            }

            mergedDoc.setProducer('Genesis Image Tools');
            mergedDoc.setCreator('Genesis Image Tools PDF Merge');
            mergedDoc.setModificationDate(new Date());

            showLoader(true, {
                title: 'Merging PDFs...',
                subtitle: 'Saving merged PDF',
                progress: 0.94
            });

            const mergedBytes = await mergedDoc.save();
            const filename = sanitizePdfFilename(state.pdf.outputName);
            const blob = new Blob([mergedBytes], { type: 'application/pdf' });
            downloadBlob(blob, filename);

            state.pdf.lastMergedPageCount = mergedDoc.getPageCount();
            finalStatus = {
                message: `Downloaded ${filename} with ${state.pdf.lastMergedPageCount} pages.`,
                tone: 'ready'
            };
        } catch (error) {
            console.error('PDF merge error:', error);
            finalStatus = {
                message: error?.message || 'Failed to merge PDFs.',
                tone: 'error'
            };
        } finally {
            state.pdf.isMerging = false;
            showLoader(false);
            renderSummary();
            if (finalStatus) {
                setStatus(finalStatus.message, finalStatus.tone);
            }
        }
    }

    function bindEvents() {
        elements.pdf.addBtn?.addEventListener('click', () => elements.pdf.fileInput?.click());
        elements.pdf.dropzone?.addEventListener('click', () => elements.pdf.fileInput?.click());
        elements.pdf.dropzone?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                elements.pdf.fileInput?.click();
            }
        });

        elements.pdf.fileInput?.addEventListener('change', async (event) => {
            await addPdfFiles(event.target.files);
            event.target.value = '';
        });

        elements.pdf.dropzone?.addEventListener('dragover', (event) => {
            event.preventDefault();
            elements.pdf.dropzone.classList.add('drag-over');
        });

        elements.pdf.dropzone?.addEventListener('dragleave', () => {
            elements.pdf.dropzone.classList.remove('drag-over');
        });

        elements.pdf.dropzone?.addEventListener('drop', async (event) => {
            event.preventDefault();
            elements.pdf.dropzone.classList.remove('drag-over');
            await addPdfFiles(event.dataTransfer?.files);
        });

        elements.pdf.fileList?.addEventListener('input', (event) => {
            const input = event.target.closest('.pdf-range-input');
            if (!input) return;
            const row = input.closest('.pdf-file-row');
            const item = state.pdf.files.find((candidate) => candidate.id === row?.dataset.id);
            if (!item) return;

            item.rangeText = input.value;
            updateItemRange(item);
            updateRowRangeState(row, item);
        });

        elements.pdf.fileList?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            const row = button?.closest('.pdf-file-row');
            const index = state.pdf.files.findIndex((item) => item.id === row?.dataset.id);
            if (!button || index < 0) return;

            const action = button.dataset.action;
            if (action === 'remove') {
                state.pdf.files.splice(index, 1);
            } else if (action === 'move-up' && index > 0) {
                const [item] = state.pdf.files.splice(index, 1);
                state.pdf.files.splice(index - 1, 0, item);
            } else if (action === 'move-down' && index < state.pdf.files.length - 1) {
                const [item] = state.pdf.files.splice(index, 1);
                state.pdf.files.splice(index + 1, 0, item);
            }

            renderFileList();
        });

        elements.pdf.previewList?.addEventListener('click', (event) => {
            const cell = event.target.closest('.pdf-thumb');
            if (!cell) return;
            const item = state.pdf.files.find((candidate) => candidate.id === cell.dataset.id);
            const pageIndex = Number.parseInt(cell.dataset.page, 10);
            if (!item || Number.isNaN(pageIndex)) return;
            togglePageSelection(item, pageIndex);
        });

        elements.pdf.outputName?.addEventListener('input', () => {
            state.pdf.outputName = elements.pdf.outputName.value;
        });

        elements.pdf.mergeBtn?.addEventListener('click', mergePdfs);
    }

    function onTabActivated() {
        renderFileList();
    }

    return {
        bindEvents,
        onTabActivated,
        addPdfFiles
    };
}

function isPdfFile(file) {
    if (!file) return false;
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

// Compress sorted 0-based page indices into the compact range syntax that
// parsePdfPageRange understands ("all", "1-3,5"). Keeps the sidebar range box
// and the click-to-select grid as two views of the same selection.
function indicesToRangeText(indices, pageCount) {
    if (!indices.length) return '';
    if (indices.length === pageCount) return 'all';

    const sorted = [...indices].sort((a, b) => a - b);
    const parts = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let k = 1; k < sorted.length; k += 1) {
        if (sorted[k] === prev + 1) {
            prev = sorted[k];
            continue;
        }
        parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
        start = sorted[k];
        prev = sorted[k];
    }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    return parts.join(',');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
