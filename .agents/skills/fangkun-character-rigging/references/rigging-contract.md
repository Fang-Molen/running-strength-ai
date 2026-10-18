# 人物绑定合同

* 视觉：仅依据 `source-reference/female-tonight.png`、`male-tonight.png` 及用户今晚确认的角色标准。是视觉参考图，不是 3D 拟合证明。
* 审核顺序：许可 → 原创模型与真实网格 → 人体比例 → UV/PBR → 骨架 → 自动权重 → 人工权重修正 → 动作测试 → GLB 导出 → iPhone 性能。
* 轻量化是后期单独预算；建议先用两档 LOD 和贴图压缩，再真机按帧率/内存优化，不能用一个多边形阈值代替真机性能审校。
* 统一单位：Blender 米制；导出 glTF +Y Up 在运行时确认，人体模型姿态与 `media-v2` 消费端对齐。
* 最小导出骨骼名单见 `references/joints.json`。最终每个关节应具备正确 father/child、rest transforms、deform influence。约束应烘焙，不把 Blender Rigify 控制器直接当作移动端形变骨架。
* 原始53关节骨骼名见 `catalog/legacy-male-53-bones.json`，仅用于命名兼容研究，不得直接使用旧人物图形。
* 蒙皮：按骨骼手工校正左右肩胛/锁骨、胸背、髋、腋下、肘/膝、鞋、头发和衣物，验收所有关键姿态无明显穿模。单点过大权重、多骨控制及衣物穿模不能靠权重归一就自动解决。
* Blend master、GLB及贴图版本保持可复现，每次输出报告 hashes 与来源证据。
