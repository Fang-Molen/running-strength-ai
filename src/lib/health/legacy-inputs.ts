import { currentAthleteId } from '../core/events'
/** Read-only compatibility with v74 local records; no UI, accounts or automatic migration. */
import { currentStore, type MemoryStore } from '../core/storage'
import { validDay } from './observation'
export type WatchId = 'pro' | 'basic' | 'none'
export type Checkin = { athleteId?:string; date:string; at:string; fatigue?:'fresh'|'ok'|'tired'; pain?:'none'|'mild'|'sharp'; sleep?:number; recovery?:number; /** v81：量表标记。10 = 1–10（现行）；缺省且 ≤5 = 旧 1–5 表单（原值不改，读取时 ×2）。 */ recoveryScale?:5|10 }
export type ScheduleEntry = {
  id:string; date:string; kind:'run'|'strength'|'coach'; modality:'run'|'strength'|'rest'; title:string;
  focus:string[]; minutes:number; intensity:'EASY'|'MODERATE'|'HARD'; lowerHeavy:boolean;
  source:'fangkun'|'custom'; refId:string|null; status:'proposed'|'planned'|'done'|'skipped'|'rejected'; unplanned?:boolean;
  actual?:{outcome:'as_planned'|'different'|'missed'; minutes:number|null; km?:number|null; intensity:'EASY'|'MODERATE'|'HARD'|null; note:string; reasons:string[]; at:string};
  exercises?:{catalogId?:string|null;name:string;sets:string;reps:string;weight:string;rpe:string}[];
}
export function readArray(key:string,s:MemoryStore|null=currentStore()):{rows:unknown[];unreadable:boolean}{
  try {const raw=s?.getItem(key);if(!raw)return {rows:[],unreadable:false};const v=JSON.parse(raw);return Array.isArray(v)?{rows:v,unreadable:false}:{rows:[],unreadable:true}}
  catch{return {rows:[],unreadable:true}}
}
export function validCheckin(v:unknown):v is Checkin{
  if(!v||typeof v!=='object')return false;const c=v as Checkin;
  return validDay(c.date)&&typeof c.at==='string'&&Number.isFinite(Date.parse(c.at))
    &&(c.fatigue===undefined||['fresh','ok','tired'].includes(c.fatigue))
    &&(c.pain===undefined||['none','mild','sharp'].includes(c.pain))
    &&(c.sleep===undefined||Number.isFinite(c.sleep)&&c.sleep>=0.1&&c.sleep<=24)
    &&(c.recovery===undefined||Number.isFinite(c.recovery)&&c.recovery>=1&&c.recovery<=10)&&(c.recoveryScale===undefined||c.recoveryScale===5||c.recoveryScale===10);
}
export function loadCheckins(s:MemoryStore|null=currentStore()):Checkin[]{return readArray('fk-checkin-v1',s).rows.filter(validCheckin).filter(x=>(x.athleteId??'local')===currentAthleteId())}
export function checkinsUnreadable():boolean{const r=readArray('fk-checkin-v1');return r.unreadable||r.rows.some(x=>!validCheckin(x))}
export function loadWatch(s:MemoryStore|null=currentStore()):WatchId|null{
  try{const v=JSON.parse(s?.getItem('fk-watch-v1')??'null');return ['pro','basic','none'].includes(v?.watch)?v.watch:null}catch{return null}
}
export function saveWatch(w:WatchId,s:MemoryStore|null=currentStore()):boolean{
  if(!['pro','basic','none'].includes(w)||!s)return false;
  try{const old=JSON.parse(s.getItem('fk-watch-v1')??'{}');const raw=JSON.stringify({...old,watch:w});s.setItem('fk-watch-v1',raw);return s.getItem('fk-watch-v1')===raw}catch{return false}
}

/** v81 统一主观恢复量表：一律按 1–10 读。旧 1–5 表单存的值（无 recoveryScale 且 ≤5，或 recoveryScale=5）按 ×2 换算显示/判断；存储里的原值不改（可逆）。 */
export function recovery10(c?:{recovery?:number;recoveryScale?:number}|null):number|null{
  const v=c?.recovery; if(v==null||!Number.isFinite(v))return null
  if(c!.recoveryScale===10)return v>=1&&v<=10?v:null
  if(c!.recoveryScale===5||v<=5)return v>=1&&v<=5?v*2:null
  return v<=10?v:null
}
/** 是否旧 1–5 记录换算而来（用于标注“原 x/5”）。 */
export const recoveryFromLegacy5=(c?:{recovery?:number;recoveryScale?:number}|null)=>c?.recovery!=null&&c.recoveryScale!==10&&(c.recoveryScale===5||c.recovery<=5)
export const recoveryText=(c?:{recovery?:number;recoveryScale?:number}|null)=>{const v=recovery10(c);return v==null?null:`${v}/10${recoveryFromLegacy5(c)?`（原 1–5 量表 ${c!.recovery}/5）`:''}`}
