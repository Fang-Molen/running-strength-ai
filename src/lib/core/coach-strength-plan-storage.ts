/** Single-key compare-before-write for the legacy localStorage plan schema.
 * NOT a true CAS across uncooperative tabs; caller must use Web Locks and re-check. */
import type {Plan} from '../strength/model.ts'
export const COACH_STRENGTH_PLAN_KEY='fr255-strength-plan-v3'
export type PlanStore={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void}
export function commitControlledStrengthPlan(store:PlanStore,expectedRaw:string,next:Plan):{ok:boolean;reason:string}{
  if(!expectedRaw)return {ok:false,reason:'没有可校验的原计划快照'}
  if(store.getItem(COACH_STRENGTH_PLAN_KEY)!==expectedRaw)return {ok:false,reason:'计划版本冲突，拒绝覆盖'}
  const previous=JSON.parse(expectedRaw) as Plan
  const oldRev=previous.coachEditRevision??0
  if(next.coachEditRevision!==oldRev+1||next.coachEditHistory?.length!==(previous.coachEditHistory?.length??0)+1)return {ok:false,reason:'计划与审计修订不一致'}
  const raw=JSON.stringify(next)
  try{
    store.setItem(COACH_STRENGTH_PLAN_KEY,raw)
    if(store.getItem(COACH_STRENGTH_PLAN_KEY)!==raw)return {ok:false,reason:'保存后校验失败，禁止宣称成功'}
    return {ok:true,reason:'已保存同一版本的计划与审计'}
  }catch{return {ok:false,reason:'本机存储写入失败，未确认成功'}}
}
