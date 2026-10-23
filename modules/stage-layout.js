/** Relocate, never clone, live controls. Anchors restore mobile document order.
 * Controllers keep their original nodes, values, event handlers and canvases. */
export function mountStageLayout() {
    if (!document.body.classList.contains('immersive-stage')) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const groups = [
        ['stage-export-host', ['#svg-export-footer', '#logo-export-footer', '#download-footer', '#annotate-download-footer']],
        ['stage-logo-source-host', ['#tab-logo .logo-source-card']],
        ['stage-raster-controls-host', ['#raster-original-preview', '#raster-content .raster-control-block:not(.raster-adjust-block)', '#raster-content .raster-adjust-block']],
        ['stage-bulk-controls-host', ['#tab-bulk .bulk-format-tabs', '#tab-bulk .bulk-controls-card']]
    ];
    const placements = groups.flatMap(([hostId, selectors]) => {
        const host = document.getElementById(hostId);
        if (!host) return [];
        return selectors.flatMap(selector => [...document.querySelectorAll(selector)])
            .map(node => {
                const anchor = document.createComment('Stage control: ' + (node.id || hostId));
                node.before(anchor);
                return { node, anchor, host };
            });
    });
    const arrange = () => placements.forEach(({ node, anchor, host }) => {
        if (desktop.matches) host.append(node);
        else anchor.after(node);
    });
    desktop.addEventListener('change', arrange);
    arrange();
}
