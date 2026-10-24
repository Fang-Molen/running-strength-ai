# R4 coaching loop implementation plan

> Execute inline using superpowers:executing-plans. Continue the user's explicit implementation request from fcf38db.

Goal: make saved personal conditions and R4 knowledge change the real coach answer, connect existing course/calendar confirmation, and refresh dependent answers after corrections.
Architecture: reuse the scoped personal profile, canonical facts, schedule writer and existing confirmation stores. No parallel user database or self-issued scientific approval. Local deterministic answers remain available without paid model execution.
Spec: CODEX-TASK.md, R4 implementation contract, and the user's continuation request.

## Constraints and review focus
- Preserve original files and user records; no paid calls, deployment or cleanup.
- Reject foreign, stale, future or invalid profiles; unknown is never healthy adult.
- Distinguish reference applicability, existing user-confirmed course choice and professional approval.
- Confirmation must bind current profile, facts, course and calendar versions; cancellation writes nothing.
- Corrections change material revisions; delayed old answers cannot replace newer records.

## Work
- [x] Add `r4/conditions.ts` and `r4/answer.ts`: use validated saved personal profile and actual facts; card-level applicability and explicit missing conditions. Test missing/stale/special populations and question scope.
- [x] Wire the actual coach-sheet local answer branch to R4, showing factual calculations, sources and relevant existing course candidates. Preserve safety precedence and original question.
- [x] Connect course/calendar choices to confirmed execution with authoritative saved inputs, atomic writes, persisted receipts, cancellation, stale rejection and undo. Reuse schedule writer and preserve V4 documents.
- [x] Add material-version refresh across profile, training and nutrition corrections; keep historical replies with stale indicators and explicit refreshed answer.
- [x] Fix the 18 TypeScript diagnostics at their causes, including replacing private test-fixture dependency with an explicitly synthetic fixture; never reintroduce personal plans into production.
- [x] Build with local-preview permissions and drive desktop/mobile browser paths: question → profile → changed answer → candidate/confirmation → calendar → correction → updated answer. Block model routes and capture rendered evidence.
- [ ] Review and commit working changes, record remaining failures honestly, deliver answer comparisons before test totals.

## User steering incorporated
- Training plan page: explicit date move or two-course swap, atomic confirmation and undo.
- Muscle training history: 3/7/14-day display, default 7; existing fatigue/exposure windows unchanged.
- Stop repeated checks after the user requested it; collect current results and deliver.
- Build and targeted browser flows passed, but missing source assets and smoke baseline differences remain. See evaluation/r4/COACHING-LOOP-RESULT-20261024.md for precise limits and unfinished capabilities.
