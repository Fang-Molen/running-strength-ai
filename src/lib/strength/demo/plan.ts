import {exerciseById} from '../catalog'
import {moveFromCatalog,type Plan} from '../model'
import {savePlanCompared,type PlanStore} from '../session-builder'
import data from './data.json' with {type:'json'}
export function demoExerciseDefaults(id:string){
 const e=data.exercises.find(e=>e.id===id)
 return e?{name:e.name_zh,sets:e.default_sets,amount:e.default_reps_or_time.amount,mode:e.default_reps_or_time.mode as 'reps'|'seconds',restSec:e.default_rest_sec,bodyweight:e.equipment.every(x=>/无器械/.test(x))}:null
}
export type DemoAppendReceipt={before:Plan;afterRaw:string;sessionId:string;moveId:string}
/** Called only after explicit confirmation and under the existing plan Web Lock. */
export function appendDemoMoveCompared(store:PlanStore,expected:string|null,plan:Plan,sessionId:string,catalogId:string,weightKg:number){
 const e=exerciseById(catalogId),defaults=demoExerciseDefaults(catalogId),session=plan.sessions.find(s=>s.id===sessionId)
 if(!e||!defaults||!session||!Number.isFinite(weightKg)||weightKg<0)return {ok:false as const,reason:'动作、课程或明确重量无效，未加入。'}
 if(session.moves.some(m=>m.catalogId===catalogId))return {ok:false as const,reason:'今日课程已有该动作；请在原动作中核对组次，不自动重复加量。'}
 const move=moveFromCatalog(e,{sets:defaults.sets,amount:defaults.amount,mode:defaults.mode,restSec:defaults.restSec,weightKg,executionNote:'用户明确确认加入；默认参数来自动作演示交接包，不代表个体适配或医学许可。'})
 const next={...plan,sessions:plan.sessions.map(s=>s.id===sessionId?{...s,moves:[...s.moves,move]}:s)},result=savePlanCompared(store,expected,next)
 return result.ok?{...result,plan:next,receipt:{before:plan,afterRaw:result.raw,sessionId,moveId:move.id}}:result
}
export function undoDemoMoveCompared(store:PlanStore,receipt:DemoAppendReceipt){
 const result=savePlanCompared(store,receipt.afterRaw,receipt.before)
 return result.ok?{...result,plan:receipt.before}:result
}
