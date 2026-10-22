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
  const points:HealthPoint[]=current.map(f=>({id:factId(f),metric:f.metric,day:f.day,value:f.value!,source:`${f.provider} · ${f.manualCorrection?'人工更正':'核对导入'}`,stream:factProtocol(f),statistic:f.protocol,method:f.metric==='HRV'?(/SDNN/.test(f.protocol)?'SDNN':/RMSSD/.test(f.protocol)?'RMSSD':'UNSPECIFIED'):'',updatedAt:f.receivedAt,measuredAt:f.end??f.start,legacy:false}))
  const all=[...new Map([...others,...points].map(v=>[v.id,v])).values()],lastDay=latest.map(f=>f.day).concat(all.map(v=>v.day)).sort().at(-1)
  const candidates=all.filter(v=>v.day===lastDay&&(!view.selectedSource||v.stream===view.selectedSource))
  const conflicted=owned.some(f=>f.day===lastDay&&p.conflicts.includes(factId(f)))||new Set(candidates.map(v=>JSON.stringify([v.stream,v.value]))).size>1
  const selected=conflicted?null:candidates.at(-1)??null
  const f=selected?current.find(f=>factId(f)===selected.id):null,b=f?personalFactBaseline(p.facts,f,7):null
  const unavailable=owned.filter(f=>f.day===lastDay&&f.quality!=='VALID'&&!owned.some(v=>factId(v)===factId(f)&&v.revision>f.revision))
  return {...view,state:conflicted?'CONFLICT':!selected?'MISSING':lastDay===snapshot.asOf?'AVAILABLE':'STALE',current:selected,candidates,series:all.filter(v=>v.stream===selected?.stream),baseline:null,availableSources:[...new Map(all.map(v=>[v.stream,{id:v.stream,label:`${v.source} · ${v.statistic}`}])).values()],notes:[...view.notes,...(b?[`同协议个人中位数 ${b.median}，变化 ${b.delta}，覆盖 ${b.observedDays}/${b.windowDays} 天；仅描述`]:[]),...unavailable.map(f=>`${f.provider} ${f.quality}（修订${f.revision}）；没有用0替代缺失`),...(conflicted?['核对证据存在冲突，未选择较好数值']:[])]}
 })}
}
