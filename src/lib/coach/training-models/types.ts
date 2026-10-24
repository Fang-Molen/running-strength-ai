import type { Context, EvidenceMeta, EvidenceSnapshot, RecoveryAssessment, EvidenceRef } from '../../health/analysis-contract'
import type { RunningPlan } from '../../core/running-plan'
export type { Context, EvidenceRef }
export interface ThresholdRecord extends EvidenceMeta {
 marker: 'LT1'|'LT2'|'VT1'|'VT2'; value: number|null; unit:'m/s'|'bpm'
 testId:string; method:string; modality:'RUNNING'; validUntil:string|null
}
export interface PerformanceRecord extends EvidenceMeta {
 distanceM:number; seconds:number; effort:'RACE'|'TIME_TRIAL'|'INTERVAL'
 maximal:boolean; testId:string
}
export interface ZoneSegment extends EvidenceMeta {
 sessionId:string; startAt:string; endAt:string; zone:1|2|3|null
 basis:'TIME_IN_ZONE'|'SESSION_GOAL'; thresholdTestId:string|null; thresholdRefs:EvidenceRef[]
}
export type MethodId='PYRAMIDAL'|'POLARIZED'|'DOUBLE_THRESHOLD'|'EVENT_SPECIFIC'
export type ModelProfile={
 eventMeters:number|null; phase:'BASE'|'BUILD'|'SPECIFIC'|'TAPER'|'UNKNOWN'
 raceDate:string|null; experience:'NOVICE'|'TRAINED'|'ADVANCED'|'UNKNOWN'
 doubleThresholdExperience:boolean|null; lactateMonitoring:boolean|null
 coachSupervision:boolean|null; twoSessionsAvailable:boolean|null
 sourceRefs:EvidenceRef[]
}
export interface PlannedModelSession {
 id:string; date:string; purpose:'EASY'|'THRESHOLD'|'VO2'|'SPEED'|'RACE_PACE'|'STRENGTH'|'RECOVERY'
 plan:RunningPlan; familiar:boolean; executionState:'NOT_STARTED'|'STARTED'|'COMPLETED'|'UNKNOWN'; sourceRefs:EvidenceRef[]
}
export interface ModelInput {
 context:Context; snapshot:EvidenceSnapshot
 thresholds:readonly ThresholdRecord[]; performances:readonly PerformanceRecord[]
 zoneSegments:readonly ZoneSegment[]
 window:{startAt:string;endAt:string;complete:boolean;totalRunSeconds:number|null;totalSessions?:number|null;basis:'TIME_IN_ZONE'|'SESSION_GOAL'}
 profile:ModelProfile; recovery:RecoveryAssessment|null; sessions:readonly PlannedModelSession[]
}
export type Applicability={method:MethodId;status:'CONSIDER'|'CONDITIONAL'|'NOT_APPLICABLE'|'INSUFFICIENT'|'HOLD';reasons:string[];missing:string[];evidenceIds:string[]}
export type TrainingCandidate={
 id:string;action:'KEEP'|'REDUCE'|'RECOVERY'|'SKIP';sessionId:string;date:string
 changedVariable:'NONE'|'REPEAT_COUNT'|'DURATION'|'SESSION_EXECUTION'
 before:RunningPlan;after:RunningPlan|null;reason:string;basisRefs:EvidenceRef[]
 requiresConfirmation:true;automaticExecution:false
}
