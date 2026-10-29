import {validLoadDay,shiftLoadDay} from '../core/coach-load-metrics'
/** Calendar selection is not a physiological cutoff. Explicit invalid periods match nothing. */
export const requestsCalendarPeriod=(question:string)=>/前天|昨天|昨日|今天|明天|本周|这周|上周|本月|这个月|近\d+天|过去\d+天|前年|去年|今年|上个月|20\d{2}年|\d{4}-\d{2}-\d{2}/.test(question)
export function contextPeriod(question:string,day:string,timeZone:string){
 const year=Number(day.slice(0,4)),month=Number(day.slice(5,7)),hits=[...question.matchAll(/\d{4}-\d{2}-\d{2}/g)],days=hits.map(m=>m[0]),years=new Set<number>()
 if(/前年/.test(question))years.add(year-2)
 if(/去年/.test(question))years.add(year-1)
 if(/今年/.test(question))years.add(year)
 for(const m of question.matchAll(/(20\d{2})年/g))years.add(Number(m[1]))
 const lastMonth=month===1?`${year-1}-12`:`${year}-${String(month-1).padStart(2,'0')}`
 const monthPrefix=/上个月/.test(question)?lastMonth:null
 let error:string|null=null,range:{startDay:string;endDay:string}|null=null
 if(days.some(d=>!validLoadDay(d)))error='指定日期不存在，请核对日期；没有改用近期记录。'
 if(hits.length===2){
  const between=question.slice(hits[0].index!+days[0].length,hits[1].index).trim()
  if(/^(?:起)?(?:到|至|~|～|—|–|\.\.)$/.test(between)){
   if(days[0]>days[1])error='日期范围起点晚于终点，请核对；没有擅自交换日期。'
   else range={startDay:days[0],endDay:days[1]}
  }else if(!/^[\s、,，]*(?:和|与|及|以及)?[\s、,，]*$/.test(between))error='两个日期之间的范围含义不明确，请注明“到”或“和”。'
 }else if(hits.length>2&&/(?:到|至|~|～|—|–)/.test(question))error='多个日期范围含义不明确，请分开指定。'
 // Relative periods are anchored to the caller's as-of calendar day, never to a pre-shifted question day.
 if(!hits.length&&!years.size&&!monthPrefix){
  if(/前天|昨天|昨日|今天|明天/.test(question)){const offset=/前天/.test(question)?-2:/昨天|昨日/.test(question)?-1:/明天/.test(question)?1:0;const at=shiftLoadDay(day,offset)!;range={startDay:at,endDay:at}}
  else if(/上周|本周|这周/.test(question)){const weekday=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7,start=shiftLoadDay(day,-weekday)!;range=/上周/.test(question)?{startDay:shiftLoadDay(start,-7)!,endDay:shiftLoadDay(start,-1)!}:{startDay:start,endDay:day}}
  else if(/本月|这个月/.test(question))range={startDay:day.slice(0,7)+'-01',endDay:day}
  else {const n=question.match(/(?:最近|近|过去)(\d+)天/);if(n){const count=Number(n[1]);if(count<1||count>3660)error='日期范围超出可检索范围，请指定起止日期。';else range={startDay:shiftLoadDay(day,1-count)!,endDay:day}}}
 }
 const label=error?'无效日期范围':range?`${range.startDay}至${range.endDay}（含首尾）`:days.length?days.join('、'):years.size?[...years].sort().join('、')+'年':monthPrefix??null
 const bounds=error?null:range??(days.length?{startDay:[...days].sort()[0],endDay:[...days].sort().at(-1)!}:years.size?{startDay:`${Math.min(...years)}-01-01`,endDay:`${Math.max(...years)}-12-31`}:monthPrefix?{startDay:monthPrefix+'-01',endDay:new Date(Date.UTC(Number(monthPrefix.slice(0,4)),Number(monthPrefix.slice(5)),0)).toISOString().slice(0,10)}:null)
 let formatter:Intl.DateTimeFormat|undefined
 try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})}catch{error='用户时区不可用，请核对时区；未改用其他日历。'}
 const cache=new Map<string,string>()
 const localDate=(at:string,calendarDay=false)=>{
  if(calendarDay)return at.slice(0,10)
  if(cache.has(at))return cache.get(at)!
  try{const parts=formatter!.formatToParts(new Date(at)),d=['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-');cache.set(at,d);return d}catch{return ''}
 }
 return {label,error,bounds,range,days,years:[...years],matches:(at:string,calendarDay=false)=>{
  if(error)return false
  const d=localDate(at,calendarDay);if(!validLoadDay(d))return false
  return range?d>=range.startDay&&d<=range.endDay:days.length?days.includes(d):years.size?years.has(Number(d.slice(0,4))):monthPrefix?d.startsWith(monthPrefix):true
 },group:(at:string)=>range?localDate(at).slice(0,7):days.length?localDate(at):years.size?localDate(at).slice(0,4):'all'}
}
