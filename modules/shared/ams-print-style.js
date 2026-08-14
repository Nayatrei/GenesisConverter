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

function setObjParams(target, styleId, preset) {
    if (!target?.objParams) return;
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
