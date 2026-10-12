import { commitRunningTransaction, loadRunningTransactions } from "./running-transaction.ts";
import { readEnvelope } from "./storage.ts";

export const RUNNING_PLAN_KEY = "fr255-running-plan-v1";
export const RUNNING_PLAN_SCHEMA_VERSION = 1 as const;

export const RUNNING_PURPOSES = [
  "UNSPECIFIED",
  "WARMUP",
  "EASY_AEROBIC",
  "LONG",
  "TEMPO_THRESHOLD",
  "INTERVAL",
  "REPETITION_SPEED",
  "HILL",
  "RACE",
  "COOLDOWN",
  "OTHER",
] as const;

export type RunningPurpose = (typeof RUNNING_PURPOSES)[number];

export type ContinuousRun = {
  kind: "CONTINUOUS";
  plannedDistanceMeters: number | null;
  plannedDistanceMaxMeters: number | null;
  plannedDurationSeconds: number | null;
};

export type RunningStep = {
  stepId: string;
  plannedDistanceMeters: number | null;
  plannedDurationSeconds: number | null;
  repeatCount: number;
  recoveryAfterRepeatSeconds: number | null;
  recoveryBeforeNextStepSeconds: number | null;
};

export type RunningBlock = {
  blockId: string;
  roundCount: number;
  steps: RunningStep[];
  recoveryAfterRoundSeconds: number | null;
};

export type RepeatedRun = {
  kind: "REPEATED";
  blocks: RunningBlock[];
};

export type RunningComponent = {
  componentId: string;
  modality: "RUNNING";
  purpose: RunningPurpose;
  structure: ContinuousRun | RepeatedRun;
};

export type StrengthComponent = {
  componentId: string;
  modality: "STRENGTH";
  strengthSessionId: string;
};

export type SessionComponent = RunningComponent | StrengthComponent;

export type RunningPlan = {
  runningPlanSchemaVersion: typeof RUNNING_PLAN_SCHEMA_VERSION;
  planId: string;
  planSlotId: string;
  components: SessionComponent[];
};

export type RunningPlanSnapshot = {
  runningPlanSchemaVersion: typeof RUNNING_PLAN_SCHEMA_VERSION;
  runningSnapshotId: string;
  capturedAt: string;
  trainingOccurrenceId: string;
  sourcePlanId: string;
  components: SessionComponent[];
};

type RunningStore = {
  plans: RunningPlan[];
  snapshots: RunningPlanSnapshot[];
};

export type RunningPlanSave = { ok: true; plan: RunningPlan } | { ok: false; errors: string[] };

function emptyStore(): RunningStore {
  return { plans: [], snapshots: [] };
}

function loadStore(): RunningStore {
  const raw = readEnvelope<RunningStore>(RUNNING_PLAN_KEY, emptyStore()).data;
  const data = raw && Array.isArray(raw.plans) && Array.isArray(raw.snapshots) ? raw : emptyStore();
  const plans = new Map(data.plans.map((p) => [p.planId, p]));
  const conflicts = new Set<string>();
  const snapshots = new Map(data.snapshots.map((s) => [s.trainingOccurrenceId, s]));
  const snapshotConflicts = new Set<string>();
  for (const tx of loadRunningTransactions()) {
    for (const op of tx.plans ?? []) {
      const previous = plans.get(op.plan.planId);
      if (conflicts.has(op.plan.planId)) continue;
      if ((previous ? JSON.stringify(previous) : null) !== op.previous) {
        conflicts.add(op.plan.planId);
        plans.delete(op.plan.planId);
        continue;
      }
      plans.set(op.plan.planId, op.plan);
    }
    for (const snap of tx.snapshots ?? []) {
      const previous = snapshots.get(snap.trainingOccurrenceId);
      if (snapshotConflicts.has(snap.trainingOccurrenceId)) continue;
      if (previous && JSON.stringify(previous) !== JSON.stringify(snap)) {
        snapshotConflicts.add(snap.trainingOccurrenceId);
        snapshots.delete(snap.trainingOccurrenceId);
      } else snapshots.set(snap.trainingOccurrenceId, snap);
    }
  }
  return { plans: [...plans.values()], snapshots: [...snapshots.values()] };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newSnapshotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return `run-snap-${crypto.randomUUID()}`;
  return `run-snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function integerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function optionalDose(value: unknown, label: string, errors: string[]): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(label);
    return null;
  }
  return value;
}

function optionalRecovery(value: unknown, label: string, errors: string[]): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(label);
    return null;
  }
  return value;
}

export function validateRunningComponents(
  components: unknown,
): { ok: true; components: SessionComponent[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(components) || components.length === 0)
    return { ok: false, errors: ["components"] };
  const componentIds = new Set<string>();
  const blockIds = new Set<string>();
  const stepIds = new Set<string>();
  const normalized: SessionComponent[] = [];
  for (const item of components) {
    if (!item || typeof item !== "object") {
      errors.push("component");
      continue;
    }
    const component = item as Record<string, unknown>;
    if (
      typeof component.componentId !== "string" ||
      component.componentId.length === 0 ||
      componentIds.has(component.componentId)
    )
      errors.push("componentId");
    else componentIds.add(component.componentId);
    if (component.modality === "STRENGTH") {
      if (
        typeof component.strengthSessionId !== "string" ||
        component.strengthSessionId.length === 0
      )
        errors.push("strengthSessionId");
      normalized.push({
        componentId: String(component.componentId ?? ""),
        modality: "STRENGTH",
        strengthSessionId: String(component.strengthSessionId ?? ""),
      });
      continue;
    }
    if (component.modality !== "RUNNING") errors.push("modality");
    const purpose = component.purpose == null ? "UNSPECIFIED" : component.purpose;
    if (typeof purpose !== "string" || !RUNNING_PURPOSES.includes(purpose as RunningPurpose))
      errors.push("purpose");
    const structure = component.structure;
    if (!structure || typeof structure !== "object") {
      errors.push("structure");
      continue;
    }
    const kind = (structure as { kind?: unknown }).kind;
    if (kind === "CONTINUOUS") {
      const source = structure as Record<string, unknown>;
      const plannedDistanceMeters = optionalDose(
        source.plannedDistanceMeters,
        "plannedDistanceMeters",
        errors,
      );
      const plannedDurationSeconds = optionalDose(
        source.plannedDurationSeconds,
        "plannedDurationSeconds",
        errors,
      );
      const plannedDistanceMaxMeters = optionalDose(
        source.plannedDistanceMaxMeters,
        "plannedDistanceMaxMeters",
        errors,
      );
      if (
        plannedDistanceMaxMeters != null &&
        (plannedDistanceMeters == null || plannedDistanceMaxMeters < plannedDistanceMeters)
      )
        errors.push("plannedDistanceMaxMeters");
      normalized.push({
        componentId: String(component.componentId ?? ""),
        modality: "RUNNING",
        purpose: purpose as RunningPurpose,
        structure: {
          kind: "CONTINUOUS",
          plannedDistanceMeters,
          plannedDistanceMaxMeters,
          plannedDurationSeconds,
        },
      });
      continue;
    }
    if (kind !== "REPEATED") {
      errors.push("structure");
      continue;
    }
    const blocks = (structure as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      errors.push("blocks");
      continue;
    }
    const nextBlocks: RunningBlock[] = [];
    for (const blockValue of blocks) {
      if (!blockValue || typeof blockValue !== "object") {
        errors.push("block");
        continue;
      }
      const block = blockValue as Record<string, unknown>;
      if (
        typeof block.blockId !== "string" ||
        block.blockId.length === 0 ||
        blockIds.has(block.blockId)
      )
        errors.push("blockId");
      else blockIds.add(block.blockId);
      if (!integerAtLeast(block.roundCount, 1)) errors.push("roundCount");
      const recoveryAfterRoundSeconds = optionalRecovery(
        block.recoveryAfterRoundSeconds,
        "recoveryAfterRoundSeconds",
        errors,
      );
      if (block.roundCount === 1 && recoveryAfterRoundSeconds != null)
        errors.push("recoveryAfterRoundSeconds");
      const steps = block.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        errors.push("steps");
        continue;
      }
      const nextSteps: RunningStep[] = [];
      steps.forEach((stepValue, index) => {
        if (!stepValue || typeof stepValue !== "object") {
          errors.push("step");
          return;
        }
        const step = stepValue as Record<string, unknown>;
        if (typeof step.stepId !== "string" || step.stepId.length === 0 || stepIds.has(step.stepId))
          errors.push("stepId");
        else stepIds.add(step.stepId);
        if (!integerAtLeast(step.repeatCount, 1)) errors.push("repeatCount");
        const plannedDistanceMeters = optionalDose(
          step.plannedDistanceMeters,
          "plannedDistanceMeters",
          errors,
        );
        const plannedDurationSeconds = optionalDose(
          step.plannedDurationSeconds,
          "plannedDurationSeconds",
          errors,
        );
        if (plannedDistanceMeters == null && plannedDurationSeconds == null)
          errors.push("stepDose");
        const recoveryAfterRepeatSeconds = optionalRecovery(
          step.recoveryAfterRepeatSeconds,
          "recoveryAfterRepeatSeconds",
          errors,
        );
        const recoveryBeforeNextStepSeconds = optionalRecovery(
          step.recoveryBeforeNextStepSeconds,
          "recoveryBeforeNextStepSeconds",
          errors,
        );
        if (step.repeatCount === 1 && recoveryAfterRepeatSeconds != null)
          errors.push("recoveryAfterRepeatSeconds");
        if (index === steps.length - 1 && recoveryBeforeNextStepSeconds != null)
          errors.push("recoveryBeforeNextStepSeconds");
        nextSteps.push({
          stepId: String(step.stepId ?? ""),
          plannedDistanceMeters,
          plannedDurationSeconds,
          repeatCount: typeof step.repeatCount === "number" ? step.repeatCount : 0,
          recoveryAfterRepeatSeconds,
          recoveryBeforeNextStepSeconds,
        });
      });
      nextBlocks.push({
        blockId: String(block.blockId ?? ""),
        roundCount: typeof block.roundCount === "number" ? block.roundCount : 0,
        steps: nextSteps,
        recoveryAfterRoundSeconds,
      });
    }
    normalized.push({
      componentId: String(component.componentId ?? ""),
      modality: "RUNNING",
      purpose: purpose as RunningPurpose,
      structure: { kind: "REPEATED", blocks: nextBlocks },
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, components: normalized };
}

export function saveRunningPlan(input: {
  planId: string;
  planSlotId: string;
  components: unknown;
}): RunningPlanSave {
  if (
    typeof input.planId !== "string" ||
    input.planId.length === 0 ||
    typeof input.planSlotId !== "string" ||
    input.planSlotId.length === 0
  )
    return { ok: false, errors: ["planId"] };
  const validated = validateRunningComponents(input.components);
  if (!validated.ok) return validated;
  const plan: RunningPlan = {
    runningPlanSchemaVersion: RUNNING_PLAN_SCHEMA_VERSION,
    planId: input.planId,
    planSlotId: input.planSlotId,
    components: validated.components,
  };
  const store = loadStore();
  const previous = store.plans.find((p) => p.planId === plan.planId);
  if (
    !commitRunningTransaction({
      version: 1,
      id: crypto.randomUUID(),
      events: [],
      plans: [{ plan, previous: previous ? JSON.stringify(previous) : null }],
    })
  )
    return { ok: false, errors: ["storage-unconfirmed"] };
  if (JSON.stringify(getRunningPlan(plan.planId)) !== JSON.stringify(plan))
    return { ok: false, errors: ["concurrent-plan-conflict"] };
  return { ok: true, plan };
}

export function listRunningPlans(): RunningPlan[] {
  return loadStore().plans;
}

export function getRunningPlan(planId: string): RunningPlan | null {
  return loadStore().plans.find((item) => item.planId === planId) ?? null;
}

export function getRunningPlanSnapshot(trainingOccurrenceId: string): RunningPlanSnapshot | null {
  return (
    loadStore().snapshots.find((item) => item.trainingOccurrenceId === trainingOccurrenceId) ?? null
  );
}

export function freezeRunningPlanOnStart(input: {
  trainingOccurrenceId: string;
  planSlotId: string;
  runningPlanId?: string | null;
  capturedAt: string;
}): RunningPlanSnapshot | null {
  const existing = getRunningPlanSnapshot(input.trainingOccurrenceId);
  if (existing) return existing;
  const store = loadStore();
  const chosen = input.runningPlanId
    ? (store.plans.find((item) => item.planId === input.runningPlanId) ?? null)
    : store.plans.filter((item) => item.planSlotId === input.planSlotId).length === 1
      ? (store.plans.find((item) => item.planSlotId === input.planSlotId) ?? null)
      : null;
  if (!chosen) return null;
  const validated = validateRunningComponents(chosen.components);
  if (!validated.ok) return null;
  const snapshot: RunningPlanSnapshot = {
    runningPlanSchemaVersion: RUNNING_PLAN_SCHEMA_VERSION,
    runningSnapshotId: newSnapshotId(),
    capturedAt: input.capturedAt,
    trainingOccurrenceId: input.trainingOccurrenceId,
    sourcePlanId: chosen.planId,
    components: clone(validated.components),
  };
  store.snapshots = [...store.snapshots, snapshot];
  return commitRunningTransaction({
    version: 1,
    id: crypto.randomUUID(),
    events: [],
    snapshots: [snapshot],
  })
    ? snapshot
    : null;
}
