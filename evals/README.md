# 方坤本地确定性评测

`npm run eval:local` 实际执行锁定的 `npx --no-install promptfoo eval`，同时跑 `cases/dev.yaml` 的 24 条和 `cases/adversarial.yaml` 的 26 条自建合成样本。它不调用 Gemini、xAI、OpenAI 或其他模型，也不使用 LLM 裁判；不读取、生成或修改外部封存集。

本地 provider 调用应用真实 `detectRedFlags`、`coachLocalSafetyTurn`、`interpretCoachModelOutput`、`calculateSessionLoad` 和标识符脱敏函数。候选回答是明确标注的对抗输入，用于检查实际输出处理，不能当作模型生成结果。provider 不读取期望分级或 rubric 来生成答案。

每条 YAML 样本记录 `input`、`expected_level`、`must_include`、`must_not_include`、`rubric[]{criterion,check,points}`。确定性加权 rubric 借鉴公开的逐项评分形式；正分为满足标准得分，负分为违反标准扣分。通过要求所有检查满足，分数不能抵消急救或诊断失败。这是工程回归分数，不是医生评审或临床有效性分数。

运行器设置 promptfoo 的 `PROMPTFOO_DISABLE_TELEMETRY=1`、`PROMPTFOO_DISABLE_UPDATE=1`，并预加载 `network-deny.cjs` 阻断 Node 的 TCP、HTTP(S)、TLS 与 fetch。移除常见服务密钥变量；所有连接尝试均在调用真正网络实现之前抛错并记录。此版本仍尝试上报一次“telemetry disabled”事件，运行器明确识别并阻断该已知事件，不修改依赖源码；汇总如实保留 `blockedNetworkRequests` 和 `blockedTelemetryRequests`。tsx 的本地 Unix IPC 尝试另记为 `blockedLocalIpc`。只有已知 opt-out 事件允许被阻断后继续，任何未知网络尝试都使评测失败，实际外部请求数始终为 0。用例并发固定为 1，禁用缓存以确保每例真正执行。

报告默认写入项目相邻的 `evidence/r11/`，可用 `FANGKUN_EVAL_OUTPUT_DIR` 改变位置：

- `promptfoo-results.json`：CLI 原始逐例结果。
- `promptfoo-summary.json`：两个样本集的通过/失败/错误/跳过数量、实际 provider 调用次数、模型调用与阻断网络次数。
- `promptfoo-calls.jsonl`：实际调用审计，仅含合成 case id、suite 和零模型调用计数。

旧报告保存为带时间戳的 `*-prior-*`，不会覆盖失败记录。CLI、汇总校验或任何断言失败时退出非零。提交检查应运行 `npm ci`、`npm run eval:local`；发布前的外部独立验收由隔离环境负责。

promptfoo 0.124.1 仅为开发依赖，不进入前端运行时；原始 MIT 许可见 `../docs/r11/licenses/promptfoo-MIT.txt`。关闭遥测依据安装的官方包 `dist/src/telemetry-zVJNEOfo.cjs` 中 `getPostHogClient` 的 `PROMPTFOO_DISABLE_TELEMETRY` 分支；关闭版本检查依据 `dist/src/main.js` 中 `checkForUpdates` 的 `PROMPTFOO_DISABLE_UPDATE` 分支。官方说明：<https://www.promptfoo.dev/docs/configuration/telemetry/>。
