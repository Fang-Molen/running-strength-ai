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

/**
 * 联网回答拦截放宽开关（用户决定，2026-10-26）。
 * 原因：线上联网回答被“无来源数字/疼痛放行/诊断”三类规则大量误拦，用户暂时关闭这三条，
 * 等 S1 的问答准确性完善后再评估重新开启。恢复方法：把下面的值改成 false（一行），规则代码都还在。
 * 不放宽：UNAUTHORIZED_WRITE_OR_CLEARANCE（模型声称已改计划/已解除限制）以及其余审计错误
 *（含 WRITE_CLEARANCE_SAFETY_OR_CAUSAL_CLAIM、NUMBER_CONTRADICTION、UNIT_CONTRADICTION 等）。
 * 红线症状（胸痛、晕厥等）在发送前由 coach-sheet 本地拦截，不经过这里，也不受此开关影响。
 */
export const ONLINE_GUARD_RELAXED = true;
/** 被放宽的规则：命中时放行，但回答必须标注“模型回答，未经核验”。 */
export const RELAXED_ONLINE_RULES: readonly string[] = ["UNBOUND_NUMERIC_SOURCE", "UNSUPPORTED_NUMERIC_CLAIM", "ACTIVE_HOLD_RELEASE", "DIAGNOSIS_CLAIM"];
/** 界面上给放行回答加的标注文案。 */
export const UNVERIFIED_ONLINE_LABEL = "模型回答，未经核验";
/** 联网回答用的入口：严格的 guardR5Reply 不变，这里只按开关把被放宽的规则移到 waived。 */
export function guardOnlineReply(text: string, packet: CoachAnalysisPacket, relaxed = ONLINE_GUARD_RELAXED) {
  const strict = guardR5Reply(text, packet);
  const waived = relaxed ? strict.errors.filter((e) => RELAXED_ONLINE_RULES.includes(e)) : [];
  const errors = strict.errors.filter((e) => !waived.includes(e));
  return { ...strict, ok: errors.length === 0, errors, waived, unverified: waived.length > 0 };
}
