import type {CoachRequestContext} from './online-contract'
/** Deterministic display of two fully recorded continuous-run work paces.
 * Descriptive comparison only, no causal inference, training dose or clearance. */
export function contextPaceComparison(question:string,context?:CoachRequestContext):string[]{
 if(!/哪次.*快|谁.*快|比较.*配速|前后.*跑步/.test(question))return []
 const rows=(context?.records??[]).filter(r=>r.category==='TRAINING'&&r.fields.some(f=>f.name==='modality'&&f.value==='RUN'))
 const values=rows.map(r=>{const f=(n:string)=>r.fields.find(f=>f.name===n)?.value;return {r,d:f('knownDistance'),t:f('knownWorkTime'),p:f('paceSecondsPerKm'),complete:f('distanceComplete')}})
 if(values.length!==2||values.some(v=>v.complete!==true||typeof v.d!=='number'||v.d<=0||typeof v.t!=='number'||v.t<=0||typeof v.p!=='number'||Math.abs(v.p-v.t*1000/v.d)>0.00001||!v.r.occurredAt))return []
 const ordered=values.sort((a,b)=>a.r.occurredAt!.localeCompare(b.r.occurredAt!)),pace=ordered.map(v=>(v.t as number)*1000/(v.d as number));
 const format=(p:number)=>{const n=Math.round(p);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}/km`}
 const date=(n:number)=>ordered[n].r.occurredAt!.slice(0,10)
 const missingSleep=(context?.records??[]).some(r=>r.fields.some(f=>f.name==='notes'&&typeof f.value==='string'&&f.value.includes('睡眠未记录')));
 return [`按已记录连续跑段比较，${pace[0]===pace[1]?'两次平均配速相同':date(pace[0]<pace[1]?0:1)+'这次更快'}：${date(0)}为${format(pace[0])}，${date(1)}为${format(pace[1])}；条件未必相同，不能据此确定疲劳原因。`,...(missingSleep?['资料缺项：睡眠未记录。']:[])]
}
