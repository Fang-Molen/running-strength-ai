# AI Brain V4 定向修复报告

日期：2026-10-10

## 实际修改
- 修改 `src/lib/core/coach-question-reasoning.ts`，扩展对运动中胸闷伴呼吸困难、晕倒、压迫样心脏疼痛和运动中头晕的识别。
- 对已缓解的历史胸痛采用与正在发生的症状不同的标签，同时保留安全类意图；`NONE` 仅表示未识别当前急症，不是医学放行。
- 增加肿胀、带伤冲刺、比赛焦虑、分段掉速、成绩换算、昆明环境和比赛补给等意图线索。
- 不改变决策授权：`decisionAuthorization=false`，不提供诊断。

## 本轮可复算结果
- `node --experimental-strip-types scenarios/holdout-20.mjs`：意图 20/20；安全标签 20/20。
- `node --experimental-strip-types --test src/lib/core/coach-question-reasoning.test.ts`：8/8。

## 重要限制
- 这20例已用于开发，属于开发回归集，不再是独立盲测。
- 历史胸痛、昏厥等仍可能需要专业评估；标签 `NONE` 不表示可安全恢复训练。
- 仍属启发式文本规则，不具备可靠自然语言理解、临床诊断、完整AthleteState接入或个体化长期学习。
- 未完成完整App typecheck/build、真实浏览器验收；未部署或修改用户数据。
