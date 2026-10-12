import { appendJournal, readJournal } from "./storage-journal.ts";
import type { AppEvent } from "./types.ts";
import type { TrainingOccurrence } from "./occurrence.ts";
import type { RunningPlan, RunningPlanSnapshot } from "./running-plan.ts";

export const RUNNING_TRANSACTION_PREFIX = "fr255-running-tx-r3:";
export type RunningFeedback = {
  id: string;
  trainingOccurrenceId: string;
  recordedAt: string;
  source: "USER_CONFIRMED";
  rpe: number | null;
  pain: number | null;
  recovery: number | null;
  horizon: "SESSION" | "24H" | "48H";
};
export type RunningTransaction = {
  version: 1;
  id: string;
  events: AppEvent[];
  plans?: { plan: RunningPlan; previous: string | null }[];
  snapshots?: RunningPlanSnapshot[];
  starts?: TrainingOccurrence[];
  close?: { occurrenceId: string; eventId: string; at: string; kind: "COMPLETED" | "INTERRUPTED" };
  feedback?: RunningFeedback[];
};
/** One immutable physical write is the commit point; there are no partially visible staged keys.
 * Readers project the same bundle. The legacy envelopes are never overwritten by this path. */
export function loadRunningTransactions(): RunningTransaction[] {
  return readJournal<RunningTransaction>(RUNNING_TRANSACTION_PREFIX)
    .map((x) => x.data)
    .filter(validRunningTransaction);
}
export function commitRunningTransaction(tx: RunningTransaction): boolean {
  return validRunningTransaction(tx) && appendJournal(RUNNING_TRANSACTION_PREFIX, tx.id, tx);
}
export function runningFeedback(): RunningFeedback[] {
  return loadRunningTransactions().flatMap((t) => t.feedback ?? []);
}
export function explainRunningFeedback(occurrenceId?: string): string {
  const records = runningFeedback().filter(
    (x) => !occurrenceId || x.trainingOccurrenceId === occurrenceId,
  );
  if (!records.length) return "训练反馈未知；缺失不代表恢复正常。";
  const facts = records.map(
    (x) =>
      `[${x.id}] 训练${x.trainingOccurrenceId}，${x.horizon}，用户确认：RPE ${x.rpe ?? "未知"}，疼痛 ${x.pain ?? "未知"}，恢复 ${x.recovery ?? "未知"}`,
  );
  const grouped = new Map<string, Set<string>>();
  for (const x of records) {
    const key = x.trainingOccurrenceId + ":" + x.horizon;
    const values = grouped.get(key) ?? new Set();
    values.add(JSON.stringify([x.rpe, x.pain, x.recovery]));
    grouped.set(key, values);
  }
  const conflict = [...grouped.values()].some((x) => x.size > 1);
  const caution = records.some(
    (x) => (x.rpe ?? 0) >= 8 || (x.pain ?? 0) > 0 || (x.recovery != null && x.recovery <= 3),
  );
  return (
    facts.join("；") +
    "。" +
    (conflict
      ? "同次同阶段反馈冲突，保留全部来源，不平均、不选择代表；先核对更正。"
      : caution
        ? "已有高用力、疼痛或低恢复线索；下次分析需先核对当前症状与恢复，不自动增加强度/训练量。"
        : "反馈仅为自报线索；未确认同课条件，不推断能力提升或恢复正常。") +
    "24h/48h尚未记录的观察仍为未知。"
  );
}

export function validRunningTransaction(x: RunningTransaction): boolean {
  if (
    x?.version !== 1 ||
    typeof x.id !== "string" ||
    !Array.isArray(x.events) ||
    !x.events.every(
      (e) =>
        e &&
        typeof e.event_id === "string" &&
        typeof e.event_type === "string" &&
        typeof e.timestamp === "string" &&
        e.payload &&
        typeof e.payload === "object",
    )
  )
    return false;
  if (x.snapshots && !Array.isArray(x.snapshots)) return false;
  if (
    x.starts &&
    (!Array.isArray(x.starts) ||
      !x.starts.every(
        (s) =>
          s &&
          typeof s.trainingOccurrenceId === "string" &&
          x.events.some(
            (e) =>
              e.event_type === "TRAINING_STARTED" &&
              e.event_id === s.startEventId &&
              s.trainingOccurrenceId === e.event_id,
          ) &&
          x.snapshots?.some(
            (n) => n.trainingOccurrenceId === s.trainingOccurrenceId && Array.isArray(n.components),
          ),
      ))
  )
    return false;
  if (
    x.snapshots &&
    (!Array.isArray(x.snapshots) ||
      !x.snapshots.every(
        (s) =>
          s &&
          typeof s.trainingOccurrenceId === "string" &&
          typeof s.runningSnapshotId === "string" &&
          Array.isArray(s.components),
      ))
  )
    return false;
  if (
    x.plans &&
    (!Array.isArray(x.plans) ||
      !x.plans.every(
        (o) =>
          o &&
          typeof o.plan?.planId === "string" &&
          Array.isArray(o.plan.components) &&
          (o.previous === null || typeof o.previous === "string"),
      ))
  )
    return false;
  if (
    x.close &&
    (!["COMPLETED", "INTERRUPTED"].includes(x.close.kind) ||
      typeof x.close.occurrenceId !== "string" ||
      typeof x.close.at !== "string")
  )
    return false;
  if (
    x.close &&
    !x.events.some(
      (e) =>
        e.event_id === x.close?.eventId &&
        e.payload.trainingOccurrenceId === x.close.occurrenceId &&
        e.event_type ===
          (x.close.kind === "COMPLETED" ? "TRAINING_COMPLETED" : "TRAINING_INTERRUPTED"),
    )
  )
    return false;
  if (
    x.feedback &&
    (!Array.isArray(x.feedback) ||
      !x.feedback.every(
        (f) =>
          f &&
          typeof f.id === "string" &&
          typeof f.trainingOccurrenceId === "string" &&
          f.source === "USER_CONFIRMED" &&
          Number.isFinite(Date.parse(f.recordedAt)) &&
          [f.rpe, f.recovery].every(
            (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10),
          ) &&
          (f.pain === null ||
            (typeof f.pain === "number" &&
              Number.isFinite(f.pain) &&
              f.pain >= 0 &&
              f.pain <= 10)) &&
          ["SESSION", "24H", "48H"].includes(f.horizon),
      ))
  )
    return false;
  return true;
}
