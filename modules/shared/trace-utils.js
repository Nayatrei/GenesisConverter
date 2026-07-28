/**
 * General-purpose debounce utility.
 */
export const debounce = (fn, ms = 250) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
};

/**
 * Returns true if a tracedata layer has any paths.
 */
export function layerHasPaths(layer) {
    return Array.isArray(layer) && layer.length > 0;
}

/**
 * Finds a likely flat image background by looking for a large non-hole path
 * that reaches at least three canvas edges. The result is only a suggestion;
 * callers should require an explicit user action before hiding it.
 */
export function detectBackgroundLayerIndex(tracedata) {
    const width = Number(tracedata?.width);
    const height = Number(tracedata?.height);
    if (!Array.isArray(tracedata?.layers) || width <= 0 || height <= 0) return -1;

    const toleranceX = Math.max(2, width * 0.02);
    const toleranceY = Math.max(2, height * 0.02);
    const canvasArea = width * height;
    let bestIndex = -1;
    let bestScore = -Infinity;

    tracedata.layers.forEach((layer, layerIndex) => {
        if (!Array.isArray(layer)) return;

        layer.forEach((path) => {
            if (path?.isholepath || !Array.isArray(path?.boundingbox)) return;
            const [minX, minY, maxX, maxY] = path.boundingbox.map(Number);
            if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;

            const boxWidth = Math.max(0, maxX - minX);
            const boxHeight = Math.max(0, maxY - minY);
            const coverage = (boxWidth * boxHeight) / canvasArea;
            const edges = [
                minX <= toleranceX,
                minY <= toleranceY,
                maxX >= width - toleranceX,
                maxY >= height - toleranceY
            ].filter(Boolean).length;

            if (edges < 3 || coverage < 0.6) return;
            const score = edges * 2 + coverage;
            if (score > bestScore) {
                bestScore = score;
                bestIndex = layerIndex;
            }
        });
    });

    return bestIndex;
}

/**
 * Resolves visible layer indices into merged output groups.
 * Merge rules operate on the ordinal positions within visibleIndices.
 * Returned groups preserve the target layer's original source-layer id
 * as the stable output identity.
 *
 * @param {number[]} visibleIndices
 * @param {{source:number,target:number}[]} rules
 * @returns {Array<{ outputLayerId:number, primarySourceLayerId:number, sourceLayerIds:number[] }>}
 */
export function resolveMergedLayerGroups(visibleIndices, rules = []) {
    if (!Array.isArray(visibleIndices) || visibleIndices.length === 0) return [];

    if (!Array.isArray(rules) || rules.length === 0) {
        return visibleIndices.map((sourceLayerId) => ({
            outputLayerId: sourceLayerId,
            primarySourceLayerId: sourceLayerId,
            sourceLayerIds: [sourceLayerId]
        }));
    }

    const finalTargets = {};
    visibleIndices.forEach((_, ruleIndex) => {
        finalTargets[ruleIndex] = ruleIndex;
    });

    rules.forEach((rule) => {
        const source = Number.parseInt(rule?.source, 10);
        const target = Number.parseInt(rule?.target, 10);
        if (!Number.isInteger(source) || !Number.isInteger(target)) return;
        if (!(source in finalTargets) || !(target in finalTargets)) return;

        let ultimateTarget = target;
        while (finalTargets[ultimateTarget] !== ultimateTarget) {
            ultimateTarget = finalTargets[ultimateTarget];
        }
        finalTargets[source] = ultimateTarget;
    });

    Object.keys(finalTargets).forEach((key) => {
        let current = Number.parseInt(key, 10);
        while (finalTargets[current] !== current) {
            current = finalTargets[current];
        }
        finalTargets[key] = current;
    });

    const groups = {};
    visibleIndices.forEach((sourceLayerId, ruleIndex) => {
        const targetRuleIndex = finalTargets[ruleIndex];
        if (!groups[targetRuleIndex]) groups[targetRuleIndex] = [];
        groups[targetRuleIndex].push(sourceLayerId);
    });

    return Object.keys(groups)
        .map(Number)
        .sort((a, b) => a - b)
        .map((targetRuleIndex) => {
            const primarySourceLayerId = visibleIndices[targetRuleIndex];
            return {
                outputLayerId: primarySourceLayerId,
                primarySourceLayerId,
                sourceLayerIds: groups[targetRuleIndex].slice()
            };
        });
}

/**
 * Builds a tracedata object containing only the given layer indices.
 */
export function buildTracedataSubset(source, indices) {
    if (!source) return null;
    const layers = [];
    const palette = [];
    indices.forEach((idx) => {
        if (source.layers[idx] && source.palette[idx]) {
            layers.push(JSON.parse(JSON.stringify(source.layers[idx])));
            palette.push(source.palette[idx]);
        }
    });
    return { ...source, layers, palette };
}

/**
 * Applies merge rules to collapse layers together, returning a new tracedata object.
 */
export function createMergedTracedata(sourceData, visibleIndices, rules) {
    if (!sourceData || !visibleIndices || !rules) return sourceData;
    const groups = resolveMergedLayerGroups(visibleIndices, rules);
    const newPalette = [];
    const newLayers = [];

    groups.forEach((group) => {
        newPalette.push(sourceData.palette[group.primarySourceLayerId]);

        let mergedPaths = [];
        group.sourceLayerIds.forEach((sourceLayerId) => {
            if (sourceData.layers[sourceLayerId]) {
                mergedPaths = mergedPaths.concat(sourceData.layers[sourceLayerId]);
            }
        });
        newLayers.push(mergedPaths);
    });

    return { ...sourceData, palette: newPalette, layers: newLayers };
}

/**
 * Legacy helper that only concatenates visible paths into a single tracedata layer.
 * This is not a welded silhouette and should not be used for print-safe backing geometry.
 * @param {object} tracedata
 * @param {function} getVisibleLayerIndices - () => number[]
 */
export function createConcatenatedSilhouetteTracedata(tracedata, getVisibleLayerIndices) {
    if (!tracedata) return null;
    const visibleIndices = getVisibleLayerIndices();
    if (!visibleIndices.length) return null;
    const subset = buildTracedataSubset(tracedata, visibleIndices);
    let mergedPaths = [];
    subset.layers.forEach((layer) => {
        if (Array.isArray(layer)) mergedPaths = mergedPaths.concat(layer);
    });
    return {
        width: subset.width,
        height: subset.height,
        layers: [mergedPaths],
        palette: [{ r: 0, g: 0, b: 0, a: 255 }]
    };
}

/**
 * Returns lightweight preflight metrics for the layered 3D build.
 * These checks intentionally describe geometry complexity and layer presence;
 * slicer-specific wall/nozzle validation still belongs in the slicer.
 * @param {object} tracedata
 * @param {function} getVisibleLayerIndices - () => number[]
 */
export function assess3DPrintQuality(tracedata, getVisibleLayerIndices) {
    if (!tracedata) {
        return {
            pathCount: 0,
            colorCount: 0,
            status: 'waiting',
            label: 'Waiting for source',
            note: 'Load or create a source, then update the 3D model.'
        };
    }

    const visibleIndices = getVisibleLayerIndices();
    const pathCount = visibleIndices.reduce((sum, index) => {
        const layer = tracedata.layers[index];
        return sum + (Array.isArray(layer) ? layer.length : 0);
    }, 0);
    const colorCount = visibleIndices.length;

    if (pathCount === 0 || colorCount === 0) {
        return {
            pathCount,
            colorCount,
            status: 'blocked',
            label: 'No printable layers',
            note: 'Adjust cleanup or color settings until at least one visible layer remains.'
        };
    }

    if (pathCount > 12000 || colorCount > 10) {
        return {
            pathCount,
            colorCount,
            status: 'review',
            label: 'Review complexity',
            note: 'This model is dense. Reduce colors or increase cleanup before exporting for a faster slice.'
        };
    }

    if (pathCount > 4500 || colorCount > 6) {
        return {
            pathCount,
            colorCount,
            status: 'review',
            label: 'Check in slicer',
            note: 'The model is usable but moderately complex. Confirm small details and color changes in your slicer.'
        };
    }

    return {
        pathCount,
        colorCount,
        status: 'ready',
        label: 'Ready to export',
        note: 'Layer and complexity checks pass. Confirm nozzle-sized details in your slicer before printing.'
    };
}
