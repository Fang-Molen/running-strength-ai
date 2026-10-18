import {currentAthleteId,dispatchEvent,loadEvents} from '../core/events'
import {aggregate,loadEntries,validFoodEntry,type FoodEntry,type Meal} from './log'
import {validDate} from '../ui/fieldwork-plan-drafts'
import {todayDate} from './body'
import {FOODS as suppliedFoods} from '../../components/fangkun-ui/food-catalog.mjs'
import {scaleNutrients} from '../../components/fangkun-ui/nutrition-core.mjs'

export type Nutrients=Record<'kcal'|'protein'|'carbs'|'fat',number|null>&{fiber?:number|null}
export type Food={id:string;name:string;brand:string;region:string;variant?:string;category:string;emoji?:string;per100g?:boolean;amount:number;nutrients:Nutrients;source:{kind:string;status:string;uri:string|null;notes:string;checkedOn:string|null}}
export const catalogue = suppliedFoods as readonly Food[]
export function customFoods():Food[]{return loadEvents().filter(e=>e.athlete_id===currentAthleteId()&&e.event_type==='NUTRITION_RECORDED').flatMap(e=>{const f=e.payload.customFood as Food|undefined;return f&&validFood(f)?[f]:[]})}
export function validFood(f:Food):boolean{return !!f&&typeof f.id==='string'&&typeof f.name==='string'&&!!f.name.trim()&&f.name.length<=80&&typeof f.brand==='string'&&!!f.brand.trim()&&typeof f.region==='string'&&!!f.region.trim()&&!!f.nutrients&&['kcal','protein','carbs','fat'].every(k=>{const n=f.nutrients[k as keyof Nutrients];return n===null||typeof n==='number'&&Number.isFinite(n)&&n>=0})&&(f.nutrients.fiber==null||typeof f.nutrients.fiber==='number'&&Number.isFinite(f.nutrients.fiber)&&f.nutrients.fiber>=0)&&!!f.source&&typeof f.source.kind==='string'}
export function saveCustomFood(input:Omit<Food,'id'>):Food|null{const f={...input,id:'label-'+crypto.randomUUID()};if(!validFood(f))return null;return dispatchEvent('NUTRITION_RECORDED',{customFood:f})&&customFoods().find(x=>x.id===f.id)||null}
export function scaledFood(food:Food,amount:number):Nutrients{const base=scaleNutrients(food,{amount,unit:food.per100g?'g':'份'}) as Nutrients;return {...base,fiber:food.nutrients.fiber==null?null:Math.round(food.nutrients.fiber*(food.per100g?amount/100:amount)*100)/100}}
export function mealRevision(row:FoodEntry):string{return row.revisionId||JSON.stringify(row)}
export type MealInput={food:Food;amount:number;meal:Meal;date:string;time:string;note:string;acknowledged:boolean;id?:string;expectedRevision?:string}
export function commitMeal(input:MealInput):{ok:true;row:FoodEntry}|{ok:false;reason:string}{
 const {food,amount,date,time}=input
 if(!validFood(food)||!validDate(date)||date>todayDate()||!['早餐','午餐','晚餐','加餐'].includes(input.meal)||!Number.isFinite(amount)||amount<=0||amount>10000)return {ok:false,reason:'请核对食物、份量和实际日期。'}
 const old=input.id?loadEntries().find(r=>r.id===input.id):undefined
 if(input.id&&(!old||mealRevision(old)!==input.expectedRevision))return {ok:false,reason:'这条餐食已变化，请重新打开后更正。'}
 const hasValues=Object.values(food.nutrients).some(v=>v!==null)
 if(hasValues&&!input.acknowledged)return {ok:false,reason:'请确认本次记录采用所列来源和规格；不确定时改为手动填写。'}
 let eatenAt:string|undefined
 if(time){const m=/^(\d{2}):(\d{2})$/.exec(time);if(!m||Number(m[1])>23||Number(m[2])>59)return {ok:false,reason:'实际进食时间无效。'};const t=new Date(date+'T'+time+':00');if(!Number.isFinite(t.getTime())||t.getTime()>Date.now())return {ok:false,reason:'实际进食时间不能晚于现在。'};eatenAt=t.toISOString()}
 const n=scaledFood(food,amount),revisionId=crypto.randomUUID()
 const row:FoodEntry={id:old?.id??'food-'+crypto.randomUUID(),revisionId,date,meal:input.meal,name:food.name,kcal:n.kcal,protein:n.protein??undefined,carbs:n.carbs??undefined,fat:n.fat??undefined,fiber:n.fiber??null,grams:food.per100g?amount:undefined,athleteId:currentAthleteId(),source:'MANUAL',recordedAt:new Date().toISOString(),eatenAt,
  foodSnapshot:{foodId:food.id,brand:food.brand,region:food.region,variant:food.variant??'',amount,unit:food.per100g?'g':'份',nutrients:{...food.nutrients},source:{...food.source},note:input.note.slice(0,250)},label:`${food.brand} · ${food.region} · ${food.source.status}`}
 if(!validFoodEntry(row)||!dispatchEvent('NUTRITION_RECORDED',{foodEntry:row,previousRevision:old?mealRevision(old):null}))return {ok:false,reason:'保存失败，输入仍保留。'}
 return loadEntries().some(r=>r.id===row.id&&r.revisionId===revisionId)?{ok:true,row}:{ok:false,reason:'未能回读保存结果。'}
}
export async function withMealLock<T>(fn:()=>T):Promise<T|{ok:false;reason:string}>{const athlete=currentAthleteId();if(typeof navigator==='undefined'||!navigator.locks?.request)return {ok:false,reason:'此浏览器暂不支持安全保存，请保留输入。'};return navigator.locks.request('fr255-fieldwork-v4-write',()=>currentAthleteId()===athlete?fn():{ok:false as const,reason:'当前运动员已变化，请重新打开。'})}
export function nutritionTotals(rows:FoodEntry[]){const a=aggregate(rows);return Object.fromEntries((['kcal','protein','carbs','fat','fiber'] as const).map(k=>{const t=a[k==='carbs'?'carb':k];return [k,{value:t.known?t.sum:null,missing:t.pending}]})) as Record<keyof Nutrients,{value:number|null;missing:number}>}
