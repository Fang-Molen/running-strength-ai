/** Presentation only. Wire quotations and stored answers stay byte-for-byte intact. */
const categories:Record<string,string>={TRAINING:'跑步训练',STRENGTH:'力量训练',GOAL:'目标',PLAN:'计划',NUTRITION:'饮食',RECOVERY:'恢复',CAPABILITY:'能力',RESTRICTION:'限制',ANALYSIS:'本机分析',DIALOGUE:'近期对话'};
const labels:Record<string,string>={quality:'资料完整性',protocol:'测试协议',metric:'指标',measure:'反馈',value:'数值',statistic:'统计方式',temporalResolution:'时间覆盖',energyKind:'消耗类型',region:'部位',side:'侧别',elapsed:'训练后间隔',functionTask:'功能动作',observationProtocol:'观察协议',modality:'运动类型',observedType:'记录类型',actualDuration:'实测时长',sessionRpe:'整课用力感',segmentCount:'分段数',setCount:'组数',jumpContacts:'跳跃触地数',structure:'结构',round:'轮次',step:'段序',kind:'类型',distance:'距离',duration:'时长',restAfter:'随后休息',restScope:'休息位置',completion:'执行情况',surface:'场地',grade:'坡度',heartRate:'心率',heartRateMethod:'心率统计',setIndex:'第几组',exercise:'动作',load:'重量',loadBasis:'重量口径',reps:'次数',hold:'保持',setRpe:'本组用力感',rir:'剩余次数',eccentric:'离心时间',rangeProtocol:'动作范围',eventDistance:'目标距离',targetDuration:'目标时间',raceDate:'比赛日期',experience:'总体经验',runningExperience:'跑步经验',strengthExperience:'力量经验',priority:'优先目标',horizon:'周期长度',title:'课程',plannedMinutes:'计划时长',plannedDistance:'计划距离',intensity:'强度',executionState:'执行状态',actualOutcome:'实际反馈',weightKg:'体重',heightCm:'身高',age:'年龄',sex:'性别',goal:'目标',daysPerWeek:'每周次数',minutes:'可用时长',equipment:'器材',restriction:'现行限制',name:'食物',meal:'餐次',recordDay:'记录日期',portion:'份量',kcal:'已记热量',protein:'蛋白质',carb:'碳水',fat:'脂肪',fiber:'纤维',wholeDayComplete:'全天记录完整',meaning:'说明',formula:'计算方法',formulaVersion:'计算版本',certainty:'确定程度',review:'复核条件',reason:'原因',conditions:'适用条件',requiresConfirmation:'需要确认',medicalClearance:'医疗放行',dataQuality:'资料质量',missing:'缺少依据',inputsOmitted:'未展示输入数',speaker:'说话方',text:'对话内容'};
const values:Record<string,string>={UNKNOWN:'未知',AVAILABLE:'可用',PARTIAL:'不完整',RUN:'跑步',STRENGTH:'力量',INTERVAL:'间歇',CONTINUOUS:'持续',RUN_SEGMENT:'跑步分段',STRENGTH_SET:'力量组',REPETITION:'重复段',WORK:'工作段',REST:'休息段',AFTER_REPEAT:'每次重复后',BETWEEN_SETS:'组间',UNSPECIFIED:'未说明',COMPLETED:'已完成',PLANNED:'计划中',IN_PROGRESS:'执行中',INTERRUPTED:'中断',TOTAL_EXTERNAL:'外部总重量',PER_HAND:'单手重量',BILATERAL:'双侧',LEFT:'左侧',RIGHT:'右侧',EASY:'轻松',MODERATE:'中等',HARD:'高强度',TRAINED:'有该项经验',NOVICE:'该项新手',ANALYSIS_COVERAGE:'分析范围',MISSING:'资料缺失',COMPUTED:'代码计算',HYPOTHESIS:'待验证解释',OBSERVATION:'观察',CANDIDATE:'待确认候选',RUN_WORK_SECONDS:'跑步工作段总时长',RUN_WORK_DISTANCE_M:'跑步工作段总距离',true:'是',false:'否'};
export function displayCoachEvidence(text:string):{text:string;hasTechnicalOriginal:boolean}{
 const readable=text.replace(/用户申报\[([A-Z]+)；([^\]]+)\]：([\s\S]*?)；发生时间 ([^；]*)；记录时间 ([^；]*)；来源 ([^；]*)；修订 ([^；]*)；未经独立核验。/g,(raw,category:string,state:string,body:string,occurred:string,known:string,source:string)=>{
  if(!categories[category])return raw;
  const fields=body.split('；').flatMap(part=>{
   const at=part.indexOf('=');if(at<0)return [part];
   const key=part.slice(0,at),value=part.slice(at+1);
   return labels[key]?[`${labels[key]}：${values[value]??value}`]:[];
  });
  if(!fields.length)return raw;
  return `${categories[category]}（${state}）：${fields.join('；')}；发生于 ${occurred}；记录于 ${known}；来源 ${source.replace(/^USER_DECLARED:/,'')}，未经独立核验。`;
 });
 return {text:readable,hasTechnicalOriginal:readable!==text};
}
