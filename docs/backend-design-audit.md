# Backend design audit — 2026-09-12

## Verdict

The backend is a working repository investigation foundation, not yet the complete backend for every behavior shown in the prototype. Passing the test suite establishes regression coverage for implemented behavior; it does not establish design completeness or production readiness.

Compared the prototype's `dist/index.html`, `feature-check.js`, and linked investigation/run workflows with the current routes, services, models, shared contracts and tests. The prototype lives in the Codex design workspace; it is not the React application in this repository. No frontend changes were made.

## Workflow coverage

| Designed workflow | Backend status | Remaining gap |
| --- | --- | --- |
| Google/GitHub signup, sessions | Provider/session routes and account lifecycle exist | Complete production browser OAuth round trip remains unverified |
| Connect GitHub, choose repository/branch | GitHub App connection, repository access and branch listing exist | Real webhook delivery and signed-in Actions authorization still need production verification |
| Analyze and draw codebase | Durable jobs, immutable snapshots, static graph, cancellation and coverage limits | No semantic call graph, workspace aliases or runtime tracing; animation must describe analysis progress rather than pretend to show execution |
| Discover/add/check a feature | Manual feature library, static candidates, scoped AI discovery, versioned assessments | AI scope remains 40 files/80 KB; no whole-repository semantic discovery orchestration |
| What's real? | Added static pattern findings and revision-scoped intentional reviews in this change | Heuristics cover literals, selected request/network calls, explicit test doubles and not-implemented errors; arbitrary custom mocks and behavior are not inferred |
| Explain error visually | Trace-to-source mapping, graph context, historical recheck and scoped AI diagnosis exist | No source-map ingestion or instrumented runtime trace capture |
| Run tests and show outcome | Workflow listing/dispatch/import/jobs/cancel and uncertain-dispatch reconciliation exist | A branch can move before GitHub checkout; matching run SHA is checked afterward. Workflow success is not feature-level proof |
| Don't break this / pinned features | Pin baselines, explicit comparison and automatic comparison on completed analysis exist | Automatic analysis on push and feature-targeted regression execution are not implemented |
| Feature test proof | Exact-project/commit user association exists | No test report ingestion and explicit test-to-requirement coverage model; verification deliberately remains not established |
| Activity, archive, delete | Activity, pagination, archive/restore, deferred transactional purge exist | Runtime/integration events depend on real provider delivery; external backups have separate retention |
| Operations | Token-protected metrics, bounded retries, deletion backlog and release checks exist | External alert schedule/delivery and backup restore exercise remain unverified |

## Implemented in this audit

1. `GET /api/projects/:projectId/revisions/:revisionId/reality` provides source-pattern findings, SHA, line anchors, limitations and intentional reviews. Optional `featureId` limits findings to that active feature's mapped paths. Empty findings mean unknown, never verified real.
2. `PUT .../reality/:findingId/review` accepts `{ "reason": "..." }`; verifies the finding exists in the exact revision. `DELETE` clears that review. Reviews do not transfer to a different revision and never change runtime verification. Permanent deletion purges reviews.
3. Literal relative `import(...)` and `require(...)` references are included in the graph. `.mjs`/`.cjs` source ingestion and `.mts`/`.cts` resolution are supported. Computed targets remain unresolved. A require-name match is not proof of runtime module binding.

Existing snapshots are immutable: graph improvements appear after a new analysis, not by rewriting historical evidence. Reality findings can inspect existing stored snapshots.

## Remaining implementation priorities

These are code/product gaps, not merely missing API keys:

1. Define a trustworthy test-report contract and per-feature test mapping before claiming feature pass/fail. Include exact SHA, attempt, environment, mock boundaries and evidence freshness. Ingest CI reports against that contract.
2. Automatic comparison on completed analysis is implemented with transactional, deduplicated activity. Still needed: an explicit automatic-analysis policy for pushes and feature-targeted test execution. Unchanged source is not a passing feature test.
3. Add bounded whole-repository AI selection/chunking, aggregate provenance and cancellation instead of silently enlarging a single prompt.
4. Extend graph resolution with captured configuration and package/workspace rules. Runtime node animation requires actual instrumentation; it cannot be derived from imports.

## Verification and production boundary

Regression tests cover reality anchors, review persistence/revision isolation, invalid findings, unauthenticated access and literal graph edges. The full isolated-database suite and build are run before committing. No real user deletion or remote workflow is triggered as a test.

Production release verification, webhook delivery, browser OAuth, alert receipt and backup restoration must be exercised separately. Do not describe this backend as fully done until the intended MVP scope above is either implemented or explicitly narrowed.
