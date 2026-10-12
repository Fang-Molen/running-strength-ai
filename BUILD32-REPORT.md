# BUILD 32 — Context-sensitive coach tone (candidate)

Based on BUILD 31 candidate. Changed `src/lib/core/coach-persona.ts` and its test only.

- Strict, gentle, analytical styles now choose distinct training/nutrition/recovery/safety/general framing.
- Underlying reply text remains byte-for-byte unchanged. The style classifier is **not** a medical triage system and cannot change risk, plan, or permissions.
- Invalid persona falls back to balanced. Empty reply remains empty.
- Targeted test: 7/7 PASS using `node --experimental-strip-types --test src/lib/core/coach-persona.test.ts`.
- NOT tested: full typecheck, production build, browser, iPhone, safety generalization.
- No frozen decision rules modified, no deployment, no localStorage migration.
