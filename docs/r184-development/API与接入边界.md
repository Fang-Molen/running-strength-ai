# R184 源码接口与接入边界

这些接口已经写入独立副本，尚未对第二阶段代码运行 TypeScript 或程序测试。`IMPLEMENTED` 仅表示源码存在，不表示验证通过或科学规范已获核准。

## 1. 量化与能力指标

`coach-ability-standard.ts`：

- `calculateAbilityMetric(request)`：17 项指标的白名单入口。`input` 复用 R173 `QuantInput`，datum 包含 athleteId、实际/自报角色、原始数值/单位、event/recorded 时间、sourceIds、revision、protocol、结构及距离。未知返回 null 和原因，不修改输入。
- `scoreAbilityMeasurement(measurement, reference, context)`：校验有效性/误差审阅/人群/项目/协议/版本/来源哈希/审批时间/锚点方向后才能算参考尺度位置。默认 `APPROVED_ABILITY_REFERENCES=[]`。调用方不得通过简单把候选标成 APPROVED 绕过正式审核流程。
- `compareAbilityMeasurements(prior,current,asOf)`：同人、同指标/variant/协议/单位/公式，且测量来源独立，才比较原始数值。无适用 SEM 时仅输出观测变化。TE、SWC 不冒充 MDC。
- `abilityGoalProgress(...)`：固定目标版本，且基线先于目标、目标先于新结果；原始百分比与显示裁剪值独立，不当作能力分。
- `buildAbilityProfile(...)`：五个竞技维度；REC、BEH、TECHNIQUE、比赛秒值、官方积分隔离。当前没有维度合成标准，所有轴 score=null。

输入关键字段：SPD01/02/03=`seconds`（实际距离分别为30/30/200）；SEN01/02=`shortSeconds,longSeconds`；SEN03=`first400,last400`；AER02=`speed`+LT1或LT2；AER03=`current`+metricUnit；PWR01=R173的`kg,reps`+`bodyMassKg`；PWR02=`height`；ECO01=`vo2,speedKmh`；ECO02=`cadence,groundContactTime,asymmetry`；REC01=`sleepHours,sessionRpe,subjectiveRecovery,painScore,soreness,restingHeartRate,averageHeartRate,hrv`；BEH01=`due,completed,skipped,notRecorded`及完整窗口。其他四项复用 R173 的输入合同。

条件声明需要来源，不能由数字大小倒推。不同测量方法的 protocolKey 必须不同；不允许为了可比而把未知设备标成通用协议。LT1/LT2 使用同一指标下不同 variant，比较时不混用。

## 2. 复盘与历史

`buildOfflineReview` 增加可选 `metricRequests/approvedCourses`，结果在可选 `development` 中扩展，旧历史无需迁移。`readOfflineWorkspace` 第六参数转交这两项。新适配器提供的 datum 必须精确匹配有效事实的 ID、sourceId、值、单位、时间和修订签名（`JSON.stringify(effectiveEvidence)`）；不允许注入其他运动员或未保存的实际测量。当前事实层未覆盖的指标不能借此强行接入。

正常页面从已有正式事实自动展示分段、力量组次原始记录及恢复/症状信号。完整的 SEN04 指标仍要求完成情况、同轮同距和协议，不把页面上若干可见分段当成完整课次统计。手工条件与真正的课程批准适配需要后续补齐。

`saveOfflineReview` 复用 `fr255-coach-review-r13:` 追加日志；完整来源依赖不沿用短答的32来源截断，不只更新最近20个判断。`reviseHypotheses` 只在明确来源更正时撤回对应假设；源记录消失不等于明确撤回。

`saveLinkedHypothesisObservation` 要求原/新复盘ID、具体假设ID、新记录sourceIds、同协议key、结论、理由、复核人/时间和确认。UI 提供相应选择入口。支持或削弱只代表暂定解释；无因果诊断或能力自动改分。单次普通反馈继续保存但不直接改变假设；已撤回假设不重新启用。该版本仅将旧分析之后发生的新训练作为响应观察；迟录旧训练留作更正/待复核，不当成前瞻响应证明。

## 3. 课程候选与效果验证

批准课程对象必须由已有课程/计划系统提供：运动员、主项、原目的、阶段、协议、课程版本、批准来源、批准/记录时间、批准人、当前状态、关联假设ID和原快照。新旧回执冲突或已撤回时不使用旧批准。没有唯一合格课程则 HOLD，保留观察任务；无新增任意剂量或新课程存储。P4 API 没有计划写入通道。

`auditPredictionTimeline` 校验训练截止、特征发生/记录时间和训练/留出验证窗口。即使通过时间审计，也只代表可继续审查模型；`automaticPredictionAuthorized=false`、`predictionSeconds=null`。本次没有训练、验证或引入成绩预测模型。

## 4. Garmin 准备接口

`coach-device-preparation.ts` 只接受显式 `DecodedDeviceActivity`，不解码 ZIP/FIT，不访问文件/网络/本地存储，也不确认导入。必须保留返回对象的 `raw`，不能只保存 `candidate` 后丢弃峰值心率、经过时间、结构来源或未定位休息。

活动身份、设备、测量协议、圈ID及预期圈覆盖均独立。缺失圈返回缺失序号；原0.45km只换算450m，不四舍五入成标准跑道距离。未知工作/恢复段不凭用时猜测。活动不能直接当作课次；`summarizeDevicePreparation` 只有确认同人且各活动已有正式课次绑定时才给训练课次去重计数，仍不合并各活动的逐圈测量。

还需真实文件、FIT 解码器和既有导入确认流程的桥接；当前设备中心不能宣称已支持 FIT 完整导入。真实文件核对须另获授权。
