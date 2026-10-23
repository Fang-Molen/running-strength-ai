import type { VerifiedDeepSeekPolicy } from './coach-service-contract.ts';
export function providerReturnedModel(reply: unknown): string | null { const model=(reply as {model?:unknown})?.model; return typeof model==='string' ? model : null; }
export type VerifiedProviderUsage = { promptTokens: number; completionTokens: number; cacheHitTokens: number; cacheMissTokens: number; reasoningTokens: number | null; totalTokens: number };
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/** A missing cache breakdown/usage is not zero cost. Reasoning is already included in completion. */
export function parseProviderUsage(reply: unknown): VerifiedProviderUsage | null {
  const u = (reply as { usage?: Record<string,unknown> })?.usage;
  if (!u || !integer(u.prompt_tokens) || !integer(u.completion_tokens) || !integer(u.total_tokens) || !integer(u.prompt_cache_hit_tokens) || !integer(u.prompt_cache_miss_tokens) || u.prompt_cache_hit_tokens + u.prompt_cache_miss_tokens !== u.prompt_tokens || u.prompt_tokens + u.completion_tokens !== u.total_tokens) return null;
  const details = u.completion_tokens_details as { reasoning_tokens?: unknown } | undefined;
  const reasoning = details?.reasoning_tokens;
  if (reasoning !== undefined && (!integer(reasoning) || reasoning > u.completion_tokens)) return null;
  return { promptTokens:u.prompt_tokens, completionTokens:u.completion_tokens, cacheHitTokens:u.prompt_cache_hit_tokens, cacheMissTokens:u.prompt_cache_miss_tokens, reasoningTokens:reasoning === undefined ? null : reasoning as number, totalTokens:u.total_tokens };
}
/** Transport metadata is validated independently of scientific/factual output guards. */
export function validateProviderReply(reply: unknown, policy: VerifiedDeepSeekPolicy, limits: { inputTokenLimit:number; outputTokenLimit:number }, analysisMode=false): string {
  const out = reply as { model?:unknown; choices?:{ finish_reason?:unknown; message?:{ role?:unknown; content?:unknown; tool_calls?:unknown; function_call?:unknown } }[] };
  const usage = parseProviderUsage(reply);
  if (!usage) throw new Error('PROVIDER_USAGE_UNKNOWN');
  if (usage.promptTokens > limits.inputTokenLimit || usage.completionTokens > limits.outputTokenLimit) throw new Error('PROVIDER_TOKEN_CAP');
  if (typeof out.model !== 'string' || !policy.acceptedResponseModels.includes(out.model)) throw new Error('PROVIDER_MODEL_MISMATCH');
  if (!Array.isArray(out.choices) || out.choices.length !== 1) throw new Error('PROVIDER_CHOICES');
  const choice = out.choices[0], message = choice.message;
  if (choice.finish_reason !== 'stop' || !message || message.role !== 'assistant' || message.function_call !== undefined || (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0))) throw new Error('PROVIDER_FINISH');
  if (typeof message.content !== 'string' || !message.content.trim() || message.content.length > 12000) throw new Error('PROVIDER_CONTENT');
  // Strict JSON; never scrape a JSON-shaped substring from surrounding prose.
  let parsed: unknown; try { parsed = JSON.parse(message.content); } catch { throw new Error('PROVIDER_JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PROVIDER_JSON');
  const value=parsed as Record<string,unknown>;
  if(analysisMode){
    const allowed=['answer','factualClaims','selectedCandidateId','hypotheses','unknowns','followup','memoryClaim'];
    if(Object.keys(value).some(k=>!allowed.includes(k))||typeof value.answer!=='string'||!Array.isArray(value.factualClaims)||!Array.isArray(value.hypotheses)||!Array.isArray(value.unknowns)||value.memoryClaim!=='NOT_SAVED')throw Error('PROVIDER_ANALYSIS_SCHEMA');
    return message.content;
  }
  const allowed=['mode','text','nextStep','citations','medicalReferral','compareIds','seriesIds','planChanged','evidenceQuotes'];
  if(Object.keys(value).some(k=>!allowed.includes(k)) || !['answer','ask','unavailable'].includes(value.mode as string) || typeof value.text!=='string' || !value.text.trim() || (value.nextStep!==null && typeof value.nextStep!=='string') || !Array.isArray(value.citations) || value.citations.length>100 || value.citations.some(id=>typeof id!=='string'||id.length>120) || typeof value.medicalReferral!=='boolean' || value.planChanged!==false) throw new Error('PROVIDER_SCHEMA');
  for(const key of ['compareIds','seriesIds'])if(value[key]!==null && value[key]!==undefined && (!Array.isArray(value[key]) || (value[key] as unknown[]).some(id=>typeof id!=='string'||id.length>120)))throw new Error('PROVIDER_SCHEMA');
  return message.content;
}
export async function boundedResponseJson(response: Response, maxBytes = 65536): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error('PROVIDER_BODY_CAP');
  if (!response.body) throw new Error('PROVIDER_BODY');
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const {value,done} = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { await reader.cancel(); throw new Error('PROVIDER_BODY_CAP'); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset=0; for (const part of parts) { bytes.set(part,offset); offset+=part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new Error('PROVIDER_BODY'); }
}
