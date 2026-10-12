import { projectTrainingLifecycle } from "./canonical.ts"
import { dispatchEvent } from "./events.ts"
import { getTrainingOccurrence, listTrainingOccurrences } from "./occurrence.ts"
import { getRunningPlanSnapshot, type RunningPlanSnapshot } from "./running-plan.ts"
import type { AppEvent } from "./types.ts"

export type RunningSlotStatus = "COMPLETED" | "SKIPPED" | "NOT_YET_RECORDED" | "NOT_RECORDED" | "DUPLICATE_UNRESOLVED"

export type RunningRepetitionIdentity = {
  trainingOccurrenceId: string
  runningSnapshotId: string
  componentId: string
  blockId: string
  stepId: string
  roundOrdinal: number
  repeatOrdinal: number
}

export type RunningRepetitionSlot = RunningRepetitionIdentity & {
  status: RunningSlotStatus
  plannedDistanceMeters: number | null
  plannedDurationSeconds: number | null
  actualDistanceMeters: number | null
  actualDurationSeconds: number | null
  sourceEventIds: string[]
  derivedPaceSecPerMeter: number | null
  paceDistanceSourceEventId: string | null
  paceDurationSourceEventId: string | null
}

export type RunningRepetitionProjection = {
  availability: "UNAVAILABLE" | "AVAILABLE"
  terminal: boolean
  slots: RunningRepetitionSlot[]
}

type LogEvent = { event_id?: string; event_type: string; payload?: Record<string, unknown> }

function ordinal(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null
}

function metric(value: unknown): number | null | undefined {
  if (value == null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

function repeatedStep(snapshot: RunningPlanSnapshot, identity: Pick<RunningRepetitionIdentity, "componentId" | "blockId" | "stepId" | "roundOrdinal" | "repeatOrdinal">) {
  const component = snapshot.components.find((item) => item.componentId === identity.componentId)
  if (!component || component.modality !== "RUNNING" || component.structure.kind !== "REPEATED") return null
  const block = component.structure.blocks.find((item) => item.blockId === identity.blockId)
  const step = block?.steps.find((item) => item.stepId === identity.stepId)
  if (!block || !step) return null
  if (identity.roundOrdinal > block.roundCount || identity.repeatOrdinal > step.repeatCount) return null
  return { step }
}

function acceptedIdentity(identity: RunningRepetitionIdentity): RunningPlanSnapshot | null {
  const occurrence = getTrainingOccurrence(identity.trainingOccurrenceId)
  const snapshot = getRunningPlanSnapshot(identity.trainingOccurrenceId)
  if (!occurrence || !snapshot || snapshot.runningSnapshotId !== identity.runningSnapshotId) return null
  if (!ordinal(identity.roundOrdinal) || !ordinal(identity.repeatOrdinal)) return null
  if (!repeatedStep(snapshot, identity)) return null
  return snapshot
}

export function recordRunningRepetitionCompleted(input: RunningRepetitionIdentity & { actualDistanceMeters?: number | null; actualDurationSeconds?: number | null }): AppEvent | null {
  if (!acceptedIdentity(input)) return null
  const actualDistanceMeters = metric(input.actualDistanceMeters)
  const actualDurationSeconds = metric(input.actualDurationSeconds)
  if (actualDistanceMeters === undefined || actualDurationSeconds === undefined) return null
  return dispatchEvent("RUNNING_REPETITION_COMPLETED", {
    trainingOccurrenceId: input.trainingOccurrenceId,
    runningSnapshotId: input.runningSnapshotId,
    componentId: input.componentId,
    blockId: input.blockId,
    stepId: input.stepId,
    roundOrdinal: input.roundOrdinal,
    repeatOrdinal: input.repeatOrdinal,
    actualDistanceMeters,
    actualDurationSeconds,
  })
}

export function recordRunningRepetitionSkipped(input: RunningRepetitionIdentity & { actualDistanceMeters?: number | null; actualDurationSeconds?: number | null }): AppEvent | null {
  if (!acceptedIdentity(input)) return null
  if (input.actualDistanceMeters != null || input.actualDurationSeconds != null) return null
  return dispatchEvent("RUNNING_REPETITION_SKIPPED", {
    trainingOccurrenceId: input.trainingOccurrenceId,
    runningSnapshotId: input.runningSnapshotId,
    componentId: input.componentId,
    blockId: input.blockId,
    stepId: input.stepId,
    roundOrdinal: input.roundOrdinal,
    repeatOrdinal: input.repeatOrdinal,
  })
}

function sameSlot(payload: Record<string, unknown>, slot: RunningRepetitionSlot): boolean {
  return payload.trainingOccurrenceId === slot.trainingOccurrenceId && payload.runningSnapshotId === slot.runningSnapshotId && payload.componentId === slot.componentId && payload.blockId === slot.blockId && payload.stepId === slot.stepId && payload.roundOrdinal === slot.roundOrdinal && payload.repeatOrdinal === slot.repeatOrdinal
}

function occurrenceEvents(trainingOccurrenceId: string, events: LogEvent[]): LogEvent[] {
  const occurrence = getTrainingOccurrence(trainingOccurrenceId)
  if (!occurrence) return []
  const startAt = events.findIndex((event) => event.event_id === occurrence.startEventId)
  const nextStart = listTrainingOccurrences()
    .filter((item) => item.sessionId === occurrence.sessionId && item.trainingOccurrenceId !== occurrence.trainingOccurrenceId)
    .map((item) => events.findIndex((event) => event.event_id === item.startEventId))
    .filter((index) => (startAt < 0 ? index >= 0 : index > startAt))
    .sort((left, right) => left - right)[0]
  if (startAt < 0) return events.slice(0, nextStart ?? events.length)
  return events.slice(startAt, nextStart ?? events.length)
}

function terminalBoundary(trainingOccurrenceId: string, events: LogEvent[]): boolean {
  const occurrence = getTrainingOccurrence(trainingOccurrenceId)
  if (!occurrence) return false
  const window = occurrenceEvents(trainingOccurrenceId, events)
  const withStart = window.some((event) => event.event_id === occurrence.startEventId || event.event_type === "TRAINING_STARTED")
    ? window
    : [{ event_type: "TRAINING_STARTED", payload: { sessionId: occurrence.sessionId } }, ...window]
  const lifecycle = projectTrainingLifecycle(withStart)
  return lifecycle === "COMPLETED" || lifecycle === "INTERRUPTED"
}

export function projectRunningRepetitions(trainingOccurrenceId: string, events: LogEvent[]): RunningRepetitionProjection {
  const snapshot = getRunningPlanSnapshot(trainingOccurrenceId)
  if (!snapshot || snapshot.trainingOccurrenceId !== trainingOccurrenceId) return { availability: "UNAVAILABLE", terminal: false, slots: [] }
  const terminal = terminalBoundary(trainingOccurrenceId, events)
  const slots: RunningRepetitionSlot[] = []
  for (const component of snapshot.components) {
    if (component.modality !== "RUNNING" || component.structure.kind !== "REPEATED") continue
    for (const block of component.structure.blocks) {
      for (let roundOrdinal = 1; roundOrdinal <= block.roundCount; roundOrdinal += 1) {
        for (const step of block.steps) {
          for (let repeatOrdinal = 1; repeatOrdinal <= step.repeatCount; repeatOrdinal += 1) {
            slots.push({
              trainingOccurrenceId,
              runningSnapshotId: snapshot.runningSnapshotId,
              componentId: component.componentId,
              blockId: block.blockId,
              stepId: step.stepId,
              roundOrdinal,
              repeatOrdinal,
              status: terminal ? "NOT_RECORDED" : "NOT_YET_RECORDED",
              plannedDistanceMeters: step.plannedDistanceMeters,
              plannedDurationSeconds: step.plannedDurationSeconds,
              actualDistanceMeters: null,
              actualDurationSeconds: null,
              sourceEventIds: [],
              derivedPaceSecPerMeter: null,
              paceDistanceSourceEventId: null,
              paceDurationSourceEventId: null,
            })
          }
        }
      }
    }
  }
  const window = occurrenceEvents(trainingOccurrenceId, events)
  for (const slot of slots) {
    const matched = window.filter((event) => (event.event_type === "RUNNING_REPETITION_COMPLETED" || event.event_type === "RUNNING_REPETITION_SKIPPED") && sameSlot(event.payload ?? {}, slot))
    if (matched.length === 0) continue
    slot.sourceEventIds = matched.map((event) => event.event_id ?? "").filter((id) => id.length > 0)
    if (matched.length > 1) {
      slot.status = "DUPLICATE_UNRESOLVED"
      continue
    }
    const event = matched[0]
    if (event?.event_type === "RUNNING_REPETITION_SKIPPED") {
      slot.status = "SKIPPED"
      continue
    }
    slot.status = "COMPLETED"
    const distance = metric(event?.payload?.actualDistanceMeters)
    const duration = metric(event?.payload?.actualDurationSeconds)
    slot.actualDistanceMeters = distance == null ? null : distance
    slot.actualDurationSeconds = duration == null ? null : duration
    if (distance != null && duration != null && event?.event_id) {
      slot.derivedPaceSecPerMeter = duration / distance
      slot.paceDistanceSourceEventId = event.event_id
      slot.paceDurationSourceEventId = event.event_id
    }
  }
  return { availability: "AVAILABLE", terminal, slots }
}

export type ContinuousStatus = "COMPLETED" | "NOT_YET_RECORDED" | "NOT_RECORDED" | "DUPLICATE_UNRESOLVED"

export type ContinuousExecution = {
  trainingOccurrenceId: string
  runningSnapshotId: string
  componentId: string
  status: ContinuousStatus
  plannedDistanceMeters: number | null
  plannedDistanceMaxMeters: number | null
  plannedDurationSeconds: number | null
  actualDistanceMeters: number | null
  actualDurationSeconds: number | null
  sourceEventIds: string[]
  derivedPaceSecPerMeter: number | null
  paceDistanceSourceEventId: string | null
  paceDurationSourceEventId: string | null
}

export type RecoveryKind = "AFTER_REPEAT" | "BEFORE_NEXT_STEP" | "AFTER_ROUND"

export type RecoveryStatus = "RECORDED" | "NOT_YET_RECORDED" | "NOT_RECORDED" | "DUPLICATE_UNRESOLVED"

export type RecoveryExecution = {
  kind: RecoveryKind
  trainingOccurrenceId: string
  runningSnapshotId: string
  componentId: string
  blockId: string
  stepId: string | null
  roundOrdinal: number | null
  afterRepeatOrdinal: number | null
  fromStepId: string | null
  toStepId: string | null
  afterRoundOrdinal: number | null
  plannedRecoverySeconds: number | null
  actualRecoverySeconds: number | null
  status: RecoveryStatus
  sourceEventIds: string[]
}

export type RunningExecutionProjection = {
  availability: "UNAVAILABLE" | "AVAILABLE"
  terminal: boolean
  repetitions: RunningRepetitionSlot[]
  continuous: ContinuousExecution[]
  recoveries: RecoveryExecution[]
}

function continuousComponent(snapshot: RunningPlanSnapshot, componentId: string) {
  const component = snapshot.components.find((item) => item.componentId === componentId)
  if (!component || component.modality !== "RUNNING" || component.structure.kind !== "CONTINUOUS") return null
  return component
}

export function recordRunningContinuousCompleted(input: { trainingOccurrenceId: string; runningSnapshotId: string; componentId: string; actualDistanceMeters?: number | null; actualDurationSeconds?: number | null }): AppEvent | null {
  const occurrence = getTrainingOccurrence(input.trainingOccurrenceId)
  const snapshot = getRunningPlanSnapshot(input.trainingOccurrenceId)
  if (!occurrence || !snapshot || snapshot.runningSnapshotId !== input.runningSnapshotId || !continuousComponent(snapshot, input.componentId)) return null
  const actualDistanceMeters = metric(input.actualDistanceMeters)
  const actualDurationSeconds = metric(input.actualDurationSeconds)
  if (actualDistanceMeters === undefined || actualDurationSeconds === undefined) return null
  return dispatchEvent("RUNNING_CONTINUOUS_COMPLETED", {
    trainingOccurrenceId: input.trainingOccurrenceId,
    runningSnapshotId: input.runningSnapshotId,
    componentId: input.componentId,
    actualDistanceMeters,
    actualDurationSeconds,
  })
}

function recoveryMatch(snapshot: RunningPlanSnapshot, input: { componentId: string; blockId: string; kind: RecoveryKind; stepId?: string | null; roundOrdinal?: number | null; afterRepeatOrdinal?: number | null; fromStepId?: string | null; toStepId?: string | null; afterRoundOrdinal?: number | null }): number | null | undefined {
  const component = snapshot.components.find((item) => item.componentId === input.componentId)
  if (!component || component.modality !== "RUNNING" || component.structure.kind !== "REPEATED") return undefined
  const block = component.structure.blocks.find((item) => item.blockId === input.blockId)
  if (!block) return undefined
  if (input.kind === "AFTER_REPEAT") {
    const round = ordinal(input.roundOrdinal)
    const after = ordinal(input.afterRepeatOrdinal)
    const step = block.steps.find((item) => item.stepId === input.stepId)
    if (!round || !after || !step || round > block.roundCount || after >= step.repeatCount) return undefined
    return step.recoveryAfterRepeatSeconds
  }
  if (input.kind === "BEFORE_NEXT_STEP") {
    const round = ordinal(input.roundOrdinal)
    if (!round || round > block.roundCount || typeof input.fromStepId !== "string" || typeof input.toStepId !== "string") return undefined
    const index = block.steps.findIndex((item) => item.stepId === input.fromStepId)
    if (index < 0 || index === block.steps.length - 1 || block.steps[index + 1]?.stepId !== input.toStepId) return undefined
    return block.steps[index]?.recoveryBeforeNextStepSeconds ?? null
  }
  const afterRound = ordinal(input.afterRoundOrdinal)
  if (!afterRound || afterRound >= block.roundCount) return undefined
  return block.recoveryAfterRoundSeconds
}

export function recordRunningRecovery(input: { trainingOccurrenceId: string; runningSnapshotId: string; componentId: string; blockId: string; kind: RecoveryKind; stepId?: string | null; roundOrdinal?: number | null; afterRepeatOrdinal?: number | null; fromStepId?: string | null; toStepId?: string | null; afterRoundOrdinal?: number | null; actualRecoverySeconds?: number | null }): AppEvent | null {
  const occurrence = getTrainingOccurrence(input.trainingOccurrenceId)
  const snapshot = getRunningPlanSnapshot(input.trainingOccurrenceId)
  if (!occurrence || !snapshot || snapshot.runningSnapshotId !== input.runningSnapshotId) return null
  if (recoveryMatch(snapshot, input) === undefined) return null
  if (typeof input.actualRecoverySeconds !== "number" || !Number.isFinite(input.actualRecoverySeconds) || input.actualRecoverySeconds < 0) return null
  return dispatchEvent("RUNNING_RECOVERY_RECORDED", {
    trainingOccurrenceId: input.trainingOccurrenceId,
    runningSnapshotId: input.runningSnapshotId,
    componentId: input.componentId,
    blockId: input.blockId,
    kind: input.kind,
    stepId: input.kind === "AFTER_REPEAT" ? input.stepId : null,
    roundOrdinal: input.kind === "AFTER_ROUND" ? null : input.roundOrdinal,
    afterRepeatOrdinal: input.kind === "AFTER_REPEAT" ? input.afterRepeatOrdinal : null,
    fromStepId: input.kind === "BEFORE_NEXT_STEP" ? input.fromStepId : null,
    toStepId: input.kind === "BEFORE_NEXT_STEP" ? input.toStepId : null,
    afterRoundOrdinal: input.kind === "AFTER_ROUND" ? input.afterRoundOrdinal : null,
    actualRecoverySeconds: input.actualRecoverySeconds,
  })
}

function projectContinuous(snapshot: RunningPlanSnapshot, events: LogEvent[], terminal: boolean): ContinuousExecution[] {
  return snapshot.components.flatMap((component) => {
    if (component.modality !== "RUNNING" || component.structure.kind !== "CONTINUOUS") return []
    const matched = events.filter((event) => event.event_type === "RUNNING_CONTINUOUS_COMPLETED" && event.payload?.trainingOccurrenceId === snapshot.trainingOccurrenceId && event.payload.runningSnapshotId === snapshot.runningSnapshotId && event.payload.componentId === component.componentId)
    const item: ContinuousExecution = {
      trainingOccurrenceId: snapshot.trainingOccurrenceId,
      runningSnapshotId: snapshot.runningSnapshotId,
      componentId: component.componentId,
      status: matched.length > 1 ? "DUPLICATE_UNRESOLVED" : matched.length === 1 ? "COMPLETED" : terminal ? "NOT_RECORDED" : "NOT_YET_RECORDED",
      plannedDistanceMeters: component.structure.plannedDistanceMeters,
      plannedDistanceMaxMeters: component.structure.plannedDistanceMaxMeters,
      plannedDurationSeconds: component.structure.plannedDurationSeconds,
      actualDistanceMeters: null,
      actualDurationSeconds: null,
      sourceEventIds: matched.map((event) => event.event_id ?? "").filter((id) => id.length > 0),
      derivedPaceSecPerMeter: null,
      paceDistanceSourceEventId: null,
      paceDurationSourceEventId: null,
    }
    if (matched.length === 1) {
      const distance = metric(matched[0]?.payload?.actualDistanceMeters)
      const duration = metric(matched[0]?.payload?.actualDurationSeconds)
      item.actualDistanceMeters = distance == null ? null : distance
      item.actualDurationSeconds = duration == null ? null : duration
      if (distance != null && duration != null && matched[0]?.event_id) {
        item.derivedPaceSecPerMeter = duration / distance
        item.paceDistanceSourceEventId = matched[0].event_id
        item.paceDurationSourceEventId = matched[0].event_id
      }
    }
    return [item]
  })
}

function projectRecoveries(snapshot: RunningPlanSnapshot, events: LogEvent[], terminal: boolean): RecoveryExecution[] {
  const slots: RecoveryExecution[] = []
  for (const component of snapshot.components) {
    if (component.modality !== "RUNNING" || component.structure.kind !== "REPEATED") continue
    for (const block of component.structure.blocks) {
      for (let roundOrdinal = 1; roundOrdinal <= block.roundCount; roundOrdinal += 1) {
        for (const step of block.steps) {
          for (let afterRepeatOrdinal = 1; afterRepeatOrdinal < step.repeatCount; afterRepeatOrdinal += 1) {
            slots.push({
              kind: "AFTER_REPEAT",
              trainingOccurrenceId: snapshot.trainingOccurrenceId,
              runningSnapshotId: snapshot.runningSnapshotId,
              componentId: component.componentId,
              blockId: block.blockId,
              stepId: step.stepId,
              roundOrdinal,
              afterRepeatOrdinal,
              fromStepId: null,
              toStepId: null,
              afterRoundOrdinal: null,
              plannedRecoverySeconds: step.recoveryAfterRepeatSeconds,
              actualRecoverySeconds: null,
              status: terminal ? "NOT_RECORDED" : "NOT_YET_RECORDED",
              sourceEventIds: [],
            })
          }
        }
        for (let index = 0; index < block.steps.length - 1; index += 1) {
          const from = block.steps[index]
          const to = block.steps[index + 1]
          if (!from || !to) continue
          slots.push({
            kind: "BEFORE_NEXT_STEP",
            trainingOccurrenceId: snapshot.trainingOccurrenceId,
            runningSnapshotId: snapshot.runningSnapshotId,
            componentId: component.componentId,
            blockId: block.blockId,
            stepId: null,
            roundOrdinal,
            afterRepeatOrdinal: null,
            fromStepId: from.stepId,
            toStepId: to.stepId,
            afterRoundOrdinal: null,
            plannedRecoverySeconds: from.recoveryBeforeNextStepSeconds,
            actualRecoverySeconds: null,
            status: terminal ? "NOT_RECORDED" : "NOT_YET_RECORDED",
            sourceEventIds: [],
          })
        }
      }
      for (let afterRoundOrdinal = 1; afterRoundOrdinal < block.roundCount; afterRoundOrdinal += 1) {
        slots.push({
          kind: "AFTER_ROUND",
          trainingOccurrenceId: snapshot.trainingOccurrenceId,
          runningSnapshotId: snapshot.runningSnapshotId,
          componentId: component.componentId,
          blockId: block.blockId,
          stepId: null,
          roundOrdinal: null,
          afterRepeatOrdinal: null,
          fromStepId: null,
          toStepId: null,
          afterRoundOrdinal,
          plannedRecoverySeconds: block.recoveryAfterRoundSeconds,
          actualRecoverySeconds: null,
          status: terminal ? "NOT_RECORDED" : "NOT_YET_RECORDED",
          sourceEventIds: [],
        })
      }
    }
  }
  const recoveryEvents = events.filter((event) => event.event_type === "RUNNING_RECOVERY_RECORDED")
  for (const slot of slots) {
    const matched = recoveryEvents.filter((event) => {
      const payload = event.payload ?? {}
      return payload.trainingOccurrenceId === slot.trainingOccurrenceId && payload.runningSnapshotId === slot.runningSnapshotId && payload.componentId === slot.componentId && payload.blockId === slot.blockId && payload.kind === slot.kind && payload.stepId === slot.stepId && payload.roundOrdinal === slot.roundOrdinal && payload.afterRepeatOrdinal === slot.afterRepeatOrdinal && payload.fromStepId === slot.fromStepId && payload.toStepId === slot.toStepId && payload.afterRoundOrdinal === slot.afterRoundOrdinal
    })
    if (matched.length === 0) continue
    slot.sourceEventIds = matched.map((event) => event.event_id ?? "").filter((id) => id.length > 0)
    if (matched.length > 1) {
      slot.status = "DUPLICATE_UNRESOLVED"
      continue
    }
    const seconds = matched[0]?.payload?.actualRecoverySeconds
    slot.status = "RECORDED"
    slot.actualRecoverySeconds = typeof seconds === "number" && seconds >= 0 ? seconds : null
  }
  return slots
}

export function projectRunningExecution(trainingOccurrenceId: string, events: LogEvent[]): RunningExecutionProjection {
  const repetitions = projectRunningRepetitions(trainingOccurrenceId, events)
  const snapshot = getRunningPlanSnapshot(trainingOccurrenceId)
  if (!snapshot || repetitions.availability === "UNAVAILABLE") return { availability: "UNAVAILABLE", terminal: false, repetitions: [], continuous: [], recoveries: [] }
  const window = occurrenceEvents(trainingOccurrenceId, events)
  return {
    availability: "AVAILABLE",
    terminal: repetitions.terminal,
    repetitions: repetitions.slots,
    continuous: projectContinuous(snapshot, window, repetitions.terminal),
    recoveries: projectRecoveries(snapshot, window, repetitions.terminal),
  }
}

