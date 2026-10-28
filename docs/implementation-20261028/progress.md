# Execution ledger — plan: docs/implementation-20261028/implementation-plan.md

## Authorization and baseline
User explicitly requested direct implementation on 2026-10-28. The supplied plan and full specification are the approved design; do not re-ask product questions already resolved there.
Task 0 intake recorded; final build/regression evidence pending. Local branch starts at verified prior delivery de6bc5f, then imports the uploaded fusion snapshot without deleting files omitted by packaging. The claimed 0d4293b identity is unverified; GitHub master was read as fb6d614 and PR #5 is merged. Network fetch was interrupted before execution; no remote refs were changed.
Node 24.19.0, npm 11.9.0. Lockfile byte-identical to installed dependencies; reusing node_modules. DATABASE_URL and model keys absent. Never run package build script because it includes db:migrate; use build:dev/build:server with keys and DB unset.

## Rulings and shared interfaces
- Supplied 20261028 plan/spec supersede conflicting older per-turn-consent and globally-local-only policies. Explicit offline preference still wins; formal mutations still require preview and confirmation.
- Task 1 supplies durable restore status and write coordination; Tasks 2 and 4 must consume these boundaries rather than invent alternate storage writers.
- Tasks 3 and 5 share semantic scope and output assertions; Task 4 retains real identity and budgets while changing persistent authorization and concurrent snapshot semantics.
- Task 0: use existing local delivery as Git parent and record imported handoff as a separate baseline commit; avoid waiting on network for independent local work. Cost: this branch must later be reconciled against remote master before any publication.
- No production accounts, live data, paid calls, migrations, deployment or external publishing. All fixtures synthetic. Preserve failures and evidence.

## Implementation updates (2026-10-28)
- Independent agents follow the explicitly applicable parallel-dispatch workflow for disjoint storage, semantics, context, backend and training domains; shared contracts are agreed before integration. No concurrent edits to the same owned files.
- Root code now connects automatic per-question online lifecycles, persistent preference sync, scoped source freshness, stored-answer stale labels and shared output classification. Old per-turn consent tests retain their scenarios with the approved v2 expectations; the old blanket unsafe-output waiver is retired.
- Baseline hydration failure was an obsolete first-frame navigation assertion: current app intentionally renders a storage loading gate. Test updated to check the gate and retained all no-personal-data-on-first-render assertions; direct test passes. No UI relaxation was introduced.
- New root failures reproduced and corrected: write failure/flush acknowledgement; deletion cache; queued local write versus external broadcast; writes appended during flush; physical pre-migration value captured inside the replacement transaction; boot overriding an authenticated athlete scope.
- Restore remains isolated-candidate-only in physical browsers because frozen legacy writers cannot be forcibly isolated. Pure transaction/recovery engine and disk journal tests are available; no active-browser-restore completion claim.
- Corrected fact and pending review intent persist together; restart retry and read-side stale/unknown handling survive audit failure and same-millisecond VOID/RESTORE. Conflicting source rows are now quarantined before freshness comparison. A missing initial capture remains pending, not fresh.
- Focused frontend typecheck passed at integration snapshot; later scoped changes await the final concentrated run. Backend tests include real local HTTP/controller, signed synthetic identities and PGlite, with provider transport mocked and native outbound blocked.
- Native Chromium browser journeys are now in progress on the current worktree dev server; all third-party requests blocked. No real user/device/model credentials supplied or used.
- Source import commit149c11f is preserved separately. No external push/PR/deploy this round. Full-source packaging and local implementation commit follow final evidence collection.

## Task state (working status; see coverage-final.json for individual issues)
0 baseline: in progress
1 storage/restore: implementation present; integration/remaining boundaries tracked
2 facts/corrections: implementation present; integration/remaining boundaries tracked
3 semantics/restrictions: implementation present; integration/remaining boundaries tracked
4 automatic online/concurrency: implementation present; integration/remaining boundaries tracked
5 context/assertions: implementation present; integration/remaining boundaries tracked
6 capabilities/recovery: implementation present; integration/remaining boundaries tracked
7 cycle/running/strength: implementation present; integration/remaining boundaries tracked
8 nutrition/feedback: implementation present; integration/remaining boundaries tracked
9 external capability matrix/runbooks: documented in external-validation.md; real execution unauthorized
10 integrated verification/delivery: pending

## Resumed delivery evidence

- Source and prior modifications preserved; latest remote master re-read as fb6d614. No external publication.
- Actual retry failure RED→GREEN under StrictMode. Independent read-only review identified selected-training propagation, educational quantity classification and early-return online gaps; each reproduced and fixed. No second general review.
- Project test stages completed in segments after the obsolete missing-source status assertion was corrected; original failure preserved. Only affected modules rerun after the final fixes (9 files pass); typecheck-final.exit=0.
- Actual UI/controller/synthetic database/provider journey passes 6 groups including selected 40/50 kg excluding 90 kg and correction to45 kg invalidating old answer. Personal and backup browser journeys pass within their documented limits.
- Frontend and Node build outputs generated. Interrupted tool return lost exact build exit receipts; built runtime launch not completed. See final/build-artifacts.json.
- Ruling: Preserve isolated browser restore until all physical writers can be isolated; no active-restore success claim. Cost: manual recovery remains restricted.
- Ruling: Read-time missing/conflicting claim sources remain REVIEW_REQUIRED, rather than labeling old unbound hypotheses current. Cost: old unsupported explanations need review.
- Ruling: Respect user request against repeated full review/testing; one independent review, one concentrated suite and final affected regression. Cost: no second whole-suite pass after localized final review fixes.
- Task10 delivery is a bounded local patch with explicit remaining gaps, not acceptance of all54 items.
