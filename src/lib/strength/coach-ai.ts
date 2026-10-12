import { createServerFn } from "@tanstack/react-start";
import { appendFileSync } from "node:fs";
import type { FatigueBand } from "./agent";
import type { CoachTurn } from "@/lib/core/coach-brief";
import { sameCalendarDay } from "@/lib/core/coach-compare";
import { buildCoachModelRequest, COACH_RESPONSE_FORMAT, interpretCoachModelOutput, normalizeAskCoachInput, type AskCoachRawInput } from "./coach-pipeline";
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

export const askCoach = createServerFn({ method: "POST" })
  .validator((input: AskCoachRawInput) => normalizeAskCoachInput(input))
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
    const request = buildCoachModelRequest(data);
    const { intent, maxTokens, packet } = request;
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
          response_format: COACH_RESPONSE_FORMAT,
          messages: request.messages,
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
      const { turn, compareIds, seriesIds, code, subcode } = interpretCoachModelOutput(data, raw);
      phaseLog("[askCoach] guard", JSON.stringify({ kind, at: new Date().toISOString(), mode: turn.mode, code, subcode }));
      return { ok: true, turn, compareIds, seriesIds };
    } catch (error) {
      const failure = describeFailure(error);
      phaseLog("[askCoach] failed", JSON.stringify({ kind, stage, at: new Date().toISOString(), elapsedMs: Date.now() - started, reason: failure.reason, detail: failure.detail }));
      return { ok: false, reason: failure.reason };
    }
  });
