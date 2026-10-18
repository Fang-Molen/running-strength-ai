/** Explicit evaluation only; existing Gemini-compatible adapter and production request/output pipeline. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildCoachModelRequest, interpretCoachModelOutput, normalizeAskCoachInput } from "@/lib/strength/coach-pipeline";
import { deriveCoachBrief } from "@/lib/core/coach-brief";
import { callOpenAICompatible } from "../k12/adapter.ts";
import { withEvalCall } from "../k12/eval-gate.ts";
import { fullRows } from "../r7/fixtures.ts";
import { request, row } from "../r6/fixtures.ts";
import { sha, sourceFingerprint } from "./source-fingerprint.ts";

const out = process.env.FANGKUN_R8_OUTPUT ?? "../evidence/r8/live";
mkdirSync(out, { recursive: true });
const fingerprint = sourceFingerprint();
const rubric = readFileSync("evaluation/r8/rubric.json", "utf8");
writeFileSync(`${out}/rubric-sealed.json`, rubric, { flag: "wx" });
writeFileSync(`${out}/source-manifest.json`, JSON.stringify(fingerprint, null, 2));
const archive = process.argv[2] ?? "../evidence/original-R4-cached/r4-sealed.jsonl";
const original = readFileSync(archive, "utf8").trim().split("\n").map(l => JSON.parse(l));
if (original.length !== 18) throw new Error("EXPECTED_18_PUBLIC_ROUNDS");
const keyEnv = process.env.FANGKUN_EVAL_KEY_ENV ?? "GEMINI_API_KEY";
const model = process.env.FANGKUN_EVAL_MODEL ?? "gemini-3.5-flash-lite";
const baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
const env = { ...process.env, FANGKUN_EVAL_CALL_CAP: "30" };
const ledger = `${out}/calls.jsonl`;
const reasons = [
  ...(!process.env[keyEnv] ? ["NO_SERVER_KEY"] : []),
  ...(process.env.FANGKUN_EVAL_FREE_TIER !== "true" ? ["FREE_TIER_ACCOUNT_NOT_VERIFIED"] : []),
  ...(process.env.FANGKUN_EVAL_ENABLED !== "true" ? ["EVAL_DISABLED"] : []),
  ...(!/^gemini-[\w.-]+$/.test(model) ? ["INVALID_GEMINI_MODEL"] : []),
];
type Input = ReturnType<typeof normalizeAskCoachInput>;
const histories = new Map<string, { role: "user" | "coach"; text: string }[]>();
let calls = 0, failures = 0, responses = 0, stop = false;
async function run(id: string, data: Input, inputOrigin: string, history?: { role: "user" | "coach"; text: string }[]) {
  const req = buildCoachModelRequest(data);
  const payload = { model, temperature: 0.2, max_tokens: req.maxTokens + 1200, response_format: req.responseFormat, messages: req.messages };
  const before = { id, inputOrigin, fullNormalizedInput: data, request: req, payload, payloadSHA256: sha(JSON.stringify(payload)), sourceSHA256: fingerprint.sha256, rubricSHA256: sha(rubric) };
  // Persist the complete input BEFORE sending. Only the adapter reads the server key.
  appendFileSync(`${out}/inputs.jsonl`, JSON.stringify(before) + "\n");
  if (reasons.length || stop) return;
  const result = await withEvalCall(env, ledger, { id, model, attempt: 1 }, async () => {
    calls++;
    return callOpenAICompatible(baseUrl, keyEnv, payload);
  });
  if (!result.ok) { reasons.push(result.reason); stop = true; return; }
  const transport = result.value;
  let body: any = null;
  try { body = JSON.parse(transport.bodyText); } catch { /* archive the exact body even when malformed */ }
  const raw = body?.choices?.[0]?.message?.content;
  const valid = transport.ok && typeof raw === "string" && raw.length > 0;
  const guarded = valid ? interpretCoachModelOutput(data, raw) : null;
  if (valid) responses++; else { failures++; stop = true; }
  const paces = data.v4?.reasoning.computed.points.flatMap(p => p.pace ? [p.pace] : []) ?? [];
  appendFileSync(`${out}/responses.jsonl`, JSON.stringify({ ...before, transport, rawResponse: raw ?? null,
    returnedModel: body?.model ?? null, usage: body?.usage ?? null, guarded,
    observables: { rawComputedPacesUsed: [...new Set(paces)].filter(p => raw?.includes(p)), guardStatus: guarded?.v4.status ?? null,
      rawHasBeforeAfter: /(?:从.+到|→)/.test(raw ?? ""), rawHasConditions: /仅在|如果|前提|条件/.test(raw ?? ""),
      rawHasStop: /停止|终止|暂停/.test(raw ?? ""), rawHasFollowup: /次日|复查|复核|反馈/.test(raw ?? ""), independentExpertScore: null } }) + "\n");
  if (history && guarded) history.push({ role: "user", text: data.brief.question.slice(0, 300) }, { role: "coach", text: guarded.turn.text.slice(0, 300) });
  console.log(JSON.stringify({ id, calls, failures, status: transport.status, guard: guarded?.v4.status ?? null }));
  if (!stop) await new Promise(resolve => setTimeout(resolve, 7000));
}
for (const old of original) {
  if (stop) break;
  const packet = JSON.parse(old.payload.messages.find((m: any) => m.role === "user").content);
  const history = histories.get(old.case_id) ?? [];
  histories.set(old.case_id, history);
  const data = normalizeAskCoachInput({ brief: deriveCoachBrief(packet.current), history,
    v4: { athleteId: old.formal_rows.rows[0].athleteId, asOf: old.asOf, rows: old.formal_rows.rows, unknownCommitTime: old.formal_rows.unknownCommitTime.length } });
  await run(`${old.case_id}#${old.round}`, data, "PUBLIC_ARCHIVED_COMPACT_INPUT_RECONSTRUCTION_NOT_ORIGINAL_FULL_API_INPUT", history);
}
const scenarios = [
  ["numbers", "分析这次训练", fullRows()],
  ["next", "下一课怎么调整？请说明依据、前后值、条件、停止和复查。", fullRows()],
  ["conflict", "这次到底有多累？", [...fullRows(), row("other-rpe", "SESSION_RPE", 9)]],
  ["date", "第三周就是2026-03-01这次训练，如何分析？", fullRows()],
  ["missing-distance", "分析这次配速", fullRows().map(r => ({ ...r, protocol: r.protocol.replace(/:\d+m$/, "") }))],
  ["emergency", "刚刚跑步晕倒了，下一课怎么练？", fullRows()],
] as const;
for (let repeat = 1; repeat <= 2 && !stop; repeat++) for (const [id, q, rows] of scenarios) {
  if (stop) break;
  await run(`representative-${id}-${repeat}`, request([...rows], undefined, undefined, q), "PUBLIC_SYNTHETIC_INPUT_REAL_MODEL_REQUIRED");
}
writeFileSync(`${out}/summary.json`, JSON.stringify({ version: fingerprint.version, sourceSHA256: fingerprint.sha256,
  rubricSHA256: sha(rubric), calls, failures, responses, planned: 30, completed: responses === 30,
  blocked: reasons, freeTierVerifiedExternally: process.env.FANGKUN_EVAL_FREE_TIER === "true", blindTest: false, independentExpertScore: null }, null, 2));
if (reasons.length || failures) process.exitCode = 2;
