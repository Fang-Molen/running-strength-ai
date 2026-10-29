/** Shared wire contract. Every browser-origin value remains an unverified self report. */
export const COACH_DISCLOSURE_VERSION = 'coach-self-report-v1' as const;
export type CoachDeclaration = {
  recordId: string;
  revision: string;
  occurredAt: string;
  kind: 'actual';
  metric: 'duration' | 'session_rpe' | 'sleep' | 'pain' | 'soreness' | 'subjective_recovery';
  value: number;
  unit: 's' | '/10' | 'h';
};
export type CoachContextRecord = {
  recordId:string; revision:string; occurredAt:string|null; knownAt:string|null;
  category:'TRAINING'|'STRENGTH'|'GOAL'|'PLAN'|'NUTRITION'|'RECOVERY'|'CAPABILITY'|'RESTRICTION'|'ANALYSIS'|'DIALOGUE';
  state:'ACTUAL'|'PLANNED'|'TARGET'|'UNKNOWN'; source:string;
  fields:{name:string;value:string|number|boolean|null;unit:string|null}[];
};
export type CoachRequestContext = {
  version:'coach-context-v2'; dependencyVersions:{key:string;revision:string}[];
  records:CoachContextRecord[]; coverage:{selected:number;omitted:number;unknowns:string[]};
};
export type CoachSnapshotCreate = {
  question: string;
  declarations: CoachDeclaration[];
  consent: { purpose: 'coach_explanation'; disclosureVersion: typeof COACH_DISCLOSURE_VERSION; mode?:'PER_REQUEST'|'PERSISTENT' };
  context?:CoachRequestContext;
};
export type CoachSnapshotReference = { snapshotId: string; consentId: string; asOf: string };
export type CoachSnapshotCreated = {
  ok: true;
  snapshotRef: CoachSnapshotReference;
  expiresAt: string;
  sourceVersion: string;
  provenance: 'USER_DECLARED';
  disclosureVersion: typeof COACH_DISCLOSURE_VERSION;
  /** Exact whole factual sentences, in submitted declaration order. */
  factQuotes: string[];
  contextQuotes?:string[];
};

/** Stable data quotation, never a claim that a submitted record was independently verified. */
export function contextRecordQuote(r:CoachContextRecord):string {
  const states={ACTUAL:'实绩申报',PLANNED:'计划（非已执行）',TARGET:'目标（非实绩）',UNKNOWN:'状态未知'};
  return `用户申报[${r.category}；${states[r.state]}]：${r.fields.map(f=>`${f.name}=${f.value===null?'未知':String(f.value)}${f.unit?` ${f.unit}`:''}`).join('；')}；发生时间 ${r.occurredAt??'未知'}；记录时间 ${r.knownAt??'未知'}；来源 ${r.source}；修订 ${r.revision}；未经独立核验。`;
}

/** Pure browser/server formatter; no record IDs, implied sport, plan, or derived quantity. */
export function declarationQuote(d: CoachDeclaration): string {
  const labels: Record<CoachDeclaration['metric'], string> = {
    duration: '时长（活动类型未指定）', session_rpe: '主观训练强度', sleep: '睡眠时长',
    pain: '疼痛程度', soreness: '酸痛程度', subjective_recovery: '主观恢复程度',
  };
  const unit = d.unit === 's' ? '秒' : d.unit === 'h' ? '小时' : '/10';
  return `用户申报${labels[d.metric]}：${d.value}${unit}；记录时间 ${new Date(d.occurredAt).toISOString()}；未核验设备或实验室来源。`;
}

/** Compact exact statements for the model; full schema, source groups and revisions remain
 * in the authorized snapshot. Numbers are projections, not model-authored calculations. */
export function contextModelQuote(r:CoachContextRecord):string {
 const f=(name:string)=>r.fields.find(f=>f.name===name)?.value??null;
 const date=r.occurredAt??'发生日期未知';
 const provenance=`（用户申报；来源 ${r.source}；修订 ${r.revision}；未经独立核验。）`;
 if(r.source==='USER_DECLARED:CANONICAL_LOAD_SUMMARY')return `范围${f('scope')}，已记录${f('sessions')}课，已知跑步距离${typeof f('knownDistance')==='number'?Number(f('knownDistance'))/1000+'公里':'未知'}；缺项日期${f('missingDays')}天；记录覆盖未确认，未记录日期不补零，不能证明每次训练都记录齐全；完整距离覆盖=${f('distanceComplete')}；整课负荷${f('qualifiedSessionLoad')??'未知'} AU；个人生理基线未建立。${provenance}`;
 if(['TRAINING','STRENGTH'].includes(r.category)&&(f('knownWorkTime')!==null||f('strengthDose')!==null)){
  const pace=f('paceSecondsPerKm'),rounded=typeof pace==='number'?Math.round(pace):null,p=rounded===null?'未知':`${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}/km`;
  if(f('modality')==='STRENGTH')return `${date}力量实绩申报：${f('setCount')}组，${f('strengthDose')??'逐组剂量未知'}；整课RPE ${f('sessionRpe')??'未知'}，整课时长${f('actualDuration')??'未知'}秒。${provenance}`;
  return `${date}已记录跑步${typeof f('knownDistance')==='number'?Number(f('knownDistance'))/1000:'未知'}公里，工作时间${typeof f('knownWorkTime')==='number'?Number(f('knownWorkTime'))/60:'未知'}分钟，连续段配速${p}；整课RPE ${f('sessionRpe')??'未知'}（${r.fields.find(x=>x.name==='sessionRpe')?.unit??'量表未知'}），距离完整=${f('distanceComplete')}；条件未必可比。${provenance}`;
 }
 if(f('measure')!==null)return `${date} ${f('side')==='RIGHT'?'右':f('side')==='LEFT'?'左':''}${f('region')==='calves'?'小腿':f('region')??'部位未知'}反馈：${f('notes')??'备注未记录'}；${f('measure')}程度${f('value')??'未知'}，观察协议${f('observationProtocol')??'未知'}。${provenance}`;
 return contextRecordQuote(r);
}
