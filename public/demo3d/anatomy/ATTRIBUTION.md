# Fangkun anatomical muscle atlas

Model: **Écorché**, https://github.com/Charleeh/ecorche

Pinned upstream commit: `320805e06aee51e2e6f6b22533eb2a59d43f2d4d`.
File: `model/ecorche.meshopt.glb` (6,004,016 bytes).
SHA-256: `cc43a8b4f218bee5da78d6c1746bd21470d1d93c6878e33b4ccdbcfc7a72b98e`.

Écorché (github.com/Charleeh/ecorche), CC BY-SA 4.0. Based on BodyParts3D,
© The Database Center for Life Science, CC BY 4.0, and Z-Anatomy by
Gauthier Kervyn, CC BY-SA 4.0.

“BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan”

“Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0”

Full upstream credits and source-processing changes are retained in
[UPSTREAM-ATTRIBUTION.md](UPSTREAM-ATTRIBUTION.md).
License: https://creativecommons.org/licenses/by-sa/4.0/;
full text in [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt).

Download this app's model: [ecorche.meshopt.glb](ecorche.meshopt.glb).
Structure metadata: [structures.json](structures.json).

## Changes in Fangkun

The distributed compressed GLB and structure metadata are unchanged.
The viewer clones the model, grounds it at y=0, merges supporting bones for
fewer draw calls, uses a silver muscle palette with primary/auxiliary/selected
highlights, adds an opaque pelvic guard (since R1: integrated shorts, see below), and limits the camera.
The muscle aliases linking this teaching asset to the existing exercise
catalogue are in ../anatomy-map.js. The model, runtime geometry adaptations,
mapping data and offline geometry renders are distributed under CC BY-SA 4.0.
This does not change the separate license or ownership of the app code or user data.

### R1 friendly display (2026-10-19)

Runtime-only changes; the GLB and structures.json above are still byte-identical
(the SHA-256 is unchanged):
- the cranial/facial skeleton, teeth, eyes, nose/ear cartilage and facial expression
  muscles are not rendered (filtered before the supporting skeleton is merged) and are
  replaced by a generated, featureless neutral head and neck core;
- the former spherical pelvic guard is replaced by shader-painted, opaque sports shorts
  on the pelvic muscle/bone surfaces plus a small opaque crotch panel of the same colour;
- matte low-saturation grey materials with reduced tendon/bone contrast;
- a tap on the external-oblique aponeurosis over the rectus sheath selects the rectus
  abdominis beneath it, and selecting the rectus hides the overlying external oblique.
These adaptations are distributed under CC BY-SA 4.0 like the rest of this derivative.

### Natural look for 按部位选动作 (2026-10-27, branch feat/muscle-look-20261027)

Runtime-only again: `ecorche.meshopt.glb` and `structures.json` are still byte-identical (same SHA-256).
Used only by the 按部位选动作 sheet (`createMuscleExplorer(..., { look: 'natural' })`); every other
caller keeps the R1 look above. Changes, all in `../anatomy3d.js`:
- the generated neutral head gets a gently modelled nose/brow/chin, two small ears and a short-hair
  volume; eyes, brows, nostrils, mouth and hair colour are painted in the fragment shader (no image
  assets). It is still one opaque, non-selectable head shell of the same footprint, so no new picking
  surface is added; muscle meshes, ids, names, side, highlight and mapping are unchanged;
- warm-neutral, low-contrast muscle/tendon/bone palette; dark shorts with a smooth tube normal inside the
  shorts area (colour/shading only, geometry unchanged, glute/hip/thigh meshes stay individually pickable);
  the crotch panel is slightly smaller in this look;
- while a muscle is selected, the other muscles step back ~12 % so the theme-coloured highlight stays legible;
- soft studio lighting and a stage colour that follow the app's light/dark `data-theme`.
These adaptations are distributed under CC BY-SA 4.0 like the rest of this derivative.

There are 634 source structure meshes, including 362 named muscle meshes.
This is a static adult male anatomy study asset: it has no animation rig,
female counterpart, body-weight morph targets, skin or genitalia. It does not
represent the athlete's body. Neither its source nor this adaptation is
asserted to have passed independent professional anatomical/clinical review.

Meshopt decoder: meshoptimizer 1.3.0, Arseny Kapoulkine, MIT;
see ../vendor/MESHOPT-LICENSE.md.

## R9 friendly muscle regions (v89.5, 肌肉恢复 view)

File: `fk-muscle-r9.meshopt.glb` (1,910,964 bytes). Region table: [muscle-regions-r9.json](muscle-regions-r9.json).
Source: Fangkun R9 candidate `fk_muscle_friendly_r9.glb` (10,116,136 bytes, SHA-256
`a8815c4f57ff763b933d9341ebc7e135b40926f6c31caae9b2a886b264699316`), delivered in package 1021c.
It is a derivative of the Écorché / BodyParts3D / Z-Anatomy meshes credited above: 156 source
muscle structures merged into 78 selectable regions (39 keys, same keys as ../anatomy-map.js),
plus a smooth neutral head, neck, hands/feet shell and opaque training shorts made by Fangkun.
License: **CC BY-SA 4.0** (same as above; BodyParts3D © The Database Center for Life Science,
CC BY 4.0; Z-Anatomy by Gauthier Kervyn, CC BY-SA 4.0).

Changes in Fangkun v89.5: repaired three invalid index references (shorts waistband/hems used a
vertex attribute as triangle indices; the right hem's index data was missing and reuses the
identical left-hem ring topology), removed empty image/texture arrays, then compressed with
gltfpack 0.25 (`-cc -kn -km -ke`, meshopt + quantization, no simplification). At load time the
hands/feet shell is split so the feet outline can show the existing `feet` region; it is an outline,
not a muscle mesh. Highlights are anatomical regions from logged training, not measured activation.
