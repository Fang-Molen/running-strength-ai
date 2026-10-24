# 2026-10-24：真实测试缺陷集中整改（离线）

本轮不执行付费模型调用。原活动26次额度已耗尽；保留旧服务、授权与账本以供追溯，不重新初始化活动。

- 定向回归：`npm run test:deepseek-remediation`。
- 保存回答离线回放：`npm run replay:deepseek:offline`；只读取原26条回答，结果不代表新的模型回答。
- 局部类型检查：`npm run typecheck:deepseek-remediation`。
- 新上下文协议为 `FK_FACT_PACKET_3`；原60题和冻结评分字节不变，旧请求通过 `protocolVersion: 'legacy-v2'` 从捕获文件读取。
- D01来源别名与C04日期口径更正见 `evaluation-protocol-v3.json`。完整交付说明见仓库 `handoff/deepseek-remediation-20261024/`。

---

# V82：60 个公开开发例的本地适配

这是确定性开发检查，不是 DeepSeek 真实模型评测，也不是医学/运动科学人工核验。

执行（项目根目录，使用当前已锁定依赖）：

```sh
node --import ./scripts/test-register.mjs -e "import('./evaluation/deepseek-development/run-local.ts')"
```

无需 API Key，不安装依赖，不联网；全局 fetch 被禁止。服务端测试只注入本地 mock transport，未创建真实外部请求。结果写入 `../audit/sixty-local-results.json` 和 `../evidence/sixty-local/results.json`。非零退出码表示本地断言失败或出现意外网络尝试。

`cases-60.json` 保留原始 A01—H04 编号和评测标准。标准答案、expectedMetrics 只归评价侧；运行器没有真实模型执行器，不把这些字段作为模型上下文。`run-local.ts` 的每个用例独立构造合成事件、个人来源、时点或明确输入，并实际调用 V82 生产函数；不通过拼预期答案来生成 PASS。每例重置 MemoryStore、运动员身份、正式计划哨兵。断言计数是实际 assert 调用数，含每例的计划哨兵只读核对，不是 Node test 文件数。

覆盖说明：

- A：真实开始锚点、冻结跑步快照、力量事实投影、交错课次、跨运动员、计划/实际、作废、更正及知晓时间。
- B：配速、秒/分钟及公里/米、首末时间/速度变化、整课 RPE 作用域、分轮工作量、目标偏差、均值、力量 kg·次、完成/跳过/缺失。
- C：原目的与教练意图、未知阶段/比赛优先级、基础期/赛前同课程的限定解释。相同 4×1000m 的实际成绩为 238/240/241/240 秒、目标 240 秒、组间休息 120 秒。
- D：缺 HRV 降级、设备/算法不可比、睡眠区间代表值不可当精确测量、个人 RHR/RMSSD 描述、早餐记录不证明全天赤字、设备准备度不等于许可。
- E：同协议历史、跨协议拒比、单次不改能力分、事前假设与随后同协议反证、未完成及不利结果不删除、未来结果与更正隔离。
- F：急症、疼痛、REDs、伤后许可 UNKNOWN、显式前轮红旗保持。
- G：独立调用同意、主体/课程/授权绑定、完整 provider payload 序列化隐私、撤回、缓存键隔离、更正依赖失效建议。
- H：预算预检、真实生产 controller 的 mock 429/503/超时、实际返回模型名/未知用量、工具请求拒绝。H01 只测预检，真实 SQL 并发/持久账本另有专项测试，不能混为一谈。

实际覆盖边界：

1. 每例 `coverage` 是准确范围。F06 测显式 prior 状态函数，不证明浏览器刷新后完整对话状态；G05/G06 测键和更正审计，不证明已经部署的缓存或长期记忆检索服务；E05 证明输入的未完成/不利记录保留，未验证完整干预试验的预登记分母和样本选择。
2. D03 从现有睡眠区间代表值合同进入原生健康计算，不是自由文本“6 到 7 小时”的语言识别测试。原始区间文字解析仍需独立评估。
3. 临床解释、专业建议优劣和真实 DeepSeek 延迟/Token/费用全部 NOT_RUN。合成 mock 价格不是真实报价。
4. 60 例原始目录仍包含概念性聊天上下文。这一轮绑定的是本地生产函数的合成场景；真实模型 A/B 必须另行冻结每例经授权的最小服务端快照和两臂请求，不能把本地 PASS 当作可直接发起 120 次真实请求的依据。
5. 该套测试不替代全量回归、类型检查、真实浏览器离线验收或科学阈值核准。不修改业务源码、训练数据或正式计划，不部署。

## V89.10.16 离线测试准备增量（2026-10-23）

以用户提供的 V89.10.16 ZIP 为基线，保留已完成的候选修改。原始 `cases-60.json` 和四条 `chain-ab-fixtures.json` 未改写。47 题是本地计算、安全或接口合同检查，13 题是模型解释候选，因此默认准备 13 对、26 个请求样本。不会为了凑 120 次调用而绕过本地路由和安全门。

在项目根目录执行一次集中离线准备（Node 使用现有依赖，Python 仅负责保存子命令日志）：

```sh
python evaluation/deepseek-development/run-offline.py --output /tmp/fangkun-deepseek-preparation
```

该命令调用原有 60 题适配器、A/B 合同测试、现有真实 controller 的本地模拟测试，再输出事实快照、请求样本、评价侧答案、空结果模板和预算。`no-network.mjs` 禁止原生网络访问；测试中的服务端 transport 是本地注入的模拟函数。收费调用数必须为零。

只回归已修复的准备程序时可使用：

```sh
python evaluation/deepseek-development/run-offline.py --output /tmp/fangkun-deepseek-preparation --stages ab-contract emit-preparation
npx tsc --noEmit -p tsconfig.preparation-check.json
```

局部重跑保留原 `execution-log.json`，另存 `regression-execution-log.json`。必须先存在该目录中真实执行的 60 题结果，不能凭空生成 PASS。

A/B 共享同一事实覆盖、来源别名、单位、缺失状态、时间截点、问题、模型及采样设置。A 接收普通逐项记录，B 额外接收现有事实/肌群暴露/恢复计算与候选推理结果。B 对重复字段使用可还原的列编码，事实和安全条件不删减；任一臂超出 8000 输入 Token 保守上界时，两臂一起阻断。实际 Token 仍为 null，必须从未来的真实回执取得。

`model-fixtures.ts` 只补 13 题缺少的公开合成快照，源头对应现有 `run-local.ts`。E01 原适配器实际只有两条先前课程，题目要求三条；A/B 快照显式增加第三条公开合成旧课，不能当作真实运动员历史。47 个本地病例的快照是原适配器的场景说明与隔离 MemoryStore 捕获，不伪称全部都已是可发送的临床事实 DTO。评分字段独立保存在 `evaluator-only-scoring.json`，不进入任何模型请求。

真实执行仍被阻断：尚无批准的模型版本/价格/费用授权；受信任宿主服务未安装；现有 App 路由会固定组装 B 提示，不能原样执行 A/B 样本。需要经过批准的服务端评测适配，不提供绕过鉴权、费用账本的直连密钥脚本。状态样本中的 `transportReady:false`、`modelApproved:false` 必须保留至真实核准。

建议上限（不是报价或批准）：单次 US$0.05，先做两对共四次、上限 US$0.20；四次计入完整 26 次、总上限 US$1.30。实际派发前按经核准的同一模型价格、零缓存优惠预留最坏费用，任一上限不足即停止。120 次全目录比较属于另一项未授权实验。

## P0 修复与最多 26 次受控评测（本轮）

基线 `932b53e`，保留原 60 题和历史日志。仅在 13 对付费子集中将 C02/E03 替换为 A03/F03。原 App 的 LOCAL 路由和疼痛安全门不变；F03 只在隔离的公开合成评测中派发，结果不进入正式教练结论。

`scoring-frozen.json` 和 `.sha256` 是本轮预先冻结的评分合同；原 60 题的 expected 保留。评分侧额外固定数值容差、独立维度、安全否决条件。`evaluator-only-scoring.json` 是兼容旧工具的材料；实际盲评使用冻结合同。所有评分资料只交给评分人员，禁止混入 providerRequest。

A 组收到可读原始事实、来源分组、未知值、历史结果和旧假设；B 组收到完全相同的事实，再加生产函数 `projectAnalysisEvidence` / `evaluateRecoveryEvidence` / `buildMuscleExposure` / `analysisModelView` 的输出。两组同模型、非思考模式、temperature=0.4、900 输出 Token、JSON，0 工具、0 重试。8,000 输入 Token 采用 UTF-8 字节保守上界，不通过删历史或加大上限解决超限。未知账号/设备不自动视为同设备。D04 使用明确的公开合成来源绑定，生产基线的同来源检查未放宽。

集中离线执行：

```sh
python evaluation/deepseek-development/run-offline.py --output /absolute/output-directory
npx tsc --noEmit -p tsconfig.preparation-check.json
```

新的 `server/coach-deepseek/evaluation-service.ts` 是可调用的隔离服务适配，复用现有 Gate EdDSA 验证和 SQL 费用账本。没有创建 App 路由或部署。`serve-evaluation.ts` 为受信任操作人员启动本地服务；只绑定回环地址，只从内置合成题库构建快照，不接收客户端提供的训练事实、API Key、ownerId 或模型参数。持久 PGlite 位于明确指定的独立评测目录，不使用 App/真实运动员数据库。也可由受信任宿主提供既有 Postgres 事务适配。

正式执行前的必要配置：

- 服务端 Secrets 中配置 `DEEPSEEK_API_KEY`，不得写入源码或发送在聊天中。
- 固定 `FANGKUN_EVAL_ISSUER` / `FANGKUN_EVAL_AUDIENCE` 及仅含 Ed25519 公钥的 JWKS 文件；使用该身份源实际签发的短期 `FANGKUN_EVAL_BEARER`。开发用户、任意 ownerId 和自行伪造的真实身份不被接受。
- 可信操作人员按用户明确费用授权完善 `approval-template-NOT-AUTHORIZED.json`，绑定 owner、manifestHash、rubricHash、期限和费用硬上限；核实模型/价格/Token 统计后补齐 VerifiedDeepSeekPolicy。模板默认禁用，不能直接消费。
- 当前参考：deepseek-flash / DeepSeek-V4.1-Flash-1017；显式关闭 thinking。2026-10-23 官方峰值无缓存输入 US$0.30/M、输出 US$1.20/M。保守 8,000+900 Token：每次 US$0.00348、4 次 US$0.01392、26 次 US$0.09048。US$0.02/US$0.10 是建议审批上限，不能自动视为授权；价格变化须重新核定。

受信任服务入口（不是直连 API Key 脚本）：

```sh
node --import ./scripts/test-register.mjs evaluation/deepseek-development/serve-evaluation.ts --state-dir /isolated/evaluation-state --approval /private/approved.json --public-jwks /private/issuer-public-jwks.json
```

另一个进程持真实身份 Token，通过服务端执行 pilot：

```sh
node --import ./scripts/test-register.mjs evaluation/deepseek-development/dispatch-evaluation.ts --order /isolated/evaluation-state/private-dispatch-order.json --phase pilot --output /isolated/evaluation-state/pilot-dispatch.json
```

Pilot 固定 A03/D04 共 4 次，已计入 26 次。任一网络、模型、用量或预算异常立即停止，无自动重试。超时扣费未知会冻结账本，不能靠重新启动或另一个请求 ID 解除；需独立核账，不提供自动退款或重发入口。重复 sample 不能扣费第二次。

停止本地服务后，可使用同一服务脚本的 `--export` 导出原始 provider 回包、Token、延迟、账本费用与评分材料；`reviewer-only.json` 不含 A/B 标签、B 提示或模型参数，`private-unblinding.json` 必须另存，盲评完成前不交评分者。模型可能在回答中透露表达风格，这种可推断性无法完全消除。科学性必须由合格专家单独审核。

人工检查四次 pilot 后，使用同一受信任身份和 `--review-pilot <四条原始回执数组的sha(JSON.stringify)值>` 记录复核，再启动服务并派发 `--phase evaluation`，只会派发剩余 22 次。不得用模型自评代替专家复核。所有费用是按返回 Token 和已固定价格核算的账本金额，并非供应商最终账单。返回中未提供的精确模型版本必须保留 null，不能把文档发布名冒充实测版本。

回退：停止这个独立服务，保留账本和原始回执以便核账；恢复本轮基线源码包。不要删除 UNKNOWN 费用记录来重试，不触碰用户训练记录、V4 课表或正式站点。

## 独立公开合成评测：本地操作员初始化补充

旧入口要求外部Gate JWT/JWKS，首轮没有登录宿主时会阻断。现在另有显式的 `--local-synthetic-operator` 模式：信任根是云端任务实际OS操作员和其0700目录/0600控制文件；随机短期凭据只授权固定的公开合成活动、manifest、评分合同。它不创建App用户，不签发App JWT，不访问真实运动员数据。原Gate JWT路径和正式App鉴权不变。客户端仍只提交sampleId，Key仍只由受控服务端使用。

新增 `bootstrap-evaluation.ts` 负责免费GET模型列表验证、原费用授权核对和首轮初始化；不会发起生成。使用前退出计划模式，并检查本任务实际挂载Key及网络。身份不再要求操作者凭空填写ISSUER/AUDIENCE/JWKS，但必须显式采用本地合成模式。

首次没有旧账本可在**确认整项活动此前没有生成调用**后初始化；历史不明、旧数据未登记、已登记目录/账本丢失、换目录重置都会拒绝。确认来源会记入私有授权文件，不假称供应商核账已完成。后续重启使用同一目录、同一registry、同一campaign和 `--resume`，费用及UNKNOWN预留必须保留。

先只验证Key（免费GET，不生成）：

```sh
node --import ./scripts/test-register.mjs evaluation/deepseek-development/bootstrap-evaluation.ts --check-key-only
```

由受信任运行人员核对当前官方价格后，使用原授权文件和经核实的历史声明。历史声明必须形如 `{ "priorGenerationCalls":0, "unknownPriorCalls":false, "source":"已核实的日志/用户声明来源" }`；无法核实就不填写成0。下列私有路径由操作者实际配置。

```sh
node --import ./scripts/test-register.mjs evaluation/deepseek-development/bootstrap-evaluation.ts --state-dir /PRIVATE/STATE --registry-dir /PRIVATE/REGISTRY --authorization /PATH/AUTHORIZATION.json --history-evidence /PRIVATE/confirmed-history.json --confirm-first-run --confirm-current-price
node --import ./scripts/test-register.mjs evaluation/deepseek-development/serve-evaluation.ts --local-synthetic-operator --state-dir /PRIVATE/STATE --registry-dir /PRIVATE/REGISTRY --approval /PRIVATE/STATE/approved.json
```

另一个进程通过本地凭据向服务派发4次Pilot，无需外部登录变量：

```sh
node --import ./scripts/test-register.mjs evaluation/deepseek-development/dispatch-evaluation.ts --operator-state /PRIVATE/STATE --order /PRIVATE/STATE/private-dispatch-order.json --phase pilot --output /PRIVATE/STATE/pilot-dispatch.json
```

停止服务后，同一serve命令加 `--export` 可导出；加 `--review-pilot <四条回执的摘要>` 可记录复核。再启动同一服务，dispatch改成 `--phase evaluation` 执行剩余22次。不要同时用两个进程打开PGlite。流程/参数/费用异常停止；模型回答质量的失败必须保留，不能改答案或重发以追求PASS。

本地凭据只在私有 `operator-token` 文件中，不打印，不装进日志/ZIP。原金额上限、26次总数、4次Pilot、并发1、零自动重试和持久费用规则不变。此补充是评测控制面适配，不是第二套AI Brain，不是正式App发布。

## 2026-10-24 本地续接说明

本审阅分支默认保留 d8a3f02 活动的冻结请求字节；新事实包协议须显式 `protocolVersion: "v3"`（CLI `--protocol v3`）。准备输入不授权执行。上面的历史操作流程不是本轮执行许可；本轮禁止调用业务模型、不得重置活动或把未知历史费用记零。R4 接入状态和未通过项见 `../r4/README.md`。
