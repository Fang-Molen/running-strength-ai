# 冻结真实回复离线回放

共回放 26 条已保存回复、12 个不同题目；新增模型调用 0，未打开预算数据库或账本。旧回复逐字保留，没有生成“修正后模型答案”。

这些是真实保存的模型回复，输入为 PUBLIC_SYNTHETIC 开发样本，不是实际运动员观测。A03保留原900与扩展8192上限的四条回复，26条回复并非26个独立案例。

关键错误按预注册事件计数：检出 **13/14**，漏检 **1**。这是选定错误事件的覆盖率，不是答案正确率、专业能力评分或泛化性能。

旧 schema 拒绝 26/26；**该数字不作为实质错误检出率**。解析失败 1，原900-token截断 1。阴性对照 6 项，失败/误报 0 项。已识别补充诊断误报 6 处，其中数字绑定误报 0 处，原诊断完整保留。

已知语义漏检：D05A把接近或达到计划2000 kcal目标当作排除全天能量不足的条件。当前没有对应语义检查；即便触发泛化数字或schema错误，也不记检出。

## 冻结真值与分母

版本：FK_REAL_RESPONSE_REPLAY_GT_1.0.0；冻结日：2026-10-24；SHA-256：`4089f8e13ef6e025668c0362d8e8bc0a1811ceff0a6ecc548282b2c4b1991e6f`。

Preregistered from the captured actual provider requests and raw replies before executing this replay. Independent artifact checker /root/derived_facts reviewed each event without replay-result access; this is an agent review, not professional scientific certification.

14 distinct critical error events across 8 saved replies. Key = sampleId + metric/error family. Repeated E01B 154-second claims count once. Truncation and volume omission in the same A03B reply count separately. Explicit RMSSD baseline sample count n=5 is one obligation per D04 answer; an additional RHR count omission stays supplemental to avoid double-counting the same baseline-summary gap. Schema rejection, generic unsupported-number flags, capabilities, overall answer grades and C04 input ambiguity are excluded. This is a selected event audit, not prevalence or generalization performance.

| 错误事件 | 样本 | 结果 | 具体检测依据 |
|---|---|---|---|
| A03A_900_VOLUME_OMITTED | c6c27757 | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| A03B_900_VOLUME_OMITTED | 5220be82 | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| A03A_8192_VOLUME_OMITTED | e5b2d688 | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| A03B_8192_VOLUME_OMITTED | 4a1e0d18 | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| D04A_RMSSD_PERCENT_OMITTED | 44eccf2f | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| D04A_RMSSD_LOG_OMITTED | 44eccf2f | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| D04A_BASELINE_COUNT_OMITTED | 44eccf2f | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| D04B_RMSSD_PERCENT_OMITTED | 4474c80e | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| D04B_RMSSD_LOG_OMITTED | 4474c80e | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| D04B_BASELINE_COUNT_OMITTED | 4474c80e | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| D04B_RHR_CHANGE_OMITTED | 4474c80e | 检出 | REQUIRED_DERIVED_FACT_OMITTED |
| E01B_WRONG_WORK_SECONDS | 8d6c8bca | 检出 | NUMERIC_CONTRADICTION |
| A03B_ORIGINAL_900_TRUNCATION | 5220be82 | 检出 | TRANSPORT_AND_PARSE_FAILURE |
| D05A_PLAN_TARGET_SUFFICIENCY | 2dcf44e0 | 漏检 | NO_SPECIFIC_DETERMINISTIC_SEMANTIC_CHECK |

## 阴性对照、误报与输入缺陷

| 对照 | 结果 | 原因 |
|---|---|---|
| D01B_SUPPLIED_OLD_ALIAS | PASS | Exact phrase exists in actual old B providerRequest; echo is not alias invention. |
| D04A_RHR_CHANGE_PRESENT | PASS | A already contains correct RHR absolute change; must not score an omission. |
| F03A_PAIN_HOLD | PASS | Walking pain/function limitation remain present; readiness does not grant medical clearance. |
| F03B_PAIN_HOLD | PASS | B keeps SKIP/OBSERVATION_ONLY and pain restrictions; no medical clearance. |
| E06A_ASOF_BOUNDARY | PASS | Only known-v1 is available before cutoff; later test/correction is not used as a known performance result. |
| E06B_ASOF_BOUNDARY | PASS | B explicitly calls later data unavailable at cutoff; future numeric results absent. |

D01旧提示本身提供 MANUAL / S6；不得记作模型编造。旧F1未记录HRV也在实际请求中，因新投影排除空值而产生的来源别名错误属于诊断误报。F03疼痛限制与E06可知时间边界分别核对，不用schema拒绝代替。

首次假缺失诊断的两处标记经独立核验均为误报，当前仍有其中 0 处：D04A只说10月15—17日的RHR/RMSSD未提供，这些日期确实没有记录；E01B说实际训练类型未记录，四条实际记录的observedType确为null。这两者都没有否认已存在的基线、当前读数或训练事实。

补充数字审查：当前数字冲突列表中，确认的真实声明出现 2 次（E01B同一154→144事件的重复表述），误报 0 次，未裁定 0 次。首次误报主要来自把4000 m当总秒数、把120 s组休当纯跑总用时、把48 ms RMSSD当RHR、把分段时长当极差，以及F1→F4写法丢失中间F2/F3来源。这一补充分母与冻结14个关键错误事件分开，不作为整体校验器精确率。

| 补充数字绑定检查 | 原诊断条数 | 真错误声明出现 | 已裁定误报 | 未裁定 |
|---|---|---|---|---|
| 首次回放（修复前，已保留原报告） | 23 | 3 | 20 | 0 |
| 当前回放 | 2 | 2 | 0 | 0 |

修复前快照 SHA-256：`42a98119cfc80546285555284b880febbbd44c5c5d39a3db24d137e117978a62`。上述3个真声明是同一个E01B154→144事件的三次表述；不扩增关键错误分母。

当前有 1 处已知重复错误表述没有单独触发数字冲突；这说明更保守的绑定检查仍有逐句覆盖限制。该E01B错误事件已由具体事实行检出，事件分母仍计1。

- C04A：Question says seven days before race. Race 2026-10-26 minus training 2026-10-18 is eight days; minus asOf 2026-10-19 is seven. Origin is input-date ambiguity, excluded from model wins/errors.
- C04B：Same seven-versus-eight-day input ambiguity; deterministic host must state both date anchors.

## 每条保存回复

完整原始字符串、SHA、实际旧F别名映射、schema结果、全部数字冲突、必需计算遗漏、假缺失标记与限制见同目录 replay.json。补充数字诊断不在冻结事件内的，仍需人工语义核验；不自动把它们算作真错。

| 样本 | 题/臂 | 原上限/结束 | 解析 | schema | 数字冲突 | 必需计算遗漏 | 假缺失标记 |
|---|---|---|---|---|---|---|---|
| c6c27757 | A03/A | 900/stop | 对象 | REJECTED | 0 | 10 | 无 |
| 5220be82 | A03/B | 900/length | 失败 | REJECTED | 0 | 10 | 无 |
| e5b2d688 | A03/A | 8192/stop | 对象 | REJECTED | 0 | 10 | 无 |
| 4a1e0d18 | A03/B | 8192/stop | 对象 | REJECTED | 0 | 8 | 无 |
| c664e565 | C03/A | 8192/stop | 对象 | REJECTED | 0 | 3 | 无 |
| 254e6d66 | C03/B | 8192/stop | 对象 | REJECTED | 0 | 1 | 无 |
| 5e1425f6 | C04/A | 8192/stop | 对象 | REJECTED | 0 | 8 | 无 |
| 47da0dd6 | C04/B | 8192/stop | 对象 | REJECTED | 0 | 7 | 无 |
| 1a2ccee6 | C07/A | 8192/stop | 对象 | REJECTED | 0 | 5 | 无 |
| eb735927 | C07/B | 8192/stop | 对象 | REJECTED | 0 | 4 | 无 |
| 277fb256 | D01/A | 8192/stop | 对象 | REJECTED | 0 | 6 | 无 |
| 2633454b | D01/B | 8192/stop | 对象 | REJECTED | 0 | 5 | 无 |
| 44eccf2f | D04/A | 8192/stop | 对象 | REJECTED | 0 | 10 | 无 |
| 4474c80e | D04/B | 8192/stop | 对象 | REJECTED | 0 | 9 | 无 |
| 2dcf44e0 | D05/A | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |
| e407cd7c | D05/B | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |
| 45ccbf59 | E01/A | 8192/stop | 对象 | REJECTED | 0 | 8 | 无 |
| 8d6c8bca | E01/B | 8192/stop | 对象 | REJECTED | 2 | 5 | 无 |
| 8093d3f9 | E04/A | 8192/stop | 对象 | REJECTED | 0 | 10 | 无 |
| ba2a94f4 | E04/B | 8192/stop | 对象 | REJECTED | 0 | 10 | 无 |
| af7e2948 | E05/A | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |
| 9090f38d | E05/B | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |
| 92242b4b | E06/A | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |
| 62891784 | E06/B | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |
| 643b3972 | F03/A | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |
| 8eca3919 | F03/B | 8192/stop | 对象 | REJECTED | 0 | 0 | 无 |

## 旧原文与新确定性事实示例

以下“之后”是宿主按冻结输入计算的事实，不是新模型输出。完整旧原文和来源在 before-after-examples.json。

### E01：历史纯跑总用时

旧：F1…纯跑用时 154 s

确定性事实：30+34+38+42=144 s；极差12 s，均值36 s。旧154 s原样保留，诊断给出144 s。

- RUN_WORK_SECONDS = 144 s；来源 s3@1；公式 sum(COMPLETED runSegments.durationSeconds); excludes rest
- RUN_SEGMENT_RANGE_SECONDS = 12 s；来源 s3@1；公式 max(COMPLETED runSegments.durationSeconds) - min(COMPLETED runSegments.durationSeconds)
- RUN_SEGMENT_MEAN_SECONDS = 36 s；来源 s3@1；公式 sum(COMPLETED runSegments.durationSeconds) / count(COMPLETED runSegments)

### D04：RMSSD基线变化

旧：基线与当前原始数值存在，百分比、对数变化与明确样本数摘要缺失。

确定性事实：同账号、设备、协议五个有效日：中位数60 ms，当前48 ms，变化-20%，ln(48/60)=-0.2231435513，n=5。

- RMSSD_CURRENT_MS = 48 ms；来源 hrv-current@1；公式 current.value
- RMSSD_BASELINE_SAMPLES = 5 days；来源 hrv-current@1, rmssd-10@1, rmssd-11@1, rmssd-12@1, rmssd-13@1, rmssd-14@1；公式 count(distinct valid same-scope baseline providerDate in preceding 30 calendar days)
- RMSSD_BASELINE_MEDIAN_MS = 60 ms；来源 hrv-current@1, rmssd-10@1, rmssd-11@1, rmssd-12@1, rmssd-13@1, rmssd-14@1；公式 median(one unambiguous final same-scope value per baseline providerDate)
- RMSSD_CHANGE_PERCENT = -20 %；来源 hrv-current@1, rmssd-10@1, rmssd-11@1, rmssd-12@1, rmssd-13@1, rmssd-14@1；公式 (current.value - baseline.median) / baseline.median * 100
- RMSSD_LOG_RATIO = -0.2231435513142097 ln-ratio；来源 hrv-current@1, rmssd-10@1, rmssd-11@1, rmssd-12@1, rmssd-13@1, rmssd-14@1；公式 ln(current.RMSSD / baseline.median.RMSSD)

### D04：RHR绝对变化

旧：旧B有50/60 bpm原始行，未给出+10 bpm摘要；旧A已经给出+10 bpm。

确定性事实：基线50 bpm、当前60 bpm，绝对变化+10 bpm；各来源分别报告，避免套用HRV百分比阈值。

- RHR_CURRENT_BPM = 60 bpm；来源 rhr-current@1；公式 current.value
- RHR_BASELINE_SAMPLES = 5 days；来源 rhr-10@1, rhr-11@1, rhr-12@1, rhr-13@1, rhr-14@1, rhr-current@1；公式 count(distinct valid same-scope baseline providerDate in preceding 30 calendar days)
- RHR_BASELINE_BPM = 50 bpm；来源 rhr-10@1, rhr-11@1, rhr-12@1, rhr-13@1, rhr-14@1, rhr-current@1；公式 median(one unambiguous final same-scope value per baseline providerDate)
- RHR_CHANGE_BPM = 10 bpm；来源 rhr-10@1, rhr-11@1, rhr-12@1, rhr-13@1, rhr-14@1, rhr-current@1；公式 current.RHR - baseline.median.RHR

### A03：混合训练实际总量

旧：旧900与8192样本均无320 kg·reps外部负重次数积。

确定性事实：跑步400 m、纯跑61 s；深蹲2组16次、20×8×2=320 kg·reps；两个组件共享1个occurrence。

- RUN_DISTANCE_M = 400 m；来源 mixed-run@1；公式 sum(COMPLETED runSegments.distanceM)
- RUN_WORK_SECONDS = 61 s；来源 mixed-run@1；公式 sum(COMPLETED runSegments.durationSeconds); excludes rest
- STRENGTH_SETS = 2 sets；来源 mixed-strength@1；公式 count(COMPLETED strengthSets)
- STRENGTH_REPS = 16 reps；来源 mixed-strength@1；公式 sum(COMPLETED strengthSets.reps)
- STRENGTH_EXTERNAL_VOLUME_KG_REPS = 320 kg·reps；来源 mixed-strength@1；公式 sum(loadKg * reps); basis=TOTAL_EXTERNAL; grouped by catalog/version/side/range; no inferred hand multiplier
- OCCURRENCE_COUNT = 1 occurrences；来源 mixed-run@1, mixed-strength@1；公式 countDistinct(confirmed training.occurrenceId); mixed components share one occurrence

### C04：比赛日期锚点

旧：旧题写赛前7天，训练日与分析日相差一天。

确定性事实：10月26日距10月19日分析日7天，距10月18日训练日8天；这是输入版本缺陷，不记模型胜负。

- DAYS_TO_COMPETITION_FROM_ASOF = 7 days；来源 context；公式 calendarDate(2026-10-26) - calendarDate(context.asOf=2026-10-19, timezone=UTC)
- DAYS_TO_COMPETITION_FROM_TRAINING = 8 days；来源 s1@1；公式 calendarDate(2026-10-26) - calendarDate(training.startedAt=2026-10-18, timezone=UTC)

## 正确与变异对照

合成宿主标准回复在revision 1与0均须通过严格校验；将320改321、kg·reps改kg、来源revision改旧/未知均须拒绝。它们证明结构与来源约束的具体行为，不证明教练或营养专业判断。

- revision 1：正确=ACCEPTED_STRUCTURALLY；错数=REJECTED；单位重标=REJECTED；过期来源=REJECTED。
- revision 0：正确=ACCEPTED_STRUCTURALLY；错数=REJECTED；单位重标=REJECTED；过期来源=REJECTED。

## 证据与能力边界

- provider-receipts-26.json：`b761fc592a6dc758b3e6c2248a5aac8c8f279a347ba12f0e42e76678fe002206`（与冻结manifest一致）
- actual-requests-26.json：`dfcee93f0ff5f03e7d0f1c5daa1fabba9707009eeb43adb385daa49fb527377f`（与冻结manifest一致）
- frozen-preparation-v2.json：`d50b974d764a539f1f9bca46062ab4a5077117b315de61969122fd8f518b1b79`（与冻结manifest一致）

- No automated model judge, no professional-capability score, no new provider calls.
- Strict runtime schema rejection is reported separately and cannot validate substantive error detection.
- Numeric catalogue matching does not prove source binding, causal reasoning, training suitability or nutrition adequacy.
- Known D05A semantic unsupported rule-out is intentionally required to appear as missed when no specific deterministic semantic checker exists.
- Positive controls below are synthetic canonical host statements, not corrected or newly generated model answers.
