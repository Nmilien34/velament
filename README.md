# Velament

TypeScript MERN monorepo using npm workspaces.

- `velament-frontend`: React + Vite; feature UI, browser services and assets.
- `velament-backend`: Express + Mongoose; controllers handle HTTP, services own business logic, models own persistence.
- `shared`: public API contracts and constants. Never import server secrets or Mongoose models into this package.

## Development

Use Node 22 and npm. Run `npm install`, copy `.env.example` to `.env` if absent, and start MongoDB locally. Then run `npm run dev`.

Frontend: http://localhost:5173 · API: http://localhost:4000/api/health

`npm run build`, `npm run typecheck`, `npm test` validate the workspace. Build shared before starting either application independently. The backend connects to MongoDB before listening; health is a liveness endpoint.

Only `VITE_` environment variables are exposed to the browser. Never put secrets in them. `.env` is ignored; `.env.example` is committed. Deployment environments should inject their own values.

The backend now implements Google/GitHub authentication, browser sessions, GitHub App connections, bounded repository analysis, feature/pin persistence, investigations, durable jobs, webhooks and Actions run management. Provider configuration and live integration testing are still required. The frontend remains a scaffold; prototype screens have not been migrated. See [backend API](docs/backend.md), [authentication setup](docs/authentication.md), and [GitHub App setup](docs/github-app.md). Keep feature-specific types close to their feature; promote only cross-boundary contracts to shared. TypeScript types do not replace runtime validation of untrusted input.

## Root infrastructure

`npm run db:up` starts a local-only MongoDB container with persistent storage; `npm run db:down` stops it without deleting data. Docker is required. This compose file is for development, not production.

`CLIENT_ORIGIN` accepts an explicit comma-separated origin allowlist. CORS is browser policy, not authorization. Cookie credentials are not enabled yet; session auth will need explicit cookie and CSRF design. Request IDs are returned in `X-Request-Id`. Helmet and a 1 MB JSON body limit are enabled.

`npm run check` runs formatting, typechecking, tests and builds. GitHub CI runs on pushes and pull requests. OAuth credentials, rate limits and production proxy settings belong with their implementations rather than speculative environment placeholders.

## Backend API

See [backend implementation and API reference](docs/backend.md) for authentication, endpoint contracts, evidence rules and current integration limits.
