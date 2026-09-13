# Backend recovery and deletion

## Access and worker behavior

GitHub disconnect and authorization revocation increment a durable per-user access generation. Analysis snapshot commits and OAuth callback writes check that generation in a MongoDB transaction. A callback started before revocation must restart. Existing in-progress OAuth states created before this change may need to restart once.

The process runs separate analysis and webhook loops. Repository fetches check cancellation and renew their project/job leases between requests, with a ten-minute source-fetch deadline. One provider request can take up to its existing 15-second timeout before cancellation is observed. This is cooperative cancellation, not instantaneous abortion of an upstream request. Queued cancellations settle without fetching source.

## Dispatch recovery

The API still dispatches a GitHub ref. A ref can move between checking and dispatching; it is not an immutable-checkout guarantee. On refresh, `verification: revision-mismatch` and `eligibleAsApprovedRevisionEvidence: false` explicitly reject the resulting run as evidence for the approved revision. Matching a revision does not prove feature coverage.

Definitive provider HTTP rejections become `rejected`. Transport ambiguity remains `unknown` and is never automatically resubmitted.

- `POST /api/projects/:projectId/dispatches/:id/reconcile` with `{ "githubRunId": 123 }` verifies the provider run belongs to the requested workflow, is a manual dispatch, and is not older than the submission window. It records `resolution: user-associated`, not a claim that correlation was automatic. Commit mismatch remains visible.
- `POST /api/projects/:projectId/dispatches/:id/acknowledge` with `{ "acknowledgeUncertainty": true }` acknowledges an unknown result. It does not claim no run occurred, and does not resubmit it. Inspect GitHub before starting a separate run.

## Pagination and archived features

Features, pins, investigations, runs, jobs, activities and dispatches accept `page` (default 1, maximum 10000), with 100 records per page. Responses preserve `data` and add `page` and `pageSize`. Revisions accept `page` with 25 records per page. Continue until a page is shorter than its page size. These are offset pages, not immutable snapshots of a changing list.

Features accept `status=active|archived`. Archived features are omitted from the pin list and cannot be edited or repinned until restored. Their saved baseline is retained, so restoring a feature makes its pin available again; version changes remain detectable.

## Permanent deletion

- Archive a project first, then `DELETE /api/projects/:projectId/permanent` with `{ "confirm": "DELETE PROJECT" }`.
- `DELETE /api/me` with `{ "confirm": "DELETE MY ACCOUNT" }` requests account deletion and immediately revokes access/sessions.

Both return 202 with a deletion receipt and a due time at least one hour later. This grace period lets already admitted requests settle. Projects pending deletion cannot be restored. The worker defers purge while any analysis is active, then transactionally removes project source snapshots, features, pins, investigations, assessments, AI results, runs, dispatches, activities and analysis jobs. Account deletion additionally removes its user profile, sessions and GitHub credentials. A small deletion receipt and opaque access-generation tombstone remain for recovery/fencing. This API does not delete GitHub repositories or cancel GitHub workflow runs.

Provider backups are outside this transaction and expire under the separately configured backup retention policy. Production deletion was not executed as a test. Tests use isolated databases.

## Operational verification still required

Protected `/internal/metrics` includes `deployment.commit` from `RENDER_GIT_COMMIT`, or null when unavailable. Compare it with the intended full Git commit before calling a release verified. A successful readiness response alone does not identify the deployed version.

Set `OPERATIONS_EXPECTED_COMMIT` to the full 40-character release SHA when running the operations checker for deployment verification. A missing or mismatched deployed commit fails the check. Omit it for routine health monitoring, or update it with each release.

Deletion metrics include pending requests and requests incomplete more than two hours after creation. Failed purges retry after a one-minute delay without blocking other due requests. Project and account deletion cancel queued analysis and signal running analysis while preserving its lease until it settles.

Metrics now include worker heartbeat age, polling failures and stale pending dispatches. The checker also fails on terminal jobs rather than considering an empty queue sufficient. A polling failure remains observable until process restart; investigate it before restarting. Failed analysis jobs can use the existing retry route. After inspecting a failed webhook, an operator can POST /internal/jobs/:id/retry with {"retry":true} and the operations bearer token. This only accepts failed webhook jobs, preserves their delivery key, and never dispatches a test workflow.

Render is live at https://velament-backend.onrender.com. Configure an external schedule for the operations checker and an alert destination. Neither external alert delivery nor the production backup schedule/restore has been verified by these code changes. Those require the account/provider configuration, not frontend implementation.
