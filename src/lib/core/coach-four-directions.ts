/** V3.3 read-only four-direction coach reasoning. No diagnosis, prescriptions or storage writes. */
export type SessionSignal = {
  id: string; day: string; category: 'SPRINT'|'INTERVAL'|'STRENGTH'|'EASY'|'UNKNOWN';
  rpe?: number|null; sleepHours?: number|null; recovery?: number|null;
  cmjCm?: number|null; sprintSeconds?: number|null; pain?: number|null;
  functionalLimitation?: boolean|null; completed?: boolean|null;
}
export type CoachContext = {
  history: SessionSignal[]; current: SessionSignal; next: { id: string; day: string; category: SessionSignal['category']; purpose: string; intensity: 'EASY'|'MODERATE'|'HARD'|'UNKNOWN' };
  previousPrediction?: { event: string; predictedSeconds: number; actualSeconds: number } | null;
}
export type FourDirectionReview = {
  hypotheses: {name: string; evidenceIds: string[]; confidence: 'POSSIBLE'|'INSUFFICIENT'; explanation: string}[];
  baseline: {cmjMedian: number|null; cmjChangePercent: number|null; samples: number; usable: boolean};
  prescription: {action: 'SAFETY_REVIEW'|'REVIEW_HIGH_INTENSITY'|'MONITOR'|'KEEP_CANDIDATE'; rationale: string; requiresConfirmation: true; nextSessionId: string; preservePurpose: boolean};
  predictionAudit: {errorSeconds: number; absoluteErrorSeconds: number; signedErrorPercent: number}|null;
  questions: string[];
  uncertainty: string[];
}
const valid=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const median=(a:number[])=>{const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2};
export function reviewFourDirections(c:CoachContext):FourDirectionReview {
  if (!c||!Array.isArray(c.history)||!c.current?.id||!c.next?.id||!c.next.purpose?.trim()) throw Error('invalid coach context');
  const prior=c.history.filter(s=>s.id!==c.current.id&&s.day<c.current.day);
  const cmj=prior.filter(s=>valid(s.cmjCm,1,150)).slice(-8).map(s=>s.cmjCm as number);
  const base=cmj.length>=3?median(cmj):null;
  const change=base!==null&&valid(c.current.cmjCm,1,150)?Math.round(((c.current.cmjCm-base)/base)*1000)/10:null;
  const baseline={cmjMedian:base,cmjChangePercent:change,samples:cmj.length,usable:base!==null&&change!==null};
  const hypotheses:FourDirectionReview['hypotheses']=[];
  const questions:string[]=[];const uncertainty:string[]=[];
  const add=(name:string,why:string)=>hypotheses.push({name,evidenceIds:[c.current.id],confidence:'POSSIBLE',explanation:why});
  if(valid(c.current.rpe,7,10))add('较高主观训练负担','RPE偏高，不能单独证明神经肌肉疲劳。');
  if(valid(c.current.sleepHours,0,5.999))add('睡眠不足可能影响恢复','睡眠较短，需结合多日睡眠和训练表现。');
  if(valid(c.current.recovery,1,3))add('较低主观恢复','恢复评分较低，不能直接推断中枢或外周疲劳。');
  if(change!==null&&change<=-7)add('神经肌肉表现下降的待验证假设','CMJ相对个人历史中位数下降；7%是复核触发条件，不是诊断阈值。');
  if(!baseline.usable){uncertainty.push('缺少至少3次可比较的历史CMJ及当前测量；不能估计个人神经肌肉基线。');questions.push('能否在相同测试条件下补充CMJ或短冲刺表现？');}
  if(c.current.rpe==null)questions.push('本次训练的RPE是多少（1–10）？');
  if(c.current.sleepHours==null)questions.push('昨晚睡眠几小时？');
  const pain=valid(c.current.pain,1,10);
  const unsafe=pain&&(c.current.functionalLimitation!==false||c.next.intensity==='HARD'||c.next.intensity==='UNKNOWN')||c.current.functionalLimitation===true;
  if(pain){add('局部疼痛或功能风险','疼痛需要单独进行安全分流，不应作为普通疲劳分数。');questions.push('疼痛具体位置、诱发动作和是否影响正常跑步？');}
  if(c.current.functionalLimitation==null&&pain)uncertainty.push('功能限制状态未知，不能默认安全。');
  const nextHard=c.next.intensity==='HARD';
  const recoverySignals=hypotheses.some(h=>h.name!=='局部疼痛或功能风险');
  const action=unsafe?'SAFETY_REVIEW':nextHard&&recoverySignals?'REVIEW_HIGH_INTENSITY':recoverySignals?'MONITOR':'KEEP_CANDIDATE';
  const rationale=unsafe?'疼痛或功能限制优先：暂停高风险刺激并做安全复核；必要时寻求运动医学评估。':action==='REVIEW_HIGH_INTENSITY'?'恢复信号与下一节高强度刺激冲突，需先复核训练目的、强度、组数、休息和动作风险。':action==='MONITOR'?'继续观察恢复与动作质量，不依据单一信号自动减量。':'没有足够证据支持改变下一节课，也不等于已经完全恢复。';
  const p=c.previousPrediction;
  const predictionAudit=p&&valid(p.predictedSeconds,1,1e6)&&valid(p.actualSeconds,1,1e6)?{errorSeconds:Math.round((p.actualSeconds-p.predictedSeconds)*100)/100,absoluteErrorSeconds:Math.round(Math.abs(p.actualSeconds-p.predictedSeconds)*100)/100,signedErrorPercent:Math.round((p.actualSeconds-p.predictedSeconds)/p.predictedSeconds*1000)/10}:null;
  if(!predictionAudit)uncertainty.push('尚无可配对的赛前预测与实际成绩，无法回测预测误差。');
  uncertainty.push('疲劳机制不能由RPE、睡眠、CMJ单独区分；必须考虑测量误差、训练意图及外部因素。');
  return {hypotheses,baseline,prescription:{action,rationale,requiresConfirmation:true,nextSessionId:c.next.id,preservePurpose:true},predictionAudit,questions,uncertainty};
}
