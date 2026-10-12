import { createServerFn } from "@tanstack/react-start"
import { requestTrainingModel } from "@/lib/core/training-model"
import { guardCoachPlan, planningQuestions, sanitizePlanningContext, type CoachPlanCandidate, type PlanningContext } from "@/lib/core/coach-plan"
import { auditCoachPlan, prescribesStrengthFailure } from "@/lib/core/coach-plan-quality"
import { coachPlanOutputContract } from "@/lib/core/coach-plan-output"
import { coachKnowledgePrompt, sanitizeCoachingBackground, type CoachingBackground } from "@/lib/core/coach-knowledge"

type Failure = "NO_KEY" | "TIMEOUT" | "NETWORK" | "UPSTREAM" | "INVALID_OUTPUT" | "LOCKED"

const citations = { type: "array", items: { type: "string" }, maxItems: 12 } as const
const schema = {
  type: "object",
  properties: {
    horizonWeeks: { type: "integer" },
    phases: { type: "array", maxItems: 4, items: { type: "object", properties: { name: { type: "string", maxLength: 12 }, weeks: { type: "integer" }, purpose: { type: "string", maxLength: 32 }, progression: { type: "string", enum: ["BUILD", "HOLD", "DELOAD", "TAPER"] }, citations }, required: ["name", "weeks", "purpose", "progression", "citations"], additionalProperties: false } },
    firstWeek: { type: "array", maxItems: 4, items: { type: "object", properties: { day: { type: "integer" }, type: { type: "string", enum: ["EASY_RUN", "QUALITY_RUN", "LONG_RUN", "STRENGTH", "RECOVERY", "REST"] }, title: { type: "string", maxLength: 12 }, durationMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] }, distanceMeters: { anyOf: [{ type: "integer" }, { type: "null" }] }, intensity: { type: "string", enum: ["EASY", "MODERATE", "HARD", "NONE"] }, prescription: { type: "string", maxLength: 40 }, rationale: { type: "string", maxLength: 32 }, citations,
      runPrescription: { anyOf: [{ type: "null" }, { type: "object", properties: {
        warmupMinutes: { type: "integer" },
        main: { type: "array", maxItems: 2, items: { type: "object", properties: { label: { type: "string", maxLength: 12 }, repetitions: { type: "integer" }, distanceMeters: { anyOf: [{ type: "integer" }, { type: "null" }] }, durationSeconds: { anyOf: [{ type: "integer" }, { type: "null" }] }, recoverySeconds: { anyOf: [{ type: "integer" }, { type: "null" }] }, effort: { type: "string", enum: ["EASY_TALK", "STEADY", "CONTROLLED_HARD", "FAST_RELAXED"] }, citations }, required: ["label", "repetitions", "distanceMeters", "durationSeconds", "recoverySeconds", "effort", "citations"], additionalProperties: false } },
        cooldownMinutes: { type: "integer" }, stopConditions: { type: "array", items: { type: "string", maxLength: 24 }, maxItems: 2 },
      }, required: ["warmupMinutes", "main", "cooldownMinutes", "stopConditions"], additionalProperties: false }] },
      strengthPrescription: { anyOf: [{ type: "null" }, { type: "object", properties: {
        exercises: { type: "array", maxItems: 3, items: { type: "object", properties: { name: { type: "string", maxLength: 12 }, sets: { type: "integer" }, repetitions: { anyOf: [{ type: "integer" }, { type: "null" }] }, durationSeconds: { anyOf: [{ type: "integer" }, { type: "null" }] }, effort: { type: "string", enum: ["TECHNIQUE", "LEAVE_3_REPS", "LEAVE_2_REPS", "BODYWEIGHT_CONTROLLED"] }, restSeconds: { type: "integer" }, citations }, required: ["name", "sets", "repetitions", "durationSeconds", "effort", "restSeconds", "citations"], additionalProperties: false } },
        stopConditions: { type: "array", items: { type: "string", maxLength: 24 }, maxItems: 2 },
      }, required: ["exercises", "stopConditions"], additionalProperties: false }] },
    }, required: ["day", "type", "title", "durationMinutes", "distanceMeters", "intensity", "prescription", "rationale", "citations", "runPrescription", "strengthPrescription"], additionalProperties: false } },
    assumptions: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3 },
    evidenceGaps: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3 },
    safetyBoundaries: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3 },
    progressionRule: { type: "string", maxLength: 48 },
    deloadRule: { type: "string", maxLength: 40 },
    userControl: { type: "string", maxLength: 32 },
  },
  required: ["horizonWeeks", "phases", "firstWeek", "assumptions", "evidenceGaps", "safetyBoundaries", "progressionRule", "deloadRule", "userControl"],
  additionalProperties: false,
} as const

export const generateCoachPlan = createServerFn({ method: "POST" })
  .validator((input: { context: PlanningContext; background?: CoachingBackground }) => ({ context: sanitizePlanningContext(input?.context), background: sanitizeCoachingBackground(input?.background) }))
  .handler(async ({ data }): Promise<{ ok: true; candidate: CoachPlanCandidate } | { ok: false; reason: Failure | "MISSING_CRITICAL_INPUT"; questions?: string[]; detail?: string }> => {
    const access = await (await import("./model-access")).beginModelCall()
    if (!access.ok) return { ok: false, reason: "LOCKED", detail: access.reason }
    const questions = planningQuestions(data.context)
    if (questions.length) return { ok: false, reason: "MISSING_CRITICAL_INPUT", questions }
    const apiKey = process.env.XAI_API_KEY
    if (!apiKey) return { ok: false, reason: "NO_KEY" }
    try {
      const called = await requestTrainingModel({
        kind: "PLAN", apiKey, model: process.env.COACH_PLAN_MODEL || "grok-4.5",
        name: "coach_plan_candidate", schema, system: `只生成待确认的短候选，所有文字用短句，JSON 必须完整结束。citations 只能用输入 sources 的 id。horizonWeeks 用 8，阶段周数之和等于 8，且包含 DELOAD。第一周只输出 4 个非休息日：轻松跑、至多一次质量或长跑、以及不超过 strengthDays 的力量。HARD 最多 2 天且不相邻。赛前 28 天内每个阶段都只能是 HOLD、DELOAD 或 TAPER，不能只让第一阶段 HOLD、后面再 BUILD。没有可靠赛后分界时，不要预先写入赛后 BUILD。疼痛或康复时不要 BUILD，也不要 HARD。没有周跑量时不要写百分比。EASY_RUN 和 LONG_RUN 的 intensity 必须是 EASY，main.effort 必须是 EASY_TALK。跑步日给 runPrescription，用距离时 durationSeconds 为 null。热身、冷身和已知秒数合计不得超过 durationMinutes，且不超过 minutesPerDay。力量日给 strengthPrescription，余力用 LEAVE_3_REPS，处方只写留余力，不要写做到力竭或做到失败。progressionRule 写成“若恢复或 RPE 变差则保持或减量”，不要出现增加、提高、加量。deloadRule 要包含减量。userControl 要包含接受、修改、拒绝。不要写长期能力。不要改课表、Decision 或疲劳分。思考尽量短，不要复述输入。\n${coachPlanOutputContract(data.context)}\n${coachKnowledgePrompt("PLAN", data.background)}`,
        content: JSON.stringify(data.context), maxTokens: 1800, waitMs: 45_000,
      }, { trace: (event) => {
        console.info(`[training-model] ${JSON.stringify(event)}`)
      } })
      if (!called.ok) return called
      const guarded = guardCoachPlan(data.context, called.value)
      if (!guarded.ok) {
        console.info(`[training-model] ${JSON.stringify({ kind: "PLAN", stage: "guard", reason: guarded.reason })}`)
        return { ok: false, reason: "INVALID_OUTPUT", detail: guarded.reason }
      }
      const quality = auditCoachPlan(data.context, guarded.candidate)
      if (!quality.pass) {
        const detail = quality.criticalIssues.join(",") || `SCORE_${quality.score}`
        const notes = quality.dimensions.flatMap((item) => item.notes.map((note) => `${item.id}:${note}`)).slice(0, 8)
        const tokens = guarded.candidate.firstWeek.filter((item) => item.type === "STRENGTH" && prescribesStrengthFailure(item.prescription)).map((item) => (/力竭|做到失败|极限/.exec(item.prescription)?.[0] ?? "WORD"))
        console.info(`[training-model] ${JSON.stringify({ kind: "PLAN", stage: "quality", reason: detail, score: quality.score, notes, tokens })}`)
        return { ok: false, reason: "INVALID_OUTPUT", detail }
      }
      return { ok: true, candidate: guarded.candidate }
    } catch (error) {
      return { ok: false, reason: error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK" }
    }
  })
