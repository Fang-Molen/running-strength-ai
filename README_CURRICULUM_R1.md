# 方坤：五大核心研修 R1 已接入候选源码

本次基于第三轮完整候选增量改动。这里的“已接入”指本地问答读到新教学规则、授权模型请求会携带受限知识上下文；不表示模型参数训练、线上更新或教练能力全部通过。

## 实际入口
- `src/lib/core/coach-curriculum-data.ts`：30条教学规则、19条分级来源、10个明确合成的教学案例。
- `coach-curriculum.ts`：只读主题检索、来源边界、合成示例检索、有上限的模型知识上下文；没有网络调用和存储写入。
- `coach-cognition-knowledge.ts` → `coach-cognition.ts` → `coach-local-first.ts`：实际本地问答调用新规则；数字分析与个人事实分开。
- `src/lib/strength/coach-ai.ts`：原授权之后构造 `knowledgeContext`，原安全/结果审查继续保留；本轮没有真实模型请求。
- `evaluation/curriculum-r1/`：20个公开变式与14个入口回放问题；不导入运行时。

## 本轮验证
32个新增知识/接入检查＋34个原有相关测试＝66项通过；14题真实本地入口回放完成，其中13题观察到对应研修引用，另1题保留紧急安全分支。仅为接线/定向行为验证，不是五大能力综合得分。
新知识数据和检索两个文件的严格类型检查通过。完整依赖安装阻断，本轮使用环境TypeScript 5.8.3，未跑整项目类型检查、构建、完整回归或浏览器。工程锁文件的TypeScript仍为5.9.3，未改依赖。
原第三轮的709/1190等数字属于旧版历史记录，不是本轮复测结果。

## 开发者复现
在独立副本完成原项目依赖安装后：
```sh
npm run test:curriculum
npm run replay:curriculum -- curriculum-answers.json
npm run test:cognition
npm run typecheck
DATABASE_URL='' npm run build
```
不要接真实数据库或将合成样本导入用户浏览器。单测不能替代独立教练评审。

## 证据与权限
教学规则全部是AUTHOR_TEACHING_CANDIDATE，不升级为已批准个人处方。来源深度沿用R1研修包报告：8项正文相关段、7项摘要、4项检索摘录；未在导入时重核论文。检索摘录在模型上下文中只列待研究，不提供已核实主张。所有示例标为SYNTHETIC_TEACHING且不可写入AthleteState、M3个人反应或训练事实。

## 版本合并与回退
只适用于交付包指定第三轮底稿；发现更晚候选时按补丁三方合并，不用本包覆盖更新工作。`preimage-postimage.json`保留原文件/新文件SHA256；`learning-intake.patch`提供差异。本轮未部署，原源码和个人记录不变。
