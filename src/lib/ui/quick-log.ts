/** “+记一笔”一句话解析：跑步 / 力量 / 体重。识别后核对一次再保存。 */
export type Parsed =
  | { kind: "run"; title: string; km: number | null; minutes: number | null; pace: string | null; when: "am" | "pm" | null }
  | { kind: "strength"; name: string; sets: number; reps: number; kg: number | null }
  | { kind: "weight"; kg: number }
  | { kind: "unknown"; text: string }
const num = (s: string) => Number(s.replace(/[，,]/g, "."))
const CN: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const cnNum = (s: string) => (/^\d/.test(s) ? num(s) : CN[s] ?? NaN)
export function parseQuickLog(input: string): Parsed {
  const t = input.trim().replace(/\s+/g, " ")
  const when = /早|上午|晨/.test(t) ? "am" : /晚|下班|夜/.test(t) ? "pm" : null
  const w = t.match(/^(?:体重)\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤)?$/i) ?? t.match(/^(\d+(?:\.\d+)?)\s*(?:kg|公斤)$/i)
  if (w && /体重|^\d/.test(t) && !/[×xX*]/.test(t)) { const kg = num(w[1]); if (kg >= 30 && kg <= 250) return { kind: "weight", kg } }
  const st = t.match(/^(.+?)\s*([一二三四五六七八九十\d]+)\s*[×xX*组]\s*(\d+)\s*(?:次)?\s*(?:(\d+(?:\.\d+)?)\s*(?:kg|公斤))?/i)
  if (st && !/跑|公里|km/i.test(st[1])) { const sets = cnNum(st[2]), reps = Number(st[3]); if (sets > 0 && sets <= 20 && reps > 0 && reps <= 100) return { kind: "strength", name: st[1].trim(), sets, reps, kg: st[4] ? num(st[4]) : null } }
  if (/跑|公里|km/i.test(t)) {
    const km = t.match(/(\d+(?:\.\d+)?)\s*(?:公里|km|k\b)/i), mn = t.match(/(\d+)\s*(?:分钟|分|min)(?!\d)/i), pc = t.match(/配速\s*(\d{1,2})[:'：](\d{2})/)
    const title = (t.match(/(轻松跑|慢跑|节奏跑|间歇跑?|长距离|长跑|跑步|跑)/)?.[1] ?? "跑步").replace(/^跑$/, "跑步")
    let minutes = mn ? Number(mn[1]) : null
    const k = km ? num(km[1]) : null
    if (minutes == null && k && pc) minutes = Math.round(k * (Number(pc[1]) + Number(pc[2]) / 60))
    const pace = pc ? `${pc[1]}:${pc[2]}` : k && minutes ? (() => { const p = minutes / k; return `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, "0")}` })() : null
    return { kind: "run", title, km: k, minutes, pace, when }
  }
  return { kind: "unknown", text: t }
}
