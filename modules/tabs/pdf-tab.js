import {
    formatPdfBytes,
    parsePdfPageRange,
    sanitizePdfFilename
} from './pdf-utils.js';

let pdfLibPromise = null;

async function getPDFDocument() {
    if (!pdfLibPromise) {
        pdfLibPromise = import('../../vendor/pdf-lib/pdf-lib.esm.min.js')
            .then((module) => module.PDFDocument);
    }
    return pdfLibPromise;
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

    // Column 2 mirror of the queue: shows each source file in merge order with
    // the pages it contributes. Built from the same state.pdf.files the sidebar
    // queue uses — no extra source of truth. DOM-built (no innerHTML) because
    // file names are user-controlled.
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
                    : `${item.selectedIndices.length} of ${item.pageCount} page${item.pageCount === 1 ? '' : 's'}`;
            info.appendChild(metaEl);

            top.appendChild(info);
            card.appendChild(top);

            if (isReady && item.selectedIndices.length) {
                const pages = document.createElement('div');
                pages.className = 'pdf-preview-pages';
                const MAX_CHIPS = 30;
                item.selectedIndices.slice(0, MAX_CHIPS).forEach((pageIndex) => {
                    const chip = document.createElement('span');
                    chip.className = 'pdf-preview-page';
                    chip.textContent = String(pageIndex + 1);
                    pages.appendChild(chip);
                });
                if (item.selectedIndices.length > MAX_CHIPS) {
                    const more = document.createElement('span');
                    more.className = 'pdf-preview-more';
                    more.textContent = `+${item.selectedIndices.length - MAX_CHIPS}`;
                    pages.appendChild(more);
                }
                card.appendChild(pages);
            }

            list.appendChild(card);
        });
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
                error: ''
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

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
