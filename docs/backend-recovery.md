# Backend recovery and deletion

## Access and worker behavior

Projects default to `analyzeOnPush: false`. Enable with `PATCH /api/projects/:projectId` and `{ "analyzeOnPush": true }`. Push webhooks for the tracked branch enqueue one analysis per delivery/project; disabled, deleted-branch, archived/deleting and unavailable projects are skipped. Analysis reads the branch when executed, not necessarily the historical push commit. Completed analysis compares pins and records source-change activity; this setting does not run GitHub test workflows or establish runtime correctness. Real webhook delivery is required.

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


## Resumable repository feature discovery

`GET /api/projects/:projectId/revisions/:revisionId/repository-discovery` returns deterministic batch IDs and paths, per-batch status/results, `nextBatchId`, `analyzedFiles`, `snapshotFiles`, skipped files and snapshot limitations. This endpoint does not send source to an AI provider. It marks abandoned pending requests failed using the existing two-minute recovery threshold.

`POST` to that same URL with `{ "batchId": "<id from GET>", "allowSourceSharing": true }` processes one batch. Each batch remains limited to 40 files / 80 KB under the existing source limit and consumes one unit of the existing 10-request hourly user budget. Fetch progress again to select the next batch. Completed batches return cached results, including batches previously analyzed through the selected-path endpoint. A failed batch is returned without resending source; add its current `retryAttempt` to explicitly retry. Unknown IDs and missing consent are rejected. Each result is tied to the immutable revision and preserves source references and provider provenance.

`complete` means every eligible batch completed, not full repository coverage or runtime verification. Files larger than one batch are split at complete line boundaries; a file with an individually oversized line is explicitly skipped. Snapshot exclusions remain visible. Candidates are kept in their originating batches, without speculative cross-batch merging. Stop submitting batches to pause; there is no unattended background continuation or cancellation of an already sent provider request. Access revocation and project lifecycle changes fence the result write.

Repository discovery progress also returns `summary.groups`: matching normalized titles grouped for display, with each original candidate and its batch ID retained. Group IDs are name hashes within the revision, not persistent feature identities. `summary.rejectedBatchIds` reports completed results excluded because their evidence cannot be validated against their originating batch. All batch results remain available for inspection. Grouping does not establish semantic equivalence or runtime proof.

Line-split batches expose `ranges` with original `startLine` and `endLine`. Each range has its own cache key, and citations are validated against only that range using original line numbers. `analyzedFiles` counts a split file only once all its ranges complete. No overlap or cross-chunk context is added; functions spanning boundaries may yield incomplete hypotheses.

The 80 KB discovery limit applies to both stored source and serialized numbered-source JSON sent as the AI user input. Batch planning uses the same check as execution, including line-number overhead and UTF-8 bytes. This is a source payload bound, not a total request or token limit. Plans may change after this sizing correction; refetch the plan instead of persisting batch IDs across backend versions.

Assessment run associations record the selected GitHub attempt. `runEvidence.stale` becomes true when the imported run advances to another attempt; `selectedAttempt` retains the user selection while `run` is the latest imported run. Reassociate explicitly to accept the current attempt. Legacy associations without an attempt are conservatively stale. Workflow success still does not establish feature verification.
