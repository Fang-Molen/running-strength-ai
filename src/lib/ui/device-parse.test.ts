import test from "node:test"
import assert from "node:assert/strict"
import { deflateRawSync } from "node:zlib"
import { parseFit, parseGpx, parseTcx, parseCsv, parseSummaryText, parseDeviceFile, parseGarminJson, detectKind, paceText } from "./device-parse.ts"

// Minimal FIT encoder: file_id(0) + session(18) + 2 strength sets(225)
function fit(): Uint8Array {
  const body: number[] = []
  const u16 = (v: number) => [v & 255, v >> 8]
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]
  const def = (local: number, gnum: number, fields: [number, number, number][]) => body.push(0x40 | local, 0, 0, ...u16(gnum), fields.length, ...fields.flat())
  def(0, 0, [[1, 2, 0x84], [2, 2, 0x84]]); body.push(0, ...u16(1), ...u16(3990))
  const start = Math.round(Date.UTC(2026, 9, 12, 22, 0) / 1000) - 631065600
  def(1, 18, [[2, 4, 0x86], [5, 1, 0], [8, 4, 0x86], [9, 4, 0x86], [16, 1, 2], [17, 1, 2], [18, 1, 2], [89, 2, 0x84], [91, 2, 0x84]])
  body.push(1, ...u32(start), 1, ...u32(3000_000), ...u32(1_000_000), 150, 172, 88, ...u16(85), ...u16(2450))
  const hdr = [14, 0x20, ...u16(2100), ...u32(body.length), 0x2e, 0x46, 0x49, 0x54, 0, 0]
  return new Uint8Array([...hdr, ...body, 0, 0])
}

test("FIT session with running dynamics (Garmin)", () => {
  const r = parseFit(fit())
  assert.equal(r.brand, "Garmin")
  assert.equal(r.activities.length, 1)
  const a = r.activities[0]
  assert.equal(a.sport, "RUNNING"); assert.equal(a.distanceM, 10000); assert.equal(a.durationSec, 3000)
  assert.equal(a.avgHr, 150); assert.equal(a.avgCadence, 176); assert.equal(a.verticalOscMm, 8.5); assert.equal(a.groundContactMs, 245)
  assert.equal(a.startIso, "2026-10-12T22:00:00.000Z")
  assert.equal(paceText(a), `5'00"/km`)
  assert.equal(detectKind("x.fit", fit()), "fit")
})

test("GPX distance and HR", () => {
  const gpx = `<gpx creator="Garmin Connect"><trk><type>running</type><trkseg>
  <trkpt lat="30.0" lon="120.0"><time>2026-10-10T00:00:00Z</time><extensions><gpxtpx:hr>140</gpxtpx:hr></extensions></trkpt>
  <trkpt lat="30.009" lon="120.0"><time>2026-10-10T00:05:00Z</time><extensions><gpxtpx:hr>150</gpxtpx:hr></extensions></trkpt></trkseg></trk></gpx>`
  const a = parseGpx(gpx).activities[0]
  assert.ok(Math.abs(a.distanceM! - 1000) < 5); assert.equal(a.durationSec, 300); assert.equal(a.avgHr, 145)
})

test("TCX laps", () => {
  const t = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-10-10T00:00:00Z</Id><Lap><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters><AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm></Lap></Activity></Activities></TrainingCenterDatabase>`
  const a = parseTcx(t).activities[0]
  assert.equal(a.distanceM, 2000); assert.equal(a.avgHr, 150)
})

test("Garmin Connect activities CSV (中文) and wellness CSV", () => {
  const csv = "活动类型,日期,标题,距离,卡路里,时间,平均心率,最大心率\n跑步,2026-10-11 07:10:00,杭州 跑步,10.02,650,00:52:13,152,170\n"
  const r = parseCsv(csv)
  assert.equal(r.brand, "Garmin"); assert.equal(r.activities[0].distanceM, 10020); assert.equal(r.activities[0].durationSec, 3133)
  const w = parseCsv("日期,静息心率,睡眠时长,身体电量\n2026-10-11,52,7h 30m,85\n")
  assert.deepEqual(w.health.map((h) => [h.metric, h.value]).sort(), [["BODY_BATTERY", 85], ["RHR", 52], ["SLEEP", 7.5]])
})

test("Garmin export JSON (sleep + UDS)", () => {
  const s = parseGarminJson("DI_CONNECT/DI-Connect-Wellness/x_sleepData.json", JSON.stringify([{ calendarDate: "2026-10-11", deepSleepSeconds: 5400, lightSleepSeconds: 14400, remSleepSeconds: 5400 }]))
  assert.equal(s.health[0].value, 7)
  const u = parseGarminJson("UDSFile_1.json", JSON.stringify([{ calendarDate: "2026-10-11", restingHeartRate: 50, bodyBattery: { bodyBatteryStatList: [{ bodyBatteryStatType: "HIGHEST", statsValue: 90 }] } }]))
  assert.equal(u.health.length, 2)
})

test("ZIP with nested FIT + JSON, dedupes", async () => {
  const f = fit()
  const entries = [["DI_CONNECT/a.fit", f], ["DI_CONNECT/b.fit", f], ["DI_CONNECT/DI-Connect-Wellness/x_sleepData.json", Buffer.from(JSON.stringify([{ calendarDate: "2026-10-11", deepSleepSeconds: 3600, lightSleepSeconds: 18000 }]))]] as const
  const parts: Buffer[] = []; const central: Buffer[] = []; let off = 0
  for (const [name, data] of entries) {
    const comp = deflateRawSync(data); const n = Buffer.from(name)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    parts.push(lh, n, comp); central.push(ch, n); off += 30 + n.length + comp.length
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  const zip = new Uint8Array(Buffer.concat([...parts, cd, e]))
  const r = await parseDeviceFile("export.zip", zip, "2026-10-13")
  assert.equal(r.activities.length, 1)
  assert.equal(r.health.find((h) => h.metric === "SLEEP")?.value, 6)
})

test("OCR text from Garmin Connect summary", () => {
  const txt = "我的一天\n身体电量 78\n睡眠 7小时 32分\n静息心率 51 bpm\nHRV 状态 平衡 夜间平均 46 毫秒\n训练准备度 72 中等\n"
  const r = parseSummaryText(txt, "2026-10-13")
  const m = Object.fromEntries(r.health.map((h) => [h.metric, h.value]))
  assert.deepEqual(m, { RHR: 51, HRV: 46, SLEEP: 7.5, BODY_BATTERY: 78, READINESS: 72 })
  const run = parseSummaryText("跑步\n距离 10.02 公里\n时间 52:13\n平均心率 152", "2026-10-13")
  assert.equal(run.activity?.distanceM, 10020); assert.equal(run.activity?.durationSec, 3133)
})
