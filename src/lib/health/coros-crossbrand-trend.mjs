// @ts-nocheck  研究模块原样保留（纯 JS，休眠，未接入界面）
/** v89.9.4 休眠（DORMANT）：没有方坤自己的高驰官方 OAuth/MCP 数据源，不被任何界面引用、不进打包；缺失=null/UNKNOWN，不补数。 */
/** Cross-brand daily evidence projection. Never converts COROS into Garmin Body Battery. */
export function projectDailyTrend(facts,{provider='COROS',referenceDays=7}={}){
 const grouped=new Map();
 for(const f of facts){if(f.provider!==provider||!/^\d{4}-\d{2}-\d{2}$/.test(f.date)||!Number.isFinite(f.value))continue;
 const day=grouped.get(f.date)||{date:f.date,source:provider,metrics:{},conflicts:[]};
 if(day.metrics[f.metric]&&day.metrics[f.metric].value!==f.value){day.conflicts.push(f.metric);delete day.metrics[f.metric]}
 else if(!day.conflicts.includes(f.metric))day.metrics[f.metric]={value:f.value,unit:f.unit,protocol:f.protocol??null,final:f.final===true};grouped.set(f.date,day)
 }
 const days=[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const baseline=(i,metric)=>{const current=days[i]?.metrics[metric];if(!current)return null;const earlier=days.slice(0,i).filter(d=>!d.conflicts.includes(metric)).map(d=>d.metrics[metric]).filter(x=>x&&x.final&&x.protocol===current.protocol).slice(-referenceDays);if(earlier.length<referenceDays)return null;const sorted=earlier.map(x=>x.value).sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]};
 return days.map((d,i)=>({date:d.date,provider,steps:d.metrics.STEPS?.value??null,activeEnergyKcal:d.metrics.ACTIVE_ENERGY?.value??null,restingHr:d.metrics.RESTING_HR?.value??null,sleepMinutes:d.metrics.SLEEP_MINUTES?.value??null,hrvMs:d.metrics.SLEEP_HRV?.value??null,reference:{restingHr:baseline(i,'RESTING_HR'),sleepMinutes:baseline(i,'SLEEP_MINUTES'),hrvMs:baseline(i,'SLEEP_HRV')},quality:d.conflicts.length?'CONFLICT':Object.keys(d.metrics).length?'PARTIAL_OR_AVAILABLE':'MISSING',fatigueDiagnosis:null,trainingClearance:false,garminBodyBattery:null}));
}
/** Never infer muscle-group fatigue from steps, calories or HRV alone. */
export function muscleEvidence({confirmedSessions=[],localSymptoms=[]}={}){
 return {confirmedTrainingCount:confirmedSessions.filter(x=>x.confirmed===true).length,reportedSymptoms:localSymptoms.filter(x=>x.confirmed===true),muscleFatiguePercent:null,assessment:'REQUIRES_SESSION_AND_SYMPTOM_CONTEXT',trainingClearance:false};
}
