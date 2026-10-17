import { useId, useState } from "react";
import { Sheet } from "@/components/sheet";
import { parseBodyGoal, persistBodyGoal } from "@/lib/body/goal-editor";
import type { Profile } from "@/lib/strength/profile";
import "./body-figure-sheet.css";

export function BodyFigureSheet({ sex, kg, bf, targetKg, targetBf, onClose, onData, onSaved }: {
  sex: "male" | "female"; kg: number | null; bf: number | null; targetKg: number | null; targetBf: number | null;
  onClose: () => void; onData: () => void; onSaved: (profile: Profile, bf: number | null) => void;
}) {
  const formId = useId();
  const [weight, setWeight] = useState(targetKg === null ? "" : String(targetKg));
  const [fat, setFat] = useState(targetBf === null ? "" : String(targetBf));
  const [withFat, setWithFat] = useState(targetBf !== null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = weight !== (targetKg === null ? "" : String(targetKg)) || (withFat ? fat : "") !== (targetBf === null ? "" : String(targetBf));
  const parsed = parseBodyGoal(weight, fat, withFat);
  const presetBase = targetKg ?? kg;
  const presets = presetBase === null ? [] : [...new Set([-2, 0, 2].map(x => Math.round(presetBase + x)).filter(x => x >= 35 && x <= 200))];
  const edit = (setter: (value: string) => void, value: string) => { setter(value); setMessage(""); };
  const submit = () => {
    if (busy) return;
    if (typeof parsed === "string") { setMessage(parsed); return; }
    setBusy(true);
    const result = persistBodyGoal(parsed);
    if (result.ok) { onSaved(result.profile, parsed.bf); setMessage("目标已保存"); }
    else setMessage(result.reason);
    setBusy(false);
  };
  return <Sheet label="我的形象与目标" title="我的形象" onClose={onClose} footer={<>
    <p className="keep fk-figure-status" role="status" aria-live="polite">{message || (!dirty && targetKg !== null ? "目标已保存，可继续调整" : "目标设置不会改写实测记录")}</p>
    <button type="submit" form={formId} disabled={busy || !dirty} className="fk-orange-btn fk-figure-save">{busy ? "正在保存…" : dirty ? "保存目标" : targetKg !== null ? "目标已保存" : "请先填写目标"}</button>
  </>}>
    <section className="fk-figure-overview" aria-label="当前身体数据">
      <img src={`/fangkun-atlas/figure-${sex}.webp`} alt="方坤标准角色插画，非实测体型" />
      <div><span className="text-xs text-muted">当前体重</span><p className="keep text-2xl font-black">{kg ?? "—"}<small className="ml-1 text-sm font-normal">kg</small></p>
        <p className="keep mt-1 text-sm text-muted">体脂率 {bf === null ? "未记录" : `${bf}%`}</p>
        <p className="keep mt-3 text-xs text-muted">标准角色插画<br />体型模拟待接入</p></div>
    </section>
    <form id={formId} className="fk-figure-goal" onSubmit={e => { e.preventDefault(); submit(); }} noValidate>
      <label htmlFor={`${formId}-kg`} className="font-bold">目标体重 <span className="text-xs font-normal text-muted">kg</span></label>
      <div className="fk-figure-number"><button type="button" aria-label="目标体重减0.5公斤" onClick={() => edit(setWeight, String(Math.max(35, (Number(weight) || kg || 56) - .5)))}>−</button>
        <input id={`${formId}-kg`} aria-label="目标体重公斤" type="number" inputMode="decimal" min="35" max="200" step="0.5" value={weight} placeholder="输入目标体重" onChange={e => edit(setWeight, e.target.value)} />
        <button type="button" aria-label="目标体重加0.5公斤" onClick={() => edit(setWeight, String(Math.min(200, (Number(weight) || kg || 56) + .5)))}>＋</button></div>
      <div className="fk-figure-presets">{presets.map(x => <button key={x} type="button" aria-pressed={Number(weight) === x} onClick={() => edit(setWeight, String(x))}>{x} kg</button>)}</div>
      <label className="fk-figure-check"><input type="checkbox" checked={withFat} onChange={e => { setWithFat(e.target.checked); setMessage(""); }} />设置目标体脂率<span className="text-xs text-muted">选填</span></label>
      {withFat ? <label className="block text-sm">目标体脂率（%）<input className="fk-cell mt-1 w-full" aria-label="目标体脂率百分比" type="number" inputMode="decimal" min="0.1" max="59.9" step="0.1" value={fat} placeholder="填写数值，或取消勾选" onChange={e => edit(setFat, e.target.value)} /></label>
        : <p className="keep text-sm text-muted">目标体脂率：暂不设置</p>}
      {kg !== null && typeof parsed !== "string" ? <div className="fk-figure-delta"><span>当前 {kg} kg</span><span aria-hidden="true">→</span><b>目标 {parsed.kg} kg</b><span className="text-muted">{parsed.kg >= kg ? "增加" : "减少"} {Math.abs(parsed.kg - kg).toFixed(1)} kg</span></div> : null}
    </form>
    <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-line text-sm" onClick={onData}>身体数据与趋势 ›</button>
  </Sheet>;
}
