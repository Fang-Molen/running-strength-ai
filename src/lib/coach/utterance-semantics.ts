import { detectRedFlags, readRedFlagMentions, redFlagResponse } from "../core/coach-red-flags";
import { contextClauses } from "../../safety/redflag/context";

export type RestrictionStatus =
  "UNKNOWN" | "NONE_EXPLICIT" | "ACTIVE" | "REVIEW_PENDING" | "RESOLVED";
export type ActionScope = "LOWER_BODY" | "UPPER_BODY" | "SYSTEMIC" | "UNKNOWN";
export type ScopedRestriction = {
  id: string;
  version: string;
  status: RestrictionStatus;
  scope: string;
  region?: string | null;
  actions?: ActionScope[];
  sourceText?: string;
  occurredAt?: string | null;
  source?: string;
  evidenceRefs?: { id: string; revision: number }[];
};

/** A scope is descriptive, not medical clearance for every exercise in that scope. */
export function restrictionActionScope(text: string): ActionScope[] {
  if (/胸痛|胸闷|心脏|心率异常|晕厥|呼吸困难|发热|医生.*(?:停止|暂停)全部|腰|脊柱|全身/.test(text))
    return ["SYSTEMIC"];
  const scopes: ActionScope[] = [];
  if (/腿|膝|踝|脚|足|跟腱|髋|臀|跑步|跑跳|冲刺|深蹲|硬拉/.test(text)) scopes.push("LOWER_BODY");
  if (/上肢|手臂|胳膊|肩|肘|腕|弯举|卧推|推举|引体/.test(text)) scopes.push("UPPER_BODY");
  return scopes.length ? scopes : ["UNKNOWN"];
}

/** Read-only, idempotent interpretation. The original stored text remains intact. */
export function interpretProfileLimit(raw: string) {
  const text = raw.trim().normalize("NFKC");
  let status: RestrictionStatus = "REVIEW_PENDING";
  if (!text) status = "UNKNOWN";
  else if (
    /^(?:(?:目前|当前|现在|暂时)(?:我)?|我)?(?:无|没有)(?:任何)?(?:身体限制|训练限制|限制|不舒服|不适|疼痛|酸痛)?[。.!！]?$/.test(
      text,
    ) ||
    /^(?:(?:目前|当前|现在)我?|我)?(?:不痛|不疼|无痛|没有不舒服)[。.!！]?$/.test(text)
  )
    status = "NONE_EXPLICIT";
  else if (
    !/不确定|不清楚|待.*(?:复核|确认)|但是|然而|但/.test(text) &&
    (readRedFlagMentions(text).some(
      (m) =>
        !m.negated &&
        m.subject !== "OTHER" &&
        m.temporal === "CURRENT" &&
        m.dimension !== "soreness",
    ) ||
      /暂停|停止|禁止|避免|受限|不能/.test(text))
  )
    status = "ACTIVE";
  return {
    status,
    raw,
    actions: restrictionActionScope(text),
    active: status === "ACTIVE" || status === "REVIEW_PENDING",
  };
}

export function parseCoachUtterance(question: string) {
  const text = question.trim().normalize("NFKC"),
    mentions = readRedFlagMentions(text).map((m) =>
      /昨天|前天|上次/.test(m.clause) && m.temporal === "CURRENT"
        ? { ...m, temporal: "HISTORY" as const }
        : m,
    );
  const readonly =
    /不用保存|不要(?:修改|记录|保存)|只(?:想)?(?:解释|了解|问|查看)|不(?:是|想|要).*?(?:改|记录|保存)/.test(
      text,
    );
  const writeRequested =
    !readonly &&
    /(?:修改|更正|保存|记录|改为|改成|换成|减少|少一组|设置|添加|更新)(?!.*(?:是什么|的定义))|(?:身体限制|备注|器材|训练日)\s*[:：为是]/.test(
      text,
    );
  const knowledge = /解释|讲解|科普|定义|什么是|是什么|想了解|原理|含义/.test(text);
  const requestedActivity =
    /能否|能不能|可以|怎么练|如何练|怎么安排|如何安排|安排.*(?:训练|跑|组)|明天.*(?:跑|练)|今天.*(?:跑|练)|带痛跑|复训|恢复训练/.test(
      text,
    );
  const task = writeRequested
    ? ("FORMAL_CHANGE" as const)
    : requestedActivity
      ? ("TRAINING_ADVICE" as const)
      : knowledge
        ? ("GENERAL_KNOWLEDGE" as const)
        : /查看|只看|复盘|记录|数据|事实/.test(text)
          ? ("FACT_REVIEW" as const)
          : /训练|跑步|跑跳|深蹲|硬拉|卧推|上肢|力量/.test(text)
            ? ("TRAINING_ADVICE" as const)
            : ("GENERAL_KNOWLEDGE" as const);
  const bodyMentions = mentions.filter((m) =>
    ["pain", "soreness", "chest", "back", "functionalPain"].includes(m.dimension),
  );
  const personalSymptoms = bodyMentions.filter(
    (m) => m.subject !== "OTHER" && m.polarity === "ASSERTED" && m.temporal === "CURRENT",
  );
  const uncertainSymptoms = bodyMentions.filter(
    (m) => m.subject !== "OTHER" && m.polarity === "UNCERTAIN" && m.temporal === "CURRENT",
  );
  const historicalSymptoms = bodyMentions.filter(
    (m) => m.subject !== "OTHER" && !m.negated && m.temporal === "HISTORY",
  );
  const currentPersonalFlags = detectRedFlags(text, { excludeOtherSubjects: true });
  const flags = detectRedFlags(text);
  return {
    text,
    mentions,
    bodyMentions,
    personalSymptoms,
    uncertainSymptoms,
    historicalSymptoms,
    task,
    writeRequested,
    readonly,
    knowledge,
    flags,
    currentPersonalFlags,
    safetyMessage: redFlagResponse(flags),
    // Callers can keep the safe question alongside immediate symptom advice.
    conversationOnly:
      readonly || (knowledge && !writeRequested) || /能不能|是否|怎么|如何|为什么|能否/.test(text),
  };
}

export function questionTaskPermission(
  question: string,
  restrictions: readonly ScopedRestriction[],
) {
  const semantic = parseCoachUtterance(question);
  const active = restrictions.filter((r) => r.status === "ACTIVE" || r.status === "REVIEW_PENDING");
  const educational = semantic.task === "GENERAL_KNOWLEDGE" || semantic.task === "FACT_REVIEW";
  // A symptom clause describes evidence, not the activity being requested.
  const requestedText =
    contextClauses(question)
      .filter((clause) => /安排|怎么练|如何练|能否|能不能|可以|复训|恢复训练/.test(clause))
      .at(-1) ?? question;
  const requested = restrictionActionScope(requestedText);
  const overlaps = (scope: readonly ActionScope[]) =>
    scope.includes("UNKNOWN") ||
    scope.includes("SYSTEMIC") ||
    requested.includes("UNKNOWN") ||
    requested.includes("SYSTEMIC") ||
    scope.some((s) => requested.includes(s));
  const relevant = educational
    ? []
    : active.filter((r) => {
        const scope = r.actions?.length
          ? r.actions
          : restrictionActionScope(r.region ?? r.sourceText ?? "");
        return /EMERGENCY|URGENT/.test(r.scope) || overlaps(scope);
      });
  const concerns = [
    ...semantic.personalSymptoms,
    ...semantic.uncertainSymptoms,
    ...semantic.historicalSymptoms,
  ].filter((m) => m.dimension !== "soreness");
  const localOnly =
    concerns.length > 0 &&
    semantic.currentPersonalFlags.classes.every((c) => c === "PAIN" || c === "OTHER") &&
    concerns.every((m) => m.dimension !== "chest" && m.dimension !== "back");
  const currentRestricted =
    (semantic.currentPersonalFlags.level !== "NONE" && !localOnly) ||
    concerns.some((m) => overlaps(restrictionActionScope(m.region ?? "")));
  return {
    task: semantic.task,
    answerAllowed: true as const,
    trainingRestricted: !educational && (relevant.length > 0 || currentRestricted),
    relevantRestrictionIds: relevant.map((r) => r.id),
    safetyMessage: semantic.safetyMessage,
    medicalClearance: false as const,
  };
}
