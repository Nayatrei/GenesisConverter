const DEFAULT_LABEL = 'Prepare Bambu transfer';

function clampProgress(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
}

export function waitForBrowserPaint({ timeoutMs = 120 } = {}) {
    const maxWait = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 120;
    return new Promise((resolve) => {
        const requestFrame = globalThis.requestAnimationFrame;
        const cancelFrame = globalThis.cancelAnimationFrame;
        let settled = false;
        let firstFrame = null;
        let secondFrame = null;
        let timeoutId = null;

        const finish = () => {
            if (settled) return;
            settled = true;
            if (timeoutId !== null) clearTimeout(timeoutId);
            if (typeof cancelFrame === 'function') {
                if (firstFrame !== null) cancelFrame.call(globalThis, firstFrame);
                if (secondFrame !== null) cancelFrame.call(globalThis, secondFrame);
            }
            resolve();
        };

        timeoutId = setTimeout(finish, typeof requestFrame === 'function' ? maxWait : 0);
        if (typeof requestFrame !== 'function') return;

        firstFrame = requestFrame.call(globalThis, () => {
            firstFrame = null;
            secondFrame = requestFrame.call(globalThis, () => {
                secondFrame = null;
                finish();
            });
        });
    });
}

export function yieldToBrowser() {
    if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Owns only the Send-to-Bambu interaction state. Geometry generation and
 * network transfer stay outside this module and report their stages here.
 */
export function createBambuSendProgress(controls = {}) {
    const button = controls.bambuOpenBtn || null;
    const meta = controls.bambuOpenMeta || null;
    const shell = controls.bambuProgress || null;
    const bar = shell?.querySelector('[data-bambu-progress-bar]') || null;
    const stageLabel = shell?.querySelector('[data-bambu-progress-stage]') || null;
    const valueLabel = shell?.querySelector('[data-bambu-progress-value]') || null;
    const buttonLabel = button?.querySelector('[data-bambu-button-label]')
        || button?.querySelector('span:last-child')
        || null;
    const initialButtonLabel = buttonLabel?.textContent?.trim() || DEFAULT_LABEL;
    const initialMeta = meta?.textContent?.trim() || '';
    let busy = false;
    let progress = 0;

    function render({ stage, value, detail, state = 'working' }) {
        const nextProgress = state === 'working'
            ? Math.max(progress, clampProgress(value))
            : clampProgress(value);
        progress = nextProgress;

        if (shell) {
            shell.hidden = false;
            shell.dataset.state = state;
        }
        if (bar) {
            bar.style.setProperty('--bambu-send-progress', String(nextProgress / 100));
            bar.setAttribute('aria-valuenow', String(Math.round(nextProgress)));
        }
        if (stageLabel) {
            stageLabel.textContent = stage || '';
            stageLabel.setAttribute('role', state === 'error' ? 'alert' : 'status');
            stageLabel.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
        }
        if (valueLabel) valueLabel.textContent = `${Math.round(nextProgress)}%`;
        if (meta && detail) meta.textContent = detail;
    }

    function begin({
        stage = 'Preparing model',
        detail = 'Checking the prepared 3D preview…',
        buttonText = 'Preparing…',
        value = 2
    } = {}) {
        if (busy) return false;
        busy = true;
        progress = 0;
        if (button) {
            button.classList.remove('is-send-ready', 'is-send-success', 'is-send-warning', 'is-send-error');
            button.classList.add('is-sending');
            button.setAttribute('aria-busy', 'true');
            button.setAttribute('aria-disabled', 'true');
        }
        if (buttonLabel) buttonLabel.textContent = buttonText;
        render({ stage, value, detail, state: 'working' });
        return true;
    }

    function update({ stage, value, detail, buttonText } = {}) {
        if (!busy) return;
        if (buttonLabel && buttonText) buttonLabel.textContent = buttonText;
        render({ stage, value, detail, state: 'working' });
    }

    function finish({
        state = 'success',
        stage = state === 'error' ? 'Could not send' : 'Transfer complete',
        detail = '',
        buttonText
    } = {}) {
        busy = false;
        if (button) {
            button.classList.remove('is-sending');
            button.classList.toggle('is-send-ready', state === 'ready');
            button.classList.toggle('is-send-success', state === 'success');
            button.classList.toggle('is-send-warning', state === 'warning');
            button.classList.toggle('is-send-error', state === 'error');
            button.setAttribute('aria-busy', 'false');
            button.removeAttribute('aria-disabled');
        }
        if (buttonLabel) {
            buttonLabel.textContent = buttonText
                || (state === 'success' ? 'Send again to Bambu Studio' : initialButtonLabel);
        }
        render({
            stage,
            value: state === 'error' ? progress : 100,
            detail,
            state
        });
    }

    function reset() {
        if (busy) return false;
        busy = false;
        progress = 0;
        if (shell) {
            shell.hidden = true;
            shell.dataset.state = 'idle';
        }
        if (button) {
            button.classList.remove(
                'is-sending',
                'is-send-ready',
                'is-send-success',
                'is-send-warning',
                'is-send-error'
            );
            button.setAttribute('aria-busy', 'false');
            button.removeAttribute('aria-disabled');
        }
        if (buttonLabel) buttonLabel.textContent = initialButtonLabel;
        if (meta) meta.textContent = meta.dataset.bambuIdleText || initialMeta;
        return true;
    }

    function cancel() {
        busy = false;
        return reset();
    }

    return {
        begin,
        update,
        finish,
        reset,
        cancel,
        isBusy: () => busy
    };
}
