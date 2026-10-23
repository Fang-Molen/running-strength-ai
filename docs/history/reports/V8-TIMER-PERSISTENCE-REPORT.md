# V8 Timer Persistence — candidate, not deployed

- Fixed: absolute wall-clock deadline persisted per decisionId/sessionId; pause stores remaining milliseconds, resume stores new deadline. Screen-lock throttling, reload, midnight and expiry covered in pure tests.
- Restoration validates checkpoint and matches an *open* next strength set. Malformed/mismatched snapshots discarded. Completion, interruption, next-set and expiration clear timer checkpoint.
- Prior V7 manual backfill shortcut remains: set training occurredAt to yesterday 18:00 (editable); this does not retroactively bind imported facts to planned occurrence.
- 7 new rest-clock tests plus 8 coach question tests: 15/15 PASS. No iPhone screen-lock test, no full typecheck/build, no production deploy. Browser storage may be evicted; wall-clock edits can affect deadlines.
- Remaining: connect historical imports to canonical occurrence only with explicit user confirmation, idempotency and audit trail; verify PWA foreground/background behavior on iOS.
