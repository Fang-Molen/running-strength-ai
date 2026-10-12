import { buildCurriculumModelContext, CURRICULUM_SYSTEM_BOUNDARY } from '@/lib/core/coach-curriculum';
import { createServerFn } from "@tanstack/react-start";
import { appendFileSync } from "node:fs";
import type { FatigueBand } from "./agent";
import { assertCoachPacket, deriveCoachBrief, guardCoachResponse, guardSubcode, highRpeRecoveryRequired, recoveryConflictApplies, sorenessBoundaryRequired, type CoachBrief, type CoachTurn } from "@/lib/core/coach-brief";
import { guardComparison, orientPair, pairedRunningObservations, readCompareIds, sameCalendarDay } from "@/lib/core/coach-compare";
import { compactCoachSeriesPacket, guardSeriesResponse, projectCoachSeries, readSeriesIds, type CoachSeries } from "@/lib/core/coach-series";
import { coachQuestionIntent, compactSingleCoachPacket, type CoachQuestionIntent } from "@/lib/core/coach-model-packet";
import { coachMaxTokens } from "@/lib/core/coach-output-budget";
import { consumeCoachEventStream, safeResponseHeaders, safeUpstreamError } from "@/lib/core/coach-stream";
import { acceptExplanation } from "./coach";

type ExplainInput = {
  text: string;
  decision: string;
  band: FatigueBand;
  goals: string;
  notes: string;
  energy: string;
};

export const explainCoach = createServerFn({ method: "POST" })
  .validator((input: ExplainInput) => {
    const bands: FatigueBand[] = ["fresh", "ready", "tired", "cooked"];
    if (!input || typeof input.text !== "string" || typeof input.decision !== "string" || !bands.includes(input.band)) {
      throw new Error("bad input");
    }
    return {
      text: input.text.slice(0, 200),
      decision: input.decision.slice(0, 500),
      band: input.band,
      goals: String(input.goals ?? "").slice(0, 200),
      notes: String(input.notes ?? "").slice(0, 300),
      energy: String(input.energy ?? "").slice(0, 200),
    };
  })
  .handler(async ({ data }) => {
    const access = await (await import("./model-access")).beginModelCall()
    if (!access.ok) return { ok: false as const, reason: "LOCKED" as const, detail: access.reason }
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const };
    const locked = data.band === "tired" || data.band === "cooked" ? "疲劳偏高，禁止建议加重、加组或改目标。" : "可以沿用规则，不要另起一个相反的结论。";
    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: 0.3,
          max_tokens: 180,
          messages: [
            {
              role: "system",
              content:
                "你是中长跑力量教练。规则已经改好课，你只把原因说清楚。用口语中文，最多四句，不要列表，不要英文术语。不要编造成绩，不要推翻规则结论。" + locked,
            },
            {
              role: "user",
              content: `运动员说：${data.text}\n规则结论：${data.decision}\n疲劳档：${data.band}\n目标：${data.goals || "未设"}\n这周记录：${data.notes || "没有"}\n热量和期限：${data.energy || "没填"}`,
            },
          ],
        }),
      });
      if (!res.ok) return { ok: false as const };
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = acceptExplanation(body.choices?.[0]?.message?.content ?? "", data.band);
      if (!text) return { ok: false as const };
      return { ok: true as const, text };
    } catch {
      return { ok: false as const };
    }
  });

export type CoachCallFailure = "NO_KEY" | "UPSTREAM" | "TIMEOUT" | "NETWORK" | "LOCKED"

const COACH_WAIT_MS = 25000

function describeFailure(error: unknown): { reason: "TIMEOUT" | "NETWORK"; detail: string } {
  const name = error instanceof Error ? error.name : "unknown"
  const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? (error.cause as { code?: unknown; name?: unknown }) : null
  const code = typeof cause?.code === "string" ? cause.code : ""
  if (name === "TimeoutError") return { reason: "TIMEOUT", detail: "TimeoutError" }
  if (code === "ECONNRESET") return { reason: "NETWORK", detail: "ECONNRESET" }
  if (name === "AbortError") return { reason: "NETWORK", detail: "AbortError" }
  return { reason: "NETWORK", detail: code ? `${name}:${code}` : name }
}

function phaseLog(event: string, fields: string) {
  const line = `${event} ${fields}`
  console.info(line)
  try { appendFileSync("/tmp/askcoach-phase.log", `${line}\n`) } catch { /* stdout is not always retained */ }
}

function readableJson(raw: string): boolean {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return false
    JSON.parse(match[0])
    return true
  } catch {
    return false
  }
}

function guardCode(turn: CoachTurn): string {
  if (turn.mode !== "unavailable") return turn.mode === "ask" ? "ASK" : "ACCEPTED"
  const rules: [string, string][] = [
    ["必须先追问尚未记录的恢复或睡眠", "HIGH_RPE_RECOVERY_REQUIRED"],
    ["没有区分酸痛和疼痛", "SORENESS_BOUNDARY_MISSING"],
    ["模型没有返回可核对", "MODEL_OUTPUT_INVALID"],
    ["确定的恢复或伤病结论", "MEDICAL_CONCLUSION"],
    ["饮食记录或一次掉速", "FUEL_CAUSALITY"],
    ["热量，却没有同一天", "FUEL_SOURCES"],
    ["主观强度或身体反馈数值", "BODY_VALUE_SOURCES"],
    ["未绑定的身体反馈", "BODY_BINDING"],
    ["回归训练边界没有引用", "RETURN_SOURCES"],
    ["下一课建议没有覆盖", "NEXT_SESSION_SOURCES"],
    ["安全约束冲突", "SAFETY_CONSTRAINT"],
    ["不能据此批准增加训练", "INCREASE_UNSUPPORTED"],
    ["没有可核对的事实来源", "NO_CITATIONS"],
    ["纵向回答没有覆盖每次", "SERIES_POINT_SOURCES"],
    ["纵向跑步结论没有覆盖", "SERIES_RUNNING_SOURCES"],
    ["实际用时没有对应", "SERIES_TIME_SOURCE"],
    ["实际用时顺序写反", "SERIES_TIME_ORDER"],
    ["纵向恢复结论缺少", "SERIES_RECOVERY_SOURCES"],
    ["训练趋势或能力变化", "SERIES_OVERCLAIM"],
  ]
  return rules.find(([fragment]) => turn.text.includes(fragment))?.[1] ?? "GUARD_REJECTED"
}

function coachSystemPrompt(kind: "candidate-route" | "formal-compare" | "formal-series", intent: CoachQuestionIntent, recoveryConflict: boolean, highRpeGap: boolean, sorenessOnly: boolean): string {
  const conflict = recoveryConflict
    ? "本次主观恢复有多条冲突 FACT。mode 必须是 ask，citations 同时列入每一条恢复 FACT 的 id，正文同时保留每条分数，请用户确认哪条有效，nextStep 为 null。不要计算平均值，不要挑选其中一条，不要给出下一课处方。正文不要写出增加、提高、提速、加组、恢复正常、安全回归。"
    : ""
  const highRpe = highRpeGap
    ? "当前 RPE 至少为 7，恢复和睡眠都未记录。mode 必须是 ask，引用 SESSION_RPE，写明这两项尚未记录，只问主观恢复是多少或睡眠几小时中的一个，nextStep 为 null。不要写保持、减量、恢复课或加量。不要用核对当下症状代替这个追问。"
    : ""
  const soreness = sorenessOnly
    ? "本次只有酸痛、没有疼痛。正文必须写明酸痛不等于疼痛，或酸痛本身不能说明伤病，并写明 clearance 为 UNKNOWN。只写不是诊断不够。不得写没有疼痛、已经恢复或安全回归。只可保持、减量、恢复、观察或继续核对症状。"
    : ""
  if (kind === "candidate-route" && intent === "RETURN") {
    return `你是跑步与力量教练。只用输入 JSON 里绑定本次训练的疼痛、酸痛、RPE、恢复和睡眠 FACT。history 不能当训练事实。酸痛不等于疼痛或伤病诊断。clearance 永远 UNKNOWN。不得声称已经安全回归、痊愈、没有疼痛或没有受伤风险。疼痛时停止诱发动作，只能保持、减量或恢复；必要时建议运动医学或康复评估，并写明不是诊断。酸痛时只能给出保持、减量、恢复和继续核对症状的边界。必须引用 returnToTraining.sourceIds。不得增加距离、速度、组数、重量或强度。输出最多两句简洁中文，nextStep 尽量为 null。citations 只能填事实包里存在的 id。用符合 response_format 的 JSON。${conflict}${highRpe}${soreness}`
  }
  const common = "你是跑步与力量教练。只用输入 JSON 中的事实和精确 source id；history 只帮助理解追问，不能当训练事实。事实、派生、推断和建议分开；UNKNOWN、未记录不等于 0、正常、无痛或已恢复。重复或冲突先请用户核对，不能代选。主观恢复、睡眠、酸痛、疼痛和 RPE 只认绑定本次训练的 FACT，酸痛不等于疼痛。不得生成伤病概率、诊断、负荷分或疲劳分，不得改课表、Decision 或疲劳分。returnToTraining.clearance 永远 UNKNOWN；可以说不能确认已恢复，不得说已痊愈、安全回归或获准恢复正常训练。PAIN_RECORDED 应停止诱发疼痛动作并考虑运动医学或康复评估，明确不是诊断。nextSession 只能使用 allowed；increaseSupported=false 时不能批准增加距离、速度、组数、重量或强度。下一课建议必须引用 requiredSourceIds，回归结论引用 returnToTraining.sourceIds。citations 只能填事实包里存在的 id，不用训练开始 id 代替数值或用时来源。用简洁中文输出符合 response_format 的 JSON。"
  if (kind === "formal-series") return `${common} 这是正式纵向包，顶部 question 是唯一当前问题，只回答它。问恢复时不要复述跑步秒数；问用时时不要评价恢复。observations 只含每次同一计划槽位都有完成来源的观察。实际用时逐次引用各 point.sourceEventIds；恢复数值逐次引用 SUBJECTIVE_RECOVERY FACT。缺一次或有冲突就说明数据不足或先核对，不能形成趋势。只能描述观察，不得宣称长期能力提高或下降。${conflict}`
  if (kind === "formal-compare") return `${common} 这是正式双节比较。newer 与 older 的来源不能混用；pairedRunning 只包含双方同一计划槽位都完成的事实。缺项、距离不同、结构 UNAVAILABLE 或冲突时不得判断快慢。具体用时引用各自完成事件；单一槽位差异不能推断长期能力变化。${conflict}`
  const intentRule = intent === "NEXT_SESSION"
    ? `这是下一课问题。严格使用 nextSession.allowed，并引用 requiredSourceIds。不要补充与问题无关的‘没有疼痛’‘没有酸痛’‘身体正常’；缺失只能不提或说不能确认。酸痛场景引用 SORENESS，并说明它不等于疼痛或伤病诊断；赛前引用 context:competition；减量周引用 context:cycle。${highRpe}`
    : intent === "FUEL"
      ? "这是饮食与表现问题。只在 SAME_DAY_RECORDED 时对照同一上海日的已记录摄入与目标，并同时引用 nutrition:log 和 context:fuel-target；记录不完整不能证明实际摄入不足或掉速原因。"
      : intent === "RUNNING"
        ? "这是本次跑步事实问题。旧数据 runningStructure=UNAVAILABLE 时不拆间歇；只有实际距离和时间都有才可谈派生配速。"
        : "只回答问题本身，不要为了显得完整而陈述输入未证明的身体状态。"
  return `${common} current 是当前所选训练。${intentRule} completedSetCount 只是已记录完成组数；0 不能说训练完成量为零，未记录组不能说实际没做。若问题明确比较两节，返回 compareIds；明确观察三至六次，返回 seriesIds；不要在路由回答中写成绩数字。指代不清则 ids 为空并只问一个必要问题。${conflict}`
}

export const askCoach = createServerFn({ method: "POST" })
  .validator((input: { brief: CoachBrief; history?: { role: "user" | "coach"; text: string }[]; candidates?: { id: string; startedAt: string; running: "INTERVAL" | "OTHER" | "UNAVAILABLE" }[]; compare?: { left: CoachBrief; right: CoachBrief; userSelected?: boolean; leftStartedAt?: string; rightStartedAt?: string } | null; series?: { points: { occurrenceId: string; startedAt: string; brief: CoachBrief }[] } | null }) => {
    if (!input?.brief || typeof input.brief.question !== "string") throw new Error("bad input");
    const b = input.brief;
    assertCoachPacket(b);
    const history = (input.history ?? []).slice(-8).filter((item) => (item.role === "user" || item.role === "coach") && typeof item.text === "string").map((item) => ({ role: item.role, text: item.text.slice(0, 300) }));
    const candidates = (input.candidates ?? []).filter((item) => item && typeof item.id === "string" && item.id.length <= 80 && typeof item.startedAt === "string" && item.startedAt.length <= 40 && (item.running === "INTERVAL" || item.running === "OTHER" || item.running === "UNAVAILABLE")).slice(0, 12);
    let compare: { left: CoachBrief; right: CoachBrief; userSelected: boolean; leftStartedAt: string; rightStartedAt: string } | null = null;
    if (input.compare?.left && input.compare.right) {
      assertCoachPacket(input.compare.left);
      assertCoachPacket(input.compare.right);
      const left = deriveCoachBrief({ ...input.compare.left, question: b.question.trim() });
      const right = deriveCoachBrief({ ...input.compare.right, question: b.question.trim() });
      const oriented = orientPair(left.occurrenceId ?? "", right.occurrenceId ?? "", String(input.compare.leftStartedAt ?? ""), String(input.compare.rightStartedAt ?? ""));
      if (!oriented) throw new Error("bad comparison");
      compare = {
        left: oriented.newerId === left.occurrenceId ? left : right,
        right: oriented.olderId === left.occurrenceId ? left : right,
        userSelected: input.compare.userSelected === true,
        leftStartedAt: oriented.newerStartedAt,
        rightStartedAt: oriented.olderStartedAt,
      };
    }
    let series: CoachSeries | null = null;
    if (input.series?.points) {
      const points = input.series.points.slice(0, 6).map((point) => {
        assertCoachPacket(point.brief);
        return { occurrenceId: String(point.occurrenceId ?? ""), startedAt: String(point.startedAt ?? ""), brief: deriveCoachBrief({ ...point.brief, question: b.question.trim() }) };
      });
      series = projectCoachSeries(points);
      if (!series) throw new Error("bad series");
    }
    if (compare && series) throw new Error("bad input");
    // Browser storage is the data owner. Recompute every constraint at the
    // server boundary instead of accepting client supplied mustAsk/constraints.
    return { brief: deriveCoachBrief({ ...b, question: b.question.trim() }), history, candidates, compare, series };
  })
  .handler(async ({ data }): Promise<{ ok: true; turn: CoachTurn; compareIds: [string, string] | null; seriesIds: string[] | null } | { ok: false; reason: CoachCallFailure; detail?: string }> => {
    const access = await (await import("./model-access")).beginModelCall()
    if (!access.ok) return { ok: false, reason: "LOCKED", detail: access.reason }
    const apiKey = process.env.XAI_API_KEY;
    const kind = data.series ? "formal-series" : data.compare ? "formal-compare" : "candidate-route";
    const entered = new Date().toISOString();
    phaseLog("[askCoach] entered", JSON.stringify({ kind, at: entered, userSelected: data.compare?.userSelected === true }));
    if (!apiKey) return { ok: false, reason: "NO_KEY" };
    if (data.compare && !data.compare.userSelected && sameCalendarDay(data.compare.leftStartedAt, data.compare.rightStartedAt)) {
      return { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "这两次训练在同一天，请先选择要比较的两节。我不会把它们混成一节。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
    }
    const started = Date.now();
    const intent = coachQuestionIntent(data.brief.question);
    const maxTokens = coachMaxTokens(kind, intent);
    const recoveryConflict = recoveryConflictApplies(data.brief);
    const highRpeGap = highRpeRecoveryRequired(data.brief);
    const sorenessOnly = sorenessBoundaryRequired(data.brief);
    const seriesPacket = data.series ? compactCoachSeriesPacket(data.series, data.history) : null;
    const basePacket = seriesPacket ?? (data.compare ? { history: data.history, newer: data.compare.left, older: data.compare.right, pairedRunning: pairedRunningObservations(data.compare.left, data.compare.right) } : compactSingleCoachPacket(data.brief, data.history, data.candidates));
    const knowledgeContext = buildCurriculumModelContext(data.brief.question);
    const packet = JSON.stringify({ ...basePacket, knowledgeContext });
    let stage: "connect" | "stream" | "body" = "connect";
    phaseLog("[askCoach] fetch", JSON.stringify({ kind, intent, transport: "sse", maxTokens, at: new Date(started).toISOString(), packetChars: packet.length, historyCount: data.history.length, historyChars: data.history.reduce((sum, item) => sum + item.text.length, 0), sourceCount: data.series ? data.series.points.reduce((sum, point) => sum + point.brief.sourceIds.length, 0) : data.compare ? data.compare.left.sourceIds.length + data.compare.right.sourceIds.length : data.brief.sourceIds.length, runningCount: data.series ? data.series.observations.length : data.compare ? (data.compare.left.running?.length ?? 0) + (data.compare.right.running?.length ?? 0) : data.brief.running?.length ?? 0, waitMs: COACH_WAIT_MS }));
    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(COACH_WAIT_MS),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: 0.2,
          max_tokens: maxTokens,
          stream: true,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "coach_answer",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  mode: { type: "string", enum: ["ask", "answer"] },
                  text: { type: "string" },
                  citations: { type: "array", items: { type: "string" } },
                  nextStep: { anyOf: [{ type: "string" }, { type: "null" }] },
                  medicalReferral: { type: "boolean" },
                  compareIds: { anyOf: [{ type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 }, { type: "null" }] },
                  seriesIds: { anyOf: [{ type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 }, { type: "null" }] },
                },
                required: ["mode", "text", "citations", "nextStep", "medicalReferral", "compareIds", "seriesIds"],
                additionalProperties: false,
              },
            },
          },
          messages: [
            {
              role: "system",
              content: coachSystemPrompt(kind, intent, recoveryConflict, highRpeGap, sorenessOnly) + CURRICULUM_SYSTEM_BOUNDARY,
            },
            { role: "user", content: packet },
          ],
        }),
      });
      const headers = safeResponseHeaders(res);
      phaseLog("[askCoach] headers", JSON.stringify({ kind, at: new Date().toISOString(), ...headers, elapsedMs: Date.now() - started }));
      if (!res.ok) {
        stage = "body";
        const rawText = await res.text();
        phaseLog("[askCoach] failed", JSON.stringify({ kind, stage, at: new Date().toISOString(), ...headers, bytes: rawText.length, error: safeUpstreamError(rawText), elapsedMs: Date.now() - started }));
        return { ok: false, reason: "UPSTREAM" };
      }
      const contentType = headers.contentType ?? "";
      let raw = "";
      if (contentType.includes("text/event-stream")) {
        stage = "stream";
        const streamed = await consumeCoachEventStream(res, () => {
          phaseLog("[askCoach] first_delta", JSON.stringify({ kind, at: new Date().toISOString(), elapsedMs: Date.now() - started }));
        });
        phaseLog("[askCoach] stop", JSON.stringify({ kind, transport: "sse", at: new Date().toISOString(), status: res.status, stop: streamed.completed, bytes: streamed.bytes, finishReason: streamed.finishReason, elapsedMs: Date.now() - started }));
        if (!streamed.completed) {
          phaseLog("[askCoach] INCOMPLETE_STREAM", JSON.stringify({ kind, at: new Date().toISOString(), bytes: streamed.bytes }));
          return { ok: false, reason: "UPSTREAM" };
        }
        raw = streamed.content;
      } else {
        // Fail safely if an upstream proxy ignores streaming and returns the
        // legacy complete JSON response.
        stage = "body";
        const rawText = await res.text();
        phaseLog("[askCoach] body", JSON.stringify({ kind, transport: "json", at: new Date().toISOString(), status: res.status, bytes: rawText.length, elapsedMs: Date.now() - started }));
        let body: { choices?: { message?: { content?: string } }[] };
        try {
          body = JSON.parse(rawText) as { choices?: { message?: { content?: string } }[] };
        } catch {
          phaseLog("[askCoach] INVALID_JSON", JSON.stringify({ kind, at: new Date().toISOString(), bytes: rawText.length }));
          return { ok: false, reason: "UPSTREAM" };
        }
        raw = body.choices?.[0]?.message?.content ?? "";
      }
      if (!readableJson(raw)) phaseLog("[askCoach] INVALID_JSON", JSON.stringify({ kind, at: new Date().toISOString(), bytes: raw.length }));
      const turn = data.series ? guardSeriesResponse(data.series, raw) : data.compare ? guardComparison(data.compare.left, data.compare.right, raw) : guardCoachResponse(data.brief, raw);
      phaseLog("[askCoach] guard", JSON.stringify({ kind, at: new Date().toISOString(), mode: turn.mode, code: guardCode(turn), subcode: guardSubcode(turn) }));
      const allowed = data.candidates.map((item) => item.id);
      const seriesIds = data.series || data.compare ? null : readSeriesIds(raw, allowed);
      const compareIds = data.series || data.compare || seriesIds ? null : readCompareIds(raw, allowed);
      return { ok: true, turn, compareIds, seriesIds };
    } catch (error) {
      const failure = describeFailure(error);
      phaseLog("[askCoach] failed", JSON.stringify({ kind, stage, at: new Date().toISOString(), elapsedMs: Date.now() - started, reason: failure.reason, detail: failure.detail }));
      return { ok: false, reason: failure.reason };
    }
  });
