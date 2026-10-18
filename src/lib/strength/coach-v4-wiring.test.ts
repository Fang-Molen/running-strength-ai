import test from "node:test"
import assert from "node:assert/strict"
import { buildCoachModelRequest, interpretCoachModelOutput, normalizeAskCoachInput, V4_WIRED_RULE } from "@/lib/strength/coach-pipeline"
import { deriveCoachBrief } from "@/lib/core/coach-brief"
import { buildParts } from "../../../evaluation/k12/fixtures.ts"
import type { FormalEvidenceRow } from "@/lib/core/coach-v4-c11-adapter"

const A = "ath-a", ASOF = "2026-03-10T00:00:00.000Z"
const row = (o: Partial<FormalEvidenceRow>): FormalEvidenceRow => ({ recordId: "ev:o1:rpe", athleteId: A, trainingOccurrenceId: "o1", sourceEventId: "ev:o1:rpe", source: "TRAINING_FACT", status: "OBSERVED", metric: "SESSION_RPE", value: 6, unit: "score", protocol: "session_rpe:session", occurredAt: "2026-03-01T09:00:00.000Z", knownAt: "2026-03-01T09:00:05.000Z", supersedesRecordId: null, verifiedByFormalProjection: true, ...o })
const input = (question: string, rows: FormalEvidenceRow[], asOf = ASOF) => normalizeAskCoachInput({ brief: deriveCoachBrief(buildParts(question, { occurrence: { id: "o1", startedAt: "2026-03-01T08:00:00.000Z" }, rpe: 6, sleep: 7 })), history: [], v4: { athleteId: A, asOf, rows } })
const raw = (o: Record<string, unknown>) => JSON.stringify({ mode: "answer", text: "本次主观强度 6/10。", citations: ["ev:o1:rpe"], nextStep: null, medicalReferral: false, compareIds: null, seriesIds: null, ...o })

test("server recomputes V4 review; malformed rows dropped; future asOf clamped", () => {
  const d = input("这次训练怎么样", [row({}), { bogus: 1 } as unknown as FormalEvidenceRow], "2099-01-01T00:00:00.000Z")
  assert.ok(d.v4); assert.equal(d.v4!.rowCount, 1); assert.equal(d.v4!.droppedRows, 1)
  assert.ok(Date.parse(d.v4!.asOf) < Date.parse("2099-01-01T00:00:00.000Z"))
})
test("snapshot reaches model input (packet + system rule), absent without v4", () => {
  const r = buildCoachModelRequest(input("这次训练怎么样", [row({})]))
  assert.ok(JSON.parse(r.packet).personalEvidenceV4.evidenceContext.includes("ev:o1:rpe")); assert.ok(r.system.endsWith(V4_WIRED_RULE))
  const plain = buildCoachModelRequest(normalizeAskCoachInput({ brief: deriveCoachBrief(buildParts("q", {})), history: [] }))
  assert.equal(JSON.parse(plain.packet).personalEvidenceV4, undefined); assert.ok(!plain.system.includes("personalEvidenceV4"))
})
test("clean cited answer passes V4 guard; nothing persisted", () => {
  const out = interpretCoachModelOutput(input("这次训练怎么样", [row({})]), raw({}))
  assert.equal(out.v4.status, "PASSED_STRUCTURAL_GUARD"); assert.equal(out.v4.persisted, false); assert.equal(out.turn.planChanged, false)
})
test("nextStep is reviewed too: negated referral in nextStep only -> advice removed and referral retained", () => {
  const out = interpretCoachModelOutput(input("这次训练怎么样", [row({}), row({ recordId: "ev:o1:pain", sourceEventId: "ev:o1:pain", metric: "PAIN_SCORE", value: 4 })]), raw({ text: "本次主观强度 6/10，建议寻求运动医学评估。", nextStep: "不需要去看医生，照常训练", citations: ["ev:o1:rpe", "ev:o1:pain"] }))
  assert.equal(out.v4.status, "PASSED_STRUCTURAL_GUARD"); assert.ok(out.v4.flags.includes("NEGATED_REFERRAL")); assert.ok(out.v4.flags.includes("NEXT_STEP_REMOVED")); assert.equal(out.turn.nextStep, null); assert.match(out.turn.text,/运动医学评估/); assert.equal(out.turn.medicalReferral,true)
})
test("voided / revoked source cited -> fallback", () => {
  const out = interpretCoachModelOutput(input("这次训练怎么样", [row({ status: "VOIDED" })]), raw({}))
  assert.equal(out.v4.status, "BASE_GUARD_REJECTED"); assert.ok(out.v4.flags.includes("UNKNOWN_OR_REVOKED_SOURCE")); assert.equal(out.turn.mode,"unavailable")
})
test("emergency question: referral retained even when production guard rejects", () => {
  const d = input("跑步时胸痛还晕倒了，下一课怎么练", [row({})])
  const out = interpretCoachModelOutput(d, "not json")
  assert.equal(out.turn.medicalReferral, true); assert.match(out.turn.text, /急救|急诊/)
  const ok = interpretCoachModelOutput(d, raw({ text: "请立即停止训练并就医。" }))
  assert.match(ok.turn.text, /急救|急诊/); assert.equal(ok.turn.nextStep, null)
})
test("many facts: model still receives a bounded fact window (no all-or-nothing drop), omission declared", () => {
  const rows = Array.from({ length: 40 }, (_, i) => row({ recordId: `ev:o${i}:rpe`, sourceEventId: `ev:o${i}:rpe`, trainingOccurrenceId: `o${i}`, occurredAt: `2026-02-${String(1 + (i % 27)).padStart(2, "0")}T09:00:00.000Z`, knownAt: `2026-02-${String(1 + (i % 27)).padStart(2, "0")}T09:00:05.000Z` }))
  const d = input("这次训练怎么样", rows)
  const ctx = JSON.parse(d.v4!.packet.evidenceContext)
  assert.ok(ctx.facts.length > 0); assert.ok(d.v4!.omittedFacts > 0); assert.ok(ctx.missing.some((m: string) => m.startsWith("OLDER_FACTS_OMITTED_")))
})
test("probe regression: citing the training-start id (used as plan-row source) does not trip the V4 revoked-source flag", () => {
  const d = input("这次训练怎么样", [row({}), row({ recordId: "o1#goal", sourceEventId: "o1", source: "PLAN", status: "PLANNED", metric: "GOAL_SECONDS", value: 90, unit: "s" })])
  const out = interpretCoachModelOutput(d, raw({ citations: ["o1", "ev:o1:rpe"] }))
  assert.equal(out.v4.status, "PASSED_STRUCTURAL_GUARD")
})
test("R2 fix: long session -> factDigest carries ALL laps deterministically (no drop)", () => {
  const rows = Array.from({ length: 18 }, (_, i) => row({ recordId: `lap:o1:${i + 1}`, sourceEventId: `lap:o1:${i + 1}`, metric: "SPLIT_SECONDS", value: 200 + i, unit: "s", protocol: `running:track:lap${i + 1}`, occurredAt: `2026-03-01T09:${String(i + 10).padStart(2, "0")}:00.000Z`, knownAt: "2026-03-01T10:00:00.000Z", source: "DEVICE", verifiedByFormalProjection: false }))
  const r = buildCoachModelRequest(input("分析这次训练", rows))
  const digest: string = JSON.parse(r.packet).personalEvidenceV4.factDigest
  for (let i = 1; i <= 18; i++) assert.ok(digest.includes(`lap:o1:${i}:SPLIT_SECONDS`), `lap ${i}`)
  assert.match(digest, /splits n=18 first=200s last=217s/)
  assert.equal(buildCoachModelRequest(input("分析这次训练", rows)).packet, r.packet)
})
test("R2 fix: missing RPE rule tells the model to analyse with uncertainty, not only ask", () => {
  assert.match(V4_WIRED_RULE, /缺少 RPE.*不要只追问.*mode 用 answer/)
})
test("R2 fix: S2-R6 wording (胸口发紧/眼前发黑/心慌) is an emergency; answer replaced with emergency referral", () => {
  const d = input("今天跑第二组的时候胸口发紧、头晕眼前发黑，现在还有点心慌，下一组还能跑吗？", [row({})])
  const out = interpretCoachModelOutput(d, raw({ text: "可以先休息一下再跑下一组。" }))
  assert.match(out.turn.text, /急救|急诊/); assert.equal(out.turn.nextStep, null); assert.equal(out.code, "V4_GUARD_FALLBACK")
})
test("R2 fix: production-guard rejection is labelled BASE_*, not V4_GUARD_FALLBACK", () => {
  const out = interpretCoachModelOutput(input("这次训练怎么样", [row({})]), "not json")
  assert.equal(out.v4.status, "BASE_GUARD_REJECTED"); assert.match(out.code, /^BASE_/)
})
test("R2 fix (S3-R1/R3 false positive): citing a skipped rep to say it was skipped is not a revoked source", () => {
  const d = input("第二周4组都完成了吗", [row({}), row({ recordId: "o1#rep4", sourceEventId: "run:o1:r4", metric: "SPLIT_SECONDS", status: "SKIPPED", value: null, unit: "s", protocol: "running:c1:rep4" })])
  const out = interpretCoachModelOutput(d, raw({ text: "第4组被标记为跳过，主观强度 6/10。", citations: ["ev:o1:rpe", "run:o1:r4"] }))
  assert.equal(out.v4.status, "PASSED_STRUCTURAL_GUARD")
})
test("R2: deterministic structure detection — continuous block, progressive reps, strides, long rest", () => {
  const laps: [string, number, number, boolean][] = [["l1", 1000, 218.5, true], ["l2", 970, 211.7, true], ["l3", 1000, 210.9, true], ["l4", 210, 369.7, false], ["l5", 990, 195.4, true], ["l6", 230, 210, false], ["l7", 990, 192.7, true], ["l8", 210, 205.3, false], ["l9", 990, 182.8, true], ["l10", 370, 691, false], ["l11", 190, 24.6, true], ["l12", 230, 212.6, false], ["l13", 180, 25.9, true]]
  const rows = laps.map(([id, m, sec, w], i) => row({ recordId: id, sourceEventId: id, metric: w ? "SPLIT_SECONDS" : "REST_SECONDS", value: sec, unit: "s", source: "DEVICE", verifiedByFormalProjection: false, protocol: `running:track:${i<3?'continuous':'rep'}:lap${i}:${m}m`, occurredAt: `2026-03-01T09:${String(10 + i).padStart(2, "0")}:00.000Z`, knownAt: "2026-03-01T10:00:00.000Z" }))
  const digest: string = JSON.parse(buildCoachModelRequest(input("分析这次训练", rows)).packet).personalEvidenceV4.factDigest
  assert.match(digest, /CONTINUOUS_NO_RECOVERY l1\+l2\+l3 total 2970m/)
  assert.match(digest, /REPS 3x~990m .*trend PROGRESSIVE_FASTER/)
  assert.match(digest, /STRIDES 2x l11=24\.6s\/190m, l13=25\.9s\/180m/)
  assert.match(digest, /LONG_REST l10=11:31/)
})

// ---------------- R4 ----------------
import { computeV4Facts } from "@/lib/core/coach-v4-computed"
import { composeScaffold, COACH_SCAFFOLD_RESPONSE_FORMAT } from "@/lib/strength/coach-pipeline"
const split = (id: string, occ: string, m: number, sec: number, at: string, hr: number | null, rest = false, knownAt?: string) => row({ recordId: id, sourceEventId: id, trainingOccurrenceId: occ, metric: rest ? "REST_SECONDS" : "SPLIT_SECONDS", value: sec, unit: "s", source: "DEVICE", verifiedByFormalProjection: false, protocol: `running:track:rep:${id}:${m}m${hr ? `-hr=${hr}` : ""}`, occurredAt: at, knownAt: knownAt ?? new Date(Date.parse(at) + 3600e3).toISOString() })
function twoWeeks() {
  const old = ["a1", "a2", "a3"].flatMap((id, i) => [split(id, "o0", 1000, 200 - i, `2026-02-22T09:${10 + 2 * i}:00.000Z`, null), split(`${id}r`, "o0", 200, 90, `2026-02-22T09:${11 + 2 * i}:00.000Z`, null, true)])
  const cur = [["b1", 196, 150], ["b2", 192, 154], ["b3", 188, 160]].flatMap(([id, s, h], i) => [split(id as string, "o1", 1000, s as number, `2026-03-01T09:${10 + 2 * i}:00.000Z`, h as number, false, i === 2 ? "2026-03-03T09:00:00.000Z" : undefined), split(`${id}r`, "o1", 200, 100, `2026-03-01T09:${11 + 2 * i}:00.000Z`, null, true)])
  return [...old, ...cur]
}
test("R7: legacy protocol HR stays unstructured; no recovery binding or comparable trend is invented", () => {
 const d=input("分析这次训练",twoWeeks()),c=computeV4Facts(d.v4!.review.audit.snapshot,"o1",2)
 assert.ok(c.missing.includes("HR_NOT_A_FORMAL_FIELD"));assert.ok(c.missing.includes("RECOVERY_WORK_BINDING_UNKNOWN"))
 assert.ok(!c.facts.some(f=>/HR_DRIFT|RECOVERY_RATIO|VS_SIMILAR|REP_PACE/.test(f.kind)))
 assert.match(c.facts.find(f=>f.kind==='WEEKLY_LOAD')!.text,/9:36.*9:57/)
 assert.deepEqual(c.facts.find(f=>f.kind==='LATE_ADDED')!.cites,['b3'])
 const universe=new Set(d.v4!.universe);for(const f of c.facts)for(const id of f.cites)assert.ok(universe.has(id),id)
})
test("R7: no focus never borrows the most recent session; corrections cite replacement source, not record key",()=>{
 const snapshot=input("分析",twoWeeks()).v4!.review.audit.snapshot
 assert.deepEqual(computeV4Facts(snapshot,null).facts,[])
 const b=snapshot.active.find(e=>e.id==='b3')!
 const changed={...snapshot,active:snapshot.active.map(e=>e.id==='b3'?{...e,sourceId:'replacement-event'}:e),corrections:[{replacedId:'old',replacementId:'b3'}]}
 assert.deepEqual(computeV4Facts(changed,'o1').facts.find(f=>f.kind==='CORRECTED')!.cites,['replacement-event'])
})
const scaffoldRaw = (sections: unknown, o: Record<string, unknown> = {}) => raw({ text: "总述。", citations: [], sections, ...o })
test("R4: scaffold composed into visible text in fixed order; V4-wired requests use the scaffold schema", () => {
  const d = input("这次训练怎么样", [row({})])
  assert.equal(buildCoachModelRequest(d).responseFormat, COACH_SCAFFOLD_RESPONSE_FORMAT)
  const out = interpretCoachModelOutput(d, scaffoldRaw({ facts: [{ text: "本次主观强度 6/10", citations: ["ev:o1:rpe"] }], explanations: ["配速安排合适", "当天状态较好"], uncertainty: ["没有心率记录"], suggestion: { variable: "恢复", change: "组间休息保持 90 秒" } }))
  assert.equal(out.scaffold.complete, false); assert.ok(out.scaffold.flags.includes("NEXT_STEP_REST_SOURCE_MISSING")); assert.doesNotMatch(out.turn.text,/组间休息保持 90 秒/)
  assert.match(out.turn.text, /事实：本次主观强度 6\/10。\n可能的解释：1）配速安排合适；2）当天状态较好。\n不确定\/缺失：没有心率记录。/)
  assert.ok(out.turn.citations.includes("ev:o1:rpe"))
})
test("R4: scaffold checks — <2 explanations / no uncertainty flagged; multi-variable suggestion flagged for review; uncited fact dropped", () => {
  const c = composeScaffold(scaffoldRaw({ facts: [{ text: "无引用事实", citations: [] }, { text: "主观强度 6", citations: ["ev:o1:rpe"] }], explanations: ["只有一个"], uncertainty: [], suggestion: { variable: "组数", change: "多跑一组并把配速提快 3 秒" } }))
  assert.ok(c.scaffold.flags.includes("FEWER_THAN_2_EXPLANATIONS") && c.scaffold.flags.includes("NO_UNCERTAINTY") && c.scaffold.flags.includes("UNCITED_FACT_DROPPED"))
  assert.ok(c.scaffold.flags.some((f) => f.startsWith("MULTI_VARIABLE_SUGGESTION_REVIEW")))
  const text = JSON.parse(c.raw).text; assert.doesNotMatch(text, /无引用事实/); assert.match(text,/多跑一组/); assert.equal(c.scaffold.complete, false)
})
test("R4: scaffold cannot bypass safety — emergency still replaced, increase advice in suggestion still stripped by high-RPE guard", () => {
  const emerg = interpretCoachModelOutput(input("跑步时胸痛还晕倒了，下一课怎么练", [row({})]), scaffoldRaw({ facts: [{ text: "主观强度 6", citations: ["ev:o1:rpe"] }], explanations: ["a", "b"], uncertainty: ["c"], suggestion: { variable: "配速", change: "下次照常训练" } }))
  assert.equal(emerg.turn.medicalReferral, true); assert.match(emerg.turn.text, /急救|急诊/); assert.doesNotMatch(emerg.turn.text, /照常训练/)
  const hi = normalizeAskCoachInput({ brief: deriveCoachBrief(buildParts("RPE 8，下一课怎么练", { occurrence: { id: "o1", startedAt: "2026-03-01T08:00:00.000Z" }, rpe: 8 })), history: [], v4: { athleteId: A, asOf: ASOF, rows: [row({ value: 8 })] } })
  const out = interpretCoachModelOutput(hi, scaffoldRaw({ facts: [{ text: "本次主观强度 8/10", citations: ["ev:o1:rpe"] }], explanations: ["强度偏高", "恢复不足"], uncertainty: ["睡眠未知"], suggestion: { variable: "配速", change: "下次配速提快 5 秒" } }, { citations: ["ev:o1:rpe"] }))
  assert.doesNotMatch(out.turn.text, /提快/); assert.match(out.turn.text, /已记录本次 RPE 8/)
})
test("R4: unsourced scaffold suggestion is dropped (analysis kept); unsourced advice in text is still rejected by the unchanged rule", () => {
  const d = normalizeAskCoachInput({ brief: deriveCoachBrief(buildParts("这次训练怎么样", { occurrence: { id: "o1", startedAt: "2026-03-01T08:00:00.000Z" }, rpe: 8, sleep: 5 })), history: [], v4: { athleteId: A, asOf: ASOF, rows: [row({ value: 8 })] } })
  const req = d.brief.nextSession!.requiredSourceIds; assert.ok(req.some((id) => id !== "ev:o1:rpe"), JSON.stringify(req))
  const sections = { facts: [{ text: "本次主观强度 8/10", citations: ["ev:o1:rpe"] }], explanations: ["强度偏高", "睡眠偏少"], uncertainty: ["恢复未知"], suggestion: { variable: "强度", change: "保持" } }
  const out = interpretCoachModelOutput(d, scaffoldRaw(sections, { citations: ["ev:o1:rpe"] }))
  if (req.some((id) => id !== "ev:o1:rpe")) { assert.ok(out.scaffold.flags.includes("SUGGESTION_UNSOURCED_DROPPED")); assert.doesNotMatch(out.turn.text, /下一课建议/); assert.notEqual(out.turn.mode, "unavailable") }
  const textAdvice = interpretCoachModelOutput(d, raw({ text: "本次主观强度 8/10。下一课建议减量。", citations: ["ev:o1:rpe"] }))
  if (req.some((id) => id !== "ev:o1:rpe")) { assert.notEqual(textAdvice.turn.mode, "unavailable"); assert.ok(textAdvice.v4.flags.includes("LOCAL_CONTEXT_FALLBACK")); assert.doesNotMatch(textAdvice.turn.text,/下一课建议减量/); }
})
