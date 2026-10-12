# BUILD 30 — Coach-led plan change proposal, phase 1

Source: BUILD 29 candidate. New module: `src/lib/core/coach-plan-governance.ts` and 8 tests.

## Results
`node --experimental-strip-types --test src/lib/core/coach-plan-governance.test.ts`: 8/8 PASS.

## Behavior
- Proposals only; no plan writes or UI confirmation action yet.
- Explicit plan revision conflict protection.
- 200 x 400m hard intervals = 80,000m, flagged for clarification; no automatic acceptance.
- Running pain, focal bone pain or altered gait triggers safety block; user approval does not bypass.
- Ordinary edits require user confirmation; future-cycle changes require replan review.
- Evidence IDs retained and deduplicated.

## Not yet done
- No UI dialog or transactional apply endpoint.
- No proof of full TypeScript compile, production build or iPhone tests.
- No automatic coach plan creation or schedule persistence.
- This is a deterministic guardrail, not a medical diagnostic model.
- No deployment or mutation of existing user data.
