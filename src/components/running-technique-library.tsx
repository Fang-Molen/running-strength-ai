import { useRef, useState } from 'react'
import './running-technique-library.css'
import { FangkunExerciseVideo } from './fangkun-unified-video'
import { catalogue, categories, filterDrills, getDrill } from '@/lib/running-technique/catalogue'
import type { DrillLevel, RunningEvent, TechniqueCategory } from '@/lib/running-technique/types'

const EVENTS: Record<RunningEvent, string> = { '100': '100 米', '200': '200 米', '400': '400 米', '800': '800 米', '1500': '1500 米', '3000': '3000 米', '5000': '5 公里', '10000': '10 公里', half_marathon: '半马', marathon: '马拉松' }
const LEVELS: Record<DrillLevel, string> = { beginner: '初级', intermediate: '中级', advanced: '高级' }
const EFFORT = { low: '低', medium: '中', high: '高' }
const EQUIPMENT = [...new Set(catalogue.drills.flatMap(d => d.equipment))]
const range = (values: readonly [number, number] | null, unit: string) => values === null ? '未指定' : `${values[0] === values[1] ? values[0] : values.join('–')} ${unit}`

export default function RunningTechniqueLibrary() {
  const [gender,setGender]=useState<'male'|'female'>('male')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TechniqueCategory | ''>('')
  const [event, setEvent] = useState<RunningEvent | ''>('')
  const [level, setLevel] = useState<DrillLevel | ''>('')
  const [equipment, setEquipment] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const drill = selected ? getDrill(selected) : undefined
  const rows = filterDrills({ query, category: category || undefined, event: event || undefined, level: level || undefined, equipment: equipment || undefined })

  if (drill) return <article className="fk-technique" aria-label={`${drill.name_zh}技术说明`}>
    <button type="button" className="back" onClick={() => { const id = selected; setSelected(null); requestAnimationFrame(() => document.getElementById(`technique-${id}`)?.focus()) }}>‹ 返回跑步技术列表</button>
    <p className="tech-eyebrow">{drill.category_name} · {LEVELS[drill.skill_level]} · 待教练审核</p>
    <h2 ref={heading} tabIndex={-1}>{drill.name_zh}</h2>
    <p className="meta">{drill.name_en}</p>
    <section className="tech-section"><h3>练习目的</h3><p>{drill.primary_purpose}</p></section>
    <section className="tech-section"><h3>动作怎么做</h3><ol>{drill.steps.map((step, i) => <li key={i}>{step}</li>)}</ol></section>
    <section className="tech-cue"><h3>先记住这一点</h3><p>{drill.cues[0]}</p>{drill.cues.length > 1 ? <details><summary>更多提示</summary><ul>{drill.cues.slice(1).map(cue => <li key={cue}>{cue}</li>)}</ul></details> : null}</section>
    <section className="tech-section"><h3>常见错误与退阶</h3><ul>{drill.common_errors.map(error => <li key={error}>{error}</li>)}</ul><p>{drill.correction_or_regression}</p></section>
    <details className="tech-section"><summary>教学参考量 · 使用前待确认</summary>
      <p>{drill.dose_note}</p><dl className="tech-dose">
        {([['组数', range(drill.starting_dose.sets, '组')], ['每组距离', range(drill.starting_dose.distance_m, '米')], ['每组时长', range(drill.starting_dose.duration_s, '秒')], ['每组次数', range(drill.starting_dose.reps, '次')], ['组间休息', range(drill.starting_dose.rest_s, '秒')]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl><p className="note">以上是内容草稿中的范围，并非为你制定的训练剂量。此动作尚未获批，暂不加入可执行计划。</p>
    </details>
    <section className="tech-section"><h3>适用条件与停止条件</h3>
      <p>项目标签：{drill.event_tags.map(tag => EVENTS[tag]).join('、')}。标签不代表个人适用性已确认。</p>
      <p>器材：{drill.equipment.join('、') || '无器材'} · 内容强度标签：{EFFORT[drill.effort_band]}{drill.safety.requires_supervision ? ' · 需要现场指导' : ''}</p>
      <p>{drill.safety.caution}</p><p>{drill.safety.stop_rule}</p>
    </section>
    <section className="tech-section"><h3>同角色动作视频</h3><div className="flex gap-2" role="group" aria-label="跑步演示角色">{(['male','female'] as const).map(g=><button type="button" className="fk-chip min-h-11" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)}>{g==='male'?'男性':'女性'}</button>)}</div><FangkunExerciseVideo exerciseId={drill.id} title={drill.name_zh} gender={gender}/><p className="note">{drill.muscle_overlay_note}</p></section>
    <details className="tech-section"><summary>内容来源与证据限制</summary><p>{drill.evidence.classification}</p><p>{drill.evidence.limits}</p>
      <ul>{drill.evidence.source_ids.map(id => { const source = catalogue.sources.find(s => s.id === id); return source ? <li key={id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a><p>{source.supports}</p></li> : null })}</ul>
      <p className="note">交接资料中的来源说明，尚未完成本项目逐条专业核验。内容版本 {drill.content_version} · {drill.id}</p>
    </details>
    <p className="note">阅读动作不会记录训练完成，也不会改变你的计划或能力判断。</p>
  </article>

  return <section className="fk-technique" aria-label="跑步技术动作库">
    <h2>跑步技术</h2><p className="meta">从一个可观察的技术目标开始。{catalogue.count} 条教学草稿，待教练审核。</p>
    <label className="tech-search">搜索动作或技术目标<input className="search" placeholder="例如：摆臂、A式、步频" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="chips" role="group" aria-label="技术分类">
      <button type="button" className={`chip ${category === '' ? 'on' : ''}`} aria-pressed={category === ''} onClick={() => setCategory('')}>全部分类</button>
      {Object.entries(categories).map(([key, name]) => <button key={key} type="button" aria-pressed={category === key} className={`chip ${category === key ? 'on' : ''}`} onClick={() => setCategory(key as TechniqueCategory)}>{name}</button>)}
    </div>
    <div className="tech-filters">
      <label>项目<select aria-label="项目" value={event} onChange={e => setEvent(e.target.value as RunningEvent | '')}><option value="">全部项目</option>{Object.entries(EVENTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>难度<select aria-label="难度" value={level} onChange={e => setLevel(e.target.value as DrillLevel | '')}><option value="">全部难度</option>{Object.entries(LEVELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>器材<select aria-label="器材" value={equipment} onChange={e => setEquipment(e.target.value)}><option value="">全部器材</option><option value="none">无器材</option>{EQUIPMENT.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    </div>
    <p className="meta" role="status">找到 {rows.length} 条技术练习</p>
    <div className="tech-list">{rows.map(d => <button id={`technique-${d.id}`} key={d.id} type="button" className="tech-item" onClick={() => { setSelected(d.id); requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }) }) }}>
      <span className="tech-item-title">{d.name_zh}<span aria-hidden="true">↗</span></span><span>{d.primary_purpose}</span><small>{d.category_name} · {LEVELS[d.skill_level]} · {d.equipment.join('、') || '无器材'} · 待审核</small>
    </button>)}</div>
    {rows.length === 0 ? <p className="tech-section">没有符合条件的动作。可清空搜索或减少筛选条件。</p> : null}
    <p className="note">分类用于查找教学内容，不是训练推荐。53 条动作均待专项教练审核；视频须单独通过同角色与动作审核；无合格素材时保留教学文字。</p>
  </section>
}
