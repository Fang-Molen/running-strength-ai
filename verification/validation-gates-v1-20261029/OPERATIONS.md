# Shadow、监控与安全回退（未部署）

本分支没有发布/合并/生产流量，当前不满足放行条件。回答校验策略版本`coach-answer-gate-v1`，断言筛查`coach-assertions-v2`；证据快照、source revision、最终正文hash及request trace一起保存。`answerGate.gates`与reasonCodes、taskCoverage、professionalReview和检索状态是观察信号；HTTP 200、非空、模型类型标签不等同任务完成或专业通过。

若后续安排shadow，先冻结代码/输入/评审版本，同一保存输出离线并跑旧/新门，保留差异和所有失败。不得自动将新门答案发布给真实用户。盲审与专业签审完成前不扩大高风险能力。统计按原本合格候选、原本含错误候选、必要任务和已审声明分别取分母；保留缺失和未知，不以所有请求数替换专业样本数。

持续观察：模型finish_reason/请求max_tokens/正文与JSON完整性；input/output/reasoning/cache token原始字段；ledger UNKNOWN、dispatch状态、自动/手动重试数；各门拒绝/修复/部分/澄清/技术故障比例；关键课/反馈反证保留；取消和更正后的旧答提示。reasoning缺失记NA，不能与completion重复相加。代码不启用自动模型修复，发生usage未知、疑似重复派发、异常预算或身份/来源错误立即停止该能力并保存原输入。

安全回退：关闭服务端`FANGKUN_DEEPSEEK_ENABLED`可停用在线解释，客户端保留本地事实/原计划与明确未完成状态；撤回授权时由服务端持久授权控制阻断旧快照。不能回退到已知会误放行的旧过滤器，也不能把失败改成VALIDATED。回退不是发布操作，本次没有执行任何生产设置修改。

外部检索与动作回执端口默认未配置。未来真实适配必须在服务端独立校验当前主体/授权；写入必须由动作系统自身提供完整request/owner/date/target/item/quantity/idempotency绑定、持久唯一性和未知对账。本分支的lookupActionReceipt仅只读查询，不发起登记；模拟receipt的SUCCEEDED不能作为真实落库证据。未配置时不得声称查过网页或写入成功。
