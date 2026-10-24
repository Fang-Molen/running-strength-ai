import type { ModelInput } from './types'
import { eligibleRecords, exactTime, ref, sameRef } from './source'
import { assessPhysiology } from './physiology'
export function reviewDistribution(input:ModelInput){
 const w=input.window,gaps:string[]=[]
 const thresholds=assessPhysiology(input).thresholds.allPairs
 const validWindow=exactTime(w.startAt)&&exactTime(w.endAt)&&Date.parse(w.startAt)<Date.parse(w.endAt)&&Date.parse(w.endAt)<=Date.parse(input.context.asOf)
 const raw=eligibleRecords(input.zoneSegments,input.context,()=> 'INTENSITY_SEGMENT')
 const rows=raw.filter(r=>{
  const valid=validWindow&&r.basis===w.basis&&exactTime(r.startAt)&&exactTime(r.endAt)&&Date.parse(r.startAt)<Date.parse(r.endAt)&&Date.parse(r.startAt)>=Date.parse(w.startAt)&&Date.parse(r.endAt)<=Date.parse(w.endAt)&&Date.parse(r.endAt)<=Date.parse(r.knownAt)
  if(!valid)gaps.push(r.id+': 时间窗或统计口径未核定')
  return valid
 })
 const overlapping=new Set<string>()
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(Date.parse(rows[i].startAt)<Date.parse(rows[j].endAt)&&Date.parse(rows[j].startAt)<Date.parse(rows[i].endAt)){overlapping.add(rows[i].id);overlapping.add(rows[j].id)}
 if(overlapping.size)gaps.push('重叠时间/来源有待核对，未重复累计')
 const shares=[0,0,0]
 const boundThreshold=(r:typeof rows[number])=>thresholds.some(t=>t.testId===r.thresholdTestId&&Array.isArray(r.thresholdRefs)&&r.thresholdRefs.length===2&&t.refs.every(tr=>r.thresholdRefs.some(zr=>sameRef(tr,zr)))&&Date.parse(t.measuredAt)<=Date.parse(r.startAt)&&Date.parse(t.knownAt)<=Date.parse(r.knownAt))
 const accepted=rows.filter(r=>!overlapping.has(r.id)&&r.zone!==null&&boundThreshold(r))
 if(rows.some(r=>r.zone!==null&&!boundThreshold(r)))gaps.push('分区缺同一有效实测阈值定义')
 const sessions=new Map<string,typeof accepted>()
 for(const r of accepted)sessions.set(r.sessionId,[...(sessions.get(r.sessionId)??[]),r])
 if(w.basis==='TIME_IN_ZONE')for(const r of accepted)shares[r.zone!-1]+=(Date.parse(r.endAt)-Date.parse(r.startAt))/1000
 else for(const rows of sessions.values()){
  if(new Set(rows.map(r=>r.zone)).size!==1){gaps.push('同一课次目标分区冲突');continue}
  shares[rows[0].zone!-1]++
 }
 const classified=shares.reduce((a,b)=>a+b,0)
 const declaredTotal=w.basis==='TIME_IN_ZONE'?w.totalRunSeconds:w.totalSessions
 const denominator=typeof declaredTotal==='number'&&Number.isFinite(declaredTotal)&&declaredTotal>=0&&(w.basis==='TIME_IN_ZONE'||Number.isInteger(declaredTotal))?declaredTotal:null
 if(w.basis==='SESSION_GOAL'&&denominator===null)gaps.push('课次法单独显示已分类课数；未提供完整课次分母，不与时间法混比')
 const overflow=denominator!==null&&classified>denominator
 if(overflow)gaps.push('已分类时间超过总跑步时间，分母冲突')
 const unknown=denominator===null||overflow?null:denominator-classified
 const coverage=denominator!==null&&denominator>0&&!overflow?classified/denominator:null
 const complete=validWindow&&w.complete&&unknown===0&&!gaps.length
 const pattern=complete&&shares[0]>shares[1]&&shares[1]>shares[2]?'PYRAMIDAL_SHAPED':complete&&shares[0]>shares[2]&&shares[2]>shares[1]?'POLARIZED_SHAPED':complete?'OTHER_SHAPE':'UNRESOLVED'
 return {basis:w.basis,unit:w.basis==='TIME_IN_ZONE'?'s':'sessions',classified,denominator,unknown,coverage,shares,sharesPercent:shares.map(x=>denominator&& !overflow?100*x/denominator:null),pattern,gaps,refs:accepted.map(ref),
 prescriptionAuthorized:false,limitation:'形状是描述，不等于应采用该训练方法；未知时间保留在分母，不能以已分类分钟凑80/20。'}
}
