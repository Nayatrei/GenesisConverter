/**
 * Tab Case Registry
 * -----------------
 * Each tab declares — in one place — what its first column (sidebar) and
 * second column (workspace) should look like. This replaces the scattered
 * `classList.toggle('hidden', ...)` calls that used to live in converter.js.
 *
 * To add a new tab or change what a tab shows, edit the registry entry —
 * the applier walks the DOM by `data-case-section` and turns sections on
 * or off based on the active case's `sections` set.
 *
 * Case identifiers used here:
 *   Sidebar sections:
 *     - import-image      Single-image import block
 *     - import-folder     Folder import block (same DOM node, different copy)
 *     - import-url        URL paste row (inside the import block)
 *     - adjust            "Adjust Conversion" parent accordion
 *     - adjust-svg        SVG color + path/curve controls
 *     - adjust-logo       Logo color + path/curve controls
 *     - adjust-3d         Shared 3D export settings
 *     - footer            The bottom action shelf
 *     - footer-svg        SVG generate-preview button
 *     - footer-logo       Logo generate-preview button
 *
 *   Workspace sections:
 *     - original-image    Single-image preview card
 *     - original-folder   Folder list card
 */

export const TAB_CASES = {
    svg: {
        label: 'SVG',
        eyebrow: 'Vector Trace',
        title: 'Color-layer SVG',
        description: 'Trace bitmap into colored vector layers for 3D printing.',
        accent: '#38bdf8',
        accentSoft: 'rgba(56, 189, 248, 0.16)',
        accentRgb: '56, 189, 248',
        importTitle: '1. Load Image',
        importButton: 'Import From Device',
        importCopy: 'Choose a single image from your device or paste a direct image URL. Supported imports: {{formats}}.',
        importAria: 'Import an image from your device',
        sections: new Set([
            'import-image',
            'import-url',
            'adjust',
            'adjust-svg',
            'adjust-3d',
            'footer',
            'footer-svg'
        ])
    },

    logo: {
        label: 'Logo',
        eyebrow: 'Brand Mark',
        title: 'Logo Vector',
        description: 'Trace a logo or graphic into clean, layered vectors.',
        accent: '#a78bfa',
        accentSoft: 'rgba(167, 139, 250, 0.16)',
        accentRgb: '167, 139, 250',
        importTitle: '1. Load Image',
        importButton: 'Import From Device',
        importCopy: 'Choose a single image from your device or paste a direct image URL. Supported imports: {{formats}}.',
        importAria: 'Import an image from your device',
        sections: new Set([
            'import-image',
            'import-url',
            'adjust',
            'adjust-logo',
            'adjust-3d',
            'footer',
            'footer-logo'
        ])
    },

    raster: {
        label: 'Raster',
        eyebrow: 'Pixel Resize',
        title: 'Raster Export',
        description: 'Resize and export bitmap images as JPG, PNG, or TGA.',
        accent: '#fbbf24',
        accentSoft: 'rgba(251, 191, 36, 0.16)',
        accentRgb: '251, 191, 36',
        importTitle: '1. Load Image',
        importButton: 'Import From Device',
        importCopy: 'Choose a single image from your device or paste a direct image URL. Supported imports: {{formats}}.',
        importAria: 'Import an image from your device',
        sections: new Set([
            'import-image',
            'import-url'
        ])
    },

    bulk: {
        label: 'Bulk',
        eyebrow: 'Batch Folder',
        title: 'Bulk Resize',
        description: 'Resize an entire folder of images and download as a ZIP.',
        accent: '#34d399',
        accentSoft: 'rgba(52, 211, 153, 0.16)',
        accentRgb: '52, 211, 153',
        importTitle: '1. Load Folder',
        importButton: 'Choose Folder',
        importCopy: 'Scan a folder of {{formats}} for batch resize and ZIP export.',
        importAria: 'Choose a folder for bulk conversion',
        sections: new Set([
            'import-image',
            'original-folder'
        ])
    },

    pdf: {
        label: 'PDF',
        eyebrow: 'Document Stack',
        title: 'PDF Merger',
        description: 'Combine PDFs with page-range selection.',
        accent: '#f87171',
        accentSoft: 'rgba(248, 113, 113, 0.16)',
        accentRgb: '248, 113, 113',
        importTitle: null,
        importButton: null,
        importCopy: null,
        importAria: null,
        sections: new Set([])
    }
};

const SIDEBAR_SECTION_NODES = [
    'import-image',
    'import-url',
    'adjust',
    'adjust-svg',
    'adjust-logo',
    'adjust-3d',
    'footer',
    'footer-svg',
    'footer-logo'
];

const WORKSPACE_SECTION_NODES = [
    'original-image',
    'original-folder'
];

/**
 * Apply a tab's case configuration to the DOM. Walks every element tagged
 * with `data-case-section` and toggles `.hidden` based on whether the case
 * declares it active. Also updates import-block copy, the case identity
 * strip, and the `--case-accent` CSS variable that drives accent coloring.
 *
 * @param {string} name              Tab name (svg/logo/raster/bulk/pdf)
 * @param {object} ctx               Shared context
 * @param {string} ctx.importablePrompt  Prompt fragment listing accepted formats
 * @param {boolean} ctx.svgIsDirty       Whether SVG controls have been touched
 * @param {boolean} ctx.logoIsDirty      Whether Logo controls have been touched
 * @returns {object|null} The applied case config, or null if name is unknown.
 */
export function applyTabCase(name, ctx = {}) {
    const caseConfig = TAB_CASES[name];
    if (!caseConfig) return null;

    const { sections } = caseConfig;
    const importablePrompt = ctx.importablePrompt || 'image files';

    // --- 1. Sidebar visibility ---------------------------------------------
    SIDEBAR_SECTION_NODES.forEach((sectionId) => {
        const nodes = document.querySelectorAll(`[data-case-section~="${sectionId}"]`);
        if (!nodes.length) return;
        const visible = sections.has(sectionId);
        nodes.forEach((node) => node.classList.toggle('hidden', !visible));
    });

    // --- 2. Workspace original-image panel ---------------------------------
    // Single panel that flips between an image preview and a folder list,
    // or is hidden entirely (SVG/Logo/Raster/PDF).
    const showImagePreview = sections.has('original-image');
    const showFolderList = sections.has('original-folder');
    const showOriginalPanel = showImagePreview || showFolderList;

    document.querySelectorAll('[data-case-section~="original-panel"]').forEach((node) => {
        node.classList.toggle('hidden', !showOriginalPanel);
    });
    document.querySelectorAll('[data-case-section~="original-image"]').forEach((node) => {
        node.classList.toggle('hidden', !showImagePreview);
    });
    document.querySelectorAll('[data-case-section~="original-folder"]').forEach((node) => {
        node.classList.toggle('hidden', !showFolderList);
    });

    // --- 3. Import block copy + labels -------------------------------------
    const importTitleEl = document.getElementById('import-panel-title');
    const importBtnLabelEl = document.getElementById('import-btn-label');
    const importCopyEl = document.getElementById('import-mode-copy');
    const importBtnEl = document.getElementById('import-btn');

    if (importTitleEl && caseConfig.importTitle) {
        importTitleEl.textContent = caseConfig.importTitle;
    }
    if (importBtnLabelEl && caseConfig.importButton) {
        importBtnLabelEl.textContent = caseConfig.importButton;
    }
    if (importCopyEl && caseConfig.importCopy) {
        importCopyEl.textContent = caseConfig.importCopy.replace('{{formats}}', importablePrompt);
    }
    if (importBtnEl && caseConfig.importAria) {
        importBtnEl.setAttribute('aria-label', caseConfig.importAria);
    }

    // --- 4. Dirty-state reset buttons (live, not in static case) ----------
    const svgResetBtn = document.getElementById('reset-btn');
    const logoResetBtn = document.getElementById('logo-reset-btn');
    if (svgResetBtn) {
        svgResetBtn.classList.remove('hidden');
        svgResetBtn.style.display = (name === 'svg' && ctx.svgIsDirty) ? 'inline' : 'none';
    }
    if (logoResetBtn) {
        logoResetBtn.classList.remove('hidden');
        logoResetBtn.style.display = (name === 'logo' && ctx.logoIsDirty) ? 'inline' : 'none';
    }

    // --- 5. Case identity strip --------------------------------------------
    const strip = document.getElementById('tab-case-strip');
    if (strip) {
        strip.dataset.case = name;
        const eyebrowEl = strip.querySelector('[data-case-eyebrow]');
        const titleEl = strip.querySelector('[data-case-title]');
        const descEl = strip.querySelector('[data-case-desc]');
        const badgeEl = strip.querySelector('[data-case-badge]');
        if (eyebrowEl) eyebrowEl.textContent = caseConfig.eyebrow;
        if (titleEl) titleEl.textContent = caseConfig.title;
        if (descEl) descEl.textContent = caseConfig.description;
        if (badgeEl) badgeEl.textContent = caseConfig.label;
    }

    // --- 6. Accent CSS variable on app shell ------------------------------
    const shell = document.querySelector('.app-shell');
    if (shell) {
        shell.style.setProperty('--case-accent', caseConfig.accent);
        shell.style.setProperty('--case-accent-soft', caseConfig.accentSoft);
        shell.style.setProperty('--case-accent-rgb', caseConfig.accentRgb);
        shell.dataset.activeCase = name;
    }

    return caseConfig;
}
