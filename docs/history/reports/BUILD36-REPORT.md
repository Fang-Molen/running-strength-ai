# BUILD 36 — Network consent foundation

Base: BUILD 35 complete candidate. Changes: `src/lib/core/coach-network-policy.ts`, its 10 tests, and `src/components/coach-sheet.tsx`.

## Actual verification
`node --experimental-strip-types --test src/lib/core/coach-network-policy.test.ts`: 10/10 PASS.

## Implemented
- Explicit user-controlled public reference preference, default off, persisted in localStorage.
- Three fixed public resource links open in a new tab; no automatic scraping, no personal data upload.
- Offline link gating; local coach stays independent.
- Paid model attempt is denied without server authorization, even if a user clicks confirm. Existing old server function remains in code but is not reachable via the new guarded path; production audit needed.

## Not implemented / not tested
- Actual live internet search, source freshness/verification, background monitoring, credit grant/approval service, private data consent UI for sending, full app typecheck/build, browser/iPhone E2E.
- This is not a deployed online agent. No server credentials are included.

## Release constraints
- Keep V3.3 frozen decisions; no plan mutation in this build.
- Independent candidate only; no overwrite of existing deployed app or browser localStorage.
- To enable advanced model calls, implement and test a server-side authorization/credits service first; never remove the guard just to demo.
