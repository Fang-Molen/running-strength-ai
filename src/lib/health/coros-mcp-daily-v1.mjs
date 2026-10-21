// @ts-nocheck  研究模块原样保留（纯 JS，休眠，未接入界面）
/** v89.9.4 休眠（DORMANT）：没有方坤自己的高驰官方 OAuth/MCP 数据源，不被任何界面引用、不进打包；缺失=null/UNKNOWN，不补数。 */
/** COROS MCP daily-data boundary: only consumes server-verified, consented responses.
 * Does not authenticate to COROS, invoke MCP, or fabricate an hourly Body Battery.
 */
const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
const day=(v)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))?v:null;
/** The server adapter must explicitly map COROS provider fields to this contract. */
export function normalizeCorosDailyBatch(batch,athleteId){
 if(!batch||batch.provider!=='COROS_MCP'||batch.verifiedOwner!==true||batch.athleteId!==athleteId||!/^[-\w]{6,100}$/.test(batch.accountRef||'')||!Array.isArray(batch.days)) return {facts:[],warnings:['COROS_OWNER_OR_SCHEMA_UNVERIFIED']};
 const warnings=[],byKey=new Map(),conflicts=new Set();
 for(const r of batch.days){
  const date=day(r.date);if(!date||typeof r.recordId!=='string'||!r.recordId||!Number.isInteger(r.revision??0)){warnings.push('INVALID_DAY');continue}
  const metrics=[['STEPS',r.steps,'steps',0,250000],['ACTIVE_ENERGY',r.activeEnergyKcal,'kcal',0,20000],['TOTAL_ENERGY',r.totalEnergyKcal,'kcal',0,30000],['SLEEP_MINUTES',r.sleepMinutes,'min',0,1440],['RESTING_HR',r.restingHr,'bpm',25,200],['SLEEP_HRV',r.sleepHrvMs,'ms',1,500]];
  for(const [metric,raw,unit,min,max] of metrics){const value=num(raw,min,max);if(value===null)continue;
   const key=`${batch.accountRef}:${date}:${metric}`;const item={provider:'COROS',sourceId:`coros:${batch.accountRef}`,recordId:r.recordId,revision:r.revision??0,date,metric,value,unit,final:r.final===true,protocol:metric==='SLEEP_HRV'?(r.hrvProtocol||'COROS_SLEEP_HRV'):null};const old=byKey.get(key);
   if(!old||item.revision>old.revision){byKey.set(key,item);conflicts.delete(key)}else if(item.revision===old.revision&&(item.value!==old.value||item.recordId!==old.recordId)){conflicts.add(key);warnings.push('CONFLICT_SAME_REVISION')}
  }
 }
 return {facts:[...byKey.entries()].filter(([k])=>!conflicts.has(k)).map(([,v])=>v),warnings};
}
/** Device-derived indicators are observations, not diagnoses or training clearance. */
export function corosRecoveryEvidence(facts,date){const own=facts.filter(f=>f.provider==='COROS'&&f.date===date);const get=m=>own.find(f=>f.metric===m)?.value??null;
 return {date,steps:get('STEPS'),activeEnergyKcal:get('ACTIVE_ENERGY'),sleepMinutes:get('SLEEP_MINUTES'),restingHr:get('RESTING_HR'),sleepHrvMs:get('SLEEP_HRV'),fatigueDiagnosis:null,bodyBattery:null,trainingPermission:'UNDETERMINED',source:'COROS'};
}
