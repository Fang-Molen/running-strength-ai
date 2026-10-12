export const SCHEMA_VERSION = 1

export const EVENT_TYPES = [
  "TRAINING_STARTED",
  "TRAINING_SET_COMPLETED",
  "TRAINING_COMPLETED",
  "TRAINING_MODIFIED",
  "TRAINING_INTERRUPTED",
  "RUN_COMPLETED",
  "RUNNING_REPETITION_COMPLETED",
  "RUNNING_REPETITION_SKIPPED",
  "RUNNING_CONTINUOUS_COMPLETED",
  "RUNNING_RECOVERY_RECORDED",
  "RPE_RECORDED",
  "PAIN_RECORDED",
  "SLEEP_RECORDED",
  "HRV_RECORDED",
  "RHR_RECORDED",
  "INJURY_REPORTED",
  "SYMPTOM_CHANGED",
  "BODY_MEASUREMENT_RECORDED",
  "NUTRITION_RECORDED",
  "WATCH_EXPENDITURE_RECORDED",
  "PLAN_CREATED",
  "PLAN_MODIFIED",
  "PLAN_COMPLETED",
  "GOAL_UPDATED",
  "USER_ACCEPTED",
  "USER_REJECTED",
  "USER_MODIFIED",
  "USER_OVERRIDDEN",
  "COMPETITION_CREATED",
  "COMPETITION_UPDATED",
  "ENVIRONMENT_CHANGED",
  "DEVICE_DATA_RECEIVED",
  "AI_DECISION_CREATED",
  "AI_DECISION_EXPIRED",
  "AI_DECISION_INTERRUPTED",
  "SUBJECTIVE_FEEDBACK",
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type EventSource = "MANUAL" | "AI_PREFILL" | "DEVICE" | "SYSTEM" | "IMPORT"

export type DataQuality = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"

export type AppEvent<T = Record<string, unknown>> = {
  event_id: string
  athlete_id: string
  timestamp: string
  event_type: EventType
  source: EventSource
  payload: T
  confidence: number
  data_quality: DataQuality
  context: Record<string, unknown>
  cycle_id: string
  schema_version: number
}

export type AuditEntry = {
  id: string
  source: "USER" | "AI" | "SYSTEM"
  action: string
  originalValue: string
  newValue: string
  reason: string
  risk: "LOW" | "MEDIUM" | "HIGH"
  timestamp: string
  decisionId: string
}

export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL"

export type OverrideReason =
  | "FEELING_GOOD"
  | "FEELING_TIRED"
  | "TIME_LIMITED"
  | "PAIN_OR_DISCOMFORT"
  | "EXERCISE_PREFERENCE"
  | "EQUIPMENT_LIMITATION"
  | "ENVIRONMENT"
  | "MOTIVATION"
  | "SCHEDULE_CHANGE"
  | "COACH_DISAGREEMENT"
  | "OTHER"

export type SafetyStatus = "CLEAR" | "REVIEW" | "BLOCKED" | "CRITICAL"

export type DecisionRecord = {
  decision_id: string
  cycle_id: string
  athlete_id: string
  decision_type: string
  target: string
  current_state: string
  reasoning: string
  evidence: string[]
  counter_evidence: string[]
  recommended_action: Record<string, unknown>
  alternative_actions: string[]
  confidence: number
  uncertainty: string
  risk: RiskLevel
  safety_status: SafetyStatus
  strategy_alignment: string
  required_confirmation: boolean
  reversibility: "EASY" | "HARD"
  monitoring_conditions: string[]
  interrupt_conditions: string[]
  expected_outcome: string
  expiry: string
  created_at: string
  status: "OPEN" | "CREATED" | "PENDING_CONFIRMATION" | "ACCEPTED" | "REJECTED" | "MODIFIED" | "EXECUTED" | "INTERRUPTED" | "EXPIRED" | "VALIDATED"
}

export type AbilitySnapshot = {
  speed: number | null
  aerobic: number | null
  strength: number | null
  power: number | null
  endurance: number | null
  runningEconomy: number | null
  sportSpecificAbility: number | null
  limiter: string | null
  confidence: number
}

export type AthleteState = {
  physical: {
    weight: number | null
    bodyFat: number | null
    muscleMass: number | null
    bmi: number | null
    bodyTrend: string
    confidence: number
  }
  training: {
    weeklySessions: number | null
    recentTrainingLoad: number | null
    recentRunningVolume: number | null
    strengthLoad: number | null
    trainingDensity: number | null
    monotony: number | null
    consistency: number | null
    currentCycle: number | null
    currentWeek: number | null
    confidence: number
  }
  recovery: {
    fatigueScore: number | null
    recoveryStatus: string
    sleep: number | null
    restingHR: number | null
    HRV: number | null
    soreness: string | null
    pain: boolean
    confidence: number
  }
  nutrition: {
    calorieTarget: number | null
    caloriesConsumed: number | null
    proteinTarget: number | null
    proteinConsumed: number | null
    energyAvailability: string
    deficitOrSurplus: number | null
    confidence: number
  }
  performance: {
    recentRuns: string
    recentPace: string | null
    recentDuration: string | null
    rpe: number | null
    performanceTrend: string
    targetStatus: string
    todayUsable: string
    confidence: number
  }
  ability: AbilitySnapshot
  competition: {
    target: string
    date: string | null
    daysRemaining: number | null
    criticality: string
  }
  environment: {
    weather: string | null
    heat: string | null
    humidity: string | null
    surface: string | null
    equipment: string | null
    schedule: string | null
  }
  uncertainty: {
    overall: DataQuality
    missingData: string[]
    conflictingData: string[]
    outOfModel: boolean
  }
  generatedAt: string
  schemaVersion: number
}

export type RunDraft = {
  id: string
  source: "AI_PREFILL" | "MANUAL"
  text: string
  distanceKm: number | null
  durationSec: number | null
  rpe: number | null
  note: string
  confirmed: boolean
  createdAt: string
}

