# R11 开源借鉴清单落实情况

本轮验收包括 R11 任务单的 P0–P2，以及配套清单明确要求的 EWMA ACWR 和 dev/adversarial 评测；清单同时用于选取实现方法。没有切换模型供应商，也没有调用 Gemini 或其他外部模型。清单描述的后续扩展不等于已经接入的功能。

| 建议 | 本轮落实 | 位置与边界 |
| --- | --- | --- |
| ConText 风格的语境作用域 | 独立编写 TypeScript 实现，区分否定、他人、历史、假设、知识咨询；保留伪否定白名单 | `src/safety/redflag/context.ts`；未复制 medspaCy 代码或第三方中文词表 |
| 症状组合与来源记录 | 按症状维度组合，加入数字和最高级别规则；来源 URL 单列 | `coach-red-flags.ts` 是可执行判定，`rules.zh.json` 是规则类别与参考来源目录；不是已核验的临床分诊工具 |
| BM25 与中文归一化 | 新增 MiniSearch 7.2.0，字符二元切分、领域概念、数字规则和安全主题优先 | `coach-playbook-retrieval.ts`、`coach-playbook-concepts.ts`；纯本地检索 |
| 输出结构与内容检查 | 复用已有 Zod；红旗前后检查、诊断句过滤、数字和引用检查 | `coach-output-contract.ts`、`coach-pipeline.ts`、`coach-explanation.ts`；对话与旧解释入口均检查，结构合法不代表内容正确 |
| 一次修复重试 | 非急症输出至多重试一次，失败保留本地安全回答和失败标记 | `coach-output-retry.ts`、`coach-explanation.ts`、`coach-ai.ts`；每次修复另取预算，25 秒超时，仅做模拟测试，没有真实模型实测 |
| 标识信息处理 | 云端请求正文去除显式标注的姓名、生日、详细位置和手机号 | `redactCoachIdentifiers`；属于有限规则，不能保证任意自由文本完全匿名化 |
| sRPE | 整课评分与单组、分段评分分离；统一分钟 × RPE，标注 AU、口径和未保存状态 | `coach-session-load.ts`；聊天不能自动写入，用户确认后才追加记录 |
| EWMA ACWR | 从保存的整课评分和实际时长计算每日 AU；明确确认完整的连续 28 天之后计算 7/28 日 EWMA 比值 | `coach-load-metrics.ts`、`coach-load-metrics-store.ts`；缺失日期不补零，仅作变化提示，方法与局限见 `load-method.md` |
| 本地导入与记录修订 | 手动录入、单组重量更正、作废及历史投影；文件原件不进入新增重试路径 | 训练导入与日志界面；这不是 FIT/GPX/TCX 二进制解析器 |
| 分层评测 | 自建开发语料、对抗断言、完整历史回归、两种视口的浏览器操作 | `__fixtures__`、`evaluation/r11`；未读取、生成或修改外部 holdout |
| promptfoo CLI | 0.124.1 开发依赖；实际执行 24 条 dev 和 26 条 adversarial，由本地 provider 调用真实应用函数 | `evals/promptfooconfig.yaml`、`evals/run-local.mjs`；确定性加权断言，不使用 LLM 裁判；原始结果、调用审计和网络阻断均随包 |

新增运行时依赖只有 MiniSearch（MIT）；promptfoo 0.124.1（MIT）仅为开发依赖，不进入前端运行时。锁文件随包，许可证原文见 `licenses/MiniSearch-MIT.txt` 与 `licenses/promptfoo-MIT.txt`。Zod 原已存在。没有引入 GPL 代码、许可不清的中文词库、HanLP 模型、商业分诊协议或不可修改的 CRT6/REDs CAT2 原文。

以下仍是配套清单的后续候选，不能计入本轮已实现能力：浏览器向量模型与 RRF、TRIMP、新增 FIT/GPX/TCX Worker 解析、跨三个手表品牌的真实文件验证、独立模型裁判。没有下载向量或裁判模型，也未用缺少的真实数据编造验收结果。

本轮实际运行 `npx --no-install promptfoo eval`，50 个本地样本全部通过；最终重跑数量与状态以 `evidence/promptfoo-summary.json` 为准。provider 调用真实规则、pipeline、sRPE 和标识符处理函数，期望分级与 rubric 不用于生成答案；候选违规模型文本是明确标注的测试输入。命中率和加权分数属于工程回归，不是临床评审或模型质量分数。

评测设置了关闭遥测/更新检查，并预加载底层连接阻断。在 promptfoo 0.124.1 中，即使关闭遥测仍会尝试发送一次已知的“telemetry disabled”事件；本轮该尝试被阻断，另有两次本地 Unix IPC 尝试单独计数。没有请求实际发往外部，也没有模型调用；未知请求会使评测失败。没有修改第三方依赖源码，也不声称“完全没有网络尝试”。每次最终执行的精确计数与原始审计文件一并交付。

公开资源的 URL 来自用户提供的清单，本轮未逐篇独立复核；手册文献统一标注“手册提供，未独立复核”。自建检索基准用于开发回归，不能替代验收方的未见表达测试。
