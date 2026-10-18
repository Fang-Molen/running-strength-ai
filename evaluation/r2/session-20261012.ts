/** One real session (user screenshot, transcribed by Grok Bot) imported for an isolated eval athlete. Wired V4 path, EXTERNAL_MODEL_WITH_FANGKUN_CONTEXT. */
import { writeFileSync } from "node:fs"
import { buildCoachModelRequest, interpretCoachModelOutput, normalizeAskCoachInput } from "@/lib/strength/coach-pipeline"
import { deriveCoachBrief } from "@/lib/core/coach-brief"
import { buildFormalEvidenceRows } from "@/lib/core/coach-v4-formal-rows"
import { buildParts } from "../k12/fixtures.ts"
import { withEvalCall } from "../k12/eval-gate.ts"
import { callOpenAICompatible } from "../k12/adapter.ts"
const OUT = process.env.SESSION_OUT ?? "/workspace/fangkun-session-20261012", TAG = process.env.SESSION_TAG ?? ""
const RECOV = process.env.RECOVERY === "1" // SYNTHETIC recovery answer (恢复7, 睡7小时) — not from the user
// lap, km, time, displayed pace, avg HR — transcribed from the screenshot
const laps: [number, number, string, string, number][] = [[1,1.00,"3:38.52","3'39\"",160],[2,0.97,"3:31.67","3'37\"",163],[3,1.00,"3:30.92","3'31\"",166],[4,0.21,"6:09.65","29'16\"",129],[5,0.99,"3:15.41","3'17\"",154],[6,0.23,"3:29.97","15'21\"",145],[7,0.99,"3:12.73","3'14\"",155],[8,0.21,"3:25.29","16'22\"",144],[9,0.99,"3:11.00","3'13\"",153],[10,0.21,"3:29.09","16'41\"",148],[11,0.99,"3:02.76","3'05\"",158],[12,0.37,"11:30.97","31'21\"",133],[13,0.19,"0:24.63","2'11\"",134],[14,0.23,"3:32.58","15'30\"",147],[15,0.18,"0:25.86","2'20\"",151],[16,0.24,"3:50.50","16'09\"",131],[17,0.19,"0:25.50","2'17\"",122],[18,0.05,"2:22.06","45'47\"",128]]
const sec = (t: string) => { const [m, s] = t.split(":"); return Number(m) * 60 + Number(s) }
const work = new Set([1, 2, 3, 5, 7, 9, 11, 13, 15, 17])
const ATH = "eval-athlete-session-20261012", OCC = "real-hz-20261012", START = "2026-10-12T08:30:00.000Z", REC = "2026-10-12T09:35:00.000Z", ASOF = process.env.RECOVERY === "1" ? "2026-10-12T10:09:30.000Z" : process.env.FOLLOWUP === "1" ? "2026-10-12T10:09:00.000Z" : "2026-10-12T10:00:00.000Z"
let t = Date.parse(START)
const committed: any[] = [{ event: { event_id: OCC, athlete_id: ATH, timestamp: START, event_type: "TRAINING_STARTED", source: "DEVICE", payload: {} }, recordedAt: REC }]
const reps: any[] = [], recs: any[] = []
for (const [n, km, time] of laps) {
  t += sec(time) * 1000; const id = `lap:${OCC}:${n}`, ts = new Date(t).toISOString()
  committed.push({ event: { event_id: id, athlete_id: ATH, timestamp: ts, event_type: work.has(n) ? "RUNNING_REPETITION_COMPLETED" : "RUNNING_RECOVERY_RECORDED", source: "DEVICE", payload: { trainingOccurrenceId: OCC, actualDurationSeconds: sec(time), actualRecoverySeconds: sec(time), actualDistanceMeters: Math.round(km * 1000) } }, recordedAt: REC })
  const base = { trainingOccurrenceId: OCC, runningSnapshotId: "imported", componentId: "track", blockId: `lap${n}`, sourceEventIds: [id] }
  if (work.has(n)) reps.push({ ...base, stepId: `${Math.round(km * 1000)}m-hr=${laps[n - 1][4]}`, roundOrdinal: 1, repeatOrdinal: n, status: "COMPLETED", plannedDistanceMeters: null, plannedDurationSeconds: null, actualDistanceMeters: Math.round(km * 1000), actualDurationSeconds: sec(time), derivedPaceSecPerMeter: null, paceDistanceSourceEventId: id, paceDurationSourceEventId: id })
  else recs.push({ ...base, kind: "AFTER_REPEAT", stepId: `${Math.round(km * 1000)}m-hr=${laps[n - 1][4]}`, roundOrdinal: 1, afterRepeatOrdinal: n - 1, fromStepId: null, toStepId: null, afterRoundOrdinal: null, plannedRecoverySeconds: null, actualRecoverySeconds: sec(time), status: "RECORDED" })
}
const FOLLOW = process.env.FOLLOWUP === "1"
// Follow-up turn: the athlete's own reply (overall OK, RPE 7) committed as a manual SESSION_RPE bound to this session.
if (FOLLOW) committed.push({ event: { event_id: `ev:${OCC}:rpe`, athlete_id: ATH, timestamp: "2026-10-12T09:40:00.000Z", event_type: "RPE_RECORDED", source: "MANUAL", payload: { evidenceType: "SESSION_RPE", trainingOccurrenceId: OCC, value: 7 } }, recordedAt: "2026-10-12T10:08:00.000Z" })
if (RECOV) committed.push({ event: { event_id: `ev:${OCC}:sleep`, athlete_id: ATH, timestamp: "2026-10-12T09:41:00.000Z", event_type: "SLEEP_RECORDED", source: "MANUAL", payload: { trainingOccurrenceId: OCC, hours: 7 } }, recordedAt: "2026-10-12T10:08:30.000Z" })
const formal = buildFormalEvidenceRows({ athleteId: ATH, asOf: ASOF, committed, corrections: [], running: { [OCC]: { availability: "AVAILABLE", terminal: true, continuous: [], repetitions: reps, recoveries: recs } } })
const question = RECOV ? "恢复7，睡了7小时。请分析这次训练，并给出下一次训练的建议。" : process.env.FOLLOWUP === "1" ? "整体感觉还好，RPE 7。请分析这次训练，并给出下一次训练的建议。" : "这是我今天（2026-10-12 16:30 杭州运动场）的跑步记录，共18圈分段。请分析这次训练，并给出下一次训练的建议。"
const running = laps.map(([n, km, time, pace, hr]) => ({ kind: work.has(n) ? "REPETITION" : "RECOVERY", position: `第${n}段`, status: "COMPLETED", planned: "未设置", actual: `${km.toFixed(2)}公里 ${time}（手表配速${pace}/公里，平均心率${hr}，设备记录）`, id: `lap:${OCC}:${n}` })) as any
const data = normalizeAskCoachInput({ brief: deriveCoachBrief(buildParts(question, { occurrence: { id: OCC, startedAt: START, lifecycle: "COMPLETED" }, running, ...(FOLLOW ? { rpe: 7 } : {}), ...(RECOV ? { sleep: 7, recovery: 7 } : {}) })), history: FOLLOW ? [...(RECOV ? [] : []),{ role: "user" as const, text: "这是我今天（2026-10-12 16:30 杭州运动场）的跑步记录，共18圈分段。请分析这次训练，并给出下一次训练的建议。" }, { role: "coach" as const, text: "要建议下一课，需要先记录本次主观强度和恢复情况。你这次训练的 RPE 是多少，恢复感觉怎样？" }, ...(RECOV ? [{ role: "user" as const, text: "整体感觉还好，RPE 7。" }, { role: "coach" as const, text: "已记录本次 RPE 7。请告诉我你现在的主观恢复（1–10），或最近一晚睡了几小时？" }] : [])] : [], v4: { athleteId: ATH, asOf: ASOF, rows: formal.rows, unknownCommitTime: formal.unknownCommitTime.length } })
const request = buildCoachModelRequest(data)
const model = process.env.FANGKUN_EVAL_MODEL!, payload = { model, temperature: 0.2, max_tokens: request.maxTokens + 1200, response_format: request.responseFormat, messages: request.messages }
const attempts: any[] = []; let final: any = null
for (let a = 1; a <= 2 && !final; a++) {
  if (process.env.DRY === "1") break
  const res = await withEvalCall(process.env, process.env.FANGKUN_EVAL_LEDGER!, { batch: "SESSION-20261012", caseId: "session", model, attempt: a }, () => callOpenAICompatible(process.env.FANGKUN_EVAL_BASE_URL!, process.env.FANGKUN_EVAL_KEY_ENV!, payload))
  if (!res.ok) { attempts.push({ blocked: res.reason }); break }
  attempts.push({ attempt: a, status: res.value.status, error: res.value.error, errorBody: res.value.ok ? null : res.value.bodyText.slice(0, 800) })
  if (res.value.ok) final = res.value; else await new Promise((r) => setTimeout(r, 15000))
}
let content: string | null = null, returned: string | null = null, usage = null
if (final) { const b = JSON.parse(final.bodyText); content = b.choices?.[0]?.message?.content ?? null; returned = b.model ?? null; usage = b.usage ?? null }
const g = content != null ? interpretCoachModelOutput(data, content) : null
const rec = { entry: "EXTERNAL_MODEL_WITH_FANGKUN_CONTEXT", path: "R2 wired candidate: buildFormalEvidenceRows -> normalizeAskCoachInput(v4) -> buildCoachModelRequest -> eval adapter -> interpretCoachModelOutput (production guard + V4 guard)", laps, formal_rows: formal, v4_snapshot: { active: data.v4!.review.audit.snapshot.active.length, excluded: data.v4!.review.audit.snapshot.excluded, quarantined: data.v4!.review.audit.snapshot.quarantined, missing: data.v4!.review.audit.snapshot.missing, safety: data.v4!.review.audit.snapshot.safety, omittedFacts: data.v4!.omittedFacts }, payload, model_requested: model, model_returned: returned, attempts, usage, raw_response: content, visible: g?.turn ?? null, gates: g ? { code: g.code, subcode: g.subcode, v4: g.v4, scaffold: g.scaffold } : null, computed: JSON.parse(request.packet).personalEvidenceV4?.computed ?? null, synthetic_recovery_answer: RECOV }
writeFileSync(`${OUT}/session-record${TAG}.json`, JSON.stringify(rec, null, 1))
console.log(JSON.stringify({ attempts, returned, gates: rec.gates, visible: rec.visible, v4: rec.v4_snapshot }, null, 1)); console.log("RAW", content)
