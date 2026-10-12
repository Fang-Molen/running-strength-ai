import { useEffect, useState } from "react";
import { BODY_FIELDS, bodyTrend, loadChecks, removeCheck, todayDate, upsertCheck, type BodyCheck, type BodyKey } from "@/lib/nutrition/body";
import type { Profile } from "@/lib/strength/profile";

function blank(date: string): Record<BodyKey, string> {
  return { date, weight: "", fat: "", fatMass: "", bmi: "", water: "", waterRate: "", muscle: "", muscleRate: "", boneRate: "", bmr: "", waist: "" } as Record<BodyKey, string> & { date: string };
}

export function BodyPanel({ profile, onProfile, onSaved }: { profile: Profile; onProfile: (profile: Profile) => void; onSaved?: () => void }) {
  const [checks, setChecks] = useState<BodyCheck[]>([]);
  const [date, setDate] = useState("");
  const [draft, setDraft] = useState(() => blank(""));
  const [open, setOpen] = useState(false);
  const [showEntry, setShowEntry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const today = todayDate();
    setChecks(loadChecks());
    setDate(today);
    setDraft(blank(today));
  }, []);
  const trend = bodyTrend(checks);
  const height = Number(profile.heightCm);
  const computedBmi = height >= 120 && Number(draft.weight) > 0 ? Number(draft.weight) / (height / 100) ** 2 : null;

  function save() {
    const next: Omit<BodyCheck, "id"> = { date, weight: 0 };
    for (const field of BODY_FIELDS) {
      const text = draft[field.key].trim();
      if (!text) continue;
      const value = Number(text);
      if (!Number.isFinite(value) || value < field.min || value > field.max) {
        setError(`${field.label}不在合理范围。`);
        return;
      }
      next[field.key] = field.key === "bmr" ? Math.round(value) : Math.round(value * 10) / 10;
    }
    if (!(next.weight > 0)) {
      setError("至少写体重。");
      return;
    }
    if (next.bmi == null && computedBmi != null) next.bmi = Math.round(computedBmi * 10) / 10;
    const saved = upsertCheck(next);
    if (!saved) {
      setError("没有写入本机，原来的体重记录还在。");
      return;
    }
    setChecks(saved);
    onSaved?.();
    setShowEntry(false);
    setError(`已记下 ${date} 的 ${next.weight} 公斤。同一天再记会盖掉这一天。`);
  }

  function useForCalories() {
    if (!trend.latest) return;
    onProfile({ ...profile, weightKg: String(trend.latest.weight) });
    setError("每天热量已按这次体重重算。");
  }

  const profileKg = Number(profile.weightKg);
  const canApply = trend.latest != null && Math.abs(trend.latest.weight - profileKg) >= 0.1;

  return (
    <div className="mt-4">
      <h2 className="sr-only">身体</h2>
      {trend.latest ? (
        <section className="mt-4 rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-muted">{trend.latest.date}</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">{trend.latest.weight}</p>
          <p className="text-sm text-muted">
            公斤
            {trend.delta != null ? ` · 比上次 ${trend.delta >= 0 ? "+" : ""}${trend.delta.toFixed(1)}` : ""}
            {trend.avg7 != null ? ` · 近 7 天均 ${trend.avg7.toFixed(1)}` : ""}
            {trend.weekDelta != null ? ` · 比前一周 ${trend.weekDelta >= 0 ? "+" : ""}${trend.weekDelta.toFixed(1)}` : ""}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {BODY_FIELDS.filter((field) => field.key !== "weight" && trend.latest?.[field.key] != null).map((field) => (
              <div key={field.key}>
                <dt className="text-muted">{field.label}</dt>
                <dd className="font-bold">
                  {trend.latest?.[field.key]} {field.suffix}
                </dd>
              </div>
            ))}
          </dl>
          {canApply ? (
            <button type="button" onClick={useForCalories} className="mt-3 h-11 rounded-card bg-accent px-4 text-sm font-bold text-accent-fg">
              用这次体重算热量
            </button>
          ) : null}
        </section>
      ) : (
        <p className="mt-4 text-sm text-muted">还没有体重。先记今天的晨重。</p>
      )}
      <section className="mt-4">
        <h3 className="text-sm text-muted">体重趋势</h3>
        {checks.length < 2 ? (
          <p className="mt-2 text-sm text-muted">数据不足。至少两天的体重才能看趋势，这里不补假的曲线。</p>
        ) : (
          <div className="mt-3 flex h-24 items-end gap-1">
            {checks.slice(-7).map((item) => {
              const slice = checks.slice(-7)
              const low = Math.min(...slice.map((row) => row.weight))
              const high = Math.max(...slice.map((row) => row.weight))
              const span = Math.max(0.1, high - low)
              const height = 24 + ((item.weight - low) / span) * 72
              return <div key={item.id} className="flex-1 rounded-t bg-accent" style={{ height }} title={`${item.date} ${item.weight}`} />
            })}
          </div>
        )}
      </section>
      <button type="button" aria-expanded={showEntry} onClick={() => setShowEntry((value) => !value)} className="mt-4 flex min-h-12 w-full items-center justify-between rounded-card bg-accent px-4 text-sm font-bold text-accent-fg">
        {showEntry ? "收起体重记录" : "＋ 记录体重 / 体测"}<span aria-hidden="true">{showEntry ? "−" : "+"}</span>
      </button>
      {showEntry ? <section className="mt-3 rounded-card border border-line bg-surface p-4">
        <label className="grid gap-1 text-sm text-muted">
          日期
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-12 rounded-card border border-line bg-bg px-3 text-fg outline-none" />
        </label>
        <label className="mt-3 grid gap-1 text-sm text-muted">
          体重 公斤
          <input inputMode="decimal" value={draft.weight} placeholder="比如 65.4" onChange={(event) => setDraft({ ...draft, weight: event.target.value })} className="h-12 rounded-card border border-line bg-bg px-3 text-fg outline-none" />
        </label>
        <button type="button" onClick={() => setOpen((value) => !value)} className="mt-3 h-11 text-sm font-bold text-accent">
          {open ? "收起体测数字" : "加上体测数字"}
        </button>
        {open ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {BODY_FIELDS.filter((field) => field.key !== "weight").map((field) => (
              <label key={field.key} className="grid gap-1 text-sm text-muted">
                {field.label}
                {field.suffix ? ` ${field.suffix}` : ""}
                <input
                  inputMode="decimal"
                  value={draft[field.key]}
                  placeholder={field.key === "bmi" && computedBmi ? `可空，按身高是 ${computedBmi.toFixed(1)}` : "可不填"}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  className="h-12 rounded-card border border-line bg-bg px-3 text-fg outline-none"
                />
              </label>
            ))}
          </div>
        ) : null}
        <button type="button" onClick={save} className="mt-3 h-14 w-full rounded-card bg-accent text-base font-bold text-accent-fg">
          记录今天
        </button>
        {error ? <p className="mt-2 text-sm text-muted">{error}</p> : null}
      </section> : null}
      {showEntry ? null : error ? <p role="status" className="mt-2 text-sm text-muted">{error}</p> : null}
      {checks.length ? <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)} className="mt-4 flex min-h-11 w-full items-center justify-between rounded-card border border-line px-4 text-sm font-bold">历史记录（{checks.length}）<span>{showHistory ? "收起" : "展开"}</span></button> : null}
      {checks.length && showHistory ? (
        <ul className="mt-3 flex flex-col gap-2">
          {[...checks].reverse().map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-card border border-line px-3 py-2 text-sm">
              <span className="w-24 shrink-0 text-muted">{item.date.slice(5)}</span>
              <span className="min-w-0 flex-1 truncate font-bold">
                {item.weight} 公斤{item.fat != null ? ` · 脂肪 ${item.fat}%` : ""}
                {item.muscle != null ? ` · 肌肉 ${item.muscle}` : ""}
              </span>
              <button type="button" className="h-11 shrink-0 px-2 text-muted" onClick={() => {
                const saved = removeCheck(item.id)
                if (!saved) return setError("没有删除。原来的记录还在。")
                setChecks(saved)
              }}>
                删
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
