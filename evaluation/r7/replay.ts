/** Local product-code regression plus cached-completion re-audit. This never calls a model. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildCoachModelRequest,
  interpretCoachModelOutput,
  normalizeAskCoachInput,
} from "@/lib/strength/coach-pipeline";
import { deriveCoachBrief } from "@/lib/core/coach-brief";
import { answerLocally } from "@/lib/core/coach-local-first";
import { fullRows } from "./fixtures.ts";
import { request, row } from "../r6/fixtures.ts";
import { sourceFingerprint } from "../r8/source-fingerprint.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const fingerprint = sourceFingerprint();
const version = fingerprint.version;
const sourceManifestSHA256 = process.env.FANGKUN_REPLAY_BASELINE
  ? "UNMODIFIED_GROK_R4"
  : fingerprint.sha256;
const contracts = [
  {
    id: "NUMERIC_VAGUE_MODEL",
    rows: fullRows(),
    q: "分析这次训练",
    body: "这次工作段逐组加快，原因仍待核对。",
    cites: ["work1"],
    step: null,
    check: (a: any) => ["3:17", "3:15", "3:13", "3:05"].every((p) => a.turn.text.includes(p)),
  },
  {
    id: "MISSING_ADVICE_CITATION",
    rows: fullRows(),
    q: "下一课怎么调整？",
    body: "工作段有加快，但不能据此确定原因。",
    cites: ["work1"],
    step: "下一课组间休息保持210秒。",
    check: (a: any) =>
      a.turn.text.includes("工作段有加快") &&
      a.turn.nextStep === null &&
      a.v4.flags.includes("NEXT_STEP_REMOVED"),
  },
  {
    id: "REST_DENSITY",
    rows: fullRows(),
    q: "分析这次训练",
    body: "工作段有加快，但不能据此确定原因。",
    cites: ["work1"],
    step: "建议下一课组间休息从3:30缩短到2:30。",
    check: (a: any) =>
      a.turn.text.includes("工作段有加快") &&
      !a.turn.text.includes("2:30") &&
      a.v4.flags.includes("REST_DENSITY_INCREASE_NOT_SUPPORTED"),
  },
  {
    id: "RPE_CONFLICT",
    rows: [...fullRows(), row("other-rpe", "SESSION_RPE", 9)],
    q: "下一课怎么调整？",
    body: "这次训练表现稳定。",
    cites: ["work1"],
    step: null,
    check: (a: any) =>
      a.turn.text.includes("RPE 6/10") &&
      a.turn.text.includes("RPE 9/10") &&
      a.turn.text.includes("同一整课、单组"),
  },
  {
    id: "AMBIGUOUS_WEEK",
    rows: fullRows(),
    q: "第四周那次课怎么看？",
    body: "第四周表现稳定。",
    cites: ["work1"],
    step: null,
    check: (a: any) =>
      !a.turn.text.includes("第四周表现稳定") && a.turn.text.includes("哪天或哪条"),
  },
  {
    id: "INVENTED_PACE",
    rows: fullRows(),
    q: "分析这次训练",
    body: "本次配速4:00/km。",
    cites: ["work1"],
    step: null,
    check: (a: any) => !a.turn.text.includes("4:00") && a.turn.text.includes("3:17"),
  },
  {
    id: "VOIDED_SOURCE",
    rows: [...fullRows(), row("void", "SPLIT_SECONDS", 220, { status: "VOIDED" })],
    q: "分析这次训练",
    body: "根据作废的成绩评价能力。",
    cites: ["void"],
    step: null,
    check: (a: any) => !a.turn.text.includes("根据作废的成绩评价能力") && a.turn.nextStep === null,
  },
  {
    id: "EMERGENCY",
    rows: fullRows(),
    q: "刚刚跑步晕倒了，下一课怎么练？",
    body: "照常训练。",
    cites: ["work1"],
    step: null,
    check: (a: any) =>
      a.turn.medicalReferral && /急救|急诊/.test(a.turn.text) && a.turn.nextStep === null,
  },
];
const results = contracts.map((c) => {
  const data = request(c.rows, undefined, undefined, c.q);
  const raw = JSON.stringify({
    mode: "answer",
    text: c.body,
    citations: c.cites,
    nextStep: c.step,
    medicalReferral: false,
  });
  const answer = interpretCoachModelOutput(data, raw);
  const local = data.v4?.reasoning
    ? answerLocally(data.brief, {
        frame: data.v4.reasoning,
        snapshot: data.v4.review.audit.snapshot,
      })
    : answerLocally(data.brief);
  return {
    id: c.id,
    input: { question: c.q, rows: c.rows },
    rawContractFixture: raw,
    syntheticContractNotModelAnswer: true,
    modelRequest: buildCoachModelRequest(data),
    localAnswer: local,
    guarded: answer,
    passed: c.check(answer),
  };
});
const cachedPath = process.argv[2],
  cached: any[] = [];
if (cachedPath)
  for (const line of readFileSync(cachedPath, "utf8").trim().split("\n")) {
    const old = JSON.parse(line),
      packet = JSON.parse(old.payload.messages.find((m: any) => m.role === "user").content);
    // The old full raw API input was not archived; this is its archived compact packet + exact formal rows.
    const input = {
      brief: deriveCoachBrief(packet.current),
      history: old.history_in,
      v4: {
        athleteId: old.formal_rows.rows[0].athleteId,
        asOf: old.asOf,
        rows: old.formal_rows.rows,
        unknownCommitTime: old.formal_rows.unknownCommitTime.length,
      },
    };
    const data = normalizeAskCoachInput(input),
      after = interpretCoachModelOutput(data, old.raw_response);
    cached.push({
      id: `${old.case_id}#${old.round}`,
      input,
      originalRequest: old.payload,
      originalRequestSHA256: old.payload_sha256,
      rawModelResponse: old.raw_response,
      rawModelResponseSHA256: sha(old.raw_response),
      originalVisible: old.visible,
      originalGates: old.gates,
      reauditedVisible: after.turn,
      reauditedGates: { code: after.code, v4: after.v4, scaffold: after.scaffold },
      unchangedRawCompletion: true,
      fullOriginalApiInputAvailable: false,
      newModelCalls: 0,
      freshModelCapabilityScore: null,
    });
  }
const output = {
  version,
  sourceManifestSHA256,
  externalModelCalls: 0,
  blindTest: false,
  contractFixtures: results,
  cachedCompletions: cached,
};
const dir = process.env.FANGKUN_REPLAY_OUTPUT ?? "evaluation/r7/results";
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "/replay.json", JSON.stringify(output, null, 2) + "\n");
console.log(
  JSON.stringify({
    version,
    sourceManifestSHA256,
    contracts: results.length,
    passed: results.filter((r) => r.passed).length,
    cachedCompletions: cached.length,
    newModelCalls: 0,
  }),
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
