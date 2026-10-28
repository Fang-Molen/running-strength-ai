import type { EvidenceRef, EvidenceSnapshot, MetricFact } from './analysis-contract';
import { median } from '../core/coach-quantitative-math';
import { sha256Hex } from '../core/sha256-sync';
import { METRIC_TRAJECTORY_RULE } from './recovery-rule-ledger';

const ref=(f:EvidenceRef):EvidenceRef=>({id:f.id,revision:f.revision});
const instant=(v:string)=>Number.isFinite(Date.parse(v));
const day=(v:string|null):v is string=>!!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&instant(v)&&new Date(v).toISOString().slice(0,10)===v;
const scope=(f:MetricFact)=>JSON.stringify([f.athleteId,f.provider,f.accountRef,f.deviceId,f.protocolKey,f.metric,f.unit,f.statistic,f.sourceTimeZone]);
type Daily={day:string;value:number;refs:EvidenceRef[]};
export type MetricTrajectorySegment={start:string;end:string;days:number;median:number;minimum:number;maximum:number;refs:EvidenceRef[]};
const segment=(rows:Daily[]):MetricTrajectorySegment=>({start:rows[0].day,end:rows.at(-1)!.day,days:rows.length,median:median(rows.map(r=>r.value))!,minimum:Math.min(...rows.map(r=>r.value)),maximum:Math.max(...rows.map(r=>r.value)),refs:rows.flatMap(r=>r.refs)});

/** Pure description over available source history. It does not persist a new
 * anchor, absorb today into its reference, or infer a diagnosis from a trend. */
export function descriptiveMetricTrajectory(s:EvidenceSnapshot,current:MetricFact){
  const known=current.athleteId===s.context.athleteId&&!!current.accountRef&&!!current.deviceId&&!!current.protocolKey&&!/UNKNOWN|UNSPECIFIED/i.test(current.protocolKey)&&day(current.providerDate);
  const now=Date.parse(s.context.asOf),eligible=s.facts.filter((f):f is MetricFact=>f.kind==='METRIC'&&f.athleteId===s.context.athleteId&&f.metric===current.metric&&f.unit===current.unit&&f.status==='CONFIRMED'&&['AVAILABLE','PARTIAL'].includes(f.quality)&&f.value!==null&&Number.isFinite(f.value)&&f.isFinal===true&&day(f.providerDate)&&[f.occurredAt,f.knownAt,f.receivedAt].every(t=>instant(t)&&Date.parse(t)<=now));
  const groups=new Map<string,MetricFact[]>();
  if(known)for(const f of eligible)if(scope(f)===scope(current)&&f.providerDate!<current.providerDate!){const key=f.providerDate!;groups.set(key,[...(groups.get(key)??[]),f])}
  const days:Daily[]=[],conflicts:EvidenceRef[]=[];
  for(const [key,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    if(new Set(rows.map(r=>r.value)).size!==1){conflicts.push(...rows.map(ref));continue}
    days.push({day:key,value:rows[0].value!,refs:rows.sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision).map(ref)});
  }
  const distinctSources=new Set(eligible.map(scope)),sourceSegmentCount=distinctSources.size;
  const earlier=days.length>=4?segment(days.slice(0,Math.floor(days.length/2))):null;
  const later=days.length>=4?segment(days.slice(Math.floor(days.length/2))):null;
  const lower=earlier!==null&&later!==null&&days.slice(Math.floor(days.length/2)).every(d=>d.value<earlier.median);
  const higher=earlier!==null&&later!==null&&days.slice(Math.floor(days.length/2)).every(d=>d.value>earlier.median);
  const unchanged=earlier!==null&&later!==null&&days.every(d=>d.value===days[0].value);
  const direction=lower?'LOWER' as const:higher?'HIGHER' as const:unchanged?'UNCHANGED' as const:earlier?'MIXED' as const:'UNKNOWN' as const;
  const status=!known?'UNAVAILABLE' as const:!days.length&&sourceSegmentCount>1?'SEGMENTED_INSUFFICIENT' as const:!days.length?'UNAVAILABLE' as const:days.length===1?'SINGLE_DAY' as const:lower||higher?'DIRECTIONAL_SHIFT_REVIEW' as const:'MULTI_DAY_DESCRIPTIVE' as const;
  const span=days.length?Math.round((Date.parse(days.at(-1)!.day)-Date.parse(days[0].day))/86400000)+1:0;
  const refs=[...new Map([...days.flatMap(r=>r.refs),...conflicts,ref(current)].map(r=>[r.id+'@'+r.revision,r])).values()];
  const currentOpposesShift=current.value!==null&&earlier!==null&&(lower&&current.value>=earlier.median||higher&&current.value<=earlier.median);
  const detail=earlier&&later?`较早历史段 ${earlier.start}—${earlier.end}（${earlier.days}日）中位数 ${earlier.median} ${current.unit}；较后历史段 ${later.start}—${later.end}（${later.days}日）中位数 ${later.median} ${current.unit}。${lower||higher?`存在描述性方向变化（${lower?'较低':'较高'}），需要复核；不能因滚动参照已接近当前值而视为健康新常态。`:'本次段间未出现一致方向变化，不等于恢复正常。'}${currentOpposesShift?'当前读数与这段历史方向相反，作为反证保留；一次回升/回落也不能独立判定恢复。':''}`:days.length===1?'仅有一个可比历史日，只描述差异，不建立稳定常态。':days.length?'独立历史日尚不足以分成两个多日段；已有记录保留，不编造稳定常态。':sourceSegmentCount>1?'设备或协议等来源发生分段，当前来源缺少可比历史；不拼接换表差值作为生理恶化。':'同来源、设备和协议的历史尚未建立，不推定正常或异常。';
  const text=`${current.metric} 历史描述：${detail}覆盖 ${days.length}/${span} 个历史自然日；缺日不补零，当前日未进入参照。${conflicts.length?'同日冲突值已排除数值比较并保留待核对。':''}规则 ${METRIC_TRAJECTORY_RULE.id}（${METRIC_TRAJECTORY_RULE.version}，产品描述方法，尚未专业校准）；不诊断、不改变剂量、不解除疼痛或医疗限制。`;
  const version=sha256Hex(JSON.stringify([METRIC_TRAJECTORY_RULE.version,scope(current),days,conflicts,[current.id,current.revision,current.value,current.occurredAt,current.knownAt],sourceSegmentCount]));
  return {version,asOf:s.context.asOf,athleteId:s.context.athleteId,metric:current.metric,unit:current.unit,status,direction,priorDays:days.length,calendarDays:span,coverageDenominator:'FIRST_TO_LAST_AVAILABLE_PRIOR_DAY' as const,conflictingDays:[...groups.values()].filter(r=>new Set(r.map(x=>x.value)).size>1).length,sourceSegmentCount,sourceScope:scope(current),algorithmVersion:'NOT_SEPARATELY_RECORDED' as const,earlier,later,currentOpposesShift,refs,text,rule:METRIC_TRAJECTORY_RULE,medicalClearance:false as const,automaticPrescription:false as const};
}
