import { chromium } from "playwright"
import { fillByLabel } from "../r2/browser/lib.mjs"
export async function setup(storageState) {
  const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] }); const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers:"block", ...(storageState ? { storageState } : {}) }); const p = await ctx.newPage(); p.setDefaultTimeout(60000)
  return { b, ctx, p }
}
export async function goal(p) {
  await p.waitForFunction(()=>!document.body.innerText.includes("读取中"),null,{timeout:60000})
  await p.getByRole("button", { name: "方坤" }).click(); await p.waitForTimeout(800)
  await p.getByPlaceholder("输入你的问题").fill("我的目标是8周后400米跑进80秒"); await p.getByRole("button", { name: "发送" }).click(); await p.waitForTimeout(2000)
}
export const panelOf = (p) => p.locator("details").filter({ hasText: "首次使用" })
export async function steps(p, upto = 9) {
  const panel = panelOf(p)
  const next = async () => { await panel.getByRole("button", { name: "确认本步并继续" }).click(); await p.waitForTimeout(900) }
  await fillByLabel(panel, { "年龄": "28", "训练经验": "24", "当前实际400米秒数": "88", "实际成绩日期": "2026-10-01", "计时方式": "手计", "目前能轻松连续走跑": "40" }); await next()
  if (upto < 3) return
  await fillByLabel(panel, { "近期训练性质": "本人实际完成（无规律训练可填0次）", "实际每周训练次数": "3", "近期每次轻松走跑分钟": "30", "近期实际主课日期": "2026-10-08", "重复跑单组米数": "400", "每轮组数": "4", "轮数": "1", "实际最快一组秒数": "86", "实际最慢一组秒数": "90", "实际组间休息秒数": "120", "上节主课RPE": "7", "上节48小时恢复": "6" }); await next()
}
