# 方坤 3D 动作演示 · 素材许可

| 素材 | 来源 | 许可 | 用法 |
|---|---|---|---|
| 人体网格、骨骼权重、肤色贴图（young_asian_male 材质 / young_lightskinned_male_diffuse3）、眼睛 low-poly、眉毛 eyebrow001、发型 short02、运动鞋 shoes06，以及脸型 / 下颌 / 头身比的 target（chin-prominent、chin-width、head-square、head-scale 等） | MakeHuman 系统素材包 `makehuman_system_assets_cc0.zip`（files.makehumancommunity.org），由 MPFB 2.0.18 在 Blender 4.2 里生成 | **CC0 1.0**（MakeHuman 项目 2020 年把基础网格和系统素材释放为 CC0） | 打包进 models/human.glb，可随方坤分发，无需署名（我们仍在说明里致谢 MakeHuman） |
| game_engine 骨骼 | MPFB 2 自带的 rig.game_engine.json | 属于 MakeHuman 数据资源，CC0 | 已烘焙到 GLB |
| MPFB 2 插件本身 | makehumancommunity.org | GPL-3.0 | **只在本机生成模型时用，没有打包进 app**。GPL 不影响用它导出的模型 |
| Blender 4.2.3 | blender.org | GPL | 只作生成工具，不随 app 分发 |
| three.js r169（three.module.min.js、GLTFLoader、OrbitControls、SkeletonUtils、BufferGeometryUtils） | github.com/mrdoob/three.js | MIT（见 vendor/THREE-LICENSE.txt） | 打包进 vendor/ |
| 紧身短袖、运动短裤（着色器按身体分区自绘的面料，不是网格衣服） | 自制 | MIT（自有） | — |
| 肌肉分区贴图 models/regions.png、关键帧 motions.js、渲染代码 viewer3d.js、界面 | 自制（脚本 gen/regions3.py 按骨骼权重、位置、法线计算） | MIT（自有） | — |
| 2D 简笔动画、2D 肌肉图（非 3D 动作的回退显示） | 上一版自制 | MIT（自有） | — |
| 动作要领文字 | 上一版自写 | 自有 | — |

没有用 Mixamo、Ready Player Me 或任何需要署名或限制分发的素材。


## Updates (batch 1)
- MakeHuman system assets (CC0): eyebrow001, hair short02, face targets (chin/nose/eyes/cheek/mouth). https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- Foot muscles (plantar fascia, intrinsic foot muscles, peroneals), sole view, hem/seam shading, calf block prop: self-made, MIT.
- Batch 4/5 equipment (cable tower, pulley, cable line, handles and rope, pulldown/row/leg-press/leg-curl/seated-calf machines, mat): self-made procedural geometry, MIT.
# v70 anatomical study atlas

The new `anatomy/ecorche.meshopt.glb` and its mapping/geometry derivatives are
CC BY-SA 4.0, independently of the original MakeHuman animation model below.
Full credits, exact source and changes: [anatomy/ATTRIBUTION.md](anatomy/ATTRIBUTION.md).
The meshoptimizer decoder is MIT (vendor/MESHOPT-LICENSE.md).

