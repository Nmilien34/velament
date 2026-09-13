# Production operations

## Database prerequisite

Snapshot persistence requires MongoDB transactions. Use a replica set (Atlas qualifies) or a sharded cluster. Local Compose and CI initialize a single-node replica set. A local single-node replica set provides transactions, not production redundancy.

## Monitoring

Set OPERATIONS_URL to the HTTPS backend origin and OPERATIONS_TOKEN to at least 32 random characters. Run from the repository root:

    npx tsx velament-backend/src/scripts/check-operations.ts

The command exits nonzero for unreachable/unready service, expired leases, ready jobs older than five minutes, uncertain dispatches, failed jobs, stale pending dispatches, or unhealthy worker heartbeat. Configure your host scheduler to run every minute and your monitoring provider to alert on nonzero exits. No alert destination is configured yet; this command does not send messages. Keep the token in the host secret store.

## Backups

Prefer the database provider's encrypted point-in-time backups. Configure daily snapshots, 30-day retention, an off-site encrypted destination, and restricted restore privileges once the provider is selected. These provider settings have not been applied.

For a manual logical backup, install MongoDB Database Tools, set MONGODB_URI and BACKUP_DIRECTORY (absolute path to an encrypted volume outside the repository), then run:

    npx tsx velament-backend/src/scripts/backup.ts

The URI is passed through a temporary owner-only config file rather than command-line arguments. Partial archives are removed, completed archives are owner-readable only. Logical dumps are not a guaranteed cross-collection point-in-time backup during concurrent writes; use provider snapshots or pause writes. Never treat an untested archive as a verified recovery plan. Restore into an isolated empty database using mongorestore and verify data before replacing any production database. Never use --drop on production as a test.

## Retention

    npx tsx velament-backend/src/scripts/retention.ts

Default is dry-run. --apply removes only completed/cancelled analysis jobs older than 90 days. Snapshots, evidence, failed jobs, dispatch records and webhook deduplication records are preserved. Removing a job also expires that job's idempotency key; do not replay old requests. Backups are not automatically deleted. Configure encrypted backup retention with the storage provider. Do not run this against production until the retention policy is accepted.

## Live verification remaining

GitHub App user OAuth requires browser sign-in. Real webhook delivery requires a public HTTPS endpoint and App webhook configuration. Render is deployed at https://velament-backend.onrender.com. The production backup policy and alert destination still require verification. Scripts and checks are prepared; production scheduling and alert delivery are not active.

See [backend recovery](backend-recovery.md) for dispatch reconciliation, pagination, revocation fencing and permanent deletion.
