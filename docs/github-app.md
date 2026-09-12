# GitHub App connection

This layer connects GitHub to an **already authenticated Velament account**. Google/GitHub login is implemented separately; see [authentication](authentication.md).

## Registration

Register a GitHub App with selected-repository installation, Contents read, Metadata read and Actions write for execution (read is sufficient for browsing/results). Use the API callback `/api/github/callback`. Set the server-only values in `.env.example`: app ID, client ID/secret, PEM private key, callback URL, app slug, and a stable 32-byte AES key encoded as 64 hex characters. Never expose these through Vite. Enable expiring user access tokens. No credentials are included in the repository.

## Flow

1. Authenticated client calls `POST /api/github/connect` and navigates to returned `authorizationUrl`.
2. Callback checks its initiating browser cookie and consumes one-time, ten-minute state and exchanges code with PKCE. User token is encrypted with AES-256-GCM. The callback returns JSON without tokens; frontend completion routing is still to be wired.
3. `GET /api/github/installation-url` returns the App installation page. The callback does not trust a supplied installation ID as proof of ownership.
4. `GET /api/github/installations?page=1` lists installations accessible to that GitHub user.
5. `GET /api/github/installations/:id/repositories?page=1` lists repositories accessible to both user and app. Explicit pagination uses 100 results per page.
6. Create a project with installationId, repositoryId, owner, repo and branch. Server validates accessible repository ID and owner/name identity.
7. Analysis and Actions import revalidate user repository access and generate a short-lived installation token scoped to that single repository. Installation tokens are not stored.
8. `DELETE /api/github/connection` deletes local credentials and pending states. Uninstall/revoke from GitHub settings separately.

Expired tokens refresh through encrypted rotating refresh credentials protected by a database lease. Revoked or uncertain refresh credentials require reconnection. Signed webhooks are persisted with delivery deduplication and processed by the durable worker. Configure `/api/webhooks/github` and subscribe to push, workflow_run, installation and github_app_authorization events. Existing downloaded snapshots are retained; connection removal is not a project-data deletion operation. Installation changes are checked before new remote work. Previously public-only projects must reconnect before analysis/import.

Dispatch requires Actions write, user repository write access, an expected SHA and an idempotency key. The branch head is checked before dispatch; branch movement after that check remains possible, so imported evidence must match the actual run SHA. Unknown submission outcomes are not automatically retried. Workflow listing, run refresh, job steps and cancellation are available; automatic reconciliation of uncertain dispatches remains outstanding.

## Verification

Automated tests cover randomized authenticated encryption, tamper rejection, denial before installation-token creation, expired connection rejection and project ownership. Provider requests are mocked. Real authorization requires registering/configuring the App and conducting a live integration test.

## Official references

- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
