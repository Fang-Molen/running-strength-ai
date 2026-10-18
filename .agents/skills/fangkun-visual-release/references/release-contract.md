# 发布合同

Current v74 `src/lib/strength/media-v2/registry.ts` performs strict identity & hash checks. Never remove `localAsset`, version uniqueness and review requirements; its `visualRelease` switch defaults OFF. Legacy runtime currently uses `src/lib/strength/demo/provider.ts` and `src/components/exercise-demo.tsx` to display old models; switching these requires full integration QA.

When user specifies removal of old characters, this is a **visual design requirement** for the completed new version, NOT permission to switch production to blank screens or unlicensed/non-rigged drafts. Until new assets pass, don't deploy. On cutover, failure handling can only fall back to approved **same-character** images/frames, else explanatory text.

Data integrity: do not clear IndexedDB/localStorage or change exercise IDs to fit animations. 100 strength movements and 53 running entries must remain findable, but representation levels may differ.

Minimum evidence: `asset_manifest.json` with SHA256, bytes, rights, model rig and motions, motion QA still shots, character turnarounds, TSC/build, iPhone Safari screenshots/performance, rollback plan, final QA matrix with statuses.
