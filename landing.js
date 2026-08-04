(() => {
    const supportedTools = new Set(['/3d-obj', '/logo', '/raster', '/bulk', '/pdf']);
    const recentToolLink = document.querySelector('#recent-tool-link');

    if (recentToolLink) {
        try {
            const lastTool = window.localStorage.getItem('genesis:lastTool');
            if (supportedTools.has(lastTool)) recentToolLink.href = lastTool;
        } catch {
            // The default 3D route remains available when storage is blocked.
        }
    }

    document.querySelectorAll('[data-tool-path]').forEach((link) => {
        link.addEventListener('click', () => {
            try {
                window.localStorage.setItem('genesis:lastTool', link.dataset.toolPath);
            } catch {
                // Navigation should never depend on browser storage.
            }
        });
    });
})();
