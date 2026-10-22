# Incremental sync and data paths implementation plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task; work is already authorized by the user's request to fix and verify the existing app.

**Goal:** Stop repeated Garmin history reads while verifying that completed training, health and food records remain accurate and available to 方坤.

**Architecture:** Commit daily health receipts independently of training import conflicts. Scope receipts to the athlete and Garmin account; daily sync reads recent dates and explicit gaps, while manual review remains available. Reuse the existing confirmed-data read models for all downstream checks.

**Tech Stack:** TypeScript, React, local durable stores, Node tests and isolated browser fixtures.

**Spec:** User's 2026-10-22 request: subsequent sync still reads too much; also check today's completed training, duplicate records, 方坤 access, and health/nutrition data paths.

## Global constraints

- Preserve the accepted UI, health trend navigation, original records and manual corrections.
- No real account requests, paid model calls, deployment or database migrations during verification.
- Use the previous delivered S1 archive as the baseline. Do not silently replace source history or mark failed reads as complete.
- Normal established sync reads recent 3 days plus explicit missing dates, with at most 14 older catch-up dates per run. Manual review reads 14 days and at most 200 activities.
- A single failed health endpoint retains the date for retry; activity conflicts remain visible and cannot reset successful health progress.

## Review focus

- Mixed success: health saved while an activity conflicts; health receipts must advance and the conflict must remain reported.
- Interrupted / cross-day catch-up: already checked historical dates must not be requested again; old pending dates must not disappear.
- Account or athlete switches, including A→B→A during a request, must invalidate the result and its progress.
- Repeated completion/import must not double count the same source identity; similar independent activities must not be silently merged.
- Unknown nutrition values, same-day different meals, corrections and removals must be reflected accurately in 方坤's latest read.

## Task 1: Runner and scheduling (runner agent)

**Files:** `src/lib/health/garmin-sync-runner.ts`, `garmin-daily-progress.ts`, related tests.

**Interface:** `GarminDailyProgress = {checkedDays:string[]; pendingDays:string[]; lastSyncAt:string|null; intradayCheckedDays?:string[]}`; optional `host.dailyProgress.get/set`; optional `save().healthErrors`; new report mode `BACKFILL`.

- [x] Reproduce repeated INITIAL with legacy cursor 42 and four activity errors.
- [x] Add failing tests for category-independent progress, bounded catch-up, per-endpoint errors, cross-day gaps, empty intraday receipts and ownership fences.
- [x] Implement modern receipt-based scheduling while preserving conservative compatibility for hosts without receipts.
- [x] Run runner / scheduling / performance regressions and save actual request counts.

## Task 2: Durable host integration (root)

**Files:** `src/lib/health/garmin-progress-store.ts`, `src/lib/ui/device-store.ts`, `src/components/garmin-sync.tsx`, `src/lib/health/garmin-sync-status.ts`, related tests.

**Interface:** Read/write daily progress with explicit scope and subject and verified durable writes; expose health errors from the single existing batch save; retain the legacy public save result for other callers.

- [x] Add tests for account/athlete isolation, corrupt progress, failed writes, and health-versus-activity errors.
- [x] Implement receipt storage and connect the real host; invalidate an in-flight sync when the athlete changes.
- [x] Update existing compact details to distinguish catch-up from first sync and show actual requested date counts.
- [x] Verify ordinary sync, manual review and source conflict preservation in the real browser entry point.

## Task 3: Data path verification (training and nutrition agents)

**Files:** Actual training completion/record/coach read models and actual health/food confirmation/coach read models; only confirmed defects receive minimal fixes.

- [x] Exercise completed and partially completed training, repeated imports, source corrections, manual corrections and athlete isolation using synthetic records.
- [x] Exercise confirmed health, multiple same-day meals, editing/removing a meal, unknown nutrition and latest 方坤 context.
- [x] For each defect, capture a failing test, apply the smallest correction, and rerun the affected tests.
- [x] Record which paths were executed and distinguish code-level synthetic evidence from real-account end-to-end verification.

## Task 4: Delivery (root)

- [x] Review all changes against the prior archive and verify no baseline files were lost.
- [x] Run relevant data-contract tests, application typecheck, clean build and bounded dev/production browser checks.
- [x] Package the complete source and a concise verification report with test counts, actual requests, unresolved limits and reproduction instructions.
- [x] Prepare the updated delivery and a short Chinese explanation for final file handoff.
