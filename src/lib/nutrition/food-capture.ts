/** Reusable food capture service. The existing nutrition journal is the receipt store. */
import {currentAthleteId, dispatchEvent, loadEvents} from '../core/events';
import {currentStore} from '../core/storage';
import {validDate} from '../ui/fieldwork-plan-drafts';
import {commitFoodDraft, NUTRIENT_KEYS, type FoodSaveInput, type NutritionDraft} from './entry-workflow';
import {findFoodRequest, foodChanged, loadEntries, MEALS, validFoodEntry, type FoodEntry, type Meal} from './log';

export type FoodCaptureReceipt={requestId:string;eventId:string;entryId:string;athleteId:string;revisionId:string;recordedAt:string;date:string;meal:Meal;name:string;amount:number|null;unit:string|null;status:'saved'|'changed'|'undone'|'removed';canUndo:boolean};
export type FoodCaptureDraft={version:1;requestId:string;athleteId:string;date:string;meal:Meal;draft:NutritionDraft};
const draftKey=(athleteId:string)=>`fk-food-capture-draft-v1:${athleteId}`;

function validDraft(value:unknown):value is NutritionDraft {
 if(!value||typeof value!=='object')return false;
 const d=value as NutritionDraft;
 return typeof d.name==='string'&&typeof d.brand==='string'&&typeof d.amount==='string'&&['g','份'].includes(d.unit)&&['100g','serv','this'].includes(d.basis)&&!!d.values&&NUTRIENT_KEYS.every(key=>typeof d.values[key]==='string')&&Array.isArray(d.userEdited);
}
export function loadFoodCaptureDraft(athleteId:string):FoodCaptureDraft|null {
 if(athleteId!==currentAthleteId())return null;
 try{
  const value=JSON.parse(currentStore()?.getItem(draftKey(athleteId))||'null') as FoodCaptureDraft|null;
  return value?.version===1&&value.athleteId===athleteId&&typeof value.requestId==='string'&&!!value.requestId.trim()&&validDate(value.date)&&MEALS.includes(value.meal)&&validDraft(value.draft)?value:null;
 }catch{return null}
}
export function storeFoodCaptureDraft(input:FoodCaptureDraft):boolean {
 if(input.athleteId!==currentAthleteId()||!validDraft(input.draft))return false;
 try{
  const box=currentStore();if(!box)return false;
  const value=JSON.stringify({version:1,requestId:input.requestId,athleteId:input.athleteId,date:input.date,meal:input.meal,draft:input.draft});box.setItem(draftKey(input.athleteId),value);return box.getItem(draftKey(input.athleteId))===value;
 }catch{return false}
}
export function clearFoodCaptureDraft(athleteId:string,requestId:string) {
 if(loadFoodCaptureDraft(athleteId)?.requestId!==requestId)return;
 try{currentStore()?.removeItem?.(draftKey(athleteId))}catch{/* Durable receipt prevents duplicate saving if draft cleanup fails. */}
}

export function loadFoodCaptureReceipts():FoodCaptureReceipt[] {
 const athleteId=currentAthleteId(),events=loadEvents(),rows=loadEntries(),seen=new Set<string>(),receipts:FoodCaptureReceipt[]=[];
 for(const event of events){
  if(event.event_type!=='NUTRITION_RECORDED'||event.athlete_id!==athleteId)continue;
  const row=event.payload.foodEntry as FoodEntry|undefined;
  if(!row?.requestId||row.athleteId!==athleteId||!validFoodEntry(row)||seen.has(row.requestId))continue;
  seen.add(row.requestId);
  const current=rows.find(item=>item.id===row.id);
  const undone=events.some(item=>item.event_type==='NUTRITION_RECORDED'&&item.athlete_id===athleteId&&item.payload.undoneFoodRequestId===row.requestId&&item.payload.removedFoodId===row.id);
  const status=current?(JSON.stringify(current)===JSON.stringify(row)?'saved':'changed'):undone?'undone':'removed';
  receipts.push({requestId:row.requestId,eventId:event.event_id,entryId:row.id,athleteId,revisionId:row.revisionId||JSON.stringify(row),recordedAt:row.recordedAt||event.timestamp,date:row.date,meal:row.meal,name:row.name,amount:row.amount??row.grams??null,unit:row.unit??(row.grams!=null?'g':null),status,canUndo:status==='saved'&&!event.payload.previousRevision});
 }
 return receipts.reverse();
}
export function saveFoodCapture(input:FoodSaveInput & {requestId:string}):{ok:true;row:FoodEntry;receipt:FoodCaptureReceipt}|{ok:false;reason:string} {
 if(!input.requestId.trim())return {ok:false,reason:'保存请求无效，请重新打开记录。'};
 const result=commitFoodDraft(input);if(!result.ok)return result;
 const receipt=loadFoodCaptureReceipts().find(item=>item.requestId===input.requestId);
 if(!receipt)return {ok:false,reason:'未能读取保存回执，草稿仍保留，请重试。'};
 clearFoodCaptureDraft(input.athleteId,input.requestId);
 return {...result,receipt};
}
export function undoFoodCapture(receipt:FoodCaptureReceipt):{ok:true;receipt:FoodCaptureReceipt}|{ok:false;reason:string} {
 if(receipt.athleteId!==currentAthleteId())return {ok:false,reason:'运动员已变化，请重新查看回执。'};
 const original=findFoodRequest(receipt.requestId),current=loadFoodCaptureReceipts().find(item=>item.requestId===receipt.requestId);
 if(!original||!current||current.eventId!==receipt.eventId||current.entryId!==receipt.entryId)return {ok:false,reason:'找不到这次保存的原始回执。'};
 if(current.status==='undone')return {ok:true,receipt:current};
 if(!current.canUndo)return {ok:false,reason:'记录已更正或移除，不能撤销这次保存。'};
 if(!dispatchEvent('NUTRITION_RECORDED',{removedFoodId:current.entryId,undoneFoodRequestId:current.requestId,previousRevision:current.revisionId}))return {ok:false,reason:'撤销未保存，请重试；原记录仍保留。'};
 foodChanged();
 return {ok:true,receipt:{...current,status:'undone',canUndo:false}};
}
