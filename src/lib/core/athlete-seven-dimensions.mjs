/** BUILD47 read-only seven-dimension evidence gate. No diagnosis, prescriptions, writes or network. */
/** @param {unknown} x @returns {x is number} */
const validNumber = x => typeof x === 'number' && Number.isFinite(x);
/** @param {unknown[]} xs */
const unique = xs => new Set(xs).size === xs.length;
/**
 * @typedef {{eventId?:unknown,stepId?:unknown,trainingOccurrenceId?:unknown,distanceM?:unknown,seconds?:unknown,round?:unknown}} Step
 * @param {{occurrenceId?:string,steps?:Step[],baseline?:{metrics?:Record<string,{status:string}>}|null,context?:{preRecovery?:unknown,sessionRpe?:unknown},safety?:{pain?:boolean,functionalLimitation?:boolean}}} input
 */
export function assessSevenDimensions({occurrenceId,steps=[],baseline=null,context={},safety={}}={}) {
  const errors=[];
  if (typeof occurrenceId!=='string'||!occurrenceId.trim()) errors.push('MISSING_OCCURRENCE_ID');
  if (!Array.isArray(steps)) errors.push('INVALID_STEPS');
  const list=Array.isArray(steps)?steps:[];
  if (!unique(list.map(x=>x?.eventId))) errors.push('DUPLICATE_EVENT_ID');
  if (!unique(list.map(x=>x?.stepId).filter(x=>x!=null))) errors.push('DUPLICATE_STEP_ID');
  if (list.some(x=>!x || x.trainingOccurrenceId!==occurrenceId)) errors.push('CROSS_OCCURRENCE_EVIDENCE');
  if (list.some(x=>!validNumber(x?.distanceM)||x.distanceM<=0||!validNumber(x?.seconds)||x.seconds<=0)) errors.push('INVALID_OR_MISSING_SPLIT');
  const safe=errors.length===0;
  /** @type {Map<string,{eventId:unknown,stepId:unknown,seconds:number,round:unknown}[]>} */
  const groups=new Map();
  if(safe) for(const s of list) { const key=String(s.distanceM); if(!groups.has(key)) groups.set(key,[]); groups.get(key)?.push({eventId:s.eventId,stepId:s.stepId??null,seconds:Number(s.seconds),round:s.round??null}); }
  const comparisons=[...groups].map(([distanceM,items])=>({distanceM:Number(distanceM),count:items.length,firstSeconds:items[0].seconds,lastSeconds:items.at(-1)?.seconds ?? NaN,deltaSeconds:items.length>=2?(items.at(-1)?.seconds ?? NaN)-items[0].seconds:null,eventIds:items.map(x=>x.eventId),rounds:items.map(x=>x.round)}));
  const baselineReady=!!baseline && Object.values(baseline.metrics??{}).some(m=>m.status==='DESCRIPTIVE_ONLY');
  const hasPain=safety.pain===true || safety.functionalLimitation===true;
  const preKnown=validNumber(context.preRecovery), postKnown=validNumber(context.sessionRpe);
  const result={status:safe?'READ_ONLY_OBSERVATION':'REJECTED',errors,occurrenceId:occurrenceId??null,dimensions:{
    trainingFacts:{status:safe?'OBSERVED':'UNAVAILABLE',count:safe?list.length:null},
    splitPerformance:{status:safe&&comparisons.some(c=>c.count>=2)?'DESCRIPTIVE_ONLY':'UNKNOWN',comparisons:safe?comparisons:[]},
    evidenceSafety:{status:hasPain?'SAFETY_REVIEW_REQUIRED':safe?'PROVENANCE_CHECKED':'INVALID_EVIDENCE',errors},
    periodPlanning:{status:'NO_AUTOMATIC_PLAN_CHANGE'},
    personalBaseline:{status:baselineReady?'DESCRIPTIVE_ONLY':'UNKNOWN'},
    fatigueRecovery:{status:'UNKNOWN',signals:{preRecoveryRecorded:preKnown,sessionRpeRecorded:postKnown},reason:'Insufficient causal and longitudinal evidence'},
    eventSpecificCapacity:{status:'UNKNOWN',reason:'Split trends alone cannot establish event-specific capacity'}
  },writes:0,externalModelCalls:0};
  return result;
}
