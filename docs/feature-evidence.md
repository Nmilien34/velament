# Feature evidence API

This implements the source-evidence portion of Check a feature. It is deterministic and runs locally on an already analyzed revision. No LLM calls or repository execution occur. Static export candidates are not AI-discovered product features.

All routes require a session and project ownership.

| Method | Route under /api/projects/:projectId      | Input / result                                                                                           |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | /revisions/:revisionId/feature-candidates | Up to 200 named exported functions/classes, each with source path, line and unverified provenance        |
| POST   | /features/:id/assessments                 | Body: revisionId, featureVersion. Creates a source assessment for that exact requirement version and SHA |
| GET    | /features/:id/assessments?page=1          | Historical assessments, 25 per page                                                                      |
| GET    | /assessments/:id                          | Assessment, requirement-staleness flag, archive flag and any associated run                              |
| PUT    | /assessments/:id/verification             | Body: runId. Associates an imported run from the same project and exact SHA                              |
| DELETE | /assessments/:id/verification             | Removes the association                                                                                  |

## Flow

Inspect candidates from a revision, then create or select a feature through the existing features API. Candidate symbols only provide a starting point: the user supplies the actual requirement and confirms source paths. Named exports, not routes or whole business journeys, are what this initial scanner recognizes. Test files and TypeScript declaration files are excluded from candidates. The snapshot can omit other relevant files.

Create an assessment using the feature's current version. A changed version returns 409; archived features cannot be assessed. The assessment preserves the requirement text, commit and evidence. A later requirement edit does not rewrite history; reading the assessment returns `stale: true`. This flag concerns feature-definition changes, not whether the commit is still the GitHub branch head. The SHA remains explicit.

Implementation describes source availability: unmapped, source-present, source-partial or source-unavailable. Connection describes imports from outside the selected scope. No observed incoming import does not prove the feature is unreachable: framework entry points and independent workers may run without one.

Proof remains `not-established`. Associated runs expose actual provider status/conclusion, but coverage is user-associated and feature verification is still not established. A passing workflow alone cannot prove this particular behavior was exercised. Environment provenance follows the imported run; it is not inferred from names.

The deterministic investigation/fix prompt includes the exact SHA, requirement, source references and snapshot limits. It asks the coding agent to inspect actual entry-point wiring and validate with an integration or end-to-end test. It does not invent a diagnosis or code patch, send prompts to agents, or change source. No assessment endpoint marks a feature fixed automatically.

AI-based business-feature discovery, semantic diagnosis, runtime coverage mapping and frontend wiring remain separate implementation work. Shared `FeatureCandidate` and `FeatureEvidence` types are exported for frontend consumption.

## OpenAI feature discovery

`POST /api/projects/:projectId/revisions/:revisionId/ai-discovery` accepts
`{ paths: ["src/example.ts"], allowSourceSharing: true }`. Only explicitly selected
snapshot files are sent to OpenAI. Requires `OPENAI_API_KEY`; `OPENAI_MODEL`
defaults to `gpt-4.1`. This is separate from static export discovery.

The endpoint returns saved candidate features, exact source citations, model and
token usage, immutable revision SHA, and limitations. Candidates are unverified;
no tests run and no tracked feature is created automatically. Citation validation
checks locations and quotations, not the truth of an AI interpretation.

Requests are bounded to 40 files / 80 KB serialized source, 3,000 output tokens,
60 seconds, no automatic provider retries, and 10 new requests per user per hour.
Identical revision/scope requests return the saved record (202 while pending).
Provider failures are saved as failed and are not automatically retried to avoid
uncertain duplicate charges. GET `/api/projects/:projectId/ai-discoveries/:id` polls saved status. Pending
records older than two minutes are marked failed with `AI_REQUEST_INTERRUPTED`
on polling or a repeated discovery request. Late results cannot overwrite this
state. No automatic retry occurs. To explicitly retry a failed analysis, repeat the POST
with the same paths, `allowSourceSharing: true`, and `retryAttempt` equal to the
returned attempt number. Refresh status after a 409 conflict. A retry may incur
another provider charge even when the previous response was lost. Concurrent
retries claim one attempt, and late responses from older attempts are rejected. The frontend must explain source sharing
before sending the request. `store: false` is set; this is not a promise of zero
provider retention. Do not select files containing credentials.

## AI error diagnosis

`POST /api/projects/:projectId/revisions/:revisionId/investigations/:investigationId/ai-diagnosis`
uses the same selected `paths`, `allowSourceSharing: true`, optional `retryAttempt`,
limits, caching, and polling lifecycle as discovery. Source-sharing consent covers
both the selected source and the stored error text; review traces for secrets before
sharing. The investigation must belong to the requested project and revision.

Saved results include `kind: error-diagnosis`, investigation ID, SHA, hypotheses,
validated source citations, next steps, a copyable investigation/fix prompt, usage,
and historical-trace status. Citations can highlight graph file nodes; they do not
prove causation. No code is edited and no tests run. Review generated prompts before
handing them to an agent. Historical traces require reproduction against the current
revision. Changed error text creates a distinct cached scope.
