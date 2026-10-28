import { validateCoachAssertions } from "../assertion-policy";
import type { CoachAnalysisPacket } from "../../health/analysis-contract";
import { auditAnalysisContent } from "../../health/analysis-reply-validation";
/** Negation is scoped to the same clause; a later affirmative clause still fails. */
function affirmed(text: string, pattern: RegExp): boolean {
  return [...text.matchAll(new RegExp(pattern.source, "gi"))].some(match => {
    const prefix = (text.slice(0, match.index).split(/[，,。；;！!？?\n]|但是|不过|然而|可是|但/).at(-1) ?? "").trim();
    const negative = /(?:不能|不可|不得|不应|不可以|不要|尚未|没有|不代表|不意味着|无法|未|不)(?:直接|自动|擅自|据此|再|就)*$/.exec(prefix);
    if (!negative) return true;
    // Subject/time words may precede the negation. Another negator in that
    // same scope makes it ambiguous/double-negative and cannot grant clearance.
    return /不|未|无|没|非/.test(prefix.slice(0, negative.index));
  });
}
/** Reuse the established numeric, unit, reference and safety audit. This is not a scientific certification. */
export function guardR5Reply(text: string, packet: CoachAnalysisPacket) {
  const prose = text.replace(/^[\t ]*(?:[-*][\t ]*)?(?:[0-9０-９]{1,2}[.．][\t ]+|[0-9０-９]{1,2}[、)）][\t ]*|[（(][0-9０-９]{1,2}[)）][\t ]*)(?=\S)/gm, "");
  const audit = auditAnalysisContent(prose, packet, { legacy: true }),
    errors = [...audit.errors];
  // A catalogue match alone cannot bind a number to its source or dimension.
  // Only exact host-owned factual sentences may carry numeric claims.
  let unbound = prose;
  for (const row of [
    ...(packet.derivedFacts ?? []).map((d) => ({ text: d.text })),
    ...packet.assessment.observations,
  ])
    unbound = unbound.split(row.text).join("");
  if (/[0-9０-９]|[零〇一二两三四五六七八九十百千万]+\s*(?:组|次|秒|小时|分钟|公里|米|公斤|千克)/.test(unbound)) errors.push("UNBOUND_NUMERIC_SOURCE");
  if (
    affirmed(text, /(?:已|已经)(?:替你|为你)?(?:修改|保存|更新|执行)(?:了)?(?:课表|计划|资料)|解除(?:安全|疼痛|训练)?限制|恢复(?:百分比|率)\s*\d+/)
  )
    errors.push("UNAUTHORIZED_WRITE_OR_CLEARANCE");
  if (
    packet.assessment.safetyState !== "NO_KNOWN_HOLD" &&
    affirmed(prose, /(?:可以|继续|照常|允许|放心)[^，,。；;！!？?\n]{0,10}(?:训练|跑步|深蹲|力量)|(?:恢复|准备度|HRV).{0,12}(?:正常|很好)(?:(?!不|未|无|没)[^，,。；;！!？?\n]){0,12}(?:训练|放行)/i)
  )
    errors.push("ACTIVE_HOLD_RELEASE");
  if (affirmed(text, /(?:确诊|诊断为|就是).{0,10}(?:炎|撕裂|骨折|拉伤)/)) errors.push("DIAGNOSIS_CLAIM");
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    professionalValidation: "NOT_PROVEN" as const,
    semanticReviewRequired: true as const,
  };
}

/** Deprecated compatibility symbols. The approved v2 policy replaces the old blanket waiver. */
export const ONLINE_GUARD_RELAXED = false;
export const RELAXED_ONLINE_RULES: readonly string[] = [];
export const UNVERIFIED_ONLINE_LABEL = "模型回答，未经核验";
/** Shared with the actual server controller; optional legacy argument cannot waive safety checks. */
export function guardOnlineReply(text:string,packet:CoachAnalysisPacket,_legacyRelaxed=false){
 const checked=validateCoachAssertions(text,{factQuotes:[...(packet.derivedFacts??[]).map(d=>d.text),...packet.assessment.observations.map(o=>o.text)],safetyRestricted:['HOLD_ACTIVE','ESCALATION_REQUIRED'].includes(packet.assessment.safetyState)})
 return {...checked,waived:[] as string[],unverified:false,semanticReviewRequired:true as const}
}
