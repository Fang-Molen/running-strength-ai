import {questionCalculations} from './question-calculation'
import {contextTextField} from './context-fields'
import type {CoachRequestContext} from './online-contract'
/** Compare explicitly supplied self-report values, without inventing a baseline
 * or turning a numerical relation into a recovery or diagnostic conclusion. */
export function selfReportRangeComparison(question:string):string[]{
 const range=/静息心率通常约\s*(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)/.exec(question);
 const recent=/近两天分别为\s*(\d+(?:\.\d+)?)和(\d+(?:\.\d+)?)/.exec(question);
 if(!range||!recent)return [];
 const low=+range[1],high=+range[2],values=[+recent[1],+recent[2]];
 if(low<=0||high<low||high>300||values.some(v=>v<=0||v>300))return [];
 return [`按当前自述比较，近两天静息心率：${values.map(v=>`${v}${v<low?'低于':v>high?'高于':'处于'}所给常态区间${low}–${high}`).join('；')}。这是相对所给个人参考的数值关系，不能据此确诊原因或证明完全恢复。`];
}
/** Deterministic display of two fully recorded continuous-run work paces.
 * Descriptive comparison only, no causal inference, training dose or clearance. */
export function contextPaceComparison(question:string,context?:CoachRequestContext):string[]{
 if(!/哪次.*快|谁.*快|比较.*(?:配速|两课|两次|跑步)|对比.*跑|前后.*跑步/.test(question))return []
 const rows=(context?.records??[]).filter(r=>r.category==='TRAINING'&&r.fields.some(f=>f.name==='modality'&&f.value==='RUN'))
 const values=rows.map(r=>{const f=(n:string)=>r.fields.find(f=>f.name===n)?.value;return {r,d:f('knownDistance'),t:f('knownWorkTime'),p:f('paceSecondsPerKm'),complete:f('distanceComplete'),label:f('comparisonLabel')}})
 if(values.length!==2||values.some(v=>v.complete!==true||typeof v.d!=='number'||v.d<=0||typeof v.t!=='number'||v.t<=0||typeof v.p!=='number'||Math.abs(v.p-v.t*1000/v.d)>0.00001||!v.r.occurredAt&&typeof v.label!=='string'))return []
 const ordered=values.sort((a,b)=>(a.r.occurredAt??'').localeCompare(b.r.occurredAt??'')),pace=ordered.map(v=>(v.t as number)*1000/(v.d as number));
 const format=(p:number)=>{const n=Math.round(p);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}/km`}
 const date=(n:number)=>typeof ordered[n].label==='string'?String(ordered[n].label):ordered[n].r.occurredAt!.slice(0,10)
 const missingSleep=(context?.records??[]).some(r=>r.fields.some(f=>f.name==='notes'&&typeof f.value==='string'&&f.value.includes('睡眠未记录')));
 return [`按已记录连续跑段比较，${pace[0]===pace[1]?'两次平均配速相同':date(pace[0]<pace[1]?0:1)+(Math.round(pace[0])===Math.round(pace[1])?'按原始记录略快，显示配速相同':'这次更快')}：${date(0)}为${format(pace[0])}，${date(1)}为${format(pace[1])}；条件未必相同，不能据此确定疲劳原因。`,...(missingSleep?['资料缺项：睡眠未记录。']:[])]
}

/** Display the same host-verified arithmetic used in the prompt, independently
 * of whether prose filtering removed a model paraphrase. Never calls a model. */
export function computedCoachQuotes(question:string,context?:CoachRequestContext):string[]{
 const prior=(context?.records??[]).filter(r=>r.category==='DIALOGUE'&&r.fields.some(f=>f.name==='speaker'&&f.value==='user')).map(r=>contextTextField(r,'text'))
 const distance:string[]=[];
 if(/(?:比较|对比).{0,16}(?:距离|公里)/.test(question)){
  const rows=(context?.records??[]).filter(r=>r.category==='TRAINING'&&r.fields.some(f=>f.name==='modality'&&f.value==='RUN')).map(r=>({label:r.fields.find(f=>f.name==='comparisonLabel')?.value,d:r.fields.find(f=>f.name==='knownDistance')?.value,complete:r.fields.find(f=>f.name==='distanceComplete')?.value}));
  if(rows.length===2&&rows.every(r=>typeof r.label==='string'&&r.label.length<=16&&typeof r.d==='number'&&r.d>=0&&r.complete===true)){
   const [a,b]=rows,delta=Number((Math.abs(Number(a.d)-Number(b.d))/1000).toFixed(6));
   distance.push(`所述两条距离：${a.label}${Number(a.d)/1000}公里，${b.label}${Number(b.d)/1000}公里；${delta===0?'距离相同':(Number(a.d)>Number(b.d)?a.label:b.label)+'比另一条多'+delta+'公里'}。仅比较本轮提供的自述数据，未读取另一账号，也不把他人数据归给本人。`);
  }
 }
 return [...questionCalculations(question,prior).map(s=>s.detail),...contextPaceComparison(question,context),...selfReportRangeComparison(question),...distance,...contextWearableComparison(question,context)]
}

/** Descriptive calculations only on explicitly selected complete records. Match by
 * upstream activity lineage, never by similar time or distance alone. */
export function contextWearableComparison(question:string,context?:CoachRequestContext):string[]{
 if(!/两个时长|时长口径|合计/.test(question))return [];
 const records=(context?.records??[]).filter(r=>r.category==='TRAINING'&&r.state==='ACTUAL'&&r.fields.some(f=>f.name==='subjectRole'&&f.value==='SELF'));
 const groups=new Map<string,typeof records>();
 for(const r of records){const lineage=r.fields.find(f=>f.name==='activityLineage')?.value;const key=typeof lineage==='string'&&lineage?lineage:r.recordId;groups.set(key,[...(groups.get(key)??[]),r]);}
 const values=[...groups.values()].map(rs=>{const f=(r:typeof records[number],name:string)=>r.fields.find(f=>f.name===name)?.value;const ds=rs.map(r=>f(r,'knownDistance'));if(rs.some(r=>r.fields.find(f=>f.name==='knownDistance')?.unit!=='m')||ds.some(d=>typeof d!=='number'||!Number.isFinite(d)||d<0)||new Set(ds).size!==1||rs.some(r=>f(r,'distanceComplete')!==true||f(r,'modality')!=='RUN'))return null;return {rs,d:Number(ds[0]),timer:rs.map(r=>f(r,'timerSeconds')).find(v=>typeof v==='number'&&v>0),elapsed:rs.map(r=>f(r,'elapsedSeconds')).find(v=>typeof v==='number'&&v>0)};});
 if(!values.length||values.some(v=>!v))return [];
 const valid=values.filter((v):v is NonNullable<typeof v>=>v!==null),out:string[]=[];
 if(/合计/.test(question))out.push('所选跑步记录按已匹配活动标识去重，距离合计'+Number((valid.reduce((n,v)=>n+v.d,0)/1000).toFixed(6))+'公里；来源：'+records.map(r=>r.source).join('、')+'。未匹配到同一活动的记录分别保留，不代表全天记录完整。');
 if(/两个时长|时长口径/.test(question)&&valid.length===1){const v=valid[0];if(typeof v.timer==='number'&&typeof v.elapsed==='number'&&v.d>0){const pace=Math.round(v.timer*1000/v.d);out.push('同一活动的计时器时长'+v.timer+'秒、经过时长'+v.elapsed+'秒，口径不同，不能相加；按计时器时长与'+v.d/1000+'公里计算配速约'+Math.floor(pace/60)+':'+String(pace%60).padStart(2,'0')+'/km。来源：'+records.map(r=>r.source).join('、')+'。');}}
 return out.filter(q=>q.length<=400);
}
