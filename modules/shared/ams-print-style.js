import {
    DEFAULT_AMS_PRINT_STYLE,
    getAmsPrintStylePreset,
    normalizeAmsPrintStyle
} from '../config.js';

const STYLE_HELPERS = Object.freeze({
    'raised-efficient': '2.4mm base with a 0.6mm color surface. Keeps the raised look while limiting AMS swaps.',
    'face-down': 'Prints the colored face against the plate for a flush finish and uses less model material. The base color joins those face layers, so thin raised color usually creates less AMS purge.',
    'full-depth': 'Uses 4mm color bodies so the sidewalls stay colored. This requires the most AMS swaps.'
});

const FACE_DOWN_STYLE = 'face-down';

function getFaceDownReturnStyle(value) {
    const normalized = normalizeAmsPrintStyle(value);
    return normalized === FACE_DOWN_STYLE ? DEFAULT_AMS_PRINT_STYLE : normalized;
}

function syncFaceDownToggle(controls, styleId) {
    const button = controls?.objFaceDownToggle;
    if (!button) return;

    const isFaceDown = styleId === FACE_DOWN_STYLE;
    const stateLabel = button.querySelector('[data-face-down-state]');
    button.classList.toggle('is-active', isFaceDown);
    button.classList.remove('is-blocked');
    button.setAttribute('aria-pressed', String(isFaceDown));
    button.setAttribute(
        'aria-label',
        isFaceDown
            ? 'Face on Bed is on. Return to the previous raised print style'
            : 'Place the colored face flat on the build plate'
    );
    button.title = isFaceDown
        ? 'Colored regions share the first layer at Z=0; click to restore the previous raised style.'
        : 'Build every color flush against the plate, with the base continuing as backing.';
    if (stateLabel) stateLabel.textContent = isFaceDown ? 'On' : 'Off';
}

function setObjParams(target, styleId, preset) {
    if (!target?.objParams) return;
    const currentStyle = normalizeAmsPrintStyle(target.objParams.amsPrintStyle);
    if (styleId === FACE_DOWN_STYLE && currentStyle !== FACE_DOWN_STYLE) {
        target.objParams.faceDownReturnStyle = getFaceDownReturnStyle(currentStyle);
    } else if (styleId !== FACE_DOWN_STYLE) {
        target.objParams.faceDownReturnStyle = styleId;
    }
    target.objParams.amsPrintStyle = styleId;
    target.objParams.baseThickness = preset.baseThickness;
    target.objParams.thickness = preset.colorThickness;
}

export function getAmsPrintStyleHelper(styleId) {
    return STYLE_HELPERS[normalizeAmsPrintStyle(styleId)] || STYLE_HELPERS[DEFAULT_AMS_PRINT_STYLE];
}

export function syncAmsPrintStyleControls({ rootState, tabState, controls }) {
    const sourceParams = tabState?.objParams || rootState?.objParams || {};
    const styleId = normalizeAmsPrintStyle(sourceParams.amsPrintStyle);
    const preset = getAmsPrintStylePreset(styleId);

    if (controls?.objAmsPrintStyle) {
        controls.objAmsPrintStyle.value = styleId;
        controls.objAmsPrintStyle.dataset.amsPrintStyle = styleId;
    }
    if (controls?.objAmsPrintStyleHelper) {
        controls.objAmsPrintStyleHelper.textContent = getAmsPrintStyleHelper(styleId);
    }
    if (controls?.objBaseThicknessSlider) {
        controls.objBaseThicknessSlider.value = String(sourceParams.baseThickness ?? preset.baseThickness);
    }
    if (controls?.objBaseThicknessValue) {
        controls.objBaseThicknessValue.textContent = String(sourceParams.baseThickness ?? preset.baseThickness);
    }
    if (controls?.objThicknessSlider) {
        controls.objThicknessSlider.value = String(sourceParams.thickness ?? preset.colorThickness);
    }
    if (controls?.objThicknessValue) {
        controls.objThicknessValue.textContent = String(sourceParams.thickness ?? preset.colorThickness);
    }
    syncFaceDownToggle(controls, styleId);
    return { styleId, preset };
}

export function applyAmsPrintStylePreset({ rootState, tabState, controls, styleId }) {
    const normalizedStyleId = normalizeAmsPrintStyle(styleId);
    const preset = getAmsPrintStylePreset(normalizedStyleId);

    setObjParams(rootState, normalizedStyleId, preset);
    if (rootState?.logo) setObjParams(rootState.logo, normalizedStyleId, preset);
    if (tabState && tabState !== rootState && tabState !== rootState?.logo) {
        setObjParams(tabState, normalizedStyleId, preset);
    }

    if (rootState) {
        rootState.layerThicknessById = {};
        rootState.useBaseLayer = true;
        rootState.autoBaseLayerSelectionPending = true;
    }
    if (rootState?.logo) {
        rootState.logo.layerThicknessById = {};
        rootState.logo.useBaseLayer = true;
        rootState.logo.autoBaseLayerSelectionPending = true;
    }
    if (tabState) {
        tabState.layerThicknessById = {};
        tabState.useBaseLayer = true;
        tabState.autoBaseLayerSelectionPending = true;
    }

    ['use-base-layer', 'logo-use-base-layer'].forEach((id) => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.checked = true;
    });
    ['base-layer-select', 'logo-base-layer-select'].forEach((id) => {
        const select = document.getElementById(id);
        if (select) select.disabled = false;
    });

    syncAmsPrintStyleControls({ rootState, tabState, controls });
    return { styleId: normalizedStyleId, preset };
}

export function toggleFaceDownPrintStyle({ rootState, tabState, controls }) {
    const sourceParams = tabState?.objParams || rootState?.objParams || {};
    const currentStyle = normalizeAmsPrintStyle(sourceParams.amsPrintStyle);
    const nextStyle = currentStyle === FACE_DOWN_STYLE
        ? getFaceDownReturnStyle(sourceParams.faceDownReturnStyle)
        : FACE_DOWN_STYLE;

    return applyAmsPrintStylePreset({
        rootState,
        tabState,
        controls,
        styleId: nextStyle
    });
}
