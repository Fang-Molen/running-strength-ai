import { useEffect, useRef, useState } from "react"
import { emptySets, deviationOf, executionOf, mainDeviation, mergeSets, outcomeReason, recordSet, setLine, stepRest, totalsOf, type SetRecord } from "@/lib/core/execution"
import { completeTraining, interruptTraining, recordPain } from "@/lib/core/training-decision"
import { getTrainingOccurrence, closeTrainingOccurrence } from "@/lib/core/occurrence"
import { ExerciseContent } from "@/components/exercise-content"
import { nextRunnerCursor, runnerInput } from "@/lib/strength/runner-input"
import { displayName, type Move, type Session } from "@/lib/strength/model"
import { decodeRest, restKey, restRemaining, type RestCheckpoint } from "@/lib/core/rest-clock"

export function completeFromRunner(input: Parameters<typeof completeTraining>[0]) {
  const event = completeTraining(input)
  if(!event)return null
  const closed=closeTrainingOccurrence(event)
  return closed && getTrainingOccurrence(closed.trainingOccurrenceId)?.closeEventId === event.event_id ? event : null
}

export function interruptFromRunner(decisionId: string, sessionId: string) {
  const event = interruptTraining(decisionId, sessionId)
  if(!event)return null
  const closed=closeTrainingOccurrence(event)
  return closed && getTrainingOccurrence(closed.trainingOccurrenceId)?.closeEventId === event.event_id ? event : null
}

export function TrainingRunner(props: {session: Session; decisionId: string; onDone: (result: {completed:boolean; interrupted:boolean; sets:SetRecord[]; pain:boolean})=>void}) {
  const [inspect,setInspect] = useState<Move|null>(null)
  const trigger = useRef<HTMLElement|null>(null)
  return <><div inert={inspect ? true : undefined}><TrainingRunnerInner {...props} onInspect={move=>{trigger.current=document.activeElement as HTMLElement;setInspect(move)}} /></div>{inspect?<div role="dialog" aria-modal="true" aria-label={displayName(inspect)} className="fixed inset-0 z-50 flex flex-col bg-bg"><div className="flex items-center justify-between gap-3 border-b border-line p-4"><h2 className="font-bold">{displayName(inspect)}</h2><button type="button" autoFocus className="min-h-11 px-3" onClick={()=>{setInspect(null);trigger.current?.focus()}}>返回当前组</button></div><div className="flex-1 overflow-y-auto p-4"><ExerciseContent key={inspect.id} catalogId={inspect.catalogId}/></div></div>:null}</>
}

function TrainingRunnerInner({
  session,
  decisionId,
  onDone,
  onInspect,
}: {
  onInspect: (move: Move) => void
  session: Session
  decisionId: string
  onDone: (result: { completed: boolean; interrupted: boolean; sets: SetRecord[]; pain: boolean }) => void
}) {
  const [sets, setSets] = useState<SetRecord[]>(() => mergeSets(emptySets(session), executionOf(session.id).sets))
  const [cursor, setCursor] = useState(0)
  const [phase, setPhase] = useState<"work" | "rest" | "edit" | "skip-ask" | "move-ask" | "finish-ask" | "paused">("work")
  const [restSeconds, setRestSeconds] = useState<number | null>(null)
  const [restRunning, setRestRunning] = useState(false)
  const restDeadline = useRef<number | null>(null)
  const restRemainingMs = useRef(0)
  const restTargetKey = useRef<string|null>(null)
  const [lastNote, setLastNote] = useState<string | null>(null)
  const [draftWeight, setDraftWeight] = useState("")
  const [draftAmount, setDraftAmount] = useState("")
  const [draftSetKey,setDraftSetKey]=useState("")
  const [pain, setPain] = useState(false)
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  const [restored, setRestored] = useState(false)
  const [saveError, setSaveError] = useState("")
  const timerKey = restKey(decisionId, session.id)
  const setKey = (set: SetRecord) => `${set.moveId}:${set.setIndex}`
  function clearRest() { try { window.localStorage.removeItem(timerKey) } catch { /* storage unavailable */ } }
  function saveRest(nextSetKey: string, remainingMs: number, deadlineMs: number | null, running: boolean) {
    const snapshot: RestCheckpoint = { version: 1, decisionId, sessionId: session.id, nextSetKey, remainingMs, deadlineMs, running }
    try { window.localStorage.setItem(timerKey, JSON.stringify(snapshot)) } catch { /* storage unavailable */ }
  }

  useEffect(() => {
    const merged = mergeSets(emptySets(session), executionOf(session.id).sets)
    const next = merged.findIndex((set) => !set.completed && !set.skipped)
    setSets(merged)
    setCursor(next < 0 ? 0 : next)
    setRestored(merged.some((set) => set.completed || set.skipped))
    // Restore only if the referenced next set is still open in this exact session/decision.
    let snapshot: RestCheckpoint | null = null
    try { snapshot = decodeRest(window.localStorage.getItem(timerKey), decisionId, session.id) } catch { /* storage unavailable */ }
    const target = snapshot ? merged.findIndex((set) => setKey(set) === snapshot.nextSetKey && !set.completed && !set.skipped) : -1
    if (snapshot && target >= 0) {
      const remaining = restRemaining(snapshot, Date.now())
      restRemainingMs.current = remaining
      restDeadline.current = snapshot.running && remaining > 0 ? snapshot.deadlineMs : null
      setRestSeconds(Math.ceil(remaining / 1000))
      setRestRunning(snapshot.running && remaining > 0)
      restTargetKey.current=snapshot.nextSetKey
      setCursor(target)
      setPhase("rest")
    } else if (snapshot) clearRest()
  }, [session, decisionId])

  useEffect(() => {
    const set = sets[cursor]
    if (!set) return
    const key=`fr255-runner-draft-v1:${decisionId}:${session.id}:${setKey(set)}`
    let draft: {weight:string;amount:string}|null=null
    try { const raw=localStorage.getItem(key); if(raw){const parsed=JSON.parse(raw);if(typeof parsed.weight==='string' && typeof parsed.amount==='string')draft=parsed} } catch { /* invalid drafts cannot become facts */ }
    setDraftWeight(draft?.weight ?? String(set.plannedWeight))
    setDraftAmount(draft?.amount ?? String(set.plannedAmount))
    setDraftSetKey(key)
  }, [cursor,decisionId,session.id])

  useEffect(()=>{
    const set=sets[cursor]
    if(!set)return
    const key=`fr255-runner-draft-v1:${decisionId}:${session.id}:${setKey(set)}`
    if(key!==draftSetKey || set.completed || set.skipped)return
    try {localStorage.setItem(key,JSON.stringify({weight:draftWeight,amount:draftAmount}))} catch {setSaveError('输入草稿暂不能恢复，尚未记录为完成。请保持此页并检查存储。')}
  },[draftWeight,draftAmount,draftSetKey,cursor,decisionId,session.id])

  useEffect(() => {
    saving.current = false
  }, [cursor, phase])

  // Wall-clock deadline survives screen lock / browser timer throttling.
  useEffect(() => {
    if (phase !== "rest" || !restRunning || restDeadline.current === null) return
    const sync = () => {
      const remaining = Math.max(0, restDeadline.current! - Date.now())
      setRestSeconds(Math.ceil(remaining / 1000))
      if (remaining === 0) { restRemainingMs.current = 0; restDeadline.current = null; setRestRunning(false); if(restTargetKey.current)saveRest(restTargetKey.current,0,null,false) }
    }
    sync()
    const timer = window.setInterval(sync, 250)
    document.addEventListener("visibilitychange", sync)
    window.addEventListener("focus", sync)
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", sync); window.removeEventListener("focus", sync) }
  }, [phase, restRunning])

  function pauseRest() {
    if (restDeadline.current !== null) restRemainingMs.current = Math.max(0, restDeadline.current - Date.now())
    restDeadline.current = null
    setRestSeconds(Math.ceil(restRemainingMs.current / 1000))
    setRestRunning(false)
    saveRest(restTargetKey.current ?? setKey(sets[cursor]), restRemainingMs.current, null, false)
  }

  function resumeRest() {
    if (restRemainingMs.current <= 0) return
    restDeadline.current = Date.now() + restRemainingMs.current
    saveRest(restTargetKey.current ?? setKey(sets[cursor]), restRemainingMs.current, restDeadline.current, true)
    setRestRunning(true)
  }

  const current = sets[cursor]
  if (!current) return null
  const moveSets = sets.filter((set) => set.moveId === current.moveId)
  const open = sets.filter((set) => !set.completed && !set.skipped).length
  const handled = sets.length - open
  const moveName = displayName(session.moves.find((move) => move.id === current.moveId) ?? session.moves[0])
  const nextOpen = sets.find(set=>setKey(set)===restTargetKey.current && !set.completed && !set.skipped) ?? sets.find((set, index) => index > cursor && !set.completed && !set.skipped)
  const nextPlanText = nextOpen ? `${nextOpen.plannedWeight > 0 ? `${nextOpen.plannedWeight} kg × ` : "自重 × "}${nextOpen.plannedAmount}${nextOpen.mode === "seconds" ? " 秒" : ""}` : "所有组已处理"

  function write(next: SetRecord) {
    if (!recordSet(session.id, decisionId, next)) { setSaveError("本组没有保存，输入保留，请重试。"); saving.current=false; return null }
    setSaveError("")
    try {localStorage.removeItem(`fr255-runner-draft-v1:${decisionId}:${session.id}:${setKey(next)}`)}catch{/* optional draft cleanup */}
    const merged = sets.map((set) => (set.moveId === next.moveId && set.setIndex === next.setIndex ? next : set))
    setSets(merged)
    return merged
  }

  function finishCurrent(actualWeight: number, actualAmount: number, source: SetRecord["source"], modified: boolean) {
    if (saving.current) return
    saving.current = true
    const recorded = { ...current, actualWeight, actualAmount, completed: true, skipped: false, modified, source, timestamp: new Date().toISOString() }
    const gap = deviationOf(recorded)
    setLastNote(gap.amount == null ? null : `${gap.amount > 0 ? "+" : ""}${gap.amount}`)
    const next = write(recorded)
    if (!next) return
    const following = next.findIndex((set, index) => index > cursor && !set.completed && !set.skipped)
    if (current.restSec > 0 && following >= 0) {
      restRemainingMs.current = current.restSec * 1000
      restDeadline.current = Date.now() + restRemainingMs.current
      restTargetKey.current=setKey(next[following])
      saveRest(restTargetKey.current, restRemainingMs.current, restDeadline.current, true)
      setRestSeconds(current.restSec)
      setRestRunning(true)
      setPhase("rest")
      return
    }
    if (following >= 0) setCursor(following)
    else {
      const firstOpen = next.findIndex((set) => !set.completed && !set.skipped)
      if (firstOpen >= 0) setCursor(firstOpen)
    }
    setPhase("work")
  }

  function skipCurrent() {
    if (saving.current) return
    saving.current = true
    const next = write({ ...current, skipped: true, completed: false, timestamp: new Date().toISOString() })
    if (!next) return
    const following = next.findIndex((set) => !set.completed && !set.skipped)
    setPhase("work")
    if (following >= 0) setCursor(following)
  }

  function skipMove() {
    if(saving.current)return
    saving.current=true
    let merged = sets
    for (const set of sets.filter((item) => item.moveId === current.moveId && !item.completed && !item.skipped)) {
      const next = { ...set, skipped: true, completed: false, timestamp: new Date().toISOString() }
      if(!recordSet(session.id, decisionId, next)){setSets(merged);setSaveError("部分组未保存，已保存组保留，请重试。");saving.current=false;return}
      merged = merged.map((item) => (item.moveId === next.moveId && item.setIndex === next.setIndex ? next : item))
    }
    setSets(merged)
    const following = merged.findIndex((set) => !set.completed && !set.skipped)
    setPhase("work")
    if (following >= 0) setCursor(following)
  }

  function goNext() {
    const following = nextRunnerCursor(sets.map(set=>({key:setKey(set),handled:set.completed||set.skipped})),cursor,restTargetKey.current)
    if (following >= 0) setCursor(following)
    restTargetKey.current=null
    setPhase("work")
    clearRest()
    restDeadline.current = null
    restRemainingMs.current = 0
    setRestRunning(false)
    setRestSeconds(null)
  }

  const planText = `${current.plannedWeight > 0 ? `${current.plannedWeight} kg × ` : "自重 × "}${current.plannedAmount}${current.mode === "seconds" ? " 秒" : ""}`

  if (phase === "paused") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-bg px-5 pt-4">
        <p className="text-sm text-muted">暂停</p>{saveError?<p role="alert" className="text-sm text-risk">{saveError}</p>:null}
        <h2 className="mt-2 text-2xl font-bold">{displayName(session.moves.find((move) => move.id === current.moveId) ?? session.moves[0])}</h2>
        <p className="mt-1 text-sm text-muted">第 {current.setIndex} / {moveSets.length} 组还没记完</p>
        <button type="button" className="mt-8 h-14 rounded-2xl bg-accent text-base font-bold text-accent-fg" onClick={() => setPhase("work")}>继续训练</button>
        <button type="button" className="mt-3 h-11 text-sm text-risk" onClick={() => { if(!interruptFromRunner(decisionId, session.id)){setSaveError("结束未核实保存，请重试。");return;} clearRest(); onDone({ completed: false, interrupted: true, sets, pain }) }}>结束训练</button>
      </div>
    )
  }

  if (phase === "rest") {
    const clock = restSeconds ?? 0
    const over = clock === 0
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-bg px-5 pt-8">
        <p className="text-sm text-muted">{!over && !restRunning ? "已暂停" : "休息"}</p>
        <p className="mt-2 text-7xl font-bold tracking-tight" aria-live="polite">{over ? "休息结束" : formatClock(clock)}</p>
        {lastNote ? <p className="mt-3 text-sm text-muted">上一组和计划相差 {lastNote}</p> : null}
        <p className="mt-6 text-sm text-muted">下一组</p>
<p className="text-xl font-bold">{sets.find(x=>setKey(x)===restTargetKey.current)?.name} · {nextPlanText}</p>
        <button type="button" className="min-h-11 text-sm" onClick={()=>onInspect(session.moves.find(m=>m.id===(sets.find(x=>setKey(x)===restTargetKey.current)?.moveId??current.moveId))!)}>查看下一组动作说明</button>
        <button type="button" className="mt-8 h-14 rounded-2xl bg-accent text-base font-bold text-accent-fg" onClick={goNext}>下一组</button>
        <div className="mt-3 flex gap-2">
          <button type="button" className="h-12 flex-1 rounded-2xl border border-line text-sm" onClick={pauseRest} disabled={!restRunning || over}>暂停</button>
          <button type="button" className="h-12 flex-1 rounded-2xl border border-line text-sm" onClick={resumeRest} disabled={restRunning || over}>继续</button>
        </div>
      </div>
    )
  }

  if (phase === "edit") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-bg px-5 pt-4">
        <p className="text-sm font-bold">修改本组</p>{saveError?<p role="alert" className="text-sm text-risk">{saveError}</p>:null}
        <label className="mt-4 text-sm text-muted">实际重量
          <input value={draftWeight} inputMode="decimal" onChange={(event) => setDraftWeight(event.target.value)} className="mt-1 h-12 w-full rounded-2xl border border-line bg-surface px-3 text-lg outline-none" />
        </label>
        <label className="mt-3 text-sm text-muted">{current.mode === "seconds" ? "实际秒数" : "实际次数"}
          <input value={draftAmount} inputMode="numeric" onChange={(event) => setDraftAmount(event.target.value)} className="mt-1 h-12 w-full rounded-2xl border border-line bg-surface px-3 text-lg outline-none" />
        </label>
        <button type="button" className="mt-6 h-12 rounded-2xl bg-accent font-bold text-accent-fg" onClick={() => {
          const input=runnerInput(draftWeight,draftAmount,current.mode)
          if(!input){setSaveError("请填写有效的实际重量和次数/秒数，空白不是 0。");return}
          const {weight,amount}=input
          finishCurrent(weight, amount, "user_entered", weight !== current.plannedWeight || amount !== current.plannedAmount)
        }}>保存</button>
        <button type="button" className="mt-2 h-11 text-sm text-muted" onClick={() => setPhase("work")}>取消</button>
      </div>
    )
  }

  if (phase === "skip-ask" || phase === "move-ask" || phase === "finish-ask") {
    const title = phase === "skip-ask" ? `跳过第 ${current.setIndex} 组？` : phase === "move-ask" ? "跳过这个动作？" : `还有 ${open} 组未处理`
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end bg-bg/80 px-5 pb-8">
        <div className="rounded-card bg-surface p-4">
          <p className="font-bold">{title}</p>{saveError?<p role="alert" className="text-sm text-risk">{saveError}</p>:null}
          <p className="mt-1 text-sm text-muted">{phase === "finish-ask" ? "现在结束会保留已做的组，未做的组明确标为跳过；不会显示全部完成。" : "没做也会留下，不会从结果里删掉。"}</p>
          <button type="button" disabled={busy} className="mt-4 h-12 w-full rounded-2xl bg-accent font-bold text-accent-fg disabled:opacity-60" onClick={() => {
            if (phase === "skip-ask") skipCurrent()
            else if (phase === "move-ask") skipMove()
            else finishSaved(() => {
              let merged = sets
              for (const set of sets.filter((item) => !item.completed && !item.skipped)) {
                const next = { ...set, skipped: true, completed: false, timestamp: new Date().toISOString() }
                if(!recordSet(session.id, decisionId, next)){setSets(merged);setSaveError("部分组未保存，已保存组保留，请重试。");return null}
                merged = merged.map((item) => (item.moveId === next.moveId && item.setIndex === next.setIndex ? next : item))
              }
              setSets(merged)
              return { completed: true, interrupted: false, sets: merged, pain }
            })
          }}>{busy ? "正在保存" : phase === "finish-ask" ? "结束并保存部分执行" : "跳过"}</button>
          <button type="button" className="mt-2 h-11 w-full text-sm" onClick={() => setPhase("work")}>取消</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg px-5 pt-4 pb-6" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">正在训练</p>
        <span className="text-sm text-muted" aria-live="polite">已处理 {handled} / {sets.length} 组</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={sets.length} aria-valuenow={handled} aria-label="训练组进度">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${sets.length ? handled / sets.length * 100 : 0}%` }} />
      </div>
      <details className="mt-3 rounded-card border border-line bg-surface px-3 py-2">
        <summary className="min-h-11 cursor-pointer text-sm font-bold">查看完整力量课表</summary>
        <ol className="mt-2 space-y-2 pb-2">
          {session.moves.map((move, index) => (
            <li key={move.id} className="text-sm">
              <button type="button" className="min-h-11 text-left font-bold" onClick={()=>onInspect(move)}>{index + 1}. {displayName(move)}</button>
              <span className="mt-0.5 block text-muted">{move.sets} 组 × {move.amount} {move.mode === "seconds" ? "秒" : "次"}{move.weightKg > 0 ? ` · ${move.weightKg} kg` : " · 自重"} · 组间 {move.restSec} 秒</span>
            </li>
          ))}
        </ol>
        <p className="pb-2 text-xs text-muted">只显示已保存的力量安排。这里没有的跑步分段不会编造。返回这一页不会重写已记录的组。</p>
      </details>
      <p className="mt-5 text-sm font-bold text-accent">当前这一组</p>
      <button type="button" className="mt-1 min-h-12 text-left text-3xl font-bold" onClick={()=>onInspect(session.moves.find(m=>m.id===current.moveId)!)}>{moveName} · 第 {current.setIndex} / {moveSets.length} 组</button>
      <p className="mt-1 text-xs text-muted">点击动作查看步骤，返回后输入与休息继续保留。</p>
      <p className="mt-2 text-sm text-muted">{session.moves.find(m=>m.id===current.moveId)?.executionNote}</p>
      {saveError?<p role="alert" className="mt-2 text-sm text-risk">{saveError}</p>:null}
      {restored ? <p className="mt-2 text-sm text-muted">已从本机恢复未完成的训练。已记录的组不会重写，未记录的仍是未记录。</p> : null}
      <p className="mt-6 text-sm text-muted">计划</p>
      <p className="text-2xl font-bold">{planText}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-sm text-muted">实际重量
          <input aria-label="实际重量" value={draftWeight} inputMode="decimal" onChange={(event) => setDraftWeight(event.target.value)} className="mt-1 h-14 w-full rounded-2xl border border-line bg-surface px-3 text-2xl font-bold outline-none" />
        </label>
        <label className="text-sm text-muted">{current.mode === "seconds" ? "实际秒数" : "实际次数"}
          <input aria-label={current.mode === "seconds" ? "实际秒数" : "实际次数"} value={draftAmount} inputMode="numeric" onChange={(event) => setDraftAmount(event.target.value)} className="mt-1 h-14 w-full rounded-2xl border border-line bg-surface px-3 text-2xl font-bold outline-none" />
        </label>
      </div>
      <p className="mt-2 text-sm text-muted">还没改的话，完成时按计划记下。空着或写错不会假装已完成。</p>
      {open === 0 ? (
        <button type="button" disabled={busy} className="mt-8 h-16 rounded-2xl bg-accent text-lg font-bold text-accent-fg disabled:opacity-60" onClick={() => finishSaved(() => ({ completed: true, interrupted: false, sets, pain }))}>{busy ? "正在保存" : "结束并保存训练"}</button>
      ) : current.completed || current.skipped ? (
        <button type="button" className="mt-8 h-16 rounded-2xl bg-accent text-lg font-bold text-accent-fg" onClick={() => { const firstOpen = sets.findIndex((set) => !set.completed && !set.skipped); if (firstOpen >= 0) setCursor(firstOpen) }}>去未完成的组</button>
      ) : (
        <button type="button" className="mt-8 h-16 rounded-2xl bg-accent text-lg font-bold text-accent-fg" onClick={() => {
          const input=runnerInput(draftWeight,draftAmount,current.mode)
          if(!input){setSaveError("请填写有效的实际重量和次数/秒数，空白不是 0。");return}
          const {weight,amount}=input
          finishCurrent(weight, amount, weight === current.plannedWeight && amount === current.plannedAmount ? "user_confirmed_plan" : "user_entered", weight !== current.plannedWeight || amount !== current.plannedAmount)
        }}>完成本组</button>
      )}
      {open > 0 ? <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" className="h-12 rounded-2xl border border-line text-sm" onClick={() => { setDraftWeight(String(current.actualWeight ?? current.plannedWeight)); setDraftAmount(String(current.actualAmount ?? current.plannedAmount)); setPhase("edit") }}>改记</button>
        <button type="button" className="h-12 rounded-2xl border border-line text-sm" onClick={() => setPhase("skip-ask")}>跳过</button>
        <button type="button" className="h-12 rounded-2xl border border-line text-sm" onClick={() => setPhase("paused")}>暂停</button>
      </div> : null}
      {open > 0 ? <button type="button" className="mt-2 h-11 text-sm text-muted" onClick={() => setPhase("move-ask")}>跳过这个动作</button> : null}
      <button type="button" className="h-11 text-sm text-muted" onClick={() => { if(recordPain(decisionId, session.id)){setPain(true);setSaveError("");}else setSaveError("疼痛反馈没有保存，请重试；有疼痛时先暂停。"); }}>记疼痛</button>
      {open > 0 ? <button type="button" className="mt-2 h-11 rounded-2xl border border-line text-sm" onClick={() => setPhase("finish-ask")}>提前结束本次训练</button> : null}
    </div>
  )

  function finishSaved(result: () => { completed: boolean; interrupted: boolean; sets: SetRecord[]; pain: boolean } | null) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    const next = result()
    if(!next){saving.current=false;setBusy(false);return}
    const saved = completeFromRunner({ decisionId, sessionId: session.id, planned: null, actualSets: next.sets.filter((set) => set.completed).length, actualAmount: current.actualAmount, actualWeightKg: current.actualWeight, rpe: null, pain: next.pain, modified: next.sets.some((set) => set.modified), interrupted: false, partial: next.sets.some(set=>!set.completed || set.skipped) })
    if(!saved){setSaveError("结束事件或课次状态未核实保存，已记录组保留，请重试。");saving.current=false;setBusy(false);return}
    clearRest()
    onDone(next)
  }

  function closeAll() {
    return { completed: true, interrupted: false, sets, pain }
  }
}

function formatClock(seconds: number) {
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

export function resultLines(sets: SetRecord[], pain: boolean) {
  const totals = totalsOf(sets)
  const moves = new Set(sets.map((set) => set.moveId))
  const doneMoves = [...moves].filter((id) => sets.filter((set) => set.moveId === id).every((set) => set.completed || set.skipped) && sets.some((set) => set.moveId === id && set.completed)).length
  return {
    moves: `${doneMoves} / ${moves.size} 动作`,
    sets: `${totals.done} / ${sets.length}`,
    skipped: totals.skipped,
    planned: totals.planned == null ? "Unknown" : String(totals.planned),
    actual: totals.actual == null ? "Unknown" : String(totals.actual),
    deviation: mainDeviation(sets),
    lines: sets.map(setLine),
    reason: outcomeReason({ pain, stated: null }),
  }
}
