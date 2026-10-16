/** t432 体型模拟：模拟外观，非准确预测。参数与实测数据分开存储（fk-shape-sim-v1）。 */
export type Girth = { waist: number; chest: number; upperArm: number; thigh: number; calf: number; shoulders: number };
export type SimParams = { mode: "bf" | "split"; leanShare: number; pose: string };
export const SIM_KEY = "fk-shape-sim-v1";
export const DEFAULT_SIM: SimParams = { mode: "split", leanShare: 0.3, pose: "stand" };
// metres of surface offset per kg (rough regional distribution; illustrative only)
const FAT: Girth = { waist: 0.0045, chest: 0.0015, upperArm: 0.0012, thigh: 0.002, calf: 0.0006, shoulders: 0.0004 };
const LEAN: Girth = { waist: 0.0004, chest: 0.0018, upperArm: 0.0016, thigh: 0.0016, calf: 0.0008, shoulders: 0.0018 };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export function splitOf(cur: { kg: number; bf: number | null }, tgt: { kg: number; bf: number | null }, p: SimParams) {
  const dW = tgt.kg - cur.kg;
  if (p.mode === "bf" && cur.bf != null && tgt.bf != null) {
    const dFat = tgt.kg * tgt.bf / 100 - cur.kg * cur.bf / 100; const dLean = dW - dFat;
    return { dFat, dLean, share: Math.abs(dW) > 0.05 ? dLean / dW : null, derivedBf: tgt.bf };
  }
  const s = clamp(p.leanShare, 0, 1); const dLean = dW * s, dFat = dW * (1 - s);
  const derivedBf = cur.bf != null && tgt.kg > 0 ? ((cur.kg * cur.bf / 100 + dFat) / tgt.kg) * 100 : null;
  return { dFat, dLean, share: s, derivedBf };
}
export function girthFor(dFat: number, dLean: number): Girth {
  const g = {} as Girth;
  for (const k of Object.keys(FAT) as (keyof Girth)[]) g[k] = clamp(FAT[k] * dFat + LEAN[k] * dLean, -0.03, 0.03);
  return g;
}
export function loadSim(): SimParams { try { return { ...DEFAULT_SIM, ...JSON.parse(localStorage.getItem(SIM_KEY) || "{}") }; } catch { return { ...DEFAULT_SIM }; } }
export function saveSim(p: SimParams) { localStorage.setItem(SIM_KEY, JSON.stringify(p)); }
