import { chromium } from "playwright"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { confirmTrainingImport, createTrainingImportDraft } from "./src/lib/core/training-import.ts"
import { setStoreBackend } from "./src/lib/core/storage.ts"

const LOG = "/tmp/app-startup.log"
const report = { extract: null, reviews: [] }
const save = () => writeFileSync("/workspace/artifacts/b20-live.json", JSON.stringify(report, null, 2))
const logSize = () => { try { return statSync(LOG).size } catch { return 0 } }
function eventsSince(offset) {
  let text = ""
  try { text = readFileSync(LOG).subarray(offset).toString("utf8") } catch { return [] }
  const found = []
  for (const line of text.split("\n")) {
    for (const tag of ["[training-model]", "[training-review-guard]"]) {
      const at = line.indexOf(tag)
      if (at < 0) continue
      try {
        const event = JSON.parse(line.slice(at + tag.length).trim())
        if (tag === "[training-review-guard]" || event.stage === "complete" || event.stage === "failed") {
          const { kind, stage, elapsedMs, bytes, contentChars, reasoningChars, sawDone, finishReason, failureClass, promptTokens, completionTokens, reasoningTokens, deltaKeys, packetChars, maxTokens, guardCode } = event
          found.push({ tag, kind, stage, elapsedMs, bytes, contentChars, reasoningChars, sawDone, finishReason, failureClass, promptTokens, completionTokens, reasoningTokens, deltaKeys, packetChars, maxTokens, guardCode })
        }
      } catch { /* ignore partial lines */ }
    }
  }
  return found
}

const recorded = (value) => ({ value, status: "RECORDED", sourceIds: ["text"] })
const absent = { value: null, status: "ABSENT", sourceIds: [] }
const mem = new Map()
setStoreBackend({ getItem: (key) => mem.get(key) ?? null, setItem: (key, value) => void mem.set(key, value) })
const seeded = confirmTrainingImport(createTrainingImportDraft({
  sport: "RUNNING",
  occurredAt: recorded("2026-10-08T18:10:00+08:00"),
  title: recorded("酸痛膝痛核对课"),
  durationSeconds: recorded(900),
  totalDistanceMeters: recorded(200),
  runningStructure: "REPEATED",
  runningSegments: [{ id: "r1", kind: "REPETITION", round: recorded(1), repeat: recorded(1), distanceMeters: recorded(200), durationSeconds: recorded(36), recoverySeconds: absent, completion: "COMPLETED", sourceIds: ["text"] }],
  strengthSets: [],
  sessionRpe: recorded(9),
  subjectiveRecovery: absent,
  sleepHours: absent,
  pain: recorded({ location: "左膝", intensity: 6 }),
  soreness: recorded({ location: "大腿", intensity: 4 }),
  uncertainFields: [], conflicts: [], warnings: [],
}, "TEXT", ["text"]))
if (!seeded.ok) throw new Error(seeded.reason)
const envelope = mem.get("fr255-confirmed-training-imports-v1")

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell", headless: true, args: ["--no-sandbox"] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" })
page.setDefaultTimeout(20000)
async function boot() {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 })
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((node) => (node.innerText || "").includes("上传一次训练")), null, { timeout: 15000 })
  await page.waitForTimeout(800)
}
async function clickIncludes(label) {
  return page.evaluate((wanted) => {
    const el = [...document.querySelectorAll("button,summary")].find((node) => (node.innerText || "").includes(wanted))
    if (!el) return false
    el.click()
    return true
  }, label)
}
async function openImport() {
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(() => document.body.innerText.includes("训练上传与复盘"))) return true
    await clickIncludes("上传一次训练")
    await page.waitForTimeout(600)
  }
  return page.evaluate(() => document.body.innerText.includes("训练上传与复盘"))
}
function sheet() { return page.evaluate(() => document.querySelector("div.fixed.inset-0.z-50")?.innerText || "") }

try {
  await boot()
  if (!(await openImport())) report.extract = { error: "no-sheet" }
  else {
    await page.locator("textarea").fill("2026-10-08T18:10:00+08:00 200米×4×2＋300米。第一轮34、35、36、37秒。第二轮35、36、37、38秒。最后300米48秒。全部完成。恢复段40秒。")
    const off = logSize()
    await clickIncludes("生成可校对草稿")
    const outcome = await page.waitForFunction(() => {
      const text = document.querySelector("div.fixed.inset-0.z-50")?.innerText || ""
      return text.includes("这不是已完成记录") || text.includes("没有拿到可核对") || text.includes("提取请求失败") ? text.slice(0, 20) : ""
    }, null, { timeout: 70000 }).catch(() => null)
    const text = await sheet()
    const rows = await page.locator('input[aria-label="用时秒"]').evaluateAll((nodes) => nodes.map((node) => node.value)).catch(() => [])
    const distances = await page.locator('input[aria-label="距离米"]').evaluateAll((nodes) => nodes.map((node) => node.value)).catch(() => [])
    report.extract = {
      opened: Boolean(outcome),
      segments: rows.length,
      filledTimes: rows.filter(Boolean).length,
      distances: distances.filter(Boolean),
      times: rows.filter(Boolean),
      banner: text.includes("可能未完整提取"),
      unknown: text.includes("总数未知") || text.includes("不能声称全部提取完成"),
      gap9: /原文约\s*9/.test(text),
      events: eventsSince(off),
    }
  }
  save()

  await page.evaluate((raw) => localStorage.setItem("fr255-confirmed-training-imports-v1", raw), envelope)
  await boot()
  if (!(await openImport())) report.reviews.push({ error: "no-sheet" })
  else {
    await clickIncludes("回看已确认训练")
    await page.waitForTimeout(300)
    const opened = await clickIncludes("酸痛膝痛核对课")
    await page.waitForTimeout(400)
    const before = await page.evaluate(() => localStorage.getItem("fr255-confirmed-training-imports-v1"))
    for (let i = 1; i <= 3; i++) {
      const off = logSize()
      const clicked = await clickIncludes("请求或重试训练当时的模型复盘")
      const done = await page.waitForFunction(() => {
        const text = document.querySelector("div.fixed.inset-0.z-50")?.innerText || ""
        return text.includes("记录事实") || text.includes("模型复盘暂不可用") || text.includes("模型复盘请求失败") ? "yes" : ""
      }, null, { timeout: 70000 }).catch(() => null)
      const text = await sheet()
      const after = await page.evaluate(() => localStorage.getItem("fr255-confirmed-training-imports-v1"))
      report.reviews.push({
        i, opened, clicked, finished: Boolean(done),
        adopted: text.includes("记录事实"),
        asksRecovery: /恢复/.test(text),
        mentionsPain: text.includes("疼痛"),
        mentionsSoreness: text.includes("酸痛"),
        hiddenPrescription: /减量|下一课保持|恢复训练/.test(text),
        storageUnchanged: before === after,
        events: eventsSince(off),
      })
      save()
      if (text.includes("记录事实")) break
    }
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : "failed"
} finally {
  save()
  await browser.close()
}
