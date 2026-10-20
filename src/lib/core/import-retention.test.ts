import assert from "node:assert/strict"
import test from "node:test"
import { retainNewest, appendRetained, MAX_CONFIRMED_IMPORTS } from "./import-retention.ts"
import { loadConfirmedTrainingImports, CONFIRMED_TRAINING_IMPORTS_KEY } from "./training-import.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { saveDeviceRows } from "../ui/device-store.ts"
import { listBoundTrainings } from "./coach-compare.ts"
import type { DeviceActivity } from "../ui/device-parse.ts"

function memory(): MemoryStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, keys: () => [...data.keys()], getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}
const rec = (id: string, iso: string) => ({ draftId: id, occurredAt: { value: iso } })

test("retainNewest：未超限原样；超限去掉发生时间最早的，不看写入顺序", () => {
  const rows = [rec("new", "2026-10-19T08:00:00Z"), rec("old", "2026-01-01T08:00:00Z"), rec("mid", "2026-06-01T08:00:00Z")]
  assert.deepEqual(retainNewest(rows, 3).map(r => r.draftId), ["new", "old", "mid"])
  assert.deepEqual(retainNewest(rows, 2).map(r => r.draftId), ["new", "mid"])
  assert.equal(appendRetained(rows.slice(0, 2), rec("older", "2025-01-01T00:00:00Z"), 2), null)
  assert.deepEqual(appendRetained(rows.slice(0, 2), rec("x", "2026-10-20T00:00:00Z"), 2)!.map(r => r.draftId), ["new", "x"])
})

// 佳明活动列表“新的在前”：一次同步 200 条，复盘选课里必须有最近的课，而不是只剩最旧的一批（v86.1 前的 6 月问题）。
function garminRuns(n: number): DeviceActivity[] {
  const base = Date.parse("2026-10-19T08:00:00Z")
  return Array.from({ length: n }, (_, i) => {
    const startIso = new Date(base - i * 864e5).toISOString()
    const id = `garmin:cn%3Ame:${1000 + n - i}`
    return { key: id, sourceIdentity: id, source: "佳明账号同步", sport: "RUNNING", sportLabel: "跑步", startIso, durationSec: 1800, distanceM: 5000,
      avgHr: 150, maxHr: 170, calories: 300, avgCadence: 180, avgPower: null, verticalOscMm: 80, groundContactMs: 240, sets: [] } as DeviceActivity
  })
}

test("佳明 200 条（新的在前）同步两次：最近的课在复盘选课里、每条只存一次、第二次不重写", () => {
  const store = memory(); setStoreBackend(store)
  try {
    const acts = garminRuns(200)
    const first = saveDeviceRows([], acts)
    assert.equal(first.saved, 200); assert.deepEqual(first.errors, [])
    const saved = loadConfirmedTrainingImports()
    assert.equal(saved.length, 200)
    assert.equal(new Set(saved.map(r => r.draftId)).size, 200)
    const before = store.data.get(CONFIRMED_TRAINING_IMPORTS_KEY)
    const second = saveDeviceRows([], acts)
    assert.equal(second.saved, 0); assert.equal(second.skipped, 200)
    assert.equal(store.data.get(CONFIRMED_TRAINING_IMPORTS_KEY), before, "第二次同步不应改写（旧版会整批挤掉再重写）")
    const picker = listBoundTrainings()
    assert.equal(picker[0].startedAt.slice(0, 10), "2026-10-19")
    assert.equal(picker.length, 200)
    // 体积：400 条上限的估算（本机存储约 5MB）
    const perRecord = before!.length / 200
    assert.ok(perRecord * MAX_CONFIRMED_IMPORTS < 1_600_000, `每条约 ${Math.round(perRecord)} 字符`)
  } finally { setStoreBackend(null) }
})

test("旧版只剩最旧 100 条的存储：升级后再同步，补回最近的课，原有记录（含确认时间）不变、不重复", () => {
  const store = memory(); setStoreBackend(store)
  try {
    const acts = garminRuns(200)
    saveDeviceRows([], acts.slice(100)) // 模拟旧版留下的“最旧 100 条”
    const old = loadConfirmedTrainingImports()
    saveDeviceRows([], acts)
    const all = loadConfirmedTrainingImports()
    assert.equal(all.length, 200)
    assert.equal(new Set(all.map(r => r.draftId)).size, 200)
    for (const o of old) assert.equal(all.find(r => r.draftId === o.draftId)!.confirmedAt, o.confirmedAt)
    assert.equal(listBoundTrainings()[0].startedAt.slice(0, 10), "2026-10-19")
  } finally { setStoreBackend(null) }
})
