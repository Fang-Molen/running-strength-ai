# 方坤 AI Brain 第一轮候选：400米认知与反馈

版本：FK-COGNITION-R1-20261011。基于交接包 UI06 候选源码，**不是最新线上源码，也未发布**。先阅读交付包根目录的 `第一轮交付报告.md` 和 `evidence/round1/`。

本轮可运行的是确定性的本地认知链路：按项目检索有来源/适用边界的知识；读取已绑定训练事实和独立用户自报；计算同距离实际分段；提出竞争假设、反证和候选决策；显式保存预测、24h/48h观察、接受/拒绝/重改、更正及撤回，再核对预测误差。没有训练一个通用大模型，也没有完成完整周期处方生成器。

## 启动

使用 Node 24（已实测版本24.19.0；Vite要求兼容的现代Node），在本目录运行：

```bash
npm ci
npm run dev
```

开发地址默认为 `http://localhost:8080`。本次复用了工作环境已存在的依赖；**没有完成干净环境的 npm ci 重现**，实际依赖版本见报告。`.grok/app-env.json` 默认关闭联网模型。请在独立浏览器配置或测试数据中运行候选版，未实现自动正式版数据迁移。

## 实际界面路径

打开原有方坤教练对话，输入400米分析问题，可看到事实、知识依据、计算、竞争假设、待确认信息和候选决策。只有对话附带某次已绑定、实际完成、来源明确、无重复的跑步证据时，反馈面板才允许保存。补齐休息、计时、场地、阶段后，明确记录候选选择与恢复预测，再录入具有实际观察时间的24h/48h恢复。可以更正或撤回观察；旧记录保留。无训练绑定时只作分析，不将自报自动写入本人训练事实。

## 复现检查

```bash
npm run test:cognition
npm run test:domain
npm test
npm run typecheck
npx --no-install tsc --noEmit -p tsconfig.cognition.json
npm run build
node --import ./scripts/test-register.mjs scripts/cognition-scenario-replay.ts quality/cognition/original24.json evidence/original24.json
node --import ./scripts/test-register.mjs scripts/cognition-failure-probe.ts evidence/concurrency.json
```

`test:cognition` 本轮87/87通过；`test:domain` 本轮1122/1124。`npm test` 和完整 `typecheck` **仍失败**；并发探针故意返回非零并给出真实丢写证据。不能把局部通过写成全仓通过。回放只测本地模拟输入，不能当完整语义验收或浏览器安全门通过。

## 科学知识更新

`coach-cognition-knowledge.ts` 区分26张交接教学候选与2条已检查原文的有限主张。两类都没有个体剂量批准权。`quality/cognition/research-gaps.json` 保留未解决剂量、跨项恢复迁移和风险词典问题。

```bash
node --import ./scripts/test-register.mjs scripts/cognition-research-workflow.ts quality/cognition/research-workflow-input.json quality/cognition/research-workflow-patch.json evidence/research-version2.json
```

输出必须是新文件。阶段为GAP→SOURCE_FOUND→TEXT_CHECKED→BLIND_TESTED→APPROVED/REJECTED，禁止跳过或回退；原文方法/人群/局限、未见题证据和人工审阅缺一不可。CLI仅版本化候选文件，**不联网、不自动激活知识、不写正式课表**。审阅者字段是开发记录，不是已实现身份认证的审批系统。

## 数据边界

原训练事件不再被固定500条静默截断。新反馈使用单独 `fr255-cognition-memory-r1` 键并纳入既有备份机制；计划与完成事实仍分离。读问答无写入，用户显式保存反馈才写候选反馈存储。实际/计划分段不混合，第三方不进入本人记忆，UNKNOWN不补零。尚未解决跨标签原子写入和多记录部分保存，当前结论NO-GO。
