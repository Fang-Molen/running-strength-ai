# V6 Longitudinal Evidence Hardening

## Scope
Read-only deterministic projection of dated athlete evidence. Does not alter frozen V3.3 architecture, persist records, make medical diagnoses, estimate current fitness, or authorize plan changes.

## Implemented
- Chronological ordering without mutating caller arrays.
- Same-ID divergent evidence quarantined.
- Same-date contradictory PB evidence quarantined.
- Strict Gregorian calendar-date validation.
- Explicit missing recovery, symptom, session and current-performance evidence.
- Idempotent identical record handling.

## Verification
`node --experimental-strip-types --test src/lib/core/athlete-longitudinal-evidence.test.ts src/lib/core/coach-question-reasoning.test.ts`
14/14 passed (6 new + 8 existing). Full typecheck, full test suite, production build and UI integration NOT RUN. No unseen-case generalization claim.

## Limitations / Next gate
Existing `AthleteEvidence` schema lacks occurrence linkage, provenance granularity, event distance, pace, session effort, pain location and recovery window. Same-date PB collision detection is conservative; source-specific reconciliation needs explicit evidence identifiers. No learning weights or personal trend prediction until longitudinal training facts are integrated and independently evaluated.
