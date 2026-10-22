import { currentAthleteId, EVENTS_KEY, EVENT_JOURNAL_PREFIX } from '../core/events'
import { currentStore } from '../core/storage'
import { storeKeys } from '../core/storage-journal'
import { RUNNING_TRANSACTION_PREFIX, validRunningTransaction, type RunningTransaction } from '../core/running-transaction'
import { calendarDay } from '../core/coach-calendar'
import { validDay, shiftDay } from '../health/observation'
import { loadEntries, nutrientOf, aggregate, validFoodEntry, type FoodEntry, type NutrientKey } from '../nutrition/log'
import { loadChecks, type BodyCheck } from '../nutrition/body'

type Facts = { summary: string[]; details: string[] }
type Readable = { food: boolean; body: boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const owned = (row: { athleteId?: string }, athlete: string) => row.athleteId ? row.athleteId === athlete : athlete === 'local'
const validBody = (v: unknown): v is BodyCheck => object(v) && typeof v.id === 'string' && typeof v.date === 'string' && validDay(v.date) && typeof v.weight === 'number' && Number.isFinite(v.weight) && v.weight > 0
const validFood = (v: unknown): v is FoodEntry => object(v) && validFoodEntry(v as FoodEntry)

/** The legacy readers preserve damaged storage but otherwise return an empty view.
 * Inspect only their source envelopes here so an unreadable view is not sent as an absence claim. */
function readableSources(athlete: string): Readable {
  const state: Readable = { food: true, body: true }
  const unknown = () => { state.food = false; state.body = false }
  for (const [key, domain, valid] of [
    ['fr255-food-log-v1', 'food', validFood],
    ['fr255-body-v1', 'body', validBody],
  ] as const) {
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
      if (!raw) continue
      const rows: unknown = JSON.parse(raw)
      if (!Array.isArray(rows) || rows.some(row => !object(row) || owned(row, athlete) && !valid(row))) state[domain] = false
    } catch { state[domain] = false }
  }
  const checkEvent = (event: unknown) => {
    if (!object(event) || typeof event.event_type !== 'string') { unknown(); return }
    if (event.athlete_id !== athlete) return
    const domain = event.event_type === 'NUTRITION_RECORDED' ? 'food' : event.event_type === 'BODY_MEASUREMENT_RECORDED' ? 'body' : null
    if (!domain) return
    const payload = event.payload
    if (!object(payload)) { state[domain] = false; return }
    if (domain === 'food') {
      if (payload.foodEntry !== undefined && (!validFood(payload.foodEntry) || payload.foodEntry.athleteId !== athlete)) state.food = false
      if (payload.foodEntries !== undefined && (!Array.isArray(payload.foodEntries) || payload.foodEntries.some(row => !validFood(row) || row.athleteId !== athlete))) state.food = false
      if (payload.removedFoodId !== undefined && typeof payload.removedFoodId !== 'string') state.food = false
      if (payload.removedFoodIds !== undefined && (!Array.isArray(payload.removedFoodIds) || payload.removedFoodIds.some(id => typeof id !== 'string'))) state.food = false
    } else {
      if (payload.bodyCheck !== undefined && (!validBody(payload.bodyCheck) || payload.bodyCheck.athleteId !== athlete)) state.body = false
      if (payload.removedCheckDate !== undefined && (typeof payload.removedCheckDate !== 'string' || !validDay(payload.removedCheckDate))) state.body = false
    }
  }
  try {
    const store = currentStore()
    if (!store) { unknown(); return state }
    const raw = store.getItem(EVENTS_KEY)
    if (raw) {
      const envelope: unknown = JSON.parse(raw)
      if (!object(envelope) || !Array.isArray(envelope.data)) unknown()
      else envelope.data.forEach(checkEvent)
    }
    for (const key of storeKeys(store)) {
      if (!key.startsWith(EVENT_JOURNAL_PREFIX) && !key.startsWith(RUNNING_TRANSACTION_PREFIX)) continue
      const rawEntry = store.getItem(key)
      const entry: unknown = rawEntry === null ? null : JSON.parse(rawEntry)
      if (!object(entry) || entry.schemaVersion !== 1 || typeof entry.id !== 'string' || typeof entry.order !== 'number' || !Number.isFinite(entry.order) || entry.data == null) { unknown(); continue }
      if (key.startsWith(EVENT_JOURNAL_PREFIX)) checkEvent(entry.data)
      else if (validRunningTransaction(entry.data as RunningTransaction)) (entry.data as RunningTransaction).events.forEach(checkEvent)
      else unknown()
    }
  } catch { unknown() }
  return state
}

const timeKnown = (value: string | undefined) => typeof value === 'string' && value.trim().length > 0
const availableAt = (value: string | undefined, cutoff: number) => !timeKnown(value) || Number.isFinite(Date.parse(value!)) && Date.parse(value!) <= cutoff
const number = (value: number) => Number.isFinite(value) ? String(Number(value.toFixed(1))) : '未知'
const name = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
function nutrientLine(row: FoodEntry, key: NutrientKey, label: string, unit: string): string {
  const value = nutrientOf(row, key)
  return value === null ? `${label}未知` : `${label}${number(value)}${unit}`
}
function mealLine(row: FoodEntry): string {
  return `餐食 ${row.date} ${row.meal} ${name(row.name)}；${[
    nutrientLine(row, 'kcal', '热量', '千卡'), nutrientLine(row, 'protein', '蛋白质', '克'),
    nutrientLine(row, 'carb', '碳水', '克'), nutrientLine(row, 'fat', '脂肪', '克'),
  ].join('，')}${timeKnown(row.recordedAt) ? '' : '；保存时间未知（旧记录）'}${row.eatenAt ? '' : '；进食时刻未知'}。`
}

/** Fresh, athlete-scoped nutrition facts for the default online chat, independent of a training link.
 * Only nutrition values, food names and dated measured weight leave this boundary. */
export function onlineNutritionFacts(day: string, asOf: string): Facts {
  const facts: Facts = { summary: [], details: [] }, cutoff = Date.parse(asOf), cutoffDay = calendarDay(asOf)
  if (!validDay(day) || !Number.isFinite(cutoff) || !cutoffDay || day > cutoffDay) {
    facts.summary.push('饮食与体重记录读取失败：分析日期或时点无效，不能判断记录是否存在。')
    return facts
  }
  const athlete = currentAthleteId(), readable = readableSources(athlete), from = shiftDay(day, -6)
  let meals: FoodEntry[] = [], checks: BodyCheck[] = []
  if (readable.food) try {
    meals = loadEntries().filter(row => owned(row, athlete) && validFood(row) && row.date <= day && availableAt(row.recordedAt, cutoff) && availableAt(row.eatenAt, cutoff))
      .sort((a, b) => b.date.localeCompare(a.date) || (Date.parse(b.recordedAt ?? '') || 0) - (Date.parse(a.recordedAt ?? '') || 0))
  } catch { readable.food = false }
  if (readable.body) try {
    checks = loadChecks().filter(row => owned(row, athlete) && validBody(row) && row.date <= day && availableAt(row.recordedAt, cutoff)).sort((a, b) => a.date.localeCompare(b.date))
  } catch { readable.body = false }

  if (!readable.food) facts.summary.push('饮食记录读取失败，记录数量及摄入情况暂时无法确认；不能把读取失败解释为没有记录。')
  else {
    const today = meals.filter(row => row.date === day), recent = meals.filter(row => row.date >= from), daily = aggregate(today)
    if (today.length) {
      const energy = daily.kcal.known ? `已知热量小计 ${number(daily.kcal.sum)} 千卡` : '已知热量小计未知'
      const macros = (['protein', 'carb', 'fat'] as const).map(key => {
        const label = { protein: '蛋白质', carb: '碳水', fat: '脂肪' }[key], value = daily[key]
        return `${label}${value.known ? `已知小计${number(value.sum)}克` : '未知'}${value.pending ? `（${value.pending}条未知）` : ''}`
      })
      facts.summary.push(`饮食（${day}）：已记录 ${today.length} 条；${energy}，${daily.kcal.pending} 条热量未知；${macros.join('，')}。全天记录完整性未知。`)
    } else facts.summary.push(`饮食（${day}）：截至分析时点未找到当日餐食记录；不等于未进食，全天记录完整性未知。`)
    if (recent.length) {
      facts.summary.push(`近7天饮食（${from}—${day}）：${new Set(recent.map(row => row.date)).size} 天有记录，共 ${recent.length} 条；已记录日期范围 ${recent.at(-1)!.date}—${recent[0].date}。空白日未计为零摄入。`)
    } else facts.summary.push(`近7天饮食（${from}—${day}）：未找到该范围餐食记录${meals.length ? `；此前最近记录 ${meals[0].date}` : ''}，不等于没有进食。`)
    const selected = recent.length ? recent.slice(0, 6) : meals.slice(0, 1)
    facts.details.push(...selected.map(mealLine))
  }
  if (!readable.body) facts.summary.push('实测体重记录读取失败，当前无法确认最近体重。')
  else {
    const latest = checks.at(-1)
    facts.summary.push(latest
      ? `最近实测体重：${latest.date} ${number(latest.weight)} 公斤${timeKnown(latest.recordedAt) ? '' : '（保存时间未知）'}；测量条件与连续趋势尚未确认。`
      : `截至 ${day} 未找到可用实测体重记录。`)
  }
  return facts
}
