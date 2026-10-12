import { useState } from "react";
import { X } from "lucide-react";
import { badClocks, PRESETS, profileError, type Profile } from "@/lib/strength/profile";
import { distanceLabel } from "@/lib/strength/agent";
import { profileSexLabel } from "@/lib/core/coach-knowledge";

export function ProfileSheet({
  initial,
  onClose,
  onSave,
}: {
  initial: Profile;
  onClose: () => void;
  onSave: (profile: Profile) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [section, setSection] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState("");

  function patch(partial: Partial<Profile>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function save() {
    const height = Number(draft.heightCm);
    const weight = Number(draft.weightKg);
    if (draft.heightCm && (height < 120 || height > 220)) {
      setError("身高写成厘米，比如 165。");
      return;
    }
    if (draft.weightKg && (weight < 35 || weight > 200)) {
      setError("体重写成公斤，比如 65。");
      return;
    }
    const clocks = badClocks(draft);
    const problem = profileError(draft) || clocks[0] || "";
    if (problem) {
      setError(problem);
      return;
    }
    onSave({
      ...draft,
      heightCm: draft.heightCm.trim(),
      weightKg: draft.weightKg.trim(),
      limit: draft.limit.trim().slice(0, 80),
      note: draft.note.trim().slice(0, 120),
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg">
      <div className="flex items-center justify-between px-5 py-2">
        <h2 className="text-lg font-bold">我的情况</h2>
        <button type="button" onClick={onClose} className="grid size-10 place-items-center" aria-label="关闭">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-sm text-muted">填一次就行。热量按这些算，教练按成绩目标和期限看，不会擅自改你的目标。</p>
        <section className="mt-4 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">基本信息</h3>
          <button type="button" className="h-10 px-2 text-sm font-bold text-accent" onClick={() => setSection((value) => (value === "base" ? null : "base"))}>{section === "base" ? "收起" : "编辑"}</button>
        </div>
        {section === "base" ? (
        <>
        <div className="mt-2 flex gap-2">
          {(
            [
              ["", "不填写"],
              ["female", "女"],
              ["male", "男"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => patch({ sex: id })} className={"h-11 flex-1 rounded-full border text-sm font-bold " + (draft.sex === id ? "border-accent bg-surface" : "border-line")}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="年龄" value={draft.age} placeholder="26" onChange={(age) => patch({ age })} />
          <Field label="体脂" suffix="%" value={draft.bodyFat} placeholder="可不填" onChange={(bodyFat) => patch({ bodyFat })} />
          <Field label="身高" suffix="厘米" value={draft.heightCm} placeholder="165" onChange={(heightCm) => patch({ heightCm })} />
          <Field label="体重" suffix="公斤" value={draft.weightKg} placeholder="65" onChange={(weightKg) => patch({ weightKg })} />
        </div>
        </>
        ) : (
          <p className="mt-1 text-sm text-muted">{profileSexLabel(draft.sex)}{draft.age ? ` · ${draft.age} 岁` : " · 年龄未填"} · {draft.heightCm || "身高未填"} 厘米 · {draft.weightKg || "体重未填"} 公斤{draft.bodyFat ? ` · 体脂 ${draft.bodyFat}%` : ""}</p>
        )}
        </section>
        <section className="mt-3 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">训练目标</h3>
          <button type="button" className="h-10 px-2 text-sm font-bold text-accent" onClick={() => setSection((value) => (value === "goal" ? null : "goal"))}>{section === "goal" ? "收起" : "编辑"}</button>
        </div>
        {section === "goal" ? (
        <>
        <div className="mt-2 flex gap-2">
          {(
            [
              ["lose", "减重"],
              ["keep", "维持"],
              ["gain", "增重"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => patch({ aim: id })} className={"h-11 flex-1 rounded-full border text-sm font-bold " + (draft.aim === id ? "border-accent bg-surface" : "border-line")}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="目标体重" suffix="公斤" value={draft.targetKg} placeholder="可不填" onChange={(targetKg) => patch({ targetKg })} />
          <Stepper label="预期" suffix="周" value={draft.weeks} min={4} max={52} step={2} onChange={(weeks) => patch({ weeks })} />
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {(
            [
              ["desk", "很少动"],
              ["light", "轻松活动"],
              ["run", "有跑步"],
              ["hard", "练得很多"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => patch({ activity: id })} className={"h-11 shrink-0 rounded-full border px-3 text-sm " + (draft.activity === id ? "border-accent bg-surface" : "border-line")}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stepper label="一周力量" suffix="次" value={draft.days} min={1} max={6} onChange={(days) => patch({ days })} />
          <Stepper label="晚上能练" suffix="分钟" value={draft.minutes} min={15} max={60} step={5} onChange={(minutes) => patch({ minutes })} />
        </div>
        </>
        ) : (
          <p className="mt-1 text-sm text-muted">{draft.aim === "lose" ? "减重" : draft.aim === "gain" ? "增重" : "维持"} · 目标 {draft.targetKg || "未填"} 公斤 · {draft.weeks} 周 · 一周 {draft.days} 次 · 每次 {draft.minutes} 分钟</p>
        )}
        </section>
        <section className="mt-3 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">比赛</h3>
          <button type="button" className="h-10 px-2 text-sm font-bold text-accent" onClick={() => setSection((value) => (value === "race" ? null : "race"))}>{section === "race" ? "收起" : "编辑"}</button>
        </div>
        {section === "race" ? (
        <>
        <p className="mt-1 text-xs text-muted">每项写目标成绩和想达成的日期。不练的可以删。800 米及以内当速度，更长的当耐力。</p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.meters}
              type="button"
              disabled={draft.marks.some((mark) => mark.meters === preset.meters)}
              onClick={() => patch({ marks: [...draft.marks, { meters: preset.meters, goal: "", recent: "", deadline: "" }] })}
              className="h-11 shrink-0 rounded-full border border-line px-3 text-sm disabled:opacity-30"
            >
              加 {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input value={custom} inputMode="numeric" placeholder="自定义米数" onChange={(event) => setCustom(event.target.value)} className="h-12 min-w-0 flex-1 rounded-card border border-line bg-surface px-3 outline-none" />
          <button
            type="button"
            className="h-12 shrink-0 rounded-card border border-line px-4 text-sm font-bold"
            onClick={() => {
              const meters = Number(custom);
              if (meters < 100 || meters > 50000 || draft.marks.some((mark) => mark.meters === meters)) {
                setError("米数用 100 到 50000，而且不要重复。");
                return;
              }
              setError("");
              setCustom("");
              patch({ marks: [...draft.marks, { meters, goal: "", recent: "", deadline: "" }] });
            }}
          >
            添加
          </button>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {draft.marks.map((mark) => (
            <li key={mark.meters} className="rounded-card border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{distanceLabel(mark.meters)}</p>
                <button type="button" className="h-11 px-2 text-sm text-muted" onClick={() => patch({ marks: draft.marks.filter((item) => item.meters !== mark.meters) })}>
                  删除
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="目标成绩" value={mark.goal} placeholder={mark.meters >= 3000 ? "25分" : "1分33"} onChange={(goal) => patch({ marks: draft.marks.map((item) => (item.meters === mark.meters ? { ...item, goal } : item)) })} />
                <Field label="最近一次" value={mark.recent} placeholder="可不填" onChange={(recent) => patch({ marks: draft.marks.map((item) => (item.meters === mark.meters ? { ...item, recent } : item)) })} />
              </div>
              <label className="mt-2 block text-xs text-muted">
                预期日期
                <input type="date" value={mark.deadline} onChange={(event) => patch({ marks: draft.marks.map((item) => (item.meters === mark.meters ? { ...item, deadline: event.target.value } : item)) })} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3 outline-none" />
              </label>
            </li>
          ))}
        </ul>
        </>
        ) : (
          <p className="mt-1 text-sm text-muted">{draft.marks.length ? draft.marks.map((mark) => distanceLabel(mark.meters)).join(" · ") : "尚未设置"}</p>
        )}
        </section>
        <section className="mt-3 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">限制</h3>
          <button type="button" className="h-10 px-2 text-sm font-bold text-accent" onClick={() => setSection((value) => (value === "limit" ? null : "limit"))}>{section === "limit" ? "收起" : "编辑"}</button>
        </div>
        {section === "limit" ? (
        <>
        <label className="mt-2 block text-sm font-bold" htmlFor="limit">
          哪里不舒服
        </label>
        <input
          id="limit"
          value={draft.limit}
          maxLength={80}
          onChange={(event) => patch({ limit: event.target.value })}
          placeholder="比如左膝下蹲会顶"
          className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3 outline-none"
        />
        </>
        ) : (
          <p className="mt-1 text-sm text-muted">{draft.limit.trim() || "尚未设置"}</p>
        )}
        </section>
        <section className="mt-3 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">备注</h3>
          <button type="button" className="h-10 px-2 text-sm font-bold text-accent" onClick={() => setSection((value) => (value === "note" ? null : "note"))}>{section === "note" ? "收起" : "编辑"}</button>
        </div>
        {section === "note" ? (
        <>
        <label className="mt-2 block text-sm font-bold" htmlFor="note">
          训练备注
        </label>
        <input
          id="note"
          value={draft.note}
          maxLength={120}
          onChange={(event) => patch({ note: event.target.value })}
          placeholder="比如工作日晚上练，一周三次"
          className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3 outline-none"
        />
        </>
        ) : (
          <p className="mt-1 text-sm text-muted">{draft.note.trim() || "尚未设置"}</p>
        )}
        </section>
        {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}
        <button type="button" onClick={save} className="mt-4 flex h-12 w-full items-center justify-center rounded-card bg-accent font-bold text-accent-fg">
          保存
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted">
        {label}
        {suffix ? `（${suffix}）` : ""}
      </span>
      <input
        value={value}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3 outline-none"
      />
    </label>
  );
}

function Stepper({
  label,
  suffix,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-card bg-surface-2 px-2 py-2">
      <p className="px-1 text-xs text-muted">
        {label}（{suffix}）
      </p>
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          disabled={value <= min}
          className="grid size-11 place-items-center rounded-full bg-surface text-lg disabled:opacity-30"
          aria-label={`减少${label}`}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </button>
        <span className="text-sm font-bold">{value}</span>
        <button
          type="button"
          disabled={value >= max}
          className="grid size-11 place-items-center rounded-full bg-surface text-lg disabled:opacity-30"
          aria-label={`增加${label}`}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}
