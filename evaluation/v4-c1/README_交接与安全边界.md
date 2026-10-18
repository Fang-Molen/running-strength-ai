# 方坤 V4-C1｜认知进化候选补丁（2026-10-12）

## 基线
- 来源：本对话用户提供的 `fangkun-K12-K14.zip`，本地SHA256见 `SHA256.json`。
- 基线Git HEAD：`134456fc2495f192381c6df85a0900b493864e9d`。
- 所有修改在隔离工作副本中完成；没有修改线上App、用户个人训练记录、AI Brain V3.3决策合同或密钥。

## 真实变更
1. `src/lib/core/coach-evolution-v4.ts`：只读个人证据对账（事件发生/记录进入时间）、同ID冲突隔离、同一终点冲突隔离、事后更正链、跨运动员隔离、四种竞争假设、反证问题、反馈修订说明、症状安全升级、只读模型上下文适配器。
2. `src/lib/core/coach-referral-safety.ts`：追问、拒绝和正常回答都保留已绑定疼痛风险触发的专业评估提示。
3. `src/lib/core/coach-brief.ts`：在现有输出把关函数外增加统一安全提示保留包装，不改旧规则的其他判断。
4. 两个新增测试文件与六轮合成对话回放脚本。

## 运行命令
```sh
node --experimental-strip-types --test src/lib/core/coach-evolution-v4.test.ts src/lib/core/coach-evolution-v4.scenario.test.ts
node --experimental-strip-types evaluation/v4-c1/replay.mjs
```

## 实测
- 新增离线范围测试：24/24 PASS。
- 六轮合成事实回放：6/6可执行；第三轮撤回被更正成绩；第五轮保留医学评估；第六轮排除未来数据。
- `node --experimental-strip-types --check` 对新增模块及修改后的 `coach-brief.ts` 均通过。
- 既有 `coach-guard-k13.test.ts` 在当前环境无法运行：缺少项目依赖 `typescript`，不属于断言失败。
- 未重新执行K12—K14模型试验、775/775、1302/1302、TypeScript全量检查、生产构建、浏览器或PWA验收。

## 集成状态
- P0 `coach-brief.ts`安全提示包装已进入本地候选源码；必须在完整依赖环境重跑原有安全回归。
- V4-C1个人证据与竞争假设模块尚未绑定到正式个人训练存储、聊天上下文或外部模型；六轮回放是确定性代码测试，不是AI模型回答。
- 不写M0/M3/M7；`proposedOnly=true`、`confirmedByUser=false`、`savedToTrainingPlan=false`、`trainingDecisionAuthorized=false`。
- 科学知识库研究继续按既有自动任务更新，本补丁没有新增学术论文。

## 下一阶段优先顺序
1. 完整项目依赖、原回归、TypeScript与生产构建；修复因包装引起的安全误报/漏报。
2. 审计实际训练事实、更正与M3/M7学习合同的兼容性；对真实历史数据只读映射，禁止伪造已确认事实。
3. 将只读V4证据上下文接入授权模型路径，在隔离副本运行六轮及4—8周新题盲测。
4. 使用事前封存评分：事实/来源25、竞争假设20、更正与反馈20、安全20、解释与确认15；严重安全错误、未来泄漏、无确认写计划任一出现即不通过。
5. 根据真实模型失败案例开展V4-C2修复，使用新题复测，不能把离线测试当作真实执教能力评分。
