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

There are 634 source structure meshes, including 362 named muscle meshes.
This is a static adult male anatomy study asset: it has no animation rig,
female counterpart, body-weight morph targets, skin or genitalia. It does not
represent the athlete's body. Neither its source nor this adaptation is
asserted to have passed independent professional anatomical/clinical review.

Meshopt decoder: meshoptimizer 1.3.0, Arseny Kapoulkine, MIT;
see ../vendor/MESHOPT-LICENSE.md.
