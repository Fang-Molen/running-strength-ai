---
name: fangkun-visual-release
description: 在方坤更新人物、3D力量动作、热身或肌肉图展示之前，审计媒体合同、授权、版本缓存、UI回退、旧人物禁用与实机性能；只有审核通过才做灰度发布准备。
---

# 方坤视觉替换上线闸门

**Read `references/release-contract.md` before modifying runtime media.**

1. Determine current source revision and current model/cover paths. Do not overwrite newer UI/brain/training data. Preserve the R2 three entry points, 100 strength IDs and 153 atlas.
2. Audit per `exerciseId + characterId + assetVersion + rigVersion`. Hash each file, verify local path and license evidence. Use the R4 audited `pipeline/publish_asset.py` allowlist gate, and preserve compatibility with existing `media-v2` semantics. DO NOT set review flags to APPROVED without artifacts.
3. UI success: 3D show only new high-fidelity model with validated motion. 3D missing ⇒ show a reviewed **same-character** action sequence if one genuinely exists. Otherwise show tonight’s new **character design reference (explicitly NOT an exercise demonstration)** + text instructions. No old character or unrelated action.
4. Remove old fallback references **only at an approved cutover**. Keep the R4 empty approved manifest until a new character+motion is audited. Do not expose legacy visible character as a fallback, do not silently mix old/new characters.
5. Test 375/390/414 widths, dark mode, keyboard safe area, downloads, offline cache and real iPhone Safari; note test evidence.
6. Rollback involves visual media and media cache only, not Training Fact, decision core, user health/nutrition/workout records, schemas.
7. Release is blocked if any required asset rights/visual/animation/performance QA is missing. Report `BLOCKED`, not 'all done'.
