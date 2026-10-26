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
export type CoachSnapshotCreate = {
  question: string;
  declarations: CoachDeclaration[];
  consent: { purpose: 'coach_explanation'; disclosureVersion: typeof COACH_DISCLOSURE_VERSION };
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
};

/** Pure browser/server formatter; no record IDs, implied sport, plan, or derived quantity. */
export function declarationQuote(d: CoachDeclaration): string {
  const labels: Record<CoachDeclaration['metric'], string> = {
    duration: '时长（活动类型未指定）', session_rpe: '主观训练强度', sleep: '睡眠时长',
    pain: '疼痛程度', soreness: '酸痛程度', subjective_recovery: '主观恢复程度',
  };
  const unit = d.unit === 's' ? '秒' : d.unit === 'h' ? '小时' : '/10';
  return `用户申报${labels[d.metric]}：${d.value}${unit}；记录时间 ${new Date(d.occurredAt).toISOString()}；未核验设备或实验室来源。`;
}
