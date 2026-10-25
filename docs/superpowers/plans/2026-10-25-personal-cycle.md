# R6 Personal Cycle Implementation Plan

> Use superpowers:executing-plans. User explicitly requests concentrated implementation and final unified verification; do not add intermediate approval or repeated full-suite gates.

**Goal:** 从用户资料、近期真实执行和比赛目标生成可修订的个体周期草案并接入原教练。
**Architecture:** cycle/types + portrait/planner纯函数；host只读现有事实及版本化目标/草案，沿用R5日历回执；UI与对话共用宿主；prompt提供固定合同与相关案例，不写正式课表。
**Tech Stack:** TypeScript/React/Node test，原项目依赖。
**Spec:** docs/r6/spec.md

## Global Constraints
保留R5/V4/UI/设备接口/历史；独立分支PR；不付费、不部署；1000字、最多2追问；未知不补零、目标不当测量；确认/版本/撤销；最终集中验证。

## Review Focus
- 未来/撤回/其他账号记录不能贡献画像与剂量；同一活动不能重复计量。
- 目标/比赛日期变化、无可练日及当周已有V4都不能静默叠加课程。
- 已接受、进行中、部分完成及后来编辑的课不能被撤销或新草案覆盖。
- 长远周不提前写入；进阶只能改一个可解释变量，疼痛/未知恢复不能放行。
- 存储部分失败、同时间戳、并发/重复提交需从原子回执恢复真实状态。

## Task 1: contracts/portrait/planner
- [ ] 定义CycleGoal、CycleInput、Portrait、CycleDraft，测试先写后实现，统一末尾运行。
- [ ] 使用projectAnalysisEvidence、adaptTrainingModelInput、deriveAnalysisFacts；计算近周实际，分来源个体反应；阶段和具体微周期并列、未知条件课。
- [ ] 多项目、时间/器材/疼痛、明确进阶政策，目标不派生实测配速。

## Task 2: host/UI/coach
- [ ] readCycleContext读取R5宿主与现有来源；saveCycleGoal(expectedVersion)显式保存。
- [ ] prepareCycle/decideCycle，复用R5_CHANGE/R5_UNDO原子回执。confirm只写最近一周，长期结构保留；source changes重新评估。
- [ ] 原方坤复盘增加周期面板和对话入口，简短回答/联网事实共用bounded read-only summary；模型仍无写端口。

## Task 3: cases/prompt/verification
- [ ] 固定prompt合同和相关案例选择；对照只改一项输入，覆盖spec验收与失败案例。
- [ ] 最终统一受影响测试、全部test分组、typecheck、build，根因集中修复及必要复验。
- [ ] 一次独立代码审查；实际UI+生产预览检查，记录测试命令、样例差异及专业边界；上传GitHub独立分支PR。
