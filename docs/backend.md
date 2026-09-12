# Backend implementation

## Structure

Models define persisted records; services handle GitHub access, graph extraction, revision analysis and run import. Middleware enforces session authentication. Project controllers own project HTTP requests; domain routes validate inputs with shared Zod schemas. All project endpoints verify ownership before accessing data. Errors use the shared API envelope.

## Start locally

Start MongoDB (`npm run db:up`, or an existing local installation), then run `npm run dev`. Provision a **local development account** with `npm run session:create -w @velament/backend -- you@example.com`. The command prints a random 24-hour bearer token once. Send it as `Authorization: Bearer <token>`. Only its SHA-256 hash is stored. This provisioning command refuses production mode. It is not a replacement for user-facing OAuth.

## API

Responses use `{ data }`; errors use `{ error: { code, message } }`. IDs are MongoDB IDs. JSON bodies are limited to 1 MB.

| Method      | Endpoint                                                         | Purpose                                                                                                         |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET         | /api/health                                                      | Public process liveness                                                                                         |
| GET         | /api/me                                                          | Current account                                                                                                 |
| POST        | /api/logout                                                      | Revoke current session                                                                                          |
| GET, POST   | /api/projects                                                    | Paginated list / create authorized GitHub project (`owner`, `repo`, `branch`, `installationId`, `repositoryId`) |
| PATCH       | /api/projects/:projectId                                         | Change branch while no analysis is running                                                                      |
| POST        | /api/projects/:projectId/analysis                                | Fetch immutable GitHub snapshot and extract relative imports                                                    |
| GET         | /api/projects/:projectId/revisions                               | Latest 25 snapshots                                                                                             |
| GET         | /api/projects/:projectId/revisions/:revisionId/graph             | Nodes, edges and limitations                                                                                    |
| GET         | /api/projects/:projectId/revisions/:revisionId/source?path=...   | Exact revision source                                                                                           |
| GET, POST   | /api/projects/:projectId/features                                | List / create user-defined feature                                                                              |
| PUT         | /api/projects/:projectId/features/:id                            | Replace feature with `If-Match: <version>` optimistic concurrency                                               |
| PUT, DELETE | /api/projects/:projectId/features/:id/pin                        | Accept baseline / unpin                                                                                         |
| GET         | /api/projects/:projectId/pins                                    | List pins                                                                                                       |
| GET         | /api/projects/:projectId/features/:id/pin/compare?revisionId=... | Source, mapping and dependency changes                                                                          |
| POST, GET   | /api/projects/:projectId/investigations                          | Locate error and prepare deterministic investigation prompt / list                                              |
| GET, PATCH  | /api/projects/:projectId/investigations/:id                      | Read / edit prompt or close investigation                                                                       |
| POST        | /api/projects/:projectId/runs/import                             | Import public Actions run by `githubRunId`                                                                      |
| GET         | /api/projects/:projectId/runs                                    | Latest imported runs                                                                                            |
| PUT, DELETE | /api/projects/:projectId/investigations/:id/verification         | Associate exact-commit run using `runId` / remove association                                                   |

Shared request schemas live in `shared/src/schemas/domain.ts`. Feature requests carry `title`, `requirement`, `kind`, `paths`, and `revisionId`. Pin requests carry `revisionId` and `environment`. Investigation requests carry `revisionId`, `text`, and optional `manualPath`.

## Feature assessments

See [feature evidence API](feature-evidence.md) for static candidates, versioned assessments, targeted prompts and exact-commit run associations. These endpoints do not perform AI inference or run tests.

## Evidence rules

- Revision content is immutable by project and commit SHA.
- Features are user-defined requirements, not AI-discovered facts.
- Static import edges are not runtime calls or proof of behavior.
- Pinning snapshots code hashes and adjacent edges. It never marks a feature verified.
- Trace lines outside source bounds stay explicitly unavailable.
- Manual context stays distinct from trace matches.
- Imported runs come from GitHub, not user-submitted pass/fail values. Environment remains unknown because it cannot be inferred reliably from a run name.
- Verification associations require the same project and SHA; coverage remains user-associated and resolution unverified.

## Current limits and remaining implementation

GitHub fetching now requires a connected GitHub App installation; see [GitHub App setup](github-app.md). Analysis runs in durable MongoDB jobs with leases, retry limits and cancellation. Requests require an `Idempotency-Key` header. Analysis is bounded to 40 JS/TS files, 50 KB per file and 2 MB per snapshot; it always reports partial coverage. It does not execute repository code. Incremental indexing, complete pagination and graph storage partitioning remain outstanding.

Signed GitHub webhooks queue delivery processing. Actions dispatch checks repository write permission and the selected commit before submission; uncertain outcomes are persisted and never automatically resubmitted. Dispatch requires `Idempotency-Key`. Credential refresh uses encrypted rotating tokens and a database lease. Google/GitHub signup and browser sessions are implemented; see [authentication](authentication.md). AI feature discovery and diagnosis, deployment/data-access/drift engines, team membership and broader production quotas remain outstanding. Auth starts and callbacks have shared database request limits. Dispatch refresh imports only a provider-returned run ID; unknown submissions remain unconfirmed to avoid duplicate execution. Workflow listing, job-step retrieval, run refresh and cancellation are exposed under project workflows/runs routes. Cancellation is a request, not a completed result; refresh or webhooks establish the final state. Workflow steps are not automatically attributed to graph nodes.

UI integration and migration from the design prototype remain outstanding.

Run `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test` for database tests. Each test suite uses a unique database and removes only that database. Without this variable, database tests are skipped. CI provides MongoDB and runs them.

## Investigation rechecks

`POST /api/projects/:projectId/investigations/:id/recheck` accepts `revisionId`, optional fresh `text`, and optional `manualPath` (null clears previous manual context). The shared `investigationRecheckInput` schema defines this contract. A recheck creates a new open investigation with `parentId`; it does not modify the old prompt/status or inherit its test result. Omitted text preserves the original trace revision across subsequent rechecks. Historical line numbers are explicitly unavailable on a different snapshot; fresh text is mapped to the selected revision. File-only context can still be shown when paths match. Fresh user-supplied traces are not independently verified runtime evidence.

`GET /api/projects/:projectId/investigations/:id/graph` returns matching source nodes, adjacent static import nodes/edges, frames, commit SHA, coverage limits and a historical-trace flag. These edges are source relationships, not a claimed runtime error propagation path. Cause, fix and runtime proof remain unverified. Each recheck needs its own exact-commit run association via the existing verification endpoint.

## Analysis job scope and retries

Analysis jobs capture `requestedBranch` when queued. Switching the project's selected branch afterward does not change queued work. The branch tip is fetched when execution begins; the resulting snapshot records its actual immutable SHA. A repeated idempotency key returns its existing job, including its original branch. Revisions are deduplicated by project/SHA; a shared commit can have been first indexed on a different branch.

Project analysis locks have ownership tokens. A worker checks ownership before saving its snapshot and only releases its own lock. Expired/superseded work does not intentionally overwrite a newer lock. Archived or disconnected projects fail explicitly.

`POST /api/projects/:projectId/jobs/:id/retry` requeues a failed analysis job with its original branch and a fresh attempt budget. Active jobs cannot be retried, and this operation does not retry uncertain workflow dispatches. Jobs created before branch capture was added fail with `JOB_SCOPE_MISSING`; request a new analysis instead of guessing their intended branch.

## Project onboarding and recovery

- `GET /api/projects?status=active|archived&page=1` lists only the current account's projects. Pagination accepts positive integers up to 10000; each page contains at most 25 projects.
- `POST /api/projects/:projectId/restore` restores an owned project without deleting or recreating snapshots. It does not reauthorize GitHub or restart cancelled jobs. Repeating restoration is harmless.
- `GET /api/projects/:projectId/status` returns selected branch, locally known connection state, latest analysis job for that branch and snapshot metadata. `configured-unverified` is deliberately not a live access check; `remoteFreshness: not-checked` prevents presenting stale snapshots as current remote state.
- `GET /api/projects/:projectId/branches?page=1` revalidates GitHub repository access and returns up to 100 branch names, SHAs and protection flags. `mayHaveMore` signals a full page, not a guaranteed next page. This reads branches; it does not create or merge them. Select one through the existing project PATCH endpoint, then request analysis.

Branch API follows [GitHub's branch documentation](https://docs.github.com/en/rest/branches/branches#list-branches). Live provider testing remains pending credentials.

## Deployment probes

`GET /api/health` reports process liveness and does not require MongoDB. `GET /api/ready` returns 200 only when the database is connected and a MongoDB ping succeeds within a one-second operation deadline. Otherwise it returns 503 with a minimal `not-ready` response and no internal connection details. Readiness responses are not cached. Shutdown marks readiness unavailable before closing the HTTP server.

Use readiness for routing traffic and liveness for process monitoring. This probe checks database availability, not GitHub credentials, AI availability, queue throughput, or completeness of an analyzed project. Model indexes are initialized before the HTTP listener starts.
