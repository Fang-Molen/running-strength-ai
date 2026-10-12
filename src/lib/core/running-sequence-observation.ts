/** BUILD 45D: read-only temporal evidence for same-distance repetitions. */
export type RepEvidence = { ordinal:number; distanceMeters:number|null; seconds:number|null; sourceEventId:string|null; targetSeconds?:number|null };
export type SequenceResult = { status:'AVAILABLE'|'PARTIAL'|'UNAVAILABLE'; comparableCount:number; transitions:{from:number;to:number;deltaSeconds:number;sourceEventIds:[string,string]}[]; firstLastDeltaSeconds:number|null; pattern:'FASTER'|'SLOWER'|'MIXED'|'STABLE'|'UNKNOWN'; interpretation:'OBSERVATION_ONLY'; reasons:string[] };
export function observeRunningSequence(reps:RepEvidence[], toleranceSeconds=0.3):SequenceResult {
  const reasons:string[]=[];
  if(!Number.isFinite(toleranceSeconds)||toleranceSeconds<0) throw new Error('INVALID_TOLERANCE');
  const ordered=[...reps].sort((a,b)=>a.ordinal-b.ordinal);
  if(new Set(ordered.map(r=>r.ordinal)).size!==ordered.length || ordered.some(r=>!Number.isInteger(r.ordinal)||r.ordinal<1)) return {status:'UNAVAILABLE',comparableCount:0,transitions:[],firstLastDeltaSeconds:null,pattern:'UNKNOWN',interpretation:'OBSERVATION_ONLY',reasons:['INVALID_ORDINALS']};
  const valid=(r:RepEvidence)=>r.distanceMeters!=null&&Number.isFinite(r.distanceMeters)&&r.distanceMeters>0&&r.seconds!=null&&Number.isFinite(r.seconds)&&r.seconds>0&&!!r.sourceEventId;
  const transitions:SequenceResult['transitions']=[];
  for(let i=1;i<ordered.length;i++) { const a=ordered[i-1]!,b=ordered[i]!; if(valid(a)&&valid(b)&&a.distanceMeters===b.distanceMeters) transitions.push({from:a.ordinal,to:b.ordinal,deltaSeconds:b.seconds!-a.seconds!,sourceEventIds:[a.sourceEventId!,b.sourceEventId!]}); else reasons.push(`INCOMPARABLE_${a.ordinal}_${b.ordinal}`); }
  const signs=transitions.map(t=>Math.abs(t.deltaSeconds)<=toleranceSeconds?0:Math.sign(t.deltaSeconds));
  const pattern:SequenceResult['pattern']=!signs.length?'UNKNOWN':signs.every(x=>x===0)?'STABLE':signs.every(x=>x>=0)&&signs.some(x=>x>0)?'SLOWER':signs.every(x=>x<=0)&&signs.some(x=>x<0)?'FASTER':'MIXED';
  const first=ordered[0],last=ordered.at(-1);
  const firstLastDeltaSeconds=first&&last&&first!==last&&valid(first)&&valid(last)&&first.distanceMeters===last.distanceMeters?last.seconds!-first.seconds!:null;
  if(ordered.some(r=>r.targetSeconds==null)) reasons.push('TARGET_CONTEXT_INCOMPLETE');
  reasons.push('NO_FATIGUE_OR_CAUSAL_INFERENCE');
  return {status:transitions.length===0?'UNAVAILABLE':transitions.length===Math.max(0,ordered.length-1)?'AVAILABLE':'PARTIAL',comparableCount:transitions.length,transitions,firstLastDeltaSeconds,pattern,interpretation:'OBSERVATION_ONLY',reasons};
}
