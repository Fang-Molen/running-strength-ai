/** Configuration inspection only: no authentication, snapshot reads, model call or billing. */
/** @param {import('./lib/coach-service-contract.ts').FangkunCoachServices | undefined} services */
export function trustedBindingsPresent(services) {
  return !!services && typeof services.authenticate === 'function' && typeof services.loadAuthorizedSnapshot === 'function' && typeof services.getVerifiedPolicy === 'function'
    && !!services.ledger && typeof services.ledger.reserve === 'function' && typeof services.ledger.markDispatched === 'function' && typeof services.ledger.settle === 'function';
}
/** @param {{env?:Record<string,string|undefined>,data?:{fangkunCoachServices?:import('./lib/coach-service-contract.ts').FangkunCoachServices}}} [context] */
export function onRequestGet({env = {}, data = {}} = {}) {
  const reason = env.FANGKUN_DEEPSEEK_ENABLED !== 'true' ? 'SERVICE_DISABLED'
    : !trustedBindingsPresent(data.fangkunCoachServices) ? 'TRUSTED_BINDINGS_MISSING'
    : typeof env.DEEPSEEK_API_KEY !== 'string' || !env.DEEPSEEK_API_KEY.trim() ? 'SERVICE_KEY_MISSING' : null;
  return Response.json({service: 'fangkun-coach', configured: reason === null, reason,
    connectionVerified: false, authorizationVerified: false, billingVerified: false},
    {headers: {'cache-control': 'no-store'}});
}
