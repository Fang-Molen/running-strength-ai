import { createServerFn } from "@tanstack/react-start"
import { coachKnowledgePrompt } from "@/lib/core/coach-knowledge"
import { requestTrainingModel } from "@/lib/core/training-model"
import {
  assessTrainingImportReview,
  normalizeTrainingImportCandidate,
  normalizeConfirmedTrainingImport,
  type ConfirmedTrainingImport,
  type TrainingImportCandidate,
  type TrainingImportReview,
} from "@/lib/core/training-import"
import { trialReviewClosed } from "@/lib/core/trial"
import { assessImportedTraining } from "@/lib/core/training-coach"

export type TrainingImportImage = {
  mimeType: "image/jpeg" | "image/png"
  dataUrl: string
  bytes: number
  sourceId: `image-${1 | 2 | 3 | 4}`
}

export type TrainingImportFailure = "NO_KEY" | "BAD_INPUT" | "TIMEOUT" | "NETWORK" | "UPSTREAM" | "INVALID_OUTPUT" | "LOCKED"

const IMPORT_WAIT_MS = 45_000
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024

const sourceIds = { type: "array", items: { type: "string" }, maxItems: 2 } as const
const shortStatus = { type: "string", enum: ["R", "A", "M", "C"] } as const

function compactSchema(value: Record<string, unknown>) {
  return {
    type: "object",
    properties: { v: { anyOf: [value, { type: "null" }] }, s: shortStatus, i: sourceIds },
    required: ["v", "s", "i"],
    additionalProperties: false,
  }
}

const numberField = compactSchema({ type: "number" })
const stringField = compactSchema({ type: "string" })
const bodyField = compactSchema({
  type: "object",
  properties: { location: { type: "string" }, intensity: { anyOf: [{ type: "integer" }, { type: "null" }] } },
  required: ["location", "intensity"],
  additionalProperties: false,
})

const candidateSchema = {
  type: "object",
  properties: {
    sport: { type: "string", enum: ["RUNNING", "STRENGTH", "MIXED", "UNKNOWN"] },
    occurredAt: stringField,
    title: stringField,
    durationSeconds: numberField,
    totalDistanceMeters: numberField,
    runningStructure: { type: "string", enum: ["REPEATED", "CONTINUOUS", "MIXED", "UNAVAILABLE"] },
    runningSegments: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["REPETITION", "CONTINUOUS", "RECOVERY", "UNKNOWN"] },
          round: numberField,
          repeat: numberField,
          distanceMeters: numberField,
          durationSeconds: numberField,
          recoverySeconds: numberField,
          completion: { type: "string", enum: ["COMPLETED", "SKIPPED", "NOT_RECORDED"] },
          sourceIds,
        },
        required: ["id", "kind", "round", "repeat", "distanceMeters", "durationSeconds", "recoverySeconds", "completion", "sourceIds"],
        additionalProperties: false,
      },
    },
    strengthSets: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          exerciseName: stringField,
          setOrdinal: numberField,
          weightKg: numberField,
          repetitions: numberField,
          durationSeconds: numberField,
          recoverySeconds: numberField,
          completion: { type: "string", enum: ["COMPLETED", "SKIPPED", "NOT_RECORDED"] },
          sourceIds,
        },
        required: ["id", "exerciseName", "setOrdinal", "weightKg", "repetitions", "durationSeconds", "recoverySeconds", "completion", "sourceIds"],
        additionalProperties: false,
      },
    },
    sessionRpe: numberField,
    subjectiveRecovery: numberField,
    sleepHours: numberField,
    pain: bodyField,
    soreness: bodyField,
    uncertainFields: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3 },
    conflicts: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3 },
    warnings: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3 },
  },
  required: ["sport", "occurredAt", "title", "durationSeconds", "totalDistanceMeters", "runningStructure", "runningSegments", "strengthSets", "sessionRpe", "subjectiveRecovery", "sleepHours", "pain", "soreness", "uncertainFields", "conflicts", "warnings"],
  additionalProperties: false,
} as const

const claimSchema = {
  type: "object",
  properties: { text: { type: "string", maxLength: 36 }, citations: { type: "array", items: { type: "string" }, maxItems: 8 } },
  required: ["text", "citations"],
  additionalProperties: false,
} as const

const reviewSchema = {
  type: "object",
  properties: {
    facts: { type: "array", items: claimSchema, maxItems: 2 },
    observations: { type: "array", items: claimSchema, maxItems: 1 },
    evidenceGaps: { type: "array", items: claimSchema, maxItems: 1 },
    interpretations: { type: "array", items: claimSchema, maxItems: 1 },
    risks: { type: "array", items: claimSchema, maxItems: 1 },
    questions: { type: "array", items: { type: "string", maxLength: 32 }, maxItems: 1 },
    nextSessionBoundary: { anyOf: [claimSchema, { type: "null" }] },
  },
  required: ["facts", "observations", "evidenceGaps", "interpretations", "risks", "questions", "nextSessionBoundary"],
  additionalProperties: false,
} as const

async function callStructuredModel(args: {
  apiKey: string
  model: string
  name: string
  schema: Record<string, unknown>
  system: string
  content: unknown
  maxTokens: number
}): Promise<{ ok: true; value: unknown } | { ok: false; reason: Exclude<TrainingImportFailure, "NO_KEY" | "BAD_INPUT"> }> {
  return requestTrainingModel({ ...args, kind: args.name === "training_import" ? "EXTRACT" : "REVIEW", waitMs: IMPORT_WAIT_MS }, { trace: (event) => {
    console.info(`[training-model] ${JSON.stringify(event)}`)
  } })
}

function validateImage(raw: TrainingImportImage, index: number): TrainingImportImage | null {
  if (!raw || (raw.mimeType !== "image/jpeg" && raw.mimeType !== "image/png")) return null
  if (raw.sourceId !== `image-${index + 1}` || !Number.isInteger(raw.bytes) || raw.bytes <= 0 || raw.bytes > MAX_IMAGE_BYTES) return null
  const prefix = `data:${raw.mimeType};base64,`
  if (!raw.dataUrl.startsWith(prefix) || raw.dataUrl.length > Math.ceil(raw.bytes * 1.5) + prefix.length + 16) return null
  return { mimeType: raw.mimeType, dataUrl: raw.dataUrl, bytes: raw.bytes, sourceId: raw.sourceId }
}

export const extractTrainingImport = createServerFn({ method: "POST" })
  .validator((input: { text?: string; images?: TrainingImportImage[] }) => {
    const text = typeof input?.text === "string" ? input.text.trim().slice(0, 6000) : ""
    const images = Array.isArray(input?.images) ? input.images.slice(0, 4).map(validateImage) : []
    if (images.some((item) => !item)) throw new Error("bad image")
    const checked = images.filter((item): item is TrainingImportImage => Boolean(item))
    if (!text && checked.length === 0) throw new Error("empty import")
    if (checked.reduce((sum, item) => sum + item.bytes, 0) > MAX_TOTAL_IMAGE_BYTES) throw new Error("images too large")
    return { text, images: checked }
  })
  .handler(async ({ data }): Promise<{ ok: true; candidate: TrainingImportCandidate; model: string } | { ok: false; reason: TrainingImportFailure; detail?: string }> => {
    const access = await (await import("./model-access")).beginModelCall()
    if (!access.ok) return { ok: false, reason: "LOCKED", detail: access.reason }
    const apiKey = process.env.XAI_API_KEY
    if (!apiKey) return { ok: false, reason: "NO_KEY" }
    const model = process.env.TRAINING_IMPORT_MODEL || "grok-4.5"
    const instructions = [
      "你是训练记录提取器，不是教练。只抄录文字或图片里明确可见的实际训练，不提供建议，不使用一般知识，不猜测性别、月经或心理状态。",
      "字段用短格式：s 为 R 已记录、A 缺失、M 看不清、C 冲突；v 是值，缺失必须是 null，绝不能写成 0；i 只能是 text、image-1、image-2、image-3、image-4。R 必须有来源，A 的 i 为 []。",
      "计划、模板和目标秒数不是已完成。只有明确完成才标 COMPLETED，否则 NOT_RECORDED。",
      "200米×4×2 是 2 轮、每轮 4 次、共 8 个 REPETITION；另加 300米 就是 9 条。不同用时各写一条，不要合并秒数，不要删恢复段，不要展平轮次，不要丢力量组。没写实际就 A。计划秒数不是已完成。",
      "runningSegments 最多 24 条，strengthSets 最多 16 条，没有就用空数组，禁止占位。写不下时不要硬塞，也不要声称全部提取，在 warnings 写未完整。多图时间不一致则 occurredAt 的 s 为 C，v 保留最先看到的时间。能确定用 ISO 8601。warnings、conflicts、uncertainFields 各最多 3 条、每条不超过 40 字。不要写抄录以外的解释。",
    ].join("\n")
    const content: Array<Record<string, unknown>> = []
    content.push({ type: "text", text: `提取这次训练。文字来源${data.text ? "如下" : "为空"}：\n${data.text || "（无文字）"}` })
    const detail = data.images.length > 1 ? "low" : "high"
    for (const image of data.images) content.push({ type: "image_url", image_url: { url: image.dataUrl, detail } })
    const called = await callStructuredModel({ apiKey, model, name: "training_import", schema: candidateSchema as unknown as Record<string, unknown>, system: instructions, content, maxTokens: 2600 })
    if (!called.ok) return called
    return { ok: true, candidate: normalizeTrainingImportCandidate(called.value), model }
  })

function compactReviewRecord(record: ConfirmedTrainingImport) {
  const compactField = <T,>(field: { value: T | null; status: string }) => ({ value: field.value, status: field.status })
  return {
    recordMode: record.recordMode,
    sport: record.sport,
    occurredAt: compactField(record.occurredAt),
    durationSeconds: compactField(record.durationSeconds),
    totalDistanceMeters: compactField(record.totalDistanceMeters),
    runningStructure: record.runningStructure,
    runningSegments: record.runningSegments.map((segment, index) => ({ sourceId: `import:${record.draftId}:run-${index + 1}`, kind: segment.kind, round: compactField(segment.round), repeat: compactField(segment.repeat), distanceMeters: compactField(segment.distanceMeters), durationSeconds: compactField(segment.durationSeconds), recoverySeconds: compactField(segment.recoverySeconds), completion: segment.completion })),
    strengthSets: record.strengthSets.map((set, index) => ({ sourceId: `import:${record.draftId}:set-${index + 1}`, exerciseName: compactField(set.exerciseName), setOrdinal: compactField(set.setOrdinal), weightKg: compactField(set.weightKg), repetitions: compactField(set.repetitions), durationSeconds: compactField(set.durationSeconds), completion: set.completion })),
    sessionRpe: compactField(record.sessionRpe),
    subjectiveRecovery: compactField(record.subjectiveRecovery),
    sleepHours: compactField(record.sleepHours),
    pain: compactField(record.pain),
    soreness: compactField(record.soreness),
    sources: record.sources.map((source) => ({ id: source.id, detail: source.detail.slice(0, 160) })),
    deterministicCoachBoundary: { status: assessImportedTraining(record).status, next: assessImportedTraining(record).nextSession.text.slice(0, 80) },
  }
}

export const reviewTrainingImport = createServerFn({ method: "POST" })
  .validator((input: { record: ConfirmedTrainingImport }) => {
    if (JSON.stringify(input).length > 150_000) throw new Error("record too large")
    const record = normalizeConfirmedTrainingImport(input?.record)
    if (!record) throw new Error("bad record")
    return { record }
  })
  .handler(async ({ data }): Promise<{ ok: true; review: TrainingImportReview } | { ok: false; reason: TrainingImportFailure; detail?: string }> => {
    const access = await (await import("./model-access")).beginModelCall()
    if (!access.ok) return { ok: false, reason: "LOCKED", detail: access.reason }
    const apiKey = process.env.XAI_API_KEY
    if (!apiKey) return { ok: false, reason: "NO_KEY" }
    if (trialReviewClosed(data.record)) return { ok: false, reason: "BAD_INPUT" }
    const model = process.env.TRAINING_IMPORT_MODEL || "grok-4.5"
    const boundary = assessImportedTraining(data.record)
    const system = [
      "只复盘这一次 ACTUAL_ONLY 记录。思考尽量短，不要复述记录或知识卡，JSON 必须完整结束。",
      "facts 最多 2 条、每条不超过 36 字，且必须引用 sources.id。句子里的每个数字都要原样出现在所引用 detail 中，禁止换算。",
      "观察、缺口、解释、风险各最多 1 条短句。nextSessionBoundary 用 null。RPE 达到 8 且恢复不是 RECORDED 时，questions 必须追问恢复，不要写保持、减量或下一课。疼痛和酸痛分成两句，分别引用 pain 与 soreness 来源。",
      "禁止写完成计划、偏离计划、长期能力、没有疼痛、已恢复、加量、加组、加重、提速。",
      `本地边界是 ${boundary.status}：${boundary.nextSession.text.slice(0, 80)}。不得放宽，不得改课表、Decision 或疲劳分。`,
      "一般知识不能证明此人已恢复、掉速原因或定量处方。",
      coachKnowledgePrompt("REVIEW"),
    ].join("\n")
    const called = await callStructuredModel({ apiKey, model, name: "training_import_review", schema: reviewSchema as unknown as Record<string, unknown>, system, content: JSON.stringify(compactReviewRecord(data.record)), maxTokens: 700 })
    if (!called.ok) return called
    const judged = assessTrainingImportReview(data.record, called.value)
    if (!judged.review) {
      console.info(`[training-review-guard] ${JSON.stringify({ kind: "REVIEW", guardCode: judged.code })}`)
      return { ok: false, reason: "INVALID_OUTPUT" }
    }
    return { ok: true, review: judged.review }
  })
