import {useEffect,useMemo,useRef,useState} from 'react';
import './food-entry-sheet.css';
import {Sheet} from './sheet';
import {FoodPhotoReview} from './food-photo-review';
import {FoodLabelScan} from './food-label-scan';
import {loadCn,loadUsda,search,sourceLabel,needsCheck} from '@/lib/nutrition/food-db';
import {currentAthleteId} from '@/lib/core/events';
import {todayDate} from '@/lib/nutrition/body';
import {MEALS,type Meal,type FoodEntry,type NutrientKey} from '@/lib/nutrition/log';
import {changeFoodAmount,commitFoodDraft,draftFromEntry,draftFromProduct,emptyFoodDraft,foodPreview,NUTRIENT_KEYS,NUTRIENT_LABELS,type NutritionDraft} from '@/lib/nutrition/entry-workflow';

export function FoodEntrySheet({meal,entry,initialDate,onClose,onSaved}:{meal:Meal;entry?:FoodEntry;initialDate?:string;onClose:()=>void;onSaved:()=>void}){
 const actor=useRef(currentAthleteId()),revision=useRef(entry?.revisionId|| (entry?JSON.stringify(entry):undefined));
 const draftKey='fk-food-draft-v2:'+actor.current;
 const [draft,setDraft]=useState<NutritionDraft>(()=>{if(entry)return draftFromEntry(entry);try{const d=JSON.parse(localStorage.getItem(draftKey)||'null');if(d?.values&&NUTRIENT_KEYS.every(k=>typeof d.values[k]==='string')&&typeof d.name==='string')return d}catch{/* untouched invalid draft */}return emptyFoodDraft()});
 const [date,setDate]=useState(entry?.date||initialDate||todayDate()),[mealValue,setMeal]=useState(entry?.meal||meal),[ready,setReady]=useState(0),[dbError,setDbError]=useState(''),[manual,setManual]=useState(!!entry),[error,setError]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false);const saving=useRef(false);const [scanned,setScanned]=useState<NutrientKey[]>([]);
 useEffect(()=>{let live=true;void loadCn().then(()=>live&&setReady(v=>v+1)).catch(()=>live&&setDbError('食物库暂未加载，可手动填写并保留未知项。'));void loadUsda().then(()=>live&&setReady(v=>v+1)).catch(()=>{});return()=>{live=false}},[]);
 useEffect(()=>{if(entry||currentAthleteId()!==actor.current)return;try{localStorage.setItem(draftKey,JSON.stringify(draft))}catch{/* input remains in component */}},[draft,draftKey,entry]);
 const set=(patch:Partial<NutritionDraft>)=>{setDraft(x=>({...x,...patch,...(patch.values||patch.unit||patch.basis?{quantityReference:undefined}:{})}));setAck(false);setError('')};
 const hits=useMemo(()=>manual||draft.selected||draft.retained?[]:search(draft.name,12),[draft.name,draft.selected,draft.retained,manual,ready]);
 let preview:ReturnType<typeof foodPreview>|null=null;try{preview=foodPreview(draft)}catch{/* validated before saving */}
 const selected=draft.selected,source=selected?sourceLabel(selected):draft.retained?.source.label;
 async function save(){if(saving.current)return;saving.current=true;setBusy(true);try{const result=commitFoodDraft({draft,date,meal:mealValue,acknowledged:ack,athleteId:actor.current,entryId:entry?.id,expectedRevision:revision.current});if(!result.ok){setError(result.reason);return}if(!entry)try{localStorage.removeItem(draftKey)}catch{/* committed record is durable */}onSaved();onClose()}finally{saving.current=false;setBusy(false)}}
 const cell='fk-cell min-h-11 w-full text-base';
 return <Sheet label={entry?'编辑饮食记录':'登记饮食'} title={entry?'更正食物与营养':'记录饮食'} onClose={onClose} footer={<><p role="alert" className="keep mb-2 text-sm text-amber-400">{error}</p><button type="button" className="fk-orange-btn min-h-12 w-full rounded-xl font-bold disabled:opacity-40" disabled={busy||!ack||!draft.name.trim()||!preview} onClick={()=>void save()}>{busy?'保存中…':entry?'确认保存更正':'确认保存饮食'}</button></>}>
 <div className="fk-food-entry space-y-4">
 <div className="grid grid-cols-2 gap-2"><label className="text-sm">记录日期<input aria-label="饮食记录日期" type="date" max={todayDate()} value={date} onChange={e=>{setDate(e.target.value);setAck(false)}} className={cell}/></label><label className="text-sm">餐次<select aria-label="饮食餐次" value={mealValue} onChange={e=>{setMeal(e.target.value as Meal);setAck(false)}} className={cell}>{MEALS.map(m=><option key={m}>{m}</option>)}</select></label></div>
 <label className="block text-sm">食物名称<input aria-label="吃了什么" placeholder="输入食物或品牌，选择对应产品" value={draft.name} onChange={e=>{setDraft({...emptyFoodDraft(),name:e.target.value.slice(0,80)});setManual(false);setAck(false)}} className={cell}/></label>
 {!entry?<FoodLabelScan onResult={(r,filled)=>{setDraft(d=>({...emptyFoodDraft(),name:d.name.trim()||r.name||'包装食品（标签识别）',brand:r.brand||d.brand,basis:r.basis,unit:r.basis==='serv'?'份':'g',amount:r.basis==='serv'?'1':r.basis==='this'?(r.servingGrams?String(r.servingGrams):d.amount):'',values:Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,r.values[k]==null?'':String(r.values[k])])) as NutritionDraft['values'],userEdited:[]}));setScanned(filled);setManual(true);setAck(false);setError('')}}/>:null}
 {dbError?<p className="text-xs text-amber-400">{dbError}</p>:null}
 {hits.length?<ul aria-label="搜索结果" className="divide-y divide-line rounded-xl border border-line">{hits.map(food=><li key={food.i}><button type="button" className="min-h-14 w-full p-3 text-left" onClick={()=>{setDraft(draftFromProduct(food));setManual(true);setAck(false)}}><b className="block">{food.n}</b><span className="keep block text-xs text-muted">{food.br||'通用食物'} · {food.rg||'地区未注明'} · {food.b==='g'?'每100g':food.s.u||'每份'} · {sourceLabel(food)}{needsCheck(food)?'，数值待核':''}</span></button></li>)}<li><button type="button" className="min-h-12 w-full p-3 text-left text-accent" onClick={()=>{setManual(true);setAck(false)}}>都不是，手动记录这份食物</button></li></ul>:null}
 {draft.name.trim()&&!hits.length?<>
 <label className="block text-sm">品牌／商家<input aria-label="食物品牌" value={draft.brand} disabled={!!selected||!!draft.retained} onChange={e=>set({brand:e.target.value.slice(0,80)})} className={cell}/></label>
 {source?<p className="keep text-xs text-muted">{source} · {selected?.rg||draft.retained?.region||'地区未注明'}<br/>{selected?.uri||draft.retained?.source.uri||'来源链接未提供'}{draft.retained?' · 采用保存时的版本，不自动更新历史数值':''}</p>:<p className="keep text-xs text-muted">未匹配到已确认产品。可填写包装标签；未知项目留空，名称本身不会生成营养值。</p>}
 <div className="grid grid-cols-2 gap-2"><label className="text-sm">份量<input aria-label="份量" type="number" min="0.01" max="10000" step="any" value={draft.amount} onChange={e=>{setDraft(d=>changeFoodAmount(d,e.target.value));setAck(false)}} className={cell}/></label><label className="text-sm">单位<select aria-label="份量单位" disabled={!!selected||!!draft.retained} value={draft.unit} onChange={e=>set({unit:e.target.value as 'g'|'份',basis:'this'})} className={cell}><option>g</option><option>份</option></select></label></div>
 <label className="block text-sm">营养标签基准<select aria-label="营养基准" value={draft.basis} disabled={!!selected||!!draft.retained} onChange={e=>set({basis:e.target.value as NutritionDraft['basis']})} className={cell}><option value="this">本次摄入总量</option><option value="100g" disabled={draft.unit!=='g'}>每100g</option><option value="serv" disabled={draft.unit!=='份'}>每份</option></select></label>
 <div className="grid grid-cols-2 gap-2">{NUTRIENT_KEYS.map(k=><label key={k} className="text-xs">{NUTRIENT_LABELS[k]}（{k==='kcal'?'kcal':'g'}）<input aria-label={'填写'+NUTRIENT_LABELS[k]} type="number" min="0" step="any" placeholder="未知留空" value={draft.values[k]} onChange={e=>set({values:{...draft.values,[k]:e.target.value},userEdited:[...new Set([...draft.userEdited,k])] as NutrientKey[]})} className={cell+(scanned.includes(k)?' ring-2 ring-accent':'')}/></label>)}</div>
 <section aria-label="本次营养预览" className="rounded-xl border border-accent/40 p-3"><b>本次摄入预览</b><p className="keep text-xs text-muted">按 {draft.amount||'待填'} {draft.unit}{preview?.grams!=null&&draft.unit==='份'?' · '+preview.grams+'g':''} 折算。修改份量会重算五项营养。</p>{NUTRIENT_KEYS.map(k=><p key={k} className="flex justify-between text-sm"><span>{NUTRIENT_LABELS[k]}</span><span>{preview?.total[k]==null?'待补充':preview.total[k]+' '+(k==='kcal'?'kcal':'g')}</span></p>)}</section>
 <label className="flex min-h-12 items-start gap-2 text-sm"><input aria-label="确认食物与营养" type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} className="mt-1"/>我已核对品牌、份量、日期和以上数值；未知项保留待补充，估计值不当作实测。</label>
 </>:null}
 {!entry?<details><summary className="min-h-11 text-sm text-accent">联网识图估算（需访问码，会上传图片）</summary><FoodPhotoReview meal={mealValue} date={date} onSaved={onSaved}/></details>:null}
 <p className="keep text-xs text-muted">{entry?'保存更正会保留原值及来源历史。':'关闭后保留本运动员的填写草稿。'}不会自动补全其他历史记录。</p>
 </div></Sheet>
}
