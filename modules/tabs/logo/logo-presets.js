const LIMITS = Object.freeze({
    fontSize: [12, 112],
    width: [120, 720],
    height: [70, 420],
    radius: [0, 210],
    border: [0, 18],
    tracking: [-2, 18]
});

export const DEFAULT_LOGO_PRESET_ID = 'capsule-wordmark';

export const LOGO_PRESETS = Object.freeze([
    {
        id: 'capsule-wordmark',
        name: 'Capsule Wordmark',
        use: 'Brand and product name',
        layout: 'wordmark',
        defaults: {
            primary: 'NORTHLINE',
            secondary: '',
            fontSize: 34,
            width: 360,
            height: 108,
            radius: 54,
            border: 0,
            tracking: 3,
            background: '#2457C5',
            foreground: '#F8FAFC'
        }
    },
    {
        id: 'studio-sign',
        name: 'Studio Sign',
        use: 'Desk and wall sign',
        layout: 'stacked',
        defaults: {
            primary: 'ATELIER 47',
            secondary: 'MADE LOCALLY',
            fontSize: 36,
            width: 430,
            height: 164,
            radius: 22,
            border: 5,
            tracking: 2,
            background: '#172033',
            foreground: '#E9C46A'
        }
    },
    {
        id: 'round-seal',
        name: 'Round Seal',
        use: 'Packaging and maker seal',
        layout: 'seal',
        defaults: {
            primary: 'G',
            secondary: 'GENESIS WORKS',
            fontSize: 82,
            width: 238,
            height: 238,
            radius: 119,
            border: 7,
            tracking: 2,
            background: '#0F766E',
            foreground: '#ECFDF5'
        }
    },
    {
        id: 'monogram-coin',
        name: 'Monogram Coin',
        use: 'Initials and small emblems',
        layout: 'monogram',
        defaults: {
            primary: 'JM',
            secondary: 'EST 24',
            fontSize: 68,
            width: 220,
            height: 220,
            radius: 110,
            border: 8,
            tracking: 1,
            background: '#7C2D12',
            foreground: '#FFF7ED'
        }
    },
    {
        id: 'address-plate',
        name: 'Address Plate',
        use: 'House and room numbers',
        layout: 'number',
        defaults: {
            primary: '204',
            secondary: 'CEDAR',
            fontSize: 72,
            width: 360,
            height: 184,
            radius: 18,
            border: 6,
            tracking: 4,
            background: '#20242B',
            foreground: '#F4F1E8'
        }
    },
    {
        id: 'maker-stamp',
        name: 'Maker Stamp',
        use: 'Workshop identification',
        layout: 'stamp',
        defaults: {
            primary: 'FORM 09',
            secondary: 'MAKER LAB',
            fontSize: 42,
            width: 390,
            height: 166,
            radius: 8,
            border: 7,
            tracking: 3,
            background: '#713F12',
            foreground: '#FEF3C7'
        }
    },
    {
        id: 'key-tag',
        name: 'Key Tag',
        use: 'Keys, bins, and storage',
        layout: 'keytag',
        defaults: {
            primary: 'KEY 07',
            secondary: 'STORAGE',
            fontSize: 38,
            width: 390,
            height: 124,
            radius: 62,
            border: 5,
            tracking: 2,
            background: '#9F1239',
            foreground: '#FFF1F2'
        }
    },
    {
        id: 'ticket-label',
        name: 'Ticket Label',
        use: 'Events and numbered sets',
        layout: 'ticket',
        defaults: {
            primary: 'A-17',
            secondary: 'ENTRY',
            fontSize: 54,
            width: 330,
            height: 164,
            radius: 14,
            border: 5,
            tracking: 4,
            background: '#3F3F46',
            foreground: '#FAFAFA'
        }
    },
    {
        id: 'split-label',
        name: 'Split Label',
        use: 'Shelf and station labels',
        layout: 'split',
        defaults: {
            primary: 'STUDIO',
            secondary: '12',
            fontSize: 38,
            width: 440,
            height: 142,
            radius: 18,
            border: 5,
            tracking: 2,
            background: '#1E3A5F',
            foreground: '#E0F2FE'
        }
    },
    {
        id: 'stacked-block',
        name: 'Stacked Block',
        use: 'Compact badge and patch',
        layout: 'block',
        defaults: {
            primary: 'BOLD',
            secondary: 'WORKS',
            fontSize: 48,
            width: 250,
            height: 250,
            radius: 28,
            border: 6,
            tracking: 3,
            background: '#365314',
            foreground: '#F7FEE7'
        }
    }
]);

export function getLogoPreset(presetId) {
    return LOGO_PRESETS.find((preset) => preset.id === presetId)
        || LOGO_PRESETS.find((preset) => preset.id === DEFAULT_LOGO_PRESET_ID);
}

function clampNumber(value, [minimum, maximum], fallback) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeColor(value, fallback) {
    return /^#[\da-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function normalizeLogoPresetValues(presetId, values = {}) {
    const preset = getLogoPreset(presetId);
    const defaults = preset.defaults;
    const width = clampNumber(values.width, LIMITS.width, defaults.width);
    const height = clampNumber(values.height, LIMITS.height, defaults.height);
    return {
        preset,
        primary: String(values.primary ?? defaults.primary).trim() || defaults.primary,
        secondary: String(values.secondary ?? defaults.secondary).trim(),
        fontSize: clampNumber(values.fontSize, LIMITS.fontSize, defaults.fontSize),
        width,
        height,
        radius: Math.min(
            Math.min(width, height) / 2,
            clampNumber(values.radius, LIMITS.radius, defaults.radius)
        ),
        border: clampNumber(values.border, LIMITS.border, defaults.border),
        tracking: clampNumber(values.tracking, LIMITS.tracking, defaults.tracking),
        background: normalizeColor(values.background, defaults.background),
        foreground: normalizeColor(values.foreground, defaults.foreground)
    };
}

function primaryStyle(values, scale = 1) {
    return [
        'display:block',
        `font-size:${(values.fontSize * scale).toFixed(2)}px`,
        'font-weight:900',
        `letter-spacing:${values.tracking.toFixed(2)}px`,
        'line-height:0.96',
        'white-space:nowrap'
    ].join(';');
}

function secondaryStyle(values, scale = 0.34) {
    return [
        'display:block',
        `font-size:${Math.max(10, values.fontSize * scale).toFixed(2)}px`,
        'font-weight:800',
        `letter-spacing:${Math.max(1, values.tracking * 0.8).toFixed(2)}px`,
        'line-height:1',
        'white-space:nowrap'
    ].join(';');
}

function buildLayoutMarkup(values) {
    const primary = escapeHtml(values.primary);
    const secondary = escapeHtml(values.secondary);
    const foreground = values.foreground;
    const innerBorder = Math.max(2, Math.round(values.border * 0.55));

    switch (values.preset.layout) {
        case 'stacked':
            return `<span style="${primaryStyle(values)}">${primary}</span>
  <span style="${secondaryStyle(values)};margin-top:${Math.max(8, values.fontSize * 0.28).toFixed(1)}px">${secondary}</span>`;
        case 'seal':
            return `<span style="${primaryStyle(values)}">${primary}</span>
  <span style="${secondaryStyle(values, 0.24)};margin-top:${Math.max(8, values.fontSize * 0.12).toFixed(1)}px">${secondary}</span>`;
        case 'monogram':
            return `<span style="${primaryStyle(values)}">${primary}</span>
  <span style="width:${Math.max(44, values.width * 0.42).toFixed(1)}px;height:${Math.max(3, values.border * 0.55).toFixed(1)}px;background-color:${foreground};margin:${Math.max(7, values.fontSize * 0.12).toFixed(1)}px 0"></span>
  <span style="${secondaryStyle(values, 0.25)}">${secondary}</span>`;
        case 'number':
            return `<span style="${primaryStyle(values)}">${primary}</span>
  <span style="width:${Math.max(70, values.width * 0.38).toFixed(1)}px;height:${Math.max(3, values.border * 0.55).toFixed(1)}px;background-color:${foreground};margin:${Math.max(7, values.fontSize * 0.1).toFixed(1)}px 0"></span>
  <span style="${secondaryStyle(values, 0.26)}">${secondary}</span>`;
        case 'stamp':
            return `<span style="
    position:absolute;inset:${Math.max(8, values.border * 1.35).toFixed(1)}px;
    border:${innerBorder}px solid ${foreground};border-radius:${Math.max(0, values.radius * 0.5).toFixed(1)}px;"></span>
  <span style="${primaryStyle(values)};position:relative">${primary}</span>
  <span style="${secondaryStyle(values, 0.3)};position:relative;margin-top:${Math.max(7, values.fontSize * 0.2).toFixed(1)}px">${secondary}</span>`;
        case 'keytag':
            return `<span style="
    width:${Math.max(22, values.height * 0.28).toFixed(1)}px;
    height:${Math.max(22, values.height * 0.28).toFixed(1)}px;
    border-radius:999px;background-color:${foreground};flex:0 0 auto;"></span>
  <span style="display:flex;flex-direction:column;align-items:flex-start;margin-left:${Math.max(14, values.width * 0.045).toFixed(1)}px">
    <span style="${primaryStyle(values)}">${primary}</span>
    <span style="${secondaryStyle(values, 0.28)};margin-top:${Math.max(5, values.fontSize * 0.12).toFixed(1)}px">${secondary}</span>
  </span>`;
        case 'ticket':
            return `<span style="${primaryStyle(values)}">${primary}</span>
  <span style="
    ${secondaryStyle(values, 0.28)};
    width:${Math.max(80, values.width * 0.42).toFixed(1)}px;
    padding-top:${Math.max(7, values.fontSize * 0.14).toFixed(1)}px;
    margin-top:${Math.max(7, values.fontSize * 0.13).toFixed(1)}px;
    border-top:${Math.max(3, values.border * 0.55).toFixed(1)}px solid ${foreground};">${secondary}</span>`;
        case 'split':
            return `<span style="
    display:flex;align-items:center;justify-content:center;
    width:66%;height:100%;">
    <span style="${primaryStyle(values, 0.88)}">${primary}</span>
  </span>
  <span style="width:${Math.max(3, values.border * 0.7).toFixed(1)}px;height:58%;background-color:${foreground};"></span>
  <span style="
    display:flex;align-items:center;justify-content:center;
    width:34%;height:100%;">
    <span style="${primaryStyle(values, 1.08)}">${secondary}</span>
  </span>`;
        case 'block':
            return `<span style="${primaryStyle(values)}">${primary}</span>
  <span style="${primaryStyle(values, 0.72)};margin-top:${Math.max(9, values.fontSize * 0.24).toFixed(1)}px">${secondary}</span>`;
        case 'wordmark':
        default:
            return `<span style="${primaryStyle(values)}">${primary}</span>`;
    }
}

export function buildLogoPresetMarkup(presetId, values = {}) {
    const normalized = normalizeLogoPresetValues(presetId, values);
    const layoutMarkup = buildLayoutMarkup(normalized);
    return `<div style="
  position:relative;display:inline-flex;align-items:center;justify-content:center;
  flex-direction:${normalized.preset.layout === 'split' || normalized.preset.layout === 'keytag' ? 'row' : 'column'};
  box-sizing:border-box;overflow:hidden;
  width:${normalized.width.toFixed(1)}px;height:${normalized.height.toFixed(1)}px;
  border:${normalized.border.toFixed(1)}px solid ${normalized.foreground};
  border-radius:${normalized.radius.toFixed(1)}px;
  background-color:${normalized.background};color:${normalized.foreground};
  font-family:Arial,Helvetica,sans-serif;text-align:center;">
  ${layoutMarkup}
</div>`;
}

function estimateLineWidth(text, fontSize, tracking) {
    const characters = Math.max(1, String(text || '').length);
    return characters * fontSize * 0.62 + Math.max(0, characters - 1) * tracking;
}

export function assessLogoPresetFit(presetId, values = {}) {
    const normalized = normalizeLogoPresetValues(presetId, values);
    const layout = normalized.preset.layout;
    const inset = normalized.border * 2 + 24;
    const primaryScale = layout === 'split' ? 0.88 : 1;
    const availablePrimaryWidth = layout === 'split'
        ? normalized.width * 0.62 - inset
        : layout === 'keytag'
            ? normalized.width - normalized.height * 0.28 - inset - 20
            : normalized.width - inset;
    const primaryWidth = estimateLineWidth(
        normalized.primary,
        normalized.fontSize * primaryScale,
        normalized.tracking
    );
    const errors = [];
    const warnings = [];

    if (primaryWidth > availablePrimaryWidth) {
        errors.push('Primary text is wider than the printable face.');
    }

    if (layout === 'split') {
        const detailWidth = estimateLineWidth(
            normalized.secondary,
            normalized.fontSize * 1.08,
            normalized.tracking
        );
        if (detailWidth > normalized.width * 0.3 - inset * 0.5) {
            errors.push('Detail text is too wide for the number panel.');
        }
    } else if (normalized.secondary) {
        const detailScaleByLayout = {
            seal: 0.24,
            monogram: 0.25,
            number: 0.26,
            stamp: 0.3,
            keytag: 0.28,
            ticket: 0.28,
            block: 0.72
        };
        const detailWidth = estimateLineWidth(
            normalized.secondary,
            Math.max(10, normalized.fontSize * (detailScaleByLayout[layout] || 0.34)),
            Math.max(1, normalized.tracking * 0.8)
        );
        if (detailWidth > normalized.width - inset) {
            errors.push('Detail text is wider than the printable face.');
        }
    }

    const needsTwoLines = !['wordmark', 'split', 'keytag'].includes(layout);
    const estimatedHeight = needsTwoLines
        ? normalized.fontSize * 1.65 + normalized.border * 2 + 22
        : normalized.fontSize * 1.18 + normalized.border * 2 + 18;
    if (estimatedHeight > normalized.height) {
        errors.push('Font size is too tall for this plate height.');
    }
    if (normalized.border > 0 && normalized.border < 2) {
        warnings.push('Borders below 2 px may disappear during layer tracing.');
    }
    if (normalized.width / normalized.height > 5.2) {
        warnings.push('Very wide labels may be auto-fitted smaller on the printer bed.');
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        values: normalized
    };
}
