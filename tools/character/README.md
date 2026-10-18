# Athlete asset tools

These tools operate on the bundled CC0 GLB. They do not use image generation,
a browser, a preview server or Blender. Python requires NumPy and Pillow; the
offline renderer/compiler uses system EGL with Mesa OpenGL ES 3.

Run from the project root:

```sh
python tools/character/build-athlete.py
node --import ./scripts/demo3d-node-register.mjs tools/character/check-athlete.mjs /tmp/athlete-evidence
python tools/character/check-geometry.py /tmp/athlete-evidence
node --import ./scripts/demo3d-node-register.mjs tools/character/export-geometry.mjs /tmp/athlete-evidence/render
python tools/character/render-athlete.py /tmp/athlete-evidence/render
node --import ./scripts/demo3d-node-register.mjs tools/character/export-shaders.mjs /tmp/athlete-evidence/shaders
python tools/character/check-shaders.py /tmp/athlete-evidence/shaders
```

`build-athlete.py` writes only the separate `athlete.glb` and `athlete.json`.
It preserves `human.glb`. Its morph coefficients are authored visual choices,
not a calibrated body-composition estimator.

`check-athlete.mjs` parses the actual GLB, checks the original 53-bone/UV/skin
contract, independent morph influences and 42 pose/appearance combinations.
It also measures the bounded athlete-only stand outsole correction and ensures
other legacy figure poses retain their original definitions.

`check-geometry.py` checks sampled convex morph combinations for reversed or
collapsed triangles, fixed head/feet and opaque pelvic texture coverage.
This is not a complete animated self-intersection proof.

`export-geometry.mjs` runs the actual Three.js morph/skin/figurePose code and
exports exact geometry for `render-athlete.py`. The resulting front/side/back
and shape images use embedded GLB textures and approximate inspection lighting.
They must not be labelled app screenshots or reference-portrait reconstructions.

`export-shaders.mjs` applies the real material compile hooks and expands the
vendored Three.js shader graph. `check-shaders.py` compiles and links all five
material programs, including body position/normal morphing and bone skinning.
This checks ES3 shader compatibility; browser integration remains a separate QA
step.

Model source/license/limitations: `public/demo3d/models/athlete-LICENSE.md`.

Preparation clips can also be checked and rendered independently:

```sh
npm run check:warmup-3d
node --import ./scripts/demo3d-node-register.mjs tools/character/export-geometry.mjs /tmp/fangkun-warmup-render --warmup
python tools/character/render-athlete.py /tmp/fangkun-warmup-render
```

The 220 sampled poses check finite bounds and shoe/floor contact for the new
unloaded warm-up clips. They are not clinical or biomechanical approval.
