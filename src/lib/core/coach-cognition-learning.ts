import { readEnvelope } from "./storage.ts";
import { appendJournal, readJournal } from "./storage-journal.ts";
import { comparability, type ComparisonContext } from "./coach-cognition-tools.ts";

export const COGNITION_MEMORY_KEY = "fr255-cognition-memory-r1";
export const COGNITION_JOURNAL_PREFIX = "fr255-cognition-journal-r2:";
export type LearningRecord = {
  id: string;
  kind: "PREDICTION" | "OBSERVATION" | "CHOICE" | "RETRACTION";
  layer: "M3" | "M7";
  athleteId: string;
  trainingOccurrenceId: string;
  sourceIds: string[];
  createdAt: string;
  observedAt: string | null;
  sessionAt: string;
  context: ComparisonContext;
  horizonHours: 24 | 48;
  value: number | null;
  predictionId: string | null;
  supersedes: string | null;
  candidateOptionId?: string | null;
  reasoningVersion?: string;
  hypothesisIds?: string[];
  choice: "ACCEPT" | "REJECT" | "MODIFY" | null;
  confirmed: true;
};
export type LearningStore = { revision: number; records: LearningRecord[] };
export function loadLearning(): LearningStore {
  const e = readEnvelope<LearningRecord[]>(COGNITION_MEMORY_KEY, []);
  const journal = readJournal<LearningRecord>(COGNITION_JOURNAL_PREFIX);
  const all = [...(Array.isArray(e.data) ? e.data : []), ...journal.map((x) => x.data)];
  const seen = new Set<string>();
  const records = all.filter((r) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { revision: e.revision + journal.length, records };
}
const validTime = (s: string) => Number.isFinite(Date.parse(s)) && /(?:Z|[+-]\d\d:\d\d)$/.test(s);
export function validateLearningRecord(
  r: LearningRecord,
  records: LearningRecord[],
): string | null {
  if (
    !r.id ||
    !r.athleteId ||
    !r.trainingOccurrenceId ||
    !r.sourceIds.length ||
    r.confirmed !== true
  )
    return "PROVENANCE_REQUIRED";
  if (!validTime(r.createdAt) || !validTime(r.sessionAt)) return "TIMESTAMP_REQUIRED";
  if (
    !["PREDICTION", "OBSERVATION", "CHOICE", "RETRACTION"].includes(r.kind) ||
    ![24, 48].includes(r.horizonHours)
  )
    return "BAD_KIND";
  if (
    (r.kind === "PREDICTION" || r.kind === "OBSERVATION") &&
    (r.value == null || !Number.isFinite(r.value) || r.value < 1 || r.value > 10)
  )
    return "RECOVERY_RANGE";
  if (
    r.kind === "PREDICTION" &&
    (Date.parse(r.createdAt) < Date.parse(r.sessionAt) ||
      Date.parse(r.createdAt) >= Date.parse(r.sessionAt) + r.horizonHours * 3600000)
  )
    return "POST_HOC_PREDICTION";
  if (r.kind === "OBSERVATION") {
    if (!r.observedAt || !validTime(r.observedAt)) return "OBSERVATION_TIME_REQUIRED";
    // A declared ±3h window, for a subjective log, is a product tolerance, not physiology.
    const elapsed = (Date.parse(r.observedAt) - Date.parse(r.sessionAt)) / 3600000;
    if (
      Math.abs(elapsed - r.horizonHours) > 3 ||
      Date.parse(r.observedAt) > Date.parse(r.createdAt)
    )
      return "OBSERVATION_WINDOW_MISMATCH";
    const prediction = records.find((p) => p.id === r.predictionId && p.kind === "PREDICTION");
    if (
      !prediction ||
      prediction.athleteId !== r.athleteId ||
      prediction.trainingOccurrenceId !== r.trainingOccurrenceId ||
      prediction.horizonHours !== r.horizonHours ||
      !comparability(prediction.context, r.context).comparable
    )
      return "PREDICTION_BINDING_MISMATCH";
    if (Date.parse(prediction.createdAt) >= Date.parse(r.observedAt)) return "POST_HOC_PREDICTION";
  }
  if (r.supersedes) {
    const prior = records.find((p) => p.id === r.supersedes);
    if (
      !prior ||
      prior.athleteId !== r.athleteId ||
      prior.trainingOccurrenceId !== r.trainingOccurrenceId ||
      prior.horizonHours !== r.horizonHours ||
      (r.kind !== "RETRACTION" && (prior.kind !== r.kind || prior.predictionId !== r.predictionId))
    )
      return "CORRECTION_BINDING_MISMATCH";
    if (records.some((p) => p.supersedes === r.supersedes && p.id !== r.id))
      return "CORRECTION_CONFLICT";
  }
  if (r.kind === "RETRACTION" && !r.supersedes) return "RETRACTION_TARGET_REQUIRED";
  if (r.kind === "CHOICE" && !["ACCEPT", "REJECT", "MODIFY"].includes(r.choice ?? ""))
    return "CHOICE_REQUIRED";
  return null;
}
/** Saves only explicitly confirmed learning; never modifies M0/events or plans. Stale revisions fail visibly. */
export function appendLearningRecord(
  r: LearningRecord,
  expectedRevision: number,
): { ok: boolean; error: string | null } {
  const state = loadLearning();
  if (state.revision !== expectedRevision) return { ok: false, error: "REVISION_CONFLICT" };
  const duplicate = state.records.find((p) => p.id === r.id);
  if (duplicate)
    return JSON.stringify(duplicate) === JSON.stringify(r)
      ? { ok: true, error: null }
      : { ok: false, error: "ID_CONFLICT" };
  const error = validateLearningRecord(r, state.records);
  if (error) return { ok: false, error };
  // Bounds inference windows, not persistence. Never silently truncate records.
  if (!appendJournal(COGNITION_JOURNAL_PREFIX, r.id, r))
    return { ok: false, error: "STORAGE_FAILED" };
  return { ok: true, error: null };
}
export function evaluateLearning(state: LearningStore, event: string, athleteId = "local") {
  const superseded = new Set(state.records.filter((r) => r.supersedes).map((r) => r.supersedes));
  const conflictingIds = new Set(
    state.records
      .filter((r) =>
        state.records.some(
          (other) => other.id === r.id && JSON.stringify(other) !== JSON.stringify(r),
        ),
      )
      .map((r) => r.id),
  );
  const active = state.records.filter(
    (r) =>
      !conflictingIds.has(r.id) &&
      r.athleteId === athleteId &&
      r.context.event === event &&
      r.confirmed === true &&
      !superseded.has(r.id) &&
      r.kind !== "RETRACTION",
  );
  const outcomes: {
    prediction: LearningRecord;
    observation: LearningRecord;
    error: number;
    contradiction: boolean;
  }[] = [];
  const excluded: string[] = [...conflictingIds];
  for (const observation of active.filter((r) => r.kind === "OBSERVATION")) {
    const prediction = active.find(
      (r) => r.id === observation.predictionId && r.kind === "PREDICTION",
    );
    if (!prediction || validateLearningRecord(observation, state.records)) {
      excluded.push(observation.id);
      continue;
    }
    // Two independent unsuperseded values for the same endpoint are a conflict, never averaged.
    const same = active.filter(
      (r) =>
        r.kind === "OBSERVATION" &&
        r.trainingOccurrenceId === observation.trainingOccurrenceId &&
        r.horizonHours === observation.horizonHours,
    );
    if (same.length !== 1) {
      excluded.push(observation.id);
      continue;
    }
    const error = observation.value! - prediction.value!;
    outcomes.push({ prediction, observation, error, contradiction: Math.abs(error) >= 2 });
  }
  // Three independent occurrences in the SAME fully specified context and endpoint, no pooling across events.
  const groups = new Map<string, typeof outcomes>();
  for (const o of outcomes) {
    if (!comparability(o.prediction.context, o.prediction.context).comparable) continue;
    const key = JSON.stringify([o.prediction.context, o.prediction.horizonHours]);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const independentGroups = [...groups.values()].map((g) => {
    const independent: typeof g = [];
    for (const o of g) {
      if (
        independent.some(
          (p) =>
            p.observation.trainingOccurrenceId === o.observation.trainingOccurrenceId ||
            p.observation.sessionAt === o.observation.sessionAt ||
            p.prediction.sourceIds.some((id) => o.prediction.sourceIds.includes(id)),
        )
      )
        continue;
      independent.push(o);
    }
    return independent;
  });
  const patterns = independentGroups
    .filter((g) => g.length >= 3)
    .map((g) => ({
      confidence: "LOW" as const,
      independentCount: new Set(g.map((o) => o.observation.trainingOccurrenceId)).size,
      contradictions: g.filter((o) => o.contradiction).length,
      sourceIds: g.flatMap((o) => o.observation.sourceIds),
      horizonHours: g[0].prediction.horizonHours,
      context: g[0].prediction.context,
      errors: g.map((o) => o.error),
      authorization: false as const,
    }));
  return {
    outcomes,
    excluded,
    patterns,
    choices: active.filter((r) => r.kind === "CHOICE"),
    authorization: false as const,
  };
}
export function learningSummary(state: LearningStore, event: string, occurrenceId: string | null) {
  const result = evaluateLearning(state, event);
  const scoped = result.outcomes.filter(
    (o) => !occurrenceId || o.observation.trainingOccurrenceId === occurrenceId,
  );
  return `${event}已核对${scoped.length}条预测—观察配对；排除冲突/无效${result.excluded.length}条；${result.patterns.length ? `低置信可比响应${result.patterns.length}组（反例${result.patterns.reduce((n, p) => n + p.contradictions, 0)}个）` : "尚无三次独立可比观察，不能形成个人规律"}；不授权自动加量`;
}
