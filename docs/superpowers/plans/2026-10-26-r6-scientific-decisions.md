# R6 Scientific Decisions Implementation Plan

Goal: connect existing athlete facts, training-model comparisons, purpose-specific recovery, conservative candidates, explicit schedule confirmation and subsequent feedback.
Architecture: reuse ModelInput, physiology/distribution calculators, readAnalysis, saved cycle/effective profile and R5 schedule transaction. Keep online explanation behind existing trusted packet validation. No paid calls/deployment.
Spec: user's R6 requirements, 2026-10-26. Base: verified GitHub master 50872a8 (V89.11.1, includes V89.10.22).

- [ ] Automatic inputs: workbench reads saved scoped cycle/profile/facts, retains provenance/missing; explicit options override only intent. Tests for saved goal reuse, device/owner boundaries and missing thresholds.
- [ ] Selection/knowledge: preserve physiology functions; split distribution/organization/event dimensions, support/limits/completeness/permission, conditional ranking. Add purpose-sensitive candidate gating, evidence policy. Local tests only.
- [ ] Online: inspect client/proxy/trusted resolver; reject unsupported numeric/identity/protocol/plan/safety output without granting client verification. Preserve offline answers and existing evaluation archives.
- [ ] Runtime: new r6/runtime.ts readR6Decision, prepareR6Candidate, confirmR6Candidate, readR6History. Recompute from current host under shared write lock, bind owner/source/plan/knowledge, reject started courses and stale previews. Record decision/execution/feedback/revision evidence without changing original actuals.
- [ ] UI: existing model workbench shows automatic context and multi-dimensional comparison; new integrated candidate/confirmation/history panel reuses runtime. No model direct write.
- [ ] Acceptance: limited differential fixtures covering the 12 user cases, at least five before/after executed outputs; preserve 60-question/26-live-answer assets, hash manifests. One combined regression after implementation, typecheck/build and browser workflow.
- [ ] Delivery: complete source, diff, API/evidence mapping, candidate examples, test breakdown and rollback. No score inferred from engineering pass counts.

Review focus: foreign ownership and device protocol conflicts; missing data vs zero; stale knowledge or corrected facts; started/completed sessions; pain/medical restrictions cannot be cleared by model, HRV or curves.
