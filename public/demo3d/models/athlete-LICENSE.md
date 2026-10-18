# Fangkun illustrative athlete — source, license and limits

Asset: `athlete.glb` · metadata: `athlete.json` · version: `fangkun-athlete-v72-1`.

## License and source

SPDX-License-Identifier: **CC0-1.0**.

The original MakeHuman mesh, skin textures, short02 hair, eyebrow001 eyebrows,
low-poly eyes, shoes06 shoes and MPFB game_engine rig are the CC0 assets already
bundled in this project as `human.glb`. The source asset was produced with
MPFB 2.0.18 in Blender 4.2, according to the retained project attribution in
`../LICENSES.md`.

MakeHuman asset-pack source:
https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html

The original source GLB remains unchanged. SHA-256:
`cbf479cf66cb281b96d83b41816b5894e4f9da9833c015821b95499c9440353c`.

The new regional position/normal morph targets, small hair-crown geometry
adjustment and baked charcoal clothing/black-hair texture derivatives in
`athlete.glb` are dedicated under **Creative Commons CC0 1.0 Universal** as well.
They may be copied, modified and redistributed, including commercially, without
an attribution requirement. We retain source credit as a courtesy.

CC0 deed: https://creativecommons.org/publicdomain/zero/1.0/

CC0 legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode

The existing Three.js runtime is MIT licensed, as retained in
`../vendor/THREE-LICENSE.txt`. This model license does not relicense the app,
user data, runtime dependencies or the separate CC BY-SA anatomy atlas.

## What changed

- Four real glTF relative morph targets: `slender`, `lean`, `muscular`, `adipose`.
  Each contains position and normal deltas; chest, waist, hips and limbs respond
  regionally. Head, fingers and feet do not undergo a whole-body size transform.
- The original 53 joints, bone hierarchy, bind matrices, body topology, UVs and
  skin weights are retained. The existing animation solver can pose the actor.
- A small actual crown sweep modifies the existing hair-card geometry. This is
  not a newly authored portrait hairstyle or a reconstruction of the reference.
- Clothing is baked as opaque charcoal surface regions on the body UVs, with
  separate skin/cloth roughness. The body material is OPAQUE and all embedded
  body-texture alpha values are 255. Hair and eyebrows use MASK alpha.
- The unlabelled pelvic clothing region stays opaque and dark under the runtime
  muscle overlay. Its coverage is not controlled by a transparent clothing mode.

Reproducible asset generation is in `tools/character/build-athlete.py` at the
project root. Exact derived SHA-256 and displacement measurements are recorded
in `athlete.json`.

## Intended use and limits

This is an **illustrative adult body-shape and movement teaching model**.
The four channels are manual appearance choices, clamped to 0..1 with combined
weight at most 1. They are not measured muscle/fat quantities and are not a
validated prediction from weight, body-fat percentage, diet or training.
Skeleton lengths and height are fixed; the model is not a body scan.

The original portrait (`public/fangkun-atlas/figure-male.webp`) was inspected for
visual direction only. It is not used as a fake 3D image plane or baked into the
mesh. **The reference man's facial identity, exact hairstyle, photorealistic
skin, loose shorts, fabric folds and white footwear have not been reproduced.**
The current actor retains a generic MakeHuman face and its original blue shoes;
the dark clothing fits the body surface and is not a separate draped garment.

Offline front/side/back images use the exact posed and morphed GLB geometry and
its embedded textures with approximate studio lighting. They are software-GL
inspection renders, not screenshots of the app or proof of browser/device
performance. The athlete-only static stand aligns the shoe sole using the
rig's resting foot direction. Other legacy poses and dynamic motions have not
received a new sole-plane audit in this asset work.

Finite sampled morph combinations were checked for new reversed/collapsed
triangles and fixed head/feet; this does not prove the absence of all
self-intersections during every animation. No independent anatomical, clinical
or identity-likeness validation is claimed.
