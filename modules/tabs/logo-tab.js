import { SLIDER_TOOLTIPS } from '../config.js';
import { createObjPreview } from '../preview3d.js?v=20260814q';
import { createObjExporter } from '../export3d.js?v=20260814q';
import {
    hasTransparentPixels,
    markTransparentPixels,
    quantizeImageDataToFixedPalette,
    remapQuantizedPaletteToColors,
    stripTransparentPalette
} from '../shared/image-utils.js';
import { debounce, layerHasPaths, buildTracedataSubset, createMergedTracedata, assess3DPrintQuality } from '../shared/trace-utils.js?v=20260726a';
import { saveInitialSliderValues, updateAllSliderDisplays, resetSlidersToInitial } from '../shared/slider-manager.js';
import { createZoomPanController } from '../shared/zoom-pan.js';
import { svgToPng } from '../shared/svg-renderer.js';
import { createPaletteManager } from '../shared/palette-manager.js';
import { buildWeldedSilhouetteSvgString } from '../shared/silhouette-builder.js';
import { formatObjScalePercent } from '../obj-scale.js?v=20260814l';
import { createHtmlEditor, extractDeclaredHtmlColors } from './logo/html-editor.js?v=20260725a';
import {
    DEFAULT_LOGO_PRESET_ID,
    LOGO_PRESETS,
    assessLogoPresetFit,
    buildLogoPresetMarkup,
    getLogoPreset
} from './logo/logo-presets.js?v=20260725j';
import { createAutoWorkingImageFromSource } from '../raster-utils.js';
import { canAttemptBambuLaunch } from '../bambu-bridge.js?v=20260725f';
import {
    buildTraceOptions,
    cycleTracePreset,
    estimateMeaningfulColorCount,
    getColorCountNoticeMessage,
    readTraceControls
} from '../shared/trace-controls.js';
import { setMakerWorkflow, updateMakerPreflight } from '../shared/maker-workflow.js?v=20260725a';
import {
    applyAmsPrintStylePreset,
    renderAmsPrintStyleChange,
    syncAmsPrintStyleControls,
    toggleFaceDownPrintStyle
} from '../shared/ams-print-style.js?v=20260814q';

export function createLogoTabController({
    state,
    ls,
    sharedElements,
    sidebarControls,
    previewElements,
    paletteElements,
    modelControls,
    viewControls,
    exportElements,
    htmlElements,
    showLoader,
    syncWorkspaceView,
    hasSingleImageLoaded,
    updateSegmentedControlIndicator,
    downloadBlob,
    downloadSVG,
    getImageBaseName,
    onRasterImageLoaded,
    onRasterExportStateChanged
}) {
    const tracer = window.ImageTracer;

    const le = {
        ...sharedElements,
        ...sidebarControls,
        ...previewElements,
        ...paletteElements,
        ...modelControls,
        ...viewControls,
        ...exportElements,
        ...htmlElements
    };
    syncAmsPrintStyleControls({ rootState: state, tabState: ls, controls: le });
    setMakerWorkflow(le.workflow, 'source');

    function getBuilderValues() {
        return {
            primary: le.builderText?.value,
            secondary: le.builderSecondary?.value,
            fontSize: le.builderFontSize?.value,
            width: le.builderWidth?.value,
            height: le.builderHeight?.value,
            radius: le.builderRadius?.value,
            border: le.builderBorder?.value,
            tracking: le.builderTracking?.value,
            background: le.builderBgColor?.value,
            foreground: le.builderTextColor?.value
        };
    }

    function updateBuilderFitStatus() {
        if (!le.builderFitStatus) return;
        const assessment = assessLogoPresetFit(
            ls.activeLogoPresetId || DEFAULT_LOGO_PRESET_ID,
            getBuilderValues()
        );
        const title = le.builderFitStatus.querySelector('strong');
        const detail = le.builderFitStatus.querySelector('span');
        le.builderFitStatus.classList.toggle('is-ready', assessment.ok && !assessment.warnings.length);
        le.builderFitStatus.classList.toggle('is-review', !assessment.ok || assessment.warnings.length > 0);
        if (title) {
            title.textContent = assessment.ok
                ? assessment.warnings.length ? 'Check' : 'Ready'
                : 'Adjust';
        }
        if (detail) {
            detail.textContent = assessment.errors[0]
                || assessment.warnings[0]
                || 'Defaults are sized for clean tracing and a printable support base.';
        }
    }

    function buildSimpleLogoMarkup() {
        return buildLogoPresetMarkup(
            ls.activeLogoPresetId || DEFAULT_LOGO_PRESET_ID,
            getBuilderValues()
        );
    }

    function syncSimpleBuilderToHtml({ render = true, immediate = false } = {}) {
        if (!le.htmlInput) return;
        updateBuilderFitStatus();
        le.htmlInput.value = buildSimpleLogoMarkup();
        if (render && ls.htmlModeActive) {
            if (immediate) {
                void htmlEditor.triggerHtmlRender();
            } else {
                htmlEditor.scheduleHtmlRender();
            }
        }
    }

    function updatePresetSelection() {
        le.builderPresetGallery?.querySelectorAll('[data-logo-preset]').forEach((button) => {
            const selected = button.dataset.logoPreset === ls.activeLogoPresetId;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.setAttribute('tabindex', selected ? '0' : '-1');
        });
    }

    function setBuilderInputValue(input, value) {
        if (!input) return;
        input.value = String(value ?? '');
    }

    function applyLogoPreset(presetId, { render = true, immediate = true } = {}) {
        const preset = getLogoPreset(presetId);
        ls.activeLogoPresetId = preset.id;
        const defaults = preset.defaults;
        setBuilderInputValue(le.builderText, defaults.primary);
        setBuilderInputValue(le.builderSecondary, defaults.secondary);
        setBuilderInputValue(le.builderFontSize, defaults.fontSize);
        setBuilderInputValue(le.builderWidth, defaults.width);
        setBuilderInputValue(le.builderHeight, defaults.height);
        setBuilderInputValue(le.builderRadius, defaults.radius);
        setBuilderInputValue(le.builderBorder, defaults.border);
        setBuilderInputValue(le.builderTracking, defaults.tracking);
        setBuilderInputValue(le.builderBgColor, defaults.background);
        setBuilderInputValue(le.builderTextColor, defaults.foreground);
        if (le.builderActiveName) le.builderActiveName.textContent = preset.name;
        if (le.builderActiveUse) le.builderActiveUse.textContent = preset.use;
        updatePresetSelection();
        syncSimpleBuilderToHtml({ render, immediate });
    }

    function renderLogoPresetGallery() {
        if (!le.builderPresetGallery || le.builderPresetGallery.childElementCount) return;
        LOGO_PRESETS.forEach((preset, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'logo-preset-card';
            button.dataset.logoPreset = preset.id;
            button.dataset.layout = preset.layout;
            button.setAttribute('role', 'option');
            button.setAttribute('aria-label', `${preset.name}: ${preset.use}`);

            const indexLabel = document.createElement('span');
            indexLabel.className = 'logo-preset-index';
            indexLabel.textContent = String(index + 1).padStart(2, '0');

            const preview = document.createElement('span');
            preview.className = 'logo-preset-preview';
            preview.dataset.layout = preset.layout;
            preview.style.setProperty('--preset-bg', preset.defaults.background);
            preview.style.setProperty('--preset-fg', preset.defaults.foreground);
            preview.style.setProperty('--preset-radius', `${Math.min(18, preset.defaults.radius * 0.15)}px`);

            const previewPrimary = document.createElement('strong');
            previewPrimary.textContent = preset.defaults.primary;
            const previewSecondary = document.createElement('small');
            previewSecondary.textContent = preset.defaults.secondary;
            preview.append(previewPrimary, previewSecondary);

            const copy = document.createElement('span');
            copy.className = 'logo-preset-copy';
            const name = document.createElement('strong');
            name.textContent = preset.name;
            const use = document.createElement('small');
            use.textContent = preset.use;
            copy.append(name, use);
            button.append(indexLabel, preview, copy);
            button.addEventListener('click', () => {
                applyLogoPreset(preset.id, { render: true, immediate: true });
            });
            le.builderPresetGallery.append(button);
        });
    }

    // Returns the active source image (HTML-rendered or imported)
    function getLogoSourceImage() {
        return ls.htmlModeActive && le.htmlSourceImg ? le.htmlSourceImg : le.sourceImage;
    }

    function hasLogoSourceLoaded() {
        const source = getLogoSourceImage();
        return Boolean(source?.src && source.naturalWidth && source.naturalHeight);
    }

    // ── Debounced re-trace ─────────────────────────────────────────────────────

    const runDebouncedGeneratePreview = debounce(() => {
        if (!ls.colorsAnalyzed || !hasLogoSourceLoaded()) return;
        void generatePreviewClick().catch(() => {});
    });

    function debounceGeneratePreview() {
        if (!ls.colorsAnalyzed || !hasLogoSourceLoaded()) return;
        if (le.generatePreviewBtn) le.generatePreviewBtn.disabled = true;
        setMakerWorkflow(le.workflow, 'layers', { tone: 'processing' });
        runDebouncedGeneratePreview();
    }

    function syncTraceControlMode() {
        if (ls.htmlModeActive) {
            getDeclaredHtmlColors();
        }
        if (le.resolutionNotice) {
            if (ls.htmlModeActive) {
                le.resolutionNotice.style.display = 'none';
            } else if (le.sourceImage?.naturalWidth && le.sourceImage?.naturalHeight) {
                updateResolutionNotice(le.sourceImage.naturalWidth, le.sourceImage.naturalHeight);
            }
        }
        if (le.htmlColorControls) {
            le.htmlColorControls.classList.toggle('hidden', ls.htmlModeActive);
        }
        if (le.htmlColorSummary) {
            le.htmlColorSummary.classList.toggle('hidden', !ls.htmlModeActive);
        }
        setMakerWorkflow(le.workflow, hasLogoSourceLoaded() ? (ls.colorsAnalyzed ? 'export' : 'layers') : 'source');
        syncTraceControlUi();
    }

    function syncTraceControlUi() {
        updateAllSliderDisplays(ls, le, {
            htmlModeActive: ls.htmlModeActive,
            htmlDeclaredColorCount: ls.htmlDeclaredColors.length
        });
        updateColorCountNotice();
    }

    function updateBezelHelperText() {
        if (!le.objBezelHelper) return;
        const preset = le.objBezelSelect?.value || 'off';
        const helperText = preset === 'high'
            ? 'Adds a 1.0mm inner rim with 0.8mm extra height on the support base.'
            : preset === 'low'
                ? 'Adds a 0.6mm inner rim with 0.4mm extra height on the support base.'
                : 'No raised rim is added to the support base.';
        le.objBezelHelper.textContent = helperText;
    }

    // ── Tracing options ────────────────────────────────────────────────────────

    function getDeclaredHtmlColors(source = null) {
        if (!ls.htmlModeActive) {
            ls.htmlDeclaredColors = [];
            return [];
        }

        const declaredColors = Array.isArray(source)
            ? source
            : extractDeclaredHtmlColors(le.htmlInput?.value || '');
        ls.htmlDeclaredColors = declaredColors;
        return declaredColors;
    }

    function queueAutoBaseSelection() {
        ls.autoBaseLayerSelectionPending = true;
    }

    function buildOptimizedOptions({ htmlDeclaredColors = null } = {}) {
        const controls = readTraceControls(le);
        ls.traceControls = controls;
        const declaredColorCount = ls.htmlModeActive
            ? getDeclaredHtmlColors(htmlDeclaredColors).length
            : null;

        return Object.assign({}, tracer.optionpresets.default, buildTraceOptions(controls, {
            htmlDeclaredColorCount: declaredColorCount
        }));
    }

    function resetWorkingImageCache() {
        ls.workingImageWidth = 0;
        ls.workingImageHeight = 0;
        ls.workingImageScale = 1;
        ls.workingImageWasReduced = false;
        ls.workingImageCanvas = null;
        ls.workingImageData = null;
        if (!ls.htmlModeActive) {
            ls.sourceRenderScale = 1;
        }
    }

    function buildWorkingImageCache() {
        resetWorkingImageCache();

        const workingImage = createAutoWorkingImageFromSource(le.sourceImage);
        if (!workingImage?.imageData) return null;

        ls.workingImageWidth = workingImage.workingWidth;
        ls.workingImageHeight = workingImage.workingHeight;
        ls.workingImageScale = workingImage.workingScale;
        ls.workingImageWasReduced = workingImage.wasReduced;
        ls.workingImageCanvas = workingImage.canvas;
        ls.workingImageData = workingImage.imageData;
        if (!ls.htmlModeActive) {
            ls.sourceRenderScale = workingImage.workingScale;
        }

        return workingImage;
    }

    function getWorkingImageData() {
        if (ls.workingImageData) {
            if (!ls.htmlModeActive) {
                ls.sourceRenderScale = ls.workingImageScale || 1;
            }
            return ls.workingImageData;
        }
        return buildWorkingImageCache()?.imageData || null;
    }

    function updateResolutionNotice(originalWidth, originalHeight) {
        if (!le.resolutionNotice || ls.htmlModeActive) return;

        if (ls.workingImageWasReduced && ls.workingImageWidth && ls.workingImageHeight) {
            le.resolutionNotice.textContent = `Large source detected. Using ${ls.workingImageWidth}×${ls.workingImageHeight} internally for faster SVG/3D processing.`;
            le.resolutionNotice.style.display = 'block';
            return;
        }

        if (originalWidth < 512 || originalHeight < 512) {
            le.resolutionNotice.textContent = 'Low resolution detected. For best results, use images larger than 512x512 pixels.';
            le.resolutionNotice.style.display = 'block';
            return;
        }

        le.resolutionNotice.style.display = 'none';
    }

    function findLargestBackgroundLayerIndex(tracedata) {
        if (!tracedata?.layers?.length) return -1;

        let largestIndex = -1;
        let largestArea = -1;

        tracedata.layers.forEach((layer, index) => {
            if (!Array.isArray(layer) || !layer.length) return;
            const layerArea = layer.reduce((maxArea, path) => {
                if (path?.isholepath) return maxArea;
                const bb = path?.boundingbox;
                if (!bb) return maxArea;
                return Math.max(maxArea, (bb[2] - bb[0]) * (bb[3] - bb[1]));
            }, 0);

            if (layerArea > largestArea) {
                largestArea = layerArea;
                largestIndex = index;
            }
        });

        return largestIndex;
    }

    function cleanupHtmlBackgroundLayer(tracedata) {
        if (!ls.htmlModeActive || !tracedata?.layers?.length) return tracedata;

        const backgroundLayerIndex = findLargestBackgroundLayerIndex(tracedata);
        if (backgroundLayerIndex < 0) return tracedata;

        tracedata.layers = tracedata.layers.map((layer, index) => {
            if (index !== backgroundLayerIndex || !Array.isArray(layer)) return layer;
            return layer.filter((path) => !path.isholepath).map((path) => ({ ...path, holechildren: [] }));
        });

        const order = tracedata.layers.map((_, index) => index).sort((a, b) => {
            if (a === backgroundLayerIndex) return -1;
            if (b === backgroundLayerIndex) return 1;
            return a - b;
        });

        tracedata.layers = order.map((index) => tracedata.layers[index]);
        tracedata.palette = order.map((index) => tracedata.palette[index]);
        return tracedata;
    }

    // ── Color analysis ─────────────────────────────────────────────────────────

    function updateColorCountNotice() {
        if (!le.colorCountNotice) return;
        if (ls.htmlModeActive) {
            le.colorCountNotice.classList.add('hidden');
            return;
        }
        if (!hasLogoSourceLoaded()) {
            le.colorCountNotice.classList.add('hidden');
            return;
        }

        const imageData = getWorkingImageData();
        if (!imageData) {
            le.colorCountNotice.classList.add('hidden');
            return;
        }

        const estimatedColors = estimateMeaningfulColorCount(imageData);
        ls.estimatedColorCount = estimatedColors;
        const currentOutputColors = parseInt(le.outputColorsSlider?.value || '4', 10);
        const notice = getColorCountNoticeMessage(estimatedColors, currentOutputColors);

        le.colorCountNotice.textContent = notice;
        le.colorCountNotice.classList.toggle('hidden', !notice);
    }

    async function quantizeColors(options) {
        showLoader(true);
        le.statusText.textContent = 'Analyzing colors...';
        disableDownloadButtons();

        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    const imageData = ls.htmlModeActive
                        ? (() => {
                            const srcImg = getLogoSourceImage();
                            const width = srcImg.naturalWidth;
                            const height = srcImg.naturalHeight;
                            if (!width || !height) return null;

                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(srcImg, 0, 0, width, height);
                            return ctx.getImageData(0, 0, width, height);
                        })()
                        : getWorkingImageData();
                    if (!imageData) throw new Error('Invalid image dimensions');

                    const declaredHtmlColors = ls.htmlModeActive ? getDeclaredHtmlColors() : [];
                    ls.lastOptions = options;

                    if (ls.htmlModeActive && declaredHtmlColors.length > 0) {
                        ls.quantizedData = quantizeImageDataToFixedPalette(imageData, declaredHtmlColors);
                    } else {
                        ls.quantizedData = tracer.colorquantization(imageData, options);
                        if (hasTransparentPixels(imageData)) {
                            markTransparentPixels(ls.quantizedData, imageData);
                            stripTransparentPalette(ls.quantizedData);
                        } else {
                            ls.quantizedData.palette.forEach(c => { c.a = 255; });
                        }
                    }

                    if (!ls.quantizedData?.palette) throw new Error('Color analysis failed.');

                    if (ls.htmlModeActive && declaredHtmlColors.length > 0) {
                        remapQuantizedPaletteToColors(ls.quantizedData, declaredHtmlColors);
                    }

                    if (!ls.quantizedData.palette.length) throw new Error('No opaque pixels found.');
                    resolve();
                } catch (error) {
                    console.error('Color analysis error:', error);
                    le.statusText.textContent = `Error: ${error.message}`;
                    reject(error);
                } finally {
                    showLoader(false);
                }
            }, 50);
        });
    }

    function needsRequantization(newOptions) {
        if (!ls.quantizedData || !ls.lastOptions) return true;
        if (ls.htmlModeActive) return true;
        return newOptions.numberofcolors !== ls.lastOptions.numberofcolors
            || newOptions.mincolorratio !== ls.lastOptions.mincolorratio;
    }

    async function generatePreviewClick() {
        if (!hasLogoSourceLoaded()) return;
        ls.layerThicknessById = {};
        queueAutoBaseSelection();
        setMakerWorkflow(le.workflow, 'layers', { tone: 'processing' });

        try {
            const declaredHtmlColors = ls.htmlModeActive ? getDeclaredHtmlColors() : [];
            const options = buildOptimizedOptions({ htmlDeclaredColors: declaredHtmlColors });
            if (needsRequantization(options)) {
                await quantizeColors(options);
            } else {
                ls.lastOptions = options;
            }
            ls.colorsAnalyzed = true;
            await traceVectorPaths();
        } catch (error) {
            ls.colorsAnalyzed = false;
            setMakerWorkflow(le.workflow, 'layers', { tone: 'error' });
            throw error;
        }
    }

    // ── HTML editor ────────────────────────────────────────────────────────────

    const htmlEditor = createHtmlEditor({
        ls,
        le,
        elements: sharedElements,
        syncWorkspaceView,
        generatePreviewClick,
        onModeChanged: syncTraceControlMode
    });

    // ── Layer helpers ──────────────────────────────────────────────────────────

    function getVisibleLayerIndices() {
        if (!ls.tracedata) return [];
        const indices = [];
        for (let i = 0; i < ls.tracedata.layers.length; i++) {
            if (layerHasPaths(ls.tracedata.layers[i])) indices.push(i);
        }
        return indices;
    }

    function getDataToExport() {
        if (!ls.tracedata) return null;
        const visibleIndices = getVisibleLayerIndices();
        if (!visibleIndices.length) return null;
        if (ls.mergeRules?.length > 0) {
            return createMergedTracedata(ls.tracedata, visibleIndices, ls.mergeRules);
        }
        return buildTracedataSubset(ls.tracedata, visibleIndices);
    }

    // ── Quality display ────────────────────────────────────────────────────────

    function updateQualityDisplay(quality) {
        const plan = ls.objPreview?.lastPlan;
        const finalColorCount = plan?.outputLayers?.length || quality.colorCount;
        const styleWarnings = (plan?.warnings || []).filter((warning) => (
            String(warning?.type || '').startsWith('ams-')
        ));
        const finalQuality = {
            ...quality,
            colorCount: finalColorCount,
            ...(quality.status === 'ready' && styleWarnings.length
                ? {
                    status: 'review',
                    label: 'Style adjusted',
                    note: styleWarnings.map((warning) => warning.message).join(' ')
                }
                : {})
        };
        if (le.qualityIndicator) {
            le.qualityIndicator.textContent = `${finalQuality.pathCount.toLocaleString()} paths · ${finalQuality.colorCount} colors`;
        }
        updateMakerPreflight(viewControls, finalQuality);
        objPreview?.refreshPreflight();
    }

    // ── 3D preview / exporter ──────────────────────────────────────────────────

    const objPreview = createObjPreview({
        state: ls,
        modelControls,
        viewControls,
        getDataToExport,
        getVisibleLayerIndices,
        ImageTracer: tracer
    });

    function renderObjModelOnly({ styleOnly = false } = {}) {
        const renderSucceeded = objPreview.render({ styleOnly });
        if (ls.tracedata) {
            updateQualityDisplay(assess3DPrintQuality(ls.tracedata, getVisibleLayerIndices));
        }
        return renderSucceeded;
    }

    const scheduleObjModelRender = debounce(renderObjModelOnly, 80);

    const objExporter = createObjExporter({
        state: ls,
        modelControls,
        statusText: le.statusText,
        getDataToExport,
        ImageTracer: tracer,
        showLoader,
        downloadBlob,
        getImageBaseName
    });

    // ── Tracing ────────────────────────────────────────────────────────────────

    async function traceVectorPaths() {
        if (!ls.quantizedData) return;
        showLoader(true);
        le.statusText.textContent = 'Tracing vector paths...';
        if (le.generatePreviewBtn) le.generatePreviewBtn.disabled = true;
        setMakerWorkflow(le.workflow, 'model', { tone: 'processing' });

        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    const options = ls.lastOptions || buildOptimizedOptions({ htmlDeclaredColors: ls.htmlDeclaredColors });
                    ls.lastOptions = options;

                    const ii = ls.quantizedData;
                    const tracedata = {
                        layers: [],
                        palette: ii.palette,
                        width: ii.array[0].length - 2,
                        height: ii.array.length - 2
                    };

                    for (let colornum = 0; colornum < ii.palette.length; colornum++) {
                        tracedata.layers.push(tracer.batchtracepaths(
                            tracer.internodes(
                                tracer.pathscan(tracer.layeringstep(ii, colornum), options.pathomit),
                                options
                            ),
                            options.ltres, options.qtres
                        ));
                    }

                    if (ls.htmlModeActive) {
                        cleanupHtmlBackgroundLayer(tracedata);
                    }

                    ls.tracedata = tracedata;
                    ls.silhouetteSvgString = buildWeldedSilhouetteSvgString({
                        tracedata: ls.tracedata,
                        layerIndices: getVisibleLayerIndices(),
                        tracer,
                        options: ls.lastOptions,
                        SVGLoader: window.SVGLoader,
                        THREERef: window.THREE
                    });

                    palette.displayPalette();
                    palette.prepareMergeUIAfterGeneration();

                    le.outputSection.style.display = 'flex';
                    setTimeout(() => updateSegmentedControlIndicator(), 100);

                    await renderPreviews();
                    await updateFilteredPreview();

                    updateQualityDisplay(assess3DPrintQuality(ls.tracedata, getVisibleLayerIndices));
                    setMakerWorkflow(le.workflow, 'export');
                    le.statusText.textContent = 'Preview generated!';
                    enableDownloadButtons();
                    onRasterExportStateChanged();
                    resolve();
                } catch (error) {
                    console.error('Tracing error:', error);
                    le.statusText.textContent = `Error: ${error.message}`;
                    setMakerWorkflow(le.workflow, 'model', { tone: 'error' });
                    reject(error);
                } finally {
                    showLoader(false);
                    if (le.generatePreviewBtn) le.generatePreviewBtn.disabled = false;
                }
            }, 50);
        });
    }

    // ── Zoom / pan ─────────────────────────────────────────────────────────────

    const { setupZoomControls } = createZoomPanController({
        st: ls,
        idPrefix: 'logo-'
    });

    // ── SVG preview rendering ──────────────────────────────────────────────────

    async function renderPreviews() {
        if (!ls.tracedata || !le.svgPreview) return;
        try {
            const visibleIndices = getVisibleLayerIndices();
            const previewData = buildTracedataSubset(ls.tracedata, visibleIndices);
            const svgString = tracer.getsvgstring(previewData, ls.lastOptions);
            const pngDataUrl = await svgToPng(svgString, null, null, true, le.previewResolution);
            le.svgPreview.src = pngDataUrl;
            le.svgPreview.style.display = 'block';
        } catch (error) {
            console.error('Preview rendering failed:', error);
            le.svgPreview.style.display = 'none';
        }
    }

    function updateFilteredPreview() {
        objPreview.render();
        if (ls.tracedata) {
            updateQualityDisplay(assess3DPrintQuality(ls.tracedata, getVisibleLayerIndices));
        }
    }

    // ── Download buttons ───────────────────────────────────────────────────────

    function disableDownloadButtons() {
        [
            le.exportObjBtn,
            le.export3mfBtn,
            le.bambuOpenBtn,
            le.exportStlBtn
        ].forEach(btn => { if (btn) btn.disabled = true; });
    }

    function refreshBambuOpenButtonState() {
        if (!le.bambuOpenBtn) return;
        const canLaunch = canAttemptBambuLaunch();
        le.bambuOpenBtn.disabled = !ls.tracedata || !canLaunch;
        le.bambuOpenBtn.title = canLaunch
            ? 'Sends the 3MF directly to the installed Bambu Studio app.'
            : 'Bambu Studio launch is only available on desktop browsers.';
        const meta = document.getElementById('logo-bambu-open-meta');
        if (meta) {
            meta.textContent = canLaunch
                ? 'One-click 3MF handoff · Bambu Studio required'
                : 'Desktop browsers only';
        }
    }

    function enableDownloadButtons() {
        [
            le.exportObjBtn,
            le.export3mfBtn,
            le.exportStlBtn
        ].forEach(btn => { if (btn) btn.disabled = false; });
        refreshBambuOpenButtonState();
    }

    // ── Palette manager ────────────────────────────────────────────────────────

    const palette = createPaletteManager({
        st: ls,
        el: le,
        getVisibleLayerIndices,
        updateFilteredPreview
    });

    // ── Original image saves ───────────────────────────────────────────────────

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    function onSourceImageLoaded() {
        // A new image always drops HTML mode so the pipeline traces the bitmap next time Logo opens.
        if (ls.htmlModeActive) {
            htmlEditor.setHtmlMode(false);
        }
        ls.htmlDeclaredColors = [];

        if (le.svgSourceMirror && le.sourceImage.src) {
            le.svgSourceMirror.src = le.sourceImage.src;
        }

        const w = le.sourceImage.naturalWidth;
        const h = le.sourceImage.naturalHeight;
        if (le.originalResolution) le.originalResolution.textContent = `${w}×${h} px`;
        updateResolutionNotice(w, h);
        onRasterImageLoaded();
        ls.colorsAnalyzed = false;
        setMakerWorkflow(le.workflow, 'layers');

        if (state.activeTab !== 'logo') {
            showLoader(false);
            return;
        }

        syncWorkspaceView();
        if (le.generatePreviewBtn) le.generatePreviewBtn.disabled = false;
        buildWorkingImageCache();
        saveInitialSliderValues(ls, le);
        syncTraceControlMode();
        void generatePreviewClick().catch(() => {});
        onTabActivated();
        showLoader(false);
    }

    function onTabActivated() {
        syncAmsPrintStyleControls({ rootState: state, tabState: ls, controls: le });
        if (ls.htmlModeActive) {
            if (!ls.colorsAnalyzed && le.htmlInput?.value.trim()) {
                setMakerWorkflow(le.workflow, 'layers');
                htmlEditor.triggerHtmlRender();
            } else if (ls.colorsAnalyzed) {
                setMakerWorkflow(le.workflow, 'export');
                renderObjModelOnly();
            } else {
                setMakerWorkflow(le.workflow, 'source');
            }
            return;
        }

        if (!hasSingleImageLoaded()) {
            setMakerWorkflow(le.workflow, 'source');
            return;
        }
        if (!ls.colorsAnalyzed) {
            setMakerWorkflow(le.workflow, 'layers');
            if (le.generatePreviewBtn) le.generatePreviewBtn.disabled = false;
            buildWorkingImageCache();
            saveInitialSliderValues(ls, le);
            syncTraceControlMode();
            void generatePreviewClick().catch(() => {});
        } else {
            setMakerWorkflow(le.workflow, 'export');
            objPreview.render();
        }
    }

    // ── Event binding ──────────────────────────────────────────────────────────

    function bindEvents() {
        if (le.generatePreviewBtn) {
            le.generatePreviewBtn.addEventListener('click', () => {
                if (state.activeTab !== 'logo') return;
                void generatePreviewClick().catch(() => {});
            });
        }
        if (le.resetBtn) {
            le.resetBtn.addEventListener('click', () => {
                resetSlidersToInitial(ls, le);
                syncTraceControlMode();
                if (hasLogoSourceLoaded()) {
                    void generatePreviewClick().catch(() => {});
                }
            });
        }
        if (le.presetBtn) {
            le.presetBtn.addEventListener('click', () => {
                if (state.activeTab !== 'logo') return;
                cycleTracePreset(le);
                if (!ls.isDirty) {
                    ls.isDirty = true;
                    le.resetBtn.style.display = 'inline';
                }
                syncTraceControlMode();
                showTraceControlTooltip('trace-preset', 'logo-trace-preset');
                if (ls.colorsAnalyzed) {
                    debounceGeneratePreview();
                }
            });
        }

        if (le.objAmsPrintStyle) {
            le.objAmsPrintStyle.addEventListener('change', () => {
                if (state.activeTab !== 'logo') return;
                void renderAmsPrintStyleChange({
                    rootState: state,
                    tabState: ls,
                    controls: le,
                    apply: () => applyAmsPrintStylePreset({
                        rootState: state,
                        tabState: ls,
                        controls: le,
                        styleId: le.objAmsPrintStyle.value
                    }),
                    render: () => renderObjModelOnly({ styleOnly: true })
                });
            });
        }
        if (le.objFaceDownToggle) {
            le.objFaceDownToggle.addEventListener('click', () => {
                if (state.activeTab !== 'logo') return;
                void renderAmsPrintStyleChange({
                    rootState: state,
                    tabState: ls,
                    controls: le,
                    apply: () => toggleFaceDownPrintStyle({
                        rootState: state,
                        tabState: ls,
                        controls: le
                    }),
                    render: () => renderObjModelOnly({ styleOnly: true })
                });
            });
        }
        if (le.objBaseThicknessSlider && le.objBaseThicknessValue) {
            le.objBaseThicknessValue.textContent = le.objBaseThicknessSlider.value;
            le.objBaseThicknessSlider.addEventListener('input', () => {
                const nextBaseThickness = Number.parseFloat(le.objBaseThicknessSlider.value);
                state.objParams.baseThickness = nextBaseThickness;
                ls.objParams.baseThickness = nextBaseThickness;
                le.objBaseThicknessValue.textContent = nextBaseThickness;
            });
            le.objBaseThicknessSlider.addEventListener('change', () => {
                if (state.activeTab === 'logo') {
                    objPreview.updateLayerHeights();
                    updateQualityDisplay(assess3DPrintQuality(ls.tracedata, getVisibleLayerIndices));
                }
            });
        }
        if (le.objThicknessSlider && le.objThicknessValue) {
            le.objThicknessValue.textContent = le.objThicknessSlider.value;
            le.objThicknessSlider.addEventListener('input', () => {
                const nextThickness = Number.parseFloat(le.objThicknessSlider.value);
                state.objParams.thickness = nextThickness;
                ls.objParams.thickness = nextThickness;
                le.objThicknessValue.textContent = nextThickness;
            });
            le.objThicknessSlider.addEventListener('change', () => {
                if (state.activeTab === 'logo') {
                    objPreview.updateLayerHeights();
                    updateQualityDisplay(assess3DPrintQuality(ls.tracedata, getVisibleLayerIndices));
                }
            });
        }

        if (le.objDecimateSlider && le.objDecimateValue) {
            le.objDecimateValue.textContent = le.objDecimateSlider.value;
            le.objDecimateSlider.addEventListener('input', () => {
                state.objParams.decimate = Number.parseFloat(le.objDecimateSlider.value);
                le.objDecimateValue.textContent = state.objParams.decimate;
                if (state.activeTab === 'logo') scheduleObjModelRender();

                const tooltipEl = document.getElementById('obj-decimate-tooltip');
                if (tooltipEl) {
                    tooltipEl.textContent = SLIDER_TOOLTIPS['obj-decimate'];
                    tooltipEl.style.opacity = '1';
                    clearTimeout(ls.tooltipTimeout);
                    ls.tooltipTimeout = setTimeout(() => { tooltipEl.style.opacity = '0'; }, 2000);
                }
            });
        }

        if (le.objScaleSlider && le.objScaleValue) {
            le.objScaleValue.textContent = formatObjScalePercent(le.objScaleSlider.value);
            le.objScaleSlider.addEventListener('input', () => {
                state.objParams.scale = Number.parseFloat(le.objScaleSlider.value);
                le.objScaleValue.textContent = formatObjScalePercent(state.objParams.scale);
                if (state.activeTab === 'logo') scheduleObjModelRender();
            });
        }
        if (le.objBedSelect) {
            le.objBedSelect.addEventListener('change', (e) => {
                state.objParams.bedKey = e.target.value;
                if (state.activeTab === 'logo') scheduleObjModelRender();
            });
        }
        if (le.objMarginInput) {
            le.objMarginInput.addEventListener('input', (e) => {
                state.objParams.margin = Number.parseFloat(e.target.value);
                if (state.activeTab === 'logo') scheduleObjModelRender();
            });
        }
        if (le.objBezelSelect) {
            le.objBezelSelect.addEventListener('change', () => {
                state.objParams.bezelPreset = le.objBezelSelect.value || 'off';
                updateBezelHelperText();
                if (state.activeTab === 'logo') scheduleObjModelRender();

                const tooltipEl = document.getElementById('obj-bezel-tooltip');
                if (tooltipEl) {
                    tooltipEl.textContent = SLIDER_TOOLTIPS['obj-bezel'];
                    tooltipEl.style.opacity = '1';
                    clearTimeout(ls.tooltipTimeout);
                    ls.tooltipTimeout = setTimeout(() => { tooltipEl.style.opacity = '0'; }, 2000);
                }
            });
            if (!state.objParams.bezelPreset) state.objParams.bezelPreset = le.objBezelSelect.value || 'off';
            le.objBezelSelect.value = state.objParams.bezelPreset || 'off';
            updateBezelHelperText();
        }
        if (le.exportObjBtn) {
            le.exportObjBtn.addEventListener('click', () => objExporter.exportAsOBJ());
        }
        if (le.export3mfBtn) {
            le.export3mfBtn.addEventListener('click', () => objExporter.exportAs3MF());
        }
        if (le.bambuOpenBtn) {
            refreshBambuOpenButtonState();
            le.bambuOpenBtn.addEventListener('click', () => {
                void objExporter.exportAndOpenInBambu();
            });
        }
        if (le.exportStlBtn) {
            le.exportStlBtn.addEventListener('click', () => objExporter.exportAsSTL());
        }

        setupZoomControls(['all']);
        objPreview.bindControls();

        if (le.useBaseLayerCheckbox) {
            le.useBaseLayerCheckbox.addEventListener('change', (e) => {
                ls.autoBaseLayerSelectionPending = false;
                ls.useBaseLayer = e.target.checked;
                if (le.baseLayerSelect) le.baseLayerSelect.disabled = !e.target.checked;
                objPreview.render();
            });
            ls.useBaseLayer = le.useBaseLayerCheckbox.checked;
        }
        if (le.baseLayerSelect) {
            le.baseLayerSelect.addEventListener('change', (e) => {
                ls.autoBaseLayerSelectionPending = false;
                ls.baseSourceLayerId = Number.parseInt(e.target.value, 10);
                objPreview.render();
            });
        }

        if (le.previewResolution) {
            le.previewResolution.addEventListener('change', () => {
                if (state.activeTab !== 'logo') return;
                if (ls.tracedata) {
                    renderPreviews();
                    updateFilteredPreview();
                }
            });
        }

        [
            le.outputColorsSlider,
            le.colorCleanupSlider,
            le.pathCleanupSlider,
            le.cornerSharpnessSlider,
            le.curveStraightnessSlider,
            le.preserveRightAnglesCheckbox
        ].filter(Boolean).forEach((control) => {
            control.addEventListener(control.type === 'checkbox' ? 'change' : 'input', (e) => {
                if (state.activeTab !== 'logo') return;
                if (!ls.isDirty) {
                    ls.isDirty = true;
                    le.resetBtn.style.display = 'inline';
                }
                syncTraceControlMode();
                showTraceControlTooltip(e.target.id.replace(/^logo-/, ''), e.target.id);

                if (ls.colorsAnalyzed) {
                    debounceGeneratePreview();
                }
            });
        });

        if (le.addMergeRuleBtn) {
            le.addMergeRuleBtn.addEventListener('click', () => {
                const ruleIndex = ls.mergeRules.length;
                const visibleIndices = getVisibleLayerIndices();
                if (visibleIndices.length < 2) return;

                const defaultRule = { source: 0, target: 1 };
                ls.mergeRules.push(defaultRule);

                const row = document.createElement('div');
                row.className = 'flex items-center gap-2 text-sm';
                const optionsHTML = visibleIndices.map((idx, ord) => `<option value="${ord}">Layer ${idx}</option>`).join('');
                row.innerHTML = `
                    <span>Merge</span>
                    <span class="w-4 h-4 rounded border border-gray-500" data-swatch="source"></span>
                    <select data-rule-index="${ruleIndex}" data-type="source" class="border rounded-md p-1 bg-gray-700 border-gray-600 text-white">${optionsHTML}</select>
                    <span>into</span>
                    <span class="w-4 h-4 rounded border border-gray-500" data-swatch="target"></span>
                    <select data-rule-index="${ruleIndex}" data-type="target" class="border rounded-md p-1 bg-gray-700 border-gray-600 text-white">${optionsHTML}</select>
                    <button data-rule-index="${ruleIndex}" class="text-red-500 hover:text-red-400 font-bold text-lg">&times;</button>
                `;
                row.querySelector('select[data-type="target"]').value = '1';
                le.mergeRulesContainer.appendChild(row);
                palette.updateMergeRuleSwatches(row, defaultRule, visibleIndices);
                palette.updateFinalPalette();
                queueAutoBaseSelection();
                updateFilteredPreview();
            });
        }

        if (le.mergeRulesContainer) {
            le.mergeRulesContainer.addEventListener('change', (e) => {
                if (e.target.tagName === 'SELECT') {
                    const ruleIndex = parseInt(e.target.dataset.ruleIndex, 10);
                    const type = e.target.dataset.type;
                    ls.mergeRules[ruleIndex][type] = parseInt(e.target.value, 10);
                    const visibleIndices = getVisibleLayerIndices();
                    palette.updateMergeRuleSwatches(e.target.parentElement, ls.mergeRules[ruleIndex], visibleIndices);
                    palette.updateFinalPalette();
                    queueAutoBaseSelection();
                    updateFilteredPreview();
                }
            });

            le.mergeRulesContainer.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') {
                    const ruleIndex = parseInt(e.target.dataset.ruleIndex, 10);
                    ls.mergeRules.splice(ruleIndex, 1);
                    e.target.parentElement.remove();
                    document.querySelectorAll('#logo-merge-rules-container > div').forEach((row, i) => {
                        row.querySelectorAll('[data-rule-index]').forEach(el => { el.dataset.ruleIndex = i; });
                    });
                    palette.updateFinalPalette();
                    queueAutoBaseSelection();
                    updateFilteredPreview();
                }
            });
        }

        const layersToggle = document.getElementById('logo-layers-toggle');
        const layersSection = document.getElementById('logo-layers-section');
        if (layersToggle && layersSection) {
            layersToggle.addEventListener('click', () => {
                layersSection.classList.toggle('collapsed');
                layersToggle.classList.toggle('expanded');
                const isExpanded = !layersSection.classList.contains('collapsed');
                layersToggle.querySelector('span').textContent = isExpanded ? 'Click to collapse' : 'Click to expand';
            });
        }

        window.addEventListener('resize', () => {
            updateSegmentedControlIndicator();
            objPreview.resize();
        });

        le.sourceImage.addEventListener('load', onSourceImageLoaded);

        // ── HTML editor bindings ───────────────────────────────────────────────
        le.htmlModeButtons?.forEach((button) => {
            button.addEventListener('click', () => {
                const htmlMode = button.dataset.logoSourceMode === 'html';
                htmlEditor.setHtmlMode(htmlMode);
                if (htmlMode && le.htmlInput?.value.trim()) {
                    htmlEditor.scheduleHtmlRender();
                } else if (!htmlMode && !hasSingleImageLoaded()) {
                    document.getElementById('import-btn')?.click();
                }
            });
        });

        if (le.htmlRenderBtn) {
            le.htmlRenderBtn.addEventListener('click', () => {
                if (le.htmlInput?.value.trim()) htmlEditor.triggerHtmlRender();
            });
        }

        if (le.htmlInput) {
            le.htmlInput.addEventListener('input', () => {
                if (ls.htmlModeActive) htmlEditor.scheduleHtmlRender();
            });
        }

        if (le.htmlWidthSlider && le.htmlWidthLabel) {
            le.htmlWidthSlider.addEventListener('input', () => {
                le.htmlWidthLabel.textContent = `${le.htmlWidthSlider.value}px`;
                if (ls.htmlModeActive && le.htmlInput?.value.trim()) {
                    // Immediately re-render source preview at new width, debounce full pipeline
                    htmlEditor.triggerSourcePreview();
                    htmlEditor.scheduleHtmlRender();
                }
            });
        }

        if (le.htmlWidthReset) {
            le.htmlWidthReset.addEventListener('click', () => {
                if (!le.htmlWidthSlider || !le.htmlWidthLabel) return;
                le.htmlWidthSlider.value = 600;
                le.htmlWidthLabel.textContent = '600px';
                if (ls.htmlModeActive && le.htmlInput?.value.trim()) {
                    htmlEditor.triggerSourcePreview();
                    htmlEditor.triggerHtmlRender();
                }
            });
        }

        const builderControls = [
            le.builderText,
            le.builderSecondary,
            le.builderFontSize,
            le.builderWidth,
            le.builderHeight,
            le.builderRadius,
            le.builderBorder,
            le.builderTracking,
            le.builderBgColor,
            le.builderTextColor
        ].filter(Boolean);
        builderControls.forEach((control) => {
            const eventName = control.type === 'color' ? 'change' : 'input';
            control.addEventListener(eventName, () => syncSimpleBuilderToHtml());
        });

        renderLogoPresetGallery();
        if (le.builderResetBtn) {
            le.builderResetBtn.addEventListener('click', () => {
                applyLogoPreset(ls.activeLogoPresetId || DEFAULT_LOGO_PRESET_ID, {
                    render: true,
                    immediate: true
                });
            });
        }
        applyLogoPreset(ls.activeLogoPresetId || DEFAULT_LOGO_PRESET_ID, {
            render: false,
            immediate: false
        });
        htmlEditor.setHtmlMode(ls.htmlModeActive);
    }

    function showTraceControlTooltip(controlId, tooltipId = controlId) {
        const tooltipEl = document.getElementById(`${tooltipId}-tooltip`);
        if (!tooltipEl) return;
        tooltipEl.textContent = SLIDER_TOOLTIPS[controlId] || '';
        tooltipEl.style.opacity = '1';
        clearTimeout(ls.tooltipTimeout);
        ls.tooltipTimeout = setTimeout(() => { tooltipEl.style.opacity = '0'; }, 2000);
    }

    return {
        bindEvents,
        onTabActivated,
        onSourceImageLoaded,
        syncTraceControlUi: syncTraceControlMode,
        updateColorCountNotice,
        renderPreviews,
        updateFilteredPreview
    };
}
