/** V89 deterministic global task coordinator. No plan, health, or training writes. */
export type Domain = 'TRAINING'|'HEALTH'|'NUTRITION'|'SCHEDULE'|'FEEDBACK';
export type Availability = 'AVAILABLE'|'MISSING'|'STALE'|'CONFLICT'|'ERROR';
export type Evidence = {id:string;athleteId:string;domain:Domain;availability:Availability;revision:string;observedAt:string|null;knownAt:string|null;summary:string};
export type TrainingPart = {id:string;kind:'RUN'|'STRENGTH';status:'NOT_STARTED'|'ACTIVE'|'COMPLETED'|'PARTIAL'|'MOVED';scheduledDate:string;feedback:'COMPLETE'|'PENDING'|'NOT_REQUIRED'};
export type GlobalInput = {athleteId:string;today:string;readState:'READY'|'PARTIAL'|'FAILED';facts:readonly Evidence[];parts:readonly TrainingPart[];correctionRequests?:readonly {id:string;targetFactId:string|null;note:string}[];staleClaimIds?:readonly string[];pendingProposalIds?:readonly string[];dismissedTaskIds?:readonly string[]};
export type TaskKind = 'VERIFY_SOURCE'|'REVIEW_CORRECTION'|'REVIEW_OLD_CLAIM'|'FILL_FEEDBACK'|'REVIEW_SCHEDULE'|'CONFIRM_PROPOSAL';
export type Task = {id:string;kind:TaskKind;priority:1|2|3;target:'today'|'log'|'body'|'plan'|'coach';title:string;detail:string;evidenceIds:string[];changesRecords:false};
export type GlobalResult = {state:'READY'|'PARTIAL'|'UNAVAILABLE';tasks:Task[];warnings:string[];canAutoModifyPlan:false};
const validDay=(v:string)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const make=(id:string,kind:TaskKind,priority:1|2|3,target:Task['target'],title:string,detail:string,evidenceIds:string[]=[]):Task=>({id,kind,priority,target,title,detail,evidenceIds,changesRecords:false});
export function coordinateGlobal(input:GlobalInput):GlobalResult {
 if(!input.athleteId.trim()||!validDay(input.today)||input.readState==='FAILED')return {state:'UNAVAILABLE',tasks:[],warnings:['数据读取未完成，不能据此认定没有训练或身体正常。'],canAutoModifyPlan:false};
 const tasks:Task[]=[],warnings:string[]=[];const owned=input.facts.filter(f=>f.athleteId===input.athleteId);
 if(owned.length!==input.facts.length)warnings.push('其他运动员数据已隔离，不参与判断。');
 for(const f of owned)if(f.availability==='CONFLICT'||f.availability==='ERROR')tasks.push(make(`source:${f.id}:${f.revision}`,'VERIFY_SOURCE',1,f.domain==='HEALTH'?'body':f.domain==='SCHEDULE'?'plan':'log','核对数据来源',`${f.summary}；冲突或读取失败不等于正常。`,[f.id]));
 const ownedIds=new Set(owned.map(f=>f.id));
 for(const c of input.correctionRequests??[])if(c.id)tasks.push(make(`correction:${c.id}`,'REVIEW_CORRECTION',1,'coach','核对你纠正的事实',c.targetFactId&&ownedIds.has(c.targetFactId)?'先核对原始记录和版本，再重新判断相关结论。':'尚未定位对应的原始记录，旧说法不能继续作为已确认依据。',c.targetFactId&&ownedIds.has(c.targetFactId)?[c.targetFactId]:[]));
 for(const id of new Set(input.staleClaimIds??[]))if(id)tasks.push(make(`claim:${id}`,'REVIEW_OLD_CLAIM',1,'coach','复核旧判断','相关证据改变；重新取证，不直接认定旧建议一定错误。'));
 for(const p of input.parts){if(!p.id||!validDay(p.scheduledDate))continue;
  if((p.status==='COMPLETED'||p.status==='PARTIAL')&&p.feedback==='PENDING')tasks.push(make(`feedback:${p.id}`,'FILL_FEEDBACK',2,'log',`${p.kind==='RUN'?'跑步':'力量'}待补主观反馈`,'客观记录保留，只补RPE、疼痛或完成差异。'));
  if(p.status==='MOVED'&&p.scheduledDate===input.today)tasks.push(make(`schedule:${p.id}`,'REVIEW_SCHEDULE',2,'plan','核对改期后的执行安排','原始课表保留，当前有效日期只能有一个待执行位置。'));
 }
 for(const id of new Set(input.pendingProposalIds??[]))if(id)tasks.push(make(`proposal:${id}`,'CONFIRM_PROPOSAL',3,'plan','待确认训练调整','预览差异和冲突，确认前不改课。'));
 if(input.readState==='PARTIAL')warnings.push('部分模块未完整读取，结论仅覆盖已确认数据。');
 if(owned.some(f=>f.availability==='MISSING'||f.availability==='STALE'))warnings.push('存在缺失或旧数据，未记录不等于未发生。');
 const unique=new Map(tasks.map(t=>[t.id,t]));const dismissed=new Set(input.dismissedTaskIds??[]);
 // Conflicted, missing or foreign inputs cannot certify a complete read.
 return {state:input.readState==='READY'&&owned.length===input.facts.length&&owned.every(f=>f.availability==='AVAILABLE')?'READY':'PARTIAL',tasks:[...unique.values()].filter(t=>t.priority===1||!dismissed.has(t.id)).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id)),warnings,canAutoModifyPlan:false};
}
/** Restrict each answer to the current task, unless an independently verified safety hold applies. */
export function relevantDomains(question:string,explicitSafetyHold:boolean):Domain[]{
 if(explicitSafetyHold)return ['HEALTH','TRAINING','SCHEDULE'];
 if(/增重|增肌|饮食|热量|蛋白|碳水|吃/.test(question))return ['NUTRITION','TRAINING'];
 if(/改期|挪到|安排|计划|明天练/.test(question))return ['SCHEDULE','TRAINING'];
 if(/睡眠|午睡|心率|HRV|疲劳|恢复|疼痛/.test(question))return ['HEALTH','TRAINING'];
 if(/成绩|分段|间歇|力量|配速|跑步/.test(question))return ['TRAINING'];return [];
}
/** The host still owns identity, transaction, persistence and rollback. */
export type PlanGuard={actorAthleteId:string;proposalAthleteId:string;explicitlyConfirmed:boolean;expectedRevision:string;currentRevision:string;calendarCoverage:'COMPLETE'|'PARTIAL'|'FAILED';componentStatus:'NOT_STARTED'|'ACTIVE'|'COMPLETED'|'UNKNOWN';medicalOrSafetyHold:boolean;persistenceReady:boolean};
export function guardPlanCommand(v:PlanGuard):{status:'READY_FOR_HOST'|'BLOCKED';reason:string;planWritten:false}{
 const reason=!v.actorAthleteId||v.actorAthleteId!==v.proposalAthleteId?'ATHLETE_MISMATCH'
 :!v.explicitlyConfirmed?'CONFIRMATION_REQUIRED'
 :!v.expectedRevision||v.expectedRevision!==v.currentRevision?'STALE_PREVIEW'
 :v.calendarCoverage!=='COMPLETE'?'INCOMPLETE_CALENDAR'
 :v.componentStatus!=='NOT_STARTED'?'COMPONENT_NOT_MOVABLE'
 :v.medicalOrSafetyHold?'SAFETY_REVIEW_REQUIRED'
 :!v.persistenceReady?'PERSISTENCE_UNAVAILABLE':'HOST_TRANSACTION_REQUIRED';
 return {status:reason==='HOST_TRANSACTION_REQUIRED'?'READY_FOR_HOST':'BLOCKED',reason,planWritten:false};
}
