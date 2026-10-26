import { createHash } from 'node:crypto';
import { deriveCoachBrief, type CoachBrief } from '../../../src/lib/core/coach-brief.ts';
import type { AskCoachRawInput } from '../../../src/lib/strength/coach-pipeline.ts';
import { COACH_DISCLOSURE_VERSION, declarationQuote, type CoachDeclaration, type CoachSnapshotCreate } from './coach-declaration-contract.ts';
import { validTime } from './coach-request-boundary.ts';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:/-]{1,120}$/.test(v);
const rules = { duration: ['s', 86400], session_rpe: ['/10', 10], sleep: ['h', 24], pain: ['/10', 10], soreness: ['/10', 10], subjective_recovery: ['/10', 10] } as const;
export function parseCoachDeclarations(body: unknown, now: number): CoachSnapshotCreate {
  if (!object(body) || !exact(body, ['question', 'declarations', 'consent']) || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.question)) throw Error('DECLARATIONS_INVALID');
  if (!object(body.consent) || !exact(body.consent, ['purpose', 'disclosureVersion']) || body.consent.purpose !== 'coach_explanation' || body.consent.disclosureVersion !== COACH_DISCLOSURE_VERSION) throw Error('EXPLICIT_CONSENT_REQUIRED');
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
  return { question: body.question.trim(), declarations, consent: { purpose: 'coach_explanation', disclosureVersion: COACH_DISCLOSURE_VERSION } };
}

/** Scalar facts do not establish a sport, workout, segment structure or completed count. */
export function declarationCoachInput(input: CoachSnapshotCreate): AskCoachRawInput {
  const sources: NonNullable<CoachBrief['sources']> = input.declarations.map(d => ({
    id: `decl:${createHash('sha256').update(JSON.stringify([d.recordId, d.revision, d.metric])).digest('hex').slice(0, 32)}`,
    kind: 'FACT', detail: declarationQuote(d),
  }));
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
