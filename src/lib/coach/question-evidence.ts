import {questionCalculations} from './question-calculation'
import {contextTextField} from './context-fields'
import type {CoachRequestContext} from './online-contract'
export function questionEvidence(question:string,context?:CoachRequestContext){
 const prior=(context?.records??[]).filter(r=>r.category==='DIALOGUE'&&r.fields.some(f=>f.name==='speaker'&&f.value==='user')).map(r=>contextTextField(r,'text'))
 const clauses=[...new Set(question.split(/[，,。；;！？?!]/).map(s=>s.trim()).filter(s=>s.length>=4&&/(?:[0-9一二两三四五六七八九十]+(?:组|次|秒|分钟|天|周|公里|米|公斤|千卡)|疼|酸|痛|发烧|走路|啪)/.test(s)&&!/^(?:请|不要|你建议|能否|我想|复盘|查看|根据|汇总|比较|解释|统计|计算|求)/.test(s)))]
 return [...clauses.slice(0,12).map((detail,i)=>({id:`question:current:${i}`,kind:'FACT' as const,detail})),...questionCalculations(question,prior)]
}
/** Only exact host-issued source statements are quotable; no arbitrary fragments. */
export function supportedEvidenceQuote(detail:string,quote:string):boolean{return quote===detail}
