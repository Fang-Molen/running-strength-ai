import {
  RUNNING_TRANSACTION_PREFIX,
  validRunningTransaction,
  type RunningTransaction,
} from "./running-transaction.ts";
import { readEnvelope } from "./storage.ts";
import { appendJournal, readJournal } from "./storage-journal.ts";
import {
  SCHEMA_VERSION,
  type AppEvent,
  type DataQuality,
  type EventSource,
  type EventType,
} from "./types.ts";

export const EVENTS_KEY = "fr255-events-v1";
export const EVENT_JOURNAL_PREFIX = "fr255-event-journal-v2:";

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();
let watchingStorage = false;
export function notifyCommittedEvent(event: AppEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* listener isolation */
    }
  }
}
function refreshFromStorage(change: StorageEvent) {
  if (change.key?.startsWith(RUNNING_TRANSACTION_PREFIX) && change.newValue) {
    try {
      const record = JSON.parse(change.newValue) as { data?: RunningTransaction };
      if (record.data && validRunningTransaction(record.data))
        record.data.events.forEach(notifyCommittedEvent);
    } catch {
      /* invalid transaction is not a notification */
    }
    return;
  }
  if (!change.key?.startsWith(EVENT_JOURNAL_PREFIX) || !change.newValue) return;
  try {
    const record = JSON.parse(change.newValue) as { data?: AppEvent };
    if (
      record.data &&
      typeof record.data.event_id === "string" &&
      typeof record.data.event_type === "string"
    )
      notifyCommittedEvent(record.data);
  } catch {
    /* invalid external records are not notifications */
  }
}
let contextProvider: () => Record<string, unknown> = () => ({});
let athleteId = "local";
let cycleId = "local-cycle";

export function setEventContext(input: {
  athleteId?: string;
  cycleId?: string;
  context?: () => Record<string, unknown>;
}) {
  if (input.athleteId) athleteId = input.athleteId;
  if (input.cycleId) cycleId = input.cycleId;
  if (input.context) contextProvider = input.context;
}

export function onAppEvent(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined" && !watchingStorage) {
    window.addEventListener("storage", refreshFromStorage);
    watchingStorage = true;
  }
  return () => {
    listeners.delete(listener);
    if (watchingStorage && listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", refreshFromStorage);
      watchingStorage = false;
    }
  };
}

export function loadEvents(): AppEvent[] {
  const data = readEnvelope<AppEvent[]>(EVENTS_KEY, []).data;
  // Preserve every legacy record, including duplicate/conflicting IDs. Only deduplicate identical retransmissions.
  const legacy = Array.isArray(data) ? data : [];
  const seen = new Set(legacy.map((e) => JSON.stringify(e)));
  const committed = [
    ...readJournal<AppEvent>(EVENT_JOURNAL_PREFIX).map((r) => ({
      order: r.order,
      id: r.id,
      index: 0,
      event: r.data,
    })),
    ...readJournal<RunningTransaction>(RUNNING_TRANSACTION_PREFIX)
      .filter((r) => validRunningTransaction(r.data))
      .flatMap((r) =>
        r.data.events.map((event, index) => ({ order: r.order, id: r.id, index, event })),
      ),
  ].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id) || a.index - b.index);
  const extra = committed
    .map((r) => r.event)
    .filter((e) => {
      const key = JSON.stringify(e);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [...legacy, ...extra];
}

function eventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function dispatchEvent<T extends Record<string, unknown>>(
  eventType: EventType,
  payload: T,
  options?: {
    source?: EventSource;
    confidence?: number;
    dataQuality?: DataQuality;
    cycleId?: string;
  },
): AppEvent<T> | null {
  try {
    const event = createAppEvent(eventType, payload, options);
    const saved = appendJournal(EVENT_JOURNAL_PREFIX, event.event_id, event);
    if (!saved) return null;
    notifyCommittedEvent(event);
    return event;
  } catch {
    return null;
  }
}

export function createAppEvent<T extends Record<string, unknown>>(
  eventType: EventType,
  payload: T,
  options?: {
    source?: EventSource;
    confidence?: number;
    dataQuality?: DataQuality;
    cycleId?: string;
  },
): AppEvent<T> {
  let context: Record<string, unknown> = {};
  try {
    context = contextProvider() ?? {};
  } catch {
    context = {};
  }
  return {
    event_id: eventId(),
    athlete_id: athleteId,
    timestamp: new Date().toISOString(),
    event_type: eventType,
    source: options?.source ?? "MANUAL",
    payload,
    confidence: options?.confidence ?? 1,
    data_quality: options?.dataQuality ?? "HIGH",
    context,
    cycle_id: options?.cycleId ?? cycleId,
    schema_version: SCHEMA_VERSION,
  };
}

export type CommittedEventRecord = { event: AppEvent; recordedAt: string | null; origin: "LEGACY" | "JOURNAL" | "RUNNING_TRANSACTION" };
/** Read-only: committed events with their journal commit time. Legacy rows have no commit time (null), never fabricated. */
export function loadCommittedEventRecords(): CommittedEventRecord[] {
  // Same ordering and retransmission dedupe as loadEvents(); only adds the commit time.
  const data = readEnvelope<AppEvent[]>(EVENTS_KEY, []).data;
  const legacy: CommittedEventRecord[] = (Array.isArray(data) ? data : []).map((event) => ({ event, recordedAt: null, origin: "LEGACY" }));
  const seen = new Set(legacy.map((r) => JSON.stringify(r.event)));
  const stamp = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const committed = [
    ...readJournal<AppEvent>(EVENT_JOURNAL_PREFIX).map((r) => ({ order: r.order, id: r.id, index: 0, rec: { event: r.data, recordedAt: stamp(r.recordedAt), origin: "JOURNAL" as const } })),
    ...readJournal<RunningTransaction>(RUNNING_TRANSACTION_PREFIX)
      .filter((r) => validRunningTransaction(r.data))
      .flatMap((r) => r.data.events.map((event, index) => ({ order: r.order, id: r.id, index, rec: { event, recordedAt: stamp(r.recordedAt), origin: "RUNNING_TRANSACTION" as const } }))),
  ].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id) || a.index - b.index);
  const extra = committed.map((r) => r.rec).filter((r) => { const key = JSON.stringify(r.event); if (seen.has(key)) return false; seen.add(key); return true; });
  return [...legacy, ...extra];
}
/** Read-only accessor for the athlete id stamped on new events (used to scope V4 formal rows). */
export function currentAthleteId(): string {
  return athleteId;
}
