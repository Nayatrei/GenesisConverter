/**
 * Shared colour-adjustment maths for the Genesis image tools.
 *
 * This module is deliberately UI-free: it knows nothing about the DOM beyond
 * `ImageData` and canvas-shaped objects, so the Raster tab and the Bulk tab can
 * both drive it from their own controllers. Every exported function is pure
 * with respect to the adjustment object; the pixel entry points mutate the
 * buffer they are handed (documented per function) because copying a full-size
 * `ImageData` on every slider tick is the single most expensive thing this
 * pipeline could do.
 *
 * Performance shape:
 *   - brightness / exposure / contrast / gamma / temperature are per-channel and
 *     independent of neighbouring pixels, so they collapse into three 256-entry
 *     lookup tables built once per call.
 *   - saturation / vibrance need the pixel's own luminance only, so they ride
 *     along in the same pass as the LUT lookups.
 *   - clarity is the one neighbourhood operation. It costs an extra luminance
 *     pass plus a separable box blur, and is skipped entirely when the slider
 *     sits at 0.
 */

/**
 * Neutral adjustment set. Every slider is 0 at rest, so a shallow copy of this
 * object is both the reset value and the "no work to do" sentinel.
 * @typedef {{brightness:number, exposure:number, contrast:number, gamma:number,
 *            saturation:number, vibrance:number, temperature:number, clarity:number}} Adjustments
 * @type {Readonly<Adjustments>}
 */
export const DEFAULT_ADJUSTMENTS = Object.freeze({
    brightness: 0,
    exposure: 0,
    contrast: 0,
    gamma: 0,
    saturation: 0,
    vibrance: 0,
    temperature: 0,
    clarity: 0
});

/** Stable key order for iterating sliders in the UI. @type {readonly string[]} */
export const ADJUSTMENT_KEYS = Object.freeze(Object.keys(DEFAULT_ADJUSTMENTS));

/**
 * Slider metadata. Every adjustment shares the same -100..100 scale so the UI
 * can render one uniform row per key and so preset values stay readable.
 * @type {Readonly<Record<string, Readonly<{min:number, max:number, step:number, label:string, hint:string}>>>}
 */
export const ADJUSTMENT_RANGES = Object.freeze({
    brightness: Object.freeze({ min: -100, max: 100, step: 1, label: 'Brightness', hint: 'Lifts or lowers every tone evenly.' }),
    exposure: Object.freeze({ min: -100, max: 100, step: 1, label: 'Exposure', hint: 'Multiplies light, up to two stops each way.' }),
    contrast: Object.freeze({ min: -100, max: 100, step: 1, label: 'Contrast', hint: 'Spreads tones away from mid grey.' }),
    gamma: Object.freeze({ min: -100, max: 100, step: 1, label: 'Gamma', hint: 'Bends midtones without clipping the ends.' }),
    saturation: Object.freeze({ min: -100, max: 100, step: 1, label: 'Saturation', hint: 'Scales all colour; -100 is greyscale.' }),
    vibrance: Object.freeze({ min: -100, max: 100, step: 1, label: 'Vibrance', hint: 'Boosts muted colour, protects strong colour.' }),
    temperature: Object.freeze({ min: -100, max: 100, step: 1, label: 'Temperature', hint: 'Cool blue through warm amber.' }),
    clarity: Object.freeze({ min: -100, max: 100, step: 1, label: 'Clarity', hint: 'Local midtone contrast on luminance.' })
});

/**
 * Named starting points shown as chips above the sliders. `original` is the
 * neutral set; `mono` reaches greyscale through saturation -100.
 * @type {Readonly<Record<string, Readonly<Adjustments>>>}
 */
export const FILTER_PRESETS = Object.freeze({
    original: Object.freeze({ ...DEFAULT_ADJUSTMENTS }),
    warm: Object.freeze({ ...DEFAULT_ADJUSTMENTS, temperature: 34, saturation: 12, contrast: 8, brightness: 4 }),
    cool: Object.freeze({ ...DEFAULT_ADJUSTMENTS, temperature: -32, saturation: 8, contrast: 10, gamma: 6 }),
    mono: Object.freeze({ ...DEFAULT_ADJUSTMENTS, saturation: -100, contrast: 16, clarity: 14 }),
    fade: Object.freeze({ ...DEFAULT_ADJUSTMENTS, contrast: -24, brightness: 10, saturation: -20, gamma: 14 })
});

/** Chip order for the preset row. @type {readonly string[]} */
export const FILTER_PRESET_ORDER = Object.freeze(['original', 'warm', 'cool', 'mono', 'fade']);

/** Display copy for each preset chip. @type {Readonly<Record<string, string>>} */
export const FILTER_PRESET_LABELS = Object.freeze({
    original: 'Original',
    warm: 'Warm',
    cool: 'Cool',
    mono: 'Mono',
    fade: 'Fade'
});

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return 0;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/**
 * Fills in missing keys and clamps every value into its declared range.
 * Always returns a fresh plain object, so callers can safely store the result.
 * @param {Partial<Adjustments>} [adjustments]
 * @returns {Adjustments}
 */
export function normalizeAdjustments(adjustments) {
    const source = adjustments || {};
    const result = {};
    for (const key of ADJUSTMENT_KEYS) {
        const range = ADJUSTMENT_RANGES[key];
        const raw = Number(source[key]);
        result[key] = clampNumber(Number.isFinite(raw) ? raw : DEFAULT_ADJUSTMENTS[key], range.min, range.max);
    }
    return result;
}

/**
 * True when the adjustment set would leave pixels untouched. Callers use this
 * to skip the whole pixel pipeline on an unedited image.
 * @param {Partial<Adjustments>} [adjustments]
 * @returns {boolean}
 */
export function isNeutralAdjustments(adjustments) {
    const normalized = normalizeAdjustments(adjustments);
    return ADJUSTMENT_KEYS.every((key) => normalized[key] === DEFAULT_ADJUSTMENTS[key]);
}

/**
 * Returns a mutable copy of a named preset, or the neutral set when the name is
 * unknown.
 * @param {string} name
 * @returns {Adjustments}
 */
export function getFilterPreset(name) {
    return normalizeAdjustments(FILTER_PRESETS[name] || DEFAULT_ADJUSTMENTS);
}

/**
 * Finds the preset whose values exactly match the supplied adjustments, so the
 * UI can keep a chip highlighted while nothing has been hand-tweaked.
 * @param {Partial<Adjustments>} adjustments
 * @returns {string|null}
 */
export function matchFilterPreset(adjustments) {
    const normalized = normalizeAdjustments(adjustments);
    return FILTER_PRESET_ORDER.find((name) => {
        const preset = FILTER_PRESETS[name];
        return ADJUSTMENT_KEYS.every((key) => preset[key] === normalized[key]);
    }) || null;
}

/**
 * Builds the three per-channel lookup tables that carry exposure, brightness,
 * contrast, gamma and temperature.
 * @param {Adjustments} adjustments
 * @returns {{red: Uint8ClampedArray, green: Uint8ClampedArray, blue: Uint8ClampedArray}}
 */
function buildChannelLuts(adjustments) {
    // ±100 maps to ±2 stops of light.
    const exposureGain = Math.pow(2, adjustments.exposure / 50);
    // ±100 maps to a little under half the tonal range as a flat offset.
    const brightnessOffset = (adjustments.brightness / 100) * 96;
    // -100 flattens to mid grey, +100 roughly doubles separation.
    const contrastFactor = adjustments.contrast >= 0
        ? 1 + (adjustments.contrast / 100) * 1.2
        : 1 + (adjustments.contrast / 100);
    // +100 → exponent 0.5 (midtones lift), -100 → exponent 2 (midtones drop).
    const gammaExponent = Math.pow(2, -adjustments.gamma / 100);
    const temperature = adjustments.temperature / 100;
    const redGain = 1 + temperature * 0.28;
    const blueGain = 1 - temperature * 0.28;
    // Pulling a touch of green out on either extreme keeps skin tones honest.
    const greenGain = 1 - Math.abs(temperature) * 0.03;

    const red = new Uint8ClampedArray(256);
    const green = new Uint8ClampedArray(256);
    const blue = new Uint8ClampedArray(256);

    for (let i = 0; i < 256; i++) {
        let value = i * exposureGain + brightnessOffset;
        value = (value - 127.5) * contrastFactor + 127.5;
        if (value < 0) value = 0;
        if (value > 255) value = 255;
        if (gammaExponent !== 1) {
            value = 255 * Math.pow(value / 255, gammaExponent);
        }
        red[i] = value * redGain;
        green[i] = value * greenGain;
        blue[i] = value * blueGain;
    }

    return { red, green, blue };
}

/**
 * Separable box blur over a single-channel Float32 plane. Uses a sliding window
 * sum so the cost is O(width * height) regardless of radius.
 * @param {Float32Array} plane
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {Float32Array} a new blurred plane
 */
function boxBlurPlane(plane, width, height, radius) {
    const horizontal = new Float32Array(plane.length);
    const window = radius * 2 + 1;

    for (let y = 0; y < height; y++) {
        const row = y * width;
        let sum = 0;
        for (let x = -radius; x <= radius; x++) {
            sum += plane[row + Math.min(width - 1, Math.max(0, x))];
        }
        for (let x = 0; x < width; x++) {
            horizontal[row + x] = sum / window;
            const outgoing = plane[row + Math.min(width - 1, Math.max(0, x - radius))];
            const incoming = plane[row + Math.min(width - 1, Math.max(0, x + radius + 1))];
            sum += incoming - outgoing;
        }
    }

    const vertical = new Float32Array(plane.length);
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = -radius; y <= radius; y++) {
            sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
        }
        for (let y = 0; y < height; y++) {
            vertical[y * width + x] = sum / window;
            const outgoing = horizontal[Math.min(height - 1, Math.max(0, y - radius)) * width + x];
            const incoming = horizontal[Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x];
            sum += incoming - outgoing;
        }
    }

    return vertical;
}

/**
 * Applies the adjustment set to an `ImageData` buffer **in place** and returns
 * the same object, so callers can chain or ignore the return value.
 *
 * Alpha is never touched: transparency survives every adjustment, which is what
 * the PNG/WEBP/TGA alpha toggle depends on.
 *
 * @param {ImageData} imageData
 * @param {Partial<Adjustments>} adjustments
 * @returns {ImageData} the same buffer, mutated
 */
export function applyAdjustmentsToImageData(imageData, adjustments) {
    if (!imageData || !imageData.data) return imageData;
    const settings = normalizeAdjustments(adjustments);
    if (isNeutralAdjustments(settings)) return imageData;

    const { data, width, height } = imageData;
    const luts = buildChannelLuts(settings);
    const lutR = luts.red;
    const lutG = luts.green;
    const lutB = luts.blue;

    const saturationFactor = 1 + (settings.saturation / 100);
    const vibranceAmount = settings.vibrance / 100;
    const needsColourMix = saturationFactor !== 1 || vibranceAmount !== 0;
    const clarityAmount = (settings.clarity / 100) * 0.9;

    let detail = null;
    if (clarityAmount !== 0 && width > 2 && height > 2) {
        // Luminance is read after the LUTs so clarity sharpens the tones the
        // user is actually looking at, not the untouched original.
        const luminance = new Float32Array(width * height);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            luminance[p] = 0.2126 * lutR[data[i]] + 0.7152 * lutG[data[i + 1]] + 0.0722 * lutB[data[i + 2]];
        }
        const radius = Math.max(1, Math.min(12, Math.round(Math.min(width, height) / 120)));
        const blurred = boxBlurPlane(luminance, width, height, radius);
        detail = luminance;
        for (let p = 0; p < detail.length; p++) {
            detail[p] = (luminance[p] - blurred[p]) * clarityAmount;
        }
    }

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        let r = lutR[data[i]];
        let g = lutG[data[i + 1]];
        let b = lutB[data[i + 2]];

        if (needsColourMix) {
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            if (saturationFactor !== 1) {
                r = lum + (r - lum) * saturationFactor;
                g = lum + (g - lum) * saturationFactor;
                b = lum + (b - lum) * saturationFactor;
            }

            if (vibranceAmount !== 0) {
                const maxChannel = r > g ? (r > b ? r : b) : (g > b ? g : b);
                const minChannel = r < g ? (r < b ? r : b) : (g < b ? g : b);
                // Already-saturated pixels get almost none of the boost.
                const currentSaturation = (maxChannel - minChannel) / 255;
                const mix = 1 + vibranceAmount * (1 - currentSaturation);
                r = lum + (r - lum) * mix;
                g = lum + (g - lum) * mix;
                b = lum + (b - lum) * mix;
            }
        }

        if (detail) {
            const delta = detail[p];
            r += delta;
            g += delta;
            b += delta;
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
    }

    return imageData;
}

/**
 * Applies adjustments to either an `ImageData` or anything canvas-shaped
 * (`HTMLCanvasElement`, `OffscreenCanvas`) and returns the same kind of object.
 *
 * Both paths mutate their input rather than allocating a copy. Pass a scratch
 * canvas if the caller needs the original preserved.
 *
 * @param {ImageData|HTMLCanvasElement|OffscreenCanvas} source
 * @param {Partial<Adjustments>} adjustments
 * @returns {ImageData|HTMLCanvasElement|OffscreenCanvas} the same object, mutated
 */
export function applyAdjustments(source, adjustments) {
    if (!source) return source;

    if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
        return applyAdjustmentsToImageData(source, adjustments);
    }

    if (typeof source.getContext !== 'function') return source;
    if (isNeutralAdjustments(adjustments)) return source;

    const width = source.width;
    const height = source.height;
    if (!width || !height) return source;

    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) return source;

    const imageData = ctx.getImageData(0, 0, width, height);
    applyAdjustmentsToImageData(imageData, adjustments);
    ctx.putImageData(imageData, 0, 0);
    return source;
}
