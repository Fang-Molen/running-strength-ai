/** BUILD 45B: Features are free. Only explicitly metered external model calls require a grant. */
export const FREE_FEATURES = [
  'period_planning','season_planning','plan_editing','training_execution','training_history',
  'strength','recovery','injury_safety','nutrition','product_management',
  'device_import','image_upload','local_ocr','manual_image_review','basic_coach',
  'memory_review','backup_restore'
] as const;
export type FreeFeature = typeof FREE_FEATURES[number];
export type ModelRoute = 'local' | 'free_remote' | 'metered_remote';
export type RouteDecision = { allowed: boolean; reason: 'FREE_FEATURE'|'CONSENT_REQUIRED'|'OFFLINE'|'SERVER_REQUIRED'|'CREDITS_REQUIRED'|'AUTHORIZED'; requiresPayment: boolean };
export function decideFeatureAccess(_feature: FreeFeature): RouteDecision {
  return {allowed:true,reason:'FREE_FEATURE',requiresPayment:false};
}
export function decideModelRoute(input: {route:ModelRoute; online:boolean; consent:boolean; serverAuthorized:boolean; credits:number; cost:number}): RouteDecision {
  if(input.route==='local') return {allowed:true,reason:'FREE_FEATURE',requiresPayment:false};
  if(!input.online) return {allowed:false,reason:'OFFLINE',requiresPayment:input.route==='metered_remote'};
  if(!input.consent) return {allowed:false,reason:'CONSENT_REQUIRED',requiresPayment:input.route==='metered_remote'};
  if(input.route==='free_remote') return {allowed:true,reason:'AUTHORIZED',requiresPayment:false};
  if(!input.serverAuthorized) return {allowed:false,reason:'SERVER_REQUIRED',requiresPayment:true};
  if(!Number.isSafeInteger(input.cost)||input.cost<=0||!Number.isSafeInteger(input.credits)||input.credits<input.cost) return {allowed:false,reason:'CREDITS_REQUIRED',requiresPayment:true};
  return {allowed:true,reason:'AUTHORIZED',requiresPayment:true};
}
