/** Generated from the attached R1 curriculum. Teaching data, NOT athlete facts or a medical prescription. */
export type TeachingRule = {id:string;originalId:string;core:string;title:string;question:string;guidance:string;counterexample:string;expectedBehavior:string;evidenceRefs:string[];authority:'AUTHOR_TEACHING_CANDIDATE';prescriptionApproved:false}
export type TeachingSource = {id:string;title:string;url:string;doi:string|null;year:number|string;design:string;reportedCheckDepth:'BODY_EXCERPTS_REPORTED'|'ABSTRACT_REPORTED'|'SEARCH_EXCERPT_REPORTED';reportedCheckDescription:string;reportedCheckedOn:string;supportedClaim:string;limitations:string;independentlyReverifiedDuringImport:false}
export type TeachingExample = {id:string;title:string;scenario:string;proposedResponse:string;changeCondition:string;followup:string;ruleRefs:string[];evidenceRefs:string[];dataOrigin:'SYNTHETIC_TEACHING';eligibleForAthleteMemory:false}
export const CURRICULUM_VERSION = 'FK5-TEACHING-R1-INTAKE-20261011';
export const CURRICULUM_ARCHIVE_SHA256 = '6ba60dba24e4a939c69dc248a33105df9f996a8e6069153d4194bf08794a7f8d';
export const TEACHING_RULES: readonly TeachingRule[] = [
  {
    "id": "FK5R1:P01",
    "originalId": "P01",
    "core": "01 训练计划",
    "title": "追问要改变决定，而不是收齐表格",
    "question": "只说“400米想跑55秒”时先问什么？",
    "guidance": "优先问近期同条件能力、期限、近期训练、可用日和当前限制；已在上下文给出的不重复问。先说明能提供什么，再分轮补齐最影响安排的信息。",
    "counterexample": "把缺一项实验室测试当作拒绝所有建议的理由，或者一次抛出二十项问卷。",
    "expectedBehavior": "首轮少量关键问题＋暂定训练方向；不能据目标直接生成全部精确配速。",
    "evidenceRefs": [
      "FK5R1:S01",
      "FK5R1:S02"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:P02",
    "originalId": "P02",
    "core": "01 训练计划",
    "title": "相同成绩不等于相同限制因素",
    "question": "两个800米都2:08，安排要一样吗？",
    "guidance": "用近期多距离表现形成描述性能力画像，再核对训练背景和测试条件；优先级是待验证假设，不是给运动员永久贴标签。",
    "counterexample": "由400米和800米成绩直接算出最大有氧速度、乳酸阈值或已验证ASR。",
    "expectedBehavior": "指出可能不同的侧重，说明什么新证据会使侧重改变。",
    "evidenceRefs": [
      "FK5R1:S02"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:P03",
    "originalId": "P03",
    "core": "01 训练计划",
    "title": "从训练目的选择刺激",
    "question": "200米重复跑到底在练什么？",
    "guidance": "结合实际速度、次数、间歇、项目与阶段解释任务；同样距离可承担不同目的，主课/辅助由本节目标决定。",
    "counterexample": "“所有400米运动员的60米都只能是辅助”“所有200米重复都等于乳酸耐受课”。",
    "expectedBehavior": "用“希望改善什么—怎样组织—看什么结果”解释课，而不靠距离贴标签。",
    "evidenceRefs": [
      "FK5R1:S01",
      "FK5R1:S02"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:P04",
    "originalId": "P04",
    "core": "01 训练计划",
    "title": "力量训练服务于专项结果",
    "question": "深蹲变强但跑步未进步怎么办？",
    "guidance": "把力量获得、专项执行、比赛表现分开观察；检查训练时间分配、疲劳背景和可比性，保留迁移不足等竞争解释。",
    "counterexample": "按1RM提升20%推算比赛快20%；一次跑差就断言力量无效。",
    "expectedBehavior": "提出有限的整合或监测改动，不能把更重重量当成唯一发展方向。",
    "evidenceRefs": [
      "FK5R1:S11"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:P05",
    "originalId": "P05",
    "core": "01 训练计划",
    "title": "资料不全也要提供可用的分层答案",
    "question": "不能定精确秒数时能交付什么？",
    "guidance": "分成现在可计算的事实、可解释的方向、带条件的熟悉训练结构、仍需补齐的剂量依据。先解决用户眼前问题。",
    "counterexample": "永远回复UNKNOWN，或者为了显得有用编出未来12周每组秒数。",
    "expectedBehavior": "给出适合当前信息层级的候选行动与明确补充问题，剂量未知只限制剂量而非全部服务。",
    "evidenceRefs": [
      "FK5R1:S01",
      "FK5R1:S07"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:P06",
    "originalId": "P06",
    "core": "01 训练计划",
    "title": "测试服务于决策，不为测试而加量",
    "question": "还需要做哪些能力测试？",
    "guidance": "先找现有可靠训练与比赛证据；只有测试结果能改变安排且风险可接受时才讨论补测，不默认整套极限测试。",
    "counterexample": "为了获取精确画像，要求陌生新手连续做100/200/400/1500全力测试。",
    "expectedBehavior": "说明每项补测要区分的假设、可用替代与不需要测试的情形。",
    "evidenceRefs": [
      "FK5R1:S01",
      "FK5R1:S02"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:R01",
    "originalId": "R01",
    "core": "02 疲劳恢复",
    "title": "工作量、反应与恢复不是同一个量",
    "question": "两次训练sRPE相同就同等疲劳吗？",
    "guidance": "把距离/速度/接触/重量等外部工作、整课主观反应、随后恢复和症状分开；总分只保留其定义内含义。",
    "counterexample": "45分钟×RPE6与90分钟×RPE3都270，便认定对肌腱或神经系统刺激相同。",
    "expectedBehavior": "允许算270任意单位，但明确不能由这个相等推出组织负荷、适应或恢复时间相等。",
    "evidenceRefs": [
      "FK5R1:S07",
      "FK5R1:S19"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:R02",
    "originalId": "R02",
    "core": "02 疲劳恢复",
    "title": "先核对测量，再解释变化",
    "question": "手表指标突然变了，是训练问题吗？",
    "guidance": "核对设备、时段、姿势、记录口径与连续背景；设备冲突先保留，不擅自取平均或选更好看的。",
    "counterexample": "把旅行后跨时区的睡眠变化全归因训练，或把两源相加当一晚总睡眠。",
    "expectedBehavior": "给出来源冲突和需要核对的窗口；不凭单值放行或否决所有运动。",
    "evidenceRefs": [
      "FK5R1:S05",
      "FK5R1:S08"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:R03",
    "originalId": "R03",
    "core": "02 疲劳恢复",
    "title": "HRV没有单向通行灯",
    "question": "HRV升了是否恢复好、降了是否必须休息？",
    "guidance": "先问当前表现与症状，再结合个人可比趋势；HRV变化只是一类证据，不与恢复许可画等号。",
    "counterexample": "HRV回升就忽视局部疼痛；一晚下降就确诊过度训练。",
    "expectedBehavior": "说明证据相容或冲突在哪里，给出条件化而非指标自动触发的选择。",
    "evidenceRefs": [
      "FK5R1:S05",
      "FK5R1:S06"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:R04",
    "originalId": "R04",
    "core": "02 疲劳恢复",
    "title": "没有设备也能有价值地判断",
    "question": "没有HRV怎么服务运动员？",
    "guidance": "可用训练是否异常费力、睡眠、精神状态、局部不适、日常功能及连续变化；降低量化精度而不是取消服务。",
    "counterexample": "要求先买手表才给建议；用默认数值填补设备缺失。",
    "expectedBehavior": "给一组简短的可手动回答问题和可观察的下一步指标。",
    "evidenceRefs": [
      "FK5R1:S04",
      "FK5R1:S07"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:R05",
    "originalId": "R05",
    "core": "02 疲劳恢复",
    "title": "风险不参与平均抵消",
    "question": "精神好但某处负重疼痛，是否继续高强度？",
    "guidance": "安全关切单列处理；说明不具备伤病诊断或回归许可，必要时转专业评估，不用良好睡眠或低RPE抵消局部问题。",
    "counterexample": "综合恢复分高就允许继续诱发性训练；机械要求两个解释而延误明显风险处理。",
    "expectedBehavior": "先处理风险和适用边界，再讨论不诱发的替代或暂停；不声称已确诊。",
    "evidenceRefs": [
      "FK5R1:S06",
      "FK5R1:S07"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:R06",
    "originalId": "R06",
    "core": "02 疲劳恢复",
    "title": "生活与补给也是解释变量",
    "question": "训练没变，为何反复恢复差？",
    "guidance": "主动检查倒班、通勤、心理压力、进食与补给、近期生病等背景；对持续异常支持运动医学/营养专业评估。",
    "counterexample": "所有疲惫归因训练量；凭一句吃得少就诊断REDs；用性别标签直接减量。",
    "expectedBehavior": "提出与生活约束有关的调整选项，敏感信息自愿提供；记录尚待核验而不自诊。",
    "evidenceRefs": [
      "FK5R1:S08",
      "FK5R1:S12"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:C01",
    "originalId": "C01",
    "core": "03 周期反馈",
    "title": "日历阶段不是生理事实",
    "question": "到了第四周就一定恢复了吗？",
    "guidance": "分别记录原本计划的阶段、实际执行和实际反应；阶段名称提供战略背景，不替代当日证据。",
    "counterexample": "每四周自动进入已恢复状态，或因“计划强化周”忽略持续异常。",
    "expectedBehavior": "说明本周原意、实际偏差和是否需要重估，而非机械翻页。",
    "evidenceRefs": [
      "FK5R1:S10",
      "FK5R1:S06"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:C02",
    "originalId": "C02",
    "core": "03 周期反馈",
    "title": "能分析自报数据，不冒充持久化事实",
    "question": "聊天给了5组成绩但没训练ID怎么办？",
    "guidance": "以本次消息为来源做算术与条件分析；缺少正式关联时不把它当已核准训练历史，但也不拒绝题面数值。",
    "counterexample": "没有trainingOccurrenceId就不计算均值；直接把自报数字写进正式档案。",
    "expectedBehavior": "标明“按你这次提供的数字”，准确完成用户要求并保留归属边界。",
    "evidenceRefs": [
      "FK5R1:S07"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:C03",
    "originalId": "C03",
    "core": "03 周期反馈",
    "title": "比较之前确认任务可比",
    "question": "末组变慢就证明能力下降吗？",
    "guidance": "先看恢复间隔、起跑方式、距离、天气和任务目的是否变化；相同距离不是相同实验条件。",
    "counterexample": "最后一组休息由5分钟改2分钟，仍把掉速全判为专项耐力下降。",
    "expectedBehavior": "计算可知偏差，列出主要混杂，再选择信息价值高且低风险的比较。",
    "evidenceRefs": [
      "FK5R1:S01",
      "FK5R1:S02",
      "FK5R1:S07"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:C04",
    "originalId": "C04",
    "core": "03 周期反馈",
    "title": "完成、适应、成绩分三层",
    "question": "全做完意味着训练有效吗？",
    "guidance": "完成度是执行指标，适应需后续可比表现，比赛结果还受情境影响；三者可以不同步。",
    "counterexample": "RPE更高、练得更多被自动写成能力提高；单场比赛失利抹掉全部训练价值。",
    "expectedBehavior": "分别给三层结论和需要的观察时点，避免用一个结果包办所有解释。",
    "evidenceRefs": [
      "FK5R1:S11",
      "FK5R1:S06"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:C05",
    "originalId": "C05",
    "core": "03 周期反馈",
    "title": "减量是情境决策，不是通用百分比",
    "question": "所有人赛前两周都减半吗？",
    "guidance": "使用项目相近的证据作为起点，再看原负荷、赛程和既往反应；保留质量不等于继续大量全力测试。",
    "counterexample": "耐力荟萃分析的分组结果直接成为100米或投掷统一模板。",
    "expectedBehavior": "解释可借鉴的方向和不能照搬的数字，给适合已知背景的候选结构。",
    "evidenceRefs": [
      "FK5R1:S09",
      "FK5R1:S01"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:C06",
    "originalId": "C06",
    "core": "03 周期反馈",
    "title": "不能提前宣布疲劳会带来超量恢复",
    "question": "强化后表现差，继续顶就一定提高吗？",
    "guidance": "恢复与后续表现尚未出现时只记录反应；既定训练意图不是其生理效果证明。",
    "counterexample": "把持续低恢复叫正常功能性超量而无后续证据；把所有短期累都诊断为过度训练。",
    "expectedBehavior": "提出跟踪和必要的调整/评估条件，不承诺疲劳必然兑换成绩。",
    "evidenceRefs": [
      "FK5R1:S06",
      "FK5R1:S10"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:A01",
    "originalId": "A01",
    "core": "04 AI协作",
    "title": "先问可研究的问题",
    "question": "知识不足时搜索什么？",
    "guidance": "写清人群、项目、目标结果、候选干预和时间范围，区分训练试验、描述性比赛研究与专家实践。",
    "counterexample": "泛搜“最佳400米计划”，然后挑一张最激进的课表。",
    "expectedBehavior": "得到有边界的研究问题和优先来源，而不是资料链接堆积。",
    "evidenceRefs": [
      "FK5R1:S16"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:A02",
    "originalId": "A02",
    "core": "04 AI协作",
    "title": "核对样本与版本",
    "question": "71次试跳说明什么？",
    "guidance": "逐一核对人、次数、设计、实际结局、在线年/卷期年和更正；读到摘要就标摘要，不伪装全文。",
    "counterexample": "把71次单人跳跃说成71名运动员；把出版年当检索截止年；忽略更正。",
    "expectedBehavior": "明确可支持的一句话与不可支持的推论；缺全文时保留待核查。",
    "evidenceRefs": [
      "FK5R1:S14",
      "FK5R1:S11",
      "FK5R1:S12",
      "FK5R1:S15"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:A03",
    "originalId": "A03",
    "core": "04 AI协作",
    "title": "来源正确不等于应用正确",
    "question": "论文有效果，就能开个人处方吗？",
    "guidance": "把研究原结论、教练应用推论和个人实际证据分开；核对结果变量是计时表现、经济性、力量还是问卷。",
    "counterexample": "有引用的训练表就自动判科学；从跑步经济性改善推导必然比赛达标。",
    "expectedBehavior": "为每个关键建议标明证据角色与适用差距，不让引用给猜测背书。",
    "evidenceRefs": [
      "FK5R1:S16",
      "FK5R1:S11"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:A04",
    "originalId": "A04",
    "core": "04 AI协作",
    "title": "外部反馈比AI相互赞同更重要",
    "question": "让多个AI都说对就够了吗？",
    "guidance": "数字用确定计算，研究用原始来源，开放决策用反例与独立专业审查；模型意见只能构成候选。",
    "counterexample": "三个模型投票把没有来源的配速建议投成事实；同一模型自评满分即通过。",
    "expectedBehavior": "交付可检查的依据摘要和分歧，不要求公开隐藏思考，不把共识次数当证据数量。",
    "evidenceRefs": [
      "FK5R1:S17",
      "FK5R1:S18"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:A05",
    "originalId": "A05",
    "core": "04 AI协作",
    "title": "补知识但不越过现实证据",
    "question": "模型知道很多，能替运动员补缺失成绩吗？",
    "guidance": "外部知识回答一般机制；个人当前成绩、症状、训练完成只能来自用户或明确授权记录。联网失败仍给可支持的部分。",
    "counterexample": "AI估出的HRV写成设备数据；没找到研究仍生成DOI；一断网所有基础能力失效。",
    "expectedBehavior": "显式区分检索结果、当前事实和未知；说明最小补充信息，不编造来源。",
    "evidenceRefs": [
      "FK5R1:S16",
      "FK5R1:S17"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:A06",
    "originalId": "A06",
    "core": "04 AI协作",
    "title": "学习必须包含撤回与修订",
    "question": "新研究或反例推翻旧结论时怎么办？",
    "guidance": "保留旧结论、原依据与被挑战的具体环节；修改适用范围或撤回，而非只增加一句例外；知识更新与个人学习分开。",
    "counterexample": "收录更多文章就叫已学会；已经公开题目的答案复述叫盲测通过。",
    "expectedBehavior": "提供修订理由、受影响建议、仍未知之处和需重新考核的情境。",
    "evidenceRefs": [
      "FK5R1:S18",
      "FK5R1:S16"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:D01",
    "originalId": "D01",
    "core": "05 动态调整",
    "title": "保持也是需要理由的决定",
    "question": "每次反馈都要改计划吗？",
    "guidance": "比较保持、局部调整与暂缓的收益/代价；一次普通波动且无冲突时，不为显示智能而改课。",
    "counterexample": "完成得很好立即加量；某一数字略差立即重写整周。",
    "expectedBehavior": "说明保持或调整的原因，以及下一条什么证据会触发重新判断。",
    "evidenceRefs": [
      "FK5R1:S07",
      "FK5R1:S10"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:D02",
    "originalId": "D02",
    "core": "05 动态调整",
    "title": "改变最关键的变量",
    "question": "间歇课质量下降，只有减一组吗？",
    "guidance": "先确认训练目的，再比较次数、间歇、速度目标、安排日期和技术复杂度的变更；尽量避免同时改变所有变量。",
    "counterexample": "不知道问题原因就同时提速、加组、缩短休息；给所有项目同一减量百分比。",
    "expectedBehavior": "提出最小充分改变及代价；条件不足时仅候选，不自动执行。",
    "evidenceRefs": [
      "FK5R1:S01",
      "FK5R1:S02"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:D03",
    "originalId": "D03",
    "core": "05 动态调整",
    "title": "看后续连锁影响",
    "question": "把今天质量课推到明天就完成调整了吗？",
    "guidance": "查看相邻跑步、力量、比赛与生活安排；调整的对象是后续可执行的训练过程，不只是今天方格。",
    "counterexample": "把高强度跑推迟一天却不检查翌日重力量与比赛。",
    "expectedBehavior": "同时解释哪节保留、哪节让位、哪些信息仍需要确认。",
    "evidenceRefs": [
      "FK5R1:S07",
      "FK5R1:S10"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:D04",
    "originalId": "D04",
    "core": "05 动态调整",
    "title": "漏课不是欠债",
    "question": "这周漏两次，周末全部补回来？",
    "guidance": "先保留当前阶段最有价值且可承受的任务，其余可以放弃或重排；尊重现实可用时间。",
    "counterexample": "把四天训练压成连续两天后宣布周量目标完成，所以安排合理。",
    "expectedBehavior": "给清晰取舍及目标影响，不用补课量补偿心理压力。",
    "evidenceRefs": [
      "FK5R1:S03",
      "FK5R1:S10",
      "FK5R1:S08"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:D05",
    "originalId": "D05",
    "core": "05 动态调整",
    "title": "个人规律是条件性的候选",
    "question": "三次48小时恢复好能否设固定恢复周期？",
    "guidance": "先确认同类任务、采集时间和口径；形成有条件的暂定预期，不设三次即稳定的万能阈值。反例出现时重新检查。",
    "counterexample": "三次200米课的反应无条件迁移到600米课，或新反例直接丢弃。",
    "expectedBehavior": "区分观测重复、规律假设和因果断言，允许降级及撤回。",
    "evidenceRefs": [
      "FK5R1:S07",
      "FK5R1:S06"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  },
  {
    "id": "FK5R1:D06",
    "originalId": "D06",
    "core": "05 动态调整",
    "title": "把建议变成可被推翻的预期",
    "question": "怎样知道刚才的调整有用？",
    "guidance": "事前写明拟改善的可观测量、保持不变的条件、复查时点和失败后的处理；检查结果而非只检查采纳率。",
    "counterexample": "调整后只问满意吗；任何结果都解释成原方案正确；编出未经校准的成功率。",
    "expectedBehavior": "输出证据摘要—候选行动—用户确认—观察结果—必要修订，不改写过去。",
    "evidenceRefs": [
      "FK5R1:S07",
      "FK5R1:S17",
      "FK5R1:S18"
    ],
    "authority": "AUTHOR_TEACHING_CANDIDATE",
    "prescriptionApproved": false
  }
];
export const TEACHING_SOURCES: readonly TeachingSource[] = [
  {
    "id": "FK5R1:S01",
    "title": "The Training and Development of Elite Sprint Performance: an Integration of Scientific and Best Practice Literature",
    "url": "https://link.springer.com/article/10.1186/s40798-019-0221-0",
    "doi": "10.1186/s40798-019-0221-0",
    "year": 2019,
    "design": "叙述性综述与高水平训练实践综合",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "短跑训练需要专项速度、技术与力量等配合；训练刺激不能只用跑段距离命名。",
    "limitations": "重点为高水平短跑尤其100米；训练实践不是适用于所有人、所有400米课表的剂量试验。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S02",
    "title": "Crossing the Golden Training Divide: The Science and Practice of Training World-Class 800- and 1500-m Runners",
    "url": "https://link.springer.com/article/10.1007/s40279-021-01481-2",
    "doi": "10.1007/s40279-021-01481-2",
    "year": 2021,
    "design": "叙述性科学与世界级运动员实践综合",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "800与1500训练侧重有差别；按整课目的和区间时间统计强度，会得到不同分布。",
    "limitations": "精英样本与实践资料有选择性；成绩组合不等于实测最大有氧速度或无氧速度储备，不能复制精英周量。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S03",
    "title": "The Training Characteristics of World-Class Distance Runners: An Integration of Scientific Literature and Results-Proven Practice",
    "url": "https://link.springer.com/article/10.1186/s40798-022-00438-7",
    "doi": "10.1186/s40798-022-00438-7",
    "year": 2022,
    "design": "叙述性科学与精英长跑实践综合",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "长跑准备需要区分比赛距离和赛季阶段，不能把5000米与马拉松视作同一任务。",
    "limitations": "描述优秀运动员的实践不证明初学者承受同等跑量后会取得同样效果。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S04",
    "title": "Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review",
    "url": "https://pubmed.ncbi.nlm.nih.gov/26423706/",
    "doi": "10.1136/bjsports-2015-094758",
    "year": "2016（在线2015）",
    "design": "系统综述",
    "reportedCheckDepth": "ABSTRACT_REPORTED",
    "reportedCheckDescription": "已核对论文摘要及书目信息；不宣称完成全文核验",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "主观健康与恢复报告能为训练反应监测提供有用信息。",
    "limitations": "不应把标题理解成所有情境中主观量表都胜过设备，也不能据量表单独诊断。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S05",
    "title": "Monitoring Athletic Training Status Through Autonomic Heart Rate Regulation: A Systematic Review and Meta-Analysis",
    "url": "https://link.springer.com/article/10.1007/s40279-016-0484-2",
    "doi": "10.1007/s40279-016-0484-2",
    "year": 2016,
    "design": "系统综述与荟萃分析",
    "reportedCheckDepth": "ABSTRACT_REPORTED",
    "reportedCheckDescription": "已核对论文摘要及书目信息；不宣称完成全文核验",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "自主神经心率指标的变化与表现关系并非简单的越高越好、越低越差。",
    "limitations": "主要为耐力训练研究；不能变成所有运动员当天训练许可的固定HRV阈值。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S06",
    "title": "Prevention, diagnosis, and treatment of the overtraining syndrome: joint consensus statement of the ECSS and the ACSM",
    "url": "https://pubmed.ncbi.nlm.nih.gov/23247672/",
    "doi": "10.1249/MSS.0b013e318279a10a",
    "year": 2013,
    "design": "联合专家共识",
    "reportedCheckDepth": "ABSTRACT_REPORTED",
    "reportedCheckDescription": "已核对论文摘要及书目信息；不宣称完成全文核验",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "持续表现下降需要综合评估；没有单一指标可以完成过度训练综合征诊断。",
    "limitations": "功能性超量恢复后的获益不能在疲劳刚出现时预先认定；医学鉴别需要专业人员。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S07",
    "title": "Monitoring Athlete Training Loads: Consensus Statement",
    "url": "https://pubmed.ncbi.nlm.nih.gov/28463642/",
    "doi": "10.1123/IJSPP.2017-0208",
    "year": 2017,
    "design": "训练负荷监测共识",
    "reportedCheckDepth": "ABSTRACT_REPORTED",
    "reportedCheckDescription": "已核对论文摘要及书目信息；不宣称完成全文核验",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "训练外部工作与运动员内部反应需要结合理解。",
    "limitations": "监测方法或总分不是精确损伤预测器，也不是所有项目刺激等价的证据。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S08",
    "title": "Sleep and the athlete: narrative review and 2021 expert consensus recommendations",
    "url": "https://bjsm.bmj.com/content/55/7/356",
    "doi": "10.1136/bjsports-2020-102025",
    "year": 2021,
    "design": "叙述性综述与专家共识",
    "reportedCheckDepth": "SEARCH_EXCERPT_REPORTED",
    "reportedCheckDescription": "已核对论文/出版方检索摘录及书目信息；全文核验待补",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "运动员睡眠应结合个人需要、训练与生活安排评估。",
    "limitations": "本轮未完成全文核读；不据此给每个人同一睡眠时长处方或自动恢复许可。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S09",
    "title": "Effects of tapering on performance in endurance athletes: A systematic review and meta-analysis",
    "url": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0282838",
    "doi": "10.1371/journal.pone.0282838",
    "year": 2023,
    "design": "系统综述与荟萃分析",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "耐力项目中减少训练量、适当保留强度的减量安排可改善比赛相关表现。",
    "limitations": "分组中的减量比例与天数不是所有专项的普适最优值；本轮不用未复核的效应量或置信区间。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S10",
    "title": "Periodization Theory: Confronting an Inconvenient Truth",
    "url": "https://link.springer.com/article/10.1007/s40279-017-0823-y",
    "doi": "10.1007/s40279-017-0823-y",
    "year": "2018（在线2017）",
    "design": "观点/理论批评文章",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "周期设计应重视个体、情境和不确定性，不能把日历结构等同已知生理反应。",
    "limitations": "这是观点文章，不是证明所有周期化方法无效的随机试验；本包周期治理规则为设计推论。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S11",
    "title": "The Effect of Strength Training Methods on Middle-Distance and Long-Distance Runners’ Athletic Performance: A Systematic Review with Meta-analysis",
    "url": "https://link.springer.com/article/10.1007/s40279-024-02018-z",
    "doi": "10.1007/s40279-024-02018-z",
    "year": 2024,
    "design": "系统综述与荟萃分析",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "38项研究、894名跑者；部分力量方法改善跑步表现，证据确定性为很低到中等。",
    "limitations": "研究检索截止2022年11月，不是2024年所有证据；不支持1RM增幅等比例换算比赛提升，不能直接用于伤者或低龄儿童。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S12",
    "title": "2023 International Olympic Committee’s (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs)",
    "url": "https://pubmed.ncbi.nlm.nih.gov/37752011/",
    "doi": "10.1136/bjsports-2023-106994",
    "year": 2023,
    "design": "IOC专家共识",
    "reportedCheckDepth": "SEARCH_EXCERPT_REPORTED",
    "reportedCheckDescription": "已核对论文/出版方检索摘录及书目信息；全文核验待补",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "低能量可用性相关健康和表现风险需要同时关注男性与女性运动员。",
    "limitations": "不以几项症状自行诊断。已检索到2024更正10.1136/bjsports-2023-106994corr1，但未核读更正细节，不复刻CAT2阈值。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S13",
    "title": "Changes in stride pattern of elite women's 400 metres hurdles from 2019 to 2022: an analysis by performance level",
    "url": "https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2025.1515441/full",
    "doi": "10.3389/fspor.2025.1515441",
    "year": 2025,
    "design": "精英女子比赛视频观察研究",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "研究分析255次比赛表现的栏间步数与节奏变化；包括同一运动员重复参赛。",
    "limitations": "255次表现不是255名独立运动员；观察相关不能证明强迫减少步数有效，也不能泛化到所有栏高、人群。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S14",
    "title": "Changes in long jump take-off technique with increasing run-up speed",
    "url": "https://pubmed.ncbi.nlm.nih.gov/16815784/",
    "doi": "10.1080/02640410500298040",
    "year": 2006,
    "design": "单名精英男子的重复试跳研究",
    "reportedCheckDepth": "SEARCH_EXCERPT_REPORTED",
    "reportedCheckDescription": "已核对论文/出版方检索摘录及书目信息；全文核验待补",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "71次试跳来自一名运动员，考察助跑速度与起跳变化。",
    "limitations": "不能误读为71名运动员；不提供所有人的最佳起跳角度或统一技术处方。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S15",
    "title": "Rotational shot put: a phase analysis of current kinematic knowledge",
    "url": "https://pubmed.ncbi.nlm.nih.gov/31368410/",
    "doi": "10.1080/14763141.2019.1636130",
    "year": "在线2019；卷期2022",
    "design": "旋转铅球运动学叙述性综述",
    "reportedCheckDepth": "SEARCH_EXCERPT_REPORTED",
    "reportedCheckDescription": "已核对论文/出版方检索摘录及书目信息；全文核验待补",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "可按动作阶段、动量传递和出手条件理解旋转铅球。",
    "limitations": "不能把旋转式文献直接当滑步式处方，也不支持以健身房力量单独预测投掷成绩。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S16",
    "title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    "url": "https://arxiv.org/abs/2005.11401",
    "doi": "arXiv:2005.11401",
    "year": "2020；修订2021",
    "design": "原始NLP方法研究",
    "reportedCheckDepth": "ABSTRACT_REPORTED",
    "reportedCheckDescription": "已核对论文摘要及书目信息；不宣称完成全文核验",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "检索的外部资料可以成为模型生成答案的输入。",
    "limitations": "检索成功不等于来源可靠或答案正确；论文不是运动训练有效性研究。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S17",
    "title": "ReAct: Synergizing Reasoning and Acting in Language Models",
    "url": "https://arxiv.org/abs/2210.03629",
    "doi": "arXiv:2210.03629",
    "year": "2022；修订2023",
    "design": "原始语言模型工具交互研究",
    "reportedCheckDepth": "ABSTRACT_REPORTED",
    "reportedCheckDescription": "已核对论文摘要及书目信息；不宣称完成全文核验",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "将推理与外部工具交互结合，是组织复杂任务的一种方法。",
    "limitations": "基准任务结果不是运动医学验证；本轮仅借鉴可核验工具反馈，不要求披露模型隐藏思考。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S18",
    "title": "Large Language Models Cannot Self-Correct Reasoning Yet",
    "url": "https://arxiv.org/abs/2310.01798",
    "doi": "arXiv:2310.01798",
    "year": "2023；修订2024",
    "design": "语言模型推理纠错实验研究",
    "reportedCheckDepth": "ABSTRACT_REPORTED",
    "reportedCheckDescription": "已核对论文摘要及书目信息；不宣称完成全文核验",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "所研究的模型与任务中，没有外部反馈的自我纠错并不可靠。",
    "limitations": "不能据旧模型研究断言所有2026模型均无法纠错；本包只据此要求外部证据与独立核查。",
    "independentlyReverifiedDuringImport": false
  },
  {
    "id": "FK5R1:S19",
    "title": "Session-RPE Method for Training Load Monitoring: Validity, Ecological Usefulness, and Influencing Factors",
    "url": "https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2017.00612/full",
    "doi": "10.3389/fnins.2017.00612",
    "year": 2017,
    "design": "方法学综述",
    "reportedCheckDepth": "BODY_EXCERPTS_REPORTED",
    "reportedCheckDescription": "已读取出版方HTML正文的相关段落；未逐一重做纳入研究、数据提取或统计分析",
    "reportedCheckedOn": "2026-10-11",
    "supportedClaim": "整课RPE乘整课分钟数是sRPE负荷表达，单位为任意单位；评分和采集方法要一致。",
    "limitations": "它不是疲劳百分比、损伤概率或组织负荷；不能把主段RPE、恢复评分、主段秒数替代整课输入。",
    "independentlyReverifiedDuringImport": false
  }
];
export const TEACHING_EXAMPLES: readonly TeachingExample[] = [
  {
    "id": "FK5R1:J01",
    "title": "400米训练掉速：先发现任务改变，再讨论能力",
    "scenario": "合成成年400米跑者，有同类训练经验。熟悉的课为3×200米，原目标29–30秒、间歇5分钟。当天29.2、29.6、31.3秒；前两段之间休5分钟，末段前因赶时间只休2分钟；整课RPE8，自述无局部疼痛。问：是不是专项耐力不行，下次要不要加一组？",
    "proposedResponse": "现在可以确认末段用时增加，不能确认专项耐力下降。当前不支持加一组。先核对次日反应与这节课的目的；在恢复和安全条件允许、运动员确认后，优先考虑保留原总量、恢复原定间歇的熟悉结构，而不是加组或再次缩短休息。若原目的就是短恢复密度训练，则按那个目的重新评价，不能拿长恢复标准判失败。",
    "changeCondition": "若核对发现所有间歇其实都是5分钟，应撤回“间歇改变”解释，检查其他因素；若出现新局部疼痛，则优先处理风险，不用复跑来验证假设。",
    "followup": "下一次可比条件下记录逐段时间、实际间歇、动作质量和次日反应；只有重复观察才讨论更稳定的能力限制，且不要求为研究额外安排高强度。",
    "ruleRefs": [
      "FK5R1:P03",
      "FK5R1:R01",
      "FK5R1:C02",
      "FK5R1:C03",
      "FK5R1:A04",
      "FK5R1:D02",
      "FK5R1:D06"
    ],
    "evidenceRefs": [
      "FK5R1:S01",
      "FK5R1:S02",
      "FK5R1:S07"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J02",
    "title": "同为800米2:08，两种能力组合",
    "scenario": "两个合成成年运动员近期800米都2:08。甲400米55秒、1500米4:50；乙400米60秒、1500米4:23。题面说明这些是近期、相近条件下的有效比赛结果，但没有最近训练分布。两人都准备六周后的800米比赛。",
    "proposedResponse": "不复制同一张课表，也不立刻给甲堆跑量、给乙堆冲刺。先看已有训练哪些刺激不足、哪些已过多；候选方向分别偏向检查耐力支持和速度支持，同时保留800米专项联系。第一周优先沿用各自熟悉且近期承受的训练框架，只改变最有依据的一项。",
    "changeCondition": "若乙400米比赛在生病或强逆风条件下，描述性画像需降级；若甲最近已经显著增加耐力训练且恢复差，不能继续按“耐力偏弱”追加。",
    "followup": "比较熟悉任务的执行质量、恢复和后续800米分段；新证据可改变当前侧重。不由现有时间计算虚假的MAS或ASR。",
    "ruleRefs": [
      "FK5R1:P01",
      "FK5R1:P02",
      "FK5R1:P06",
      "FK5R1:C04",
      "FK5R1:A03",
      "FK5R1:D01"
    ],
    "evidenceRefs": [
      "FK5R1:S02"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J03",
    "title": "5000米没变快，不等于力量训练无用",
    "scenario": "合成跑者六周内深蹲1RM由100kg到120kg；两次5000米从20:00到20:10。第二次更热、前晚睡得少，力量课安排也变化。用户问：继续加重量，还是把力量全删？",
    "proposedResponse": "暂不选择“继续加重”或“全部删除”的极端。保持熟悉且可承受的力量基础，先检查与关键跑课的相邻安排；用已有的可比跑步记录观察趋势。力量结果、跑步能力证据和比赛结果分开报告，不能承诺力量涨幅兑换配速。",
    "changeCondition": "若多次相近条件下跑步质量持续受影响，调整力量量、时点或方式的理由更充分；若跑步改善且恢复稳定，不应因为单场热天结果撤掉整个方向。",
    "followup": "事前记录要观察的是关键跑课质量与恢复，而非只看下一次1RM；不为了复核而立即加一场全力5000米。",
    "ruleRefs": [
      "FK5R1:P04",
      "FK5R1:R06",
      "FK5R1:C03",
      "FK5R1:C04",
      "FK5R1:A03",
      "FK5R1:D03"
    ],
    "evidenceRefs": [
      "FK5R1:S11",
      "FK5R1:S08"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J04",
    "title": "倒班半马跑者：删掉训练债，交付实际安排",
    "scenario": "合成有经验成年跑者，近期稳定32km/周：6、8、6、12km四次；12km轻松跑已多次完成且恢复正常。本周因倒班只有周六、周日可跑，自述目前无新症状，但周六睡眠尚未知。六周后半马，原定目标可协商。",
    "proposedResponse": "候选A：周六状态适宜时做熟悉的6km轻松跑；周日经恢复再确认，考虑熟悉范围内10–12km轻松长跑，不附加漏掉的间歇或公里数。候选B：周六明显缺眠或不适时不追补这次跑步，周日重新评估后缩短或取消长跑。其余错过内容本周放弃。这里的距离仅来自题面已知经验与保守候选，不适用于没有该基础的人。",
    "changeCondition": "若可用日变成周三与周日，可以重新比较分散任务，而不必沿用连续日安排；若出现局部疼痛则不能仅依据旧耐受继续。",
    "followup": "看两日执行、睡眠和下周恢复；若倒班成为长期约束，重新设定训练频率与比赛目标，不周周欠账。",
    "ruleRefs": [
      "FK5R1:P05",
      "FK5R1:R06",
      "FK5R1:C01",
      "FK5R1:D03",
      "FK5R1:D04",
      "FK5R1:D06"
    ],
    "evidenceRefs": [
      "FK5R1:S03",
      "FK5R1:S08",
      "FK5R1:S10"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J05",
    "title": "相反的HRV数字，不该得到机械相反的答案",
    "scenario": "合成甲今天HRV较个人近期记录高，但跑跳出现新的局部负重不适；合成乙只有单日HRV降低，自述精神与日常功能正常，今天原本只是熟悉的轻松活动。问两人是否都按手表分数走？",
    "proposedResponse": "甲先处理新症状和功能变化，暂不以高HRV支持诱发性高强度，必要时寻求专业评估。乙先核对测量与近几日背景，在没有新增风险的前提下可讨论原本熟悉、低要求活动的条件化选择，而不是单值强制休息。两人都不输出精确疲劳百分比。",
    "changeCondition": "乙若补充明显生病或局部疼痛，答案要改变；甲若专业评估和后续事实改变风险认识，也应更新，而不是永久禁训。",
    "followup": "记录症状、日常功能、任务反应与可比连续数据；医疗问题由适当专业人员处理。",
    "ruleRefs": [
      "FK5R1:R02",
      "FK5R1:R03",
      "FK5R1:R04",
      "FK5R1:R05",
      "FK5R1:A05",
      "FK5R1:D01"
    ],
    "evidenceRefs": [
      "FK5R1:S04",
      "FK5R1:S05",
      "FK5R1:S06"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J06",
    "title": "400米栏后程乱步：专项技术不该被平跑取代",
    "scenario": "合成成年400米栏运动员近期平跑400米变化不大，但最后三栏频繁换腿、节奏紊乱。只提供了总成绩，没有逐栏分段和视频。用户说：直接多跑300米能解决吗？",
    "proposedResponse": "先把最后几栏的步数变化、起跨位置、前程节奏与已有视频核对。候选方向可以是在专项教练指导下练熟悉、受控的节奏转换，也可以调整全程分配；“多跑300米”只是可能工具，不是默认答案。不从精英女子比赛观察中选一个固定步数强迫此人执行。",
    "changeCondition": "若视频显示节奏早在充分恢复时就不稳定，优先考虑技术组织；若只在特定负荷后出现，调整课次安排与任务难度的理由增加。",
    "followup": "用训练中已有的逐栏记录检验技术稳定性，不额外堆全速跨栏来凑证据。",
    "ruleRefs": [
      "FK5R1:P03",
      "FK5R1:P06",
      "FK5R1:C03",
      "FK5R1:A02",
      "FK5R1:A03",
      "FK5R1:D02"
    ],
    "evidenceRefs": [
      "FK5R1:S13",
      "FK5R1:S01"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J07",
    "title": "跳远跑快了却犯规增多：有效成绩优先",
    "scenario": "合成跳远运动员短跑测试提高，但最近两组六次试跳，踩板犯规分别从1/6到4/6。没有助跑标记和起跳视频。运动员问是不是不用再练速度？",
    "proposedResponse": "不能因此宣告速度无用。当前训练任务可优先检查助跑标记、落脚稳定和起跳组织，保留必要的速度基础；在指导下比较熟悉的受控助跑，不以增加最大强度跳跃次数来“练准”。参考单人71跳研究时明确样本是一个人，不生成普适起跳角度。",
    "changeCondition": "若有效跳的距离也持续变差，要扩大分析而非只盯犯规；若后续同条件尝试恢复稳定，则不应因本次小样本长期削弱速度训练。",
    "followup": "跟踪有效率、板前误差及有效跳结果，结合现有视频，不只看最远一跳或最快一次冲刺。",
    "ruleRefs": [
      "FK5R1:P04",
      "FK5R1:C03",
      "FK5R1:C04",
      "FK5R1:A02",
      "FK5R1:D02"
    ],
    "evidenceRefs": [
      "FK5R1:S14",
      "FK5R1:S01"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J08",
    "title": "铅球力量涨了，专项结果没涨",
    "scenario": "合成成年旋转式铅球运动员使用同规格器械，深蹲从105kg升120kg，近几次最好成绩仍约12m。视频没有经过技术教练分析。问应不应该再加一次大重量课？",
    "proposedResponse": "暂不依据重量增长自动追加重力量课。优先请专项教练观察已有视频和稳定试投，核对旋转节奏与出手组织，再比较维持力量、调整力量位置或增加低风险技术练习等方向。不给统一出手角，也不将旋转式文献当滑步式直接答案。",
    "changeCondition": "若阶段分析发现明确技术变化，可围绕它设观察任务；若后续证据说明力量暴露反而不足，也应允许推翻当前优先级。",
    "followup": "看同规格、相近条件下的有效试投分布和技术稳定，而非只看个人最好一投。",
    "ruleRefs": [
      "FK5R1:P04",
      "FK5R1:C04",
      "FK5R1:A03",
      "FK5R1:D01",
      "FK5R1:D02"
    ],
    "evidenceRefs": [
      "FK5R1:S15",
      "FK5R1:S07"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J09",
    "title": "AI检索到减量研究：能否套用100米？",
    "scenario": "合成100米跑者距比赛12天，问：网上AI引用耐力减量荟萃分析，说所有人应两周减量一半，再保持每天全力，照做吗？近期训练安排和症状没有完整提供。",
    "proposedResponse": "先核验论文结论实际支持什么：不批准“所有项目同一比例”和“每天全力”的跳跃推论。可讨论保留熟悉的速度质量、减少不必要疲劳任务的方向，再依近期总量、关键课位置、恢复及以往赛前反应确定具体安排。既不照抄，也不因为外推不成立就否认减量概念。",
    "changeCondition": "若换为与研究相近的耐力跑者，证据直接性提高，但仍需个体背景；若近期有伤病或明显恢复异常，不能靠减量论文做医学放行。",
    "followup": "观察熟悉速度任务的质量、恢复及比赛表现；当前只交付条件化候选，不声称找到了个人最优减量比例。",
    "ruleRefs": [
      "FK5R1:C05",
      "FK5R1:A01",
      "FK5R1:A02",
      "FK5R1:A03",
      "FK5R1:D01"
    ],
    "evidenceRefs": [
      "FK5R1:S09",
      "FK5R1:S01",
      "FK5R1:S16"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  },
  {
    "id": "FK5R1:J10",
    "title": "第四次反例：学会改变认识，而非为旧结论辩护",
    "scenario": "合成运动员三次200米重复课后48小时主观恢复分别7、8、7分，第四次同一量表3分，但第四次实际多一组、睡眠也更差。现想转练800米中的600米重复课。旧AI说：你固定48小时恢复好了，可以自动加量。",
    "proposedResponse": "撤回无条件的48小时恢复规则。保留更窄的描述：过去三次特定任务后自报恢复较好，但新条件下出现低恢复。不能凭这些记录给600米课自动加量；重新核对新任务目标、既往相关训练和当前状态，先讨论熟悉范围内的候选。",
    "changeCondition": "若第四条经用户核实为录入错误，保留更正链后重新解释；即便纠正，前三次也仍不足以证明跨任务的固定规律。",
    "followup": "为新的同类条件积累观察，同时保留不符合预期的记录；分别记录知识、个人假设、实际结果，不把新解释写成已证实病因。",
    "ruleRefs": [
      "FK5R1:R01",
      "FK5R1:C02",
      "FK5R1:C06",
      "FK5R1:A04",
      "FK5R1:A06",
      "FK5R1:D05",
      "FK5R1:D06"
    ],
    "evidenceRefs": [
      "FK5R1:S04",
      "FK5R1:S07",
      "FK5R1:S18",
      "FK5R1:S19"
    ],
    "dataOrigin": "SYNTHETIC_TEACHING",
    "eligibleForAthleteMemory": false
  }
];
