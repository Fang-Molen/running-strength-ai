import {useState} from 'react'
import {recordSegmentRpe,readSegmentRpe,type SegmentRpeIdentity} from '@/lib/core/segment-rpe'
export function SegmentRpeEditor({identity}:{identity:SegmentRpeIdentity}){
 const [value,setValue]=useState(()=>String(readSegmentRpe(identity)?.payload.value??'')),[notice,setNotice]=useState('')
 return <div className="mt-2"><label className="text-xs">本段RPE（0–10，可不填）<input aria-label="本段RPE" value={value} inputMode="decimal" onChange={e=>setValue(e.target.value)} className="ml-2 h-11 w-20 rounded border border-line bg-bg px-2"/></label><button type="button" className="min-h-11 px-3 text-sm underline" disabled={!value.trim()} onClick={()=>{const r=recordSegmentRpe(identity,Number(value));setNotice(r.ok?'本段评分已保存；不作为整课RPE。':r.reason)}}>保存本段评分</button><p role="status" className="text-xs text-muted">{notice}</p></div>
}
