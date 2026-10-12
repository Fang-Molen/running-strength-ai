/** BUILD 45K: no model, network, persistent storage or plan mutation. */
/**
 * @typedef {{trainingOccurrenceId?:string,sourceEventId?:string,distanceMeters?:number,durationSeconds?:number}} Step
 * @param {{workouts?:{trainingOccurrenceId?:string,steps?:Step[],duration?:number}[],records?:Record<string,unknown>[],trainingOccurrenceId?:string|null,pain?:boolean}} input
 */
export function assessOfflineTrainingEvidence({workouts = [], records = [], trainingOccurrenceId = null, pain = false} = {}) {
  const hasBoundSteps = Boolean(trainingOccurrenceId) && workouts.some(w =>
    w.trainingOccurrenceId === trainingOccurrenceId && Array.isArray(w.steps) &&
    w.steps.length > 0 && w.steps.every(s => s.trainingOccurrenceId === trainingOccurrenceId &&
      s.sourceEventId && Number.isFinite(s.distanceMeters) && (s.distanceMeters??0) > 0 &&
      Number.isFinite(s.durationSeconds) && (s.durationSeconds??0) > 0));
  const selected = hasBoundSteps ? workouts.find(w => w.trainingOccurrenceId === trainingOccurrenceId && Array.isArray(w.steps) && w.steps.length) : null;
  const steps = selected?.steps ?? [];
  const ids = steps.map(s => s.sourceEventId);
  const unique = ids.length === new Set(ids).size;
  const sameDistance = steps.length > 0 && steps.every(s => s.distanceMeters === steps[0].distanceMeters);
  const comparable = hasBoundSteps && unique && sameDistance;
  const times = steps.map(s => s.durationSeconds);
  return Object.freeze({
    trainingOccurrenceId: trainingOccurrenceId || null,
    repAnalysis: comparable ? {status:'OBSERVED',firstSeconds:times[0],lastSeconds:times.at(-1),differenceSeconds:Number(times.at(-1))-Number(times[0]),count:times.length} : {status:'UNAVAILABLE',reason: !hasBoundSteps?'NO_BOUND_INTERVAL_STEPS':!unique?'DUPLICATE_SOURCE_EVENTS':'MIXED_DISTANCES'},
    healthRecordCount:records.length,
    causalAttribution:'UNKNOWN',fatigueDiagnosis:'UNKNOWN',safety:pain?'SAFETY_REVIEW':'NO_PAIN_FLAG_REPORTED',
    recommendedPlanChange:null,externalModelCalls:0,writes:0
  });
}
