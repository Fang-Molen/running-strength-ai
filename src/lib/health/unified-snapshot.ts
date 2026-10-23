import type { HealthSnapshot, HealthPoint } from './snapshot'
import { readUnifiedFacts } from './unified-fact-store'
import { factId, factProtocol, personalFactBaseline } from './unified-facts'
import { shortHash } from './observation'
/** Read-only projection: reviewed revisions replace their own device stream, never mutate stored records. */
export function withUnifiedFacts(snapshot:HealthSnapshot,asOf=new Date().toISOString()):HealthSnapshot{
 const p=readUnifiedFacts(asOf);if(!p.evidence.length)return {...snapshot,unreadable:snapshot.unreadable||p.rejected.length>0}
 return {...snapshot,unreadable:snapshot.unreadable||p.rejected.length>0,metrics:snapshot.metrics.map(view=>{
  const owned=p.evidence.filter(f=>f.metric===view.metric&&f.day<=snapshot.asOf);if(!owned.length)return view
  const prefixes=new Set(owned.map(f=>`${f.provider.toLowerCase()}:${shortHash(f.accountRef+':'+f.deviceId)}|`))
  const others=view.series.concat(view.candidates).filter(v=>![...prefixes].some(prefix=>v.stream.startsWith(prefix)))
  const visible=(f:typeof p.evidence[number])=>f.provider!=='APPLE'||!['SLEEP','STEPS','ACTIVE_KCAL','RESTING_KCAL'].includes(f.metric)||f.recordId.startsWith('daily:')
  const current=p.facts.filter(f=>f.metric===view.metric&&f.day<=snapshot.asOf&&visible(f))
  const latestRevision=new Map<string,number>();for(const f of p.evidence)latestRevision.set(factId(f),Math.max(latestRevision.get(factId(f))??-1,f.revision))
  const latest=owned.filter(f=>f.revision===latestRevision.get(factId(f))&&visible(f))
  const points:HealthPoint[]=current.map(f=>({id:factId(f),metric:f.metric,day:f.day,value:f.value!,source:`${f.provider} · ${f.manualCorrection?'人工更正':'核对导入'}`,sourceId:`${f.provider.toLowerCase()}:${shortHash(f.accountRef+':'+f.deviceId)}`,stream:factProtocol(f),statistic:f.protocol,method:f.metric==='HRV'?(/SDNN/.test(f.protocol)?'SDNN':/RMSSD/.test(f.protocol)?'RMSSD':'UNSPECIFIED'):'',updatedAt:f.receivedAt,measuredAt:f.end??f.start,legacy:false}))
  const all=[...new Map([...others,...points].map(v=>[v.id,v])).values()]
  // Resolve only an exact legacy source+protocol alias after reviewed import; no fuzzy brand matching.
  const alias = view.selectedSource ? latest.find(f => {
    const sourceId = `${f.provider.toLowerCase()}:${shortHash(f.accountRef+':'+f.deviceId)}`
    const method = f.metric === 'HRV' ? (/SDNN/.test(f.protocol) ? 'SDNN' : /RMSSD/.test(f.protocol) ? 'RMSSD' : 'UNSPECIFIED') : ''
    return view.selectedSource === `${sourceId}|${f.protocol.slice(0,80)}|${method}`
  }) : null
  const selectedSource = alias ? factProtocol(alias) : view.selectedSource
  // A selected source owns its date and conflict state; another watch must not blank it.
  const eligible=all.filter(v=>!selectedSource||v.stream===selectedSource)
  const ownedEligible=latest.filter(f=>!selectedSource||factProtocol(f)===selectedSource)
  const lastDay=ownedEligible.map(f=>f.day).concat(eligible.map(v=>v.day)).sort().at(-1)
  const candidates=all.filter(v=>v.day===lastDay&&(!selectedSource||v.stream===selectedSource))
  const conflicted=ownedEligible.some(f=>f.day===lastDay&&p.conflicts.includes(factId(f)))||new Set(candidates.map(v=>JSON.stringify([v.stream,v.value]))).size>1
  const selected=conflicted?null:candidates.at(-1)??null
  const f=selected?current.find(f=>factId(f)===selected.id):null,b=f?personalFactBaseline(p.facts,f,7):null
  const unavailable=ownedEligible.filter(f=>f.day===lastDay&&f.quality!=='VALID'&&!owned.some(v=>factId(v)===factId(f)&&v.revision>f.revision))
  return {...view,selectedSource,state:conflicted?'CONFLICT':!selected?'MISSING':lastDay===snapshot.asOf?'AVAILABLE':'STALE',current:selected,candidates,series:all.filter(v=>v.stream===selected?.stream).sort((a,b)=>a.day.localeCompare(b.day)||a.updatedAt.localeCompare(b.updatedAt)),baseline:null,availableSources:[...new Map([...view.availableSources.filter(s=>![...prefixes].some(prefix=>s.id.startsWith(prefix))).map(s=>[s.id,s] as const),...all.map(v=>[v.stream,{id:v.stream,label:`${v.source} · ${v.statistic}`}] as const)]).values()],notes:[...view.notes.filter(n=>!/^同一天存在多个来源|所选来源暂无|历史值 |旧\/手填记录|日最高值/.test(n)),...(selected&&selected.day!==snapshot.asOf?[`历史值 ${selected.day}，不能当作今天状态。`]:[]),...(selected?.legacy?['旧/手填记录未含完整设备元数据；原值保留。']:[]),...(selectedSource&&!selected&&!conflicted?['所选来源暂无该日期前的有效数据；未改用其他来源。']:[]),...(selected?.statistic.includes('最高')?['日最高值不代表当前电量，不参与当前疲劳判定。']:[]),...(b?[`同协议个人中位数 ${b.median}，变化 ${b.delta}，覆盖 ${b.observedDays}/${b.windowDays} 天；仅描述`]:[]),...unavailable.map(f=>`${f.provider} ${f.quality}（修订${f.revision}）；没有用0替代缺失`),...(conflicted?['核对证据存在冲突，未选择较好数值']:[])]}
 })}
}
