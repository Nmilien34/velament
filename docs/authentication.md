# Authentication

Google and GitHub login create Velament accounts. GitHub repository authorization is a separate GitHub App connection: signing in does not grant repository access.

## Configuration

Set `AUTH_API_ORIGIN`, `AUTH_APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_OAUTH_CLIENT_ID`, and `GITHUB_OAUTH_CLIENT_SECRET` in the root ignored `.env`. Origins have no trailing slash. Providers fail with `AUTH_NOT_CONFIGURED` until configured; the rest of the backend can run without provider secrets.

Register a Google web OAuth client with callback `${AUTH_API_ORIGIN}/api/auth/google/callback`. Register a GitHub OAuth App for login with callback `${AUTH_API_ORIGIN}/api/auth/github/callback`. This is separate from the existing repository GitHub App. Login requests only identity/email scopes; repository permissions come later.

Both origins must use HTTPS in production. Host the frontend and API on the same site, such as `app.velament.com` and `api.velament.com`, for SameSite=Lax cookies. For local development use `localhost` consistently, not a mixture of localhost and 127.0.0.1. `CLIENT_ORIGIN` must include the frontend origin. Do not use wildcard credentialed CORS.

## Browser flow

1. Navigate to `GET /api/auth/google/start` or `/api/auth/github/start` on the backend.
2. Server creates a ten-minute, one-use authorization attempt with a separate HttpOnly browser cookie, PKCE verifier and nonce. A new attempt for the same provider supersedes the old attempt in that browser.
3. Provider returns to the callback. Server checks browser binding and state before exchanging the code. Google ID tokens are verified by Google's official library against the configured audience, then checked for nonce and verified email. GitHub identity is fetched from `/user`, with a verified primary email from `/user/emails`.
4. Account lookup uses provider plus immutable subject ID. A matching email alone never links or merges accounts. If another account owns that email, the API returns `ACCOUNT_EXISTS`; sign in using its original provider. Cross-provider account linking is not implemented.
5. Server creates a seven-day opaque session, storing only its SHA-256 hash. It rotates the browser's previous session and redirects to `${AUTH_APP_ORIGIN}/auth/complete`. No session/provider tokens appear in the redirect. The frontend must implement this completion route and fetch `/api/me` with `credentials: "include"`.

Callbacks return the normal JSON error envelope on failure, including cancellation, expiry, invalid identity or provider outage. The frontend completion/error presentation is still to be wired; the static prototype is not automatically connected to these routes. Login OAuth tokens are discarded after identity verification rather than stored for repository access.

## Sessions

Production session cookies use `__Host-velament_session`, Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain. Development uses `velament_session` over local HTTP. Unsafe cookie-authenticated requests must send an exact allowlisted `Origin`; requests without one are rejected. Browser fetch sets Origin automatically. Development bearer sessions remain supported and do not depend on cookies.

| Route                            | Behavior                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| GET /api/me                      | Account profile using shared AccountProfile type                       |
| GET /api/sessions                | Up to 100 active sessions with current-session marker; no token hashes |
| DELETE /api/sessions/:id         | Revoke an owned session; clears cookie when revoking current session   |
| POST /api/sessions/revoke-others | Revoke all other sessions for this account                             |
| POST /api/logout                 | Revoke current session and clear browser cookie                        |

Signup starts are limited to 20 requests per ten-minute IP window, callbacks to 40, and repository connection starts to 20 per authenticated user. Budgets are stored in MongoDB so multiple processes share limits. `Retry-After` accompanies 429 responses. Express does not trust forwarded client IP headers by default; configure a narrowly trusted reverse proxy before production, or the proxy IP will share a budget. Add edge traffic protection and broader account quotas before launch.

Startup awaits model indexes before listening. TTL cleanup is not relied upon for validity: state and session lookups explicitly check expiry. Provider network responses are mocked in tests; real OAuth registration, consent and callback delivery still require a live integration test.

## References

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
