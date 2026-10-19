import { deriveCoachBrief, type CoachBrief, type CoachParts } from '../../src/lib/core/coach-brief.ts';
import { redactCoachIdentifiers } from '../../src/lib/core/coach-output-contract.ts';
import type { AskCoachRawInput } from '../../src/lib/strength/coach-pipeline.ts';
import type { AuthorizedCoachSnapshot, CoachSnapshotRefs, VerifiedCoachSubject, VerifiedDeepSeekPolicy } from './coach-service-contract.ts';

const ID = /^[A-Za-z0-9_.:/-]{1,120}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
export const validTime = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v));
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export function parseCoachRequest(body: unknown): CoachSnapshotRefs & { requestId: string } {
  const keys = ['question', 'requestId', 'snapshotId', 'consentId', 'asOf'];
  if (!object(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(k => !keys.includes(k))) throw new Error('REQUEST_FIELDS');
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.question)) throw new Error('QUESTION_INVALID');
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)) throw new Error('REQUEST_ID_INVALID');
  if (typeof body.snapshotId !== 'string' || !ID.test(body.snapshotId) || typeof body.consentId !== 'string' || !ID.test(body.consentId) || !validTime(body.asOf)) throw new Error('REFS_INVALID');
  return { question: body.question.trim(), requestId: body.requestId, snapshotId: body.snapshotId, consentId: body.consentId, asOf: body.asOf };
}
export function assertSnapshotBinding(snapshot: AuthorizedCoachSnapshot | null, subject: VerifiedCoachSubject, refs: CoachSnapshotRefs, now: number): asserts snapshot is AuthorizedCoachSnapshot {
  if (!snapshot || snapshot.subjectId !== subject.id || !subject.athleteIds.includes(snapshot.athleteId) || snapshot.snapshotId !== refs.snapshotId || !ID.test(snapshot.version ?? '') || snapshot.asOf !== refs.asOf || !validTime(snapshot.asOf) || Date.parse(snapshot.asOf) > now || !validTime(snapshot.latestEvidenceKnownAt) || Date.parse(snapshot.latestEvidenceKnownAt) > Date.parse(snapshot.asOf) || !validTime(snapshot.expiresAt) || Date.parse(snapshot.expiresAt) <= now || snapshot.revokedAt !== null) throw new Error('SNAPSHOT_BINDING');
  const consent = snapshot.consent;
  if (!consent || consent.id !== refs.consentId || consent.subjectId !== subject.id || consent.purpose !== 'coach_explanation' || !validTime(consent.grantedAt) || Date.parse(consent.grantedAt) > now || !validTime(consent.expiresAt) || Date.parse(consent.expiresAt) <= now || consent.revokedAt !== null) throw new Error('CONSENT_BINDING');
  if (snapshot.scope?.purpose !== 'coach_explanation' || !Array.isArray(snapshot.scope.occurrenceIds) || snapshot.scope.occurrenceIds.some(id => !ID.test(id))) throw new Error('SNAPSHOT_SCOPE');
  const raw = snapshot.rawInput;
  const ids = [raw?.brief?.occurrenceId, raw?.compare?.left.occurrenceId, raw?.compare?.right.occurrenceId, ...(raw?.series?.points ?? []).map(p => p.occurrenceId)].filter((id): id is string => id != null);
  if (ids.some(id => !snapshot.scope.occurrenceIds.includes(id))) throw new Error('SNAPSHOT_SCOPE');
  const starts = [raw?.compare?.leftStartedAt,raw?.compare?.rightStartedAt,...(raw?.series?.points ?? []).map(p => p.startedAt)].filter((v): v is string => v !== undefined);
  if (starts.some(v => !validTime(v) || Date.parse(v) > Date.parse(snapshot.asOf))) throw new Error('SNAPSHOT_FUTURE_TRAINING');
  if (raw?.v4 && (raw.v4.athleteId !== snapshot.athleteId || raw.v4.asOf !== snapshot.asOf)) throw new Error('SNAPSHOT_SCOPE');
}
export function assertVerifiedPolicy(p: VerifiedDeepSeekPolicy | null, now: number): asserts p is VerifiedDeepSeekPolicy {
  if (!p || p.enabled !== true || !ID.test(p.approvalId ?? '') || !validTime(p.approvalExpiresAt) || Date.parse(p.approvalExpiresAt) <= now || !ID.test(p.campaignId ?? '') || !['pilot','evaluation'].includes(p.phase) || !ID.test(p.model ?? '') || !ID.test(p.modelVersion ?? '') || !ID.test(p.priceVersion ?? '') || p.modelVerified !== true || p.samplingVerified !== true || p.temperature !== 0.4 || p.jsonObjectModeVerified !== true || p.tokenUpperBoundVerified !== true || p.reasoningIncludedInCompletionVerified !== true || p.usageCacheAccountingVerified !== true || p.pricesVerified !== true || !Array.isArray(p.acceptedResponseModels) || !p.acceptedResponseModels.length || p.acceptedResponseModels.some(m => !ID.test(m)) || !/^[A-Z]{3}$/.test(p.currency)) throw new Error('POLICY_UNVERIFIED');
  if (![p.inputMicrosPerMillion,p.cachedInputMicrosPerMillion,p.outputMicrosPerMillion,p.tokenOverheadUpperBound,p.timeoutMs].every(n => Number.isSafeInteger(n) && n >= 0) || p.inputMicrosPerMillion <= 0 || p.outputMicrosPerMillion <= 0 || p.cachedInputMicrosPerMillion > p.inputMicrosPerMillion || p.timeoutMs < 1 || p.timeoutMs > 30000 || p.tokenOverheadUpperBound < 1) throw new Error('POLICY_INVALID');
  const counts = ['campaignCalls','pilotCalls','ownerCalls','concurrency','globalDailyCalls','ownerDailyCalls'] as const;
  const costs = ['campaignCostMicros','ownerCostMicros','globalDailyCostMicros','ownerDailyCostMicros','perCallCostMicros'] as const;
  if (!p.caps || counts.some(k => !Number.isSafeInteger(p.caps[k]) || Number(p.caps[k]) <= 0) || costs.some(k => !/^[1-9]\d{0,29}$/.test(p.caps[k] ?? '')) || p.caps.pilotCalls! > 8 || p.caps.campaignCalls! > 120 || p.caps.concurrency !== 1) throw new Error('POLICY_CAPS');
}

function finite(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null; }
/** Rebuild known fact fields. Arbitrary snapshot text, account data, GPS, memories and notes never enter the provider packet. */
export function minimalCoachInput(raw: AskCoachRawInput, question: string): AskCoachRawInput {
  if (raw.series && (!Array.isArray(raw.series.points) || raw.series.points.length > 6)) throw new Error('SERIES_TOO_LARGE');
  const count = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) < 0) throw new Error('COUNT_INVALID'); return v as number; };
  const cleanBrief = (b: CoachBrief): CoachBrief => {
    if (!b || (b.occurrenceId !== null && !ID.test(b.occurrenceId)) || !Array.isArray(b.sources) || !Array.isArray(b.sourceIds) || !Array.isArray(b.running) || b.sources.length > 100 || b.sourceIds.length > 100 || b.running.length > 48 || new Set(b.sources.map(s=>s.id)).size !== b.sources.length) throw new Error('BRIEF_INVALID');
    const allowedSourceIds = new Set((b.sources ?? []).map(s => s.id).filter(id => typeof id === 'string' && ID.test(id)));
    const slotStatuses = new Set(['COMPLETED','PARTIAL','NOT_RECORDED','SKIPPED','DUPLICATE_UNRESOLVED','NOT_YET_RECORDED','UNKNOWN','UNAVAILABLE']);
    const running: NonNullable<CoachBrief['running']> = (b.running ?? []).slice(0,48).map((s, i) => {
      if (!['REPETITION','CONTINUOUS','RECOVERY'].includes(s.kind) || !slotStatuses.has(s.status)) throw new Error('RUNNING_INVALID');
      const measure = (v: string) => { if (typeof v !== 'string' || v.length > 100 || !/^[\d\s?.:/米秒分公里未记录]+$/.test(v)) throw new Error('MEASURE_INVALID'); return v; };
      const ordinals = typeof s.position === 'string' ? s.position.match(/第\d+轮|第\d+次/g) ?? [] : [];
      const group = typeof s.position === 'string' ? s.position.split(' 第')[0] : String(i);
      return { kind: s.kind, position: `结构${groupAliases.get(group) ?? (groupAliases.set(group,groupAliases.size + 1),groupAliases.size)} ${ordinals.join('')}`.trim(), status: s.status, planned: measure(s.planned), actual: measure(s.actual), sourceEventIds: s.sourceEventIds.filter(id => allowedSourceIds.has(id)) };
    });
    const parts: CoachParts = {
      question: redactCoachIdentifiers(question), occurrenceId: b.occurrenceId,
      runningStructure: b.runningStructure === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
      sessionRpe: finite(b.sessionRpe,0,10), sleepHours: finite(b.sleepHours,0,24), subjectiveRecovery: finite(b.subjectiveRecovery,0,10),
      recoveryState: null, fatigueState: null, musculoskeletalState: b.musculoskeletalState && ['NO_RELEVANT_EVIDENCE','SIGNAL_PRESENT','INSUFFICIENT_EVIDENCE','CONFLICTING_EVIDENCE'].includes(b.musculoskeletalState) ? b.musculoskeletalState : null,
      duplicateCount: count(b.duplicateCount), repetitionSlots: count(b.repetitionSlots), continuousCount: count(b.continuousCount),
      plannedSetCount: finite(b.plannedSetCount), completedSetCount: finite(b.completedSetCount), durationSec: finite(b.durationSec),
      pain: b.pain === true, soreness: b.soreness === true, daysToCompetition: finite(b.daysToCompetition,-10000,10000),
      week: [1,2,3,4].includes(b.week as number) ? b.week : null, bias: ['build','hold','deload'].includes(b.bias as string) ? b.bias : null,
      sourceIds: [], sources: [], running, runningTruncated: b.runningTruncated === true, fuel: null,
    };
    const sources = new Map<string,NonNullable<CoachBrief['sources']>[number]>();
    const add = (id: string, kind: 'FACT'|'DERIVED'|'CONTEXT', detail: string) => { if (allowedSourceIds.has(id)) sources.set(id,{id,kind,detail}); };
    if (b.occurrenceId) add(b.occurrenceId,'FACT','训练开始；服务端已核对所选训练归属');
    for (const s of b.sources ?? []) {
      if (s.kind !== 'FACT') continue;
      const m = s.detail?.match(/^(SESSION_RPE|SUBJECTIVE_RECOVERY|SLEEP|PAIN|SORENESS)\s[^:：]{0,40}[:：]\s*(\d+(?:\.\d+)?)(小时|\/10)/);
      if (m && finite(Number(m[2]),0,m[1] === 'SLEEP' ? 24 : 10) !== null) add(s.id,'FACT',`${m[1]} 已记录：${Number(m[2])}${m[1] === 'SLEEP' ? '小时' : '/10'}；绑定本次训练，不是诊断`);
    }
    for (const s of running) for (const id of s.sourceEventIds) add(id,'FACT',`${s.kind} ${s.position}：${s.status}；实际 ${s.actual}`);
    if (parts.daysToCompetition != null) add('context:competition','CONTEXT',`距比赛 ${parts.daysToCompetition} 天；原计划背景，不是实际训练事实`);
    if (parts.week !== null || parts.bias) add('context:cycle','CONTEXT',`第 ${parts.week ?? '?'} 周，${parts.bias ?? '未记录'}；原计划背景`);
    parts.sources = [...sources.values()]; parts.sourceIds = parts.sources.map(s => s.id);
    for (const s of running) s.sourceEventIds = s.sourceEventIds.filter(id => sources.has(id));
    return deriveCoachBrief(parts);
  };
  const groupAliases = new Map<string,number>();
  const brief = cleanBrief(raw.brief);
  return {
    brief, history: [], candidates: [], coachContextMemory: [], v4: null,
    ...(raw.compare ? { compare: { left: cleanBrief(raw.compare.left), right: cleanBrief(raw.compare.right), userSelected: raw.compare.userSelected === true, leftStartedAt: raw.compare.leftStartedAt, rightStartedAt: raw.compare.rightStartedAt } } : {}),
    ...(raw.series ? { series: { points: raw.series.points.slice(0,6).map(p => ({ occurrenceId: p.occurrenceId, startedAt: p.startedAt, brief: cleanBrief(p.brief) })) } } : {}),
  };
}
/** Alias every bound source/occurrence ID, and reverse only citations/selection fields after generation. */
export function aliasCoachInput(input: AskCoachRawInput): { input: AskCoachRawInput; restore(raw: string): string } {
  const aliases = new Map<string,string>();
  const visit = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string' && (key === 'id' || key === 'occurrenceId' || key === 'sourceId' || key === 'sourceIds' || key === 'sourceEventIds')) {
      if (!aliases.has(value)) aliases.set(value, `ref${aliases.size + 1}`);
      return aliases.get(value);
    }
    if (Array.isArray(value)) return value.map(v => visit(v,key));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,visit(v,k)]));
    return value;
  };
  const aliased = visit(input) as AskCoachRawInput;
  const reverse = new Map([...aliases].map(([k,v]) => [v,k]));
  return { input: aliased, restore(raw) {
    const parsed = JSON.parse(raw);
    for (const key of ['citations','compareIds','seriesIds']) if (Array.isArray(parsed[key])) parsed[key] = parsed[key].map((id: string) => reverse.get(id) ?? id);
    return JSON.stringify(parsed);
  } };
}
export function costMicros(inputTokens: number, outputTokens: number, p: VerifiedDeepSeekPolicy, cachedTokens = 0): string {
  return ((BigInt(inputTokens - cachedTokens) * BigInt(p.inputMicrosPerMillion) + BigInt(cachedTokens) * BigInt(p.cachedInputMicrosPerMillion) + BigInt(outputTokens) * BigInt(p.outputMicrosPerMillion) + 999999n) / 1000000n).toString();
}
