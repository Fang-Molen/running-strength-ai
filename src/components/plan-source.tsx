import { useEffect, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";

type Imp = { id: string; name: string; type: string; size: number; at: string; text?: string };
const KEY = "fk-plan-imports-v1";
const load = (): Imp[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const LABEL: Record<string, string> = { "400m-v4": "400米专项计划 V4（已导入）", generated: "方坤生成计划" };

/** 计划来源：一次一个激活计划；切换不删任何记录。 */
export function PlanSourceCard({ active, onChange, onGenerate }: { active: string; onChange: (v: string) => void; onGenerate: () => void }) {
  const [imports, setImports] = useState<Imp[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => setImports(load()), []);
  const add = async (f: File) => {
    const text = /text|json|csv/.test(f.type) || /\.(txt|md|csv)$/i.test(f.name) ? (await f.text()).slice(0, 200000) : undefined;
    const next = [...load(), { id: `imp-${Date.now()}`, name: f.name, type: f.type, size: f.size, at: new Date().toISOString(), text }];
    localStorage.setItem(KEY, JSON.stringify(next)); setImports(next);
    setMsg(`已保存「${f.name}」，待解析成课表`);
  };
  return <section className="home-card mb-3 p-3" aria-label="计划来源">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0"><p className="keep text-xs text-muted">当前计划</p><b className="block truncate">{LABEL[active] ?? active}</b></div>
      <button type="button" className="min-h-10 shrink-0 rounded-full border border-line px-3 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>切换 / 替换</button>
    </div>
    {open ? <div className="mt-3 space-y-2">
      <label className="fk-orange-btn flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl font-bold"><FileUp className="size-4" />导入课表（PDF / 图片 / 文本）<input type="file" accept=".pdf,image/*,.txt,.md,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void add(f); e.target.value = ""; }} /></label>
      <button type="button" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line text-sm" onClick={onGenerate}><Sparkles className="size-4" />让方坤生成</button>
      <div className="space-y-1 text-sm">{["400m-v4", "generated"].map((k) => <button key={k} type="button" aria-pressed={active === k} onClick={() => onChange(k)} className={"flex min-h-10 w-full items-center justify-between rounded-lg border px-3 " + (active === k ? "border-accent" : "border-line")}><span>{LABEL[k]}</span><span>{active === k ? "使用中" : "切换"}</span></button>)}</div>
      {imports.length ? <ul className="keep text-xs text-muted">{imports.map((i) => <li key={i.id}>{i.name} · 待解析</li>)}</ul> : null}
      {msg ? <p className="keep text-xs" aria-live="polite">{msg}</p> : null}
      <p className="keep text-xs text-muted">切换不会删除旧计划的记录</p>
    </div> : null}
  </section>;
}
