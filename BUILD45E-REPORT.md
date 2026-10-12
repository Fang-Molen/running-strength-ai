# BUILD 45E — purpose-aware running session observations

Base: BUILD 45D candidate, no production deployment.

Added `src/lib/core/running-session-context.ts` and six focused tests. Evaluates explicit session purpose (even pace, progressive faster/slower, unspecified) against time-series observations without inventing purpose. Retains per-repetition target differences and source event IDs. Reports whether pre-session, inter-repetition rest, post-session, 24h and 48h recovery context is present; missing inputs remain missing. No fatigue diagnosis, automatic plan change, paid-model calls, training-history mutation, or safety-rule changes.

Validation: 12/12 combined BUILD 45D+45E isolated tests passed using `node --experimental-strip-types --test ...` (see BUILD45E-TEST.log). Full typecheck/build/browser UI and end-to-end integration NOT RUN (dependencies absent). The alignment flag is descriptive and not a coaching judgment. Explicit purpose is mandatory for alignment.

Next: bind real trainingOccurrenceId and plan snapshot to UI read-only view; add rest interval and target progression semantics; confirm against actual training logs; integrate model authorization UI separately.
