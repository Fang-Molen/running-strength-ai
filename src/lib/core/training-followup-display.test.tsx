import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TrainingFollowupPanel } from "../../components/training-followup-panel.tsx"
import { confirmTrainingImport, createTrainingImportDraft } from "./training-import.ts"
import { setStoreBackend } from "./storage.ts"
import { saveImportedFollowup } from "./training-followup.ts"

const recorded = <T,>(value: T) => ({ value, status: "RECORDED" as const, sourceIds: ["text"] })
const absent = { value: null, status: "ABSENT" as const, sourceIds: [] as string[] }
function fixture() {
  const data = new Map<string, string>(), writes: string[] = []
  setStoreBackend({ keys:()=>[...data.keys()], getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); writes.push(key) } })
  const result = confirmTrainingImport(createTrainingImportDraft({
    sport: "RUNNING", occurredAt: recorded("2026-10-01T08:00:00+08:00"), title: recorded("已确认连续跑"),
    durationSeconds: recorded(1500), totalDistanceMeters: recorded(5000), runningStructure: "CONTINUOUS", runningSegments: [], strengthSets: [],
    sessionRpe: recorded(5), subjectiveRecovery: absent, sleepHours: absent, pain: absent, soreness: absent, uncertainFields: [], conflicts: [], warnings: [],
  }, "TEXT", ["text"]))
  if (!result.ok) throw new Error(result.reason)
  writes.length = 0
  return { record: result.record, writes }
}

test("recovery panel visibly distinguishes unknown and transparent rules without writing on render", () => {
  const { record, writes } = fixture()
  const html = renderToStaticMarkup(<TrainingFollowupPanel record={record} />)
  assert.match(html, /24–48h、48–72h/)
  assert.match(html, /不推断结束时间/)
  assert.match(html, /未记录 \/ 不确定/)
  assert.match(html, /暂未送入模型复盘/)
  assert.match(html, /自报没有疼痛不等于医学确认/)
  assert.match(html, /这份训练尚无后续反馈/)
  assert.deepEqual(writes, [])
})

test("saved follow-up renders its concrete source and separate soreness boundary, even when model is busy", () => {
  const { record, writes } = fixture()
  saveImportedFollowup({ requestId: "display-source", confirmedImportId: record.confirmedImportId, observedAt: "2026-10-02T08:00:00+08:00", recoveryScore: 4, sleepHours: 7,
    pain: { state: "UNKNOWN", location: null, intensity: null }, soreness: { state: "PRESENT", location: "大腿", intensity: 5 },
  }, "2026-10-02T08:00:00+08:00")
  writes.length = 0
  const html = renderToStaticMarkup(<TrainingFollowupPanel record={record} disabled />)
  assert.match(html, /followup:display-source/)
  assert.match(html, /大腿酸痛 5\/10/)
  assert.match(html, /主观恢复 4\/10/)
  assert.match(html, /酸痛不等于疼痛或伤病/)
  assert.match(html, /疼痛未记录/)
  assert.match(html, /disabled/)
  assert.deepEqual(writes, [])
})
