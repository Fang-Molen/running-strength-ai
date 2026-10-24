import type { Applicability, ModelInput } from './types'
import { assessPhysiology } from './physiology'
import { reviewDistribution } from './distribution'
import { canonical } from './source'
const day=(at:string,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))
export function selectTrainingModels(input:ModelInput){
 const physiology=assessPhysiology(input),distribution=reviewDistribution(input),p=input.profile
 const bound=canonical(input.context)===canonical(input.snapshot.context)&&(!input.recovery||input.recovery.snapshotId===input.snapshot.snapshotId)
 const holds=!bound||input.snapshot.safetyConstraints.length>0||input.recovery?.safetyState==='HOLD_ACTIVE'||input.recovery?.safetyState==='ESCALATION_REQUIRED'
 const unknownSafety=!input.recovery||input.recovery.safetyState==='UNKNOWN'
 const short=p.eventMeters!==null&&p.eventMeters<=800
 const daysToRace=p.raceDate&&/^\d{4}-\d\d-\d\d$/.test(p.raceDate)?(Date.parse(p.raceDate+'T00:00:00Z')-Date.parse(day(input.context.asOf,input.context.timeZone)+'T00:00:00Z'))/86400000:null
 const imminent=daysToRace!==null&&daysToRace>=0&&daysToRace<=7
 const thresholds=!!(physiology.thresholds.speed||physiology.thresholds.heartRate)
 const profileKnown=!!p.sourceRefs.length&&p.eventMeters!==null&&Number.isFinite(p.eventMeters)&&p.eventMeters>0&&p.phase!=='UNKNOWN'
 const methods:Applicability[]=[]
 for(const method of ['PYRAMIDAL','POLARIZED'] as const){
  const missing=[...(!thresholds?['同测试、同口径的实测阈值分区']:[]),...(!profileKnown?['目标项目和当前训练阶段']:[])]
  const status=holds?'HOLD':unknownSafety||missing.length?'INSUFFICIENT':short||imminent||p.phase==='TAPER'?'CONDITIONAL':'CONSIDER'
  methods.push({method,status,missing,evidenceIds:['TID-SEILER-2006','TID-FILIPAS-2022'],reasons:[method==='PYRAMIDAL'?'可作为低强度为主、适量中高强度的阶段候选。':'可作为低强度为主、部分高强度的阶段候选。','研究没有给出按运动水平自动二选一的通用规则。',...(short?['400/800需保留速度、专项耐力与力量优先级，耐力分布证据不能直接外推。']:[]),...(imminent?['临近比赛保留熟悉刺激，不在本轮引入新的分布训练。']:[])]})
 }
 const doubleMissing=[...(!thresholds?['个体实测阈值']:[]),...(['doubleThresholdExperience','lactateMonitoring','coachSupervision','twoSessionsAvailable'] as const).filter(k=>p[k]!==true).map(k=>({doubleThresholdExperience:'既有双课耐受记录',lactateMonitoring:'乳酸与主观负荷监测条件',coachSupervision:'教练复核',twoSessionsAvailable:'两课时间及课间恢复条件'}[k]))]
 methods.push({method:'DOUBLE_THRESHOLD',status:holds?'HOLD':p.experience==='NOVICE'?'NOT_APPLICABLE':unknownSafety||doubleMissing.length||!profileKnown?'INSUFFICIENT':'CONDITIONAL',missing:doubleMissing,evidenceIds:['DOUBLE-TALSNES-2024'],reasons:['双阈值为同日安排方式，可同时呈现金字塔或极化分布。','已有小样本急性实验，不能据此承诺长期提高成绩或降低伤病。','不自动增加第二课，不复制研究中的阈值、周跑量或课间小时数。']})
 const eventRaces=physiology.eventProfile.races.filter(r=>r.distanceM===p.eventMeters)
 methods.push({method:'EVENT_SPECIFIC',status:holds?'HOLD':unknownSafety||!profileKnown?'INSUFFICIENT':eventRaces.length?'CONSIDER':'CONDITIONAL',missing:eventRaces.length?[]:['近期同协议专项比赛/连续测试及分段'],evidenceIds:['EVENT-SPENCER-2001','INTERVAL-BUCHHEIT-2013'],reasons:['围绕已声明专项比较实测比赛速度、重复质量及恢复；不同距离不相互充当精确预测。','缺速度、恢复、分段或既有耐受记录时不生成新的高强度剂量。']})
 const notes=[...(!bound?['上下文/恢复版本不匹配，必须重新读取。']:[]),...(holds?['已有安全限制，模型选择不能解除限制。']:[]),...(unknownSafety?['当前安全状态未核定，不输出可执行训练建议。']:[]),...(imminent?['比赛临近：7日为产品保守复核窗口，不是统一生理减量规则。']:[])]
 for(const s of input.sessions)if(s.purpose==='STRENGTH'&&input.sessions.some(r=>r.date===s.date&&['SPEED','RACE_PACE','VO2'].includes(r.purpose)))notes.push('同日力量与关键跑步课需核对先后、间隔和目的；不以固定小时数保证恢复。')
 return {version:'FK_TRAINING_MODELS_1' as const,physiology,distribution,methods,preferredMethod:null,
 allowTrainingCandidates:!holds&&!unknownSafety,notes,daysToRace,imminentRace:imminent,
 factsUsed:[...physiology.thresholds.allPairs.flatMap(t=>t.refs),...physiology.eventProfile.races.map(r=>r.ref),...distribution.refs],scientificallyValidated:false,planWritten:false}
}
