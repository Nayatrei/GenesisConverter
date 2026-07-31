import { createBulkTabController } from './modules/tabs/bulk-tab.js';
import { createRasterTabController } from './modules/tabs/raster-tab.js';
import { createSvgTabController } from './modules/tabs/svg-tab.js?v=20260730a';
import { createLogoTabController } from './modules/tabs/logo-tab.js?v=20260730a';
import { createPdfTabController } from './modules/tabs/pdf-tab.js?v=20260725p';
import {
    getDataUrlSize,
    getImageFormat,
    IMPORTABLE_IMAGE_PROMPT,
    isImportableImageFile,
    normalizeImageBlob
} from './modules/raster-utils.js';
import { createElements } from './modules/app-elements.js?v=20260730a';
import { createState } from './modules/app-state.js?v=20260730a';
import { applyTabCase, TAB_CASES } from './modules/tab-cases.js?v=20260725a';
import { bindMagnetPocketControls } from './modules/shared/magnet-pocket-controls.js?v=20260730a';

async function loadTabPartials() {
    const tabs = ['svg', 'logo', 'raster', 'bulk', 'pdf'];
    await Promise.all(tabs.map(async (name) => {
        const res = await fetch(`modules/tabs/html/tab-${name}.html?v=20260726a`);
        const html = await res.text();
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const panel = tmp.querySelector(`#tab-${name}`);
        const footer = tmp.querySelector('footer');
        const panelSlot = document.getElementById(`tab-${name}-slot`);
        const footerSlot = document.getElementById(`footer-${name}-slot`);
        if (panel && panelSlot) panelSlot.outerHTML = panel.outerHTML;
        if (footer && footerSlot) footerSlot.outerHTML = footer.outerHTML;
    }));

    const brandRes = await fetch('modules/partials/footer-brand.html');
    const brandHtml = await brandRes.text();
    const brandSlot = document.getElementById('footer-brand-slot');
    if (brandSlot) brandSlot.outerHTML = brandHtml;
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadTabPartials();

    const elements = createElements();
    const state = createState();

    function showLoader(show, options = {}) {
        if (show) {
            const {
                title = 'Processing Image...',
                subtitle = '',
                progress = null
            } = options;

            if (elements.loaderTitle) {
                elements.loaderTitle.textContent = title;
            }

            if (elements.loaderSubtitle) {
                elements.loaderSubtitle.textContent = subtitle;
                elements.loaderSubtitle.classList.toggle('hidden', !subtitle);
            }

            if (elements.loaderProgressShell && elements.loaderProgressBar && elements.loaderProgressMeta) {
                const hasProgress = typeof progress === 'number' && !Number.isNaN(progress);
                const normalizedProgress = hasProgress
                    ? Math.max(0, Math.min(1, progress))
                    : 0;

                elements.loaderProgressShell.classList.toggle('hidden', !hasProgress);
                elements.loaderProgressBar.style.width = `${normalizedProgress * 100}%`;
                elements.loaderProgressMeta.textContent = `${Math.round(normalizedProgress * 100)}%`;
            }
        } else {
            if (elements.loaderTitle) {
                elements.loaderTitle.textContent = 'Processing Image...';
            }
            if (elements.loaderSubtitle) {
                elements.loaderSubtitle.textContent = '';
                elements.loaderSubtitle.classList.add('hidden');
            }
            if (elements.loaderProgressShell) {
                elements.loaderProgressShell.classList.add('hidden');
            }
            if (elements.loaderProgressBar) {
                elements.loaderProgressBar.style.width = '0%';
            }
            if (elements.loaderProgressMeta) {
                elements.loaderProgressMeta.textContent = '0%';
            }
        }

        elements.loaderOverlay.style.display = show ? 'flex' : 'none';
    }

    function readBlobAsDataUrl(blob, { onProgress } = {}) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onprogress = (event) => {
                if (event.lengthComputable) {
                    onProgress?.(event.loaded / event.total);
                }
            };
            reader.onload = (event) => {
                onProgress?.(1);
                resolve(event.target?.result);
            };
            reader.onerror = () => reject(new Error('Failed to read image data.'));
            reader.readAsDataURL(blob);
        });
    }

    async function fetchImageBlobWithProgress(url, onProgress) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image (${response.status}).`);
        }

        const contentType = response.headers.get('content-type') || undefined;
        const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);

        if (!response.body || !Number.isFinite(contentLength) || contentLength <= 0) {
            const blob = await response.blob();
            onProgress?.(1);
            return blob;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let loaded = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            chunks.push(value);
            loaded += value.byteLength;
            onProgress?.(loaded / contentLength);
        }

        onProgress?.(1);
        return new Blob(chunks, { type: contentType });
    }

    function getImportDisplayName(source) {
        if (!source) return 'image';
        if (source.startsWith('data:')) return 'pasted image';

        try {
            const parsed = new URL(source);
            const pathname = parsed.pathname.split('/').filter(Boolean).pop();
            return pathname || parsed.hostname || 'remote image';
        } catch {
            const fallback = source.split('?')[0].split('#')[0];
            return fallback.split('/').filter(Boolean).pop() || 'remote image';
        }
    }

    function validateImageSource(src) {
        return new Promise((resolve, reject) => {
            const probe = new Image();
            probe.onload = () => resolve();
            probe.onerror = () => reject(new Error(`This image format could not be opened here. Supported imports include ${IMPORTABLE_IMAGE_PROMPT}.`));
            probe.src = src;
        });
    }

    function hasSingleImageLoaded() {
        return Boolean(elements.sourceImage?.getAttribute('src'));
    }

    // The active tab's case (modules/tab-cases.js) owns which original-image
    // panel mode shows in column 2 — applied via applyCurrentTabCase below.
    // This only reveals the workspace shell (welcome -> main/output).
    function syncWorkspaceView() {
        if (elements.welcomeScreen) {
            elements.welcomeScreen.style.display = 'none';
        }
        if (elements.mainContent) {
            elements.mainContent.classList.remove('hidden');
        }
        if (elements.outputSection) {
            elements.outputSection.style.display = 'flex';
        }
    }

    // Drive column 1 (sidebar) and column 2 (workspace) for the active tab from
    // a single declarative source. Replaces the old per-element toggle pile.
    function applyCurrentTabCase() {
        return applyTabCase(state.activeTab, {
            importablePrompt: IMPORTABLE_IMAGE_PROMPT,
            svgIsDirty: state.isDirty,
            logoIsDirty: state.logo?.isDirty
        });
    }

    function updateSegmentedControlIndicator() {
        const activeTab = document.querySelector('.segmented-control-tab.active');
        const indicator = document.querySelector('.segmented-control-indicator');
        if (!activeTab || !indicator) return;

        const tabRect = activeTab.getBoundingClientRect();
        const containerRect = activeTab.parentElement.getBoundingClientRect();
        const offsetLeft = tabRect.left - containerRect.left - 6;

        indicator.style.width = `${tabRect.width}px`;
        indicator.style.transform = `translateX(${offsetLeft}px)`;
    }

    function getImageBaseName() {
        const name = (state.originalImageUrl || 'image').split(/[\\/]/).pop() || 'image';
        return name.replace(/\.[^/.]+$/, '') || 'image';
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function downloadSVG(svgContent, baseName) {
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName || 'converted'}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    const rasterTab = createRasterTabController({
        state,
        elements,
        downloadBlob,
        getImageBaseName,
        hasSingleImageLoaded
    });

    const bulkTab = createBulkTabController({
        state,
        elements,
        showLoader,
        syncWorkspaceView,
        downloadBlob
    });

    let svgTab = null;
    let logoTab = null;
    bindMagnetPocketControls({
        state,
        controls: elements.shared3d,
        onChange: () => {
            if (state.activeTab === 'logo') {
                logoTab?.updateFilteredPreview();
            } else if (state.activeTab === 'svg') {
                svgTab?.updateFilteredPreview();
            }
        }
    });

    svgTab = createSvgTabController({
        state,
        sharedElements: {
            sourceImage: elements.sourceImage,
            outputSection: elements.outputSection,
            statusText: elements.statusText,
            resolutionNotice: elements.resolutionNotice
        },
        sidebarControls: elements.svg.sidebar,
        previewElements: elements.svg.preview,
        paletteElements: elements.svg.palette,
        modelControls: elements.shared3d,
        viewControls: elements.svg.preview3d,
        exportElements: elements.svg.export,
        showLoader,
        syncWorkspaceView,
        hasSingleImageLoaded,
        updateSegmentedControlIndicator,
        downloadBlob,
        downloadSVG,
        getImageBaseName,
        onRasterImageLoaded: rasterTab.onSourceImageLoaded,
        onRasterExportStateChanged: rasterTab.updateExportScaleDisplay
    });

    logoTab = createLogoTabController({
        state,
        ls: state.logo,
        sharedElements: {
            sourceImage: elements.sourceImage,
            outputSection: elements.outputSection,
            statusText: elements.statusText,
            resolutionNotice: elements.resolutionNotice
        },
        sidebarControls: elements.logo.sidebar,
        previewElements: elements.logo.preview,
        paletteElements: elements.logo.palette,
        modelControls: elements.shared3d,
        viewControls: elements.logo.preview3d,
        exportElements: elements.logo.export,
        htmlElements: elements.logo.html,
        showLoader,
        syncWorkspaceView,
        hasSingleImageLoaded,
        updateSegmentedControlIndicator,
        downloadBlob,
        downloadSVG,
        getImageBaseName,
        onRasterImageLoaded: rasterTab.onSourceImageLoaded,
        onRasterExportStateChanged: rasterTab.updateExportScaleDisplay
    });

    const pdfTab = createPdfTabController({
        state,
        elements,
        showLoader,
        downloadBlob
    });

    function switchExportTab(target) {
        state.activeTab = target;

        // One declarative call drives BOTH columns for this tab: sidebar
        // sections (column 1) plus the tab button, export panel, footer, and
        // original-image panel (column 2), the accent color, and the case strip.
        applyCurrentTabCase();
        syncWorkspaceView();
        updateSegmentedControlIndicator();

        if (target === 'svg' && hasSingleImageLoaded()) {
            svgTab.onTabActivated();
        } else if (target === 'logo') {
            logoTab.onTabActivated();
        } else if (target === 'raster' && hasSingleImageLoaded()) {
            rasterTab.onTabActivated();
        } else if (target === 'pdf') {
            pdfTab.onTabActivated();
        } else {
            bulkTab.onTabActivated();
        }
    }

    function loadImage(src, name) {
        state.originalImageUrl = name;

        if (!state.originalImageFormat) {
            state.originalImageFormat = getImageFormat(name, src);
        }
        if (!state.originalImageSize) {
            state.originalImageSize = getDataUrlSize(src);
        }

        elements.sourceImage.src = src;
        if (elements.logo?.preview?.svgSourceMirror) elements.logo.preview.svgSourceMirror.src = src;
    }

    function resetImageInfo() {
        state.originalImageFormat = null;
        state.originalImageSize = null;
    }

    async function handleImportedFile(file) {
        if (!isImportableImageFile(file)) {
            elements.statusText.textContent = `Unsupported file. Import supports ${IMPORTABLE_IMAGE_PROMPT}.`;
            return;
        }

        resetImageInfo();
        state.originalImageFormat = getImageFormat(file.name, null);
        state.originalImageSize = file.size;

        try {
            const updateImportProgress = (progress, subtitle) => {
                showLoader(true, {
                    title: 'Loading Image...',
                    subtitle,
                    progress
                });
            };

            updateImportProgress(0.05, `Preparing ${file.name}`);
            const normalizedFile = normalizeImageBlob(file, file.name);
            updateImportProgress(0.15, `Reading ${file.name}`);
            const dataUrl = await readBlobAsDataUrl(normalizedFile, {
                onProgress: (progress) => {
                    updateImportProgress(0.15 + (progress * 0.6), `Reading ${file.name}`);
                }
            });
            updateImportProgress(0.82, `Validating ${file.name}`);
            await validateImageSource(dataUrl);
            updateImportProgress(0.96, `Rendering ${file.name}`);
            loadImage(dataUrl, file.name);
            elements.statusText.textContent = `${file.name} loaded.`;
        } catch (error) {
            console.error('Local image load error:', error);
            elements.statusText.textContent = error.message || `Failed to load image. Supported imports include ${IMPORTABLE_IMAGE_PROMPT}.`;
            showLoader(false);
        }
    }

    async function loadImageFromUrl(url) {
        resetImageInfo();

        const displayName = getImportDisplayName(url);
        const updateImportProgress = (progress, subtitle) => {
            showLoader(true, {
                title: 'Loading Image...',
                subtitle,
                progress
            });
        };

        updateImportProgress(0.05, url.startsWith('data:') ? 'Preparing pasted image' : `Fetching ${displayName}`);
        elements.statusText.textContent = 'Fetching image...';
        try {
            let dataUrl;
            if (url.startsWith('data:')) {
                dataUrl = url;
                updateImportProgress(0.75, 'Reading pasted image');
            } else {
                const blob = normalizeImageBlob(
                    await fetchImageBlobWithProgress(url, (progress) => {
                        updateImportProgress(0.1 + (progress * 0.6), `Fetching ${displayName}`);
                    }),
                    displayName
                );
                updateImportProgress(0.78, `Reading ${displayName}`);
                dataUrl = await readBlobAsDataUrl(blob, {
                    onProgress: (progress) => {
                        updateImportProgress(0.78 + (progress * 0.14), `Reading ${displayName}`);
                    }
                });
            }
            updateImportProgress(0.94, `Validating ${displayName}`);
            await validateImageSource(dataUrl);
            updateImportProgress(0.98, `Rendering ${displayName}`);
            loadImage(dataUrl, displayName);
            elements.statusText.textContent = `${displayName} loaded.`;
        } catch (error) {
            console.error('URL load error:', error);
            elements.statusText.textContent = error.message || `Failed to load image from URL. Supported imports include ${IMPORTABLE_IMAGE_PROMPT}.`;
            showLoader(false);
        }
    }

    function setupWorkspaceDragAndDrop() {
        if (!elements.workspace) return;

        const clearDragState = () => elements.workspace.classList.remove('drag-over');

        elements.workspace.addEventListener('dragover', (event) => {
            event.preventDefault();
            elements.workspace.classList.add('drag-over');
        });

        elements.workspace.addEventListener('dragleave', clearDragState);

        elements.workspace.addEventListener('drop', (event) => {
            event.preventDefault();
            clearDragState();

            const dt = event.dataTransfer;
            if (dt?.files?.length) {
                const file = Array.from(dt.files).find(isImportableImageFile);
                if (file) {
                    handleImportedFile(file);
                    return;
                }

                elements.statusText.textContent = `Dragged file is not a compatible image. Supported imports include ${IMPORTABLE_IMAGE_PROMPT}.`;
                return;
            }

            const url = dt?.getData('text/uri-list') || dt?.getData('text/plain');
            if (url) {
                loadImageFromUrl(url.trim());
            }
        });
    }

    function bindAppEvents() {
        if (elements.importBtn) {
            elements.importBtn.addEventListener('click', () => {
                if (state.activeTab === 'bulk') {
                    elements.bulkFolderInput?.click();
                    return;
                }
                elements.fileInput?.click();
            });
        }

        if (elements.fileInput) {
            elements.fileInput.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (file) {
                    handleImportedFile(file);
                }
                event.target.value = '';
            });
        }

        if (elements.welcomeScreen && elements.fileInput) {
            const openImportPicker = () => elements.fileInput.click();
            const isInteractiveTarget = (target) => target instanceof Element && Boolean(target.closest('button, a, input, select, textarea, label'));

            elements.welcomeScreen.addEventListener('click', (event) => {
                if (isInteractiveTarget(event.target)) return;
                openImportPicker();
            });
            elements.welcomeScreen.setAttribute('tabindex', '0');
            elements.welcomeScreen.setAttribute('role', 'button');
            elements.welcomeScreen.setAttribute('aria-label', 'Open image import dialog');
            elements.welcomeScreen.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openImportPicker();
                }
            });
        }

        if (elements.loadUrlBtn) {
            elements.loadUrlBtn.addEventListener('click', () => {
                const url = elements.urlInput.value.trim();
                if (url) loadImageFromUrl(url);
            });
        }

        elements.exportTabs.forEach((btn) => {
            btn.addEventListener('click', () => {
                switchExportTab(btn.dataset.tab);
            });
        });
    }

    function initialize() {
        bindAppEvents();
        setupWorkspaceDragAndDrop();

        rasterTab.bindEvents();
        bulkTab.bindEvents();
        svgTab.bindEvents();
        logoTab.bindEvents();
        pdfTab.bindEvents();

        // Detect default tab from the HTML filename so svg.html, logo.html, etc. open the right tab
        const _tabFromPath = (function() {
            const validTabs = ['svg', 'logo', 'raster', 'bulk', 'pdf'];
            const pageName = window.location.pathname.split('/').pop().replace('.html', '').toLowerCase();
            return validTabs.includes(pageName) ? pageName : 'svg';
        })();
        switchExportTab(_tabFromPath);
        rasterTab.setExportScale(state.exportScale);
        bulkTab.setExportScale(state.bulk.exportScale);
        svgTab.syncTraceControlUi();
        logoTab.syncTraceControlUi();
        rasterTab.updateExportScaleDisplay();
        applyCurrentTabCase();
        syncWorkspaceView();
    }

    initialize();
});
