const VERSION_MANIFEST_PATH = './app-version.json';
// Tool shells load this bootstrap behind the generated release key so a stale
// CDN 404 for an earlier deployment can never block the current application.
const TOOL_PATHS = new Set(['/3d-obj', '/logo', '/raster', '/bulk', '/pdf', '/svg']);

function rememberRequestedTool() {
    const route = window.location.pathname.replace(/\.html$/i, '');
    if (!TOOL_PATHS.has(route)) return;
    try {
        window.localStorage.setItem('genesis:lastTool', route);
    } catch {
        // Navigation remains usable when storage is blocked.
    }
}

function beginBootFeedback() {
    const overlay = document.getElementById('loader-overlay');
    const title = document.getElementById('loader-title');
    const subtitle = document.getElementById('loader-subtitle');
    if (title) title.textContent = 'Loading current release…';
    if (subtitle) {
        subtitle.textContent = 'Checking that every tool is on the same version.';
        subtitle.classList.remove('hidden');
    }
    if (overlay) overlay.style.display = 'flex';

    const captureEarlyImport = (event) => {
        if (window.__GENESIS_APP_EVENTS_BOUND__) return;
        const input = event.target;
        if (input?.id === 'file-input' && input.files?.[0]) {
            window.__GENESIS_PENDING_IMPORT_FILE__ = input.files[0];
        }
    };
    document.addEventListener('change', captureEarlyImport, true);
    return () => document.removeEventListener('change', captureEarlyImport, true);
}

function showBootError(error) {
    console.error('Application boot failed:', error);
    const overlay = document.getElementById('loader-overlay');
    const title = document.getElementById('loader-title');
    const subtitle = document.getElementById('loader-subtitle');
    if (title) title.textContent = 'The app could not start';
    if (subtitle) {
        subtitle.textContent = 'Refresh once to load the current release. If it continues, the deployment is incomplete.';
        subtitle.classList.remove('hidden');
    }
    if (overlay) {
        overlay.dataset.state = 'error';
        overlay.style.display = 'flex';
    }
}

function loadClassicScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${url}`));
        document.head.appendChild(script);
    });
}

async function readCurrentVersion() {
    const manifestUrl = new URL(VERSION_MANIFEST_PATH, import.meta.url);
    manifestUrl.searchParams.set('request', `${Date.now()}`);
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Version manifest returned HTTP ${response.status}.`);
    const manifest = await response.json();
    if (manifest?.schema !== 1 || !/^r-[a-f0-9]{16}$/.test(manifest?.version || '')) {
        throw new Error('Version manifest is invalid.');
    }
    return manifest.version;
}

async function boot() {
    const version = await readCurrentVersion();
    window.__GENESIS_APP_VERSION__ = version;
    window.__GENESIS_BOOTSTRAP_MANAGED__ = true;

    const style = document.getElementById('app-stylesheet');
    if (style) style.href = `style.css?v=${encodeURIComponent(version)}`;

    const currentTracerScript = [...document.scripts].some((script) => {
        if (!script.src) return false;
        const url = new URL(script.src);
        return url.pathname.endsWith('/imagetracer_v1.2.6.js')
            && url.searchParams.get('v') === version;
    });
    const tracerReady = currentTracerScript && window.ImageTracer
        ? Promise.resolve()
        : loadClassicScript(`imagetracer_v1.2.6.js?v=${encodeURIComponent(version)}`);
    const threeReady = import(`./three-setup.js?v=${encodeURIComponent(version)}`);
    await Promise.all([tracerReady, threeReady]);
    const app = await import(`./converter.js?v=${encodeURIComponent(version)}`);
    await app.startApplication();
}

rememberRequestedTool();
const stopCapturingEarlyImport = beginBootFeedback();
try {
    await boot();
    window.__GENESIS_APP_READY__ = true;
    stopCapturingEarlyImport();
    const overlay = document.getElementById('loader-overlay');
    if (overlay) overlay.style.display = 'none';
} catch (error) {
    stopCapturingEarlyImport();
    showBootError(error);
}
