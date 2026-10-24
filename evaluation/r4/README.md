# R4 review delivery — 2026-10-24

This is a review branch based on V89.10.16 / `d8a3f02`. Full application acceptance is **not passed**. No deployment or new model execution is authorized by this delivery.

Original R4 files and their publisher manifest are in `knowledge/professional-r4-20261024/`. The new adapter is `src/lib/coach/r4/`; it reads the original `runtime/kb.mjs` and keeps all material reference-only. The existing analysis host exposes an explicit, read-only preview through `readAnalysis(day, asOf, question, {r4ReferencePreview: true})`. The default is disabled (`professionalReference: null`). No UI automatically enables it. Unknown population produces no adult reference selection. Even selected cards have `applicability: NOT_ESTABLISHED` and cannot authorize a course.

Reproduce deterministic verification without model access:

```sh
python3 evaluation/r4/run-targeted-checks.py /tmp/fangkun-r4-verification
npm run test:r4-reference
npm run typecheck:r4-reference
npm run typecheck:deepseek-remediation
npm run replay:r4-reference
```

The Python runner records assertion counts from isolated test files, rather than mistaking Node's file-level `--test` count for individual assertions. Its output includes both passing and failing logs. `no-network.mjs` guards these test/replay entrypoints. These are development checks; they do not accept the application's offline capability.

`acceptance-replay.ts` generates actual deterministic output for all 20 teaching inputs, 12 weekly projections for two synthetic athletes, and three component demonstrations. Expected answers are attached only by the evaluator after application calls. No teaching answers enter production imports or model context. The generated reports explicitly retain missing browser, storage, recommendation and professional acceptance.

The six-week fixture includes sparse initial data; same-source observations; work-related sleep change and missed work; performance returning; watch change and null observations; late distance and nutrition corrections. Each week records running, strength, known rest and unrecorded calendar states. Calendar state is fixture metadata: its UI binding is **not** established by this replay. Hypothesis persistence/withdrawal is covered separately by existing C03 tests, not falsely attributed to the replay.

Old evaluation campaigns keep their immutable public synthetic request manifest. V3 preparation requires `protocolVersion: 'v3'` or CLI `--protocol v3`. Preparation never grants execution authority, resets a budget or issues a request. Changed fixtures cannot reuse archived input bytes. Direct CLI entrypoints are guarded so imported preparers do not execute or overwrite output.

No database migration is required. No new user storage keys, plan writes, approval receipts, model credentials or fee ledgers are created. Review code can be reverted as a Git commit without reverting or deleting user records. Preserve later local changes when applying or reverting; do not use a hard reset or clean command.

See `docs/r4-integration-review-20261024.md` and `verification/r4-20261024/` for the contract matrix, failures, cost provenance and saved evidence.
