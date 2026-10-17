/** t438 体脂秤截图/照片识别结果解析。未识别的项保持为空（不是 0）。 */
export type ScaleKey = "weight" | "fat" | "muscle" | "armMuscle" | "trunkMuscle" | "legMuscle" | "visceral" | "waterRate" | "boneMass" | "bmr";
export type ScaleResult = { values: Partial<Record<ScaleKey, number>>; date?: string; suspicious: ScaleKey[] };
export const RANGES: Record<ScaleKey, [number, number]> = {
  weight: [30, 200], fat: [3, 60], muscle: [15, 100], armMuscle: [1, 20], trunkMuscle: [8, 50], legMuscle: [5, 40],
  visceral: [1, 30], waterRate: [35, 75], boneMass: [1, 6], bmr: [800, 3500],
};
const LABELS: [ScaleKey, RegExp][] = [
  ["armMuscle", /(双臂|手臂|上肢)肌肉(量)?/], ["trunkMuscle", /躯干肌肉(量)?/], ["legMuscle", /(双腿|腿部|下肢)肌肉(量)?/],
  ["visceral", /内脏脂肪(等级|指数)?/], ["fat", /体脂(肪)?率|体脂(?!肪量)/], ["waterRate", /(身体)?水分(率)?|体水分/],
  ["boneMass", /骨(盐)?量|骨骼量/], ["bmr", /基础代谢(率|量)?/], ["muscle", /(骨骼)?肌肉(量|率)?/], ["weight", /体重/],
];
const num = (s: string) => { const m = s.match(/(\d{1,4}(?:[.,]\d{1,2})?)/); return m ? Number(m[1].replace(",", ".")) : null; };
export function checkValues(v: Partial<Record<ScaleKey, number>>): ScaleKey[] {
  return (Object.keys(v) as ScaleKey[]).filter(k => { const x = v[k]!; const [a, b] = RANGES[k]; return !(x >= a && x <= b); });
}
export function parseScaleText(text: string): ScaleResult {
  const values: Partial<Record<ScaleKey, number>> = {};
  const lines = text.replace(/[：:]/g, " ").split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\s+/g, "");
    for (const [k, re] of LABELS) {
      if (values[k] != null) continue; const m = l.match(re); if (!m) continue;
      let rest = l.slice((m.index ?? 0) + m[0].length); let n = num(rest);
      if (n == null && lines[i + 1]) { rest = lines[i + 1].replace(/\s+/g, ""); n = num(rest); }
      if (n == null) break;
      if (k === "weight" && /斤/.test(rest) && !/kg|公斤/i.test(rest)) n = n / 2;
      if (k === "muscle" && /率|%/.test(m[0] + rest.slice(0, 6))) break; // muscle rate ≠ muscle mass
      values[k] = Math.round(n * 10) / 10; break;
    }
  }
  const d = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  const date = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : undefined;
  return { values, date, suspicious: checkValues(values) };
}
/** Normalise a provider JSON reply: only known keys, finite numbers; null/absent stay absent. */
export function fromJson(o: Record<string, unknown>): ScaleResult {
  const values: Partial<Record<ScaleKey, number>> = {};
  for (const k of Object.keys(RANGES) as ScaleKey[]) { const v = o[k]; const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; if (v != null && v !== "" && Number.isFinite(n) && n > 0) values[k] = n; }
  const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : undefined;
  return { values, date, suspicious: checkValues(values) };
}
