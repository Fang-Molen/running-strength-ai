# BUILD 45C — deterministic task routing candidate

Source: BUILD 45B candidate. Added `src/lib/core/ai-task-router.ts` and 12 new tests. Previous 34 tests plus 12 = 46/46 PASS using `node --experimental-strip-types --test`. See `BUILD45C-TESTS.log`.

The default route for period planning, product management, training logs, basic coaching, and local OCR is free local. Image semantics defaults to consent-gated free remote; deep reasoning defaults to server-granted metered remote. Any explicit paid route request that fails authorization offers local fallback, not a paywall on the original feature. Image upload requires a separate confirmation. Safety block vetoes every route. This module only returns routing decisions and never sends data, charges credits, modifies plans, or grants access.

No real AI provider, backend, payment, card redemption, or persistent credit ledger. Not integrated into App UI. `serverAuthorized` is untrusted caller input and MUST be verified server-side before production requests. node_modules unavailable, so full typecheck, production build and browser verification NOT RUN. No deployment or user-history changes.
