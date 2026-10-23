import { compressPdf } from './pdf-compression.js?v=r-d45f015f257fd23c';
import { sanitizePdfFilename } from './pdf-utils.js?v=r-d45f015f257fd23c';

const MODES = new Set(['optimize', 'simplify', 'rasterize']);
const PRESETS = new Set(['high', 'balanced', 'small']);
const MAX_INPUT_BYTES = 100_000_000;

function formatCompressionBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(2)} KB`;
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function setMeasuredBytes(element, bytes) {
    if (!element) return;
    element.textContent = formatCompressionBytes(bytes);
    element.title = `${bytes.toLocaleString('en-US')} bytes (decimal units)`;
}

/** One local job at a time; no document bytes are stored in shared app state. */
export function createPdfCompressionController({ state, elements, downloadBlob, compress = compressPdf }) {
    const ui = elements?.pdf || {};
    const listeners = [];
    const downloadUrls = new Map();
    let disposed = false;
    let bound = false;
    let generation = 0;
    let activeJob = null;
    let resultBlob = null;

    state.pdf ||= {};
    state.pdf.compression ||= {
        file: null, mode: 'optimize', preset: 'balanced', acknowledged: false,
        status: 'idle', progress: 0, message: '', result: null
    };
    const model = state.pdf.compression;

    function listen(target, event, callback) {
        if (!target?.addEventListener) return;
        target.addEventListener(event, callback);
        listeners.push([target, event, callback]);
    }

    function invalidate() {
        generation += 1;
        activeJob?.abort.abort();
        resultBlob = null;
        model.result = null;
        model.progress = 0;
    }

    function setFiles(fileList) {
        if (disposed) return;
        invalidate();
        model.file = null;
        const files = Array.from(fileList || []);
        const file = files[0];
        if (files.length !== 1 || !(file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || ''))) {
            model.status = 'error';
            model.message = 'Choose one PDF file at a time.';
        } else if (!file.size || file.size > MAX_INPUT_BYTES) {
            model.status = 'error';
            model.message = `Choose a non-empty PDF up to ${formatCompressionBytes(MAX_INPUT_BYTES)}. Large documents can exceed browser memory.`;
        } else {
            model.file = file;
            model.status = 'ready';
            model.message = activeJob
                ? 'Replacement selected. Stopping the previous job before another can start…'
                : 'Ready. Your original file will not be changed or uploaded.';
        }
        render();
    }

    function changeOption(key, value) {
        const accepted = key === 'mode' ? MODES : PRESETS;
        if (!accepted.has(value) || model[key] === value || disposed) return;
        invalidate();
        model[key] = value;
        if (key === 'mode') model.acknowledged = false;
        model.status = model.file ? 'ready' : 'idle';
        model.message = activeJob ? 'Stopping the previous job. The new settings will apply to the next copy.' : '';
        render();
    }

    function render() {
        const working = Boolean(activeJob);
        const requiresAcknowledgement = model.mode !== 'optimize';
        const ready = Boolean(model.file) && (!requiresAcknowledgement || model.acknowledged);
        if (ui.compressPanel) ui.compressPanel.setAttribute('aria-busy', String(working));
        if (ui.compressFileInput) ui.compressFileInput.multiple = false;
        if (ui.compressFilename) ui.compressFilename.textContent = model.file?.name || 'No PDF selected';
        if (model.file) setMeasuredBytes(ui.compressSourceSize, model.file.size);
        else if (ui.compressSourceSize) { ui.compressSourceSize.textContent = '—'; ui.compressSourceSize.removeAttribute('title'); }
        if (ui.compressMode) ui.compressMode.value = model.mode;
        if (ui.compressPreset) ui.compressPreset.value = model.preset;
        if (ui.compressOptionsSummary) {
            const modes = { optimize: 'Standard', simplify: 'View-only', rasterize: 'Image-only' };
            const presets = { high: 'High quality', balanced: 'Balanced', small: 'Smaller file' };
            ui.compressOptionsSummary.textContent = `Optional settings · ${modes[model.mode]} · ${presets[model.preset]}`;
        }
        if (ui.compressAcknowledgeRow) ui.compressAcknowledgeRow.hidden = !requiresAcknowledgement;
        if (ui.compressAcknowledge) ui.compressAcknowledge.checked = Boolean(model.acknowledged);
        if (ui.compressLossNotice) {
            ui.compressLossNotice.textContent = model.mode === 'rasterize'
                ? 'Every page becomes a JPEG image. Text search, text selection, links, accessibility tags, forms, bookmarks, and editable annotations are lost. Small text and photos may lose detail. This is not secure redaction.'
                : model.mode === 'simplify'
                    ? 'Creates a view-only copy: supported visible forms and annotations are flattened; links, editable forms, comments, bookmarks, attachments, and document metadata are removed. Unsupported visible features stop the export. Text may remain searchable. This is not secure redaction.'
                    : 'Keeps existing text and links where supported, and optimizes supported images. Not every PDF can become smaller. Review the copy before sharing; this is not secure redaction.';
        }
        if (ui.compressStartBtn) {
            ui.compressStartBtn.disabled = !ready || working || disposed;
            ui.compressStartBtn.textContent = working ? 'Working…' : 'Create copy';
        }
        if (ui.compressCancelBtn) {
            ui.compressCancelBtn.hidden = !working;
            ui.compressCancelBtn.disabled = !working || activeJob.abort.signal.aborted;
        }
        if (ui.compressClearBtn) ui.compressClearBtn.disabled = !model.file && !working;
        if (ui.compressProgress) {
            ui.compressProgress.hidden = !working;
            ui.compressProgress.value = model.progress;
        }
        if (ui.compressStatus) {
            ui.compressStatus.textContent = model.message || (model.file
                ? 'Ready. Your original file will not be changed or uploaded.'
                : 'Choose one PDF. Processing stays on this device; no account is needed.');
            ui.compressStatus.dataset.tone = model.status === 'error' ? 'error' : model.status === 'done' ? 'ready' : 'muted';
        }
        const hasResult = Boolean(model.result && resultBlob);
        if (ui.compressResult) ui.compressResult.hidden = !hasResult;
        if (ui.compressDownloadBtn) ui.compressDownloadBtn.disabled = !hasResult || working;
        if (ui.compressOriginalBtn) ui.compressOriginalBtn.disabled = !model.file;
        if (!hasResult) return;
        const { originalBytes, outputBytes, pageCount, warnings } = model.result;
        const percent = ((originalBytes - outputBytes) / originalBytes) * 100;
        setMeasuredBytes(ui.compressResultSize, outputBytes);
        if (ui.compressReduction) ui.compressReduction.textContent = percent > 0
            ? `${percent.toFixed(1)}% smaller`
            : percent < 0 ? `${Math.abs(percent).toFixed(1)}% larger — no size saving` : 'Same size — no size saving';
        if (ui.compressPageCount) ui.compressPageCount.textContent = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
        if (ui.compressResultNotice) ui.compressResultNotice.textContent = percent > 0
            ? 'Check every page, especially small text, Korean characters, and photos, before sharing this copy.'
            : 'This copy is not smaller. Keep the original, or choose another mode or quality preset. Simplifying a PDF does not guarantee a smaller file.';
        if (ui.compressWarnings) {
            ui.compressWarnings.replaceChildren(...warnings.map((warning) => {
                const li = document.createElement('li');
                li.textContent = warning;
                return li;
            }));
            ui.compressWarnings.hidden = !warnings.length;
        }
    }

    async function start() {
        if (disposed || activeJob || !model.file || (model.mode !== 'optimize' && !model.acknowledged)) return;
        invalidate();
        const owner = generation;
        const file = model.file;
        const mode = model.mode;
        const preset = model.preset;
        const job = { abort: new AbortController() };
        activeJob = job;
        model.status = 'working';
        model.message = 'Reading PDF on this device…';
        render();
        const isCurrent = () => !disposed && owner === generation && !job.abort.signal.aborted;
        try {
            let bytes = new Uint8Array(await file.arrayBuffer());
            if (!isCurrent()) return;
            const result = await compress({ bytes, mode, preset, signal: job.abort.signal, onProgress(event) {
                if (!isCurrent()) return;
                const raw = typeof event === 'number' ? event : event?.progress;
                if (Number.isFinite(raw)) model.progress = Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
                model.message = typeof event?.message === 'string' ? event.message : `Creating copy… ${Math.round(model.progress)}%`;
                render();
            } });
            bytes = null;
            if (!isCurrent()) return;
            if (!(result?.bytes instanceof Uint8Array) || !result.bytes.byteLength || !Number.isInteger(result.pageCount) || result.pageCount < 1) {
                throw new Error('The PDF engine did not return a valid copy. Your original is unchanged.');
            }
            resultBlob = new Blob([result.bytes], { type: 'application/pdf' });
            model.result = {
                originalBytes: file.size, outputBytes: resultBlob.size, pageCount: result.pageCount,
                mode, preset, warnings: (Array.isArray(result.warnings) ? result.warnings : []).filter((item) => typeof item === 'string')
            };
            model.status = 'done';
            model.progress = 100;
            model.message = 'Copy ready. Nothing is downloaded until you choose a download button.';
        } catch (error) {
            if (!isCurrent()) return;
            model.status = 'error';
            model.message = error?.name === 'AbortError' ? 'Compression stopped. Your original file is unchanged.'
                : String(error?.message || 'This PDF could not be processed. Your original file is unchanged.');
        } finally {
            if (activeJob === job) activeJob = null;
            if (!disposed) {
                if (owner !== generation && model.status === 'ready') model.message = 'Ready. Your original file will not be changed or uploaded.';
                render();
            }
        }
    }

    function cancel() {
        if (!activeJob || disposed) return;
        invalidate();
        model.status = model.file ? 'ready' : 'idle';
        model.message = 'Stopping compression… Your original file is unchanged.';
        render();
    }

    function save(blob, name) {
        if (!blob || disposed) return;
        if (typeof downloadBlob === 'function') return downloadBlob(blob, name);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        downloadUrls.set(url, setTimeout(() => {
            URL.revokeObjectURL(url);
            downloadUrls.delete(url);
        }, 1000));
    }

    function bindEvents() {
        if (bound || disposed) return;
        bound = true;
        listen(ui.compressFileInput, 'change', () => {
            setFiles(ui.compressFileInput.files);
            ui.compressFileInput.value = '';
        });
        listen(ui.compressDropzone, 'click', () => ui.compressFileInput?.click());
        listen(ui.compressDropzone, 'keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                ui.compressFileInput?.click();
            }
        });
        listen(ui.compressDropzone, 'dragover', (event) => event.preventDefault());
        listen(ui.compressDropzone, 'drop', (event) => { event.preventDefault(); setFiles(event.dataTransfer?.files); });
        listen(ui.compressMode, 'change', () => changeOption('mode', ui.compressMode.value));
        listen(ui.compressPreset, 'change', () => changeOption('preset', ui.compressPreset.value));
        listen(ui.compressAcknowledge, 'change', () => { model.acknowledged = ui.compressAcknowledge.checked; render(); });
        listen(ui.compressStartBtn, 'click', start);
        listen(ui.compressCancelBtn, 'click', cancel);
        listen(ui.compressClearBtn, 'click', () => {
            invalidate(); model.file = null; model.status = 'idle'; model.message = ''; render();
        });
        listen(ui.compressDownloadBtn, 'click', () => {
            if (!resultBlob || !model.result || activeJob) return;
            const base = (model.file?.name || 'document.pdf').replace(/\.pdf$/i, '');
            save(resultBlob, sanitizePdfFilename(`${base}-${model.result.mode}-${model.result.preset}.pdf`));
        });
        listen(ui.compressOriginalBtn, 'click', () => save(model.file, sanitizePdfFilename(model.file?.name || 'original.pdf')));
        render();
    }

    return {
        bindEvents, render, setFiles, start, cancel,
        dispose() {
            if (disposed) return;
            disposed = true;
            invalidate();
            model.file = null;
            for (const [target, event, callback] of listeners) target.removeEventListener(event, callback);
            listeners.length = 0;
            for (const [url, timer] of downloadUrls) { clearTimeout(timer); URL.revokeObjectURL(url); }
            downloadUrls.clear();
        }
    };
}
