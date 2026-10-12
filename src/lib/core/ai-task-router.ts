/** BUILD 45C: deterministic, non-network task routing. No client-side grants or billing. */
import { decideModelRoute, type ModelRoute } from './ai-feature-policy.ts';
export type AiTask = 'period_plan'|'product_management'|'training_log'|'basic_coach'|'image_ocr'|'image_semantics'|'deep_reasoning';
export type RouteRequest = {task:AiTask; requestedRoute?:ModelRoute; online:boolean; consent:boolean; serverAuthorized:boolean; credits:number; estimatedCost:number; safetyBlocked?:boolean; userConfirmedImageUpload?:boolean};
export type RoutingResult = {route:ModelRoute; allowed:boolean; reason:string; billable:boolean; fallback:'local'|'manual_review'|null; requiresExplicitConfirmation:boolean};
const DEFAULT_ROUTES:Record<AiTask,ModelRoute> = {
  period_plan:'local',product_management:'local',training_log:'local',basic_coach:'local',image_ocr:'local',image_semantics:'free_remote',deep_reasoning:'metered_remote'
};
export function routeAiTask(input:RouteRequest):RoutingResult {
  const route=input.requestedRoute ?? DEFAULT_ROUTES[input.task];
  const fallback = input.task.startsWith('image_') ? 'manual_review' : 'local';
  if(input.safetyBlocked) return {route,allowed:false,reason:'SAFETY_BLOCKED',billable:false,fallback:null,requiresExplicitConfirmation:false};
  if(route!=='local' && input.task.startsWith('image_') && !input.userConfirmedImageUpload)
    return {route,allowed:false,reason:'IMAGE_UPLOAD_CONFIRMATION_REQUIRED',billable:false,fallback:'manual_review',requiresExplicitConfirmation:true};
  const result=decideModelRoute({route,online:input.online,consent:input.consent,serverAuthorized:input.serverAuthorized,credits:input.credits,cost:input.estimatedCost});
  return {route,allowed:result.allowed,reason:result.reason,billable:route==='metered_remote' && result.allowed,fallback:result.allowed?null:fallback,requiresExplicitConfirmation:route!=='local'};
}
