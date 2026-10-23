/** Mount shared controls inside the main workflow, never in a side panel.
 * Moving the bound nodes once preserves values, listeners and native inputs.
 * Raster, Bulk, Logo and all export controls stay in their own tool markup. */
export function mountStageLayout() {
    if (!document.body.classList.contains('immersive-stage')) return;
    for (const [hostId, ids] of [
        ['workspace-source-controls', ['sidebar-import-section']],
        ['workspace-model-controls', ['sidebar-adjust-section', 'sidebar-primary-footer']]
    ]) {
        const host = document.getElementById(hostId);
        if (!host) continue;
        for (const id of ids) {
            const control = document.getElementById(id);
            if (control) host.append(control);
        }
    }
    document.getElementById('stage-control-source')?.remove();
}
