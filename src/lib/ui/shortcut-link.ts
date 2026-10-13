/** iOS 快捷指令入口（URL 参数，不打开表单也能带数据进来；仍需在 App 里确认一次）。
 *  记一笔：  https://<域名>/?log=<URL编码的一句话>
 *  健康数据：https://<域名>/?health=<URL编码的多行文本>，每行 “指标,日期,数值”，指标 SLEEP(小时)/RHR(次/分)/HRV(ms)/WEIGHT(kg)。 */
import type { DeviceHealthRow, HealthMetric } from "./device-parse.ts"
const OK: Record<string, [HealthMetric, number, number]> = { SLEEP: ["SLEEP" as HealthMetric, 0, 24], RHR: ["RHR" as HealthMetric, 25, 140], HRV: ["HRV" as HealthMetric, 5, 300], WEIGHT: ["WEIGHT" as HealthMetric, 30, 250] }
export function parseHealthParam(text: string): { rows: DeviceHealthRow[]; errors: string[] } {
  const rows: DeviceHealthRow[] = [], errors: string[] = [], seen = new Set<string>()
  for (const [i, raw] of text.split(/\r?\n|;/).entries()) {
    const line = raw.trim(); if (!line) continue
    const [m, d, v] = line.split(",").map((x) => x.trim()); const spec = OK[(m ?? "").toUpperCase()]; const val = Number(v)
    if (!spec || !/^\d{4}-\d{2}-\d{2}$/.test(d ?? "") || !Number.isFinite(val) || val < spec[1] || val > spec[2]) { errors.push(`第 ${i + 1} 行无法识别：${line.slice(0, 40)}`); continue }
    const key = `${spec[0]}:${d}`; if (seen.has(key)) continue; seen.add(key)
    rows.push({ key, source: "Apple 健康（快捷指令）", metric: spec[0], day: d, value: Math.round(val * 10) / 10 })
  }
  return { rows: rows.slice(0, 400), errors }
}
export function readLaunchParams(search: string): { log: string | null; health: string | null } {
  const p = new URLSearchParams(search); return { log: p.get("log")?.slice(0, 80) ?? null, health: p.get("health")?.slice(0, 20000) ?? null }
}
