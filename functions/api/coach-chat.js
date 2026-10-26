// The public route uses the existing server-owned subject/snapshot/consent resolver.
// Browser facts or a local consent preference cannot authorize provider dispatch.
import { onRequestPost as trustedPost } from '../../server/coach-deepseek/coach-chat.controller.js';
import { onRequestGet as status } from '../../server/coach-deepseek/coach-status.js';
import { proxyCoachBackend } from './coach-backend.js';
/** @param {{request:Request,env?:Record<string,any>,data?:{fangkunCoachServices?:import('../../server/coach-deepseek/lib/coach-service-contract.ts').FangkunCoachServices}}} context */
export function onRequestPost(context) {
  if (context.data?.fangkunCoachServices) return trustedPost(context);
  if (context.env?.FANGKUN_COACH_BACKEND || context.env?.FANGKUN_COACH_BACKEND_ORIGIN) return proxyCoachBackend(context);
  return trustedPost(context);
}
/** @param {{request:Request,env?:Record<string,any>,data?:{fangkunCoachServices?:import('../../server/coach-deepseek/lib/coach-service-contract.ts').FangkunCoachServices}}} context */
export function onRequestGet(context) {
  return context.env?.FANGKUN_COACH_BACKEND || context.env?.FANGKUN_COACH_BACKEND_ORIGIN ? proxyCoachBackend(context) : status(context);
}
