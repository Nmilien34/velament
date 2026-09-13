# Backend design audit — 2026-09-12

## Verdict

The backend is a working repository investigation foundation, not yet the complete backend for every behavior shown in the prototype. Passing the test suite establishes regression coverage for implemented behavior; it does not establish design completeness or production readiness.

Compared the prototype's `dist/index.html`, `feature-check.js`, and linked investigation/run workflows with the current routes, services, models, shared contracts and tests. The prototype lives in the Codex design workspace; it is not the React application in this repository. No frontend changes were made.

## Workflow coverage

| Designed workflow                        | Backend status                                                                           | Remaining gap                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google/GitHub signup, sessions           | Provider/session routes and account lifecycle exist                                      | Complete production browser OAuth round trip remains unverified                                                                                                                                     |
| Connect GitHub, choose repository/branch | GitHub App connection, repository access and branch listing exist                        | Real webhook delivery and signed-in Actions authorization still need production verification                                                                                                        |
| Analyze and draw codebase                | Durable jobs, immutable snapshots, static graph, cancellation and coverage limits        | Limited captured workspace resolution is implemented; no semantic call graph or runtime tracing; animation must describe analysis progress rather than pretend to show execution                    |
| Discover/add/check a feature             | Manual feature library, static candidates, scoped AI discovery, versioned assessments    | Resumable snapshot batches exceed the prior 40-file total limit; no cross-batch semantic merging. Oversized files are split by line; files containing an individually oversized line remain skipped |
| What's real?                             | Added static pattern findings and revision-scoped intentional reviews in this change     | Heuristics cover literals, selected request/network calls, explicit test doubles and not-implemented errors; arbitrary custom mocks and behavior are not inferred                                   |
| Explain error visually                   | Trace-to-source mapping, graph context, historical recheck and scoped AI diagnosis exist | No source-map ingestion or instrumented runtime trace capture                                                                                                                                       |
| Run tests and show outcome               | Workflow listing/dispatch/import/jobs/cancel and uncertain-dispatch reconciliation exist | A branch can move before GitHub checkout; matching run SHA is checked afterward. Workflow success is not feature-level proof                                                                        |
| Don't break this / pinned features       | Pin baselines, explicit comparison and automatic comparison on completed analysis exist  | Opt-in push analysis is implemented; feature-targeted regression execution is not                                                                                                                   |
| Feature test proof                       | Exact-project/commit user association exists                                             | User-uploaded assessment reports now bind named outcomes to run attempts; explicit CI artifact import is implemented; independently verified coverage remains absent                                |
| Activity, archive, delete                | Activity, pagination, archive/restore, deferred transactional purge exist                | Runtime/integration events depend on real provider delivery; external backups have separate retention                                                                                               |
| Operations                               | Token-protected metrics, bounded retries, deletion backlog and release checks exist      | External alert schedule/delivery and backup restore exercise remain unverified                                                                                                                      |

## Implemented in this audit

1. `GET /api/projects/:projectId/revisions/:revisionId/reality` provides source-pattern findings, SHA, line anchors, limitations and intentional reviews. Optional `featureId` limits findings to that active feature's mapped paths. Empty findings mean unknown, never verified real.
2. `PUT .../reality/:findingId/review` accepts `{ "reason": "..." }`; verifies the finding exists in the exact revision. `DELETE` clears that review. Reviews do not transfer to a different revision and never change runtime verification. Permanent deletion purges reviews.
3. Literal relative `import(...)` and `require(...)` references are included in the graph. `.mjs`/`.cjs` source ingestion and `.mts`/`.cts` resolution are supported. Computed targets remain unresolved. A require-name match is not proof of runtime module binding.

Existing snapshots are immutable: graph improvements appear after a new analysis, not by rewriting historical evidence. Reality findings can inspect existing stored snapshots.

## Remaining implementation priorities

These are code/product gaps, not merely missing API keys:

1. User-uploaded reports now capture exact SHA, attempt, environment, mock boundaries and staleness. Explicit bounded GitHub artifact import is implemented. Still needed: independently verified test-to-requirement mapping before claiming feature pass/fail.
2. Automatic comparison on completed analysis is implemented with transactional, deduplicated activity. Opt-in tracked-branch push analysis is implemented. Still needed: feature-targeted test execution. Unchanged source is not a passing feature test.
3. Resumable repository discovery now exposes deterministic batches, progress and per-batch provenance. Line-based oversized-file splitting is implemented. Still needed for broader coverage: cross-batch semantic aggregation. Stopping batch submissions pauses work; in-flight provider calls are not recalled.
4. Extend graph resolution with captured configuration and package/workspace rules. Runtime node animation requires actual instrumentation; it cannot be derived from imports.

## Verification and production boundary

Regression tests cover reality anchors, review persistence/revision isolation, invalid findings, unauthenticated access and literal graph edges. The full isolated-database suite and build are run before committing. No real user deletion or remote workflow is triggered as a test.

Production release verification, webhook delivery, browser OAuth, alert receipt and backup restoration must be exercised separately. Do not describe this backend as fully done until the intended MVP scope above is either implemented or explicitly narrowed.

## AI access completion fence

Feature discovery and error diagnosis now capture the access generation before reading source and commit results in a transaction that checks the generation and writes the active project. Revocation, project archive, or pending deletion during the provider request prevents accepting its result. Source already sent to the provider cannot be recalled. Historical cached results remain subject to existing project access rules.

## Captured workspace resolution

The static graph now resolves root `package.json` workspaces declared as exact paths or whole-directory `*` patterns. A unique member name and an explicit importing package dependency are required (`*`, `workspace:*`, `workspace:^`, `workspace:~`, or the captured exact version). Self-references are also supported. String exports, exact and single-wildcard string subpath exports, and explicit `main` entries can connect to captured source, including existing JavaScript-to-TypeScript extension substitution. Exports take precedence over main; private subpaths stay unresolved.

Conditional exports, general semver ranges, pnpm YAML workspace declarations, external packages and missing build outputs remain unresolved. No `dist`-to-`src` mapping is inferred. This is static source association, not proof of the installed dependency graph or runtime behavior. Package manifests share the existing capture budgets; existing revisions need reanalysis to include them.

The supported subset follows [npm workspace declarations](https://docs.npmjs.com/misc/workspaces/) and [Node package entry points](https://nodejs.org/api/packages.html).
