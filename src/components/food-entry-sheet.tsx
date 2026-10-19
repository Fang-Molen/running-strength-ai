import {useEffect,useMemo,useRef,useState} from 'react';
import './food-entry-sheet.css';
import {Sheet} from './sheet';
import {FoodPhotoReview} from './food-photo-review';
import {FoodLabelScan} from './food-label-scan';
import {loadCn,loadUsda,search,similarFoods,portionUnits,sourceLabel,needsCheck,type FoodRow} from '@/lib/nutrition/food-db';
import {currentAthleteId} from '@/lib/core/events';
import {todayDate} from '@/lib/nutrition/body';
import {MEALS,type Meal,type FoodEntry,type NutrientKey} from '@/lib/nutrition/log';
import {changeFoodAmount,commitFoodDraft,draftFromEntry,draftFromProduct,emptyFoodDraft,foodPreview,NUTRIENT_KEYS,NUTRIENT_LABELS,type NutritionDraft} from '@/lib/nutrition/entry-workflow';
import {isOnlineOn} from '@/lib/ui/online-features';
import {visionStatus} from '@/lib/vision/client';

const unitOf=(k:NutrientKey)=>k==='kcal'?'kcal':'g';
const fmtN=(v:number|null|undefined,k:NutrientKey)=>v==null?'—':`${v}${k==='kcal'?' kcal':' g'}`;
/** v79 记录饮食：一个拍照入口；搜索即选；没搜到 → 相近食物估算 / 联网估算 / 自己填；常用份量单位；估算标明、未知留空；一个确认按钮。 */
export function FoodEntrySheet({meal,entry,initialDate,onClose,onSaved}:{meal:Meal;entry?:FoodEntry;initialDate?:string;onClose:()=>void;onSaved:()=>void}){
 const actor=useRef(currentAthleteId()),revision=useRef(entry?.revisionId|| (entry?JSON.stringify(entry):undefined));
 const draftKey='fk-food-draft-v2:'+actor.current;
 const [draft,setDraft]=useState<NutritionDraft>(()=>{if(entry)return draftFromEntry(entry);try{const d=JSON.parse(localStorage.getItem(draftKey)||'null');if(d?.values&&NUTRIENT_KEYS.every(k=>typeof d.values[k]==='string')&&typeof d.name==='string')return d}catch{/* untouched invalid draft */}return emptyFoodDraft()});
 const [date,setDate]=useState(entry?.date||initialDate||todayDate()),[mealValue,setMeal]=useState(entry?.meal||meal),[ready,setReady]=useState(0),[dbError,setDbError]=useState(''),[manual,setManual]=useState(!!entry),[error,setError]=useState(''),[busy,setBusy]=useState(false);const saving=useRef(false);const [scanned,setScanned]=useState<NutrientKey[]>([]);
 const [est,setEst]=useState<{busy:boolean;msg:string;note?:string}>({busy:false,msg:''}),[vision,setVision]=useState<boolean|null>(null),[showValues,setShowValues]=useState(false);
 useEffect(()=>{let live=true;void loadCn().then(()=>live&&setReady(v=>v+1)).catch(()=>live&&setDbError('食物库暂未加载，可自己填写；未知项留空。'));void loadUsda().then(()=>live&&setReady(v=>v+1)).catch(()=>{});void visionStatus().then(v=>live&&setVision(v)).catch(()=>live&&setVision(false));return()=>{live=false}},[]);
 useEffect(()=>{if(entry||currentAthleteId()!==actor.current)return;try{localStorage.setItem(draftKey,JSON.stringify(draft))}catch{/* input remains in component */}},[draft,draftKey,entry]);
 const set=(patch:Partial<NutritionDraft>)=>{setDraft(x=>({...x,...patch,...(patch.values||patch.unit||patch.basis?{quantityReference:undefined}:{})}));setError('')};
 const picked=manual||!!draft.selected||!!draft.retained;
 const hits=useMemo(()=>picked?[]:search(draft.name,8),[draft.name,picked,ready]);
 const similar=useMemo(()=>picked||hits.length||draft.name.trim().length<3?[]:similarFoods(draft.name,4),[draft.name,picked,hits.length,ready]);
 let preview:ReturnType<typeof foodPreview>|null=null;try{preview=foodPreview(draft)}catch{/* validated before saving */}
 const selected=draft.selected,source=draft.estimateSource||(selected?sourceLabel(selected):draft.retained?.source.label);
 const estimated=!!draft.estimateSource||(selected?needsCheck(selected)||selected.src==='D':!!draft.retained?.source.estimated);
 const units=selected?portionUnits(selected):[];
 const choose=(food:FoodRow,asSimilar=false)=>{const d=draftFromProduct(food),u=portionUnits(food)[0];setDraft({...d,...(asSimilar?{name:draft.name.trim(),estimateSource:`相近食物估算：${food.n}（${sourceLabel(food)}）`}:{}),...(food.b==='g'&&u?.grams?{portion:{label:u.label,grams:u.grams,count:'1'},amount:String(u.grams)}:{})});setManual(true);setShowValues(false);setError('')};
 const setCount=(count:string)=>{const p=draft.portion;if(!p)return;const n=Number(count);setDraft(d=>({...d,portion:{...p,count},amount:p.grams&&Number.isFinite(n)&&n>0?String(Math.round(n*p.grams*10)/10):''}))};
 const pickUnit=(label:string,grams:number|null)=>{if(label==='g'){setDraft(d=>({...d,portion:undefined,amount:d.amount||'100'}));return}const n=Number(draft.portion?.count||'1');setDraft(d=>({...d,portion:{label,grams,count:String(n)},amount:grams?String(Math.round(n*grams*10)/10):''}))};
 async function onlineEstimate(){setEst({busy:true,msg:'联网估算中（只发食物名称和份量）…'});try{const r=await fetch('/api/food-estimate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:draft.name.trim()})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.result){setEst({busy:false,msg:`联网估算不可用（${j.error||r.status}）。可用相近食物或自己填。`});return}
  const o=j.result;setDraft({...emptyFoodDraft(),name:draft.name.trim(),unit:'份',basis:'serv',amount:'1',estimateSource:`联网估算（DeepSeek）·待核${o.grams?` · 1${o.unit||'份'}约${o.grams}g`:''}`,values:Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,o[k]==null?'':String(o[k])])) as NutritionDraft['values']});setManual(true);setShowValues(true);setEst({busy:false,msg:'',note:o.note})}catch{setEst({busy:false,msg:'联网估算失败，可用相近食物或自己填。'})}}
 async function save(){if(saving.current)return;saving.current=true;setBusy(true);try{const result=commitFoodDraft({draft,date,meal:mealValue,acknowledged:true,athleteId:actor.current,entryId:entry?.id,expectedRevision:revision.current});if(!result.ok){setError(result.reason);return}if(!entry)try{localStorage.removeItem(draftKey)}catch{/* committed record is durable */}onSaved();onClose()}finally{saving.current=false;setBusy(false)}}
 const cell='fk-cell min-h-11 w-full text-base';
 const valuesEditable=!selected&&!draft.retained||showValues;
 return <Sheet label={entry?'编辑饮食记录':'登记饮食'} title={entry?'更正食物与营养':'记录饮食'} onClose={onClose} footer={<><p role="alert" className="keep mb-2 text-sm text-amber-400">{error}</p><button type="button" className="fk-orange-btn min-h-12 w-full rounded-xl font-bold disabled:opacity-40" disabled={busy||!draft.name.trim()||!preview} onClick={()=>void save()}>{busy?'保存中…':entry?'确认保存更正':'确认保存饮食'}</button></>}>
 <div className="fk-food-entry space-y-3">
 <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted">日期<input aria-label="饮食记录日期" type="date" max={todayDate()} value={date} onChange={e=>setDate(e.target.value)} className={cell}/></label><label className="text-xs text-muted">餐次<select aria-label="饮食餐次" value={mealValue} onChange={e=>setMeal(e.target.value as Meal)} className={cell}>{MEALS.map(m=><option key={m}>{m}</option>)}</select></label></div>
 <div><input aria-label="吃了什么" placeholder="吃了什么？如 灌汤小笼包、伯牙绝弦" value={draft.name} onChange={e=>{setDraft({...emptyFoodDraft(),name:e.target.value.slice(0,80)});setManual(false);setEst({busy:false,msg:''})}} className={cell}/>
 {hits.length?<ul aria-label="搜索结果" className="mt-1 divide-y divide-line rounded-xl border border-line">{hits.map(food=><li key={food.i}><button type="button" className="min-h-12 w-full px-3 py-2 text-left" onClick={()=>choose(food)}><b className="block text-sm">{food.n}</b><span className="keep block text-[11px] text-muted">{food.br?food.br+' · ':''}{food.b==='g'?`每100g ${food.p?.[0]??'—'} kcal`:`${food.s.u} ${food.s.v?.[0]??'—'} kcal`} · {sourceLabel(food)}</span></button></li>)}</ul>:null}
 {!picked&&draft.name.trim()&&!hits.length?<section aria-label="没找到" className="mt-1 space-y-2 rounded-xl border border-line p-2 text-sm"><p className="keep text-xs text-muted">食物库里没有「{draft.name.trim()}」。</p>
  {similar.length?<div><p className="keep text-xs font-bold">用相近食物估算（结果标“估算”）</p><div className="mt-1 flex flex-wrap gap-1.5">{similar.map(f=><button key={f.i} type="button" className="fk-chip min-h-10" onClick={()=>choose(f,true)}>{f.n}</button>)}</div></div>:null}
  <div className="flex flex-wrap gap-2">{isOnlineOn('foodEstimate')?<button type="button" className="fk-chip min-h-10" disabled={est.busy} onClick={()=>void onlineEstimate()}>{est.busy?'估算中…':'联网估算'}</button>:null}<button type="button" className="fk-chip min-h-10" onClick={()=>{setManual(true);setShowValues(true)}}>自己填</button></div>
  {est.msg?<p role="status" className="keep text-xs text-amber-400">{est.msg}</p>:null}</section>:null}
 {dbError?<p className="keep text-xs text-amber-400">{dbError}</p>:null}</div>
 {picked?<section aria-label="本次营养预览" className="space-y-2 rounded-xl border border-accent/40 p-3">
  <p className="keep text-xs text-muted">{estimated?<b className="mr-1 rounded bg-amber-500/20 px-1 text-amber-400">估算</b>:null}{source||'自己填写'}{est.note?` · ${est.note}`:''}</p>
  {selected&&(units.length||selected.b==='g')?<div className="flex flex-wrap gap-1.5" role="group" aria-label="份量单位">{(selected.b==='g'?[...units,{label:'g',grams:1}]:units).map(u=><button key={u.label} type="button" aria-pressed={selected.b==='serv'||(u.label==='g'?!draft.portion:draft.portion?.label===u.label)} className="fk-chip min-h-9" onClick={()=>selected.b==='g'&&pickUnit(u.label,u.grams)}>{u.label}{u.label!=='g'&&u.grams?` ≈${u.grams}g`:''}</button>)}</div>:null}
  <div className="flex items-center gap-2"><label className="flex-1 text-xs text-muted">份量<input aria-label="份量" type="number" min="0.01" max="10000" step="any" value={draft.portion?draft.portion.count:draft.amount} onChange={e=>draft.portion?setCount(e.target.value):setDraft(d=>changeFoodAmount(d,e.target.value))} className={cell}/></label>
   <span className="mt-4 text-sm">{draft.portion?`${draft.portion.label}${preview?.grams!=null?`（${preview.grams}g）`:''}`:selected?.b==='serv'?(units[0]?.label??'份'):!selected&&!draft.retained?<select aria-label="份量单位" value={draft.unit} onChange={e=>set({unit:e.target.value as 'g'|'份',basis:'this'})} className="fk-cell min-h-11"><option>g</option><option>份</option></select>:draft.unit}</span></div>
  <p className="text-sm"><b>{fmtN(preview?.total.kcal,'kcal')}</b> · 蛋白质 {fmtN(preview?.total.protein,'protein')} · 碳水 {fmtN(preview?.total.carb,'carb')} · 脂肪 {fmtN(preview?.total.fat,'fat')}{preview?.total.fiber!=null?` · 纤维 ${fmtN(preview.total.fiber,'fiber')}`:''}</p>
  {preview&&NUTRIENT_KEYS.some(k=>preview!.total[k]==null)?<p className="keep text-[11px] text-muted">— = 未知，不按 0 计。</p>:null}
  {selected||draft.retained?<button type="button" className="text-xs text-accent" aria-expanded={showValues} onClick={()=>setShowValues(!showValues)}>{showValues?'收起营养数值':'改营养数值'}</button>:null}
  {valuesEditable?<>{!selected&&!draft.retained?<label className="block text-xs text-muted">数值对应<select aria-label="营养基准" value={draft.basis} onChange={e=>set({basis:e.target.value as NutritionDraft['basis']})} className={cell}><option value="this">这次吃的总量</option><option value="100g" disabled={draft.unit!=='g'}>每100g</option><option value="serv" disabled={draft.unit!=='份'}>每份</option></select></label>:null}
   <div className="grid grid-cols-3 gap-1.5">{NUTRIENT_KEYS.map(k=><label key={k} className="text-[11px] text-muted">{NUTRIENT_LABELS[k]}（{unitOf(k)}）<input aria-label={'填写'+NUTRIENT_LABELS[k]} type="number" min="0" step="any" placeholder="未知" value={draft.values[k]} onChange={e=>set({values:{...draft.values,[k]:e.target.value},userEdited:[...new Set([...draft.userEdited,k])] as NutrientKey[]})} className={cell+(scanned.includes(k)?' ring-2 ring-accent':'')}/></label>)}</div></>:null}
 </section>:null}
 {!entry?<FoodLabelScan onResult={(r,filled)=>{setDraft(d=>({...emptyFoodDraft(),name:d.name.trim()||r.name||'包装食品（标签识别）',brand:r.brand||d.brand,basis:r.basis,unit:r.basis==='serv'?'份':'g',amount:r.basis==='serv'?'1':r.basis==='this'?(r.servingGrams?String(r.servingGrams):d.amount):'',values:Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,r.values[k]==null?'':String(r.values[k])])) as NutritionDraft['values'],userEdited:[]}));setScanned(filled);setManual(true);setShowValues(true);setError('')}}>
  {vision?<details className="mt-2"><summary className="min-h-10 cursor-pointer text-xs text-accent">菜品照片（没有文字）→ 识图估算</summary><FoodPhotoReview meal={mealValue} date={date} onSaved={onSaved}/></details>
   :<p className="keep mt-2 text-xs text-muted" data-testid="dish-photo-status">菜品照片（没有文字）识别：{vision===null?'检查中…':'未配置视觉模型（DeepSeek 不支持图片）'}</p>}
 </FoodLabelScan>:null}
 {entry?<p className="keep text-xs text-muted">保存更正会保留原值及来源历史。</p>:null}
 </div></Sheet>
}
