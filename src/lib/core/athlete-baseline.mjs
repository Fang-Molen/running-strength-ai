/** BUILD46: read-only, device-neutral longitudinal baseline. No medical diagnosis. */
/** @param {unknown} v */
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
/** @param {Array<Record<string, unknown> & {date?:string}>} rows */
export function buildAthleteBaseline(rows, {recentDays=28, minimumDays=14}={}) {
  /** @type {Map<string, Record<string,unknown>>} */
  const byDate = new Map();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date||''))) continue;
    if (byDate.has(String(row.date))) throw new Error('DUPLICATE_DATE');
    byDate.set(String(row.date),row);
  }
  const dates=[...byDate.keys()].sort();
  const recent=dates.slice(-recentDays);
  const metrics={resting_hr_mean:'bpm',hrv_sdnn_mean:'ms',steps_sum_raw:'steps'};
  /** @type {Record<string,string[]>} */
  const aliases={resting_hr_mean:['resting_hr_mean','resting_hr_bpm'],hrv_sdnn_mean:['hrv_sdnn_mean','hrv_sdnn_ms'],steps_sum_raw:['steps_sum_raw','steps']};
  /** @type {{dateCount:number,dateRange:(string|undefined)[]|null,metrics:Record<string,{unit:string,totalDays:number,recentDays:number,priorDays:number,recentMean:number|null,priorMean:number|null,delta:number|null,status:string}>,fatigue:string,recovery:string,performance:string,caveats:string[]}} */
  const output={dateCount:dates.length, dateRange:dates.length?[dates[0],dates.at(-1)]:null, metrics:{}, fatigue:'UNKNOWN', recovery:'UNKNOWN', performance:'UNKNOWN', caveats:['No causality inferred','Raw step sums may overlap between devices','No automatic plan changes']};
  for(const [key,unit] of Object.entries(metrics)) {
    const samples=dates.map(d=>({date:d,value:finite(aliases[key].map(k=>byDate.get(d)?.[k]).find(v=>v!==undefined && v!==''))})).filter(x=>x.value!==null && x.value>=0 && (key!=='resting_hr_mean'||x.value>0));
    const current=samples.filter(x=>recent.includes(x.date));
    const prior=samples.filter(x=>!recent.includes(x.date));
    /** @param {{value:number|null}[]} a */
    const mean=a=>a.length?a.reduce((s,x)=>s+(x.value??0),0)/a.length:null;
    const valid=current.length>=minimumDays && prior.length>=minimumDays;
    output.metrics[key]={unit, totalDays:samples.length,recentDays:current.length,priorDays:prior.length,recentMean:valid?mean(current):null,priorMean:valid?mean(prior):null,delta:valid?(mean(current)??0)-(mean(prior)??0):null,status:valid?'DESCRIPTIVE_ONLY':'INSUFFICIENT_DATA'};
  }
  return output;
}
