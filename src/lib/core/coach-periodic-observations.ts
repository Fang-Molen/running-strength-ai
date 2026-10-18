import { parseCsvPreview } from '../ui/device-csv-preview.ts'

/** Derived weekly CSV only. No activity import, athlete binding, scoring or plan writes. */
export function analyzePeriodicObservations(csv: string, sourceId: string, cycleId?: string) {
  const parsed = parseCsvPreview(csv, 10000)
  const required = ['week_start', 'week_end', 'cycle_id', 'activity_count', 'running_sessions', 'rhr_days', 'rhr_mean']
  if (!required.every(k => parsed.headers.includes(k))) return null
  if (!sourceId.trim() || parsed.warnings.length || new Set(parsed.headers).size !== parsed.headers.length || parsed.totalRows > 10000) throw Error('周期 CSV 表头、来源或行结构不完整')
  const rows = parsed.rows.map(cells => Object.fromEntries(parsed.headers.map((key, i) => [key, cells[i]])))
  const day = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s
  if (rows.some(r => !day(r.week_start) || !day(r.week_end) || r.week_start > r.week_end) || new Set(rows.map(r => r.week_start)).size !== rows.length) throw Error('周日期无效或重复；不能合并可能重叠的运动员或设备数据')
  const selected = rows.filter(r => cycleId === undefined || r.cycle_id === cycleId).sort((a,b) => a.week_start.localeCompare(b.week_start))
  if (!selected.length) throw Error('没有对应观察窗口')
  const numeric = (s: string, integer = false): number | null => {
    if (s == null || !s.trim() || /^(UNKNOWN|UNAVAILABLE|NA|NaN)$/i.test(s.trim())) return null
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0 || integer && !Number.isInteger(n)) throw Error('周期 CSV 数值无效')
    return n
  }
  const records = selected.map(r => {
    const activities = numeric(r.activity_count,true), running = numeric(r.running_sessions,true), days = numeric(r.rhr_days,true), rhr = numeric(r.rhr_mean)
    if (days !== null && days > 7 || running !== null && activities !== null && running > activities || rhr !== null && (days === null || days === 0)) throw Error('周期 CSV 覆盖天数或计数关系冲突')
    return {activities,running,days,rhr}
  })
  const sum = (values: (number|null)[]) => values.some(v => v === null) ? null : values.reduce<number>((a,b) => a + b!,0)
  const activityCount = sum(records.map(r=>r.activities)), runningActivityCount = sum(records.map(r=>r.running))
  const rhrWeeks = records.filter(r=>r.rhr !== null), rhrWeeklyMean = rhrWeeks.length ? rhrWeeks.reduce((n,r)=>n+r.rhr!,0)/rhrWeeks.length : null
  const emptyWeeks = records.filter(r=>r.activities===0).length
  const facts = `${selected.length}个自然周，活动汇总${activityCount??'未完整记录'}条，其中标记跑步${runningActivityCount??'未完整记录'}条；${emptyWeeks}周明确无活动记录。${rhrWeeks.length}周有静息心率周均值${rhrWeeklyMean===null?'':`，这些周均值的算术平均为${rhrWeeklyMean.toFixed(2)} bpm`}。`
  return {
    kind:'DERIVED_WEEKLY_OBSERVATIONS' as const,sourceId,cycleIds:[...new Set(rows.map(r=>r.cycle_id))],cycleId:cycleId??null,
    start:selected[0].week_start,end:selected.at(-1)!.week_end,weeks:selected.length,activityCount,runningActivityCount,
    confirmedTrainingSessions:null,emptyWeeks,rhrObservedDays:sum(records.map(r=>r.days)),rhrWeeks:rhrWeeks.length,rhrWeeklyMean,
    missingActivityWeeks:records.filter(r=>r.activities===null).length,
    phase:'UNKNOWN' as const,purpose:'UNKNOWN' as const,fatigue:'UNKNOWN' as const,recovery:'UNKNOWN' as const,
    athleteBinding:'UNCONFIRMED' as const,deviceProtocol:'UNKNOWN' as const,rawUnitsVerified:false,
    abilityAxes:['SPD','SEN','AER','PWR','ECO'].map(axis=>({axis,status:'待评估',score:null,trend:null})),
    planWrite:false as const,storageWrite:false as const,
    text:`本次事实：${facts}\n训练目的：待确认；四周观察窗口不是已确认的训练周期。\n可能解释：记录数量的变化可能来自实际活动变化，也可能来自设备、同步或记录覆盖变化；需原始活动和同期课表反证。\n不确定性：活动条数不是训练课次数，空白周不证明休息或受伤。周均值平均不等于逐日原始心率平均，不能诊断疲劳或恢复。缺少运动员身份、设备协议及逐圈结构核验，五维能力均待评估，不评分、不推算跑量或配速。\n下一步具体观察：对照同一人的原始活动、重复文件、逐圈和同期课表，确认本窗口原计划目的；核实前不调整训练。`,
  }
}
