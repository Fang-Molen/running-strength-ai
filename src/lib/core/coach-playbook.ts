import { rankPlaybook } from './coach-playbook-retrieval.ts'
import { PLAYBOOK_CONCEPTS } from './coach-playbook-concepts.ts'
/** User-supplied coaching handbook v1.0, adapted for R10. No network, model, storage or plan writes. */
export const PLAYBOOK_VERSION = 'FK-R11-COACH-PLAYBOOK-2' as const
export type EvidenceLevel = 'evidence' | 'consensus' | 'rule_of_thumb' | 'uncertain'
export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
 evidence:'研究证据', consensus:'机构共识', rule_of_thumb:'经验规则', uncertain:'证据不确定',
}
/** Reviewable defaults, not personal clearance or universal physiological thresholds. */
export const COACH_PLAYBOOK_POLICY = {
 maxQuestions:3, maxExamples:2, minimumComparableSessions:2, lateReportHours:24,
 intervalChangeNoticePercent:3, intervalEvennessNoticePercent:2,
 minorAgeYears:18, resistanceIncreasePercent:[2,10],
 singleRunDistanceNoticePercent:10, twoWeekVolumeNoticePercent:30,
 provenance:'用户手册的可审阅参数；手册提供，未独立复核。观察性阈值与经验阈值不能单独批准训练。',
} as const
export type PlaybookLesson = {id:string;title:string;terms:string[];level:EvidenceLevel;refs:number[];guidance:string;question:string;boundary:string}
const lesson=(id:string,title:string,terms:string[],level:EvidenceLevel,refs:number[],guidance:string,question:string,boundary:string):PlaybookLesson=>({id,title,terms,level,refs,guidance,question,boundary})
export const PLAYBOOK_LESSONS:readonly PlaybookLesson[]=[
 lesson('PB-RPE','整课主观强度与负荷',['rpe','主观用力','整课负荷','foster','au','整体有多累','整堂课','整课评分','训练负荷'],'evidence',[5],
  'RPE 是主观用力评分（0–10），整课评分与最后一组评分不同。session-RPE = 整课实际分钟 × 整课 RPE，单位为任意单位 AU；传统方法在结束后约30分钟询问。它不是组织负荷、疲劳百分比或伤病概率。',
  '评分针对整堂课还是某一组？这会决定能否与整课时长相乘。','时长必须覆盖整课；不能拿工作段时间之和冒充整课时长。超过24小时的回忆补录须标注，不单凭它进阶。'),
 lesson('PB-INTERVAL','重复跑与间歇复盘',['间歇','重复跑','掉速','掉得','最后两组','最后一组','组间','恢复间隔'],'rule_of_thumb',[16],
  '先看同课次、同轮次、同距离和记录方法的实际用时；均匀、加快或掉速是观察，不是能力与疲劳的诊断。末组快可能是留余量，也可能只是冲刺；掉速可能与起跑过快、恢复或当天状态有关。',
  '末组变化是原计划要求还是临场用力改变？计划内变化与偏离计划应分别评价。','缩短恢复也是增加密度；先核对同类课完成、当前睡眠/症状、目标与恢复，不能把“先缩恢复”写成通用进阶路线。'),
 lesson('PB-LOAD','跑量变化与长期负荷',['跑量','长距离','长跑','acwr','10%','负荷比','最长一次','最长单次','周跑','周末','比上周','公里拉到'],'uncertain',[3,4,6,9,10],
  '单次距离相对近30天最长单次的变化、周跑量变化与ACWR是不同指标。单次跳升研究是观察性关联；每周10%不是已证实的安全线，ACWR不能单独预测伤病或决定加量。',
  '近30天记录是否完整，最长单次实际距离是多少？不完整时只能说“已记录最长”，不能当个人上限。','缺课不能补为零。没有完整、同口径窗口，不计算周趋势或ACWR；不由一个百分比直接给个人新跑量。'),
 lesson('PB-SLEEP','睡眠与恢复',['睡眠','睡了','只睡','恢复感','疲劳','腿沉'],'consensus',[18],
  '把睡眠与本人平时水平、白天精神和训练反应一起看；一次短睡眠或高RPE不能确诊过度训练。已选训练当时的睡眠不等于当前恢复。',
  '最近睡眠相对平时怎样，白天精神或热身反应有变化吗？明显变差时暂缓强度，正常也不自动批准加量。','缺恢复时先保持调整决定，保持不等于无条件照做原高强度；长期影响生活的睡眠问题建议专业评估。'),
 lesson('PB-PAIN','酸痛、疼痛与功能',['疼痛','酸痛','晨僵','骨头','跛行','跑姿','刺痛','锐痛','一按就痛','压痛','小腿痛','膝盖','外侧痛','肿胀'],'rule_of_thumb',[17],
  '先区分弥散肌肉酸痛与局部锐痛、骨点压痛、肿胀、夜间痛和功能变化。疼痛加重、跑姿改变或日常活动受影响时停止诱发动作并寻求评估。',
  '痛在什么部位、什么性质、何时开始且是否加重？这比只报一个分数更能改变处理。','低疼痛分数不等于获准训练；跟腱康复疼痛模型不能直接推广到未诊断疼痛或所有部位。'),
 lesson('PB-HEART','心率与设备口径',['心率','胸带','腕表心率','手表心率','光电','hrv','rhr'],'evidence',[27],
  '先核对腕式或胸带、平均或最高、分段时间窗及佩戴。短间歇的平均心率包含爬升阶段；快配速与低心率并不能单独证明效率改善，也不能只凭矛盾认定手表错误。',
  '这些数值来自同一设备和同一种统计口径吗？同步对照可区分测量差异与实际反应。','没有显式来源和方法，只讨论可能性；不同设备、时刻、方法的HRV/RHR不能混成趋势。'),
 lesson('PB-GPS','跑道距离与GPS',['gps','跑道','圈数','距离误差','测距','手表距离','手表显示','公里算','距离总是'],'evidence',[26],
  '手表测距存在误差，但研究平均误差不是每条记录的置信区间。只有本人确认标准跑道、道次与实际圈数后，才能提出按已知距离重算。',
  '实际跑的是哪一道、多少圈，还是依手表到点停止？答案会决定使用哪种距离。','不得把0.99公里自动改成1000米；先展示两种条件解释，更正须经正式记录路径。'),
 lesson('PB-STRENGTH','力量实际组与RIR',['力量','深蹲','卧推','硬拉','rir','加重量','1rm'],'consensus',[19,23,24],
  'RIR 表示还能规范完成几次；动作变形不算可用余量。用实际重量、次数、动作质量与重复课次判断，不能由跑步整课RPE推单组RIR。对能规范超过目标次数的人，ACSM给出2–10%的进阶范围；不是人人自动加重量。',
  '同一动作最近同类课的完成次数、动作质量和剩余次数是否一致？若只是估计或动作变形，先维持并核对。','重量×次数仅为记录量；不由总量判断动作质量，不替新手改填RIR，不从一次组量计算个人1RM。'),
 lesson('PB-CONCURRENT','跑步与力量安排',['跑步加力量','跑步+力量','先跑','先练','力量课放','排期','同一天'],'evidence',[25],
  '有氧与力量的安排取决于主项目、恢复和动作目标。研究对爆发力的影响与同堂安排有关；间隔至少3小时是研究分组信息，不是每个人的保证。',
  '本阶段优先跑步表现还是力量，哪些日期可训练？先调整排期，保留剂量以观察影响。','“硬课放同一天”是经验排法；不能为凑模板把高负荷集中，也不能同时改排期和总量。'),
 lesson('PB-YOUTH','青少年力量与跑步',['未成年','青少年','孩子','初中生','小学生','中学生','儿子','女儿'],'consensus',[14,15],
  '支持青少年力量训练，优先技术学习、逐步负荷和合格教练监督。训练经验、动作能力和成熟度比单看年龄更重要。',
  '是否有合格教练监督、已学会哪些动作？没有监督时先联系教练与监护人，不远程指导极限测试。','不套成人最大力量或快速加量模板，不因模板含年龄就假定用户是未成年人。'),
 lesson('PB-ILLNESS','生病与回归',['发热','发烧','感冒','鼻塞','病后','生病','退烧'],'consensus',[20],
  '发热或急性全身症状期间暂停训练。症状消失后根据功能与反应逐步恢复；轻微“颈部以上”症状可活动的说法证据有限，不等于可以做强度课。',
  '是否仍发热、明显乏力或胸部症状，日常活动如何？有胸痛、晕厥等先就医，不用补课追进度。','不提供固定病愈天数或清除许可，不用未核实的病名解释症状。'),
 lesson('PB-HEAT','高温与热应激',['高温','热天','气温','湿度','wbgt','热适应','中暑','大太阳','烈日','夏天','中午跑','暴晒'],'consensus',[21,22],
  'WBGT 是综合湿球、黑球与气温的热应激指标，手机气温不等于WBGT。热环境可升高同配速心率；选择更凉时段或室内，降低暴露，避免硬追配速。',
  '有没有可靠的WBGT、日晒风速与热适应信息？没有时先调整环境，不伪造温度估算。','意识混乱、抽搐或倒下需急救并迅速降温；安全撤退可同时改变多个训练参数，不受单变量实验约束。'),
 lesson('PB-ENERGY','能量不足线索',['red-s','reds','月经','闭经','晨勃','性欲','节食','减重','骨应力','减脂','每天只吃','吃1200','摄入不足'],'consensus',[8],
  '月经变化、反复骨应力问题、明显体重下降与持续疲劳等组合线索值得专业评估；男女都可能受影响，不能由体重或热量差诊断RED-S。',
  '这些变化持续多久、是否影响生活或伴反复伤病？如存在，先不加量，建议运动医学及营养评估。','不道德评判体重与饮食，不提供极端节食、药物或治疗性补剂剂量；尊重用户不回答敏感问题的选择。'),
 lesson('PB-STRIDES','放松加速跑',['加速跑','strides','课后','放松跑','短冲刺'],'rule_of_thumb',[2],
  '放松加速跑用于练习动作与神经刺激，逐渐加快而不冲到极限，充分恢复后再做。常见短段秒数属于经验范围，不是个人必做剂量。',
  '目的是动作练习还是测试成绩，有无疼痛和冲刺经验？二者不能用同一种强度要求。','与间歇主课分开描述，但仍应计入总运动距离与机械暴露，不能把加速跑当成没有负荷。'),
]
const refNames:Record<number,string>={2:'Daniels, Running Formula 4th ed.',3:'Gabbett 2016',4:'Impellizzeri 2020',5:'Foster 2001',6:'IOC load consensus 2016',8:'IOC REDs consensus/CAT2 2023',9:'Frandsen 2025 跑者队列',10:'Nielsen 2014 新手跑者队列',14:'NSCA youth resistance 2009',15:'Youth resistance consensus 2014',16:'Buchheit & Laursen 2013',17:'Silbernagel 2007 跟腱康复研究',18:'Walsh sleep consensus 2021',19:'ACSM resistance progression 2009',20:'ESC sports cardiology 2020',21:'ACSM heat illness 2023',22:'ACSM heat illness 2007',23:'Zourdos RIR 2016',24:'Blagrove 2018 跑者力量综述',25:'Schumann concurrent training 2022',26:'Gilgen-Ammann GPS 2020',27:'Wang wrist HR 2017'}
export function selectPlaybookLessons(question:string,limit=3):PlaybookLesson[]{
 return rankPlaybook(question,PLAYBOOK_LESSONS).slice(0,Math.max(0,Math.min(4,limit))).map(r=>PLAYBOOK_LESSONS.find(l=>l.id===r.id)!)
}
export function buildPlaybookContext(question:string){
 const selected=selectPlaybookLessons(question)
 const context={version:PLAYBOOK_VERSION,role:'GENERAL_COACHING_REFERENCE_NOT_ATHLETE_FACT',verified:'手册提供，未独立复核',decisionAuthorization:false,truncated:false,tokenUpperBound:0,
  lessons:selected.map(l=>({id:l.id,title:l.title,level:l.level,guidance:l.guidance,question:l.question,boundary:l.boundary})),
  references:[...new Set(selected.flatMap(l=>l.refs))].map(id=>({id,name:refNames[id],verification:'手册提供，未独立复核'}))}
 // UTF-8 bytes are a conservative token upper bound for byte-based model tokenizers.
 const size=()=>new TextEncoder().encode(JSON.stringify(context)).length
 while(size()>1200&&context.references.length){context.references.pop();context.truncated=true}
 for(const field of ['boundary','question','guidance'] as const)while(size()>1200&&context.lessons.some(l=>l[field].length>12)){
  const lesson=[...context.lessons].reverse().find(l=>l[field].length>12)!
  lesson[field]=lesson[field].slice(0,Math.max(12,lesson[field].length-16));context.truncated=true
 }
 while(size()>1180&&context.lessons.length>1){context.lessons.pop();context.truncated=true}
 context.tokenUpperBound=size()+4
 return context
}
export function localPlaybookLesson(question:string):{text:string;sourceIds:string[]}|null{
 if(!/什么|意思|解释|区别|怎么算|如何理解|原理|原则|科普|定义/.test(question)||/这次|今天|下次|明天|昨天|上次|我(?:的|想|能|要|该|填|跑|练)|记录/.test(question))return null
 const lessons=selectPlaybookLessons(question,2);if(!lessons.length)return null
 return {text:lessons.map(l=>`${l.title}：${l.guidance}\n${l.boundary}\n依据：${EVIDENCE_LABELS[l.level]}；${l.refs.map(n=>refNames[n]).join('、')}（手册提供，未独立复核）。`).join('\n'),sourceIds:lessons.map(l=>l.id)}
}
export const PLAYBOOK_SYSTEM_BOUNDARY = `\n方坤好教练手册：参考coachPlaybook的通用知识与coachingReview的可核实观察，不把示范句、研究数字或阈值当作运动员事实。正文通常简短，按事实→竞争解释→最关键缺项组织；只有完整训练分析需要两种有区分性的解释，每种说明支持和“若什么出现则不支持”。单纯算数、知识解释、冲突核对及急症不要硬凑解释。只问1—3个会改变决定的问题，并写答案不同怎样改变下一步；已知的RPE不重复询问。参考证据分级，经验范围明确标注，研究人群/口径不符时不外推。研究标签不是已核验原文或个人处方。保持/减量也须说明可核实原值，数据缺失时不编新剂量；保持是暂缓调整，不是照常做高强度的安全许可。进阶可以讨论条件与小幅候选，不等于已批准执行；须说明同类课表现、动作质量、当前状态等适用前提，单次末组加速不够。建议写在sections.suggestion或nextStep，优先一个变量，尽量写原值→新值、适用条件、停止条件与次日复查；排期、技术练习、减量或安全撤退不强制数字模板；其余参数“保持不变”不算新增变量。安全停训/就医可同时撤下所有危险暴露。缺原值时可给标明通用范围的条件建议并提问，不把假设写成已有事实。ACWR、10%经验线、短睡眠和RIR映射不单独发放训练许可。GPS距离须确认场地/道次/圈数后正式更正，不能自动改。手机气温湿度不能伪造WBGT。RIR是还能规范完成的次数，不能用跑步整课RPE换算。药物、治疗性补剂、极端节食和无人监督的未成年人极限测试不提供。知识引用在正文注明，citations仍只填个人事实sourceId。`

/** A structural review, not semantic certification. Missing structure is advisory; never deletes an otherwise useful candidate. */
export function coachingSuggestionIssues(variable:string,change:string):string[]{
 if(!change.trim())return []
 const issues:string[]=[]
 const variables:[string,RegExp][]=[['sets',/组数|总组/],['reps',/次数|重复次数/],['weight',/重量|负重/],['distance',/距离|单组米数/],['pace',/配速|速度/],['rest',/组间|轮间|休息|恢复间隔|恢复时长/],['duration',/持续时间|跑步时长|单组时长/],['effort',/强度|RIR|保留次数/i]]
 const named=variables.filter(([,re])=>re.test(variable)).map(([id])=>id)
 if(variable.trim()==='恢复')named.push('rest')
 if(!variable.trim())issues.push('SUGGESTION_VARIABLE_MISSING')
 if(named.length!==1)issues.push('SUGGESTION_VARIABLE_UNCLEAR')
 const transition=/(?:\d[\d.:：]*(?:\s*(?:kg|公斤|秒|分|分钟|米|公里|组|次|\/km|%))?\s*(?:→|->|到|至)\s*\d)|(?:从\s*\d.{0,24}(?:到|至|改为|缩短为|增加为)\s*\d)/i
 if(!transition.test(change))issues.push('SUGGESTION_BEFORE_AFTER_MISSING')
 const changed=new Set<string>()
 for(const clause of change.split(/[，,；;。\n]/))if(transition.test(clause)){
  for(const [id,re] of variables)if(re.test(clause))changed.add(id)
 }
 if(/多跑.{0,3}组|增加.{0,3}组/.test(change))changed.add('sets')
 if(/配速.{0,6}(?:提快|加快)|提速/.test(change))changed.add('pace')
 if(changed.size>1 || (named.length===1&&[...changed].some(id=>id!==named[0])))issues.push('MULTI_VARIABLE_SUGGESTION_REVIEW')
 if(!/仅在|前提|条件|若|如果|确认.{0,12}后|核对.{0,12}后/.test(change))issues.push('SUGGESTION_CONDITION_MISSING')
 if(!/停止|停训|终止|退回|撤回|结束/.test(change))issues.push('SUGGESTION_STOP_MISSING')
 if(!/次日|第二天|24\s*(?:h|小时)|48\s*(?:h|小时)|复查|复核|反馈/i.test(change))issues.push('SUGGESTION_FOLLOWUP_MISSING')
 return issues
}

/** Explicit self-reported age only; no age guessing from performance or a teaching scenario. */
export function localPlaybookBoundary(question:string):{text:string;sourceIds:string[]}|null{
 if(/假如|假设|举例|范例|以前|当年/.test(question))return null
 if(/跟腱|腘绳肌|骨伤|伤后|康复/.test(question)&&/不痛|无痛|全速|冲刺|恢复训练|回归/.test(question))return {
  text:'不痛不等于已经可以全速跑。先核对原伤病评估、日常功能、力量与逐级专项暴露，必要时由运动医学或康复人员评估；不要直接用一次无痛反应恢复高速训练。下一步先记录低风险日常活动的功能和次日反应，有疼痛或功能下降就停止诱发活动。',sourceIds:['PB-PAIN']}
 const age=question.match(/(?<!\d)(\d{1,2})\s*岁/)
 const minor=age&&Number(age[1])<COACH_PLAYBOOK_POLICY.minorAgeYears&&Number(age[1])>0 || /我是未成年|我还未成年|初中生|小学生/.test(question)
 if(minor&&/成年|成人|冠军|精英|照搬/.test(question))return {
  text:'青少年不直接照搬成人冠军的训练剂量。先由监护人与合格教练核对成熟度、训练经验、动作能力、体验和可用资源，再讨论适合当前基础的安排；不以年龄或成绩单独批准极限训练。',sourceIds:['PB-YOUTH']}
 if(minor&&/1RM|极限(?:测试|重量)|最大重量|测.{0,4}极限/i.test(question))return {
  text:'可以学习力量训练，但方坤不远程指导未成年人做极限测试或冲最大重量。先联系合格教练与监护人，在监督下学习动作、核对训练经验，再安排逐步训练；不直接套用成人重量和进阶模板。依据：青少年力量训练共识；远程不指导极限测试是本产品的保护边界。',sourceIds:['PB-YOUTH']}
 return null
}
