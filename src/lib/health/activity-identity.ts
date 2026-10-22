/** A confirmed common activity suppresses duplicate contribution, never deletes evidence.
 * Near timestamps are only a review candidate; account/athlete scope is mandatory. */
import { exactInstant } from './unified-facts'
export type SourceActivity={id:string;athleteId:string;provider:string;accountRef:string;protocol:string;start:string;end:string;actual:boolean;confirmedActivityRef?:string;revision:number}
export function activityContributions(rows:readonly SourceActivity[],athleteId:string){
 const valid=rows.filter(r=>r.athleteId===athleteId&&r.id&&r.accountRef&&r.protocol&&r.actual&&exactInstant(r.start)&&exactInstant(r.end)&&Date.parse(r.end)>Date.parse(r.start)&&Number.isSafeInteger(r.revision)&&r.revision>=0)
 const groups=new Map<string,SourceActivity[]>(),conflicts:string[]=[],possibleDuplicates:string[][]=[]
 for(const r of valid){const id=JSON.stringify([r.provider,r.accountRef,r.id]);groups.set(id,[...groups.get(id)??[],r])}
 const unique:SourceActivity[]=[]
 for(const [id,versions] of groups){const max=Math.max(...versions.map(v=>v.revision)),latest=versions.filter(v=>v.revision===max)
  if(new Set(latest.map(v=>JSON.stringify([v.start,v.end,v.protocol,v.confirmedActivityRef??null]))).size>1){conflicts.push(id);continue}unique.push(latest[0])}
 const representatives:SourceActivity[]=[],suppressed:SourceActivity[]=[]
 for(const r of unique.sort((a,b)=>JSON.stringify([a.provider,a.accountRef,a.id]).localeCompare(JSON.stringify([b.provider,b.accountRef,b.id])))){
  const same=representatives.find(v=>r.confirmedActivityRef&&r.confirmedActivityRef===v.confirmedActivityRef)
  if(same){if(same.protocol!==r.protocol){conflicts.push('LINK_PROTOCOL_CONFLICT:'+r.confirmedActivityRef);representatives.splice(representatives.indexOf(same),1);suppressed.push(same,r)}else suppressed.push(r)}else if(!conflicts.includes('LINK_PROTOCOL_CONFLICT:'+r.confirmedActivityRef))representatives.push(r)
 }
 for(let a=0;a<representatives.length;a++)for(let b=a+1;b<representatives.length;b++){
  const x=representatives[a],y=representatives[b]
  if(x.provider!==y.provider&&Math.max(Date.parse(x.start),Date.parse(y.start))<Math.min(Date.parse(x.end),Date.parse(y.end)))possibleDuplicates.push([x.id,y.id])
 }
 return {representatives,suppressed,originalEvidence:rows.filter(r=>r.athleteId===athleteId),conflicts,possibleDuplicates,canSum:!conflicts.length&&!possibleDuplicates.length,trainingSessionCount:null}
}
