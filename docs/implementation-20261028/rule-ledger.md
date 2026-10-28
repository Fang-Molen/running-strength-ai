规则分类总表见 [rule-ledger.json](./rule-ledger.json)。登记表示可审阅的方法与工程证据，不表示专业认证。

<a id="FK_RECOVERY_HISTORY_SEGMENTS_1"></a>

## 历史分段描述 FK_RECOVERY_HISTORY_SEGMENTS_1

版本：2026-10-28.1。源码：[metric-trajectory.ts](../../src/lib/health/metric-trajectory.ts)、[recovery-rule-ledger.ts](../../src/lib/health/recovery-rule-ledger.ts)。分类：产品描述方法；个人效果与临床校准未验证；不允许直接处方。

按本次可读取且截至分析时已知的历史独立日排序，保留较早、较后两个历史段，分别报告中位数、日期、有效天数和自然日覆盖。当前日不进入参照；同日重复记录不增加独立天数，同日冲突值不参与数值比较。每段至少两个独立日仅为分段描述最低结构要求，不是医学充分性标准，也未新增生理幅度或持续时间阈值。

如果较后段全部数值位于较早段中位数同一侧，显示“描述性方向变化，待复核”。滚动30日差值为零也不能掩盖较早与较后历史的差异。指标变化不能单独证明疲劳、疾病、能力变化或某种训练的因果作用；稳定的同条件训练表现、正常功能、当前相反方向读数作为反证保留。无可比表现或功能记录时维持解释未解决。

来源边界包括运动员、来源、账号、设备、协议、单位、统计口径与时区；算法未单独记录时明确未知。来源更换产生分段，不按跨设备差值推断生理恶化。源记录更正后重算，保留输入引用、版本及内容摘要。

这是本次可读取历史的较早/较后比较，不保证覆盖全部历史，也不保证旧记录超出保留范围后仍有同一参照。训练阶段、环境、生活变化和缺失模式可能改变解释。所有结果保持 `medicalClearance=false`，不新增安全HOLD、不自动改变计划或剂量；疼痛及既有医疗限制仍由原安全路径独立处理。

工作流依据：[athlete-baseline-research](skill://user/6adb9be1b83c819191397c519263102d/athlete-baseline-research/SKILL.md) 与 [athlete-fatigue-recovery](skill://user/6adb9781233c819189ceb2606fa82b35/athlete-fatigue-recovery/SKILL.md)。这些指令支持描述与校验边界，并非本规则的临床有效性研究。

工程证据：新增8项定向断言及84项邻近既有断言通过；[实际程序输出](../../verification/implementation-20261028/metric-trajectory/actual-outputs.json)包含同一合成运动员的下降、稳定、换设备及更正后四组结果，均未经过真实模型或真人专业评估。
