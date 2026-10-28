// usage: node e2e.mjs <baseUrl> <label> <scenario: user|full>
// 构造 localStorage 已满的浏览器：user = 与用户相同（约 2.7M：日程 ~1.3M + 日内 528K/475K + 导入 346K，pending 三倍放大）；full = 约 4.99M（逼出 E-QUOTA，要靠迁移腾空间）
import { chromium } from "playwright";
const [base, label, scenario = "user"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript((scenario) => {
  if (localStorage.getItem("e2e-seeded") || !sessionStorage.getItem("do-seed")) return;
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const day = (n, id) => ({ schemaVersion: 1, day: id, fetchedAt: id + "T23:59:00.000Z", sourceId: "s1", offsetMin: 480, eventTimingVersion: 2, hr: Array.from({ length: n }, (_, i) => [i * 5, 60 + (i % 40)]), bb: [[0, 50]] });
  const intraday = JSON.stringify({ schemaVersion: 1, days: { "2026-10-20": day(scenario === "full" ? 120000 : 20000, "2026-10-20") } });
  const archive = JSON.stringify({ schemaVersion: 1, entries: { a: day(scenario === "full" ? 110000 : 18000, "2026-10-19") } });
  const imports = JSON.stringify({ schemaVersion: 1, revision: 1, updatedAt: "2026-10-20T00:00:00Z", data: [] });
  const old = (i) => ({ id: `old${i}`, date: "2026-09-01", title: "x".repeat(780), kind: "strength", modality: "strength", trainingType: "strength", focus: [], minutes: 40, intensity: "MODERATE", lowerHeavy: false, source: "custom", refId: `old${i}`, status: "done", athleteId: "local" });
  const sched = JSON.stringify({ entries: Array.from({ length: scenario === "full" ? 400 : 1900 }, (_, i) => old(i)), acks: [] });
  const set = (k, v) => localStorage.setItem(k, v);
  set("fk-schedule-v1", sched); set("fk-garmin-intraday-v1:local", intraday); set("fk-garmin-intraday-v1:local:source-archive", archive); set("fr255-confirmed-training-imports-v1", imports);
  const used = () => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + localStorage.getItem(k).length } return n };
  if (scenario === "full") { const room = 5_240_000 - used() - 12; set("fk-filler", "f".repeat(Math.max(0, room))) }
  const ex = (i) => ({ id: `ex${i}`, catalogId: "", name: ["坐姿哑铃推举", "杠铃深蹲", "引体向上", "平板支撑", "罗马尼亚硬拉"][i], sets: "3", reps: "10", weight: "", restSec: 75, rpe: "", unit: "reps" });
  set(`fk-training-draft-v71:${today}:new`, JSON.stringify({ id: "custom:e2e-draft", date: today, type: "strength", name: "e2e 力量", minutes: "40", intensity: "MODERATE", slot: "pm", exercises: [0, 1, 2, 3, 4].map(ex), betweenRest: null, runMode: "continuous", distance: "", target: "", repeats: "", rounds: "", repeatRest: "", roundRest: "" }));
  set("e2e-seeded", "1");
}, scenario);
const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
const R = []; const rec = (ok, m) => { R.push(`${ok ? "PASS" : "FAIL"} ${m}`); console.log(R.at(-1)); };
await p.goto(base, { waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(2500);
for (let i = 0; i < 8; i++) { const k = p.getByText("跳过，用默认"); if (!(await k.count())) break; await k.click().catch(() => {}); await p.waitForTimeout(400); }
for (let i = 0; i < 6; i++) { const k = p.getByRole("button", { name: /^接受$|暂不需要|知道了|跳过，从头开始/ }).first(); if (!(await k.count())) break; await k.click().catch(() => {}); await p.waitForTimeout(400); }
await p.locator("[data-ready=true]").first().waitFor({ timeout: 60000 }).catch(() => {});
await p.evaluate(() => sessionStorage.setItem("do-seed", "1")); await p.reload({ waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(4000);
await p.locator("[data-ready=true]").first().waitFor({ timeout: 90000 }).catch(() => {});
const lsInfo = () => p.evaluate(() => { let n = 0; const keys = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const c = k.length + localStorage.getItem(k).length; n += c; keys[k] = c } return { total: n, garmin: Object.keys(keys).filter(k => k.startsWith("fk-garmin-intraday") || k.startsWith("fr255-confirmed")), top: Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 4) } });
const before = await lsInfo(); console.log("INFO localStorage at start", JSON.stringify(before));
const open = async () => { await p.getByRole("button", { name: "添加训练", exact: true }).first().click({ timeout: 15000 }); return p.getByRole("dialog", { name: "添加训练", exact: true }); };
let dlg = await open(); await p.waitForTimeout(800);
rec((await dlg.getByText(/5个动作/).count()) > 0, "editor shows the 5-exercise strength draft");
await dlg.getByRole("button", { name: /^加入/ }).click(); await p.waitForTimeout(3500);
const stillOpen = await p.getByRole("dialog", { name: "添加训练", exact: true }).count();
const notice = stillOpen ? await p.getByRole("alert").first().innerText().catch(() => "") : "";
const saved = await p.evaluate(async () => { const s = JSON.parse(localStorage.getItem("fk-schedule-v1") || "{}"); return (s.entries || []).some(e => e.id === "custom:e2e-draft") });
rec(!stillOpen && saved, `save 5-exercise strength: ${stillOpen ? "FAILED notice=" + notice.slice(0, 220) : "saved"}`);
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
const after = await lsInfo(); console.log("INFO localStorage after reload", JSON.stringify(after));
const persisted = await p.evaluate(() => (JSON.parse(localStorage.getItem("fk-schedule-v1") || "{}").entries || []).some(e => e.id === "custom:e2e-draft"));
rec(persisted, "after refresh the saved training is still there");
const idb = await p.evaluate(() => new Promise(res => { const r = indexedDB.open("fangkun-bulk-store-v1"); r.onerror = () => res(null); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("kv")) return res({ none: true }); const out = { kv: {}, backup: 0 }; const t = db.transaction(["kv", "backup"], "readonly"); const c = t.objectStore("kv").openCursor(); c.onsuccess = () => { const x = c.result; if (x) { out.kv[x.key] = String(x.value).length; x.continue() } }; t.objectStore("backup").count().onsuccess = e => { out.backup = e.target.result }; t.oncomplete = () => res(out) } }));
console.log("INFO bulk IndexedDB", JSON.stringify(idb));
if (label === "new") {
  rec(idb?.kv?.["fk-garmin-intraday-v1:local"] > 100000 && idb?.kv?.["fk-garmin-intraday-v1:local:source-archive"] > 100000, "Garmin intraday + source-archive are in IndexedDB with full size");
  rec(idb?.backup >= 3, `original values backed up in IndexedDB (${idb?.backup} rows)`);
  rec(after.garmin.length === 0, "old big keys removed from localStorage after verified copy");
  rec(after.total < 2_000_000, `localStorage now ${after.total} chars`);
}
rec(errs.length === 0, `no page errors ${errs.slice(0, 2).join("|")}`);
await p.screenshot({ path: `/tmp/t/e2e-${label}-${scenario}.png` });
await b.close(); process.exit(R.some(x => x.startsWith("FAIL")) ? 1 : 0);
