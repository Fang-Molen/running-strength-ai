// Deterministic reference utilities. No medical diagnosis, model call, persistence or prescription approval.
const missing=x=>x===undefined||x===null||x==='';
function finite(x,min=0){if(typeof x!=='number'||!Number.isFinite(x)||x<min)throw new TypeError('Invalid numeric input');return x;}
export function retrieve(cards,input){
 if(!Array.isArray(cards)||!input||typeof input.task!=='string')throw new TypeError('Explicit task required');
 const matched=[],needsInput=[],excluded=[];
 for(const c of cards){
  if(!c.tasks.includes(input.task))continue;
  if(c.population!==input.population){excluded.push({id:c.id,reason:'POPULATION_MISMATCH_OR_UNKNOWN'});continue;}
  const gaps=c.required.filter(k=>missing(input[k]));
  if(gaps.length)needsInput.push({id:c.id,missing:gaps});else matched.push(c);
 }
 return {question:input.question??'',task:input.task,matched,needsInput,excluded,status:'REFERENCE_SELECTION_ONLY',autoExecute:false};
}
export function scaleRange(ref,weightKg){
 finite(weightKg,Number.MIN_VALUE);
 if(ref.unit!=='g/kg/day'||!Array.isArray(ref.range)||ref.range.length!==2)throw new TypeError('Unsupported reference');
 const [a,b]=ref.range.map(v=>finite(v));if(a>b)throw new TypeError('Reversed range');
 return {range:[a*weightKg,b*weightKg].map(x=>Number(x.toFixed(4))),unit:'g/day',status:'REFERENCE_NOT_PRESCRIPTION'};
}
export function compareSessions(a,b){
 const keys=['event','start','timing','surface','restSeconds','purpose','distanceM'];
 const unknown=keys.filter(k=>missing(a[k])||missing(b[k]));
 const differences=keys.filter(k=>!unknown.includes(k)&&a[k]!==b[k]);
 return {status:unknown.length?'INSUFFICIENT':differences.length?'REFERENCE_ONLY':'CONDITIONALLY_COMPARABLE',unknown,differences,limitation:'Weather, device error, effort and individual state still require review; not evidence of causation.'};
}
export function loadRatio(days){
 if(!Array.isArray(days)||days.length!==28)throw new TypeError('28 ordered daily observations required');
 days.filter(x=>!missing(x)).forEach(x=>finite(x));
 if(days.some(missing))return {ratio:null,status:'INCOMPLETE'};
 const acute=days.slice(-7).reduce((a,b)=>a+b,0)/7,chronic=days.reduce((a,b)=>a+b,0)/28;
 return {ratio:chronic?acute/chronic:null,acuteDailyMean:acute,chronicDailyMean:chronic,status:chronic?'DESCRIPTIVE_ONLY':'NO_BASELINE',method:'rolling means; overlapping 7/28 days; not injury risk'};
}
export function nutritionTotal(items,nutrient){
 let knownSum=0,count=0;for(const i of items){if(missing(i[nutrient]))count++;else knownSum+=finite(i[nutrient]);}
 return {knownSum,missing:count,status:count?'PARTIAL':'COMPLETE'};
}
