import type { CoachContextRecord } from './online-contract'
import { sha256Hex } from '../core/sha256-sync'
import { stableJson } from '../health/analysis-evidence'

/** Reassemble V2 field parts before semantic/safety interpretation. */
export function contextTextField(record: CoachContextRecord, name:string): string {
 const value=record.fields.find(f=>f.name===name)?.value
 const parts=record.fields.filter(f=>f.name.startsWith(name+'Part')&&/^\d+$/.test(f.name.slice(name.length+4)))
  .sort((a,b)=>Number(a.name.slice(name.length+4))-Number(b.name.slice(name.length+4)))
 return (value==null?'':String(value))+parts.map(f=>String(f.value??'')).join('')
}

/** V2 permits 256 characters per field. Split text before the budget selector,
 * preserving the full source digest even if a very long record needs clipping. */
export function boundedContextRecord(record: CoachContextRecord): CoachContextRecord {
 const fields = record.fields.flatMap(f => {
  if (typeof f.value !== 'string' || f.value.length <= 256) return [f]
  const parts: typeof record.fields = []
  for(let at=0;at<f.value.length;at+=256)parts.push({...f,name:at===0?f.name:`${f.name}Part${at/256+1}`,value:f.value.slice(at,at+256)})
  return parts
 })
 if(fields.length===record.fields.length)return record
 if(fields.length<=24)return {...record,fields}
 // Keep authority flags, the start, and the end: omitted middle text is explicit.
 const authority=fields.filter(f=>/Authority|Clearance|requiresConfirmation|executionState/.test(f.name))
 const others=fields.filter(f=>!authority.includes(f))
 const room=21-authority.length
 const head=Math.ceil(room/2),tail=Math.floor(room/2)
 const kept=[...authority,...others.slice(0,head),...(tail?others.slice(-tail):[])]
 return {...record,revision:sha256Hex(stableJson([record.revision,record.fields])),fields:[...kept,
  {name:'contentIncomplete',value:true,unit:null},
  {name:'omittedFieldParts',value:fields.length-kept.length,unit:null},
  {name:'fullContentDigest',value:sha256Hex(stableJson(record.fields)),unit:null}]}
}
