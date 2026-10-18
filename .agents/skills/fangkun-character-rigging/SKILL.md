---
name: fangkun-character-rigging
description: 为方坤新男女运动角色做 Blender 网格质量审计、人体骨架生成、权重蒙皮、GLB 导出与形变 QA；仅在处理获授权的新版真实 3D 人物时触发。
---

# 方坤角色建模与骨骼绑定

## Input gate
1. Read repository current `AGENTS.md`, asset manifests, latest R2/media-v2 contracts; **do not override a newer repository**.
2. Read `references/rigging-contract.md`. Inspect `source-reference/` approved **style reference images**, not runnable meshes. Existing rough GLBs in previous draft are **reference-only reject**.
3. Run `python .agents/skills/fangkun-character-rigging/scripts/audit_glb.py --input <actual-model.glb> --report <path.json>`. No materials, invalid geometry, wrong appearance or missing commercial permissions ⇒ **STOP and model/re-source**, do not rig/release.
4. Distinguish studio control rig (Rigify) from compact deform skeleton exported into GLB. Rigify is Blender's add-on, not a ready-to-use 3D person or commercial animation library.

## Real rigging
1. Acquire/create **approved topology** (one separately refined mesh for each of male/female); check T/A/neutral rest pose, X left-right, Y front-back, Z height, units/meters, UVs and PBR textures.
2. Blender GUI align metarig to **anatomical** hips/knees/ankles/shoulders/elbows/wrists; use auto-weights only as first pass; correct weight paint. Use `pipeline/blender_bind_landmarks.py` from the R4 package after manual landmark review; scripts under skills are historical helpers only. Read its constraints; it is a 23-joint **diagnostic/export starter**, not an automatic beautiful fully production-ready 53-bone rig.
3. Export GLB with actual skinning, not just a named armature. Keep `.blend` master and proof screenshots. Ensure underlay floor contacts/foot anchors and equipment pivots are defined.
4. Require genuine pose-based render QA (raise/lower arms, 60/90° elbow/knee, squat start/end), face/hair/clothes review from front/side/back. Do not auto-approve based solely on triangle or bone counts.
5. Record provenance, license, SHA-256, versions and visual review. If unavailable STOP with explicit `BLOCKED` report.

## Commands
```
python .agents/skills/fangkun-character-rigging/scripts/audit_glb.py --input candidate.glb --report preflight.json
python -m unittest discover -s .agents/skills/fangkun-character-rigging/scripts/tests -v
# After manually checked real 3D mesh and landmark JSON, on machine with Blender:
blender -b --python pipeline/blender_bind_landmarks.py -- --input approved.glb --landmarks landmarks.reviewed.json --output bound.glb --blend character_master.blend --report bind.json
```

## Explicit exclusions
- No image/panorama => real mesh claim.
- No unreviewed auto weights => release.
- Do not reuse visible old character model or show old fallback.
- Do not bypass media-v2 review or invent rights.
