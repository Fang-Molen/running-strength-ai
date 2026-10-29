/** References to a user's planned versus available session counts. These are not
 * completed training facts or new distance/intensity prescriptions. Both roles
 * must be present in exact, already verified quotations. */
const digits='[0-9零〇一二两三四五六七八九十百]+'
function count(s:string):number|null{
 if(/^\d+$/.test(s))return Number(s)
 const n:Record<string,number>={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9}
 if(s in n)return n[s]
 const m=s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
 return m?(m[1]?n[m[1]]:1)*10+(m[2]?n[m[2]]:0):null
}
export function boundPlanReference(clause:string,question:string|undefined,cited:readonly string[]=[]):boolean{
 if(!question||!cited.length)return false
 const plan=question.match(new RegExp('(?:原计划|原课表)[^，,。；;]{0,16}?('+digits+')\\s*次'))
 const available=question.match(new RegExp('(?:只能(?:训练|练|完成)?|可以(?:完成|训练|练)|可练|可用)[^，,。；;]{0,8}?('+digits+')\\s*次'))
 if(!plan||!available||!cited.some(q=>q.includes(plan[0]))||!cited.some(q=>q.includes(available[0])))return false
 const planned=count(plan[1]),capacity=count(available[1]);if(planned===null||capacity===null||planned>100||capacity>100)return false
 if(!/保留|关键课|其余课|原计划|可用|可练|可完成|只能|优先|取舍|本周|这周|顺延|放弃|取消/.test(clause))return false
 // An availability statement cannot become an accomplishment, measurement, or new dose.
 if(/已完成|已经完成|完成了|实际完成|已训练|已练|已经练|昨天|前天|测得|记录显示|实绩/.test(clause))return false
 if(/(?:把|将).{0,20}(?:压成|合并|叠加|塞进)/.test(clause)&&!/不|勿|不要|避免|不能/.test(clause))return false
 const hits=[...clause.matchAll(new RegExp('('+digits+')\\s*次','g'))];if(!hits.length)return false
 let remainder=clause
 for(const m of hits){const value=count(m[1]);if(value===null||value!==planned&&value!==capacity)return false
  const before=clause.slice(0,m.index),after=clause.slice((m.index??0)+m[0].length)
  if(value>capacity&&!/^中/.test(after)&&!/(?:原计划|原课表)(?:本周|这周)?(?:有)?$/.test(before))return false
  remainder=remainder.replace(m[0],'')
 }
 // Reject all other quantities, even if their numeric value occurs in a source.
 if(/[0-9０-９]|[零〇一二两三四五六七八九十百]+\s*(?:组|秒|分钟|小时|公里|米|公斤|千克|%|天|周)/.test(remainder))return false
 return true
}
