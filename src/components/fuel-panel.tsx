import { useEffect, useMemo, useState } from "react";
import { activityLabel, aimLabel, computePlan, todayEatTarget } from "@/lib/nutrition/calc";
import { effectiveNutritionProfile } from "@/lib/coach/loop/effective-host";
import { DayCard } from "@/components/day-card";
import { catalogSize, parseFoodLine, searchFoods, type FoodHit } from "@/lib/nutrition/lookup";
import { MEALS, addEntriesBatch, loadEntries, removeEntry, todayEaten, todayEntries, type FoodEntry, type Meal } from "@/lib/nutrition/log";
import { distanceLabel } from "@/lib/strength/agent";
import type { Profile } from "@/lib/strength/profile";

export function FuelPanel({ profile, onEdit, onSaved, revision = 0 }: { profile: Profile; onEdit: () => void; onSaved?: () => void; revision?: number }) {
  const plan = computePlan(effectiveNutritionProfile(profile));
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [meal, setMeal] = useState<Meal>("午餐");
  const [showDevice, setShowDevice] = useState(false);
  const [showMeals, setShowMeals] = useState(false);
  const [foodError, setFoodError] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<FoodHit[] | null>(null);
  useEffect(() => { const refresh = () => setEntries(loadEntries()); refresh(); window.addEventListener("fk-food-changed", refresh); window.addEventListener("storage", refresh); return () => { window.removeEventListener("fk-food-changed", refresh); window.removeEventListener("storage", refresh); }; }, [revision]);
  const today = todayEntries(entries);
  const eaten = todayEaten(entries);
  const protein = Math.round(today.reduce((sum, item) => sum + (item.protein ?? 0), 0));
  const target = plan ? todayEatTarget(plan) : null;
  const watch = target != null && plan != null && target !== plan.kcal;
  const races = profile.marks.filter((mark) => mark.goal || mark.deadline);
  const hits = useMemo(() => searchFoods(query), [query]);

  const recent = useMemo(() => {
    const seen = new Set<string>();
    return [...entries].reverse().filter((item) => {
      const key = `${item.name}|${item.grams}|${item.kcal}|${item.protein ?? 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [entries]);

  function prepareHits() {
    if (hits.length === 0) return;
    const explicit = parseFoodLine(query);
    if (explicit.length === 0 && hits.length > 1) { setFoodError("请从下方匹配结果选择具体食物，避免一次记录多个搜索建议。"); return; }
    setPending(explicit.length > 0 ? explicit : [hits[0]]);
    setFoodError("");
    setSavedNote("");
  }

  function confirmHits() {
    if (!pending?.length) return;
    const saved = addEntriesBatch(pending.map((hit) => ({ meal, name: hit.name, grams: hit.grams, kcal: hit.kcal, protein: hit.protein, label: hit.label })));
    if (!saved) { setFoodError("保存失败，原有记录未修改。请检查本机存储空间。"); return; }
    setEntries(saved);
    onSaved?.();
    setPending(null);
    setQuery("");
    setFoodError("");
    setSavedNote(`已记录 ${pending.length} 项食物，原有记录保留。`);
  }

  function repeatFood(item: FoodEntry) {
    const saved = addEntriesBatch([{ meal, name: item.name, grams: item.grams, kcal: item.kcal, protein: item.protein, carb: item.carb, fat: item.fat, fiber: item.fiber, foodId: item.foodId, amount: item.amount, unit: item.unit, nutritionSource: item.nutritionSource, label: item.label }]);
    if (!saved) { setFoodError("快捷记录失败，原有记录未修改。"); return; }
    setEntries(saved);
    onSaved?.();
    setFoodError("");
    setSavedNote(`已加入${meal}：${item.name}（${item.label ?? `${item.grams}克`}）。`);
  }

  return (
    <div>
      <section className="rounded-card border border-line bg-surface p-4">
        {plan ? (
          <>
            <p className="text-sm text-muted">今日摄入 · {aimLabel(plan.aim)}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">{eaten}<span className="text-base font-medium text-muted"> / {target ?? plan.kcal}</span></p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.round((eaten / Math.max(1, target ?? plan.kcal)) * 100))}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">剩余 {Math.max(0, (target ?? plan.kcal) - eaten)}{eaten > (target ?? plan.kcal) ? ` · 已超出 ${eaten - (target ?? plan.kcal)}` : ""}</p>
            <p className="mt-1 text-sm">蛋白质 {protein} / {plan.protein} 克</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.round((protein / Math.max(1, plan.protein)) * 100))}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">{activityLabel(profile.activity)}{watch ? ` · 目标已按运动设备的今日总消耗改成 ${target}` : ""}</p>
            <p className="mt-1 text-xs text-muted">热量目标是估算参考，不代表运动表现或健康诊断；训练消耗不重复叠加。食物记录、身体指标和历史数据会继续保留。</p>
            {today.length === 0 ? <p className="mt-2 text-sm">今天还没有食物记录。保存后才会出现，不会显示成已达标。</p> : null}
            {savedNote ? <p className="mt-2 text-sm">{savedNote}</p> : null}
          </>
        ) : (
          <>
            <p className="text-sm text-muted">今日目标</p>
            <p className="mt-1 text-xl font-bold">暂不可计算</p>
            <p className="mt-1 text-sm text-muted">填了身高、体重和年龄才能算每天热量。今天已吃 {eaten} 千卡，蛋白 {protein} 克。</p>
            <button type="button" onClick={onEdit} className="mt-3 h-11 rounded-2xl bg-accent px-4 text-sm font-bold text-accent-fg">
              去填写身体数据
            </button>
          </>
        )}
      </section>
      <button type="button" aria-expanded={showDevice} onClick={() => setShowDevice((value) => !value)} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-card border border-line px-4 text-sm font-bold">运动与设备消耗 <span>{showDevice ? "收起" : "查看"}</span></button>
      {showDevice ? <div className="mt-3"><DayCard part="all" /></div> : null}
      <p className="mt-4 text-sm text-muted">搜索食物 · 库里 {catalogSize()} 个名字</p>
      <div className="mt-2 flex gap-2">
        {MEALS.map((name) => (
          <button key={name} type="button" onClick={() => setMeal(name)} className={"h-11 flex-1 rounded-full text-sm font-bold " + (meal === name ? "bg-accent text-accent-fg" : "border border-line")}>
            {name}
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          prepareHits();
        }}
      >
        <input
          id="food-query"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPending(null); }}
          placeholder="输入食物名称及克数，例如面条200克"
          className="h-12 min-w-0 flex-1 rounded-card border border-line bg-surface px-3 outline-none"
        />
        <button type="submit" disabled={hits.length === 0} className="h-12 w-14 shrink-0 rounded-card bg-accent font-bold text-accent-fg disabled:opacity-30">
          预览
        </button>
      </form>
      <p className="mt-2 min-h-5 text-sm text-muted">
        {foodError || (query.trim() && hits.length === 0 ? "库里没有。可以写成「海参 35千卡 蛋白7」。" : hits.map((hit) => `${hit.name} ${hit.label} · ${hit.kcal}千卡 · 蛋白${hit.protein}克`).join("、"))}
      </p>
      {pending && <section className="mt-3 rounded-card border border-line bg-surface p-3" aria-label="待确认的食物记录">
        <p className="text-sm font-bold">确认加入{meal} · {pending.length}项</p>
        <p className="mt-1 text-xs text-muted">按现有食物库估算；请检查食物和份量，确认前不会写入。</p>
        <ul className="mt-2 space-y-2">{pending.map((hit, index) => <li key={`${hit.name}-${index}`} className="flex justify-between gap-2 text-sm"><span>{hit.name} · {hit.label}</span><span className="shrink-0">{hit.kcal}千卡 · 蛋白{hit.protein}克</span></li>)}</ul>
        <p className="mt-2 text-sm font-bold">合计 {pending.reduce((sum, hit) => sum + hit.kcal, 0)} 千卡 · 蛋白 {Math.round(pending.reduce((sum, hit) => sum + hit.protein, 0) * 10) / 10} 克</p>
        <div className="mt-3 flex gap-2"><button type="button" className="h-11 flex-1 rounded-2xl bg-accent font-bold text-accent-fg" onClick={confirmHits}>确认记录</button><button type="button" className="h-11 rounded-2xl border border-line px-4" onClick={() => setPending(null)}>取消</button></div>
      </section>}
      {recent.length > 0 && <section className="mt-4" aria-label="最近吃过的食物">
        <p className="text-sm font-bold">最近吃过 · 一键再记</p>
        <div className="mt-2 flex flex-wrap gap-2">{recent.map((item) => <button key={item.id} type="button" onClick={() => repeatFood(item)} className="min-h-11 rounded-2xl border border-line px-3 text-sm">+ {item.name} {item.label ?? `${item.grams}克`}</button>)}</div>
      </section>}
      {query.trim() && parseFoodLine(query).length === 0 && hits.length > 1 && <div className="mt-2 flex flex-wrap gap-2" aria-label="食物匹配建议">{hits.map((hit, index) => <button type="button" key={`${hit.name}-${index}`} className="min-h-11 rounded-2xl border border-line px-3 text-sm" onClick={() => { setPending([hit]); setFoodError(""); }}>{hit.name} · {hit.label} · {hit.kcal}千卡</button>)}</div>}
      <button type="button" aria-expanded={showMeals} onClick={() => setShowMeals((value) => !value)} className="mt-4 flex min-h-11 w-full items-center justify-between rounded-card border border-line px-4 text-sm font-bold">今日饮食明细（{today.length} 条）<span>{showMeals ? "收起" : "查看"}</span></button>
      {showMeals ? <ul className="mt-2 flex flex-col gap-3">
        {MEALS.map((name) => {
          const items = today.filter((item) => item.meal === name);
          const sum = items.reduce((total, item) => total + (item.kcal ?? 0), 0);
          return (
            <li key={name} className="rounded-card border border-line bg-surface p-3">
              <p className="text-sm font-bold">
                {name}
                <span className="ml-2 font-normal text-muted">{sum} 千卡</span>
              </p>
              {items.length ? (
                <ul className="mt-2 flex flex-col">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 border-b border-line py-1 text-sm last:border-0">
                      <span className="min-w-0 flex-1 truncate">
                        {item.name} {item.label ?? (item.grams ? `${item.grams}克` : "")}
                      </span>
                      <span className="shrink-0 text-muted">
                        {item.kcal}
                        {item.protein != null ? ` · ${Math.round(item.protein)}克` : ""}
                      </span>
                      <button type="button" className="h-11 shrink-0 px-2 text-muted" onClick={() => {
                        const saved = removeEntry(item.id)
                        if (!saved) return setFoodError("没有删除。原来的食物记录还在。")
                        setEntries(saved)
                        onSaved?.()
                      }}>
                        删
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">还没记</p>
              )}
            </li>
          );
        })}
      </ul> : null}
      {races.length ? (
        <ul className="mt-4 flex flex-col gap-2">
          {races.map((mark) => (
            <li key={mark.meters} className="text-sm text-muted">
              {distanceLabel(mark.meters)}
              {mark.goal ? ` 目标 ${mark.goal}` : ""}
              {mark.deadline ? ` · ${mark.deadline} 前` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={onEdit} className="mt-4 h-11 text-sm font-bold text-accent">
        改体重目标和每天热量
      </button>
    </div>
  );
}
