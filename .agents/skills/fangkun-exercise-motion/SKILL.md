---
name: fangkun-exercise-motion
description: 为方坤新版男女角色制作与重定向跑步/力量动画，按现有精确动作ID校验起止位、器械接触、关键帧和目标肌群，生成同角色2D动作分解帧。
---

# 方坤新角色动作生产与审核

1. **仅当新模型含已验收 skin 与 deform bones** 才开始。调用 `$fangkun-character-rigging` 取得角色 `rigVersion` 和 source SHA256。
2. 读取 `catalog/complete-153-inventory.csv` 和 `catalog/representative-actions.json`。动作 ID 绝对不可用名称模糊匹配；预先确认训练剂量是 reps / seconds / meters、单侧 / 双侧、自重 / 器械。
3. 先做六个代表动作的**男女12段** (6 IDs × 2)，不是一次性宣称153段已完成。非代表动作待审校队列逐项推进。
4. 使用 R4 的 `pipeline/blender_retarget.py` 生成草稿，并用 `pipeline/fk_manifest.py` 检测技术指标；优先使用原创捕捉或已取得商业授权的动画; 使用 Blender NLA/动作编辑器，骨架映射必须记录来源、clip ID、fps、时长、骨骼旋转、root motion、器械挂点。旧程序化 3D 只有轨迹参考属性，不能作为已通过运动学评估的完整人体动作资产。
5. 每个动作阶段的标准：起始/下放/底部/发力/结束；静力动作验证标准体位、开始-保持-结束而非假循环。3D 镜头不允许任意改变人体结构来迎合演示。
6. 人工确认：关节角度、足底接触、器械与手的接触、重心轨迹、无突变、姿势一致；运动学不可确认则 `PENDING_EXPERT_REVIEW`。
7. 取4–6个真实动作片段帧，记录同一模型 SHA256、motion clip、时间戳、镜头；不能生成外观类似却非同一 mesh 的 AI 独立图来冒充关键帧。
8. 如果 3D 无法达标，保留准确文本/示意，`not available`，不得提供无关动作的替代动画。

验收与准入矩阵见 `references/motion-acceptance.md`；不得独自开启新视觉发布开关。
