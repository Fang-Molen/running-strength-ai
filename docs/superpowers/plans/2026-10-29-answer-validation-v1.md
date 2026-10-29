# Answer Validation V1 Implementation Plan

> Agentic execution: use superpowers:executing-plans inline; one fresh code reviewer at the end. User has already requested continuous implementation, so no intermediate approval pauses.

**Goal:** Integrate evidence-aware final answer validation, preserve supported advice, and distinguish completed/partial/clarification/failure results.

**Architecture:** Keep existing authorization, snapshot, billing and transport boundaries. Introduce shared pure evidence, claim/dependency/task validation used by server composition and browser verification. Reuse saved replies and offline injection without sending candidates/rubrics to any model.

**Tech Stack:** TypeScript, Node tests, PGlite, React, Python package evaluation tools.

**Spec:** verification/validation-gates-v1-20261029/input-package/01_校验设计与决策规则.md; execution and acceptance documents 02/03 in the same directory.

## Global Constraints

- Baseline 0fd2e5fd21854cd6453a33db5312f47b52cdf5d4 in Fang-Molen/running-strength-ai, test/load-memory-20261029. Package's Fang-Molen/fangkun name is stale; supplied candidate ancestor matches this repo.
- No paid calls: previous full budget exhausted; package provides no new authorization. No secrets in files/logs, no real user data, no deployment, merge, PR or main push.
- Original candidate/rubric files remain frozen and separate. No production branches on case IDs or rubric inspection. Report pending professional/tool/browser checks honestly.
- No ordinary npm build: it invokes DB migrations. Use build:dev if build is needed. Existing user/scratch work remains intact.
- Claims cannot self-authorize. Unknown coverage/clearance is neither false nor incomplete. Final composition, nextStep and host-derived text all pass the final gate. No recursive regeneration.

## Review Focus

1. Negated write or safety text must retain polarity while a separate affirmative action is still rejected.
2. Equivalent units, tied/near-tied paces, sequential corrections and explicit completion without timing.
3. Advice using a prior plan must not become historical accomplishment or new unsupported dose.
4. Invalid/cyclic dependencies must remove dependent actions and never orphan conditions or stop rules.
5. Tool success, current consent/revision, response/task state, and UI request identity must agree.

## Tasks

### Task 1: Evidence states and deterministic arithmetic (C01/C02)
- [x] Reproduce RV01–04 and unknown-as-fact with failing tests.
- [x] Add evidence-state projection (coverage/symptom/caution/declared restriction/clearance separated); remove false medical-clearance wire field.
- [x] Fix calculator ties, rounding, chronological correction application and independent completion/timing.
- [x] Run pure tests and existing relevant tests; commit.
Expected: exact original and transformed cases pass; no inferred medical restriction or missing=zero.

### Task 2: Shared claim, dependency and task gate (C03/C04/C05)
- [x] Write fail-first tests for typed labels, quantity roles, supported plan advice, whole-group repairs, task omissions and final host append.
- [x] Add focused evidence/claim/task modules, bounded legacy adapter and final status/result types.
- [x] Preserve supported numbered advice, normalize/deduplicate quotes, explain unknown and partial results; validate all composed blocks.
- [x] Run pure and policy regressions; commit.
Expected: no empty-answer success, forged tags/receipts or orphan actions; Q12/Q14/Q15 useful supported information survives.

### Task 3: Controller, client and tool receipts (C06/C07)
- [x] Fail-first duplicate-key/schema and controller final-gate tests.
- [x] Integrate the gate across modern, legacy and analysis responses without bypassing existing source/auth/budget controls.
- [x] Add trusted retrieval/action receipt interfaces with truthful NOT_NEEDED/FAILED states; no model-provided URL/receipt can authorize access or writes.
- [x] Decode/verify final decision, blocks, hashes and task state in client; run HTTP/client tests and typecheck; commit.
Expected: final composition is verified; valid partial result is distinguishable from completed task; original request remains recoverable on failure.

### Task 4: UI state and request isolation (C08)
- [x] Add fail-first status/render/request-identity tests.
- [x] Surface partial/clarification/professional-pending state and collapsed verified sources; preserve cancellation/account/revision safety.
- [x] Run component tests, build:dev and available browser checks at requested widths; record exact limitations; commit.
Expected: only validated blocks render; late/cancelled replies do not overwrite another question; no false completion.

### Task 5: Frozen offline acceptance, review and handoff (C09/C10)
- [x] Verify package SHA, lint and 23 tool self-tests; adapt all 50 synthetic cases with explicit mapping traces.
- [x] Save raw→old final→new final for 9 legacy replies and metamorphic checks; separate L1/L2/L3/L4/L5 conclusions.
- [x] Run evaluator without fabricated reviews (professional required stays pending), full npm test, typecheck and diff/secret checks.
- [x] Fresh whole-branch code review; fix important findings with RED→GREEN.
- [x] Produce ZIP with source patch, commits, all final outputs/reasons/gates/hashes, request ledger (new paid=0), metrics and remaining blockers; push specified test branch only.
Expected: complete and honest evidence package, no hidden paid calls or claimed expert sign-off.

Completion scope: all authorized implementation and offline execution steps are recorded, including negative/pending outcomes. Checkmarks do not mean all release gates passed. Professional review and final live generation remain externally blocked, not performed. AI review was on d1a0789 with a single counterexample fix pass; later changes are covered by targeted regressions, not a claimed second independent review. Full npm test is explicitly not green; the same three legacy makeup failures were reproduced on 0fd2e5f. Final code freeze is 64a1496; subsequent commits only package artifacts/docs.
