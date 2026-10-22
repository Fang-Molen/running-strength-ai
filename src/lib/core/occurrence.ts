import { loadRunningTransactions } from "./running-transaction.ts";
import type { Session } from "@/lib/strength/model";
import { buildOriginalPlanSnapshot, type OriginalPlanSnapshot } from "./canonical.ts";
import { freezeRunningPlanOnStart } from "./running-plan.ts";
import { readEnvelope, writeEnvelope } from "./storage.ts";
import { loadTrainingFact } from "./training-fact.ts";
import { currentAthleteId, loadEvents } from './events.ts';

export const TRAINING_OCCURRENCE_KEY = "fr255-training-occurrence-v1";

export type PlanKnowledge = "KNOWN" | "UNKNOWN";

export type OccurrenceFutureLinks = {
  strengthRpeEventId: null;
  painEventIds: [];
  injuryEventId: null;
};

export type TrainingOccurrence = {
  trainingOccurrenceId: string;
  planSlotId: string;
  sessionId: string;
  startEventId: string;
  trainingPlanSnapshotId: string | null;
  planKnowledge: PlanKnowledge;
  lifecycle: "IN_PROGRESS" | "COMPLETED" | "INTERRUPTED" | "UNCLASSIFIED_CLOSE" | "DUPLICATE_CLOSE";
  outcome: "COMPLETED" | "INTERRUPTED" | "UNKNOWN";
  reason: "UNKNOWN";
  startedAt: string | null;
  endedAt: string | null;
  closeEventId: string | null;
  duplicateCloseEventIds: string[];
  duplicateStartEventIds: string[];
  futureLinks: OccurrenceFutureLinks;
};

type OccurrenceStore = {
  occurrences: TrainingOccurrence[];
  trainingPlans: OriginalPlanSnapshot[];
};

function emptyStore(): OccurrenceStore {
  return { occurrences: [], trainingPlans: [] };
}

function emptyLinks(): OccurrenceFutureLinks {
  return { strengthRpeEventId: null, painEventIds: [], injuryEventId: null };
}

function loadStore(): OccurrenceStore {
  const raw = readEnvelope<OccurrenceStore>(TRAINING_OCCURRENCE_KEY, emptyStore()).data;
  const data =
    raw && Array.isArray(raw.occurrences) && Array.isArray(raw.trainingPlans) ? raw : emptyStore();
  const occurrences = new Map(data.occurrences.map((x) => [x.trainingOccurrenceId, x]));
  for (const tx of loadRunningTransactions()) {
    for (const start of tx.starts ?? [])
      occurrences.set(start.trainingOccurrenceId, structuredClone(start));
    if (tx.close) {
      const c = tx.close;
      const row = occurrences.get(c.occurrenceId);
      if (row && row.closeEventId !== c.eventId) {
        if (row.lifecycle === "IN_PROGRESS") {
          row.lifecycle = c.kind;
          row.outcome = c.kind;
          row.closeEventId = c.eventId;
          row.endedAt = c.at;
        } else {
          row.lifecycle = "DUPLICATE_CLOSE";
          row.outcome = "UNKNOWN";
          row.duplicateCloseEventIds.push(c.eventId);
        }
      }
    }
  }
  return { ...data, occurrences: [...occurrences.values()] };
}

function saveStore(store: OccurrenceStore): boolean {
  return writeEnvelope(TRAINING_OCCURRENCE_KEY, store) != null;
}

function isMove(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const move = value as Record<string, unknown>;
  return (
    typeof move.id === "string" &&
    (move.mode === "reps" || move.mode === "seconds") &&
    typeof move.sets === "number" &&
    Number.isFinite(move.sets) &&
    move.sets >= 0 &&
    typeof move.amount === "number" &&
    typeof move.weightKg === "number" &&
    typeof move.restSec === "number" &&
    (move.catalogId === null || typeof move.catalogId === "string") &&
    typeof move.customName === "string"
  );
}

export function readableSession(plan: unknown): Session | null {
  if (!plan || typeof plan !== "object") return null;
  const session = plan as Record<string, unknown>;
  if (
    typeof session.id !== "string" ||
    typeof session.name !== "string" ||
    !Array.isArray(session.moves)
  )
    return null;
  if (!session.moves.every(isMove)) return null;
  return session as Session;
}

export function listTrainingOccurrences(): TrainingOccurrence[] {
  return loadStore().occurrences;
}

export function getTrainingOccurrence(trainingOccurrenceId: string): TrainingOccurrence | null {
  return (
    listTrainingOccurrences().find((item) => item.trainingOccurrenceId === trainingOccurrenceId) ??
    null
  );
}

export function getTrainingPlanSnapshot(
  trainingPlanSnapshotId: string,
): OriginalPlanSnapshot | null {
  return (
    loadStore().trainingPlans.find((item) => item.snapshotId === trainingPlanSnapshotId) ?? null
  );
}

function sameOccurrenceOwner(occurrence: TrainingOccurrence, athleteId: string, events = loadEvents()): boolean {
  const starts = events.filter(event => event.event_id === occurrence.startEventId && event.event_type === 'TRAINING_STARTED');
  // Legacy snapshots without a persisted start stay in their original local namespace.
  return starts.length ? starts.every(event => (event.athlete_id ?? 'local') === athleteId) : athleteId === 'local';
}
function openOccurrence(store: OccurrenceStore, sessionId: string, athleteId = currentAthleteId()): TrainingOccurrence | null {
  const events = loadEvents();
  return (
    [...store.occurrences]
      .reverse()
      .find((item) => item.sessionId === sessionId && item.lifecycle === "IN_PROGRESS" && sameOccurrenceOwner(item, athleteId, events)) ?? null
  );
}

export function bindTrainingStart(input: {
  startEventId: string;
  startedAt: string | null;
  sessionId: string;
  planSlotId: string;
  plan: unknown;
  runningPlanId?: string | null;
  persistSnapshot?: (snapshot: OriginalPlanSnapshot) => boolean;
}): TrainingOccurrence | null {
  const started = loadEvents().find(event => event.event_id === input.startEventId && event.event_type === 'TRAINING_STARTED');
  if (started && (started.athlete_id ?? 'local') !== currentAthleteId()) return null;
  const store = loadStore();
  const existing = store.occurrences.find(
    (item) =>
      item.startEventId === input.startEventId || item.trainingOccurrenceId === input.startEventId,
  );
  if (existing) return existing;
  const open = openOccurrence(store, input.sessionId);
  if (open) {
    if (!open.duplicateStartEventIds.includes(input.startEventId))
      open.duplicateStartEventIds = [...open.duplicateStartEventIds, input.startEventId];
    return saveStore(store) ? open : null;
  }
  const occurrence: TrainingOccurrence = {
    trainingOccurrenceId: input.startEventId,
    planSlotId: input.planSlotId,
    sessionId: input.sessionId,
    startEventId: input.startEventId,
    trainingPlanSnapshotId: null,
    planKnowledge: "UNKNOWN",
    lifecycle: "IN_PROGRESS",
    outcome: "UNKNOWN",
    reason: "UNKNOWN",
    startedAt: input.startedAt,
    endedAt: null,
    closeEventId: null,
    duplicateCloseEventIds: [],
    duplicateStartEventIds: [],
    futureLinks: emptyLinks(),
  };
  store.occurrences = [...store.occurrences, occurrence];
  if (!saveStore(store)) return null;
  freezeRunningPlanOnStart({
    trainingOccurrenceId: input.startEventId,
    planSlotId: input.planSlotId,
    runningPlanId: input.runningPlanId,
    capturedAt: input.startedAt ?? "",
  });
  const session = readableSession(input.plan);
  if (!session) return occurrence;
  const snapshot = buildOriginalPlanSnapshot(session, input.startedAt ?? "");
  const persist = input.persistSnapshot ?? (() => true);
  if (!persist(snapshot)) return occurrence;
  const saved = loadStore();
  const current = saved.occurrences.find(
    (item) => item.trainingOccurrenceId === occurrence.trainingOccurrenceId,
  );
  if (!current || current.trainingPlanSnapshotId) return current ?? occurrence;
  current.trainingPlanSnapshotId = snapshot.snapshotId;
  current.planKnowledge = "KNOWN";
  saved.trainingPlans = [...saved.trainingPlans, snapshot];
  return saveStore(saved) ? current : occurrence;
}

export function markOccurrenceClosed(
  trainingOccurrenceId: string,
  close: { kind: "COMPLETED" | "INTERRUPTED"; endedAt: string | null },
): TrainingOccurrence | null {
  const store = loadStore();
  const current = store.occurrences.find(
    (item) => item.trainingOccurrenceId === trainingOccurrenceId,
  );
  if (!current) return null;
  if (current.lifecycle !== "IN_PROGRESS") return current;
  current.lifecycle = close.kind;
  current.outcome = close.kind;
  current.reason = "UNKNOWN";
  current.endedAt = close.endedAt;
  return saveStore(store) ? current : null;
}

type CloseEvent = {
  event_id?: string;
  event_type: string;
  timestamp?: string;
  athlete_id?: string;
  payload?: Record<string, unknown>;
};

function closeKind(
  event: CloseEvent,
): "COMPLETED" | "INTERRUPTED" | "UNCLASSIFIED_CLOSE" | "IGNORE" | null {
  const payload = event.payload ?? {};
  if (event.event_type === "TRAINING_COMPLETED" && typeof payload.feel === "string")
    return "IGNORE";
  if (event.event_type === "TRAINING_INTERRUPTED" && typeof payload.decisionId !== "string")
    return "IGNORE";
  if (event.event_type !== "TRAINING_COMPLETED" && event.event_type !== "TRAINING_INTERRUPTED")
    return null;
  if (event.event_type === "TRAINING_INTERRUPTED") return "INTERRUPTED";
  if ("setsCompleted" in payload || "interruptions" in payload || "actual" in payload)
    return "COMPLETED";
  return "UNCLASSIFIED_CLOSE";
}

export function closeTrainingOccurrence(event: CloseEvent): TrainingOccurrence | null {
  const kind = closeKind(event);
  const sessionId = typeof event.payload?.sessionId === "string" ? event.payload.sessionId : "";
  if (!kind || kind === "IGNORE" || !sessionId) return openOccurrence(loadStore(), sessionId);
  const store = loadStore();
  const athleteId = event.athlete_id ?? currentAthleteId(), events = loadEvents();
  const boundId = typeof event.payload?.trainingOccurrenceId === 'string' ? event.payload.trainingOccurrenceId : null;
  const eligible = store.occurrences.filter(item => item.sessionId === sessionId && sameOccurrenceOwner(item, athleteId, events));
  const target = boundId !== null ? eligible.find(item => item.trainingOccurrenceId === boundId) ?? null
    : [...eligible].reverse().find(item => item.lifecycle === 'IN_PROGRESS') ?? eligible.at(-1) ?? null;
  if (!target) return null;
  const open = target.lifecycle === 'IN_PROGRESS';
  if (!open) {
    const ids = target.duplicateCloseEventIds ?? [];
    const id = event.event_id ?? "";
    if (id && id === target.closeEventId) return target;
    target.lifecycle = "DUPLICATE_CLOSE";
    target.outcome = "UNKNOWN";
    target.reason = "UNKNOWN";
    target.endedAt = null;
    if (id && id !== target.closeEventId && !ids.includes(id))
      target.duplicateCloseEventIds = [...ids, id];
    return saveStore(store) ? target : null;
  }
  target.lifecycle = kind;
  target.outcome = kind === "UNCLASSIFIED_CLOSE" ? "UNKNOWN" : kind;
  target.reason = "UNKNOWN";
  target.endedAt =
    kind === "UNCLASSIFIED_CLOSE"
      ? null
      : typeof event.timestamp === "string"
        ? event.timestamp
        : null;
  target.closeEventId = event.event_id ?? null;
  return saveStore(store) ? target : null;
}

export function attemptsForOccurrence(
  trainingOccurrenceId: string,
  events: CloseEvent[],
): CloseEvent[] {
  const occurrence = getTrainingOccurrence(trainingOccurrenceId);
  if (!occurrence) return [];
  const startAt = events.findIndex((event) => event.event_id === occurrence.startEventId);
  if (startAt < 0) return [];
  const nextStart = listTrainingOccurrences()
    .filter(
      (item) =>
        item.sessionId === occurrence.sessionId &&
        item.trainingOccurrenceId !== occurrence.trainingOccurrenceId,
    )
    .map((item) => events.findIndex((event) => event.event_id === item.startEventId))
    .filter((index) => index > startAt)
    .sort((left, right) => left - right)[0];
  const endAt = nextStart ?? events.length;
  let window = events.slice(startAt + 1, endAt);
  const closeAt = occurrence.closeEventId
    ? window.findIndex((event) => event.event_id === occurrence.closeEventId)
    : -1;
  if (occurrence.lifecycle !== "IN_PROGRESS") {
    if (closeAt < 0) return [];
    window = window.slice(0, closeAt);
  }
  return window.filter(
    (event) =>
      event.event_type === "TRAINING_SET_COMPLETED" &&
      event.payload?.sessionId === occurrence.sessionId,
  );
}

export function trainingFact(trainingOccurrenceId: string, events: CloseEvent[]) {
  return loadTrainingFact(trainingOccurrenceId, events);
}

export function trainingCompletion(
  trainingOccurrenceId: string,
  events: CloseEvent[],
): {
  plannedSetCount: number | null;
  completedSetCount: number | null;
  completionRatio: number | null;
} | null {
  const fact = trainingFact(trainingOccurrenceId, events);
  if (!fact) return null;
  return {
    plannedSetCount: fact.plannedSetCount,
    completedSetCount: fact.completedSetCount,
    completionRatio: fact.completionRatio,
  };
}
