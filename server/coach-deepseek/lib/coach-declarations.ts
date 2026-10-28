import { createHash } from 'node:crypto';
import { deriveCoachBrief, type CoachBrief } from '../../../src/lib/core/coach-brief.ts';
import type { AskCoachRawInput } from '../../../src/lib/strength/coach-pipeline.ts';
import { COACH_DISCLOSURE_VERSION, declarationQuote, contextRecordQuote, type CoachDeclaration, type CoachSnapshotCreate, type CoachRequestContext, type CoachContextRecord } from './coach-declaration-contract.ts';
import { validTime } from './coach-request-boundary.ts';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:/-]{1,120}$/.test(v);
const rules = { duration: ['s', 86400], session_rpe: ['/10', 10], sleep: ['h', 24], pain: ['/10', 10], soreness: ['/10', 10], subjective_recovery: ['/10', 10] } as const;
const plain=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f<>]/.test(v);
const exactTime=(v:unknown):v is string=>validTime(v)&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
export function parseCoachContext(raw:unknown,now:number):CoachRequestContext {
 if(!object(raw)||!exact(raw,['version','dependencyVersions','records','coverage'])||raw.version!=='coach-context-v2'||new TextEncoder().encode(JSON.stringify(raw)).length>49152)throw Error('CONTEXT_INVALID');
 if(!Array.isArray(raw.dependencyVersions)||raw.dependencyVersions.length>64||!Array.isArray(raw.records)||raw.records.length>32)throw Error('CONTEXT_INVALID');
 const keys=new Set<string>();
 const dependencyVersions=raw.dependencyVersions.map(d=>{if(!object(d)||!exact(d,['key','revision'])||!id(d.key)||!id(d.revision)||keys.has(d.key))throw Error('CONTEXT_DEPENDENCY_INVALID');keys.add(d.key);return {key:d.key,revision:d.revision}});
 const ids=new Set<string>();
 const records=raw.records.map((r):CoachContextRecord=>{
  if(!object(r)||!exact(r,['recordId','revision','occurredAt','knownAt','category','state','source','fields'])||!id(r.recordId)||!id(r.revision)||ids.has(r.recordId)||!['TRAINING','STRENGTH','GOAL','PLAN','NUTRITION','RECOVERY','CAPABILITY','RESTRICTION','ANALYSIS','DIALOGUE'].includes(String(r.category))||!['ACTUAL','PLANNED','TARGET','UNKNOWN'].includes(String(r.state))||!plain(r.source,64)||!r.source||!Array.isArray(r.fields)||r.fields.length>24)throw Error('CONTEXT_RECORD_INVALID');
  if(['ANALYSIS','DIALOGUE'].includes(String(r.category))&&(r.state!=='UNKNOWN'||!String(r.source).startsWith('USER_DECLARED:')))throw Error('CONTEXT_STATE_INVALID');
  if(['ANALYSIS','DIALOGUE'].includes(String(r.category))&&r.fields.some(f=>object(f)&&(
    f.name==='medicalClearance'&&f.value!==false||
    ['writeAuthority','factAuthority'].includes(String(f.name))&&f.value!=='NONE'
  )))throw Error('CONTEXT_AUTHORITY_INVALID');
  ids.add(r.recordId);
  if((r.category==='PLAN'&&!['PLANNED','UNKNOWN'].includes(String(r.state)))||(r.category==='GOAL'&&!['TARGET','UNKNOWN'].includes(String(r.state))))throw Error('CONTEXT_STATE_INVALID');
  if(r.knownAt!==null&&(!exactTime(r.knownAt)||Date.parse(r.knownAt)>now))throw Error('CONTEXT_TIME_INVALID');
  if(r.occurredAt!==null&&(!exactTime(r.occurredAt)||(['ACTUAL','UNKNOWN'].includes(String(r.state))&&Date.parse(r.occurredAt)>now)))throw Error('CONTEXT_TIME_INVALID');
  const names=new Set<string>();
  const fields=r.fields.map(f=>{
   if(!object(f)||!exact(f,['name','value','unit'])||!plain(f.name,64)||!f.name||names.has(f.name)||/password|token|secret|email|account.?id|device.?id|latitude|longitude|gps|密码|密钥|邮箱|经度|纬度/i.test(f.name)||(f.unit!==null&&!plain(f.unit,32))||!(f.value===null||typeof f.value==='boolean'||(typeof f.value==='number'&&Number.isFinite(f.value)&&Math.abs(f.value)<=1e9)||plain(f.value,256)))throw Error('CONTEXT_FIELD_INVALID');
   names.add(f.name);return {name:f.name,value:f.value,unit:f.unit} as CoachContextRecord['fields'][number];
  });
  return {...r,fields} as CoachContextRecord;
 });
 const c=raw.coverage;
 if(!object(c)||!exact(c,['selected','omitted','unknowns'])||c.selected!==records.length||!Number.isSafeInteger(c.omitted)||Number(c.omitted)<0||!Array.isArray(c.unknowns)||c.unknowns.length>24||c.unknowns.some(x=>!plain(x,160)))throw Error('CONTEXT_COVERAGE_INVALID');
 return {version:'coach-context-v2',dependencyVersions,records,coverage:{selected:records.length,omitted:c.omitted as number,unknowns:c.unknowns as string[]}};
}
export function parseCoachDeclarations(body: unknown, now: number): CoachSnapshotCreate {
  if (!object(body) || !exact(body, ['question', 'declarations', 'consent',...(Object.hasOwn(body,'context')?['context']:[])]) || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.question)) throw Error('DECLARATIONS_INVALID');
  if (!object(body.consent) || !exact(body.consent, ['purpose', 'disclosureVersion',...(Object.hasOwn(body.consent,'mode')?['mode']:[])]) || body.consent.purpose !== 'coach_explanation' || body.consent.disclosureVersion !== COACH_DISCLOSURE_VERSION || (body.consent.mode!==undefined&&!['PER_REQUEST','PERSISTENT'].includes(String(body.consent.mode)))) throw Error('EXPLICIT_CONSENT_REQUIRED');
  if (!Array.isArray(body.declarations) || body.declarations.length > 36) throw Error('DECLARATIONS_INVALID');
  const seen = new Set<string>(), records = new Map<string, string>();
  const declarations = body.declarations.map((d: unknown): CoachDeclaration => {
    if (!object(d) || !exact(d, ['recordId', 'revision', 'occurredAt', 'kind', 'metric', 'value', 'unit']) || !id(d.recordId) || !id(d.revision) || !validTime(d.occurredAt) || new Date(d.occurredAt).toISOString().slice(0, 19) !== d.occurredAt.slice(0, 19) || Date.parse(d.occurredAt) > now || d.kind !== 'actual' || typeof d.metric !== 'string' || !Object.hasOwn(rules, d.metric)) throw Error('DECLARATIONS_INVALID');
    const metric = d.metric as CoachDeclaration['metric'], [unit, max] = rules[metric];
    if (d.unit !== unit || typeof d.value !== 'number' || !Number.isFinite(d.value) || !/^\d+(?:\.\d{1,6})?$/.test(String(d.value)) || d.value < 0 || d.value > max || (metric === 'duration' && d.value === 0)) throw Error('DECLARATION_UNIT_OR_VALUE');
    const key = JSON.stringify([d.recordId, metric]);
    const binding = JSON.stringify([d.revision, d.occurredAt]);
    if (seen.has(key) || (records.has(d.recordId) && records.get(d.recordId) !== binding)) throw Error('DECLARATION_CONFLICT');
    seen.add(key); records.set(d.recordId, binding);
    return { recordId: d.recordId, revision: d.revision, occurredAt: d.occurredAt, kind: 'actual', metric, value: d.value, unit };
  });
  if (records.size > 6) throw Error('DECLARATIONS_INVALID');
  return { question: body.question.trim(), declarations, consent: { purpose: 'coach_explanation', disclosureVersion: COACH_DISCLOSURE_VERSION,...(body.consent.mode?{mode:body.consent.mode as 'PER_REQUEST'|'PERSISTENT'}:{}) },...(body.context!==undefined?{context:parseCoachContext(body.context,now)}:{}) };
}

/** Scalar facts do not establish a sport, workout, segment structure or completed count. */
export function declarationCoachInput(input: CoachSnapshotCreate): AskCoachRawInput {
  const sources: NonNullable<CoachBrief['sources']> = input.declarations.map(d => ({
    id: `decl:${createHash('sha256').update(JSON.stringify([d.recordId, d.revision, d.metric])).digest('hex').slice(0, 32)}`,
    kind: 'FACT', detail: declarationQuote(d),
  }));
  for(const r of input.context?.records??[])sources.push({id:`ctx:${createHash('sha256').update(JSON.stringify([r.recordId,r.revision])).digest('hex').slice(0,32)}`,kind:r.category==='DIALOGUE'?'CONTEXT':'FACT',detail:contextRecordQuote(r)});
  const brief = deriveCoachBrief({
    question: input.question, occurrenceId: null, runningStructure: 'UNAVAILABLE',
    sessionRpe: null, sleepHours: null, subjectiveRecovery: null, recoveryState: null, fatigueState: null,
    // These are counts of projected structural items (none), not completed training history.
    duplicateCount: 0, repetitionSlots: 0, continuousCount: 0,
    plannedSetCount: null, completedSetCount: null, durationSec: null,
    pain: input.declarations.some(d => d.metric === 'pain' && d.value > 0),
    soreness: input.declarations.some(d => d.metric === 'soreness' && d.value > 0),
    daysToCompetition: null, week: null, bias: null, sourceIds: sources.map(s => s.id), sources, running: [],
  });
  return { brief, history: [], candidates: [], coachContextMemory: [], v4: null };
}
