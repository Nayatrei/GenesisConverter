function getProtocolHook() {
    if (typeof window === 'undefined') return null;
    return typeof window.__GENESIS_BAMBU_PROTOCOL_HOOK__ === 'function'
        ? window.__GENESIS_BAMBU_PROTOCOL_HOOK__
        : null;
}

function getPlatformKey() {
    if (typeof navigator === 'undefined') return 'windows';
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    if (/Mac/i.test(platform)) return 'mac';
    if (/Linux/i.test(platform)) return 'linux';
    return 'windows';
}

export function buildProtocolUrl(fileUrl) {
    const platform = getPlatformKey();
    if (platform === 'mac' || platform === 'linux') {
        return `bambustudioopen://${fileUrl}`;
    }
    return `bambustudio://open?file=${encodeURIComponent(fileUrl)}`;
}

export function canPublishBambuProject() {
    if (typeof window === 'undefined') return false;
    return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

export async function publishBambuProject(blob, filename) {
    if (!canPublishBambuProject()) {
        throw new Error('Direct Bambu transfer requires the hosted Genesis app.');
    }
    if (!(blob instanceof Blob) || blob.size === 0) {
        throw new Error('The generated 3MF project is empty.');
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);

    try {
        const endpoint = new URL('/api/bambu-transfer', window.location.origin);
        endpoint.searchParams.set('filename', filename || 'genesis-model.3mf');
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'model/3mf'
            },
            body: blob,
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `Bambu transfer failed (${response.status}).`);
        }

        const transferUrl = new URL(payload.url);
        if (transferUrl.protocol !== 'http:' && transferUrl.protocol !== 'https:') {
            throw new Error('The Bambu transfer URL is invalid.');
        }

        return {
            expiresAt: payload.expiresAt || null,
            filename: payload.filename || filename,
            url: transferUrl.toString()
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('Bambu transfer timed out.');
        }
        throw error;
    } finally {
        window.clearTimeout(timeout);
    }
}

export function canAttemptBambuLaunch() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

    const userAgent = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return false;
    if (getPlatformKey() === 'linux') return false;

    return true;
}

/**
 * Triggers the Bambu Studio protocol handler to launch the app.
 * Uses blur/visibility heuristic to detect whether it opened.
 */
export async function launchBambuStudio(fileUrl = '') {
    if (!canAttemptBambuLaunch()) {
        return { attempted: false, opened: false };
    }

    const platform = getPlatformKey();
    const protocolUrl = fileUrl
        ? buildProtocolUrl(fileUrl)
        : platform === 'mac'
            ? 'bambustudioopen://'
            : 'bambustudio://open';

    const protocolHook = getProtocolHook();
    if (protocolHook) {
        const opened = await Promise.resolve(protocolHook(protocolUrl));
        return { attempted: true, opened: Boolean(opened), protocolUrl };
    }

    return new Promise((resolve) => {
        let settled = false;

        const cleanup = () => {
            window.removeEventListener('blur', handleBlur, true);
            document.removeEventListener('visibilitychange', handleVisibilityChange, true);
        };

        const finish = (opened) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ attempted: true, opened, protocolUrl });
        };

        const handleBlur = () => finish(true);
        const handleVisibilityChange = () => {
            if (document.hidden) finish(true);
        };

        window.addEventListener('blur', handleBlur, true);
        document.addEventListener('visibilitychange', handleVisibilityChange, true);

        // Anchor-click to trigger protocol handler
        const anchor = document.createElement('a');
        anchor.href = protocolUrl;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);

        window.setTimeout(() => finish(false), 1800);
    });
}
