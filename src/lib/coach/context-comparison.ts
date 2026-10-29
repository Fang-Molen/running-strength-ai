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
 return [...questionCalculations(question,prior).map(s=>s.detail),...contextPaceComparison(question,context),...selfReportRangeComparison(question),...distance]
}
