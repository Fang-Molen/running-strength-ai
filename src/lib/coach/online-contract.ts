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
