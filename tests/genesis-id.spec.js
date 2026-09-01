const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');

const identityOrigin = 'https://id.genesisframeworks.com';

function base64UrlJson(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function managedToken() {
    return `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson({
        sub: 'agent-editor',
        exp: Math.floor(Date.now() / 1000) + 3600,
        genesisApp: 'genesis-editor',
        genesisAgent: true
    })}.${'s'.repeat(64)}`;
}

async function mockAccount(page, { unlimited = false } = {}) {
    await page.route(`${identityOrigin}/api/v1/account/me`, (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            profile: { uid: 'agent-editor', displayName: '' },
            access: {
                status: 'active',
                tier: 'pro',
                entitlements: unlimited ? ['testing.unlimited_sparks'] : []
            },
            credits: { available: unlimited ? 0 : 1234, reserved: 0, unlimited }
        })
    }));
}

test('free converters remain usable without Genesis ID', async ({ page }) => {
    await page.goto('/3d-obj');

    await expect(page.getByRole('button', { name: 'Genesis ID 연결' })).toBeVisible();
    await expect(page.locator('#import-btn')).toBeEnabled();
    await expect(page.locator('body')).not.toContainText(/microcredits?/i);
});

test('connection request binds app, exact callback, state, and S256 PKCE', async ({ page }) => {
    await page.route(`${identityOrigin}/**`, (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Genesis ID test authorization</title>'
    }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Genesis ID 연결' }).click();
    await page.waitForURL((url) => url.origin === identityOrigin);

    const authorizeUrl = new URL(page.url());
    expect(authorizeUrl.searchParams.get('app_id')).toBe('genesis-editor');
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
        'http://127.0.0.1:4173/auth/callback/'
    );
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizeUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await page.goBack();
    const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('genesis:id:pending:v1')));
    expect(pending.appId).toBe('genesis-editor');
    expect(pending.callbackUri).toBe('http://127.0.0.1:4173/auth/callback/');
    expect(pending.state).toBe(authorizeUrl.searchParams.get('state'));
    const expectedChallenge = crypto.createHash('sha256').update(pending.verifier).digest('base64url');
    expect(authorizeUrl.searchParams.get('code_challenge')).toBe(expectedChallenge);
});

test('callback exchanges once and renders only whole-Spark account state', async ({ page }) => {
    const state = 's'.repeat(43);
    const verifier = 'v'.repeat(43);
    const code = 'c'.repeat(43);
    let exchangeBody;

    await page.route(`${identityOrigin}/api/v1/auth/sso/exchange`, async (route) => {
        exchangeBody = route.request().postDataJSON();
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ appId: 'genesis-editor', firebaseCustomToken: 'custom-editor-token' })
        });
    });
    await page.route(`${identityOrigin}/api/v1/account/config`, (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ firebase: { apiKey: 'public-web-api-key' } })
    }));
    await page.route('https://identitytoolkit.googleapis.com/**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            idToken: managedToken(),
            refreshToken: 'test-refresh-token',
            expiresIn: '3600',
            localId: 'editor-user'
        })
    }));
    await mockAccount(page);

    await page.goto('/');
    await page.evaluate(({ state, verifier }) => {
        sessionStorage.setItem('genesis:id:pending:v1', JSON.stringify({
            schemaVersion: 1,
            appId: 'genesis-editor',
            callbackUri: `${location.origin}/auth/callback/`,
            state,
            verifier,
            returnTo: '/',
            createdAt: Date.now()
        }));
    }, { state, verifier });
    await page.goto(`/auth/callback/?code=${code}&state=${state}`);
    await page.waitForURL(/\/$/);

    await expect(page.getByRole('button', { name: /Genesis ID.*Pro.*1,234 Sparks/ })).toBeVisible();
    await page.getByRole('button', { name: /Genesis ID.*Pro.*1,234 Sparks/ }).click();
    await expect(page.getByRole('dialog', { name: 'Genesis ID account' })).toContainText('Pro · 1,234 Sparks');
    await expect(page.locator('body')).not.toContainText(/microcredits?/i);
    expect(exchangeBody).toEqual({
        appId: 'genesis-editor',
        redirectUri: 'http://127.0.0.1:4173/auth/callback/',
        code,
        codeVerifier: verifier,
        state
    });
});

test('callback rejects a mismatched state before contacting the gateway', async ({ page }) => {
    let exchangeRequests = 0;
    await page.route(`${identityOrigin}/api/v1/auth/sso/exchange`, (route) => {
        exchangeRequests += 1;
        return route.abort();
    });
    await page.goto('/');
    await page.evaluate(() => {
        sessionStorage.setItem('genesis:id:pending:v1', JSON.stringify({
            schemaVersion: 1,
            appId: 'genesis-editor',
            callbackUri: `${location.origin}/auth/callback/`,
            state: 'expected-state',
            verifier: 'v'.repeat(43),
            returnTo: '/',
            createdAt: Date.now()
        }));
    });

    await page.goto(`/auth/callback/?code=${'c'.repeat(43)}&state=wrong-state`);
    await expect(page.getByRole('heading', { name: 'Genesis ID를 연결하지 못했습니다' })).toBeVisible();
    expect(exchangeRequests).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem('genesis:id:pending:v1'))).toBeNull();
});

test('managed email-free Agent token shows unlimited Sparks and disconnects locally', async ({ page }) => {
    await mockAccount(page, { unlimited: true });
    await page.goto('/');

    await page.evaluate(async (token) => window.GenesisId.useManagedIdToken(token), managedToken());
    const accountButton = page.getByRole('button', { name: /Genesis ID.*Pro.*Unlimited Sparks/ });
    await expect(accountButton).toBeVisible();
    await accountButton.click();
    await page.getByRole('button', { name: '이 기기 연결 해제' }).click();

    await expect(page.getByRole('button', { name: 'Genesis ID 연결' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('genesis:id:session:v1'))).toBeNull();
});

test('managed token rejects another application before loading account data', async ({ page }) => {
    let accountRequests = 0;
    await page.route(`${identityOrigin}/api/v1/account/me`, (route) => {
        accountRequests += 1;
        return route.abort();
    });
    await page.goto('/');
    const wrongAppToken = `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson({
        sub: 'agent-chat',
        exp: Math.floor(Date.now() / 1000) + 3600,
        genesisApp: 'genesis-chat',
        genesisAgent: true
    })}.${'s'.repeat(64)}`;

    const error = await page.evaluate(async (token) => {
        try {
            await window.GenesisId.useManagedIdToken(token);
            return '';
        } catch (caught) {
            return caught instanceof Error ? caught.message : String(caught);
        }
    }, wrongAppToken);
    expect(error).toContain('not bound to this Agent application');
    expect(accountRequests).toBe(0);
});
