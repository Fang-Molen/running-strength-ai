/** R2 step 6 headless flow: 目标→追问→候选→确认→记录→结束→刷新→反馈影响下次分析. Synthetic data, local dev server, desktop Chromium only. */
import { writeFileSync } from "node:fs"
import { setup, goal, steps, panelOf } from "./browser-prefix.mjs"
import { fillByLabel } from "../r2/browser/lib.mjs"
const OUT = process.env.FLOW_OUT ?? "/workspace/screenshots/fangkun-r8-flow"
const log = []; const step = (name, ok, detail) => { log.push({ step: name, ok, detail, at: new Date().toISOString() }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail).slice(0, 300)) }
const { b, ctx, p } = await setup()
const reqs = []; p.on("request", (r) => { if (r.method() === "POST") reqs.push({ url: r.url(), body: r.postData() }) })
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false })
const panel = panelOf(p)
const next = async () => { await panel.getByRole("button", { name: "确认本步并继续" }).click(); await p.waitForTimeout(900) }
try {
  await p.clock.install({ time: new Date("2026-10-13T07:30:00+08:00") }); await p.clock.resume()
  await p.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1500)
  // 1 目标
  await goal(p); const chat1 = await p.locator("body").innerText(); await shot("01-goal")
  step("1-目标", /400米本地认知分析/.test(chat1) && /目标不当作完成事实/.test(chat1), { localAnswer: chat1.match(/400米本地认知分析[^\n]*/)?.[0] })
  // 2 追问 (step-wise intake questions)
  const ask = (await panel.innerText()).match(/先确认当前基础[^\n]*/)?.[0]; await shot("02-followup")
  step("2-追问", Boolean(ask), { question: ask })
  await steps(p)
  await fillByLabel(panel, { "目标或比赛日期": "2026-12-07" }); await next()
  await fillByLabel(panel, { "首周开始日期": "2026-10-13", "每次可用分钟": "60" }); for (const d of ["周二", "周四", "周六"]) await panel.getByLabel(d).check(); await next()
  await fillByLabel(panel, { "当前疼痛": "本人报告当前无疼痛", "运动限制": "本人报告无已知运动限制", "最近睡眠小时": "7.5", "当前主观恢复": "7" }); await next()
  // 3 候选
  const cand = await panel.innerText(); await shot("03-candidate")
  step("3-候选", /首周候选已生成，尚未替换正式课表/.test(cand), { header: cand.match(/400米首周候选[^\n]*/)?.[0], line: cand.match(/400米 × [^\n]*/)?.[0] })
  // 4 确认 (status text must come from the business write result)
  await panel.getByRole("button", { name: "接受首周候选" }).click(); await p.waitForTimeout(1200)
  const conf = await panel.innerText(); const journal = await p.evaluate(() => Object.keys(localStorage).filter((k) => /intake|first|week|decision/i.test(k)).length); await shot("04-confirm")
  step("4-确认", /已记录接受首周候选/.test(conf), { notice: conf.match(/已记录接受首周候选[^\n]*/)?.[0], relatedStorageKeys: journal })
  // 5 记录
  await panel.getByRole("button", { name: /开始\/查看这天训练/ }).first().click(); await p.waitForTimeout(1500)
  const values = { 热身: "720", warmup: "720", "第 1 次": "92", "第 2 次": "93", "第 3 次": "91", 组间休息: "125", cooldown: "300", 放松: "300" }
  let recorded = 0
  await p.getByLabel("实际秒数").first().fill("720"); await p.getByRole("button", { name: "记录这段实际" }).first().click(); await p.waitForTimeout(700); recorded++
  for (const sec of ["92", "93", "91"]) {
    const rest = p.getByRole("button", { name: "记下这次休息" })
    if (await rest.count()) { await p.getByLabel("实际休息秒").fill("125"); await rest.first().click(); await p.waitForTimeout(600); recorded++ }
    await p.getByLabel("实际秒数").first().fill(sec); await p.getByLabel("实际距离（米）").first().fill("400"); await p.getByRole("button", { name: "记下这段" }).first().click(); await p.waitForTimeout(700); recorded++
  }
  const cool = p.getByRole("button", { name: "记录这段实际" })
  if (await cool.count()) { await p.getByLabel("实际秒数").first().fill("300"); await cool.first().click(); await p.waitForTimeout(700); recorded++ }
  const prog = (await p.locator("body").innerText()).match(/本次训练进度[^\n]*/)?.[0]; await shot("05-record")
  step("5-记录", recorded >= 5, { recorded, progress: prog })
  // 6 结束 with feedback
  await fillByLabel(p.locator("body"), { "整课RPE": "8", "疼痛（0–10": "3" })
  await p.getByRole("button", { name: "确认完成并保存" }).click(); await p.waitForTimeout(1500)
  const end = await p.locator("body").innerText(); await shot("06-end")
  const done = await p.evaluate(async () => { const ev = await import("/src/lib/core/events.ts"); return ev.loadEvents().filter((e) => e.event_type === "TRAINING_COMPLETED").length })
  step("6-结束", done === 1, { trainingCompletedEvents: done, snippet: end.match(/[^\n]*(已保存|已结束|已完成)[^\n]*/)?.[0] })
  // 7 刷新
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(1500)
  const stamps = await p.evaluate(() => { const ks = Object.keys(localStorage).filter((k) => k.startsWith("fr255-event-journal-v2:") || k.startsWith("fr255-running-transaction")); return { total: ks.length, withRecordedAt: ks.filter((k) => { try { return typeof JSON.parse(localStorage.getItem(k)).recordedAt === "string" } catch { return false } }).length } })
  const rows = await p.evaluate(async () => { const ev = await import("/src/lib/core/events.ts"); const m = await import("/src/lib/core/coach-v4-formal-rows-store.ts"); const r = m.readFormalEvidenceRows(ev.currentAthleteId()); return { athlete: ev.currentAthleteId(), rows: r.rows.map((x) => ({ id: x.recordId, metric: x.metric, status: x.status, value: x.value, unit: x.unit, source: x.source, knownAt: x.knownAt })), unknownCommitTime: r.unknownCommitTime.length, excluded: r.excluded, corrections: r.corrections } })
  const dbg = await p.evaluate(async () => { const ev = await import("/src/lib/core/events.ts"); const re = await import("/src/lib/core/running-execution.ts"); const all = ev.loadCommittedEventRecords(); const st = all.filter((r) => r.event.event_type === "TRAINING_STARTED"); return { types: all.map((r) => r.event.event_type + ":" + r.event.athlete_id + ":" + (r.recordedAt ? "rec" : "null")), proj: st.map((s) => { const x = re.projectRunningExecution(s.event.event_id, all.map((r) => r.event)); return { a: x.availability, reps: x.repetitions.map((r) => r.status + ":" + r.actualDurationSeconds + ":" + r.sourceEventIds.length), rec: x.recoveries.map((r) => r.status) } }) } })
  writeFileSync(`${OUT}/debug-projection.json`, JSON.stringify(dbg, null, 1))
  await shot("07-refresh")
  step("7-刷新", stamps.total > 0 && stamps.withRecordedAt === stamps.total && rows.rows.length > 0, { stamps, rowCount: rows.rows.length, metrics: [...new Set(rows.rows.map((r) => r.metric))], unknownCommitTime: rows.unknownCommitTime })
  writeFileSync(`${OUT}/formal-rows-from-ui.json`, JSON.stringify(rows, null, 1))
  await p.waitForFunction(()=>!document.body.innerText.includes("读取中"),null,{timeout:60000})
  // 8 反馈影响下次分析 (local path) + V4 rows attached to the online request (server gate expected LOCKED)
  await p.getByRole("button", { name: "方坤" }).click(); await p.waitForTimeout(800)
  await p.getByPlaceholder("输入你的问题").fill("刚才这次400米训练怎么样？下次可以加组吗？"); await p.getByRole("button", { name: "发送" }).click(); await p.waitForTimeout(2500)
  const after = await p.locator("body").innerText(); await shot("08-next-analysis")
  const tailText = after.split("刚才这次400米训练怎么样？下次可以加组吗？").at(-1) ?? ""; const localHit = /(?:疼痛|健康风险)/.test(tailText) && /(?:运动医学|康复|评估)/.test(tailText)
  let online = null
  const tryOnline = p.getByRole("button", { name: "确认尝试线上回答" })
  if (await tryOnline.count()) { await tryOnline.last().click(); await p.waitForTimeout(7000); const t = await p.locator("body").innerText(); online = { lockedNotice: /没有调用模型：服务端安全开关未打开/.test(t), requests: reqs.length, v4InRequest: reqs.some((r) => (r.body ?? "").includes("v4") && (r.body ?? "").includes("SESSION_RPE")) }; await shot("09-online-locked") }
  step("8-反馈影响下次分析", localHit, { answerEvidence: tailText.match(/[^\n]*RPE 8[^\n]*/)?.[0], answerSafety: tailText.match(/[^\n]*不建议在此基础上自动加量[^\n]*/)?.[0], online })
} catch (e) { step("ERROR", false, String(e).slice(0, 500)); await shot("99-error").catch(() => {}) }
finally { writeFileSync(`${OUT}/flow-log.json`, JSON.stringify({ entry: "browser local dev server, headless chromium desktop 1280x1000; mobile/PWA NOT TESTED; model calls: none (server gate CALLS_DISABLED)", steps: log, serverFnRequests: reqs.map((r) => ({ url: r.url, bytes: (r.body ?? "").length, hasV4: (r.body ?? "").includes("v4") })) }, null, 1)); await b.close() }

if (log.some(s => !s.ok)) process.exitCode = 1
