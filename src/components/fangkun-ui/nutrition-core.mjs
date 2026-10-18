// @ts-nocheck -- supplied pure module, host validates inputs
/** Pure nutrient, portions and immutable event projection for an isolated demo module. */
export const STORAGE_VERSION=1;
const FIELDS=['kcal','protein','carbs','fat'];
export function round(n,dec=1){return Math.round((n+Number.EPSILON)*10**dec)/10**dec;}
export function validFinite(x){return typeof x==='number'&&Number.isFinite(x);}
export function sanitizeNutrition(n){const out={};for(const k of FIELDS){out[k]=validFinite(n?.[k])&&n[k]>=0?round(n[k],2):null;}return out;}
export function scaleNutrients(food,portion){
 const qty=Number(portion?.amount);if(!(qty>0&&Number.isFinite(qty)))throw Error('份量必须大于0');
 const unit=portion?.unit;
 const isG=food.per100g===true;
 if ((isG&&unit!=='g')||(!isG&&unit!=='份'))throw Error('所选份量单位与食物计量基准不符');
 const mul=isG?qty/100:qty; const source=sanitizeNutrition(food.nutrients),out={};
 for(const field of FIELDS)out[field]=source[field]===null?null:round(source[field]*mul,2);
 return out;
}
export function makeEntry(food,portion,{date,meal='午餐',note='',id,createdAt}={}){
 if(!food||!food.id||!id||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('缺少合法的记录ID或日期');
 const source=food.source||{kind:'CUSTOM_UNVERIFIED',status:'UNVERIFIED'};
 return {id,date,meal,foodId:food.id,foodName:food.name,brand:food.brand||'自定义',region:food.region||'未指定',variant:food.variant||'',category:food.category||'其他',portion:{unit:portion.unit,amount:Number(portion.amount)},nutrients:scaleNutrients(food,portion),nutrientsAtEntry:sanitizeNutrition(food.nutrients),source:{...source},note:String(note||'').slice(0,250),createdAt:createdAt||new Date().toISOString()};
}
export function applyMealEvents(events=[]){
 const record=new Map();const history=new Map();
 for(const evt of events){if(!evt||typeof evt.id!=='string'||typeof evt.entityId!=='string')continue;
  if(!['ADD','AMEND','VOID'].includes(evt.op))continue;
  const target=evt.entityId;
  if(evt.op==='ADD'){
    if(record.has(target)||!evt.payload||evt.payload.id!==target)continue;
    record.set(target,{...evt.payload});
  }else if(evt.op==='AMEND'){
    if(!record.has(target)||record.get(target).voided||!evt.payload)continue;
    const prior=record.get(target);record.set(target,{...prior,...evt.payload,id:target,createdAt:prior.createdAt,updatedAt:evt.at});
  }else if(evt.op==='VOID'){
    if(!record.has(target)||record.get(target).voided)continue;
    record.set(target,{...record.get(target),voided:true,updatedAt:evt.at});
  }
  const h=history.get(target)||[];h.push(evt.id);history.set(target,h);
 }
 return {entries:[...record.values()].filter(x=>!x.voided).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))),history};
}
export function summarizeDay(entries,date){const today=entries.filter(x=>x.date===date),totals={},unquantified={};
 for(const f of FIELDS){let sum=0,missing=0;for(const x of today){if(validFinite(x.nutrients?.[f]))sum+=x.nutrients[f];else missing++;}totals[f]=round(sum);unquantified[f]=missing;}
 return {date,count:today.length,knownSubtotal:totals,unknownCount:unquantified,complete:today.length>0&&FIELDS.every(f=>unquantified[f]===0),hasEntries:today.length>0};
}
export function cloneWithAdjustedPortion(entry,food,portion,reason='调整份量'){
 return {...entry,portion:{unit:portion.unit,amount:Number(portion.amount)},nutrients:scaleNutrients(food,portion),note:[entry.note,reason].filter(Boolean).join('｜').slice(0,250)};
}
export function keyFor(food){return `${food.brand||'自定义'}|${food.region||'未指定'}|${food.id}|${food.variant||''}`;}
export function validateCustomFood(food){
 if(!food||typeof food.name!=='string'||!food.name.trim())return '请输入食品名称';
 if(!food.brand||!food.region)return '需要品牌和国家/地区';
 if(!food.per100g&&!food.amount)return '需要核定一份对应的数量';
 if(!food.nutrients||!validFinite(food.nutrients.kcal)||food.nutrients.kcal<0)return '热量缺失时请保持待核，不能用0代替';
 for(const key of ['protein','carbs','fat'])if(food.nutrients[key]!=null&&(!validFinite(food.nutrients[key])||food.nutrients[key]<0))return '营养素不得为负数或非数值';
 return null;
}
export function mergeBackup(current,backup){
 if(backup?.schema!=='fk-nh-backup-v1'||!Array.isArray(backup.events))throw Error('备份格式无效');
 if(backup.events.length>20000)throw Error('备份过大，请先检查');
 const map=new Map(current.map(x=>[x.id,x]));let added=0;
 for(const e of backup.events){if(typeof e?.id!=='string'||typeof e?.entityId!=='string'||!['ADD','AMEND','VOID'].includes(e?.op))continue;if(!map.has(e.id)){map.set(e.id,e);added++;}}
 return {events:[...map.values()].sort((a,b)=>(a.at||'').localeCompare(b.at||'')),added};
}
export function newEvent(op,entityId,payload=null,now=new Date()){
 const id=(globalThis.crypto?.randomUUID?.()||`${now.getTime()}-${Math.random().toString(36).slice(2)}`);
 return {id,entityId,op,payload,at:now.toISOString()};
}
