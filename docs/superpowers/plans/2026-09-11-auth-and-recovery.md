# Signup, sessions and run recovery

Goal: implement the approved Google/GitHub signup flow and complete durable dispatch result lookup without live credentials.

Architecture: provider adapters verify identity, an account service keys users by provider subject, and a session service issues hashed opaque credentials in HttpOnly cookies. Repository access stays in the existing GitHub App connection. The frontend completion URL is fixed server configuration. Matching emails never implicitly link accounts. Production cookies require HTTPS and same-site frontend/API deployment; unsafe cookie requests require an allowlisted Origin.

- [x] Add failing HTTP/database tests for provider start, cookie authentication, CSRF and session revocation.
- [x] Add AuthState model and account identity fields/index; state includes browser binding, expiry, PKCE and nonce. Implement provider configuration and verified Google/GitHub identity adapters.
- [x] Implement auth routes, secure cookies, account collision handling, session rotation/list/revoke and account response DTOs. Test callback replay, wrong browser, unverified email and duplicate account behavior with mocked provider exchanges.
- [x] Add durable dispatch refresh that imports only the returned GitHub run ID and preserves unknown status when no unambiguous ID exists. Test revision mismatch and project isolation.
- [x] Update environment examples/API docs and run formatting, typechecks, Mongo integration tests and build.

Validation: TEST_MONGODB_URI=mongodb://127.0.0.1:27029 npm test; npm run check. No provider tokens enter redirects or response bodies. Live provider verification remains pending configuration.
