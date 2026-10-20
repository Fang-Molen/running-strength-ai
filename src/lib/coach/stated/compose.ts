/** 题面事实 → 本地回答的“按你给的数字”段（v86，区块 coach-stated 入口）。
 * 只用这句话里给出的数；没给的不补、不猜；不写入任何存储；不替用户批准训练。 */
import { parseStatedFacts, hasStatedNumbers, type StatedFacts } from './parse.ts'
import { setStats, planActualStats, baselineStats, distanceTimeStats, strengthVolume, r1, r2, signed, pct, pace } from './compute.ts'

export { parseStatedFacts, hasStatedNumbers, type StatedFacts }
const s1 = (n: number) => `${r1(n)}`
const dist = (m: number) => `${m}米`

export function statedFactsSection(question: string): { text: string | null; facts: StatedFacts; numbers: boolean } {
  const f = parseStatedFacts(question), lines: string[] = [], reads: string[] = []
  for (const s of f.sets) {
    const st = setStats(s); if (!st) continue
    const label = `${s.date ? s.date + ' ' : ''}${s.label}${s.targetSec !== null ? `（目标${s.targetSec}秒）` : ''}`
    const vsSeries = s.targetSeries ? s.splits.map((v, i) => v === null ? '缺' : signed(v - s.targetSeries![i])).join('/') : null
    const vs = vsSeries ? `；逐段目标${s.targetSeries!.join('/')}秒，实际−目标 ${vsSeries}秒` : st.vsTarget ? `；相对目标逐段 ${st.vsTarget.map(v => signed(v)).join('/')}秒，均值偏差 ${signed(st.meanVsTarget!, 2)}秒` : ''
    const rate = s.reps && s.reps > st.n ? `；以计划${s.reps}次为分母，有实际计时的${st.n}/${s.reps}（${r2(st.n / s.reps * 100)}%）` : ''
    lines.push(`· ${label}实际 ${s.splits.map(v => v ?? '缺').join('/')}秒：${st.n}段有效计时${st.missing ? `、${st.missing}段无用时（不当作没跑，也不补数）` : ''}，工作用时合计${s1(st.total)}秒，均值${r2(st.mean)}秒${st.pacePerKm ? `（约${pace(st.pacePerKm)}）` : ''}；末段比首段${st.diff > 0 ? '慢' : st.diff < 0 ? '快' : '持平'}${st.diff ? Math.abs(r2(st.diff)) + '秒' : ''}（${pct(st.diffPct)}），平均速度变化${pct(st.speedPct)}；样本变异系数${r2(st.cv * 100)}%${vs}${s.restSec !== null ? `；休${s.restSec}秒` : ''}${s.rpe !== null ? `${s.restSec !== null ? '、' : '；'}RPE${s.rpe}` : ''}${rate}${st.meters ? `；工作跑距${st.n * st.meters}米` : ''}。`)
    if (Math.abs(st.diffPct) <= 0.015 && st.cv <= 0.015) reads.push(`${label}节奏稳定（首末差${pct(st.diffPct)}、CV ${r2(st.cv * 100)}%）`)
    else if (st.diffPct > 0.03) reads.push(`${label}后段明显变慢（末段${pct(st.diffPct)}）`)
    else if (st.diffPct < -0.015) reads.push(`${label}后段比前段快`)
    if (st.vsTarget) { const ok = st.vsTarget.filter(v => Math.abs(v) <= 2).length; reads.push(`${label}${ok}/${st.n}段在目标±2秒内`) }
  }
  if (f.rounds) { const r = f.rounds, n = r.rounds * r.perRound, rest = r.repRest !== null ? r.rounds * (r.perRound - 1) * r.repRest : null, total = rest !== null && r.roundRest !== null ? rest + (r.rounds - 1) * r.roundRest : null
    lines.push(`· ${r.rounds}轮×${r.perRound}次×${r.meters}米、每段${r.eachSec}秒：工作跑距${n * r.meters}米，工作时间${r1(n * r.eachSec)}秒${rest !== null ? `；轮内恢复${r.rounds}×${r.perRound - 1}×${r.repRest}=${rest}秒` : ''}${total !== null ? `，轮间${r.rounds - 1}×${r.roundRest}秒，列明的恢复合计${total}秒（最后一段后不计）` : ''}；热身、放松未给，不当作0。`) }
  if (f.statuses) { const x = f.statuses; lines.push(`· 以计划${x.planned}次为分母：已确认完成${x.completed}/${x.planned}（${r2(x.completed / x.planned * 100)}%）；跳过${x.skipped}次、未记录${x.notRecorded}次分别保留，未记录不当作没跑也不当作完成。`) }
  for (const p of f.planActual) { const x = planActualStats(p); lines.push(`· ${p.meters ? dist(p.meters) + ' ' : ''}计划${p.planSec}秒、实际${p.actualSec}秒：实际−计划 = ${signed(x.diff, 2)}秒，偏差${pct(x.pct)}（以计划用时为分母；正值=慢于计划）。`) }
  for (const d of f.distanceTimes) { const x = distanceTimeStats(d); lines.push(`· ${dist(d.meters)}用时${d.seconds}秒：配速${pace(x.pacePerKm)}，平均速度${r2(x.mps)}米/秒（${r2(x.kmh)}公里/时）。`) }
  for (const c of f.changes) lines.push(`· ${c.label}从${c.from}${c.unit}到${c.to}${c.unit}：${signed(c.to - c.from)}${c.unit}（${pct((c.to - c.from) / c.from)}）。`)
  if (f.result) { const r = f.result, mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`
    const cmp = [r.pb !== null ? `比PB ${mmss(r.pb)} ${r.sec < r.pb ? '快' : r.sec > r.pb ? '慢' : '持平'}${Math.abs(r.sec - r.pb) || ''}${r.sec !== r.pb ? '秒' : ''}` : null, r.target !== null ? `比目标 ${mmss(r.target)} ${r.sec < r.target ? '快' : r.sec > r.target ? '慢' : '持平'}${Math.abs(r.sec - r.target) || ''}${r.sec !== r.target ? '秒' : ''}` : null].filter(Boolean)
    if (cmp.length) lines.push(`· 成绩${mmss(r.sec)}（${r.sec}秒）：${cmp.join('，')}。`) }
  if (f.hrvMetricMismatch) lines.push(`· ${f.hrvMetricMismatch}`)
  if (f.sessionRpeNull) lines.push(`· 整课sRPE为空：不能按“分钟×整课sRPE”算整课AU；末组或单段RPE不能代替整课评分。`)
  if (f.raceDays) lines.push(`· 当前${f.raceDays.asOf}到比赛日${f.raceDays.race}还有${f.raceDays.days}天。`)
  if (f.raceUndecided) lines.push('· 比赛日期未确定：还不能把下周称为“最后赛前减量周”，先确认日期。')
  if (f.energy) lines.push(f.energy.partial && !f.energy.whole ? `· 能量记录${f.energy.kcal}kcal只覆盖部分餐次：不能当作全天摄入，也不能据此断定全天能量不足。` : f.energy.whole ? `· 全天如实录入的能量只有${f.energy.kcal}kcal：按记录明显偏低，需要尽快和医生/营养师核对；仍不能单凭这一天确定是掉速原因。` : `· 能量记录${f.energy.kcal}kcal（记录范围未说明）。`)
  if (f.priorLast) { const last = f.sets.map(setStats).find(Boolean)?.last; if (last != null) lines.push(`· 此前同协议末段${f.priorLast.join('、')}秒，本次末段${last}秒：比此前${f.priorLast.map(p => signed(last - p)).join('/')}秒。`) }
  if (f.corrected) { const a = distanceTimeStats({ meters: f.corrected.meters, seconds: f.corrected.from }), b = distanceTimeStats({ meters: f.corrected.meters, seconds: f.corrected.to }); lines.push(`· ${f.corrected.meters}米：原值${f.corrected.from}秒（${pace(a.pacePerKm)}）→ 当前值${f.corrected.to}秒（${pace(b.pacePerKm)}，${r2(b.mps)}米/秒）；按当前值计算，原值派生的配速作废但历史保留。`) }
  if (f.budget) { const b = f.budget, over = (b.cap !== null && b.estimate > b.cap) || (b.remaining !== null && b.estimate > b.remaining); lines.push(`· 预估${b.estimate}${b.cap !== null ? `，单次上限${b.cap}` : ''}${b.remaining !== null ? `，剩余${b.remaining}` : ''}：${over ? '超出额度，应阻断这次请求' : '在额度内，按额度规则可放行'}（这里只是按你给的数比较，本地回答没有发出任何网络请求）。`) }
  if (f.secondsToMinutes !== null) lines.push(`· ${f.secondsToMinutes}秒 = ${r2(f.secondsToMinutes / 60)}分钟。`)
  if (f.strength.length) {
    // 不同日期的组各算各的，不合成一个数
    const days = [...new Set(f.strength.map(s => s.date ?? ''))]
    const parts = days.map(d => { const xs = f.strength.filter(s => (s.date ?? '') === d); return `${d ? d + ' ' : ''}${xs.map(s => `${s.kg}kg×${s.reps}次×${s.sets}组`).join(' + ')} = ${r1(strengthVolume(xs))}kg` })
    lines.push(`· 力量外负重重复量（重量×次数×组数，只算写明完成的组）：${parts.join('；')}。这个数不能与跑步距离相加成一个总负荷。`)
  }
  if (f.sessionMinutes !== null && f.sessionRpe !== null) lines.push(`· 整课${f.sessionMinutes}分钟 × 整课sRPE${f.sessionRpe} = ${r1(f.sessionMinutes * f.sessionRpe)} AU（按这个约定的记录值，不是疲劳分或伤病概率）。`)
  const bl = f.baselines.map(b => { const x = baselineStats(b); return x ? `${b.label}今天${b.today}${b.unit}、基线${b.base}${b.unit}：${signed(x.diff)}${b.unit}（${pct(x.pct)}）` : b.todayNull ? `${b.label}基线${b.base}${b.unit}，今天的值为空：不能算变化，按缺失处理` : null }).filter(Boolean)
  if (bl.length) lines.push(`· ${bl.join('；')}${f.baselines.filter(b => b.today !== null).length >= 2 ? '。两者来自同一晨测，属于相关信号，不当作两次独立证据' : ''}。`)
  const status = [f.sleepHours !== null ? `睡眠${f.sleepHours}小时` : f.sleepRange ? `睡眠是本人回忆${f.sleepRange[0]}–${f.sleepRange[1]}小时（不是设备测量值，不能存成精确数）` : null,
    f.recovery10 !== null ? `主观恢复${f.recovery10}/10` : null, f.readiness !== null ? `手表准备度${f.readiness}` : null,
    ...f.pain.map(p => `${p.where ?? ''}疼痛${p.score}/10`), !f.pain.length && f.painFree ? '无痛' : null,
    f.symptoms.some(s => s.state === 'ABSENT') ? `当前没有${f.symptoms.filter(s => s.state === 'ABSENT').map(s => s.label).join('、')}（按你所述）` : null,
    f.symptoms.some(s => s.state === 'PRESENT') ? `你报告了${f.symptoms.filter(s => s.state === 'PRESENT').map(s => s.label).join('、')}` : null].filter(Boolean)
  if (f.weekly.length >= 2) { const a = f.weekly.at(-1)!, b = f.weekly.at(-2)!; status.push(`周跑量${f.weekly.join('/')}公里（最近一周较前一周${pct((a - b) / b)}）`) }
  if (status.length && (lines.length || f.pain.length || f.readiness !== null || f.symptoms.length)) lines.push(`· ${status.join('；')}。`)
  const painNow = f.pain.filter(p => p.score > 0)
  if (painNow.length && f.readiness !== null) reads.push(`手表准备度${f.readiness}不能覆盖你自报的${painNow.map(p => `${p.where ?? ''}疼痛${p.score}/10`).join('、')}`)
  if (f.recentInjury && f.notAssessed && !painNow.length && (f.pain.some(p => p.score === 0) || f.painFree)) reads.push(`${f.recentInjury}，尚未面诊：${f.pain.some(p => p.score === 0) ? `${f.pain.find(p => p.score === 0)!.where ?? ''}疼痛0/10` : '“不痛”'}只说明这件事不痛，不等于能接近全速；先按顺序做无痛递进测试（快走→慢跑→单脚跳10次→逐级加速跑），每一步记“是否疼痛、几分”，任何一步出现疼痛就停并安排面诊`)
  const rhr = f.baselines.find(b => b.label === '静息心率'), hrv = f.baselines.find(b => b.label === 'RMSSD')
  if (rhr?.today != null && hrv?.today != null && rhr.today > rhr.base && hrv.today < hrv.base) reads.push(`晨脉高于基线、RMSSD低于基线${f.sleepHours !== null ? `，再加上睡眠${f.sleepHours}小时` : ''}${f.recovery10 !== null ? `、恢复${f.recovery10}/10` : ''}，一种解释是当天恢复不足；另一种是测量或作息波动——明早同设备同坐姿复测一次再判断`)
  if (rhr?.today != null && hrv?.today != null && rhr.today === rhr.base && hrv.today < hrv.base) reads.push('晨脉回到基线而RMSSD仍低于基线，两个指标方向不一致，不能据单一指标下结论')
  const numbers = hasStatedNumbers(f)
  if (!lines.length) return { text: null, facts: f, numbers }
  return { text: ['按你这次给的数字（本地核算，只读，未保存）：', ...lines, reads.length ? `从数字看：${reads.join('；')}。` : ''].filter(Boolean).join('\n'), facts: f, numbers }
}
