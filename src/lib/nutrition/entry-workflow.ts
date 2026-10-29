/** Five-nutrient snapshots. Calculations never turn absent label values into zero. */
import {currentAthleteId} from '../core/events';
import {validDate} from '../ui/fieldwork-plan-drafts';
import {todayDate} from './body';
import {loadEntries,recordManualFood,updateEntry,nutrientOf,findFoodRequest,type FoodEntry,type Meal,type NutrientKey} from './log';
import {defaultAmount,sourceLabel,needsCheck,type FoodRow,type Macros} from './food-db';
export const NUTRIENT_KEYS: NutrientKey[]=['kcal','protein','carb','fat','fiber'];
export const NUTRIENT_LABELS={kcal:'热量',protein:'蛋白质',carb:'碳水',fat:'脂肪',fiber:'膳食纤维'};
export const FOOD_DATA_VERSION='fangkun-food-library-20261019-r3';
export type NutritionSnapshot={version:1;dataVersion:string;foodId:string|null;name:string;brand:string;region:string;basis:'100g'|'serv'|'this';base:Macros;total:Macros;amount:number;unit:'g'|'份';grams:number|null;source:{label:string;uri:string|null;status:string;estimated:boolean};userEdited:NutrientKey[];confirmedAt:string};
export type NutritionDraft={name:string;brand:string;selected:FoodRow|null;amount:string;unit:'g'|'份';basis:NutritionSnapshot['basis'];values:Record<NutrientKey,string>;userEdited:NutrientKey[];retained?:NutritionSnapshot;quantityReference?:{amount:number;values:Record<NutrientKey,string>};/** v79：估算来源（相近食物 / 联网估算），保存时标“估算” */estimateSource?:string;portion?:{label:string;grams:number|null;count:string}};
export const emptyFoodDraft=():NutritionDraft=>({name:'',brand:'',selected:null,amount:'',unit:'g',basis:'this',values:{kcal:'',protein:'',carb:'',fat:'',fiber:''},userEdited:[]});
export function draftFromProduct(food:FoodRow):NutritionDraft{
 const base=food.b==='g'?food.p:food.s.v;
 return {...emptyFoodDraft(),name:food.n,brand:food.br||'',selected:food,amount:String(defaultAmount(food)),unit:food.b==='g'?'g':'份',basis:food.b==='g'?'100g':'serv',values:Object.fromEntries(NUTRIENT_KEYS.map((k,i)=>[k,base?.[i]==null?'':String(base[i])])) as NutritionDraft['values']};
}
export function draftFromEntry(row:FoodEntry):NutritionDraft{
 const s=row.nutritionSnapshot;
 if(s)return {...emptyFoodDraft(),name:row.name,brand:s.brand,amount:String(s.amount),unit:s.unit,basis:s.basis,values:Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,s.base[k]==null?'':String(s.base[k])])) as NutritionDraft['values'],userEdited:[...s.userEdited],retained:s};
 // Legacy totals are retained exactly; editing quantity can explicitly scale those totals.
 return {...emptyFoodDraft(),name:row.name,brand:row.foodSnapshot?.brand||'',amount:String(row.amount??row.grams??row.foodSnapshot?.amount??''),unit:row.unit==='份'?'份':'g',values:Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,nutrientOf(row,k)==null?'':String(nutrientOf(row,k))])) as NutritionDraft['values']};
}
export function foodPreview(d: NutritionDraft):{base:Macros;total:Macros;grams:number|null}{
 const amount=Number(d.amount);
 if(!d.amount.trim()||!Number.isFinite(amount)||amount<=0||amount>10000)throw Error('请填写有效份量。');
 if(d.basis==='100g'&&d.unit!=='g'||d.basis==='serv'&&d.unit!=='份')throw Error('营养基准与份量单位不一致，请重新核对。');
 const base={} as Macros,total={} as Macros;
 const factor=d.basis==='100g'?amount/100:d.basis==='serv'?amount:1;
 for(const k of NUTRIENT_KEYS){const raw=d.values[k]?.trim()??'',v=raw===''?null:Number(raw);if(v!==null&&(!Number.isFinite(v)||v<0))throw Error('营养值无效；未知项目请留空。');base[k]=v;total[k]=v===null?null:Math.round(v*factor*(k==='kcal'?1:10))/(k==='kcal'?1:10)}
 const servingGrams=d.selected?.s.g??(d.retained?.grams!=null?d.retained.grams/d.retained.amount:null);
 return {base,total,grams:d.unit==='g'?amount:typeof servingGrams==='number'&&Number.isFinite(servingGrams)&&servingGrams>0?Math.round(servingGrams*amount*100)/100:null};
}
export function changeFoodAmount(d:NutritionDraft,amount:string):NutritionDraft{
 if(d.basis!=='this')return {...d,amount};
 const reference=d.quantityReference??(Number(d.amount)>0?{amount:Number(d.amount),values:{...d.values}}:undefined),after=Number(amount);
 if(!reference||!Number.isFinite(after)||after<=0)return {...d,amount,quantityReference:reference};
 return {...d,amount,quantityReference:reference,values:Object.fromEntries(NUTRIENT_KEYS.map(k=>{const raw=reference.values[k];return [k,raw.trim()===''?'':String(Number(raw)*after/reference.amount)]})) as NutritionDraft['values']};
}
export type FoodSaveInput={draft:NutritionDraft;date:string;meal:Meal;acknowledged:boolean;athleteId:string;entryId?:string;expectedRevision?:string;requestId?:string};
export function commitFoodDraft(input:FoodSaveInput):{ok:true;row:FoodEntry}|{ok:false;reason:string}{
 try{
  if(input.athleteId!==currentAthleteId())throw Error('当前运动员已变化，请重新打开记录。');
  const requestFingerprint=input.requestId?JSON.stringify({draft:input.draft,date:input.date,meal:input.meal,athleteId:input.athleteId,entryId:input.entryId,expectedRevision:input.expectedRevision}):undefined;
  if(input.requestId){
   if(!input.requestId.trim())throw Error('保存请求无效，请重新打开记录。');
   const original=findFoodRequest(input.requestId);
   if(original){
    if(!input.acknowledged||original.row.requestFingerprint!==requestFingerprint)throw Error('此保存请求的内容已变化，请重新打开记录。');
    const current=loadEntries().find(row=>row.id===original.row.id);
    if(!current||JSON.stringify(current)!==JSON.stringify(original.row))throw Error('这条饮食已被更正或撤销，请重新查看记录。');
    return {ok:true,row:current};
   }
  }
  if(!validDate(input.date)||input.date>todayDate())throw Error('请填写有效的实际日期，不能记入未来。');
  const d=input.draft;if(!d.name.trim())throw Error('请填写食物名称。');
  if(!input.acknowledged)throw Error('请核对食物、份量、来源及本次营养后确认保存。');
  const prior=input.entryId?loadEntries().find(r=>r.id===input.entryId):null;
  if(input.entryId&&(!prior||(prior.revisionId||JSON.stringify(prior))!==input.expectedRevision))throw Error('记录已变化，请重新打开后更正。');
  const p=foodPreview(d),date=new Date().toISOString(),product=d.selected,retained=d.retained;
  const originalSource=d.estimateSource?{label:d.estimateSource,uri:product?.uri||null,status:'ESTIMATED',estimated:true}:product?{label:sourceLabel(product),uri:product.uri||null,status:product.st,estimated:needsCheck(product)}:retained?.source??{label:'用户手填',uri:null,status:'USER_REPORTED',estimated:true};
  const source={...originalSource,estimated:originalSource.estimated||d.userEdited.length>0};
  const snapshot:NutritionSnapshot={version:1,dataVersion:product?FOOD_DATA_VERSION:retained?.dataVersion||'user-entry-v1',foodId:product?.i??retained?.foodId??null,name:d.name.trim(),brand:d.brand.trim(),region:product?.rg||retained?.region||'',basis:d.basis,...p,amount:Number(d.amount),unit:d.unit,source:{...source},userEdited:[...d.userEdited],confirmedAt:date};
  const patch={name:snapshot.name,date:input.date,meal:input.meal,amount:snapshot.amount,unit:d.unit,grams:p.grams??undefined,kcal:p.total.kcal,protein:p.total.protein??undefined,carb:p.total.carb,carbs:undefined,fat:p.total.fat,fiber:p.total.fiber,foodId:snapshot.foodId??undefined,foodSnapshot:undefined,nutritionSnapshot:snapshot,
   label:p.total.kcal==null?'营养待补充':source.label+(d.userEdited.length?'·人工补充':''),nutritionSource:{kind:product||retained?'DATABASE_SNAPSHOT':'MANUAL',at:date,evidence:[source.label,d.brand,source.uri].filter(Boolean).join(' · '),uncertainty:source.estimated?'来源值或用户估计尚待核对；未知字段保留为空。':'所用产品版本已记录，仍需核对实物规格。',reviewed:true},source:'MANUAL' as const,revisionId:crypto.randomUUID(),
   // Changing the local day cannot retain the previous day's timestamp as a fact.
   eatenAt:prior?.date===input.date?prior.eatenAt:undefined,...(input.requestId?{requestId:input.requestId,requestFingerprint}:{requestId:undefined,requestFingerprint:undefined})};
  if(input.entryId){const saved=updateEntry(input.entryId,patch,input.expectedRevision);const row=saved?.find(r=>r.id===input.entryId);if(!row)throw Error('保存失败或记录已变化，输入仍保留。');return {ok:true,row}}
  const row=recordManualFood(patch);if(!row)throw Error('保存失败，输入仍保留。');return {ok:true,row};
 }catch(error){return {ok:false,reason:error instanceof Error?error.message:'保存失败，输入仍保留。'}}
}
export function missingNutrition(rows:FoodEntry[],key?:NutrientKey){return rows.map(row=>({row,fields:NUTRIENT_KEYS.filter(k=>(!key||key===k)&&nutrientOf(row,k)==null)})).filter(x=>x.fields.length)}
