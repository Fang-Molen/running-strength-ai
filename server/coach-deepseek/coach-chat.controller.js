// DORMANT (v84): Codex 1019y 受信快照+预算账本版 coach-chat 控制器，仅作参考与单测，不在 functions/ 下、不会部署成路由。
// 线上 /api/coach-chat 仍是 functions/api/coach-chat.js（v83 口径，按 IP 限流，无费用上限——用户 10-19 决定）。
import { normalizeAskCoachInput, buildCoachModelRequest, interpretCoachModelOutput, coachLocalSafetyTurn } from '../../src/lib/strength/coach-pipeline.ts';
import { MODEL_DEV_USER_ID } from '../../src/lib/strength/model-access.ts';
import { assertDeepSeekNumericGrounding } from '../../src/lib/coach/deepseek-grounding.ts';
import { selectDeepSeekRoute, estimateInputTokenUpperBound } from '../../src/lib/coach/deepseek-policy.ts';
import { parseCoachRequest, assertSnapshotBinding, assertVerifiedPolicy, minimalCoachInput, aliasCoachInput, costMicros } from './lib/coach-request-boundary.ts';
import { providerReturnedModel, parseProviderUsage, validateProviderReply, boundedResponseJson } from './lib/coach-provider-boundary.ts';

/** @param {unknown} value @param {number} [status] */
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
/** @param {unknown} value */
const utf8 = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** @param {unknown} value */
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
/** @param {string} code @param {number} [status] */
const failure = (code,status=503) => json({ok:false,error:code,text:'联网解释当前不可用；保留本地训练分析与原计划。'},status);
/**
 * Cloudflare Pages entry. context.data ports MUST be installed by trusted server middleware.
 * Missing auth/snapshot/persistent-ledger/verified billing configuration fails closed.
 * No IP counter, body userId, browser facts, implicit consent, retry, tool or plan write.
 * @param {{request:Request,env?:Record<string,string|undefined>,data?:{fangkunCoachServices?:import('./lib/coach-service-contract.ts').FangkunCoachServices}}} context
 */
export async function onRequestPost({request,env={},data={}}) {
  const services = data.fangkunCoachServices;
  if (env.FANGKUN_DEEPSEEK_ENABLED !== 'true') return failure('SERVICE_DISABLED');
  if (!services || typeof services.authenticate !== 'function' || typeof services.loadAuthorizedSnapshot !== 'function' || typeof services.getVerifiedPolicy !== 'function' || !services.ledger || typeof services.ledger.reserve !== 'function' || typeof services.ledger.markDispatched !== 'function' || typeof services.ledger.settle !== 'function') return failure('TRUSTED_BINDINGS_MISSING');
  const now = services.now?.() ?? Date.now();
  let subject;
  try { subject=await services.authenticate(request); } catch { return failure('AUTH_UNAVAILABLE'); }
  if (!subject || subject.verified !== true || typeof subject.id !== 'string' || !subject.id.trim() || subject.id.trim() === MODEL_DEV_USER_ID || !Array.isArray(subject.athleteIds) || !subject.athleteIds.length || subject.athleteIds.some(id=>typeof id!=='string'||!id)) return failure('AUTH_REQUIRED',401);
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return failure('CONTENT_TYPE',415);
  if (Number(request.headers.get('content-length')??0)>4096) return failure('REQUEST_TOO_LARGE',413);
  let refs;
  try { refs=parseCoachRequest(await boundedResponseJson(new Response(request.body,{headers:request.headers}),4096)); } catch(error) { const tooLarge=error instanceof Error && error.message==='PROVIDER_BODY_CAP'; return failure(tooLarge?'REQUEST_TOO_LARGE':'REQUEST_INVALID',tooLarge?413:400); }
  if (Date.parse(refs.asOf)>now) return failure('AS_OF_FUTURE',400);
  let snapshot, canonical, aliased, modelRequest, policy, route;
  try {
    snapshot=await services.loadAuthorizedSnapshot(subject,refs);
    assertSnapshotBinding(snapshot,subject,refs,now);
    canonical=normalizeAskCoachInput(minimalCoachInput(snapshot.rawInput,refs.question));
    const urgentSafety=coachLocalSafetyTurn(canonical);
    if(urgentSafety)return json({ok:true,text:urgentSafety.text,turn:urgentSafety,model:null,route:'LOCAL',planChanged:false});
    // Trusted snapshots can contain a stronger cross-domain gate than pain alone.
    // Never let minimal projection/normalisation silently clear that restriction.
    const originals=[snapshot.rawInput.brief,...(snapshot.rawInput.compare?[snapshot.rawInput.compare.left,snapshot.rawInput.compare.right]:[]),...(snapshot.rawInput.series?.points??[]).map(p=>p.brief)];
    const projected=[canonical.brief,...(canonical.compare?[canonical.compare.left,canonical.compare.right]:[]),...(canonical.series?.points??[]).map(p=>p.brief)];
    if(originals.some(b=>typeof b.constraints?.medicalReferral!=='boolean'||typeof b.constraints?.increaseBlocked!=='boolean'))return failure('SNAPSHOT_CONSTRAINTS_INVALID');
    if(originals.some(b=>b.constraints.medicalReferral===true)) {
      const turn={mode:'ask',text:'现有记录包含需要专业评估的医疗安全限制。先保留该限制并核对记录，不依据本次对话批准训练或医学回归；必要时联系运动医学或康复专业人员。这不是诊断。',nextStep:null,citations:[],medicalReferral:true,planChanged:false};
      return json({ok:true,route:'LOCAL',model:null,text:turn.text,turn,planChanged:false});
    }
    if(originals.some(b=>b.constraints.increaseBlocked===true&&!projected.some(p=>p.occurrenceId===b.occurrenceId&&p.constraints.increaseBlocked===true)))return failure('CONSTRAINT_DOWNGRADE_BLOCKED',422);
    const safety=(canonical.brief.pain ? {mode:'ask',text:canonical.brief.constraints.blockReason ?? '已有疼痛记录，停止诱发疼痛的动作，并考虑运动医学或康复评估；这不是诊断。',nextStep:null,citations:canonical.brief.returnToTraining?.sourceIds ?? [],medicalReferral:true,planChanged:false} : null);
    if (safety) return json({ok:true,text:safety.text,turn:safety,model:null,route:'LOCAL',planChanged:false});
    route=selectDeepSeekRoute(refs.question,{complexComparison:!!canonical.compare,hasComparableHistory:!!canonical.series,needsComplexExplanation:/解释|原因|取舍|方案|为什么/.test(refs.question)});
    if(route.kind==='LOCAL')return json({ok:true,route:'LOCAL',model:null,text:'请查看本地训练复盘中的已核对事实；当前问题由本地计算处理。',planChanged:false});
    policy=await services.getVerifiedPolicy(); assertVerifiedPolicy(policy,now);
    if(typeof env.DEEPSEEK_API_KEY!=='string'||!env.DEEPSEEK_API_KEY.trim())return failure('SERVICE_KEY_MISSING');
    aliased=aliasCoachInput(minimalCoachInput(snapshot.rawInput,refs.question));
    modelRequest=buildCoachModelRequest(normalizeAskCoachInput(aliased.input),{profile:'minimal-transport'});
  } catch { return failure('AUTHORIZED_CONTEXT_UNAVAILABLE'); }
  const payload={model:policy.model,temperature:policy.temperature,messages:modelRequest.messages,max_tokens:route.outputTokenLimit,stream:false,response_format:{type:'json_object'}};
  // Include serialized non-message options and verified chat-format overhead; never trim safety to fit.
  const {messages,...options}=payload;
  const inputUpper=estimateInputTokenUpperBound(messages)+utf8(options)+policy.tokenOverheadUpperBound;
  if(inputUpper>route.inputTokenLimit)return failure('CONTEXT_BUDGET_EXCEEDED',422);
  const worstCost=costMicros(route.inputTokenLimit,route.outputTokenLimit,policy);
  if(typeof policy.caps.perCallCostMicros!=='string')return failure('CALL_COST_UNVERIFIED');
  if(BigInt(worstCost)>BigInt(policy.caps.perCallCostMicros))return failure('CALL_COST_CAP',429);
  const binding={requestId:refs.requestId,ownerId:subject.id,
    contextHash:await digest({subject:subject.id,athlete:snapshot.athleteId,snapshot:snapshot.snapshotId,version:snapshot.version,asOf:refs.asOf,consent:refs.consentId,messages}),
    modelHash:await digest({model:policy.model,version:policy.modelVersion}),configHash:await digest({policy,route,inputUpper})};
  let reservation;
  try { reservation=await services.ledger.reserve({...binding,campaignId:policy.campaignId,phase:policy.phase,day:new Date(now).toISOString().slice(0,10),worstCostMicros:worstCost,caps:policy.caps}); }
  catch {return failure('BUDGET_RESERVATION_DENIED',429);}
  if(reservation.status!=='RESERVED')return failure('DUPLICATE_REQUEST',409);
  if(reservation.reservationId!==refs.requestId||reservation.state!=='RESERVED')return failure('RESERVATION_BINDING_INVALID');
  try { await services.ledger.markDispatched(binding); } catch {return failure('DISPATCH_DENIED',409);}
  const abort=new AbortController(); let timer;
  let reply;
  try {
    const operation=(async()=>{
      const response=await (services.fetch??globalThis.fetch)('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',signal:abort.signal,headers:{'content-type':'application/json',authorization:`Bearer ${env.DEEPSEEK_API_KEY}`},body:JSON.stringify(payload)});
      if(!response.ok)throw new Error('UPSTREAM_STATUS');
      return boundedResponseJson(response);
    })();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('UPSTREAM_TIMEOUT'));},policy.timeoutMs);});
    reply=await Promise.race([operation,deadline]);
  } catch {
    try{await services.ledger.settle({...binding,outcome:'UNKNOWN',actualCostMicros:null,usageHash:null});}catch{/* Durable reservation is retained; never refund an uncertain dispatch. */}
    return failure('UPSTREAM_UNCERTAIN',502);
  } finally {clearTimeout(timer);}
  const usage=parseProviderUsage(reply);
  if(!usage){try{await services.ledger.settle({...binding,outcome:'UNKNOWN',actualCostMicros:null,usageHash:null});}catch{} return failure('PROVIDER_USAGE_UNKNOWN',502);}
  const actualCost=costMicros(usage.promptTokens,usage.completionTokens,policy,usage.cacheHitTokens);
  let settlement;
  try{settlement=await services.ledger.settle({...binding,outcome:'SUCCESS',actualCostMicros:actualCost,usageHash:await digest({usage,returnedModel:providerReturnedModel(reply),requestedModel:policy.model})});}catch{return failure('BILLING_SETTLEMENT_UNAVAILABLE');}
  if(settlement?.state!=='SETTLED'||settlement?.overrun)return failure('BILLING_REQUIRES_REVIEW');
  let interpreted;
  try {
    const raw=validateProviderReply(reply,policy,route);
    const restored=aliased.restore(raw);
    assertDeepSeekNumericGrounding(canonical,restored);
    interpreted=interpretCoachModelOutput(canonical,restored);
    if(interpreted.turn.mode==='unavailable'||interpreted.turn.planChanged!==false)throw new Error('OUTPUT_GUARD');
  } catch {return failure('OUTPUT_REJECTED',502);}
  return json({ok:true,text:interpreted.turn.text,turn:interpreted.turn,compareIds:interpreted.compareIds,seriesIds:interpreted.seriesIds,route:route.kind,model:providerReturnedModel(reply),requestedModel:policy.model,usage,costMicros:actualCost,currency:policy.currency,planChanged:false});
}
