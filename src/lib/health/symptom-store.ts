import { r5ScopeReady } from "../coach/r5/scope";
/** Append-only symptom metadata, projected into the existing response/safety chain. */
import { currentAthleteId } from "../core/events";
import { appendJournal, readJournal } from "../core/storage-journal";
import { healthChanged, validDay } from "./observation";
import type { EvidenceRef, ResponseFact, Region } from "./analysis-contract";
import { regionFromExplicitLabel } from "./recovery-host-u11";
export type SymptomInput = {
  kind: "PAIN" | "SORENESS";
  region: string;
  side: "LEFT" | "RIGHT" | "BILATERAL" | "UNSPECIFIED";
  severity: number | null;
  durationHours: number | null;
  trigger: string | null;
  functionImpact: "NORMAL" | "LIMITED" | "UNABLE" | "UNKNOWN";
  trend: "WORSENING" | "STABLE" | "IMPROVING" | "UNKNOWN";
  notes: string;
  occurredAt: string;
  trainingRefs: EvidenceRef[];
};
export type SymptomRow = SymptomInput & {
  id: string;
  revision: number;
  athleteId: string;
  recordedAt: string;
  retracted: boolean;
  source: "USER_CONFIRMED";
};
const prefix = () => `fk-symptoms-r5:${encodeURIComponent(currentAthleteId())}:`;
function valid(v: SymptomInput, now: string) {
  return (
    v &&
    ["PAIN", "SORENESS"].includes(v.kind) &&
    typeof v.region === "string" &&
    v.region.trim().length > 0 &&
    v.region.length <= 40 &&
    ["LEFT", "RIGHT", "BILATERAL", "UNSPECIFIED"].includes(v.side) &&
    (v.severity === null || (Number.isFinite(v.severity) && v.severity >= 0 && v.severity <= 10)) &&
    (v.durationHours === null || (Number.isFinite(v.durationHours) && v.durationHours >= 0)) &&
    ["NORMAL", "LIMITED", "UNABLE", "UNKNOWN"].includes(v.functionImpact) &&
    ["WORSENING", "STABLE", "IMPROVING", "UNKNOWN"].includes(v.trend) &&
    typeof v.notes === "string" &&
    v.notes.length <= 1000 &&
    (v.trigger === null || (typeof v.trigger === "string" && v.trigger.length <= 160)) &&
    Array.isArray(v.trainingRefs) &&
    v.trainingRefs.every(
      (r) => typeof r.id === "string" && Number.isSafeInteger(r.revision) && r.revision >= 0,
    ) &&
    Number.isFinite(Date.parse(v.occurredAt)) &&
    Number.isFinite(Date.parse(now)) &&
    Date.parse(v.occurredAt) <= Date.parse(now)
  );
}
export function symptomHistory(asOf = new Date().toISOString()): SymptomRow[] {
  if (!r5ScopeReady()) return [];
  if (!Number.isFinite(Date.parse(asOf))) throw Error("症状读取时间无效");
  return readJournal<SymptomRow>(prefix())
    .map((x) => x.data)
    .filter(
      (x) =>
        x?.athleteId === currentAthleteId() &&
        valid(x, asOf) &&
        Number.isFinite(Date.parse(x.recordedAt)) &&
        Date.parse(x.recordedAt) <= Date.parse(asOf),
    )
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.revision - b.revision);
}
export function readSymptoms(asOf = new Date().toISOString()): SymptomRow[] {
  const latest = new Map<string, SymptomRow>();
  for (const row of symptomHistory(asOf))
    if (!latest.has(row.id) || latest.get(row.id)!.revision < row.revision) latest.set(row.id, row);
  return [...latest.values()]
    .filter((x) => !x.retracted)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}
export function appendSymptom(
  input: SymptomInput,
  now = new Date().toISOString(),
  id: string = crypto.randomUUID(),
) {
  if (!r5ScopeReady() || !valid(input, now) || !id || symptomHistory(now).some((x) => x.id === id))
    return { ok: false as const, message: "症状内容、时间或重复标识需核对" };
  const row: SymptomRow = {
    ...structuredClone(input),
    id,
    revision: 0,
    athleteId: currentAthleteId(),
    recordedAt: now,
    retracted: false,
    source: "USER_CONFIRMED",
  };
  const saved = appendJournal(prefix(), `${id}@0`, row);
  if (saved) healthChanged();
  return saved
    ? { ok: true as const, row }
    : { ok: false as const, message: "症状保存失败，未报告成功" };
}
export function reviseSymptom(
  id: string,
  expectedRevision: number,
  patch: Partial<SymptomInput>,
  retract = false,
  now = new Date().toISOString(),
) {
  const old = readSymptoms(now).find((x) => x.id === id);
  if (!old || old.revision !== expectedRevision)
    return { ok: false as const, message: "记录已更正、撤回或不属于当前用户，请重新读取" };
  const next: SymptomRow = {
    ...old,
    ...patch,
    id,
    athleteId: old.athleteId,
    revision: old.revision + 1,
    recordedAt: now,
    retracted: retract,
    source: "USER_CONFIRMED",
  };
  if (!valid(next, now)) return { ok: false as const, message: "更正内容无效" };
  const saved = appendJournal(prefix(), `${id}@${next.revision}`, next);
  if (saved) healthChanged();
  return saved ? { ok: true as const, row: next } : { ok: false as const, message: "更正保存失败" };
}
/** Preserve the user's anatomical label even if the old muscle catalogue has no match. */
export function symptomResponses(rows: SymptomRow[]): ResponseFact[] {
  return rows.flatMap((r) => {
    const region: Region | null = regionFromExplicitLabel(r.region) ?? null;
    const base = {
      id: `symptom:${r.id}`,
      revision: r.revision,
      athleteId: r.athleteId,
      provider: "MANUAL" as const,
      accountRef: null,
      deviceId: null,
      protocolKey: "SYMPTOM_R5",
      sourceRecordId: r.id,
      occurredAt: r.occurredAt,
      knownAt: r.recordedAt,
      receivedAt: r.recordedAt,
      sourceTimeZone: null,
      status: "CONFIRMED" as const,
      quality: "PARTIAL" as const,
      ownershipReceiptId: null,
      kind: "RESPONSE" as const,
      relatedTrainingRefs: r.trainingRefs,
      region,
      side: r.side,
      observationProtocol: "SYMPTOM_R5",
      elapsedHours: r.durationHours,
      functionTaskId: null,
      notes: `${r.region}；诱发：${r.trigger ?? "未知"}；趋势：${r.trend}；${r.notes}`,
    };
    return [
      { ...base, measure: r.kind, value: r.severity, scale: "0-10_HIGH_WORSE" },
      ...(r.functionImpact === "UNKNOWN"
        ? []
        : [
            {
              ...base,
              id: base.id + ":function",
              measure: "FUNCTION" as const,
              value: r.functionImpact === "NORMAL" ? 0 : 1,
              scale: "FUNCTION_LIMITATION_0_1",
            },
          ]),
    ];
  });
}
export const symptomDay = (r: SymptomRow) => {
  const d = r.occurredAt.slice(0, 10);
  return validDay(d) ? d : "";
};
