/**
 * Annotate Tab
 * ------------
 * Canvas image markup. Every mark is stored as an object in source-image pixel
 * space and the whole list is re-rendered each frame, so undo/redo is a plain
 * stack operation. The on-screen canvas is capped to a comfortable working
 * size while exports re-render the same object list at scale 1, which keeps
 * downloads at the full source resolution.
 *
 * Object shapes (all coordinates in source pixels):
 *   pen     { color, strokeWidth, points: [{x, y}] }
 *   line    { color, strokeWidth, x1, y1, x2, y2 }
 *   arrow   { color, strokeWidth, x1, y1, x2, y2 }
 *   rect    { color, strokeWidth, fill, fillColor, fillOpacity, x, y, w, h }
 *   ellipse { color, strokeWidth, fill, fillColor, fillOpacity, x, y, w, h }
 *   text    { color, size, x, y, text }
 *   blur    { mode, strength, x, y, w, h }
 *   frame   { color, strokeWidth, rounded }
 */

const VIEW_MAX_DIMENSION = 1400;

const EXPORT_FORMATS = {
    png: { extension: 'png', mime: 'image/png', label: 'PNG', quality: undefined, background: null },
    jpg: { extension: 'jpg', mime: 'image/jpeg', label: 'JPG', quality: 0.92, background: '#ffffff' },
    webp: { extension: 'webp', mime: 'image/webp', label: 'WEBP', quality: 0.92, background: null }
};

// Which option rows the toolbar exposes for each tool.
const TOOL_OPTIONS = {
    pen: ['stroke'],
    line: ['stroke'],
    arrow: ['stroke'],
    rect: ['stroke', 'fill'],
    ellipse: ['stroke', 'fill'],
    text: ['stroke', 'text'],
    blur: ['blur'],
    frame: ['frame']
};

const TOOL_HINTS = {
    pen: 'Drag to draw freehand.',
    line: 'Drag from one point to another.',
    arrow: 'Drag to place an arrow — the head lands where you release.',
    rect: 'Drag to draw a rectangle.',
    ellipse: 'Drag to draw an ellipse.',
    text: 'Click the image, type, then press Enter.',
    blur: 'Drag over anything that should be hidden.',
    frame: 'Pick a color and width, then apply the frame.'
};

const MIN_BOX_SIZE = 2;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function hexToRgba(hex, alpha) {
    const normalized = String(hex || '#000000').replace('#', '');
    const full = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized.padEnd(6, '0').slice(0, 6);
    const value = Number.parseInt(full, 16) || 0;
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function traceRoundedRect(ctx, x, y, width, height, radius) {
    const limit = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, limit);
        return;
    }
    ctx.beginPath();
    ctx.moveTo(x + limit, y);
    ctx.lineTo(x + width - limit, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + limit);
    ctx.lineTo(x + width, y + height - limit);
    ctx.quadraticCurveTo(x + width, y + height, x + width - limit, y + height);
    ctx.lineTo(x + limit, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - limit);
    ctx.lineTo(x, y + limit);
    ctx.quadraticCurveTo(x, y, x + limit, y);
    ctx.closePath();
}

export function createAnnotateTabController({
    state,
    elements,
    downloadBlob,
    getImageBaseName,
    hasSingleImageLoaded
}) {
    const dom = {
        panel: document.getElementById('tab-annotate'),
        emptyState: document.getElementById('annotate-empty-state'),
        content: document.getElementById('annotate-content'),
        canvas: document.getElementById('annotate-canvas'),
        canvasFrame: document.getElementById('annotate-canvas-frame'),
        textInput: document.getElementById('annotate-text-input'),
        hint: document.getElementById('annotate-hint'),
        objectCount: document.getElementById('annotate-object-count'),
        toolButtons: Array.from(document.querySelectorAll('[data-annotate-tool]')),
        optionRows: Array.from(document.querySelectorAll('[data-annotate-option]')),
        strokeColor: document.getElementById('annotate-stroke-color'),
        strokeWidth: document.getElementById('annotate-stroke-width'),
        strokeWidthValue: document.getElementById('annotate-stroke-width-value'),
        fillToggle: document.getElementById('annotate-fill-toggle'),
        fillColor: document.getElementById('annotate-fill-color'),
        fillOpacity: document.getElementById('annotate-fill-opacity'),
        fillOpacityValue: document.getElementById('annotate-fill-opacity-value'),
        fontSize: document.getElementById('annotate-font-size'),
        fontSizeValue: document.getElementById('annotate-font-size-value'),
        blurMode: document.getElementById('annotate-blur-mode'),
        blurStrength: document.getElementById('annotate-blur-strength'),
        blurStrengthValue: document.getElementById('annotate-blur-strength-value'),
        frameColor: document.getElementById('annotate-frame-color'),
        frameWidth: document.getElementById('annotate-frame-width'),
        frameWidthValue: document.getElementById('annotate-frame-width-value'),
        frameRounded: document.getElementById('annotate-frame-rounded'),
        frameApply: document.getElementById('annotate-frame-apply'),
        undoBtn: document.getElementById('annotate-undo-btn'),
        redoBtn: document.getElementById('annotate-redo-btn'),
        clearBtn: document.getElementById('annotate-clear-btn'),
        savePngBtn: document.getElementById('annotate-save-png-btn'),
        saveJpgBtn: document.getElementById('annotate-save-jpg-btn'),
        saveWebpBtn: document.getElementById('annotate-save-webp-btn')
    };

    // The tab partial only lands on shells that reserve a slot for it, and every
    // shell loads this module through converter.js, so each entry point below
    // has to survive a missing panel.
    const isMounted = Boolean(dom.panel && dom.canvas);

    const editor = {
        tool: 'pen',
        objects: [],
        redoStack: [],
        draft: null,
        pointerId: null,
        source: { width: 0, height: 0 },
        view: { width: 0, height: 0, scale: 1 },
        pendingText: null,
        generation: null
    };

    function getContext() {
        return dom.canvas?.getContext('2d') || null;
    }

    function isImageReady() {
        const image = elements.sourceImage;
        return Boolean(image?.complete && image.naturalWidth && image.naturalHeight);
    }

    function readStrokeColor() {
        return dom.strokeColor?.value || '#ff3b30';
    }

    // Sliders describe on-screen weight. Convert to source pixels so an
    // exported mark keeps the thickness it had while being drawn.
    function toSourceUnits(screenValue) {
        return Math.max(0.5, screenValue / (editor.view.scale || 1));
    }

    function readStrokeWidth() {
        return toSourceUnits(Number.parseFloat(dom.strokeWidth?.value || '6') || 6);
    }

    function readFillSettings() {
        return {
            fill: Boolean(dom.fillToggle?.checked),
            fillColor: dom.fillColor?.value || '#ffd60a',
            fillOpacity: (Number.parseFloat(dom.fillOpacity?.value || '35') || 35) / 100
        };
    }

    function syncEmptyState() {
        if (!isMounted) return;
        const hasImage = hasSingleImageLoaded() && isImageReady();
        dom.emptyState?.classList.toggle('hidden', hasImage);
        dom.content?.classList.toggle('hidden', !hasImage);
        [dom.savePngBtn, dom.saveJpgBtn, dom.saveWebpBtn].forEach((button) => {
            if (button) button.disabled = !hasImage;
        });
    }

    function syncHistoryButtons() {
        if (!isMounted) return;
        if (dom.undoBtn) dom.undoBtn.disabled = editor.objects.length === 0;
        if (dom.redoBtn) dom.redoBtn.disabled = editor.redoStack.length === 0;
        if (dom.clearBtn) dom.clearBtn.disabled = editor.objects.length === 0;
        if (dom.objectCount) {
            const count = editor.objects.length;
            dom.objectCount.textContent = `${count} ${count === 1 ? 'object' : 'objects'}`;
        }
    }

    function syncOptionRows() {
        if (!isMounted) return;
        const active = TOOL_OPTIONS[editor.tool] || [];
        dom.optionRows.forEach((row) => {
            row.classList.toggle('hidden', !active.includes(row.dataset.annotateOption));
        });
        if (dom.hint) dom.hint.textContent = TOOL_HINTS[editor.tool] || '';
    }

    function setTool(tool) {
        if (!TOOL_OPTIONS[tool]) return;
        commitPendingText();
        editor.tool = tool;
        dom.toolButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.annotateTool === tool);
        });
        dom.canvas?.setAttribute('data-tool', tool);
        syncOptionRows();
    }

    function resizeCanvasToImage() {
        if (!isMounted || !isImageReady()) return;
        const image = elements.sourceImage;
        editor.source = { width: image.naturalWidth, height: image.naturalHeight };

        const longest = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = longest > VIEW_MAX_DIMENSION ? VIEW_MAX_DIMENSION / longest : 1;
        const viewWidth = Math.max(1, Math.round(image.naturalWidth * scale));
        const viewHeight = Math.max(1, Math.round(image.naturalHeight * scale));

        editor.view = { width: viewWidth, height: viewHeight, scale };
        dom.canvas.width = viewWidth;
        dom.canvas.height = viewHeight;
        dom.canvas.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
    }

    function drawPen(ctx, object, scale) {
        if (object.points.length < 2) {
            const only = object.points[0];
            if (!only) return;
            ctx.beginPath();
            ctx.arc(only.x * scale, only.y * scale, Math.max(0.5, (object.strokeWidth * scale) / 2), 0, Math.PI * 2);
            ctx.fillStyle = object.color;
            ctx.fill();
            return;
        }
        ctx.beginPath();
        ctx.moveTo(object.points[0].x * scale, object.points[0].y * scale);
        for (let index = 1; index < object.points.length; index += 1) {
            ctx.lineTo(object.points[index].x * scale, object.points[index].y * scale);
        }
        ctx.stroke();
    }

    function drawArrowHead(ctx, object, scale) {
        const fromX = object.x1 * scale;
        const fromY = object.y1 * scale;
        const toX = object.x2 * scale;
        const toY = object.y2 * scale;
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const length = Math.hypot(toX - fromX, toY - fromY);
        const head = Math.min(Math.max(object.strokeWidth * scale * 3.2, 10), Math.max(length, 10));
        const spread = Math.PI / 7;

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - head * Math.cos(angle - spread), toY - head * Math.sin(angle - spread));
        ctx.lineTo(toX - head * Math.cos(angle + spread), toY - head * Math.sin(angle + spread));
        ctx.closePath();
        ctx.fillStyle = object.color;
        ctx.fill();
    }

    // Blur objects resample whatever has already been painted, so they hide the
    // image and any marks underneath them and still replay correctly on undo.
    function drawBlurRegion(ctx, object, scale) {
        const x = Math.round(Math.min(object.x, object.x + object.w) * scale);
        const y = Math.round(Math.min(object.y, object.y + object.h) * scale);
        const width = Math.round(Math.abs(object.w) * scale);
        const height = Math.round(Math.abs(object.h) * scale);
        if (width < MIN_BOX_SIZE || height < MIN_BOX_SIZE) return;

        const strength = Math.max(1, object.strength * scale);

        if (object.mode === 'blur') {
            // Sample past the edges so the blur kernel has real pixels to pull
            // from instead of smearing transparency inward.
            const pad = Math.ceil(strength * 2);
            const sx = Math.max(0, x - pad);
            const sy = Math.max(0, y - pad);
            const sw = Math.min(ctx.canvas.width - sx, width + pad * 2);
            const sh = Math.min(ctx.canvas.height - sy, height + pad * 2);
            if (sw <= 0 || sh <= 0) return;

            const sample = document.createElement('canvas');
            sample.width = sw;
            sample.height = sh;
            sample.getContext('2d').drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.clip();
            ctx.filter = `blur(${strength}px)`;
            ctx.drawImage(sample, sx, sy);
            ctx.restore();
            return;
        }

        // Pixelate: shrink the region, then paint it back with smoothing off.
        const block = Math.max(2, strength);
        const smallWidth = Math.max(1, Math.round(width / block));
        const smallHeight = Math.max(1, Math.round(height / block));
        const sample = document.createElement('canvas');
        sample.width = smallWidth;
        sample.height = smallHeight;
        const sampleCtx = sample.getContext('2d');
        sampleCtx.imageSmoothingEnabled = false;
        sampleCtx.drawImage(ctx.canvas, x, y, width, height, 0, 0, smallWidth, smallHeight);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sample, 0, 0, smallWidth, smallHeight, x, y, width, height);
        ctx.restore();
    }

    function drawFrame(ctx, object, scale) {
        const width = Math.max(1, object.strokeWidth * scale);
        const inset = width / 2;
        ctx.save();
        ctx.lineWidth = width;
        ctx.strokeStyle = object.color;
        ctx.lineJoin = 'miter';
        if (object.rounded) {
            const radius = Math.max(width, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.06);
            traceRoundedRect(ctx, inset, inset, ctx.canvas.width - width, ctx.canvas.height - width, radius);
            ctx.stroke();
        } else {
            ctx.strokeRect(inset, inset, ctx.canvas.width - width, ctx.canvas.height - width);
        }
        ctx.restore();
    }

    function drawBox(ctx, object, scale) {
        const x = Math.min(object.x, object.x + object.w) * scale;
        const y = Math.min(object.y, object.y + object.h) * scale;
        const width = Math.abs(object.w) * scale;
        const height = Math.abs(object.h) * scale;

        if (object.type === 'rect') {
            if (object.fill) {
                ctx.fillStyle = hexToRgba(object.fillColor, object.fillOpacity);
                ctx.fillRect(x, y, width, height);
            }
            ctx.strokeRect(x, y, width, height);
            return;
        }

        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        if (object.fill) {
            ctx.fillStyle = hexToRgba(object.fillColor, object.fillOpacity);
            ctx.fill();
        }
        ctx.stroke();
    }

    function drawObject(ctx, object, scale) {
        if (!object) return;
        if (object.type === 'blur') {
            drawBlurRegion(ctx, object, scale);
            return;
        }
        if (object.type === 'frame') {
            drawFrame(ctx, object, scale);
            return;
        }

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = object.color;
        ctx.lineWidth = Math.max(0.5, (object.strokeWidth || 1) * scale);

        switch (object.type) {
            case 'pen':
                drawPen(ctx, object, scale);
                break;
            case 'line':
                ctx.beginPath();
                ctx.moveTo(object.x1 * scale, object.y1 * scale);
                ctx.lineTo(object.x2 * scale, object.y2 * scale);
                ctx.stroke();
                break;
            case 'arrow':
                ctx.beginPath();
                ctx.moveTo(object.x1 * scale, object.y1 * scale);
                ctx.lineTo(object.x2 * scale, object.y2 * scale);
                ctx.stroke();
                drawArrowHead(ctx, object, scale);
                break;
            case 'rect':
            case 'ellipse':
                drawBox(ctx, object, scale);
                break;
            case 'text': {
                const size = Math.max(1, object.size * scale);
                ctx.font = `600 ${size}px "Plus Jakarta Sans", "Inter", system-ui, sans-serif`;
                ctx.textBaseline = 'top';
                // A dark halo keeps light text readable over busy screenshots.
                ctx.lineWidth = Math.max(1, size * 0.14);
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.strokeText(object.text, object.x * scale, object.y * scale);
                ctx.fillStyle = object.color;
                ctx.fillText(object.text, object.x * scale, object.y * scale);
                break;
            }
            default:
                break;
        }

        ctx.restore();
    }

    function renderToContext(ctx, scale, { background = null, extra = null } = {}) {
        if (!ctx || !isImageReady()) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        ctx.drawImage(elements.sourceImage, 0, 0, ctx.canvas.width, ctx.canvas.height);

        editor.objects.forEach((object) => drawObject(ctx, object, scale));
        if (extra) drawObject(ctx, extra, scale);
    }

    function render(extra = null) {
        if (!isMounted) return;
        renderToContext(getContext(), editor.view.scale || 1, { extra });
    }

    function pushObject(object) {
        editor.objects.push(object);
        editor.redoStack.length = 0;
        syncHistoryButtons();
        render();
    }

    function undo() {
        if (!editor.objects.length) return;
        editor.redoStack.push(editor.objects.pop());
        syncHistoryButtons();
        render();
    }

    function redo() {
        if (!editor.redoStack.length) return;
        editor.objects.push(editor.redoStack.pop());
        syncHistoryButtons();
        render();
    }

    function clearObjects() {
        if (!editor.objects.length) return;
        // Reversed so repeated redo rebuilds the drawing in its original order.
        editor.redoStack = editor.objects.slice().reverse();
        editor.objects = [];
        syncHistoryButtons();
        render();
    }

    function getPointerPosition(event) {
        const rect = dom.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return { x: 0, y: 0 };
        const scaleX = editor.source.width / rect.width;
        const scaleY = editor.source.height / rect.height;
        return {
            x: clamp((event.clientX - rect.left) * scaleX, 0, editor.source.width),
            y: clamp((event.clientY - rect.top) * scaleY, 0, editor.source.height)
        };
    }

    function hideTextInput() {
        if (!dom.textInput) return;
        dom.textInput.classList.add('hidden');
        dom.textInput.value = '';
        editor.pendingText = null;
    }

    function commitPendingText() {
        if (!editor.pendingText || !dom.textInput) return;
        const value = dom.textInput.value.trim();
        const { x, y, size, color } = editor.pendingText;
        hideTextInput();
        if (!value) return;
        pushObject({ type: 'text', x, y, size, color, text: value });
    }

    function openTextInput(position) {
        if (!dom.textInput || !dom.canvasFrame) return;
        commitPendingText();

        const screenSize = Number.parseFloat(dom.fontSize?.value || '36') || 36;
        editor.pendingText = {
            x: position.x,
            y: position.y,
            size: toSourceUnits(screenSize),
            color: readStrokeColor()
        };

        const canvasRect = dom.canvas.getBoundingClientRect();
        const frameRect = dom.canvasFrame.getBoundingClientRect();
        const left = (position.x / editor.source.width) * canvasRect.width + (canvasRect.left - frameRect.left);
        const top = (position.y / editor.source.height) * canvasRect.height + (canvasRect.top - frameRect.top);

        dom.textInput.classList.remove('hidden');
        dom.textInput.style.left = `${left}px`;
        dom.textInput.style.top = `${top}px`;
        dom.textInput.style.fontSize = `${Math.max(12, screenSize)}px`;
        dom.textInput.style.color = editor.pendingText.color;
        dom.textInput.value = '';
        dom.textInput.focus();
    }

    function applyFrame() {
        if (!isImageReady()) return;
        const screenWidth = Number.parseFloat(dom.frameWidth?.value || '24') || 24;
        pushObject({
            type: 'frame',
            color: dom.frameColor?.value || '#111827',
            strokeWidth: toSourceUnits(screenWidth),
            rounded: Boolean(dom.frameRounded?.checked)
        });
    }

    function startDraft(position) {
        const color = readStrokeColor();
        const strokeWidth = readStrokeWidth();

        switch (editor.tool) {
            case 'pen':
                return { type: 'pen', color, strokeWidth, points: [position] };
            case 'line':
            case 'arrow':
                return {
                    type: editor.tool,
                    color,
                    strokeWidth,
                    x1: position.x,
                    y1: position.y,
                    x2: position.x,
                    y2: position.y
                };
            case 'rect':
            case 'ellipse':
                return {
                    type: editor.tool,
                    color,
                    strokeWidth,
                    ...readFillSettings(),
                    x: position.x,
                    y: position.y,
                    w: 0,
                    h: 0
                };
            case 'blur':
                return {
                    type: 'blur',
                    mode: dom.blurMode?.value === 'blur' ? 'blur' : 'pixelate',
                    strength: toSourceUnits(Number.parseFloat(dom.blurStrength?.value || '12') || 12),
                    x: position.x,
                    y: position.y,
                    w: 0,
                    h: 0
                };
            default:
                return null;
        }
    }

    function updateDraft(position) {
        const draft = editor.draft;
        if (!draft) return;

        if (draft.type === 'pen') {
            const last = draft.points[draft.points.length - 1];
            if (!last || Math.hypot(position.x - last.x, position.y - last.y) > 0.5) {
                draft.points.push(position);
            }
            return;
        }
        if (draft.type === 'line' || draft.type === 'arrow') {
            draft.x2 = position.x;
            draft.y2 = position.y;
            return;
        }
        draft.w = position.x - draft.x;
        draft.h = position.y - draft.y;
    }

    // A draft is only worth committing once it covers a meaningful distance;
    // otherwise a stray click would leave an invisible object in the list.
    function isCommittableDraft(draft) {
        if (!draft) return false;
        if (draft.type === 'pen') return draft.points.length > 0;
        if (draft.type === 'line' || draft.type === 'arrow') {
            return Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 1;
        }
        return Math.abs(draft.w) >= MIN_BOX_SIZE && Math.abs(draft.h) >= MIN_BOX_SIZE;
    }

    function handlePointerDown(event) {
        if (!isMounted || !isImageReady()) return;
        if (event.button !== undefined && event.button > 0) return;

        const position = getPointerPosition(event);

        if (editor.tool === 'text') {
            event.preventDefault();
            openTextInput(position);
            return;
        }
        if (editor.tool === 'frame') {
            event.preventDefault();
            applyFrame();
            return;
        }

        commitPendingText();
        event.preventDefault();
        editor.pointerId = event.pointerId;
        editor.draft = startDraft(position);
        dom.canvas.setPointerCapture?.(event.pointerId);
        render(editor.draft);
    }

    function handlePointerMove(event) {
        if (!editor.draft || event.pointerId !== editor.pointerId) return;
        event.preventDefault();
        updateDraft(getPointerPosition(event));
        render(editor.draft);
    }

    function handlePointerUp(event) {
        if (!editor.draft || event.pointerId !== editor.pointerId) return;
        event.preventDefault();
        updateDraft(getPointerPosition(event));

        const draft = editor.draft;
        editor.draft = null;
        editor.pointerId = null;
        if (dom.canvas.hasPointerCapture?.(event.pointerId)) {
            dom.canvas.releasePointerCapture(event.pointerId);
        }

        if (isCommittableDraft(draft)) pushObject(draft);
        else render();
    }

    function cancelDraft() {
        if (!editor.draft) return;
        editor.draft = null;
        editor.pointerId = null;
        render();
    }

    async function exportImage(type) {
        const format = EXPORT_FORMATS[type];
        if (!format || !isImageReady()) {
            if (elements.statusText) elements.statusText.textContent = 'No image loaded.';
            return;
        }

        commitPendingText();

        const canvas = document.createElement('canvas');
        canvas.width = editor.source.width;
        canvas.height = editor.source.height;
        renderToContext(canvas.getContext('2d'), 1, { background: format.background });

        try {
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    (result) => (result ? resolve(result) : reject(new Error('Canvas export failed.'))),
                    format.mime,
                    format.quality
                );
            });

            // Browsers silently fall back to PNG for unsupported types.
            if (blob.type !== format.mime) {
                throw new Error(`${format.label} export is not supported by this browser.`);
            }

            downloadBlob(blob, `${getImageBaseName()}_annotated.${format.extension}`);
            if (elements.statusText) {
                elements.statusText.textContent = `Saved ${format.label} at ${canvas.width}×${canvas.height}.`;
            }
        } catch (error) {
            console.error('Annotate export failed:', error);
            if (elements.statusText) {
                elements.statusText.textContent = error.message || 'Failed to export the annotated image.';
            }
        }
    }

    function resetForNewImage() {
        editor.objects = [];
        editor.redoStack = [];
        editor.draft = null;
        editor.pointerId = null;
        hideTextInput();
    }

    function onSourceImageLoaded() {
        if (!isMounted) return;
        // Every tab shares one <img>. A new generation means a different import,
        // so markup drawn over the previous image has to go.
        if (editor.generation !== state.sourceGeneration) {
            editor.generation = state.sourceGeneration;
            resetForNewImage();
        }
        syncEmptyState();
        resizeCanvasToImage();
        syncHistoryButtons();
        render();
    }

    function onTabActivated() {
        if (!isMounted) return;
        syncEmptyState();
        if (hasSingleImageLoaded() && isImageReady()) {
            if (editor.generation !== state.sourceGeneration) {
                editor.generation = state.sourceGeneration;
                resetForNewImage();
                syncHistoryButtons();
            }
            resizeCanvasToImage();
            render();
        }
        syncOptionRows();
        syncHistoryButtons();
    }

    function bindSliderReadout(input, output, format = (value) => value) {
        if (!input || !output) return;
        const sync = () => {
            output.textContent = format(input.value);
        };
        input.addEventListener('input', sync);
        sync();
    }

    function bindEvents() {
        if (!isMounted) return;

        dom.toolButtons.forEach((button) => {
            button.addEventListener('click', () => setTool(button.dataset.annotateTool));
        });

        bindSliderReadout(dom.strokeWidth, dom.strokeWidthValue);
        bindSliderReadout(dom.fontSize, dom.fontSizeValue);
        bindSliderReadout(dom.blurStrength, dom.blurStrengthValue);
        bindSliderReadout(dom.frameWidth, dom.frameWidthValue);
        bindSliderReadout(dom.fillOpacity, dom.fillOpacityValue, (value) => `${value}%`);

        dom.frameApply?.addEventListener('click', applyFrame);
        dom.undoBtn?.addEventListener('click', undo);
        dom.redoBtn?.addEventListener('click', redo);
        dom.clearBtn?.addEventListener('click', clearObjects);

        dom.savePngBtn?.addEventListener('click', () => void exportImage('png'));
        dom.saveJpgBtn?.addEventListener('click', () => void exportImage('jpg'));
        dom.saveWebpBtn?.addEventListener('click', () => void exportImage('webp'));

        dom.canvas.addEventListener('pointerdown', handlePointerDown);
        dom.canvas.addEventListener('pointermove', handlePointerMove);
        dom.canvas.addEventListener('pointerup', handlePointerUp);
        dom.canvas.addEventListener('pointercancel', cancelDraft);

        if (dom.textInput) {
            dom.textInput.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitPendingText();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    hideTextInput();
                }
            });
            dom.textInput.addEventListener('blur', commitPendingText);
        }

        document.addEventListener('keydown', (event) => {
            if (state.activeTab !== 'annotate') return;
            if (String(event.key).toLowerCase() !== 'z') return;
            if (!event.metaKey && !event.ctrlKey) return;
            const target = event.target;
            if (target instanceof HTMLElement && target.matches('input, textarea, select')) return;
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
        });

        window.addEventListener('resize', () => {
            if (state.activeTab === 'annotate') hideTextInput();
        });

        setTool(editor.tool);
        syncHistoryButtons();
        syncEmptyState();
    }

    return {
        bindEvents,
        onSourceImageLoaded,
        onTabActivated,
        setTool,
        undo,
        redo
    };
}
