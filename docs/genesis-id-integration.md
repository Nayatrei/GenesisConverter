# Genesis Editor — Genesis ID integration

Genesis Editor (`GenesisImageConverter`) keeps every local converter free and
usable without an account. Genesis ID is an optional connection that exposes a
user's current tier and whole-Spark balance and records this app in the central
connected-app list.

## Fixed client contract

- App ID: `genesis-editor`
- Production origin: `https://editor.genesisframeworks.com`
- Exact production callback: `https://editor.genesisframeworks.com/auth/callback/`
- Identity/gateway origin: `https://id.genesisframeworks.com`
- Protocol: authorization code + S256 PKCE + random state
- Pending verifier/state storage: per-tab `sessionStorage`
- Connected Firebase session storage: per-tab `sessionStorage`

The gateway production configuration must include the following exact values:

```text
CORS_ORIGINS += https://editor.genesisframeworks.com
SSO_CLIENTS_JSON["genesis-editor"] += https://editor.genesisframeworks.com/auth/callback/
```

For local manual QA only, add these exact temporary entries and remove them if
the environment does not need browser-to-production SSO:

```text
CORS_ORIGINS += http://127.0.0.1:4173
SSO_CLIENTS_JSON["genesis-editor"] += http://127.0.0.1:4173/auth/callback/
```

The checked-in `genesis-id-*` meta values are public routing configuration, not
credentials. Firebase Web API configuration is read from the public Genesis ID
config endpoint only when a token must be exchanged or refreshed.

## Browser connection and logout

Select **Genesis ID 연결**. The Editor creates a 32-byte PKCE verifier and a
separate random state, stores them only for the current tab, and sends the
challenge to Genesis ID. The callback requires the exact state, app ID,
callback URI, pending lifetime, and one-time central code before it accepts a
Firebase custom token. Return navigation is restricted to this Editor origin.

**이 기기 연결 해제** clears the Editor's per-tab session. It does not revoke
the user's other Genesis applications. Account-wide session revocation remains
available from the Genesis ID membership portal.

No raw microcredit values are read or rendered. The widget uses the central
Spark projection and displays either an integer `N Sparks` or
`Unlimited Sparks`.

## Email-free Agent test session

The central Agent credential exchange must allow app ID `genesis-editor`. Use
the guarded Agent workflow documented by Genesis ID to obtain a short-lived ID
token. Never paste the Agent secret or Firebase custom token into the Editor.
When visual browser QA specifically needs the connected state, attach the
short-lived app-bound ID token at runtime:

```js
await window.GenesisId.useManagedIdToken(agentIdToken)
```

This API validates the token against `/api/v1/account/me`, keeps it only in the
current tab's `sessionStorage`, and cannot refresh it. Closing the tab or using
**이 기기 연결 해제** removes it. The Editor's conversion code does not consume
Sparks and remains independent of this session.

## Deployment verification

Render deploys the repository as the `genesis-image-converter` static service:

```text
buildCommand: npm ci --omit=dev && npm run build
staticPublishPath: .
rewrite /auth/callback and /auth/callback/ -> /auth/callback/index.html
```

The explicit Blueprint rewrites make the exact callback independent of CDN
directory-index behavior. Render serves an existing static file before broader
fallback rules, so these narrow rules do not affect converter entrypoints.

Before promoting a commit, run `npm test`, `npm run build`, and
`npm run check:cache`. Verify `/`, one converter route, and
`/auth/callback/` on desktop and mobile. A real SSO canary must confirm that the
callback returns to the originating Editor route, displays only Sparks, and
that local disconnect leaves all converter actions enabled.
